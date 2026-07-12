import assert from "node:assert/strict";
import test from "node:test";
import {
	CompactReviewContractError,
	parseCompactFinalizeInput,
	parseCompactStartInput,
} from "../lib/review-compact-contract.ts";

const POLICY_HASH = "a".repeat(64);

test("compact start parser returns canonical input and rejects widened nested projection", () => {
	assert.deepEqual(parseCompactStartInput({
		cwd: "/repo",
		lineageId: "review-1",
		policyHash: POLICY_HASH,
		projection: { kind: "complete" },
	}), {
		cwd: "/repo",
		lineageId: "review-1",
		policyHash: POLICY_HASH,
		projection: { kind: "complete" },
	});
	assert.throws(
		() => parseCompactStartInput({ cwd: "/repo", policyHash: POLICY_HASH, projection: { kind: "complete", extra: true } }),
		(error: unknown) => error instanceof CompactReviewContractError && error.area === "review/start.projection" && error.code === "unknown-key",
	);
});

test("compact finalize parser rejects malformed nested findings and incomplete final evidence pairing", () => {
	const valid = {
		cwd: "/repo",
		review_result: {
			lens_results: [{
				lens: "review-risk",
				findings: [{
					id: "RISK-001",
					lens: "review-risk",
					location: "lib/a.ts:1",
					severity: "CRITICAL",
					claim: "Concrete claim",
					evidence_class: "deterministic",
					causal_disposition: "introduced",
					proof_refs: ["changed-hunk:lib/a.ts:1"],
				}],
				evidence: ["reviewed"],
			}],
		},
	};
	assert.equal(parseCompactFinalizeInput(valid).review_result?.lens_results[0]?.findings[0]?.id, "RISK-001");
	assert.throws(
		() => parseCompactFinalizeInput({ ...valid, review_result: { lens_results: [{ ...valid.review_result.lens_results[0], findings: [{ ...valid.review_result.lens_results[0].findings[0], extra: true }] }] } }),
		(error: unknown) => error instanceof CompactReviewContractError && error.area === "review/finalize.review_result.lens_results[0].findings[0]" && error.code === "unknown-key",
	);
	assert.throws(
		() => parseCompactFinalizeInput({ cwd: "/repo", final_evidence: "passed" }),
		(error: unknown) => error instanceof CompactReviewContractError && error.code === "field-pair",
	);
});
