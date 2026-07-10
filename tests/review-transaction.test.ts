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
	JOURNAL_STATUS,
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
	type CanonicalFrozenRowV1,
	type ReceiptBodyV1,
	type ReviewBudgetV1,
} from "../lib/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
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
