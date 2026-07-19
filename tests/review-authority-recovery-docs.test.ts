import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const README = readFileSync("README.md", "utf8");
const CONTROLLER = readFileSync("extensions/gentle-ai.ts", "utf8");

test("recovery guidance documents the narrow native reconciliation contract", () => {
	assert.match(README, /reconcile-authority.*only Pi route/i);
	assert.match(README, /predecessor lineage and revision.*successor lineage and revision/i);
	assert.match(README, /exact seven-line.*fresh interactive approval/i);
	assert.match(README, /quarantine only the bound invalid compact-v2 recovery successor/i);
	assert.match(README, /predecessor stays untouched/i);
	assert.match(README, /RESET.*RECOVER.*destructive/i);
	assert.match(README, /typed envelopes/i);
	assert.match(README, /pre-commit.*pre-push.*pre-PR.*release/is);
});

test("controller help keeps authorization, blocked outcomes, and recovery boundaries explicit", () => {
	assert.match(CONTROLLER, /reconcile-authority.*fresh UI approval.*exact predecessor and successor revisions/is);
	assert.match(CONTROLLER, /headlessly|headless/i);
	assert.match(CONTROLLER, /quarantine.*invalid recovery successor/i);
	assert.match(CONTROLLER, /never.*RESET or RECOVER/is);
});
