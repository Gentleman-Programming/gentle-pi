import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, win32 } from "node:path";
import { promisify } from "node:util";
import { GENTLE_AI_VERSION, PackageLocalGentleAiBinaryMissingError, resolveGentleAiBinary } from "./gentle-ai-binary.ts";
import {
	REVIEW_INTEGRATION_CONTRACT,
	decodeReviewCapabilitiesV2,
	decodeReviewConsentV2,
	decodeReviewFailureV2,
	decodeReviewOperationV2,
	decodeReviewRepairV2,
	decodeReviewStartV3,
	decodeReviewStatusV3,
	type ReviewCapabilitiesV2,
	type ReviewConsentV2,
	type ReviewFailureV2,
	type ReviewRepairV2,
	type ReviewStartState,
	type ReviewStatusV3,
} from "./review-integration-v2.ts";

const execFileAsync = promisify(execFile);

// Negotiated review/status responses can carry a complete authority inventory.
// Keep the production default large enough for that payload while retaining a
// hard 64 MiB ceiling even when GENTLE_PI_REVIEW_MAX_BUFFER_BYTES is set.
export const NATIVE_REVIEW_DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const NATIVE_REVIEW_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const NATIVE_REVIEW_MAX_BUFFER_BYTES_ENV = "GENTLE_PI_REVIEW_MAX_BUFFER_BYTES";
const NATIVE_REVIEW_MAX_BUFFER_CONFIGURATION_HINT = "Inspect native review state before any new START; GENTLE_PI_REVIEW_MAX_BUFFER_BYTES accepts a positive decimal up to 67108864.";

function resolveNativeReviewMaxBufferBytes(environment: NodeJS.ProcessEnv = process.env): number {
	const value = environment[NATIVE_REVIEW_MAX_BUFFER_BYTES_ENV];
	if (value === undefined || !/^[1-9]\d*$/.test(value)) return NATIVE_REVIEW_DEFAULT_MAX_BUFFER_BYTES;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed <= NATIVE_REVIEW_MAX_BUFFER_BYTES
		? parsed
		: NATIVE_REVIEW_DEFAULT_MAX_BUFFER_BYTES;
}

export const NATIVE_REVIEW_OPERATION = {
	VERSION: "version",
	START: "review/start",
	FINALIZE: "review/finalize",
	VALIDATE: "review/validate",
	BIND_SDD: "review/bind-sdd",
	SDD_STATUS: "sdd-status",
	STATUS: "review/status",
	RECLAIM: "review/reclaim",
	RECOVER: "review/recover",
	ABANDON: "review/abandon",
	QUARANTINE_LEGACY: "review/quarantine-legacy",
	RECONCILE_AUTHORITY: "review/reconcile-authority",
	REPAIR_LEGACY_ALIAS: "review/repair-legacy-alias",
	MODE: "review/mode",
	REPAIR: "review/repair",
	CAPTURE_EVIDENCE: "review/capture-evidence",
	CAPTURE_RESULT: "review/capture-result",
} as const;
export type NativeReviewOperation = (typeof NATIVE_REVIEW_OPERATION)[keyof typeof NATIVE_REVIEW_OPERATION];

export const NATIVE_REVIEW_ERROR_CODE = {
	UNAVAILABLE: "unavailable",
	TIMEOUT: "timeout",
	NON_ZERO: "non-zero",
	SIGNAL: "signal",
	UNEXPECTED_STDERR: "unexpected-stderr",
	OUTPUT_LIMIT: "output-limit",
	EMPTY_OUTPUT: "empty-output",
	MALFORMED_JSON: "malformed-json",
	SCHEMA_INCOMPATIBLE: "schema-incompatible",
	IDENTITY_MISMATCH: "identity-mismatch",
	VERSION_INCOMPATIBLE: "version-incompatible",
	CANCELLED: "cancelled",
	PACKAGE_BINARY_MISSING: "package-local-binary-missing",
	UNSUPPORTED_TRANSITION_OPERATION: "unsupported-transition-operation",
} as const;
export type NativeReviewErrorCode = (typeof NATIVE_REVIEW_ERROR_CODE)[keyof typeof NATIVE_REVIEW_ERROR_CODE];

export interface ExecFileRequest { file: string; arguments: readonly string[]; cwd: string; timeoutMs: number | undefined; maxBufferBytes: number; signal?: AbortSignal; }
export interface ExecFileResult { stdout: string; stderr: string; exitCode: number; signal: NodeJS.Signals | null; timedOut: boolean; outputLimitExceeded: boolean; }
export type ExecFileAdapter = (request: ExecFileRequest) => Promise<ExecFileResult>;

export const NATIVE_SDD_ARTIFACT_STORE = {
	OPENSPEC: "openspec",
	ENGRAM: "engram",
	NONE: "none",
} as const;
export type NativeSddArtifactStore = (typeof NATIVE_SDD_ARTIFACT_STORE)[keyof typeof NATIVE_SDD_ARTIFACT_STORE];

export const NATIVE_SDD_ARTIFACT_STATE = {
	MISSING: "missing",
	DONE: "done",
	PARTIAL: "partial",
} as const;
export type NativeSddArtifactState = (typeof NATIVE_SDD_ARTIFACT_STATE)[keyof typeof NATIVE_SDD_ARTIFACT_STATE];

export interface NativeSddArtifactStates {
	proposal: NativeSddArtifactState;
	specs: NativeSddArtifactState;
	design: NativeSddArtifactState;
	tasks: NativeSddArtifactState;
	applyProgress: NativeSddArtifactState;
	verifyReport: NativeSddArtifactState;
	reviewPolicy?: NativeSddArtifactState;
	reviewLedger: NativeSddArtifactState;
	reviewReceipt: NativeSddArtifactState;
	reviewBundle: NativeSddArtifactState;
	reviewContext: NativeSddArtifactState;
	reviewState: NativeSddArtifactState;
}

export interface NativeReviewCli {
	start(request: NativeStartRequest): Promise<NativeStartResult>;
	finalize(request: NativeFinalizeRequest): Promise<NativeFinalizeResult>;
	validate(request: NativeValidateRequest): Promise<NativeValidateResult>;
	bindSdd(request: NativeBindSddRequest): Promise<NativeBindSddResult>;
	sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusResult>;
	reviewStatus(request: NativeReviewStatusRequest): Promise<NativeReviewStatusResult>;
	capabilities?(request?: NativeCapabilitiesRequest): Promise<ReviewCapabilitiesV2>;
	targetStatus?(request: NativeTargetStatusRequest): Promise<ReviewStatusV3>;
	answerConsent?(request: NativeReviewConsentAnswerRequest): Promise<NativeReviewConsentAnswerResult>;
	reclaim?(request: NativeReviewReclaimRequest): Promise<NativeReviewRecoveryResult>;
	recover?(request: NativeReviewRecoverRequest): Promise<NativeReviewRecoveryResult>;
	abandon?(request: NativeReviewAbandonRequest): Promise<NativeReviewRecoveryResult>;
	quarantineLegacy?(request: NativeReviewLegacyQuarantineRequest): Promise<NativeReviewRecoveryResult>;
	reconcileAuthority?(request: NativeReviewReconcileAuthorityRequest): Promise<NativeReviewRecoveryResult>;
	repairLegacyAlias?(request: NativeReviewLegacyAliasRepairRequest): Promise<NativeReviewRecoveryResult>;
	// Net-new negotiated operations (contract v2 only): `review.repair` is
	// advertised in the v2 operation list; `capture-evidence` is the
	// evidence-first correction lifecycle's collection step.
	repair?(request: NativeReviewRepairRequest): Promise<ReviewRepairV2>;
	captureEvidence?(request: NativeReviewCaptureEvidenceRequest): Promise<NativeReviewVerificationEvidenceV2>;
	// `review capture-result`: the FINALIZE capture phase's collection step
	// (Wave 1, #2028 host behavior, Design Decision 1). Optional, exactly like
	// captureEvidence above, since older negotiated clients may not implement it.
	captureResult?(request: NativeReviewCaptureResultRequest): Promise<NativeReviewAdmittedResultManifest>;
	// Dark until a negotiated version reports the `mode` capability true
	// (Design Decision #7, organic-rdd-parity). Plain versioned CLI operation,
	// outside the negotiated review-integration protocol — same shape as
	// reviewStatus/sddStatus/reclaim above.
	reviewMode?(request: NativeReviewModeRequest): Promise<NativeReviewModeResult>;
}

export const NATIVE_REVIEW_MODE_OPERATION = {
	STATUS: "status",
	ENABLE: "enable",
	DISABLE: "disable",
} as const;
export type NativeReviewModeOperation = (typeof NATIVE_REVIEW_MODE_OPERATION)[keyof typeof NATIVE_REVIEW_MODE_OPERATION];

export const NATIVE_REVIEW_MODE_VALUE = {
	UNSET: "",
	ON: "on",
	OFF: "off",
} as const;
export type NativeReviewModeValue = (typeof NATIVE_REVIEW_MODE_VALUE)[keyof typeof NATIVE_REVIEW_MODE_VALUE];

export const NATIVE_REVIEW_MODE_SOURCE = {
	DEFAULT: "default",
	GLOBAL: "global",
	CLONE_LOCAL: "clone_local",
} as const;
export type NativeReviewModeSource = (typeof NATIVE_REVIEW_MODE_SOURCE)[keyof typeof NATIVE_REVIEW_MODE_SOURCE];

export const NATIVE_REVIEW_MODE_SCOPE = {
	GLOBAL: "global",
	CLONE: "clone",
	BOTH: "both",
} as const;
export type NativeReviewModeScope = (typeof NATIVE_REVIEW_MODE_SCOPE)[keyof typeof NATIVE_REVIEW_MODE_SCOPE];

export interface NativeReviewModeRequest {
	cwd: string;
	operation: NativeReviewModeOperation;
	signal?: AbortSignal;
}

export interface NativeReviewModeStatus {
	global: NativeReviewModeValue;
	cloneLocal: NativeReviewModeValue;
	effective: "on" | "off";
	source: NativeReviewModeSource;
	revision?: string;
}

export interface NativeReviewModeResult {
	operation: NativeReviewModeOperation;
	scope: NativeReviewModeScope;
	status: NativeReviewModeStatus;
}

// Exact-match tolerated-stderr allowlist for START only, gated on the `mode`
// capability being true (Design Decision #6, organic-rdd-parity). Byte-exact
// against gentle-ai's headless notice (internal/cli/review_mode.go
// reviewConsentSkippedNotice) written when the switch is on but no interactive
// terminal answered the one-time consent question — which is always true when
// Pi spawns gentle-ai without a TTY. Any other text still fails closed as
// UNEXPECTED_STDERR.
// Each entry is one whole line gentle-ai may write to the console stream while
// still succeeding. The provenance line rides with the skip notice whenever the
// resolved mode source is `default`, so a headless START legitimately emits two
// lines; they are separate Fprintln calls, never one joined string.
export const REVIEW_CONSENT_NOTICES = Object.freeze([
	"Gentle AI reviewed this change without asking, because this session has no terminal to answer on. Run 'gentle-ai review mode disable' to turn reviews off, or 'gentle-ai review mode status' to see the current setting.",
	"Reviews are on by default; this was never explicitly chosen. Run 'gentle-ai review mode enable' to make reviews an explicit choice, or 'gentle-ai review mode disable' to turn them off.",
	"Gentle AI could not read an answer, so it reviewed this change and will ask again next time.",
	"Gentle AI did not recognize that answer, so it reviewed this change and will ask again next time.",
	"Review skipped for this candidate at your request. It will be offered again on the next change.",
]);

// Every non-empty line must be allowlisted. Matching the whole stderr blob as
// one string only worked while exactly one notice could appear; the moment a
// second legitimate line joined it, an otherwise successful START was reported
// as unexpected-stderr.
function stderrIsTolerated(stderr: string, tolerated: readonly string[]): boolean {
	const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	return lines.length > 0 && lines.every((line) => tolerated.includes(line));
}

export const NATIVE_REVIEW_RECOVER_DISPOSITION = ["scope_changed", "invalidated", "escalated"] as const;
export type NativeReviewRecoverDisposition = (typeof NATIVE_REVIEW_RECOVER_DISPOSITION)[number];

export interface NativeReviewReclaimRequest {
	cwd: string;
	lineage: string;
	actor: string;
	reason: string;
	signal?: AbortSignal;
}

export interface NativeReviewRecoverRequest {
	cwd: string;
	predecessorLineage: string;
	expectedPredecessorRevision: string;
	successorLineage: string;
	disposition: NativeReviewRecoverDisposition;
	actor: string;
	reason: string;
	maintainerAuthorization?: string;
	signal?: AbortSignal;
}

export const NATIVE_REVIEW_LEGACY_QUARANTINE = {
	DIAGNOSTIC: "historical findings freeze changed unrelated transaction state",
	DISPOSITION: "quarantine-malformed-freeze-event",
} as const;

export const NATIVE_REVIEW_RECONCILE_ANOMALIES = {
	COMBINED: "unchanged_target,malformed_recovery_authorization",
} as const;

export const NATIVE_REVIEW_LEGACY_ALIAS_REPAIR = {
	DIAGNOSTIC: "unsupported historical v1 operation alias",
	DISPOSITION: "quarantine-approved-historical-alias",
} as const;
export type NativeReviewReconcileAnomalies = (typeof NATIVE_REVIEW_RECONCILE_ANOMALIES)[keyof typeof NATIVE_REVIEW_RECONCILE_ANOMALIES];

export interface NativeReviewAbandonRequest {
	cwd: string;
	lineage: string;
	expectedRevision: string;
	snapshotIdentity: string;
	actor: string;
	reason: string;
	maintainerAuthorization: string;
	signal?: AbortSignal;
}

export interface NativeReviewLegacyQuarantineRequest {
	cwd: string;
	repository: string;
	lineage: string;
	expectedRevision: string;
	diagnostic: (typeof NATIVE_REVIEW_LEGACY_QUARANTINE)["DIAGNOSTIC"];
	disposition: (typeof NATIVE_REVIEW_LEGACY_QUARANTINE)["DISPOSITION"];
	actor: string;
	reason: string;
	maintainerAuthorization: string;
	signal?: AbortSignal;
}

export interface NativeReviewReconcileAuthorityRequest {
	cwd: string;
	predecessorLineage: string;
	expectedPredecessorRevision: string;
	successorLineage: string;
	expectedSuccessorRevision: string;
	actor: string;
	reason: string;
	anomalies?: NativeReviewReconcileAnomalies;
	maintainerAuthorization: string;
	signal?: AbortSignal;
}

export interface NativeReviewLegacyAliasRepairRequest {
	cwd: string;
	repository: string;
	lineage: string;
	expectedRevision: string;
	diagnostic: (typeof NATIVE_REVIEW_LEGACY_ALIAS_REPAIR)["DIAGNOSTIC"];
	disposition: (typeof NATIVE_REVIEW_LEGACY_ALIAS_REPAIR)["DISPOSITION"];
	actor: string;
	reason: string;
	maintainerAuthorization: string;
	signal?: AbortSignal;
}

/** Raw audited native record; Pi relays it verbatim and never reinterprets it. */
export interface NativeReviewRecoveryResult { record: Record<string, unknown>; }

// Net-new negotiated `review.repair` (contract v2). `repair(request)` always
// runs a `--mode preflight` first; only an eligible assessment is ever
// executed, using the exact provider_inputs that assessment published — Pi's
// own NATIVE_REVIEW_LEGACY_ALIAS_REPAIR constants are never a source, only a
// disagreement check (Design Decision #6, migrate-review-integration-v2).
export interface NativeReviewRepairRequest {
	cwd: string;
	actor: string;
	reason: string;
	maintainerAuthorization: string;
	signal?: AbortSignal;
}

// `review capture-evidence` argv and response shape are pinned to a real
// v2.2.2 review run (lineage review-b39d803b68a90767): exactly
// --cwd/--lineage/--target/--expected-revision/--outcome/--input, no
// --contract, and the `gentle-ai.review-verification-evidence/v2` record
// returned directly (not wrapped in an operation/v2 envelope).
export const NATIVE_REVIEW_CAPTURE_OUTCOME = ["passed", "verification_failed", "procedural_tooling_failed"] as const;
export type NativeReviewCaptureOutcome = (typeof NATIVE_REVIEW_CAPTURE_OUTCOME)[number];

// `capture-result` is an additive headless command, NOT a negotiated
// repository operation: it accepts no --contract, and the provider's own
// transition tokens already carry the repository context -- it takes that or
// --cwd, never both. So Pi passes the tokens through verbatim and adds only
// --input. Reconstructing them would mean re-deriving a lineage, revision,
// target, lens slot, and subject hash the provider already issued.
// Added for the v2 finalize transport. `capturedResults` asks the provider to
// discover every manifest it already admitted; `resultArtifactFiles` hands them
// over explicitly in lens order. Both replace the retired `--result`.
export interface NativeReviewFinalizeCapturedResults {
	readonly capturedResults?: boolean;
	readonly resultArtifactFiles?: readonly string[];
}

export interface NativeReviewCaptureResultRequest {
	readonly argumentTokens: readonly string[];
	readonly resultDocument: string;
	// Only for the compatibility path-manifest mode, when the tokens carry no
	// repository context. Supplying both is refused by the provider.
	readonly cwd?: string;
	readonly signal?: AbortSignal;
}

export interface NativeReviewAdmittedResultManifest {
	readonly schema: string;
	readonly subjectHash: string;
	readonly admissionDecision: string;
	readonly lens?: string;
	readonly path?: string;
	readonly reference?: string;
}

export interface NativeReviewCaptureEvidenceRequest {
	cwd: string;
	lineageId: string;
	targetIdentity: string;
	expectedRevision: string;
	outcome: NativeReviewCaptureOutcome;
	evidenceDocument: string;
	signal?: AbortSignal;
}

export interface NativeReviewVerificationEvidenceV2 {
	schema: "gentle-ai.review-verification-evidence/v2";
	version: 2;
	lineageId: string;
	authorityRevision: string;
	targetIdentity: string;
	candidateTree: string;
	pathsDigest: string;
	paths: readonly string[];
	ledgerIds: readonly string[];
	rawPayloadSha256: string;
	rawPayloadBytes: number;
	outcome: NativeReviewCaptureOutcome;
	recordDigest: string;
}

export interface NativeStartRequest { cwd: string; baseRef?: string; committedOnly?: boolean; lineageId?: string; policyPath?: string; focus?: string; targetIdentity?: string; projection?: "workspace" | "staged"; signal?: AbortSignal; }
export const NATIVE_REVIEW_CONSENT_ANSWER = { GRANTED: "granted", DECLINED: "declined" } as const;
export type NativeReviewConsentAnswer = (typeof NATIVE_REVIEW_CONSENT_ANSWER)[keyof typeof NATIVE_REVIEW_CONSENT_ANSWER];
export interface NativeReviewConsentAnswerRequest { cwd: string; consent: ReviewConsentV2; answer: NativeReviewConsentAnswer; signal?: AbortSignal; }
export interface NativeReviewConsentDeclinedResult {
	kind: "declined";
	targetIdentity: string;
	projection: "workspace" | "staged";
	riskLevel: "medium" | "high";
	changedFiles: number;
	changedLines: number;
	consent: "declined_this_candidate";
	raw: Readonly<Record<string, unknown>>;
}
export interface NativeReviewConsentStartedResult { kind: "started"; start: NativeStartResult; }
export type NativeReviewConsentAnswerResult = NativeReviewConsentStartedResult | NativeReviewConsentDeclinedResult;
export interface NativeFinalizeLensResult { lens: string; document: unknown; }
export interface NativeFinalizeRequest extends NativeReviewFinalizeCapturedResults {
	cwd: string;
	lineageId?: string;
	resultFiles?: readonly string[];
	lensResults?: readonly NativeFinalizeLensResult[];
	refuterFile?: string;
	refuterDocument?: unknown;
	correctionLines?: number;
	validationFile?: string;
	validationDocument?: unknown;
	evidenceFile?: string;
	evidenceDocument?: string;
	failed?: boolean;
	signal?: AbortSignal;
}
export interface NativeValidateRequest { cwd: string; gate: string; lineageId?: string; flags?: readonly string[]; signal?: AbortSignal; }
export interface NativeBindSddRequest { cwd: string; change: string; lineage: string; expectedBindingRevision: string; signal?: AbortSignal; }
export interface NativeSddStatusRequest { cwd: string; change: string; signal?: AbortSignal; }
export interface NativeReviewStatusRequest { cwd: string; signal?: AbortSignal; }
export interface NativeCapabilitiesRequest { cwd?: string; signal?: AbortSignal; }
export interface NativeTargetStatusRequest { cwd: string; lineageId?: string; baseRef?: string; projection?: "workspace" | "staged"; signal?: AbortSignal; }
export interface NativeGateContext { lineageId: string; storeRevision: string; raw: Record<string, unknown>; }

export const NATIVE_REVIEW_AUTHORITY_STATUS = {
	CLEAN: "clean",
	ACTIVE: "active",
	APPROVED: "approved",
	ESCALATED: "escalated",
	RESET_IN_PROGRESS: "reset-in-progress",
	SUPERSEDED: "superseded",
	RECOVERED: "recovered",
	SAME_LINEAGE_MIXED_COLLISION: "same-lineage-mixed-collision",
	INVALID: "invalid",
} as const;
export type NativeReviewAuthorityStatus = (typeof NATIVE_REVIEW_AUTHORITY_STATUS)[keyof typeof NATIVE_REVIEW_AUTHORITY_STATUS];

export const NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION = {
	LEGACY_V1: "legacy-v1",
	COMPACT_V2: "compact-v2",
} as const;
export type NativeReviewAuthorityEntryVersion = (typeof NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION)[keyof typeof NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION];

export const NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS = NATIVE_REVIEW_AUTHORITY_STATUS;
export type NativeReviewAuthorityEntryStatus = NativeReviewAuthorityStatus;

export const NATIVE_REVIEW_LOCK_STATUS = {
	OWNED: "owned",
	AMBIGUOUS: "ambiguous",
	// gentle-ai 2.1.8 leaves review-transactions/v2/LOCK behind after ordinary
	// successful operations and inventories it as a released (dead-owner) entry
	// (#184). This stays a closed enum: lock status routes controller blocking
	// behavior, so unknown future statuses must keep failing closed instead of
	// being tolerated like diagnostic-only metadata.
	RELEASED: "released",
} as const;
export type NativeReviewLockStatus = (typeof NATIVE_REVIEW_LOCK_STATUS)[keyof typeof NATIVE_REVIEW_LOCK_STATUS];

export const NATIVE_REVIEW_LOCK_OWNER_SCHEMA = {
	V1: "gentle-ai.review-store-lock/v1",
} as const;
export type NativeReviewLockOwnerSchema = (typeof NATIVE_REVIEW_LOCK_OWNER_SCHEMA)[keyof typeof NATIVE_REVIEW_LOCK_OWNER_SCHEMA];

export interface NativeReviewLockOwner {
	schema: NativeReviewLockOwnerSchema;
	ownerId: string;
	pid: number;
	host: string;
	acquiredAt: string;
}
export const NATIVE_REVIEW_RECOVERY_DISPOSITION = {
	SCOPE_CHANGED: "scope_changed",
	INVALIDATED: "invalidated",
	ESCALATED: "escalated",
} as const;
export type NativeReviewRecoveryDisposition = (typeof NATIVE_REVIEW_RECOVERY_DISPOSITION)[keyof typeof NATIVE_REVIEW_RECOVERY_DISPOSITION];

export interface NativeReviewRecovery {
	predecessorLineageId: string;
	predecessorRevision: string;
	disposition: NativeReviewRecoveryDisposition;
	reason: string;
	actor: string;
	recoveredAt: string;
	maintainerAuthorization?: string;
}
export interface NativeReviewAuthorityEntry {
	version: NativeReviewAuthorityEntryVersion;
	lineageId?: string;
	path: string;
	status: NativeReviewAuthorityEntryStatus;
	state?: string;
	revision?: string;
	snapshotIdentity?: string;
	chainIdentity?: string;
	recovery?: NativeReviewRecovery;
	problems: readonly string[];
}
export interface NativeReviewAuthorityLock {
	version: NativeReviewAuthorityEntryVersion;
	lineageId?: string;
	path: string;
	status: NativeReviewLockStatus;
	owner?: NativeReviewLockOwner;
	problem?: string;
}
export interface NativeReviewAuthorityDiagnostic {
	path: string;
	problem: string;
}
export interface NativeReviewStatusResult {
	repository: string;
	complete: boolean;
	authoritative: boolean;
	status: NativeReviewAuthorityStatus;
	entries: readonly NativeReviewAuthorityEntry[];
	locks: readonly NativeReviewAuthorityLock[];
	diagnostics: readonly NativeReviewAuthorityDiagnostic[];
	raw: Record<string, unknown>;
}
export const NATIVE_START_ACTION = { CREATED: "created", RESUMED: "resumed", REUSE_RECEIPT: "reuse-receipt", BLOCKED_SCOPE_ACTION: "blocked-scope-action" } as const;
export type NativeStartAction = (typeof NATIVE_START_ACTION)[keyof typeof NATIVE_START_ACTION];
export interface NativeStartResult { lineageId: string; state: ReviewStartState; riskLevel: string; selectedLenses: readonly string[]; changedFiles: number; changedLines: number; correctionBudget: number; action: NativeStartAction; lensesRequired: boolean; riskReasons?: readonly Record<string, unknown>[]; raw?: Readonly<Record<string, unknown>>; riskEvidence?: readonly string[]; hint?: string; }
export interface NativeValidateResult { allowed: boolean; result: "allow" | "scope-changed" | "invalidated" | "escalated"; action: string; reason: string; gateContext: NativeGateContext; delivery?: "disabled/unmanaged"; }
export interface NativeFinalizeResult { lineageId: string; state: string; action: string; storeRevision: string; receiptPath?: string; validationRequest?: Readonly<Record<string, unknown>>; escalation?: string; }
export interface NativeBindSddResult {
	revision: string;
	change: string;
	lineage: string;
	authorityRevision: string;
	receiptHash: string;
	gateContext: NativeGateContext;
}
export interface NativeSddStatusResult {
	ready: boolean;
	artifactStore: NativeSddArtifactStore;
	artifacts: NativeSddArtifactStates;
	nextRecommended: string;
	[key: string]: unknown;
}

export function isCanonicalProcessString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

const NATIVE_RISK_LEVEL = ["low", "medium", "high"] as const;

// gentle-ai's negotiated `start/v2` envelope is a closed schema
// (`additionalProperties: false`), so the two projections its plain sibling
// carries cannot be added to it without a new contract version. Both are
// projections of facts `start/v2` already reports as required fields, so a
// negotiated caller reconstructs them here instead of ending up with a worse
// recovery story than a plain one. These are Pi-side renderings of native
// facts, never a claim that the CLI sent them: the `riskEvidence`/`hint`
// capability rows stay dark for every version whose envelope omits them.
//
// Byte-for-byte mirrors of internal/cli/review_mode.go and review_facade.go.
// `reviewConsentEvidencePhrases` is documented there as the single phrasing
// source so its surfaces cannot drift, which makes this a second surface: an
// unrecognized reason code therefore renders nothing rather than guessing, and
// nativeRiskEvidencePhrases is pinned against a gentle-ai fixture in
// tests/native-review-parity.test.ts so a vocabulary change fails loudly.
const REVIEW_EMPTY_CANDIDATE_HINT =
	"the candidate has no pending changes; already-committed work can be reviewed by rerunning review start with --base-ref <commit> naming the base to compare against";
const REVIEW_MEDIUM_RISK_REASON = "this change is not purely passive documentation, so it gets one consolidated review.";
const REVIEW_EMPTY_CONTENT_CODE = "empty_content";
const REVIEW_RISK_SUBJECT_BY_CODE: Readonly<Record<string, string>> = Object.freeze({
	service_token: "service credentials",
	shell_source: "shell scripting",
	process_boundary: "code that starts other processes",
	process_scan_limit: "code that starts other processes",
	executable_mode: "an executable permission change",
	executable_change: "an executable change",
	configuration_change: "a configuration change",
});
const REVIEW_RISK_SUBJECT_BY_SIGNAL: Readonly<Record<string, string>> = Object.freeze({
	auth: "authentication",
	update: "the update path",
	security: "security",
	payments: "payments",
	data_exposure: "data exposure",
	data_loss: "data loss",
	permissions: "permissions",
	shell_process: "shell or process execution",
});
// The Go signal switch has no empty default: every hot_path reason speaks, and
// an unmapped signal degrades to this rather than dropping the path entirely.
const REVIEW_RISK_UNKNOWN_SIGNAL_SUBJECT = "a sensitive area";

interface NativeRiskEvidenceReason {
	readonly code?: string;
	readonly signal?: string;
	readonly path?: string;
}

function nativeRiskEvidenceSubject(reason: NativeRiskEvidenceReason): string {
	const code = typeof reason.code === "string" ? reason.code : "";
	if (code === "hot_path") {
		const signal = typeof reason.signal === "string" ? reason.signal : "";
		return REVIEW_RISK_SUBJECT_BY_SIGNAL[signal] ?? REVIEW_RISK_UNKNOWN_SIGNAL_SUBJECT;
	}
	return REVIEW_RISK_SUBJECT_BY_CODE[code] ?? "";
}

function nativeRiskEvidencePhrase(reason: NativeRiskEvidenceReason): string {
	const path = typeof reason.path === "string" ? reason.path.trim() : "";
	// An empty file is named first and described second. Every other subject
	// reads "<what changed> in <path>", which for a file with no bytes would
	// assert something about content that is not there.
	if (reason.code === REVIEW_EMPTY_CONTENT_CODE) {
		return path === "" ? "" : `${path}, an empty file whose type cannot be determined from its content`;
	}
	const subject = nativeRiskEvidenceSubject(reason);
	if (subject === "" || path === "") return subject;
	return `${subject} in ${path}`;
}

export function nativeRiskEvidencePhrases(riskLevel: string, reasons: readonly NativeRiskEvidenceReason[]): readonly string[] {
	if (riskLevel !== "high" && riskLevel !== "medium") return [];
	const phrases = reasons.map((reason) => nativeRiskEvidencePhrase(reason)).filter((phrase) => phrase !== "");
	return riskLevel === "medium" ? [REVIEW_MEDIUM_RISK_REASON, ...phrases] : phrases;
}
const NATIVE_REVIEW_LENS = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
const NATIVE_FINALIZE_STATE = ["reviewing", "correction_required", "validating", "approved", "escalated"] as const;
const NATIVE_START_ACTION_VALUES = Object.values(NATIVE_START_ACTION);
const NATIVE_GATE_RESULT = ["allow", "scope-changed", "invalidated", "escalated"] as const;
const NATIVE_GATE = ["post-apply", "pre-commit", "pre-push", "pre-pr", "release"] as const;
const NATIVE_SDD_NEXT_ACTION = ["apply", "verify", "remediate", "archive", "review", "resolve-review", "resolve-blockers", "sdd-new", "select-change", "propose", "spec", "design", "tasks"] as const;
const NATIVE_SDD_POST_REVIEW_ACTION = ["verify", "archive"] as const;

// Organic-parity columns (mode, riskEvidence, hint, delivery) stay false on
// every shipped row, including "2.1.11". PI-2 adds the first capability-true
// row (and bumps the triple pin) in one dedicated commit — never one without
// the other. See Design Decision #1 (organic-rdd-parity).
const ORGANIC_PARITY_DARK = { mode: false, riskEvidence: false, hint: false, delivery: false } as const;

export const NATIVE_CLI_CONTRACTS = Object.freeze({
	"2.1.4": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: false, inventory: false, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.5": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.6": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.7": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.8": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: false, quarantineLegacy: false, reconcileAuthority: true, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.9": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.10": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, ...ORGANIC_PARITY_DARK }),
	"2.1.11": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, ...ORGANIC_PARITY_DARK }),
	// First capability-true row, paired with the triple pin bump in this same
	// commit as Design Decision #1 requires.
	//
	// Only two of the four organic-parity columns are lit, because a capability
	// row is a promise and these are the two whose data was proven to reach the
	// negotiated path Pi actually consumes:
	//
	//   mode      `gentle-ai review mode status` answers the review-mode/v1
	//             envelope directly.
	//   delivery  the gate result carries `delivery` ("disabled/unmanaged" when
	//             the kill switch is off), verified against v2.2.0.
	//
	// riskEvidence and hint stay dark deliberately. Both exist in gentle-ai
	// v2.2.0 but only on the PLAIN start envelope; the negotiated
	// `review-integration.start/v2` that NativeReviewCliV216 decodes carries
	// `risk_reasons` instead of `risk_evidence` and omits `hint` entirely.
	// Lighting them would advertise data that cannot arrive. Closing that gap
	// needs the negotiated start envelope extended upstream, which moves a
	// byte-pinned fixture and therefore belongs to a gentle-ai release, not to
	// a Pi capability flip.
	"2.2.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 2.2.1 repeats 2.2.0 because the wire did not move for the lane Pi speaks.
	// v2.2.1 advertises capabilities/v1.5 (protocol minor 5) on
	// review-integration/v1, but the negotiated start envelope is still the
	// closed `start/v2`, so riskEvidence and hint stay dark for the same reason
	// they are dark on 2.2.0. The release does publish a second contract,
	// review-integration/v2, whose `start/v3` carries base/candidate trees --
	// but Pi does not negotiate it yet, and a row must describe the lane in use.
	"2.2.1": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 2.2.2 repeats 2.2.1 for the same reason, confirmed against the released
	// v2.2.2 binary rather than assumed: on review-integration/v1 it still
	// advertises capabilities/v1.5 and the negotiated start envelope is still
	// the closed `start/v2`, so riskEvidence and hint still cannot arrive.
	"2.2.2": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// Ground-truthed against the released v2.2.3 binary: the v2 lane remains
	// protocol 2.0 with the same operation set and closed START fields consumed
	// by Pi, so the existing capability columns are unchanged.
	"2.2.3": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
});
type NativeCliCapability = keyof (typeof NATIVE_CLI_CONTRACTS)[keyof typeof NATIVE_CLI_CONTRACTS];

// Testing-only capability overlay: lets tests exercise mode/riskEvidence/hint/
// delivery decode paths under a synthetic version key without ever making a
// shipped row (including "2.1.11") capability-true. Production code never
// calls the setter, so this is inert outside test files.
const nativeCliContractsTestingOverlay = new Map<string, Record<NativeCliCapability, boolean>>();
export function setNativeCliContractForTesting(version: string, contract: Record<NativeCliCapability, boolean> | undefined): void {
	if (contract === undefined) nativeCliContractsTestingOverlay.delete(version);
	else nativeCliContractsTestingOverlay.set(version, contract);
}
function resolvedNativeCliContract(version: string): Record<NativeCliCapability, boolean> | undefined {
	return nativeCliContractsTestingOverlay.get(version) ?? (NATIVE_CLI_CONTRACTS as Record<string, Record<NativeCliCapability, boolean> | undefined>)[version];
}

export interface NativeReviewStructuredDenial {
	schema: "gentle-ai.review-gate-result/v1";
	result: "scope-changed" | "invalidated" | "escalated";
	action: string;
	reason: string;
	denial?: { stage: string; code: string };
}

export interface NativeReviewProcessDiagnostics {
	operation: NativeReviewOperation;
	error_code: NativeReviewErrorCode;
	exit_code?: number;
	signal?: NodeJS.Signals;
	timed_out: boolean;
	output_limit_exceeded: boolean;
	max_buffer_bytes?: number;
	configuration_hint?: string;
	stderr?: string;
	denial?: NativeReviewStructuredDenial;
}

export class NativeReviewCliError extends Error {
	readonly code: NativeReviewErrorCode;
	readonly operation: NativeReviewOperation;
	readonly launchAttempted: boolean;
	readonly mutating: boolean;
	readonly mutationOutcome: "none" | "unknown";
	readonly nextAction?: "review.status";
	readonly diagnostics: NativeReviewProcessDiagnostics;
	readonly auditRecord?: Record<string, unknown>;
	constructor(code: NativeReviewErrorCode, operation: NativeReviewOperation, launchAttempted: boolean, mutating: boolean, message: string, diagnostics?: NativeReviewProcessDiagnostics, auditRecord?: Record<string, unknown>) {
		super(message);
		this.name = "NativeReviewCliError";
		this.code = code;
		this.operation = operation;
		this.launchAttempted = launchAttempted;
		this.mutating = mutating;
		this.mutationOutcome = launchAttempted && mutating ? "unknown" : "none";
		this.nextAction = this.mutationOutcome === "unknown" ? "review.status" : undefined;
		this.diagnostics = diagnostics ?? { operation, error_code: code, timed_out: false, output_limit_exceeded: false };
		this.auditRecord = auditRecord;
	}
}

export function createNodeExecFileAdapter(): ExecFileAdapter {
	return async (request) => {
		try {
			const output = await execFileAsync(request.file, [...request.arguments], { cwd: request.cwd, encoding: "utf8", shell: false, windowsHide: true, timeout: request.timeoutMs, maxBuffer: request.maxBufferBytes, signal: request.signal });
			return { stdout: output.stdout, stderr: output.stderr, exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		} catch (error) {
			const detail = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number; signal?: NodeJS.Signals; killed?: boolean };
			if (detail.code === "ENOENT" || detail.code === "EACCES" || detail.name === "AbortError") throw error;
			const outputLimitExceeded = detail.code === "ENOBUFS" || detail.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
			return { stdout: detail.stdout ?? "", stderr: detail.stderr ?? "", exitCode: typeof detail.code === "number" ? detail.code : 1, signal: detail.signal ?? null, timedOut: !outputLimitExceeded && detail.killed === true, outputLimitExceeded };
		}
	};
}

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected object");
	return value as Record<string, unknown>;
}
function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	const parsed = object(value);
	const allowed = [...required, ...optional];
	if (required.some((key) => !(key in parsed)) || Object.keys(parsed).some((key) => !allowed.includes(key))) throw new Error("unexpected object shape");
	return parsed;
}
function requiredString(value: unknown): string { if (typeof value !== "string" || value.length === 0) throw new Error("expected string"); return value; }
function stringValue(value: unknown): string { if (typeof value !== "string") throw new Error("expected string"); return value; }
function sha256Identity(value: unknown): string { const parsed = requiredString(value); if (!/^sha256:[0-9a-f]{64}$/.test(parsed)) throw new Error("expected canonical SHA-256 identity"); return parsed; }
function booleanValue(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("expected boolean"); return value; }
function nonNegativeInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("expected safe non-negative integer"); return value; }
function positiveInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("expected safe positive integer"); return value; }
function stringArray(value: unknown): readonly string[] { if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) throw new Error("expected string array"); return value; }
function decodeSelectedLenses(value: unknown, riskLevel: string, lensesRequired: boolean): readonly string[] {
	if (value === null && riskLevel === "low" && !lensesRequired) return [];
	return stringArray(value);
}
function enumString(value: unknown, allowed: readonly string[]): string { const parsed = stringValue(value); if (!allowed.includes(parsed)) throw new Error("unsupported enum"); return parsed; }
const NATIVE_DIAGNOSTIC_TEXT_LIMIT = 4_096;
const NATIVE_REVIEW_DENIAL_TEXT_LIMIT = 1_024;

function sanitizeNativeDiagnosticText(value: string, limit = NATIVE_DIAGNOSTIC_TEXT_LIMIT): string {
	const normalized = value
		.replace(/\x1b](?:[^\x07\x1b]|\x1b(?!\\))*?(?:\x07|\x1b\\)/g, "[REDACTED CONTROL]")
		.replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, "[REDACTED CONTROL]")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "[REDACTED CONTROL]")
		.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED PEM]")
		.replace(/("(?:token|password|secret|api_key|apikey|authorization|cookie|private_key|access_token|github_token|[a-z0-9_-]+_token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[REDACTED]\"")
		.replace(/\b(Bearer)\s+[^\s]+/gi, "$1 [REDACTED]")
		.replace(/\b(token|secret|password|authorization|cookie|private_key|access_token|github_token|[a-z0-9_-]+_token|api[_-]?key)\s*([:=])\s*[^\s]+/gi, "$1$2[REDACTED]")
		.replace(/[\u0000-\u001f\u007f]/g, "");
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 14)}…[truncated]`;
}

function parseStructuredNativeDenial(stdout: string): NativeReviewStructuredDenial | undefined {
	if (Buffer.byteLength(stdout, "utf8") > NATIVE_DIAGNOSTIC_TEXT_LIMIT * 4) return undefined;
	try {
		const value = exactObject(JSON.parse(stdout), ["schema", "result", "allowed", "action", "reason", "context"]);
		const result = enumString(value.result, ["scope-changed", "invalidated", "escalated"] as const) as NativeReviewStructuredDenial["result"];
		const action = sanitizeNativeDiagnosticText(requiredString(value.action), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
		const reason = sanitizeNativeDiagnosticText(requiredString(value.reason), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
		const expectedAction = { "scope-changed": "create-new-lineage", invalidated: "explicit-maintainer-action", escalated: "stop" }[result];
		if (
			value.schema !== "gentle-ai.review-gate-result/v1" ||
			value.allowed !== false ||
			action !== expectedAction ||
			!isCanonicalProcessString(action) ||
			!isCanonicalProcessString(reason)
		) return undefined;
		const context = decodeGateContext(value.context).raw;
		const rawDenial = context.denial;
		const denial = rawDenial === undefined
			? undefined
			: (() => {
				const parsed = exactObject(rawDenial, ["stage", "code"]);
				const stage = sanitizeNativeDiagnosticText(requiredString(parsed.stage), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
				const code = sanitizeNativeDiagnosticText(requiredString(parsed.code), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
				if (!isCanonicalProcessString(stage) || !isCanonicalProcessString(code)) throw new Error("non-canonical denial evidence");
				return { stage, code };
			})();
		return { schema: "gentle-ai.review-gate-result/v1", result, action, reason, ...(denial === undefined ? {} : { denial }) };
	} catch { return undefined; }
}

// Rebuild diagnostics from a duplicated module instance before facade output.
export function sanitizeForeignNativeReviewDiagnostics(value: unknown): NativeReviewProcessDiagnostics | undefined {
	try {
		const raw = exactObject(value, ["operation", "error_code", "timed_out", "output_limit_exceeded"], ["exit_code", "signal", "max_buffer_bytes", "configuration_hint", "stderr", "denial"]);
		const operation = enumString(raw.operation, Object.values(NATIVE_REVIEW_OPERATION)) as NativeReviewOperation;
		const errorCode = enumString(raw.error_code, Object.values(NATIVE_REVIEW_ERROR_CODE)) as NativeReviewErrorCode;
		const signal = raw.signal === undefined ? undefined : requiredString(raw.signal);
		const maxBufferBytes = raw.max_buffer_bytes === undefined ? undefined : positiveInteger(raw.max_buffer_bytes);
		const configurationHint = raw.configuration_hint === undefined ? undefined : stringValue(raw.configuration_hint);
		if (
			(signal !== undefined && !/^SIG[A-Z0-9]{1,12}$/.test(signal)) ||
			(maxBufferBytes === undefined) !== (configurationHint === undefined) ||
			(configurationHint !== undefined && (errorCode !== NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT || configurationHint !== NATIVE_REVIEW_MAX_BUFFER_CONFIGURATION_HINT))
		) return undefined;
		return {
			operation,
			error_code: errorCode,
			...(raw.exit_code === undefined ? {} : { exit_code: nonNegativeInteger(raw.exit_code) }),
			...(signal === undefined ? {} : { signal: signal as NodeJS.Signals }),
			timed_out: booleanValue(raw.timed_out),
			output_limit_exceeded: booleanValue(raw.output_limit_exceeded),
			...(maxBufferBytes === undefined ? {} : { max_buffer_bytes: maxBufferBytes, configuration_hint: configurationHint! }),
			...(raw.stderr === undefined ? {} : { stderr: sanitizeNativeDiagnosticText(stringValue(raw.stderr)) }),
			...(raw.denial === undefined ? {} : { denial: sanitizeForeignStructuredDenial(raw.denial) }),
		};
	} catch { return undefined; }
}

function sanitizeForeignStructuredDenial(value: unknown): NativeReviewStructuredDenial {
	const parsed = exactObject(value, ["schema", "result", "action", "reason"], ["denial"]);
	if (parsed.schema !== "gentle-ai.review-gate-result/v1") throw new Error("invalid denial schema");
	const result = enumString(parsed.result, ["scope-changed", "invalidated", "escalated"] as const) as NativeReviewStructuredDenial["result"];
	const action = sanitizeNativeDiagnosticText(requiredString(parsed.action), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
	const reason = sanitizeNativeDiagnosticText(requiredString(parsed.reason), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
	const expectedAction = { "scope-changed": "create-new-lineage", invalidated: "explicit-maintainer-action", escalated: "stop" }[result];
	if (action !== expectedAction || !isCanonicalProcessString(action) || !isCanonicalProcessString(reason)) throw new Error("non-canonical denial evidence");
	const denial = parsed.denial === undefined ? undefined : (() => { const nested = exactObject(parsed.denial, ["stage", "code"]); const stage = sanitizeNativeDiagnosticText(requiredString(nested.stage), NATIVE_REVIEW_DENIAL_TEXT_LIMIT); const code = sanitizeNativeDiagnosticText(requiredString(nested.code), NATIVE_REVIEW_DENIAL_TEXT_LIMIT); if (!isCanonicalProcessString(stage) || !isCanonicalProcessString(code)) throw new Error("non-canonical denial evidence"); return { stage, code }; })();
	return { schema: "gentle-ai.review-gate-result/v1", result, action, reason, ...(denial === undefined ? {} : { denial }) };
}

function nativeProcessDiagnostics(operation: NativeReviewOperation, code: NativeReviewErrorCode, result?: ExecFileResult, maxBufferBytes?: number): NativeReviewProcessDiagnostics {
	const outputLimitExceeded = result?.outputLimitExceeded === true;
	return {
		operation,
		error_code: code,
		...(result === undefined ? {} : { exit_code: result.exitCode }),
		...(result?.signal === null || result?.signal === undefined ? {} : { signal: result.signal }),
		timed_out: !outputLimitExceeded && result?.timedOut === true,
		output_limit_exceeded: outputLimitExceeded,
		...(code === NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT && maxBufferBytes !== undefined
			? { max_buffer_bytes: maxBufferBytes, configuration_hint: NATIVE_REVIEW_MAX_BUFFER_CONFIGURATION_HINT }
			: {}),
		...(result?.stderr.trim() ? { stderr: sanitizeNativeDiagnosticText(result.stderr) } : {}),
		...(result === undefined ? {} : { denial: parseStructuredNativeDenial(result.stdout) }),
	};
}

function parseJson(stdout: string, operation: NativeReviewOperation, mutating: boolean, diagnostics: NativeReviewProcessDiagnostics): Record<string, unknown> {
	if (stdout.length === 0) throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT, operation, true, mutating, "native command returned empty output", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT });
	try { return object(JSON.parse(stdout)); } catch { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON, operation, true, mutating, "native command returned malformed JSON", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON }); }
}
function decodeNativeMaintenanceResult(value: unknown, expectedOperation: NativeReviewOperation): NativeReviewRecoveryResult {
	const body = exactObject(value, ["operation", "record"]);
	if (body.operation !== expectedOperation) throw new Error("wrong native maintenance discriminator");
	return { record: object(body.record) };
}
function decodeLegacyReconcileAudit(value: unknown): NativeReviewRecoveryResult {
	const record = exactObject(value, ["schema", "predecessor_lineage", "successor_lineage", "outcome"]);
	if (record.schema !== "gentle-ai.review-reconcile-audit/v1") throw new Error("wrong legacy reconcile audit schema");
	for (const field of ["predecessor_lineage", "successor_lineage", "outcome"]) requiredString(record[field]);
	return { record };
}
function decodeNativeReviewVerificationEvidence(value: unknown): NativeReviewVerificationEvidenceV2 {
	const body = exactObject(value, ["schema", "version", "lineage_id", "authority_revision", "target_identity", "candidate_tree", "paths_digest", "paths", "ledger_ids", "raw_payload_sha256", "raw_payload_bytes", "outcome", "record_digest"]);
	if (body.schema !== "gentle-ai.review-verification-evidence/v2") throw new Error("wrong verification evidence schema");
	return {
		schema: "gentle-ai.review-verification-evidence/v2",
		// verification-evidence.schema.json pins `version` to {"const": 2} -- the
		// NUMBER two, not the string. It was written as a string from a handoff
		// that listed the observed field NAMES without their types.
		version: (() => { if (body.version !== 2) throw new Error(`native verification evidence version must be the number 2, received ${JSON.stringify(body.version)}`); return 2 as const; })(),
		lineageId: requiredString(body.lineage_id),
		authorityRevision: requiredString(body.authority_revision),
		targetIdentity: requiredString(body.target_identity),
		candidateTree: requiredString(body.candidate_tree),
		pathsDigest: requiredString(body.paths_digest),
		paths: stringArray(body.paths),
		// The schema requires ledger_ids to be an array, but v2.2.2 emits null when
		// there are none. Tolerated deliberately: refusing here would reject a
		// response the provider actually sends, and the provider violating its own
		// published schema is its defect to fix, not a reason to break the client.
		ledgerIds: body.ledger_ids === null || body.ledger_ids === undefined ? [] : stringArray(body.ledger_ids),
		rawPayloadSha256: requiredString(body.raw_payload_sha256),
		rawPayloadBytes: nonNegativeInteger(body.raw_payload_bytes),
		outcome: enumString(body.outcome, NATIVE_REVIEW_CAPTURE_OUTCOME) as NativeReviewCaptureOutcome,
		recordDigest: requiredString(body.record_digest),
	};
}
// Unimplemented next_transition.execute.operation values must never reach
// argv synthesis. Checked against the raw pre-decode body so an operation
// gentle-pi does not implement (e.g. a future `dispose-result`) fails with a
// named, typed refusal instead of a generic schema-incompatible error, and
// before any client ever tries to build an invocation for it (Design
// Decision #6, migrate-review-integration-v2).
const NATIVE_REVIEW_SUPPORTED_TRANSITION_OPERATIONS = new Set(["review.start", "review.finalize", "review.recover", "review.repair", "review.validate"]);
function assertSupportedNextTransitionOperation(body: Record<string, unknown>): void {
	const nextTransition = body.next_transition;
	if (typeof nextTransition !== "object" || nextTransition === null || Array.isArray(nextTransition)) return;
	const execute = (nextTransition as Record<string, unknown>).execute;
	if (typeof execute !== "object" || execute === null || Array.isArray(execute)) return;
	const operation = (execute as Record<string, unknown>).operation;
	if (typeof operation === "string" && !NATIVE_REVIEW_SUPPORTED_TRANSITION_OPERATIONS.has(operation)) {
		throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNSUPPORTED_TRANSITION_OPERATION, NATIVE_REVIEW_OPERATION.STATUS, false, `unsupported-transition-operation: gentle-pi does not implement the next_transition operation "${operation}"; refusing rather than synthesizing an invocation for it`);
	}
}
function decode<T>(operation: NativeReviewOperation, mutating: boolean, callback: () => T, diagnostics = nativeProcessDiagnostics(operation, NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE)): T {
	try { return callback(); } catch (error) { if (error instanceof NativeReviewCliError) throw error; throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE, operation, true, mutating, "native response is schema incompatible", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE }); }
}
function decodeReleaseEvidence(value: unknown): void {
	const release = exactObject(value, ["release_tree", "configuration_hash", "generated_artifact_hash", "provenance_hash", "publication_boundary_hash", "publication_state", "evidence_freshness_hash", "evidence_freshness_state"]);
	for (const field of ["release_tree", "configuration_hash", "generated_artifact_hash", "provenance_hash", "publication_boundary_hash", "evidence_freshness_hash"]) requiredString(release[field]);
	if (release.publication_state !== "sealed" || release.evidence_freshness_state !== "current") throw new Error("invalid release evidence");
}
function decodeGateContext(value: unknown): NativeGateContext {
	const context = exactObject(
		value,
		["gate", "lineage_id", "generation", "base_tree", "candidate_tree", "paths_digest", "fix_delta_hash", "policy_hash", "ledger_hash", "evidence_hash", "base_relationship_valid"],
		["store_revision", "genesis_revision", "chain_identity", "bundle_digest", "external_evidence", "base_advanced_compatible", "release", "pre_pr_boundary", "denial"],
	);
	const gate = stringValue(context.gate);
	if (gate !== "" && !(NATIVE_GATE as readonly string[]).includes(gate)) throw new Error("invalid gate context gate");
	for (const field of ["lineage_id", "base_tree", "candidate_tree", "paths_digest", "fix_delta_hash", "policy_hash", "ledger_hash", "evidence_hash"]) stringValue(context[field]);
	for (const field of ["store_revision", "genesis_revision", "chain_identity", "bundle_digest"]) if (context[field] !== undefined) stringValue(context[field]);
	nonNegativeInteger(context.generation);
	booleanValue(context.base_relationship_valid);
	if (context.external_evidence !== undefined) enumString(context.external_evidence, ["invalidating", "escalating"]);
	let sanitizedContext = context;
	if (context.denial !== undefined) {
		const denial = exactObject(context.denial, ["stage", "code"]);
		const stage = sanitizeNativeDiagnosticText(requiredString(denial.stage), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
		const code = sanitizeNativeDiagnosticText(requiredString(denial.code), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
		if (!isCanonicalProcessString(stage) || !isCanonicalProcessString(code)) throw new Error("non-canonical denial evidence");
		sanitizedContext = { ...context, denial: { stage, code } };
	}
	if (context.pre_pr_boundary !== undefined) {
		const boundary = exactObject(context.pre_pr_boundary, ["source", "selector", "commit"], ["remote", "remote_ref", "remote_identity"]);
		enumString(boundary.source, ["explicit", "publication-default"]); requiredString(boundary.selector); stringValue(boundary.commit);
		for (const field of ["remote", "remote_ref", "remote_identity"]) if (boundary[field] !== undefined) requiredString(boundary[field]);
	}
	if (context.base_advanced_compatible !== undefined) {
		const proof = exactObject(context.base_advanced_compatible, ["status", "compatible", "old_base_tree", "new_base_tree", "original_patch_identity", "delivered_patch_identity", "delivered_paths_digest", "base_advance_paths_digest", "paths_disjoint", "merged_result_tree", "ci_attestation_artifact_hash", "ci_attestation_issuer", "ci_status"]);
		for (const field of ["status", "old_base_tree", "new_base_tree", "original_patch_identity", "delivered_patch_identity", "delivered_paths_digest", "base_advance_paths_digest", "merged_result_tree", "ci_attestation_artifact_hash", "ci_attestation_issuer", "ci_status"]) requiredString(proof[field]);
		booleanValue(proof.compatible); booleanValue(proof.paths_disjoint);
	}
	if (context.release !== undefined) decodeReleaseEvidence(context.release);
	return {
		lineageId: stringValue(context.lineage_id),
		storeRevision: context.store_revision === undefined ? "" : stringValue(context.store_revision),
		raw: sanitizedContext,
	};
}
function decodeNativeReviewRecovery(value: unknown): NativeReviewRecovery {
	const recovery = exactObject(value, ["predecessor_lineage_id", "predecessor_revision", "disposition", "reason", "actor", "recovered_at"], ["maintainer_authorization"]);
	return {
		predecessorLineageId: requiredString(recovery.predecessor_lineage_id),
		predecessorRevision: requiredString(recovery.predecessor_revision),
		disposition: enumString(recovery.disposition, Object.values(NATIVE_REVIEW_RECOVERY_DISPOSITION)) as NativeReviewRecoveryDisposition,
		reason: requiredString(recovery.reason),
		actor: requiredString(recovery.actor),
		recoveredAt: requiredString(recovery.recovered_at),
		...(recovery.maintainer_authorization === undefined ? {} : { maintainerAuthorization: requiredString(recovery.maintainer_authorization) }),
	};
}
function decodeNativeReviewStatusEntry(value: unknown): NativeReviewAuthorityEntry {
	const entry = exactObject(value, ["version", "path", "status", "problems"], ["lineage_id", "state", "revision", "snapshot_identity", "chain_identity", "recovery"]);
	return {
		version: enumString(entry.version, Object.values(NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION)) as NativeReviewAuthorityEntryVersion,
		...(entry.lineage_id === undefined ? {} : { lineageId: requiredString(entry.lineage_id) }),
		path: requiredString(entry.path),
		status: enumString(entry.status, Object.values(NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS)) as NativeReviewAuthorityEntryStatus,
		...(entry.state === undefined ? {} : { state: requiredString(entry.state) }),
		...(entry.revision === undefined ? {} : { revision: requiredString(entry.revision) }),
		...(entry.snapshot_identity === undefined ? {} : { snapshotIdentity: sha256Identity(entry.snapshot_identity) }),
		...(entry.chain_identity === undefined ? {} : { chainIdentity: requiredString(entry.chain_identity) }),
		...(entry.recovery === undefined ? {} : { recovery: decodeNativeReviewRecovery(entry.recovery) }),
		problems: stringArray(entry.problems),
	};
}
function decodeNativeReviewStatusLock(value: unknown): NativeReviewAuthorityLock {
	const lock = exactObject(value, ["version", "path", "status"], ["lineage_id", "owner", "problem"]);
	let owner: NativeReviewLockOwner | undefined;
	if (lock.owner !== undefined) {
		const decodedOwner = exactObject(lock.owner, ["schema", "owner_id", "pid", "host", "acquired_at"]);
		owner = {
			schema: enumString(decodedOwner.schema, Object.values(NATIVE_REVIEW_LOCK_OWNER_SCHEMA)) as NativeReviewLockOwnerSchema,
			ownerId: requiredString(decodedOwner.owner_id),
			pid: positiveInteger(decodedOwner.pid),
			host: requiredString(decodedOwner.host),
			acquiredAt: requiredString(decodedOwner.acquired_at),
		};
	}
	return {
		version: enumString(lock.version, Object.values(NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION)) as NativeReviewAuthorityEntryVersion,
		...(lock.lineage_id === undefined ? {} : { lineageId: requiredString(lock.lineage_id) }),
		path: requiredString(lock.path),
		status: enumString(lock.status, Object.values(NATIVE_REVIEW_LOCK_STATUS)) as NativeReviewLockStatus,
		...(owner === undefined ? {} : { owner }),
		...(lock.problem === undefined ? {} : { problem: requiredString(lock.problem) }),
	};
}
function decodeNativeReviewStatusDiagnostic(value: unknown): NativeReviewAuthorityDiagnostic {
	const diagnostic = exactObject(value, ["path", "problem"]);
	return { path: requiredString(diagnostic.path), problem: requiredString(diagnostic.problem) };
}
function decodeNativeReviewModeStatus(value: unknown): NativeReviewModeStatus {
	const status = exactObject(value, ["schema", "global", "clone_local", "effective", "source"], ["revision"]);
	if (status.schema !== "gentle-ai.rdd-mode-status/v1") throw new Error("wrong review mode status schema");
	return {
		global: enumString(status.global, Object.values(NATIVE_REVIEW_MODE_VALUE)) as NativeReviewModeValue,
		cloneLocal: enumString(status.clone_local, Object.values(NATIVE_REVIEW_MODE_VALUE)) as NativeReviewModeValue,
		effective: enumString(status.effective, ["on", "off"]) as "on" | "off",
		source: enumString(status.source, Object.values(NATIVE_REVIEW_MODE_SOURCE)) as NativeReviewModeSource,
		...(status.revision === undefined ? {} : { revision: requiredString(status.revision) }),
	};
}

function decodeNativeReviewMode(value: unknown, expectedOperation: NativeReviewModeOperation): NativeReviewModeResult {
	const body = exactObject(value, ["schema", "operation", "scope", "status"]);
	if (body.schema !== "gentle-ai.review-mode/v1" || body.operation !== expectedOperation) throw new Error("wrong review mode discriminator");
	return {
		operation: expectedOperation,
		scope: enumString(body.scope, Object.values(NATIVE_REVIEW_MODE_SCOPE)) as NativeReviewModeScope,
		status: decodeNativeReviewModeStatus(body.status),
	};
}

function decodeNativeReviewStatus(value: unknown): NativeReviewStatusResult {
	const body = exactObject(value, ["schema", "operation", "repository", "complete", "authoritative", "status", "entries", "locks", "diagnostics"]);
	if (body.schema !== "gentle-ai.review-authority-status/v1" || body.operation !== "review/status") throw new Error("wrong review status discriminator");
	const complete = booleanValue(body.complete);
	const authoritative = booleanValue(body.authoritative);
	if (authoritative && !complete) throw new Error("incomplete inventory cannot be authoritative");
	if (!Array.isArray(body.entries) || !Array.isArray(body.locks)) throw new Error("invalid native status inventory");
	return {
		repository: requiredString(body.repository),
		complete,
		authoritative,
		status: enumString(body.status, Object.values(NATIVE_REVIEW_AUTHORITY_STATUS)) as NativeReviewAuthorityStatus,
		entries: body.entries.map(decodeNativeReviewStatusEntry),
		locks: body.locks.map(decodeNativeReviewStatusLock),
		diagnostics: body.diagnostics.map(decodeNativeReviewStatusDiagnostic),
		raw: body,
	};
}
function isWindowsRepositoryPath(value: string): boolean { return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value); }
export function normalizeNativeReviewCwd(value: string, platform: NodeJS.Platform = process.platform): string {
	if (platform !== "win32") return value;
	const gitBashDrive = /^\/([A-Za-z])(?:\/(.*))?$/.exec(value);
	const windowsPath = gitBashDrive === null
		? value
		: `${gitBashDrive[1]!.toUpperCase()}:/${gitBashDrive[2] ?? ""}`;
	if (!isWindowsRepositoryPath(windowsPath)) return windowsPath;
	const normalized = win32.normalize(windowsPath);
	return normalized.replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
}
async function canonicalNativeReviewCwd(value: string): Promise<string> {
	const normalized = normalizeNativeReviewCwd(value);
	try { return await realpath(normalized); }
	catch { return normalized; }
}
async function repositoryPathIdentity(value: string): Promise<string> {
	const windowsPath = isWindowsRepositoryPath(value);
	try { return `filesystem:${windowsPath ? (await realpath(value)).toLowerCase() : await realpath(value)}`; }
	catch { return `path:${windowsPath ? win32.normalize(value).toLowerCase() : posix.normalize(value)}`; }
}
async function repositoriesMatch(requested: string, returned: string): Promise<boolean> {
	return (await repositoryPathIdentity(requested)) === (await repositoryPathIdentity(returned));
}
function decodeSnapshot(value: unknown): void {
	const snapshot = exactObject(value, ["kind", "base_tree", "candidate_tree", "paths_digest", "intended_untracked", "intended_untracked_proof", "paths", "identity"], ["ledger_ids"]);
	enumString(snapshot.kind, ["current-changes", "base-diff", "commit-range", "fix-diff"]);
	for (const field of ["base_tree", "candidate_tree", "paths_digest", "intended_untracked_proof", "identity"]) requiredString(snapshot[field]);
	stringArray(snapshot.intended_untracked); stringArray(snapshot.paths);
	if (snapshot.ledger_ids !== undefined) stringArray(snapshot.ledger_ids);
}
function decodeFinding(value: unknown): void {
	const finding = exactObject(value, ["id"], ["lens", "location", "severity", "claim", "proof_refs"]);
	requiredString(finding.id);
	if (finding.lens !== undefined) enumString(finding.lens, ["risk", "resilience", "readability", "reliability"]);
	if (finding.location !== undefined) stringValue(finding.location);
	if (finding.severity !== undefined) enumString(finding.severity, ["BLOCKER", "CRITICAL", "WARNING", "SUGGESTION"]);
	if (finding.claim !== undefined) stringValue(finding.claim);
	if (finding.proof_refs !== undefined) stringArray(finding.proof_refs);
}
function decodeLensResult(value: unknown): void {
	const result = exactObject(value, ["lens", "findings", "evidence", "result_hash"]);
	enumString(result.lens, NATIVE_REVIEW_LENS);
	if (!Array.isArray(result.findings)) throw new Error("invalid lens findings");
	for (const finding of result.findings) decodeFinding(finding);
	stringArray(result.evidence); requiredString(result.result_hash);
}
function decodeFindingEvidence(value: unknown): void {
	const evidence = exactObject(value, ["finding_id", "class", "proof"], ["causal_disposition"]);
	requiredString(evidence.finding_id); enumString(evidence.class, ["deterministic", "inferential", "insufficient"]); requiredString(evidence.proof);
	if (evidence.causal_disposition !== undefined) enumString(evidence.causal_disposition, ["introduced", "behavior-activated", "worsened", "pre-existing", "base-only", "unknown"]);
}
function decodeValidationCheck(value: unknown): void {
	const check = exactObject(value, ["evidence_hash", "fix_delta_hash", "passed"]);
	requiredString(check.evidence_hash); requiredString(check.fix_delta_hash); booleanValue(check.passed);
}
function decodeReviewTransaction(value: unknown): void {
	const transaction = exactObject(
		value,
		["schema", "lineage_id", "mode", "generation", "state", "snapshot", "base_tree", "paths_digest", "initial_review_tree", "final_candidate_tree", "fix_delta_hash", "policy_hash", "ledger_hash", "ledger_findings_hash", "evidence_hash", "judge_proofs", "counters", "findings", "classifications", "outcomes", "fix_finding_ids", "pending_refuter_ids", "fix_caused_findings", "follow_ups"],
		["genesis_paths", "invalidation_reason", "judge_proof_hash", "judge_agreement_hash", "release", "failed_evidence_revision", "original_criteria", "correction_regression", "risk_level", "selected_lenses", "lens_results", "original_changed_lines", "correction_budget", "proposed_correction_lines", "actual_correction_lines"],
	);
	if (transaction.schema !== "gentle-ai.review-transaction/v1") throw new Error("invalid review transaction schema");
	requiredString(transaction.lineage_id); enumString(transaction.mode, ["ordinary_4r", "ordinary_bounded", "judgment_day"]); nonNegativeInteger(transaction.generation);
	enumString(transaction.state, ["unreviewed", "reviewing", "judges_confirmed", "findings_frozen", "evidence_classified", "fix_required", "fixing", "fix_validating", "ready_final_verification", "final_verifying", "approved", "escalated", "invalidated"]);
	decodeSnapshot(transaction.snapshot);
	for (const field of ["base_tree", "paths_digest", "initial_review_tree", "final_candidate_tree", "fix_delta_hash", "policy_hash", "ledger_hash", "ledger_findings_hash", "evidence_hash"]) stringValue(transaction[field]);
	for (const field of ["genesis_paths", "fix_finding_ids", "pending_refuter_ids"]) if (transaction[field] !== undefined) stringArray(transaction[field]);
	for (const field of ["invalidation_reason", "judge_proof_hash", "judge_agreement_hash", "failed_evidence_revision"]) if (transaction[field] !== undefined) requiredString(transaction[field]);
	if (!Array.isArray(transaction.judge_proofs)) throw new Error("invalid judge proofs");
	for (const proof of transaction.judge_proofs) {
		const row = exactObject(proof, ["judge_id", "execution_hash", "result_hash", "blind", "confirmed"]);
		requiredString(row.judge_id); requiredString(row.execution_hash); requiredString(row.result_hash); booleanValue(row.blind); booleanValue(row.confirmed);
	}
	const counters = exactObject(transaction.counters, ["full_reviews", "refuter_batches", "fix_batches", "scoped_fix_validations", "final_verifications", "fix_rounds", "scoped_rejudgments", "judge_executions"], ["risk_executions", "resilience_executions", "readability_executions", "reliability_executions"]);
	for (const value of Object.values(counters)) nonNegativeInteger(value);
	for (const field of ["findings", "fix_caused_findings"]) {
		if (!Array.isArray(transaction[field])) throw new Error("invalid transaction findings");
		for (const finding of transaction[field]) decodeFinding(finding);
	}
	const classifications = object(transaction.classifications);
	for (const evidence of Object.values(classifications)) decodeFindingEvidence(evidence);
	const outcomes = object(transaction.outcomes);
	for (const outcome of Object.values(outcomes)) enumString(outcome, ["corroborated", "refuted", "inconclusive", "info"]);
	if (!Array.isArray(transaction.follow_ups)) throw new Error("invalid follow-ups");
	for (const followUp of transaction.follow_ups) {
		const row = exactObject(followUp, ["observation", "proof_refs"]);
		requiredString(row.observation); stringArray(row.proof_refs);
	}
	for (const field of ["original_criteria", "correction_regression"]) if (transaction[field] !== undefined) decodeValidationCheck(transaction[field]);
	if (transaction.release !== undefined) decodeReleaseEvidence(transaction.release);
	if (transaction.risk_level !== undefined) enumString(transaction.risk_level, NATIVE_RISK_LEVEL);
	if (transaction.selected_lenses !== undefined) for (const lens of stringArray(transaction.selected_lenses)) enumString(lens, NATIVE_REVIEW_LENS);
	if (transaction.lens_results !== undefined) {
		if (!Array.isArray(transaction.lens_results)) throw new Error("invalid lens results");
		for (const result of transaction.lens_results) decodeLensResult(result);
	}
	for (const field of ["original_changed_lines", "correction_budget", "proposed_correction_lines", "actual_correction_lines"]) if (transaction[field] !== undefined) nonNegativeInteger(transaction[field]);
}
function hasCanonicalSelectedLenses(riskLevel: string, selectedLenses: readonly string[]): boolean {
	if (new Set(selectedLenses).size !== selectedLenses.length) return false;
	if (riskLevel === "low") return selectedLenses.length === 0;
	if (riskLevel === "medium") return selectedLenses.length === 1;
	return selectedLenses.length === NATIVE_REVIEW_LENS.length
		&& NATIVE_REVIEW_LENS.every((lens) => selectedLenses.includes(lens));
}

function hasValidLensesRequired(action: NativeStartAction, state: string, riskLevel: string, lensesRequired: boolean): boolean {
	if (riskLevel === "low") return !lensesRequired;
	if (action === NATIVE_START_ACTION.CREATED) return state === "reviewing" && lensesRequired;
	if (action === NATIVE_START_ACTION.RESUMED) return !lensesRequired || state === "reviewing";
	if (action === NATIVE_START_ACTION.REUSE_RECEIPT) return state === "approved" && !lensesRequired;
	return !lensesRequired;
}

function nativeError(code: NativeReviewErrorCode, operation: NativeReviewOperation, mutating: boolean, message: string, result?: ExecFileResult, launchAttempted = true, auditRecord?: Record<string, unknown>, maxBufferBytes?: number): NativeReviewCliError {
	return new NativeReviewCliError(code, operation, launchAttempted, mutating, message, nativeProcessDiagnostics(operation, code, result, maxBufferBytes), auditRecord);
}

interface NativeJsonExecution {
	body: Record<string, unknown>;
	exitCode: number;
	process: ExecFileResult;
}

export class NativeReviewCliV214 {
	private readonly adapter: ExecFileAdapter;
	private readonly executable: string | (() => string);
	private readonly timeoutMs: number;
	private readonly maxBufferBytes: number;
	private readonly cleanupDirectory: (directory: string) => Promise<void>;
	constructor(adapter: ExecFileAdapter, executable: string | (() => string) = resolveGentleAiBinary, timeoutMs = 30_000, maxBufferBytes = resolveNativeReviewMaxBufferBytes(), cleanupDirectory = (directory: string) => rm(directory, { recursive: true, force: true })) {
		if (typeof executable === "string" && (!isAbsolute(executable) || executable === "gentle-ai")) throw new TypeError("Native review requires an absolute package-local executable");
		this.adapter = adapter;
		this.executable = executable;
		this.timeoutMs = timeoutMs;
		this.maxBufferBytes = maxBufferBytes;
		this.cleanupDirectory = cleanupDirectory;
	}

	private executablePath(operation: NativeReviewOperation, mutating: boolean): string {
		try {
			const executable = typeof this.executable === "string" ? this.executable : this.executable();
			if (!isAbsolute(executable) || executable === "gentle-ai") throw new TypeError("Native review requires an absolute package-local executable");
			return executable;
		}
		catch (error) {
			if (error instanceof PackageLocalGentleAiBinaryMissingError) {
				throw nativeError(NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING, operation, mutating, error.message, undefined, false);
			}
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, operation, mutating, "package-local native process could not start", undefined, false);
		}
	}

	// toleratedStderr is an exact-match, operation-scoped allowlist (Design
	// Decision #6, organic-rdd-parity): only START passes a non-empty list, and
	// only when the negotiated version's `mode` capability is true. A near-miss,
	// prefixed, or multi-line stderr is never tolerated — only byte-exact
	// membership in the frozen set.
	private async execute(operation: NativeReviewOperation, cwd: string, arguments_: readonly string[], mutating: boolean, signal?: AbortSignal, toleratedStderr: readonly string[] = []): Promise<NativeJsonExecution> {
		let result: ExecFileResult;
		try { result = await this.adapter({ file: this.executablePath(operation, mutating), arguments: arguments_, cwd, timeoutMs: mutating ? undefined : this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal }); }
		catch (error) {
			if (error instanceof NativeReviewCliError) throw nativeError(error.code, operation, mutating, error.message, undefined, error.launchAttempted);
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, operation, mutating, "native process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, operation, mutating, "native process could not start");
		}
		const diagnostics = nativeProcessDiagnostics(operation, NATIVE_REVIEW_ERROR_CODE.NON_ZERO, result);
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, operation, mutating, "native process output exceeded limit", result, true, undefined, this.maxBufferBytes);
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, operation, mutating, "native process timed out", result);
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, operation, mutating, "native process was signalled", result);
		const structuredValidateDenial = operation === NATIVE_REVIEW_OPERATION.VALIDATE && result.exitCode === 1;
		const maintenancePartialFailure = [NATIVE_REVIEW_OPERATION.ABANDON, NATIVE_REVIEW_OPERATION.QUARANTINE_LEGACY, NATIVE_REVIEW_OPERATION.RECONCILE_AUTHORITY, NATIVE_REVIEW_OPERATION.REPAIR_LEGACY_ALIAS].includes(operation) && result.exitCode !== 0;
		const toleratedNotice = stderrIsTolerated(result.stderr, toleratedStderr);
		if (result.exitCode !== 0 && !structuredValidateDenial && !maintenancePartialFailure) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, operation, mutating, "native process failed", result);
		if (result.stderr.trim().length > 0 && !structuredValidateDenial && !maintenancePartialFailure && !toleratedNotice) throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR, operation, mutating, "native process wrote stderr", result);
		return { body: parseJson(result.stdout, operation, mutating, diagnostics), exitCode: result.exitCode, process: result };
	}

	private async verifyVersion(cwd: string, signal: AbortSignal | undefined, capabilities: readonly NativeCliCapability[]): Promise<keyof typeof NATIVE_CLI_CONTRACTS> {
		let result: ExecFileResult;
		try { result = await this.adapter({ file: this.executablePath(NATIVE_REVIEW_OPERATION.VERSION, false), arguments: ["version"], cwd, timeoutMs: this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal }); }
		catch (error) {
			if (error instanceof NativeReviewCliError) throw error;
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, NATIVE_REVIEW_OPERATION.VERSION, false, "version process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, NATIVE_REVIEW_OPERATION.VERSION, false, "gentle-ai is unavailable");
		}
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process output exceeded limit", result, true, undefined, this.maxBufferBytes);
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process timed out", result);
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, NATIVE_REVIEW_OPERATION.VERSION, false, "version process was signalled", result);
		if (result.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.VERSION, false, "version process failed", result);
		const version = /^gentle-ai ([0-9]+\.[0-9]+\.[0-9]+)\n$/.exec(result.stdout.replace(/\r\n$/, "\n"))?.[1];
		const contract = version === undefined ? undefined : resolvedNativeCliContract(version);
		if (result.stderr.trim().length > 0 || contract === undefined || capabilities.some((capability) => !contract[capability])) throw nativeError(NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE, NATIVE_REVIEW_OPERATION.VERSION, false, `native gentle-ai lacks required capabilities: expected v${GENTLE_AI_VERSION}, found v${version ?? "unparseable"}`);
		return version as keyof typeof NATIVE_CLI_CONTRACTS;
	}

	async start(request: NativeStartRequest): Promise<NativeStartResult> {
		if (request.baseRef !== undefined && !isCanonicalProcessString(request.baseRef)) throw new TypeError("Native START baseRef must be a non-empty, trimmed, NUL-free string");
		if (request.committedOnly !== undefined && typeof request.committedOnly !== "boolean") throw new TypeError("Native START committedOnly must be a boolean when supplied");
		if (request.baseRef !== undefined && request.committedOnly !== true) throw new TypeError("Native START baseRef requires explicit committedOnly acknowledgement");
		if (request.baseRef === undefined && request.committedOnly !== undefined) throw new TypeError("Native START committedOnly requires an explicit baseRef");
		const version = await this.verifyVersion(request.cwd, request.signal, ["start"]);
		const toleratedStderr = resolvedNativeCliContract(version)?.mode === true ? REVIEW_CONSENT_NOTICES : [];
		const { body: result } = await this.execute(NATIVE_REVIEW_OPERATION.START, request.cwd, ["review", "start", "--cwd", request.cwd, ...(request.baseRef === undefined ? [] : ["--base-ref", request.baseRef, "--committed-only"]), ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...(request.policyPath ? ["--policy", request.policyPath] : []), ...(request.focus ? ["--focus", request.focus] : [])], true, request.signal, toleratedStderr);
		return decode(NATIVE_REVIEW_OPERATION.START, true, () => {
			// `target_identity` and `lens_bindings` are real, unconditionally-present
			// fields on gentle-ai's plain (non-negotiated) `review start` JSON output
			// (confirmed against the pinned v2.1.11 Go source and live against a dev
			// build during Phase 6 dev-binary ground-truthing, organic-rdd-parity) —
			// tolerated here but not consumed: Pi's negotiated-contract client
			// (NativeReviewCliV216, the production default) carries lineage/target
			// identity through its own `review-integration/v1` decoder instead.
			const body = exactObject(result, ["operation", "lineage_id", "state", "risk_level", "selected_lenses", "changed_files", "changed_lines", "correction_budget", "action", "lenses_required", "projection"], ["risk_evidence", "hint", "target_identity", "lens_bindings"]);
			if (body.operation !== "review/start" || body.projection !== "workspace" || !(NATIVE_FINALIZE_STATE as readonly string[]).includes(stringValue(body.state))) throw new Error("wrong start discriminator");
			const lineageId = requiredString(body.lineage_id);
			if (request.lineageId && lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native start lineage mismatch");
			const riskLevel = requiredString(body.risk_level);
			const action = enumString(body.action, NATIVE_START_ACTION_VALUES) as NativeStartAction;
			const lensesRequired = booleanValue(body.lenses_required);
			const selectedLenses = decodeSelectedLenses(body.selected_lenses, riskLevel, lensesRequired);
			if (
				!(NATIVE_RISK_LEVEL as readonly string[]).includes(riskLevel) ||
				selectedLenses.some((lens) => !(NATIVE_REVIEW_LENS as readonly string[]).includes(lens)) ||
				!hasCanonicalSelectedLenses(riskLevel, selectedLenses) ||
				!hasValidLensesRequired(action, body.state as string, riskLevel, lensesRequired)
			) throw new Error("unknown or contradictory start enum");
			return {
				lineageId, state: body.state as NativeStartResult["state"], riskLevel, selectedLenses, changedFiles: nonNegativeInteger(body.changed_files), changedLines: nonNegativeInteger(body.changed_lines), correctionBudget: nonNegativeInteger(body.correction_budget), action, lensesRequired,
				...(body.risk_evidence === undefined ? {} : { riskEvidence: stringArray(body.risk_evidence) }),
				...(body.hint === undefined ? {} : { hint: requiredString(body.hint) }),
			};
		});
	}

	private async stageDocument(directory: string, name: string, document: unknown): Promise<string> {
		const path = join(directory, `${name}.json`);
		await writeFile(path, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
		await chmod(path, 0o600);
		return path;
	}
	private async stageEvidence(directory: string, evidence: string): Promise<string> {
		const path = join(directory, "evidence.txt");
		await writeFile(path, evidence, { encoding: "utf8", mode: 0o600 });
		await chmod(path, 0o600);
		return path;
	}

	async finalize(request: NativeFinalizeRequest): Promise<NativeFinalizeResult> {
		if (request.evidenceDocument !== undefined && (typeof request.evidenceDocument !== "string" || request.evidenceDocument.length === 0)) throw new TypeError("Native FINALIZE evidence must contain at least one byte");
		await this.verifyVersion(request.cwd, request.signal, ["finalize"]);
		const needsStaging = request.lensResults !== undefined || request.refuterDocument !== undefined || request.validationDocument !== undefined || request.evidenceDocument !== undefined;
		const directory = needsStaging ? await mkdtemp(join(tmpdir(), "gentle-ai-finalize-")) : undefined;
		try {
			if (directory) await chmod(directory, 0o700);
			const resultFiles = directory && request.lensResults ? await Promise.all(request.lensResults.map((entry, index) => this.stageDocument(directory, `result-${index}`, entry.document))) : request.resultFiles ?? [];
			const refuterFile = directory && request.refuterDocument !== undefined ? await this.stageDocument(directory, "refuter", request.refuterDocument) : request.refuterFile;
			const validationFile = directory && request.validationDocument !== undefined ? await this.stageDocument(directory, "validation", request.validationDocument) : request.validationFile;
			const evidenceFile = directory && request.evidenceDocument !== undefined ? await this.stageEvidence(directory, request.evidenceDocument) : request.evidenceFile;
			const { body: result } = await this.execute(NATIVE_REVIEW_OPERATION.FINALIZE, request.cwd, ["review", "finalize", "--cwd", request.cwd, ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...resultFiles.flatMap((path) => ["--result", path]), ...(refuterFile ? ["--refuter", refuterFile] : []), ...(request.correctionLines === undefined ? [] : ["--correction-lines", String(request.correctionLines)]), ...(validationFile ? ["--validation", validationFile] : []), ...(evidenceFile ? ["--evidence", evidenceFile] : []), ...(request.failed ? ["--failed"] : [])], true, request.signal);
			return decode(NATIVE_REVIEW_OPERATION.FINALIZE, true, () => {
				const body = exactObject(result, ["operation", "lineage_id", "state", "action", "store_revision"], ["receipt_path"]);
				if (body.operation !== "review/finalize") throw new Error("wrong finalize discriminator");
				const lineageId = requiredString(body.lineage_id);
				if (request.lineageId && lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.FINALIZE, true, "native finalize lineage mismatch");
				const state = requiredString(body.state);
				if (!(NATIVE_FINALIZE_STATE as readonly string[]).includes(state)) throw new Error("unknown finalize state");
				return { lineageId, state, action: requiredString(body.action), storeRevision: requiredString(body.store_revision), ...(body.receipt_path === undefined ? {} : { receiptPath: requiredString(body.receipt_path) }) };
			});
		} finally { if (directory) await this.cleanupDirectory(directory).catch(() => undefined); }
	}

	async validate(request: NativeValidateRequest): Promise<NativeValidateResult> {
		await this.verifyVersion(request.cwd, request.signal, ["validate"]);
		const execution = await this.execute(NATIVE_REVIEW_OPERATION.VALIDATE, request.cwd, ["review", "validate", "--gate", request.gate, "--cwd", request.cwd, ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...(request.flags ?? [])], false, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.VALIDATE, false, () => {
			const body = exactObject(execution.body, ["schema", "result", "allowed", "action", "reason", "context"], ["delivery"]);
			const gateResult = enumString(body.result, NATIVE_GATE_RESULT) as NativeValidateResult["result"];
			const action = sanitizeNativeDiagnosticText(requiredString(body.action), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
			const reason = sanitizeNativeDiagnosticText(requiredString(body.reason), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
			// `delivery` (Design Decision #9, organic-rdd-parity) is an alternate
			// discriminator: when present it must be the single literal
			// "disabled/unmanaged" (gentle-ai's RDDDeliveryDisabledUnmanaged — the
			// kill switch is off and no receipt governs the candidate), paired
			// exactly with result:invalidated, allowed:false, action:repository-policy,
			// and exit 0 — never the strict continue/create-new-lineage/
			// explicit-maintainer-action/stop pairing used when delivery is absent.
			const delivery = body.delivery === undefined ? undefined : (enumString(body.delivery, ["disabled/unmanaged"]) as NativeValidateResult["delivery"]);
			if (body.schema !== "gentle-ai.review-gate-result/v1" || !isCanonicalProcessString(action) || !isCanonicalProcessString(reason)) throw new Error("wrong validate discriminator");
			if (delivery !== undefined) {
				if (gateResult !== "invalidated" || body.allowed !== false || action !== "repository-policy" || execution.exitCode !== 0) throw new Error("wrong validate delivery discriminator");
			} else {
				const expectedAction = { allow: "continue", "scope-changed": "create-new-lineage", invalidated: "explicit-maintainer-action", escalated: "stop" }[gateResult];
				const expectedExitCode = gateResult === "allow" ? 0 : 1;
				if (typeof body.allowed !== "boolean" || body.allowed !== (gateResult === "allow") || action !== expectedAction || execution.exitCode !== expectedExitCode) throw new Error("wrong validate discriminator");
			}
			const gateContext = decodeGateContext(body.context);
			const returnedGate = gateContext.raw.gate;
			if (returnedGate !== request.gate && (gateResult === "allow" || returnedGate !== "")) throw new Error("native gate context does not match the requested gate");
			if (request.lineageId && returnedGate !== "" && gateContext.lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.VALIDATE, false, "native gate lineage mismatch");
			return { allowed: body.allowed as boolean, result: gateResult, action, reason, gateContext, ...(delivery === undefined ? {} : { delivery }) };
		});
	}

	async bindSdd(request: NativeBindSddRequest): Promise<NativeBindSddResult> {
		await this.verifyVersion(request.cwd, request.signal, ["bindSdd"]);
		const { body: result } = await this.execute(NATIVE_REVIEW_OPERATION.BIND_SDD, request.cwd, ["review", "bind-sdd", "--cwd", request.cwd, "--change", request.change, "--lineage", request.lineage, `--expected-binding-revision=${request.expectedBindingRevision}`], true, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.BIND_SDD, true, () => {
			const body = exactObject(result, ["schema", "revision", "change", "lineage", "authority_revision", "receipt_hash", "gate_context"]);
			if (body.schema !== "gentle-ai.sdd-review-binding/v1" || body.change !== request.change || body.lineage !== request.lineage) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.BIND_SDD, true, "native binding identity mismatch");
			const receiptHash = requiredString(body.receipt_hash);
			const gateContext = decodeGateContext(body.gate_context);
			const authorityRevision = requiredString(body.authority_revision);
			if (gateContext.lineageId !== request.lineage || gateContext.storeRevision !== authorityRevision || gateContext.raw.gate !== "post-apply") throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.BIND_SDD, true, "native binding gate mismatch");
			return {
				revision: requiredString(body.revision),
				change: requiredString(body.change),
				lineage: requiredString(body.lineage),
				authorityRevision,
				receiptHash,
				gateContext,
			};
		});
	}

	async reviewStatus(request: NativeReviewStatusRequest): Promise<NativeReviewStatusResult> {
		await this.verifyVersion(request.cwd, request.signal, ["status", "inventory"]);
		const { body: result } = await this.execute(NATIVE_REVIEW_OPERATION.STATUS, request.cwd, ["review", "status", "--cwd", request.cwd], false, request.signal);
		const status = decode(NATIVE_REVIEW_OPERATION.STATUS, false, () => decodeNativeReviewStatus(result));
		if (!await repositoriesMatch(request.cwd, status.repository)) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.STATUS, false, "native review status repository mismatch");
		return status;
	}

	// Dark until the negotiated version reports `mode: true` (Design Decision
	// #7, organic-rdd-parity). `status` is read-only (no timeout suppression,
	// exact fixed argv per the design's data flow); `enable`/`disable` mutate
	// and always pass `--scope clone` so Pi's own kill-switch command surface
	// never mutates the operator's global gentle-ai state across other clones.
	async reviewMode(request: NativeReviewModeRequest): Promise<NativeReviewModeResult> {
		const cwd = await canonicalNativeReviewCwd(request.cwd);
		await this.verifyVersion(cwd, request.signal, ["mode"]);
		const mutating = request.operation !== NATIVE_REVIEW_MODE_OPERATION.STATUS;
		const { body } = await this.execute(
			NATIVE_REVIEW_OPERATION.MODE,
			cwd,
			["review", "mode", request.operation, "--cwd", cwd, ...(mutating ? ["--scope", "clone"] : []), "--json"],
			mutating,
			request.signal,
		);
		return decode(NATIVE_REVIEW_OPERATION.MODE, mutating, () => decodeNativeReviewMode(body, request.operation));
	}

	async sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusResult> {
		await this.verifyVersion(request.cwd, request.signal, ["sddStatus"]);
		const { body: result } = await this.execute(NATIVE_REVIEW_OPERATION.SDD_STATUS, request.cwd, ["sdd-status", request.change, "--cwd", request.cwd, "--json", "--instructions"], false, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.SDD_STATUS, false, () => {
			const body = exactObject(result, ["schemaName", "schemaVersion", "changeName", "artifactStore", "planningHome", "changeRoot", "artifactPaths", "contextFiles", "artifacts", "taskProgress", "dependencies", "applyState", "actionContext", "relationships", "remediationState", "nextRecommended", "blockedReasons"], ["reviewGate", "reviewTransaction", "phaseInstructions"]);
			if (body.schemaName !== "gentle-ai.sdd-status" || body.schemaVersion !== 1 || body.changeName !== request.change || !["openspec", "engram", "none"].includes(body.artifactStore as string) || !["blocked", "all_done", "ready"].includes(body.applyState as string)) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.SDD_STATUS, false, "native status identity mismatch");
			const paths = ["proposal", "specs", "design", "tasks", "applyProgress", "verifyReport", "reviewPolicy", "reviewLedger", "reviewReceipt", "reviewBundle", "reviewContext", "reviewState"];
			const pathMap = (value: unknown) => { const parsed = exactObject(value, paths); for (const path of paths) stringArray(parsed[path]); };
			const planningHome = exactObject(body.planningHome, ["mode", "path"]);
			if (planningHome.mode !== "repo-local") throw new Error("invalid planning home");
			requiredString(planningHome.path); requiredString(body.changeRoot); pathMap(body.artifactPaths); pathMap(body.contextFiles);
			const artifactStates = paths.filter((path) => path !== "reviewPolicy" || body.artifactStore === NATIVE_SDD_ARTIFACT_STORE.ENGRAM);
			const artifacts = exactObject(body.artifacts, artifactStates);
			for (const path of artifactStates) if (!Object.values(NATIVE_SDD_ARTIFACT_STATE).includes(artifacts[path] as NativeSddArtifactState)) throw new Error("invalid artifact state");
			const taskProgress = exactObject(body.taskProgress, ["total", "completed", "pending", "allComplete"]);
			const total = nonNegativeInteger(taskProgress.total), completed = nonNegativeInteger(taskProgress.completed), pending = nonNegativeInteger(taskProgress.pending);
			if (typeof taskProgress.allComplete !== "boolean" || completed + pending !== total || taskProgress.allComplete !== (pending === 0)) throw new Error("invalid task progress");
			const dependencies = exactObject(body.dependencies, ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"]);
			for (const phase of ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"]) if (!["blocked", "ready", "all_done"].includes(dependencies[phase] as string)) throw new Error("invalid dependency state");
			const actionContext = exactObject(body.actionContext, ["mode", "workspaceRoot", "allowedEditRoots"]);
			if (actionContext.mode !== "repo-local" || requiredString(actionContext.workspaceRoot).length === 0 || stringArray(actionContext.allowedEditRoots).length === 0) throw new Error("invalid action context");
			const relationships = exactObject(body.relationships, ["dependsOn", "supersedes", "amends", "conflictsWith", "sameDomainActiveChanges"]);
			for (const field of ["dependsOn", "supersedes", "amends", "conflictsWith", "sameDomainActiveChanges"]) stringArray(relationships[field]);
			const remediation = exactObject(body.remediationState, ["required", "complete", "failedEvidenceRevision", "lineageId", "generation", "fixBatch", "reason"], ["correctionBudget"]);
			if (typeof remediation.required !== "boolean" || typeof remediation.complete !== "boolean" || ["failedEvidenceRevision", "lineageId", "reason"].some((field) => typeof remediation[field] !== "string")) throw new Error("invalid remediation state");
			nonNegativeInteger(remediation.generation); nonNegativeInteger(remediation.fixBatch);
			if (remediation.correctionBudget !== undefined) nonNegativeInteger(remediation.correctionBudget);
			let reviewGateResult: string | undefined;
			let reviewGateDelivery: string | undefined;
			if (body.reviewGate !== undefined) {
				// `delivery` (present since 09e4b14c, gentle-ai v2.2.0+) is emitted
				// when the kill switch is off: gentle-ai's status struct carries
				// `Delivery` with `json:"delivery,omitempty"`, so an exact-key decode
				// without it rejects that payload outright. Pre-existing bug fix
				// (Phase 13.13, migrate-review-integration-v2).
				const gate = exactObject(body.reviewGate, ["result", "reason"], ["delivery"]);
				reviewGateResult = enumString(gate.result, NATIVE_GATE_RESULT); requiredString(gate.reason);
				if (gate.delivery !== undefined) reviewGateDelivery = enumString(gate.delivery, ["disabled/unmanaged"]);
			}
			if (body.reviewTransaction !== undefined) decodeReviewTransaction(body.reviewTransaction);
			if (body.phaseInstructions !== undefined) {
				const instructions = exactObject(body.phaseInstructions, ["apply", "verify", "remediate", "archive"]);
				for (const phase of ["apply", "verify", "remediate", "archive"]) stringArray(instructions[phase]);
			}
			const nextRecommended = requiredString(body.nextRecommended);
			if (!(NATIVE_SDD_NEXT_ACTION as readonly string[]).includes(nextRecommended)) throw new Error("unknown SDD next action");
			const blockedReasons = stringArray(body.blockedReasons);
			return {
				...body,
				artifactStore: body.artifactStore as NativeSddArtifactStore,
				artifacts: artifacts as unknown as NativeSddArtifactStates,
				nextRecommended,
				ready:
					(NATIVE_SDD_POST_REVIEW_ACTION as readonly string[]).includes(nextRecommended) &&
					blockedReasons.length === 0 &&
					// With the kill switch off, the gate result can never become
					// "allow" (delivery follows ordinary repository policy instead) —
					// gated only on `result === "allow"` this deadlocked `ready`
					// forever, the same deadlock gentle-ai fixed upstream in 2c18fa10.
					// `disabled/unmanaged` delivery is the legitimate non-blocking
					// terminal state and must also unblock readiness.
					(reviewGateResult === "allow" || reviewGateDelivery === "disabled/unmanaged"),
			};
		});
	}

	async reclaim(request: NativeReviewReclaimRequest): Promise<NativeReviewRecoveryResult> {
		for (const [name, value] of [["lineage", request.lineage], ["actor", request.actor], ["reason", request.reason]] as const) {
			if (!isCanonicalProcessString(value)) throw new TypeError(`Native RECLAIM ${name} must be a non-empty, trimmed, NUL-free string`);
		}
		await this.verifyVersion(request.cwd, request.signal, ["reclaim"]);
		const { body } = await this.execute(NATIVE_REVIEW_OPERATION.RECLAIM, request.cwd, ["review", "reclaim", "--cwd", request.cwd, "--lineage", request.lineage, "--actor", request.actor, "--reason", request.reason], true, request.signal);
		return { record: body };
	}

	async recover(request: NativeReviewRecoverRequest): Promise<NativeReviewRecoveryResult> {
		for (const [name, value] of [
			["predecessorLineage", request.predecessorLineage],
			["expectedPredecessorRevision", request.expectedPredecessorRevision],
			["successorLineage", request.successorLineage],
			["actor", request.actor],
			["reason", request.reason],
		] as const) {
			if (!isCanonicalProcessString(value)) throw new TypeError(`Native RECOVER ${name} must be a non-empty, trimmed, NUL-free string`);
		}
		// The maintainer authorization is an exact multi-line LF-only binding, so
		// LF is the only permitted control character.
		if (request.maintainerAuthorization !== undefined && (request.maintainerAuthorization.length === 0 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(request.maintainerAuthorization))) {
			throw new TypeError("Native RECOVER maintainerAuthorization must be a non-empty LF-only binding");
		}
		if (!(NATIVE_REVIEW_RECOVER_DISPOSITION as readonly string[]).includes(request.disposition)) throw new TypeError("Native RECOVER disposition must be scope_changed, invalidated, or escalated");
		await this.verifyVersion(request.cwd, request.signal, ["recover"]);
		const { body } = await this.execute(NATIVE_REVIEW_OPERATION.RECOVER, request.cwd, [
			"review", "recover", "--cwd", request.cwd,
			"--predecessor-lineage", request.predecessorLineage,
			"--expected-predecessor-revision", request.expectedPredecessorRevision,
			"--successor-lineage", request.successorLineage,
			"--disposition", request.disposition,
			"--actor", request.actor,
			"--reason", request.reason,
			...(request.maintainerAuthorization === undefined ? [] : ["--maintainer-authorization", request.maintainerAuthorization]),
		], true, request.signal);
		return { record: body };
	}

	async abandon(request: NativeReviewAbandonRequest): Promise<NativeReviewRecoveryResult> {
		for (const [name, value] of [["lineage", request.lineage], ["expectedRevision", request.expectedRevision], ["snapshotIdentity", request.snapshotIdentity], ["actor", request.actor], ["reason", request.reason]] as const) {
			if (!isCanonicalProcessString(value)) throw new TypeError(`Native ABANDON ${name} must be a non-empty, trimmed, NUL-free string`);
		}
		if (request.maintainerAuthorization !== nativeReviewAbandonAuthorization(request)) throw new TypeError("Native ABANDON maintainerAuthorization must match the exact lineage, revision, snapshot, actor, and reason binding");
		await this.verifyVersion(request.cwd, request.signal, ["abandon"]);
		const execution = await this.execute(NATIVE_REVIEW_OPERATION.ABANDON, request.cwd, [
			"review", "abandon", "--cwd", request.cwd,
			"--lineage", request.lineage,
			"--expected-revision", request.expectedRevision,
			"--actor", request.actor,
			"--reason", request.reason,
			"--maintainer-authorization", request.maintainerAuthorization,
		], true, request.signal);
		const result = decode(NATIVE_REVIEW_OPERATION.ABANDON, true, () => decodeNativeMaintenanceResult(execution.body, NATIVE_REVIEW_OPERATION.ABANDON));
		if (execution.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.ABANDON, true, "native authority abandonment partially failed", execution.process, true, result.record);
		return result;
	}

	async quarantineLegacy(request: NativeReviewLegacyQuarantineRequest): Promise<NativeReviewRecoveryResult> {
		for (const [name, value] of [["repository", request.repository], ["lineage", request.lineage], ["expectedRevision", request.expectedRevision], ["actor", request.actor], ["reason", request.reason]] as const) {
			if (!isCanonicalProcessString(value)) throw new TypeError(`Native QUARANTINE_LEGACY ${name} must be a non-empty, trimmed, NUL-free string`);
		}
		if (request.diagnostic !== NATIVE_REVIEW_LEGACY_QUARANTINE.DIAGNOSTIC || request.disposition !== NATIVE_REVIEW_LEGACY_QUARANTINE.DISPOSITION) throw new TypeError("Native QUARANTINE_LEGACY supports only the published malformed freeze-findings diagnostic and disposition");
		if (request.maintainerAuthorization !== nativeReviewLegacyQuarantineAuthorization(request)) throw new TypeError("Native QUARANTINE_LEGACY maintainerAuthorization must match the exact repository, lineage, revision, diagnostic, disposition, actor, and reason binding");
		await this.verifyVersion(request.cwd, request.signal, ["quarantineLegacy"]);
		const execution = await this.execute(NATIVE_REVIEW_OPERATION.QUARANTINE_LEGACY, request.cwd, [
			"review", "quarantine-legacy", "--cwd", request.cwd,
			"--lineage", request.lineage,
			"--expected-revision", request.expectedRevision,
			"--diagnostic", request.diagnostic,
			"--disposition", request.disposition,
			"--actor", request.actor,
			"--reason", request.reason,
			"--maintainer-authorization", request.maintainerAuthorization,
		], true, request.signal);
		const result = decode(NATIVE_REVIEW_OPERATION.QUARANTINE_LEGACY, true, () => decodeNativeMaintenanceResult(execution.body, NATIVE_REVIEW_OPERATION.QUARANTINE_LEGACY));
		if (execution.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.QUARANTINE_LEGACY, true, "native legacy quarantine partially failed", execution.process, true, result.record);
		return result;
	}

	async reconcileAuthority(request: NativeReviewReconcileAuthorityRequest): Promise<NativeReviewRecoveryResult> {
		for (const [name, value] of [
			["predecessorLineage", request.predecessorLineage],
			["expectedPredecessorRevision", request.expectedPredecessorRevision],
			["successorLineage", request.successorLineage],
			["expectedSuccessorRevision", request.expectedSuccessorRevision],
			["actor", request.actor],
			["reason", request.reason],
		] as const) {
			if (!isCanonicalProcessString(value)) throw new TypeError(`Native RECONCILE_AUTHORITY ${name} must be a non-empty, trimmed, NUL-free string`);
		}
		if (request.anomalies !== undefined && request.anomalies !== NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED) throw new TypeError("Native RECONCILE_AUTHORITY anomalies must use the published unchanged_target,malformed_recovery_authorization ordering");
		const expectedAuthorization = nativeReviewReconcileAuthorization(request);
		if (request.maintainerAuthorization !== expectedAuthorization) {
			throw new TypeError("Native RECONCILE_AUTHORITY maintainerAuthorization must match the exact target and revision binding");
		}
		const version = await this.verifyVersion(request.cwd, request.signal, ["reconcileAuthority"]);
		const execution = await this.execute(NATIVE_REVIEW_OPERATION.RECONCILE_AUTHORITY, request.cwd, [
			"review", "reconcile-authority", "--cwd", request.cwd,
			"--predecessor-lineage", request.predecessorLineage,
			"--expected-predecessor-revision", request.expectedPredecessorRevision,
			"--successor-lineage", request.successorLineage,
			"--expected-successor-revision", request.expectedSuccessorRevision,
			"--actor", request.actor,
			"--reason", request.reason,
			"--maintainer-authorization", request.maintainerAuthorization,
		], true, request.signal);
		const result = decode(NATIVE_REVIEW_OPERATION.RECONCILE_AUTHORITY, true, () => version === "2.1.8"
			? decodeLegacyReconcileAudit(execution.body)
			: decodeNativeMaintenanceResult(execution.body, NATIVE_REVIEW_OPERATION.RECONCILE_AUTHORITY));
		if (execution.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.RECONCILE_AUTHORITY, true, "native authority reconciliation partially failed", execution.process, true, result.record);
		return result;
	}

	async repairLegacyAlias(request: NativeReviewLegacyAliasRepairRequest): Promise<NativeReviewRecoveryResult> {
		for (const [name, value] of [["repository", request.repository], ["lineage", request.lineage], ["expectedRevision", request.expectedRevision], ["actor", request.actor], ["reason", request.reason]] as const) {
			if (!isCanonicalProcessString(value)) throw new TypeError(`Native REPAIR_LEGACY_ALIAS ${name} must be a non-empty, trimmed, NUL-free string`);
		}
		if (request.diagnostic !== NATIVE_REVIEW_LEGACY_ALIAS_REPAIR.DIAGNOSTIC || request.disposition !== NATIVE_REVIEW_LEGACY_ALIAS_REPAIR.DISPOSITION) throw new TypeError("Native REPAIR_LEGACY_ALIAS supports only the published historical alias diagnostic and disposition");
		if (request.maintainerAuthorization !== nativeReviewLegacyAliasRepairAuthorization(request)) throw new TypeError("Native REPAIR_LEGACY_ALIAS maintainerAuthorization must match the exact repository, lineage, revision, diagnostic, disposition, actor, and reason binding");
		await this.verifyVersion(request.cwd, request.signal, ["repairLegacyAlias"]);
		const execution = await this.execute(NATIVE_REVIEW_OPERATION.REPAIR_LEGACY_ALIAS, request.cwd, [
			"review", "repair-legacy-alias", "--cwd", request.cwd,
			"--lineage", request.lineage,
			"--expected-revision", request.expectedRevision,
			"--diagnostic", request.diagnostic,
			"--disposition", request.disposition,
			"--actor", request.actor,
			"--reason", request.reason,
			"--maintainer-authorization", request.maintainerAuthorization,
		], true, request.signal);
		const result = decode(NATIVE_REVIEW_OPERATION.REPAIR_LEGACY_ALIAS, true, () => decodeNativeMaintenanceResult(execution.body, NATIVE_REVIEW_OPERATION.REPAIR_LEGACY_ALIAS));
		if (execution.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.REPAIR_LEGACY_ALIAS, true, "native historical alias repair partially failed", execution.process, true, result.record);
		return result;
	}
}

export function nativeReviewAbandonAuthorization(request: Pick<NativeReviewAbandonRequest, "lineage" | "expectedRevision" | "snapshotIdentity" | "actor" | "reason">): string {
	return [
		"gentle-ai.review-abandon-authorization/v1",
		`lineage=${request.lineage}`,
		`revision=${request.expectedRevision}`,
		`snapshot_identity=${request.snapshotIdentity}`,
		`actor=${request.actor}`,
		`reason=${request.reason}`,
	].join("\n");
}

export function nativeReviewLegacyQuarantineAuthorization(request: Pick<NativeReviewLegacyQuarantineRequest, "repository" | "lineage" | "expectedRevision" | "diagnostic" | "disposition" | "actor" | "reason">): string {
	return [
		"gentle-ai.review-legacy-quarantine-authorization/v1",
		`repository=${request.repository}`,
		`lineage=${request.lineage}`,
		`revision=${request.expectedRevision}`,
		`diagnostic=${request.diagnostic}`,
		`disposition=${request.disposition}`,
		`actor=${request.actor}`,
		`reason=${request.reason}`,
	].join("\n");
}

export function nativeReviewReconcileAuthorization(request: Pick<NativeReviewReconcileAuthorityRequest, "predecessorLineage" | "expectedPredecessorRevision" | "successorLineage" | "expectedSuccessorRevision" | "actor" | "reason" | "anomalies">): string {
	return [
		"gentle-ai.review-reconcile-authorization/v1",
		`predecessor_lineage=${request.predecessorLineage}`,
		`predecessor_revision=${request.expectedPredecessorRevision}`,
		`successor_lineage=${request.successorLineage}`,
		`successor_revision=${request.expectedSuccessorRevision}`,
		`actor=${request.actor}`,
		`reason=${request.reason}`,
		...(request.anomalies === NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED ? [`anomalies=${request.anomalies}`] : []),
	].join("\n");
}

export function nativeReviewLegacyAliasRepairAuthorization(request: Pick<NativeReviewLegacyAliasRepairRequest, "repository" | "lineage" | "expectedRevision" | "diagnostic" | "disposition" | "actor" | "reason">): string {
	return [
		"gentle-ai.review-legacy-alias-repair-authorization/v1",
		`repository=${request.repository}`,
		`lineage=${request.lineage}`,
		`revision=${request.expectedRevision}`,
		`diagnostic=${request.diagnostic}`,
		`disposition=${request.disposition}`,
		`actor=${request.actor}`,
		`reason=${request.reason}`,
	].join("\n");
}

export class NativeReviewIntegrationError extends Error {
	readonly failureEnvelope: ReviewFailureV2;
	readonly mutationOutcome: ReviewFailureV2["mutationOutcome"];
	readonly nextAction: string;
	readonly launchAttempted = true;
	constructor(failure: ReviewFailureV2) {
		super(failure.message);
		this.name = "NativeReviewIntegrationError";
		this.failureEnvelope = failure;
		this.mutationOutcome = failure.mutationOutcome;
		this.nextAction = failure.nextAction;
	}
}

// Raised when negotiated START answers `consent/v2` (action:
// "consent_required") instead of `start/v3`. The provider has frozen no
// authority yet: Pi must relay this complete candidate-scoped question and may
// answer only through one of the exact invocations carried by the envelope.
export class NativeReviewConsentRequiredError extends Error {
	readonly consent: ReviewConsentV2;
	readonly launchAttempted = true;
	readonly mutationOutcome = "none";
	constructor(consent: ReviewConsentV2) {
		super(consent.headline);
		this.name = "NativeReviewConsentRequiredError";
		this.consent = consent;
	}
}

// Raised when the provider-issued consent invocation no longer matches the
// binding Pi is answering for. Every one of these guards runs before the
// provider is launched, so the failure is local and nothing was mutated. It
// carries its own identity precisely so callers never report it as a provider
// outage: an opaque `native-operation-failed` here sent issue #247 chasing a
// missing `--cwd` that Pi does forward.
export class NativeReviewConsentBindingError extends Error {
	readonly reason: string;
	readonly launchAttempted = false;
	readonly mutationOutcome = "none";
	constructor(reason: string, message: string) {
		super(message);
		this.name = "NativeReviewConsentBindingError";
		this.reason = reason;
	}
}

function splitNativeConsentInvocation(invocation: string): readonly string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;
	let started = false;
	for (const character of invocation.trim()) {
		if (escaping) {
			current += character;
			escaping = false;
			started = true;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaping = true;
			started = true;
			continue;
		}
		if (quote !== undefined) {
			if (character === quote) quote = undefined;
			else current += character;
			started = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			started = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (started) {
				words.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += character;
		started = true;
	}
	if (quote !== undefined || escaping) throw new TypeError("Native consent invocation has invalid quoting");
	if (started) words.push(current);
	return words;
}

function exactConsentOption(arguments_: readonly string[], name: string): string {
	const values: string[] = [];
	for (let index = 0; index < arguments_.length; index += 1) {
		const token = arguments_[index]!;
		if (token === name) {
			const value = arguments_[index + 1];
			if (value === undefined) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", `Native consent invocation ${name} is missing its value`);
			values.push(value);
			index += 1;
		} else if (token.startsWith(`${name}=`)) values.push(token.slice(name.length + 1));
	}
	if (values.length !== 1) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", `Native consent invocation requires exactly one ${name}`);
	return values[0]!;
}

function optionalConsentLineageOption(arguments_: readonly string[]): string | undefined {
	const values: string[] = [];
	for (let index = 0; index < arguments_.length; index += 1) {
		const token = arguments_[index]!;
		if (token === "--lineage") {
			const value = arguments_[index + 1];
			if (value === undefined || value.startsWith("--")) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", "Native consent invocation --lineage is missing its value");
			values.push(value);
			index += 1;
		} else if (token.startsWith("--lineage=")) values.push(token.slice("--lineage=".length));
	}
	if (values.length > 1) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", "Native consent invocation permits at most one --lineage");
	if (values.length === 0) return undefined;
	const lineageId = values[0]!;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(lineageId)) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", "Native consent invocation --lineage is malformed");
	return lineageId;
}

interface ConsentInvocation {
	arguments_: readonly string[];
	lineageId?: string;
}

function consentInvocationArguments(request: NativeReviewConsentAnswerRequest): ConsentInvocation {
	const choice = request.consent.choices.find((candidate) => candidate.answer === request.answer);
	if (choice === undefined) throw new NativeReviewConsentBindingError("consent-answer-unknown", "Native consent answer must be granted or declined");
	const words = splitNativeConsentInvocation(choice.invocation);
	if (words[0] !== "gentle-ai" || words[1] !== "review" || words[2] !== "start") throw new NativeReviewConsentBindingError("consent-invocation-not-start", "Native consent invocation is not a provider review START");
	const arguments_ = words.slice(1);
	if (exactConsentOption(arguments_, "--contract") !== REVIEW_INTEGRATION_CONTRACT) throw new NativeReviewConsentBindingError("consent-invocation-contract-changed", "Native consent invocation contract changed");
	if (exactConsentOption(arguments_, "--cwd") !== request.cwd) throw new NativeReviewConsentBindingError("consent-invocation-cwd-changed", "Native consent invocation repository binding changed");
	if (exactConsentOption(arguments_, "--target") !== request.consent.targetIdentity) throw new NativeReviewConsentBindingError("consent-invocation-target-changed", "Native consent invocation target binding changed");
	if (exactConsentOption(arguments_, "--projection") !== request.consent.projection) throw new NativeReviewConsentBindingError("consent-invocation-projection-changed", "Native consent invocation projection binding changed");
	const lineageId = optionalConsentLineageOption(arguments_);
	if (exactConsentOption(arguments_, "--consent") !== request.answer || arguments_.at(-1) !== request.answer) throw new NativeReviewConsentBindingError("consent-invocation-answer-changed", "Native consent invocation answer binding changed");
	return { arguments_, ...(lineageId === undefined ? {} : { lineageId }) };
}

function decodeDeclinedConsentStart(value: unknown, expected: NativeReviewConsentAnswerRequest): NativeReviewConsentDeclinedResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Native declined consent result must be an object");
	const body = value as Record<string, unknown>;
	if (body.operation !== "review/start" || body.action !== "declined" || body.consent !== "declined_this_candidate") throw new TypeError("Native declined consent result has an invalid identity");
	if (body.target_identity !== expected.consent.targetIdentity || body.projection !== expected.consent.projection || body.risk_level !== expected.consent.riskLevel) throw new TypeError("Native declined consent result target binding changed");
	if (body.lenses_required !== false || !Array.isArray(body.selected_lenses) || body.selected_lenses.length !== 0 || !Array.isArray(body.lens_bindings) || body.lens_bindings.length !== 0) throw new TypeError("Native declined consent result must create no review authority");
	if (typeof body.changed_files !== "number" || !Number.isSafeInteger(body.changed_files) || body.changed_files < 0 || typeof body.changed_lines !== "number" || !Number.isSafeInteger(body.changed_lines) || body.changed_lines < 0) throw new TypeError("Native declined consent result has invalid change counts");
	if (body.lineage_id !== "" || body.state !== "" || body.correction_budget !== 0) throw new TypeError("Native declined consent result cannot carry review authority");
	return {
		kind: "declined",
		targetIdentity: expected.consent.targetIdentity,
		projection: expected.consent.projection,
		riskLevel: expected.consent.riskLevel,
		changedFiles: body.changed_files,
		changedLines: body.changed_lines,
		consent: "declined_this_candidate",
		raw: body,
	};
}

type NativeExecutableDigestResolver = (path: string) => string;
const nativeCapabilitiesByDigest = new Map<string, Promise<ReviewCapabilitiesV2>>();

export function clearNativeReviewCapabilitiesCacheForTesting(): void {
	nativeCapabilitiesByDigest.clear();
}

function defaultExecutableDigest(path: string): string {
	const before = statSync(path);
	const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
	const after = statSync(path);
	if (
		before.dev !== after.dev ||
		before.ino !== after.ino ||
		before.size !== after.size ||
		before.mtimeMs !== after.mtimeMs
	) throw new Error("native review executable changed during capability verification");
	return digest;
}

interface NegotiatedExecution {
	body: Record<string, unknown>;
	exitCode: number;
}

function decodeNativeAdmittedResultManifest(value: unknown): NativeReviewAdmittedResultManifest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("native capture-result manifest must be an object");
	const body = value as Record<string, unknown>;
	const text = (key: string): string => {
		const found = body[key];
		if (typeof found !== "string" || found.trim() !== found || found.length === 0) throw new TypeError(`native capture-result manifest ${key} must be a non-empty trimmed string`);
		return found;
	};
	const schema = text("schema");
	if (schema !== "gentle-ai.review-result-artifact/v2") throw new TypeError(`native capture-result manifest schema must be gentle-ai.review-result-artifact/v2, received ${schema}`);
	const admission = text("admission_decision");
	if (admission !== "completed") throw new TypeError(`native capture-result manifest admission_decision must be completed, received ${admission}`);
	// Exactly one locator: a provider-owned path OR an opaque reference. Both or
	// neither means the manifest cannot be handed to FINALIZE.
	const hasPath = body.path !== undefined, hasReference = body.reference !== undefined;
	if (hasPath === hasReference) throw new TypeError("native capture-result manifest must carry exactly one of path or reference");
	return Object.freeze({
		schema,
		subjectHash: text("subject_hash"),
		admissionDecision: admission,
		...(body.lens === undefined ? {} : { lens: text("lens") }),
		...(hasPath ? { path: text("path") } : { reference: text("reference") }),
	});
}

export class NativeReviewCliV216 implements NativeReviewCli {
	private readonly legacy: NativeReviewCliV214;
	private readonly adapter: ExecFileAdapter;
	private readonly executable: string | (() => string);
	private readonly timeoutMs: number;
	private readonly maxBufferBytes: number;
	private readonly cleanupDirectory: (directory: string) => Promise<void>;
	private readonly executableDigest: NativeExecutableDigestResolver;
	constructor(
		adapter: ExecFileAdapter,
		executable: string | (() => string) = resolveGentleAiBinary,
		timeoutMs = 30_000,
		maxBufferBytes = resolveNativeReviewMaxBufferBytes(),
		cleanupDirectory: (directory: string) => Promise<void> = (directory) => rm(directory, { recursive: true, force: true }),
		executableDigest: NativeExecutableDigestResolver = defaultExecutableDigest,
	) {
		if (typeof executable === "string" && (!isAbsolute(executable) || executable === "gentle-ai")) throw new TypeError("Native review requires an absolute package-local executable");
		this.adapter = adapter;
		this.executable = executable;
		this.timeoutMs = timeoutMs;
		this.maxBufferBytes = maxBufferBytes;
		this.cleanupDirectory = cleanupDirectory;
		this.executableDigest = executableDigest;
		this.legacy = new NativeReviewCliV214(adapter, executable, timeoutMs, maxBufferBytes, cleanupDirectory);
	}

	private executablePath(operation: NativeReviewOperation, mutating: boolean): string {
		try {
			const path = typeof this.executable === "string" ? this.executable : this.executable();
			if (!isAbsolute(path) || path === "gentle-ai") throw new TypeError("Native review requires an absolute package-local executable");
			return path;
		} catch (error) {
			if (error instanceof PackageLocalGentleAiBinaryMissingError) throw nativeError(NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING, operation, mutating, error.message, undefined, false);
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, operation, mutating, "package-local native process could not start", undefined, false);
		}
	}

	private verifiedExecutable(operation: NativeReviewOperation, mutating: boolean): { path: string; digest: string } {
		const path = this.executablePath(operation, mutating);
		try {
			return { path, digest: this.executableDigest(path) };
		} catch {
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, operation, mutating, "package-local native executable identity could not be verified", undefined, false);
		}
	}

	private async invoke(
		operation: NativeReviewOperation,
		cwd: string,
		arguments_: readonly string[],
		mutating: boolean,
		signal: AbortSignal | undefined,
		path: string,
		toleratedStderr: readonly string[] = [],
	): Promise<NegotiatedExecution> {
		let result: ExecFileResult;
		try {
			result = await this.adapter({ file: path, arguments: arguments_, cwd, timeoutMs: mutating ? undefined : this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, operation, mutating, "native process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, operation, mutating, "native process could not start");
		}
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, operation, mutating, "native process output exceeded limit", result, true, undefined, this.maxBufferBytes);
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, operation, mutating, "native process timed out", result);
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, operation, mutating, "native process was signalled", result);
		const diagnostics = nativeProcessDiagnostics(operation, NATIVE_REVIEW_ERROR_CODE.NON_ZERO, result);
		const body = parseJson(result.stdout, operation, mutating, diagnostics);
		if (result.exitCode !== 0) {
			try {
				throw new NativeReviewIntegrationError(decodeReviewFailureV2(body));
			} catch (error) {
				if (error instanceof NativeReviewIntegrationError) throw error;
				throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, operation, mutating, "native negotiated operation failed without a valid failure envelope", result);
			}
		}
		if (result.stderr.trim().length > 0 && !stderrIsTolerated(result.stderr, toleratedStderr)) throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR, operation, mutating, "native process wrote stderr", result);
		return { body, exitCode: result.exitCode };
	}

	async capabilities(request: NativeCapabilitiesRequest = {}): Promise<ReviewCapabilitiesV2> {
		const executable = this.verifiedExecutable(NATIVE_REVIEW_OPERATION.VERSION, false);
		const cached = nativeCapabilitiesByDigest.get(executable.digest);
		if (cached !== undefined) return cached;
		const negotiation = (async () => {
			const execution = await this.invoke(
				NATIVE_REVIEW_OPERATION.VERSION,
				request.cwd ?? dirname(executable.path),
				["review", "capabilities", "--contract", REVIEW_INTEGRATION_CONTRACT],
				false,
				request.signal,
				executable.path,
			);
			// Two distinct half-upgraded-install failures (Design Decision #7,
			// migrate-review-integration-v2): a decode failure means the installed
			// runtime cannot even answer this shape (an older `.gentle-ai/` payload
			// that still speaks `unsupported_contract` for v2); a successful decode
			// whose package.version disagrees with the pin names both versions.
			let capabilities: ReviewCapabilitiesV2;
			try {
				capabilities = decodeReviewCapabilitiesV2(execution.body, executable.digest);
			} catch (error) {
				if (error instanceof NativeReviewCliError) throw error;
				throw nativeError(NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE, NATIVE_REVIEW_OPERATION.VERSION, false, `expected gentle-ai v${GENTLE_AI_VERSION}; the installed runtime is incompatible — reinstall gentle-pi`);
			}
			if (capabilities.packageVersion !== GENTLE_AI_VERSION) {
				throw nativeError(NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE, NATIVE_REVIEW_OPERATION.VERSION, false, `expected gentle-ai v${GENTLE_AI_VERSION}, provider reported v${capabilities.packageVersion}`);
			}
			return capabilities;
		})();
		nativeCapabilitiesByDigest.set(executable.digest, negotiation);
		try {
			return await negotiation;
		} catch (error) {
			nativeCapabilitiesByDigest.delete(executable.digest);
			throw error;
		}
	}

	private async negotiated(
		operation: NativeReviewOperation,
		cwd: string,
		arguments_: readonly string[],
		mutating: boolean,
		signal?: AbortSignal,
		toleratedStderr: readonly string[] = [],
	): Promise<NegotiatedExecution> {
		const executable = this.verifiedExecutable(operation, mutating);
		await this.capabilities({ cwd, ...(signal === undefined ? {} : { signal }) });
		const afterNegotiation = this.verifiedExecutable(operation, mutating);
		if (afterNegotiation.path !== executable.path || afterNegotiation.digest !== executable.digest) {
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, operation, mutating, "native executable was replaced after capability negotiation", undefined, false);
		}
		return this.invoke(operation, cwd, arguments_, mutating, signal, executable.path, toleratedStderr);
	}

	async start(request: NativeStartRequest): Promise<NativeStartResult> {
		if (request.baseRef !== undefined && !isCanonicalProcessString(request.baseRef)) throw new TypeError("Native START baseRef must be a non-empty, trimmed, NUL-free string");
		if (request.baseRef !== undefined && request.committedOnly !== true) throw new TypeError("Native START baseRef requires explicit committedOnly acknowledgement");
		if (request.baseRef === undefined && request.committedOnly !== undefined) throw new TypeError("Native START committedOnly requires an explicit baseRef");
		if (request.targetIdentity !== undefined && !/^sha256:[0-9a-f]{64}$/.test(request.targetIdentity)) throw new TypeError("Native START targetIdentity must be a canonical sha256 identity");
		// The controller supplies the target it already projected from the
		// authority workspace after proving its immutable actor view is identical.
		// Direct adapter callers may omit it and retain the same-root projection.
		const projection = request.projection ?? "workspace";
		const targetIdentity = request.targetIdentity ?? (await this.targetStatus({
			cwd: request.cwd,
			projection,
			...(request.baseRef === undefined ? {} : { baseRef: request.baseRef }),
			...(request.lineageId === undefined ? {} : { lineageId: request.lineageId }),
			...(request.signal === undefined ? {} : { signal: request.signal }),
		})).targetIdentity;
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.START, request.cwd, [
			"review", "start", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
			"--target", targetIdentity, "--projection", projection,
			...(request.baseRef === undefined ? [] : ["--base-ref", request.baseRef, "--committed-only"]),
			...(request.lineageId === undefined ? [] : ["--lineage", request.lineageId]),
			...(request.policyPath === undefined ? [] : ["--policy", request.policyPath]),
			...(request.focus === undefined ? [] : ["--focus", request.focus]),
			"--consent", "relay",
		], true, request.signal);
		// A negotiated v2 START may answer `consent/v2` (action:
		// "consent_required") instead of `start/v3` when the provider needs an
		// explicit answer it cannot infer. Discriminate before decode and surface
		// the complete envelope; only the caller can map a human answer.
		if (execution.body.action === "consent_required") {
			const consent = decode(NATIVE_REVIEW_OPERATION.START, true, () => decodeReviewConsentV2(execution.body));
			if (consent.targetIdentity !== targetIdentity || consent.projection !== projection) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native consent target binding mismatch");
			throw new NativeReviewConsentRequiredError(consent);
		}
		const result = decode(NATIVE_REVIEW_OPERATION.START, true, () => decodeReviewStartV3(execution.body));
		if (request.lineageId !== undefined && result.lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native start lineage mismatch");
		const resultTarget = result.targetIdentity ?? result.repositoryContext?.targetIdentity;
		if (resultTarget !== undefined && resultTarget !== targetIdentity) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native start target mismatch");
		return {
			lineageId: result.lineageId,
			state: result.state as NativeStartResult["state"],
			riskLevel: result.riskLevel,
			selectedLenses: result.selectedLenses,
			changedFiles: result.changedFiles,
			changedLines: result.changedLines,
			correctionBudget: result.correctionBudget,
			action: result.action as NativeStartAction,
			lensesRequired: result.lensesRequired,
			riskReasons: result.riskReasons.map((reason) => ({ ...reason })),
			// Derived, not received. `risk_reasons` is a required start/v2 field
			// already recomputed against the authoritative frozen snapshot, so
			// these phrases describe the same candidate the lenses will review.
			...(() => {
				const evidence = nativeRiskEvidencePhrases(result.riskLevel, result.riskReasons);
				return evidence.length === 0 ? {} : { riskEvidence: evidence };
			})(),
			// Only the empty-candidate recovery is reconstructed. Its sibling
			// tells a plain caller to rerun under the negotiated contract, which
			// this client already did, so relaying it would name a step that
			// changes nothing. A committed-only start (baseRef) is already the
			// recovery, and reporting zero changes there is a real answer.
			...(result.changedFiles === 0 && request.baseRef === undefined ? { hint: REVIEW_EMPTY_CANDIDATE_HINT } : {}),
			raw: result.raw,
		};
	}

	async answerConsent(request: NativeReviewConsentAnswerRequest): Promise<NativeReviewConsentAnswerResult> {
		const invocation = consentInvocationArguments(request);
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.START, request.cwd, invocation.arguments_, true, request.signal);
		if (request.answer === NATIVE_REVIEW_CONSENT_ANSWER.DECLINED) {
			return decode(NATIVE_REVIEW_OPERATION.START, true, () => decodeDeclinedConsentStart(execution.body, request));
		}
		const result = decode(NATIVE_REVIEW_OPERATION.START, true, () => decodeReviewStartV3(execution.body));
		const answeredTarget = result.targetIdentity ?? result.repositoryContext?.targetIdentity;
		if (answeredTarget !== request.consent.targetIdentity) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native consent answer target mismatch");
		if (invocation.lineageId !== undefined && result.lineageId !== invocation.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native consent answer lineage mismatch");
		return { kind: "started", start: {
			lineageId: result.lineageId,
			state: result.state as NativeStartResult["state"],
			riskLevel: result.riskLevel,
			selectedLenses: result.selectedLenses,
			changedFiles: result.changedFiles,
			changedLines: result.changedLines,
			correctionBudget: result.correctionBudget,
			action: result.action as NativeStartAction,
			lensesRequired: result.lensesRequired,
			riskReasons: result.riskReasons.map((reason) => ({ ...reason })),
			...(() => {
				const evidence = nativeRiskEvidencePhrases(result.riskLevel, result.riskReasons);
				return evidence.length === 0 ? {} : { riskEvidence: evidence };
			})(),
			raw: result.raw,
		} };
	}

	private async stageDocument(directory: string, name: string, document: unknown): Promise<string> {
		const path = join(directory, `${name}.json`);
		await writeFile(path, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
		await chmod(path, 0o600);
		return path;
	}

	private async stageEvidence(directory: string, evidence: string): Promise<string> {
		const path = join(directory, "evidence.txt");
		await writeFile(path, evidence, { encoding: "utf8", mode: 0o600 });
		await chmod(path, 0o600);
		return path;
	}

	async finalize(request: NativeFinalizeRequest): Promise<NativeFinalizeResult> {
		if (request.evidenceDocument !== undefined && request.evidenceDocument.length === 0) throw new TypeError("Native FINALIZE evidence must contain at least one byte");
		// `lensResults`/`resultFiles` are accepted only by the legacy plain-CLI
		// client (NativeReviewCliV214) and its retired `--result` argv. The
		// negotiated V216 client never had a caller for them (Wave 1, #2028 host
		// behavior): reviewer results reach authority exclusively through
		// `review capture-result`, and FINALIZE either discovers them
		// (`--captured-results`) or is handed each admitted manifest explicitly
		// (`--result-artifact-file`). Staging `lensResults` into a tmp document
		// here would write candidate-derived content to disk for an argv that
		// never consumes it, so it is intentionally ignored.
		const needsStaging = request.refuterDocument !== undefined || request.validationDocument !== undefined || request.evidenceDocument !== undefined;
		const directory = needsStaging ? await mkdtemp(join(tmpdir(), "gentle-ai-finalize-")) : undefined;
		try {
			if (directory !== undefined) await chmod(directory, 0o700);
			const refuterFile = directory !== undefined && request.refuterDocument !== undefined ? await this.stageDocument(directory, "refuter", request.refuterDocument) : request.refuterFile;
			const validationFile = directory !== undefined && request.validationDocument !== undefined ? await this.stageDocument(directory, "validation", request.validationDocument) : request.validationFile;
			const evidenceFile = directory !== undefined && request.evidenceDocument !== undefined ? await this.stageEvidence(directory, request.evidenceDocument) : request.evidenceFile;
			const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.FINALIZE, request.cwd, [
				"review", "finalize", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
				...(request.lineageId === undefined ? [] : ["--lineage", request.lineageId]),
				// `--result` is RETIRED. A reviewer result supplied that way carries
				// no provider-owned admission, so it cannot prove the lens inspected
				// the frozen candidate. Results reach authority through
				// `review capture-result`, and FINALIZE either discovers them
				// (`--captured-results`) or is handed each manifest in lens order.
				...(request.capturedResults === true ? ["--captured-results=true"] : []),
				...(request.resultArtifactFiles ?? []).flatMap((path) => ["--result-artifact-file", path]),
				...(refuterFile === undefined ? [] : ["--refuter", refuterFile]),
				...(request.correctionLines === undefined ? [] : ["--correction-lines", String(request.correctionLines)]),
				...(validationFile === undefined ? [] : ["--validation", validationFile]),
				...(evidenceFile === undefined ? [] : ["--evidence", evidenceFile]),
				...(request.failed === true ? ["--failed"] : []),
			], true, request.signal);
			const envelope = decode(NATIVE_REVIEW_OPERATION.FINALIZE, true, () => decodeReviewOperationV2(execution.body));
			if (envelope.operation !== "review.finalize") throw new Error("wrong finalize operation envelope");
			const body = envelope.result;
			const lineageId = requiredString(body.lineage_id);
			if (request.lineageId !== undefined && lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.FINALIZE, true, "native finalize lineage mismatch");
			return {
				lineageId,
				state: requiredString(body.state),
				action: requiredString(body.action),
				storeRevision: requiredString(body.store_revision),
				// Present only when state is correction_required (validated by
				// decodeReviewOperationV2); carried through as the raw validated
				// shape rather than re-decoded, since the typed decoder for this
				// nested object is private to lib/review-integration-v2.ts.
				...(body.validation_request === undefined ? {} : { validationRequest: body.validation_request as Readonly<Record<string, unknown>> }),
				...(body.escalation === undefined ? {} : { escalation: requiredString(body.escalation) }),
			};
		} finally {
			if (directory !== undefined) await this.cleanupDirectory(directory).catch(() => undefined);
		}
	}

	async validate(request: NativeValidateRequest): Promise<NativeValidateResult> {
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.VALIDATE, request.cwd, [
			"review", "validate", "--contract", REVIEW_INTEGRATION_CONTRACT, "--gate", request.gate, "--cwd", request.cwd,
			...(request.lineageId === undefined ? [] : ["--lineage", request.lineageId]),
			...(request.flags ?? []),
		], false, request.signal);
		const envelope = decode(NATIVE_REVIEW_OPERATION.VALIDATE, false, () => decodeReviewOperationV2(execution.body));
		if (envelope.operation !== "review.validate") throw new Error("wrong validate operation envelope");
		const body = envelope.result;
		const gateContext = decodeGateContext(body.context);
		return {
			allowed: booleanValue(body.allowed),
			result: enumString(body.result, NATIVE_GATE_RESULT) as NativeValidateResult["result"],
			action: requiredString(body.action),
			reason: requiredString(body.reason),
			gateContext,
			...(body.delivery === undefined ? {} : { delivery: enumString(body.delivery, ["disabled/unmanaged"]) as NativeValidateResult["delivery"] }),
		};
	}

	async bindSdd(request: NativeBindSddRequest): Promise<NativeBindSddResult> {
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.BIND_SDD, request.cwd, [
			"review", "bind-sdd", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
			"--change", request.change, "--lineage", request.lineage,
			`--expected-binding-revision=${request.expectedBindingRevision}`,
		], true, request.signal);
		const envelope = decode(NATIVE_REVIEW_OPERATION.BIND_SDD, true, () => decodeReviewOperationV2(execution.body));
		if (envelope.operation !== "review.bind_sdd") throw new Error("wrong bind-sdd operation envelope");
		const body = envelope.result;
		const gateContext = decodeGateContext(body.gate_context);
		const lineage = requiredString(body.lineage);
		const change = requiredString(body.change);
		if (lineage !== request.lineage || change !== request.change || gateContext.raw.gate !== "post-apply") throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.BIND_SDD, true, "native binding identity mismatch");
		return {
			revision: requiredString(body.revision),
			change,
			lineage,
			authorityRevision: requiredString(body.authority_revision),
			receiptHash: requiredString(body.receipt_hash),
			gateContext,
		};
	}

	async targetStatus(request: NativeTargetStatusRequest): Promise<ReviewStatusV3> {
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.STATUS, request.cwd, [
			"review", "status", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
			"--projection", request.projection ?? "workspace",
			...(request.baseRef === undefined ? [] : ["--base-ref", request.baseRef]),
			...(request.lineageId === undefined ? [] : ["--lineage", request.lineageId]),
			"--next-transition",
		], false, request.signal);
		assertSupportedNextTransitionOperation(execution.body);
		return decode(NATIVE_REVIEW_OPERATION.STATUS, false, () => decodeReviewStatusV3(execution.body));
	}

	// Net-new negotiated `review.repair`: preflight first, execute only when
	// the assessment is eligible, using exactly the provider_inputs that
	// preflight published (Design Decision #6, migrate-review-integration-v2).
	// Argv shape beyond --mode is inferred from provider_inputs' own field
	// names — no repair/v2 fixture is mirrored upstream to ground-truth it
	// against (design.md Open Questions); this is a documented risk.
	async repair(request: NativeReviewRepairRequest): Promise<ReviewRepairV2> {
		const preflightExecution = await this.negotiated(NATIVE_REVIEW_OPERATION.REPAIR, request.cwd, [
			"review", "repair", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd, "--mode", "preflight",
		], false, request.signal);
		const preflight = decode(NATIVE_REVIEW_OPERATION.REPAIR, false, () => decodeReviewRepairV2(preflightExecution.body));
		if (preflight.mode !== "preflight") throw new Error("wrong repair preflight discriminator");
		if (preflight.assessment.status !== "eligible" || preflight.providerInputs === undefined) return preflight;
		const providerInputs = preflight.providerInputs;
		const executeExecution = await this.negotiated(NATIVE_REVIEW_OPERATION.REPAIR, request.cwd, [
			"review", "repair", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd, "--mode", "execute",
			"--lineage", providerInputs.lineageId,
			"--expected-revision", providerInputs.expectedRevision,
			"--cause", providerInputs.cause,
			"--disposition", providerInputs.disposition,
			"--repository-binding", providerInputs.repositoryBinding,
			"--actor", request.actor,
			"--reason", request.reason,
			"--maintainer-authorization", request.maintainerAuthorization,
		], true, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.REPAIR, true, () => decodeReviewRepairV2(executeExecution.body));
	}

	// `review capture-evidence`: the evidence-first correction lifecycle's
	// collection step. Confirmed argv and response shape against a real v2.2.2
	// review run (lineage review-b39d803b68a90767): exactly
	// --cwd/--lineage/--target/--expected-revision/--outcome/--input, no
	// --contract, and the verification-evidence/v2 record returned DIRECTLY —
	// not wrapped in an operation/v2 envelope. Evidence is staged through the
	// same 0o600 tmpfile discipline FINALIZE uses.
	async captureResult(request: NativeReviewCaptureResultRequest): Promise<NativeReviewAdmittedResultManifest> {
		if (request.argumentTokens.length === 0) throw new TypeError("Native CAPTURE_RESULT requires the provider-issued argument tokens");
		if (request.argumentTokens.some((token) => typeof token !== "string" || token.length === 0)) throw new TypeError("Native CAPTURE_RESULT argument tokens must all be non-empty strings");
		if (request.resultDocument.length === 0) throw new TypeError("Native CAPTURE_RESULT result document must contain at least one byte");
		const carriesContext = request.argumentTokens.some((token) => token === "--repository-context" || token.startsWith("--repository-context="));
		if (carriesContext && request.cwd !== undefined) throw new TypeError("Native CAPTURE_RESULT takes a repository context or --cwd, never both");
		const directory = await mkdtemp(join(tmpdir(), "gentle-ai-capture-result-"));
		try {
			await chmod(directory, 0o700);
			const resultFile = join(directory, "result.json");
			await writeFile(resultFile, request.resultDocument, { encoding: "utf8", mode: 0o600 });
			await chmod(resultFile, 0o600);
			const executable = this.verifiedExecutable(NATIVE_REVIEW_OPERATION.CAPTURE_RESULT, true);
			const execution = await this.invoke(NATIVE_REVIEW_OPERATION.CAPTURE_RESULT, request.cwd ?? process.cwd(), [
				"review", "capture-result",
				...request.argumentTokens,
				...(carriesContext || request.cwd === undefined ? [] : ["--cwd", request.cwd]),
				"--input", resultFile,
			], true, request.signal, executable.path);
			return decode(NATIVE_REVIEW_OPERATION.CAPTURE_RESULT, true, () => decodeNativeAdmittedResultManifest(execution.body));
		} finally {
			await this.cleanupDirectory(directory).catch(() => undefined);
		}
	}

	async captureEvidence(request: NativeReviewCaptureEvidenceRequest): Promise<NativeReviewVerificationEvidenceV2> {
		if (!(NATIVE_REVIEW_CAPTURE_OUTCOME as readonly string[]).includes(request.outcome)) throw new TypeError("Native CAPTURE_EVIDENCE outcome must be passed, verification_failed, or procedural_tooling_failed");
		if (request.evidenceDocument.length === 0) throw new TypeError("Native CAPTURE_EVIDENCE evidence must contain at least one byte");
		const directory = await mkdtemp(join(tmpdir(), "gentle-ai-capture-evidence-"));
		try {
			await chmod(directory, 0o700);
			const evidenceFile = await this.stageEvidence(directory, request.evidenceDocument);
			const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.CAPTURE_EVIDENCE, request.cwd, [
				"review", "capture-evidence", "--cwd", request.cwd,
				"--lineage", request.lineageId,
				"--target", request.targetIdentity,
				"--expected-revision", request.expectedRevision,
				"--outcome", request.outcome,
				"--input", evidenceFile,
			], true, request.signal);
			return decode(NATIVE_REVIEW_OPERATION.CAPTURE_EVIDENCE, true, () => decodeNativeReviewVerificationEvidence(execution.body));
		} finally {
			await this.cleanupDirectory(directory).catch(() => undefined);
		}
	}

	reviewStatus(request: NativeReviewStatusRequest): Promise<NativeReviewStatusResult> {
		return this.legacy.reviewStatus(request);
	}

	sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusResult> {
		return this.legacy.sddStatus(request);
	}

	// Same plain-CLI delegation as reviewStatus/sddStatus above: `review mode`
	// is dark until the negotiated version reports `mode: true` and stays
	// outside the negotiated integration-v1 contract.
	reviewMode(request: NativeReviewModeRequest): Promise<NativeReviewModeResult> {
		return this.legacy.reviewMode(request);
	}

	// Recovery commands are version-gated plain CLI operations outside the
	// negotiated integration-v1 contract, exactly like reviewStatus/sddStatus.
	reclaim(request: NativeReviewReclaimRequest): Promise<NativeReviewRecoveryResult> {
		return this.legacy.reclaim(request);
	}

	recover(request: NativeReviewRecoverRequest): Promise<NativeReviewRecoveryResult> {
		return this.legacy.recover(request);
	}

	abandon(request: NativeReviewAbandonRequest): Promise<NativeReviewRecoveryResult> {
		return this.legacy.abandon(request);
	}

	quarantineLegacy(request: NativeReviewLegacyQuarantineRequest): Promise<NativeReviewRecoveryResult> {
		return this.legacy.quarantineLegacy(request);
	}

	reconcileAuthority(request: NativeReviewReconcileAuthorityRequest): Promise<NativeReviewRecoveryResult> {
		return this.legacy.reconcileAuthority(request);
	}

	repairLegacyAlias(request: NativeReviewLegacyAliasRepairRequest): Promise<NativeReviewRecoveryResult> {
		return this.legacy.repairLegacyAlias(request);
	}
}

export function createNativeReviewCli(adapter?: ExecFileAdapter, executable: string | (() => string) = resolveGentleAiBinary): NativeReviewCli {
	if (adapter !== undefined) return new NativeReviewCliV214(adapter, executable);
	return new NativeReviewCliV216(createNodeExecFileAdapter(), executable);
}

// Response-schema fixtures remain v2.1.3 historical contracts; the production
// client above accepts only the v2.1.4 runtime release.
export { NativeReviewCliV214 as NativeReviewCliV213 };
