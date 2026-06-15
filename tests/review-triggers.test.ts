import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_RULE_SET,
	KNOWN_AGENTS,
	LARGE_CHANGED_LINE_THRESHOLD,
	evaluateEvent,
	matchPathGlobs,
	validateTriggerRuleSet,
	type ChangedDiff,
	type TriggerBinding,
	type TriggerRuleSet,
} from "../lib/review-triggers.ts";

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — accepts DEFAULT_RULE_SET
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: DEFAULT_RULE_SET is valid", () => {
	assert.doesNotThrow(() => validateTriggerRuleSet(DEFAULT_RULE_SET));
});

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — rejects negative minDiffLines
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: rejects negative minDiffLines", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-pr",
				when: { minDiffLines: -1 },
				run: ["review-risk"],
				mode: "strong",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /MinDiffLines/);
});

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — rejects 4R fan-out on pre-commit/pre-push with always
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: rejects 4R fan-out on pre-commit with always:true", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-commit",
				when: { always: true },
				run: [
					"review-risk",
					"review-readability",
					"review-reliability",
					"review-resilience",
				],
				mode: "strong",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /4R fan-out|spec G/i);
});

test("validateTriggerRuleSet: rejects 4R fan-out on pre-push with always:true", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-push",
				when: { always: true },
				run: [
					"review-risk",
					"review-readability",
					"review-reliability",
					"review-resilience",
				],
				mode: "strong",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /4R fan-out|spec G/i);
});

test("validateTriggerRuleSet: allows 4R fan-out on pre-pr (not everyday event)", () => {
	const ok: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-pr",
				when: { minDiffLines: 400, combine: "or" },
				run: [
					"review-risk",
					"review-readability",
					"review-reliability",
					"review-resilience",
				],
				mode: "strong",
				reason: "test",
			},
		],
	};
	assert.doesNotThrow(() => validateTriggerRuleSet(ok));
});

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — rejects unknown agent
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: rejects unknown agent in run", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-commit",
				when: { always: true },
				run: ["not-a-real-agent"],
				mode: "advisory",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /unknown.*agent|agent.*unknown/i);
});

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — rejects empty run
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: rejects empty run array", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-commit",
				when: { always: true },
				run: [],
				mode: "advisory",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /run.*empty|empty.*run/i);
});

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — rejects phases on non-post-sdd-phase event
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: rejects phases field on pre-commit event", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-commit",
				when: { phases: ["design"] },
				run: ["judgment-day"],
				mode: "strong",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /phases.*post-sdd-phase|post-sdd-phase.*phases/i);
});

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — rejects empty-slice When
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: rejects When with no conditions set", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-commit",
				when: {},
				run: ["review-readability"],
				mode: "advisory",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /at least one condition/i);
});

// ---------------------------------------------------------------------------
// validateTriggerRuleSet — rejects invalid combine value
// ---------------------------------------------------------------------------

test("validateTriggerRuleSet: rejects invalid combine value", () => {
	const bad: TriggerRuleSet = {
		bindings: [
			{
				on: "pre-pr",
				when: { pathGlobs: ["**/auth/**"], combine: "xor" as "" },
				run: ["review-risk"],
				mode: "strong",
				reason: "test",
			},
		],
	};
	assert.throws(() => validateTriggerRuleSet(bad), /combine/i);
});

// ---------------------------------------------------------------------------
// KNOWN_AGENTS — closed set coverage
// ---------------------------------------------------------------------------

test("KNOWN_AGENTS contains all 4R agents and SDD phases", () => {
	const required = [
		"review-risk",
		"review-readability",
		"review-reliability",
		"review-resilience",
		"judgment-day",
		"sdd-explore",
		"sdd-propose",
		"sdd-spec",
		"sdd-design",
		"sdd-tasks",
		"sdd-apply",
		"sdd-verify",
		"sdd-archive",
	];
	for (const agent of required) {
		assert.ok(KNOWN_AGENTS.includes(agent), `Expected KNOWN_AGENTS to include "${agent}"`);
	}
});

// ---------------------------------------------------------------------------
// LARGE_CHANGED_LINE_THRESHOLD
// ---------------------------------------------------------------------------

test("LARGE_CHANGED_LINE_THRESHOLD is 400", () => {
	assert.equal(LARGE_CHANGED_LINE_THRESHOLD, 400);
});

// ---------------------------------------------------------------------------
// matchPathGlobs — positive cases
// ---------------------------------------------------------------------------

test("matchPathGlobs: src/auth/login.ts matches **/auth/**", () => {
	assert.ok(matchPathGlobs(["src/auth/login.ts"], ["**/auth/**"]));
});

test("matchPathGlobs: src/security/handler.ts matches **/security/**", () => {
	assert.ok(matchPathGlobs(["src/security/handler.ts"], ["**/security/**"]));
});

test("matchPathGlobs: src/payments/gateway.ts matches **/payments/**", () => {
	assert.ok(matchPathGlobs(["src/payments/gateway.ts"], ["**/payments/**"]));
});

test("matchPathGlobs: src/update/updater.ts matches **/update/**", () => {
	assert.ok(matchPathGlobs(["src/update/updater.ts"], ["**/update/**"]));
});

test("matchPathGlobs: deep path matches **/auth/**", () => {
	assert.ok(matchPathGlobs(["a/b/c/auth/deep/file.ts"], ["**/auth/**"]));
});

test("matchPathGlobs: mixed paths — only one matches — returns true", () => {
	assert.ok(matchPathGlobs(["src/utils/helper.ts", "src/auth/middleware.ts"], ["**/auth/**"]));
});

// ---------------------------------------------------------------------------
// matchPathGlobs — negative cases
// ---------------------------------------------------------------------------

test("matchPathGlobs: src/utils/helper.ts does NOT match **/auth/**", () => {
	assert.equal(matchPathGlobs(["src/utils/helper.ts"], ["**/auth/**"]), false);
});

test("matchPathGlobs: empty paths returns false", () => {
	assert.equal(matchPathGlobs([], ["**/auth/**"]), false);
});

test("matchPathGlobs: path without auth segment does not match auth glob", () => {
	assert.equal(matchPathGlobs(["src/authutils/helper.ts"], ["**/auth/**"]), false);
});

// ---------------------------------------------------------------------------
// matchPathGlobs — root-level directory matching (FIX 1: leading **/ zero segments)
// ---------------------------------------------------------------------------

test("matchPathGlobs: auth/login.ts (root-level) matches **/auth/**", () => {
	assert.ok(matchPathGlobs(["auth/login.ts"], ["**/auth/**"]));
});

test("matchPathGlobs: payments/stripe.ts (root-level) matches **/payments/**", () => {
	assert.ok(matchPathGlobs(["payments/stripe.ts"], ["**/payments/**"]));
});

test("matchPathGlobs: security/config.ts (root-level) matches **/security/**", () => {
	assert.ok(matchPathGlobs(["security/config.ts"], ["**/security/**"]));
});

test("matchPathGlobs: authutils/helper.ts (root-level) does NOT match **/auth/** (segment boundary required)", () => {
	assert.equal(matchPathGlobs(["authutils/helper.ts"], ["**/auth/**"]), false);
});

// ---------------------------------------------------------------------------
// evaluateEvent — pre-commit: always fires advisory readability
// ---------------------------------------------------------------------------

test("evaluateEvent: pre-commit always fires advisory review-readability", () => {
	const diff: ChangedDiff = { changedPaths: [], changedLines: 0 };
	const result = evaluateEvent("pre-commit", diff);
	assert.ok(result !== null, "Expected a result for pre-commit");
	assert.equal(result!.mode, "advisory");
	assert.ok(result!.run.includes("review-readability"));
});

test("evaluateEvent: pre-push always fires advisory review-readability", () => {
	const diff: ChangedDiff = { changedPaths: [], changedLines: 0 };
	const result = evaluateEvent("pre-push", diff);
	assert.ok(result !== null, "Expected a result for pre-push");
	assert.equal(result!.mode, "advisory");
	assert.ok(result!.run.includes("review-readability"));
});

// ---------------------------------------------------------------------------
// evaluateEvent — pre-pr: fires strong 4R when path matches hot globs
// ---------------------------------------------------------------------------

test("evaluateEvent: pre-pr fires strong 4R when auth path matches", () => {
	const diff: ChangedDiff = {
		changedPaths: ["src/auth/middleware.ts"],
		changedLines: 10,
	};
	const result = evaluateEvent("pre-pr", diff);
	assert.ok(result !== null, "Expected a result for pre-pr on auth path");
	assert.equal(result!.mode, "strong");
	assert.ok(result!.run.includes("review-risk"));
	assert.ok(result!.run.includes("review-readability"));
	assert.ok(result!.run.includes("review-reliability"));
	assert.ok(result!.run.includes("review-resilience"));
});

// ---------------------------------------------------------------------------
// evaluateEvent — pre-pr: fires strong 4R when changedLines >= 400
// ---------------------------------------------------------------------------

test("evaluateEvent: pre-pr fires strong 4R when changedLines >= 400", () => {
	const diff: ChangedDiff = {
		changedPaths: ["src/utils/helper.ts"],
		changedLines: 400,
	};
	const result = evaluateEvent("pre-pr", diff);
	assert.ok(result !== null, "Expected a result for pre-pr on large diff");
	assert.equal(result!.mode, "strong");
});

test("evaluateEvent: pre-pr threshold boundary — 400 fires", () => {
	const diff: ChangedDiff = { changedPaths: [], changedLines: 400 };
	const result = evaluateEvent("pre-pr", diff);
	assert.ok(result !== null, "Expected a result at boundary 400");
});

test("evaluateEvent: pre-pr threshold boundary — 399 does NOT fire", () => {
	const diff: ChangedDiff = { changedPaths: [], changedLines: 399 };
	const result = evaluateEvent("pre-pr", diff);
	assert.equal(result, null, "Expected null at 399 with no hot paths");
});

// ---------------------------------------------------------------------------
// evaluateEvent — pre-pr: does NOT fire when neither condition holds
// ---------------------------------------------------------------------------

test("evaluateEvent: pre-pr does NOT fire with 0 lines and no hot paths", () => {
	const diff: ChangedDiff = {
		changedPaths: ["src/utils/helper.ts"],
		changedLines: 0,
	};
	const result = evaluateEvent("pre-pr", diff);
	assert.equal(result, null);
});

test("evaluateEvent: pre-pr does NOT fire with 50 lines and no hot paths", () => {
	const diff: ChangedDiff = {
		changedPaths: ["src/components/Button.tsx"],
		changedLines: 50,
	};
	const result = evaluateEvent("pre-pr", diff);
	assert.equal(result, null);
});
