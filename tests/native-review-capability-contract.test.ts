import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CLI_CONTRACTS } from "../lib/native-review-cli.ts";

// Organic RDD parity, Phase 2: the four new organic-parity capability columns
// must exist on every shipped NATIVE_CLI_CONTRACTS row and must all report
// false — including the pinned "2.1.11" row. This keeps every new behavior
// (kill-switch consultation, native consent, empty-candidate hint, delivery
// passthrough) dark until a future gentle-ai release ships a version row with
// these columns true, per Design Decision #1 ("Future row policy").

const ORGANIC_PARITY_CAPABILITIES = ["mode", "riskEvidence", "hint", "delivery"] as const;

test("every shipped NATIVE_CLI_CONTRACTS row reports the organic-parity capability columns false", () => {
	const rows = Object.entries(NATIVE_CLI_CONTRACTS);
	assert.ok(rows.length > 0);
	for (const [version, contract] of rows) {
		for (const capability of ORGANIC_PARITY_CAPABILITIES) {
			assert.equal(
				Object.hasOwn(contract, capability) ? (contract as Record<string, boolean>)[capability] : false,
				false,
				`${version}.${capability} must be false or absent`,
			);
		}
	}
});

test("the pinned 2.1.11 row explicitly reports all four organic-parity capabilities false", () => {
	const contract = NATIVE_CLI_CONTRACTS["2.1.11"] as Record<string, boolean>;
	assert.equal(contract.mode, false);
	assert.equal(contract.riskEvidence, false);
	assert.equal(contract.hint, false);
	assert.equal(contract.delivery, false);
});

test("no new shipped version key was added alongside the organic-parity columns", () => {
	// Frozen at the time Track B started: the existing set of shipped version
	// rows. Organic-parity is additive-columns-only; PI-2 adds the first
	// capability-true row in its own dedicated commit together with the triple
	// pin bump, never silently here.
	assert.deepEqual(Object.keys(NATIVE_CLI_CONTRACTS), ["2.1.4", "2.1.5", "2.1.6", "2.1.7", "2.1.8", "2.1.9", "2.1.10", "2.1.11"]);
});
