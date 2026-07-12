import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	CompactReviewLineageBindingMismatchError,
	CompactReviewTerminalAmbiguityError,
	createTerminalReviewCandidateBinding,
	discoverCompactReview,
	matchesTerminalReviewCandidateBinding,
	finalizeCompactReview,
	startCompactReview,
} from "../lib/review-facade.ts";
import { CompactReviewContractError } from "../lib/review-compact-contract.ts";
import type { LiveReviewCandidateBinding } from "../lib/review-snapshot.ts";

function repository(t: test.TestContext): string {
	const parent = mkdtempSync(join(tmpdir(), "compact-facade-"));
	const root = join(parent, "repo");
	mkdirSync(root);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "value.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync("git", ["-c", "user.name=Facade", "-c", "user.email=facade@example.invalid", "commit", "-m", "base"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "value.ts"), "export const value = 2;\n");
	return root;
}

test("facade rejects malformed compact inputs before repository discovery", () => {
	assert.throws(
		() => startCompactReview({ cwd: "/does-not-exist", policyHash: "not-a-digest" }),
		(error: unknown) => error instanceof CompactReviewContractError && error.area === "review/start.policyHash",
	);
	assert.throws(
		() => finalizeCompactReview({ cwd: "/does-not-exist", final_evidence: "evidence" }),
		(error: unknown) => error instanceof CompactReviewContractError && error.code === "field-pair",
	);
});

test("ordinary facade derives compact start authority and finalizes a clean review with evidence hashed only at finalization", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	assert.equal(started.state, "reviewing");
	assert.equal(started.risk_tier, "medium");
	assert.equal(started.selected_lenses.length, 1);
	assert.equal(started.correction_budget, 1);
	const before = discoverCompactReview(root, started.lineage_id).record.state;
	assert.equal(before.final_evidence_hash, undefined);

	const finalized = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: {
			lens_results: [{ findings: [], evidence: ["exact candidate tree reviewed"] }],
		},
		final_evidence: "focused tests and full suite passed",
		final_verification_passed: true,
	});
	assert.equal(finalized.state, "approved");
	assert.ok(finalized.receipt_path);
	const terminal = discoverCompactReview(root, started.lineage_id, true).record.state;
	assert.match(terminal.final_evidence_hash ?? "", /^[0-9a-f]{64}$/);

	const replay = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id });
	assert.equal(replay.store_revision, finalized.store_revision);
	assert.equal(replay.state, "approved");
});

test("facade exposes native refuter IDs without mutation before an identical second call", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	const before = discoverCompactReview(root, started.lineage_id).record;
	const lensResults = [{ findings: [{
		location: "value.ts:1", severity: "CRITICAL", claim: "The value may be invalid.",
		evidence_class: "inferential", causal_disposition: "introduced",
		proof_refs: ["differential-test:tests/value.test.ts"],
	}], evidence: [] }];
	const first = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: { lens_results: lensResults } });
	assert.equal(first.store_revision, before.revision);
	assert.equal(first.state, "reviewing");
	assert.deepEqual(first.refuter_request?.findings.map(({ id }) => id), ["READABILITY-001"]);
	const refuterResults = [{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: ["differential-test:tests/value.test.ts"] }];
	assert.throws(() => finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: {
		lens_results: lensResults, refuter_request_hash: "0".repeat(64), refuter_results: refuterResults,
	} }), /request hash/i);
	assert.throws(() => finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: {
		lens_results: [{ ...lensResults[0]!, evidence: ["changed"] }],
		refuter_request_hash: first.refuter_request?.request_hash,
		refuter_results: refuterResults,
	} }), /request hash/i);
	assert.equal(discoverCompactReview(root, started.lineage_id).record.revision, before.revision);
	const second = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: { lens_results: lensResults },
		refuter_batch: {
			schema: "gentle-ai.refuter-result-batch/v1",
			request_hash: first.refuter_request?.request_hash,
			results: refuterResults,
		},
	});
	assert.equal(second.state, "validating");
});

test("malformed refuter batches escalate atomically and replay idempotently", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, lineageId: "malformed-refuter", policyHash: "a".repeat(64) });
	const lensResults = [{ findings: [{
		location: "value.ts:1", severity: "CRITICAL", claim: "The value may be invalid.",
		evidence_class: "inferential", causal_disposition: "introduced", proof_refs: ["differential-test:tests/value.test.ts"],
	}], evidence: [] }];
	const first = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: { lens_results: lensResults } });
	const terminal = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: { lens_results: lensResults },
		refuter_batch: `prose ${JSON.stringify({ schema: "gentle-ai.refuter-result-batch/v1", request_hash: first.refuter_request?.request_hash, results: [] })}`,
	});
	assert.equal(terminal.state, "escalated");
	const state = discoverCompactReview(root, started.lineage_id, true).record.state;
	assert.deepEqual(state.correction_ids, []);
	assert.equal(state.outcomes["READABILITY-001"], "inconclusive");
	assert.match(state.escalation_reasons.join("\n"), /refuter batch rejected/i);
	assert.equal(finalizeCompactReview({ cwd: root, lineageId: started.lineage_id }).store_revision, terminal.store_revision);
});

test("facade freezes a pre-edit forecast, derives actual correction lines, and runs one targeted validator", (t) => {
	const root = repository(t);
	writeFileSync(join(root, "value.ts"), [
		"export const value = 2;",
		"export const one = 1;",
		"export const two = 2;",
		"export const three = 3;",
		"export const four = 4;",
		"",
	].join("\n"));
	const started = startCompactReview({ cwd: root, lineageId: "facade-correction", policyHash: "a".repeat(64) });
	const reviewed = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: {
			lens_results: [{
				findings: [{
					id: "READABILITY-001",
					location: "value.ts:1",
					severity: "BLOCKER",
					claim: "The candidate uses the wrong exported value.",
					evidence_class: "deterministic",
					causal_disposition: "introduced",
					proof_refs: ["changed-hunk:value.ts:1"],
				}],
				evidence: [],
			}],
		},
	});
	assert.equal(reviewed.state, "correction_required");
	const forecast = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, correction_line_forecast: 2 });
	assert.equal(forecast.state, "correction_required");

	writeFileSync(join(root, "value.ts"), readFileSync(join(root, "value.ts"), "utf8").replace("value = 2", "value = 3"));
	const validation = {
		original_criteria: { passed: true, evidence: ["original acceptance suite passed"] },
		correction_regression: { passed: true, evidence: ["wrong-value regression passed"] },
	};
	const handoff = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id });
	assert.equal(handoff.state, "correction_required");
	assert.deepEqual(handoff.validator_request?.body.correction_ids, ["READABILITY-001"]);
	assert.deepEqual(handoff.repair_report?.allowed_paths, ["value.ts"]);
	assert.throws(() => finalizeCompactReview({
		cwd: root, lineageId: started.lineage_id,
		validation: { request_hash: "0".repeat(64), correction_ids: ["READABILITY-001"], ...validation, fix_caused_findings: [], follow_ups: [] },
	}), /frozen native validator request/i);
	const terminal = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		validation: { request_hash: handoff.validator_request!.request_hash, correction_ids: ["READABILITY-001"], ...validation, fix_caused_findings: [], follow_ups: [] },
		final_evidence: "focused and full verification passed",
		final_verification_passed: true,
	});
	assert.equal(terminal.state, "approved");
	assert.equal(terminal.repair_report?.phase, "approved");
	const state = discoverCompactReview(root, started.lineage_id, true).record.state;
	assert.equal(state.correction?.changed_lines, 2);
	assert.equal(state.validation?.correction_ids[0], "READABILITY-001");
});

test("facade freezes validator scope without caller-predeclared results", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	const review = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: {
			lens_results: [{
				findings: [{
					location: "value.ts:1", severity: "CRITICAL", claim: "Value must be corrected.",
					evidence_class: "deterministic", causal_disposition: "introduced", proof_refs: ["changed-hunk:value.ts:1"],
				}], evidence: [],
			}],
		},
		correction_line_forecast: 1,
	});
	assert.equal(review.state, "correction_required");
	writeFileSync(join(root, "value.ts"), readFileSync(join(root, "value.ts"), "utf8").replace("value = 2", "value = 3"));
	const originalProof = {
		original_criteria: { passed: true, evidence: ["original acceptance passed"] },
		correction_regression: { passed: true, evidence: ["correction regression passed"] },
	};
	const request = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, validation_proof: originalProof }).validator_request!;
	const substitutedProof = {
		original_criteria: { passed: false, evidence: ["independent acceptance failure"] },
		correction_regression: { passed: true, evidence: ["independent regression evidence"] },
	};
	const after = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, validation_proof: substitutedProof });
	assert.equal(after.validator_request?.request_hash, request.request_hash);
});

test("facade blocks a caller-supplied alternate lineage for an unchanged terminal target", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, lineageId: "first", policyHash: "a".repeat(64) });
	const terminal = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: { lens_results: [{ findings: [], evidence: [] }] },
		final_evidence: "verification passed",
		final_verification_passed: true,
	});
	assert.equal(terminal.state, "approved");
	assert.throws(
		() => startCompactReview({ cwd: root, lineageId: "alternate", policyHash: "a".repeat(64) }),
		/approved authority already exists for this review target/i,
	);
	const differentPolicy = startCompactReview({ cwd: root, lineageId: "different-policy", policyHash: "b".repeat(64) });
	assert.equal(differentPolicy.state, "reviewing");
	writeFileSync(join(root, "value.ts"), "export const value = 3;\n");
	const alternate = startCompactReview({ cwd: root, lineageId: "alternate", policyHash: "a".repeat(64) });
	const statePath = discoverCompactReview(root, alternate.lineage_id).store.statePath;
	writeFileSync(statePath, "malformed compact state");
	assert.throws(() => discoverCompactReview(root), /compact review state is malformed|state is unavailable/i);
});

for (const kind of ["binary", "mode-only"] as const) {
	test(`facade routes a ${kind} candidate through one lens`, (t) => {
		const root = repository(t);
		if (kind === "binary") {
			writeFileSync(join(root, "value.ts"), Buffer.from([0, 1, 2, 3]));
		} else {
			writeFileSync(join(root, "value.ts"), "export const value = 1;\n");
			chmodSync(join(root, "value.ts"), 0o755);
		}
		const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
		assert.equal(started.original_changed_lines, 0);
		assert.equal(started.risk_tier, "medium");
		assert.equal(started.selected_lenses.length, 1);
		const terminal = finalizeCompactReview({
			cwd: root,
			lineageId: started.lineage_id,
			review_result: { lens_results: [{ findings: [], evidence: [`${kind} candidate reviewed`] }] },
			final_evidence: `${kind} lifecycle verified`,
			final_verification_passed: true,
		});
		assert.equal(terminal.state, "approved");
	});
}

test("terminal binding rejects material candidate dimensions while allowing staging-state changes", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, lineageId: "terminal-a", policyHash: "a".repeat(64) });
	finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: { lens_results: [{ findings: [], evidence: [] }] }, final_evidence: "passed", final_verification_passed: true });
	const { record, receipt } = discoverCompactReview(root, started.lineage_id, true).store.loadTerminalReceipt();
	const snapshot = record.state.initial_snapshot;
	const binding = createTerminalReviewCandidateBinding("repository-a", receipt);
	const live: LiveReviewCandidateBinding = {
		repository_id: "repository-a",
		base_tree: snapshot.base_tree,
		complete_snapshot_tree: receipt.body.final_candidate_tree,
		initial_review_tree: snapshot.initial_review_tree,
		genesis_paths: [...record.state.genesis_paths],
		intended_untracked: [...record.state.intended_untracked],
	};
	assert.equal(matchesTerminalReviewCandidateBinding(live, "a".repeat(64), binding), true);
	for (const candidate of [
		{ ...live, repository_id: "repository-b" },
		{ ...live, base_tree: "b".repeat(40) },
		{ ...live, complete_snapshot_tree: "c".repeat(40) },
		{ ...live, genesis_paths: ["other.ts"] },
	]) assert.equal(matchesTerminalReviewCandidateBinding(candidate, "a".repeat(64), binding), false);
	assert.equal(matchesTerminalReviewCandidateBinding({ ...live, intended_untracked: [] }, "a".repeat(64), binding), true);
	assert.equal(matchesTerminalReviewCandidateBinding(live, "b".repeat(64), binding), false);
});

test("facade fails closed when a detached terminal receipt is discovered", (t) => {
	const root = repository(t);
	const first = startCompactReview({ cwd: root, lineageId: "first", policyHash: "a".repeat(64) });
	finalizeCompactReview({ cwd: root, lineageId: first.lineage_id, review_result: { lens_results: [{ findings: [], evidence: [] }] }, final_evidence: "passed", final_verification_passed: true });
	const compactRoot = join(root, ".git", "gentle-ai", "reviews", "compact-v2");
	const parked = join(root, ".git", "gentle-ai", "reviews", "parked-first");
	const detachedReceipt = readFileSync(discoverCompactReview(root, first.lineage_id, true).store.receiptPath, "utf8");
	execFileSync("mv", [join(compactRoot, "first"), parked]);
	const second = startCompactReview({ cwd: root, lineageId: "second", policyHash: "a".repeat(64) });
	finalizeCompactReview({ cwd: root, lineageId: second.lineage_id, review_result: { lens_results: [{ findings: [], evidence: [] }] }, final_evidence: "passed", final_verification_passed: true });
	writeFileSync(discoverCompactReview(root, second.lineage_id, true).store.receiptPath, detachedReceipt);
	execFileSync("mv", [parked, join(compactRoot, "first")]);
	writeFileSync(join(root, "value.ts"), "export const value = 3;\n");
	assert.throws(
		() => startCompactReview({ cwd: root, lineageId: "third", policyHash: "a".repeat(64) }),
		/receipt does not match current terminal authority/i,
	);
});

test("facade rejects explicit terminal lineage mismatch and reports duplicate exact terminals deterministically", (t) => {
	const root = repository(t);
	const first = startCompactReview({ cwd: root, lineageId: "first", policyHash: "a".repeat(64) });
	finalizeCompactReview({ cwd: root, lineageId: first.lineage_id, review_result: { lens_results: [{ findings: [], evidence: [] }] }, final_evidence: "passed", final_verification_passed: true });
	const compactRoot = join(root, ".git", "gentle-ai", "reviews", "compact-v2");
	const parked = join(root, ".git", "gentle-ai", "reviews", "parked-first");
	execFileSync("mv", [join(compactRoot, "first"), parked]);
	const second = startCompactReview({ cwd: root, lineageId: "second", policyHash: "a".repeat(64) });
	finalizeCompactReview({ cwd: root, lineageId: second.lineage_id, review_result: { lens_results: [{ findings: [], evidence: [] }] }, final_evidence: "passed", final_verification_passed: true });
	execFileSync("mv", [parked, join(compactRoot, "first")]);
	assert.throws(
		() => startCompactReview({ cwd: root, lineageId: "third", policyHash: "a".repeat(64) }),
		(error: unknown) => error instanceof CompactReviewTerminalAmbiguityError && error.lineageIds.join(",") === "first,second",
	);
	writeFileSync(join(root, "value.ts"), "export const value = 3;\n");
	assert.throws(
		() => startCompactReview({ cwd: root, lineageId: "first", policyHash: "a".repeat(64) }),
		(error: unknown) => error instanceof CompactReviewLineageBindingMismatchError && error.lineageId === "first",
	);
});

test("facade rejects a correction forecast recorded after editing began", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, lineageId: "late-forecast", policyHash: "a".repeat(64) });
	finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: {
			lens_results: [{ findings: [{
				location: "value.ts:1",
				severity: "BLOCKER",
				claim: "The candidate uses the wrong value.",
				evidence_class: "deterministic",
				causal_disposition: "introduced",
				proof_refs: ["changed-hunk:value.ts:1"],
			}], evidence: [] }],
		},
	});
	writeFileSync(join(root, "value.ts"), "export const value = 3;\n");
	assert.throws(
		() => finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, correction_line_forecast: 1 }),
		/forecast must be recorded before editing/i,
	);
});
