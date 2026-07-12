import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { canonicalJsonV1, domainHashV1 } from "../lib/review-canonical.ts";
import {
	createSupersessionEnvelopeV1,
	parseSupersessionEnvelopeV1,
	writeSupersessionRecordV1,
	loadSupersessionChainV1,
	ReviewAuthoritySupersessionError,
	assertRecoverableSourceEligibilityV1,
	assertRecoverySuccessorEquivalenceV1,
	prepareSupersessionV1,
	deriveIntendedUntrackedProofV1,
	inspectApprovedCompactSuccessorV1,
	inspectRecoverableGraphSourceV1,
	SupersessionStoreV1,
	resolveReviewAuthorityForChange,
	assertLiveRecoveredSuccessorBindingV1,
	assertLiveRecoveredSourceBindingV1,
	hasEligibleGraphV1RecoveryAuthorityV1,
} from "../lib/review-authority-supersession.ts";
import { COMPACT_REVIEW_STATE, completeCompactReview, completeCompactVerification, createCompactReviewState, type CompactReviewStateV2 } from "../lib/review-compact.ts";
import { COMPACT_STORE_OPERATION, CompactReviewStoreV2 } from "../lib/review-compact-store.ts";
import { REVIEW_MODE, REVIEW_TRANSITION, ReviewTransactionStore, createReviewState, type ReviewBudgetV1 } from "../lib/review-transaction.ts";
import { REVIEW_MODE as SNAPSHOT_REVIEW_MODE, REVIEW_PROJECTION, captureReviewSnapshot } from "../lib/review-snapshot.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import { testSnapshot } from "./review-test-fixtures.ts";

const digest = (digit: string) => digit.repeat(64);

function body(operationId = digest("a")) {
	return {
		schema: "gentle-ai.review-authority-supersession/v1" as const,
		operation_id: operationId,
		request_hash: digest("b"),
		sequence: 0,
		predecessor_recovery_id: null,
		repository: { repository_id: digest("c"), authority_id: digest("d"), common_directory_hash: digest("e"), repository_identity_hash: digest("f") },
		change: { change_name: "recover-legacy-review-authority", change_name_hash: domainHashV1("openspec-change-name", "recover-legacy-review-authority"), change_root_relative_path: "openspec/changes/recover-legacy-review-authority" },
		source: { format: "graph-v1" as const, lineage_id: "legacy", head_event_id: digest("2"), head_sequence: 4, reduced_state_hash: digest("3"), source_closure_hash: digest("4"), receipt_hash: digest("5"), frozen_ledger_hash: digest("6") },
		successor: { format: "compact-v2" as const, lineage_id: "successor", authority_revision: digest("7"), state_hash: digest("8"), receipt_hash: digest("9"), ledger_hash: digest("0"), runtime_identity_hash: digest("a") },
		equivalence: { base_tree: digest("b"), complete_snapshot_tree: digest("c"), initial_review_tree: digest("d"), final_candidate_tree: digest("e"), review_projection_hash: digest("f"), genesis_paths_hash: digest("1"), scope_digest: digest("2"), intended_untracked_hash: digest("3"), intended_untracked_proof_hash: digest("4"), policy_hash: digest("5"), policy_evidence_hash: digest("6"), source_receipt_hash: digest("7"), successor_receipt_hash: digest("8"), source_ledger_hash: digest("9"), successor_ledger_hash: digest("0") },
		authorization_hash: digest("b"),
	};
}

test("supersession envelopes are canonical, content-bound, and reject changed recovery IDs", () => {
	const envelope = createSupersessionEnvelopeV1(body());
	assert.equal(parseSupersessionEnvelopeV1(JSON.stringify(envelope)).recovery_id, envelope.recovery_id);
	assert.throws(() => parseSupersessionEnvelopeV1(JSON.stringify({ ...envelope, recovery_id: digest("c") })), ReviewAuthoritySupersessionError);
	assert.throws(() => parseSupersessionEnvelopeV1(JSON.stringify({ ...envelope, body: { ...envelope.body, change: { ...envelope.body.change, change_root_relative_path: "elsewhere" } } })), ReviewAuthoritySupersessionError);
});

test("supersession storage is append-only, exact retries are idempotent, and conflicts preserve source bytes", (t) => {
	const root = mkdtempSync(join(tmpdir(), "supersession-store-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const envelope = createSupersessionEnvelopeV1(body());
	const first = writeSupersessionRecordV1(root, envelope);
	const second = writeSupersessionRecordV1(root, envelope);
	assert.equal(first, second);
	assert.equal(readFileSync(first, "utf8"), canonicalJsonV1(envelope));
	const conflicting = createSupersessionEnvelopeV1({
		...body(envelope.body.operation_id),
		request_hash: digest("c"),
	});
	assert.throws(() => writeSupersessionRecordV1(root, conflicting), /OPERATION_CONFLICT/);
	assert.equal(readFileSync(first, "utf8"), canonicalJsonV1(envelope));
});

test("supersession discovery derives one deterministic linear chain and rejects forks", (t) => {
	const root = mkdtempSync(join(tmpdir(), "supersession-chain-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = createSupersessionEnvelopeV1(body());
	const second = createSupersessionEnvelopeV1({
		...body(digest("c")),
		sequence: 1,
		predecessor_recovery_id: first.recovery_id,
	});
	writeSupersessionRecordV1(root, second);
	writeSupersessionRecordV1(root, first);
	assert.deepEqual(loadSupersessionChainV1(root).map((entry) => entry.recovery_id), [first.recovery_id, second.recovery_id]);

	const fork = createSupersessionEnvelopeV1({
		...body(digest("d")),
		sequence: 1,
		predecessor_recovery_id: first.recovery_id,
	});
	writeSupersessionRecordV1(root, fork);
	assert.throws(() => loadSupersessionChainV1(root), /CHAIN_AMBIGUOUS/);
});

function sourceEligibility() {
	const record = body();
	return {
		repository: record.repository,
		change: record.change,
		source: record.source,
		immutable: true,
		readable: true,
		graph_replay_valid: true,
		receipt_valid: true,
		frozen_ledger_valid: true,
		identity_broken: false,
		reset_in_progress: false,
		mixed_authority: false,
		duplicate_authority: false,
	};
}

function authorityEvidence(record = body()) {
	return {
		repository: record.repository,
		change: record.change,
		source: record.source,
		successor: record.successor,
		source_evidence: {
			base_tree: digest("a"), complete_snapshot_tree: digest("b"), initial_review_tree: digest("c"), final_candidate_tree: digest("d"), review_projection_hash: digest("e"), genesis_paths_hash: digest("f"), scope_digest: digest("1"), intended_untracked_hash: digest("2"), intended_untracked_proof_hash: digest("3"), policy_hash: digest("4"), policy_evidence_hash: digest("5"), receipt_hash: record.source.receipt_hash, ledger_hash: record.source.frozen_ledger_hash,
		},
		successor_evidence: {
			base_tree: digest("a"), complete_snapshot_tree: digest("b"), initial_review_tree: digest("c"), final_candidate_tree: digest("d"), review_projection_hash: digest("e"), genesis_paths_hash: digest("f"), scope_digest: digest("1"), intended_untracked_hash: digest("2"), intended_untracked_proof_hash: digest("3"), policy_hash: digest("4"), policy_evidence_hash: digest("5"), receipt_hash: record.successor.receipt_hash, ledger_hash: record.successor.ledger_hash,
		},
	};
}

test("source eligibility accepts only immutable readable approved graph authority and canonical change identity", () => {
	const eligible = sourceEligibility();
	assert.deepEqual(assertRecoverableSourceEligibilityV1(eligible), eligible);
	assert.throws(() => assertRecoverableSourceEligibilityV1({ ...eligible, mixed_authority: true }), /INELIGIBLE_SOURCE/);
	assert.throws(() => assertRecoverableSourceEligibilityV1({ ...eligible, receipt_valid: false }), /INELIGIBLE_SOURCE/);
	assert.throws(() => assertRecoverableSourceEligibilityV1({ ...eligible, change: { ...eligible.change, change_name_hash: digest("0") } }), /INVALID/);
});

test("successor equivalence rejects every target, path, untracked, policy, evidence, receipt, and candidate substitution while allowing distinct valid ledgers", () => {
	const evidence = authorityEvidence();
	assert.doesNotThrow(() => assertRecoverySuccessorEquivalenceV1(evidence));
	for (const field of [
		"base_tree", "complete_snapshot_tree", "initial_review_tree", "final_candidate_tree",
		"review_projection_hash", "genesis_paths_hash", "scope_digest", "intended_untracked_hash",
		"intended_untracked_proof_hash", "policy_hash", "policy_evidence_hash",
	] as const) {
		assert.throws(() => assertRecoverySuccessorEquivalenceV1({
			...evidence,
			successor_evidence: { ...evidence.successor_evidence, [field]: digest("9") },
		}), /EQUIVALENCE_MISMATCH/, field);
	}
	assert.throws(() => assertRecoverySuccessorEquivalenceV1({ ...evidence, successor_evidence: { ...evidence.successor_evidence, receipt_hash: digest("f") } }), /EQUIVALENCE_MISMATCH/);
	assert.throws(() => assertRecoverySuccessorEquivalenceV1({ ...evidence, successor_evidence: { ...evidence.successor_evidence, ledger_hash: digest("f") } }), /EQUIVALENCE_MISMATCH/);
});

test("prepared supersession rejects mismatched source identities and binds every successor identity mutation", () => {
	const eligibility = sourceEligibility();
	const equivalence = authorityEvidence();
	const prepared = prepareSupersessionV1({ operation_id: digest("e"), eligibility, equivalence });
	assert.match(prepared.challenge, /^SUPERSEDE REVIEW AUTHORITY /);
	assert.equal(prepared.body.request_hash, prepared.request_hash);
	assert.equal(prepared.body.source.lineage_id, eligibility.source.lineage_id);
	assert.throws(() => prepareSupersessionV1({
		operation_id: digest("e"),
		eligibility,
		equivalence: { ...equivalence, source: { ...equivalence.source, head_event_id: digest("f") } },
	}), /EQUIVALENCE_MISMATCH/);
	for (const field of ["lineage_id", "authority_revision", "state_hash", "receipt_hash", "ledger_hash", "runtime_identity_hash"] as const) {
		const value = field === "lineage_id" ? "other-successor" : digest("f");
		const successor = { ...equivalence.successor, [field]: value };
		const successor_evidence = {
			...equivalence.successor_evidence,
			...(field === "receipt_hash" ? { receipt_hash: value } : {}),
			...(field === "ledger_hash" ? { ledger_hash: value } : {}),
		};
		const changed = prepareSupersessionV1({
			operation_id: digest("e"),
			eligibility,
			equivalence: { ...equivalence, successor, successor_evidence },
		});
		assert.notEqual(changed.request_hash, prepared.request_hash, field);
	}
});

function proofRepository(t: test.TestContext): { root: string; git: (...args: string[]) => string } {
	const parent = mkdtempSync(join(tmpdir(), "supersession-proof-"));
	const root = join(parent, "repo");
	mkdirSync(root);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	writeFileSync(join(root, "tracked.txt"), "base\n");
	git("add", "tracked.txt");
	git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "base");
	mkdirSync(join(root, "nested"));
	return { root, git };
}

test("live intended-untracked proof accepts only all-untracked or an exact complete-index successor", (t) => {
	const { root, git } = proofRepository(t);
	writeFileSync(join(root, "new.txt"), "reviewed\n");
	git("add", "new.txt");
	const candidate = git("write-tree");
	git("reset", "--", "new.txt");

	const untracked = deriveIntendedUntrackedProofV1(join(root, "nested"), candidate, ["new.txt"]);
	assert.equal(untracked.state, "all-untracked");
	assert.equal(untracked.candidate_tree, candidate);
	assert.match(untracked.proof_hash, /^[0-9a-f]{64}$/);

	git("add", "new.txt");
	const indexed = deriveIntendedUntrackedProofV1(root, candidate, ["new.txt"]);
	assert.equal(indexed.state, "complete-index");
	assert.equal(indexed.index_tree, candidate);
	assert.notEqual(indexed.proof_hash, untracked.proof_hash);
});

test("live intended-untracked proof rejects mixed, ignored, extra, missing, content, mode, and index-tree mismatches", (t) => {
	const { root, git } = proofRepository(t);
	writeFileSync(join(root, "one.txt"), "one\n");
	writeFileSync(join(root, "two.txt"), "two\n");
	git("add", "one.txt", "two.txt");
	const candidate = git("write-tree");
	git("reset", "--", "one.txt", "two.txt");

	git("add", "one.txt");
	assert.throws(() => deriveIntendedUntrackedProofV1(root, candidate, ["one.txt", "two.txt"]), /UNTRACKED_DRIFT/);
	git("reset", "--", "one.txt");
	writeFileSync(join(root, ".gitignore"), "one.txt\n");
	assert.throws(() => deriveIntendedUntrackedProofV1(root, candidate, ["one.txt", "two.txt"]), /UNTRACKED_DRIFT/);
	unlinkSync(join(root, ".gitignore"));
	writeFileSync(join(root, "extra.txt"), "extra\n");
	assert.throws(() => deriveIntendedUntrackedProofV1(root, candidate, ["one.txt", "two.txt"]), /UNTRACKED_DRIFT/);

	git("clean", "-f", "extra.txt");
	unlinkSync(join(root, "two.txt"));
	assert.throws(() => deriveIntendedUntrackedProofV1(root, candidate, ["one.txt", "two.txt"]), /UNTRACKED_DRIFT/);
	writeFileSync(join(root, "two.txt"), "two\n");
	writeFileSync(join(root, "one.txt"), "changed\n");
	assert.throws(() => deriveIntendedUntrackedProofV1(root, candidate, ["one.txt", "two.txt"]), /UNTRACKED_DRIFT/);
	writeFileSync(join(root, "one.txt"), "one\n");
	chmodSync(join(root, "one.txt"), 0o755);
	if (process.platform !== "win32") assert.throws(() => deriveIntendedUntrackedProofV1(root, candidate, ["one.txt", "two.txt"]), /UNTRACKED_DRIFT/);
	chmodSync(join(root, "one.txt"), 0o644);
	git("add", "one.txt", "two.txt");
	writeFileSync(join(root, "tracked.txt"), "drift\n");
	git("add", "tracked.txt");
	assert.throws(() => deriveIntendedUntrackedProofV1(root, candidate, ["one.txt", "two.txt"]), /UNTRACKED_DRIFT/);
});

function reviewBudget(): ReviewBudgetV1 {
	return {
		review_batches: 1,
		review_actors: 1,
		refuter_batches: 1,
		fix_batches: 1,
		validator_runs: 1,
		final_verifications: 1,
		judgment_rounds: 0,
		judge_runs: 0,
	};
}

function approvedGraphSource(t: test.TestContext, options: { mode?: "ordinary" | "judgment-day"; lineageId?: string; complete?: boolean } = {}) {
	const { root, git } = proofRepository(t);
	mkdirSync(join(root, "openspec", "changes", "recover-legacy-review-authority"), { recursive: true });
	const baseTree = git("rev-parse", "HEAD^{tree}");
	writeFileSync(join(root, "tracked.txt"), "reviewed\n");
	git("add", "tracked.txt");
	const finalTree = git("write-tree");
	const lineageId = options.lineageId ?? "legacy-source";
	const state = createReviewState({
		lineageId,
		mode: options.mode === "judgment-day" ? REVIEW_MODE.JUDGMENT_DAY : REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot(options.mode === "judgment-day"
			? { mode: REVIEW_MODE.JUDGMENT_DAY, baseTree, completeTree: finalTree, route: REVIEW_ROUTE.TRIVIAL, lenses: [] }
			: { mode: REVIEW_MODE.ORDINARY, baseTree, completeTree: finalTree, genesisPaths: ["tracked.txt"], route: REVIEW_ROUTE.STANDARD, lenses: [REVIEW_LENS.READABILITY] }),
		evidenceHash: digest("a"),
		budget: options.mode === "judgment-day"
			? { review_batches: 1, review_actors: 2, refuter_batches: 0, fix_batches: 2, validator_runs: 0, final_verifications: 1, judgment_rounds: 2, judge_runs: 6 }
			: reviewBudget(),
	});
	const store = ReviewTransactionStore.forRepository(root);
	store.create(state, "start");
	if (options.mode !== "judgment-day" && options.complete !== false) {
		store.runReducerOperation({ lineageId, transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY, idempotencyKey: "discover", input: { rows: [] } });
		store.runReducerOperation({ lineageId, transition: REVIEW_TRANSITION.ORDINARY_EVIDENCE, idempotencyKey: "evidence", input: { deterministicResults: [] } });
		store.runReducerOperation({ lineageId, transition: REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION, idempotencyKey: "verify", input: { passed: true } });
	}
	return { root, git, store, lineageId };
}

function immutableFiles(root: string): Map<string, string> {
	const files = new Map<string, string>();
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) files.set(path.slice(root.length + 1).replaceAll("\\", "/"), readFileSync(path, "utf8"));
		}
	};
	visit(root);
	return files;
}

test("repository source inspection preserves source bytes and rejects reset, duplicate, unrelated, corrupt, broken-identity, and Judgment Day authority", (t) => {
	const { root, store, lineageId } = approvedGraphSource(t);
	const sourceBytes = immutableFiles(store.root);
	const source = inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId);
	assert.equal(source.source.lineage_id, lineageId);
	assert.equal(source.source.format, "graph-v1");
	assert.match(source.repository.common_directory_hash, /^[0-9a-f]{64}$/);
	assert.equal(source.change.change_root_relative_path, "openspec/changes/recover-legacy-review-authority");
	assert.deepEqual(immutableFiles(store.root), sourceBytes);
	const authorityRoot = join(dirname(store.root), "control");
	mkdirSync(authorityRoot, { recursive: true });
	writeFileSync(join(authorityRoot, "reset-state.json"), "{\"body\":{\"phase\":\"quarantining\"}}");
	assert.throws(() => inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId), /INELIGIBLE_SOURCE/);

	const incomplete = approvedGraphSource(t, { complete: false, lineageId: "missing-evidence" });
	assert.throws(() => inspectRecoverableGraphSourceV1(incomplete.root, "recover-legacy-review-authority", incomplete.lineageId), /INELIGIBLE_SOURCE/);
	const unrelated = approvedGraphSource(t, { lineageId: "source-one" });
	unrelated.store.create(createReviewState({
		lineageId: "source-two",
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({ baseTree: "c".repeat(40), completeTree: "d".repeat(40), route: REVIEW_ROUTE.STANDARD, lenses: [REVIEW_LENS.READABILITY] }),
		evidenceHash: digest("a"),
		budget: reviewBudget(),
	}), "start-unrelated");
	assert.equal(
		inspectRecoverableGraphSourceV1(unrelated.root, "recover-legacy-review-authority", unrelated.lineageId).source.lineage_id,
		unrelated.lineageId,
	);

	const corrupt = approvedGraphSource(t, { lineageId: "corrupt-source" });
	const event = [...immutableFiles(corrupt.store.root).keys()].find((path) => path.startsWith("objects/events/sha256/"));
	assert.ok(event, "fixture must contain an immutable graph event");
	writeFileSync(join(corrupt.store.root, event), "corrupt");
	assert.throws(() => inspectRecoverableGraphSourceV1(corrupt.root, "recover-legacy-review-authority", corrupt.lineageId), /INELIGIBLE_SOURCE/);
	assert.throws(() => hasEligibleGraphV1RecoveryAuthorityV1(corrupt.root), /INELIGIBLE_SOURCE/);

	const brokenIdentity = approvedGraphSource(t, { lineageId: "broken-identity" });
	writeFileSync(join(dirname(brokenIdentity.store.root), "IDENTITY"), "broken repository identity");
	assert.throws(() => inspectRecoverableGraphSourceV1(brokenIdentity.root, "recover-legacy-review-authority", brokenIdentity.lineageId), /INELIGIBLE_SOURCE/);

	const judgmentDay = approvedGraphSource(t, { mode: "judgment-day", lineageId: "judgment-day" });
	assert.throws(() => inspectRecoverableGraphSourceV1(judgmentDay.root, "recover-legacy-review-authority", judgmentDay.lineageId), /INELIGIBLE_SOURCE/);
});

function compactSnapshot(root: string) {
	return captureReviewSnapshot({
		cwd: root,
		mode: SNAPSHOT_REVIEW_MODE.ORDINARY,
		projection: { kind: REVIEW_PROJECTION.COMPLETE },
		policyHash: digest("a"),
	});
}

function approvedCompactSuccessor(root: string, lineageId = "compact-successor"): string {
	const snapshot = compactSnapshot(root);
	const store = CompactReviewStoreV2.forRepository(root, lineageId);
	const reviewing = createCompactReviewState({ lineageId, snapshot, policyHash: digest("a") });
	const start = store.replace("", COMPACT_STORE_OPERATION.START, reviewing);
	const reviewed = completeCompactReview(reviewing, { lens_results: reviewing.selected_lenses.map(() => ({ findings: [], evidence: [] })) });
	const review = store.replace(start, COMPACT_STORE_OPERATION.COMPLETE_REVIEW, reviewed);
	const approved = completeCompactVerification(reviewed, "focused verification passed", true);
	store.replace(review, COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION, approved);
	assert.equal(store.load().state.state, COMPACT_REVIEW_STATE.APPROVED);
	store.materializeTerminalReceipt();
	return lineageId;
}

test("successor inspection accepts exactly one approved compact-v2 claimant and rejects nonterminal, escalated, and ambiguous claimants", (t) => {
	const { root } = proofRepository(t);
	const lineageId = approvedCompactSuccessor(root);
	assert.equal(inspectApprovedCompactSuccessorV1(root, lineageId).lineage_id, lineageId);
	const nonterminal = CompactReviewStoreV2.forRepository(root, "nonterminal");
	const reviewing = createCompactReviewState({ lineageId: "nonterminal", snapshot: compactSnapshot(root), policyHash: digest("a") });
	nonterminal.replace("", COMPACT_STORE_OPERATION.START, reviewing);
	assert.throws(() => inspectApprovedCompactSuccessorV1(root, "nonterminal"), /INELIGIBLE_SOURCE/);

	const escalatedRoot = proofRepository(t).root;
	const escalated = CompactReviewStoreV2.forRepository(escalatedRoot, "escalated");
	const escalatedReview = createCompactReviewState({ lineageId: "escalated", snapshot: compactSnapshot(escalatedRoot), policyHash: digest("a") });
	const escalatedStart = escalated.replace("", COMPACT_STORE_OPERATION.START, escalatedReview);
	const escalatedReviewed = completeCompactReview(escalatedReview, { lens_results: escalatedReview.selected_lenses.map(() => ({ findings: [], evidence: [] })) });
	const escalatedReviewRevision = escalated.replace(escalatedStart, COMPACT_STORE_OPERATION.COMPLETE_REVIEW, escalatedReviewed);
	const escalatedState = completeCompactVerification(escalatedReviewed, "verification failed", false);
	escalated.replace(escalatedReviewRevision, COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION, escalatedState);
	escalated.materializeTerminalReceipt();
	assert.equal(escalated.load().state.state, COMPACT_REVIEW_STATE.ESCALATED);
	assert.throws(() => inspectApprovedCompactSuccessorV1(escalatedRoot, "escalated"), /INELIGIBLE_SOURCE/);

	approvedCompactSuccessor(root, "ambiguous-claimant");
	assert.throws(() => inspectApprovedCompactSuccessorV1(root, lineageId), /INELIGIBLE_SOURCE/);
});

test("repository-backed source and successor fixtures reject each independently changed binding", (t) => {
	const { root, git } = proofRepository(t);
	writeFileSync(join(root, "reviewed.txt"), "reviewed\n");
	git("add", "reviewed.txt");
	const candidate = git("write-tree");
	git("reset", "--", "reviewed.txt");
	const proof = deriveIntendedUntrackedProofV1(root, candidate, ["reviewed.txt"]);
	const record = body();
	const binding = authorityEvidence(record);
	const repositoryDigest = domainHashV1("repository-backed-fixture", root);
	const candidateDigest = domainHashV1("repository-backed-candidate", candidate);
	const proofDigest = domainHashV1("repository-backed-proof", proof);
	const source = {
		...binding.source_evidence,
		base_tree: repositoryDigest,
		complete_snapshot_tree: candidateDigest,
		initial_review_tree: candidateDigest,
		final_candidate_tree: candidateDigest,
		intended_untracked_proof_hash: proofDigest,
	};
	const successor = {
		...binding.successor_evidence,
		base_tree: repositoryDigest,
		complete_snapshot_tree: candidateDigest,
		initial_review_tree: candidateDigest,
		final_candidate_tree: candidateDigest,
		intended_untracked_proof_hash: proofDigest,
	};
	const exact = { ...binding, source_evidence: source, successor_evidence: successor };
	assert.doesNotThrow(() => assertRecoverySuccessorEquivalenceV1(exact));
	for (const field of ["base_tree", "complete_snapshot_tree", "initial_review_tree", "final_candidate_tree", "intended_untracked_proof_hash", "policy_hash"] as const) {
		assert.throws(() => assertRecoverySuccessorEquivalenceV1({
			...exact,
			successor_evidence: { ...exact.successor_evidence, [field]: digest("9") },
		}), /EQUIVALENCE_MISMATCH/, field);
	}
});


test("repository-anchored supersession installation serializes CAS, retries exactly, rejects divergent operations, and preserves graph source bytes", (t) => {
	const { root, store: graphStore, lineageId } = approvedGraphSource(t);
	const sourceBytes = immutableFiles(graphStore.root);
	const envelope = createSupersessionEnvelopeV1({
		...body(digest("b")),
		repository: inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId).repository,
		change: inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId).change,
		source: inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId).source,
	});
	const supersessions = SupersessionStoreV1.forRepository(root);
	const first = supersessions.install("recover-legacy-review-authority", envelope);
	assert.throws(() => supersessions.install("recover-legacy-review-authority", envelope, {
		casChecks: [{ label: "retry source", expected: digest("a"), observe: () => digest("b") }],
	}), /STALE_AUTHORIZATION/);
	assert.equal(supersessions.install("recover-legacy-review-authority", envelope).recovery_id, first.recovery_id);
	assert.equal(lstatSync(join(supersessions.root, "recovery-required-v1", `${domainHashV1("openspec-change-name", "recover-legacy-review-authority")}.json`)).isFile(), true);
	if (process.platform !== "win32") assert.equal(lstatSync(first.path).mode & 0o777, 0o600);
	assert.deepEqual(immutableFiles(graphStore.root), sourceBytes);
	const conflict = createSupersessionEnvelopeV1({ ...envelope.body, request_hash: digest("c") });
	assert.throws(() => supersessions.install("recover-legacy-review-authority", conflict), /OPERATION_CONFLICT/);
	const stale = createSupersessionEnvelopeV1({ ...body(digest("d")), repository: envelope.body.repository, change: envelope.body.change, source: envelope.body.source });
	assert.throws(() => supersessions.install("recover-legacy-review-authority", stale), /STALE_AUTHORIZATION/);
	for (const label of ["source", "successor", "policy", "receipt"] as const) {
		const candidate = createSupersessionEnvelopeV1({
			...body(digest(label === "source" ? "e" : label === "successor" ? "f" : label === "policy" ? "1" : "2")),
			sequence: 1,
			predecessor_recovery_id: first.recovery_id,
			repository: envelope.body.repository,
			change: envelope.body.change,
			source: envelope.body.source,
		});
		assert.throws(() => supersessions.install("recover-legacy-review-authority", candidate, {
			casChecks: [{ label, expected: digest("a"), observe: () => digest("b") }],
		}), /STALE_AUTHORIZATION/, label);
	}
});

test("repository-anchored supersession storage rejects symlink substitution and preserves zero-or-one complete record across fault windows", (t) => {
	const { root, lineageId } = approvedGraphSource(t);
	const source = inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId);
	const envelope = createSupersessionEnvelopeV1({ ...body(digest("e")), repository: source.repository, change: source.change, source: source.source });
	const crashing = SupersessionStoreV1.forRepository(root, { faultInjector: (point) => { if (point === "before-link") throw new Error("injected crash"); } });
	assert.throws(() => crashing.install("recover-legacy-review-authority", envelope), /injected crash/);
	const recovered = SupersessionStoreV1.forRepository(root);
	assert.equal(recovered.load("recover-legacy-review-authority").length, 0);
	recovered.install("recover-legacy-review-authority", envelope);
	assert.equal(recovered.load("recover-legacy-review-authority").length, 1);

	const afterLinkSource = approvedGraphSource(t, { lineageId: "after-link-source" });
	const afterLink = inspectRecoverableGraphSourceV1(afterLinkSource.root, "recover-legacy-review-authority", afterLinkSource.lineageId);
	const afterLinkEnvelope = createSupersessionEnvelopeV1({ ...body(digest("f")), repository: afterLink.repository, change: afterLink.change, source: afterLink.source });
	const linkedThenInterrupted = SupersessionStoreV1.forRepository(afterLinkSource.root, { faultInjector: (point) => { if (point === "after-link") throw new Error("injected after-link crash"); } });
	assert.throws(() => linkedThenInterrupted.install("recover-legacy-review-authority", afterLinkEnvelope), /injected after-link crash/);
	const retryBeforeDirectoryFsync = SupersessionStoreV1.forRepository(afterLinkSource.root, { faultInjector: (point) => { if (point === "before-directory-fsync") throw new Error("exact retry reaches directory fsync"); } });
	assert.throws(() => retryBeforeDirectoryFsync.install("recover-legacy-review-authority", afterLinkEnvelope), /exact retry reaches directory fsync/);
	assert.equal(SupersessionStoreV1.forRepository(afterLinkSource.root).install("recover-legacy-review-authority", afterLinkEnvelope).recovery_id, afterLinkEnvelope.recovery_id);

	const base = join(recovered.root, domainHashV1("openspec-change-name", "recover-legacy-review-authority"));
	rmSync(base, { recursive: true, force: true });
	symlinkSync(tmpdir(), base);
	assert.throws(() => recovered.load("recover-legacy-review-authority"), /REPOSITORY_MISMATCH|symlink/i);
});

function recoveredSuccessorEquivalence(source: ReturnType<typeof inspectRecoverableGraphSourceV1>, successor: ReturnType<typeof inspectApprovedCompactSuccessorV1>, state: CompactReviewStateV2) {
	return {
		base_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.base_tree),
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
}

test("change-aware resolution requires an initial record for eligible graph authority, selects exactly the bound successor, and blocks unbound authority", (t) => {
	const { root, lineageId } = approvedGraphSource(t);
	assert.throws(() => resolveReviewAuthorityForChange(root, "recover-legacy-review-authority"), /CHAIN_AMBIGUOUS/);
	const successorLineage = approvedCompactSuccessor(root);
	const source = inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId);
	const successor = inspectApprovedCompactSuccessorV1(root, successorLineage);
	const envelope = createSupersessionEnvelopeV1({
		...body(digest("7")),
		repository: source.repository,
		change: source.change,
		source: source.source,
		successor,
		equivalence: recoveredSuccessorEquivalence(source, successor, CompactReviewStoreV2.forRepository(root, successorLineage).load().state),
	});
	SupersessionStoreV1.forRepository(root).install("recover-legacy-review-authority", envelope);
	const resolved = resolveReviewAuthorityForChange(root, "recover-legacy-review-authority");
	assert.ok(resolved);
	assert.equal(resolved.record.state.lineage_id, successorLineage);
	approvedCompactSuccessor(root, "unbound-claimant");
	assert.throws(() => resolveReviewAuthorityForChange(root, "recover-legacy-review-authority"), /CHAIN_AMBIGUOUS|unbound/i);
});

test("live recovered source binding rederives source target, scope, policy, receipt, and ledger evidence", (t) => {
	const { root, lineageId } = approvedGraphSource(t);
	const successorLineage = approvedCompactSuccessor(root);
	const source = inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId);
	const successor = inspectApprovedCompactSuccessorV1(root, successorLineage);
	const state = CompactReviewStoreV2.forRepository(root, successorLineage).load().state;
	const expected = recoveredSuccessorEquivalence(source, successor, state);
	const recovery = createSupersessionEnvelopeV1({ ...body(digest("c")), repository: source.repository, change: source.change, source: source.source, successor, equivalence: expected });
	assert.doesNotThrow(() => assertLiveRecoveredSourceBindingV1(root, recovery));
	for (const field of ["base_tree", "complete_snapshot_tree", "initial_review_tree", "final_candidate_tree", "review_projection_hash", "genesis_paths_hash", "scope_digest", "intended_untracked_hash", "intended_untracked_proof_hash", "policy_hash", "source_receipt_hash", "source_ledger_hash"] as const) {
		assert.throws(() => assertLiveRecoveredSourceBindingV1(root, createSupersessionEnvelopeV1({ ...recovery.body, equivalence: { ...expected, [field]: digest("f") } })), /CHAIN_AMBIGUOUS|UNTRACKED_DRIFT/, field);
	}
});

test("live recovered successor binding rejects target, paths, policy, receipt, and authority drift", (t) => {
	const { root, lineageId } = approvedGraphSource(t);
	const successorLineage = approvedCompactSuccessor(root);
	const source = inspectRecoverableGraphSourceV1(root, "recover-legacy-review-authority", lineageId);
	const successor = inspectApprovedCompactSuccessorV1(root, successorLineage);
	const state = CompactReviewStoreV2.forRepository(root, successorLineage).load().state;
	const expected = recoveredSuccessorEquivalence(source, successor, state);
	const recovery = createSupersessionEnvelopeV1({ ...body(digest("e")), repository: source.repository, change: source.change, source: source.source, successor, equivalence: expected });
	assert.doesNotThrow(() => assertLiveRecoveredSuccessorBindingV1(root, recovery, state));
	for (const field of ["final_candidate_tree", "genesis_paths_hash", "policy_hash", "policy_evidence_hash", "successor_receipt_hash", "successor_ledger_hash"] as const) {
		assert.throws(() => assertLiveRecoveredSuccessorBindingV1(root, createSupersessionEnvelopeV1({ ...recovery.body, equivalence: { ...expected, [field]: digest("f") } }), state), /CHAIN_AMBIGUOUS|UNTRACKED_DRIFT/, field);
	}
});

test("supersession chain rejects gaps, cycles, and duplicate heads without selecting by directory order", (t) => {
	const root = mkdtempSync(join(tmpdir(), "supersession-invalid-chain-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = createSupersessionEnvelopeV1(body(digest("1")));
	const gap = createSupersessionEnvelopeV1({ ...body(digest("2")), sequence: 2, predecessor_recovery_id: first.recovery_id });
	writeSupersessionRecordV1(root, first);
	writeSupersessionRecordV1(root, gap);
	assert.throws(() => loadSupersessionChainV1(root), /CHAIN_AMBIGUOUS/);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root);
	const cycle = createSupersessionEnvelopeV1({ ...body(digest("3")), sequence: 1, predecessor_recovery_id: digest("4") });
	writeSupersessionRecordV1(root, cycle);
	assert.throws(() => loadSupersessionChainV1(root), /CHAIN_AMBIGUOUS/);
});
