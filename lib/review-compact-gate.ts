import { canonicalJsonV1, domainHashV1 } from "./review-canonical.ts";
import {
	COMPACT_REVIEW_STATE,
	type CompactReceiptEnvelopeV2,
	type CompactReviewStateV2,
} from "./review-compact.ts";
import { hasEligibleGraphV1RecoveryAuthorityV1, resolveReviewAuthorityForChange, SupersessionStoreV1 } from "./review-authority-supersession.ts";
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
	/** Enables exact change-scoped recovery authority resolution; generic gates remain unchanged. */
	changeName?: string;
	deriveTarget: () => DerivedCompactGateTarget;
	beforeFinalRecheck?: () => void;
}

const GATE_AUTHORITY_PROVENANCE = {
	GENERIC: "generic",
	RECOVERED: "recovered",
} as const;

interface GenericGateAuthoritySelection {
	provenance: typeof GATE_AUTHORITY_PROVENANCE.GENERIC;
	store: ReturnType<typeof discoverCompactReview>["store"];
	record: ReturnType<typeof discoverCompactReview>["record"];
}

interface RecoveredGateAuthoritySelection {
	provenance: typeof GATE_AUTHORITY_PROVENANCE.RECOVERED;
	recoveryId: string;
	store: ReturnType<typeof discoverCompactReview>["store"];
	record: ReturnType<typeof discoverCompactReview>["record"];
}

type GateAuthoritySelection = GenericGateAuthoritySelection | RecoveredGateAuthoritySelection;

function discoverGateAuthority(options: ValidateCompactGateOptions, lineageId?: string): GateAuthoritySelection {
	if (options.changeName !== undefined) {
		const recovered = resolveReviewAuthorityForChange(options.cwd, options.changeName);
		if (recovered !== undefined) {
			return {
				provenance: GATE_AUTHORITY_PROVENANCE.RECOVERED,
				recoveryId: recovered.recovery.recovery_id,
				store: recovered.store,
				record: recovered.record,
			};
		}
	}
	return { provenance: GATE_AUTHORITY_PROVENANCE.GENERIC, ...discoverCompactReview(options.cwd, lineageId, true) };
}

function rediscoverGateAuthority(options: ValidateCompactGateOptions, first: GateAuthoritySelection): GateAuthoritySelection {
	if (first.provenance === GATE_AUTHORITY_PROVENANCE.GENERIC) {
		if (hasEligibleGraphV1RecoveryAuthorityV1(options.cwd) || SupersessionStoreV1.forRepository(options.cwd).hasRecoveryRequiredMarker()) {
			throw new Error("Recovery-required authority cannot be validated without a bound change.");
		}
		return { provenance: GATE_AUTHORITY_PROVENANCE.GENERIC, ...discoverCompactReview(options.cwd, first.record.state.lineage_id, true) };
	}
	if (options.changeName === undefined) throw new Error("Recovered gate authority lost its change binding.");
	const recovered = resolveReviewAuthorityForChange(options.cwd, options.changeName);
	if (recovered === undefined) throw new Error("Required recovered authority is missing.");
	return {
		provenance: GATE_AUTHORITY_PROVENANCE.RECOVERED,
		recoveryId: recovered.recovery.recovery_id,
		store: recovered.store,
		record: recovered.record,
	};
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
	try {
		if (options.changeName === undefined && hasEligibleGraphV1RecoveryAuthorityV1(options.cwd)) {
			return invalidResult("", options.deriveTarget().target, "Eligible graph-v1 recovery authority requires a bound change and valid supersession.");
		}
	} catch (error) {
		return invalidResult("", options.deriveTarget().target, `Recovery authority is unresolved: ${error instanceof Error ? error.message : String(error)}`);
	}
	let firstDiscovery: GateAuthoritySelection;
	let first: ReturnType<ReturnType<typeof discoverCompactReview>["store"]["loadTerminalReceipt"]>;
	try {
		firstDiscovery = discoverGateAuthority(options, options.lineageId);
		first = firstDiscovery.store.loadTerminalReceipt();
		if (options.changeName === undefined && SupersessionStoreV1.forRepository(options.cwd).hasRecoveryRequiredMarker()) {
			return invalidResult(first.receipt.receipt_hash, options.deriveTarget().target, "Recovery-required marker cannot be validated without a bound change.");
		}
	} catch (error) {
		return invalidResult("", options.deriveTarget().target, `Recovery authority is unresolved: ${error instanceof Error ? error.message : String(error)}`);
	}
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
	const finalTarget = options.deriveTarget();
	let final: ReturnType<typeof firstDiscovery.store.loadTerminalReceipt>;
	try {
		const finalDiscovery = rediscoverGateAuthority(options, firstDiscovery);
		if (
			finalDiscovery.provenance !== firstDiscovery.provenance ||
			(firstDiscovery.provenance === GATE_AUTHORITY_PROVENANCE.RECOVERED &&
				(finalDiscovery.provenance !== GATE_AUTHORITY_PROVENANCE.RECOVERED || finalDiscovery.recoveryId !== firstDiscovery.recoveryId))
		) {
			return invalidResult(first.receipt.receipt_hash, finalTarget.target, "Recovered authority changed during final authorization.");
		}
		final = finalDiscovery.store.loadTerminalReceipt();
	} catch (error) {
		return invalidResult(first.receipt.receipt_hash, finalTarget.target, `Compact authority changed or became invalid during final authorization: ${error instanceof Error ? error.message : String(error)}`);
	}
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
