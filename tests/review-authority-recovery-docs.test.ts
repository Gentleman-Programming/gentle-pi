import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const README = readFileSync("README.md", "utf8");
const CONTROLLER = readFileSync("extensions/gentle-ai.ts", "utf8");

test("recovery guidance documents the non-destructive supersession contract", () => {
	assert.match(README, /non-destructive.*supersession/i);
	assert.match(README, /eligible.*immutable.*graph-v1/i);
	assert.match(README, /prepare-supersession.*supersede/i);
	assert.match(README, /exact retr(?:y|ies).*idempotent/i);
	assert.match(README, /conflict.*fails closed/i);
	assert.match(README, /RESET.*RECOVER.*destructive/i);
	assert.match(README, /append-only.*authority-supersession-v1/i);
	assert.match(README, /rollback.*does not delete/i);
	assert.match(README, /pre-commit.*pre-push.*pre-PR.*release/is);
});

test("controller help keeps authorization, blocked outcomes, and recovery boundaries explicit", () => {
	assert.match(CONTROLLER, /prepare-supersession.*fresh UI approval.*never falls back to RESET or RECOVER/is);
	assert.match(CONTROLLER, /headlessly|headless/i);
	assert.match(CONTROLLER, /exact retr(?:y|ies)|semantic retr(?:y|ies)/i);
	assert.match(CONTROLLER, /resolve-review/);
});
