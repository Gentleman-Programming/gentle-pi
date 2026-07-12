import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { REVIEW_PROJECTION } from "../lib/review-snapshot.ts";
import {
	EVIDENCE_CLASS,
	GATE_RESULT,
	GATE_TARGET_KIND,
	JOURNAL_STATUS,
	PUSH_UPDATE_KIND,
	REVIEW_MODE,
	REVIEW_OPERATION,
	REVIEW_PHASE,
	REVIEW_TRANSITION,
	TERMINAL_STATE,
	ReviewIntegrityError,
	ReviewTransactionStore,
	assertFrozenLedgerIntegrity,
	assertReceiptIntegrity,
	canonicalHash,
	createFrozenLedger,
	createReceiptEnvelope,
	createReviewState,
	evaluateGateTarget,
	resolveConfiguredPushDestinationV1,
	type CanonicalFrozenRowV1,
	type ReceiptBodyV1,
	type ReviewBudgetV1,
} from "../lib/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import {
	ordinaryValidatorRequest,
	recordOrdinaryValidation,
} from "../lib/review-policy-ordinary.ts";
import { testSnapshot } from "./review-test-fixtures.ts";

const TREE = {
	BASE: "1".repeat(40),
	COMPLETE: "2".repeat(40),
	INITIAL: "3".repeat(40),
	FINAL: "4".repeat(40),
	CHILD: "5".repeat(40),
} as const;

function budget(overrides: Partial<ReviewBudgetV1> = {}): ReviewBudgetV1 {
	return {
		review_batches: 1,
		review_actors: 1,
		refuter_batches: 1,
		fix_batches: 1,
		validator_runs: 1,
		final_verifications: 1,
		judgment_rounds: 0,
		judge_runs: 0,
		...overrides,
	};
}

function frozenRows(): CanonicalFrozenRowV1[] {
	return [
		{
			id: "RISK-002",
			lens: REVIEW_LENS.RISK,
			location: "src/auth.ts:20",
			severity: "CRITICAL",
			status_at_freeze: "open",
			evidence_class: EVIDENCE_CLASS.INFERENTIAL_SEVERE,
			evidence_claim: "A forged token reaches the protected handler.",
		},
		{
			id: "READ-001",
			lens: REVIEW_LENS.READABILITY,
			location: "src/review.ts:8",
			severity: "WARNING",
			status_at_freeze: "info",
			evidence_class: EVIDENCE_CLASS.INFO,
			evidence_claim: "The name hides the transaction boundary.",
		},
	];
}

function state(lineageId = "lineage-a") {
	return createReviewState({
		lineageId,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({
			baseTree: TREE.BASE,
			completeTree: TREE.COMPLETE,
			initialTree: TREE.INITIAL,
			route: REVIEW_ROUTE.STANDARD,
			lenses: [REVIEW_LENS.RISK],
		}),
		evidenceHash: "b".repeat(64),
		budget: budget(),
	});
}

function receiptBody(): ReceiptBodyV1 {
	const current = state();
	return {
		schema: "gentle-ai.review-receipt-body/v1",
		lineage_id: current.lineage_id,
		mode: current.mode,
		base_tree: current.base_tree,
		complete_snapshot_tree: current.complete_snapshot_tree,
		review_projection: current.review_projection,
		initial_review_tree: current.initial_review_tree,
		final_candidate_tree: TREE.FINAL,
		route: current.route,
		lenses: current.lenses,
		policy_hash: current.policy_hash,
		frozen_ledger_hash: createFrozenLedger(frozenRows()).frozen_ledger_hash,
		evidence_hash: current.evidence_hash,
		budget: current.budget,
		counters: current.counters,
		terminal_state: TERMINAL_STATE.APPROVED,
	};
}

function temporaryStore(t: test.TestContext): { root: string; store: ReviewTransactionStore } {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-review-store-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new ReviewTransactionStore({ root }) };
}

test("canonical frozen rows are ID-sorted and tampering invalidates their hash", () => {
	const ledger = createFrozenLedger(frozenRows());
	assert.deepEqual(
		ledger.rows.map(({ id }) => id),
		["READ-001", "RISK-002"],
	);
	assert.equal(ledger.frozen_ledger_hash, canonicalHash(ledger.rows));
	assert.doesNotThrow(() => assertFrozenLedgerIntegrity(ledger));

	const tampered = structuredClone(ledger);
	tampered.rows[0]!.evidence_claim = "rewritten claim";
	assert.throws(() => assertFrozenLedgerIntegrity(tampered), ReviewIntegrityError);
	assert.throws(
		() => createFrozenLedger([...frozenRows(), frozenRows()[0]!]),
		/duplicate frozen finding ID/i,
	);

	const normalized = createFrozenLedger([
		{
			...frozenRows()[0]!,
			status_at_freeze: "info",
			evidence_class: EVIDENCE_CLASS.INFO,
		},
		{
			...frozenRows()[1]!,
			status_at_freeze: "open",
			evidence_class: EVIDENCE_CLASS.DETERMINISTIC,
		},
	]);
	assert.deepEqual(
		normalized.rows.map(({ severity, status_at_freeze, evidence_class }) => ({
			severity,
			status_at_freeze,
			evidence_class,
		})),
		[
			{
				severity: "WARNING",
				status_at_freeze: "info",
				evidence_class: EVIDENCE_CLASS.INFO,
			},
			{
				severity: "CRITICAL",
				status_at_freeze: "open",
				evidence_class: EVIDENCE_CLASS.INFERENTIAL_SEVERE,
			},
		],
	);
});

test("receipt envelope hashes only its canonical body and binds exact projection", () => {
	const body = receiptBody();
	const envelope = createReceiptEnvelope(body);
	assert.equal(envelope.receipt_hash, canonicalHash(body));
	assert.equal("receipt_hash" in envelope.body, false);
	assert.doesNotThrow(() => assertReceiptIntegrity(envelope));

	const changedProjection = structuredClone(envelope);
	changedProjection.body.review_projection = { kind: REVIEW_PROJECTION.COMPLETE };
	assert.throws(() => assertReceiptIntegrity(changedProjection), ReviewIntegrityError);
	const changedFinal = structuredClone(envelope);
	changedFinal.body.final_candidate_tree = TREE.CHILD;
	assert.throws(() => assertReceiptIntegrity(changedFinal), ReviewIntegrityError);
});

test("journaled operation replay survives restart and rejects key reuse with a changed request", (t) => {
	const { root, store } = temporaryStore(t);
	store.create(state(), "start-a");
	const first = store.runReducerOperation({
		lineageId: "lineage-a",
		transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		idempotencyKey: "freeze-1",
		input: { rows: frozenRows().filter(({ lens }) => lens === REVIEW_LENS.RISK) },
	});
	assert.equal(first.revision, 1);

	const restarted = new ReviewTransactionStore({ root });
	const replay = restarted.runReducerOperation({
		lineageId: "lineage-a",
		transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		idempotencyKey: "freeze-1",
		input: { rows: frozenRows().filter(({ lens }) => lens === REVIEW_LENS.RISK) },
	});
	assert.deepEqual(replay, first);
	assert.equal(restarted.read("lineage-a").revision, 1);
	assert.equal(restarted.read("lineage-a").request_journal.length, 2);
	assert.equal(restarted.read("lineage-a").request_journal[1]!.status, JOURNAL_STATUS.COMPLETED);
	assert.throws(
		() =>
			restarted.runReducerOperation({
				lineageId: "lineage-a",
				transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
				idempotencyKey: "freeze-1",
				input: { rows: [] },
			}),
		/idempotency key.*different request/i,
	);
});

test("lineage start is journaled and exact replay is stable across restart", (t) => {
	const { root, store } = temporaryStore(t);
	const initialState = state();
	const first = store.create(initialState, "start-a");

	assert.deepEqual(first, {
		lineage_id: "lineage-a",
		revision: 0,
		phase: REVIEW_PHASE.STARTED,
	});
	const persisted = store.read("lineage-a");
	assert.equal(persisted.request_journal.length, 1);
	assert.deepEqual(persisted.request_journal[0], {
		operation: REVIEW_OPERATION.START,
		idempotency_key: "start-a",
		request_hash: canonicalHash(initialState),
		status: JOURNAL_STATUS.COMPLETED,
		canonical_result: first,
	});

	const restarted = new ReviewTransactionStore({ root });
	assert.deepEqual(restarted.create(initialState, "start-a"), first);
	assert.equal(restarted.read("lineage-a").revision, 0);
	assert.throws(
		() => restarted.create({ ...initialState, evidence_hash: "c".repeat(64) }, "start-a"),
		/idempotency key.*different request/i,
	);
	assert.throws(
		() => restarted.create(initialState, "another-start"),
		/lineage already exists/i,
	);
});

test("pending reducer work is crash-completable and exact completion replay is stable", (t) => {
	const { root, store } = temporaryStore(t);
	store.create(state(), "start-a");
	const request = { initial_review_tree: TREE.INITIAL };
	store.beginReducerOperation({
		lineageId: "lineage-a",
		transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		idempotencyKey: "discover-1",
		request,
		authorization: { actor: "review-risk" },
	});
	const restarted = new ReviewTransactionStore({ root });
	assert.equal(restarted.read("lineage-a").request_journal[1]!.status, JOURNAL_STATUS.PENDING);
	assert.throws(
		() =>
			restarted.runReducerOperation({
				lineageId: "lineage-a",
				transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
				idempotencyKey: "discover-2",
				input: { rows: [] },
			}),
		/unresolved pending operation/i,
	);
	const completed = restarted.completeReducerOperation({
		lineageId: "lineage-a",
		transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		idempotencyKey: "discover-1",
		request,
		input: { rows: frozenRows().filter(({ lens }) => lens === REVIEW_LENS.RISK) },
	});
	assert.equal(completed.revision, 2);
	assert.equal(restarted.read("lineage-a").request_journal[1]!.status, JOURNAL_STATUS.COMPLETED);
	assert.deepEqual(
		new ReviewTransactionStore({ root }).completeReducerOperation({
			lineageId: "lineage-a",
			transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
			idempotencyKey: "discover-1",
			request,
			input: { rows: [] },
		}),
		completed,
	);
});

test("lock and fsync-adjacent faults preserve the prior authoritative revision", (t) => {
	const { root, store } = temporaryStore(t);
	store.create(state(), "start-a");
	mkdirSync(join(root, "locks"), { recursive: true });
	writeFileSync(join(root, "locks", "lineage-a.lock"), "held");
	assert.throws(
		() =>
			store.runReducerOperation({
				lineageId: "lineage-a",
				transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
				idempotencyKey: "verify-locked",
				input: { rows: [] },
			}),
		/locked/i,
	);
	rmSync(join(root, "locks", "lineage-a.lock"));

	let injected = false;
	const faulty = new ReviewTransactionStore({
		root,
		faultInjector(point) {
			if (!injected && point === "before-head-rename") {
				injected = true;
				throw new Error("injected fsync-adjacent fault");
			}
		},
	});
	assert.throws(
		() =>
			faulty.runReducerOperation({
				lineageId: "lineage-a",
				transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
				idempotencyKey: "verify-fault",
				input: { rows: frozenRows().filter(({ lens }) => lens === REVIEW_LENS.RISK) },
			}),
		/injected fsync-adjacent fault/,
	);
	assert.equal(new ReviewTransactionStore({ root }).read("lineage-a").revision, 0);
});

test("state and HEAD tampering fail closed", (t) => {
	const { root, store } = temporaryStore(t);
	store.create(state(), "start-a");
	const revisionPath = join(root, "lineages", "lineage-a", "revisions", "0.json");
	const revision = JSON.parse(readFileSync(revisionPath, "utf8")) as {
		state: { evidence_hash: string };
	};
	revision.state.evidence_hash = "f".repeat(64);
	writeFileSync(revisionPath, `${JSON.stringify(revision)}\n`);
	assert.throws(() => store.read("lineage-a"), ReviewIntegrityError);

	chmodSync(revisionPath, 0o600);
	store.create(state("lineage-b"), "start-b");
	writeFileSync(join(root, "lineages", "lineage-b", "HEAD"), "999\n");
	assert.throws(() => store.read("lineage-b"), ReviewIntegrityError);
});

test("store exposes only reducer-bound authority transitions", (t) => {
	const { store } = temporaryStore(t);
	store.create(state(), "start-a");
	assert.equal("runOperation" in store, false);
	assert.equal("claimScopeChild" in store, false);
	assert.equal(store.read("lineage-a").route, REVIEW_ROUTE.STANDARD);
	assert.deepEqual(store.read("lineage-a").lenses, [REVIEW_LENS.RISK]);
});

test("repository authority fails closed until Git has stable root commit anchors", (t) => {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-review-git-store-"));
	const repository = join(parent, "repo");
	mkdirSync(repository);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const git = (...args: string[]): string =>
		execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	assert.throws(() => ReviewTransactionStore.forRepository(repository), /root commit anchors/i);
});

test("ordinary follow-ups are ID-sorted action-free validation evidence and do not change lifecycle authority", () => {
	const fixed = {
		...state(),
		frozen_ledger: createFrozenLedger([frozenRows()[0]!]),
		phase: REVIEW_PHASE.FIX_COMPLETE,
		fix_record: {
			candidate_tree: TREE.FINAL,
			fixed_ids: ["RISK-002"],
			fix_diff: "bounded fix",
			fix_diff_hash: canonicalHash("bounded fix"),
			changed_paths: ["src/auth.ts"],
		},
	};
	const request = ordinaryValidatorRequest(fixed, {
		originalAcceptanceTests: { passed: true, evidenceHash: "a".repeat(64) },
		correctionRegressions: [{ findingId: "RISK-002", evidenceHash: "b".repeat(64), passed: true }],
		originalCriterionRegressions: [],
		followUps: [
			{ id: "LATE-002", location: "docs/readme.md:2", summary: "Document later observation", evidenceHash: "c".repeat(64) },
			{ id: "LATE-001", location: "docs/readme.md:1", summary: "Keep as a future note", evidenceHash: "d".repeat(64) },
		],
	});
	const recorded = recordOrdinaryValidation(fixed, {
		request,
		results: [{ id: "RISK-002", outcome: "verified" }],
	});
	assert.deepEqual(recorded.validation_evidence?.follow_ups.map(({ id }) => id), ["LATE-001", "LATE-002"]);
	assert.equal(recorded.phase, REVIEW_PHASE.FINAL_VERIFICATION);
	assert.equal(recorded.counters.validator_runs, fixed.counters.validator_runs + 1);
	assert.equal(recorded.current_candidate_tree, fixed.current_candidate_tree);
	assert.equal(recorded.follow_ups, undefined);
});

test("new ordinary lineages fail closed when immutable genesis paths are absent", () => {
	const snapshot = testSnapshot({
		baseTree: TREE.BASE,
		completeTree: TREE.COMPLETE,
		route: REVIEW_ROUTE.STANDARD,
		lenses: [REVIEW_LENS.RISK],
	});
	delete snapshot.genesis_paths;
	assert.throws(
		() => createReviewState({
			lineageId: "missing-genesis",
			mode: REVIEW_MODE.ORDINARY,
			snapshot,
			evidenceHash: "b".repeat(64),
			budget: budget(),
		}),
		/immutable genesis paths/i,
	);
});

test("tag PUSH CREATE accepts an annotated tag for an approved commit advertised by the bound destination", (t) => {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-tag-gate-"));
	const repository = join(parent, "repo");
	const remote = join(parent, "remote.git");
	mkdirSync(repository);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const git = (...args: string[]): string =>
		execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	writeFileSync(join(repository, "release.ts"), "export const release = 1;\n");
	git("add", ".");
	git("-c", "user.name=Gate", "-c", "user.email=gate@example.invalid", "commit", "-m", "release");
	const commit = git("rev-parse", "HEAD");
	const tree = git("rev-parse", "HEAD^{tree}");
	execFileSync("git", ["clone", "--bare", repository, remote], { stdio: "ignore" });
	git("remote", "add", "origin", remote);
	git("-c", "user.name=Gate", "-c", "user.email=gate@example.invalid", "tag", "-a", "v1.0.0", "-m", "release", commit);
	const tagObject = git("rev-parse", "refs/tags/v1.0.0^{object}");
	const destination = resolveConfiguredPushDestinationV1(repository, "origin");
	const receipt = createReceiptEnvelope({ ...receiptBody(), final_candidate_tree: tree });
	const tagPush = (tag: string, object: string, peeledCommit: string, targetTree: string) => ({
		kind: GATE_TARGET_KIND.PUSH,
		remote: "origin",
		destination_id: destination.destination_id,
		updates: [{
			kind: PUSH_UPDATE_KIND.CREATE,
			source_ref: `refs/tags/${tag}`,
			destination_ref: `refs/tags/${tag}`,
			old_object: null,
			old_peeled_commit: null,
			old_tree: null,
			new_object: object,
			new_peeled_commit: peeledCommit,
			new_tree: targetTree,
		}],
	} as const);
	const annotated = evaluateGateTarget(receipt, tagPush("v1.0.0", tagObject, commit, tree), repository);
	assert.equal(annotated.status, GATE_RESULT.ALLOW, annotated.reason);

	git("tag", "v1.0.1", commit);
	const lightweightTarget = tagPush("v1.0.1", commit, commit, tree);
	const lightweight = evaluateGateTarget(receipt, lightweightTarget, repository);
	assert.equal(lightweight.status, GATE_RESULT.ALLOW, lightweight.reason);
	const remapped = evaluateGateTarget(
		receipt,
		{
			...lightweightTarget,
			updates: [{
				...lightweightTarget.updates[0],
				destination_ref: "refs/tags/remapped",
			}],
		},
		repository,
	);
	assert.equal(remapped.status, GATE_RESULT.DENY, remapped.reason);
	assert.match(remapped.reason, /matching tag source and destination/i);

	git("-c", "user.name=Gate", "-c", "user.email=gate@example.invalid", "commit", "--allow-empty", "-m", "unadvertised");
	const unadvertisedCommit = git("rev-parse", "HEAD");
	git("tag", "v1.0.2", unadvertisedCommit);
	const unadvertised = evaluateGateTarget(
		receipt,
		tagPush("v1.0.2", unadvertisedCommit, unadvertisedCommit, tree),
		repository,
	);
	assert.equal(unadvertised.status, GATE_RESULT.DENY, unadvertised.reason);
	assert.match(unadvertised.reason, /peeled commit.*advertised/i);

	const unresolved = evaluateGateTarget(
		receipt,
		tagPush("missing", tagObject, commit, tree),
		repository,
	);
	assert.equal(unresolved.status, GATE_RESULT.DENY, unresolved.reason);

	const fakeGitDirectory = join(parent, "fake-git");
	mkdirSync(fakeGitDirectory);
	const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
	const fakeGit = join(fakeGitDirectory, "git");
	writeFileSync(
		fakeGit,
		`#!/bin/sh\nif [ "$1" = "ls-remote" ] && [ "$4" = "refs/tags/v1.0.0" ]; then printf '${tagObject}\\trefs/tags/v1.0.0\\n${tagObject}\\trefs/tags/v1.0.0\\n'; exit 0; fi\nexec "${realGit}" "$@"\n`,
	);
	chmodSync(fakeGit, 0o755);
	const originalPath = process.env.PATH;
	process.env.PATH = `${fakeGitDirectory}:${originalPath ?? ""}`;
	try {
		const ambiguous = evaluateGateTarget(receipt, tagPush("v1.0.0", tagObject, commit, tree), repository);
		assert.equal(ambiguous.status, GATE_RESULT.DENY, ambiguous.reason);
		assert.match(ambiguous.reason, /ambiguously/i);
	} finally {
		process.env.PATH = originalPath;
	}

	writeFileSync(join(repository, "release.ts"), "export const release = 2;\n");
	git("add", ".");
	git("-c", "user.name=Gate", "-c", "user.email=gate@example.invalid", "commit", "-m", "wrong tree");
	const wrongCommit = git("rev-parse", "HEAD");
	const wrongTree = git("rev-parse", "HEAD^{tree}");
	git("tag", "v1.0.3", wrongCommit);
	const wrongTreeResult = evaluateGateTarget(
		receipt,
		tagPush("v1.0.3", wrongCommit, wrongCommit, wrongTree),
		repository,
	);
	assert.equal(wrongTreeResult.status, GATE_RESULT.DENY, wrongTreeResult.reason);
	assert.match(wrongTreeResult.reason, /tree.*approved receipt/i);

	const changedRemote = join(parent, "changed-remote.git");
	execFileSync("git", ["init", "--bare", changedRemote], { stdio: "ignore" });
	git("remote", "set-url", "--push", "origin", changedRemote);
	const drifted = evaluateGateTarget(receipt, tagPush("v1.0.0", tagObject, commit, tree), repository);
	assert.equal(drifted.status, GATE_RESULT.DENY, drifted.reason);
	assert.match(drifted.reason, /destination changed/i);
});
