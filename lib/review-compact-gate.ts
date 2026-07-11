import { canonicalJsonV1, domainHashV1 } from "./review-canonical.ts";
import {
	COMPACT_REVIEW_STATE,
	type CompactReceiptEnvelopeV2,
	type CompactReviewStateV2,
} from "./review-compact.ts";
import { discoverCompactReview } from "./review-facade.ts";
import {
	GATE_RESULT,
	TERMINAL_STATE,
	canonicalHash,
	evaluateGateTarget,
	type GateResultV1,
	type GateTargetV1,
	type ReceiptEnvelopeV1,
} from "./review-transaction.ts";
import { REVIEW_RISK_TIER } from "./review-risk.ts";
import { REVIEW_ROUTE } from "./review-triggers.ts";

export interface DerivedCompactGateTarget {
	target: GateTargetV1;
	actualIntendedCommitTree?: string;
}

export interface ValidateCompactGateOptions {
	cwd: string;
	lineageId?: string;
	deriveTarget: () => DerivedCompactGateTarget;
	beforeFinalRecheck?: () => void;
}

function equal(left: unknown, right: unknown): boolean {
	return canonicalJsonV1(left) === canonicalJsonV1(right);
}

function compatibilityReceipt(
	state: CompactReviewStateV2,
	receipt: CompactReceiptEnvelopeV2,
): ReceiptEnvelopeV1 {
	const route = state.risk_tier === REVIEW_RISK_TIER.LOW
		? REVIEW_ROUTE.TRIVIAL
		: state.risk_tier === REVIEW_RISK_TIER.HIGH
			? REVIEW_ROUTE.FULL_4R
			: REVIEW_ROUTE.STANDARD;
	const reviewActors = state.selected_lenses.length;
	const corrected = state.correction === undefined ? 0 : 1;
	const body = {
		schema: "gentle-ai.review-receipt-body/v1" as const,
		lineage_id: state.lineage_id,
		mode: state.mode,
		base_tree: state.initial_snapshot.base_tree,
		complete_snapshot_tree: state.initial_snapshot.complete_snapshot_tree,
		review_projection: state.initial_snapshot.review_projection,
		initial_review_tree: state.initial_snapshot.initial_review_tree,
		final_candidate_tree: state.current_candidate_tree,
		route,
		lenses: state.selected_lenses,
		policy_hash: state.policy_hash,
		frozen_ledger_hash: domainHashV1("compact-findings", state.findings),
		evidence_hash: receipt.body.evidence_hash,
		budget: {
			review_batches: 1,
			review_actors: reviewActors,
			refuter_batches: 1,
			fix_batches: 1,
			validator_runs: 1,
			final_verifications: 1,
			judgment_rounds: 0,
			judge_runs: 0,
		},
		counters: {
			review_batches: 1,
			review_actors: reviewActors,
			refuter_batches: state.findings.some((finding) => finding.evidence_class === "inferential") ? 1 : 0,
			fix_batches: corrected,
			validator_runs: corrected,
			final_verifications: 1,
			judgment_rounds: 0,
			judge_runs: 0,
		},
		terminal_state: TERMINAL_STATE.APPROVED,
	};
	return { body, receipt_hash: canonicalHash(body) };
}

function invalidResult(receiptHash: string, target: GateTargetV1, reason: string): GateResultV1 {
	return {
		status: GATE_RESULT.DENY,
		actor_count: 0,
		target_hash: canonicalHash(target),
		receipt_hash: receiptHash,
		reason,
	};
}

export function validateCompactReviewGate(
	options: ValidateCompactGateOptions,
): GateResultV1 {
	const firstDiscovery = discoverCompactReview(options.cwd, options.lineageId, true);
	const first = firstDiscovery.store.loadTerminalReceipt();
	if (first.record.state.state === COMPACT_REVIEW_STATE.ESCALATED) {
		return invalidResult(first.receipt.receipt_hash, options.deriveTarget().target, "Escalated compact authority cannot cross a lifecycle gate.");
	}
	if (first.record.state.state !== COMPACT_REVIEW_STATE.APPROVED) {
		return invalidResult(first.receipt.receipt_hash, options.deriveTarget().target, "Only approved compact authority can cross a lifecycle gate.");
	}
	const firstTarget = options.deriveTarget();
	const evaluated = evaluateGateTarget(
		compatibilityReceipt(first.record.state, first.receipt),
		firstTarget.target,
		options.cwd,
		firstTarget.actualIntendedCommitTree,
	);
	if (evaluated.status !== GATE_RESULT.ALLOW) return evaluated;
	options.beforeFinalRecheck?.();
	const finalDiscovery = discoverCompactReview(options.cwd, first.record.state.lineage_id, true);
	const final = finalDiscovery.store.loadTerminalReceipt();
	const finalTarget = options.deriveTarget();
	if (
		final.record.revision !== first.record.revision ||
		!equal(final.receipt, first.receipt) ||
		!equal(finalTarget, firstTarget)
	) {
		return invalidResult(first.receipt.receipt_hash, finalTarget.target, "Compact authority, target, publication refs, or evidence changed during final authorization.");
	}
	const rechecked = evaluateGateTarget(
		compatibilityReceipt(final.record.state, final.receipt),
		finalTarget.target,
		options.cwd,
		finalTarget.actualIntendedCommitTree,
	);
	return rechecked.status === GATE_RESULT.ALLOW
		? { ...rechecked, receipt_hash: final.receipt.receipt_hash }
		: rechecked;
}
