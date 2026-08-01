import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	assertLockReleaseVersionPin,
	gentleAiVersionPinMismatches,
	mirrorDigestDrift,
	mirrorDigestsFromLock,
	reconcileContractsOnDisk,
	reconcileGeneratedRuntimeSources,
} from "../scripts/verify-package-files.mjs";
import { INSTALLER_VERSION, RELEASE_BASE_URL, GENTLE_AI_WINDOWS_SOURCE_TAG } from "../scripts/gentle-ai-installer.mjs";
import { GENTLE_AI_VERSION } from "../lib/gentle-ai-binary.ts";

function makeFixtureRoot(): string {
	return mkdtempSync(join(tmpdir(), "gentle-pi-verify-package-files-"));
}

test("contracts/ walk fails on a file that exists on disk but is unlisted in contractHashes", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		const knownRelativePath = "contracts/review-integration/v2/schemas/known.schema.json";
		const unlistedRelativePath = "contracts/review-integration/v2/schemas/unlisted.schema.json";
		mkdirSync(join(fixtureRoot, "contracts/review-integration/v2/schemas"), { recursive: true });
		writeFileSync(join(fixtureRoot, knownRelativePath), "{}\n");
		writeFileSync(join(fixtureRoot, unlistedRelativePath), "{}\n");

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			[knownRelativePath]: "irrelevant-for-this-walk",
		});

		assert.deepEqual(unlistedOnDisk, [unlistedRelativePath]);
		assert.deepEqual(listedButMissing, []);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("contracts/ walk fails on a contractHashes entry that is missing from disk", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		const missingRelativePath = "contracts/review-integration/v2/schemas/missing.schema.json";
		mkdirSync(join(fixtureRoot, "contracts/review-integration/v2/schemas"), { recursive: true });

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			[missingRelativePath]: "irrelevant-for-this-walk",
		});

		assert.deepEqual(unlistedOnDisk, []);
		assert.deepEqual(listedButMissing, [missingRelativePath]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("sources <-> runtime/*.mjs walk fails when a generated runtime file is absent from the generator's sources array", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "runtime"), { recursive: true });
		writeFileSync(join(fixtureRoot, "runtime/known.mjs"), "// generated\n");
		writeFileSync(join(fixtureRoot, "runtime/orphan.mjs"), "// generated\n");

		const { drifted } = reconcileGeneratedRuntimeSources(
			fixtureRoot,
			["known"],
			["runtime/known.mjs", "runtime/orphan.mjs"],
		);

		assert.deepEqual(drifted, [
			{ name: "orphan", inSources: false, inRuntimeDir: true, inRequiredPaths: true },
		]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("sources <-> runtime/*.mjs walk fails when a sources entry is absent from requiredPaths", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "runtime"), { recursive: true });
		writeFileSync(join(fixtureRoot, "runtime/known.mjs"), "// generated\n");
		writeFileSync(join(fixtureRoot, "runtime/unrequired.mjs"), "// generated\n");

		const { drifted } = reconcileGeneratedRuntimeSources(
			fixtureRoot,
			["known", "unrequired"],
			["runtime/known.mjs"],
		);

		assert.deepEqual(drifted, [
			{ name: "unrequired", inSources: true, inRuntimeDir: true, inRequiredPaths: false },
		]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

// Regression test for the documented incident in scripts/install-gentle-ai.mjs:
// the installer once reported installing v2.1.11 while writing v2.2.0 to disk
// because two hardcoded version copies had drifted apart. The textual
// `.includes(...)` grep this replaces could not have caught this, because it
// only verifies a string appears in a file, not that two values agree.
test("Gentle AI version pin mismatch is reported with a specific message when a derived location disagrees with the authoritative constant", () => {
	const mismatches = gentleAiVersionPinMismatches({
		installerVersion: "2.2.3",
		releaseBaseUrl: "https://github.com/Gentleman-Programming/gentle-ai/releases/download/v2.2.3/",
		windowsSourceTag: "v2.2.3",
		libGentleAiVersion: "2.2.0",
	});

	assert.deepEqual(mismatches, [
		'lib/gentle-ai-binary.ts GENTLE_AI_VERSION ("2.2.0") does not match the authoritative scripts/gentle-ai-installer.mjs INSTALLER_VERSION ("2.2.3")',
	]);
});

test("Gentle AI version pin mismatch also flags a drifted release URL and a drifted Windows source tag", () => {
	const mismatches = gentleAiVersionPinMismatches({
		installerVersion: "2.2.3",
		releaseBaseUrl: "https://github.com/Gentleman-Programming/gentle-ai/releases/download/v2.2.0/",
		windowsSourceTag: "v2.1.11",
		libGentleAiVersion: "2.2.3",
	});

	assert.deepEqual(mismatches, [
		'RELEASE_BASE_URL ("https://github.com/Gentleman-Programming/gentle-ai/releases/download/v2.2.0/") does not pin the authoritative v2.2.3',
		'GENTLE_AI_WINDOWS_SOURCE_TAG ("v2.1.11") does not match the authoritative v2.2.3',
	]);
});

test("Gentle AI version pin agrees across the installer version, the release URL, the Windows source tag, and lib/gentle-ai-binary.ts", () => {
	const mismatches = gentleAiVersionPinMismatches({
		installerVersion: INSTALLER_VERSION,
		releaseBaseUrl: RELEASE_BASE_URL,
		windowsSourceTag: GENTLE_AI_WINDOWS_SOURCE_TAG,
		libGentleAiVersion: GENTLE_AI_VERSION,
	});

	assert.deepEqual(mismatches, []);
});

// --- lock-based mirror reconciliation (task 2.5, replaces contractHashes) --

test("mirror walk fails on a file that exists on disk under docs/gentle-ai but is unlisted in the lock", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "docs/gentle-ai"), { recursive: true });
		writeFileSync(join(fixtureRoot, "docs/gentle-ai/review-integration.md"), "known\n");
		writeFileSync(join(fixtureRoot, "docs/gentle-ai/unlisted.md"), "unlisted\n");

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			"docs/gentle-ai/review-integration.md": "irrelevant-for-this-walk",
		});

		assert.deepEqual(unlistedOnDisk, ["docs/gentle-ai/unlisted.md"]);
		assert.deepEqual(listedButMissing, []);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("mirror walk fails on a lock entry with no file on disk under capabilities/, excluding the lock itself and hand-authored files", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "capabilities"), { recursive: true });
		writeFileSync(join(fixtureRoot, "capabilities/gentle-ai-release.lock.json"), "{}\n");
		writeFileSync(join(fixtureRoot, "capabilities/native-cli-history.json"), "[]\n");

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			"capabilities/review-integration-v2.semantic.json": "irrelevant-for-this-walk",
		});

		assert.deepEqual(unlistedOnDisk, []);
		assert.deepEqual(listedButMissing, ["capabilities/review-integration-v2.semantic.json"]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("mirror digest drift names the exact drifted file", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "contracts/release-artifact/v1/schemas"), { recursive: true });
		const path = "contracts/release-artifact/v1/schemas/artifact-manifest.schema.json";
		writeFileSync(join(fixtureRoot, path), "{}\n");
		const actualDigest = `sha256:${createHash("sha256").update(readFileSync(join(fixtureRoot, path))).digest("hex")}`;
		const staleDigest = `sha256:${"0".repeat(64)}`;

		const drift = mirrorDigestDrift(fixtureRoot, { [path]: staleDigest });

		assert.deepEqual(drift, [{ relativePath: path, expected: staleDigest, actual: actualDigest }]);
		assert.deepEqual(mirrorDigestDrift(fixtureRoot, { [path]: actualDigest }), []);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("mirror digests are derived from capabilities/gentle-ai-release.lock.json entries, not a hand-maintained map", () => {
	const lockEntries = [
		{ path: "docs/gentle-ai/review-integration.md", digest: `sha256:${"a".repeat(64)}` },
		{ path: "contracts/x.schema.json", digest: `sha256:${"b".repeat(64)}` },
	];
	assert.deepEqual(mirrorDigestsFromLock({ entries: lockEntries }), {
		"docs/gentle-ai/review-integration.md": `sha256:${"a".repeat(64)}`,
		"contracts/x.schema.json": `sha256:${"b".repeat(64)}`,
	});
});

test("lock release version pin mismatch is reported naming the authoritative INSTALLER_VERSION", () => {
	assert.throws(
		() => assertLockReleaseVersionPin({ release: { version: "9.9.9" } }, INSTALLER_VERSION),
		/gentle-ai-release\.lock\.json/,
	);
	assert.doesNotThrow(() => assertLockReleaseVersionPin({ release: { version: INSTALLER_VERSION } }, INSTALLER_VERSION));
});

test("both walks report no drift when sources, runtime/*.mjs, requiredPaths, and contractHashes fully agree", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "contracts/review-integration/v2/schemas"), { recursive: true });
		mkdirSync(join(fixtureRoot, "runtime"), { recursive: true });
		writeFileSync(
			join(fixtureRoot, "contracts/review-integration/v2/schemas/status.schema.json"),
			"{}\n",
		);
		writeFileSync(join(fixtureRoot, "runtime/known.mjs"), "// generated\n");

		const contractsResult = reconcileContractsOnDisk(fixtureRoot, {
			"contracts/review-integration/v2/schemas/status.schema.json": "irrelevant-for-this-walk",
		});
		const sourcesResult = reconcileGeneratedRuntimeSources(
			fixtureRoot,
			["known"],
			["runtime/known.mjs"],
		);

		assert.deepEqual(contractsResult, { unlistedOnDisk: [], listedButMissing: [] });
		assert.deepEqual(sourcesResult, { drifted: [] });
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});
