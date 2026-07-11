import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateCompactReviewGate } from "../lib/review-compact-gate.ts";
import { discoverCompactReview, finalizeCompactReview, startCompactReview } from "../lib/review-facade.ts";
import { GATE_TARGET_KIND } from "../lib/review-transaction.ts";

function repository(t: test.TestContext): string {
	const parent = mkdtempSync(join(tmpdir(), "compact-gate-"));
	const root = join(parent, "repo");
	mkdirSync(root);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "value.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync("git", ["-c", "user.name=Gate", "-c", "user.email=gate@example.invalid", "commit", "-m", "base"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "value.ts"), "export const value = 2;\n");
	return root;
}

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function approved(root: string): string {
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: { lens_results: [{ findings: [], evidence: [] }] },
		final_evidence: "verification passed",
		final_verification_passed: true,
	});
	git(root, "add", ".");
	return started.lineage_id;
}

test("omitted final verification cannot approve a receipt or gate", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	const finalized = finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: { lens_results: [{ findings: [], evidence: [] }] },
		final_evidence: "verification result was never reported",
	});
	assert.equal(finalized.state, "escalated");
	git(root, "add", ".");
	const tree = git(root, "write-tree");
	const denied = validateCompactReviewGate({
		cwd: root,
		lineageId: started.lineage_id,
		deriveTarget: () => ({
			target: { kind: GATE_TARGET_KIND.INTENDED_COMMIT, intended_commit_tree: tree },
			actualIntendedCommitTree: tree,
		}),
	});
	assert.equal(denied.status, "deny");
	assert.match(denied.reason, /escalated/i);
});

test("compact gate is read-only and closes authority and target TOCTOU before allow", (t) => {
	const root = repository(t);
	const lineageId = approved(root);
	const before = discoverCompactReview(root, lineageId, true).record;
	const deriveTarget = () => {
		const tree = git(root, "write-tree");
		return {
			target: { kind: GATE_TARGET_KIND.INTENDED_COMMIT, intended_commit_tree: tree } as const,
			actualIntendedCommitTree: tree,
		};
	};
	const allowed = validateCompactReviewGate({ cwd: root, lineageId, deriveTarget });
	assert.equal(allowed.status, "allow", allowed.reason);
	assert.equal(allowed.actor_count, 0);
	assert.equal(discoverCompactReview(root, lineageId, true).record.revision, before.revision);

	const denied = validateCompactReviewGate({
		cwd: root,
		lineageId,
		deriveTarget,
		beforeFinalRecheck() {
			writeFileSync(join(root, "value.ts"), "export const value = 3;\n");
			git(root, "add", ".");
		},
	});
	assert.equal(denied.status, "deny");
	assert.match(denied.reason, /changed during final authorization/i);
});
