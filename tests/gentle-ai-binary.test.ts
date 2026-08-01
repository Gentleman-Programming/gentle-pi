import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import test from "node:test";
import {
	GENTLE_AI_ASSETS_MISSING_CODE,
	GENTLE_AI_BINARY_MISSING_CODE,
	GENTLE_AI_VERSION,
	PackageLocalGentleAiAssetsMissingError,
	PackageLocalGentleAiBinaryMissingError,
	gentleAiAssetsDirectoryPath,
	resolveGentleAiAssets,
	resolveGentleAiBinary,
} from "../lib/gentle-ai-binary.ts";
import { NativeReviewCliV213, createNativeReviewCli, type ExecFileAdapter } from "../lib/native-review-cli.ts";
import { RELEASE_ARTIFACT_MANIFEST_FILE_NAME } from "../lib/release-artifact.ts";
import { GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM, resolveGentleAiReleaseAsset } from "../scripts/gentle-ai-installer.mjs";
import { requireNativeBinary } from "./support/native-binary-gate.ts";
import { buildAssetsFixture, makeAssetsExecutable, writeAssetsTree, type AssetsFixture } from "./support/gentle-ai-assets-fixture.ts";

const VERSION = { stdout: `gentle-ai ${GENTLE_AI_VERSION}\n`, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false } as const;
const RUNTIME_DIRECTORY = `v${GENTLE_AI_VERSION}`;
const repoRuntimeBinary = join(import.meta.dirname, "..", ".gentle-ai", RUNTIME_DIRECTORY, process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
const releaseDigestsPinned = process.platform === "win32" || /^[0-9a-f]{64}$/.test(resolveGentleAiReleaseAsset(process.platform, process.arch).sha256);
// These integrity tests need the published official binary; they skip while a
// re-pinned release's archives and digest table are still pending.
const nativeBinaryGate = requireNativeBinary({
	resolvedBinary: existsSync(repoRuntimeBinary) ? repoRuntimeBinary : undefined,
	digestsPinned: releaseDigestsPinned,
	env: process.env,
});
if (!nativeBinaryGate.run) console.log(`gentle-ai-binary: ${nativeBinaryGate.reason}`);
const verifiedBinaryTest = nativeBinaryGate.run && process.platform !== "win32" ? test : test.skip;

// --- assets bundle fixtures (P2a, tasks 3.2-3.6, design D3/D4) -------------
//
// `resolveGentleAiBinary` now also reads the pinned assets identity from
// `capabilities/gentle-ai-release.lock.json` (never the assets tree itself —
// the hot path stays one file hash). Every packageRoot below that expects
// `resolveGentleAiBinary` to SUCCEED must therefore also carry a lock fixture
// whose values agree with the written `integrity.json`'s assets fields.

const DEFAULT_ASSETS_FIXTURE = buildAssetsFixture();
const DEFAULT_ASSETS_ARCHIVE_NAME = "gentle-ai_2.2.3_assets.tar.gz";
const DEFAULT_ASSETS_ARCHIVE_SHA256 = "c".repeat(64);

async function writeAssetsLock(packageRoot: string, fixture: AssetsFixture = DEFAULT_ASSETS_FIXTURE, archiveSha256 = DEFAULT_ASSETS_ARCHIVE_SHA256): Promise<void> {
	await mkdir(join(packageRoot, "capabilities"), { recursive: true });
	await writeFile(join(packageRoot, "capabilities", "gentle-ai-release.lock.json"), `${JSON.stringify({
		release: { version: GENTLE_AI_VERSION },
		archive: { asset: DEFAULT_ASSETS_ARCHIVE_NAME, sha256: `sha256:${archiveSha256}` },
		tree: { digest: fixture.treeDigest },
		contract: { major: fixture.contractMajor, layoutVersion: fixture.layoutVersion },
	})}\n`);
}

function assetsManifestFields(fixture: AssetsFixture = DEFAULT_ASSETS_FIXTURE, archiveSha256 = DEFAULT_ASSETS_ARCHIVE_SHA256): Record<string, string | number> {
	return {
		assetsAsset: DEFAULT_ASSETS_ARCHIVE_NAME,
		assetsArchiveSha256: archiveSha256,
		assetsTreeSha256: fixture.treeDigest.replace(/^sha256:/, ""),
		contractMajor: fixture.contractMajor,
		layoutVersion: fixture.layoutVersion,
	};
}

async function writeAssetsBundle(packageRoot: string, platform = process.platform, fixture: AssetsFixture = DEFAULT_ASSETS_FIXTURE): Promise<string> {
	const assetsDirectory = gentleAiAssetsDirectoryPath(packageRoot, platform);
	await writeAssetsTree(assetsDirectory, fixture);
	return assetsDirectory;
}

async function writeVerifiedBinary(packageRoot: string, platform = process.platform): Promise<string> {
	const asset = resolveGentleAiReleaseAsset(platform, process.arch);
	const binaryPath = join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, asset.executable);
	await mkdir(join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY), { recursive: true });
	await writeFile(binaryPath, readFileSync(join(import.meta.dirname, "..", ".gentle-ai", RUNTIME_DIRECTORY, asset.executable)));
	if (platform !== "win32") await chmod(binaryPath, 0o700);
	await writeAssetsLock(packageRoot);
	await writeAssetsBundle(packageRoot, platform);
	await writeFile(join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "integrity.json"), `${JSON.stringify({ version: GENTLE_AI_VERSION, asset: asset.name, assetSha256: asset.sha256, binarySha256: asset.binarySha256, ...assetsManifestFields() })}\n`);
	return binaryPath;
}

async function writeWindowsSourceBinary(packageRoot: string): Promise<{ binaryPath: string; manifestPath: string }> {
	const binaryPath = join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "gentle-ai.exe");
	const manifestPath = join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "integrity.json");
	const binary = "verified Windows source build";
	await mkdir(join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY), { recursive: true });
	await writeFile(binaryPath, binary);
	await writeAssetsLock(packageRoot);
	await writeAssetsBundle(packageRoot, "win32");
	await writeFile(manifestPath, `${JSON.stringify({
		version: GENTLE_AI_VERSION,
		method: "go-sumdb-source-build",
		package: "github.com/gentleman-programming/gentle-ai/v2/cmd/gentle-ai",
		module: "github.com/gentleman-programming/gentle-ai/v2",
		tag: "v2.2.3",
		architecture: process.arch === "x64" ? "x64" : "arm64",
		binarySha256: createHash("sha256").update(binary).digest("hex"),
		moduleChecksum: GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM,
		goVersion: "go1.25.10",
		goos: "windows",
		goarch: process.arch === "x64" ? "amd64" : "arm64",
		buildMode: "exe",
		compiler: "gc",
		cgoEnabled: "0",
		...assetsManifestFields(),
	})}\n`);
	return { binaryPath, manifestPath };
}

verifiedBinaryTest("runtime resolves an absolute package-local binary path without PATH fallback", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-"));
	const executable = process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai";
	const binaryPath = await writeVerifiedBinary(packageRoot);

	const resolved = resolveGentleAiBinary(packageRoot, process.platform);
	assert.equal(resolved, binaryPath);
	assert.equal(isAbsolute(resolved), true);
	assert.equal(basename(resolved), executable);
	assert.doesNotMatch(resolved, /(^|[/\\])PATH($|[/\\])/i);
});

test("runtime validates a Windows Go SumDB source manifest and rejects tampering, symlinks, and PATH injection", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-windows-source-runtime-"));
	const { binaryPath, manifestPath } = await writeWindowsSourceBinary(packageRoot);
	assert.equal(resolveGentleAiBinary(packageRoot, "win32"), binaryPath);

	const valid = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
	for (const manifest of [
		{ ...valid, method: "signed-release-asset" },
		{ ...valid, module: "example.invalid/gentle-ai" },
		{ ...valid, tag: "v2.2.1" },
		{ ...valid, binarySha256: "0".repeat(64) },
		{ ...valid, moduleChecksum: "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
		{ ...valid, goVersion: "go1.25.9" },
		{ ...valid, goVersion: "go1.25" },
	]) {
		await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
		assert.throws(() => resolveGentleAiBinary(packageRoot, "win32"), /package-local-binary-missing/);
	}
	await writeFile(manifestPath, `${JSON.stringify(valid)}\n`);
	await writeFile(binaryPath, "tampered Windows source build");
	assert.throws(() => resolveGentleAiBinary(packageRoot, "win32"), /package-local-binary-missing/);
	await writeFile(binaryPath, "verified Windows source build");
	await rm(binaryPath);
	const ambient = join(packageRoot, "ambient-gentle-ai.exe");
	await writeFile(ambient, "ambient executable");
	await symlink(ambient, binaryPath);
	assert.throws(() => resolveGentleAiBinary(packageRoot, "win32"), /package-local-binary-missing/);
	assert.doesNotMatch(gentleAiBinaryPathForTest(packageRoot), /(^|[/\\])PATH($|[/\\])/i);
});

function gentleAiBinaryPathForTest(packageRoot: string): string {
	return join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "gentle-ai.exe");
}

test("runtime rejects an unverified binary, a symlinked manifest, and ambient executable injection", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-integrity-"));
	const executable = process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai";
	const binaryPath = join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, executable);
	const manifestPath = join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "integrity.json");
	await mkdir(join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY), { recursive: true });
	await writeFile(binaryPath, "native");

	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
	const binarySha256 = createHash("sha256").update("native").digest("hex");
	const manifestTarget = join(packageRoot, "manifest-target.json");
	await writeFile(manifestTarget, `${JSON.stringify({ version: GENTLE_AI_VERSION, asset: `gentle-ai_${GENTLE_AI_VERSION}_${process.platform}_${process.arch === "x64" ? "amd64" : process.arch}.tar.gz`, assetSha256: "a".repeat(64), binarySha256 })}\n`);
	await symlink(manifestTarget, manifestPath);
	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
	assert.throws(() => new NativeReviewCliV213(async () => VERSION, "gentle-ai"), /absolute package-local executable/);
});

verifiedBinaryTest("runtime rejects malformed, unknown, wrong, and symlinked integrity paths", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-manifest-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	const manifestPath = join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "integrity.json");
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

verifiedBinaryTest("runtime rejects a binary-only tamper while its canonical pinned manifest remains unchanged", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-pinned-manifest-tamper-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	await writeFile(binaryPath, "binary-only tamper");
	if (process.platform !== "win32") await chmod(binaryPath, 0o700);
	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
});

verifiedBinaryTest("runtime rejects an arbitrary binary even when a forged manifest matches its digest", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-forged-manifest-"));
	const binaryPath = await writeVerifiedBinary(packageRoot);
	const asset = resolveGentleAiReleaseAsset(process.platform, process.arch);
	await writeFile(binaryPath, "arbitrary binary");
	if (process.platform !== "win32") await chmod(binaryPath, 0o700);
	await writeFile(join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "integrity.json"), JSON.stringify({ version: GENTLE_AI_VERSION, asset: asset.name, assetSha256: asset.sha256, binarySha256: createHash("sha256").update("arbitrary binary").digest("hex") }));
	assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
});

verifiedBinaryTest("runtime rejects binary replacement during verification", async () => {
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

verifiedBinaryTest("runtime rejects a valid but non-executable POSIX binary", async (t) => {
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

verifiedBinaryTest("production native client never invokes a global gentle-ai executable", async () => {
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

// --- resolveGentleAiAssets (P2a, tasks 3.2-3.6, design D4) ------------------

test("resolveGentleAiAssets accepts a verified assets bundle and returns the decoded manifest", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-assets-"));
	await writeAssetsBundle(packageRoot, "linux");
	const { assetsDirectory, manifest } = resolveGentleAiAssets(packageRoot, "linux");
	assert.equal(assetsDirectory, gentleAiAssetsDirectoryPath(packageRoot, "linux"));
	assert.equal(manifest.entries.length, DEFAULT_ASSETS_FIXTURE.entries.length);
	assert.equal(manifest.tree.digest, DEFAULT_ASSETS_FIXTURE.treeDigest);
});

test("resolveGentleAiAssets fails closed when the assets bundle is missing", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-assets-missing-"));
	assert.throws(
		() => resolveGentleAiAssets(packageRoot, "linux"),
		(error: unknown) => error instanceof PackageLocalGentleAiAssetsMissingError
			&& error.code === GENTLE_AI_ASSETS_MISSING_CODE
			&& error.message.includes(GENTLE_AI_ASSETS_MISSING_CODE),
	);
});

test("resolveGentleAiAssets rejects an extra file in the installed assets tree (added-file attack)", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-assets-extra-"));
	const assetsDirectory = await writeAssetsBundle(packageRoot, "linux");
	await writeFile(join(assetsDirectory, "capabilities", "evil.json"), "{}");
	assert.throws(() => resolveGentleAiAssets(packageRoot, "linux"), PackageLocalGentleAiAssetsMissingError);
});

test("resolveGentleAiAssets rejects a symlinked asset", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-assets-symlink-"));
	const assetsDirectory = await writeAssetsBundle(packageRoot, "linux");
	const entry = DEFAULT_ASSETS_FIXTURE.entries[0];
	const entryPath = join(assetsDirectory, entry.path);
	const realTarget = join(assetsDirectory, "real-target.json");
	await writeFile(realTarget, await readFile(entryPath));
	await rm(entryPath);
	await symlink(realTarget, entryPath);
	assert.throws(() => resolveGentleAiAssets(packageRoot, "linux"), PackageLocalGentleAiAssetsMissingError);
});

test("resolveGentleAiAssets rejects an asset with mode 0755", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-assets-mode-"));
	const assetsDirectory = await writeAssetsBundle(packageRoot, "linux");
	await makeAssetsExecutable(assetsDirectory, DEFAULT_ASSETS_FIXTURE, DEFAULT_ASSETS_FIXTURE.entries[0].path);
	assert.throws(() => resolveGentleAiAssets(packageRoot, "linux"), PackageLocalGentleAiAssetsMissingError);
});

test("resolveGentleAiAssets keeps an asset named like install.sh non-executable, with no filename-based exemption", async () => {
	const fileA = Buffer.from("#!/bin/sh\necho hi\n");
	const fileB = DEFAULT_ASSETS_FIXTURE.files[1].bytes;
	// Entries must stay in ascending raw-byte path order (design D1 step 10):
	// "contracts/..." sorts before "install.sh".
	const entries = [
		DEFAULT_ASSETS_FIXTURE.entries[1],
		{ ...DEFAULT_ASSETS_FIXTURE.entries[0], path: "install.sh", size: fileA.length, digest: `sha256:${createHash("sha256").update(fileA).digest("hex")}` },
	];
	const { treeDigest } = await import("../lib/release-artifact.ts");
	const fixture: AssetsFixture = {
		entries,
		manifestBytes: Buffer.from(""),
		files: [{ path: entries[0].path, bytes: fileB }, { path: "install.sh", bytes: fileA }],
		treeDigest: treeDigest(entries),
		contractMajor: DEFAULT_ASSETS_FIXTURE.contractMajor,
		layoutVersion: DEFAULT_ASSETS_FIXTURE.layoutVersion,
	};
	const manifestObject = {
		schema: "gentle-ai.release-artifact-manifest/v1",
		contract: { id: "gentle-ai.release-artifact", major: fixture.contractMajor, minor: 0, schema_id: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json", schema_path: entries[0].path },
		release: { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3", version: "2.2.3", commit: "0".repeat(40) },
		layout: { version: fixture.layoutVersion },
		archive: { asset: "gentle-ai_2.2.3_assets.tar.gz", digest_source: "signed-checksums.txt" },
		references: {
			semantic_snapshots: [{ contract: "gentle-ai.review-integration/v2", path: "install.sh", schema: "gentle-ai.release-semantic-capabilities/v1" }],
			contracts: [{ id: "gentle-ai.review-integration/v1", root: "contracts/release-artifact/v1" }],
		},
		tree: { algorithm: "sha256", canonicalization: "gentle-ai.release-artifact-tree/v1", manifest_included: false, digest: fixture.treeDigest },
		compatibility: { minimum_contract_major: 1, maximum_contract_major: 1, additive_minor_policy: "optional-fields-only", unknown_mandatory: "reject", unknown_optional: "ignore" },
		entries,
	};
	fixture.manifestBytes = Buffer.from(JSON.stringify(manifestObject));

	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-assets-install-sh-"));
	const assetsDirectory = await writeAssetsBundle(packageRoot, "linux", fixture);
	const { manifest } = resolveGentleAiAssets(packageRoot, "linux");
	assert.ok(manifest.entries.some((entry) => entry.path === "install.sh"));

	await makeAssetsExecutable(assetsDirectory, fixture, "install.sh");
	assert.throws(() => resolveGentleAiAssets(packageRoot, "linux"), PackageLocalGentleAiAssetsMissingError);
});

test("resolveGentleAiAssets detects TOCTOU replacement of a non-endpoint entry across the whole file set", async () => {
	const { treeDigest, ENTRY_TYPE, ENTRY_MODE } = await import("../lib/release-artifact.ts");
	const files = [Buffer.from("first"), Buffer.from("second-middle"), Buffer.from("third")];
	const entries = files.map((bytes, index) => ({
		path: `assets/file-${index}.json`,
		type: ENTRY_TYPE.FILE,
		mode: ENTRY_MODE,
		size: bytes.length,
		digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
	}));
	const digest = treeDigest(entries as never);
	const manifestObject = {
		schema: "gentle-ai.release-artifact-manifest/v1",
		contract: { id: "gentle-ai.release-artifact", major: 1, minor: 0, schema_id: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json", schema_path: "assets/file-0.json" },
		release: { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3", version: "2.2.3", commit: "0".repeat(40) },
		layout: { version: 1 },
		archive: { asset: "gentle-ai_2.2.3_assets.tar.gz", digest_source: "signed-checksums.txt" },
		references: {
			semantic_snapshots: [{ contract: "gentle-ai.review-integration/v2", path: "assets/file-1.json", schema: "gentle-ai.release-semantic-capabilities/v1" }],
			contracts: [{ id: "gentle-ai.review-integration/v1", root: "assets" }],
		},
		tree: { algorithm: "sha256", canonicalization: "gentle-ai.release-artifact-tree/v1", manifest_included: false, digest },
		compatibility: { minimum_contract_major: 1, maximum_contract_major: 1, additive_minor_policy: "optional-fields-only", unknown_mandatory: "reject", unknown_optional: "ignore" },
		entries,
	};
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-assets-toctou-"));
	const assetsDirectory = gentleAiAssetsDirectoryPath(packageRoot, "linux");
	await mkdir(join(assetsDirectory, "assets"), { recursive: true });
	await writeFile(join(assetsDirectory, RELEASE_ARTIFACT_MANIFEST_FILE_NAME), Buffer.from(JSON.stringify(manifestObject)));
	for (const [index, entry] of entries.entries()) await writeFile(join(assetsDirectory, entry.path), files[index]);

	// Replace the middle entry (not the first, not the last) with
	// same-length different bytes as a side effect of reading it, but return
	// the ORIGINAL bytes so the digest check still passes — isolating the
	// whole-set `sameFile` recheck (mtime/inode, not content) as the thing
	// that actually catches this, exactly as it would for a real race
	// between this function's per-file read and its final recheck.
	const middlePath = join(assetsDirectory, entries[1].path);
	const readEntryFile = (path: string): Buffer => {
		const original = readFileSync(path);
		// Returning the ORIGINAL bytes keeps the digest check (and the
		// treeDigest recompute, which never touches file bytes at all)
		// passing — isolating the whole-set `sameFile` recheck as the only
		// check that can still fail here, since the mtime/inode change below
		// happens strictly after this entry's "before" lstat snapshot.
		if (path === middlePath) writeFileSync(path, Buffer.from("MUTATED-mid".padEnd(original.length, "!")).subarray(0, original.length));
		return original;
	};
	assert.throws(() => resolveGentleAiAssets(packageRoot, "linux", readEntryFile), PackageLocalGentleAiAssetsMissingError);
});

verifiedBinaryTest("resolveGentleAiBinary still rejects a forged assets digest even when the binary itself verifies", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-binary-forged-assets-"));
	await writeVerifiedBinary(packageRoot);
	const manifestPath = join(packageRoot, ".gentle-ai", RUNTIME_DIRECTORY, "integrity.json");
	const valid = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string | number>;
	for (const manifest of [
		{ ...valid, assetsTreeSha256: "f".repeat(64) },
		{ ...valid, assetsArchiveSha256: "f".repeat(64) },
		{ ...valid, contractMajor: 99 },
		{ ...valid, layoutVersion: 99 },
	]) {
		writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
		assert.throws(() => resolveGentleAiBinary(packageRoot, process.platform), /package-local-binary-missing/);
	}
});
