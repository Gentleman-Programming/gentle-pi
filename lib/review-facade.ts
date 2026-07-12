import { existsSync } from "node:fs";
import {
	parseCompactFinalizeInput,
	parseCompactStartInput,
} from "./review-compact-contract.ts";
import { domainHashV1 } from "./review-canonical.ts";
import { normalizeRefuterBatch } from "./review-refuter-adapter.ts";
import {
	COMPACT_REVIEW_STATE,
	beginCompactCorrection,
	completeCompactCorrection,
	completeCompactReview,
	completeCompactVerification,
	createCompactRefuterRequest,
	createCompactValidatorRequest,
	createCompactReviewState,
	freezeCompactValidatorRequest,
	type CompactRefuterRequest,
	type CompactValidationProofInput,
	type CompactValidatorRequest,
	type CompactReviewResultInput,
	type CompactReviewStateV2,
	type CompactTargetedValidationInput,
} from "./review-compact.ts";
import {
	COMPACT_STORE_OPERATION,
	CompactReviewStoreError,
	CompactReviewStoreV2,
	compactV2LineageExists,
	discoverCompactReviewStores,
	graphV1LineageExists,
	type CompactStateRecordV2,
} from "./review-compact-store.ts";
import { assertNoLegacyReviewAuthorityV1 } from "./review-legacy-detector.ts";
import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	captureCurrentReviewCandidateTree,
	captureOrdinaryCorrectionSnapshot,
	captureReviewSnapshot,
	discoverReviewUntrackedPaths,
	type ReviewProjectionV1,
} from "./review-snapshot.ts";

export interface CompactFacadeStartInput {
	cwd: string;
	lineageId?: string;
	policyHash: string;
	projection?: ReviewProjectionV1;
}

export interface CompactFacadeStartResult {
	operation: "review/start";
	lineage_id: string;
	state: CompactReviewStateV2["state"];
	risk_tier: CompactReviewStateV2["risk_tier"];
	selected_lenses: CompactReviewStateV2["selected_lenses"];
	changed_files: number;
	original_changed_lines: number;
	correction_budget: number;
	store_revision: string;
}

export interface CompactFacadeFinalizeInput {
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

export interface CompactFacadeFinalizeResult {
	operation: "review/finalize";
	lineage_id: string;
	state: CompactReviewStateV2["state"];
	action: string;
	store_revision: string;
	receipt_path?: string;
	refuter_request?: CompactRefuterRequest;
	validator_request?: CompactValidatorRequest;
	repair_report?: CompactRepairReport;
}

export const COMPACT_REPAIR_PHASE = {
	CORRECTION_REQUIRED: "correction-required",
	SCOPED_VALIDATION: "scoped-validation",
	APPROVED: "approved",
	ESCALATED: "escalated",
} as const;

export interface CompactRepairReport {
	phase: (typeof COMPACT_REPAIR_PHASE)[keyof typeof COMPACT_REPAIR_PHASE];
	correction_ids: string[];
	allowed_paths: string[];
	changed_paths?: string[];
	correction_budget: number;
	forecast_lines?: number;
	actual_lines?: number;
}

export const GRAPH_V1_ORDINARY_READ_ONLY = "Graph-v1 ordinary review lineages are read-only; new ordinary work must use the compact-v2 facade";

export const COMPACT_START_BLOCK_ACTION = {
	APPROVED: "validate-existing-terminal-receipt",
	ESCALATED: "change-review-scope-or-use-supported-maintainer-action",
} as const;

export class CompactReviewStartBlockedError extends Error {
	readonly lineageId: string;
	readonly state: CompactReviewStateV2["state"];
	readonly action: (typeof COMPACT_START_BLOCK_ACTION)[keyof typeof COMPACT_START_BLOCK_ACTION];

	constructor(
		lineageId: string,
		state: CompactReviewStateV2["state"],
		action: (typeof COMPACT_START_BLOCK_ACTION)[keyof typeof COMPACT_START_BLOCK_ACTION],
	) {
		super(`Compact ${state} authority already exists for this review target; ${action}`);
		this.name = "CompactReviewStartBlockedError";
		this.lineageId = lineageId;
		this.state = state;
		this.action = action;
	}
}

function derivedLineageId(snapshot: ReturnType<typeof captureReviewSnapshot>): string {
	return `review-${domainHashV1("compact-lineage", {
		base_tree: snapshot.base_tree,
		initial_review_tree: snapshot.initial_review_tree,
		genesis_paths: snapshot.genesis_paths ?? [],
		intended_untracked: snapshot.intended_untracked,
	}).slice(0, 16)}`;
}

export function startCompactReview(
	input: CompactFacadeStartInput,
): CompactFacadeStartResult {
	input = parseCompactStartInput(input);
	assertNoLegacyReviewAuthorityV1(input.cwd);
	const projection = input.projection ?? { kind: REVIEW_PROJECTION.COMPLETE };
	if (projection.kind !== REVIEW_PROJECTION.COMPLETE) {
		throw new Error("New compact ordinary reviews require the complete live Git projection");
	}
	const snapshot = captureReviewSnapshot({
		cwd: input.cwd,
		mode: REVIEW_MODE.ORDINARY,
		projection,
		policyHash: input.policyHash,
	});
	const lineageId = input.lineageId?.trim() || derivedLineageId(snapshot);
	if (graphV1LineageExists(input.cwd, lineageId)) {
		throw new Error("Graph-v1 and compact-v2 authority are ambiguous for this lineage; choose a fresh compact lineage");
	}
	if (compactV2LineageExists(input.cwd, lineageId)) {
		const existing = CompactReviewStoreV2.forRepository(input.cwd, lineageId).load().state;
		if (existing.state === COMPACT_REVIEW_STATE.APPROVED) {
			if (existing.policy_hash !== input.policyHash) {
				throw new Error("Compact approved authority policy hash does not match requested policy hash.");
			}
			throw new CompactReviewStartBlockedError(lineageId, existing.state, COMPACT_START_BLOCK_ACTION.APPROVED);
		}
		if (existing.state === COMPACT_REVIEW_STATE.ESCALATED) {
			throw new CompactReviewStartBlockedError(lineageId, existing.state, COMPACT_START_BLOCK_ACTION.ESCALATED);
		}
	}
	const terminal = discoverCompactReviewStores(input.cwd)
		.map((store) => store.load().state)
		.find((existing) => (
			existing.state === COMPACT_REVIEW_STATE.APPROVED ||
			existing.state === COMPACT_REVIEW_STATE.ESCALATED
		) &&
			existing.initial_snapshot.base_tree === snapshot.base_tree &&
			existing.initial_snapshot.initial_review_tree === snapshot.initial_review_tree &&
			domainHashV1("compact-target-paths", existing.genesis_paths) === domainHashV1("compact-target-paths", snapshot.genesis_paths ?? []) &&
			domainHashV1("compact-target-untracked", existing.intended_untracked) === domainHashV1("compact-target-untracked", snapshot.intended_untracked)
		);
	if (terminal) {
		throw new CompactReviewStartBlockedError(
			terminal.lineage_id,
			terminal.state,
			terminal.state === COMPACT_REVIEW_STATE.APPROVED
				? COMPACT_START_BLOCK_ACTION.APPROVED
				: COMPACT_START_BLOCK_ACTION.ESCALATED,
		);
	}
	const state = createCompactReviewState({ lineageId, snapshot, policyHash: input.policyHash });
	const store = CompactReviewStoreV2.forRepository(input.cwd, lineageId);
	const revision = store.replace("", COMPACT_STORE_OPERATION.START, state);
	return {
		operation: "review/start",
		lineage_id: lineageId,
		state: state.state,
		risk_tier: state.risk_tier,
		selected_lenses: state.selected_lenses,
		changed_files: state.genesis_paths.length,
		original_changed_lines: state.original_changed_lines,
		correction_budget: state.correction_budget,
		store_revision: revision,
	};
}

export function discoverCompactReview(
	cwd: string,
	lineageId?: string,
	terminal = false,
): { store: CompactReviewStoreV2; record: CompactStateRecordV2 } {
	if (lineageId?.trim()) {
		const compactExists = compactV2LineageExists(cwd, lineageId);
		const graphExists = graphV1LineageExists(cwd, lineageId);
		if (compactExists && graphExists) throw new Error("Review authority is ambiguous across graph-v1 and compact-v2");
		if (!compactExists && graphExists) throw new Error(GRAPH_V1_ORDINARY_READ_ONLY);
		if (!compactExists) throw new Error("Compact review lineage was not found");
		const store = CompactReviewStoreV2.forRepository(cwd, lineageId);
		const record = store.load();
		if (terminal && !existsSync(store.receiptPath)) throw new Error("Compact terminal receipt is unavailable");
		return { store, record };
	}
	let candidates = discoverCompactReviewStores(cwd).flatMap((store) => {
		const record = store.load();
		if (graphV1LineageExists(cwd, record.state.lineage_id)) throw new Error("Review authority is ambiguous across graph-v1 and compact-v2");
		if (terminal && !existsSync(store.receiptPath)) return [];
		return [{ store, record }];
	});
	if (!terminal) {
		const active = candidates.filter(({ record }) =>
			record.state.state !== COMPACT_REVIEW_STATE.APPROVED &&
			record.state.state !== COMPACT_REVIEW_STATE.ESCALATED
		);
		if (active.length > 0) candidates = active;
	}
	if (candidates.length !== 1) {
		throw new Error(candidates.length === 0
			? "No discoverable compact review lineage was found"
			: "Multiple compact review lineages were found; specify lineageId");
	}
	return candidates[0]!;
}

function finalizeResult(
	store: CompactReviewStoreV2,
	record: CompactStateRecordV2,
	action: string,
): CompactFacadeFinalizeResult {
	const result: CompactFacadeFinalizeResult = {
		operation: "review/finalize",
		lineage_id: record.state.lineage_id,
		state: record.state.state,
		action,
		store_revision: record.revision,
	};
	if (
		record.state.state === COMPACT_REVIEW_STATE.APPROVED ||
		record.state.state === COMPACT_REVIEW_STATE.ESCALATED
	) result.receipt_path = store.receiptPath;
	if (record.state.correction_ids.length > 0) {
		const phase = record.state.state === COMPACT_REVIEW_STATE.CORRECTION_REQUIRED
			? COMPACT_REPAIR_PHASE.CORRECTION_REQUIRED
			: record.state.state === COMPACT_REVIEW_STATE.VALIDATING
				? COMPACT_REPAIR_PHASE.SCOPED_VALIDATION
				: record.state.state === COMPACT_REVIEW_STATE.APPROVED
					? COMPACT_REPAIR_PHASE.APPROVED
					: COMPACT_REPAIR_PHASE.ESCALATED;
		result.repair_report = {
			phase,
			correction_ids: [...record.state.correction_ids],
			allowed_paths: [...record.state.genesis_paths],
			...(record.state.correction === undefined ? {} : { changed_paths: [...record.state.correction.changed_paths], actual_lines: record.state.correction.changed_lines }),
			correction_budget: record.state.correction_budget,
			...(record.state.correction_line_forecast === undefined ? {} : { forecast_lines: record.state.correction_line_forecast }),
		};
	}
	return result;
}

export function finalizeCompactReview(
	input: CompactFacadeFinalizeInput,
): CompactFacadeFinalizeResult {
	input = parseCompactFinalizeInput(input);
	const discovered = discoverCompactReview(input.cwd, input.lineageId);
	let { store, record } = discovered;
	let state = record.state;
	if (
		state.state === COMPACT_REVIEW_STATE.APPROVED ||
		state.state === COMPACT_REVIEW_STATE.ESCALATED
	) {
		store.materializeTerminalReceipt();
		return finalizeResult(store, store.load(), "validate the terminal receipt against an exact lifecycle gate");
	}
	if (state.state === COMPACT_REVIEW_STATE.REVIEWING) {
		if (!input.review_result) return finalizeResult(store, record, "supply all selected lens results");
		const request = createCompactRefuterRequest(state, input.review_result.lens_results);
		if (request && input.refuter_batch === undefined) {
			if (input.review_result.refuter_results !== undefined && input.review_result.refuter_request_hash !== request.request_hash) {
				throw new Error("Compact refuter request hash is missing or does not match the identical canonical lens input");
			}
			return { ...finalizeResult(store, record, "run one complete refuter batch, then replay identical lens input"), refuter_request: request };
		}
		if (request) {
			const normalized = normalizeRefuterBatch(request, input.refuter_batch);
			if (normalized.status === "normalized") {
				input.review_result = {
					...input.review_result,
					refuter_request_hash: normalized.refuter_request_hash,
					refuter_results: normalized.refuter_results,
				};
			} else {
				state = completeCompactReview(state, {
					...input.review_result,
					refuter_request_hash: request.request_hash,
					refuter_results: [],
				});
				state.escalation_reasons.push(`Refuter batch rejected: ${normalized.reason_code}.`);
				const revision = store.replace(record.revision, COMPACT_STORE_OPERATION.COMPLETE_REVIEW, state);
				record = { schema: "gentle-ai.review-state-record/v2", revision, state };
			}
		}
		if (state.state === COMPACT_REVIEW_STATE.REVIEWING) {
			state = completeCompactReview(state, input.review_result);
			const revision = store.replace(record.revision, COMPACT_STORE_OPERATION.COMPLETE_REVIEW, state);
			record = { schema: "gentle-ai.review-state-record/v2", revision, state };
		}
	}
	if (
		state.state === COMPACT_REVIEW_STATE.CORRECTION_REQUIRED &&
		state.correction_line_forecast === undefined
	) {
		if (input.correction_line_forecast === undefined) {
			return finalizeResult(store, record, "rerun finalize with a positive correction_line_forecast before editing");
		}
		state = beginCompactCorrection(state, input.correction_line_forecast);
		const revision = store.replace(record.revision, COMPACT_STORE_OPERATION.BEGIN_CORRECTION, state);
		record = { schema: "gentle-ai.review-state-record/v2", revision, state };
		return finalizeResult(store, record, "apply the bounded correction, then rerun finalize to derive the validator request");
	}
	if (state.state === COMPACT_REVIEW_STATE.CORRECTION_REQUIRED) {
		if (state.validator_request === undefined) {
			const candidateTree = captureCurrentReviewCandidateTree(state.initial_snapshot);
			const correction = captureOrdinaryCorrectionSnapshot(state.initial_snapshot, candidateTree);
			const request = createCompactValidatorRequest(state, correction);
			state = freezeCompactValidatorRequest(state, request);
			const revision = store.replace(record.revision, COMPACT_STORE_OPERATION.FREEZE_VALIDATOR_REQUEST, state);
			record = { schema: "gentle-ai.review-state-record/v2", revision, state };
			return { ...finalizeResult(store, record, "run the one targeted validator against the frozen native request"), validator_request: request };
		}
		if (!input.validation) {
			return { ...finalizeResult(store, record, "run the one targeted validator against the frozen native request"), validator_request: state.validator_request };
		}
		const candidateTree = captureCurrentReviewCandidateTree(state.initial_snapshot);
		const correction = captureOrdinaryCorrectionSnapshot(state.initial_snapshot, candidateTree);
		state = completeCompactCorrection(
			state,
			correction,
			discoverReviewUntrackedPaths(input.cwd),
			input.validation,
		);
		const revision = store.replace(record.revision, COMPACT_STORE_OPERATION.COMPLETE_CORRECTION, state);
		record = { schema: "gentle-ai.review-state-record/v2", revision, state };
	}
	if (state.state === COMPACT_REVIEW_STATE.VALIDATING) {
		if (input.final_evidence === undefined || input.final_evidence.length === 0) {
			return finalizeResult(store, record, "rerun finalize with final_evidence from independent verification");
		}
		state = completeCompactVerification(
			state,
			input.final_evidence,
			input.final_verification_passed === true,
		);
		const revision = store.replace(record.revision, COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION, state);
		record = { schema: "gentle-ai.review-state-record/v2", revision, state };
	}
	if (
		state.state === COMPACT_REVIEW_STATE.APPROVED ||
		state.state === COMPACT_REVIEW_STATE.ESCALATED
	) {
		store.materializeTerminalReceipt();
		return finalizeResult(store, store.load(), "validate the terminal receipt against an exact lifecycle gate");
	}
	throw new CompactReviewStoreError(`Compact finalize stopped in unsupported state ${state.state}`);
}
