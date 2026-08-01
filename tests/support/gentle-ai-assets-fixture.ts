// Shared assets-bundle fixture builder for the gentle-ai binary + installer
// test suites (design D3/D4, task 3.2-3.10). Builds a structurally valid
// `gentle-ai.release-artifact` manifest (the same shape `lib/release-artifact.ts`
// decodes) together with matching real files, so both
// `tests/gentle-ai-installer.test.ts` (staging/publish behavior) and
// `tests/gentle-ai-binary.test.ts` (resolveGentleAiAssets snapshot reads) can
// build a consistent, real on-disk assets tree without re-deriving the
// manifest schema in each file.

import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	ENTRY_MODE,
	ENTRY_TYPE,
	RELEASE_ARTIFACT_MANIFEST_FILE_NAME,
	RELEASE_ARTIFACT_TREE_CANONICALIZATION,
	treeDigest,
	type ArtifactEntry,
} from "../../lib/release-artifact.ts";

export const GENTLE_AI_ASSETS_ARCHIVE_NAME = "gentle-ai_2.2.3_assets.tar.gz";

export interface AssetsFixtureFile {
	path: string;
	bytes: Buffer;
}

export interface AssetsFixture {
	entries: ArtifactEntry[];
	manifestBytes: Buffer;
	files: AssetsFixtureFile[];
	treeDigest: string;
	contractMajor: number;
	layoutVersion: number;
}

// Two entry files by default, mirroring the shape of the real mirrored assets
// (a semantic snapshot json + a schema json) without depending on their real
// byte content.
export function buildAssetsFixture(): AssetsFixture {
	const fileA = Buffer.from("assets fixture file a\n");
	const fileB = Buffer.from("assets fixture file b, slightly longer content\n");
	const entries: ArtifactEntry[] = [
		{
			path: "capabilities/review-integration-v2.semantic.json",
			type: ENTRY_TYPE.FILE,
			mode: ENTRY_MODE,
			size: fileA.length,
			digest: `sha256:${createHash("sha256").update(fileA).digest("hex")}`,
		},
		{
			path: "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json",
			type: ENTRY_TYPE.FILE,
			mode: ENTRY_MODE,
			size: fileB.length,
			digest: `sha256:${createHash("sha256").update(fileB).digest("hex")}`,
		},
	];
	const digest = treeDigest(entries);
	const contractMajor = 1;
	const layoutVersion = 1;
	const manifestObject = {
		schema: "gentle-ai.release-artifact-manifest/v1",
		contract: {
			id: "gentle-ai.release-artifact",
			major: contractMajor,
			minor: 0,
			schema_id: "https://gentle-ai.dev/contracts/release-artifact/v1/schemas/artifact-manifest.schema.json",
			schema_path: "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json",
		},
		release: { repository: "Gentleman-Programming/gentle-ai", tag: "v2.2.3", version: "2.2.3", commit: "0".repeat(40) },
		layout: { version: layoutVersion },
		archive: { asset: GENTLE_AI_ASSETS_ARCHIVE_NAME, digest_source: "signed-checksums.txt" },
		references: {
			semantic_snapshots: [{ contract: "gentle-ai.review-integration/v2", path: "capabilities/review-integration-v2.semantic.json", schema: "gentle-ai.release-semantic-capabilities/v1" }],
			contracts: [{ id: "gentle-ai.review-integration/v1", root: "contracts/release-artifact/v1" }],
		},
		tree: { algorithm: "sha256", canonicalization: RELEASE_ARTIFACT_TREE_CANONICALIZATION, manifest_included: false, digest },
		compatibility: { minimum_contract_major: 1, maximum_contract_major: 1, additive_minor_policy: "optional-fields-only", unknown_mandatory: "reject", unknown_optional: "ignore" },
		entries,
	};
	return {
		entries,
		manifestBytes: Buffer.from(JSON.stringify(manifestObject)),
		files: [
			{ path: entries[0].path, bytes: fileA },
			{ path: entries[1].path, bytes: fileB },
		],
		treeDigest: digest,
		contractMajor,
		layoutVersion,
	};
}

// Writes a fixture's manifest + entry files into an already-extracted assets
// directory shape (mirrors what `extractReleaseArtifact` leaves behind: the
// manifest file plus every entry, each mode 0644 non-executable).
export async function writeAssetsTree(assetsDirectory: string, fixture: AssetsFixture = buildAssetsFixture()): Promise<AssetsFixture> {
	await mkdir(assetsDirectory, { recursive: true });
	await writeFile(join(assetsDirectory, RELEASE_ARTIFACT_MANIFEST_FILE_NAME), fixture.manifestBytes, { mode: 0o644 });
	for (const file of fixture.files) {
		const target = join(assetsDirectory, file.path);
		await mkdir(join(target, ".."), { recursive: true });
		await writeFile(target, file.bytes, { mode: 0o644 });
	}
	return fixture;
}

export async function makeAssetsExecutable(assetsDirectory: string, fixture: AssetsFixture, relativePath: string): Promise<void> {
	await chmod(join(assetsDirectory, relativePath), 0o755);
}

// A pinned-lock-shaped descriptor for the fixture archive, matching the
// `resolveGentleAiAssetsArchive` return shape used by both
// scripts/gentle-ai-installer.mjs and lib/gentle-ai-binary.ts.
export function assetsArchiveDescriptor(fixture: AssetsFixture, archiveSha256: string, url = `https://example.invalid/${GENTLE_AI_ASSETS_ARCHIVE_NAME}`) {
	return Object.freeze({
		name: GENTLE_AI_ASSETS_ARCHIVE_NAME,
		sha256: archiveSha256,
		treeSha256: fixture.treeDigest.replace(/^sha256:/, ""),
		contractMajor: fixture.contractMajor,
		layoutVersion: fixture.layoutVersion,
		url,
	});
}
