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
	phaseCoverageBindings,
	phaseCoverageGate,
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

// --- phase-coverage gate (design D9, task 7.1/7.2) --------------------------
//
// Maintainer decision superseding tasks.md 7.1's "fails" wording for the
// forward direction (recorded in apply-progress.md): a provider-declared
// phase with no Pi binding WARNS, naming the missing phase, and does NOT
// fail CI -- the reverse direction (a Pi binding naming no declared phase,
// not listed Pi-only) still fails, since that is a real inconsistency in
// Pi's own configuration rather than provider release cadence.

test("phase coverage: a provider-declared phase with no Pi binding is reported as missing, not as an unknown binding", () => {
	const { missingBindings, unknownBindings } = phaseCoverageGate(
		{ declaredPhases: ["sdd-apply", "sdd-brand-new-phase"], alias: {}, piOnly: [] },
		{ agentNames: ["sdd-apply"], chainNames: [] },
	);

	assert.deepEqual(missingBindings, ["sdd-brand-new-phase"]);
	assert.deepEqual(unknownBindings, []);
});

test("phase coverage: a Pi agent binding naming no declared phase and not listed Pi-only is an unknown binding", () => {
	const { missingBindings, unknownBindings } = phaseCoverageGate(
		{ declaredPhases: ["sdd-apply"], alias: {}, piOnly: [] },
		{ agentNames: ["sdd-apply", "gentle-ai-rogue"], chainNames: [] },
	);

	assert.deepEqual(missingBindings, []);
	assert.deepEqual(unknownBindings, ["gentle-ai-rogue"]);
});

test("phase coverage: a Pi-only binding names no declared phase but is never reported unknown", () => {
	const { missingBindings, unknownBindings } = phaseCoverageGate(
		{ declaredPhases: ["sdd-apply"], alias: {}, piOnly: ["sdd-status"] },
		{ agentNames: ["sdd-apply", "sdd-status"], chainNames: [] },
	);

	assert.deepEqual(missingBindings, []);
	assert.deepEqual(unknownBindings, []);
});

test("phase coverage: the sdd-proposal <-> sdd-propose alias resolves in both directions", () => {
	const phaseCoverage = { declaredPhases: ["sdd-propose"], alias: { "sdd-proposal": "sdd-propose" }, piOnly: [] };

	assert.deepEqual(
		phaseCoverageGate(phaseCoverage, { agentNames: ["sdd-proposal"], chainNames: [] }),
		{ missingBindings: [], unknownBindings: [] },
	);
});

test("phase coverage: a chain binding satisfies the forward check for a declared phase", () => {
	const { missingBindings } = phaseCoverageGate(
		{ declaredPhases: ["sdd-verify"], alias: {}, piOnly: [] },
		{ agentNames: [], chainNames: ["sdd-verify"] },
	);

	assert.deepEqual(missingBindings, []);
});

test("phase coverage: a chain naming no declared phase is never reported as an unknown binding (reverse check only walks assets/agents/**)", () => {
	const { missingBindings, unknownBindings } = phaseCoverageGate(
		{ declaredPhases: ["sdd-apply"], alias: {}, piOnly: [] },
		{ agentNames: ["sdd-apply"], chainNames: ["4r-review"] },
	);

	assert.deepEqual(missingBindings, []);
	assert.deepEqual(unknownBindings, []);
});

test("phase coverage: skills/issue-creation/SKILL.md is never read or flagged -- the gate only walks assets/agents/** and assets/chains/**", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "assets/agents"), { recursive: true });
		mkdirSync(join(fixtureRoot, "assets/chains"), { recursive: true });
		mkdirSync(join(fixtureRoot, "skills/issue-creation"), { recursive: true });
		writeFileSync(join(fixtureRoot, "assets/agents/sdd-apply.md"), "agent\n");
		writeFileSync(join(fixtureRoot, "assets/chains/sdd-plan.chain.md"), "chain\n");
		writeFileSync(join(fixtureRoot, "skills/issue-creation/SKILL.md"), "repo-identity, not drift\n");

		const bindings = phaseCoverageBindings(fixtureRoot);

		assert.deepEqual(bindings.agentNames, ["sdd-apply"]);
		assert.deepEqual(bindings.chainNames, ["sdd-plan"]);

		const { unknownBindings } = phaseCoverageGate(
			{ declaredPhases: ["sdd-apply"], alias: {}, piOnly: [] },
			bindings,
		);
		assert.deepEqual(unknownBindings, []);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("phase coverage: the real assets/phase-coverage.json fully reconciles against the real assets/agents and assets/chains trees", async () => {
	const PACKAGE_ROOT = join(import.meta.dirname, "..");
	const phaseCoverage = JSON.parse(readFileSync(join(PACKAGE_ROOT, "assets/phase-coverage.json"), "utf8"));
	const bindings = phaseCoverageBindings(PACKAGE_ROOT);

	const { missingBindings, unknownBindings } = phaseCoverageGate(phaseCoverage, bindings);

	assert.deepEqual(missingBindings, []);
	assert.deepEqual(unknownBindings, []);
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
