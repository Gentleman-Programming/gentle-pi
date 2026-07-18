import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, win32 } from "node:path";
import { promisify } from "node:util";
import { PackageLocalGentleAiBinaryMissingError, resolveGentleAiBinary } from "./gentle-ai-binary.ts";
import {
	REVIEW_INTEGRATION_CONTRACT,
	decodeReviewCapabilitiesV1,
	decodeReviewFailureV1,
	decodeReviewOperationV1,
	decodeReviewStartV1,
	decodeReviewStatusV1,
	type ReviewCapabilitiesV1,
	type ReviewFailureV1,
	type ReviewStartState,
	type ReviewStatusV1,
} from "./review-integration-v1.ts";

const execFileAsync = promisify(execFile);

export const NATIVE_REVIEW_OPERATION = {
	VERSION: "version",
	START: "review/start",
	FINALIZE: "review/finalize",
	VALIDATE: "review/validate",
	BIND_SDD: "review/bind-sdd",
	SDD_STATUS: "sdd-status",
	STATUS: "review/status",
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
	capabilities?(request?: NativeCapabilitiesRequest): Promise<ReviewCapabilitiesV1>;
	targetStatus?(request: NativeTargetStatusRequest): Promise<ReviewStatusV1>;
}

export interface NativeStartRequest { cwd: string; baseRef?: string; committedOnly?: boolean; lineageId?: string; policyPath?: string; focus?: string; signal?: AbortSignal; }
export interface NativeFinalizeLensResult { lens: string; document: unknown; }
export interface NativeFinalizeRequest {
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
export interface NativeStartResult { lineageId: string; state: ReviewStartState; riskLevel: string; selectedLenses: readonly string[]; changedFiles: number; changedLines: number; correctionBudget: number; action: NativeStartAction; lensesRequired: boolean; riskReasons?: readonly Record<string, unknown>[]; raw?: Readonly<Record<string, unknown>>; }
export interface NativeValidateResult { allowed: boolean; result: "allow" | "scope-changed" | "invalidated" | "escalated"; action: string; reason: string; gateContext: NativeGateContext; }
export interface NativeFinalizeResult { lineageId: string; state: string; action: string; storeRevision: string; receiptPath?: string; }
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
const NATIVE_REVIEW_LENS = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
const NATIVE_FINALIZE_STATE = ["reviewing", "correction_required", "validating", "approved", "escalated"] as const;
const NATIVE_START_ACTION_VALUES = Object.values(NATIVE_START_ACTION);
const NATIVE_GATE_RESULT = ["allow", "scope-changed", "invalidated", "escalated"] as const;
const NATIVE_GATE = ["post-apply", "pre-commit", "pre-push", "pre-pr", "release"] as const;
const NATIVE_SDD_NEXT_ACTION = ["apply", "verify", "remediate", "archive", "review", "resolve-review", "resolve-blockers", "sdd-new", "select-change", "propose", "spec", "design", "tasks"] as const;
const NATIVE_SDD_POST_REVIEW_ACTION = ["verify", "archive"] as const;

export const NATIVE_CLI_CONTRACTS = Object.freeze({
	"2.1.4": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: false, inventory: false }),
	"2.1.5": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true }),
	"2.1.6": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true }),
	"2.1.7": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: true, inventory: true }),
});
type NativeCliCapability = keyof (typeof NATIVE_CLI_CONTRACTS)[keyof typeof NATIVE_CLI_CONTRACTS];

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
	constructor(code: NativeReviewErrorCode, operation: NativeReviewOperation, launchAttempted: boolean, mutating: boolean, message: string, diagnostics?: NativeReviewProcessDiagnostics) {
		super(message);
		this.name = "NativeReviewCliError";
		this.code = code;
		this.operation = operation;
		this.launchAttempted = launchAttempted;
		this.mutating = mutating;
		this.mutationOutcome = launchAttempted && mutating ? "unknown" : "none";
		this.nextAction = this.mutationOutcome === "unknown" ? "review.status" : undefined;
		this.diagnostics = diagnostics ?? { operation, error_code: code, timed_out: false, output_limit_exceeded: false };
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
			return { stdout: detail.stdout ?? "", stderr: detail.stderr ?? "", exitCode: typeof detail.code === "number" ? detail.code : 1, signal: detail.signal ?? null, timedOut: detail.killed === true, outputLimitExceeded: detail.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" };
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

function nativeProcessDiagnostics(operation: NativeReviewOperation, code: NativeReviewErrorCode, result?: ExecFileResult): NativeReviewProcessDiagnostics {
	return {
		operation,
		error_code: code,
		...(result === undefined ? {} : { exit_code: result.exitCode }),
		...(result?.signal === null || result?.signal === undefined ? {} : { signal: result.signal }),
		timed_out: result?.timedOut === true,
		output_limit_exceeded: result?.outputLimitExceeded === true,
		...(result?.stderr.trim() ? { stderr: sanitizeNativeDiagnosticText(result.stderr) } : {}),
		...(result === undefined ? {} : { denial: parseStructuredNativeDenial(result.stdout) }),
	};
}

function parseJson(stdout: string, operation: NativeReviewOperation, mutating: boolean, diagnostics: NativeReviewProcessDiagnostics): Record<string, unknown> {
	if (stdout.length === 0) throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT, operation, true, mutating, "native command returned empty output", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT });
	try { return object(JSON.parse(stdout)); } catch { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON, operation, true, mutating, "native command returned malformed JSON", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON }); }
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
	const entry = exactObject(value, ["version", "path", "status", "problems"], ["lineage_id", "state", "revision", "chain_identity", "recovery"]);
	return {
		version: enumString(entry.version, Object.values(NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION)) as NativeReviewAuthorityEntryVersion,
		...(entry.lineage_id === undefined ? {} : { lineageId: requiredString(entry.lineage_id) }),
		path: requiredString(entry.path),
		status: enumString(entry.status, Object.values(NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS)) as NativeReviewAuthorityEntryStatus,
		...(entry.state === undefined ? {} : { state: requiredString(entry.state) }),
		...(entry.revision === undefined ? {} : { revision: requiredString(entry.revision) }),
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

function nativeError(code: NativeReviewErrorCode, operation: NativeReviewOperation, mutating: boolean, message: string, result?: ExecFileResult, launchAttempted = true): NativeReviewCliError {
	return new NativeReviewCliError(code, operation, launchAttempted, mutating, message, nativeProcessDiagnostics(operation, code, result));
}

interface NativeJsonExecution {
	body: Record<string, unknown>;
	exitCode: number;
}

export class NativeReviewCliV214 {
	private readonly adapter: ExecFileAdapter;
	private readonly executable: string | (() => string);
	private readonly timeoutMs: number;
	private readonly maxBufferBytes: number;
	private readonly cleanupDirectory: (directory: string) => Promise<void>;
	constructor(adapter: ExecFileAdapter, executable: string | (() => string) = resolveGentleAiBinary, timeoutMs = 30_000, maxBufferBytes = 1024 * 1024, cleanupDirectory = (directory: string) => rm(directory, { recursive: true, force: true })) {
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

	private async execute(operation: NativeReviewOperation, cwd: string, arguments_: readonly string[], mutating: boolean, signal?: AbortSignal): Promise<NativeJsonExecution> {
		let result: ExecFileResult;
		try { result = await this.adapter({ file: this.executablePath(operation, mutating), arguments: arguments_, cwd, timeoutMs: mutating ? undefined : this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal }); }
		catch (error) {
			if (error instanceof NativeReviewCliError) throw nativeError(error.code, operation, mutating, error.message, undefined, error.launchAttempted);
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, operation, mutating, "native process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, operation, mutating, "native process could not start");
		}
		const diagnostics = nativeProcessDiagnostics(operation, NATIVE_REVIEW_ERROR_CODE.NON_ZERO, result);
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, operation, mutating, "native process timed out", result);
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, operation, mutating, "native process output exceeded limit", result);
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, operation, mutating, "native process was signalled", result);
		const structuredValidateDenial = operation === NATIVE_REVIEW_OPERATION.VALIDATE && result.exitCode === 1;
		if (result.exitCode !== 0 && !structuredValidateDenial) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, operation, mutating, "native process failed", result);
		if (result.stderr.trim().length > 0 && !structuredValidateDenial) throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR, operation, mutating, "native process wrote stderr", result);
		return { body: parseJson(result.stdout, operation, mutating, diagnostics), exitCode: result.exitCode };
	}

	private async verifyVersion(cwd: string, signal: AbortSignal | undefined, capabilities: readonly NativeCliCapability[]): Promise<void> {
		let result: ExecFileResult;
		try { result = await this.adapter({ file: this.executablePath(NATIVE_REVIEW_OPERATION.VERSION, false), arguments: ["version"], cwd, timeoutMs: this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal }); }
		catch (error) {
			if (error instanceof NativeReviewCliError) throw error;
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, NATIVE_REVIEW_OPERATION.VERSION, false, "version process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, NATIVE_REVIEW_OPERATION.VERSION, false, "gentle-ai is unavailable");
		}
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process timed out", result);
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process output exceeded limit", result);
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, NATIVE_REVIEW_OPERATION.VERSION, false, "version process was signalled", result);
		if (result.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.VERSION, false, "version process failed", result);
		const version = /^gentle-ai ([0-9]+\.[0-9]+\.[0-9]+)\n$/.exec(result.stdout.replace(/\r\n$/, "\n"))?.[1];
		const contract = version === undefined ? undefined : NATIVE_CLI_CONTRACTS[version as keyof typeof NATIVE_CLI_CONTRACTS];
		if (result.stderr.trim().length > 0 || contract === undefined || capabilities.some((capability) => !contract[capability])) throw nativeError(NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE, NATIVE_REVIEW_OPERATION.VERSION, false, "native gentle-ai lacks required capabilities");
	}

	async start(request: NativeStartRequest): Promise<NativeStartResult> {
		if (request.baseRef !== undefined && !isCanonicalProcessString(request.baseRef)) throw new TypeError("Native START baseRef must be a non-empty, trimmed, NUL-free string");
		if (request.committedOnly !== undefined && typeof request.committedOnly !== "boolean") throw new TypeError("Native START committedOnly must be a boolean when supplied");
		if (request.baseRef !== undefined && request.committedOnly !== true) throw new TypeError("Native START baseRef requires explicit committedOnly acknowledgement");
		if (request.baseRef === undefined && request.committedOnly !== undefined) throw new TypeError("Native START committedOnly requires an explicit baseRef");
		await this.verifyVersion(request.cwd, request.signal, ["start"]);
		const { body: result } = await this.execute(NATIVE_REVIEW_OPERATION.START, request.cwd, ["review", "start", "--cwd", request.cwd, ...(request.baseRef === undefined ? [] : ["--base-ref", request.baseRef, "--committed-only"]), ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...(request.policyPath ? ["--policy", request.policyPath] : []), ...(request.focus ? ["--focus", request.focus] : [])], true, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.START, true, () => {
			const body = exactObject(result, ["operation", "lineage_id", "state", "risk_level", "selected_lenses", "changed_files", "changed_lines", "correction_budget", "action", "lenses_required", "projection"]);
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
			return { lineageId, state: body.state as NativeStartResult["state"], riskLevel, selectedLenses, changedFiles: nonNegativeInteger(body.changed_files), changedLines: nonNegativeInteger(body.changed_lines), correctionBudget: nonNegativeInteger(body.correction_budget), action, lensesRequired };
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
			const body = exactObject(execution.body, ["schema", "result", "allowed", "action", "reason", "context"]);
			const gateResult = enumString(body.result, NATIVE_GATE_RESULT) as NativeValidateResult["result"];
			const action = sanitizeNativeDiagnosticText(requiredString(body.action), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
			const reason = sanitizeNativeDiagnosticText(requiredString(body.reason), NATIVE_REVIEW_DENIAL_TEXT_LIMIT);
			const expectedAction = { allow: "continue", "scope-changed": "create-new-lineage", invalidated: "explicit-maintainer-action", escalated: "stop" }[gateResult];
			const expectedExitCode = gateResult === "allow" ? 0 : 1;
			if (body.schema !== "gentle-ai.review-gate-result/v1" || typeof body.allowed !== "boolean" || body.allowed !== (gateResult === "allow") || action !== expectedAction || !isCanonicalProcessString(action) || !isCanonicalProcessString(reason) || execution.exitCode !== expectedExitCode) throw new Error("wrong validate discriminator");
			const gateContext = decodeGateContext(body.context);
			const returnedGate = gateContext.raw.gate;
			if (returnedGate !== request.gate && (gateResult === "allow" || returnedGate !== "")) throw new Error("native gate context does not match the requested gate");
			if (request.lineageId && returnedGate !== "" && gateContext.lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.VALIDATE, false, "native gate lineage mismatch");
			return { allowed: body.allowed, result: gateResult, action, reason, gateContext };
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
			const remediation = exactObject(body.remediationState, ["required", "complete", "failedEvidenceRevision", "lineageId", "generation", "fixBatch", "reason"]);
			if (typeof remediation.required !== "boolean" || typeof remediation.complete !== "boolean" || ["failedEvidenceRevision", "lineageId", "reason"].some((field) => typeof remediation[field] !== "string")) throw new Error("invalid remediation state");
			nonNegativeInteger(remediation.generation); nonNegativeInteger(remediation.fixBatch);
			let reviewGateResult: string | undefined;
			if (body.reviewGate !== undefined) {
				const gate = exactObject(body.reviewGate, ["result", "reason"]);
				reviewGateResult = enumString(gate.result, NATIVE_GATE_RESULT); requiredString(gate.reason);
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
					reviewGateResult === "allow",
			};
		});
	}
}

export class NativeReviewIntegrationError extends Error {
	readonly failureEnvelope: ReviewFailureV1;
	readonly mutationOutcome: ReviewFailureV1["mutationOutcome"];
	readonly nextAction: string;
	readonly launchAttempted = true;
	constructor(failure: ReviewFailureV1) {
		super(failure.message);
		this.name = "NativeReviewIntegrationError";
		this.failureEnvelope = failure;
		this.mutationOutcome = failure.mutationOutcome;
		this.nextAction = failure.nextAction;
	}
}

type NativeExecutableDigestResolver = (path: string) => string;
const nativeCapabilitiesByDigest = new Map<string, Promise<ReviewCapabilitiesV1>>();

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
		maxBufferBytes = 1024 * 1024,
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
	): Promise<NegotiatedExecution> {
		let result: ExecFileResult;
		try {
			result = await this.adapter({ file: path, arguments: arguments_, cwd, timeoutMs: mutating ? undefined : this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, operation, mutating, "native process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, operation, mutating, "native process could not start");
		}
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, operation, mutating, "native process timed out", result);
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, operation, mutating, "native process output exceeded limit", result);
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, operation, mutating, "native process was signalled", result);
		const diagnostics = nativeProcessDiagnostics(operation, NATIVE_REVIEW_ERROR_CODE.NON_ZERO, result);
		const body = parseJson(result.stdout, operation, mutating, diagnostics);
		if (result.exitCode !== 0) {
			try {
				throw new NativeReviewIntegrationError(decodeReviewFailureV1(body));
			} catch (error) {
				if (error instanceof NativeReviewIntegrationError) throw error;
				throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, operation, mutating, "native negotiated operation failed without a valid failure envelope", result);
			}
		}
		if (result.stderr.trim().length > 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR, operation, mutating, "native process wrote stderr", result);
		return { body, exitCode: result.exitCode };
	}

	async capabilities(request: NativeCapabilitiesRequest = {}): Promise<ReviewCapabilitiesV1> {
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
			return decode(NATIVE_REVIEW_OPERATION.VERSION, false, () => decodeReviewCapabilitiesV1(execution.body, executable.digest));
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
	): Promise<NegotiatedExecution> {
		const executable = this.verifiedExecutable(operation, mutating);
		await this.capabilities({ cwd, ...(signal === undefined ? {} : { signal }) });
		const afterNegotiation = this.verifiedExecutable(operation, mutating);
		if (afterNegotiation.path !== executable.path || afterNegotiation.digest !== executable.digest) {
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, operation, mutating, "native executable was replaced after capability negotiation", undefined, false);
		}
		return this.invoke(operation, cwd, arguments_, mutating, signal, executable.path);
	}

	async start(request: NativeStartRequest): Promise<NativeStartResult> {
		if (request.baseRef !== undefined && !isCanonicalProcessString(request.baseRef)) throw new TypeError("Native START baseRef must be a non-empty, trimmed, NUL-free string");
		if (request.baseRef !== undefined && request.committedOnly !== true) throw new TypeError("Native START baseRef requires explicit committedOnly acknowledgement");
		if (request.baseRef === undefined && request.committedOnly !== undefined) throw new TypeError("Native START committedOnly requires an explicit baseRef");
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.START, request.cwd, [
			"review", "start", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
			...(request.baseRef === undefined ? [] : ["--base-ref", request.baseRef, "--committed-only"]),
			...(request.lineageId === undefined ? [] : ["--lineage", request.lineageId]),
			...(request.policyPath === undefined ? [] : ["--policy", request.policyPath]),
			...(request.focus === undefined ? [] : ["--focus", request.focus]),
		], true, request.signal);
		const result = decode(NATIVE_REVIEW_OPERATION.START, true, () => decodeReviewStartV1(execution.body));
		if (request.lineageId !== undefined && result.lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native start lineage mismatch");
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
			raw: result.raw,
		};
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
		const needsStaging = request.lensResults !== undefined || request.refuterDocument !== undefined || request.validationDocument !== undefined || request.evidenceDocument !== undefined;
		const directory = needsStaging ? await mkdtemp(join(tmpdir(), "gentle-ai-finalize-")) : undefined;
		try {
			if (directory !== undefined) await chmod(directory, 0o700);
			const resultFiles = directory !== undefined && request.lensResults !== undefined ? await Promise.all(request.lensResults.map((entry, index) => this.stageDocument(directory, `result-${index}`, entry.document))) : request.resultFiles ?? [];
			const refuterFile = directory !== undefined && request.refuterDocument !== undefined ? await this.stageDocument(directory, "refuter", request.refuterDocument) : request.refuterFile;
			const validationFile = directory !== undefined && request.validationDocument !== undefined ? await this.stageDocument(directory, "validation", request.validationDocument) : request.validationFile;
			const evidenceFile = directory !== undefined && request.evidenceDocument !== undefined ? await this.stageEvidence(directory, request.evidenceDocument) : request.evidenceFile;
			const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.FINALIZE, request.cwd, [
				"review", "finalize", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
				...(request.lineageId === undefined ? [] : ["--lineage", request.lineageId]),
				...resultFiles.flatMap((path) => ["--result", path]),
				...(refuterFile === undefined ? [] : ["--refuter", refuterFile]),
				...(request.correctionLines === undefined ? [] : ["--correction-lines", String(request.correctionLines)]),
				...(validationFile === undefined ? [] : ["--validation", validationFile]),
				...(evidenceFile === undefined ? [] : ["--evidence", evidenceFile]),
				...(request.failed === true ? ["--failed"] : []),
			], true, request.signal);
			const envelope = decode(NATIVE_REVIEW_OPERATION.FINALIZE, true, () => decodeReviewOperationV1(execution.body));
			if (envelope.operation !== "review.finalize") throw new Error("wrong finalize operation envelope");
			const body = envelope.result;
			const lineageId = requiredString(body.lineage_id);
			if (request.lineageId !== undefined && lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.FINALIZE, true, "native finalize lineage mismatch");
			return {
				lineageId,
				state: requiredString(body.state),
				action: requiredString(body.action),
				storeRevision: requiredString(body.store_revision),
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
		const envelope = decode(NATIVE_REVIEW_OPERATION.VALIDATE, false, () => decodeReviewOperationV1(execution.body));
		if (envelope.operation !== "review.validate") throw new Error("wrong validate operation envelope");
		const body = envelope.result;
		const gateContext = decodeGateContext(body.context);
		return {
			allowed: booleanValue(body.allowed),
			result: enumString(body.result, NATIVE_GATE_RESULT) as NativeValidateResult["result"],
			action: requiredString(body.action),
			reason: requiredString(body.reason),
			gateContext,
		};
	}

	async bindSdd(request: NativeBindSddRequest): Promise<NativeBindSddResult> {
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.BIND_SDD, request.cwd, [
			"review", "bind-sdd", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
			"--change", request.change, "--lineage", request.lineage,
			`--expected-binding-revision=${request.expectedBindingRevision}`,
		], true, request.signal);
		const envelope = decode(NATIVE_REVIEW_OPERATION.BIND_SDD, true, () => decodeReviewOperationV1(execution.body));
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

	async targetStatus(request: NativeTargetStatusRequest): Promise<ReviewStatusV1> {
		const execution = await this.negotiated(NATIVE_REVIEW_OPERATION.STATUS, request.cwd, [
			"review", "status", "--contract", REVIEW_INTEGRATION_CONTRACT, "--cwd", request.cwd,
			"--projection", request.projection ?? "workspace",
			...(request.baseRef === undefined ? [] : ["--base-ref", request.baseRef]),
			...(request.lineageId === undefined ? [] : ["--lineage", request.lineageId]),
		], false, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.STATUS, false, () => decodeReviewStatusV1(execution.body));
	}

	reviewStatus(request: NativeReviewStatusRequest): Promise<NativeReviewStatusResult> {
		return this.legacy.reviewStatus(request);
	}

	sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusResult> {
		return this.legacy.sddStatus(request);
	}
}

export function createNativeReviewCli(adapter?: ExecFileAdapter, executable: string | (() => string) = resolveGentleAiBinary): NativeReviewCli {
	if (adapter !== undefined) return new NativeReviewCliV214(adapter, executable);
	return new NativeReviewCliV216(createNodeExecFileAdapter(), executable);
}

// Response-schema fixtures remain v2.1.3 historical contracts; the production
// client above accepts only the v2.1.4 runtime release.
export { NativeReviewCliV214 as NativeReviewCliV213 };
