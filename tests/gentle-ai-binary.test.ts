import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import test from "node:test";
import {
	GENTLE_AI_BINARY_MISSING_CODE,
	PackageLocalGentleAiBinaryMissingError,
	resolveGentleAiBinary,
} from "../lib/gentle-ai-binary.ts";
import { NativeReviewCliV213, createNativeReviewCli, type ExecFileAdapter } from "../lib/native-review-cli.ts";
import { resolveGentleAiReleaseAsset } from "../scripts/gentle-ai-installer.mjs";

const VERSION = { stdout: "gentle-ai 2.1.5\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false } as const;

async function writeVerifiedBinary(packageRoot: string, platform = process.platform): Promise<string> {
	const asset = resolveGentleAiReleaseAsset(platform, process.arch);
	const binaryPath = join(packageRoot, ".gentle-ai", "v2.1.5", asset.executable);
	await mkdir(join(packageRoot, ".gentle-ai", "v2.1.5"), { recursive: true });
	await writeFile(binaryPath, readFileSync(join(import.meta.dirname, "..", ".gentle-ai", "v2.1.5", asset.executable)));
	if (platform !== "win32") await chmod(binaryPath, 0o700);
	await writeFile(join(packageRoot, ".gentle-ai", "v2.1.5", "integrity.json"), `${JSON.stringify({ version: "2.1.5", asset: asset.name, assetSha256: asset.sha256, binarySha256: asset.binarySha256 })}\n`);
	return binaryPath;
}

test("runtime resolves an absolute package-local binary path without PATH fallback", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-"));
	const executable = process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai";
	const binaryPath = await writeVerifiedBinary(packageRoot);

	const resolved = resolveGentleAiBinary(packageRoot, process.platform);
	assert.equal(resolved, binaryPath);
	assert.equal(isAbsolute(resolved), true);
	assert.equal(basename(resolved), executable);
	assert.doesNotMatch(resolved, /(^|[/\\])PATH($|[/\\])/i);
});

test("runtime rejects an unverified binary, a symlinked manifest, and ambient executable injection", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-integrity-"));
	const executable = process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai";
	const binaryPath = join(packageRoot, ".gentle-ai", "v2.1.5", executable);
	const manifestPath = join(packageRoot, ".gentle-ai", "v2.1.5", "integrity.json");
	await mkdir(join(packageRoot, ".gentle-ai", "v2.1.5"), { recursive: true });
	await writeFile(binaryPath, "native");

	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
	const binarySha256 = createHash("sha256").update("native").digest("hex");
	const manifestTarget = join(packageRoot, "manifest-target.json");
	await writeFile(manifestTarget, `${JSON.stringify({ version: "2.1.5", asset: `gentle-ai_2.1.5_${process.platform}_${process.arch === "x64" ? "amd64" : process.arch}.tar.gz`, assetSha256: "a".repeat(64), binarySha256 })}\n`);
	await symlink(manifestTarget, manifestPath);
	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
	assert.throws(() => new NativeReviewCliV213(async () => VERSION, "gentle-ai"), /absolute package-local executable/);
});

test("runtime rejects malformed, unknown, wrong, and symlinked integrity paths", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-manifest-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	const manifestPath = join(packageRoot, ".gentle-ai", "v2.1.5", "integrity.json");
	const valid = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
	for (const manifest of [
		"{",
		{ ...valid, extra: "unknown" },
		{ ...valid, version: "9.9.9" },
		{ ...valid, asset: "wrong-asset" },
		{ ...valid, assetSha256: "0".repeat(64) },
		{ ...valid, binarySha256: "not-a-digest" },
	]) {
		writeFileSync(manifestPath, typeof manifest === "string" ? manifest : JSON.stringify(manifest));
		assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
	}
	await writeFile(manifestPath, JSON.stringify(valid));
	const binaryTarget = join(packageRoot, "binary-target");
	await writeFile(binaryTarget, "native");
	await rm(binaryPath);
	await symlink(binaryTarget, binaryPath);
	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);

	const directoryRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-directory-"));
	await symlink(join(packageRoot, ".gentle-ai"), join(directoryRoot, ".gentle-ai"));
	assert.throws(() => resolveGentleAiBinary(directoryRoot, process.platform), /package-local-binary-missing/);
});

test("runtime rejects an arbitrary binary even when a forged manifest matches its digest", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-forged-manifest-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	const asset = resolveGentleAiReleaseAsset(process.platform, process.arch);
	await writeFile(binaryPath, "arbitrary binary");
	if (process.platform !== "win32") await chmod(binaryPath, 0o700);
	await writeFile(join(packageRoot, ".gentle-ai", "v2.1.5", "integrity.json"), JSON.stringify({ version: "2.1.5", asset: asset.name, assetSha256: asset.sha256, binarySha256: createHash("sha256").update("arbitrary binary").digest("hex") }));
	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
});

test("runtime rejects binary replacement during verification", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-replacement-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	assert.throws(
		() => resolveGentleAiBinary(packageRoot, process.platform, (path) => {
			writeFileSync(path, "replaced");
			return readFileSync(path);
		}),
		/package-local-binary-missing/,
	);
	assert.equal(readFileSync(binaryPath, "utf8"), "replaced");
});

test("runtime fails closed when the package-local binary is missing", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-missing-"));
	assert.throws(
		() => resolveGentleAiBinary(packageRoot, "linux"),
		(error: unknown) => error instanceof PackageLocalGentleAiBinaryMissingError
			&& error.code === GENTLE_AI_BINARY_MISSING_CODE
			&& error.message.includes("package-local-binary-missing"),
	);
});

test("runtime rejects a valid but non-executable POSIX binary", async (t) => {
	if (process.platform === "win32") {
		t.skip("Windows does not use POSIX executable mode bits");
		return;
	}
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-non-executable-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	await chmod(binaryPath, 0o600);
	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
});

test("production native operations report the package-local missing binary code", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-native-missing-"));
	const adapter: ExecFileAdapter = async () => {
		throw new Error("the adapter must not be reached when the package binary is missing");
	};
	await assert.rejects(
		() => createNativeReviewCli(adapter, () => resolveGentleAiBinary(packageRoot, "linux")).start({ cwd: packageRoot }),
		(error: unknown) => error instanceof Error && "code" in error && error.code === GENTLE_AI_BINARY_MISSING_CODE,
	);
});

test("production native client never invokes a global gentle-ai executable", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-native-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	const calls: string[] = [];
	const adapter: ExecFileAdapter = async (request) => {
		calls.push(request.file);
		if (request.arguments[0] === "version") return VERSION;
		return {
			...VERSION,
			stdout: JSON.stringify({ operation: "review/start", lineage_id: "lineage", state: "reviewing", risk_level: "low", selected_lenses: [], changed_files: 0, changed_lines: 0, correction_budget: 0, action: "created", lenses_required: false, projection: "workspace" }),
		};
	};

	await createNativeReviewCli(adapter, () => resolveGentleAiBinary(packageRoot, process.platform)).start({ cwd: packageRoot });
	assert.deepEqual(calls, [binaryPath, binaryPath]);
	assert.ok(calls.every((file) => file !== "gentle-ai"));
	assert.throws(() => new NativeReviewCliV213(adapter, "gentle-ai"), /absolute package-local executable/);
	assert.throws(() => new NativeReviewCliV213(adapter, "./gentle-ai"), /absolute package-local executable/);
});
