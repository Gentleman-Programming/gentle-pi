import { createHash, randomBytes } from "node:crypto";
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
const MAX_GO_OUTPUT_BYTES = 1024 * 1024;
const RELEASE_BASE_URL = "https://github.com/Gentleman-Programming/gentle-ai/releases/download/v2.2.2/";
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUTS = { headers: 10_000, body: 30_000, attempts: 2, retryDelay: 100 };
export const INSTALLER_VERSION = "2.2.2";
export const GENTLE_AI_GO_MODULE = "github.com/gentleman-programming/gentle-ai/v2";
export const GENTLE_AI_GO_MODULE_SUM = "h1:YZcI5dRvoHm82I2CULvgBkB2M3UQQGarYO/u/Nt5LSc=";
export const GENTLE_AI_MINIMUM_GO_VERSION = "1.25.10";

// Sentinel used while a re-pinned gentle-ai release is not yet published. A
// sentinel digest can never match a real SHA-256, so installation fails closed,
// and verify-package-files.mjs refuses to pack/publish while any digest below
// still holds it. The v2.2.2 digests are pinned from the published release:
// archive sha256 values verified against the minisign-signed checksums.txt and
// freshly computed hashes; binary sha256 values computed from the extracted
// executables.
export const GENTLE_AI_PENDING_DIGEST = "PENDING-GENTLE-AI-RELEASE-DIGEST";

function asset(name, sha256, binarySha256, executable) {
	return Object.freeze({ name, sha256, binarySha256, executable, url: `${RELEASE_BASE_URL}${name}` });
}

// Windows is absent on purpose. gentle-ai stopped distributing Windows builds
// in c4b764d0 ("omit unsigned Windows distribution"), so v2.2.2 publishes only
// darwin and linux archives and there is nothing to pin. A Windows caller now
// gets resolveGentleAiReleaseAsset's unsupported-platform error, which is the
// truth: Pi cannot install a binary that upstream does not publish. Restore
// both rows the moment gentle-ai ships signed Windows assets again.
export const GENTLE_AI_RELEASE_ASSETS = Object.freeze({
	"darwin/amd64": asset("gentle-ai_2.2.2_darwin_amd64.tar.gz", "5ca67829903bf4c6b14665664f80f9d8216c84b10c8e50870d297f452cefb9dc", "9b239423450562d026384f482bbd2f1e3f2820431a84f0921743ac3df9d632de", "gentle-ai"),
	"darwin/arm64": asset("gentle-ai_2.2.2_darwin_arm64.tar.gz", "0193e1a284444dccee2863d31b8dbb76a982e8f9111955908d6a9131c1a5490e", "149b97248552c5e03ebc4d991f86b1360fb847a40fc315555a8aa256f95baca0", "gentle-ai"),
	"linux/amd64": asset("gentle-ai_2.2.2_linux_amd64.tar.gz", "b85bbb20eb2236de97b261df16cfc8d8394dfd07a137e885c4889b62d0c20fa1", "00d5732e8dd3945956800217a4f60213c2d9ca63351092a2cb7f4e5f9ece54f9", "gentle-ai"),
	"linux/arm64": asset("gentle-ai_2.2.2_linux_arm64.tar.gz", "61e7077342448273f0c43af49ce4d182594bab5e4f86f812975af2fbe69e3b0b", "a92685aa7dbea0cc4297d016569b3defe9bb30a7374a620021e245b74f50eb68", "gentle-ai"),
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
	if (!resolved) throw new Error(`unsupported Gentle AI release asset platform/architecture: ${platform}/${architecture}; supported release asset pairs are ${Object.keys(releaseAssets).join(", ")}`);
	return resolved;
}

function safeWindowsExecutable(path) {
	return typeof path === "string" && /^[A-Za-z]:\\[^\0\r\n"|<>*?]+\\go\.exe$/i.test(path) && win32.isAbsolute(path);
}

async function assertRegularNonSymlink(path, label) {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
}

async function resolveWindowsGo(env, run) {
	const override = env.GENTLE_PI_GO;
	if (override !== undefined) {
		if (!safeWindowsExecutable(override)) throw new Error("GENTLE_PI_GO must be an absolute local path ending in go.exe");
		await assertRegularNonSymlink(override, "GENTLE_PI_GO");
		return override;
	}
	const where = "C:\\Windows\\System32\\where.exe";
	await assertRegularNonSymlink(where, "System32 where.exe");
	const result = await run(where, ["go.exe"], { shell: false, windowsHide: true, maxBuffer: MAX_GO_OUTPUT_BYTES, env });
	const candidates = result.stdout.split(/\r?\n/u).filter(Boolean);
	if (candidates.length === 0) throw new Error("Gentle AI Windows installation requires Go 1.25.10 or newer on PATH, or an absolute GENTLE_PI_GO override");
	for (const candidate of candidates) {
		if (!safeWindowsExecutable(candidate)) continue;
		try { await assertRegularNonSymlink(candidate, "PATH go.exe"); return candidate; } catch { /* Try the next absolute PATH result. */ }
	}
	throw new Error("PATH did not resolve to a safe absolute go.exe");
}

function parseGoVersion(stdout) {
	const match = /^go version go(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(stdout.trim());
	if (!match) throw new Error("Unable to parse local Go version");
	return { text: `${match[1]}.${match[2]}.${match[3]}`, parts: match.slice(1).map(Number) };
}

function versionAtLeast(actual, minimum) {
	const expected = minimum.split(".").map(Number);
	return actual.every((value, index) => value === expected[index] ? true : value > expected[index] || actual.slice(0, index).some((part, prior) => part > expected[prior]));
}

function parseDownloadedModule(stdout) {
	let value;
	try { value = JSON.parse(stdout); } catch { throw new Error("Go module download returned malformed JSON"); }
	if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some((key) => !["Path", "Version", "Info", "GoMod", "Zip", "Dir", "Sum", "GoModSum", "Origin", "Reuse"].includes(key))) throw new Error("Go module download returned an unexpected JSON object");
	if (value.Path !== GENTLE_AI_GO_MODULE || value.Version !== `v${INSTALLER_VERSION}` || value.Sum !== GENTLE_AI_GO_MODULE_SUM) throw new Error("Go module download identity or checksum mismatch");
	if (typeof value.Dir !== "string" || !win32.isAbsolute(value.Dir) || /[\0\r\n]/u.test(value.Dir)) throw new Error("Go module download returned an unsafe source directory");
	return value.Dir;
}

async function buildGentleAiForWindows({ temporaryDirectory, env, run }) {
	const go = await resolveWindowsGo(env, run);
	const goEnv = { ...env, GOTOOLCHAIN: "local", GOWORK: "off", CGO_ENABLED: "0" };
	const versionResult = await run(go, ["version"], { shell: false, windowsHide: true, maxBuffer: MAX_GO_OUTPUT_BYTES, env: goEnv });
	const goVersion = parseGoVersion(versionResult.stdout);
	if (!versionAtLeast(goVersion.parts, GENTLE_AI_MINIMUM_GO_VERSION)) throw new Error(`Gentle AI Windows installation requires Go ${GENTLE_AI_MINIMUM_GO_VERSION} or newer; found ${goVersion.text}`);
	const moduleVersion = `v${INSTALLER_VERSION}`;
	const downloaded = await run(go, ["mod", "download", "-json", `${GENTLE_AI_GO_MODULE}@${moduleVersion}`], { shell: false, windowsHide: true, maxBuffer: MAX_GO_OUTPUT_BYTES, env: goEnv });
	const sourceDirectory = parseDownloadedModule(downloaded.stdout);
	const sourceBefore = await lstat(sourceDirectory);
	if (!sourceBefore.isDirectory() || sourceBefore.isSymbolicLink()) throw new Error("Go module source must be a real directory");
	const output = join(temporaryDirectory, `gentle-ai-${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}.exe`);
	await run(go, ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags", `-s -w -X main.version=${INSTALLER_VERSION}`, "-o", output, "./cmd/gentle-ai"], { cwd: sourceDirectory, shell: false, windowsHide: true, maxBuffer: MAX_GO_OUTPUT_BYTES, env: goEnv });
	const sourceAfter = await lstat(sourceDirectory);
	if (sourceBefore.dev !== sourceAfter.dev || sourceBefore.ino !== sourceAfter.ino || sourceBefore.mtimeMs !== sourceAfter.mtimeMs) throw new Error("Go module source changed during build");
	await assertRegularNonSymlink(output, "built Gentle AI executable");
	return { output, goVersion: goVersion.text };
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
		const releaseManifest = asset && Object.keys(parsed).length === 4
			&& ["version", "asset", "assetSha256", "binarySha256"].every((key) => key in parsed)
			&& parsed.asset === asset.name && parsed.assetSha256 === asset.sha256
			&& (!asset.binarySha256 || parsed.binarySha256 === asset.binarySha256);
		const sourceManifest = platform === "win32" && Object.keys(parsed).length === 7
			&& ["version", "provenance", "module", "moduleVersion", "moduleSum", "goVersion", "binarySha256"].every((key) => key in parsed)
			&& parsed.provenance === "go-source" && parsed.module === GENTLE_AI_GO_MODULE
			&& parsed.moduleVersion === `v${INSTALLER_VERSION}` && parsed.moduleSum === GENTLE_AI_GO_MODULE_SUM
			&& typeof parsed.goVersion === "string" && /^\d+\.\d+\.\d+$/u.test(parsed.goVersion);
		return parent.isDirectory() && !parent.isSymbolicLink()
			&& runtime.isDirectory() && !runtime.isSymbolicLink()
			&& binary.isFile() && !binary.isSymbolicLink()
			&& (platform === "win32" || (binary.mode & 0o111) !== 0)
			&& manifestFile.isFile() && !manifestFile.isSymbolicLink()
			&& typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			&& parsed.version === INSTALLER_VERSION
			&& (releaseManifest || sourceManifest)
			&& typeof parsed.binarySha256 === "string"
			&& /^[0-9a-f]{64}$/.test(parsed.binarySha256)
			&& (!asset?.binarySha256 || parsed.binarySha256 === asset.binarySha256)
			&& parsed.binarySha256 === await sha256File(binaryPath);
	} catch {
		return false;
	}
}

async function promoteWindowsRuntime(temporaryBinary, binaryPath, temporaryManifest, manifestPath) {
	const nonce = `${process.pid}.${Date.now()}.${randomBytes(8).toString("hex")}`;
	const backupBinary = `${binaryPath}.${nonce}.bak`;
	const backupManifest = `${manifestPath}.${nonce}.bak`;
	let binaryBackedUp = false;
	let manifestBackedUp = false;
	try {
		if (existsSync(binaryPath)) { await rename(binaryPath, backupBinary); binaryBackedUp = true; }
		if (existsSync(manifestPath)) { await rename(manifestPath, backupManifest); manifestBackedUp = true; }
		await rename(temporaryBinary, binaryPath);
		await rename(temporaryManifest, manifestPath);
	} catch (error) {
		await rm(binaryPath, { force: true }).catch(() => undefined);
		await rm(manifestPath, { force: true }).catch(() => undefined);
		if (binaryBackedUp) await rename(backupBinary, binaryPath).catch(() => undefined);
		if (manifestBackedUp) await rename(backupManifest, manifestPath).catch(() => undefined);
		throw error;
	} finally {
		await rm(backupBinary, { force: true }).catch(() => undefined);
		await rm(backupManifest, { force: true }).catch(() => undefined);
	}
}

export async function installGentleAi(options = {}) {
	const packageRoot = options.packageRoot ?? resolveGentleAiInstallerPackageRoot();
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const releaseAssets = options.releaseAssets ?? GENTLE_AI_RELEASE_ASSETS;
	const windowsSourceBuild = platform === "win32" && arch === "x64";
	const asset = windowsSourceBuild ? undefined : resolveGentleAiReleaseAsset(platform, arch, releaseAssets);
	const installDirectory = join(packageRoot, ".gentle-ai", `v${INSTALLER_VERSION}`);
	const binaryPath = join(installDirectory, windowsSourceBuild ? "gentle-ai.exe" : asset.executable);
	const manifestPath = join(installDirectory, "integrity.json");
	await assertRuntimeDirectory(join(packageRoot, ".gentle-ai"));
	await assertRuntimeDirectory(installDirectory);
	if (await existingBinaryMatches(binaryPath, manifestPath, asset, platform)) return { installed: false, binaryPath, asset };

	await mkdir(packageRoot, { recursive: true });
	const temporaryDirectory = await mkdtemp(join(packageRoot, ".gentle-ai-install-"));
	try {
		await chmod(temporaryDirectory, 0o700);
		if (windowsSourceBuild) {
			const run = options.execFile ?? execFileAsync;
			const built = await buildGentleAiForWindows({ temporaryDirectory, env: options.env ?? process.env, run });
			await mkdir(installDirectory, { recursive: true, mode: 0o700 });
			await assertRuntimeDirectory(join(packageRoot, ".gentle-ai"));
			await assertRuntimeDirectory(installDirectory);
			const nonce = `${process.pid}.${Date.now()}`;
			const temporaryBinary = join(installDirectory, `.gentle-ai.exe.${nonce}.tmp`);
			const temporaryManifest = join(installDirectory, `.integrity.${nonce}.tmp`);
			await copyFile(built.output, temporaryBinary);
			await assertRegularNonSymlink(temporaryBinary, "temporary Gentle AI executable");
			const binarySha256 = await sha256File(temporaryBinary);
			await writeFile(temporaryManifest, `${JSON.stringify({ version: INSTALLER_VERSION, provenance: "go-source", module: GENTLE_AI_GO_MODULE, moduleVersion: `v${INSTALLER_VERSION}`, moduleSum: GENTLE_AI_GO_MODULE_SUM, goVersion: built.goVersion, binarySha256 })}\n`, { mode: 0o600 });
			try {
				await promoteWindowsRuntime(temporaryBinary, binaryPath, temporaryManifest, manifestPath);
			} finally {
				await rm(temporaryBinary, { force: true }).catch(() => undefined);
				await rm(temporaryManifest, { force: true }).catch(() => undefined);
			}
			return { installed: true, binaryPath, asset: { provenance: "go-source", module: GENTLE_AI_GO_MODULE } };
		}
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
