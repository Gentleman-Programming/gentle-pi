import assert from "node:assert/strict";
import test from "node:test";
import {
	CAUSAL_DISPOSITION,
	COMPACT_EVIDENCE_CLASS,
	COMPACT_REVIEW_STATE,
	completeCompactCorrection,
	completeCompactReview,
	completeCompactVerification,
	beginCompactCorrection,
	createCompactRefuterRequest,
	createCompactValidatorRequest,
	createCompactReceipt,
	freezeCompactValidatorRequest,
	createCompactReviewState,
} from "../lib/review-compact.ts";
import { REVIEW_RISK_TIER } from "../lib/review-risk.ts";
import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	type SnapshotV1,
} from "../lib/review-snapshot.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";

function snapshot(): SnapshotV1 {
	return {
		schema: "gentle-ai.review-snapshot/v1",
		mode: REVIEW_MODE.ORDINARY,
		repository_root: "/repo",
		base_tree: "1".repeat(40),
		complete_snapshot_tree: "2".repeat(40),
		review_projection: { kind: REVIEW_PROJECTION.COMPLETE },
		initial_review_tree: "2".repeat(40),
		genesis_paths: ["src/value.ts"],
		intended_untracked: [],
		diff_evidence: {
			event: "ordinary-start",
			changedLines: 10,
			triviality: "unproven",
			evidenceComplete: true,
			executableChanged: true,
			configurationChanged: false,
			hotPathChanged: false,
			riskSignal: false,
			resilienceSignal: false,
			reliabilitySignal: false,
		},
		route: REVIEW_ROUTE.STANDARD,
		lenses: [REVIEW_LENS.READABILITY],
		risk_tier: REVIEW_RISK_TIER.MEDIUM,
		original_changed_lines: 10,
		correction_budget: 5,
		policy_hash: "a".repeat(64),
		object_store: {
			snapshot_directory: "/tmp/snapshot",
			object_directory: "/tmp/snapshot/objects",
			alternate_object_directory: "/repo/.git/objects",
			metadata_path: "/tmp/snapshot/snapshot.json",
			sensitivity: "workspace-content",
			cleanup_trigger: "lineage-terminal",
			cleanup_action: "delete-isolated-object-store",
		},
	};
}

test("causal review assigns missing IDs and admits only proven candidate-caused severe findings", () => {
	const reviewing = createCompactReviewState({
		lineageId: "compact-causal",
		snapshot: snapshot(),
		policyHash: "a".repeat(64),
	});
	const completed = completeCompactReview(reviewing, {
		lens_results: [{
			findings: [
				{
					location: "src/value.ts:2",
					severity: "CRITICAL",
					claim: "The candidate activates an invalid branch.",
					evidence_class: COMPACT_EVIDENCE_CLASS.DETERMINISTIC,
					causal_disposition: CAUSAL_DISPOSITION.BEHAVIOR_ACTIVATED,
					proof_refs: ["changed-hunk:src/value.ts:2"],
				},
				{
					location: "src/value.ts:1",
					severity: "BLOCKER",
					claim: "The base already contains a separate defect.",
					evidence_class: COMPACT_EVIDENCE_CLASS.DETERMINISTIC,
					causal_disposition: CAUSAL_DISPOSITION.PRE_EXISTING,
					proof_refs: ["before-after:base-and-candidate"],
				},
			],
			evidence: ["reviewed exact candidate tree"],
		}],
	});

	assert.equal(completed.state, COMPACT_REVIEW_STATE.CORRECTION_REQUIRED);
	assert.deepEqual(completed.correction_ids, ["READABILITY-002"]);
	assert.equal(completed.follow_ups.length, 1);
	assert.equal(completed.follow_ups[0]?.finding_id, "READABILITY-001");
});

test("unknown, malformed, insufficient, and incomplete inferential severe claims escalate", () => {
	const reviewing = createCompactReviewState({
		lineageId: "compact-escalation",
		snapshot: snapshot(),
		policyHash: "a".repeat(64),
	});
	const lensResults = [{
			findings: [{
				location: "src/value.ts:2",
				severity: "CRITICAL",
				claim: "The candidate may activate an invalid branch.",
				evidence_class: COMPACT_EVIDENCE_CLASS.INFERENTIAL,
				causal_disposition: CAUSAL_DISPOSITION.INTRODUCED,
				proof_refs: ["differential-test:tests/value.test.ts"],
			}],
			evidence: [],
		}];
	const completed = completeCompactReview(reviewing, {
		lens_results: lensResults,
		refuter_request_hash: createCompactRefuterRequest(reviewing, lensResults)?.request_hash,
	});
	assert.equal(completed.state, COMPACT_REVIEW_STATE.ESCALATED);
	assert.match(completed.escalation_reasons.join("\n"), /complete refuter batch/i);
});

test("refuter request assigns native IDs and rejects incomplete or foreign batches", () => {
	const input = { lens_results: [{ findings: [{
		location: "src/value.ts:2", severity: "CRITICAL", claim: "The branch may fail.",
		evidence_class: "inferential", causal_disposition: "introduced",
		proof_refs: ["differential-test:tests/value.test.ts"],
	}], evidence: [] }] };
	for (const rows of [[], [
		{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: ["before-after:proof"] },
		{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: ["before-after:proof"] },
	], [{ finding_id: "FOREIGN-001", outcome: "refuted", proof_refs: ["before-after:proof"] }]]) {
		const reviewing = createCompactReviewState({ lineageId: `refuter-${rows.length}-${rows[0]?.finding_id ?? "empty"}`, snapshot: snapshot(), policyHash: "a".repeat(64) });
		const request = createCompactRefuterRequest(reviewing, input.lens_results);
		assert.deepEqual(request?.findings.map(({ id }) => id), ["READABILITY-001"]);
		const completed = completeCompactReview(reviewing, { ...input, refuter_request_hash: request?.request_hash, refuter_results: rows });
		assert.equal(completed.state, COMPACT_REVIEW_STATE.ESCALATED);
	}
});

test("informational malformed and duplicate IDs are replaced without escalation", () => {
	const completed = completeCompactReview(createCompactReviewState({ lineageId: "informational-ids", snapshot: snapshot(), policyHash: "a".repeat(64) }), {
		lens_results: [{ findings: [
			{ id: "bad", location: "src/value.ts:1", severity: "WARNING", claim: "Info.", proof_refs: [] },
			{ id: "READABILITY-010", location: "src/value.ts:2", severity: "WARNING", claim: "Info.", proof_refs: [] },
			{ id: "READABILITY-010", location: "src/value.ts:3", severity: "SUGGESTION", claim: "Info.", proof_refs: [] },
			{ id: "also-bad", location: "src/value.ts:4", severity: "CRITICAL", claim: "Severe.", evidence_class: "deterministic", causal_disposition: "introduced", proof_refs: ["changed-hunk:src/value.ts:4"] },
		], evidence: [] }],
	});
	assert.equal(completed.state, COMPACT_REVIEW_STATE.ESCALATED);
	assert.equal(completed.escalation_reasons.length, 1);
	assert.match(completed.escalation_reasons[0] ?? "", /ALSO-BAD/);
	for (const finding of completed.findings.filter(({ severity }) => severity === "WARNING" || severity === "SUGGESTION")) {
		assert.equal(completed.outcomes[finding.id], "info");
	}
});

test("one forecast, one repository-sized correction, one targeted validator, and final evidence close the lineage", () => {
	const reviewed = completeCompactReview(createCompactReviewState({
		lineageId: "compact-correction",
		snapshot: snapshot(),
		policyHash: "a".repeat(64),
	}), {
		lens_results: [{
			findings: [{
				id: "READABILITY-009",
				location: "src/value.ts:2",
				severity: "BLOCKER",
				claim: "The candidate removes the required guard.",
				evidence_class: "deterministic",
				causal_disposition: "introduced",
				proof_refs: ["changed-hunk:src/value.ts:2"],
			}],
			evidence: [],
		}],
	});
	const forecast = beginCompactCorrection(reviewed, 3);
	const correction = {
		candidate_tree: "3".repeat(40),
		changed_paths: ["src/value.ts"],
		changed_lines: 3,
		fix_diff: "diff --git a/src/value.ts b/src/value.ts",
		fix_diff_hash: "b".repeat(64),
	};
	const proof = {
		original_criteria: { passed: true, evidence: ["original suite passed"] },
		correction_regression: { passed: true, evidence: ["guard regression passed"] },
	};
	const request = createCompactValidatorRequest(forecast, correction);
	const frozen = freezeCompactValidatorRequest(forecast, request);
	const validation = { request_hash: request.request_hash, correction_ids: ["READABILITY-009"], ...proof, fix_caused_findings: [], follow_ups: [] };
	assert.throws(() => completeCompactCorrection(frozen, { ...correction, candidate_tree: "4".repeat(40) }, [], validation), /frozen validator request/i);
	assert.equal(completeCompactCorrection(frozen, correction, [], { ...validation, original_criteria: { passed: false, evidence: ["independent acceptance failure"] } }).state, COMPACT_REVIEW_STATE.ESCALATED);
	const corrected = completeCompactCorrection(frozen, correction, [], validation);
	assert.equal(corrected.state, COMPACT_REVIEW_STATE.VALIDATING);
	const terminal = completeCompactVerification(corrected, "full suite passed", true);
	assert.equal(terminal.state, COMPACT_REVIEW_STATE.APPROVED);
	const receipt = createCompactReceipt(terminal, "c".repeat(64));
	assert.equal(receipt.body.original_changed_lines, 10);
	assert.equal(receipt.body.correction_budget, 5);
	assert.deepEqual(receipt.body.correction_ids, ["READABILITY-009"]);
	assert.match(receipt.body.evidence_hash, /^[0-9a-f]{64}$/);
});

test("correction forecast and actual repository evidence cannot exceed the frozen budget", () => {
	const reviewed = completeCompactReview(createCompactReviewState({
		lineageId: "compact-budget",
		snapshot: snapshot(),
		policyHash: "a".repeat(64),
	}), {
		lens_results: [{
			findings: [{
				location: "src/value.ts:2",
				severity: "BLOCKER",
				claim: "The candidate removes the required guard.",
				evidence_class: "deterministic",
				causal_disposition: "introduced",
				proof_refs: ["changed-hunk:src/value.ts:2"],
			}],
			evidence: [],
		}],
	});
	assert.throws(() => beginCompactCorrection(reviewed, 0), /positive/);
	const overBudget = beginCompactCorrection(reviewed, 6);
	assert.equal(overBudget.state, COMPACT_REVIEW_STATE.ESCALATED);
	const forecast = beginCompactCorrection(reviewed, 5);
	assert.throws(() => completeCompactCorrection(forecast, {
		candidate_tree: "3".repeat(40),
		changed_paths: ["src/value.ts"],
		changed_lines: 6,
		fix_diff: "diff",
		fix_diff_hash: "b".repeat(64),
	}, [], {
		correction_ids: forecast.correction_ids,
		original_criteria: { passed: true, evidence: ["passed"] },
		correction_regression: { passed: true, evidence: ["passed"] },
		follow_ups: [],
	}), /exceeding frozen budget/i);
});
