import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	assertMandatoryFeaturesSupported,
	deriveCapabilityRow,
	findPreviousHistoricalRow,
	monotoneFloor,
	parseRequiredFloorModule,
	renderGeneratedFloorModule,
	OPERATION_COLUMN_MAP,
} from "../scripts/build-gentle-ai-baselines.mjs";

const root = new URL("..", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// 5.1 -- --write may ADD a required name to the generated floor.
// ---------------------------------------------------------------------------

test("monotoneFloor accepts a snapshot that adds a new required name", () => {
	const next = monotoneFloor(["review.start", "review.finalize"], ["review.start", "review.finalize", "review.validate"], "REQUIRED_OPERATIONS");
	assert.deepEqual(next, ["review.finalize", "review.start", "review.validate"]);
});

// ---------------------------------------------------------------------------
// 5.2 -- a name disappearing from the snapshot's required block fails naming it.
// ---------------------------------------------------------------------------

test("monotoneFloor rejects a snapshot that drops a previously required name", () => {
	assert.throws(
		() => monotoneFloor(["review.start", "review.finalize", "review.validate"], ["review.start", "review.finalize"], "REQUIRED_OPERATIONS"),
		/REQUIRED_OPERATIONS: review\.validate disappeared from the snapshot's required block/,
	);
});

test("monotoneFloor names every disappeared entry, not only the first", () => {
	assert.throws(
		() => monotoneFloor(["a", "b", "c"], ["b"], "REQUIRED_GATES"),
		/REQUIRED_GATES: a, c disappeared/,
	);
});

// ---------------------------------------------------------------------------
// 5.3 -- an advertised mandatory feature absent from Pi's set fails naming it.
// ---------------------------------------------------------------------------

test("assertMandatoryFeaturesSupported passes when every advertised mandatory name is supported", () => {
	assert.doesNotThrow(() => assertMandatoryFeaturesSupported(["compact_v2_authority", "immutable_snapshot"], ["compact_v2_authority", "immutable_snapshot", "target_scoped_status"]));
});

test("assertMandatoryFeaturesSupported fails naming an advertised mandatory feature Pi does not support, never auto-adding it", () => {
	assert.throws(
		() => assertMandatoryFeaturesSupported(["compact_v2_authority", "brand_new_mandatory_feature"], ["compact_v2_authority"]),
		/mandatory feature\(s\) with no gentle-pi client support: brand_new_mandatory_feature/,
	);
});

// ---------------------------------------------------------------------------
// 5.4 -- unmapped operation stops generation with the exact actionable message.
// ---------------------------------------------------------------------------

test("deriveCapabilityRow fails with the exact unmapped-operation message when a snapshot operation has no client mapping", () => {
	assert.throws(
		() =>
			deriveCapabilityRow({
				version: "9.9.9",
				advertisedOperations: ["review.start", "review.frobnicate"],
				envelopeFlags: { mode: true, riskEvidence: false, hint: false, delivery: true },
				previousRow: { sddStatus: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true },
			}),
		/^Error: gentle-ai 9\.9\.9 advertises operation "review\.frobnicate" with no NativeCliCapability column\. Add the column and its decoder in lib\/native-review-cli\.ts, then re-run --write\.$/,
	);
});

test("deriveCapabilityRow accepts operations explicitly mapped to null without treating them as capability-true", () => {
	const row = deriveCapabilityRow({
		version: "9.9.9",
		advertisedOperations: ["review.start", "review.capabilities", "review.repair"],
		envelopeFlags: { mode: true, riskEvidence: false, hint: false, delivery: true },
		previousRow: { sddStatus: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true },
	});
	assert.equal(row.start, true);
	assert.equal(row.finalize, false);
	assert.equal(Object.keys(OPERATION_COLUMN_MAP).includes("review.capabilities"), true);
});

// ---------------------------------------------------------------------------
// 5.5 -- pinned version missing envelopeFlags fails generation.
// ---------------------------------------------------------------------------

test("deriveCapabilityRow fails naming the version when envelopeFlags is missing from native-cli-history.json", () => {
	assert.throws(
		() =>
			deriveCapabilityRow({
				version: "9.9.9",
				advertisedOperations: ["review.start"],
				envelopeFlags: undefined,
				previousRow: { sddStatus: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true },
			}),
		/gentle-ai 9\.9\.9 has no envelopeFlags entry in capabilities\/native-cli-history\.json/,
	);
});

test("deriveCapabilityRow fails when an envelopeFlags column is not a boolean", () => {
	assert.throws(
		() =>
			deriveCapabilityRow({
				version: "9.9.9",
				advertisedOperations: ["review.start"],
				envelopeFlags: { mode: true, riskEvidence: false, hint: false, delivery: "yes" },
				previousRow: { sddStatus: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true },
			}),
		/envelopeFlags\.delivery in capabilities\/native-cli-history\.json must be a boolean/,
	);
});

// ---------------------------------------------------------------------------
// Carry-forward columns and disagreement cross-check.
// ---------------------------------------------------------------------------

test("deriveCapabilityRow carries legacy CLI columns forward from the previous frozen row", () => {
	const row = deriveCapabilityRow({
		version: "9.9.9",
		advertisedOperations: ["review.start", "review.finalize", "review.validate", "review.bind_sdd", "review.status"],
		envelopeFlags: { mode: true, riskEvidence: false, hint: false, delivery: true },
		previousRow: { sddStatus: true, inventory: true, reclaim: true, recover: false, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: false },
	});
	assert.equal(row.recover, false);
	assert.equal(row.repairLegacyAlias, false);
	assert.equal(row.sddStatus, true);
});

test("deriveCapabilityRow fails when a carry-forward column has no prior frozen row to carry from", () => {
	assert.throws(
		() =>
			deriveCapabilityRow({
				version: "9.9.9",
				advertisedOperations: ["review.start"],
				envelopeFlags: { mode: true, riskEvidence: false, hint: false, delivery: true },
				previousRow: undefined,
			}),
		/gentle-ai 9\.9\.9 has no prior frozen row to carry column "sddStatus" forward from/,
	);
});

test("deriveCapabilityRow fails when the freshly derived row disagrees with its known historical record", () => {
	assert.throws(
		() =>
			deriveCapabilityRow({
				version: "9.9.9",
				advertisedOperations: ["review.start"],
				envelopeFlags: { mode: true, riskEvidence: false, hint: false, delivery: true },
				previousRow: { sddStatus: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true },
				knownRow: { start: false, finalize: false, validate: false, bindSdd: false, sddStatus: true, status: false, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true },
			}),
		/freshly derived row disagrees with its capabilities\/native-cli-history\.json record on: start/,
	);
});

// ---------------------------------------------------------------------------
// findPreviousHistoricalRow
// ---------------------------------------------------------------------------

test("findPreviousHistoricalRow returns the entry immediately preceding an already-recorded pinned version", () => {
	const versions = [
		{ version: "1.0.0", capabilities: { a: true } },
		{ version: "1.0.1", capabilities: { a: false } },
	];
	assert.deepEqual(findPreviousHistoricalRow(versions, "1.0.1"), { a: true });
});

test("findPreviousHistoricalRow returns the last entry when the pinned version is not yet recorded", () => {
	const versions = [
		{ version: "1.0.0", capabilities: { a: true } },
		{ version: "1.0.1", capabilities: { a: false } },
	];
	assert.deepEqual(findPreviousHistoricalRow(versions, "1.0.2"), { a: false });
});

// ---------------------------------------------------------------------------
// renderGeneratedFloorModule / parseRequiredFloorModule round trip.
// ---------------------------------------------------------------------------

test("renderGeneratedFloorModule output round-trips through parseRequiredFloorModule", () => {
	const source = renderGeneratedFloorModule({
		requiredOperations: ["review.start", "review.finalize"],
		requiredGates: ["post-apply"],
		requiredProjections: ["staged"],
		historicalRows: [{ version: "1.0.0", row: { start: true }, notes: ["a historical note"] }],
		currentVersion: "1.0.1",
		currentRow: { start: true },
		currentNotes: ["a current note"],
	});
	assert.match(source, /^\/\/ Generated by scripts\/build-gentle-ai-baselines\.mjs\. Do not edit\.$/m);
	assert.match(source, /a historical note/);
	assert.match(source, /a current note/);
	assert.doesNotMatch(source, /[ \t]+\n/);
	const parsed = parseRequiredFloorModule(source);
	assert.deepEqual(parsed.requiredOperations, ["review.start", "review.finalize"]);
	assert.deepEqual(parsed.requiredGates, ["post-apply"]);
	assert.deepEqual(parsed.requiredProjections, ["staged"]);
});

test("parseRequiredFloorModule returns empty arrays for a nonexistent previous generation (bootstrap case)", () => {
	const parsed = parseRequiredFloorModule("// nothing generated yet\n");
	assert.deepEqual(parsed, { requiredOperations: [], requiredGates: [], requiredProjections: [] });
});

// ---------------------------------------------------------------------------
// End-to-end CLI: real repository data, real subprocess.
// ---------------------------------------------------------------------------

test("build-gentle-ai-baselines.mjs --check passes against the real checked-in repository", () => {
	const output = execFileSync(process.execPath, [join(root, "scripts/build-gentle-ai-baselines.mjs"), "--check"], { cwd: root, encoding: "utf8" });
	assert.match(output, /gentle-ai baselines match their checked-in sources/);
});

test("build-gentle-ai-baselines.mjs --write regenerates byte-identical output against the real repository (idempotent)", () => {
	const generatedPath = join(root, "lib/gentle-ai-required-floor.generated.ts");
	const before = readFileSync(generatedPath, "utf8");
	execFileSync(process.execPath, [join(root, "scripts/build-gentle-ai-baselines.mjs"), "--write"], { cwd: root, encoding: "utf8" });
	const after = readFileSync(generatedPath, "utf8");
	assert.equal(after, before);
});

test("build-gentle-ai-baselines.mjs --write fails naming a required entry that disappeared from a shrunk snapshot", () => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "gentle-pi-baselines-"));
	try {
		copyRepoInto(fixtureRoot);
		const snapshotPath = join(fixtureRoot, "capabilities/review-integration-v2.semantic.json");
		const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
		snapshot.operations = snapshot.operations.filter((operation: string) => operation !== "review.repair");
		writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
		assert.throws(
			() => execFileSync(process.execPath, [join(fixtureRoot, "scripts/build-gentle-ai-baselines.mjs"), "--write"], { cwd: fixtureRoot, encoding: "utf8" }),
			/review\.repair disappeared from the snapshot's required block/,
		);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

function copyRepoInto(fixtureRoot: string) {
	mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
	mkdirSync(join(fixtureRoot, "capabilities"), { recursive: true });
	mkdirSync(join(fixtureRoot, "lib"), { recursive: true });
	writeFileSync(join(fixtureRoot, "scripts/build-gentle-ai-baselines.mjs"), readFileSync(join(root, "scripts/build-gentle-ai-baselines.mjs")));
	writeFileSync(join(fixtureRoot, "capabilities/review-integration-v2.semantic.json"), readFileSync(join(root, "capabilities/review-integration-v2.semantic.json")));
	writeFileSync(join(fixtureRoot, "capabilities/native-cli-history.json"), readFileSync(join(root, "capabilities/native-cli-history.json")));
	writeFileSync(join(fixtureRoot, "capabilities/gentle-ai-release.lock.json"), readFileSync(join(root, "capabilities/gentle-ai-release.lock.json")));
	writeFileSync(join(fixtureRoot, "lib/gentle-ai-required-floor.generated.ts"), readFileSync(join(root, "lib/gentle-ai-required-floor.generated.ts")));
}
