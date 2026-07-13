import {
	CAUSAL_DISPOSITION,
	COMPACT_EVIDENCE_CLASS,
	COMPACT_FINDING_OUTCOME,
	COMPACT_SEVERITY,
	type CompactRefuterResultInput,
	type CompactFinding,
	type CompactLensResultInput,
	type CompactValidationProofInput,
	type CompactReviewResultInput,
	type CompactTargetedValidationInput,
} from "./review-compact.ts";
import { REVIEW_LENS } from "./review-triggers.ts";
import { normalizeRefuterBatch, type RefuterBatch } from "./review-refuter-adapter.ts";

const DIGEST = /^[0-9a-f]{64}$/;
const LINEAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class CompactReviewContractError extends Error {
	readonly area: string;
	readonly code: string;

	constructor(area: string, code: string, message: string) {
		super(`${area}: ${message}`);
		this.name = "CompactReviewContractError";
		this.area = area;
		this.code = code;
	}
}

export interface CompactStartContractInput {
	cwd: string;
	lineageId?: string;
	policyHash: string;
	projection?: { kind: "complete" };
}

export interface CompactFinalizeContractInput {
	cwd: string;
	lineageId?: string;
	review_result?: CompactReviewResultInput;
	correction_line_forecast?: number;
	validation_proof?: CompactValidationProofInput;
	validation?: CompactTargetedValidationInput;
	final_evidence?: string;
	final_verification_passed?: boolean;
	refuter_batch?: unknown;
}

function fail(area: string, code: string, message: string): never {
	throw new CompactReviewContractError(area, code, message);
}

function record(value: unknown, area: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		return fail(area, "type", "must be a plain object");
	}
	return value as Record<string, unknown>;
}

function exact(value: unknown, area: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	const object = record(value, area);
	for (const key of Object.keys(object)) if (!required.includes(key) && !optional.includes(key)) fail(area, "unknown-key", `contains unknown field ${key}`);
	for (const key of required) if (!(key in object)) fail(area, "required", `requires ${key}`);
	return object;
}

function string(value: unknown, area: string): string {
	if (typeof value !== "string") return fail(area, "type", "must be a string");
	if (value.length === 0 || value.trim() !== value) return fail(area, "canonical-string", "must be non-empty and trimmed");
	return value;
}

function optionalString(value: unknown, area: string): string | undefined {
	return value === undefined ? undefined : string(value, area);
}

function strings(value: unknown, area: string): string[] {
	if (!Array.isArray(value)) return fail(area, "type", "must be an array");
	const parsed = value.map((item, index) => string(item, `${area}[${index}]`));
	if (new Set(parsed).size !== parsed.length) fail(area, "duplicate", "must not contain duplicates");
	return parsed;
}

function enumValue<T extends Record<string, string>>(value: unknown, values: T, area: string): T[keyof T] {
	const parsed = string(value, area);
	if (!Object.values(values).includes(parsed)) return fail(area, "enum", "contains an unsupported value");
	return parsed as T[keyof T];
}

function optionalLineage(value: unknown, area: string): string | undefined {
	const parsed = optionalString(value, area);
	if (parsed !== undefined && !LINEAGE_ID.test(parsed)) fail(area, "lineage", "is malformed");
	return parsed;
}

function parseFinding(value: unknown, area: string) {
	const row = exact(value, area, ["location", "severity", "claim", "proof_refs"], ["id", "lens", "evidence_class", "causal_disposition"]);
	const severity = enumValue(row.severity, COMPACT_SEVERITY, `${area}.severity`);
	const severe = severity === COMPACT_SEVERITY.BLOCKER || severity === COMPACT_SEVERITY.CRITICAL;
	if (severe && (row.evidence_class === undefined || row.causal_disposition === undefined)) fail(area, "required", "severe findings require evidence_class and causal_disposition");
	return {
		...(row.id === undefined ? {} : { id: string(row.id, `${area}.id`) }),
		...(row.lens === undefined ? {} : { lens: enumValue(row.lens, REVIEW_LENS, `${area}.lens`) }),
		location: string(row.location, `${area}.location`),
		severity,
		claim: string(row.claim, `${area}.claim`),
		...(row.evidence_class === undefined ? {} : { evidence_class: enumValue(row.evidence_class, COMPACT_EVIDENCE_CLASS, `${area}.evidence_class`) }),
		...(row.causal_disposition === undefined ? {} : { causal_disposition: enumValue(row.causal_disposition, CAUSAL_DISPOSITION, `${area}.causal_disposition`) }),
		proof_refs: strings(row.proof_refs, `${area}.proof_refs`),
	};
}

function parseReviewResult(value: unknown, area: string): CompactReviewResultInput {
	const input = exact(value, area, ["lens_results"], ["refuter_request_hash", "refuter_results"]);
	if (!Array.isArray(input.lens_results)) fail(`${area}.lens_results`, "type", "must be an array");
	const lens_results = input.lens_results.map((item, index) => {
		const row = exact(item, `${area}.lens_results[${index}]`, ["findings", "evidence"], ["lens"]);
		if (!Array.isArray(row.findings)) fail(`${area}.lens_results[${index}].findings`, "type", "must be an array");
		return {
			...(row.lens === undefined ? {} : { lens: enumValue(row.lens, REVIEW_LENS, `${area}.lens_results[${index}].lens`) }),
			findings: row.findings.map((finding, findingIndex) => parseFinding(finding, `${area}.lens_results[${index}].findings[${findingIndex}]`)),
			evidence: strings(row.evidence, `${area}.lens_results[${index}].evidence`),
		};
	});
	const refuter_request_hash = optionalString(input.refuter_request_hash, `${area}.refuter_request_hash`);
	if (refuter_request_hash !== undefined && !DIGEST.test(refuter_request_hash)) fail(`${area}.refuter_request_hash`, "digest", "is malformed");
	let refuter_results: CompactRefuterResultInput[] | undefined;
	if (input.refuter_results !== undefined) {
		if (!Array.isArray(input.refuter_results)) fail(`${area}.refuter_results`, "type", "must be an array");
		refuter_results = input.refuter_results.map((item, index) => {
			const row = exact(item, `${area}.refuter_results[${index}]`, ["finding_id", "outcome", "proof_refs"]);
			return { finding_id: string(row.finding_id, `${area}.refuter_results[${index}].finding_id`), outcome: enumValue(row.outcome, COMPACT_FINDING_OUTCOME, `${area}.refuter_results[${index}].outcome`), proof_refs: strings(row.proof_refs, `${area}.refuter_results[${index}].proof_refs`) };
		});
	}
	return { lens_results, ...(refuter_request_hash === undefined ? {} : { refuter_request_hash }), ...(refuter_results === undefined ? {} : { refuter_results }) };
}

function parseValidationProof(value: unknown, area: string): CompactValidationProofInput {
	const input = exact(value, area, ["original_criteria", "correction_regression"]);
	const check = (item: unknown, label: string) => {
		const row = exact(item, label, ["passed", "evidence"]);
		if (typeof row.passed !== "boolean") fail(`${label}.passed`, "type", "must be boolean");
		return { passed: row.passed, evidence: strings(row.evidence, `${label}.evidence`) };
	};
	return { original_criteria: check(input.original_criteria, `${area}.original_criteria`), correction_regression: check(input.correction_regression, `${area}.correction_regression`) };
}

function parseValidation(value: unknown, area: string): CompactTargetedValidationInput {
	const input = exact(value, area, ["request_hash", "correction_ids", "original_criteria", "correction_regression", "fix_caused_findings", "follow_ups"]);
	const check = (item: unknown, label: string) => {
		const row = exact(item, label, ["passed", "evidence"]);
		if (typeof row.passed !== "boolean") fail(`${label}.passed`, "type", "must be boolean");
		return { passed: row.passed, evidence: strings(row.evidence, `${label}.evidence`) };
	};
	if (!Array.isArray(input.fix_caused_findings) || input.fix_caused_findings.length !== 0) fail(`${area}.fix_caused_findings`, "scope", "must be an explicitly empty array");
	if (!Array.isArray(input.follow_ups)) fail(`${area}.follow_ups`, "type", "must be an array");
	const follow_ups = input.follow_ups.map((item, index) => {
		const row = exact(item, `${area}.follow_ups[${index}]`, ["finding_id", "location", "summary", "proof_refs"]);
		return { finding_id: string(row.finding_id, `${area}.follow_ups[${index}].finding_id`), location: string(row.location, `${area}.follow_ups[${index}].location`), summary: string(row.summary, `${area}.follow_ups[${index}].summary`), proof_refs: strings(row.proof_refs, `${area}.follow_ups[${index}].proof_refs`) };
	});
	const request_hash = string(input.request_hash, `${area}.request_hash`);
	if (!DIGEST.test(request_hash)) fail(`${area}.request_hash`, "digest", "is malformed");
	return { request_hash, correction_ids: strings(input.correction_ids, `${area}.correction_ids`), original_criteria: check(input.original_criteria, `${area}.original_criteria`), correction_regression: check(input.correction_regression, `${area}.correction_regression`), fix_caused_findings: [], follow_ups };
}

export function parseCompactStartInput(value: unknown): CompactStartContractInput {
	const input = exact(value, "review/start", ["cwd", "policyHash"], ["lineageId", "projection"]);
	const policyHash = string(input.policyHash, "review/start.policyHash");
	if (!DIGEST.test(policyHash)) fail("review/start.policyHash", "digest", "is malformed");
	let projection: { kind: "complete" } | undefined;
	if (input.projection !== undefined) {
		const raw = exact(input.projection, "review/start.projection", ["kind"]);
		if (raw.kind !== "complete") fail("review/start.projection.kind", "enum", "must be complete");
		projection = { kind: "complete" };
	}
	return { cwd: string(input.cwd, "review/start.cwd"), ...(optionalLineage(input.lineageId, "review/start.lineageId") === undefined ? {} : { lineageId: optionalLineage(input.lineageId, "review/start.lineageId")! }), policyHash, ...(projection === undefined ? {} : { projection }) };
}

function parseCompactFinalizeInputValue(value: unknown, preserveFinalEvidence: boolean): CompactFinalizeContractInput {
	const input = exact(value, "review/finalize", ["cwd"], ["lineageId", "review_result", "correction_line_forecast", "validation_proof", "validation", "final_evidence", "final_verification_passed", "refuter_batch"]);
	if ((input.final_evidence === undefined) !== (input.final_verification_passed === undefined)) fail("review/finalize", "field-pair", "final evidence and result must appear together");
	let correction_line_forecast: number | undefined;
	if (input.correction_line_forecast !== undefined) {
		if (!Number.isSafeInteger(input.correction_line_forecast) || input.correction_line_forecast <= 0) fail("review/finalize.correction_line_forecast", "range", "must be a positive safe integer");
		correction_line_forecast = input.correction_line_forecast;
	}
	if (input.final_verification_passed !== undefined && typeof input.final_verification_passed !== "boolean") fail("review/finalize.final_verification_passed", "type", "must be boolean");
	let final_evidence: string | undefined;
	if (input.final_evidence !== undefined) {
		if (preserveFinalEvidence) {
			if (typeof input.final_evidence !== "string" || input.final_evidence.length === 0) fail("review/finalize.final_evidence", "empty", "must contain at least one byte");
			final_evidence = input.final_evidence;
		} else {
			final_evidence = string(input.final_evidence, "review/finalize.final_evidence");
		}
	}
	return { cwd: string(input.cwd, "review/finalize.cwd"), ...(optionalLineage(input.lineageId, "review/finalize.lineageId") === undefined ? {} : { lineageId: optionalLineage(input.lineageId, "review/finalize.lineageId")! }), ...(input.review_result === undefined ? {} : { review_result: parseReviewResult(input.review_result, "review/finalize.review_result") }), ...(correction_line_forecast === undefined ? {} : { correction_line_forecast }), ...(input.validation_proof === undefined ? {} : { validation_proof: parseValidationProof(input.validation_proof, "review/finalize.validation_proof") }), ...(input.validation === undefined ? {} : { validation: parseValidation(input.validation, "review/finalize.validation") }), ...(final_evidence === undefined ? {} : { final_evidence }), ...(input.final_verification_passed === undefined ? {} : { final_verification_passed: input.final_verification_passed }), ...(input.refuter_batch === undefined ? {} : { refuter_batch: input.refuter_batch }) };
}

export function parseCompactFinalizeInput(value: unknown): CompactFinalizeContractInput {
	return parseCompactFinalizeInputValue(value, false);
}

export function parseNativeCompactFinalizeInput(value: unknown): CompactFinalizeContractInput & { refuter_batch?: RefuterBatch } {
	const input = parseCompactFinalizeInputValue(value, true);
	for (const lens of input.review_result?.lens_results ?? []) {
		if (lens.evidence.length === 0 || lens.findings.some((finding) => finding.proof_refs?.length === 0)) fail("review/finalize.review_result", "empty", "reviewer evidence and proof_refs must be non-empty");
		if (lens.findings.some((finding) => finding.evidence_class === COMPACT_EVIDENCE_CLASS.INFO)) fail("review/finalize.review_result", "enum", "reviewer evidence_class must match the published native schema");
	}
	for (const validation of [input.validation_proof, input.validation]) {
		if (validation && (validation.original_criteria.evidence.length === 0 || validation.correction_regression.evidence.length === 0)) fail("review/finalize.validation", "empty", "validator evidence must be non-empty");
	}
	if (input.validation?.follow_ups.some((row) => row.proof_refs.length === 0)) fail("review/finalize.validation.follow_ups", "empty", "follow-up proof_refs must be non-empty");
	let refuter_batch: RefuterBatch | undefined;
	if (input.refuter_batch !== undefined) {
		const reviewResult = input.review_result;
		if (reviewResult?.refuter_request_hash === undefined) fail("review/finalize.refuter_batch", "request-hash", "requires the expected review_result.refuter_request_hash");
		const candidateCausality = new Set<string>([CAUSAL_DISPOSITION.INTRODUCED, CAUSAL_DISPOSITION.BEHAVIOR_ACTIVATED, CAUSAL_DISPOSITION.WORSENED]);
		const findings: CompactFinding[] = [];
		for (const lens of reviewResult.lens_results) {
			for (const finding of lens.findings) {
				if ((finding.severity !== COMPACT_SEVERITY.BLOCKER && finding.severity !== COMPACT_SEVERITY.CRITICAL) || finding.evidence_class !== COMPACT_EVIDENCE_CLASS.INFERENTIAL || !candidateCausality.has(finding.causal_disposition ?? "")) continue;
				if (finding.id === undefined || (finding.lens ?? lens.lens) === undefined) fail("review/finalize.refuter_batch", "finding-id", "requires stable IDs and lenses for every refuted finding");
				findings.push({
					id: finding.id,
					lens: (finding.lens ?? lens.lens)!,
					location: finding.location!,
					severity: finding.severity,
					claim: finding.claim!,
					evidence_class: finding.evidence_class,
					causal_disposition: finding.causal_disposition!,
					proof_refs: [...finding.proof_refs!],
				});
			}
		}
		const normalized = normalizeRefuterBatch({ request_hash: reviewResult.refuter_request_hash, findings }, input.refuter_batch);
		if (normalized.status !== "normalized") fail("review/finalize.refuter_batch", normalized.reason_code, "must match the frozen request hash and IDs with complete concrete proof rows");
		refuter_batch = {
			schema: "gentle-ai.refuter-result-batch/v1",
			request_hash: normalized.refuter_request_hash,
			results: normalized.refuter_results,
		};
	}
	return { ...input, ...(refuter_batch === undefined ? {} : { refuter_batch }) };
}

const NATIVE_REVIEWER_LENS = {
	[REVIEW_LENS.RISK]: "risk",
	[REVIEW_LENS.RESILIENCE]: "resilience",
	[REVIEW_LENS.READABILITY]: "readability",
	[REVIEW_LENS.RELIABILITY]: "reliability",
} as const;

export function toNativeReviewerDocument(input: CompactLensResultInput) {
	const lens = input.lens === undefined ? undefined : NATIVE_REVIEWER_LENS[input.lens as keyof typeof NATIVE_REVIEWER_LENS];
	return {
		...(lens === undefined ? {} : { lens }),
		findings: input.findings.map((finding) => ({ ...finding, ...(finding.lens === undefined ? {} : { lens: NATIVE_REVIEWER_LENS[finding.lens as keyof typeof NATIVE_REVIEWER_LENS] }) })),
		evidence: [...input.evidence],
	};
}

export function toNativeValidatorDocument(input: CompactValidationProofInput | CompactTargetedValidationInput) {
	return {
		original_criteria: input.original_criteria,
		correction_regression: input.correction_regression,
		follow_ups: "follow_ups" in input ? input.follow_ups.map((row) => ({ observation: row.summary, proof_refs: [...row.proof_refs] })) : [],
	};
}
