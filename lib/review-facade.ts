import { existsSync } from "node:fs";
import { domainHashV1 } from "./review-canonical.ts";
import {
	COMPACT_REVIEW_STATE,
	beginCompactCorrection,
	completeCompactCorrection,
	completeCompactReview,
	completeCompactVerification,
	createCompactRefuterRequest,
	createCompactReviewState,
	type CompactRefuterRequest,
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
	validation?: CompactTargetedValidationInput;
	final_evidence?: string;
	final_verification_passed?: boolean;
}

export interface CompactFacadeFinalizeResult {
	operation: "review/finalize";
	lineage_id: string;
	state: CompactReviewStateV2["state"];
	action: string;
	store_revision: string;
	receipt_path?: string;
	refuter_request?: CompactRefuterRequest;
}

export const GRAPH_V1_ORDINARY_READ_ONLY = "Graph-v1 ordinary review lineages are read-only; new ordinary work must use the compact-v2 facade";

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
		try {
			const record = store.load();
			if (graphV1LineageExists(cwd, record.state.lineage_id)) throw new Error("Review authority is ambiguous across graph-v1 and compact-v2");
			if (terminal && !existsSync(store.receiptPath)) return [];
			return [{ store, record }];
		} catch (error) {
			if (error instanceof Error && /ambiguous across graph-v1/.test(error.message)) throw error;
			return [];
		}
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
	return result;
}

export function finalizeCompactReview(
	input: CompactFacadeFinalizeInput,
): CompactFacadeFinalizeResult {
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
		if (request && input.review_result.refuter_results === undefined) {
			return { ...finalizeResult(store, record, "run one complete refuter batch, then replay identical lens input"), refuter_request: request };
		}
		state = completeCompactReview(state, input.review_result);
		const revision = store.replace(record.revision, COMPACT_STORE_OPERATION.COMPLETE_REVIEW, state);
		record = { schema: "gentle-ai.review-state-record/v2", revision, state };
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
	}
	if (state.state === COMPACT_REVIEW_STATE.CORRECTION_REQUIRED) {
		if (!input.validation) {
			return finalizeResult(store, record, "apply the bounded correction, then supply one targeted validation result");
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
