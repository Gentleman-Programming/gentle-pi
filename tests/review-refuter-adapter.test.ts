import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRefuterBatch } from "../lib/review-refuter-adapter.ts";
import type { CompactRefuterRequest } from "../lib/review-compact.ts";

const request: CompactRefuterRequest = {
	request_hash: "a".repeat(64),
	findings: [
		{
			id: "READABILITY-001",
			lens: "review-readability",
			location: "lib/value.ts:1",
			severity: "CRITICAL",
			claim: "The value may be invalid.",
			evidence_class: "inferential",
			causal_disposition: "introduced",
			proof_refs: ["changed-hunk:lib/value.ts:1"],
		},
	],
};

test("refuter adapter normalizes only the exact complete frozen batch", () => {
	const normalized = normalizeRefuterBatch(request, {
		schema: "gentle-ai.refuter-result-batch/v1",
		request_hash: request.request_hash,
		results: [{
			finding_id: "READABILITY-001",
			outcome: "refuted",
			proof_refs: ["changed-hunk:lib/value.ts:1"],
		}],
	});

	assert.deepEqual(normalized, {
		status: "normalized",
		refuter_request_hash: request.request_hash,
		refuter_results: [{
			finding_id: "READABILITY-001",
			outcome: "refuted",
			proof_refs: ["changed-hunk:lib/value.ts:1"],
		}],
	});
});

test("refuter adapter preserves published inconclusive outcomes", () => {
	const normalized = normalizeRefuterBatch(request, {
		schema: "gentle-ai.refuter-result-batch/v1",
		request_hash: request.request_hash,
		results: [{ finding_id: "READABILITY-001", outcome: "inconclusive", proof_refs: ["changed-hunk:lib/value.ts:1"] }],
	});
	assert.equal(normalized.status, "normalized");
	assert.equal(normalized.status === "normalized" && normalized.refuter_results[0]?.outcome, "inconclusive");
});

test("refuter adapter accepts independent concrete refuter proof", () => {
	const normalized = normalizeRefuterBatch(request, {
		schema: "gentle-ai.refuter-result-batch/v1",
		request_hash: request.request_hash,
		results: [{
			finding_id: "READABILITY-001",
			outcome: "refuted",
			proof_refs: ["differential-test:independent reproduction passes"],
		}],
	});

	assert.equal(normalized.status, "normalized");
	assert.deepEqual(normalized.status === "normalized" && normalized.refuter_results[0]?.proof_refs, [
		"differential-test:independent reproduction passes",
	]);
});

test("refuter adapter rejects prose, aliases, invalid outcomes, and empty or malformed proof", () => {
	for (const batch of [
		`prose ${JSON.stringify({ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [] })}`,
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [{ id: "READABILITY-001", resolution: "refuted", proof_refs: ["changed-hunk:lib/value.ts:1"] }] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: [] }] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: [""] }] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [{ finding_id: "READABILITY-001", outcome: "refuted", proof_refs: [" untrimmed proof"] }] },
	]) assert.equal(normalizeRefuterBatch(request, batch).status, "invalid");
});

test("refuter adapter rejects wrong hashes and incomplete, duplicate, or extra frozen IDs", () => {
	const row = { finding_id: "READABILITY-001", outcome: "refuted", proof_refs: ["changed-hunk:lib/value.ts:1"] };
	for (const batch of [
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: "b".repeat(64), results: [row] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [row, row] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: request.request_hash, results: [{ ...row, finding_id: "READABILITY-002" }] },
	]) assert.equal(normalizeRefuterBatch(request, batch).status, "invalid");
});
