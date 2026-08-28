import type { NativeReviewCli } from "./native-review-cli.ts";
import type { ReviewLastEventClosureBinding, ReviewStatusV3 } from "./review-integration-v2.ts";

export interface ReviewLastEventCaptureSelector {
	readonly baseRef?: string;
	readonly committedOnly?: true;
}

/**
 * Reconcile exactly one ambiguous native capture outcome. Successful captures
 * return their native artifact or closure directly; this helper is never a
 * post-success lifecycle step and never replays a capture.
 */
export async function reconcileUnknownReviewLastEventCapture(
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selector?: ReviewLastEventCaptureSelector,
): Promise<ReviewStatusV3> {
	if (nativeReviewCli.targetStatus === undefined) {
		throw new TypeError("native target-scoped STATUS is required to reconcile an ambiguous capture outcome");
	}
	const status = await nativeReviewCli.targetStatus({
		cwd,
		lineageId: binding.lineageId,
		...(selector === undefined ? {} : selector),
	});
	if (binding.targetIdentity !== undefined && status.targetIdentity !== binding.targetIdentity) {
		throw new TypeError("capture reconciliation returned a different target");
	}
	if (status.authority?.lineageId !== undefined && status.authority.lineageId !== binding.lineageId) {
		throw new TypeError("capture reconciliation returned a different lineage");
	}
	return status;
}
