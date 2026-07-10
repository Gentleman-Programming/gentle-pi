import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import {
	GATE_RESULT,
	GATE_TARGET_KIND,
	PUSH_UPDATE_KIND,
	REVIEW_MODE,
	REVIEW_TRANSITION,
	TERMINAL_STATE,
	ReviewTransactionStore,
	canonicalHash,
	createReceiptForState,
	createReviewState,
	evaluateGateTarget,
	validateReviewGate,
	type GateTargetV1,
	type ReceiptBodyV1,
	type ReceiptEnvelopeV1,
	type ReviewBudgetV1,
	type ReviewStateV1,
} from "../lib/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import { testSnapshot } from "./review-test-fixtures.ts";

interface GateRepository {
	repository: string;
	remote: string;
	baseTree: string;
	finalTree: string;
	changedTree: string;
	baseCommit: string;
	finalCommit: string;
	tagObject: string;
}

function createGateRepository(t: test.TestContext): GateRepository {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-gate-repo-"));
	const repository = join(parent, "repo");
	mkdirSync(repository);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const git = (...args: string[]): string =>
		execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	writeFileSync(join(repository, "app.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=Gate Test", "-c", "user.email=gate@example.invalid", "commit", "-m", "base");
	const baseCommit = git("rev-parse", "HEAD");
	const baseTree = git("rev-parse", "HEAD^{tree}");
	git("branch", "base", baseCommit);
	writeFileSync(join(repository, "app.ts"), "export const value = 2;\n");
	git("add", ".");
	git("-c", "user.name=Gate Test", "-c", "user.email=gate@example.invalid", "commit", "-m", "final");
	const finalCommit = git("rev-parse", "HEAD");
	const finalTree = git("rev-parse", "HEAD^{tree}");
	git("branch", "final", finalCommit);
	git("-c", "user.name=Gate Test", "-c", "user.email=gate@example.invalid", "tag", "-a", "v1.2.3", "-m", "release", finalCommit);
	const tagObject = git("rev-parse", "refs/tags/v1.2.3^{object}");
	writeFileSync(join(repository, "app.ts"), "export const value = 3;\n");
	git("add", ".");
	git("-c", "user.name=Gate Test", "-c", "user.email=gate@example.invalid", "commit", "-m", "changed");
	const changedTree = git("rev-parse", "HEAD^{tree}");
	const remote = join(parent, "remote.git");
	execFileSync("git", ["clone", "--bare", repository, remote], {
		cwd: parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", remote, "update-ref", "refs/heads/main", baseCommit], {
		cwd: parent,
	});
	git("remote", "add", "origin", remote);
	git("update-ref", "refs/heads/main", finalCommit);
	return {
		repository,
		remote: "origin",
		baseTree,
		finalTree,
		changedTree,
		baseCommit,
		finalCommit,
		tagObject,
	};
}

function budget(overrides: Partial<ReviewBudgetV1> = {}): ReviewBudgetV1 {
	return {
		review_batches: 1,
		review_actors: 0,
		refuter_batches: 1,
		fix_batches: 1,
		validator_runs: 1,
		final_verifications: 1,
		judgment_rounds: 0,
		judge_runs: 0,
		...overrides,
	};
}

function initialState(repository: GateRepository, lineageId = "approved-lineage"): ReviewStateV1 {
	return createReviewState({
		lineageId,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({
			baseTree: repository.baseTree,
			completeTree: repository.finalTree,
			route: REVIEW_ROUTE.STANDARD,
			lenses: [REVIEW_LENS.READABILITY],
		}),
		evidenceHash: "b".repeat(64),
		budget: budget({ review_actors: 1 }),
	});
}

function receiptFor(state: ReviewStateV1): ReceiptEnvelopeV1 {
	return createReceiptForState(state);
}

function temporaryAuthority(t: test.TestContext): GateRepository & {
	store: ReviewTransactionStore;
	receipt: ReceiptEnvelopeV1;
} {
	const repository = createGateRepository(t);
	const store = ReviewTransactionStore.forRepository(repository.repository);
	store.create(initialState(repository), "start-approved-lineage");
	store.runReducerOperation({
		lineageId: "approved-lineage",
		transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		idempotencyKey: "discover",
		input: { rows: [] },
	});
	store.runReducerOperation({
		lineageId: "approved-lineage",
		transition: REVIEW_TRANSITION.ORDINARY_EVIDENCE,
		idempotencyKey: "evidence",
		input: { deterministicResults: [] },
	});
	store.runReducerOperation({
		lineageId: "approved-lineage",
		transition: REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION,
		idempotencyKey: "verify",
		input: { passed: true },
	});
	const state = store.read("approved-lineage");
	return { ...repository, store, receipt: receiptFor(state) };
}

test("lifecycle command classification identifies gates but never runs review routing", () => {
	assert.equal(__testing.classifyReviewEvent("git commit -m fix"), "pre-commit");
	assert.equal(__testing.classifyReviewEvent("git -C /repo push origin main"), "pre-push");
	assert.equal(__testing.classifyReviewEvent("gh pr create --draft"), "pre-pr");
	assert.equal(__testing.classifyReviewEvent("gh release create v1.2.3"), "pre-release");
	assert.equal(__testing.classifyReviewEvent("git status"), null);
});

test("exact intended commit target allows with zero actors and journal replay is stable", (t) => {
	const { repository, finalTree, store, receipt } = temporaryAuthority(t);
	execFileSync("git", ["read-tree", finalTree], { cwd: repository });
	const target = {
		kind: GATE_TARGET_KIND.INTENDED_COMMIT,
		intended_commit_tree: finalTree,
	} as const;
	const first = validateReviewGate({
		store,
		receipt,
		target,
		repositoryCwd: repository,
		idempotencyKey: "gate-commit-1",
		scopeBudget: budget(),
	});
	assert.equal(first.status, GATE_RESULT.ALLOW);
	assert.equal(first.actor_count, 0);
	assert.equal(first.target_hash, canonicalHash(target));
	const replay = validateReviewGate({
		store: ReviewTransactionStore.forRepository(repository),
		receipt,
		target,
		repositoryCwd: repository,
		idempotencyKey: "gate-commit-1",
		scopeBudget: budget({ fix_batches: 99 }),
	});
	assert.deepEqual(replay, first);
	assert.equal(store.read(receipt.body.lineage_id).revision, 4);
});

test("intended commit target denies when the actual staged tree drifted after approval", (t) => {
	const { repository, finalTree, changedTree, receipt } = temporaryAuthority(t);
	assert.equal(
		execFileSync("git", ["write-tree"], { cwd: repository, encoding: "utf8" }).trim(),
		changedTree,
	);

	const result = evaluateGateTarget(
		receipt,
		{
			kind: GATE_TARGET_KIND.INTENDED_COMMIT,
			intended_commit_tree: finalTree,
		},
		repository,
	);

	assert.equal(result.status, GATE_RESULT.DENY);
	assert.match(result.reason, /staged tree.*intended commit tree/i);
});

test("changed exact target returns one deterministic child with a non-refreshing budget", (t) => {
	const { repository, changedTree, store, receipt } = temporaryAuthority(t);
	const target = {
		kind: GATE_TARGET_KIND.INTENDED_COMMIT,
		intended_commit_tree: changedTree,
	} as const;
	const first = validateReviewGate({
		store,
		receipt,
		target,
		repositoryCwd: repository,
		idempotencyKey: "scope-1",
		scopeBudget: budget({ review_actors: 4 }),
	});
	assert.equal(first.status, GATE_RESULT.SCOPE_CHANGED);
	assert.equal(first.actor_count, 0);
	assert.equal(first.child_claim?.target_tree, changedTree);
	assert.equal(first.child_claim?.budget.review_actors, 4);
	const replayUnderAnotherGateKey = validateReviewGate({
		store,
		receipt,
		target,
		repositoryCwd: repository,
		idempotencyKey: "scope-2",
		scopeBudget: budget({ review_actors: 99, fix_batches: 99 }),
	});
	assert.equal(
		replayUnderAnotherGateKey.child_claim?.child_lineage_id,
		first.child_claim?.child_lineage_id,
	);
	assert.equal(replayUnderAnotherGateKey.child_claim?.budget.review_actors, 4);
	assert.equal(replayUnderAnotherGateKey.child_claim?.budget.fix_batches, 1);
});

test("push gate allows normal same-name updates while preserving exact-old and create rules", (t) => {
	const authority = temporaryAuthority(t);
	const { repository, remote, baseTree, finalTree, baseCommit, finalCommit, receipt } = authority;
	const target = {
		kind: GATE_TARGET_KIND.PUSH,
		remote,
		updates: [
			{
				kind: PUSH_UPDATE_KIND.CREATE,
				source_ref: "refs/heads/final",
				destination_ref: "refs/heads/feature",
				old_object: null,
				old_peeled_commit: null,
				old_tree: null,
				new_object: finalCommit,
				new_peeled_commit: finalCommit,
				new_tree: finalTree,
			},
			{
				kind: PUSH_UPDATE_KIND.UPDATE,
				source_ref: "refs/heads/main",
				destination_ref: "refs/heads/main",
				old_object: baseCommit,
				old_peeled_commit: baseCommit,
				old_tree: baseTree,
				new_object: finalCommit,
				new_peeled_commit: finalCommit,
				new_tree: finalTree,
			},
		],
	} as const;
	const allowed = evaluateGateTarget(receipt, target, repository);
	assert.equal(allowed.status, GATE_RESULT.ALLOW, allowed.reason);
	assert.equal(allowed.actor_count, 0);
	const driftedUpdate = {
		kind: GATE_TARGET_KIND.PUSH,
		remote,
		updates: [{
			...target.updates[1],
			old_object: finalCommit,
			old_peeled_commit: finalCommit,
			old_tree: finalTree,
		}],
	} as const;
	assert.equal(
		evaluateGateTarget(receipt, driftedUpdate, repository).status,
		GATE_RESULT.DENY,
	);
	const createOverExisting = {
		kind: GATE_TARGET_KIND.PUSH,
		remote,
		updates: [{ ...target.updates[0], destination_ref: "refs/heads/final" }],
	} as const;
	assert.equal(
		evaluateGateTarget(receipt, createOverExisting, repository).status,
		GATE_RESULT.DENY,
	);

	const reversed = { ...target, updates: [...target.updates].reverse() };
	assert.equal(evaluateGateTarget(receipt, reversed, repository).status, GATE_RESULT.DENY);
	const deletion = {
		kind: GATE_TARGET_KIND.PUSH,
		updates: [{ kind: "delete", destination_ref: "refs/heads/main" }],
	} as unknown as GateTargetV1;
	assert.equal(evaluateGateTarget(receipt, deletion, repository).status, GATE_RESULT.DENY);
	assert.equal(
		evaluateGateTarget(
			receipt,
			{
				...target,
				updates: [{ ...target.updates[0], new_peeled_commit: baseCommit }, target.updates[1]],
			},
			repository,
		).status,
		GATE_RESULT.DENY,
	);
	assert.equal(
		evaluateGateTarget(receipt, { ...target, remote: "missing-remote" }, repository).status,
		GATE_RESULT.DENY,
	);
});

test("PR and release gates resolve exact refs, commits, tag objects, peels, and trees", (t) => {
	const { repository, baseTree, finalTree, changedTree, baseCommit, finalCommit, tagObject, receipt } = temporaryAuthority(t);
	const pullRequest = {
		kind: GATE_TARGET_KIND.PULL_REQUEST,
		base_ref: "refs/heads/base",
		base_commit: baseCommit,
		base_tree: baseTree,
		head_ref: "refs/heads/final",
		head_commit: finalCommit,
		head_tree: finalTree,
	} as const;
	const pullRequestResult = evaluateGateTarget(receipt, pullRequest, repository);
	assert.equal(pullRequestResult.status, GATE_RESULT.ALLOW, pullRequestResult.reason);
	assert.equal(
		evaluateGateTarget(receipt, { ...pullRequest, base_commit: finalCommit }, repository).status,
		GATE_RESULT.DENY,
	);
	const release = {
		kind: GATE_TARGET_KIND.RELEASE,
		tag_ref: "refs/tags/v1.2.3",
		tag_object: tagObject,
		peeled_commit: finalCommit,
		tree: finalTree,
	} as const;
	const releaseResult = evaluateGateTarget(receipt, release, repository);
	assert.equal(releaseResult.status, GATE_RESULT.ALLOW, releaseResult.reason);
	assert.equal(
		evaluateGateTarget(receipt, { ...release, tree: changedTree }, repository).status,
		GATE_RESULT.DENY,
	);
});

test("unsupported, ambiguous, nonexistent, and non-approved targets fail closed", (t) => {
	const { repository, finalTree, receipt: approved } = temporaryAuthority(t);
	assert.equal(
		evaluateGateTarget(approved, {
			kind: GATE_TARGET_KIND.INTENDED_COMMIT,
			intended_commit_tree: "HEAD",
		}, repository).status,
		GATE_RESULT.DENY,
	);
	assert.equal(
		evaluateGateTarget(approved, { kind: "branch", ref: "main" } as unknown as GateTargetV1, repository)
			.status,
		GATE_RESULT.DENY,
	);
	const escalated = structuredClone(approved);
	escalated.body.terminal_state = TERMINAL_STATE.ESCALATED;
	escalated.receipt_hash = canonicalHash(escalated.body);
	assert.equal(
		evaluateGateTarget(escalated, {
			kind: GATE_TARGET_KIND.INTENDED_COMMIT,
			intended_commit_tree: finalTree,
		}, repository).status,
		GATE_RESULT.DENY,
	);
	assert.equal(
		evaluateGateTarget(approved, {
			kind: GATE_TARGET_KIND.INTENDED_COMMIT,
			intended_commit_tree: "f".repeat(40),
		}, repository).status,
		GATE_RESULT.DENY,
	);
});

test("scope child claim and parent gate journal publish atomically across faults", (t) => {
	const { repository, changedTree, store, receipt } = temporaryAuthority(t);
	const before = store.read(receipt.body.lineage_id);
	let injected = false;
	const faulty = ReviewTransactionStore.forRepository(repository, {
		faultInjector(point) {
			if (!injected && point === "before-head-rename") {
				injected = true;
				throw new Error("scope publication fault");
			}
		},
	});
	const target = {
		kind: GATE_TARGET_KIND.INTENDED_COMMIT,
		intended_commit_tree: changedTree,
	} as const;
	assert.throws(
		() => validateReviewGate({
			store: faulty,
			receipt,
			target,
			repositoryCwd: repository,
			idempotencyKey: "scope-fault",
			scopeBudget: budget({ review_actors: 4 }),
		}),
		/scope publication fault/,
	);
	const afterFault = store.read(receipt.body.lineage_id);
	assert.equal(afterFault.revision, before.revision);
	assert.deepEqual(afterFault.child_claims ?? [], []);
	assert.equal(afterFault.request_journal.length, before.request_journal.length);

	const published = validateReviewGate({
		store,
		receipt,
		target,
		repositoryCwd: repository,
		idempotencyKey: "scope-fault",
		scopeBudget: budget({ review_actors: 4 }),
	});
	assert.equal(published.child_claim?.child_lineage_id, canonicalHash({
		parent_lineage_id: receipt.body.lineage_id,
		target_tree: changedTree,
	}));
	assert.equal(store.read(receipt.body.lineage_id).child_claims?.length, 1);
});

test("receipt gate cannot bypass independent dangerous-command safety", async () => {
	let safetyCalls = 0;
	let gateCalls = 0;
	const safetyBlock = { block: true, reason: "dangerous command denied" };
	const result = await __testing.enforceReviewGateAndCommandSafety(
		"git push origin main",
		() => {
			gateCalls += 1;
			return undefined;
		},
		async () => {
			safetyCalls += 1;
			return safetyBlock;
		},
	);
	assert.deepEqual(result, safetyBlock);
	assert.equal(safetyCalls, 1);
	assert.equal(gateCalls, 0);

	const gateBlock = { block: true, reason: "exact receipt required" };
	const blocked = await __testing.enforceReviewGateAndCommandSafety(
		"git push origin main",
		() => {
			gateCalls += 1;
			return gateBlock;
		},
		async () => {
			safetyCalls += 1;
			return undefined;
		},
	);
	assert.deepEqual(blocked, gateBlock);
	assert.equal(safetyCalls, 2);
	assert.equal(gateCalls, 1);
});
