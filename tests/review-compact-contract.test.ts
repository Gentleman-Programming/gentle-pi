import assert from "node:assert/strict";
import test from "node:test";
import {
	CompactReviewContractError,
	parseNativeCompactFinalizeInput,
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
	assert.equal(parseNativeCompactFinalizeInput(valid).review_result?.lens_results[0]?.findings[0]?.id, "RISK-001");
	assert.throws(
		() => parseNativeCompactFinalizeInput({ ...valid, review_result: { lens_results: [{ ...valid.review_result.lens_results[0], findings: [{ ...valid.review_result.lens_results[0].findings[0], extra: true }] }] } }),
		(error: unknown) => error instanceof CompactReviewContractError && error.area === "review/finalize.review_result.lens_results[0].findings[0]" && error.code === "unknown-key",
	);
	assert.throws(
		() => parseNativeCompactFinalizeInput({ cwd: "/repo", final_evidence: "passed" }),
		(error: unknown) => error instanceof CompactReviewContractError && error.code === "field-pair",
	);
	for (const review_result of [
		{ lens_results: [{ findings: [], evidence: [] }] },
		{ lens_results: [{ findings: [{ ...valid.review_result.lens_results[0].findings[0], proof_refs: [] }], evidence: ["reviewed"] }] },
		{ lens_results: [{ findings: [{ ...valid.review_result.lens_results[0].findings[0], severity: "UNKNOWN" }], evidence: ["reviewed"] }] },
		{ lens_results: [{ findings: [{ ...valid.review_result.lens_results[0].findings[0], evidence_class: "info" }], evidence: ["reviewed"] }] },
	]) assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", review_result }), CompactReviewContractError);
	assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", validation_proof: { original_criteria: { passed: true, evidence: [] }, correction_regression: { passed: true, evidence: ["passed"] } } }), CompactReviewContractError);
	assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", refuter_batch: { schema: "gentle-ai.refuter-result-batch/v1", request_hash: POLICY_HASH, results: [{ finding_id: "RISK-001", outcome: "unknown", proof_refs: ["proof"] }] } }), CompactReviewContractError);
});

test("native finalize preserves arbitrary non-empty evidence text and binds refuter batches", () => {
	const evidence = " \tleading evidence\nterminal newlines\n\n";
	assert.equal(parseNativeCompactFinalizeInput({ cwd: "/repo", final_evidence: evidence, final_verification_passed: true }).final_evidence, evidence);
	assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", final_evidence: "", final_verification_passed: true }), CompactReviewContractError);

	const proof = "differential-test:candidate still fails";
	const review_result = {
		lens_results: [{
			lens: "review-risk",
			findings: [{ id: "RISK-001", lens: "review-risk", location: "lib/a.ts:1", severity: "CRITICAL", claim: "Candidate fails", evidence_class: "inferential", causal_disposition: "introduced", proof_refs: [proof] }],
			evidence: ["reviewed"],
		}],
		refuter_request_hash: POLICY_HASH,
	};
	const batch = { schema: "gentle-ai.refuter-result-batch/v1", request_hash: POLICY_HASH, results: [{ finding_id: "RISK-001", outcome: "corroborated", proof_refs: [proof] }] };
	assert.deepEqual(parseNativeCompactFinalizeInput({ cwd: "/repo", review_result, refuter_batch: batch }).refuter_batch, batch);
	assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", review_result, refuter_batch: { ...batch, request_hash: "b".repeat(64) } }), CompactReviewContractError);
	const independent = { ...batch, results: [{ ...batch.results[0], proof_refs: ["differential-test:independent reproduction fails"] }] };
	assert.deepEqual(parseNativeCompactFinalizeInput({ cwd: "/repo", review_result, refuter_batch: independent }).refuter_batch, independent);
	for (const proof_refs of [[], [""], [" malformed"]]) {
		assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", review_result, refuter_batch: { ...batch, results: [{ ...batch.results[0], proof_refs }] } }), CompactReviewContractError);
	}
});
