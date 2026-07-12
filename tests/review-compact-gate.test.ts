import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { validateCompactReviewGate } from "../lib/review-compact-gate.ts";
import { domainHashV1 } from "../lib/review-canonical.ts";
import { discoverCompactReview, finalizeCompactReview, startCompactReview } from "../lib/review-facade.ts";
import {
	createSupersessionEnvelopeV1,
	inspectApprovedCompactSuccessorV1,
	inspectRecoverableGraphSourceV1,
	SupersessionStoreV1,
} from "../lib/review-authority-supersession.ts";
import { CompactReviewStoreV2 } from "../lib/review-compact-store.ts";
import { REVIEW_MODE, REVIEW_TRANSITION, ReviewTransactionStore, createReviewState, type GateTargetV1 } from "../lib/review-transaction.ts";
import { GATE_TARGET_KIND, PUSH_UPDATE_KIND, resolveConfiguredPushDestinationV1 } from "../lib/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import { testSnapshot } from "./review-test-fixtures.ts";

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
	const allowed = validateCompactReviewGate({
		cwd: root,
		lineageId,
		changeName: "recover-legacy-review-authority",
		deriveTarget,
	});
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

test("compact gate fails closed for a recovery-required marker without a bound change, but not an empty marker directory", (t) => {
	const root = repository(t);
	const lineageId = approved(root);
	const store = SupersessionStoreV1.forRepository(root);
	mkdirSync(join(store.root, "recovery-required-v1"), { recursive: true });
	const emptyDirectory = validateCompactReviewGate({ cwd: root, lineageId, deriveTarget: () => deriveIntendedCommitTarget(root) });
	assert.equal(emptyDirectory.status, "allow", emptyDirectory.reason);
	writeFileSync(join(store.root, "recovery-required-v1", `${domainHashV1("openspec-change-name", "recover-legacy-review-authority")}.json`), "recovery-required");
	const missingChange = validateCompactReviewGate({ cwd: root, lineageId, deriveTarget: () => deriveIntendedCommitTarget(root) });
	assert.equal(missingChange.status, "deny", missingChange.reason);
	const missingRecord = validateCompactReviewGate({ cwd: root, lineageId, changeName: "recover-legacy-review-authority", deriveTarget: () => deriveIntendedCommitTarget(root) });
	assert.equal(missingRecord.status, "deny", missingRecord.reason);
});

test("eligible graph-v1 authority requires a change-bound supersession even when its OpenSpec change and marker are absent", (t) => {
	const omitted = recoveredFixture(t);
	const changeName = "recover-legacy-review-authority";
	const store = SupersessionStoreV1.forRepository(omitted.root);
	rmSync(join(omitted.root, "openspec", "changes", changeName), { recursive: true, force: true });
	unlinkSync(join(store.root, "recovery-required-v1", `${domainHashV1("openspec-change-name", changeName)}.json`));
	const withoutChange = validateCompactReviewGate({
		cwd: omitted.root,
		deriveTarget: recoveredGateTargets(omitted)["pre-commit"],
	});
	assert.equal(withoutChange.status, "deny", withoutChange.reason);
	const withoutRecord = validateCompactReviewGate({
		cwd: omitted.root,
		changeName,
		deriveTarget: recoveredGateTargets(omitted)["pre-commit"],
	});
	assert.equal(withoutRecord.status, "deny", withoutRecord.reason);

	const corrupt = recoveredFixture(t);
	const marker = join(
		SupersessionStoreV1.forRepository(corrupt.root).root,
		"recovery-required-v1",
		`${domainHashV1("openspec-change-name", "recover-legacy-review-authority")}.json`,
	);
	writeFileSync(marker, "corrupt marker");
	const withCorruptMarker = validateCompactReviewGate({
		cwd: corrupt.root,
		changeName: "recover-legacy-review-authority",
		deriveTarget: recoveredGateTargets(corrupt)["pre-commit"],
	});
	assert.equal(withCorruptMarker.status, "deny", withCorruptMarker.reason);
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


function recoveredFixture(t: test.TestContext) {
	const root = repository(t);
	const baseCommit = git(root, "rev-parse", "HEAD");
	const baseTree = git(root, "rev-parse", "HEAD^{tree}");
	const successorLineage = approved(root);
	const successorState = CompactReviewStoreV2.forRepository(root, successorLineage).load().state;
	const finalTree = git(root, "write-tree");
	const graphLineage = "legacy-source";
	const graphStore = ReviewTransactionStore.forRepository(root);
	const graphState = createReviewState({
		lineageId: graphLineage,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({ baseTree, completeTree: finalTree, genesisPaths: successorState.genesis_paths, route: REVIEW_ROUTE.STANDARD, lenses: [REVIEW_LENS.READABILITY] }),
		evidenceHash: "a".repeat(64),
		budget: { review_batches: 1, review_actors: 1, refuter_batches: 1, fix_batches: 1, validator_runs: 1, final_verifications: 1, judgment_rounds: 0, judge_runs: 0 },
	});
	mkdirSync(join(root, "openspec", "changes", "recover-legacy-review-authority"), { recursive: true });
	graphStore.create(graphState, "start");
	graphStore.runReducerOperation({ lineageId: graphLineage, transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY, idempotencyKey: "discover", input: { rows: [] } });
	graphStore.runReducerOperation({ lineageId: graphLineage, transition: REVIEW_TRANSITION.ORDINARY_EVIDENCE, idempotencyKey: "evidence", input: { deterministicResults: [] } });
	graphStore.runReducerOperation({ lineageId: graphLineage, transition: REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION, idempotencyKey: "verify", input: { passed: true } });
	git(root, "-c", "user.name=Gate", "-c", "user.email=gate@example.invalid", "commit", "-m", "reviewed");
	const finalCommit = git(root, "rev-parse", "HEAD");
	git(root, "branch", "base", baseCommit);
	git(root, "branch", "final", finalCommit);
	git(root, "-c", "user.name=Gate", "-c", "user.email=gate@example.invalid", "tag", "-a", "v1.2.3", "-m", "release", finalCommit);
	const remotePath = join(root, "remote.git");
	execFileSync("git", ["init", "--bare", remotePath], { stdio: "ignore" });
	git(root, "remote", "add", "origin", remotePath);
	git(root, "push", "origin", "base:refs/heads/feature");
	const source = inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", graphLineage);
	const successor = inspectApprovedCompactSuccessorV1(root, successorLineage);
	const state = CompactReviewStoreV2.forRepository(root, successorLineage).load().state;
	const equivalence = {
		base_tree: (domainHashV1("review-recovery-tree", state.initial_snapshot.base_tree)),
		complete_snapshot_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.complete_snapshot_tree),
		initial_review_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.initial_review_tree),
		final_candidate_tree: domainHashV1("review-recovery-tree", state.current_candidate_tree),
		review_projection_hash: domainHashV1("review-recovery-projection", state.initial_snapshot.review_projection),
		genesis_paths_hash: domainHashV1("compact-paths", state.genesis_paths),
		scope_digest: domainHashV1("review-recovery-scope", { base_tree: state.initial_snapshot.base_tree, complete_snapshot_tree: state.initial_snapshot.complete_snapshot_tree, initial_review_tree: state.initial_snapshot.initial_review_tree, final_candidate_tree: state.current_candidate_tree, genesis_paths: state.genesis_paths, intended_untracked: state.intended_untracked }),
		intended_untracked_hash: domainHashV1("compact-untracked", state.intended_untracked),
		intended_untracked_proof_hash: domainHashV1("review-recovery-empty-untracked", { candidate_tree: state.current_candidate_tree, paths: [] }),
		policy_hash: state.policy_hash,
		policy_evidence_hash: domainHashV1("review-recovery-policy-evidence", { policy_hash: state.policy_hash, runtime_identity_hash: state.runtime_identity.identity_hash }),
		source_receipt_hash: source.source.receipt_hash,
		successor_receipt_hash: successor.receipt_hash,
		source_ledger_hash: source.source.frozen_ledger_hash,
		successor_ledger_hash: successor.ledger_hash,
	};
	SupersessionStoreV1.forRepository(root).install("recover-legacy-review-authority", createSupersessionEnvelopeV1({
		schema: "gentle-ai.review-authority-supersession/v1", operation_id: "b".repeat(64), request_hash: "c".repeat(64), sequence: 0, predecessor_recovery_id: null,
		repository: source.repository, change: source.change, source: source.source, successor, equivalence, authorization_hash: "d".repeat(64),
	}));
	return { root, graphRoot: graphStore.root, successorLineage, baseCommit, baseTree, finalCommit, finalTree, tagObject: git(root, "rev-parse", "refs/tags/v1.2.3"), remote: "origin" };
}


function recoveredGateTargets(fixture: ReturnType<typeof recoveredFixture>): Record<string, () => { target: GateTargetV1; actualIntendedCommitTree?: string }> {
	const destination = resolveConfiguredPushDestinationV1(fixture.root, fixture.remote);
	return {
		"pre-commit": () => ({ target: { kind: GATE_TARGET_KIND.INTENDED_COMMIT, intended_commit_tree: fixture.finalTree }, actualIntendedCommitTree: fixture.finalTree }),
		"pre-push": () => ({ target: { kind: GATE_TARGET_KIND.PUSH, remote: fixture.remote, destination_id: destination.destination_id, updates: [{ kind: PUSH_UPDATE_KIND.UPDATE, source_ref: "refs/heads/final", destination_ref: "refs/heads/feature", old_object: fixture.baseCommit, old_peeled_commit: fixture.baseCommit, old_tree: fixture.baseTree, new_object: fixture.finalCommit, new_peeled_commit: fixture.finalCommit, new_tree: fixture.finalTree }] } }),
		"pre-PR": () => ({ target: { kind: GATE_TARGET_KIND.PULL_REQUEST, base_ref: "refs/heads/base", base_commit: fixture.baseCommit, base_tree: fixture.baseTree, head_ref: "refs/heads/final", head_commit: fixture.finalCommit, head_tree: fixture.finalTree } }),
		release: () => ({ target: { kind: GATE_TARGET_KIND.RELEASE, tag_ref: "refs/tags/v1.2.3", tag_object: fixture.tagObject, peeled_commit: fixture.finalCommit, tree: fixture.finalTree } }),
	};
}

function mutateRecoveredSource(fixture: ReturnType<typeof recoveredFixture>): void {
	writeFileSync(join(dirname(fixture.graphRoot), "IDENTITY"), "corrupt source identity");
}

function assertRecoveredGateLifecycle(t: test.TestContext, gate: keyof ReturnType<typeof recoveredGateTargets>): void {
	const exact = recoveredFixture(t);
	const exactAllowed = validateCompactReviewGate({ cwd: exact.root, changeName: "recover-legacy-review-authority", deriveTarget: recoveredGateTargets(exact)[gate] });
	assert.equal(exactAllowed.status, "allow", `${gate}: ${exactAllowed.reason}`);
	assert.equal(exactAllowed.actor_count, 0);

	const source = recoveredFixture(t);
	const sourceDenied = validateCompactReviewGate({ cwd: source.root, changeName: "recover-legacy-review-authority", deriveTarget: recoveredGateTargets(source)[gate], beforeFinalRecheck: () => mutateRecoveredSource(source) });
	assert.equal(sourceDenied.status, "deny", `${gate}: source mutation must deny`);
	assert.equal(sourceDenied.actor_count, 0);

	const authority = recoveredFixture(t);
	const authorityDenied = validateCompactReviewGate({ cwd: authority.root, changeName: "recover-legacy-review-authority", deriveTarget: recoveredGateTargets(authority)[gate], beforeFinalRecheck: () => writeFileSync(CompactReviewStoreV2.forRepository(authority.root, authority.successorLineage).receiptPath, "corrupt compact authority") });
	assert.equal(authorityDenied.status, "deny", `${gate}: authority mutation must deny`);
	assert.equal(authorityDenied.actor_count, 0);

	const target = recoveredFixture(t);
	const targetDenied = validateCompactReviewGate({ cwd: target.root, changeName: "recover-legacy-review-authority", deriveTarget: recoveredGateTargets(target)[gate], beforeFinalRecheck: () => { target.finalTree = target.baseTree; } });
	assert.equal(targetDenied.status, "deny", `${gate}: target mutation must deny`);
	assert.equal(targetDenied.actor_count, 0);
}

test("recovered chain pre-commit gate allows exact authority and denies final-recheck drift", (t) => assertRecoveredGateLifecycle(t, "pre-commit"));
test("recovered chain pre-push gate allows exact authority and denies final-recheck drift", (t) => assertRecoveredGateLifecycle(t, "pre-push"));
test("recovered chain pre-PR gate allows exact authority and denies final-recheck drift", (t) => assertRecoveredGateLifecycle(t, "pre-PR"));
test("recovered chain release gate allows exact authority and denies final-recheck drift", (t) => assertRecoveredGateLifecycle(t, "release"));

test("recovered gate denies when its supersession record disappears before final recheck", (t) => {
	const fixture = recoveredFixture(t);
	const result = validateCompactReviewGate({
		cwd: fixture.root,
		changeName: "recover-legacy-review-authority",
		deriveTarget: recoveredGateTargets(fixture)["pre-commit"],
		beforeFinalRecheck: () => rmSync(SupersessionStoreV1.forRepository(fixture.root).root, { recursive: true, force: true }),
	});
	assert.equal(result.status, "deny", result.reason);
	assert.equal(result.actor_count, 0);
});

test("recovered gate denies when its supersession state becomes unsupported before final recheck", (t) => {
	const fixture = recoveredFixture(t);
	const store = SupersessionStoreV1.forRepository(fixture.root);
	const result = validateCompactReviewGate({
		cwd: fixture.root,
		changeName: "recover-legacy-review-authority",
		deriveTarget: recoveredGateTargets(fixture)["pre-commit"],
		beforeFinalRecheck: () => {
			rmSync(store.root, { recursive: true, force: true });
			writeFileSync(store.root, "unsupported supersession state");
		},
	});
	assert.equal(result.status, "deny", result.reason);
	assert.equal(result.actor_count, 0);
});
