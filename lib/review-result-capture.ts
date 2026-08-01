// Pure exact-slot capture derivation (Wave 1, #2028 host behavior, Design
// Decision 1). This is the single validator for the provider-issued
// `review.capture-result` binding fields: lineage, target, authority
// revision, repository context (base/candidate tree), changed-path manifest
// hash, lens, order, and subject hash. `providerReviewerProjection`
// (extensions/gentle-ai.ts) and the FINALIZE capture phase both consume this
// module instead of re-validating the binding themselves, so exactly one
// validator exists.
import { createHash } from "node:crypto";
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

// ---------------------------------------------------------------------------
// Wave 1, #2028 host behavior, Design Decision 2: admission diagnostics.
//
// `decodeSafeAdmissionDiagnostic` is an ALLOWLIST decoder: it returns a value
// only for its exact known shape, and `undefined` for anything it cannot
// fully prove — unknown code, an extra key, an absolute or private location,
// `..`/`~`/control characters, an over-length reason, or raw prose all yield
// `undefined`. A denylist or sanitize-then-forward default was explicitly
// rejected (design.md Decision 2): a wrong default here is exactly how
// private paths and user content leak into an issue report. The raw provider
// failure envelope keeps flowing through the existing opaque
// `nativeOperationFailure` path unchanged, and never through this decoder.
export const ADMISSION_DIAGNOSTIC_CODE = {
	INVALID_FINDING_LOCATION: "invalid_finding_location",
	CANDIDATE_CAUSALITY_UNPROVEN: "candidate_causality_unproven",
} as const;
export type AdmissionDiagnosticCode = (typeof ADMISSION_DIAGNOSTIC_CODE)[keyof typeof ADMISSION_DIAGNOSTIC_CODE];

export interface SafeAdmissionDiagnostic {
	readonly code: AdmissionDiagnosticCode;
	readonly findingId: string;
	readonly reason: string;
	readonly location?: string;
}

const ADMISSION_DIAGNOSTIC_REQUIRED_KEYS = ["code", "finding_id", "reason"] as const;
const ADMISSION_DIAGNOSTIC_OPTIONAL_KEYS = ["location"] as const;
const ADMISSION_FINDING_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// Printable ASCII, space (0x20) through tilde (0x7e). Excludes every control
// character (including NUL and newline) and every non-ASCII byte by
// construction — no separate control-character check is needed.
const ADMISSION_PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;
const ADMISSION_LOCATION_MAX_LENGTH = 256;
const ADMISSION_REASON_MAX_LENGTH = 120;

function isSafeAdmissionLocation(value: string): boolean {
	if (value.length === 0 || value.length > ADMISSION_LOCATION_MAX_LENGTH) return false;
	if (!ADMISSION_PRINTABLE_ASCII_PATTERN.test(value)) return false;
	if (value.startsWith("/") || value.startsWith("~") || value.includes("\\")) return false;
	return !value.split("/").some((segment) => segment === "..");
}

function isSafeAdmissionReason(value: string): boolean {
	return value.length > 0 && value.length <= ADMISSION_REASON_MAX_LENGTH && value.trim() === value && ADMISSION_PRINTABLE_ASCII_PATTERN.test(value);
}

/**
 * Decodes a raw, untrusted admission-diagnostic envelope into its safe,
 * bounded shape, or `undefined` when anything about it cannot be fully
 * proven safe. Exact-record discipline (the same discipline
 * `lib/review-integration-v2.ts` applies via its own `exactRecord` helper):
 * every required key must be present and every key must be allowlisted, or
 * decoding fails closed.
 */
export function decodeSafeAdmissionDiagnostic(value: unknown): SafeAdmissionDiagnostic | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const body = value as Record<string, unknown>;
	const allowedKeys = new Set<string>([...ADMISSION_DIAGNOSTIC_REQUIRED_KEYS, ...ADMISSION_DIAGNOSTIC_OPTIONAL_KEYS]);
	for (const key of ADMISSION_DIAGNOSTIC_REQUIRED_KEYS) if (!Object.hasOwn(body, key)) return undefined;
	for (const key of Object.keys(body)) if (!allowedKeys.has(key)) return undefined;
	const code = body.code;
	if (code !== ADMISSION_DIAGNOSTIC_CODE.INVALID_FINDING_LOCATION && code !== ADMISSION_DIAGNOSTIC_CODE.CANDIDATE_CAUSALITY_UNPROVEN) return undefined;
	const findingId = body.finding_id;
	if (typeof findingId !== "string" || !ADMISSION_FINDING_ID_PATTERN.test(findingId)) return undefined;
	const reason = body.reason;
	if (typeof reason !== "string" || !isSafeAdmissionReason(reason)) return undefined;
	if (body.location !== undefined) {
		if (typeof body.location !== "string" || !isSafeAdmissionLocation(body.location)) return undefined;
	}
	return Object.freeze({
		code,
		findingId,
		reason,
		...(body.location === undefined ? {} : { location: body.location as string }),
	});
}

// ---------------------------------------------------------------------------
// Wave 1, #2028 host behavior, Design Decisions 3, 4, 5: one relaunch grant
// per slot key, committed-capture proof, and cleanup. State lives in a
// parameter-injected `Map<string, CaptureSlotRecord>`, created beside
// `correctionEvidenceByLineage` and threaded through
// `executeReviewControllerOperation` the same way (extensions/gentle-ai.ts).
export const CAPTURE_SLOT_STATE = {
	ADMITTED: "admitted",
	COMMITTED: "committed",
	RELAUNCH_GRANTED: "relaunch-granted",
} as const;
export type CaptureSlotStateValue = (typeof CAPTURE_SLOT_STATE)[keyof typeof CAPTURE_SLOT_STATE];

export interface CaptureSlotRecord {
	readonly slotKey: string;
	readonly lineageId: string;
	readonly state: CaptureSlotStateValue;
	// sha256 of every rejected submission for this slot, never the bytes
	// themselves — unreplayability is enforced by digest membership, not by
	// keeping candidate-derived content across turns.
	readonly rejectedDocumentHashes: ReadonlySet<string>;
	readonly manifest?: { readonly path?: string; readonly reference?: string };
}

/** `sha256:<hex>` of `value`, the repository-wide canonical digest format. */
export function sha256Hex(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Removes every record belonging to `lineageId`. Used by all three cleanup
 * triggers (Decision 5): all slots for a lineage admitted/committed, FINALIZE
 * terminal, and — for the whole map, one lineage at a time — session
 * shutdown. A stale grant can never be reused after this: `slotKey` embeds
 * `authorityRevision` and `subjectHash`, so even a record that somehow
 * survived would never match a fresh STATUS reoffer for a new revision or a
 * new candidate.
 */
export function clearCaptureSlotRecordsForLineage(records: Map<string, CaptureSlotRecord>, lineageId: string): void {
	for (const [key, record] of records) if (record.lineageId === lineageId) records.delete(key);
}

/**
 * Proof of commitment (Decision 4): under an UNCHANGED authority lineage and
 * revision, `slot` is no longer offered as a `review.capture-result` collect
 * input for its exact lens/order pair. This is the only Pi-observable proof
 * that requires zero provider-topology reconstruction. A changed authority,
 * a missing authority (non-`current_target` applicability), or the slot
 * still being offered are all "not proven" — the caller must fail closed.
 */
export function isCaptureSlotCommitted(slot: CaptureSlot, freshStatus: ReviewStatusV3): boolean {
	const authority = freshStatus.authority;
	if (authority === undefined || authority.lineageId !== slot.lineageId || authority.revision !== slot.authorityRevision) return false;
	const inputs = freshStatus.nextTransition?.kind === "collect" ? freshStatus.nextTransition.collect?.inputs ?? [] : [];
	const stillOffered = inputs.some((input) =>
		input.captureOperation === "review.capture-result" &&
		input.artifactSubject?.lens === slot.lens &&
		input.artifactSubject?.selectedOrder === slot.selectedOrder,
	);
	return !stillOffered;
}
