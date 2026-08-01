import { REQUIRED_GATES, REQUIRED_OPERATIONS, REQUIRED_PROJECTIONS } from "./gentle-ai-required-floor.generated.ts";

export const REVIEW_INTEGRATION_CONTRACT = "gentle-ai.review-integration/v2";

export const REVIEW_INTEGRATION_OPERATION = {
	BIND_SDD: "review.bind_sdd",
	CAPABILITIES: "review.capabilities",
	FINALIZE: "review.finalize",
	REPAIR: "review.repair",
	START: "review.start",
	STATUS: "review.status",
	VALIDATE: "review.validate",
} as const;
export type ReviewIntegrationOperation = (typeof REVIEW_INTEGRATION_OPERATION)[keyof typeof REVIEW_INTEGRATION_OPERATION];

// Retained enums/unions, identity-neutral: copied verbatim from lib/review-integration-v1.ts.
export const REVIEW_AUTHORITY_APPLICABILITY = {
	CURRENT_TARGET: "current_target",
	UNRELATED: "unrelated",
	AMBIGUOUS: "ambiguous",
	CORRUPTED: "corrupted",
	NOT_EVALUATED: "not_evaluated",
} as const;
export type ReviewAuthorityApplicability = (typeof REVIEW_AUTHORITY_APPLICABILITY)[keyof typeof REVIEW_AUTHORITY_APPLICABILITY];

export const REVIEW_REPLAYABILITY = {
	NOT_REPLAYABLE: "not_replayable",
	EXACT_REPLAY_SAFE: "exact_replay_safe",
	STATUS_REQUIRED: "status_required",
	MANUAL_ACTION_REQUIRED: "manual_action_required",
} as const;
export type ReviewReplayability = (typeof REVIEW_REPLAYABILITY)[keyof typeof REVIEW_REPLAYABILITY];

export const REVIEW_MUTATION_OUTCOME = {
	NOT_STARTED: "not_started",
	UNKNOWN: "unknown",
	COMMITTED: "committed",
} as const;
export type ReviewMutationOutcome = (typeof REVIEW_MUTATION_OUTCOME)[keyof typeof REVIEW_MUTATION_OUTCOME];

export const REVIEW_PROJECTION = {
	STAGED: "staged",
	WORKSPACE: "workspace",
} as const;
export type ReviewProjection = (typeof REVIEW_PROJECTION)[keyof typeof REVIEW_PROJECTION];

export const REVIEW_PROJECTION_KIND = {
	CURRENT_CHANGES: "current-changes",
	BASE_DIFF: "base-diff",
	BASE_WORKSPACE_OVERLAY: "base-workspace-overlay",
	EXACT_REVISION: "exact-revision",
	FIX_DIFF: "fix-diff",
} as const;
export type ReviewProjectionKind = (typeof REVIEW_PROJECTION_KIND)[keyof typeof REVIEW_PROJECTION_KIND];

export const REVIEW_AUTHORITY_VERSION = {
	COMPACT_V2: "compact-v2",
	LEGACY_V1: "legacy-v1",
} as const;
export type ReviewAuthorityVersion = (typeof REVIEW_AUTHORITY_VERSION)[keyof typeof REVIEW_AUTHORITY_VERSION];

// Widened by protocol v2: `correction_required` and `validating` are new
// start/status states introduced by the negotiated correction lifecycle.
export const REVIEW_START_STATE = {
	UNREVIEWED: "unreviewed",
	REVIEWING: "reviewing",
	JUDGES_CONFIRMED: "judges_confirmed",
	FINDINGS_FROZEN: "findings_frozen",
	EVIDENCE_CLASSIFIED: "evidence_classified",
	FIX_REQUIRED: "fix_required",
	FIXING: "fixing",
	FIX_VALIDATING: "fix_validating",
	CORRECTION_REQUIRED: "correction_required",
	VALIDATING: "validating",
	READY_FINAL_VERIFICATION: "ready_final_verification",
	FINAL_VERIFYING: "final_verifying",
	APPROVED: "approved",
	ESCALATED: "escalated",
	INVALIDATED: "invalidated",
} as const;
export type ReviewStartState = (typeof REVIEW_START_STATE)[keyof typeof REVIEW_START_STATE];

const START_ACTIONS = ["created", "resumed", "reuse-receipt", "blocked-scope-action"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const REVIEW_LENSES = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
const RISK_REASON_CODES = ["configuration_change", "empty_content", "executable_change", "executable_mode", "hot_path", "large_change", "non_executable_only", "process_boundary", "process_scan_limit", "service_token", "shell_source"] as const;
const RISK_SIGNALS = ["auth", "update", "security", "payments", "permissions", "shell_process"] as const;
const STATUS_ACTIONS = ["start", "finalize", "validate", "recover", "retry_final_verification", "maintainer_action", "select_lineage", "repair_authority", "reconcile_finalize", "stop"] as const;
export const REVIEW_STATUS_ACTION_DISPOSITION = {
	SCOPE_CHANGED: "scope_changed",
	INVALIDATED: "invalidated",
	ESCALATED: "escalated",
	FINAL_VERIFICATION_RETRY: "final_verification_retry",
} as const;
export type ReviewStatusActionDisposition = (typeof REVIEW_STATUS_ACTION_DISPOSITION)[keyof typeof REVIEW_STATUS_ACTION_DISPOSITION];
const RECEIPT_STATUSES = ["expected_missing", "present", "publication_pending", "not_applicable"] as const;
// REQUIRED_OPERATIONS/REQUIRED_GATES/REQUIRED_PROJECTIONS are generated (D7,
// scripts/build-gentle-ai-baselines.mjs) from the checked-in semantic
// snapshot: monotone floors that `--write` may only grow, never silently
// shrink. REQUIRED_SCHEMAS stays hand-authored below -- the checked-in
// semantic snapshot mirror carries no `schemas` array (that field exists only
// on the live negotiated `review.capabilities` response this module decodes,
// a strictly larger runtime surface the offline generator does not consume).
const REQUIRED_SCHEMAS = Object.freeze([
	"gentle-ai.review-admitted-result/v2",
	"gentle-ai.review-artifact-subject/v2",
	"gentle-ai.review-authority-repair-assessment/v1",
	"gentle-ai.review-authority-status/v1",
	"gentle-ai.review-gate-request/v1",
	"gentle-ai.review-integration.capabilities/v2",
	"gentle-ai.review-integration.consent/v2",
	"gentle-ai.review-integration.failure/v2",
	"gentle-ai.review-final-verification-incident/v1",
	"gentle-ai.review-integration.operation/v2",
	"gentle-ai.review-integration.projection/v1",
	"gentle-ai.review-integration.repair/v2",
	"gentle-ai.review-integration.start/v3",
	"gentle-ai.review-integration.status/v3",
	"gentle-ai.review-receipt/v1",
	"gentle-ai.review-receipt/v2",
	"gentle-ai.review-result-artifact/v2",
	"gentle-ai.review-targeted-validation-request/v1",
	"gentle-ai.review-verification-evidence/v2",
	"https://gentle-ai.dev/schema/review/refuter/v1",
	"https://gentle-ai.dev/schema/review/reviewer/v1",
	"https://gentle-ai.dev/schema/review/validator/v1",
] as const);
const OPTIONAL_FEATURE_NAMES = Object.freeze([
	"base_ref_workspace_overlay",
	"bounded_process_waits",
	"classified_authority_repair",
	"exact_gate_receipt_discovery",
	"native_frozen_candidate_context",
	"native_low_risk_verification",
	"native_next_transition",
	"one_shot_final_verification_retry",
	"opaque_repository_context",
	"outcome_bound_verification_evidence",
	"provider_artifact_admission",
	"provider_bound_native_git_context",
	"provider_targeted_validation_request",
	"recovered_correction_evidence",
	"risk_reasons",
	"scope_change_diagnostics",
	"validating_result_reopen",
] as const);
const FEATURE_NAMES = Object.freeze([
	"base_ref_workspace_overlay",
	"bounded_process_waits",
	"classified_authority_repair",
	"compact_v2_authority",
	"exact_gate_receipt_discovery",
	"exact_receipt_replay",
	"five_delivery_gates",
	"immutable_snapshot",
	"legacy_v1_target_scoped_read_only",
	"native_frozen_candidate_context",
	"native_low_risk_verification",
	"native_next_transition",
	"one_shot_final_verification_retry",
	"opaque_repository_context",
	"outcome_bound_verification_evidence",
	"provider_artifact_admission",
	"provider_bound_native_git_context",
	"provider_targeted_validation_request",
	"recovered_correction_evidence",
	"repository_independent_capabilities",
	"restart_safe_projection",
	"risk_reasons",
	"scope_change_diagnostics",
	"sdd_receipt_binding",
	"target_scoped_status",
	"uniform_failure_envelope",
	"validating_result_reopen",
] as const);
// Exact set, no tolerance (unlike the monotone floors above): FEATURE_NAMES/
// OPTIONAL_FEATURE_NAMES/REQUIRED_MANDATORY_FEATURES stay hand-authored, not
// generated. A mandatory feature needs client decode code before Pi can
// support it, so an advertised mandatory name is never auto-added here --
// scripts/build-gentle-ai-baselines.mjs independently validates the same
// exact-set discipline offline against its own PI_SUPPORTED_MANDATORY_FEATURES
// (a deliberate duplicate decision, not a shared source, per D7).
const REQUIRED_MANDATORY_FEATURES = Object.freeze(FEATURE_NAMES.filter((name) => !(OPTIONAL_FEATURE_NAMES as readonly string[]).includes(name)));

type StartAction = (typeof START_ACTIONS)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];
type ReviewLens = (typeof REVIEW_LENSES)[number];
type RiskReasonCode = (typeof RISK_REASON_CODES)[number];
type RiskSignal = (typeof RISK_SIGNALS)[number];
type ReviewStatusAction = (typeof STATUS_ACTIONS)[number];
type ReviewReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface ReviewFeatureV2 {
	name: (typeof FEATURE_NAMES)[number];
	supported: boolean;
	requires: readonly string[];
}

export interface ReviewCapabilitiesV2 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	packageVersion: string;
	buildId: string;
	executableDigest: string;
	operations: ReadonlySet<string>;
	gates: ReadonlySet<string>;
	projections: ReadonlySet<string>;
	schemas: ReadonlySet<string>;
	mandatoryFeatures: ReadonlySet<string>;
	optionalFeatures: ReadonlySet<string>;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewRiskReasonV2 {
	code: RiskReasonCode;
	signal?: RiskSignal;
	path?: string;
	oldMode?: string;
	newMode?: string;
}

export interface ChangedPathEntry {
	readonly path: string;
	readonly status: "A" | "D" | "M" | "T";
	readonly oldMode: string;
	readonly newMode: string;
	readonly deleted: boolean;
	readonly typeChanged: boolean;
	readonly modeOnly: boolean;
	readonly intendedUntracked: boolean;
}

export interface ReviewArtifactSubjectV2 {
	schema: "gentle-ai.review-artifact-subject/v2";
	subjectHash: string;
	lineageId: string;
	authorityRevision: string;
	targetIdentity: string;
	baseTree: string;
	candidateTree: string;
	changedPathManifestSha256: string;
	lens: ReviewLens;
	selectedOrder: number;
	correctionTargetIdentity?: string;
}

export interface ReviewRepositoryContextV2 {
	capability: "review.opaque_repository_context";
	handle: string;
	revision: string;
	targetIdentity: string;
}

export interface ReviewStartV3 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	action: StartAction;
	lensesRequired: boolean;
	lineageId: string;
	state: ReviewStartState;
	riskLevel: RiskLevel;
	selectedLenses: readonly ReviewLens[];
	projection: ReviewProjection;
	changedFiles: number;
	changedLines: number;
	correctionBudget: number;
	riskReasons: readonly ReviewRiskReasonV2[];
	artifactSubjects: readonly ReviewArtifactSubjectV2[];
	targetMode?: "base-workspace-overlay";
	targetIdentity?: string;
	baseTree?: string;
	candidateTree?: string;
	changedPathManifest?: readonly ChangedPathEntry[];
	repositoryContext?: ReviewRepositoryContextV2;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewProjectionDescriptorV1 {
	schema: "gentle-ai.review-integration.projection/v1";
	kind: ReviewProjectionKind;
	projection: ReviewProjection;
	baseTree: string;
	initialReviewTree: string;
	currentCandidateTree: string;
	pathsDigest: string;
	paths: readonly string[];
	intendedUntracked: readonly string[];
	intendedUntrackedProof: string;
	initialSnapshotIdentity: string;
	currentSnapshotIdentity: string;
}

export interface ReviewStatusAuthorityV1 {
	version: ReviewAuthorityVersion;
	lineageId: string;
	state: string;
	generation: number;
	revision: string;
}

export interface ReviewStatusReceiptV1 {
	status: ReviewReceiptStatus;
	identity?: string;
}

export interface ReviewStatusFrozenV1 {
	tier: RiskLevel;
	originalChangedLines: number;
	correctionBudget: number;
}

export interface ReviewStatusReconciliationV1 {
	required: true;
}

export interface ReviewTransitionArgumentV3 {
	name: string;
	value: string;
	token?: string;
}

export interface ReviewNextTransitionExecuteV3 {
	operation: string;
	arguments: readonly ReviewTransitionArgumentV3[];
	preconditions: readonly ReviewTransitionArgumentV3[];
	binding: { targetIdentity: string; lineageId?: string; revision?: string };
	command?: string;
}

export interface ReviewCollectInputV3 {
	name: string;
	schema: string;
	captureOperation: string;
	arguments: readonly ReviewTransitionArgumentV3[];
	artifactSubject?: ReviewArtifactSubjectV2;
	baseTree?: string;
	candidateTree?: string;
	changedPathManifest?: readonly ChangedPathEntry[];
	validationRequest?: ReviewTargetedValidationRequestV1;
}

export interface ReviewNextTransitionV3 {
	kind: "execute" | "collect" | "stop";
	reasonCode: string;
	execute?: ReviewNextTransitionExecuteV3;
	collect?: { inputs: readonly ReviewCollectInputV3[] };
}

export interface ReviewTargetedValidationRequestV1 {
	schema: "gentle-ai.review-targeted-validation-request/v1";
	requestHash: string;
	lineageId: string;
	expectedRevision: string;
	targetIdentity: string;
	fixFindingIds: readonly string[];
	projection: ReviewProjection;
	correctionCandidateTree: string;
	correctionTargetIdentity: string;
	correctionPaths: readonly string[];
	correctionPathsDigest: string;
}

export interface ReviewFinalVerificationRetryV1 {
	incidentSchema: "gentle-ai.review-final-verification-incident/v1";
	incidentClass: "procedural_tooling_failure";
	validatingRevision: string;
	targetIdentity: string;
	failedEvidenceHash: string;
	failedEvidenceRecordDigest?: string;
	finalizeRequestDigest: string;
}

export interface ReviewStatusV3 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	applicability: Exclude<ReviewAuthorityApplicability, "not_evaluated">;
	authority?: ReviewStatusAuthorityV1;
	receipt: ReviewStatusReceiptV1;
	action: ReviewStatusAction;
	actionDisposition?: ReviewStatusActionDisposition;
	replayability: ReviewReplayability;
	frozen?: ReviewStatusFrozenV1;
	reconciliation?: ReviewStatusReconciliationV1;
	targetIdentity: string;
	authorityTargetIdentity?: string;
	projection: ReviewProjectionDescriptorV1;
	repair: AuthorityRepairAssessmentV1;
	candidates: readonly string[];
	nextTransition?: ReviewNextTransitionV3;
	validationRequest?: ReviewTargetedValidationRequestV1;
	finalVerificationRetry?: ReviewFinalVerificationRetryV1;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewConsentChoiceV2 {
	answer: "granted" | "declined";
	label: string;
	effect: string;
	invocation: string;
}

export interface ReviewConsentV2 {
	schema: "gentle-ai.review-integration.consent/v2";
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: "review.start";
	action: "consent_required";
	blocking: true;
	targetIdentity: string;
	projection: ReviewProjection;
	riskLevel: "medium" | "high";
	changedFiles: number;
	changedLines: number;
	headline: string;
	reason: string;
	value: string;
	riskEvidence: readonly string[];
	choices: readonly [ReviewConsentChoiceV2, ReviewConsentChoiceV2];
	offPath: { note: string; command: "gentle-ai review mode disable" };
	raw: Readonly<Record<string, unknown>>;
}

const FAILURE_REQUIRED_INPUTS = [
	"lineage_id",
	"change",
	"expected_binding_revision",
	"predecessor_lineage_id",
	"expected_predecessor_revision",
	"successor_lineage_id",
	"disposition",
	"reason",
	"actor",
	"incident",
	"maintainer_authorization",
	"base_ref",
] as const;
export type ReviewFailureRequiredInputV2 = (typeof FAILURE_REQUIRED_INPUTS)[number];
const FAILURE_NEXT_ACTIONS = ["correct_request", "retry", "retry_with_bounded_backoff", "review.status", "review.finalize", "review.repair", "review.bind_sdd", "explicit-maintainer-action", "stop"] as const;
export type ReviewFailureNextActionV2 = (typeof FAILURE_NEXT_ACTIONS)[number];
// Known cause_category values: the vendored failure.schema.json enum plus
// "incomplete_store_entry", which the v2.1.8 emitter produces beyond that enum.
// cause_category is diagnostic metadata (nothing routes on it), so unknown
// snake_case values are tolerated for forward compatibility.
const FAILURE_CAUSE_CATEGORIES = ["inventory_io_or_layout", "lock_ambiguous", "reset_residue", "record_or_graph_invalid", "inventory_incomplete", "incomplete_store_entry"] as const;
export type ReviewFailureCauseCategoryV2 = (typeof FAILURE_CAUSE_CATEGORIES)[number] | (string & {});

export interface ReviewFailureTargetEvidenceV1 {
	candidateTree: string;
	pathsDigest: string;
}

export interface ReviewFailureScopeChangeV1 {
	expected: ReviewFailureTargetEvidenceV1;
	actual: ReviewFailureTargetEvidenceV1;
	differingPathCount: number;
	differingPathsDigest: string;
	predecessorLineageId: string;
	predecessorRevision: string;
	recoveryOperation: "review.recover";
	recoveryRequiredInputs: readonly string[];
}

export interface ReviewFailureBindingRevisionV1 {
	expected: string;
	current: string;
}

export interface ReviewFailureContextV2 {
	scopeChange?: ReviewFailureScopeChangeV1;
	bindingRevision?: ReviewFailureBindingRevisionV1;
}

export interface ReviewFailureV2 {
	schema: "gentle-ai.review-integration.failure/v2";
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: ReviewIntegrationOperation;
	phase: "preflight" | "pre_native" | "native_running" | "native_committed" | "reconciliation";
	code: string;
	message: string;
	mutationOutcome: ReviewMutationOutcome;
	authorityApplicability: ReviewAuthorityApplicability;
	retrySafe: boolean;
	replayability: ReviewReplayability;
	lineageId?: string;
	requestDigest?: string;
	progressIdentity?: string;
	requiredInputs: readonly ReviewFailureRequiredInputV2[];
	nextAction: ReviewFailureNextActionV2;
	causeCategory?: ReviewFailureCauseCategoryV2;
	cause?: string;
	context?: ReviewFailureContextV2;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewOperationV2 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: "review.finalize" | "review.validate" | "review.bind_sdd" | "review.retry_final_verification";
	result: Readonly<Record<string, unknown>>;
	raw: Readonly<Record<string, unknown>>;
}

export interface AuthorityRepairAssessmentCandidateV1 {
	lineageId: string;
	revision: string;
	chainIdentity: string;
	eventCount: number;
	aliasEventCount: number;
	operations: readonly ("review/complete-fix" | "review/validate-fix")[];
}

export interface AuthorityRepairAssessmentCountsV1 {
	lineages: number;
	compactLineages: number;
	legacyLineages: number;
	events: number;
	bytes: number;
	eligibleCandidates: number;
	unsupportedLineages: number;
	conflicts: number;
}

export interface AuthorityRepairAssessmentV1 {
	schema: "gentle-ai.review-authority-repair-assessment/v1";
	status: "eligible" | "unsupported" | "ambiguous" | "conflicting" | "truncated";
	class?: "legacy_v1_historical_alias";
	cause?: "unsupported_historical_v1_operation_alias";
	disposition?: "quarantine-approved-historical-alias";
	repositoryBinding?: string;
	candidate?: AuthorityRepairAssessmentCandidateV1;
	counts: AuthorityRepairAssessmentCountsV1;
	supportedOperations: readonly ["review/complete-fix", "review/validate-fix"];
	authorizationSchema: "gentle-ai.review-repair-authorization/v1";
}

export interface ReviewRepairProviderInputsV2 {
	class: "legacy_v1_historical_alias";
	lineageId: string;
	expectedRevision: string;
	cause: "unsupported_historical_v1_operation_alias";
	disposition: "quarantine-approved-historical-alias";
	repositoryBinding: string;
	authorizationSchema: "gentle-ai.review-repair-authorization/v1";
}

export interface ReviewRepairExecutionV2 {
	status: "committed";
	class: "legacy_v1_historical_alias";
	lineageId: string;
	revision: string;
	chainIdentity: string;
	cause: "unsupported_historical_v1_operation_alias";
	disposition: "quarantine-approved-historical-alias";
	assessmentDigest: string;
	requestDigest: string;
	recordIdentity: string;
}

export interface ReviewRepairV2 {
	schema: "gentle-ai.review-integration.repair/v2";
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: "review.repair";
	mode: "preflight" | "execute";
	assessment: AuthorityRepairAssessmentV1;
	providerInputs?: ReviewRepairProviderInputsV2;
	requiredInputs: readonly ("actor" | "reason" | "maintainer_authorization")[];
	execution?: ReviewRepairExecutionV2;
	raw: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Primitives — ported verbatim from lib/review-integration-v1.ts. exactRecord's
// exact-key discipline (allowAdditional = false by default) is the single
// highest-risk thing to port faithfully: losing it means Pi silently accepts
// malformed v2 payloads.
// ---------------------------------------------------------------------------

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exactRecord(value: unknown, label: string, required: readonly string[], optional: readonly string[] = [], allowAdditional = false): Record<string, unknown> {
	const body = record(value, label);
	for (const key of required) {
		if (!Object.hasOwn(body, key)) throw new TypeError(`${label}.${key} is required`);
	}
	const allowed = new Set([...required, ...optional]);
	if (!allowAdditional) for (const key of Object.keys(body)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
	return body;
}

function text(value: unknown, label: string, options: { minimum?: number; maximum?: number; pattern?: RegExp } = {}): string {
	const minimum = options.minimum ?? 0;
	if (typeof value !== "string" || value.length < minimum || (options.maximum !== undefined && value.length > options.maximum) || (options.pattern !== undefined && !options.pattern.test(value))) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

function nonempty(value: unknown, label: string): string {
	return text(value, label, { minimum: 1 });
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
	return value;
}

function integer(value: unknown, label: string, minimum = 0, maximum?: number): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
		throw new TypeError(`${label} must be an integer in range`);
	}
	return value;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], label: string): T {
	if (typeof value !== "string" || !values.includes(value as T)) throw new TypeError(`${label} is unsupported`);
	return value as T;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const body = value as Record<string, unknown>;
		return `{${Object.keys(body).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(body[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function array<T>(value: unknown, label: string, decodeItem: (entry: unknown, label: string) => T, options: { minimum?: number; maximum?: number; unique?: boolean } = {}): readonly T[] {
	if (!Array.isArray(value) || value.length < (options.minimum ?? 0) || (options.maximum !== undefined && value.length > options.maximum)) {
		throw new TypeError(`${label} has an invalid length`);
	}
	const decoded = value.map((entry, index) => decodeItem(entry, `${label}[${index}]`));
	if (options.unique && new Set(decoded.map(canonicalJson)).size !== decoded.length) throw new TypeError(`${label} must not contain duplicates`);
	return decoded;
}

function stringArray(value: unknown, label: string, options: { minimum?: number; maximum?: number; unique?: boolean; pattern?: RegExp } = {}): readonly string[] {
	return array(value, label, (entry, itemLabel) => text(entry, itemLabel, { minimum: 1, pattern: options.pattern }), options);
}

function enumArray<T extends string>(value: unknown, values: readonly T[], label: string, options: { minimum?: number; maximum?: number; unique?: boolean } = {}): readonly T[] {
	return array(value, label, (entry, itemLabel) => enumeration(entry, values, itemLabel), options);
}

function sha256(value: unknown, label: string): string {
	return text(value, label, { pattern: /^sha256:[0-9a-f]{64}$/ });
}

function gitTree(value: unknown, label: string): string {
	return text(value, label, { pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/ });
}

function lineage(value: unknown, label: string): string {
	return text(value, label, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
}

function safePath(value: unknown, label: string): string {
	return text(value, label, { minimum: 1, pattern: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/ });
}

// v2 constant identity: every v2 payload pins one `const` schema, so unlike
// v1's requireVersionedIdentity there is no minor-driven revision to resolve.
function requireIdentity(value: Record<string, unknown>, schema: string, operation?: string): void {
	if (value.schema !== schema) throw new TypeError(`schema must be ${schema}`);
	if (value.contract !== REVIEW_INTEGRATION_CONTRACT) throw new TypeError(`contract must be ${REVIEW_INTEGRATION_CONTRACT}`);
	if (operation !== undefined && value.operation !== operation) throw new TypeError(`operation must be ${operation}`);
}

function assertExactSet(actual: readonly string[], expected: readonly string[], label: string): void {
	if (actual.length !== expected.length || expected.some((value) => !actual.includes(value))) throw new TypeError(`${label} does not match the required integration surface`);
}

// An advertised surface is a superset promise, not an exact manifest — see
// lib/review-integration-v1.ts's identical comment for the v2.2.0 lesson this
// codifies: demanding an exact match rejects a compatible provider release.
function assertSupersetOf(actual: readonly string[], required: readonly string[], label: string): void {
	const advertised = new Set(actual);
	const missing = required.filter((value) => !advertised.has(value));
	if (missing.length > 0) throw new TypeError(`${label} omits the required integration surface: ${missing.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Capabilities/v2
// ---------------------------------------------------------------------------

function decodeFeature(value: unknown, label: string): ReviewFeatureV2 {
	const feature = exactRecord(value, label, ["name", "supported", "requires"]);
	return {
		name: enumeration(feature.name, FEATURE_NAMES, `${label}.name`),
		supported: boolean(feature.supported, `${label}.supported`),
		requires: stringArray(feature.requires, `${label}.requires`, { unique: true }),
	};
}

function decodeOptionalFeature(value: unknown, label: string): { name: string; supported: boolean; requires: readonly string[] } {
	const feature = exactRecord(value, label, ["name", "supported", "requires"]);
	return {
		name: nonempty(feature.name, `${label}.name`),
		supported: boolean(feature.supported, `${label}.supported`),
		requires: stringArray(feature.requires, `${label}.requires`, { unique: true }),
	};
}

export function decodeReviewCapabilitiesV2(value: unknown, verifiedExecutableDigest: string): ReviewCapabilitiesV2 {
	const requiredFields = ["schema", "contract", "protocol", "package", "build", "executable", "operations", "gates", "projections", "schemas", "features", "compatibility"] as const;
	const body = exactRecord(value, "capabilities", requiredFields, ["bootstrap"]);
	requireIdentity(body, "gentle-ai.review-integration.capabilities/v2");

	const protocol = exactRecord(body.protocol, "capabilities.protocol", ["major", "minor"]);
	if (protocol.major !== 2 || protocol.minor !== 0) throw new TypeError("incompatible review integration protocol");

	const packageIdentity = exactRecord(body.package, "capabilities.package", ["name", "version", "release_channel"]);
	if (packageIdentity.name !== "gentle-ai") throw new TypeError("capabilities package identity mismatch");
	const packageVersion = nonempty(packageIdentity.version, "capabilities.package.version");
	enumeration(packageIdentity.release_channel, ["development", "prerelease", "stable"] as const, "capabilities.package.release_channel");

	const build = exactRecord(body.build, "capabilities.build", ["id", "go_version", "module_version", "vcs", "vcs_revision", "vcs_time", "vcs_modified"]);
	const buildId = sha256(build.id, "capabilities.build.id");
	nonempty(build.go_version, "capabilities.build.go_version");
	for (const field of ["module_version", "vcs", "vcs_revision", "vcs_time"] as const) text(build[field], `capabilities.build.${field}`);
	enumeration(build.vcs_modified, ["true", "false", "unknown"] as const, "capabilities.build.vcs_modified");

	const executable = exactRecord(body.executable, "capabilities.executable", ["sha256", "evidence", "verification"]);
	const selfReportedDigest = sha256(executable.sha256, "capabilities.executable.sha256");
	if (executable.evidence !== "self-reported" || executable.verification !== "compare-with-published-manifest") throw new TypeError("capabilities executable evidence is incompatible");
	const normalizedVerifiedDigest = sha256(verifiedExecutableDigest.startsWith("sha256:") ? verifiedExecutableDigest : `sha256:${verifiedExecutableDigest}`, "verified executable digest");
	if (selfReportedDigest !== normalizedVerifiedDigest) throw new TypeError("review provider executable digest mismatch");

	const advertisedOperations = stringArray(body.operations, "capabilities.operations", { minimum: REQUIRED_OPERATIONS.length, unique: true });
	// Gates and projections are, like operations and schemas, a superset promise
	// rather than an exact manifest: a compatible provider release may advertise
	// an additional gate or projection name beyond the required floor. Decode as
	// a plain string array (not `enumArray` against the known enum) so an
	// unknown addition is not rejected before assertSupersetOf can even run.
	const advertisedGates = stringArray(body.gates, "capabilities.gates", { minimum: REQUIRED_GATES.length, unique: true });
	const advertisedProjections = stringArray(body.projections, "capabilities.projections", { minimum: REQUIRED_PROJECTIONS.length, unique: true });
	const advertisedSchemas = stringArray(body.schemas, "capabilities.schemas", { minimum: REQUIRED_SCHEMAS.length, unique: true });
	assertSupersetOf(advertisedOperations, REQUIRED_OPERATIONS, "capabilities operations");
	assertSupersetOf(advertisedGates, REQUIRED_GATES, "capabilities gates");
	assertSupersetOf(advertisedProjections, REQUIRED_PROJECTIONS, "capabilities projections");
	assertSupersetOf(advertisedSchemas, REQUIRED_SCHEMAS, "capabilities schemas");

	const features = exactRecord(body.features, "capabilities.features", ["mandatory", "optional"]);
	const mandatory = array(features.mandatory, "capabilities.features.mandatory", (entry, label) => decodeFeature(entry, label), { minimum: 10 });
	const optional = array(features.optional, "capabilities.features.optional", (entry, label) => decodeOptionalFeature(entry, label), { minimum: 17, unique: true });
	const mandatoryNames = mandatory.map((feature) => feature.name);
	const optionalNames = optional.map((feature) => feature.name);
	assertExactSet(mandatoryNames, REQUIRED_MANDATORY_FEATURES, "mandatory capabilities");
	if (new Set(optionalNames).size !== optionalNames.length) throw new TypeError("optional capabilities contain duplicate names");
	if (optionalNames.some((name) => mandatoryNames.includes(name as ReviewFeatureV2["name"]))) throw new TypeError("mandatory and optional capabilities overlap");
	if (mandatory.some((feature) => !feature.supported)) throw new TypeError("mandatory capability is unsupported");

	const compatibility = exactRecord(body.compatibility, "capabilities.compatibility", ["minimum_protocol_major", "maximum_protocol_major", "additive_minor_policy", "unknown_mandatory", "unknown_optional", "modes", "legacy_window"]);
	if (compatibility.minimum_protocol_major !== 2 || compatibility.maximum_protocol_major !== 2 || compatibility.additive_minor_policy !== "optional-fields-only" || compatibility.unknown_mandatory !== "reject" || compatibility.unknown_optional !== "ignore") {
		throw new TypeError("incompatible capability evolution policy");
	}
	const modes = enumArray(compatibility.modes, Object.values(REVIEW_AUTHORITY_VERSION), "capabilities.compatibility.modes", { minimum: 2, maximum: 2 });
	if (modes[0] !== REVIEW_AUTHORITY_VERSION.COMPACT_V2 || modes[1] !== REVIEW_AUTHORITY_VERSION.LEGACY_V1) throw new TypeError("capabilities compatibility modes are out of order");
	const legacyWindow = exactRecord(compatibility.legacy_window, "capabilities.compatibility.legacy_window", ["mode", "state", "read_only", "deprecation_started", "removal", "minimum_compatibility_releases"]);
	if (legacyWindow.mode !== REVIEW_AUTHORITY_VERSION.LEGACY_V1) throw new TypeError("capabilities legacy window mode is incompatible");
	enumeration(legacyWindow.state, ["pre-fence", "active", "deprecated", "expired"] as const, "capabilities.compatibility.legacy_window.state");
	boolean(legacyWindow.read_only, "capabilities.compatibility.legacy_window.read_only");
	boolean(legacyWindow.deprecation_started, "capabilities.compatibility.legacy_window.deprecation_started");
	nonempty(legacyWindow.removal, "capabilities.compatibility.legacy_window.removal");
	integer(legacyWindow.minimum_compatibility_releases, "capabilities.compatibility.legacy_window.minimum_compatibility_releases", 1);

	if (body.bootstrap !== undefined) {
		const bootstrap = exactRecord(body.bootstrap, "capabilities.bootstrap", ["command", "target_selector_variants", "required_feature", "unsupported_outcome", "parent_only"]);
		if (bootstrap.command !== "gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --next-transition") throw new TypeError("capabilities.bootstrap.command is unsupported");
		array(bootstrap.target_selector_variants, "capabilities.bootstrap.target_selector_variants", (entry, label) => {
			const selector = exactRecord(entry, label, ["target_type", "arguments"]);
			enumeration(selector.target_type, ["staged", "base_ref", "workspace_overlay_base_ref", "workspace_overlay_base_tree"] as const, `${label}.target_type`);
			stringArray(selector.arguments, `${label}.arguments`, { minimum: 2 });
			return selector;
		}, { minimum: 4, maximum: 4 });
		if (bootstrap.required_feature !== "native_next_transition") throw new TypeError("capabilities.bootstrap.required_feature is unsupported");
		if (bootstrap.unsupported_outcome !== "unsupported-capability") throw new TypeError("capabilities.bootstrap.unsupported_outcome is unsupported");
		if (bootstrap.parent_only !== true) throw new TypeError("capabilities.bootstrap.parent_only must be true");
	}

	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		packageVersion,
		buildId,
		executableDigest: selfReportedDigest,
		operations: new Set(REQUIRED_OPERATIONS),
		gates: new Set(REQUIRED_GATES),
		projections: new Set(REQUIRED_PROJECTIONS),
		schemas: new Set(REQUIRED_SCHEMAS),
		mandatoryFeatures: new Set(mandatoryNames),
		optionalFeatures: new Set(optional.filter((feature) => feature.supported && (FEATURE_NAMES as readonly string[]).includes(feature.name)).map((feature) => feature.name)),
		raw: body,
	};
}

// ---------------------------------------------------------------------------
// artifact-subject/v2
// ---------------------------------------------------------------------------

function decodeArtifactSubject(value: unknown, label: string): ReviewArtifactSubjectV2 {
	const body = exactRecord(value, label, ["schema", "subject_hash", "lineage_id", "authority_revision", "target_identity", "base_tree", "candidate_tree", "changed_path_manifest_sha256", "lens", "selected_order"], ["correction_target_identity"]);
	if (body.schema !== "gentle-ai.review-artifact-subject/v2") throw new TypeError(`${label}.schema must be gentle-ai.review-artifact-subject/v2`);
	return {
		schema: "gentle-ai.review-artifact-subject/v2",
		subjectHash: sha256(body.subject_hash, `${label}.subject_hash`),
		lineageId: lineage(body.lineage_id, `${label}.lineage_id`),
		authorityRevision: sha256(body.authority_revision, `${label}.authority_revision`),
		targetIdentity: sha256(body.target_identity, `${label}.target_identity`),
		baseTree: gitTree(body.base_tree, `${label}.base_tree`),
		candidateTree: gitTree(body.candidate_tree, `${label}.candidate_tree`),
		changedPathManifestSha256: sha256(body.changed_path_manifest_sha256, `${label}.changed_path_manifest_sha256`),
		lens: enumeration(body.lens, REVIEW_LENSES, `${label}.lens`),
		selectedOrder: integer(body.selected_order, `${label}.selected_order`, 0, 3),
		...(body.correction_target_identity === undefined ? {} : { correctionTargetIdentity: sha256(body.correction_target_identity, `${label}.correction_target_identity`) }),
	};
}

export function decodeReviewArtifactSubjectV2(value: unknown): ReviewArtifactSubjectV2 {
	return decodeArtifactSubject(value, "artifact_subject");
}

function decodeChangedPathEntry(value: unknown, label: string): ChangedPathEntry {
	const body = exactRecord(value, label, ["path", "status", "old_mode", "new_mode", "deleted", "type_changed", "mode_only", "intended_untracked"]);
	return {
		path: nonempty(body.path, `${label}.path`),
		status: enumeration(body.status, ["A", "D", "M", "T"] as const, `${label}.status`),
		oldMode: text(body.old_mode, `${label}.old_mode`, { pattern: /^[0-7]{6}$/ }),
		newMode: text(body.new_mode, `${label}.new_mode`, { pattern: /^[0-7]{6}$/ }),
		deleted: boolean(body.deleted, `${label}.deleted`),
		typeChanged: boolean(body.type_changed, `${label}.type_changed`),
		modeOnly: boolean(body.mode_only, `${label}.mode_only`),
		intendedUntracked: boolean(body.intended_untracked, `${label}.intended_untracked`),
	};
}

// ---------------------------------------------------------------------------
// start/v3
// ---------------------------------------------------------------------------

export function decodeReviewStartV3(value: unknown): ReviewStartV3 {
	const overlayFields = ["target_mode", "target_identity", "base_tree", "candidate_tree"] as const;
	const body = exactRecord(value, "start", [
		"schema", "contract", "operation", "action", "lenses_required", "lineage_id", "state", "risk_level",
		"selected_lenses", "projection", "changed_files", "changed_lines", "correction_budget", "risk_reasons", "artifact_subjects",
	], [...overlayFields, "changed_path_manifest", "repository_context"]);
	requireIdentity(body, "gentle-ai.review-integration.start/v3", REVIEW_INTEGRATION_OPERATION.START);

	// dependentRequired binds base_tree<->candidate_tree bidirectionally, and
	// separately binds target_mode<->target_identity bidirectionally with both
	// requiring base_tree+candidate_tree. The two pairs are independent: a
	// selected_lenses START can carry base_tree/candidate_tree without ever
	// carrying target_mode/target_identity.
	if ((body.base_tree === undefined) !== (body.candidate_tree === undefined)) throw new TypeError("start.base_tree and start.candidate_tree must appear together");
	const baseTree = body.base_tree === undefined ? undefined : gitTree(body.base_tree, "start.base_tree");
	const candidateTree = body.candidate_tree === undefined ? undefined : gitTree(body.candidate_tree, "start.candidate_tree");

	if ((body.target_mode === undefined) !== (body.target_identity === undefined)) throw new TypeError("start.target_mode and start.target_identity must appear together");
	if (body.target_mode !== undefined && (baseTree === undefined || candidateTree === undefined)) throw new TypeError("start.target_mode and start.target_identity require base_tree and candidate_tree");
	const targetMode = body.target_mode === undefined ? undefined : enumeration(body.target_mode, ["base-workspace-overlay"] as const, "start.target_mode");
	const targetIdentity = body.target_identity === undefined ? undefined : sha256(body.target_identity, "start.target_identity");

	if (body.changed_path_manifest !== undefined && (baseTree === undefined || candidateTree === undefined)) {
		throw new TypeError("start.changed_path_manifest requires base_tree and candidate_tree");
	}

	const action = enumeration(body.action, START_ACTIONS, "start.action");
	const state = enumeration(body.state, Object.values(REVIEW_START_STATE), "start.state");
	const selectedLenses = enumArray(body.selected_lenses, REVIEW_LENSES, "start.selected_lenses", { maximum: 4, unique: true });

	if (selectedLenses.length >= 1 && (body.base_tree === undefined || body.candidate_tree === undefined || body.changed_path_manifest === undefined)) {
		throw new TypeError("start with selected_lenses requires base_tree, candidate_tree, and changed_path_manifest");
	}

	const requiresRepositoryContext = (action === "created" || action === "resumed") && state === REVIEW_START_STATE.REVIEWING;
	if (requiresRepositoryContext && body.repository_context === undefined) throw new TypeError("start.repository_context is required when action is created/resumed and state is reviewing");
	if (!requiresRepositoryContext && body.repository_context !== undefined) throw new TypeError("start.repository_context is only valid when action is created/resumed and state is reviewing");

	let repositoryContext: ReviewRepositoryContextV2 | undefined;
	if (body.repository_context !== undefined) {
		const source = exactRecord(body.repository_context, "start.repository_context", ["capability", "handle", "revision", "target_identity"]);
		if (source.capability !== "review.opaque_repository_context") throw new TypeError("start.repository_context.capability is unsupported");
		repositoryContext = {
			capability: "review.opaque_repository_context",
			handle: text(source.handle, "start.repository_context.handle", { pattern: /^rctx1_[0-9a-f]{64}$/ }),
			revision: sha256(source.revision, "start.repository_context.revision"),
			targetIdentity: sha256(source.target_identity, "start.repository_context.target_identity"),
		};
	}

	const riskReasons = array(body.risk_reasons, "start.risk_reasons", (entry, label): ReviewRiskReasonV2 => {
		const reason = exactRecord(entry, label, ["code"], ["signal", "path", "old_mode", "new_mode"]);
		return {
			code: enumeration(reason.code, RISK_REASON_CODES, `${label}.code`),
			...(reason.signal === undefined ? {} : { signal: enumeration(reason.signal, RISK_SIGNALS, `${label}.signal`) }),
			...(reason.path === undefined ? {} : { path: nonempty(reason.path, `${label}.path`) }),
			...(reason.old_mode === undefined ? {} : { oldMode: text(reason.old_mode, `${label}.old_mode`, { pattern: /^[0-7]{6}$/ }) }),
			...(reason.new_mode === undefined ? {} : { newMode: text(reason.new_mode, `${label}.new_mode`, { pattern: /^[0-7]{6}$/ }) }),
		};
	}, { minimum: 1, unique: true });

	const artifactSubjects = array(body.artifact_subjects, "start.artifact_subjects", (entry, label) => decodeArtifactSubject(entry, label), { maximum: 4 });

	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		action,
		lensesRequired: boolean(body.lenses_required, "start.lenses_required"),
		lineageId: nonempty(body.lineage_id, "start.lineage_id"),
		state,
		riskLevel: enumeration(body.risk_level, RISK_LEVELS, "start.risk_level"),
		selectedLenses,
		projection: enumeration(body.projection, REQUIRED_PROJECTIONS, "start.projection"),
		changedFiles: integer(body.changed_files, "start.changed_files"),
		changedLines: integer(body.changed_lines, "start.changed_lines"),
		correctionBudget: integer(body.correction_budget, "start.correction_budget", 0, 200),
		riskReasons,
		artifactSubjects,
		...(targetMode === undefined ? {} : { targetMode }),
		...(targetIdentity === undefined ? {} : { targetIdentity }),
		...(baseTree === undefined ? {} : { baseTree }),
		...(candidateTree === undefined ? {} : { candidateTree }),
		...(body.changed_path_manifest === undefined ? {} : { changedPathManifest: array(body.changed_path_manifest, "start.changed_path_manifest", decodeChangedPathEntry, { unique: true }) }),
		...(repositoryContext === undefined ? {} : { repositoryContext }),
		raw: body,
	};
}

// ---------------------------------------------------------------------------
// projection/v1 — reused verbatim; the v2 capabilities schema still advertises
// gentle-ai.review-integration.projection/v1, so renaming this decoder would
// be the same kind of lie the module rename is meant to remove.
// ---------------------------------------------------------------------------

export function decodeReviewProjectionV1(value: unknown): ReviewProjectionDescriptorV1 {
	const projection = exactRecord(value, "status.projection", ["schema", "kind", "projection", "base_tree", "initial_review_tree", "current_candidate_tree", "paths_digest", "paths", "intended_untracked", "intended_untracked_proof", "initial_snapshot_identity", "current_snapshot_identity"]);
	if (projection.schema !== "gentle-ai.review-integration.projection/v1") throw new TypeError("status.projection schema is incompatible");
	return {
		schema: "gentle-ai.review-integration.projection/v1",
		kind: enumeration(projection.kind, Object.values(REVIEW_PROJECTION_KIND), "status.projection.kind"),
		projection: enumeration(projection.projection, REQUIRED_PROJECTIONS, "status.projection.projection"),
		baseTree: gitTree(projection.base_tree, "status.projection.base_tree"),
		initialReviewTree: gitTree(projection.initial_review_tree, "status.projection.initial_review_tree"),
		currentCandidateTree: gitTree(projection.current_candidate_tree, "status.projection.current_candidate_tree"),
		pathsDigest: sha256(projection.paths_digest, "status.projection.paths_digest"),
		paths: array(projection.paths, "status.projection.paths", safePath, { unique: true }),
		intendedUntracked: array(projection.intended_untracked, "status.projection.intended_untracked", safePath, { unique: true }),
		intendedUntrackedProof: sha256(projection.intended_untracked_proof, "status.projection.intended_untracked_proof"),
		initialSnapshotIdentity: sha256(projection.initial_snapshot_identity, "status.projection.initial_snapshot_identity"),
		currentSnapshotIdentity: sha256(projection.current_snapshot_identity, "status.projection.current_snapshot_identity"),
	};
}

// ---------------------------------------------------------------------------
// authority-repair-assessment/v1 — net-new. Consumed as status.repair AND
// repair.assessment.
// ---------------------------------------------------------------------------

function decodeAuthorityRepairAssessmentCounts(value: unknown, label: string): AuthorityRepairAssessmentCountsV1 {
	const body = exactRecord(value, label, ["lineages", "compact_lineages", "legacy_lineages", "events", "bytes", "eligible_candidates", "unsupported_lineages", "conflicts"]);
	return {
		lineages: integer(body.lineages, `${label}.lineages`, 0, 256),
		compactLineages: integer(body.compact_lineages, `${label}.compact_lineages`, 0, 256),
		legacyLineages: integer(body.legacy_lineages, `${label}.legacy_lineages`, 0, 256),
		events: integer(body.events, `${label}.events`, 0, 1024),
		bytes: integer(body.bytes, `${label}.bytes`, 0, 8_388_608),
		eligibleCandidates: integer(body.eligible_candidates, `${label}.eligible_candidates`, 0, 256),
		unsupportedLineages: integer(body.unsupported_lineages, `${label}.unsupported_lineages`, 0, 1024),
		conflicts: integer(body.conflicts, `${label}.conflicts`, 0, 1024),
	};
}

export function decodeAuthorityRepairAssessmentV1(value: unknown): AuthorityRepairAssessmentV1 {
	const label = "assessment";
	const body = exactRecord(value, label, ["schema", "status", "counts", "supported_operations", "authorization_schema"], ["class", "cause", "disposition", "repository_binding", "candidate"]);
	if (body.schema !== "gentle-ai.review-authority-repair-assessment/v1") throw new TypeError(`${label}.schema must be gentle-ai.review-authority-repair-assessment/v1`);
	const status = enumeration(body.status, ["eligible", "unsupported", "ambiguous", "conflicting", "truncated"] as const, `${label}.status`);

	const eligibleFields = ["class", "cause", "disposition", "repository_binding", "candidate"] as const;
	const eligiblePresent = eligibleFields.filter((field) => body[field] !== undefined);
	if (status === "eligible") {
		if (eligiblePresent.length !== eligibleFields.length) throw new TypeError(`${label} eligible status requires class, cause, disposition, repository_binding, and candidate`);
	} else if (eligiblePresent.length > 0) {
		throw new TypeError(`${label} non-eligible status cannot expose class, cause, disposition, repository_binding, or candidate`);
	}
	if (body.class !== undefined && body.class !== "legacy_v1_historical_alias") throw new TypeError(`${label}.class is unsupported`);
	if (body.cause !== undefined && body.cause !== "unsupported_historical_v1_operation_alias") throw new TypeError(`${label}.cause is unsupported`);
	if (body.disposition !== undefined && body.disposition !== "quarantine-approved-historical-alias") throw new TypeError(`${label}.disposition is unsupported`);

	let candidate: AuthorityRepairAssessmentCandidateV1 | undefined;
	if (body.candidate !== undefined) {
		const source = exactRecord(body.candidate, `${label}.candidate`, ["lineage_id", "revision", "chain_identity", "event_count", "alias_event_count", "operations"]);
		candidate = {
			lineageId: lineage(source.lineage_id, `${label}.candidate.lineage_id`),
			revision: sha256(source.revision, `${label}.candidate.revision`),
			chainIdentity: sha256(source.chain_identity, `${label}.candidate.chain_identity`),
			eventCount: integer(source.event_count, `${label}.candidate.event_count`, 2, 1024),
			aliasEventCount: integer(source.alias_event_count, `${label}.candidate.alias_event_count`, 1, 1024),
			operations: enumArray(source.operations, ["review/complete-fix", "review/validate-fix"] as const, `${label}.candidate.operations`, { minimum: 1, maximum: 2, unique: true }),
		};
	}

	const counts = decodeAuthorityRepairAssessmentCounts(body.counts, `${label}.counts`);
	if (status === "eligible" && (counts.eligibleCandidates !== 1 || counts.unsupportedLineages !== 0 || counts.conflicts !== 0)) {
		throw new TypeError(`${label}.counts is incompatible with eligible status`);
	}

	const supportedOperations = array(body.supported_operations, `${label}.supported_operations`, (entry, entryLabel) => enumeration(entry, ["review/complete-fix", "review/validate-fix"] as const, entryLabel), { minimum: 2, maximum: 2 });
	if (supportedOperations[0] !== "review/complete-fix" || supportedOperations[1] !== "review/validate-fix") throw new TypeError(`${label}.supported_operations is out of order`);
	if (body.authorization_schema !== "gentle-ai.review-repair-authorization/v1") throw new TypeError(`${label}.authorization_schema must be gentle-ai.review-repair-authorization/v1`);

	return {
		schema: "gentle-ai.review-authority-repair-assessment/v1",
		status,
		...(body.class === undefined ? {} : { class: "legacy_v1_historical_alias" as const }),
		...(body.cause === undefined ? {} : { cause: "unsupported_historical_v1_operation_alias" as const }),
		...(body.disposition === undefined ? {} : { disposition: "quarantine-approved-historical-alias" as const }),
		...(body.repository_binding === undefined ? {} : { repositoryBinding: sha256(body.repository_binding, `${label}.repository_binding`) }),
		...(candidate === undefined ? {} : { candidate }),
		counts,
		supportedOperations: supportedOperations as readonly ["review/complete-fix", "review/validate-fix"],
		authorizationSchema: "gentle-ai.review-repair-authorization/v1",
	};
}

// ---------------------------------------------------------------------------
// targeted-validation-request/v1 — reused for status.validation_request,
// operation.result.validation_request, and next_transition collect inputs.
// ---------------------------------------------------------------------------

function decodeTargetedValidationRequestV1(value: unknown, label: string): ReviewTargetedValidationRequestV1 {
	const body = exactRecord(value, label, ["schema", "request_hash", "lineage_id", "expected_revision", "target_identity", "fix_finding_ids", "projection", "correction_candidate_tree", "correction_target_identity", "correction_paths", "correction_paths_digest"]);
	if (body.schema !== "gentle-ai.review-targeted-validation-request/v1") throw new TypeError(`${label}.schema must be gentle-ai.review-targeted-validation-request/v1`);
	return {
		schema: "gentle-ai.review-targeted-validation-request/v1",
		requestHash: sha256(body.request_hash, `${label}.request_hash`),
		lineageId: lineage(body.lineage_id, `${label}.lineage_id`),
		expectedRevision: sha256(body.expected_revision, `${label}.expected_revision`),
		targetIdentity: sha256(body.target_identity, `${label}.target_identity`),
		fixFindingIds: stringArray(body.fix_finding_ids, `${label}.fix_finding_ids`, { minimum: 1, unique: true }),
		projection: enumeration(body.projection, REQUIRED_PROJECTIONS, `${label}.projection`),
		correctionCandidateTree: gitTree(body.correction_candidate_tree, `${label}.correction_candidate_tree`),
		correctionTargetIdentity: sha256(body.correction_target_identity, `${label}.correction_target_identity`),
		correctionPaths: stringArray(body.correction_paths, `${label}.correction_paths`, { minimum: 1, unique: true }),
		correctionPathsDigest: sha256(body.correction_paths_digest, `${label}.correction_paths_digest`),
	};
}

// ---------------------------------------------------------------------------
// next-transition/v3 — net-new; unlike v1's decodeNextTransition (void),
// this decoder returns a typed value so callers can read the manifest-bound
// collect inputs and the execute binding.
// ---------------------------------------------------------------------------

const NEXT_TRANSITION_OPERATIONS = ["review.start", "review.finalize", "review.recover", "review.repair", "review.validate"] as const;

function decodeTransitionArguments(value: unknown, label: string): readonly ReviewTransitionArgumentV3[] {
	return array(value, label, (entry, entryLabel) => {
		const argument = exactRecord(entry, entryLabel, ["name", "value"], ["token"]);
		const name = text(argument.name, `${entryLabel}.name`, { minimum: 1, pattern: /^[a-z0-9_-]+$/ });
		const argumentValue = text(argument.value, `${entryLabel}.value`, { minimum: 1 });
		const token = argument.token === undefined ? undefined : text(argument.token, `${entryLabel}.token`, { minimum: 1 });
		return { name, value: argumentValue, ...(token === undefined ? {} : { token }) };
	});
}

function decodeCollectInput(value: unknown, label: string): ReviewCollectInputV3 {
	const input = exactRecord(value, label, ["name", "schema", "capture_operation", "arguments"], ["artifact_subject", "base_tree", "candidate_tree", "changed_path_manifest", "validation_request"]);
	const name = text(input.name, `${label}.name`, { minimum: 1, pattern: /^[a-z0-9_]+$/ });
	const schema = nonempty(input.schema, `${label}.schema`);
	const captureOperation = nonempty(input.capture_operation, `${label}.capture_operation`);
	const argumentsList = decodeTransitionArguments(input.arguments, `${label}.arguments`);

	if (captureOperation === "external.run_targeted_validation") {
		if (input.validation_request === undefined) throw new TypeError(`${label}.validation_request is required`);
		if (schema !== "gentle-ai.review-targeted-validation-request/v1") throw new TypeError(`${label}.schema must be gentle-ai.review-targeted-validation-request/v1`);
	} else if (input.validation_request !== undefined) {
		throw new TypeError(`${label}.validation_request is only valid for external.run_targeted_validation`);
	}

	if (captureOperation === "review.capture-result") {
		if (input.artifact_subject === undefined || input.base_tree === undefined || input.candidate_tree === undefined || input.changed_path_manifest === undefined) {
			throw new TypeError(`${label} requires artifact_subject, base_tree, candidate_tree, and changed_path_manifest`);
		}
		if (schema !== "https://gentle-ai.dev/schema/review/reviewer/v1") throw new TypeError(`${label}.schema must be https://gentle-ai.dev/schema/review/reviewer/v1`);
	} else if (input.artifact_subject !== undefined || input.base_tree !== undefined || input.candidate_tree !== undefined || input.changed_path_manifest !== undefined) {
		throw new TypeError(`${label} carries capture-result fields without review.capture-result`);
	}

	return {
		name,
		schema,
		captureOperation,
		arguments: argumentsList,
		...(input.artifact_subject === undefined ? {} : { artifactSubject: decodeArtifactSubject(input.artifact_subject, `${label}.artifact_subject`) }),
		...(input.base_tree === undefined ? {} : { baseTree: gitTree(input.base_tree, `${label}.base_tree`) }),
		...(input.candidate_tree === undefined ? {} : { candidateTree: gitTree(input.candidate_tree, `${label}.candidate_tree`) }),
		...(input.changed_path_manifest === undefined ? {} : { changedPathManifest: array(input.changed_path_manifest, `${label}.changed_path_manifest`, decodeChangedPathEntry, { unique: true }) }),
		...(input.validation_request === undefined ? {} : { validationRequest: decodeTargetedValidationRequestV1(input.validation_request, `${label}.validation_request`) }),
	};
}

export function decodeReviewNextTransitionV3(value: unknown): ReviewNextTransitionV3 {
	const transition = exactRecord(value, "next_transition", ["kind", "reason_code"], ["execute", "collect"]);
	const kind = enumeration(transition.kind, ["execute", "collect", "stop"] as const, "next_transition.kind");
	const reasonCode = text(transition.reason_code, "next_transition.reason_code", { minimum: 1, pattern: /^[a-z0-9_]+$/ });

	if (kind === "execute") {
		// `command` is an optional, ready-to-paste rendering of `arguments` (the
		// exact same binding as a single shell-ready string) — observed live
		// against a real v2.2.2 review run but absent from the mirrored fixture,
		// which only exercises the `collect` variant of this envelope. Carried
		// through untyped-but-validated rather than dropped, matching how this
		// module already treats every other provider-owned convenience field.
		// status-v2.schema.json $defs.transition_execution declares optional
		// `command`, `selector_arguments`, AND `artifacts`. Declaring only the
		// first rejected two real transitions -- captured_results_ready carries
		// artifacts, approved_receipt_ready carries selector_arguments -- while
		// every native call had already succeeded and authority had advanced.
		const execute = exactRecord(transition.execute, "next_transition.execute", ["operation", "arguments", "preconditions", "binding"], ["command", "selector_arguments", "artifacts"]);
		const operation = enumeration(execute.operation, NEXT_TRANSITION_OPERATIONS, "next_transition.execute.operation");
		const argumentsList = decodeTransitionArguments(execute.arguments, "next_transition.execute.arguments");
		const preconditions = decodeTransitionArguments(execute.preconditions, "next_transition.execute.preconditions");
		// The schema gives `binding` no declared properties and no required list:
		// it is an OPEN object. Closing it here made Pi stricter than the
		// contract it implements and rejected the provider's repository_context.
		// target_identity stays required because Pi reads it.
		const binding = exactRecord(execute.binding, "next_transition.execute.binding", ["target_identity"], ["lineage_id", "revision"], true);
		const targetIdentity = sha256(binding.target_identity, "next_transition.execute.binding.target_identity");
		const lineageId = binding.lineage_id === undefined ? undefined : lineage(binding.lineage_id, "next_transition.execute.binding.lineage_id");
		const revision = binding.revision === undefined ? undefined : sha256(binding.revision, "next_transition.execute.binding.revision");
		const command = execute.command === undefined ? undefined : nonempty(execute.command, "next_transition.execute.command");
		if (transition.collect !== undefined) throw new TypeError("next_transition.collect is incompatible with execute");
		return { kind, reasonCode, execute: { operation, arguments: argumentsList, preconditions, binding: { targetIdentity, ...(lineageId === undefined ? {} : { lineageId }), ...(revision === undefined ? {} : { revision }) }, ...(command === undefined ? {} : { command }) } };
	}
	if (kind === "collect") {
		const collect = exactRecord(transition.collect, "next_transition.collect", ["inputs"]);
		const inputs = array(collect.inputs, "next_transition.collect.inputs", (entry, label) => decodeCollectInput(entry, label), { minimum: 1 });
		if (transition.execute !== undefined) throw new TypeError("next_transition.execute is incompatible with collect");
		return { kind, reasonCode, collect: { inputs } };
	}
	if (transition.execute !== undefined || transition.collect !== undefined) throw new TypeError("next_transition stop cannot carry a transition");
	return { kind, reasonCode };
}

// ---------------------------------------------------------------------------
// eligibility — decoded for validation, discarded (not exposed on the typed
// status/finalize shapes), matching lib/review-integration-v1.ts's pattern.
// Unlike v1's decoder, this one accepts disposition+binding for BOTH
// review.recover and review.retry_final_verification, matching the mirrored
// status-v2.schema.json action_eligibility definition v2 also $refs.
// ---------------------------------------------------------------------------

const ELIGIBLE_ACTIONS = ["stop", "review.start", "review.finalize", "review.validate", "review.recover", "review.repair", "review.retry_final_verification"] as const;
const FORBIDDEN_ACTIONS = ["review.abandon", "review.finalize", "review.invalidate", "review.quarantine-legacy", "review.reclaim", "review.reconcile-authority", "review.reconcile-authority-batch", "review.recover", "review.repair", "review.retry_final_verification", "review.start", "review.validate"] as const;

function decodeEligibility(value: unknown, label: string): void {
	const eligibility = exactRecord(value, label, ["allowed_actions", "forbidden_actions"]);
	array(eligibility.allowed_actions, `${label}.allowed_actions`, (entry, entryLabel) => {
		const action = exactRecord(entry, entryLabel, ["action", "reason_code", "required_inputs"], ["disposition", "binding"]);
		const selected = enumeration(action.action, ELIGIBLE_ACTIONS, `${entryLabel}.action`);
		text(action.reason_code, `${entryLabel}.reason_code`, { minimum: 1, pattern: /^[a-z0-9_]+$/ });
		array(action.required_inputs, `${entryLabel}.required_inputs`, (input, inputLabel) => text(input, inputLabel, { minimum: 1, pattern: /^[a-z0-9_]+$/ }), { unique: true });
		if (selected === "review.recover" || selected === "review.retry_final_verification") {
			const binding = exactRecord(action.binding, `${entryLabel}.binding`, ["lineage_id", "revision", "target_identity"]);
			enumeration(action.disposition, Object.values(REVIEW_STATUS_ACTION_DISPOSITION), `${entryLabel}.disposition`);
			lineage(binding.lineage_id, `${entryLabel}.binding.lineage_id`);
			sha256(binding.revision, `${entryLabel}.binding.revision`);
			sha256(binding.target_identity, `${entryLabel}.binding.target_identity`);
		} else if (action.disposition !== undefined || action.binding !== undefined) {
			throw new TypeError(`${entryLabel} recovery fields require review.recover or review.retry_final_verification`);
		}
		return action;
	}, { minimum: 1, maximum: 1 });
	array(eligibility.forbidden_actions, `${label}.forbidden_actions`, (entry, entryLabel) => {
		const action = exactRecord(entry, entryLabel, ["action", "reason_code"]);
		enumeration(action.action, FORBIDDEN_ACTIONS, `${entryLabel}.action`);
		text(action.reason_code, `${entryLabel}.reason_code`, { minimum: 1, pattern: /^[a-z0-9_]+$/ });
		return action;
	});
}

function decodeFinalVerificationRetry(value: unknown, label: string): ReviewFinalVerificationRetryV1 {
	const body = exactRecord(value, label, ["incident_schema", "incident_class", "validating_revision", "target_identity", "failed_evidence_hash", "finalize_request_digest"], ["failed_evidence_record_digest"]);
	if (body.incident_schema !== "gentle-ai.review-final-verification-incident/v1") throw new TypeError(`${label}.incident_schema is unsupported`);
	if (body.incident_class !== "procedural_tooling_failure") throw new TypeError(`${label}.incident_class is unsupported`);
	return {
		incidentSchema: "gentle-ai.review-final-verification-incident/v1",
		incidentClass: "procedural_tooling_failure",
		validatingRevision: sha256(body.validating_revision, `${label}.validating_revision`),
		targetIdentity: sha256(body.target_identity, `${label}.target_identity`),
		failedEvidenceHash: sha256(body.failed_evidence_hash, `${label}.failed_evidence_hash`),
		...(body.failed_evidence_record_digest === undefined ? {} : { failedEvidenceRecordDigest: sha256(body.failed_evidence_record_digest, `${label}.failed_evidence_record_digest`) }),
		finalizeRequestDigest: sha256(body.finalize_request_digest, `${label}.finalize_request_digest`),
	};
}

// ---------------------------------------------------------------------------
// status/v3
// ---------------------------------------------------------------------------

export function decodeReviewStatusV3(value: unknown): ReviewStatusV3 {
	const body = exactRecord(value, "status", [
		"schema", "contract", "operation", "applicability", "receipt", "action", "replayability", "target_identity", "projection", "repair", "candidates",
	], ["authority", "frozen", "reconciliation", "action_disposition", "eligibility", "next_transition", "authority_target_identity", "validation_request", "final_verification_retry"]);
	requireIdentity(body, "gentle-ai.review-integration.status/v3", REVIEW_INTEGRATION_OPERATION.STATUS);

	const applicability = enumeration(body.applicability, ["current_target", "unrelated", "ambiguous", "corrupted"] as const, "status.applicability");
	const receiptBody = exactRecord(body.receipt, "status.receipt", ["status"], ["identity"]);
	const receiptStatus = enumeration(receiptBody.status, RECEIPT_STATUSES, "status.receipt.status");
	const receipt: ReviewStatusReceiptV1 = { status: receiptStatus, ...(receiptBody.identity === undefined ? {} : { identity: sha256(receiptBody.identity, "status.receipt.identity") }) };

	let authority: ReviewStatusAuthorityV1 | undefined;
	if (body.authority !== undefined) {
		const source = exactRecord(body.authority, "status.authority", ["version", "lineage_id", "state", "generation", "revision"]);
		authority = {
			version: enumeration(source.version, Object.values(REVIEW_AUTHORITY_VERSION), "status.authority.version"),
			lineageId: lineage(source.lineage_id, "status.authority.lineage_id"),
			state: nonempty(source.state, "status.authority.state"),
			generation: integer(source.generation, "status.authority.generation", 1),
			revision: sha256(source.revision, "status.authority.revision"),
		};
	}
	if (applicability === REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET && authority === undefined) throw new TypeError("current_target status requires authority");
	if (applicability !== REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET && (authority !== undefined || body.frozen !== undefined || body.authority_target_identity !== undefined)) {
		throw new TypeError("non-current status cannot expose authority, frozen, or authority_target_identity");
	}

	let frozen: ReviewStatusFrozenV1 | undefined;
	if (body.frozen !== undefined) {
		const source = exactRecord(body.frozen, "status.frozen", ["tier", "original_changed_lines", "correction_budget"]);
		frozen = {
			tier: enumeration(source.tier, RISK_LEVELS, "status.frozen.tier"),
			originalChangedLines: integer(source.original_changed_lines, "status.frozen.original_changed_lines"),
			correctionBudget: integer(source.correction_budget, "status.frozen.correction_budget", 0, 200),
		};
	}
	if (authority?.version === REVIEW_AUTHORITY_VERSION.COMPACT_V2 && frozen === undefined) throw new TypeError("compact-v2 status requires frozen metadata");
	if (authority?.version === REVIEW_AUTHORITY_VERSION.LEGACY_V1 && (frozen !== undefined || body.authority_target_identity !== undefined)) throw new TypeError("legacy status cannot expose frozen metadata or authority_target_identity");
	if (authority?.version === REVIEW_AUTHORITY_VERSION.LEGACY_V1 && receiptStatus !== "expected_missing" && receiptStatus !== "present") throw new TypeError("legacy status receipt is incompatible");

	const action = enumeration(body.action, STATUS_ACTIONS, "status.action");
	const actionDisposition = body.action_disposition === undefined ? undefined : enumeration(body.action_disposition, Object.values(REVIEW_STATUS_ACTION_DISPOSITION), "status.action_disposition");
	if ((action === "recover" || action === "retry_final_verification") && actionDisposition === undefined) throw new TypeError(`${action} status requires action_disposition`);
	if (action !== "recover" && action !== "retry_final_verification" && actionDisposition !== undefined) throw new TypeError("status.action_disposition is only valid for the recover or retry_final_verification action");
	if (body.eligibility !== undefined) decodeEligibility(body.eligibility, "status.eligibility");
	const nextTransition = body.next_transition === undefined ? undefined : decodeReviewNextTransitionV3(body.next_transition);
	const replayability = enumeration(body.replayability, Object.values(REVIEW_REPLAYABILITY), "status.replayability");

	let reconciliation: ReviewStatusReconciliationV1 | undefined;
	if (action === "reconcile_finalize") {
		if (body.reconciliation === undefined) throw new TypeError("reconcile_finalize status requires reconciliation");
		const source = exactRecord(body.reconciliation, "status.reconciliation", ["required"]);
		if (source.required !== true) throw new TypeError("status.reconciliation.required must be true");
		if (applicability !== REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET) throw new TypeError("reconcile_finalize status requires current_target applicability");
		if (replayability !== REVIEW_REPLAYABILITY.STATUS_REQUIRED) throw new TypeError("reconcile_finalize status requires status_required replayability");
		reconciliation = { required: true };
	} else if (body.reconciliation !== undefined) {
		throw new TypeError("status.reconciliation is only valid for the reconcile_finalize action");
	}

	let validationRequest: ReviewTargetedValidationRequestV1 | undefined;
	if (body.validation_request !== undefined) {
		if (applicability !== REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET || authority?.state !== "correction_required") {
			throw new TypeError("status.validation_request requires current_target applicability and correction_required authority state");
		}
		validationRequest = decodeTargetedValidationRequestV1(body.validation_request, "status.validation_request");
	}

	let finalVerificationRetry: ReviewFinalVerificationRetryV1 | undefined;
	if (action === "retry_final_verification") {
		if (body.final_verification_retry === undefined) throw new TypeError("retry_final_verification status requires final_verification_retry");
		if (applicability !== REVIEW_AUTHORITY_APPLICABILITY.CURRENT_TARGET || authority?.version !== REVIEW_AUTHORITY_VERSION.COMPACT_V2 || authority?.state !== "escalated") {
			throw new TypeError("retry_final_verification status requires current_target compact-v2 escalated authority");
		}
		if (actionDisposition !== REVIEW_STATUS_ACTION_DISPOSITION.FINAL_VERIFICATION_RETRY) throw new TypeError("retry_final_verification status requires final_verification_retry disposition");
		finalVerificationRetry = decodeFinalVerificationRetry(body.final_verification_retry, "status.final_verification_retry");
	} else if (body.final_verification_retry !== undefined) {
		throw new TypeError("status.final_verification_retry is only valid for the retry_final_verification action");
	}

	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		applicability,
		...(authority === undefined ? {} : { authority }),
		receipt,
		action,
		...(actionDisposition === undefined ? {} : { actionDisposition }),
		replayability,
		...(frozen === undefined ? {} : { frozen }),
		...(reconciliation === undefined ? {} : { reconciliation }),
		targetIdentity: sha256(body.target_identity, "status.target_identity"),
		...(body.authority_target_identity === undefined ? {} : { authorityTargetIdentity: sha256(body.authority_target_identity, "status.authority_target_identity") }),
		projection: decodeReviewProjectionV1(body.projection),
		repair: decodeAuthorityRepairAssessmentV1(body.repair),
		candidates: stringArray(body.candidates, "status.candidates", { unique: true, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }),
		...(nextTransition === undefined ? {} : { nextTransition }),
		...(validationRequest === undefined ? {} : { validationRequest }),
		...(finalVerificationRetry === undefined ? {} : { finalVerificationRetry }),
		raw: body,
	};
}

// ---------------------------------------------------------------------------
// consent/v2 — net-new. The typed per-candidate blocking consent question
// emitted by negotiated v2 START when the caller declared --consent relay.
// ---------------------------------------------------------------------------

function decodeConsentChoice(value: unknown, label: string, answer: "granted" | "declined"): ReviewConsentChoiceV2 {
	const body = exactRecord(value, label, ["answer", "label", "effect", "invocation"]);
	if (body.answer !== answer) throw new TypeError(`${label}.answer must be ${answer}`);
	return {
		answer,
		label: nonempty(body.label, `${label}.label`),
		effect: nonempty(body.effect, `${label}.effect`),
		invocation: text(body.invocation, `${label}.invocation`, { pattern: new RegExp(`^gentle-ai review start --contract gentle-ai\\.review-integration/v2 .* --consent ${answer}$`) }),
	};
}

export function decodeReviewConsentV2(value: unknown): ReviewConsentV2 {
	const body = exactRecord(value, "consent", [
		"schema", "contract", "operation", "action", "blocking", "target_identity", "projection", "risk_level", "changed_files", "changed_lines", "headline", "reason", "value", "risk_evidence", "choices", "off_path",
	]);
	requireIdentity(body, "gentle-ai.review-integration.consent/v2", "review.start");
	if (body.action !== "consent_required") throw new TypeError("consent.action must be consent_required");
	if (body.blocking !== true) throw new TypeError("consent.blocking must be true");

	const targetIdentity = sha256(body.target_identity, "consent.target_identity");
	const choicesArray = body.choices;
	if (!Array.isArray(choicesArray) || choicesArray.length !== 2) throw new TypeError("consent.choices must have exactly 2 items");
	const granted = decodeConsentChoice(choicesArray[0], "consent.choices[0]", "granted");
	const declined = decodeConsentChoice(choicesArray[1], "consent.choices[1]", "declined");
	for (const choice of [granted, declined]) {
		if (!choice.invocation.includes(` --target ${targetIdentity} `)) throw new TypeError(`consent choice ${choice.answer} invocation must bind consent.target_identity`);
	}

	const offPathSource = exactRecord(body.off_path, "consent.off_path", ["note", "command"]);
	if (offPathSource.command !== "gentle-ai review mode disable") throw new TypeError("consent.off_path.command is unsupported");

	return {
		schema: "gentle-ai.review-integration.consent/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.start",
		action: "consent_required",
		blocking: true,
		targetIdentity,
		projection: enumeration(body.projection, REQUIRED_PROJECTIONS, "consent.projection"),
		riskLevel: enumeration(body.risk_level, ["medium", "high"] as const, "consent.risk_level"),
		changedFiles: integer(body.changed_files, "consent.changed_files"),
		changedLines: integer(body.changed_lines, "consent.changed_lines"),
		headline: nonempty(body.headline, "consent.headline"),
		reason: nonempty(body.reason, "consent.reason"),
		value: nonempty(body.value, "consent.value"),
		riskEvidence: stringArray(body.risk_evidence, "consent.risk_evidence"),
		choices: [granted, declined],
		offPath: { note: nonempty(offPathSource.note, "consent.off_path.note"), command: "gentle-ai review mode disable" },
		raw: body,
	};
}

// ---------------------------------------------------------------------------
// failure/v2
// ---------------------------------------------------------------------------

function decodeOptionalSha256(value: unknown, label: string): string {
	if (value === "") return "";
	return sha256(value, label);
}

function decodeFailureBindingRevision(value: unknown, label: string): ReviewFailureBindingRevisionV1 {
	const body = exactRecord(value, label, ["expected", "current"]);
	return { expected: decodeOptionalSha256(body.expected, `${label}.expected`), current: decodeOptionalSha256(body.current, `${label}.current`) };
}

function decodeFailureTargetEvidence(value: unknown, label: string): ReviewFailureTargetEvidenceV1 {
	const evidence = exactRecord(value, label, ["candidate_tree", "paths_digest"]);
	return {
		candidateTree: gitTree(evidence.candidate_tree, `${label}.candidate_tree`),
		pathsDigest: sha256(evidence.paths_digest, `${label}.paths_digest`),
	};
}

function decodeFailureScopeChange(value: unknown, label: string): ReviewFailureScopeChangeV1 {
	const scope = exactRecord(value, label, ["expected", "actual", "differing_path_count", "differing_paths_digest", "predecessor_lineage_id", "predecessor_revision", "recovery_operation", "recovery_required_inputs"]);
	if (scope.recovery_operation !== "review.recover") throw new TypeError(`${label}.recovery_operation is unsupported`);
	const recoveryInputs = stringArray(scope.recovery_required_inputs, `${label}.recovery_required_inputs`, { minimum: 6, maximum: 6 });
	const expectedRecoveryInputs = ["predecessor_lineage_id", "expected_predecessor_revision", "successor_lineage_id", "disposition", "reason", "actor"];
	if (recoveryInputs.some((input, index) => input !== expectedRecoveryInputs[index])) throw new TypeError(`${label}.recovery_required_inputs is unsupported`);
	return {
		expected: decodeFailureTargetEvidence(scope.expected, `${label}.expected`),
		actual: decodeFailureTargetEvidence(scope.actual, `${label}.actual`),
		differingPathCount: integer(scope.differing_path_count, `${label}.differing_path_count`, 0, 1_000_000),
		differingPathsDigest: sha256(scope.differing_paths_digest, `${label}.differing_paths_digest`),
		predecessorLineageId: lineage(scope.predecessor_lineage_id, `${label}.predecessor_lineage_id`),
		predecessorRevision: sha256(scope.predecessor_revision, `${label}.predecessor_revision`),
		recoveryOperation: "review.recover",
		recoveryRequiredInputs: recoveryInputs,
	};
}

// The mirrored gate_context is `oneOf` [scope_change, binding_revision]. v1's
// decoder only ever implemented scope_change; this decoder implements both
// branches so a legitimate binding_revision failure payload is not rejected.
function decodeFailureContext(value: unknown, label: string): ReviewFailureContextV2 {
	const context = exactRecord(value, label, [], ["scope_change", "binding_revision"]);
	const hasScope = context.scope_change !== undefined;
	const hasBinding = context.binding_revision !== undefined;
	if (hasScope === hasBinding) throw new TypeError(`${label} requires exactly one of scope_change or binding_revision`);
	return {
		...(hasScope ? { scopeChange: decodeFailureScopeChange(context.scope_change, `${label}.scope_change`) } : {}),
		...(hasBinding ? { bindingRevision: decodeFailureBindingRevision(context.binding_revision, `${label}.binding_revision`) } : {}),
	};
}

export function decodeReviewFailureV2(value: unknown): ReviewFailureV2 {
	const body = exactRecord(value, "failure", [
		"schema", "contract", "operation", "phase", "code", "message", "mutation_outcome", "authority_applicability", "retry_safe", "replayability", "required_inputs", "next_action",
	], ["lineage_id", "request_digest", "progress_identity", "cause_category", "cause", "context"]);
	requireIdentity(body, "gentle-ai.review-integration.failure/v2");
	const operation = enumeration(body.operation, REQUIRED_OPERATIONS, "failure.operation");

	if (body.progress_identity !== undefined) {
		if (body.lineage_id === undefined || body.request_digest === undefined) throw new TypeError("failure.progress_identity requires lineage_id and request_digest");
		if (operation !== REVIEW_INTEGRATION_OPERATION.REPAIR) throw new TypeError("failure.progress_identity requires operation review.repair");
	}
	if (body.request_digest !== undefined && operation === REVIEW_INTEGRATION_OPERATION.REPAIR && body.progress_identity === undefined) {
		throw new TypeError("failure.request_digest with review.repair requires progress_identity");
	}

	return {
		schema: "gentle-ai.review-integration.failure/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation,
		phase: enumeration(body.phase, ["preflight", "pre_native", "native_running", "native_committed", "reconciliation"] as const, "failure.phase"),
		code: text(body.code, "failure.code", { pattern: /^[a-z0-9]+(?:_[a-z0-9]+)*$/ }),
		message: text(body.message, "failure.message", { minimum: 1, maximum: 240, pattern: /^[^\r\n]+$/ }),
		mutationOutcome: enumeration(body.mutation_outcome, Object.values(REVIEW_MUTATION_OUTCOME), "failure.mutation_outcome"),
		authorityApplicability: enumeration(body.authority_applicability, Object.values(REVIEW_AUTHORITY_APPLICABILITY), "failure.authority_applicability"),
		retrySafe: boolean(body.retry_safe, "failure.retry_safe"),
		replayability: enumeration(body.replayability, Object.values(REVIEW_REPLAYABILITY), "failure.replayability"),
		...(body.lineage_id === undefined ? {} : { lineageId: lineage(body.lineage_id, "failure.lineage_id") }),
		...(body.request_digest === undefined ? {} : { requestDigest: sha256(body.request_digest, "failure.request_digest") }),
		...(body.progress_identity === undefined ? {} : { progressIdentity: sha256(body.progress_identity, "failure.progress_identity") }),
		requiredInputs: enumArray(body.required_inputs, FAILURE_REQUIRED_INPUTS, "failure.required_inputs", { unique: true }),
		nextAction: enumeration(body.next_action, FAILURE_NEXT_ACTIONS, "failure.next_action"),
		...(body.cause_category === undefined ? {} : { causeCategory: text(body.cause_category, "failure.cause_category", { minimum: 1, pattern: /^[a-z0-9]+(?:_[a-z0-9]+)*$/ }) }),
		...(body.cause === undefined ? {} : { cause: text(body.cause, "failure.cause", { minimum: 1, maximum: 4000, pattern: /^[^\r\n]+$/ }) }),
		...(body.context === undefined ? {} : { context: decodeFailureContext(body.context, "failure.context") }),
		raw: body,
	};
}

// ---------------------------------------------------------------------------
// operation/v2
// ---------------------------------------------------------------------------

export function decodeReviewOperationV2(value: unknown): ReviewOperationV2 {
	const body = exactRecord(value, "operation", ["schema", "contract", "operation", "result"]);
	requireIdentity(body, "gentle-ai.review-integration.operation/v2");
	const operation = enumeration(body.operation, ["review.finalize", "review.validate", "review.bind_sdd", "review.retry_final_verification"] as const, "operation.operation");
	let result: Record<string, unknown>;
	if (operation === REVIEW_INTEGRATION_OPERATION.FINALIZE) {
		result = exactRecord(body.result, "operation.result", ["operation", "lineage_id", "state", "action", "store_revision"], ["eligibility", "next_transition", "validation_request", "escalation"]);
		if (result.operation !== "review/finalize") throw new TypeError("operation.result does not match review.finalize");
		nonempty(result.lineage_id, "operation.result.lineage_id");
		nonempty(result.state, "operation.result.state");
		nonempty(result.action, "operation.result.action");
		sha256(result.store_revision, "operation.result.store_revision");
		if (result.eligibility !== undefined) decodeEligibility(result.eligibility, "operation.result.eligibility");
		if (result.next_transition !== undefined) decodeReviewNextTransitionV3(result.next_transition);
		if (result.validation_request !== undefined) {
			decodeTargetedValidationRequestV1(result.validation_request, "operation.result.validation_request");
			if (result.state !== "correction_required") throw new TypeError("operation.result.validation_request requires state correction_required");
		}
		if (result.escalation !== undefined) nonempty(result.escalation, "operation.result.escalation");
	} else if (operation === REVIEW_INTEGRATION_OPERATION.VALIDATE) {
		result = exactRecord(body.result, "operation.result", ["schema", "result", "allowed", "action", "reason", "context"], ["delivery"]);
		if (result.schema !== "gentle-ai.review-gate-result/v1") throw new TypeError("operation.result does not match review.validate");
		enumeration(result.result, ["allow", "scope-changed", "invalidated", "escalated"] as const, "operation.result.result");
		boolean(result.allowed, "operation.result.allowed");
		nonempty(result.action, "operation.result.action");
		nonempty(result.reason, "operation.result.reason");
		record(result.context, "operation.result.context");
		if (result.delivery !== undefined && result.delivery !== "disabled/unmanaged") throw new TypeError("operation.result.delivery is unsupported");
	} else if (operation === REVIEW_INTEGRATION_OPERATION.BIND_SDD) {
		result = exactRecord(body.result, "operation.result", ["schema", "revision", "change", "lineage", "authority_revision", "receipt_hash", "gate_context"]);
		if (result.schema !== "gentle-ai.sdd-review-binding/v1") throw new TypeError("operation.result does not match review.bind_sdd");
		sha256(result.revision, "operation.result.revision");
		nonempty(result.change, "operation.result.change");
		nonempty(result.lineage, "operation.result.lineage");
		sha256(result.authority_revision, "operation.result.authority_revision");
		sha256(result.receipt_hash, "operation.result.receipt_hash");
		record(result.gate_context, "operation.result.gate_context");
	} else {
		result = exactRecord(body.result, "operation.result", ["operation", "predecessor_lineage_id", "predecessor_revision", "lineage_id", "state", "store_revision", "target_identity", "incident_digest", "recovery_disposition"]);
		if (result.operation !== "review.retry_final_verification") throw new TypeError("operation.result does not match review.retry_final_verification");
		lineage(result.predecessor_lineage_id, "operation.result.predecessor_lineage_id");
		sha256(result.predecessor_revision, "operation.result.predecessor_revision");
		lineage(result.lineage_id, "operation.result.lineage_id");
		if (result.state !== "validating") throw new TypeError("operation.result.state must be validating");
		sha256(result.store_revision, "operation.result.store_revision");
		sha256(result.target_identity, "operation.result.target_identity");
		sha256(result.incident_digest, "operation.result.incident_digest");
		if (result.recovery_disposition !== "final_verification_retry") throw new TypeError("operation.result.recovery_disposition must be final_verification_retry");
	}
	return { contract: REVIEW_INTEGRATION_CONTRACT, operation, result, raw: body };
}

// ---------------------------------------------------------------------------
// repair/v2 — net-new. Encodes the two conditional allOf invariants from v1
// repair.schema.json:53-157: execute mode requires execution (and forbids
// provider_inputs / non-empty required_inputs); an eligible preflight
// assessment requires provider_inputs and required_inputs exactly
// [actor, reason, maintainer_authorization] in that order.
// ---------------------------------------------------------------------------

export function decodeReviewRepairV2(value: unknown): ReviewRepairV2 {
	const body = exactRecord(value, "repair", ["schema", "contract", "operation", "mode", "assessment", "required_inputs"], ["provider_inputs", "execution"]);
	requireIdentity(body, "gentle-ai.review-integration.repair/v2", "review.repair");
	const mode = enumeration(body.mode, ["preflight", "execute"] as const, "repair.mode");
	const assessment = decodeAuthorityRepairAssessmentV1(body.assessment);
	const requiredInputs = enumArray(body.required_inputs, ["actor", "reason", "maintainer_authorization"] as const, "repair.required_inputs", { maximum: 3, unique: true });

	if (mode === "execute") {
		if (body.execution === undefined) throw new TypeError("repair execute mode requires execution");
		if (body.provider_inputs !== undefined) throw new TypeError("repair execute mode cannot expose provider_inputs");
		if (requiredInputs.length !== 0) throw new TypeError("repair execute mode requires an empty required_inputs");
	} else if (body.execution !== undefined) {
		throw new TypeError("repair.execution is only valid for execute mode");
	}

	let providerInputs: ReviewRepairProviderInputsV2 | undefined;
	if (mode === "preflight" && assessment.status === "eligible") {
		if (body.provider_inputs === undefined) throw new TypeError("eligible preflight repair requires provider_inputs");
		if (requiredInputs.length !== 3 || requiredInputs[0] !== "actor" || requiredInputs[1] !== "reason" || requiredInputs[2] !== "maintainer_authorization") {
			throw new TypeError("eligible preflight repair requires required_inputs exactly [actor, reason, maintainer_authorization] in order");
		}
		const source = exactRecord(body.provider_inputs, "repair.provider_inputs", ["class", "lineage_id", "expected_revision", "cause", "disposition", "repository_binding", "authorization_schema"]);
		if (source.class !== "legacy_v1_historical_alias") throw new TypeError("repair.provider_inputs.class is unsupported");
		if (source.cause !== "unsupported_historical_v1_operation_alias") throw new TypeError("repair.provider_inputs.cause is unsupported");
		if (source.disposition !== "quarantine-approved-historical-alias") throw new TypeError("repair.provider_inputs.disposition is unsupported");
		if (source.authorization_schema !== "gentle-ai.review-repair-authorization/v1") throw new TypeError("repair.provider_inputs.authorization_schema is unsupported");
		providerInputs = {
			class: "legacy_v1_historical_alias",
			lineageId: lineage(source.lineage_id, "repair.provider_inputs.lineage_id"),
			expectedRevision: sha256(source.expected_revision, "repair.provider_inputs.expected_revision"),
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			repositoryBinding: sha256(source.repository_binding, "repair.provider_inputs.repository_binding"),
			authorizationSchema: "gentle-ai.review-repair-authorization/v1",
		};
	} else if (mode === "preflight") {
		if (body.provider_inputs !== undefined) throw new TypeError("repair.provider_inputs is only valid for an eligible preflight assessment");
		if (requiredInputs.length !== 0) throw new TypeError("non-eligible preflight repair requires an empty required_inputs");
	}

	let execution: ReviewRepairExecutionV2 | undefined;
	if (body.execution !== undefined) {
		const source = exactRecord(body.execution, "repair.execution", ["status", "class", "lineage_id", "revision", "chain_identity", "cause", "disposition", "assessment_digest", "request_digest", "record_identity"]);
		if (source.status !== "committed") throw new TypeError("repair.execution.status must be committed");
		if (source.class !== "legacy_v1_historical_alias") throw new TypeError("repair.execution.class is unsupported");
		if (source.cause !== "unsupported_historical_v1_operation_alias") throw new TypeError("repair.execution.cause is unsupported");
		if (source.disposition !== "quarantine-approved-historical-alias") throw new TypeError("repair.execution.disposition is unsupported");
		execution = {
			status: "committed",
			class: "legacy_v1_historical_alias",
			lineageId: lineage(source.lineage_id, "repair.execution.lineage_id"),
			revision: sha256(source.revision, "repair.execution.revision"),
			chainIdentity: sha256(source.chain_identity, "repair.execution.chain_identity"),
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			assessmentDigest: sha256(source.assessment_digest, "repair.execution.assessment_digest"),
			requestDigest: sha256(source.request_digest, "repair.execution.request_digest"),
			recordIdentity: sha256(source.record_identity, "repair.execution.record_identity"),
		};
	}

	return {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode,
		assessment,
		...(providerInputs === undefined ? {} : { providerInputs }),
		requiredInputs,
		...(execution === undefined ? {} : { execution }),
		raw: body,
	};
}
