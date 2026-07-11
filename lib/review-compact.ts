import { createHash } from "node:crypto";
import { canonicalJsonV1, domainHashV1 } from "./review-canonical.ts";
import {
	REVIEW_RISK_TIER,
	correctionBudget,
	type ReviewRiskTier,
} from "./review-risk.ts";
import {
	REVIEW_MODE,
	type CorrectionSnapshotV1,
	type SnapshotV1,
} from "./review-snapshot.ts";
import {
	FULL_4R_LENSES,
	REVIEW_LENS,
	type ReviewLens,
} from "./review-triggers.ts";

export const COMPACT_REVIEW_STATE = {
	REVIEWING: "reviewing",
	CORRECTION_REQUIRED: "correction_required",
	VALIDATING: "validating",
	APPROVED: "approved",
	ESCALATED: "escalated",
} as const;

export type CompactReviewStateName =
	(typeof COMPACT_REVIEW_STATE)[keyof typeof COMPACT_REVIEW_STATE];

export const CAUSAL_DISPOSITION = {
	INTRODUCED: "introduced",
	BEHAVIOR_ACTIVATED: "behavior-activated",
	WORSENED: "worsened",
	PRE_EXISTING: "pre-existing",
	BASE_ONLY: "base-only",
	UNKNOWN: "unknown",
} as const;

export type CausalDisposition =
	(typeof CAUSAL_DISPOSITION)[keyof typeof CAUSAL_DISPOSITION];

export const COMPACT_EVIDENCE_CLASS = {
	DETERMINISTIC: "deterministic",
	INFERENTIAL: "inferential",
	INSUFFICIENT: "insufficient",
	INFO: "info",
} as const;

export type CompactEvidenceClass =
	(typeof COMPACT_EVIDENCE_CLASS)[keyof typeof COMPACT_EVIDENCE_CLASS];

export const COMPACT_FINDING_OUTCOME = {
	CORROBORATED: "corroborated",
	REFUTED: "refuted",
	INCONCLUSIVE: "inconclusive",
	INFO: "info",
} as const;

export type CompactFindingOutcome =
	(typeof COMPACT_FINDING_OUTCOME)[keyof typeof COMPACT_FINDING_OUTCOME];

export const COMPACT_SEVERITY = {
	BLOCKER: "BLOCKER",
	CRITICAL: "CRITICAL",
	WARNING: "WARNING",
	SUGGESTION: "SUGGESTION",
} as const;

export type CompactSeverity =
	(typeof COMPACT_SEVERITY)[keyof typeof COMPACT_SEVERITY];

export const CAUSAL_PROOF_KIND = {
	CHANGED_HUNK: "changed-hunk",
	CANDIDATE_CREATED_PATH: "candidate-created-path",
	DIFFERENTIAL_TEST: "differential-test",
	BEFORE_AFTER: "before-after",
} as const;

export type CausalProofKind =
	(typeof CAUSAL_PROOF_KIND)[keyof typeof CAUSAL_PROOF_KIND];

export interface CompactFindingInput {
	id?: string;
	lens?: string;
	location?: string;
	severity?: string;
	claim?: string;
	evidence_class?: string;
	causal_disposition?: string;
	proof_refs?: string[];
}

export interface CompactFinding {
	id: string;
	lens: ReviewLens;
	location: string;
	severity: CompactSeverity;
	claim: string;
	evidence_class: CompactEvidenceClass;
	causal_disposition: CausalDisposition;
	proof_refs: string[];
}

export interface CompactLensResultInput {
	lens?: string;
	findings: CompactFindingInput[];
	evidence: string[];
}

export interface CompactLensResult {
	lens: ReviewLens;
	findings: CompactFinding[];
	evidence: string[];
}

export interface CompactRefuterResultInput {
	finding_id: string;
	outcome: string;
	proof_refs: string[];
}

export interface CompactRefuterResult {
	finding_id: string;
	outcome: Exclude<CompactFindingOutcome, "info">;
	proof_refs: string[];
}

export interface CompactFollowUp {
	finding_id: string;
	location: string;
	summary: string;
	proof_refs: string[];
}

export interface CompactReviewResultInput {
	lens_results: CompactLensResultInput[];
	refuter_request_hash?: string;
	refuter_results?: CompactRefuterResultInput[];
}

export interface CompactRefuterRequest {
	request_hash: string;
	findings: CompactFinding[];
}

export interface CompactValidationCheckInput {
	passed: boolean;
	evidence: string[];
}

export interface CompactTargetedValidationInput {
	correction_ids: string[];
	original_criteria: CompactValidationCheckInput;
	correction_regression: CompactValidationCheckInput;
	fix_caused_findings?: CompactFindingInput[];
	follow_ups: CompactFollowUp[];
}

export interface CompactTargetedValidation {
	correction_ids: string[];
	original_criteria: CompactValidationCheckInput;
	correction_regression: CompactValidationCheckInput;
	follow_ups: CompactFollowUp[];
}

export interface CompactCorrectionRecord {
	candidate_tree: string;
	changed_paths: string[];
	changed_lines: number;
	fix_diff_hash: string;
	correction_ids: string[];
	intended_untracked: string[];
}

export interface CompactReviewStateV2 {
	schema: "gentle-ai.review-state/v2";
	lineage_id: string;
	generation: 1;
	mode: typeof REVIEW_MODE.ORDINARY;
	state: CompactReviewStateName;
	initial_snapshot: SnapshotV1;
	current_candidate_tree: string;
	genesis_paths: string[];
	intended_untracked: string[];
	policy_hash: string;
	risk_tier: ReviewRiskTier;
	selected_lenses: readonly ReviewLens[];
	original_changed_lines: number;
	correction_budget: number;
	lens_results: CompactLensResult[];
	findings: CompactFinding[];
	outcomes: Record<string, CompactFindingOutcome>;
	correction_ids: string[];
	follow_ups: CompactFollowUp[];
	correction_line_forecast?: number;
	correction?: CompactCorrectionRecord;
	validation?: CompactTargetedValidation;
	final_evidence_hash?: string;
	escalation_reasons: string[];
}

export interface CompactReceiptBodyV2 {
	schema: "gentle-ai.review-receipt-body/v2";
	lineage_id: string;
	generation: 1;
	authority_revision: string;
	base_tree: string;
	initial_review_tree: string;
	final_candidate_tree: string;
	genesis_paths_hash: string;
	intended_untracked_hash: string;
	policy_hash: string;
	risk_tier: ReviewRiskTier;
	selected_lenses: readonly ReviewLens[];
	original_changed_lines: number;
	correction_budget: number;
	correction_ids: string[];
	fix_diff_hash: string;
	evidence_hash: string;
	terminal_state: "approved" | "escalated";
}

export interface CompactReceiptEnvelopeV2 {
	body: CompactReceiptBodyV2;
	receipt_hash: string;
}

const DIGEST = /^[0-9a-f]{64}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LINEAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FINDING_ID = /^[A-Z][A-Z0-9-]*-[0-9]{3,}$/;
const PROOF_PREFIX = new RegExp(`^(?:${Object.values(CAUSAL_PROOF_KIND).join("|")}):\\S`);
const CANDIDATE_CAUSED = new Set<CausalDisposition>([
	CAUSAL_DISPOSITION.INTRODUCED,
	CAUSAL_DISPOSITION.BEHAVIOR_ACTIVATED,
	CAUSAL_DISPOSITION.WORSENED,
]);
const SEVERE = new Set<CompactSeverity>([
	COMPACT_SEVERITY.BLOCKER,
	COMPACT_SEVERITY.CRITICAL,
]);
const LENS_PREFIX: Record<ReviewLens, string> = {
	[REVIEW_LENS.RISK]: "RISK",
	[REVIEW_LENS.RESILIENCE]: "RESILIENCE",
	[REVIEW_LENS.READABILITY]: "READABILITY",
	[REVIEW_LENS.RELIABILITY]: "RELIABILITY",
};

function clone<T>(value: T): T {
	return JSON.parse(canonicalJsonV1(value)) as T;
}

function canonicalStrings(values: readonly string[], label: string): string[] {
	if (values.some((value) => typeof value !== "string" || value.trim() !== value || value.length === 0)) {
		throw new Error(`${label} must contain non-empty canonical strings`);
	}
	return [...new Set(values)].toSorted();
}

function equal(left: unknown, right: unknown): boolean {
	return canonicalJsonV1(left) === canonicalJsonV1(right);
}

function expectedLenses(tier: ReviewRiskTier): readonly ReviewLens[] {
	if (tier === REVIEW_RISK_TIER.LOW) return [];
	if (tier === REVIEW_RISK_TIER.HIGH) return FULL_4R_LENSES;
	return [];
}

function assertSelectedLenses(
	tier: ReviewRiskTier,
	lenses: readonly ReviewLens[],
): void {
	if (tier === REVIEW_RISK_TIER.MEDIUM) {
		if (lenses.length !== 1 || !Object.values(REVIEW_LENS).includes(lenses[0]!)) {
			throw new Error("Medium compact review requires exactly one selected lens");
		}
		return;
	}
	if (!equal(lenses, expectedLenses(tier))) {
		throw new Error("Compact selected lenses do not match the frozen risk tier");
	}
}

function isConcreteProof(proofRefs: readonly string[]): boolean {
	return proofRefs.length > 0 && proofRefs.every((proof) => PROOF_PREFIX.test(proof));
}

function normalizeSeverity(value: string | undefined): CompactSeverity | undefined {
	const normalized = value?.trim().toUpperCase();
	return Object.values(COMPACT_SEVERITY).find((severity) => severity === normalized);
}

function normalizeEvidenceClass(value: string | undefined): CompactEvidenceClass | undefined {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "inferential-severe") return COMPACT_EVIDENCE_CLASS.INFERENTIAL;
	return Object.values(COMPACT_EVIDENCE_CLASS).find((item) => item === normalized);
}

function normalizeDisposition(value: string | undefined): CausalDisposition | undefined {
	const normalized = value?.trim().toLowerCase();
	return Object.values(CAUSAL_DISPOSITION).find((item) => item === normalized);
}

function canonicalizeLensResults(
	selectedLenses: readonly ReviewLens[],
	inputs: readonly CompactLensResultInput[],
): { results: CompactLensResult[]; findings: CompactFinding[]; reasons: string[] } {
	if (inputs.length !== selectedLenses.length) {
		throw new Error(`Compact review requires all ${selectedLenses.length} selected lens results`);
	}
	const reasons: string[] = [];
	const usedIds = new Set<string>();
	const results = inputs.map((input, lensIndex): CompactLensResult => {
		const lens = selectedLenses[lensIndex]!;
		if (!Array.isArray(input.findings) || !Array.isArray(input.evidence)) {
			throw new Error(`Compact lens result ${lensIndex + 1} requires explicit findings and evidence arrays`);
		}
		if (input.lens !== undefined && input.lens !== lens) {
			reasons.push(`Lens result ${lensIndex + 1} claimed ${input.lens} instead of selected lens ${lens}.`);
		}
		const sorted = input.findings.map((finding, index) => ({ finding, index })).toSorted((left, right) => {
			const leftKey = [left.finding.location ?? "", left.finding.claim ?? "", left.finding.severity ?? "", left.index];
			const rightKey = [right.finding.location ?? "", right.finding.claim ?? "", right.finding.severity ?? "", right.index];
			return canonicalJsonV1(leftKey).localeCompare(canonicalJsonV1(rightKey));
		});
		let nextId = 1;
		const findings = sorted.map(({ finding }): CompactFinding => {
			const severity = normalizeSeverity(finding.severity) ?? COMPACT_SEVERITY.CRITICAL;
			const severe = SEVERE.has(severity);
			const evidenceClass = severe
				? normalizeEvidenceClass(finding.evidence_class) ?? COMPACT_EVIDENCE_CLASS.INSUFFICIENT
				: COMPACT_EVIDENCE_CLASS.INFO;
			const disposition = severe
				? normalizeDisposition(finding.causal_disposition) ?? CAUSAL_DISPOSITION.UNKNOWN
				: normalizeDisposition(finding.causal_disposition) ?? CAUSAL_DISPOSITION.UNKNOWN;
			const proofRefs = Array.isArray(finding.proof_refs)
				? finding.proof_refs.filter((proof): proof is string => typeof proof === "string").toSorted()
				: [];
			let id = finding.id?.trim().toUpperCase() ?? "";
			while (!id || !FINDING_ID.test(id) || usedIds.has(id)) {
				if (id && severe) reasons.push(`Finding ID ${id} was malformed or duplicated and was replaced natively.`);
				id = `${LENS_PREFIX[lens]}-${String(nextId).padStart(3, "0")}`;
				nextId += 1;
				if (!usedIds.has(id)) break;
			}
			usedIds.add(id);
			const location = finding.location?.trim() || "unknown:0";
			const claim = finding.claim?.trim() || "Malformed severe finding without a concrete claim.";
			if (severe && (
				!normalizeSeverity(finding.severity) ||
				!finding.location?.trim() ||
				!finding.claim?.trim() ||
				!normalizeEvidenceClass(finding.evidence_class) ||
				!normalizeDisposition(finding.causal_disposition) ||
				!isConcreteProof(proofRefs)
			)) {
				reasons.push(`${id} is a malformed or insufficient severe claim.`);
			}
			return {
				id,
				lens,
				location,
				severity,
				claim,
				evidence_class: evidenceClass,
				causal_disposition: disposition,
				proof_refs: proofRefs,
			};
		});
		return {
			lens,
			findings: findings.toSorted((left, right) => left.id.localeCompare(right.id)),
			evidence: input.evidence.filter((item): item is string => typeof item === "string").toSorted(),
		};
	});
	return { results, findings: results.flatMap(({ findings }) => findings), reasons };
}

function refuterRequest(
	current: CompactReviewStateV2,
	canonical: ReturnType<typeof canonicalizeLensResults>,
): CompactRefuterRequest | undefined {
	const findings = canonical.findings.filter((finding) =>
		SEVERE.has(finding.severity) &&
		finding.evidence_class === COMPACT_EVIDENCE_CLASS.INFERENTIAL &&
		CANDIDATE_CAUSED.has(finding.causal_disposition) &&
		isConcreteProof(finding.proof_refs)
	);
	if (findings.length === 0) return undefined;
	return {
		request_hash: domainHashV1("compact-refuter-request", {
			lineage_id: current.lineage_id,
			candidate_tree: current.current_candidate_tree,
			lens_results: canonical.results,
			finding_ids: findings.map(({ id }) => id),
		}),
		findings: clone(findings),
	};
}

export function createCompactRefuterRequest(
	current: CompactReviewStateV2,
	lensResults: readonly CompactLensResultInput[],
): CompactRefuterRequest | undefined {
	assertCompactReviewState(current);
	if (current.state !== COMPACT_REVIEW_STATE.REVIEWING) throw new Error(`Cannot request compact refutation from ${current.state}`);
	return refuterRequest(current, canonicalizeLensResults(current.selected_lenses, lensResults));
}

function causalFollowUp(finding: CompactFinding): CompactFollowUp {
	return {
		finding_id: finding.id,
		location: finding.location,
		summary: finding.claim,
		proof_refs: [...finding.proof_refs],
	};
}

function validateRefuterBatch(
	inferentialIds: readonly string[],
	input: readonly CompactRefuterResultInput[] | undefined,
): { results: CompactRefuterResult[]; reasons: string[] } {
	if (inferentialIds.length === 0) {
		return {
			results: [],
			reasons: input && input.length > 0
				? ["A refuter batch was supplied without inferential candidate-caused severe findings."]
				: [],
		};
	}
	if (!input) {
		return { results: [], reasons: ["Inferential severe findings require exactly one complete refuter batch."] };
	}
	const expected = new Set(inferentialIds);
	const seen = new Set<string>();
	const reasons: string[] = [];
	const results: CompactRefuterResult[] = [];
	for (const item of input as readonly unknown[]) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			reasons.push("Refuter result <malformed> is malformed, duplicated, or outside the complete batch.");
			continue;
		}
		const row = item as Partial<CompactRefuterResultInput>;
		const id = typeof row.finding_id === "string" ? row.finding_id.trim().toUpperCase() : "";
		const outcome = typeof row.outcome === "string" ? Object.values(COMPACT_FINDING_OUTCOME).find((value) => value === row.outcome) as CompactFindingOutcome | undefined : undefined;
		const proofRefs = Array.isArray(row.proof_refs) && row.proof_refs.every((proof) => typeof proof === "string") ? row.proof_refs : undefined;
		if (!expected.has(id) || seen.has(id) || outcome === undefined || outcome === COMPACT_FINDING_OUTCOME.INFO || !proofRefs || !isConcreteProof(proofRefs)) {
			reasons.push(`Refuter result ${id || "<missing>"} is malformed, duplicated, or outside the complete batch.`);
			continue;
		}
		seen.add(id);
		results.push({
			finding_id: id,
			outcome,
			proof_refs: [...proofRefs].toSorted(),
		});
	}
	for (const id of inferentialIds) {
		if (!seen.has(id)) reasons.push(`Refuter batch omitted inferential finding ${id}.`);
	}
	return { results: results.toSorted((left, right) => left.finding_id.localeCompare(right.finding_id)), reasons };
}

export function createCompactReviewState(input: {
	lineageId: string;
	snapshot: SnapshotV1;
	policyHash: string;
}): CompactReviewStateV2 {
	if (!LINEAGE_ID.test(input.lineageId)) throw new Error("Compact review lineage ID is invalid");
	if (input.snapshot.mode !== REVIEW_MODE.ORDINARY) throw new Error("Compact reviews require ordinary mode");
	if (!DIGEST.test(input.policyHash)) throw new Error("Compact review policy hash is invalid");
	const state: CompactReviewStateV2 = {
		schema: "gentle-ai.review-state/v2",
		lineage_id: input.lineageId,
		generation: 1,
		mode: REVIEW_MODE.ORDINARY,
		state: COMPACT_REVIEW_STATE.REVIEWING,
		initial_snapshot: clone(input.snapshot),
		current_candidate_tree: input.snapshot.initial_review_tree,
		genesis_paths: [...(input.snapshot.genesis_paths ?? [])],
		intended_untracked: [...input.snapshot.intended_untracked],
		policy_hash: input.policyHash,
		risk_tier: input.snapshot.risk_tier,
		selected_lenses: Object.freeze([...input.snapshot.lenses]),
		original_changed_lines: input.snapshot.original_changed_lines,
		correction_budget: input.snapshot.correction_budget,
		lens_results: [],
		findings: [],
		outcomes: {},
		correction_ids: [],
		follow_ups: [],
		escalation_reasons: [],
	};
	assertCompactReviewState(state);
	return state;
}

export function completeCompactReview(
	current: CompactReviewStateV2,
	input: CompactReviewResultInput,
): CompactReviewStateV2 {
	assertCompactReviewState(current);
	if (current.state !== COMPACT_REVIEW_STATE.REVIEWING) {
		throw new Error(`Cannot complete compact review from ${current.state}`);
	}
	const next = clone(current);
	const canonical = canonicalizeLensResults(current.selected_lenses, input.lens_results);
	const request = refuterRequest(current, canonical);
	if (request?.request_hash !== input.refuter_request_hash) {
		throw new Error("Compact refuter request hash is missing or does not match the identical canonical lens input");
	}
	next.lens_results = canonical.results;
	next.findings = canonical.findings;
	next.escalation_reasons.push(...canonical.reasons);
	const inferential: string[] = [];
	for (const finding of next.findings) {
		if (!SEVERE.has(finding.severity)) {
			next.outcomes[finding.id] = COMPACT_FINDING_OUTCOME.INFO;
			continue;
		}
		if (finding.evidence_class === COMPACT_EVIDENCE_CLASS.INSUFFICIENT || !isConcreteProof(finding.proof_refs)) {
			next.outcomes[finding.id] = COMPACT_FINDING_OUTCOME.INCONCLUSIVE;
			next.escalation_reasons.push(`${finding.id} has insufficient or malformed severe evidence.`);
			continue;
		}
		if (
			finding.causal_disposition === CAUSAL_DISPOSITION.PRE_EXISTING ||
			finding.causal_disposition === CAUSAL_DISPOSITION.BASE_ONLY
		) {
			next.outcomes[finding.id] = COMPACT_FINDING_OUTCOME.INFO;
			next.follow_ups.push(causalFollowUp(finding));
			continue;
		}
		if (finding.causal_disposition === CAUSAL_DISPOSITION.UNKNOWN) {
			next.outcomes[finding.id] = COMPACT_FINDING_OUTCOME.INCONCLUSIVE;
			next.escalation_reasons.push(`${finding.id} has unknown causal disposition.`);
			continue;
		}
		if (!CANDIDATE_CAUSED.has(finding.causal_disposition)) {
			next.outcomes[finding.id] = COMPACT_FINDING_OUTCOME.INCONCLUSIVE;
			next.escalation_reasons.push(`${finding.id} has unsupported causal disposition.`);
			continue;
		}
		if (finding.evidence_class === COMPACT_EVIDENCE_CLASS.DETERMINISTIC) {
			next.outcomes[finding.id] = COMPACT_FINDING_OUTCOME.CORROBORATED;
			next.correction_ids.push(finding.id);
		} else if (finding.evidence_class === COMPACT_EVIDENCE_CLASS.INFERENTIAL) {
			inferential.push(finding.id);
		} else {
			next.outcomes[finding.id] = COMPACT_FINDING_OUTCOME.INCONCLUSIVE;
			next.escalation_reasons.push(`${finding.id} has insufficient severe evidence.`);
		}
	}
	const refuter = validateRefuterBatch(inferential, input.refuter_results);
	next.escalation_reasons.push(...refuter.reasons);
	for (const result of refuter.results) {
		next.outcomes[result.finding_id] = result.outcome;
		if (result.outcome === COMPACT_FINDING_OUTCOME.CORROBORATED) {
			next.correction_ids.push(result.finding_id);
		} else if (result.outcome === COMPACT_FINDING_OUTCOME.INCONCLUSIVE) {
			next.escalation_reasons.push(`${result.finding_id} remained inconclusive after the only refuter batch.`);
		}
	}
	for (const id of inferential) {
		if (next.outcomes[id] === undefined) next.outcomes[id] = COMPACT_FINDING_OUTCOME.INCONCLUSIVE;
	}
	next.correction_ids = canonicalStrings(next.correction_ids, "Compact correction IDs");
	next.follow_ups = next.follow_ups.toSorted((left, right) => left.finding_id.localeCompare(right.finding_id));
	next.state = next.escalation_reasons.length > 0
		? COMPACT_REVIEW_STATE.ESCALATED
		: next.correction_ids.length > 0
			? COMPACT_REVIEW_STATE.CORRECTION_REQUIRED
			: COMPACT_REVIEW_STATE.VALIDATING;
	assertCompactReviewState(next);
	return next;
}

export function beginCompactCorrection(
	current: CompactReviewStateV2,
	forecast: number,
): CompactReviewStateV2 {
	assertCompactReviewState(current);
	if (
		current.state !== COMPACT_REVIEW_STATE.CORRECTION_REQUIRED ||
		current.correction_line_forecast !== undefined
	) {
		throw new Error(`Cannot begin compact correction from ${current.state}`);
	}
	if (!Number.isSafeInteger(forecast) || forecast <= 0) {
		throw new Error("Compact correction requires a positive changed-line forecast before editing");
	}
	const next = clone(current);
	next.correction_line_forecast = forecast;
	if (forecast > next.correction_budget) {
		next.state = COMPACT_REVIEW_STATE.ESCALATED;
		next.escalation_reasons.push(`Correction forecast ${forecast} exceeds frozen budget ${next.correction_budget}.`);
	}
	assertCompactReviewState(next);
	return next;
}

export function completeCompactCorrection(
	current: CompactReviewStateV2,
	snapshot: CorrectionSnapshotV1,
	intendedUntracked: readonly string[],
	input: CompactTargetedValidationInput,
): CompactReviewStateV2 {
	assertCompactReviewState(current);
	if (
		current.state !== COMPACT_REVIEW_STATE.CORRECTION_REQUIRED ||
		current.correction_line_forecast === undefined
	) {
		throw new Error(`Cannot complete compact correction from ${current.state}`);
	}
	if (current.correction_line_forecast > current.correction_budget) {
		throw new Error("Compact correction forecast exceeds the frozen budget");
	}
	if (snapshot.changed_lines > current.correction_budget) {
		throw new Error(`Actual correction is ${snapshot.changed_lines} changed lines, exceeding frozen budget ${current.correction_budget}`);
	}
	if (!equal(canonicalStrings(snapshot.changed_paths, "Correction paths"), snapshot.changed_paths)) {
		throw new Error("Correction paths are not canonical");
	}
	if (snapshot.changed_paths.some((path) => !current.genesis_paths.includes(path))) {
		throw new Error("Compact correction touches a path outside the frozen original scope");
	}
	if (!equal(canonicalStrings(intendedUntracked, "Correction untracked paths"), current.intended_untracked)) {
		throw new Error("Compact correction changed the frozen untracked path set");
	}
	const correctionIds = canonicalStrings(input.correction_ids, "Targeted validation correction IDs");
	if (!equal(correctionIds, current.correction_ids)) {
		throw new Error("Targeted validation must cover exactly the frozen correction IDs");
	}
	if (
		!Array.isArray(input.original_criteria?.evidence) ||
		input.original_criteria.evidence.length === 0 ||
		!Array.isArray(input.correction_regression?.evidence) ||
		input.correction_regression.evidence.length === 0
	) {
		throw new Error("Targeted validation requires original criteria and correction regression evidence");
	}
	const next = clone(current);
	next.current_candidate_tree = snapshot.candidate_tree;
	next.correction = {
		candidate_tree: snapshot.candidate_tree,
		changed_paths: [...snapshot.changed_paths],
		changed_lines: snapshot.changed_lines,
		fix_diff_hash: snapshot.fix_diff_hash,
		correction_ids: [...current.correction_ids],
		intended_untracked: [...intendedUntracked],
	};
	next.validation = {
		correction_ids: correctionIds,
		original_criteria: clone(input.original_criteria),
		correction_regression: clone(input.correction_regression),
		follow_ups: clone(input.follow_ups ?? []).toSorted((left, right) => left.finding_id.localeCompare(right.finding_id)),
	};
	next.follow_ups.push(...next.validation.follow_ups);
	if ((input.fix_caused_findings?.length ?? 0) > 0) {
		next.escalation_reasons.push("Targeted validation attempted to add correction-caused findings or scope.");
	}
	if (!input.original_criteria.passed) next.escalation_reasons.push("Original criteria failed during targeted validation.");
	if (!input.correction_regression.passed) next.escalation_reasons.push("Correction regression check failed.");
	next.state = next.escalation_reasons.length > 0
		? COMPACT_REVIEW_STATE.ESCALATED
		: COMPACT_REVIEW_STATE.VALIDATING;
	assertCompactReviewState(next);
	return next;
}

export function completeCompactVerification(
	current: CompactReviewStateV2,
	evidence: string | Uint8Array,
	approved: boolean,
): CompactReviewStateV2 {
	assertCompactReviewState(current);
	if (current.state !== COMPACT_REVIEW_STATE.VALIDATING) {
		throw new Error(`Cannot complete compact verification from ${current.state}`);
	}
	const bytes = typeof evidence === "string" ? new TextEncoder().encode(evidence) : evidence;
	if (bytes.byteLength === 0) throw new Error("Compact final verification evidence is required");
	const next = clone(current);
	next.final_evidence_hash = createHash("sha256").update(bytes).digest("hex");
	next.state = approved ? COMPACT_REVIEW_STATE.APPROVED : COMPACT_REVIEW_STATE.ESCALATED;
	if (!approved) next.escalation_reasons.push("Final verification failed.");
	assertCompactReviewState(next);
	return next;
}

export function assertCompactReviewState(state: CompactReviewStateV2): void {
	if (state.schema !== "gentle-ai.review-state/v2" || state.mode !== REVIEW_MODE.ORDINARY) {
		throw new Error("Unsupported compact review state schema or mode");
	}
	if (!LINEAGE_ID.test(state.lineage_id) || state.generation !== 1) throw new Error("Compact review identity is invalid");
	if (!OBJECT_ID.test(state.initial_snapshot.base_tree) || !OBJECT_ID.test(state.initial_snapshot.initial_review_tree) || !OBJECT_ID.test(state.current_candidate_tree)) {
		throw new Error("Compact review tree identity is invalid");
	}
	if (!DIGEST.test(state.policy_hash)) throw new Error("Compact policy hash is invalid");
	if (state.initial_snapshot.mode !== REVIEW_MODE.ORDINARY) throw new Error("Compact initial snapshot mode is invalid");
	const genesis = canonicalStrings(state.genesis_paths, "Compact genesis paths");
	if (!equal(genesis, state.genesis_paths) || !equal(genesis, state.initial_snapshot.genesis_paths ?? [])) {
		throw new Error("Compact genesis paths do not match the frozen snapshot scope");
	}
	const untracked = canonicalStrings(state.intended_untracked, "Compact intended-untracked paths");
	if (!equal(untracked, state.intended_untracked) || !equal(untracked, state.initial_snapshot.intended_untracked)) {
		throw new Error("Compact intended-untracked paths do not match the frozen snapshot");
	}
	if (state.risk_tier !== state.initial_snapshot.risk_tier || state.original_changed_lines !== state.initial_snapshot.original_changed_lines || state.correction_budget !== state.initial_snapshot.correction_budget) {
		throw new Error("Compact authored-risk baseline changed");
	}
	if (state.correction_budget !== correctionBudget(state.original_changed_lines)) {
		throw new Error("Compact correction budget does not match original changed lines");
	}
	assertSelectedLenses(state.risk_tier, state.selected_lenses);
	if (!equal(state.selected_lenses, state.initial_snapshot.lenses)) {
		throw new Error("Compact selected lenses changed from the frozen snapshot");
	}
	if (!Array.isArray(state.lens_results) || !Array.isArray(state.findings) || !Array.isArray(state.correction_ids) || !Array.isArray(state.follow_ups) || !Array.isArray(state.escalation_reasons)) {
		throw new Error("Compact review collections must be explicit");
	}
	if (state.lens_results.length > state.selected_lenses.length) throw new Error("Compact review has extra lens results");
	for (const [index, result] of state.lens_results.entries()) {
		if (result.lens !== state.selected_lenses[index]) throw new Error("Compact lens results are not in selected-lens order");
		if (!equal(result.evidence, [...result.evidence].toSorted())) throw new Error("Compact lens evidence is not canonical");
		if (!equal(result.findings, [...result.findings].toSorted((left, right) => left.id.localeCompare(right.id)))) throw new Error("Compact lens findings are not canonical");
		if (result.findings.some((finding) => finding.lens !== result.lens)) throw new Error("Compact finding lens does not match its selected result");
	}
	if (!equal(state.findings, state.lens_results.flatMap(({ findings }) => findings))) {
		throw new Error("Compact findings do not match canonical lens result concatenation");
	}
	if (new Set(state.findings.map(({ id }) => id)).size !== state.findings.length) throw new Error("Compact finding IDs are duplicated");
	if (!equal(canonicalStrings(state.correction_ids, "Compact correction IDs"), state.correction_ids)) {
		throw new Error("Compact correction IDs are not canonical");
	}
	if (state.state !== COMPACT_REVIEW_STATE.REVIEWING) {
		const findingIds = state.findings.map(({ id }) => id).toSorted();
		if (!equal(Object.keys(state.outcomes).toSorted(), findingIds)) throw new Error("Compact finding outcomes are missing or contain unknown IDs");
		const expectedCorrectionIds: string[] = [];
		let unresolved = false;
		for (const finding of state.findings) {
			const outcome = state.outcomes[finding.id];
			if (!SEVERE.has(finding.severity)) {
				if (outcome !== COMPACT_FINDING_OUTCOME.INFO) throw new Error("Non-severe compact findings must remain informational");
				continue;
			}
			if (finding.causal_disposition === CAUSAL_DISPOSITION.PRE_EXISTING || finding.causal_disposition === CAUSAL_DISPOSITION.BASE_ONLY) {
				if (outcome !== COMPACT_FINDING_OUTCOME.INFO || !state.follow_ups.some(({ finding_id }) => finding_id === finding.id)) throw new Error("Non-candidate severe finding is not an inert follow-up");
				continue;
			}
			if (finding.causal_disposition === CAUSAL_DISPOSITION.UNKNOWN || finding.evidence_class === COMPACT_EVIDENCE_CLASS.INSUFFICIENT || outcome === COMPACT_FINDING_OUTCOME.INCONCLUSIVE) {
				if (outcome !== COMPACT_FINDING_OUTCOME.INCONCLUSIVE) throw new Error("Unresolved compact severe finding must be inconclusive");
				unresolved = true;
				continue;
			}
			if (CANDIDATE_CAUSED.has(finding.causal_disposition) && outcome === COMPACT_FINDING_OUTCOME.CORROBORATED) expectedCorrectionIds.push(finding.id);
			else if (outcome !== COMPACT_FINDING_OUTCOME.REFUTED) throw new Error("Candidate-caused severe finding has an invalid outcome");
		}
		if (!equal(expectedCorrectionIds.toSorted(), state.correction_ids)) throw new Error("Compact correction IDs do not match causal corroborated findings");
		if (unresolved && state.state !== COMPACT_REVIEW_STATE.ESCALATED) throw new Error("Unresolved severe findings must escalate");
	} else if (Object.keys(state.outcomes).length > 0) {
		throw new Error("Reviewing compact state contains finding outcomes");
	}
	if (state.correction_line_forecast !== undefined && (!Number.isSafeInteger(state.correction_line_forecast) || state.correction_line_forecast <= 0)) {
		throw new Error("Compact correction forecast must be positive");
	}
	if (state.correction) {
		if (!DIGEST.test(state.correction.fix_diff_hash) || state.correction.changed_lines > state.correction_budget || state.correction.candidate_tree !== state.current_candidate_tree || !equal(state.correction.correction_ids, state.correction_ids) || !equal(state.correction.intended_untracked, state.intended_untracked)) {
			throw new Error("Compact correction record is not bound to frozen authority");
		}
	}
	if (state.validation && (!state.correction || !equal(state.validation.correction_ids, state.correction_ids) || state.validation.original_criteria.evidence.length === 0 || state.validation.correction_regression.evidence.length === 0)) {
		throw new Error("Compact targeted validation is incomplete or unbound");
	}
	if (state.state === COMPACT_REVIEW_STATE.REVIEWING) {
		if (state.findings.length > 0 || state.lens_results.length > 0 || state.correction_ids.length > 0 || state.final_evidence_hash !== undefined) {
			throw new Error("Reviewing compact state contains post-review data");
		}
	} else if (state.lens_results.length !== state.selected_lenses.length) {
		throw new Error("Post-review compact state requires every selected lens result");
	}
	if (state.state === COMPACT_REVIEW_STATE.CORRECTION_REQUIRED && state.correction_ids.length === 0) {
		throw new Error("Correction-required compact state has no correction IDs");
	}
	if (state.state === COMPACT_REVIEW_STATE.VALIDATING && state.correction_ids.length > 0 && (!state.correction || !state.validation)) {
		throw new Error("Corrected compact state requires one targeted validation");
	}
	if (state.state === COMPACT_REVIEW_STATE.APPROVED && !DIGEST.test(state.final_evidence_hash ?? "")) {
		throw new Error("Approved compact state requires final verification evidence");
	}
	if (!Object.values(COMPACT_REVIEW_STATE).includes(state.state)) throw new Error("Compact review state is invalid");
}

export function createCompactReceipt(
	state: CompactReviewStateV2,
	authorityRevision: string,
): CompactReceiptEnvelopeV2 {
	assertCompactReviewState(state);
	if (state.state !== COMPACT_REVIEW_STATE.APPROVED && state.state !== COMPACT_REVIEW_STATE.ESCALATED) {
		throw new Error("Compact receipt requires terminal authority");
	}
	if (!DIGEST.test(authorityRevision)) throw new Error("Compact receipt authority revision is invalid");
	const body: CompactReceiptBodyV2 = {
		schema: "gentle-ai.review-receipt-body/v2",
		lineage_id: state.lineage_id,
		generation: state.generation,
		authority_revision: authorityRevision,
		base_tree: state.initial_snapshot.base_tree,
		initial_review_tree: state.initial_snapshot.initial_review_tree,
		final_candidate_tree: state.current_candidate_tree,
		genesis_paths_hash: domainHashV1("compact-paths", state.genesis_paths),
		intended_untracked_hash: domainHashV1("compact-untracked", state.intended_untracked),
		policy_hash: state.policy_hash,
		risk_tier: state.risk_tier,
		selected_lenses: [...state.selected_lenses],
		original_changed_lines: state.original_changed_lines,
		correction_budget: state.correction_budget,
		correction_ids: [...state.correction_ids],
		fix_diff_hash: state.correction?.fix_diff_hash ?? domainHashV1("compact-empty-fix", null),
		evidence_hash: state.final_evidence_hash ?? domainHashV1("compact-empty-evidence", null),
		terminal_state: state.state,
	};
	return { body, receipt_hash: domainHashV1("compact-receipt", body) };
}

export function assertCompactReceipt(
	receipt: CompactReceiptEnvelopeV2,
): void {
	const { body } = receipt;
	if (body.schema !== "gentle-ai.review-receipt-body/v2" || body.generation !== 1 || !LINEAGE_ID.test(body.lineage_id)) throw new Error("Compact receipt identity is invalid");
	for (const digest of [body.authority_revision, body.genesis_paths_hash, body.intended_untracked_hash, body.policy_hash, body.fix_diff_hash, body.evidence_hash, receipt.receipt_hash]) {
		if (!DIGEST.test(digest)) throw new Error("Compact receipt contains an invalid digest");
	}
	for (const tree of [body.base_tree, body.initial_review_tree, body.final_candidate_tree]) {
		if (!OBJECT_ID.test(tree)) throw new Error("Compact receipt contains an invalid tree");
	}
	assertSelectedLenses(body.risk_tier, body.selected_lenses);
	if (!equal(canonicalStrings(body.correction_ids, "Compact receipt correction IDs"), body.correction_ids)) throw new Error("Compact receipt correction IDs are not canonical");
	if (body.correction_budget !== correctionBudget(body.original_changed_lines)) throw new Error("Compact receipt budget is invalid");
	if (receipt.receipt_hash !== domainHashV1("compact-receipt", body)) throw new Error("Compact receipt hash mismatch");
}
