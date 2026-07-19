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
const RELEASE_BASE_URL = "https://github.com/Gentleman-Programming/gentle-ai/releases/download/v2.1.8/";
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUTS = { headers: 10_000, body: 30_000, attempts: 2, retryDelay: 100 };
const INSTALLER_VERSION = "2.1.8";

// Sentinel used while a re-pinned gentle-ai release is not yet published. A
// sentinel digest can never match a real SHA-256, so installation fails closed,
// and verify-package-files.mjs refuses to pack/publish while any digest below
// still holds it. The v2.1.8 digests are pinned from the published release:
// archive sha256 values verified against checksums.txt and freshly computed
// hashes; binary sha256 values computed from the extracted executables.
export const GENTLE_AI_PENDING_DIGEST = "PENDING-GENTLE-AI-RELEASE-DIGEST";

function asset(name, sha256, binarySha256, executable) {
	return Object.freeze({ name, sha256, binarySha256, executable, url: `${RELEASE_BASE_URL}${name}` });
}

export const GENTLE_AI_RELEASE_ASSETS = Object.freeze({
	"darwin/amd64": asset("gentle-ai_2.1.8_darwin_amd64.tar.gz", "cafe1e1ab27ebad0f11037b97f1642d940e382df2be36002cf008836b631d1dd", "a9300b10d369007df7ed76c70dcae06f114ec1bbe9042ca730af836356bbd885", "gentle-ai"),
	"darwin/arm64": asset("gentle-ai_2.1.8_darwin_arm64.tar.gz", "7a7095bf4ff1ca5ab277197256cf7925dfbdb3bb3a69c5b3a83c9d0ca4a75489", "bd4d2600d761ec097f5b621ce10f53c5cf0b54dffed21c808177e279b86008c2", "gentle-ai"),
	"linux/amd64": asset("gentle-ai_2.1.8_linux_amd64.tar.gz", "9c8004918c2c3bd1c4bb3975b31edd7e272fc1e6ebc71a17327f553265dc59b7", "b57728d1254af966cc39796bcb00cf0d2bbc405df6f174dc872bab4dc2735287", "gentle-ai"),
	"linux/arm64": asset("gentle-ai_2.1.8_linux_arm64.tar.gz", "28ef653b6d0ecdc47ea43a11af8d51b11865be5d823795557911a3da9c1f0a50", "34fd6ee751af8aa22c2e301c71d202c60664d865da68e7c928b4a6e539803106", "gentle-ai"),
	"windows/amd64": asset("gentle-ai_2.1.8_windows_amd64.zip", "705cf3570a52165f2e4f79f8d0ac549217a4723ebdfb542bfb7e13882920e61c", "61dbdf465fe57b35bcff0cba246137dd63ebabd3a7a9153c08ebb59e6b032581", "gentle-ai.exe"),
	"windows/arm64": asset("gentle-ai_2.1.8_windows_arm64.zip", "001036f4e6bd2e3a81139b0dcbd8161c04ffa8f774a0209daf35867096967824", "ad825935dd27f8972a05a073e7df13aa941b408cb4f7782ab084a87fa016ea8d", "gentle-ai.exe"),
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
