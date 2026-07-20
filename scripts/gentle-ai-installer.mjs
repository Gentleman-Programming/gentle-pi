import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import https from "node:https";
import { dirname, isAbsolute, join, relative, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_BASE_URL = "https://github.com/Gentleman-Programming/gentle-ai/releases/download/v2.1.11/";
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUTS = { headers: 10_000, body: 30_000, attempts: 2, retryDelay: 100 };
const INSTALLER_VERSION = "2.1.11";

// Sentinel used while a re-pinned gentle-ai release is not yet published. A
// sentinel digest can never match a real SHA-256, so installation fails closed,
// and verify-package-files.mjs refuses to pack/publish while any digest below
// still holds it. The v2.1.11 digests are pinned from the published release:
// archive sha256 values verified against checksums.txt and freshly computed
// hashes; binary sha256 values computed from the extracted executables.
export const GENTLE_AI_PENDING_DIGEST = "PENDING-GENTLE-AI-RELEASE-DIGEST";

function asset(name, sha256, binarySha256, executable) {
	return Object.freeze({ name, sha256, binarySha256, executable, url: `${RELEASE_BASE_URL}${name}` });
}

export const GENTLE_AI_RELEASE_ASSETS = Object.freeze({
	"darwin/amd64": asset("gentle-ai_2.1.11_darwin_amd64.tar.gz", "80c2a6bba981fd0ec1fdc9b21d9b80c03853cacc644b307ca7baf1faa6b376d2", "bffca50cb51b07cc1c428e21616ea1cf7d25970643fed13ab0aa10fd359bbd02", "gentle-ai"),
	"darwin/arm64": asset("gentle-ai_2.1.11_darwin_arm64.tar.gz", "27e49a5104ff1ab156276e191b845f266135afe9339f111689ddf340b562c926", "4e39e520abf116a53ff5e36a0cd65756b6fadfa528489f21e9c722bfa00af620", "gentle-ai"),
	"linux/amd64": asset("gentle-ai_2.1.11_linux_amd64.tar.gz", "d115aaf5724a71503150ebf740769e7aa52e41e673ac39bf5b0ff1be4e3324b0", "45788ac6cf37a6165f50aca3503d4af4e7e375e518fc67010064dccf78f98d2d", "gentle-ai"),
	"linux/arm64": asset("gentle-ai_2.1.11_linux_arm64.tar.gz", "aea3a4b0064b57df5f831fdf6b27b29e9898a8f9393fd648dea4a8ba563e477e", "2bf929993ba03dd02401a3c35d8b0bff7801717e43d17b39e29f3cd389894e63", "gentle-ai"),
	"windows/amd64": asset("gentle-ai_2.1.11_windows_amd64.zip", "43fb4e66cf36a7f01d2d343f59fe8ff37396fc0e98fb24abcd95bc79c2450e9a", "1c92cdcaf826d4bec6a6560770e5a0edefc09997364a664a5033abc6ab932b2b", "gentle-ai.exe"),
	"windows/arm64": asset("gentle-ai_2.1.11_windows_arm64.zip", "9c2884075161715f0efac1ce55cd08f2d9313068f125443ade8de3a83645258a", "a903bface64af274a28cfdd08b5c55c67fc554bac9279d7d466fc3f99020bd89", "gentle-ai.exe"),
});

function upstreamArchitecture(architecture) {
	return architecture === "x64" ? "amd64" : architecture;
}

function upstreamPlatform(platform) {
	return platform === "win32" ? "windows" : platform;
}

export function resolveGentleAiReleaseAsset(platform = process.platform, architecture = process.arch, releaseAssets = GENTLE_AI_RELEASE_ASSETS) {
	const key = `${upstreamPlatform(platform)}/${upstreamArchitecture(architecture)}`;
	const resolved = releaseAssets[key];
	if (!resolved) throw new Error(`unsupported Gentle AI platform/architecture: ${platform}/${architecture}; supported pairs are darwin, linux, or windows with x64 or arm64`);
	return resolved;
}

export function resolveGentleAiInstallerPackageRoot() {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

async function sha256File(path) {
	return createHash("sha256").update(await readFile(path)).digest("hex");
}

function downloadTimeoutError(stage) { return Object.assign(new Error(`Gentle AI download ${stage} timed out`), { code: "GENTLE_AI_DOWNLOAD_TIMEOUT" }); }
function isRetryableDownloadError(error) { return error && typeof error === "object" && ["GENTLE_AI_DOWNLOAD_TIMEOUT", "GENTLE_AI_DOWNLOAD_TRANSIENT_HTTP", "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"].includes(error.code); }
function downloadHttpError(status) { return Object.assign(new Error(`Gentle AI download failed with HTTP ${status}`), { code: [429, 500, 502, 503, 504].includes(status) ? "GENTLE_AI_DOWNLOAD_TRANSIENT_HTTP" : "GENTLE_AI_DOWNLOAD_HTTP" }); }
export async function downloadGentleAiAsset(url, destination, maxBytes = MAX_DOWNLOAD_BYTES, redirects = MAX_REDIRECTS, options = {}) {
	const { request = https.get, headerTimeoutMs = DOWNLOAD_TIMEOUTS.headers, bodyTimeoutMs = DOWNLOAD_TIMEOUTS.body, maxAttempts = DOWNLOAD_TIMEOUTS.attempts, retryDelayMs = DOWNLOAD_TIMEOUTS.retryDelay } = options;
	if (![headerTimeoutMs, bodyTimeoutMs, retryDelayMs, maxAttempts].every((value) => Number.isSafeInteger(value) && value >= 0) || maxAttempts < 1) throw new TypeError("Gentle AI download timeout and retry options must be safe non-negative integers");
	const responseFor = async (currentUrl, remainingRedirects) => {
		const parsed = new URL(currentUrl);
		if (parsed.protocol !== "https:") throw new Error("Gentle AI installer requires HTTPS downloads");
		return new Promise((resolve, reject) => {
			let pending;
			const timer = setTimeout(() => pending?.destroy(downloadTimeoutError("headers")), headerTimeoutMs);
			const fail = (error) => { clearTimeout(timer); reject(error); };
			pending = request(parsed, { headers: { "user-agent": "gentle-pi-installer" } }, (response) => {
				clearTimeout(timer);
				const status = response.statusCode ?? 0, location = response.headers.location;
				if (status >= 300 && status < 400 && location) { response.resume(); return remainingRedirects <= 0 ? fail(new Error("Gentle AI download exceeded redirect limit")) : responseFor(new URL(location, parsed).toString(), remainingRedirects - 1).then(resolve, reject); }
				if (status !== 200) { response.resume(); return fail(downloadHttpError(status)); }
				resolve(response);
			});
			pending.on("error", fail);
			pending.setTimeout?.(headerTimeoutMs, () => pending.destroy(downloadTimeoutError("headers")));
		});
	};
	const downloadOnce = async () => {
		const response = await responseFor(url, redirects), contentLength = Number(response.headers["content-length"] ?? "0");
		if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) { response.resume(); throw new Error("Gentle AI download exceeds the maximum allowed size"); }
		await new Promise((resolve, reject) => {
			const output = createWriteStream(destination, { flags: "wx", mode: 0o600 }); let received = 0, settled = false;
			let timer = setTimeout(() => response.destroy(downloadTimeoutError("body")), bodyTimeoutMs);
			const finish = (callback, value) => { if (!settled) { settled = true; clearTimeout(timer); callback(value); } };
			const fail = (error) => { response.destroy(); output.destroy(); finish(reject, error); };
			const reset = () => { clearTimeout(timer); timer = setTimeout(() => response.destroy(downloadTimeoutError("body")), bodyTimeoutMs); };
			response.on("data", (chunk) => { reset(); received += chunk.length; if (received > maxBytes) response.destroy(new Error("Gentle AI download exceeds the maximum allowed size")); });
			response.on("error", fail); response.setTimeout?.(bodyTimeoutMs, () => response.destroy(downloadTimeoutError("body")));
			output.on("error", fail); output.on("finish", () => finish(resolve)); response.pipe(output);
		});
	};
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) try { if (attempt > 1) await rm(destination, { force: true }); await downloadOnce(); return; } catch (error) {
		if (attempt === maxAttempts || !isRetryableDownloadError(error)) throw error;
		if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
	}
}

export function trustedSystemExtractor(archive, platform = process.platform, exists = existsSync) {
	if (platform === "win32") {
		const command = "C:\\Windows\\System32\\tar.exe";
		if (exists(command)) return { command, arguments_: ["-xf", archive, "-C"] };
		throw new Error("Gentle AI installer requires the System32 tar.exe extractor");
	}
	const name = archive.endsWith(".zip") ? "unzip" : "tar";
	const command = [join("/usr/bin", name), join("/bin", name)].find((path) => exists(path));
	if (!command) throw new Error(`Gentle AI installer requires a trusted system ${name} extractor`);
	return { command, arguments_: archive.endsWith(".zip") ? ["-q", archive, "-d"] : ["-xzf", archive, "-C"] };
}

export async function extractGentleAiArchive(archive, destination) {
	await mkdir(destination, { recursive: true, mode: 0o700 });
	const extractor = trustedSystemExtractor(archive);
	try {
		await execFileAsync(extractor.command, [...extractor.arguments_, destination], { shell: false, windowsHide: true, maxBuffer: 1024 * 1024 });
	} catch (error) {
		throw new Error(`Unable to extract ${archive} with trusted system extractor ${extractor.command}.`, { cause: error });
	}
}

async function expectedRegularFile(directory, executable) {
	const candidates = [];
	async function visit(current) {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.name === executable) {
				const details = await lstat(path);
				if (!details.isFile()) throw new Error(`Gentle AI archive contains a non-regular ${executable}`);
				candidates.push(path);
			} else if (entry.isDirectory()) await visit(path);
		}
	}
	await visit(directory);
	if (candidates.length !== 1) throw new Error(`Gentle AI archive must contain exactly one regular ${executable}`);
	return candidates[0];
}

async function assertRuntimeDirectory(path) {
	try {
		const details = await lstat(path);
		if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("Gentle AI package-local runtime directory must be a real directory");
	} catch (error) {
		if (error && typeof error === "object" && error.code === "ENOENT") return;
		throw error;
	}
}

function isConfined(path, directory) {
	const value = relative(directory, path);
	return value !== "" && !value.startsWith("..") && !isAbsolute(value);
}

async function existingBinaryMatches(binaryPath, manifestPath, asset, platform) {
	try {
		const runtimeDirectory = dirname(binaryPath);
		const packageRuntimeDirectory = dirname(runtimeDirectory);
		if (!isConfined(binaryPath, runtimeDirectory) || !isConfined(manifestPath, runtimeDirectory)) return false;
		const [parent, runtime, binary, manifestFile, manifest] = await Promise.all([
			lstat(packageRuntimeDirectory), lstat(runtimeDirectory), lstat(binaryPath), lstat(manifestPath), readFile(manifestPath, "utf8"),
		]);
		const parsed = JSON.parse(manifest);
		return parent.isDirectory() && !parent.isSymbolicLink()
			&& runtime.isDirectory() && !runtime.isSymbolicLink()
			&& binary.isFile() && !binary.isSymbolicLink()
			&& (platform === "win32" || (binary.mode & 0o111) !== 0)
			&& manifestFile.isFile() && !manifestFile.isSymbolicLink()
			&& typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			&& Object.keys(parsed).length === 4
			&& ["version", "asset", "assetSha256", "binarySha256"].every((key) => key in parsed)
			&& parsed.version === INSTALLER_VERSION
			&& parsed.asset === asset.name
			&& parsed.assetSha256 === asset.sha256
			&& typeof parsed.binarySha256 === "string"
			&& /^[0-9a-f]{64}$/.test(parsed.binarySha256)
			&& (!asset.binarySha256 || parsed.binarySha256 === asset.binarySha256)
			&& parsed.binarySha256 === await sha256File(binaryPath);
	} catch {
		return false;
	}
}

export async function installGentleAi(options = {}) {
	const packageRoot = options.packageRoot ?? resolveGentleAiInstallerPackageRoot();
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const releaseAssets = options.releaseAssets ?? GENTLE_AI_RELEASE_ASSETS;
	const asset = resolveGentleAiReleaseAsset(platform, arch, releaseAssets);
	const installDirectory = join(packageRoot, ".gentle-ai", `v${INSTALLER_VERSION}`);
	const binaryPath = join(installDirectory, asset.executable);
	const manifestPath = join(installDirectory, "integrity.json");
	await assertRuntimeDirectory(join(packageRoot, ".gentle-ai"));
	await assertRuntimeDirectory(installDirectory);
	if (await existingBinaryMatches(binaryPath, manifestPath, asset, platform)) return { installed: false, binaryPath, asset };

	await mkdir(packageRoot, { recursive: true });
	const temporaryDirectory = await mkdtemp(join(packageRoot, ".gentle-ai-install-"));
	try {
		await chmod(temporaryDirectory, 0o700);
		const archive = join(temporaryDirectory, asset.name);
		await (options.download ?? downloadGentleAiAsset)(asset.url, archive);
		const digest = await sha256File(archive);
		if (digest !== asset.sha256) throw new Error(`Gentle AI archive checksum mismatch for ${asset.name}`);
		const extracted = join(temporaryDirectory, "extracted");
		await (options.extractArchive ?? extractGentleAiArchive)(archive, extracted);
		const source = await expectedRegularFile(extracted, asset.executable);
		if (asset.binarySha256 && (await sha256File(source)) !== asset.binarySha256) throw new Error(`Gentle AI binary checksum mismatch for ${asset.name}`);
		await mkdir(installDirectory, { recursive: true, mode: 0o700 });
		await assertRuntimeDirectory(join(packageRoot, ".gentle-ai"));
		await assertRuntimeDirectory(installDirectory);
		const temporaryBinary = join(installDirectory, `.${asset.executable}.${process.pid}.${Date.now()}.tmp`);
		const temporaryManifest = join(installDirectory, `.integrity.${process.pid}.${Date.now()}.tmp`);
		await copyFile(source, temporaryBinary);
		if (platform !== "win32") await chmod(temporaryBinary, 0o700);
		const binarySha256 = await sha256File(temporaryBinary);
		await writeFile(temporaryManifest, `${JSON.stringify({ version: INSTALLER_VERSION, asset: asset.name, assetSha256: asset.sha256, binarySha256 })}\n`, { mode: 0o600 });
		await rename(temporaryBinary, binaryPath);
		await rename(temporaryManifest, manifestPath);
		return { installed: true, binaryPath, asset };
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
	}
}
