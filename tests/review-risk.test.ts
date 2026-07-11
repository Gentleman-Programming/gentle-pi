import assert from "node:assert/strict";
import test from "node:test";
import {
	GENERATED_GOLDEN_PATH,
	REVIEW_RISK_TIER,
	classifyReviewRisk,
	correctionBudget,
	countAuthoredChangedLines,
	type ReviewDiffStat,
} from "../lib/review-risk.ts";
import { FULL_4R_LENSES, REVIEW_LENS } from "../lib/review-triggers.ts";

function stat(path: string, additions: number, deletions = 0): ReviewDiffStat {
	return { path, additions, deletions, binary: false, mode_only: false };
}

test("generated adapter goldens remain explicit and do not hide ordinary tests or fixtures", () => {
	assert.equal(GENERATED_GOLDEN_PATH.test("testdata/golden/adapter.golden"), true);
	assert.equal(countAuthoredChangedLines([
		stat("testdata/golden/adapter.golden", 900, 300),
		stat("tests/golden-behavior.test.ts", 20, 5),
		stat("tests/fixtures/expected.json", 8, 2),
	]), 35);
});

test("risk classification freezes deterministic low, medium, and high routes", () => {
	const low = classifyReviewRisk([stat("docs/review.md", 9, 1)]);
	assert.equal(low.tier, REVIEW_RISK_TIER.LOW);
	assert.deepEqual(low.selected_lenses, []);
	assert.equal(low.correction_budget, 5);

	const medium = classifyReviewRisk([stat("src/parser.ts", 3, 2)]);
	assert.equal(medium.tier, REVIEW_RISK_TIER.MEDIUM);
	assert.deepEqual(medium.selected_lenses, [REVIEW_LENS.READABILITY]);

	const high = classifyReviewRisk([stat("src/shell/process-runner.ts", 2)]);
	assert.equal(high.tier, REVIEW_RISK_TIER.HIGH);
	assert.deepEqual(high.selected_lenses, FULL_4R_LENSES);

	const large = classifyReviewRisk([stat("src/value.ts", 401)]);
	assert.equal(large.tier, REVIEW_RISK_TIER.HIGH);
});

test("binary-only and mode-only candidates keep zero authored lines but require a lens", () => {
	for (const opaque of [
		{ ...stat("src/plugin.bin", 0), binary: true },
		{ ...stat("src/runner.ts", 0), mode_only: true },
	]) {
		const classified = classifyReviewRisk([opaque]);
		assert.equal(classified.original_changed_lines, 0);
		assert.equal(classified.tier, REVIEW_RISK_TIER.MEDIUM);
		assert.deepEqual(classified.selected_lenses, [REVIEW_LENS.READABILITY]);
	}
});

test("correction budget rounds up and caps at two hundred authored lines", () => {
	assert.equal(correctionBudget(0), 0);
	assert.equal(correctionBudget(1), 1);
	assert.equal(correctionBudget(5), 3);
	assert.equal(correctionBudget(400), 200);
	assert.equal(correctionBudget(900), 200);
	assert.throws(() => correctionBudget(-1), /non-negative/);
});
