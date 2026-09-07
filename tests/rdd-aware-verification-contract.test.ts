import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// ---------------------------------------------------------------------------
// gentle-pi#661: pilot of an RDD-aware verification rule for delegated work.
//
// The bounded writer always self-verifies: it runs the parent-authorized
// `## Verification` commands itself and reports observed output. Whether a
// SEPARATE `gentle-ai-verify` delegation is also required depends on the
// rendered `Receipt-driven development:` line, stated normatively exactly
// once in trigger 5 (Verification rule) and referenced -- not restated --
// everywhere else in this asset:
//   - `on`     -> the writer's own report is the verification of record;
//                 `gentle-ai-verify` is on-demand.
//   - `off`    -> `gentle-ai-verify` is additionally required for any
//                 non-trivial change.
//   - `unknown` -> fails closed: treated as non-trivial by default, so
//                 `gentle-ai-verify` is required unless the change is
//                 purely passive documentation.
// These tests assert the exact distinctive sentence for each branch (not
// bare words like `off`/`unknown`/`partial`/`blocked`), that the routing
// ladder paragraph references trigger 5 rather than restating it, and that
// `## Known environmental failures` has one canonical definition (owned by
// the worker asset) that the delegation asset references rather than
// duplicates.
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, "..");

function read(relativePath: string): string {
	return readFileSync(join(ROOT, relativePath), "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

const delegation = read("assets/orchestrator-delegation.md");
const worker = read("assets/agents/gentle-ai-worker.md");

const ON_SENTENCE =
	"When the line reads `on`, that writer report is the verification of record, and the native review is the independent check the writer cannot influence";
const OFF_SENTENCE =
	"When the line reads `off`, delegate the same verification separately to `gentle-ai-verify` for any non-trivial change, in addition to the writer's own report.";
const UNKNOWN_SENTENCE =
	"When the line reads `unknown`, treat the change as non-trivial by default (fail closed): keep the writer's own report and still require that separate `gentle-ai-verify` delegation, unless the change is purely passive documentation with no behavior to verify.";

test("trigger 5 (Verification rule) states the exact on-line routing: writer report is the verification of record", () => {
	assert.ok(delegation.includes(ON_SENTENCE), "trigger 5 is missing the exact on-line sentence");
});

test("trigger 5 states the exact off-line routing: gentle-ai-verify required for non-trivial changes", () => {
	assert.ok(delegation.includes(OFF_SENTENCE), "trigger 5 is missing the exact off-line sentence");
});

test("trigger 5 states the exact unknown-line routing: fails closed as non-trivial unless purely passive documentation", () => {
	assert.ok(delegation.includes(UNKNOWN_SENTENCE), "trigger 5 is missing the exact unknown-line fail-closed sentence");
});

test("the three on/off/unknown routing sentences appear exactly once each (normative statement lives only in trigger 5)", () => {
	for (const sentence of [ON_SENTENCE, OFF_SENTENCE, UNKNOWN_SENTENCE]) {
		assert.equal(countOccurrences(delegation, sentence), 1, `expected exactly one occurrence of: ${sentence.slice(0, 60)}...`);
	}
});

test("the Simple Delegation paragraph references trigger 5 instead of restating the on/off/unknown routing", () => {
	assert.match(
		delegation,
		/per the RDD-aware Verification rule \(trigger 5 under Mandatory Delegation Triggers, gentle-pi#661\)/,
	);
	assert.match(delegation, /the normative on\/off\/unknown routing lives there, not here/);
});

test("delegation overlay's trigger 5 (Verification rule) is RDD-aware", () => {
	assert.match(delegation, /\*\*Verification rule\*\*.*RDD-aware/);
});

test("delegation overlay reserves separate exploration for parent routing decisions", () => {
	assert.match(delegation, /exploration stays reserved for when the parent needs the map to decide or route/i);
	assert.match(delegation, /reading that prepares a write belongs with the writer/i);
});

test("delegation overlay keeps the required headings", () => {
	for (const heading of [
		"### Delegation Rules",
		"#### Background Subagent Policy",
		"#### Allowed edit surfaces (MANDATORY)",
		"### 3. SDD (optional)",
	]) {
		assert.ok(delegation.includes(heading), `delegation overlay lost required heading: ${heading}`);
	}
});

test("worker asset declares the Verification section after Test discipline", () => {
	const testDisciplineIndex = worker.indexOf("## Test discipline");
	const verificationIndex = worker.indexOf("## Verification");
	const interactionIndex = worker.indexOf("## Interaction contract");
	assert.ok(testDisciplineIndex >= 0, "worker asset lost ## Test discipline");
	assert.ok(verificationIndex >= 0, "worker asset is missing ## Verification");
	assert.ok(interactionIndex >= 0, "worker asset lost ## Interaction contract");
	assert.ok(
		testDisciplineIndex < verificationIndex && verificationIndex < interactionIndex,
		"## Verification must sit between ## Test discipline and ## Interaction contract",
	);
});

test("worker asset requires foreground, one-at-a-time verification with nothing left unreported", () => {
	for (const clause of [
		"in the foreground",
		"one at a time",
		"Never launch a verification command in the background",
		"never end the task with a listed command unreported",
	]) {
		assert.ok(worker.includes(clause), `worker asset is missing: ${clause}`);
	}
});

test("worker asset reports each verification command as <exact command>: <observed result> in validation", () => {
	assert.ok(worker.includes("`<exact command>: <observed result>`"));
	assert.ok(worker.includes("in `validation`"));
});

// ---------------------------------------------------------------------------
// Contract consistency (`## Known environmental failures`): defined exactly
// once, in the worker asset, as "exact test names (or exact command lines)
// that already fail on the base"; the writer reports those as evidence, but
// any OTHER failing required command still forces `status: partial`. The
// delegation asset must reference this same definition, not restate it.
// ---------------------------------------------------------------------------

test("worker asset owns the canonical Known environmental failures definition", () => {
	assert.ok(worker.includes("## Known environmental failures"));
	assert.match(worker, /this is the canonical definition; other assets reference it, they do not restate it/i);
	assert.match(worker, /lists exact test names or exact command lines that already fail on the base/i);
	assert.match(worker, /Any OTHER required command that fails -- one not named under that heading -- still forces `status: partial`\./);
});

test("delegation asset references the worker's Known environmental failures definition instead of restating it", () => {
	assert.match(
		delegation,
		/`## Known environmental failures` follows the same definition as `gentle-ai-worker`'s Verification contract: exact pre-existing base failures reported as evidence, never blockers -- any other failing required command still forces `status: partial`\./,
	);
	// The full canonical wording ("lists exact test names or exact command
	// lines that already fail on the base") must not be duplicated here.
	assert.doesNotMatch(delegation, /lists exact test names or exact command lines that already fail on the base/i);
});

test("worker asset never claims completion while a required verification command fails under RDD, except a named environmental failure", () => {
	assert.match(worker, /this report is the verification of record/i);
	assert.match(worker, /native review remains the independent check/i);
	assert.match(
		worker,
		/never report `status: completed` while a required command under `## Verification` is failing, unless that exact failure is named under `## Known environmental failures`\./i,
	);
});

test("worker asset keeps the existing Return contract fields", () => {
	for (const field of [
		"status: completed | partial | blocked | interaction_required",
		"summary:",
		"files_changed:",
		"tdd_evidence:",
		"validation:",
		"risks:",
		"review_focus:",
		"skill_resolution:",
		"interaction_required:",
	]) {
		assert.ok(worker.includes(field), `worker asset lost Return contract field: ${field}`);
	}
});
