import assert from "node:assert/strict";
import test from "node:test";
import {
	CompactReviewContractError,
	deriveNativeValidationRequest,
	parseNativeCompactFinalizeInput,
	parseCompactStartInput,
	toNativeValidatorDocument,
} from "../lib/review-compact-contract.ts";

const POLICY_HASH = "a".repeat(64);

function correctionRequiredState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		lineage_id: "correction-lineage",
		state: "correction_required",
		initial_snapshot: { candidate_tree: "c".repeat(40) },
		fix_finding_ids: ["R4-001", "R4-002"],
		findings: [
			{ id: "R4-001", severity: "CRITICAL" },
			{ id: "R4-002", severity: "BLOCKER" },
			{ id: "RISK-XSS-001", severity: "CRITICAL" },
		],
		outcomes: { "R4-001": "corroborated", "R4-002": "corroborated", "RISK-XSS-001": "info" },
		...overrides,
	};
}

test("validation request derivation keeps severe pre-existing follow-ups inert (#171)", () => {
	const request = deriveNativeValidationRequest({
		lineageId: "correction-lineage",
		candidateTree: "d".repeat(40),
		state: correctionRequiredState(),
	});
	assert.deepEqual(request.blocking_finding_ids, ["R4-001", "R4-002"]);
	assert.deepEqual(request.fix_finding_ids, ["R4-001", "R4-002"]);
});

test("validation request derivation still blocks corroborated severe findings absent from the fix set", () => {
	assert.throws(
		() => deriveNativeValidationRequest({
			lineageId: "correction-lineage",
			candidateTree: "d".repeat(40),
			state: correctionRequiredState({
				fix_finding_ids: ["R4-001"],
				outcomes: { "R4-001": "corroborated", "R4-002": "corroborated", "RISK-XSS-001": "info" },
			}),
		}),
		(error: unknown) => error instanceof CompactReviewContractError && error.code === "finding-ids",
	);
});

test("validation request derivation without native outcomes keeps the severity-derived blocking set", () => {
	const request = deriveNativeValidationRequest({
		lineageId: "correction-lineage",
		candidateTree: "d".repeat(40),
		state: correctionRequiredState({
			fix_finding_ids: ["R4-001", "R4-002", "RISK-XSS-001"],
			outcomes: undefined,
		}),
	});
	assert.deepEqual(request.blocking_finding_ids, ["R4-001", "R4-002", "RISK-XSS-001"]);
});

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
	for (const outcome of ["passed", "verification_failed", "procedural_tooling_failed"] as const) {
		assert.equal(parseNativeCompactFinalizeInput({ cwd: "/repo", final_evidence: evidence, final_verification_outcome: outcome }).final_verification_outcome, outcome);
	}
	assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", final_evidence: evidence, final_verification_outcome: "failed" }), CompactReviewContractError);
	assert.throws(() => parseNativeCompactFinalizeInput({ cwd: "/repo", final_evidence: evidence, final_verification_passed: true, final_verification_outcome: "passed" }), CompactReviewContractError);
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

test("native validator document keeps legacy three fields for legacy finalizer inputs", () => {
	const legacy = {
		original_criteria: { passed: true, evidence: ["proof"] },
		correction_regression: { passed: false, evidence: ["failed"] },
	};
	assert.deepEqual(toNativeValidatorDocument(legacy), {
		original_criteria: legacy.original_criteria,
		correction_regression: legacy.correction_regression,
		follow_ups: [],
	});
});

test("targeted validator document uses canonical provider request identities and follow-up projections", () => {
	const targeted = {
		original_criteria: { passed: true, evidence: ["proof"] },
		correction_regression: { passed: false, evidence: ["failed"] },
		request_hash: "1".repeat(64),
		correction_ids: ["RISK-1"],
		follow_ups: [{ summary: "Proof observed", proof_refs: ["candidate:line"] }],
	};
	const validationRequest = { requestHash: `sha256:${"2".repeat(64)}`, correctionTargetIdentity: `sha256:${"3".repeat(64)}` };
	assert.deepEqual(toNativeValidatorDocument(targeted, validationRequest), {
		targeted_validation_request_hash: validationRequest.requestHash,
		correction_target_identity: validationRequest.correctionTargetIdentity,
		original_criteria: targeted.original_criteria,
		correction_regression: targeted.correction_regression,
		follow_ups: [{ observation: "Proof observed", proof_refs: ["candidate:line"] }],
	});
});

test("targeted validator document requires provider validationRequest binding", () => {
	const targeted = {
		original_criteria: { passed: true, evidence: ["proof"] },
		correction_regression: { passed: false, evidence: ["failed"] },
		request_hash: "1".repeat(64),
		correction_ids: ["RISK-1"],
		follow_ups: [{ summary: "Proof observed", proof_refs: ["candidate:line"] }],
	};
	assert.throws(() => toNativeValidatorDocument(targeted), /requires provider validationRequest/);
});

test("targeted validator document rejects malformed provider identities", () => {
	const targeted = {
		original_criteria: { passed: true, evidence: ["proof"] },
		correction_regression: { passed: false, evidence: ["failed"] },
		request_hash: "1".repeat(64),
		correction_ids: ["RISK-1"],
		follow_ups: [{ summary: "Proof observed", proof_refs: ["candidate:line"] }],
	};
	for (const validationRequest of [
		{ requestHash: "sha256:bad", correctionTargetIdentity: `sha256:${"3".repeat(64)}` },
		{ requestHash: `sha256:${"2".repeat(64)}`, correctionTargetIdentity: "sha256:bad" },
	]) {
		assert.throws(() => toNativeValidatorDocument(targeted, validationRequest), CompactReviewContractError);
	}
});
