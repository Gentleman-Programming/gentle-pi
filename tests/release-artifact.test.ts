import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
	DEFAULT_EXTRACTION_LIMITS,
	ENTRY_MODE,
	ENTRY_TYPE,
	RELEASE_ARTIFACT_EVIDENCE_CLASS,
	RELEASE_ARTIFACT_MANIFEST_FILE_NAME,
	RELEASE_ARTIFACT_TREE_CANONICALIZATION,
	ReleaseArtifactExtractionError,
	ReleaseArtifactManifestError,
	SUPPORTED_CONTRACT_MAJOR,
	UnsupportedReleaseArtifactMajorError,
	assertBundledSchemaMatches,
	assertExactMemberSet,
	assertReleaseAcceptanceEvidence,
	createSystemReleaseArtifactExtractor,
	decodeArtifactManifest,
	enforceExtractionCaps,
	extractReleaseArtifact,
	resolveBootstrapArtifactSource,
	treeDigest,
	type ArchiveMember,
	type ArtifactEntry,
} from "../lib/release-artifact.ts";

const execFileAsync = promisify(execFile);
const FIXTURES_ROOT = join(import.meta.dirname, "fixtures", "release-artifact");

async function readJsonFixture(name: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(join(FIXTURES_ROOT, name), "utf8"));
}

async function readFixtureBytes(name: string): Promise<Buffer> {
	return readFile(join(FIXTURES_ROOT, name));
}

function mutate<T>(base: T, mutator: (draft: T) => void): T {
	const draft = structuredClone(base);
	mutator(draft);
	return draft;
}

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gentle-pi-release-artifact-"));
}

// --- tree digest (task 1.3) ---------------------------------------------

const KNOWN_VECTOR_ENTRIES: ArtifactEntry[] = [
	// Declared out of sorted order on purpose: "z/file.txt" sorts after
	// "a/file.txt", so treeDigest must sort internally to reach the
	// expected hash regardless of input order (mirrors the provider's
	// internal/releaseartifact/tree_test.go known vector byte-for-byte).
	{ path: "z/file.txt", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: 10, digest: `sha256:${"a".repeat(64)}` },
	{ path: "a/file.txt", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: 5, digest: `sha256:${"b".repeat(64)}` },
];
const KNOWN_VECTOR_DIGEST = "sha256:971ca2d598a9f6e517c00eee9581f40376f9fef61b8a905c310a2a8d71140844";

test("treeDigest matches the provider's known-vector preimage", () => {
	assert.equal(treeDigest(KNOWN_VECTOR_ENTRIES), KNOWN_VECTOR_DIGEST);
});

test("treeDigest is input-order independent", () => {
	const reversed = [KNOWN_VECTOR_ENTRIES[1], KNOWN_VECTOR_ENTRIES[0]];
	assert.equal(treeDigest(reversed), KNOWN_VECTOR_DIGEST);
});

test("treeDigest does not mutate the caller's array", () => {
	const entries = [...KNOWN_VECTOR_ENTRIES];
	const before = structuredClone(entries);
	treeDigest(entries);
	assert.deepEqual(entries, before);
});

test("treeDigest over the real provider fixture's entries reproduces its declared digest (manifest excluded)", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const entries = (fixture.entries as ArtifactEntry[]).map((entry) => ({ ...entry }));
	assert.equal(treeDigest(entries), (fixture.tree as { digest: string }).digest);
});

// --- decoder (task 1.2) --------------------------------------------------

test("decodeArtifactManifest accepts the provider's valid fixture and returns a camelCased manifest", async () => {
	const bytes = await readFixtureBytes("artifact-manifest.fixture.json");
	const manifest = decodeArtifactManifest(bytes);
	assert.equal(manifest.contract.id, "gentle-ai.release-artifact");
	assert.equal(manifest.contract.major, SUPPORTED_CONTRACT_MAJOR);
	assert.equal(manifest.contract.schemaId, "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json");
	assert.equal(manifest.contract.schemaPath, "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json");
	assert.equal(manifest.tree.manifestIncluded, false);
	assert.equal(manifest.entries.length, 2);
	assert.equal(manifest.compatibility.unknownMandatory, "reject");
});

test("decodeArtifactManifest rejects an unsupported contract major before any layout is inferred, naming the major", async () => {
	const bytes = await readFixtureBytes("artifact-manifest-unsupported-major.fixture.json");
	assert.throws(
		() => decodeArtifactManifest(bytes),
		(error: unknown) => error instanceof UnsupportedReleaseArtifactMajorError
			&& error.major === 2
			&& /\b2\b/.test(error.message),
	);
});

test("decodeArtifactManifest rejects an unknown top-level key", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		(draft as Record<string, unknown>).unknown = true;
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		ReleaseArtifactManifestError,
	);
});

test("decodeArtifactManifest rejects an unknown key nested inside contract", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		(draft as any).contract.unknown = "x";
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		ReleaseArtifactManifestError,
	);
});

test("decodeArtifactManifest rejects tree.manifest_included: true", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		(draft as any).tree.manifest_included = true;
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		/manifest_included/,
	);
});

test("decodeArtifactManifest rejects compatibility.unknown_mandatory when it is not \"reject\"", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		(draft as any).compatibility.unknown_mandatory = "ignore";
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		/unknown_mandatory/,
	);
});

test("decodeArtifactManifest rejects a manifest whose bundled schema entry is missing", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		(draft as any).contract.schema_path = "contracts/release-artifact/v1/schemas/does-not-exist.json";
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		/schema_path/,
	);
});

test("decodeArtifactManifest rejects a non-\"file\" entry type", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		(draft as any).entries[0].type = "directory";
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		/disallowed type/,
	);
});

test("decodeArtifactManifest rejects a non-\"0644\" entry mode", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		(draft as any).entries[0].mode = "0755";
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		/disallowed mode/,
	);
});

test("decodeArtifactManifest rejects a malformed entry digest shape", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	for (const digest of ["not-a-digest", "sha256:tooShort", `sha1:${"a".repeat(64)}`, `sha256:${"A".repeat(64)}`]) {
		const tampered = mutate(fixture, (draft) => {
			(draft as any).entries[0].digest = digest;
		});
		assert.throws(
			() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
			/malformed digest/,
			`digest ${digest} should have been rejected`,
		);
	}
});

test("decodeArtifactManifest rejects an entry path that is absolute, traversal, or backslash-separated", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	for (const path of ["/etc/passwd", "../escape/x.json", "a\\b\\x.json", "a/../b/x.json"]) {
		const tampered = mutate(fixture, (draft) => {
			(draft as any).entries[0].path = path;
		});
		assert.throws(
			() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
			ReleaseArtifactManifestError,
			`path ${path} should have been rejected`,
		);
	}
});

test("decodeArtifactManifest rejects an entry path containing a NUL byte or an over-length path", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const withNul = mutate(fixture, (draft) => {
		(draft as any).entries[0].path = `a/b${String.fromCharCode(0)}c.json`;
	});
	assert.throws(() => decodeArtifactManifest(Buffer.from(JSON.stringify(withNul))), /control byte/);

	const overLong = mutate(fixture, (draft) => {
		(draft as any).entries[0].path = `${"a".repeat(1025)}.json`;
	});
	assert.throws(() => decodeArtifactManifest(Buffer.from(JSON.stringify(overLong))), /exceeds/);
});

test("decodeArtifactManifest rejects a duplicate entry path", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		const entries = (draft as any).entries;
		entries.push({ ...entries[0] });
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		/duplicate path/,
	);
});

test("decodeArtifactManifest rejects entries that are not in ascending raw-byte path order", async () => {
	const fixture = await readJsonFixture("artifact-manifest.fixture.json");
	const tampered = mutate(fixture, (draft) => {
		const entries = (draft as any).entries;
		entries.reverse();
	});
	assert.throws(
		() => decodeArtifactManifest(Buffer.from(JSON.stringify(tampered))),
		/ascending/,
	);
});

test("decodeArtifactManifest rejects malformed JSON", () => {
	assert.throws(() => decodeArtifactManifest(Buffer.from("{ not json")), ReleaseArtifactManifestError);
});

// --- bundled schema identity/digest ($id mismatch, task 1.2) ------------

function buildSyntheticManifest(schemaBytes: Buffer): Record<string, unknown> {
	const schemaDigest = `sha256:${createHash("sha256").update(schemaBytes).digest("hex")}`;
	const otherBytes = Buffer.from("synthetic-snapshot-bytes");
	const entries = [
		{
			path: "capabilities/review-integration-v2.semantic.json",
			type: "file",
			mode: "0644",
			size: otherBytes.length,
			digest: `sha256:${createHash("sha256").update(otherBytes).digest("hex")}`,
		},
		{
			path: "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json",
			type: "file",
			mode: "0644",
			size: schemaBytes.length,
			digest: schemaDigest,
		},
	];
	const digest = treeDigest(entries as ArtifactEntry[]);
	return {
		schema: "gentle-ai.release-artifact-manifest/v1",
		contract: {
			id: "gentle-ai.release-artifact",
			major: 1,
			minor: 0,
			schema_id: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json",
			schema_path: "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json",
		},
		release: { repository: "Gentleman-Programming/gentle-ai", tag: "v2.3.0", version: "2.3.0", commit: "0".repeat(40) },
		layout: { version: 1 },
		archive: { asset: "gentle-ai_2.3.0_assets.tar.gz", digest_source: "signed-checksums.txt" },
		references: {
			semantic_snapshots: [{ contract: "gentle-ai.review-integration/v2", path: "capabilities/review-integration-v2.semantic.json", schema: "gentle-ai.release-semantic-capabilities/v1" }],
			contracts: [{ id: "gentle-ai.review-integration/v2", root: "contracts/review-integration/v2" }],
		},
		tree: { algorithm: "sha256", canonicalization: RELEASE_ARTIFACT_TREE_CANONICALIZATION, manifest_included: false, digest },
		compatibility: { minimum_contract_major: 1, maximum_contract_major: 1, additive_minor_policy: "optional-fields-only", unknown_mandatory: "reject", unknown_optional: "ignore" },
		entries,
	};
}

test("assertBundledSchemaMatches accepts schema bytes whose digest and $id both match the manifest", () => {
	const schemaBytes = Buffer.from(JSON.stringify({ $id: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json", type: "object" }));
	const manifest = decodeArtifactManifest(Buffer.from(JSON.stringify(buildSyntheticManifest(schemaBytes))));
	assert.doesNotThrow(() => assertBundledSchemaMatches(manifest, schemaBytes));
});

test("assertBundledSchemaMatches rejects a bundled schema whose $id does not match contract.schema_id", () => {
	const schemaBytes = Buffer.from(JSON.stringify({ $id: "https://wrong.example/schema.json", type: "object" }));
	const manifest = decodeArtifactManifest(Buffer.from(JSON.stringify(buildSyntheticManifest(schemaBytes))));
	assert.throws(() => assertBundledSchemaMatches(manifest, schemaBytes), /\$id/);
});

test("assertBundledSchemaMatches rejects bundled schema bytes whose digest disagrees with the manifest entry", () => {
	const schemaBytes = Buffer.from(JSON.stringify({ $id: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json" }));
	const manifest = decodeArtifactManifest(Buffer.from(JSON.stringify(buildSyntheticManifest(schemaBytes))));
	const tamperedBytes = Buffer.from(`${schemaBytes.toString("utf8")} `);
	assert.throws(() => assertBundledSchemaMatches(manifest, tamperedBytes), /digest/);
});

// --- bootstrap archive evidence (task 1.5) --------------------------------

test("resolveBootstrapArtifactSource requires an explicit non-empty path and is never auto-discovered", () => {
	assert.throws(() => resolveBootstrapArtifactSource(undefined), /explicitly/);
	assert.throws(() => resolveBootstrapArtifactSource(""), /explicitly/);
});

test("resolveBootstrapArtifactSource records signature_status not-applicable/local-unsigned and evidence class development/bootstrap", () => {
	const source = resolveBootstrapArtifactSource("/tmp/local-archive.tar.gz");
	assert.equal(source.archivePath, "/tmp/local-archive.tar.gz");
	assert.equal(source.evidenceClass, RELEASE_ARTIFACT_EVIDENCE_CLASS.BOOTSTRAP);
	assert.equal(source.signatureStatus, "not-applicable/local-unsigned");
});

test("assertReleaseAcceptanceEvidence bars bootstrap evidence from pin/final-acceptance evidence", () => {
	const source = resolveBootstrapArtifactSource("/tmp/local-archive.tar.gz");
	assert.throws(() => assertReleaseAcceptanceEvidence(source), /cannot serve as pin or final-acceptance evidence/);
	assert.doesNotThrow(() => assertReleaseAcceptanceEvidence({ evidenceClass: RELEASE_ARTIFACT_EVIDENCE_CLASS.RELEASE }));
});

// --- bounded extraction: caps (task 1.4) ----------------------------------

const TINY_LIMITS = { maxEntries: 2, maxFileBytes: 100, maxTotalBytes: 150 };

function regularMember(path: string, size: number): ArchiveMember {
	return { path, size, typeChar: "-" };
}

test("enforceExtractionCaps accepts a listing within every cap", () => {
	assert.doesNotThrow(() => enforceExtractionCaps([regularMember("a", 10), regularMember("b", 10)], TINY_LIMITS));
});

test("enforceExtractionCaps rejects a listing exceeding MAX_ASSET_ENTRIES", () => {
	const members = [regularMember("a", 1), regularMember("b", 1), regularMember("c", 1)];
	assert.throws(() => enforceExtractionCaps(members, TINY_LIMITS), /member cap|entries/);
});

test("enforceExtractionCaps rejects a single member exceeding MAX_ASSET_FILE_BYTES", () => {
	assert.throws(() => enforceExtractionCaps([regularMember("a", 999)], TINY_LIMITS), /byte per-file cap|MAX_ASSET_FILE_BYTES/);
});

test("enforceExtractionCaps rejects a listing whose summed size exceeds MAX_ASSETS_UNPACKED_BYTES", () => {
	assert.throws(() => enforceExtractionCaps([regularMember("a", 90), regularMember("b", 90)], TINY_LIMITS), /total unpacked cap|MAX_ASSETS_UNPACKED_BYTES/);
});

test("enforceExtractionCaps rejects symlink, hardlink, device, and directory members", () => {
	for (const typeChar of ["l", "h", "c", "b", "p", "d"]) {
		assert.throws(
			() => enforceExtractionCaps([{ path: "x", size: 1, typeChar }], TINY_LIMITS),
			/disallowed type|regular files/,
			`typeChar ${typeChar} should have been rejected`,
		);
	}
});

// --- bounded extraction: exact path-set equality (task 1.4, design D2 stage 3) --

const MANIFEST_ENTRIES: ArtifactEntry[] = [
	{ path: "capabilities/x.json", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: 7, digest: `sha256:${"1".repeat(64)}` },
	{ path: "contracts/y.json", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: 11, digest: `sha256:${"2".repeat(64)}` },
];

function exactMembers(): ArchiveMember[] {
	return [
		regularMember(RELEASE_ARTIFACT_MANIFEST_FILE_NAME, 14),
		regularMember("capabilities/x.json", 7),
		regularMember("contracts/y.json", 11),
	];
}

test("assertExactMemberSet accepts an archive whose members exactly match manifest entries plus the manifest file", () => {
	assert.doesNotThrow(() => assertExactMemberSet(exactMembers(), RELEASE_ARTIFACT_MANIFEST_FILE_NAME, MANIFEST_ENTRIES));
});

test("assertExactMemberSet rejects an extra archive member the manifest never declared (added-file attack)", () => {
	// This is the load-bearing security property from design D2/spec "Exact
	// path-set equality must precede digesting": a tree digest computed only
	// over "the files we found" would happily match even if one extra file
	// snuck in, because nothing in a per-file digest walk ever looks at what
	// is NOT declared. assertExactMemberSet is what actually catches it, by
	// asserting the member set is exactly {manifest} U entries[] before any
	// digest is ever computed.
	const membersWithExtra = [...exactMembers(), regularMember("capabilities/evil.json", 3)];
	assert.throws(
		() => assertExactMemberSet(membersWithExtra, RELEASE_ARTIFACT_MANIFEST_FILE_NAME, MANIFEST_ENTRIES),
		/unlisted member|unexpected member/,
	);
});

test("assertExactMemberSet rejects a missing manifest-declared member", () => {
	const membersMissingOne = exactMembers().filter((member) => member.path !== "contracts/y.json");
	assert.throws(
		() => assertExactMemberSet(membersMissingOne, RELEASE_ARTIFACT_MANIFEST_FILE_NAME, MANIFEST_ENTRIES),
		/missing/,
	);
});

test("assertExactMemberSet rejects a duplicate member path", () => {
	const membersWithDuplicate = [...exactMembers(), regularMember("capabilities/x.json", 7)];
	assert.throws(
		() => assertExactMemberSet(membersWithDuplicate, RELEASE_ARTIFACT_MANIFEST_FILE_NAME, MANIFEST_ENTRIES),
		/duplicate member/,
	);
});

test("assertExactMemberSet rejects a listed member size that disagrees with entries[].size", () => {
	const membersWithWrongSize = exactMembers().map((member) => (member.path === "capabilities/x.json" ? { ...member, size: 999 } : member));
	assert.throws(
		() => assertExactMemberSet(membersWithWrongSize, RELEASE_ARTIFACT_MANIFEST_FILE_NAME, MANIFEST_ENTRIES),
		/size .* disagrees/,
	);
});

// --- bounded extraction orchestration (task 1.4/1.6, design D2 full pipeline) --

function fakeExtractor(members: ArchiveMember[], fileBytes: Map<string, Buffer>) {
	const calls: string[] = [];
	return {
		calls,
		async listMembers(): Promise<ArchiveMember[]> {
			calls.push("list");
			return members;
		},
		async extractMember(_archivePath: string, memberPath: string, destinationDir: string): Promise<void> {
			calls.push(`extractMember:${memberPath}`);
			const bytes = fileBytes.get(memberPath);
			if (!bytes) throw new Error(`fake extractor has no bytes for ${memberPath}`);
			const target = join(destinationDir, memberPath);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, bytes, { mode: 0o644 });
		},
		async extractAll(_archivePath: string, destinationDir: string): Promise<void> {
			calls.push("extractAll");
			for (const [path, bytes] of fileBytes) {
				const target = join(destinationDir, path);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, bytes, { mode: 0o644 });
			}
		},
	};
}

function digestOf(bytes: Buffer): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function syntheticFixture() {
	const fileA = Buffer.from("hello-a");
	const fileB = Buffer.from("hello-bb-content");
	const entries: ArtifactEntry[] = [
		{ path: "capabilities/x.json", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: fileA.length, digest: digestOf(fileA) },
		{ path: "contracts/y.json", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: fileB.length, digest: digestOf(fileB) },
	];
	const manifestObject = buildSyntheticManifest(Buffer.from("placeholder"));
	(manifestObject as any).entries = entries;
	(manifestObject as any).tree.digest = treeDigest(entries);
	(manifestObject as any).contract.schema_path = "capabilities/x.json";
	(manifestObject as any).references.semantic_snapshots[0].path = "contracts/y.json";
	const manifestBytes = Buffer.from(JSON.stringify(manifestObject));
	const fileBytes = new Map([
		["capabilities/x.json", fileA],
		["contracts/y.json", fileB],
	]);
	const members = [
		regularMember(RELEASE_ARTIFACT_MANIFEST_FILE_NAME, manifestBytes.length),
		regularMember("capabilities/x.json", fileA.length),
		regularMember("contracts/y.json", fileB.length),
	];
	fileBytes.set(RELEASE_ARTIFACT_MANIFEST_FILE_NAME, manifestBytes);
	return { entries, manifestBytes, fileBytes, members };
}

test("extractReleaseArtifact writes zero bytes when the listing exceeds bound caps (stage 0 before any write)", async () => {
	const { members, fileBytes } = await syntheticFixture();
	const oversizedMembers = [...members, regularMember("capabilities/extra-1.json", 1), regularMember("capabilities/extra-2.json", 1)];
	const extractor = fakeExtractor(oversizedMembers, fileBytes);
	const destination = await tempWorkspace();
	try {
		await assert.rejects(
			() => extractReleaseArtifact("archive.tar.gz", destination, { extractor, limits: { ...DEFAULT_EXTRACTION_LIMITS, maxEntries: 3 } }),
			ReleaseArtifactExtractionError,
		);
		assert.deepEqual(extractor.calls, ["list"], "no extraction call may happen once stage 0 caps reject the listing");
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

test("extractReleaseArtifact rejects an added file before full extraction, even though the manifest member alone must still be read to decode it", async () => {
	const { members, fileBytes } = await syntheticFixture();
	const withExtraMember = [...members, regularMember("capabilities/evil.json", 3)];
	fileBytes.set("capabilities/evil.json", Buffer.from("evi"));
	const extractor = fakeExtractor(withExtraMember, fileBytes);
	const destination = await tempWorkspace();
	try {
		await assert.rejects(
			() => extractReleaseArtifact("archive.tar.gz", destination, { extractor }),
			/unlisted member|unexpected member/,
		);
		assert.deepEqual(
			extractor.calls,
			["list", `extractMember:${RELEASE_ARTIFACT_MANIFEST_FILE_NAME}`],
			"stage 4 (extractAll) must never run once stage 3's exact-set check rejects an added file",
		);
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

test("extractReleaseArtifact succeeds end-to-end, extracts every entry, and returns the decoded manifest", async () => {
	const { manifestBytes, fileBytes, members } = await syntheticFixture();
	const extractor = fakeExtractor(members, fileBytes);
	const destination = await tempWorkspace();
	try {
		const result = await extractReleaseArtifact("archive.tar.gz", destination, { extractor });
		assert.equal(result.destinationDir, destination);
		assert.equal(result.manifest.entries.length, 2);
		assert.equal(
			await readFile(join(destination, "capabilities/x.json"), "utf8"),
			fileBytes.get("capabilities/x.json")?.toString("utf8"),
		);
		assert.deepEqual(extractor.calls, ["list", `extractMember:${RELEASE_ARTIFACT_MANIFEST_FILE_NAME}`, "extractAll"]);
		assert.ok(manifestBytes.length > 0);
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

test("extractReleaseArtifact fails closed on a symlinked extracted entry", async () => {
	const { members, fileBytes } = await syntheticFixture();
	const target = fileBytes.get("capabilities/x.json") as Buffer;
	const extractor = fakeExtractor(members, fileBytes);
	const destination = await tempWorkspace();
	try {
		const symlinkExtractor = {
			...extractor,
			async extractAll(archivePath: string, destinationDir: string): Promise<void> {
				await extractor.extractAll(archivePath, destinationDir);
				const linkPath = join(destinationDir, "capabilities/x.json");
				await rm(linkPath, { force: true });
				const realFile = join(destinationDir, "real-target.json");
				await writeFile(realFile, target);
				await symlink(realFile, linkPath);
			},
		};
		await assert.rejects(
			() => extractReleaseArtifact("archive.tar.gz", destination, { extractor: symlinkExtractor }),
			/non-symlink|symlink/,
		);
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

test("extractReleaseArtifact fails closed when an extracted file's digest disagrees with the manifest", async () => {
	const { members, fileBytes } = await syntheticFixture();
	const extractor = fakeExtractor(members, fileBytes);
	const destination = await tempWorkspace();
	try {
		const tamperingExtractor = {
			...extractor,
			async extractAll(archivePath: string, destinationDir: string): Promise<void> {
				await extractor.extractAll(archivePath, destinationDir);
				// Same byte length as the original ("hello-a") so this isolates the
				// digest-mismatch path from the (already separately tested) size
				// disagreement path.
				await writeFile(join(destinationDir, "capabilities/x.json"), "wr0ng-a", { mode: 0o644 });
			},
		};
		await assert.rejects(
			() => extractReleaseArtifact("archive.tar.gz", destination, { extractor: tamperingExtractor }),
			/digest/,
		);
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

test("extractReleaseArtifact fails closed on an executable extracted file", async () => {
	const { members, fileBytes } = await syntheticFixture();
	const extractor = fakeExtractor(members, fileBytes);
	const destination = await tempWorkspace();
	try {
		const executableExtractor = {
			...extractor,
			async extractAll(archivePath: string, destinationDir: string): Promise<void> {
				await extractor.extractAll(archivePath, destinationDir);
				await chmod(join(destinationDir, "capabilities/x.json"), 0o755);
			},
		};
		await assert.rejects(
			() => extractReleaseArtifact("archive.tar.gz", destination, { extractor: executableExtractor }),
			/executable/,
		);
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

// --- production system-tar wiring (real archive, real GNU tar) -----------

test("createSystemReleaseArtifactExtractor lists and extracts a real archive, and the added-file case is still caught end-to-end", async () => {
	const sourceDir = await tempWorkspace();
	const destination = await tempWorkspace();
	const archivePath = join(sourceDir, "..", "release-artifact-real.tar.gz");
	try {
		const fileA = Buffer.from("hello-a");
		const fileB = Buffer.from("hello-bb-content");
		const entries: ArtifactEntry[] = [
			{ path: "capabilities/x.json", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: fileA.length, digest: digestOf(fileA) },
			{ path: "contracts/y.json", type: ENTRY_TYPE.FILE, mode: ENTRY_MODE, size: fileB.length, digest: digestOf(fileB) },
		];
		const manifestObject = buildSyntheticManifest(Buffer.from("placeholder"));
		(manifestObject as any).entries = entries;
		(manifestObject as any).tree.digest = treeDigest(entries);
		(manifestObject as any).contract.schema_path = "capabilities/x.json";
		(manifestObject as any).references.semantic_snapshots[0].path = "contracts/y.json";
		const manifestBytes = Buffer.from(JSON.stringify(manifestObject));

		await mkdir(join(sourceDir, "capabilities"), { recursive: true });
		await mkdir(join(sourceDir, "contracts"), { recursive: true });
		await writeFile(join(sourceDir, RELEASE_ARTIFACT_MANIFEST_FILE_NAME), manifestBytes);
		await writeFile(join(sourceDir, "capabilities/x.json"), fileA);
		await writeFile(join(sourceDir, "contracts/y.json"), fileB);

		await execFileAsync("tar", ["-czf", archivePath, "-C", sourceDir, RELEASE_ARTIFACT_MANIFEST_FILE_NAME, "capabilities/x.json", "contracts/y.json"]);

		const extractor = createSystemReleaseArtifactExtractor();
		const result = await extractReleaseArtifact(archivePath, destination, { extractor });
		assert.equal(result.manifest.entries.length, 2);
		assert.equal(await readFile(join(destination, "capabilities/x.json"), "utf8"), fileA.toString("utf8"));

		// Now build a SECOND real archive with one extra, entirely valid-looking
		// file the manifest never declared, and prove the real system-tar
		// listing path still rejects it via the exact-set check — not merely
		// the in-memory fake used above.
		await writeFile(join(sourceDir, "capabilities/evil.json"), "evil");
		const archiveWithExtraPath = join(sourceDir, "..", "release-artifact-real-extra.tar.gz");
		await execFileAsync("tar", ["-czf", archiveWithExtraPath, "-C", sourceDir, RELEASE_ARTIFACT_MANIFEST_FILE_NAME, "capabilities/x.json", "capabilities/evil.json", "contracts/y.json"]);
		const destinationTwo = await tempWorkspace();
		try {
			await assert.rejects(
				() => extractReleaseArtifact(archiveWithExtraPath, destinationTwo, { extractor: createSystemReleaseArtifactExtractor() }),
				/unlisted member|unexpected member/,
			);
		} finally {
			await rm(destinationTwo, { recursive: true, force: true });
		}
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
		await rm(destination, { recursive: true, force: true });
		await rm(archivePath, { force: true });
		await rm(join(sourceDir, "..", "release-artifact-real-extra.tar.gz"), { force: true });
	}
});
