import {
	EVIDENCE_CLASS,
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
import {
	FULL_4R_LENSES,
	REVIEW_ROUTE,
	type ReviewLens,
} from "./review-triggers.ts";

export { RESOLUTION_OUTCOME };

export interface OrdinaryDiscoveryInput {
	rows: readonly CanonicalFrozenRowV1[];
}

export interface FindingResolutionInput {
	id: string;
	outcome: ResolutionOutcome;
}

export interface OrdinaryEvidenceInput {
	deterministicResults: readonly FindingResolutionInput[];
	refuterResults?: readonly FindingResolutionInput[];
}

export interface OrdinaryFixInput {
	candidateTree: string;
	fixedIds: readonly string[];
	fixDiff: string;
}

export interface OrdinaryValidatorRequestV1 {
	requested_ids: string[];
	frozen_rows: CanonicalFrozenRowV1[];
	frozen_ledger_hash: string;
	fix_diff: string;
	fix_diff_hash: string;
	candidate_tree: string;
}

export interface OrdinaryValidationInput {
	request: OrdinaryValidatorRequestV1;
	results: readonly FindingResolutionInput[];
}

export interface OrdinaryFinalVerificationInput {
	passed: boolean;
	reason?: string;
}

const SEVERE = new Set(["BLOCKER", "CRITICAL"]);
const OBJECT_ID = /^[0-9a-f]{40,64}$/;

function cloneState(state: ReviewStateV1): ReviewStateV1 {
	return structuredClone(state);
}

function assertOrdinaryMode(state: ReviewStateV1): void {
	if (state.mode !== REVIEW_MODE.ORDINARY) {
		throw new Error("Ordinary reducer requires ordinary mode");
	}
	if (state.terminal_state !== undefined || state.phase === REVIEW_PHASE.TERMINAL) {
		throw new Error("Ordinary transaction is already terminal");
	}
	assertOrdinaryBudget(state);
}

function assertOrdinaryBudget(state: ReviewStateV1): void {
	const expectedActors = state.lenses.length;
	if (
		state.budget.review_batches !== 1 ||
		state.budget.review_actors !== expectedActors ||
		state.budget.refuter_batches > 1 ||
		state.budget.fix_batches > 1 ||
		state.budget.validator_runs > 1 ||
		state.budget.final_verifications !== 1 ||
		state.budget.judgment_rounds !== 0 ||
		state.budget.judge_runs !== 0
	) {
		throw new Error("Ordinary state has an invalid immutable budget");
	}
}

function assertRouteBinding(state: ReviewStateV1): void {
	let expected: readonly ReviewLens[];
	if (state.route === REVIEW_ROUTE.TRIVIAL) expected = [];
	else if (state.route === REVIEW_ROUTE.STANDARD) {
		if (state.lenses.length !== 1) throw new Error("Standard route requires exactly one lens");
		return;
	} else if (state.route === REVIEW_ROUTE.FULL_4R) expected = FULL_4R_LENSES;
	else throw new Error("Unsupported ordinary route");
	if (canonicalHash(state.lenses) !== canonicalHash(expected)) {
		throw new Error("Ordinary route and ordered lenses do not match");
	}
}

function severeRows(state: ReviewStateV1): CanonicalFrozenRowV1[] {
	return (state.frozen_ledger?.rows ?? []).filter(
		(row) => SEVERE.has(row.severity) && row.status_at_freeze === "open",
	);
}

function appendReasons(state: ReviewStateV1, reasons: readonly string[]): void {
	if (reasons.length === 0) return;
	state.escalation_reasons = [...(state.escalation_reasons ?? []), ...reasons];
}

function increment(
	state: ReviewStateV1,
	key: keyof ReviewCountersV1,
	amount = 1,
): void {
	const next = state.counters[key] + amount;
	if (next > state.budget[key]) throw new Error(`Ordinary budget exceeded: ${key}`);
	state.counters[key] = next;
}

function validateResolutionList(
	rows: readonly CanonicalFrozenRowV1[],
	inputs: readonly FindingResolutionInput[],
	allowed: ReadonlySet<ResolutionOutcome>,
	source: typeof RESOLUTION_SOURCE.CONTROLLER | typeof RESOLUTION_SOURCE.REFUTER,
): { resolutions: FindingResolutionV1[]; reasons: string[] } {
	const expectedIds = new Set(rows.map(({ id }) => id));
	const seen = new Set<string>();
	const resolutions: FindingResolutionV1[] = [];
	const reasons: string[] = [];
	for (const input of inputs) {
		if (!expectedIds.has(input.id)) {
			reasons.push(`Invalid ${source} result added unknown finding ${input.id}.`);
			continue;
		}
		if (seen.has(input.id)) {
			reasons.push(`Invalid ${source} result duplicated finding ${input.id}.`);
			continue;
		}
		seen.add(input.id);
		if (!allowed.has(input.outcome)) {
			resolutions.push({
				id: input.id,
				outcome: RESOLUTION_OUTCOME.INCONCLUSIVE,
				source,
			});
			reasons.push(`${input.id} became inconclusive because ${source} returned an invalid outcome.`);
			continue;
		}
		resolutions.push({ id: input.id, outcome: input.outcome, source });
	}
	for (const row of rows) {
		if (seen.has(row.id)) continue;
		resolutions.push({
			id: row.id,
			outcome: RESOLUTION_OUTCOME.INCONCLUSIVE,
			source,
		});
		reasons.push(`${row.id} is inconclusive because no valid ${source} result was returned.`);
	}
	return { resolutions, reasons };
}

export function recordOrdinaryDiscovery(
	state: ReviewStateV1,
	input: OrdinaryDiscoveryInput,
): ReviewStateV1 {
	assertOrdinaryMode(state);
	if (state.phase !== REVIEW_PHASE.STARTED) {
		throw new Error("Ordinary discovery is allowed only from started phase");
	}
	assertRouteBinding(state);
	if (state.lenses.length === 0 && input.rows.length !== 0) {
		throw new Error("A zero-lens route cannot return findings");
	}
	const selectedLenses = new Set(state.lenses);
	if (input.rows.some((row) => row.lens === "judgment-day" || !selectedLenses.has(row.lens))) {
		throw new Error("Ordinary discovery returned a finding outside the selected ordinary lens set");
	}
	const next = cloneState(state);
	next.frozen_ledger = createFrozenLedger(input.rows);
	increment(next, "review_batches");
	increment(next, "review_actors", state.lenses.length);
	next.phase = REVIEW_PHASE.DISCOVERY_COMPLETE;
	return next;
}

export function resolveOrdinaryEvidence(
	state: ReviewStateV1,
	input: OrdinaryEvidenceInput,
): ReviewStateV1 {
	assertOrdinaryMode(state);
	if (state.phase !== REVIEW_PHASE.DISCOVERY_COMPLETE) {
		throw new Error("Ordinary evidence resolution is allowed only after discovery");
	}
	if (!state.frozen_ledger) throw new Error("Ordinary evidence requires a frozen ledger");
	const next = cloneState(state);
	const severe = severeRows(state);
	const deterministic = severe.filter(
		(row) => row.evidence_class === EVIDENCE_CLASS.DETERMINISTIC,
	);
	const inferential = severe.filter(
		(row) => row.evidence_class === EVIDENCE_CLASS.INFERENTIAL_SEVERE,
	);
	const controller = validateResolutionList(
		deterministic,
		input.deterministicResults,
		new Set([RESOLUTION_OUTCOME.CORROBORATED, RESOLUTION_OUTCOME.REFUTED]),
		RESOLUTION_SOURCE.CONTROLLER,
	);
	const resolutions = [...controller.resolutions];
	const reasons = [...controller.reasons];
	if (inferential.length > 0) {
		const refuter = validateResolutionList(
			inferential,
			input.refuterResults ?? [],
			new Set([
				RESOLUTION_OUTCOME.CORROBORATED,
				RESOLUTION_OUTCOME.REFUTED,
				RESOLUTION_OUTCOME.INCONCLUSIVE,
			]),
			RESOLUTION_SOURCE.REFUTER,
		);
		if (input.refuterResults !== undefined) increment(next, "refuter_batches");
		resolutions.push(...refuter.resolutions);
		reasons.push(...refuter.reasons);
		for (const resolution of refuter.resolutions) {
			if (resolution.outcome === RESOLUTION_OUTCOME.INCONCLUSIVE) {
				reasons.push(`${resolution.id} remained inconclusive after the only refuter batch.`);
			}
		}
	} else if (input.refuterResults !== undefined && input.refuterResults.length > 0) {
		reasons.push("A refuter result was supplied when no inferential-severe finding existed.");
	}
	next.resolutions = [...(next.resolutions ?? []), ...resolutions];
	appendReasons(next, reasons);
	const corroborated = resolutions.filter(
		(resolution) => resolution.outcome === RESOLUTION_OUTCOME.CORROBORATED,
	);
	if (reasons.length === 0 && corroborated.length > 0 && next.budget.fix_batches === 0) {
		appendReasons(next, [
			"Corroborated severe findings cannot be fixed because this ordinary lineage has zero fix budget.",
		]);
		next.phase = REVIEW_PHASE.FINAL_VERIFICATION;
	} else {
		next.phase =
			reasons.length === 0 && corroborated.length > 0
				? REVIEW_PHASE.REFUTATION_COMPLETE
				: REVIEW_PHASE.FINAL_VERIFICATION;
	}
	return next;
}

function corroboratedFindingIds(state: ReviewStateV1): string[] {
	const severeIds = new Set(severeRows(state).map(({ id }) => id));
	return (state.resolutions ?? [])
		.filter(
			(resolution) =>
				severeIds.has(resolution.id) &&
				resolution.outcome === RESOLUTION_OUTCOME.CORROBORATED,
		)
		.map(({ id }) => id)
		.toSorted();
}

export function applyOrdinaryFix(
	state: ReviewStateV1,
	input: OrdinaryFixInput,
): ReviewStateV1 {
	assertOrdinaryMode(state);
	if (state.phase !== REVIEW_PHASE.REFUTATION_COMPLETE) {
		throw new Error("Ordinary fix is allowed only after refutation");
	}
	if (!OBJECT_ID.test(input.candidateTree)) throw new Error("Fix candidate tree must be resolved");
	if (input.fixDiff.length === 0) throw new Error("Ordinary fix must bind a non-empty fix diff");
	const requiredIds = corroboratedFindingIds(state);
	const fixedIds = [...new Set(input.fixedIds)].toSorted();
	if (canonicalHash(requiredIds) !== canonicalHash(fixedIds)) {
		throw new Error("The one ordinary fix batch must address every corroborated severe finding");
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

export function declineOrdinaryFix(
	state: ReviewStateV1,
	reason: string,
): ReviewStateV1 {
	assertOrdinaryMode(state);
	if (state.phase !== REVIEW_PHASE.REFUTATION_COMPLETE) {
		throw new Error("Ordinary no-fix transition is allowed only after refutation");
	}
	if (reason.trim().length === 0) {
		throw new Error("Ordinary no-fix transition requires an escalation reason");
	}
	const next = cloneState(state);
	appendReasons(next, [reason]);
	next.phase = REVIEW_PHASE.FINAL_VERIFICATION;
	return next;
}

export function ordinaryValidatorRequest(
	state: ReviewStateV1,
): OrdinaryValidatorRequestV1 {
	assertOrdinaryMode(state);
	if (state.phase !== REVIEW_PHASE.FIX_COMPLETE || !state.fix_record) {
		throw new Error("An ordinary fix is required before scoped validation");
	}
	if (!state.frozen_ledger) throw new Error("Scoped validation requires a frozen ledger");
	const requestedIds = [...state.fix_record.fixed_ids];
	const requested = new Set(requestedIds);
	const frozenRows = state.frozen_ledger.rows.filter(({ id }) => requested.has(id));
	if (frozenRows.length !== requestedIds.length) {
		throw new Error("Scoped validator IDs do not resolve to exact frozen rows");
	}
	return {
		requested_ids: requestedIds,
		frozen_rows: structuredClone(frozenRows),
		frozen_ledger_hash: state.frozen_ledger.frozen_ledger_hash,
		fix_diff: state.fix_record.fix_diff,
		fix_diff_hash: state.fix_record.fix_diff_hash,
		candidate_tree: state.fix_record.candidate_tree,
	};
}

export function recordOrdinaryValidation(
	state: ReviewStateV1,
	input: OrdinaryValidationInput,
): ReviewStateV1 {
	assertOrdinaryMode(state);
	if (state.phase !== REVIEW_PHASE.FIX_COMPLETE) {
		throw new Error("Ordinary validation is allowed only after a fix");
	}
	const expected = ordinaryValidatorRequest(state);
	if (canonicalHash(input.request) !== canonicalHash(expected)) {
		throw new Error("Validator request must preserve the exact frozen scope");
	}
	const next = cloneState(state);
	increment(next, "validator_runs");
	const expectedIds = new Set(expected.requested_ids);
	const seen = new Set<string>();
	const reasons: string[] = [];
	const resolutions: FindingResolutionV1[] = [];
	for (const result of input.results) {
		if (!expectedIds.has(result.id)) {
			reasons.push(`Validator attempted to add new finding ${result.id}.`);
			continue;
		}
		if (seen.has(result.id)) {
			reasons.push(`Validator duplicated resolution for ${result.id}.`);
			continue;
		}
		seen.add(result.id);
		if (result.outcome === RESOLUTION_OUTCOME.VERIFIED) {
			resolutions.push({
				id: result.id,
				outcome: result.outcome,
				source: RESOLUTION_SOURCE.VALIDATOR,
			});
		} else if (result.outcome === RESOLUTION_OUTCOME.REGRESSION) {
			resolutions.push({
				id: result.id,
				outcome: result.outcome,
				source: RESOLUTION_SOURCE.VALIDATOR,
			});
			reasons.push(`Validator detected regression for ${result.id}.`);
		} else {
			reasons.push(`Validator returned an invalid resolution for ${result.id}.`);
		}
	}
	for (const id of expected.requested_ids) {
		if (!seen.has(id)) reasons.push(`Validator omitted requested finding ${id}.`);
	}
	next.resolutions = [...(next.resolutions ?? []), ...resolutions];
	appendReasons(next, reasons);
	next.phase = REVIEW_PHASE.FINAL_VERIFICATION;
	return next;
}

export function recordOrdinaryFinalVerification(
	state: ReviewStateV1,
	input: OrdinaryFinalVerificationInput,
): ReviewStateV1 {
	if (state.mode !== REVIEW_MODE.ORDINARY) {
		throw new Error("Ordinary reducer requires ordinary mode");
	}
	if (state.phase !== REVIEW_PHASE.FINAL_VERIFICATION) {
		throw new Error("Ordinary final verification is allowed only from final-verification phase");
	}
	assertOrdinaryMode(state);
	const next = cloneState(state);
	increment(next, "final_verifications");
	if (!input.passed) {
		appendReasons(next, [input.reason ?? "Final verification failed."]);
	}
	next.final_candidate_tree = next.current_candidate_tree;
	next.terminal_state =
		input.passed && (next.escalation_reasons?.length ?? 0) === 0
			? TERMINAL_STATE.APPROVED
			: TERMINAL_STATE.ESCALATED;
	next.phase = REVIEW_PHASE.TERMINAL;
	return next;
}
