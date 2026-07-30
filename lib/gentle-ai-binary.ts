import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	GENTLE_AI_INSTALL_METHOD,
	GENTLE_AI_WINDOWS_SOURCE_MODULE,
	GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM,
	GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH,
	GENTLE_AI_WINDOWS_SOURCE_TAG,
	isGentleAiWindowsGoVersionSupported,
	isWindowsGoSumdbSourceTarget,
	resolveGentleAiReleaseAsset,
} from "../scripts/gentle-ai-installer.mjs";
import { fileURLToPath } from "node:url";

export const GENTLE_AI_BINARY_MISSING_CODE = "package-local-binary-missing";
export const GENTLE_AI_VERSION = "2.2.2";

export class PackageLocalGentleAiBinaryMissingError extends Error {
	readonly code = GENTLE_AI_BINARY_MISSING_CODE;
	constructor(path: string) {
		super(
			`${GENTLE_AI_BINARY_MISSING_CODE}: Gentle AI v${GENTLE_AI_VERSION} is not installed at ${path}. Reinstall gentle-pi, or use GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1 only for development/offline installs.`,
		);
		this.name = "PackageLocalGentleAiBinaryMissingError";
	}
}

export function gentleAiBinaryPath(
	packageRoot = dirname(dirname(fileURLToPath(import.meta.url))),
	platform = process.platform,
): string {
	return join(
		resolve(packageRoot),
		".gentle-ai",
		`v${GENTLE_AI_VERSION}`,
		platform === "win32" ? "gentle-ai.exe" : "gentle-ai",
	);
}

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function isConfined(path: string, directory: string): boolean {
	const relativePath = relative(directory, path);
	return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function assertRegularNonSymlink(path: string): void {
	const details = lstatSync(path);
	if (!details.isFile() || details.isSymbolicLink()) throw new Error("expected regular non-symlink file");
}

function assertPosixExecutable(path: string, platform: string): void {
	if (platform !== "win32" && (lstatSync(path).mode & 0o111) === 0) {
		throw new Error("expected executable POSIX binary");
	}
}

function signedReleaseManifest(asset: { name: string; sha256: string; binarySha256: string }): Record<string, string> {
	return { version: GENTLE_AI_VERSION, asset: asset.name, assetSha256: asset.sha256, binarySha256: asset.binarySha256 };
}

function windowsSourceManifest(manifest: Record<string, unknown>, binarySha256: string, platform: string): Record<string, string> {
	if (!isWindowsGoSumdbSourceTarget(platform, process.arch)) throw new Error("unsupported Windows source architecture");
	const architecture = process.arch === "x64" ? "x64" : "arm64";
	const goVersion = manifest.goVersion;
	if (manifest.moduleChecksum !== GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM || typeof goVersion !== "string" || !isGentleAiWindowsGoVersionSupported(goVersion)) throw new Error("invalid Windows source provenance");
	return {
		version: GENTLE_AI_VERSION,
		method: GENTLE_AI_INSTALL_METHOD.GO_SUMDB_SOURCE_BUILD,
		package: GENTLE_AI_WINDOWS_SOURCE_PACKAGE_PATH,
		module: GENTLE_AI_WINDOWS_SOURCE_MODULE,
		tag: GENTLE_AI_WINDOWS_SOURCE_TAG,
		architecture,
		binarySha256,
		moduleChecksum: GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM,
		goVersion,
		goos: "windows",
		goarch: process.arch === "x64" ? "amd64" : "arm64",
		buildMode: "exe",
		compiler: "gc",
		cgoEnabled: "0",
	};
}

function expectedRuntimeManifest(platform: string, binarySha256: string, manifest: Record<string, unknown>): Record<string, string> {
	if (platform === "win32") return windowsSourceManifest(manifest, binarySha256, platform);
	const asset = resolveGentleAiReleaseAsset(platform, process.arch);
	if (binarySha256 !== asset.binarySha256) throw new Error("runtime binary does not match pinned release digest");
	return signedReleaseManifest(asset);
}

function isCanonicalManifest(contents: string, manifest: Record<string, unknown>, expected: Record<string, string>): boolean {
	return contents === `${JSON.stringify(expected)}\n`
		&& Object.keys(manifest).length === Object.keys(expected).length
		&& Object.entries(expected).every(([key, value]) => manifest[key] === value);
}

function sameFile(before: ReturnType<typeof lstatSync>, after: ReturnType<typeof lstatSync>): boolean {
	return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs;
}

export function resolveGentleAiBinary(
	packageRoot = dirname(dirname(fileURLToPath(import.meta.url))),
	platform = process.platform,
	readBinary: (path: string) => Buffer = readFileSync,
): string {
	const binaryPath = gentleAiBinaryPath(packageRoot, platform);
	const versionDirectory = dirname(binaryPath);
	const manifestPath = join(versionDirectory, "integrity.json");
	try {
		if (!isAbsolute(binaryPath) || !isConfined(binaryPath, versionDirectory)) throw new Error("unconfined binary");
		for (const path of [join(resolve(packageRoot), ".gentle-ai"), versionDirectory]) {
			const details = lstatSync(path);
			if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("symlinked runtime directory");
		}
		assertRegularNonSymlink(binaryPath);
		assertPosixExecutable(binaryPath, platform);
		assertRegularNonSymlink(manifestPath);
		const beforeBinary = lstatSync(binaryPath);
		const beforeManifest = lstatSync(manifestPath);
		const manifestContents = readFileSync(manifestPath, "utf8");
		const manifest = JSON.parse(manifestContents) as Record<string, unknown>;
		const binarySha256 = sha256(readBinary(binaryPath));
		const expected = expectedRuntimeManifest(platform, binarySha256, manifest);
		if (!isCanonicalManifest(manifestContents, manifest, expected)) throw new Error("invalid runtime integrity manifest");
		const afterBinary = lstatSync(binaryPath);
		const afterManifest = lstatSync(manifestPath);
		if (!sameFile(beforeBinary, afterBinary) || !sameFile(beforeManifest, afterManifest)) throw new Error("runtime replaced during verification");
		assertPosixExecutable(binaryPath, platform);
		return binaryPath;
	} catch {
		throw new PackageLocalGentleAiBinaryMissingError(binaryPath);
	}
}
