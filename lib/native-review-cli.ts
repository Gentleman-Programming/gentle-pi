import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const NATIVE_REVIEW_OPERATION = {
	VERSION: "version",
	START: "review/start",
	FINALIZE: "review/finalize",
	VALIDATE: "review/validate",
	BIND_SDD: "review/bind-sdd",
	SDD_STATUS: "sdd-status",
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
} as const;
export type NativeReviewErrorCode = (typeof NATIVE_REVIEW_ERROR_CODE)[keyof typeof NATIVE_REVIEW_ERROR_CODE];

export interface ExecFileRequest { file: string; arguments: readonly string[]; cwd: string; timeoutMs: number; maxBufferBytes: number; signal?: AbortSignal; }
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
}

export interface NativeStartRequest { cwd: string; baseRef?: string; lineageId?: string; policyPath?: string; focus?: string; signal?: AbortSignal; }
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
export interface NativeGateContext { lineageId: string; storeRevision: string; raw: Record<string, unknown>; }
export interface NativeStartResult { lineageId: string; state: "reviewing"; riskLevel: string; selectedLenses: readonly string[]; changedFiles: number; changedLines: number; correctionBudget: number; }
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
const NATIVE_GATE_RESULT = ["allow", "scope-changed", "invalidated", "escalated"] as const;
const NATIVE_GATE = ["post-apply", "pre-commit", "pre-push", "pre-pr", "release"] as const;
const NATIVE_SDD_NEXT_ACTION = ["apply", "verify", "remediate", "archive", "review", "resolve-review", "resolve-blockers", "sdd-new", "select-change", "propose", "spec", "design", "tasks"] as const;
const NATIVE_SDD_POST_REVIEW_ACTION = ["verify", "archive"] as const;

export const NATIVE_CLI_CONTRACTS = Object.freeze({
	"2.1.2": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: false, inventory: false }),
});

export class NativeReviewCliError extends Error {
	readonly code: NativeReviewErrorCode;
	readonly operation: NativeReviewOperation;
	readonly launchAttempted: boolean;
	readonly mutating: boolean;
	readonly mutationOutcome: "none" | "unknown";
	readonly nextAction?: "replay-exact-native-operation";
	constructor(code: NativeReviewErrorCode, operation: NativeReviewOperation, launchAttempted: boolean, mutating: boolean, message: string) {
		super(message);
		this.name = "NativeReviewCliError";
		this.code = code;
		this.operation = operation;
		this.launchAttempted = launchAttempted;
		this.mutating = mutating;
		this.mutationOutcome = launchAttempted && mutating ? "unknown" : "none";
		this.nextAction = this.mutationOutcome === "unknown" ? "replay-exact-native-operation" : undefined;
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
function stringArray(value: unknown): readonly string[] { if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) throw new Error("expected string array"); return value; }
function enumString(value: unknown, allowed: readonly string[]): string { const parsed = stringValue(value); if (!allowed.includes(parsed)) throw new Error("unsupported enum"); return parsed; }
function parseJson(stdout: string, operation: NativeReviewOperation, mutating: boolean): Record<string, unknown> {
	if (stdout.length === 0) throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT, operation, true, mutating, "native command returned empty output");
	try { return object(JSON.parse(stdout)); } catch { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON, operation, true, mutating, "native command returned malformed JSON"); }
}
function decode<T>(operation: NativeReviewOperation, mutating: boolean, callback: () => T): T {
	try { return callback(); } catch (error) { if (error instanceof NativeReviewCliError) throw error; throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE, operation, true, mutating, "native response is schema incompatible"); }
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
	if (context.denial !== undefined) {
		const denial = exactObject(context.denial, ["stage", "code"]);
		requiredString(denial.stage); requiredString(denial.code);
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
		raw: context,
	};
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
function nativeError(code: NativeReviewErrorCode, operation: NativeReviewOperation, mutating: boolean, message: string): NativeReviewCliError {
	return new NativeReviewCliError(code, operation, true, mutating, message);
}

interface NativeJsonExecution {
	body: Record<string, unknown>;
	exitCode: number;
}

export class NativeReviewCliV212 {
	private readonly adapter: ExecFileAdapter;
	private readonly executable: string;
	private readonly timeoutMs: number;
	private readonly maxBufferBytes: number;
	private readonly cleanupDirectory: (directory: string) => Promise<void>;
	constructor(adapter: ExecFileAdapter, executable = "gentle-ai", timeoutMs = 30_000, maxBufferBytes = 1024 * 1024, cleanupDirectory = (directory: string) => rm(directory, { recursive: true, force: true })) {
		this.adapter = adapter;
		this.executable = executable;
		this.timeoutMs = timeoutMs;
		this.maxBufferBytes = maxBufferBytes;
		this.cleanupDirectory = cleanupDirectory;
	}

	private async execute(operation: NativeReviewOperation, cwd: string, arguments_: readonly string[], mutating: boolean, signal?: AbortSignal): Promise<NativeJsonExecution> {
		let result: ExecFileResult;
		try { result = await this.adapter({ file: this.executable, arguments: arguments_, cwd, timeoutMs: this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal }); }
		catch (error) {
			if (error instanceof NativeReviewCliError) throw nativeError(error.code, operation, mutating, error.message);
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, operation, mutating, "native process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, operation, mutating, "native process could not start");
		}
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, operation, mutating, "native process timed out");
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, operation, mutating, "native process output exceeded limit");
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, operation, mutating, "native process was signalled");
		const structuredValidateDenial = operation === NATIVE_REVIEW_OPERATION.VALIDATE && result.exitCode === 1;
		if (result.exitCode !== 0 && !structuredValidateDenial) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, operation, mutating, "native process failed");
		if (result.stderr.trim().length > 0 && !structuredValidateDenial) throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR, operation, mutating, "native process wrote stderr");
		return { body: parseJson(result.stdout, operation, mutating), exitCode: result.exitCode };
	}

	private async verifyVersion(cwd: string, signal?: AbortSignal): Promise<void> {
		let result: ExecFileResult;
		try { result = await this.adapter({ file: this.executable, arguments: ["version"], cwd, timeoutMs: this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal }); }
		catch (error) {
			if (error instanceof Error && error.name === "AbortError") throw nativeError(NATIVE_REVIEW_ERROR_CODE.CANCELLED, NATIVE_REVIEW_OPERATION.VERSION, false, "version process was cancelled");
			throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, NATIVE_REVIEW_OPERATION.VERSION, false, "gentle-ai is unavailable");
		}
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process timed out");
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process output exceeded limit");
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, NATIVE_REVIEW_OPERATION.VERSION, false, "version process was signalled");
		if (result.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.VERSION, false, "version process failed");
		if (result.stderr.trim().length > 0 || result.stdout.replace(/\r\n$/, "\n") !== "gentle-ai 2.1.2\n") throw nativeError(NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE, NATIVE_REVIEW_OPERATION.VERSION, false, "gentle-ai 2.1.2 is required");
	}

	async start(request: NativeStartRequest): Promise<NativeStartResult> {
		if (request.baseRef !== undefined && !isCanonicalProcessString(request.baseRef)) throw new TypeError("Native START baseRef must be a non-empty, trimmed, NUL-free string");
		await this.verifyVersion(request.cwd, request.signal);
		const { body: result } = await this.execute(NATIVE_REVIEW_OPERATION.START, request.cwd, ["review", "start", "--cwd", request.cwd, ...(request.baseRef === undefined ? [] : ["--base-ref", request.baseRef]), ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...(request.policyPath ? ["--policy", request.policyPath] : []), ...(request.focus ? ["--focus", request.focus] : [])], true, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.START, true, () => {
			const body = exactObject(result, ["operation", "lineage_id", "state", "risk_level", "selected_lenses", "changed_files", "changed_lines", "correction_budget"]);
			if (body.operation !== "review/start" || body.state !== "reviewing") throw new Error("wrong start discriminator");
			const lineageId = requiredString(body.lineage_id);
			if (request.lineageId && lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.START, true, "native start lineage mismatch");
			const riskLevel = requiredString(body.risk_level);
			const selectedLenses = stringArray(body.selected_lenses);
			if (!(NATIVE_RISK_LEVEL as readonly string[]).includes(riskLevel) || selectedLenses.some((lens) => !(NATIVE_REVIEW_LENS as readonly string[]).includes(lens))) throw new Error("unknown start enum");
			return { lineageId, state: "reviewing", riskLevel, selectedLenses, changedFiles: nonNegativeInteger(body.changed_files), changedLines: nonNegativeInteger(body.changed_lines), correctionBudget: nonNegativeInteger(body.correction_budget) };
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
		await this.verifyVersion(request.cwd, request.signal);
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
		await this.verifyVersion(request.cwd, request.signal);
		const execution = await this.execute(NATIVE_REVIEW_OPERATION.VALIDATE, request.cwd, ["review", "validate", "--gate", request.gate, "--cwd", request.cwd, ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...(request.flags ?? [])], false, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.VALIDATE, false, () => {
			const body = exactObject(execution.body, ["schema", "result", "allowed", "action", "reason", "context"]);
			const gateResult = enumString(body.result, NATIVE_GATE_RESULT) as NativeValidateResult["result"];
			const action = requiredString(body.action);
			const expectedAction = { allow: "continue", "scope-changed": "create-new-lineage", invalidated: "explicit-maintainer-action", escalated: "stop" }[gateResult];
			const expectedExitCode = gateResult === "allow" ? 0 : 1;
			if (body.schema !== "gentle-ai.review-gate-result/v1" || typeof body.allowed !== "boolean" || body.allowed !== (gateResult === "allow") || action !== expectedAction || execution.exitCode !== expectedExitCode) throw new Error("wrong validate discriminator");
			const gateContext = decodeGateContext(body.context);
			const returnedGate = gateContext.raw.gate;
			if (returnedGate !== request.gate && (gateResult === "allow" || returnedGate !== "")) throw new Error("native gate context does not match the requested gate");
			if (request.lineageId && returnedGate !== "" && gateContext.lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.VALIDATE, false, "native gate lineage mismatch");
			return { allowed: body.allowed, result: gateResult, action, reason: requiredString(body.reason), gateContext };
		});
	}

	async bindSdd(request: NativeBindSddRequest): Promise<NativeBindSddResult> {
		await this.verifyVersion(request.cwd, request.signal);
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

	async sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusResult> {
		await this.verifyVersion(request.cwd, request.signal);
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

export function createNativeReviewCli(adapter = createNodeExecFileAdapter()): NativeReviewCliV212 { return new NativeReviewCliV212(adapter); }
