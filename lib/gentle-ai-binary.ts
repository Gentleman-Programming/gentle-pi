import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { GENTLE_AI_GO_MODULE, GENTLE_AI_GO_MODULE_SUM, resolveGentleAiReleaseAsset } from "../scripts/gentle-ai-installer.mjs";
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
		const before = lstatSync(binaryPath);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
		const sourceManifest = platform === "win32" && Object.keys(manifest).length === 7
			&& ["version", "provenance", "module", "moduleVersion", "moduleSum", "goVersion", "binarySha256"].every((key) => key in manifest)
			&& manifest.version === GENTLE_AI_VERSION && manifest.provenance === "go-source"
			&& manifest.module === GENTLE_AI_GO_MODULE && manifest.moduleVersion === `v${GENTLE_AI_VERSION}`
			&& manifest.moduleSum === GENTLE_AI_GO_MODULE_SUM && typeof manifest.goVersion === "string"
			&& /^\d+\.\d+\.\d+$/.test(manifest.goVersion);
		let releaseManifest = false;
		if (platform !== "win32") {
			const asset = resolveGentleAiReleaseAsset(platform, process.arch);
			releaseManifest = Object.keys(manifest).length === 4
				&& ["version", "asset", "assetSha256", "binarySha256"].every((key) => key in manifest)
				&& manifest.version === GENTLE_AI_VERSION && manifest.asset === asset.name
				&& manifest.assetSha256 === asset.sha256 && manifest.binarySha256 === asset.binarySha256;
		}
		if (!(sourceManifest || releaseManifest) || typeof manifest.binarySha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.binarySha256) || sha256(readBinary(binaryPath)) !== manifest.binarySha256) throw new Error("invalid runtime integrity manifest");
		const after = lstatSync(binaryPath);
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("runtime replaced during verification");
		assertPosixExecutable(binaryPath, platform);
		return binaryPath;
	} catch {
		throw new PackageLocalGentleAiBinaryMissingError(binaryPath);
	}
}
