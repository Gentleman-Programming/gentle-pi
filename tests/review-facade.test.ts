import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	discoverCompactReview,
	finalizeCompactReview,
	startCompactReview,
} from "../lib/review-facade.ts";

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
	const refuterResults = [{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: ["before-after:proof"] }];
	assert.throws(() => finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: {
		lens_results: lensResults, refuter_request_hash: "0".repeat(64), refuter_results: refuterResults,
	} }), /request hash/i);
	assert.throws(() => finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: {
		lens_results: [{ ...lensResults[0]!, evidence: ["changed"] }],
		refuter_request_hash: first.refuter_request?.request_hash,
		refuter_results: refuterResults,
	} }), /request hash/i);
	assert.equal(discoverCompactReview(root, started.lineage_id).record.revision, before.revision);
	const second = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: {
		lens_results: lensResults, refuter_request_hash: first.refuter_request?.request_hash,
		refuter_results: refuterResults,
	} });
	assert.equal(second.state, "validating");
});

test("malformed refuter rows persist escalation and cannot be replaced", (t) => {
	for (const [index, malformed] of [null, "invalid", {}].entries()) {
		const root = repository(t);
		const started = startCompactReview({ cwd: root, lineageId: `malformed-refuter-${index}`, policyHash: "a".repeat(64) });
		const lensResults = [{ findings: [{
			location: "value.ts:1", severity: "CRITICAL", claim: "The value may be invalid.",
			evidence_class: "inferential", causal_disposition: "introduced", proof_refs: ["differential-test:tests/value.test.ts"],
		}], evidence: [] }];
		const first = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: { lens_results: lensResults } });
		const terminal = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: {
			lens_results: lensResults, refuter_request_hash: first.refuter_request?.request_hash, refuter_results: [malformed] as never,
		} });
		assert.equal(terminal.state, "escalated");
		const retry = finalizeCompactReview({ cwd: root, lineageId: started.lineage_id, review_result: {
			lens_results: lensResults, refuter_request_hash: first.refuter_request?.request_hash,
			refuter_results: [{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: ["before-after:proof"] }],
		} });
		assert.equal(retry.state, "escalated");
		assert.equal(retry.store_revision, terminal.store_revision);
	}
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
	const terminal = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		validation: {
			correction_ids: ["READABILITY-001"],
			original_criteria: { passed: true, evidence: ["original acceptance suite passed"] },
			correction_regression: { passed: true, evidence: ["wrong-value regression passed"] },
			fix_caused_findings: [],
			follow_ups: [],
		},
		final_evidence: "focused and full verification passed",
		final_verification_passed: true,
	});
	assert.equal(terminal.state, "approved");
	const state = discoverCompactReview(root, started.lineage_id, true).record.state;
	assert.equal(state.correction?.changed_lines, 2);
	assert.equal(state.validation?.correction_ids[0], "READABILITY-001");
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
