import {
	REVIEW_MODE,
	REVIEW_PHASE,
	RESOLUTION_OUTCOME,
	RESOLUTION_SOURCE,
	TERMINAL_STATE,
	canonicalHash,
	createFrozenLedger,
	type CanonicalFrozenRowV1,
	type FindingResolutionV1,
	type ResolutionOutcome,
	type ReviewCountersV1,
	type ReviewStateV1,
} from "./review-transaction.ts";

export interface JudgmentDayDiscoveryInput {
	judgeA: readonly CanonicalFrozenRowV1[];
	judgeB: readonly CanonicalFrozenRowV1[];
}

export interface JudgmentDayFixInput {
	candidateTree: string;
	fixedIds: readonly string[];
	fixDiff: string;
}

export interface JudgmentDayResultInput {
	id: string;
	outcome: ResolutionOutcome;
}

export interface JudgmentDayRejudgmentRequestV1 {
	requested_ids: string[];
	frozen_rows: CanonicalFrozenRowV1[];
	frozen_ledger_hash: string;
	fix_diff: string;
	fix_diff_hash: string;
	candidate_tree: string;
	round: number;
}

export interface JudgmentDayRejudgmentInput {
	request: JudgmentDayRejudgmentRequestV1;
	judgeAResults: readonly JudgmentDayResultInput[];
	judgeBResults: readonly JudgmentDayResultInput[];
}

export interface JudgmentDayFinalVerificationInput {
	passed: boolean;
	reason?: string;
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const SEVERE = new Set(["BLOCKER", "CRITICAL"]);

function cloneState(state: ReviewStateV1): ReviewStateV1 {
	return structuredClone(state);
}

function assertJudgmentDayMode(state: ReviewStateV1): void {
	if (state.mode !== REVIEW_MODE.JUDGMENT_DAY) {
		throw new Error("Judgment Day reducer requires judgment-day mode");
	}
	if (state.terminal_state !== undefined || state.phase === REVIEW_PHASE.TERMINAL) {
		throw new Error("Judgment Day transaction is already terminal");
	}
	if (
		state.budget.review_batches !== 1 ||
		state.budget.review_actors !== 2 ||
		state.budget.refuter_batches !== 0 ||
		state.budget.fix_batches !== 2 ||
		state.budget.validator_runs !== 0 ||
		state.budget.final_verifications !== 1 ||
		state.budget.judgment_rounds !== 2 ||
		state.budget.judge_runs !== 6
	) {
		throw new Error("Judgment Day state has an invalid immutable budget");
	}
}

function increment(
	state: ReviewStateV1,
	key: keyof ReviewCountersV1,
	amount = 1,
): void {
	const next = state.counters[key] + amount;
	if (next > state.budget[key]) throw new Error(`Judgment Day budget exceeded: ${key}`);
	state.counters[key] = next;
}

function appendReasons(state: ReviewStateV1, reasons: readonly string[]): void {
	if (reasons.length === 0) return;
	state.escalation_reasons = [...(state.escalation_reasons ?? []), ...reasons];
}

function severeIds(rows: readonly CanonicalFrozenRowV1[]): string[] {
	return rows
		.filter((row) => SEVERE.has(row.severity) && row.status_at_freeze === "open")
		.map(({ id }) => id)
		.toSorted();
}

export function recordJudgmentDayDiscovery(
	state: ReviewStateV1,
	input: JudgmentDayDiscoveryInput,
): ReviewStateV1 {
	assertJudgmentDayMode(state);
	if (state.phase !== REVIEW_PHASE.STARTED) {
		throw new Error("Judgment Day discovery is allowed only from started phase");
	}
	if ([...input.judgeA, ...input.judgeB].some((row) => row.lens !== "judgment-day")) {
		throw new Error("Judgment Day discovery accepts only judgment-day lens rows");
	}
	const next = cloneState(state);
	next.frozen_ledger = createFrozenLedger([...input.judgeA, ...input.judgeB]);
	next.active_finding_ids = severeIds(next.frozen_ledger.rows);
	increment(next, "review_batches");
	increment(next, "review_actors", 2);
	increment(next, "judge_runs", 2);
	next.phase =
		next.active_finding_ids.length === 0
			? REVIEW_PHASE.FINAL_VERIFICATION
			: REVIEW_PHASE.JUDGMENT_COMPLETE;
	return next;
}

export function applyJudgmentDayFix(
	state: ReviewStateV1,
	input: JudgmentDayFixInput,
): ReviewStateV1 {
	assertJudgmentDayMode(state);
	if (state.phase !== REVIEW_PHASE.JUDGMENT_COMPLETE) {
		throw new Error("Judgment Day fix is allowed only from judgment-complete phase");
	}
	if (!OBJECT_ID.test(input.candidateTree)) {
		throw new Error("Judgment Day fix candidate tree must be resolved");
	}
	if (input.fixDiff.length === 0) throw new Error("Judgment Day fix must bind a non-empty diff");
	const requiredIds = [...(state.active_finding_ids ?? [])].toSorted();
	const fixedIds = [...new Set(input.fixedIds)].toSorted();
	if (canonicalHash(requiredIds) !== canonicalHash(fixedIds)) {
		throw new Error("Judgment Day fix must address every surviving finding in one batch");
	}
	const next = cloneState(state);
	increment(next, "fix_batches");
	next.current_candidate_tree = input.candidateTree;
	next.fix_record = {
		candidate_tree: input.candidateTree,
		fixed_ids: fixedIds,
		fix_diff: input.fixDiff,
		fix_diff_hash: canonicalHash(input.fixDiff),
	};
	next.phase = REVIEW_PHASE.FIX_COMPLETE;
	return next;
}

export function judgmentDayRejudgmentRequest(
	state: ReviewStateV1,
): JudgmentDayRejudgmentRequestV1 {
	assertJudgmentDayMode(state);
	if (state.phase !== REVIEW_PHASE.FIX_COMPLETE || !state.fix_record) {
		throw new Error("A Judgment Day fix is required before re-judgment");
	}
	if (!state.frozen_ledger) throw new Error("Re-judgment requires a frozen ledger");
	const requestedIds = [...(state.active_finding_ids ?? [])].toSorted();
	const requested = new Set(requestedIds);
	const frozenRows = state.frozen_ledger.rows.filter(({ id }) => requested.has(id));
	if (frozenRows.length !== requestedIds.length) {
		throw new Error("Re-judgment IDs do not resolve to exact frozen rows");
	}
	return {
		requested_ids: requestedIds,
		frozen_rows: structuredClone(frozenRows),
		frozen_ledger_hash: state.frozen_ledger.frozen_ledger_hash,
		fix_diff: state.fix_record.fix_diff,
		fix_diff_hash: state.fix_record.fix_diff_hash,
		candidate_tree: state.fix_record.candidate_tree,
		round: state.counters.judgment_rounds + 1,
	};
}

function collectJudgeResults(
	judge: string,
	results: readonly JudgmentDayResultInput[],
	expectedIds: ReadonlySet<string>,
): {
	byId: Map<string, ResolutionOutcome>;
	resolutions: FindingResolutionV1[];
	reasons: string[];
} {
	const byId = new Map<string, ResolutionOutcome>();
	const resolutions: FindingResolutionV1[] = [];
	const reasons: string[] = [];
	for (const result of results) {
		if (!expectedIds.has(result.id)) {
			reasons.push(`${judge} attempted to add new finding ${result.id}.`);
			continue;
		}
		if (byId.has(result.id)) {
			reasons.push(`${judge} duplicated finding ${result.id}.`);
			continue;
		}
		if (
			result.outcome !== RESOLUTION_OUTCOME.VERIFIED &&
			result.outcome !== RESOLUTION_OUTCOME.CORROBORATED &&
			result.outcome !== RESOLUTION_OUTCOME.REGRESSION
		) {
			reasons.push(`${judge} returned an invalid outcome for ${result.id}.`);
			continue;
		}
		byId.set(result.id, result.outcome);
		resolutions.push({
			id: result.id,
			outcome: result.outcome,
			source: RESOLUTION_SOURCE.JUDGE,
		});
	}
	for (const id of expectedIds) {
		if (!byId.has(id)) reasons.push(`${judge} omitted requested finding ${id}.`);
	}
	return { byId, resolutions, reasons };
}

export function recordJudgmentDayRejudgment(
	state: ReviewStateV1,
	input: JudgmentDayRejudgmentInput,
): ReviewStateV1 {
	assertJudgmentDayMode(state);
	if (state.phase !== REVIEW_PHASE.FIX_COMPLETE) {
		throw new Error("Judgment Day re-judgment is allowed only after a fix");
	}
	const expected = judgmentDayRejudgmentRequest(state);
	if (canonicalHash(input.request) !== canonicalHash(expected)) {
		throw new Error("Re-judgment request must preserve exact frozen rows and fix diff");
	}
	const expectedIds = new Set(expected.requested_ids);
	const judgeA = collectJudgeResults("Judge A", input.judgeAResults, expectedIds);
	const judgeB = collectJudgeResults("Judge B", input.judgeBResults, expectedIds);
	const survivors = expected.requested_ids.filter(
		(id) =>
			judgeA.byId.get(id) !== RESOLUTION_OUTCOME.VERIFIED ||
			judgeB.byId.get(id) !== RESOLUTION_OUTCOME.VERIFIED,
	);
	const next = cloneState(state);
	increment(next, "judgment_rounds");
	increment(next, "judge_runs", 2);
	next.resolutions = [
		...(next.resolutions ?? []),
		...judgeA.resolutions,
		...judgeB.resolutions,
	];
	next.active_finding_ids = survivors;
	appendReasons(next, [...judgeA.reasons, ...judgeB.reasons]);
	if (survivors.length > 0 && next.counters.judgment_rounds >= 2) {
		appendReasons(next, [
			`Findings ${survivors.join(", ")} survived Judgment Day round two; no third round is allowed.`,
		]);
		next.phase = REVIEW_PHASE.FINAL_VERIFICATION;
	} else if (survivors.length > 0) {
		next.phase = REVIEW_PHASE.JUDGMENT_COMPLETE;
	} else {
		next.phase = REVIEW_PHASE.FINAL_VERIFICATION;
	}
	return next;
}

export function recordJudgmentDayFinalVerification(
	state: ReviewStateV1,
	input: JudgmentDayFinalVerificationInput,
): ReviewStateV1 {
	if (state.mode !== REVIEW_MODE.JUDGMENT_DAY) {
		throw new Error("Judgment Day reducer requires judgment-day mode");
	}
	if (state.phase !== REVIEW_PHASE.FINAL_VERIFICATION) {
		throw new Error("Judgment Day final verification is allowed only from final-verification phase");
	}
	assertJudgmentDayMode(state);
	const next = cloneState(state);
	increment(next, "final_verifications");
	if (!input.passed) appendReasons(next, [input.reason ?? "Final verification failed."]);
	next.final_candidate_tree = next.current_candidate_tree;
	next.terminal_state =
		input.passed && (next.escalation_reasons?.length ?? 0) === 0
			? TERMINAL_STATE.APPROVED
			: TERMINAL_STATE.ESCALATED;
	next.phase = REVIEW_PHASE.TERMINAL;
	return next;
}
