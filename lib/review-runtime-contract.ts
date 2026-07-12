import { domainHashV1 } from "./review-canonical.ts";

export const REVIEW_RUNTIME_INCOMPATIBLE = "REVIEW_RUNTIME_INCOMPATIBLE";

export interface LoadedReviewRuntimeIdentityV1 {
	schema: "gentle-ai.review-runtime/v1";
	compact_contract: "gentle-ai.review-compact/v2";
	operation_contract: string;
	state_schema: "gentle-ai.review-state/v2";
	record_schema: "gentle-ai.review-state-record/v2";
	receipt_schema: "gentle-ai.review-receipt-body/v2";
	canonicalization: "gentle-ai.canonical-json/v1";
	identity_hash: string;
}

function identityBody(): Omit<LoadedReviewRuntimeIdentityV1, "identity_hash"> {
	return {
		schema: "gentle-ai.review-runtime/v1",
		compact_contract: "gentle-ai.review-compact/v2",
		operation_contract: "gentle-ai.review-operation/v1",
		state_schema: "gentle-ai.review-state/v2",
		record_schema: "gentle-ai.review-state-record/v2",
		receipt_schema: "gentle-ai.review-receipt-body/v2",
		canonicalization: "gentle-ai.canonical-json/v1",
	};
}

function createIdentity(): LoadedReviewRuntimeIdentityV1 {
	const body = identityBody();
	return { ...body, identity_hash: domainHashV1("review-runtime-contract", body) };
}

let testIdentity: LoadedReviewRuntimeIdentityV1 | undefined;

export function loadedReviewRuntimeIdentity(): LoadedReviewRuntimeIdentityV1 {
	return testIdentity ?? createIdentity();
}

function identityHash(identity: Omit<LoadedReviewRuntimeIdentityV1, "identity_hash">): string {
	return domainHashV1("review-runtime-contract", identity);
}

export function assertReviewRuntimeIdentity(identity: LoadedReviewRuntimeIdentityV1): void {
	if (!hasValidIdentityHash(identity)) throw new Error(REVIEW_RUNTIME_INCOMPATIBLE);
}

function hasValidIdentityHash(identity: LoadedReviewRuntimeIdentityV1): boolean {
	return identity.identity_hash === identityHash({
		schema: identity.schema,
		compact_contract: identity.compact_contract,
		operation_contract: identity.operation_contract,
		state_schema: identity.state_schema,
		record_schema: identity.record_schema,
		receipt_schema: identity.receipt_schema,
		canonicalization: identity.canonicalization,
	});
}

export function assertLoadedReviewRuntimeIdentity(expected: LoadedReviewRuntimeIdentityV1): void {
	const actual = loadedReviewRuntimeIdentity();
	assertReviewRuntimeIdentity(actual);
	assertReviewRuntimeIdentity(expected);
	if (actual.identity_hash !== expected.identity_hash) throw new Error(REVIEW_RUNTIME_INCOMPATIBLE);
}

export function setLoadedReviewRuntimeIdentityForTesting(identity: LoadedReviewRuntimeIdentityV1 | undefined): void {
	testIdentity = identity;
}
