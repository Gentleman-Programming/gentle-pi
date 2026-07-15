import {
	NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS,
	NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION,
	NATIVE_REVIEW_AUTHORITY_STATUS,
	type NativeReviewStatusResult,
} from "./native-review-cli.ts";

export const NATIVE_REVIEW_REMEDIATION = {
	NONE: "none",
	LEGACY: "legacy",
	INVALID_OR_MIXED: "invalid-or-mixed",
} as const;
export type NativeReviewRemediationKind = (typeof NATIVE_REVIEW_REMEDIATION)[keyof typeof NATIVE_REVIEW_REMEDIATION];

export const NATIVE_REVIEW_AUTHORITY_APPLICABILITY = {
	APPLICABLE: "applicable",
	UNRELATED_HISTORY: "unrelated-history",
	UNKNOWN: "unknown",
} as const;
export type NativeReviewAuthorityApplicability = (typeof NATIVE_REVIEW_AUTHORITY_APPLICABILITY)[keyof typeof NATIVE_REVIEW_AUTHORITY_APPLICABILITY];

export interface NativeReviewRemediationClassification {
	kind: NativeReviewRemediationKind;
	applicability: NativeReviewAuthorityApplicability;
	applicableLineageId?: string;
}

export function classifyNativeReviewRemediation(status: NativeReviewStatusResult, currentCandidateLineageIds: readonly string[] = []): NativeReviewRemediationClassification {
	const invalid = status.status === NATIVE_REVIEW_AUTHORITY_STATUS.SAME_LINEAGE_MIXED_COLLISION || (status.status === NATIVE_REVIEW_AUTHORITY_STATUS.INVALID && !status.complete && !status.authoritative);
	if (!invalid) return { kind: NATIVE_REVIEW_REMEDIATION.NONE, applicability: NATIVE_REVIEW_AUTHORITY_APPLICABILITY.UNRELATED_HISTORY };
	const matches = status.entries.filter((entry) =>
		entry.status === NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS.INVALID &&
		entry.lineageId !== undefined && currentCandidateLineageIds.includes(entry.lineageId),
	);
	if (matches.length !== 1) return {
		kind: NATIVE_REVIEW_REMEDIATION.NONE,
		applicability: currentCandidateLineageIds.length === 0 ? NATIVE_REVIEW_AUTHORITY_APPLICABILITY.UNRELATED_HISTORY : NATIVE_REVIEW_AUTHORITY_APPLICABILITY.UNKNOWN,
	};
	const entry = matches[0]!;
	return {
		kind: entry.version === NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION.LEGACY_V1 ? NATIVE_REVIEW_REMEDIATION.LEGACY : NATIVE_REVIEW_REMEDIATION.INVALID_OR_MIXED,
		applicability: NATIVE_REVIEW_AUTHORITY_APPLICABILITY.APPLICABLE,
		applicableLineageId: entry.lineageId,
	};
}

export function nativeReviewRemediationPermitsReset(classification: NativeReviewRemediationClassification): boolean {
	return classification.applicability === NATIVE_REVIEW_AUTHORITY_APPLICABILITY.APPLICABLE && classification.kind !== NATIVE_REVIEW_REMEDIATION.NONE;
}
