import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CLI_CONTRACTS } from "../lib/native-review-cli.ts";

// Organic RDD parity: the four organic-parity capability columns exist on every
// shipped NATIVE_CLI_CONTRACTS row. Every row through the pinned "2.1.11"
// reports them false. "2.2.0" is the first capability-true row and it lights
// only what was demonstrated to reach a negotiated consumer, per Design
// Decision #1 ("Future row policy").
//
// A row describes what the NATIVE CLI puts on the wire, never what Pi manages
// to show. `riskEvidence` and `hint` stay false on 2.2.0 even though a Pi
// operator now sees both, because Pi derives them from `risk_reasons` and
// `changed_files` rather than receiving them: the closed `start/v2` schema
// omits the fields. Lighting the row would tell a future reader the envelope
// carries something it does not.

const ORGANIC_PARITY_CAPABILITIES = ["mode", "riskEvidence", "hint", "delivery"] as const;
const DARK_VERSIONS = ["2.1.4", "2.1.5", "2.1.6", "2.1.7", "2.1.8", "2.1.9", "2.1.10", "2.1.11"] as const;

test("every row through the pinned 2.1.11 reports the organic-parity capability columns false", () => {
	for (const version of DARK_VERSIONS) {
		const contract = NATIVE_CLI_CONTRACTS[version] as Record<string, boolean>;
		for (const capability of ORGANIC_PARITY_CAPABILITIES) {
			assert.equal(
				Object.hasOwn(contract, capability) ? contract[capability] : false,
				false,
				`${version}.${capability} must be false or absent`,
			);
		}
	}
});

test("the 2.1.11 row explicitly reports all four organic-parity capabilities false", () => {
	const contract = NATIVE_CLI_CONTRACTS["2.1.11"] as Record<string, boolean>;
	assert.equal(contract.mode, false);
	assert.equal(contract.riskEvidence, false);
	assert.equal(contract.hint, false);
	assert.equal(contract.delivery, false);
});

test("2.2.0 lights only the two capabilities its negotiated envelope demonstrably carries", () => {
	// Ground-truthed against the released v2.2.0 binary: the kill switch and
	// delivery disposition reach the negotiated path, while `risk_evidence` and
	// `hint` appear only in the plain envelope. See
	// tests/native-risk-evidence-parity.test.ts for the captured evidence.
	const contract = NATIVE_CLI_CONTRACTS["2.2.0"] as Record<string, boolean>;
	assert.equal(contract.mode, true);
	assert.equal(contract.delivery, true);
	assert.equal(contract.riskEvidence, false);
	assert.equal(contract.hint, false);
});

test("no shipped version key was added beyond the pin bump", () => {
	// Rows are promises to consumers, so a new key only ever appears in a
	// dedicated commit alongside a pin bump, never as a side effect.
	assert.deepEqual(Object.keys(NATIVE_CLI_CONTRACTS), [...DARK_VERSIONS, "2.2.0"]);
});
