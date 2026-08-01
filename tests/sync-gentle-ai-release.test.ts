import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
	RELEASE_ARTIFACT_MANIFEST_FILE_NAME,
	RELEASE_ARTIFACT_TREE_CANONICALIZATION,
	assertReleaseAcceptanceEvidence,
	RELEASE_ARTIFACT_EVIDENCE_CLASS,
	treeDigest,
	type ArtifactEntry,
} from "../lib/release-artifact.ts";
import {
	GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH,
	assertLockVersionPin,
	assertTrustedCommentBinding,
	buildGentleAiReleaseLock,
	canonicalLockJson,
	findChecksumLine,
	parseMinisignPublicKey,
	parseMinisignSignature,
	parseTrustedCommentFields,
	syncGentleAiRelease,
	verifyMinisignSignature,
} from "../scripts/sync-gentle-ai-release.mjs";

const execFileAsync = promisify(execFile);

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gentle-pi-sync-gentle-ai-release-"));
}

// --- minisign wire-format test helpers ------------------------------------
// These build byte-identical minisign public key / signature files from a
// locally generated Ed25519 keypair, so the parser and verifier can be
// proven correct without depending on gentle-ai's real (not-yet-existing)
// signing key. The wire format itself is minisign's documented format:
// 2-byte algorithm "Ed" + 8-byte key id + payload, base64-encoded on one
// line, preceded by an "untrusted comment:" line and followed (for
// signatures) by a "trusted comment:" line and a base64 global signature
// line covering (signature bytes || trusted comment bytes).

const MINISIGN_ALGORITHM = Buffer.from("Ed", "latin1");

function minisignKeyId(seed: number): Buffer {
	const id = Buffer.alloc(8);
	id.writeUInt32LE(seed, 0);
	return id;
}

function buildMinisignPublicKeyText(publicKeyBytes: Buffer, keyId: Buffer): string {
	const line = Buffer.concat([MINISIGN_ALGORITHM, keyId, publicKeyBytes]).toString("base64");
	return `untrusted comment: minisign public key ${keyId.toString("hex")}\n${line}\n`;
}

function buildMinisignSignatureText(message: Buffer, trustedComment: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], keyId: Buffer): string {
	const signature = cryptoSign(null, message, privateKey);
	const signatureLineBytes = Buffer.concat([MINISIGN_ALGORITHM, keyId, signature]);
	const trustedCommentBytes = Buffer.from(trustedComment, "utf8");
	const globalSignature = cryptoSign(null, Buffer.concat([signatureLineBytes, trustedCommentBytes]), privateKey);
	return [
		"untrusted comment: minisign signature",
		signatureLineBytes.toString("base64"),
		`trusted comment: ${trustedComment}`,
		globalSignature.toString("base64"),
		"",
	].join("\n");
}

function generateTestKeypair(seed: number) {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const rawPublicKey = publicKey.export({ type: "spki", format: "der" }).subarray(12);
	const keyId = minisignKeyId(seed);
	return {
		privateKey,
		keyId,
		publicKeyText: buildMinisignPublicKeyText(rawPublicKey, keyId),
	};
}

// --- minisign parsing (task 2.1) ------------------------------------------

test("parseMinisignPublicKey decodes algorithm, key id, and raw 32-byte key", () => {
	const { keyId, publicKeyText } = generateTestKeypair(1);
	const parsed = parseMinisignPublicKey(publicKeyText);
	assert.equal(parsed.keyId.toString("hex"), keyId.toString("hex"));
	assert.equal(parsed.publicKeyBytes.length, 32);
});

test("parseMinisignSignature decodes the trusted comment and signature fields", () => {
	const { privateKey, keyId } = generateTestKeypair(1);
	const message = Buffer.from("checksums content\n");
	const text = buildMinisignSignatureText(message, "repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3", privateKey, keyId);
	const parsed = parseMinisignSignature(text);
	assert.equal(parsed.trustedComment, "repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3");
	assert.equal(parsed.keyId.toString("hex"), keyId.toString("hex"));
	assert.equal(parsed.signature.length, 64);
	assert.equal(parsed.globalSignature.length, 64);
});

// --- forged minisign signature rejected (threat-matrix: network trust boundary) ---

test("verifyMinisignSignature rejects a signature produced by a different (untrusted) key", () => {
	const trusted = generateTestKeypair(1);
	const attacker = generateTestKeypair(2);
	const message = Buffer.from("checksums content\n");
	const forgedText = buildMinisignSignatureText(message, "repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3", attacker.privateKey, trusted.keyId);
	assert.throws(() => verifyMinisignSignature(message, forgedText, trusted.publicKeyText), /signature/i);
});

test("verifyMinisignSignature rejects a tampered message that no longer matches the signature", () => {
	const trusted = generateTestKeypair(1);
	const message = Buffer.from("checksums content\n");
	const validText = buildMinisignSignatureText(message, "repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3", trusted.privateKey, trusted.keyId);
	const tamperedMessage = Buffer.from("checksums CONTENT\n");
	assert.throws(() => verifyMinisignSignature(tamperedMessage, validText, trusted.publicKeyText), /signature/i);
});

test("verifyMinisignSignature rejects a tampered trusted comment even when the message signature is valid", () => {
	const trusted = generateTestKeypair(1);
	const message = Buffer.from("checksums content\n");
	const validText = buildMinisignSignatureText(message, "repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3", trusted.privateKey, trusted.keyId);
	const tampered = validText.replace("tag:v2.2.3", "tag:v9.9.9");
	assert.throws(() => verifyMinisignSignature(message, tampered, trusted.publicKeyText), /signature/i);
});

test("verifyMinisignSignature accepts a genuine signature and returns its trusted comment", () => {
	const trusted = generateTestKeypair(1);
	const message = Buffer.from("checksums content\n");
	const text = buildMinisignSignatureText(message, "repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3", trusted.privateKey, trusted.keyId);
	const result = verifyMinisignSignature(message, text, trusted.publicKeyText);
	assert.equal(result.trustedComment, "repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3");
});

// --- wrong trusted-comment repo/tag binding rejected -----------------------

test("parseTrustedCommentFields extracts tab-separated key:value tokens", () => {
	const fields = parseTrustedCommentFields("timestamp:123\tfile:checksums.txt\trepo:Gentleman-Programming/gentle-ai\ttag:v2.2.3");
	assert.equal(fields.get("repo"), "Gentleman-Programming/gentle-ai");
	assert.equal(fields.get("tag"), "v2.2.3");
});

test("assertTrustedCommentBinding rejects a trusted comment naming the wrong repository", () => {
	assert.throws(
		() => assertTrustedCommentBinding("repo:someone-else/gentle-ai\ttag:v2.2.3", { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3" }),
		/repo/i,
	);
});

test("assertTrustedCommentBinding rejects a trusted comment naming the wrong tag", () => {
	assert.throws(
		() => assertTrustedCommentBinding("repo:Gentleman-Programming/gentle-ai\ttag:v9.9.9", { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3" }),
		/tag/i,
	);
});

test("assertTrustedCommentBinding accepts a trusted comment naming the expected repository and tag", () => {
	assert.doesNotThrow(() =>
		assertTrustedCommentBinding("repo:Gentleman-Programming/gentle-ai\ttag:v2.2.3", { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3" }),
	);
});

// --- missing / duplicate checksum line rejected -----------------------------

test("findChecksumLine rejects a checksums.txt with no line for the expected asset", () => {
	assert.throws(
		() => findChecksumLine(`${"a".repeat(64)}  gentle-ai_other_assets.tar.gz\n`, "gentle-ai_2.2.3_assets.tar.gz"),
		/no checksum line/i,
	);
});

test("findChecksumLine rejects a checksums.txt with two lines for the expected asset", () => {
	const text = `${"a".repeat(64)}  gentle-ai_2.2.3_assets.tar.gz\n${"b".repeat(64)}  gentle-ai_2.2.3_assets.tar.gz\n`;
	assert.throws(() => findChecksumLine(text, "gentle-ai_2.2.3_assets.tar.gz"), /duplicate checksum/i);
});

test("findChecksumLine returns the exact one matching digest", () => {
	const text = `${"a".repeat(64)}  gentle-ai_other_assets.tar.gz\n${"b".repeat(64)}  gentle-ai_2.2.3_assets.tar.gz\n`;
	assert.equal(findChecksumLine(text, "gentle-ai_2.2.3_assets.tar.gz"), "b".repeat(64));
});

// --- canonical lock (task 2.4) ---------------------------------------------

function buildTestManifest(entries: ArtifactEntry[]) {
	return {
		schema: "gentle-ai.release-artifact-manifest/v1",
		contract: { id: "gentle-ai.release-artifact", major: 1, minor: 0, schemaId: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json", schemaPath: "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json" },
		release: { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3", version: "2.2.3", commit: "0".repeat(40) },
		layout: { version: 1 },
		archive: { asset: "gentle-ai_2.2.3_assets.tar.gz", digestSource: "signed-checksums.txt" },
		references: { semanticSnapshots: [], contracts: [] },
		tree: { algorithm: "sha256", canonicalization: RELEASE_ARTIFACT_TREE_CANONICALIZATION, manifestIncluded: false, digest: treeDigest(entries) },
		compatibility: { minimumContractMajor: 1, maximumContractMajor: 1, additiveMinorPolicy: "optional-fields-only", unknownMandatory: "reject", unknownOptional: "ignore" },
		entries,
	};
}

test("buildGentleAiReleaseLock sorts entries and generated by raw path bytes", () => {
	const entries: ArtifactEntry[] = [
		{ path: "z/last.json", type: "file", mode: "0644", size: 1, digest: `sha256:${"a".repeat(64)}` },
		{ path: "a/first.json", type: "file", mode: "0644", size: 1, digest: `sha256:${"b".repeat(64)}` },
	];
	const manifest = buildTestManifest(entries);
	const lock = buildGentleAiReleaseLock(manifest, [
		{ path: "z/last.json", sha256: `sha256:${"a".repeat(64)}` },
		{ path: "a/first.json", sha256: `sha256:${"b".repeat(64)}` },
	], { archiveSha256: `sha256:${"c".repeat(64)}` });
	assert.deepEqual(lock.entries.map((entry: { path: string }) => entry.path), ["a/first.json", "z/last.json"]);
	assert.deepEqual(lock.generated.map((entry: { path: string }) => entry.path), ["a/first.json", "z/last.json"]);
	assert.equal(lock.archive.sha256, `sha256:${"c".repeat(64)}`);
	assert.equal(lock.contract.layoutVersion, 1);
});

test("canonicalLockJson serializes with 2-space indent, LF newlines, and exactly one trailing LF", () => {
	const lock = buildGentleAiReleaseLock(buildTestManifest([{ path: "a.json", type: "file", mode: "0644", size: 1, digest: `sha256:${"a".repeat(64)}` }]), [
		{ path: "a.json", sha256: `sha256:${"a".repeat(64)}` },
	], { archiveSha256: `sha256:${"c".repeat(64)}` });
	const text = canonicalLockJson(lock);
	assert.ok(!text.includes("\r"));
	assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"));
	assert.ok(text.includes('  "release"'));
});

test("assertLockVersionPin passes when lock.release.version matches the authoritative INSTALLER_VERSION", () => {
	const lock = buildGentleAiReleaseLock(buildTestManifest([{ path: "a.json", type: "file", mode: "0644", size: 1, digest: `sha256:${"a".repeat(64)}` }]), [
		{ path: "a.json", sha256: `sha256:${"a".repeat(64)}` },
	], { archiveSha256: `sha256:${"c".repeat(64)}` });
	assert.doesNotThrow(() => assertLockVersionPin(lock, "2.2.3"));
	assert.throws(() => assertLockVersionPin(lock, "9.9.9"), /INSTALLER_VERSION/);
});

// --- evidence-S/R labeling (task 2.7) and mirror/lock writing (task 2.3/2.4) ---

async function buildBootstrapArchive(sourceDir: string, archivePath: string): Promise<{ manifest: Record<string, unknown> }> {
	const schemaBytes = await readFile(join(import.meta.dirname, "fixtures", "release-artifact", "artifact-manifest.schema.json"));
	const semanticBytes = Buffer.from(`${JSON.stringify({ schema: "gentle-ai.release-semantic-capabilities/v1", operations: ["review.status"] }, null, 2)}\n`);
	const entries = [
		{ path: "capabilities/review-integration-v2.semantic.json", type: "file", mode: "0644", size: semanticBytes.length, digest: `sha256:${createHash("sha256").update(semanticBytes).digest("hex")}` },
		{ path: "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json", type: "file", mode: "0644", size: schemaBytes.length, digest: `sha256:${createHash("sha256").update(schemaBytes).digest("hex")}` },
	];
	const manifest = {
		schema: "gentle-ai.release-artifact-manifest/v1",
		contract: { id: "gentle-ai.release-artifact", major: 1, minor: 0, schema_id: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json", schema_path: "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json" },
		release: { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3", version: "2.2.3", commit: "0".repeat(40) },
		layout: { version: 1 },
		archive: { asset: "gentle-ai_2.2.3_assets.tar.gz", digest_source: "signed-checksums.txt" },
		references: {
			semantic_snapshots: [{ contract: "gentle-ai.review-integration/v2", path: "capabilities/review-integration-v2.semantic.json", schema: "gentle-ai.release-semantic-capabilities/v1" }],
			contracts: [{ id: "gentle-ai.review-integration/v2", root: "contracts/review-integration/v2" }],
		},
		tree: { algorithm: "sha256", canonicalization: RELEASE_ARTIFACT_TREE_CANONICALIZATION, manifest_included: false, digest: treeDigest(entries as ArtifactEntry[]) },
		compatibility: { minimum_contract_major: 1, maximum_contract_major: 1, additive_minor_policy: "optional-fields-only", unknown_mandatory: "reject", unknown_optional: "ignore" },
		entries,
	};

	await mkdir(join(sourceDir, "contracts", "release-artifact", "v1", "schemas"), { recursive: true });
	await mkdir(join(sourceDir, "capabilities"), { recursive: true });
	await writeFile(join(sourceDir, RELEASE_ARTIFACT_MANIFEST_FILE_NAME), JSON.stringify(manifest));
	await writeFile(join(sourceDir, "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json"), schemaBytes);
	await writeFile(join(sourceDir, "capabilities/review-integration-v2.semantic.json"), semanticBytes);
	await execFileAsync("tar", [
		"-czf",
		archivePath,
		"-C",
		sourceDir,
		RELEASE_ARTIFACT_MANIFEST_FILE_NAME,
		"contracts/release-artifact/v1/schemas/artifact-manifest.schema.json",
		"capabilities/review-integration-v2.semantic.json",
	]);
	return { manifest };
}

test("syncGentleAiRelease against --bootstrap-archive is labeled development/bootstrap and writes mirrors + lock", async () => {
	const sourceDir = await tempWorkspace();
	const packageRoot = await tempWorkspace();
	const archivePath = join(sourceDir, "..", "sync-bootstrap.tar.gz");
	try {
		await buildBootstrapArchive(sourceDir, archivePath);

		const result = await syncGentleAiRelease({ packageRoot, bootstrapArchivePath: archivePath, write: true });

		assert.equal(result.evidenceClass, RELEASE_ARTIFACT_EVIDENCE_CLASS.BOOTSTRAP);
		assert.throws(() => assertReleaseAcceptanceEvidence(result), /cannot serve as pin or final-acceptance evidence/);

		const writtenSchema = await readFile(join(packageRoot, "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json"));
		const expectedSchema = await readFile(join(import.meta.dirname, "fixtures", "release-artifact", "artifact-manifest.schema.json"));
		assert.deepEqual(writtenSchema, expectedSchema);

		const lockText = await readFile(join(packageRoot, GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH), "utf8");
		const lock = JSON.parse(lockText);
		assert.equal(lock.release.version, "2.2.3");
		assert.equal(lock.entries.length, 2);
		assert.equal(lock.generated.length, 2);
		assert.ok(lockText.endsWith("\n") && !lockText.endsWith("\n\n"));
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
		await rm(packageRoot, { recursive: true, force: true });
		await rm(archivePath, { force: true });
	}
});

test("syncGentleAiRelease against --bootstrap-archive never labels its result release evidence even when write is false", async () => {
	const sourceDir = await tempWorkspace();
	const packageRoot = await tempWorkspace();
	const archivePath = join(sourceDir, "..", "sync-bootstrap-noop.tar.gz");
	try {
		await buildBootstrapArchive(sourceDir, archivePath);
		const result = await syncGentleAiRelease({ packageRoot, bootstrapArchivePath: archivePath, write: false });
		assert.equal(result.evidenceClass, RELEASE_ARTIFACT_EVIDENCE_CLASS.BOOTSTRAP);
		assert.equal(result.signatureStatus, "not-applicable/local-unsigned");
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
		await rm(packageRoot, { recursive: true, force: true });
		await rm(archivePath, { force: true });
	}
});
