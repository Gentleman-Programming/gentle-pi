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

function deriveIntendedCommitTarget(root: string) {
	const tree = git(root, "write-tree");
	return {
		target: { kind: GATE_TARGET_KIND.INTENDED_COMMIT, intended_commit_tree: tree } as const,
		actualIntendedCommitTree: tree,
	};
}

test("omitted final verification result rejects before compact authority mutation", (t) => {
	const root = repository(t);
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	const before = discoverCompactReview(root, started.lineage_id).record;
	assert.throws(
		() => finalizeCompactReview({
			cwd: root,
			lineageId: started.lineage_id,
			review_result: { lens_results: [{ findings: [], evidence: [] }] },
			final_evidence: "verification result was never reported",
		}),
		/final evidence and result/i,
	);
	const after = discoverCompactReview(root, started.lineage_id).record;
	assert.equal(after.revision, before.revision);
	assert.equal(after.state.state, "reviewing");
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

test("compact pre-commit gate preserves an approved receipt across exact staging of reviewed new files", (t) => {
	const root = repository(t);
	writeFileSync(join(root, "new-value.ts"), "export const newValue = 1;\n");
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: { lens_results: [{ findings: [], evidence: [] }] },
		final_evidence: "verification passed",
		final_verification_passed: true,
	});

	git(root, "add", "value.ts", "new-value.ts");
	const allowed = validateCompactReviewGate({
		cwd: root,
		lineageId: started.lineage_id,
		deriveTarget: () => deriveIntendedCommitTarget(root),
	});
	assert.equal(allowed.status, "allow", allowed.reason);
});

test("compact pre-commit gate rejects partial or additional staging around reviewed new files", (t) => {
	const root = repository(t);
	writeFileSync(join(root, "first.ts"), "export const first = 1;\n");
	writeFileSync(join(root, "second.ts"), "export const second = 2;\n");
	const started = startCompactReview({ cwd: root, policyHash: "a".repeat(64) });
	finalizeCompactReview({
		cwd: root,
		lineageId: started.lineage_id,
		review_result: { lens_results: [{ findings: [], evidence: [] }] },
		final_evidence: "verification passed",
		final_verification_passed: true,
	});

	git(root, "add", "value.ts", "first.ts");
	const partial = validateCompactReviewGate({
		cwd: root,
		lineageId: started.lineage_id,
		deriveTarget: () => deriveIntendedCommitTarget(root),
	});
	assert.equal(partial.status, "scope-changed");

	git(root, "add", "second.ts");
	writeFileSync(join(root, "extra.ts"), "export const extra = 3;\n");
	git(root, "add", "extra.ts");
	const additional = validateCompactReviewGate({
		cwd: root,
		lineageId: started.lineage_id,
		deriveTarget: () => deriveIntendedCommitTarget(root),
	});
	assert.equal(additional.status, "scope-changed");
});
