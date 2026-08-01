// Pure exact-slot capture derivation (Wave 1, #2028 host behavior, Design
// Decision 1). This is the single validator for the provider-issued
// `review.capture-result` binding fields: lineage, target, authority
// revision, repository context (base/candidate tree), changed-path manifest
// hash, lens, order, and subject hash. `providerReviewerProjection`
// (extensions/gentle-ai.ts) and the FINALIZE capture phase both consume this
// module instead of re-validating the binding themselves, so exactly one
// validator exists.
import { isCanonicalProcessString } from "./native-review-cli.ts";
import { CandidateViewError } from "./review-candidate-view.ts";
import type { ReviewArtifactSubjectV2, ReviewCollectInputV3, ReviewStatusV3 } from "./review-integration-v2.ts";

export const CAPTURE_SLOT_ARGUMENT = {
	LINEAGE: "lineage",
	EXPECTED_REVISION: "expected-revision",
	TARGET: "target",
	LENS: "lens",
	ORDER: "order",
	SUBJECT_HASH: "subject-hash",
} as const;
export type CaptureSlotArgument = (typeof CAPTURE_SLOT_ARGUMENT)[keyof typeof CAPTURE_SLOT_ARGUMENT];

export interface CaptureSlot {
	readonly slotKey: string;
	readonly lineageId: string;
	readonly authorityRevision: string;
	readonly targetIdentity: string;
	readonly lens: ReviewArtifactSubjectV2["lens"];
	readonly selectedOrder: number;
	readonly subjectHash: string;
	// Provider-issued, forwarded byte-identical. Never recomposed.
	readonly argumentTokens: readonly string[];
}

export interface CaptureSlotDerivation {
	readonly slots: readonly CaptureSlot[];
	// The first `review.capture-result` collect input, already validated
	// identical to every other input's frozen manifest binding. Callers that
	// need the changed-path manifest itself (rather than the six-field slot
	// binding) read it from here instead of re-deriving or re-validating it.
	readonly first: ReviewCollectInputV3;
}

const MANIFEST_INPUT_DIVERGENCE = "manifest-input-divergence";

export function captureSlotKey(lineageId: string, authorityRevision: string, targetIdentity: string, lens: string, selectedOrder: number, subjectHash: string): string {
	return [lineageId, authorityRevision, targetIdentity, lens, String(selectedOrder), subjectHash].join("|");
}

function captureArgumentValue(name: CaptureSlotArgument, input: ReviewCollectInputV3): string {
	const matches = input.arguments.filter((argument) => argument.name === name);
	if (matches.length !== 1 || !isCanonicalProcessString(matches[0]?.value)) {
		throw new CandidateViewError(`provider reviewer collect input requires exactly one canonical ${name} argument`, MANIFEST_INPUT_DIVERGENCE);
	}
	return matches[0]!.value;
}

function captureArgumentTokens(input: ReviewCollectInputV3): readonly string[] {
	return input.arguments.map((argument) => {
		if (typeof argument.token !== "string" || argument.token.length === 0) {
			throw new CandidateViewError("provider reviewer collect input argument token must be a non-empty string", MANIFEST_INPUT_DIVERGENCE);
		}
		return argument.token;
	});
}

/**
 * Derives one `CaptureSlot` per `review.capture-result` collect input offered
 * by fresh STATUS, validating that every input agrees on the frozen
 * candidate (lineage, authority revision, target, base/candidate tree,
 * changed-path manifest hash) and that lens/order/subject-hash are pairwise
 * distinct. Pure, no I/O — throws `CandidateViewError` with reason
 * `manifest-input-divergence` on any disagreement, exactly as the pre-Wave-1
 * `providerReviewerProjection` did before this module existed.
 */
export function deriveCaptureSlots(status: ReviewStatusV3): CaptureSlotDerivation {
	const authority = status.authority;
	const inputs = status.nextTransition?.kind === "collect"
		? status.nextTransition.collect?.inputs.filter((input) => input.captureOperation === "review.capture-result") ?? []
		: [];
	if (authority === undefined || inputs.length === 0) {
		throw new CandidateViewError("provider status did not supply reviewer collect inputs for the frozen candidate", MANIFEST_INPUT_DIVERGENCE);
	}
	const first = inputs[0]!;
	if (first.artifactSubject === undefined || first.baseTree === undefined || first.candidateTree === undefined || first.changedPathManifest === undefined) {
		throw new CandidateViewError("provider reviewer collect input omitted its frozen artifact subject or manifest", MANIFEST_INPUT_DIVERGENCE);
	}
	const manifestBytes = JSON.stringify(first.changedPathManifest);
	const manifestHash = first.artifactSubject.changedPathManifestSha256;
	const seenLenses = new Set<string>();
	const seenOrders = new Set<number>();
	const seenSubjects = new Set<string>();
	const slots: CaptureSlot[] = [];
	for (const input of inputs) {
		const subject = input.artifactSubject;
		if (
			subject === undefined || input.baseTree === undefined || input.candidateTree === undefined || input.changedPathManifest === undefined ||
			input.baseTree !== status.projection.baseTree || input.candidateTree !== status.projection.currentCandidateTree ||
			subject.baseTree !== input.baseTree || subject.candidateTree !== input.candidateTree ||
			subject.lineageId !== authority.lineageId || subject.authorityRevision !== authority.revision || subject.targetIdentity !== status.targetIdentity ||
			subject.changedPathManifestSha256 !== manifestHash || JSON.stringify(input.changedPathManifest) !== manifestBytes ||
			captureArgumentValue(CAPTURE_SLOT_ARGUMENT.LINEAGE, input) !== subject.lineageId ||
			captureArgumentValue(CAPTURE_SLOT_ARGUMENT.EXPECTED_REVISION, input) !== subject.authorityRevision ||
			captureArgumentValue(CAPTURE_SLOT_ARGUMENT.TARGET, input) !== subject.targetIdentity ||
			captureArgumentValue(CAPTURE_SLOT_ARGUMENT.LENS, input) !== subject.lens ||
			captureArgumentValue(CAPTURE_SLOT_ARGUMENT.ORDER, input) !== String(subject.selectedOrder) ||
			captureArgumentValue(CAPTURE_SLOT_ARGUMENT.SUBJECT_HASH, input) !== subject.subjectHash ||
			seenLenses.has(subject.lens) || seenOrders.has(subject.selectedOrder) || seenSubjects.has(subject.subjectHash)
		) {
			throw new CandidateViewError("provider reviewer collect inputs disagree on their frozen manifest binding", MANIFEST_INPUT_DIVERGENCE);
		}
		seenLenses.add(subject.lens);
		seenOrders.add(subject.selectedOrder);
		seenSubjects.add(subject.subjectHash);
		slots.push(Object.freeze({
			slotKey: captureSlotKey(subject.lineageId, subject.authorityRevision, subject.targetIdentity, subject.lens, subject.selectedOrder, subject.subjectHash),
			lineageId: subject.lineageId,
			authorityRevision: subject.authorityRevision,
			targetIdentity: subject.targetIdentity,
			lens: subject.lens,
			selectedOrder: subject.selectedOrder,
			subjectHash: subject.subjectHash,
			argumentTokens: captureArgumentTokens(input),
		}));
	}
	return Object.freeze({ slots: Object.freeze(slots), first });
}

/**
 * Fails closed before any capture runs unless every entry in `lensLabels`
 * (one per `review_result.lens_results[]` entry) maps to exactly one slot in
 * `slots` (outstanding STATUS-offered slots) — a missing lens, an extra
 * lens, or a duplicate all reject.
 */
export function assertLensSlotBijection(lensLabels: readonly string[], slots: readonly CaptureSlot[]): void {
	const slotLenses = new Set(slots.map((slot) => slot.lens as string));
	const seen = new Set<string>();
	for (const lens of lensLabels) {
		if (!slotLenses.has(lens) || seen.has(lens)) {
			throw new CandidateViewError(`review result lens ${lens} does not match exactly one outstanding capture slot`, "capture-lens-bijection-violation");
		}
		seen.add(lens);
	}
	if (seen.size !== slotLenses.size) {
		throw new CandidateViewError("review result is missing a capture slot for a selected lens", "capture-lens-bijection-violation");
	}
}
