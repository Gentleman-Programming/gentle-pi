import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
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
import {
	RELEASE_ARTIFACT_MANIFEST_FILE_NAME,
	createSystemReleaseArtifactExtractor,
	decodeArtifactManifest,
	extractReleaseArtifact,
} from "../lib/release-artifact.ts";

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
export const INSTALLER_VERSION = "2.2.3";
export const RELEASE_BASE_URL = `https://github.com/Gentleman-Programming/gentle-ai/releases/download/v${INSTALLER_VERSION}/`;
export const GENTLE_AI_INSTALL_METHOD = Object.freeze({
	SIGNED_RELEASE_ASSET: "signed-release-asset",
	GO_SUMDB_SOURCE_BUILD: "go-sumdb-source-build",
});
export const GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH = "github.com/gentleman-programming/gentle-ai/v2/cmd/gentle-ai";
export const GENTLE_AI_WINDOWS_SOURCE_MODULE = "github.com/gentleman-programming/gentle-ai/v2";
export const GENTLE_AI_WINDOWS_SOURCE_TAG = `v${INSTALLER_VERSION}`;
// `go mod download -json github.com/gentleman-programming/gentle-ai/v2@v2.2.3`
// with GOSUMDB=sum.golang.org reports this exact module SumDB checksum.
export const GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM = "h1:GWFPqNIgPDv82BiCceWQBV6p9VKbFm51W//sKTKNn5c=";
export const GENTLE_AI_WINDOWS_SOURCE_PACKAGE = `${GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH}@${GENTLE_AI_WINDOWS_SOURCE_TAG}`;
export const GENTLE_AI_WINDOWS_MINIMUM_GO_VERSION = "1.25.10";
export const GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE_CODE = "GENTLE_AI_GO_TOOLCHAIN_UNAVAILABLE";
export const GENTLE_AI_GO_TOOLCHAIN_TOO_OLD_CODE = "GENTLE_AI_GO_TOOLCHAIN_TOO_OLD";
export const GENTLE_AI_GO_INSTALL_FAILED_CODE = "GENTLE_AI_GO_INSTALL_FAILED";
export const GENTLE_AI_VERSION_MISMATCH_CODE = "GENTLE_AI_VERSION_MISMATCH";
export const GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED_CODE = "GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED";

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
// still holds it. The v2.2.3 digests are pinned from the published release:
// archive sha256 values verified against the minisign-signed checksums.txt and
// freshly computed hashes; binary sha256 values computed from the extracted
// executables.
export const GENTLE_AI_PENDING_DIGEST = "PENDING-GENTLE-AI-RELEASE-DIGEST";

function asset(name, sha256, binarySha256, executable) {
	return Object.freeze({ name, sha256, binarySha256, executable, url: `${RELEASE_BASE_URL}${name}` });
}

// Windows is absent from signed release archives on purpose. gentle-ai stopped
// distributing unsigned Windows builds in c4b764d0, so v2.2.3 publishes signed
// Darwin/Linux archives only. Windows x64/arm64 uses the separately verified
// exact-tag Go SumDB source-build path below; restore archive rows only when
// upstream ships signed Windows assets.
export const GENTLE_AI_RELEASE_ASSETS = Object.freeze({
	"darwin/amd64": asset("gentle-ai_2.2.3_darwin_amd64.tar.gz", "1622e283d53192aaa195ca2a7c6f63d41475dcdadda1949fac248015081c88ca", "f3505695bd135dfdcc64adfeb3385f3aea40033a7c3c02a7b387a26bc10b4a39", "gentle-ai"),
	"darwin/arm64": asset("gentle-ai_2.2.3_darwin_arm64.tar.gz", "28517e136df6208e0225c51ffc986cb65af1f4fc6e6b173ddc4d0f2d0e402a30", "638a7ef64fa5d2657cbe52fc0a033a5f6ddfce190961e845042ef166f116c70f", "gentle-ai"),
	"linux/amd64": asset("gentle-ai_2.2.3_linux_amd64.tar.gz", "8ef700fb4d8e097f98a70cbb53edaa854ee39c09c0a998c53866b93c45b51d36", "5af38452caf057215628e0f0c8cb87647b0f0a1506feacc39a3f487d6471b7cc", "gentle-ai"),
	"linux/arm64": asset("gentle-ai_2.2.3_linux_arm64.tar.gz", "9f4eba7184d2b70e05685e99ffbf2ad4e8df3d8f64519043f08d0bbe5e93d399", "48f55abf9347e9db191469b1daf2265b4d267b3a61db3a548ae269f3407a4b9a", "gentle-ai"),
});

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
		throw new Error(`unsupported Gentle AI platform/architecture: ${platform}/${architecture}; signed archive pairs are darwin/x64, darwin/arm64, linux/x64, and linux/arm64${windowsSource}`);
	}
	return resolved;
}

export function resolveGentleAiInstallerPackageRoot() {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

// The lock is the canonical, sync-script-written source for the assets
// archive's pinned identity (design D6). Reading it at install time keeps a
// pin bump a single-write operation (regenerate the lock, nothing else to
// hand-update) instead of reintroducing the duplicated-literal drift #262
// eliminated for the binary version.
export const GENTLE_AI_ASSETS_LOCK_RELATIVE_PATH = "capabilities/gentle-ai-release.lock.json";

function assetsLockDigest(value, label, lockPath) {
	const match = typeof value === "string" ? /^sha256:([0-9a-f]{64})$/.exec(value) : null;
	if (!match) throw new Error(`${lockPath} has an invalid ${label}: ${JSON.stringify(value)}`);
	return match[1];
}

export function resolveGentleAiAssetsArchive(packageRoot, installerVersion = INSTALLER_VERSION, readLockFile = (path) => readFileSync(path, "utf8")) {
	const lockPath = join(packageRoot, GENTLE_AI_ASSETS_LOCK_RELATIVE_PATH);
	let lock;
	try {
		lock = JSON.parse(readLockFile(lockPath));
	} catch (error) {
		throw new Error(`Gentle AI assets archive requires a valid ${GENTLE_AI_ASSETS_LOCK_RELATIVE_PATH} at ${lockPath}`, { cause: error });
	}
	if (lock?.release?.version !== installerVersion) {
		throw new Error(`${lockPath} release.version ${JSON.stringify(lock?.release?.version)} does not match the authoritative INSTALLER_VERSION ${JSON.stringify(installerVersion)}`);
	}
	const name = lock?.archive?.asset;
	if (typeof name !== "string" || name.length === 0) throw new Error(`${lockPath} is missing archive.asset`);
	const contractMajor = lock?.contract?.major;
	const layoutVersion = lock?.contract?.layoutVersion;
	if (!Number.isInteger(contractMajor) || !Number.isInteger(layoutVersion)) {
		throw new Error(`${lockPath} is missing contract.major or contract.layoutVersion`);
	}
	return Object.freeze({
		name,
		sha256: assetsLockDigest(lock.archive?.sha256, "archive.sha256", lockPath),
		treeSha256: assetsLockDigest(lock.tree?.digest, "tree.digest", lockPath),
		contractMajor,
		layoutVersion,
		url: `${RELEASE_BASE_URL}${name}`,
	});
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

// Extends the manifest with the assets provenance (design D3/D4): the same
// `isCanonicalManifest` exact-key-count/string-equality discipline below
// applies unmodified to the grown key set, so a missing or forged assets
// field fails resolution exactly like a missing or forged binary field
// always has.
function assetsManifestFields(assetsArchive) {
	return {
		assetsAsset: assetsArchive.name,
		assetsArchiveSha256: assetsArchive.sha256,
		assetsTreeSha256: assetsArchive.treeSha256,
		contractMajor: assetsArchive.contractMajor,
		layoutVersion: assetsArchive.layoutVersion,
	};
}

function signedReleaseManifest(asset, binarySha256, assetsArchive) {
	return { version: INSTALLER_VERSION, asset: asset.name, assetSha256: asset.sha256, binarySha256, ...assetsManifestFields(assetsArchive) };
}

function windowsSourceManifest(metadata, binarySha256, architecture, assetsArchive) {
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
		...assetsManifestFields(assetsArchive),
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

// --- assets bundle staging (design D2/D3) -----------------------------------

function assetsTreeDigestHex(treeDigest, label, source) {
	const match = typeof treeDigest === "string" ? /^sha256:([0-9a-f]{64})$/.exec(treeDigest) : null;
	if (!match) throw new Error(`Gentle AI assets archive ${label} has an invalid tree digest for ${source}`);
	return match[1];
}

async function defaultExtractAssets(archivePath, destinationDir) {
	return extractReleaseArtifact(archivePath, destinationDir, { extractor: createSystemReleaseArtifactExtractor() });
}

// Stages the same signed assets archive consumed on every platform (design
// D5: assets carry no goos/goarch axis) into `<staging>/assets`, reusing
// `lib/release-artifact.ts`'s bounded, exact-set-verified extractor (D2) —
// this module re-authors no extraction or decode logic, only the download +
// pinned-digest cross-check around it.
async function installAssets(options, stagingDirectory, assetsArchive) {
	const archivePath = join(stagingDirectory, assetsArchive.name);
	await (options.downloadAssets ?? downloadGentleAiAsset)(assetsArchive.url, archivePath);
	if ((await sha256File(archivePath)) !== assetsArchive.sha256) {
		throw new Error(`Gentle AI assets archive checksum mismatch for ${assetsArchive.name}`);
	}
	const assetsDirectory = join(stagingDirectory, "assets");
	const { manifest } = await (options.extractAssets ?? defaultExtractAssets)(archivePath, assetsDirectory);
	const treeSha256 = assetsTreeDigestHex(manifest.tree.digest, "manifest tree.digest", assetsArchive.name);
	if (treeSha256 !== assetsArchive.treeSha256) throw new Error(`Gentle AI assets tree digest mismatch for ${assetsArchive.name}`);
	if (manifest.contract.major !== assetsArchive.contractMajor) throw new Error(`Gentle AI assets contract major mismatch for ${assetsArchive.name}`);
	if (manifest.layout.version !== assetsArchive.layoutVersion) throw new Error(`Gentle AI assets layout version mismatch for ${assetsArchive.name}`);
	await rm(archivePath, { force: true });
	return assetsDirectory;
}

// Cheap existence/shape check reused by both `existingSignedBundleMatches`
// and `existingWindowsSourceBundleMatches` (design D3: extending the ONE
// bundle-validity predicate that `recoverInterruptedPublication` already
// takes covers interrupted-publication recovery for the assets tree with no
// new publish operation). Deliberately does not walk or digest every asset
// file — that N-file work is `resolveGentleAiAssets`'s job, reserved for lazy
// snapshot readers (D4) — but a missing or shape-invalid assets directory,
// or one that disagrees with the pinned contract/layout/tree digest, is
// enough to make a binary-without-assets bundle invalid by construction.
async function assetsBundleMatches(directory, assetsArchive) {
	try {
		const assetsDirectory = join(directory, "assets");
		const manifestPath = join(assetsDirectory, RELEASE_ARTIFACT_MANIFEST_FILE_NAME);
		const [assetsDetails, manifestDetails] = await Promise.all([lstat(assetsDirectory), lstat(manifestPath)]);
		if (!assetsDetails.isDirectory() || assetsDetails.isSymbolicLink() || !manifestDetails.isFile() || manifestDetails.isSymbolicLink()) return false;
		const manifest = decodeArtifactManifest(await readFile(manifestPath));
		return manifest.contract.major === assetsArchive.contractMajor
			&& manifest.layout.version === assetsArchive.layoutVersion
			&& manifest.tree.digest === `sha256:${assetsArchive.treeSha256}`;
	} catch {
		return false;
	}
}

// --- Windows capability cross-check (design D5) -----------------------------

// D5: Windows has no goreleaser-built binary archive — the release builds
// linux and darwin only, and Windows builds the binary from Go SumDB source
// at the exact pinned tag (above). This is the checked-in mirror every
// platform's assets bundle is already verified against; the cross-check
// below only ever READS it, exactly like `resolveGentleAiAssetsArchive`
// reads the lock, and never writes or regenerates it.
export const GENTLE_AI_CAPABILITIES_SNAPSHOT_RELATIVE_PATH = "capabilities/review-integration-v2.semantic.json";
const GENTLE_AI_CAPABILITIES_CONTRACT = "gentle-ai.review-integration/v2";

function readGentleAiCapabilitiesSnapshot(packageRoot, readSnapshotFile) {
	const path = join(packageRoot, GENTLE_AI_CAPABILITIES_SNAPSHOT_RELATIVE_PATH);
	try {
		return JSON.parse(readSnapshotFile(path));
	} catch (error) {
		throw new Error(`Gentle AI Windows capability cross-check requires a valid ${GENTLE_AI_CAPABILITIES_SNAPSHOT_RELATIVE_PATH} at ${path}`, { cause: error });
	}
}

function capabilityNameSets(payload, label) {
	const operations = Array.isArray(payload?.operations) ? payload.operations : null;
	const gates = Array.isArray(payload?.gates) ? payload.gates : null;
	const projections = Array.isArray(payload?.projections) ? payload.projections : null;
	const mandatory = Array.isArray(payload?.features?.mandatory) ? payload.features.mandatory : null;
	const optional = Array.isArray(payload?.features?.optional) ? payload.features.optional : null;
	if (!operations || !gates || !projections || !mandatory || !optional) throw new Error(`${label} is missing operations, gates, projections, or features.mandatory/features.optional`);
	const featureNames = [...mandatory, ...optional].map((feature) => feature?.name);
	if ([...operations, ...gates, ...projections, ...featureNames].some((value) => typeof value !== "string" || value.length === 0)) {
		throw new Error(`${label} has a non-string or empty operation, gate, projection, or feature name`);
	}
	return {
		contract: typeof payload.contract === "string" ? payload.contract : undefined,
		operations: new Set(operations),
		gates: new Set(gates),
		projections: new Set(projections),
		features: new Set(featureNames),
	};
}

function sameNameSet(a, b) {
	return a.size === b.size && [...a].every((value) => b.has(value));
}

function capabilitiesCrossCheckMismatch(observed, expected) {
	return observed.contract !== expected.contract
		|| !sameNameSet(observed.operations, expected.operations)
		|| !sameNameSet(observed.gates, expected.gates)
		|| !sameNameSet(observed.projections, expected.projections)
		|| !sameNameSet(observed.features, expected.features);
}

// A live `gentle-ai.exe review capabilities --contract gentle-ai.review-integration/v2`
// call MAY cross-check that the source-built Windows binary is semantically
// compatible with the signed snapshot every platform already trusts. Fixed
// argv, no shell, bounded output (the same `commandOptions`/`maxBuffer` seam
// `go install`/`go version -m` already use above), sealed environment. Every
// failure mode below — non-zero exit, oversized output, non-JSON output, or a
// semantic mismatch — fails closed with the caller publishing nothing: this
// function has no write path at all, so it can never regenerate the snapshot
// or create a second authority. The signed artifact stays authoritative.
async function crossCheckWindowsCapabilities(options, execute, binaryPath, environment, cwd, packageRoot) {
	const expected = capabilityNameSets(
		options.capabilitiesSnapshot ?? readGentleAiCapabilitiesSnapshot(packageRoot, options.readCapabilitiesSnapshot ?? ((path) => readFileSync(path, "utf8"))),
		GENTLE_AI_CAPABILITIES_SNAPSHOT_RELATIVE_PATH,
	);
	let result;
	try {
		result = await runCommand(execute, binaryPath, ["review", "capabilities", "--contract", GENTLE_AI_CAPABILITIES_CONTRACT], commandOptions(environment, cwd));
	} catch (error) {
		throw new GentleAiInstallerError(GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED_CODE, "Gentle AI Windows capability cross-check subprocess failed.", error);
	}
	let parsed;
	try {
		parsed = JSON.parse(commandOutput(result));
	} catch (error) {
		throw new GentleAiInstallerError(GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED_CODE, "Gentle AI Windows capability cross-check produced non-JSON output.", error);
	}
	let observed;
	try {
		observed = capabilityNameSets(parsed, "Windows capability cross-check output");
	} catch (error) {
		throw new GentleAiInstallerError(GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED_CODE, "Gentle AI Windows capability cross-check produced a malformed capabilities payload.", error);
	}
	if (capabilitiesCrossCheckMismatch(observed, expected)) {
		throw new GentleAiInstallerError(GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED_CODE, "Gentle AI Windows-built binary capabilities do not match the signed release snapshot.");
	}
}

async function safeRemoveDirectory(path) {
	try {
		const details = await lstat(path);
		if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("not a real directory");
		await rm(path, { recursive: true, force: true });
	} catch (error) { if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error; }
}

async function existingSignedBundleMatches(directory, asset, platform, assetsArchive) {
	try {
		const binaryPath = join(directory, asset.executable), manifestPath = join(directory, "integrity.json");
		const [bundle, binary, manifestFile, contents] = await Promise.all([lstat(directory), lstat(binaryPath), lstat(manifestPath), readFile(manifestPath, "utf8")]);
		const binarySha256 = await sha256File(binaryPath);
		return bundle.isDirectory() && !bundle.isSymbolicLink() && binary.isFile() && !binary.isSymbolicLink() && (platform === "win32" || (binary.mode & 0o111) !== 0) && manifestFile.isFile() && !manifestFile.isSymbolicLink() && (!asset.binarySha256 || asset.binarySha256 === binarySha256) && isCanonicalManifest(contents, JSON.parse(contents), signedReleaseManifest(asset, binarySha256, assetsArchive)) && await assetsBundleMatches(directory, assetsArchive);
	} catch { return false; }
}

async function existingWindowsSourceBundleMatches(directory, execute, goPath, environment, architecture, assetsArchive) {
	try {
		const binaryPath = join(directory, "gentle-ai.exe"), manifestPath = join(directory, "integrity.json");
		const [bundle, binary, manifestFile, contents] = await Promise.all([lstat(directory), lstat(binaryPath), lstat(manifestPath), readFile(manifestPath, "utf8")]);
		if (!bundle.isDirectory() || bundle.isSymbolicLink() || !binary.isFile() || binary.isSymbolicLink() || !manifestFile.isFile() || manifestFile.isSymbolicLink()) return false;
		const parsed = JSON.parse(contents);
		if (typeof parsed?.binarySha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.binarySha256)) return false;
		const beforeBinary = await lstat(binaryPath), beforeManifest = await lstat(manifestPath);
		const metadata = await verifyGoBuildMetadata(execute, goPath, binaryPath, environment, directory, architecture);
		if ((await sha256File(binaryPath)) !== parsed.binarySha256 || !isCanonicalManifest(contents, parsed, windowsSourceManifest(metadata, parsed.binarySha256, architecture, assetsArchive))) return false;
		await assertExactGentleAiVersion(execute, binaryPath, environment, directory);
		if (!(sameFile(beforeBinary, await lstat(binaryPath)) && sameFile(beforeManifest, await lstat(manifestPath)))) return false;
		return await assetsBundleMatches(directory, assetsArchive);
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

const BUNDLE_VERSION_DIRECTORY_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

function bundleVersionOf(name) {
	const match = BUNDLE_VERSION_DIRECTORY_PATTERN.exec(name);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareBundleVersionsDescending(a, b) {
	return b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2];
}

// D3: prunes superseded `v<other-version>` bundle directories. Called ONLY
// after the new bundle's rename in `publishBundle` has already succeeded,
// from nowhere else, and it never touches `v<INSTALLER_VERSION>` — the live
// bundle just published. Deliberately conservative: it keeps exactly the
// single immediately-previous bundle (the highest-versioned directory that
// is not live) for rollback, and removes every other superseded version —
// neither "keep everything" nor "keep only the current one". A pin bump is
// the only way a superseded directory can exist at all. Its own failure is
// deliberately non-fatal: a locked or otherwise unremovable old bundle must
// not fail an install that already succeeded — it is only logged for a
// maintainer to clean up later.
export async function pruneSupersededBundles(runtimeRoot, options = {}) {
	const log = options.logPruneWarning ?? ((message) => console.warn(message));
	const remove = options.removeSupersededBundle ?? safeRemoveDirectory;
	let entries;
	try {
		entries = await readdir(runtimeRoot, { withFileTypes: true });
	} catch (error) {
		log(`Gentle AI could not list ${runtimeRoot} to prune superseded bundles: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	const live = `v${INSTALLER_VERSION}`;
	const superseded = entries
		.filter((entry) => entry.isDirectory() && entry.name !== live)
		.map((entry) => ({ name: entry.name, version: bundleVersionOf(entry.name) }))
		.filter((candidate) => candidate.version !== undefined)
		.sort(compareBundleVersionsDescending);
	const [, ...toPrune] = superseded; // keep index 0 (the immediately-previous bundle) for rollback
	for (const { name } of toPrune) {
		const path = join(runtimeRoot, name);
		if (!isConfined(path, runtimeRoot)) continue;
		try {
			await remove(path);
		} catch (error) {
			log(`Gentle AI could not prune superseded bundle at ${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
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

async function installWindowsGentleAiFromGoSumdb(options, packageRoot, architecture, assetsArchive) {
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
			await recoverInterruptedPublication(runtimeRoot, (directory) => existingWindowsSourceBundleMatches(directory, execute, goPath, environment, architecture, assetsArchive), options);
			const existing = versionBundlePath(runtimeRoot);
			if (await existingWindowsSourceBundleMatches(existing, execute, goPath, environment, architecture, assetsArchive)) return { installed: false, binaryPath: join(existing, "gentle-ai.exe"), method: GENTLE_AI_INSTALL_METHOD.GO_SUMDB_SOURCE_BUILD };
			await assertGoToolchain(execute, goPath, environment, stagingDirectory);
			try { await runCommand(execute, goPath, ["install", GENTLE_AI_WINDOWS_SOURCE_PACKAGE], commandOptions(environment, stagingDirectory)); }
			catch (error) { throw new GentleAiInstallerError(GENTLE_AI_GO_INSTALL_FAILED_CODE, `Gentle AI Go SumDB source installation failed for ${GENTLE_AI_WINDOWS_SOURCE_PACKAGE}.`, error); }
			const builtBinary = join(environment.GOBIN, "gentle-ai.exe"), binaryPath = join(stagingDirectory, "gentle-ai.exe");
			const details = await lstat(builtBinary);
			if (!details.isFile() || details.isSymbolicLink()) throw new GentleAiInstallerError(GENTLE_AI_GO_INSTALL_FAILED_CODE, "Gentle AI Go installation produced a non-regular gentle-ai.exe.");
			await copyFile(builtBinary, binaryPath);
			const metadata = await verifyGoBuildMetadata(execute, goPath, binaryPath, environment, stagingDirectory, architecture);
			await assertExactGentleAiVersion(execute, binaryPath, environment, stagingDirectory);
			// D5: a live capability call MAY cross-check that the source-built
			// binary is semantically compatible with the signed snapshot every
			// platform already trusts. It must never create authority, so it
			// runs strictly before anything below is staged or published.
			await crossCheckWindowsCapabilities(options, execute, binaryPath, environment, stagingDirectory, packageRoot);
			const binarySha256 = await sha256File(binaryPath);
			// D5: the same signed assets archive as POSIX, bound in the one
			// atomic bundle and integrity manifest below.
			await installAssets(options, stagingDirectory, assetsArchive);
			await writeFile(join(stagingDirectory, "integrity.json"), canonicalManifest(windowsSourceManifest(metadata, binarySha256, architecture, assetsArchive)), { mode: 0o600 });
			await safeRemoveDirectory(buildDirectory);
			const published = await publishBundle(runtimeRoot, stagingDirectory, options);
			await pruneSupersededBundles(runtimeRoot, options);
			return { installed: true, binaryPath: join(published, "gentle-ai.exe"), method: GENTLE_AI_INSTALL_METHOD.GO_SUMDB_SOURCE_BUILD };
		} finally { await safeRemoveDirectory(stagingDirectory); }
	});
}

async function installSignedRelease(options, packageRoot, platform, arch, asset, assetsArchive) {
	return withInstallLock(packageRoot, options, async (runtimeRoot) => {
		await recoverInterruptedPublication(runtimeRoot, (directory) => existingSignedBundleMatches(directory, asset, platform, assetsArchive), options);
		await cleanupStaleStagingBundles(runtimeRoot);
		const existing = versionBundlePath(runtimeRoot);
		if (await existingSignedBundleMatches(existing, asset, platform, assetsArchive)) return { installed: false, binaryPath: join(existing, asset.executable), asset };
		const stagingDirectory = await mkdtemp(join(runtimeRoot, `.v${INSTALLER_VERSION}.staging-`));
		try {
			const archive = join(stagingDirectory, asset.name);
			await (options.download ?? downloadGentleAiAsset)(asset.url, archive);
			if ((await sha256File(archive)) !== asset.sha256) throw new Error(`Gentle AI archive checksum mismatch for ${asset.name}`);
			const extracted = join(stagingDirectory, "extracted");
			await (options.extractArchive ?? extractGentleAiArchive)(archive, extracted);
			const source = await expectedRegularFile(extracted, asset.executable);
			if (asset.binarySha256 && (await sha256File(source)) !== asset.binarySha256) throw new Error(`Gentle AI binary checksum mismatch for ${asset.name}`);
			const binaryPath = join(stagingDirectory, asset.executable);
			await copyFile(source, binaryPath);
			if (platform !== "win32") await chmod(binaryPath, 0o700);
			// D3: one staging tree, one atomic rename below covers both the
			// binary (above) and the assets bundle (here) — no second publish
			// operation.
			await installAssets(options, stagingDirectory, assetsArchive);
			await writeFile(join(stagingDirectory, "integrity.json"), canonicalManifest(signedReleaseManifest(asset, await sha256File(binaryPath), assetsArchive)), { mode: 0o600 });
			await safeRemoveDirectory(extracted);
			await rm(archive, { force: true });
			const published = await publishBundle(runtimeRoot, stagingDirectory, options);
			await pruneSupersededBundles(runtimeRoot, options);
			return { installed: true, binaryPath: join(published, asset.executable), asset };
		} finally { await safeRemoveDirectory(stagingDirectory); }
	});
}

export async function installGentleAi(options = {}) {
	const packageRoot = options.packageRoot ?? resolveGentleAiInstallerPackageRoot();
	const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
	const assetsArchive = options.assetsArchive ?? resolveGentleAiAssetsArchive(packageRoot);
	if (isWindowsGoSumdbSourceTarget(platform, arch)) return installWindowsGentleAiFromGoSumdb(options, packageRoot, arch, assetsArchive);
	const asset = resolveGentleAiReleaseAsset(platform, arch, options.releaseAssets ?? GENTLE_AI_RELEASE_ASSETS);
	return installSignedRelease(options, packageRoot, platform, arch, asset, assetsArchive);
}
