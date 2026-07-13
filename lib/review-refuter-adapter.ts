import {
	COMPACT_FINDING_OUTCOME,
	type CompactRefuterRequest,
	type CompactRefuterResult,
} from "./review-compact.ts";

const REFUTER_BATCH_SCHEMA = "gentle-ai.refuter-result-batch/v1";
const DIGEST = /^[0-9a-f]{64}$/;

export const REFUTER_BATCH_STATUS = {
	NORMALIZED: "normalized",
	INVALID: "invalid",
} as const;

export interface RefuterBatchRow {
	finding_id: string;
	outcome: CompactRefuterResult["outcome"];
	proof_refs: string[];
}

export interface RefuterBatch {
	schema: typeof REFUTER_BATCH_SCHEMA;
	request_hash: string;
	results: RefuterBatchRow[];
}

export interface NativeRefuterDocument {
	results: RefuterBatchRow[];
}

interface NormalizedRefuterBatch {
	status: typeof REFUTER_BATCH_STATUS.NORMALIZED;
	refuter_request_hash: string;
	refuter_results: CompactRefuterResult[];
}

interface InvalidRefuterBatch {
	status: typeof REFUTER_BATCH_STATUS.INVALID;
	reason_code: string;
}

export type RefuterBatchNormalization = NormalizedRefuterBatch | InvalidRefuterBatch;

function invalid(reason_code: string): InvalidRefuterBatch {
	return { status: REFUTER_BATCH_STATUS.INVALID, reason_code };
}

function record(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
	return value as Record<string, unknown>;
}

function exact(object: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(object).length === keys.length && keys.every((key) => key in object);
}

function parseBatch(value: unknown): RefuterBatch | InvalidRefuterBatch {
	let raw = value;
	if (typeof raw === "string") {
		if (raw.length === 0 || raw.trim() !== raw) return invalid("refuter-batch-prose");
		try {
			raw = JSON.parse(raw) as unknown;
		} catch {
			return invalid("refuter-batch-json");
		}
	}
	const batch = record(raw);
	if (!batch || !exact(batch, ["schema", "request_hash", "results"])) return invalid("refuter-batch-shape");
	if (batch.schema !== REFUTER_BATCH_SCHEMA || typeof batch.request_hash !== "string" || !DIGEST.test(batch.request_hash) || !Array.isArray(batch.results)) {
		return invalid("refuter-batch-shape");
	}
	const results: RefuterBatchRow[] = [];
	for (const result of batch.results) {
		const row = record(result);
		if (!row || !exact(row, ["finding_id", "outcome", "proof_refs"])) return invalid("refuter-row-shape");
		if (
			typeof row.finding_id !== "string" || row.finding_id.length === 0 || row.finding_id.trim() !== row.finding_id ||
			(row.outcome !== COMPACT_FINDING_OUTCOME.REFUTED && row.outcome !== COMPACT_FINDING_OUTCOME.CORROBORATED && row.outcome !== COMPACT_FINDING_OUTCOME.INCONCLUSIVE) ||
			!Array.isArray(row.proof_refs) ||
			row.proof_refs.length === 0 ||
			row.proof_refs.some((proof) => typeof proof !== "string" || proof.length === 0 || proof.trim() !== proof)
		) return invalid("refuter-row-value");
		results.push({ finding_id: row.finding_id, outcome: row.outcome, proof_refs: [...row.proof_refs] });
	}
	return { schema: REFUTER_BATCH_SCHEMA, request_hash: batch.request_hash, results };
}

export function parseRefuterBatch(value: unknown): RefuterBatch {
	const batch = parseBatch(value);
	if ("status" in batch) throw new TypeError(batch.reason_code);
	return batch;
}

export function toNativeRefuterDocument(batch: RefuterBatch): NativeRefuterDocument {
	return { results: batch.results.map((row) => ({ ...row, proof_refs: [...row.proof_refs] })) };
}

export function normalizeRefuterBatch(
	request: CompactRefuterRequest,
	value: unknown,
): RefuterBatchNormalization {
	const batch = parseBatch(value);
	if ("status" in batch) return batch;
	if (batch.request_hash !== request.request_hash) return invalid("refuter-request-hash");
	const frozen = new Map(request.findings.map((finding) => [finding.id, finding]));
	const rows = new Map<string, RefuterBatchRow>();
	for (const row of batch.results) {
		const finding = frozen.get(row.finding_id);
		if (!finding) return invalid("refuter-finding-id");
		if (rows.has(row.finding_id)) return invalid("refuter-duplicate-id");
		if (row.proof_refs.length === 0 || new Set(row.proof_refs).size !== row.proof_refs.length) return invalid("refuter-proof-refs");
		rows.set(row.finding_id, row);
	}
	if (rows.size !== request.findings.length) return invalid("refuter-missing-id");
	const refuter_results = request.findings.map((finding) => {
		const row = rows.get(finding.id);
		if (!row) throw new Error("Complete refuter batch lost a frozen finding");
		return {
			finding_id: row.finding_id,
			outcome: row.outcome,
			proof_refs: [...row.proof_refs].toSorted(),
		};
	});
	return {
		status: REFUTER_BATCH_STATUS.NORMALIZED,
		refuter_request_hash: request.request_hash,
		refuter_results,
	};
}
