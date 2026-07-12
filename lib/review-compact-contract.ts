import {
	CAUSAL_DISPOSITION,
	COMPACT_EVIDENCE_CLASS,
	COMPACT_FINDING_OUTCOME,
	COMPACT_SEVERITY,
	type CompactRefuterResultInput,
	type CompactValidationProofInput,
	type CompactReviewResultInput,
	type CompactTargetedValidationInput,
} from "./review-compact.ts";
import { REVIEW_LENS } from "./review-triggers.ts";

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
	const row = exact(value, area, ["location", "severity", "claim", "evidence_class", "causal_disposition", "proof_refs"], ["id", "lens"]);
	return {
		...(row.id === undefined ? {} : { id: string(row.id, `${area}.id`) }),
		...(row.lens === undefined ? {} : { lens: enumValue(row.lens, REVIEW_LENS, `${area}.lens`) }),
		location: string(row.location, `${area}.location`),
		severity: enumValue(row.severity, COMPACT_SEVERITY, `${area}.severity`),
		claim: string(row.claim, `${area}.claim`),
		evidence_class: enumValue(row.evidence_class, COMPACT_EVIDENCE_CLASS, `${area}.evidence_class`),
		causal_disposition: enumValue(row.causal_disposition, CAUSAL_DISPOSITION, `${area}.causal_disposition`),
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

export function parseCompactFinalizeInput(value: unknown): CompactFinalizeContractInput {
	const input = exact(value, "review/finalize", ["cwd"], ["lineageId", "review_result", "correction_line_forecast", "validation_proof", "validation", "final_evidence", "final_verification_passed"]);
	if ((input.final_evidence === undefined) !== (input.final_verification_passed === undefined)) fail("review/finalize", "field-pair", "final evidence and result must appear together");
	let correction_line_forecast: number | undefined;
	if (input.correction_line_forecast !== undefined) {
		if (!Number.isSafeInteger(input.correction_line_forecast) || input.correction_line_forecast <= 0) fail("review/finalize.correction_line_forecast", "range", "must be a positive safe integer");
		correction_line_forecast = input.correction_line_forecast;
	}
	if (input.final_verification_passed !== undefined && typeof input.final_verification_passed !== "boolean") fail("review/finalize.final_verification_passed", "type", "must be boolean");
	return { cwd: string(input.cwd, "review/finalize.cwd"), ...(optionalLineage(input.lineageId, "review/finalize.lineageId") === undefined ? {} : { lineageId: optionalLineage(input.lineageId, "review/finalize.lineageId")! }), ...(input.review_result === undefined ? {} : { review_result: parseReviewResult(input.review_result, "review/finalize.review_result") }), ...(correction_line_forecast === undefined ? {} : { correction_line_forecast }), ...(input.validation_proof === undefined ? {} : { validation_proof: parseValidationProof(input.validation_proof, "review/finalize.validation_proof") }), ...(input.validation === undefined ? {} : { validation: parseValidation(input.validation, "review/finalize.validation") }), ...(input.final_evidence === undefined ? {} : { final_evidence: string(input.final_evidence, "review/finalize.final_evidence") }), ...(input.final_verification_passed === undefined ? {} : { final_verification_passed: input.final_verification_passed }) };
}
