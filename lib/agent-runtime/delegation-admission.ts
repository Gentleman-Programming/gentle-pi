import type { CandidateViewRegistry } from "../review-candidate-view.ts";

const SUBAGENT_RUN_TOOL = "subagent_run";

export type DelegationAdmissionResult =
	| { kind: "allow"; input: unknown }
	| { kind: "block"; reason: string }
	| { kind: "not-applicable" };

export interface DelegationAdmissionCollaborators {
	candidateViews: CandidateViewRegistry | null;
	injectReviewCandidateView: (
		input: unknown,
		candidateViews: CandidateViewRegistry | null,
	) => void;
}

export interface DelegationAdmissionRequest
	extends DelegationAdmissionCollaborators {
	toolName: string;
	input: unknown;
}

/**
 * Admits the existing Pi subagent dispatch shape without executing it.
 * Candidate-view safety remains owned by the supplied existing collaborator.
 */
export function admitDelegation(
	request: DelegationAdmissionRequest,
): DelegationAdmissionResult {
	if (request.toolName !== SUBAGENT_RUN_TOOL) {
		return { kind: "not-applicable" };
	}
	try {
		request.injectReviewCandidateView(request.input, request.candidateViews);
		return { kind: "allow", input: request.input };
	} catch (error) {
		return {
			kind: "block",
			reason:
				error instanceof Error
					? error.message
					: "review subagent dispatch is invalid",
		};
	}
}
