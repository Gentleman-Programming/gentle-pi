import assert from "node:assert/strict";
import test from "node:test";
import {
	EVIDENCE_CLASS,
	REVIEW_MODE,
	REVIEW_PHASE,
	TERMINAL_STATE,
	canonicalHash,
	createReviewState,
	type CanonicalFrozenRowV1,
	type ReviewBudgetV1,
	type ReviewStateV1,
} from "../lib/review-transaction.ts";
import {
	RESOLUTION_OUTCOME,
	applyOrdinaryFix,
	declineOrdinaryFix,
	ordinaryValidatorRequest,
	recordOrdinaryDiscovery,
	recordOrdinaryFinalVerification,
	recordOrdinaryValidation,
	resolveOrdinaryEvidence,
} from "../lib/review-policy-ordinary.ts";
import {
	FULL_4R_LENSES,
	REVIEW_LENS,
	REVIEW_ROUTE,
	type ReviewLens,
	type ReviewRoute,
} from "../lib/review-triggers.ts";
import { testSnapshot } from "./review-test-fixtures.ts";

const TREE = {
	BASE: "1".repeat(40),
	COMPLETE: "2".repeat(40),
	FIXED: "3".repeat(40),
} as const;

function ordinaryBudget(reviewActors: number): ReviewBudgetV1 {
	return {
		review_batches: 1,
		review_actors: reviewActors,
		refuter_batches: 1,
		fix_batches: 1,
		validator_runs: 1,
		final_verifications: 1,
		judgment_rounds: 0,
		judge_runs: 0,
	};
}

function ordinaryState(
	route: ReviewRoute = REVIEW_ROUTE.FULL_4R,
	lenses: readonly ReviewLens[] = FULL_4R_LENSES,
	budgetOverrides: Partial<ReviewBudgetV1> = {},
): ReviewStateV1 {
	return createReviewState({
		lineageId: `ordinary-${route.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({
			baseTree: TREE.BASE,
			completeTree: TREE.COMPLETE,
			route,
			lenses,
		}),
		evidenceHash: "b".repeat(64),
		budget: { ...ordinaryBudget(lenses.length), ...budgetOverrides },
	});
}

function rows(): CanonicalFrozenRowV1[] {
	return [
		{
			id: "RISK-001",
			lens: REVIEW_LENS.RISK,
			location: "src/auth.ts:10",
			severity: "BLOCKER",
			status_at_freeze: "open",
			evidence_class: EVIDENCE_CLASS.DETERMINISTIC,
			evidence_claim: "The access check is absent on the protected branch.",
		},
		{
			id: "RELY-002",
			lens: REVIEW_LENS.RELIABILITY,
			location: "src/retry.ts:30",
			severity: "CRITICAL",
			status_at_freeze: "open",
			evidence_class: EVIDENCE_CLASS.INFERENTIAL_SEVERE,
			evidence_claim: "A retry may duplicate the persisted operation.",
		},
		{
			id: "READ-003",
			lens: REVIEW_LENS.READABILITY,
			location: "src/review.ts:5",
			severity: "WARNING",
			status_at_freeze: "info",
			evidence_class: EVIDENCE_CLASS.INFO,
			evidence_claim: "The transaction name is ambiguous.",
		},
	];
}

test("ordinary discovery runs the selected zero, one, or four lenses exactly once", () => {
	for (const selected of [
		{ route: REVIEW_ROUTE.TRIVIAL, lenses: [] },
		{ route: REVIEW_ROUTE.STANDARD, lenses: [REVIEW_LENS.READABILITY] },
		{ route: REVIEW_ROUTE.FULL_4R, lenses: FULL_4R_LENSES },
	] as const) {
		const discovered = recordOrdinaryDiscovery(
			ordinaryState(selected.route, selected.lenses),
			{
				rows:
					selected.lenses.length === 0
						? []
						: rows().filter(({ lens }) => selected.lenses.includes(lens as ReviewLens)),
			},
		);
		assert.equal(discovered.phase, REVIEW_PHASE.DISCOVERY_COMPLETE);
		assert.equal(discovered.counters.review_batches, 1);
		assert.equal(discovered.counters.review_actors, selected.lenses.length);
		assert.throws(
			() => recordOrdinaryDiscovery(discovered, { rows: [] }),
			/discovery.*only.*started/i,
		);
	}
});

test("ordinary discovery enforces selected lenses and normalizes severe actor rows fail closed", () => {
	const standard = ordinaryState(REVIEW_ROUTE.STANDARD, [REVIEW_LENS.READABILITY]);
	assert.throws(
		() => recordOrdinaryDiscovery(standard, { rows: [rows()[0]!] }),
		/selected ordinary lens/i,
	);
	const malformedSevere = {
		...rows()[0]!,
		id: "READ-900",
		lens: REVIEW_LENS.READABILITY,
		status_at_freeze: "info",
		evidence_class: EVIDENCE_CLASS.INFO,
	} as CanonicalFrozenRowV1;
	const discovered = recordOrdinaryDiscovery(standard, { rows: [malformedSevere] });
	assert.deepEqual(discovered.frozen_ledger!.rows[0], {
		...malformedSevere,
		status_at_freeze: "open",
		evidence_class: EVIDENCE_CLASS.INFERENTIAL_SEVERE,
	});
});

test("no-finding ordinary path runs zero refuters, fixes, and validators then verifies once", () => {
	const discovered = recordOrdinaryDiscovery(
		ordinaryState(REVIEW_ROUTE.TRIVIAL, []),
		{ rows: [] },
	);
	const resolved = resolveOrdinaryEvidence(discovered, {
		deterministicResults: [],
	});
	assert.equal(resolved.phase, REVIEW_PHASE.FINAL_VERIFICATION);
	assert.equal(resolved.counters.refuter_batches, 0);
	assert.equal(resolved.counters.fix_batches, 0);
	assert.equal(resolved.counters.validator_runs, 0);
	assert.throws(() => ordinaryValidatorRequest(resolved), /fix.*required/i);

	const terminal = recordOrdinaryFinalVerification(resolved, { passed: true });
	assert.equal(terminal.terminal_state, TERMINAL_STATE.APPROVED);
	assert.equal(terminal.final_candidate_tree, TREE.COMPLETE);
	assert.equal(terminal.counters.final_verifications, 1);
	assert.throws(
		() => recordOrdinaryFinalVerification(terminal, { passed: true }),
		/final verification.*only/i,
	);
});

test("ordinary uses at most one complete-list refuter, one fix, one scoped validator, and one final verification", () => {
	const discovered = recordOrdinaryDiscovery(ordinaryState(), { rows: rows() });
	const frozenHash = discovered.frozen_ledger!.frozen_ledger_hash;
	const resolved = resolveOrdinaryEvidence(discovered, {
		deterministicResults: [
			{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.CORROBORATED },
		],
		refuterResults: [
			{ id: "RELY-002", outcome: RESOLUTION_OUTCOME.REFUTED },
		],
	});
	assert.equal(resolved.counters.refuter_batches, 1);
	assert.equal(resolved.phase, REVIEW_PHASE.REFUTATION_COMPLETE);
	assert.equal(resolved.frozen_ledger!.frozen_ledger_hash, frozenHash);

	const fixed = applyOrdinaryFix(resolved, {
		candidateTree: TREE.FIXED,
		fixedIds: ["RISK-001"],
		fixDiff: "diff --git a/src/auth.ts b/src/auth.ts\n",
	});
	assert.equal(fixed.counters.fix_batches, 1);
	assert.equal(fixed.current_candidate_tree, TREE.FIXED);
	assert.throws(
		() =>
			applyOrdinaryFix(fixed, {
				candidateTree: TREE.FIXED,
				fixedIds: ["RISK-001"],
				fixDiff: "same",
			}),
		/fix.*only.*refutation/i,
	);

	const request = ordinaryValidatorRequest(fixed);
	assert.deepEqual(request.requested_ids, ["RISK-001"]);
	assert.equal(request.frozen_ledger_hash, frozenHash);
	assert.equal(request.fix_diff, "diff --git a/src/auth.ts b/src/auth.ts\n");
	assert.deepEqual(request.frozen_rows, [
		discovered.frozen_ledger!.rows.find(({ id }) => id === "RISK-001")!,
	]);
	const validated = recordOrdinaryValidation(fixed, {
		request,
		results: [{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.VERIFIED }],
	});
	assert.equal(validated.counters.validator_runs, 1);
	assert.equal(validated.phase, REVIEW_PHASE.FINAL_VERIFICATION);
	assert.equal(validated.frozen_ledger!.frozen_ledger_hash, frozenHash);

	const terminal = recordOrdinaryFinalVerification(validated, { passed: true });
	assert.equal(terminal.terminal_state, TERMINAL_STATE.APPROVED);
	assert.equal(terminal.counters.final_verifications, 1);
	assert.equal(terminal.final_candidate_tree, TREE.FIXED);
});

test("ordinary corroboration has explicit no-fix and zero-budget paths to terminal escalation", () => {
	const discovered = recordOrdinaryDiscovery(ordinaryState(), { rows: rows() });
	const resolved = resolveOrdinaryEvidence(discovered, {
		deterministicResults: [
			{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.CORROBORATED },
		],
		refuterResults: [
			{ id: "RELY-002", outcome: RESOLUTION_OUTCOME.REFUTED },
		],
	});
	const declined = declineOrdinaryFix(resolved, "Maintainer declined the authorized fix batch.");
	assert.equal(declined.phase, REVIEW_PHASE.FINAL_VERIFICATION);
	assert.equal(declined.counters.fix_batches, 0);
	assert.equal(declined.counters.validator_runs, 0);
	assert.equal(
		recordOrdinaryFinalVerification(declined, { passed: true }).terminal_state,
		TERMINAL_STATE.ESCALATED,
	);

	const zeroBudgetDiscovery = recordOrdinaryDiscovery(
		ordinaryState(REVIEW_ROUTE.FULL_4R, FULL_4R_LENSES, {
			fix_batches: 0,
			validator_runs: 0,
		}),
		{ rows: rows() },
	);
	const zeroBudget = resolveOrdinaryEvidence(zeroBudgetDiscovery, {
		deterministicResults: [
			{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.CORROBORATED },
		],
		refuterResults: [
			{ id: "RELY-002", outcome: RESOLUTION_OUTCOME.REFUTED },
		],
	});
	assert.equal(zeroBudget.phase, REVIEW_PHASE.FINAL_VERIFICATION);
	assert.match(zeroBudget.escalation_reasons!.at(-1)!, /zero fix budget/i);
});

test("inconclusive or incomplete evidence escalates without a second refuter", () => {
	const discovered = recordOrdinaryDiscovery(ordinaryState(), { rows: rows() });
	const resolved = resolveOrdinaryEvidence(discovered, {
		deterministicResults: [
			{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.REFUTED },
		],
		refuterResults: [],
	});
	assert.equal(resolved.counters.refuter_batches, 1);
	assert.equal(resolved.phase, REVIEW_PHASE.FINAL_VERIFICATION);
	assert.match(resolved.escalation_reasons![0]!, /RELY-002.*inconclusive/i);
	assert.throws(
		() =>
			resolveOrdinaryEvidence(resolved, {
				deterministicResults: [],
				refuterResults: [
					{ id: "RELY-002", outcome: RESOLUTION_OUTCOME.REFUTED },
				],
			}),
		/evidence.*only.*discovery/i,
	);
	const terminal = recordOrdinaryFinalVerification(resolved, { passed: true });
	assert.equal(terminal.terminal_state, TERMINAL_STATE.ESCALATED);
});

test("validator cannot alter frozen claims, add findings, repeat, or hide regressions", () => {
	const discovered = recordOrdinaryDiscovery(ordinaryState(), { rows: rows() });
	const resolved = resolveOrdinaryEvidence(discovered, {
		deterministicResults: [
			{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.CORROBORATED },
		],
		refuterResults: [
			{ id: "RELY-002", outcome: RESOLUTION_OUTCOME.REFUTED },
		],
	});
	const fixed = applyOrdinaryFix(resolved, {
		candidateTree: TREE.FIXED,
		fixedIds: ["RISK-001"],
		fixDiff: "bounded fix",
	});
	const request = ordinaryValidatorRequest(fixed);
	const altered = structuredClone(request);
	altered.frozen_rows[0]!.evidence_claim = "validator rewrote the claim";
	assert.throws(
		() =>
			recordOrdinaryValidation(fixed, {
				request: altered,
				results: [{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.VERIFIED }],
			}),
		/validator request.*exact frozen scope/i,
	);

	const validated = recordOrdinaryValidation(fixed, {
		request,
		results: [
			{ id: "RISK-001", outcome: RESOLUTION_OUTCOME.REGRESSION },
			{ id: "NEW-999", outcome: RESOLUTION_OUTCOME.VERIFIED },
		],
	});
	assert.equal(validated.counters.validator_runs, 1);
	assert.equal(validated.resolutions!.some(({ id }) => id === "NEW-999"), false);
	assert.ok(validated.escalation_reasons!.some((reason) => /new finding NEW-999/i.test(reason)));
	assert.ok(validated.escalation_reasons!.some((reason) => /regression.*RISK-001/i.test(reason)));
	assert.equal(
		canonicalHash(validated.frozen_ledger),
		canonicalHash(fixed.frozen_ledger),
	);
	assert.throws(
		() =>
			recordOrdinaryValidation(validated, {
				request,
				results: [],
			}),
		/validation.*only.*fix/i,
	);
	assert.equal(
		recordOrdinaryFinalVerification(validated, { passed: true }).terminal_state,
		TERMINAL_STATE.ESCALATED,
	);
});

test("failed final verification escalates and ordinary rejects Judgment Day state", () => {
	const discovered = recordOrdinaryDiscovery(
		ordinaryState(REVIEW_ROUTE.TRIVIAL, []),
		{ rows: [] },
	);
	const ready = resolveOrdinaryEvidence(discovered, { deterministicResults: [] });
	const terminal = recordOrdinaryFinalVerification(ready, {
		passed: false,
		reason: "tests failed",
	});
	assert.equal(terminal.terminal_state, TERMINAL_STATE.ESCALATED);
	assert.match(terminal.escalation_reasons!.at(-1)!, /tests failed/);

	const wrongMode = {
		...ordinaryState(),
		mode: REVIEW_MODE.JUDGMENT_DAY,
	};
	assert.throws(
		() => recordOrdinaryDiscovery(wrongMode, { rows: [] }),
		/ordinary reducer.*ordinary mode/i,
	);
});
