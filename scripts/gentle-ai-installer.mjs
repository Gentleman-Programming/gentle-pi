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
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUTS = { headers: 10_000, body: 30_000, attempts: 2, retryDelay: 100 };
const GO_COMMAND_TIMEOUT_MS = 120_000;
const GO_COMMAND_MAX_BUFFER = 1024 * 1024;
const WINDOWS_SYSTEM_ROOT = "C:\\Windows";
// The one authoritative pinned Gentle AI version. Every other location in this
// module (the release download URL, the Windows source tag, and the reported
// version check below) derives from this constant instead of repeating the
// literal, so a pin bump cannot leave a stale copy behind. See
// scripts/install-gentle-ai.mjs for the incident that motivated this.
export const INSTALLER_VERSION = "2.5.0-rc.3";
export const RELEASE_BASE_URL = `https://github.com/Gentleman-Programming/gentle-ai/releases/download/v${INSTALLER_VERSION}/`;
export const GENTLE_AI_INSTALL_METHOD = Object.freeze({
	SIGNED_RELEASE_ASSET: "signed-release-asset",
	GO_SUMDB_SOURCE_BUILD: "go-sumdb-source-build",
});
export const GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH = "github.com/gentleman-programming/gentle-ai/v2/cmd/gentle-ai";
export const GENTLE_AI_WINDOWS_SOURCE_MODULE = "github.com/gentleman-programming/gentle-ai/v2";
export const GENTLE_AI_WINDOWS_SOURCE_TAG = `v${INSTALLER_VERSION}`;
// `go mod download -json github.com/gentleman-programming/gentle-ai/v2@v2.5.0-rc.3`
// with GOSUMDB=sum.golang.org reports this exact module SumDB checksum, and the
// tag resolves to commit 8e5c79b0, the published v2.5.0-rc.3 release head.
export const GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM = "h1:zDmIUCSZxFowQQjR4IS+YhvHPKHABYKyRT3ytZi8Qj4=";
export const GENTLE_AI_WINDOWS_SOURCE_PACKAGE = `${GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH}@${GENTLE_AI_WINDOWS_SOURCE_TAG}`;
export const GENTLE_AI_WINDOWS_MINIMUM_GO_VERSION = "1.25.10";
export const GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE_CODE = "GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE";
export const GENTLE_AI_GO_TOOLCHAIN_TOO_OLD_CODE = "GENTLE_AI_GO_TOOLCHAIN_TOO_OLD";
export const GENTLE_AI_GO_INSTALL_FAILED_CODE = "GENTLE_AI_GO_INSTALL_FAILED";
export const GENTLE_AI_VERSION_MISMATCH_CODE = "GENTLE_AI_VERSION_MISMATCH";

export class GentleAiInstallerError extends Error {
	constructor(code, message, cause) {
		super(message, cause === undefined ? undefined : { cause });
		this.code = code;
		this.name = "GentleAiInstallerError";
	}
}

// Sentinel used while a re-pinned gentle-ai release is not yet published. A
// sentinel digest can never match a real SHA-256, so installation fails closed,
// and verify-package-files.mjs refuses to pack/publish while any digest below
// still holds it. The v2.5.0-rc.3 prerelease ships raw binaries rather than
// signed archives, so its digests are verified against the release's published
// SHA256SUMS.txt and independently recomputed from the downloaded assets; a
// prerelease has no minisign-signed checksums.txt. For a raw binary the asset
// and the executable are the same bytes, so both pinned digests are equal.
export const GENTLE_AI_PENDING_DIGEST = "PENDING-GENTLE-AI-RELEASE-DIGEST";

function asset(name, sha256, binarySha256, executable) {
	return Object.freeze({ name, sha256, binarySha256, executable, url: `${RELEASE_BASE_URL}${name}` });
}

// Windows is absent from the pinned release assets on purpose. gentle-ai
// stopped distributing unsigned Windows builds in c4b764d0; Windows x64/arm64
// uses the separately verified exact-tag Go SumDB source-build path below.
// v2.5.0-rc.3 is a prerelease and ships raw platform binaries instead of
// signed archives, so each row pins the downloaded file itself: the asset
// digest and the binary digest are the same SHA-256, both verified against the
// release's SHA256SUMS.txt and independently recomputed.
export const GENTLE_AI_RELEASE_ASSETS = Object.freeze({
	"darwin/amd64": asset("gentle-ai_2.5.0-rc.3_darwin_amd64", "8aea61402abadc235645af0e2ad7a74a335337f7a32e52bbcf2ef6003304c7c5", "8aea61402abadc235645af0e2ad7a74a335337f7a32e52bbcf2ef6003304c7c5", "gentle-ai"),
	"darwin/arm64": asset("gentle-ai_2.5.0-rc.3_darwin_arm64", "6e5c026e68c974787b71a7e25f346bb667322c97d5fec2a0d688bf331128d7fd", "6e5c026e68c974787b71a7e25f346bb667322c97d5fec2a0d688bf331128d7fd", "gentle-ai"),
	"linux/amd64": asset("gentle-ai_2.5.0-rc.3_linux_amd64", "b69da0a51b03f326147498ae465fc1ec52eff8427d579964eefad714c3f9bd87", "b69da0a51b03f326147498ae465fc1ec52eff8427d579964eefad714c3f9bd87", "gentle-ai"),
	"linux/arm64": asset("gentle-ai_2.5.0-rc.3_linux_arm64", "e69393bcf337db932a245fc79c87f3877a74b11800c35f4e002614379671b2d9", "e69393bcf337db932a245fc79c87f3877a74b11800c35f4e002614379671b2d9", "gentle-ai"),
});

// A pinned asset is either a signed archive or, for a prerelease pin only,
// the raw executable itself: prereleases are hand-built and ship raw binaries,
// while every stable release publishes signed archives, so a raw asset under a
// stable pin means the pin itself is wrong. Anything else fails closed before
// a byte is downloaded.
export function gentleAiAssetForm(name, installerVersion = INSTALLER_VERSION) {
	if (name.endsWith(".tar.gz") || name.endsWith(".zip")) return "archive";
	if (/^gentle-ai_[0-9A-Za-z.+~-]+_(darwin|linux|windows)_(amd64|arm64)(\.exe)?$/.test(name)) {
		if (!installerVersion.includes("-")) throw new Error(`raw Gentle AI release asset ${name} is only admitted for a prerelease pin; stable pin ${installerVersion} requires a signed archive`);
		return "raw-binary";
	}
	throw new Error(`unsupported Gentle AI release asset form: ${name}`);
}

function upstreamArchitecture(architecture) {
	return architecture === "x64" ? "amd64" : architecture;
}

function upstreamPlatform(platform) {
	return platform === "win32" ? "windows" : platform;
}

export function isWindowsGoSumdbSourceTarget(platform = process.platform, architecture = process.arch) {
	return platform === "win32" && ["x64", "arm64"].includes(architecture);
}

export function resolveGentleAiReleaseAsset(platform = process.platform, architecture = process.arch, releaseAssets = GENTLE_AI_RELEASE_ASSETS) {
	const key = `${upstreamPlatform(platform)}/${upstreamArchitecture(architecture)}`;
	const resolved = releaseAssets[key];
	if (!resolved) {
		const windowsSource = isWindowsGoSumdbSourceTarget(platform, architecture)
			? "; Windows x64/arm64 use Go SumDB source installation because no signed Windows archive is published"
			: "";
		throw new Error(`unsupported Gentle AI platform/architecture: ${platform}/${architecture}; pinned release asset pairs are darwin/x64, darwin/arm64, linux/x64, and linux/arm64${windowsSource}`);
	}
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

function signedReleaseManifest(asset, binarySha256) {
	return { version: INSTALLER_VERSION, asset: asset.name, assetSha256: asset.sha256, binarySha256 };
}

function windowsSourceManifest(metadata, binarySha256, architecture) {
	return {
		version: INSTALLER_VERSION,
		method: GENTLE_AI_INSTALL_METHOD.GO_SUMDB_SOURCE_BUILD,
		package: GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH,
		module: GENTLE_AI_WINDOWS_SOURCE_MODULE,
		tag: GENTLE_AI_WINDOWS_SOURCE_TAG,
		architecture,
		binarySha256,
		moduleChecksum: GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM,
		goVersion: metadata.goVersion,
		goos: metadata.goos,
		goarch: metadata.goarch,
		buildMode: metadata.buildMode,
		compiler: metadata.compiler,
		cgoEnabled: metadata.cgoEnabled,
	};
}

function canonicalManifest(manifest) { return `${JSON.stringify(manifest)}\n`; }

function isCanonicalManifest(contents, parsed, expected) {
	return contents === canonicalManifest(expected)
		&& typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		&& Object.keys(parsed).length === Object.keys(expected).length
		&& Object.entries(expected).every(([key, value]) => parsed[key] === value);
}

function commandOutput(result) { return typeof result?.stdout === "string" ? result.stdout : ""; }

function commandOptions(env, cwd) {
	return { cwd, env, shell: false, windowsHide: true, timeout: GO_COMMAND_TIMEOUT_MS, maxBuffer: GO_COMMAND_MAX_BUFFER };
}

function outputVersion(output) {
	const match = /^go version go(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(output);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function isVersionAtLeast(actual, minimum) {
	return actual[0] > minimum[0] || (actual[0] === minimum[0] && (actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2])));
}

export function isGentleAiWindowsGoVersionSupported(goVersion) {
	const match = /^go(\d+)\.(\d+)\.(\d+)$/.exec(goVersion);
	return match !== null && isVersionAtLeast(match.slice(1).map(Number), GENTLE_AI_WINDOWS_MINIMUM_GO_VERSION.split(".").map(Number));
}

function expectedGoArchitecture(architecture) { return architecture === "x64" ? "amd64" : "arm64"; }

function sealedGoEnvironment(goPath, buildDirectory, architecture) {
	const goDirectory = dirname(goPath);
	const tempDirectory = join(buildDirectory, "tmp");
	return {
		GOENV: "off", GOFLAGS: "", GOWORK: "off", GOTOOLCHAIN: "local", GOSUMDB: "sum.golang.org",
		GONOSUMDB: "", GOPRIVATE: "", GONOPROXY: "", GOINSECURE: "", GOPROXY: "https://proxy.golang.org",
		GOOS: "windows", GOARCH: expectedGoArchitecture(architecture), CGO_ENABLED: "0",
		GOBIN: join(buildDirectory, "gobin"), GOPATH: join(buildDirectory, "gopath"), GOMODCACHE: join(buildDirectory, "gomodcache"), GOCACHE: join(buildDirectory, "gocache"),
		SystemRoot: WINDOWS_SYSTEM_ROOT, WINDIR: WINDOWS_SYSTEM_ROOT, ComSpec: join(WINDOWS_SYSTEM_ROOT, "System32", "cmd.exe"),
		TEMP: tempDirectory, TMP: tempDirectory, PATHEXT: ".COM;.EXE;.BAT;.CMD",
		PATH: [goDirectory, join(WINDOWS_SYSTEM_ROOT, "System32"), WINDOWS_SYSTEM_ROOT].join(";"),
	};
}

async function runCommand(execute, file, arguments_, options) { return execute(file, arguments_, options); }

async function resolveWindowsGoExecutable(options) {
	let resolved;
	if (options.resolveGoExecutable) resolved = await options.resolveGoExecutable();
	else {
		try {
			const result = await execFileAsync(join(WINDOWS_SYSTEM_ROOT, "System32", "where.exe"), ["go.exe"], { shell: false, windowsHide: true, timeout: GO_COMMAND_TIMEOUT_MS, maxBuffer: GO_COMMAND_MAX_BUFFER });
			resolved = commandOutput(result).split(/\r?\n/).find((value) => isAbsolute(value));
		} catch (error) {
			throw new GentleAiInstallerError(GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE_CODE, `Windows source installation requires local Go ${GENTLE_AI_WINDOWS_MINIMUM_GO_VERSION} or newer; install Go and retry (automatic Go toolchain download is disabled).`, error);
		}
	}
	if (typeof resolved !== "string" || !isAbsolute(resolved)) throw new GentleAiInstallerError(GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE_CODE, "Windows source installation could not resolve an absolute local Go executable.");
	try {
		const details = await lstat(resolved);
		if (!details.isFile() || details.isSymbolicLink()) throw new Error("not a regular non-symlink file");
	} catch (error) {
		throw new GentleAiInstallerError(GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE_CODE, "Windows source installation requires a regular non-symlink local Go executable.", error);
	}
	return resolved;
}

async function assertGoToolchain(execute, goPath, environment, cwd) {
	let result;
	try { result = await runCommand(execute, goPath, ["version"], commandOptions(environment, cwd)); }
	catch (error) { throw new GentleAiInstallerError(GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE_CODE, `Windows source installation requires local Go ${GENTLE_AI_WINDOWS_MINIMUM_GO_VERSION} or newer; install Go and retry (automatic Go toolchain download is disabled).`, error); }
	const version = outputVersion(commandOutput(result));
	const minimum = GENTLE_AI_WINDOWS_MINIMUM_GO_VERSION.split(".").map(Number);
	if (!version || !isVersionAtLeast(version, minimum)) throw new GentleAiInstallerError(GENTLE_AI_GO_TOOLCHAIN_TOO_OLD_CODE, `Windows source installation requires local Go ${GENTLE_AI_WINDOWS_MINIMUM_GO_VERSION} or newer; found ${commandOutput(result).trim() || "an unrecognized Go version"}.`);
}

function parseGoBuildMetadata(output, architecture) {
	const fields = new Map();
	const lines = output.split(/\r?\n/).filter(Boolean);
	const goVersion = /:\s+(go\d+\.\d+\.\d+)$/.exec(lines[0] ?? "")?.[1];
	for (const line of lines.slice(1)) {
		const [kind, ...values] = line.trimStart().split(/\s+/);
		if (kind === "path") fields.set("path", values[0]);
		else if (kind === "mod") { fields.set("module", values[0]); fields.set("tag", values[1]); fields.set("moduleChecksum", values[2]); }
		else if (kind === "build") { const [key, value] = (values[0] ?? "").split("="); fields.set(key, value); }
	}
	const metadata = {
		goVersion, path: fields.get("path"), module: fields.get("module"), tag: fields.get("tag"), moduleChecksum: fields.get("moduleChecksum"),
		goos: fields.get("GOOS"), goarch: fields.get("GOARCH"), buildMode: fields.get("-buildmode"), compiler: fields.get("-compiler"), cgoEnabled: fields.get("CGO_ENABLED"),
	};
	if (metadata.path !== GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH || metadata.module !== GENTLE_AI_WINDOWS_SOURCE_MODULE || metadata.tag !== GENTLE_AI_WINDOWS_SOURCE_TAG || metadata.moduleChecksum !== GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM || !isGentleAiWindowsGoVersionSupported(metadata.goVersion ?? "") || metadata.goos !== "windows" || metadata.goarch !== expectedGoArchitecture(architecture) || metadata.buildMode !== "exe" || metadata.compiler !== "gc" || metadata.cgoEnabled !== "0") throw new GentleAiInstallerError(GENTLE_AI_GO_INSTALL_FAILED_CODE, "Gentle AI source build metadata does not match the pinned Windows provenance.");
	return metadata;
}

async function verifyGoBuildMetadata(execute, goPath, binaryPath, environment, cwd, architecture) {
	try { return parseGoBuildMetadata(commandOutput(await runCommand(execute, goPath, ["version", "-m", binaryPath], commandOptions(environment, cwd))), architecture); }
	catch (error) { if (error instanceof GentleAiInstallerError) throw error; throw new GentleAiInstallerError(GENTLE_AI_GO_INSTALL_FAILED_CODE, "Gentle AI source build metadata could not be verified.", error); }
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function assertExactGentleAiVersion(execute, binaryPath, environment, cwd) {
	let result;
	try { result = await runCommand(execute, binaryPath, ["version"], commandOptions(environment, cwd)); }
	catch (error) { throw new GentleAiInstallerError(GENTLE_AI_VERSION_MISMATCH_CODE, `Gentle AI source build at ${binaryPath} could not report its version.`, error); }
	if (!new RegExp(`^gentle-ai ${escapeRegExp(INSTALLER_VERSION)}\\r?\\n?$`).test(commandOutput(result))) throw new GentleAiInstallerError(GENTLE_AI_VERSION_MISMATCH_CODE, `Gentle AI source build reported ${JSON.stringify(commandOutput(result).trim())}; expected gentle-ai ${INSTALLER_VERSION}.`);
}

function sameFile(before, after) { return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs; }

async function safeRemoveDirectory(path) {
	try {
		const details = await lstat(path);
		if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("not a real directory");
		await rm(path, { recursive: true, force: true });
	} catch (error) { if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error; }
}

async function existingSignedBundleMatches(directory, asset, platform) {
	try {
		const binaryPath = join(directory, asset.executable), manifestPath = join(directory, "integrity.json");
		const [bundle, binary, manifestFile, contents] = await Promise.all([lstat(directory), lstat(binaryPath), lstat(manifestPath), readFile(manifestPath, "utf8")]);
		const binarySha256 = await sha256File(binaryPath);
		return bundle.isDirectory() && !bundle.isSymbolicLink() && binary.isFile() && !binary.isSymbolicLink() && (platform === "win32" || (binary.mode & 0o111) !== 0) && manifestFile.isFile() && !manifestFile.isSymbolicLink() && (!asset.binarySha256 || asset.binarySha256 === binarySha256) && isCanonicalManifest(contents, JSON.parse(contents), signedReleaseManifest(asset, binarySha256));
	} catch { return false; }
}

async function existingWindowsSourceBundleMatches(directory, execute, goPath, environment, architecture) {
	try {
		const binaryPath = join(directory, "gentle-ai.exe"), manifestPath = join(directory, "integrity.json");
		const [bundle, binary, manifestFile, contents] = await Promise.all([lstat(directory), lstat(binaryPath), lstat(manifestPath), readFile(manifestPath, "utf8")]);
		if (!bundle.isDirectory() || bundle.isSymbolicLink() || !binary.isFile() || binary.isSymbolicLink() || !manifestFile.isFile() || manifestFile.isSymbolicLink()) return false;
		const parsed = JSON.parse(contents);
		if (typeof parsed?.binarySha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.binarySha256)) return false;
		const beforeBinary = await lstat(binaryPath), beforeManifest = await lstat(manifestPath);
		const metadata = await verifyGoBuildMetadata(execute, goPath, binaryPath, environment, directory, architecture);
		if ((await sha256File(binaryPath)) !== parsed.binarySha256 || !isCanonicalManifest(contents, parsed, windowsSourceManifest(metadata, parsed.binarySha256, architecture))) return false;
		await assertExactGentleAiVersion(execute, binaryPath, environment, directory);
		return sameFile(beforeBinary, await lstat(binaryPath)) && sameFile(beforeManifest, await lstat(manifestPath));
	} catch { return false; }
}

function lockIdentity(details) { return `${details.dev}:${details.ino}`; }

function validInstallLockOwner(owner) {
	return typeof owner === "object" && owner !== null
		&& Number.isSafeInteger(owner.createdAt)
		&& typeof owner.nonce === "string"
		&& /^[0-9a-f]{64}$/.test(owner.nonce);
}

async function inspectInstallLock(lockPath) {
	const details = await lstat(lockPath);
	if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("Gentle AI install lock is not a real directory");
	let owner;
	try {
		const ownerPath = join(lockPath, "owner.json");
		const ownerDetails = await lstat(ownerPath);
		if (ownerDetails.isFile() && !ownerDetails.isSymbolicLink()) {
			const parsed = JSON.parse(await readFile(ownerPath, "utf8"));
			if (validInstallLockOwner(parsed)) owner = parsed;
		}
	} catch (error) {
		if (!(error && typeof error === "object" && error.code === "ENOENT") && !(error instanceof SyntaxError)) throw error;
	}
	return { details, identity: lockIdentity(details), owner };
}

function installLockBlockedError(path) {
	return new Error(`Gentle AI package-private installation lock or tombstone exists at ${path}. Confirm no installer is active, then remove this package-private path manually before retrying.`);
}

function installTombstonePrefix() { return `.v${INSTALLER_VERSION}.install.tombstone-`; }

function installTombstonePath(runtimeRoot, nonce) {
	const path = join(runtimeRoot, `${installTombstonePrefix()}${nonce}`);
	if (!isConfined(path, runtimeRoot)) throw new Error("Gentle AI install tombstone escaped the package-private runtime directory");
	return path;
}

async function existingInstallTombstone(runtimeRoot) {
	for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
		if (!entry.name.startsWith(installTombstonePrefix())) continue;
		const path = join(runtimeRoot, entry.name);
		const details = await lstat(path);
		if (!details.isDirectory() || details.isSymbolicLink()) throw installLockBlockedError(path);
		return path;
	}
	return undefined;
}

async function assertNoInstallTombstones(runtimeRoot) {
	const tombstone = await existingInstallTombstone(runtimeRoot);
	if (tombstone) throw installLockBlockedError(tombstone);
}

async function releaseInstallLock(runtimeRoot, lockPath, owner, options) {
	try {
		const observed = await inspectInstallLock(lockPath);
		if (observed.identity !== owner.identity || observed.owner?.nonce !== owner.owner?.nonce) return;
		await options.beforeInstallLockReleaseRename?.(lockPath);
		const tombstonePath = installTombstonePath(runtimeRoot, randomBytes(32).toString("hex"));
		await (options.rename ?? rename)(lockPath, tombstonePath);
		const tombstone = await inspectInstallLock(tombstonePath);
		if (tombstone.identity !== owner.identity || tombstone.owner?.nonce !== owner.owner?.nonce) throw installLockBlockedError(tombstonePath);
		await safeRemoveDirectory(tombstonePath);
	} catch (error) {
		if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
	}
}

// This coordinates cooperative installers only. A malicious same-user package
// writer can already replace package code, binaries, or manifests; Node has no
// pathname-delete CAS. Tombstones make rename auditable: only a matching owned
// tombstone is deleted automatically. Any other tombstone requires a maintainer
// to confirm no installer is active before manual package-private cleanup.
async function acquireInstallLock(runtimeRoot, options) {
	const lockPath = join(runtimeRoot, `.v${INSTALLER_VERSION}.install.lock`);
	await assertNoInstallTombstones(runtimeRoot);
	await options.afterInstallLockFirstTombstoneScan?.(runtimeRoot);
	const nonce = randomBytes(32).toString("hex");
	try {
		await mkdir(lockPath, { mode: 0o700 });
		await writeFile(join(lockPath, "owner.json"), canonicalManifest({ createdAt: (options.now ?? Date.now)(), nonce }), { mode: 0o600, flag: "wx" });
	} catch (error) {
		if (error && typeof error === "object" && error.code === "EEXIST") throw installLockBlockedError(lockPath);
		throw error;
	}
	const owner = await inspectInstallLock(lockPath);
	if (owner.owner?.nonce !== nonce) throw installLockBlockedError(lockPath);
	try {
		await assertNoInstallTombstones(runtimeRoot);
	} catch (error) {
		await releaseInstallLock(runtimeRoot, lockPath, owner, options);
		throw error;
	}
	return async () => releaseInstallLock(runtimeRoot, lockPath, owner, options);
}

function bundleRecoveryError(runtimeRoot, reason) {
	return new Error(`Gentle AI package-local bundle recovery requires manual intervention in ${runtimeRoot}: ${reason}. Confirm no installer is active before changing package-private bundle paths.`);
}

function versionBundlePath(runtimeRoot) { return join(runtimeRoot, `v${INSTALLER_VERSION}`); }
function bundleBackupPrefix() { return `.v${INSTALLER_VERSION}.backup-`; }
function bundleStagingPrefix() { return `.v${INSTALLER_VERSION}.staging-`; }

async function realBundleDirectory(path, runtimeRoot, label) {
	if (!isConfined(path, runtimeRoot)) throw bundleRecoveryError(runtimeRoot, `${label} escaped the version parent`);
	try {
		const details = await lstat(path);
		if (!details.isDirectory() || details.isSymbolicLink()) throw bundleRecoveryError(runtimeRoot, `${label} is not a real directory at ${path}`);
		return true;
	} catch (error) {
		if (error && typeof error === "object" && error.code === "ENOENT") return false;
		throw error;
	}
}

async function backupBundlePaths(runtimeRoot) {
	const backups = [];
	for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
		if (!entry.name.startsWith(bundleBackupPrefix())) continue;
		const path = join(runtimeRoot, entry.name);
		if (!await realBundleDirectory(path, runtimeRoot, "backup bundle")) throw bundleRecoveryError(runtimeRoot, `backup bundle disappeared at ${path}`);
		backups.push(path);
	}
	return backups;
}

async function recoverInterruptedPublication(runtimeRoot, bundleIsValid, options) {
	const backups = await backupBundlePaths(runtimeRoot);
	if (backups.length === 0) return;
	if (backups.length !== 1) throw bundleRecoveryError(runtimeRoot, `found ${backups.length} backup bundle candidates`);
	const [backup] = backups;
	if (!await bundleIsValid(backup)) throw bundleRecoveryError(runtimeRoot, `backup bundle is invalid at ${backup}`);
	const live = versionBundlePath(runtimeRoot);
	const liveExists = await realBundleDirectory(live, runtimeRoot, "live bundle");
	if (!liveExists) {
		try { await (options.rename ?? rename)(backup, live); }
		catch (error) { throw bundleRecoveryError(runtimeRoot, `could not restore valid backup ${backup}: ${error instanceof Error ? error.message : String(error)}`); }
		return;
	}
	if (!await bundleIsValid(live)) throw bundleRecoveryError(runtimeRoot, `live bundle is invalid while valid backup remains at ${backup}`);
	await safeRemoveDirectory(backup);
}

async function cleanupStaleStagingBundles(runtimeRoot) {
	for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
		if (!entry.name.startsWith(bundleStagingPrefix())) continue;
		const path = join(runtimeRoot, entry.name);
		if (!await realBundleDirectory(path, runtimeRoot, "staging bundle")) throw bundleRecoveryError(runtimeRoot, `staging bundle disappeared at ${path}`);
		await safeRemoveDirectory(path);
	}
}

async function publishBundle(runtimeRoot, stagingDirectory, options) {
	const versionDirectory = join(runtimeRoot, `v${INSTALLER_VERSION}`), renameFile = options.rename ?? rename;
	const backupDirectory = join(runtimeRoot, `.v${INSTALLER_VERSION}.backup-${process.pid}-${Date.now()}`);
	let movedPrior = false;
	try {
		try {
			const current = await lstat(versionDirectory);
			if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("Gentle AI package-local version directory must be a real directory");
			await renameFile(versionDirectory, backupDirectory);
			movedPrior = true;
		} catch (error) { if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error; }
		await renameFile(stagingDirectory, versionDirectory);
	} catch (error) {
		if (movedPrior) {
			try { await renameFile(backupDirectory, versionDirectory); }
			catch (rollbackError) { throw new Error("Gentle AI bundle publication failed and rollback could not restore the prior bundle", { cause: rollbackError }); }
		}
		throw error;
	}
	if (movedPrior) await safeRemoveDirectory(backupDirectory);
	return versionDirectory;
}

async function withInstallLock(packageRoot, options, install) {
	const runtimeRoot = join(packageRoot, ".gentle-ai");
	await mkdir(packageRoot, { recursive: true });
	await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
	await assertRuntimeDirectory(runtimeRoot);
	const release = await acquireInstallLock(runtimeRoot, options);
	try { return await install(runtimeRoot); }
	finally { await release(); }
}

async function installWindowsGentleAiFromGoSumdb(options, packageRoot, architecture) {
	const execute = options.execFile ?? execFileAsync;
	return withInstallLock(packageRoot, options, async (runtimeRoot) => {
		await cleanupStaleStagingBundles(runtimeRoot);
		const stagingDirectory = await mkdtemp(join(runtimeRoot, `.v${INSTALLER_VERSION}.staging-`));
		try {
			await chmod(stagingDirectory, 0o700);
			const buildDirectory = join(stagingDirectory, ".build");
			await mkdir(buildDirectory, { recursive: true, mode: 0o700 });
			const goPath = await resolveWindowsGoExecutable(options);
			const environment = sealedGoEnvironment(goPath, buildDirectory, architecture);
			for (const directory of [environment.GOBIN, environment.GOPATH, environment.GOMODCACHE, environment.GOCACHE, environment.TEMP]) await mkdir(directory, { recursive: true, mode: 0o700 });
			await recoverInterruptedPublication(runtimeRoot, (directory) => existingWindowsSourceBundleMatches(directory, execute, goPath, environment, architecture), options);
			const existing = versionBundlePath(runtimeRoot);
			if (await existingWindowsSourceBundleMatches(existing, execute, goPath, environment, architecture)) return { installed: false, binaryPath: join(existing, "gentle-ai.exe"), method: GENTLE_AI_INSTALL_METHOD.GO_SUMDB_SOURCE_BUILD };
			await assertGoToolchain(execute, goPath, environment, stagingDirectory);
			try { await runCommand(execute, goPath, ["install", GENTLE_AI_WINDOWS_SOURCE_PACKAGE], commandOptions(environment, stagingDirectory)); }
			catch (error) { throw new GentleAiInstallerError(GENTLE_AI_GO_INSTALL_FAILED_CODE, `Gentle AI Go SumDB source installation failed for ${GENTLE_AI_WINDOWS_SOURCE_PACKAGE}.`, error); }
			const builtBinary = join(environment.GOBIN, "gentle-ai.exe"), binaryPath = join(stagingDirectory, "gentle-ai.exe");
			const details = await lstat(builtBinary);
			if (!details.isFile() || details.isSymbolicLink()) throw new GentleAiInstallerError(GENTLE_AI_GO_INSTALL_FAILED_CODE, "Gentle AI Go installation produced a non-regular gentle-ai.exe.");
			await copyFile(builtBinary, binaryPath);
			const metadata = await verifyGoBuildMetadata(execute, goPath, binaryPath, environment, stagingDirectory, architecture);
			await assertExactGentleAiVersion(execute, binaryPath, environment, stagingDirectory);
			const binarySha256 = await sha256File(binaryPath);
			await writeFile(join(stagingDirectory, "integrity.json"), canonicalManifest(windowsSourceManifest(metadata, binarySha256, architecture)), { mode: 0o600 });
			await safeRemoveDirectory(buildDirectory);
			const published = await publishBundle(runtimeRoot, stagingDirectory, options);
			return { installed: true, binaryPath: join(published, "gentle-ai.exe"), method: GENTLE_AI_INSTALL_METHOD.GO_SUMDB_SOURCE_BUILD };
		} finally { await safeRemoveDirectory(stagingDirectory); }
	});
}

async function installSignedRelease(options, packageRoot, platform, arch, asset) {
	return withInstallLock(packageRoot, options, async (runtimeRoot) => {
		await recoverInterruptedPublication(runtimeRoot, (directory) => existingSignedBundleMatches(directory, asset, platform), options);
		await cleanupStaleStagingBundles(runtimeRoot);
		const existing = versionBundlePath(runtimeRoot);
		if (await existingSignedBundleMatches(existing, asset, platform)) return { installed: false, binaryPath: join(existing, asset.executable), asset };
		const stagingDirectory = await mkdtemp(join(runtimeRoot, `.v${INSTALLER_VERSION}.staging-`));
		try {
			const form = gentleAiAssetForm(asset.name);
			const archive = join(stagingDirectory, asset.name);
			await (options.download ?? downloadGentleAiAsset)(asset.url, archive);
			if ((await sha256File(archive)) !== asset.sha256) throw new Error(`Gentle AI archive checksum mismatch for ${asset.name}`);
			let source = archive;
			const extracted = join(stagingDirectory, "extracted");
			if (form === "archive") {
				await (options.extractArchive ?? extractGentleAiArchive)(archive, extracted);
				source = await expectedRegularFile(extracted, asset.executable);
			}
			if (asset.binarySha256 && (await sha256File(source)) !== asset.binarySha256) throw new Error(`Gentle AI binary checksum mismatch for ${asset.name}`);
			const binaryPath = join(stagingDirectory, asset.executable);
			await copyFile(source, binaryPath);
			if (platform !== "win32") await chmod(binaryPath, 0o700);
			await writeFile(join(stagingDirectory, "integrity.json"), canonicalManifest(signedReleaseManifest(asset, await sha256File(binaryPath))), { mode: 0o600 });
			if (form === "archive") await safeRemoveDirectory(extracted);
			await rm(archive, { force: true });
			const published = await publishBundle(runtimeRoot, stagingDirectory, options);
			return { installed: true, binaryPath: join(published, asset.executable), asset };
		} finally { await safeRemoveDirectory(stagingDirectory); }
	});
}

export async function installGentleAi(options = {}) {
	const packageRoot = options.packageRoot ?? resolveGentleAiInstallerPackageRoot();
	const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
	if (isWindowsGoSumdbSourceTarget(platform, arch)) return installWindowsGentleAiFromGoSumdb(options, packageRoot, arch);
	const asset = resolveGentleAiReleaseAsset(platform, arch, options.releaseAssets ?? GENTLE_AI_RELEASE_ASSETS);
	return installSignedRelease(options, packageRoot, platform, arch, asset);
}
