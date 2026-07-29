// Evidence-first correction lifecycle, protocol v1.5.
//
// An ordinary review permits exactly one bounded correction transaction. Since
// v1.5 the provider collects candidate-bound verification evidence BEFORE it
// offers `targeted_validation`, and the outcome it records decides which of
// three terminal branches follows. Those branches differ in what they consume:
// only `procedural_tooling_failed` ends the lifecycle, only `passed` unlocks
// validation, and `verification_failed` must cost nothing at all.
//
// This module is deliberately pure — no subprocess, no filesystem, no clock.
// The provider owns the evidence directory and the budget ledger; what Pi owns
// is the decision, and a decision made from data can be tested without a live
// binary. The rejected alternative was inlining these branches beside the
// existing validation conditionals, where the single-correction invariant would
// have been enforced by control flow instead of by data.

export const CORRECTION_OUTCOMES = Object.freeze(["passed", "verification_failed", "procedural_tooling_failed"] as const);
export type CorrectionOutcome = (typeof CORRECTION_OUTCOMES)[number];

export class CorrectionOutcomeError extends Error {
	constructor(received: unknown) {
		super(`review correction evidence outcome must be exactly one of ${CORRECTION_OUTCOMES.join(", ")}; received ${JSON.stringify(received)}`);
		this.name = "CorrectionOutcomeError";
	}
}

export class CorrectionEvidenceReplacedError extends Error {
	constructor(detail: string) {
		super(`correction-evidence-replaced: ${detail}`);
		this.name = "CorrectionEvidenceReplacedError";
	}
}

export interface CorrectionStatus {
	readonly lineageId: string;
	readonly targetIdentity: string;
	readonly authorityRevision: string;
	readonly correctionBudget: number;
	readonly changedLinesCharged: number;
}

export interface CorrectionEvidence {
	readonly outcome: string;
	readonly evidenceIdentity: string;
	readonly recordDigest: string;
	readonly candidateTree?: string;
	readonly rawPayloadSha256?: string;
}

interface CorrectionStepBase {
	readonly kind: string;
	readonly lineageId: string;
	readonly transactionOpen: boolean;
	readonly unlocksTargetedValidation: boolean;
}

export interface RunTargetedValidationStep extends CorrectionStepBase {
	readonly kind: "run-targeted-validation";
	readonly transactionOpen: false;
	readonly unlocksTargetedValidation: true;
	// The provider issues the request. Pi re-queries STATUS for it instead of
	// fabricating one, so the step names the operation it expects to collect.
	readonly expectCaptureOperation: "external.run_targeted_validation";
	readonly evidenceIdentity: string;
}

export interface RecaptureRequiredStep extends CorrectionStepBase {
	readonly kind: "recapture-required";
	readonly transactionOpen: true;
	readonly unlocksTargetedValidation: false;
	readonly attemptConsumed: false;
	readonly budgetConsumed: 0;
	readonly changedLinesCharged: number;
	readonly autoRetry: false;
	// Carries the identity this capture supersedes. A new capture is mandatory:
	// there is deliberately no field that would let a caller resubmit the same
	// candidate bytes under the prior identity.
	readonly supersedes: string;
	readonly requiresNewCapture: true;
	readonly guidance: string;
}

export interface TerminalEscalationStep extends CorrectionStepBase {
	readonly kind: "terminal-escalation";
	readonly transactionOpen: false;
	readonly unlocksTargetedValidation: false;
	readonly retryEligible: false;
	readonly launchesReviewer: false;
	readonly launchesValidator: false;
	readonly launchesCorrection: false;
	readonly escalation: string;
	readonly evidenceIdentity: string;
}

export type CorrectionStep = RunTargetedValidationStep | RecaptureRequiredStep | TerminalEscalationStep;

function requireOutcome(value: unknown): CorrectionOutcome {
	if (typeof value !== "string" || !(CORRECTION_OUTCOMES as readonly string[]).includes(value)) throw new CorrectionOutcomeError(value);
	return value as CorrectionOutcome;
}

export function resolveCorrectionStep(status: CorrectionStatus, evidence: CorrectionEvidence): CorrectionStep {
	const outcome = requireOutcome(evidence?.outcome);

	if (outcome === "passed") {
		return Object.freeze({
			kind: "run-targeted-validation",
			lineageId: status.lineageId,
			transactionOpen: false,
			unlocksTargetedValidation: true,
			expectCaptureOperation: "external.run_targeted_validation",
			evidenceIdentity: evidence.evidenceIdentity,
		} as const);
	}

	if (outcome === "verification_failed") {
		return Object.freeze({
			kind: "recapture-required",
			lineageId: status.lineageId,
			transactionOpen: true,
			unlocksTargetedValidation: false,
			attemptConsumed: false,
			budgetConsumed: 0,
			// Reported, never recomputed: a failed verification must not move the
			// accounting the provider already holds in either direction.
			changedLinesCharged: status.changedLinesCharged,
			autoRetry: false,
			supersedes: evidence.evidenceIdentity,
			requiresNewCapture: true,
			guidance: "Verification failed. Change the candidate and capture new evidence; the correction transaction stays open and nothing has been charged. Do not retry the same bytes.",
		} as const);
	}

	return Object.freeze({
		kind: "terminal-escalation",
		lineageId: status.lineageId,
		transactionOpen: false,
		unlocksTargetedValidation: false,
		retryEligible: false,
		launchesReviewer: false,
		launchesValidator: false,
		launchesCorrection: false,
		escalation: "Procedural tooling failed while capturing verification evidence. This is a terminal escalation: no reviewer, correction, or validator runs afterwards, and retry eligibility is not considered. It needs one human decision.",
		evidenceIdentity: evidence.evidenceIdentity,
	} as const);
}

export interface DistinctEvidenceCheck {
	readonly prior: CorrectionEvidence;
	readonly next: CorrectionEvidence;
	// Whether the earlier record is still resolvable, and what its bytes hash to
	// NOW. Both are observations the caller supplies; this function judges them
	// rather than performing IO, which keeps the invariant unit-testable.
	readonly priorStillResolvable: boolean;
	readonly priorRecordDigestNow: string;
}

export function assertDistinctCorrectionEvidence(check: DistinctEvidenceCheck): void {
	const { prior, next, priorStillResolvable, priorRecordDigestNow } = check;

	if (next.evidenceIdentity === prior.evidenceIdentity) {
		throw new CorrectionEvidenceReplacedError(`the provider reused evidence identity ${prior.evidenceIdentity} for a second capture; each capture must land in its own immutable directory`);
	}
	if (!priorStillResolvable) {
		throw new CorrectionEvidenceReplacedError(`the earlier evidence record ${prior.evidenceIdentity} is no longer resolvable; a failed capture must survive alongside its successor, not be replaced`);
	}
	if (priorRecordDigestNow !== prior.recordDigest) {
		throw new CorrectionEvidenceReplacedError(`the earlier evidence record ${prior.evidenceIdentity} now digests to ${priorRecordDigestNow} instead of ${prior.recordDigest}; its bytes must be immutable`);
	}
}
