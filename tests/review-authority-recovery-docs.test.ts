import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const README = readFileSync("README.md", "utf8");
const CONTROLLER = readFileSync("extensions/gentle-ai.ts", "utf8");

test("recovery guidance documents the narrow published native maintenance contract", () => {
	assert.match(README, /abandon.*quarantine-legacy.*reconcile-authority.*explicit v2\.1\.11 maintenance/i);
	assert.match(README, /predecessor lineage and revision.*successor lineage and revision/i);
	assert.match(README, /exact seven-line.*anomalies=unchanged_target,malformed_recovery_authorization/i);
	assert.match(README, /fresh interactive approval/i);
	assert.match(README, /quarantine only the bound invalid compact-v2 recovery successor/i);
	assert.match(README, /predecessor stays untouched/i);
	assert.match(README, /repair-legacy-alias.*unsupported historical v1 operation alias/i);
	assert.match(README, /model supplies only lineage, actor, and reason/i);
	assert.match(README, /review dispose-result.*unsupported.*pending.*design/i);
	assert.match(README, /RESET.*RECOVER.*destructive/i);
	assert.match(README, /typed envelopes/i);
	assert.match(README, /pre-commit.*pre-push.*pre-PR.*release/is);
});

test("controller help keeps authorization, blocked outcomes, and recovery boundaries explicit", () => {
	assert.match(CONTROLLER, /v2\.1\.11 repair-legacy-alias.*fresh native inventory.*fresh UI approval/is);
	assert.match(CONTROLLER, /unchanged_target,malformed_recovery_authorization/);
	assert.match(CONTROLLER, /provider-selected recovery disposition/);
	assert.match(CONTROLLER, /headlessly|headless/i);
	assert.match(CONTROLLER, /quarantine.*invalid recovery successor/i);
	assert.match(CONTROLLER, /never.*RESET or RECOVER/is);
});
