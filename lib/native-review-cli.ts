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

export interface NativeReviewCli {
	start(request: NativeStartRequest): Promise<NativeStartResult>;
	finalize(request: NativeFinalizeRequest): Promise<NativeFinalizeResult>;
	validate(request: NativeValidateRequest): Promise<NativeValidateResult>;
	bindSdd(request: NativeBindSddRequest): Promise<NativeBindSddResult>;
	sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusResult>;
}

export interface NativeStartRequest { cwd: string; lineageId?: string; policyPath?: string; focus?: string; signal?: AbortSignal; }
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
	evidenceDocument?: unknown;
	failed?: boolean;
	signal?: AbortSignal;
}
export interface NativeValidateRequest { cwd: string; gate: string; lineageId?: string; flags?: readonly string[]; signal?: AbortSignal; }
export interface NativeBindSddRequest { cwd: string; change: string; lineage: string; expectedBindingRevision: string; signal?: AbortSignal; }
export interface NativeSddStatusRequest { cwd: string; change: string; signal?: AbortSignal; }
export interface NativeGateContext { lineageId: string; storeRevision: string; receiptHash: string; targetHash: string; }
export interface NativeStartResult { lineageId: string; state: "reviewing"; riskLevel: string; selectedLenses: readonly string[]; changedFiles: number; changedLines: number; correctionBudget: number; }
export interface NativeValidateResult { allowed: boolean; result: "allow" | "deny"; action: string; reason: string; gateContext: NativeGateContext; }
export interface NativeFinalizeResult { lineageId: string; state: string; action: string; storeRevision: string; receiptPath?: string; }
export interface NativeBindSddResult {
	repository: string;
	change: string;
	path: string;
	lineageId: string;
	authorityRevision: string;
	receiptHash: string;
	bindingRevision: string;
}
export interface NativeSddStatusResult { ready: boolean; [key: string]: unknown; }

const NATIVE_RISK_LEVEL = ["low", "medium", "high"] as const;
const NATIVE_REVIEW_LENS = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
const NATIVE_FINALIZE_STATE = ["reviewing", "correction_required", "validating", "approved", "escalated"] as const;
const NATIVE_SDD_NEXT_ACTION = ["apply", "sdd-apply", "verify", "sdd-verify", "remediate", "sdd-remediate", "sdd-archive", "resolve-review", "resolve-blockers", "propose", "spec", "design", "tasks"] as const;

export const NATIVE_CLI_CONTRACTS = Object.freeze({
	"2.1.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, sddStatus: true, status: false, inventory: false }),
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
function nonNegativeInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("expected safe non-negative integer"); return value; }
function stringArray(value: unknown): readonly string[] { if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) throw new Error("expected string array"); return value; }
function parseJson(stdout: string, operation: NativeReviewOperation, mutating: boolean): Record<string, unknown> {
	if (stdout.length === 0) throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT, operation, true, mutating, "native command returned empty output");
	try { return object(JSON.parse(stdout)); } catch { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON, operation, true, mutating, "native command returned malformed JSON"); }
}
function decode<T>(operation: NativeReviewOperation, mutating: boolean, callback: () => T): T {
	try { return callback(); } catch (error) { if (error instanceof NativeReviewCliError) throw error; throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE, operation, true, mutating, "native response is schema incompatible"); }
}
function decodeGateContext(value: unknown): NativeGateContext {
	const context = exactObject(value, ["lineage_id", "store_revision", "receipt_hash", "target_hash"]);
	return { lineageId: requiredString(context.lineage_id), storeRevision: requiredString(context.store_revision), receiptHash: requiredString(context.receipt_hash), targetHash: requiredString(context.target_hash) };
}
function nativeError(code: NativeReviewErrorCode, operation: NativeReviewOperation, mutating: boolean, message: string): NativeReviewCliError {
	return new NativeReviewCliError(code, operation, true, mutating, message);
}

export class NativeReviewCliV210 {
	private verified = false;
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

	private async execute(operation: NativeReviewOperation, cwd: string, arguments_: readonly string[], mutating: boolean, signal?: AbortSignal): Promise<Record<string, unknown>> {
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
		if (result.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, operation, mutating, "native process failed");
		if (result.stderr.trim().length > 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR, operation, mutating, "native process wrote stderr");
		return parseJson(result.stdout, operation, mutating);
	}

	private async verifyVersion(cwd: string, signal?: AbortSignal): Promise<void> {
		if (this.verified) return;
		let result: ExecFileResult;
		try { result = await this.adapter({ file: this.executable, arguments: ["version"], cwd, timeoutMs: this.timeoutMs, maxBufferBytes: this.maxBufferBytes, signal }); }
		catch { throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, NATIVE_REVIEW_OPERATION.VERSION, false, "gentle-ai is unavailable"); }
		if (result.timedOut) throw nativeError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process timed out");
		if (result.outputLimitExceeded) throw nativeError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, NATIVE_REVIEW_OPERATION.VERSION, false, "version process output exceeded limit");
		if (result.signal) throw nativeError(NATIVE_REVIEW_ERROR_CODE.SIGNAL, NATIVE_REVIEW_OPERATION.VERSION, false, "version process was signalled");
		if (result.exitCode !== 0) throw nativeError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.VERSION, false, "version process failed");
		if (result.stderr.trim().length > 0 || result.stdout.replace(/\r\n$/, "\n") !== "gentle-ai 2.1.0\n") throw nativeError(NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE, NATIVE_REVIEW_OPERATION.VERSION, false, "gentle-ai 2.1.0 is required");
		this.verified = true;
	}

	async start(request: NativeStartRequest): Promise<NativeStartResult> {
		await this.verifyVersion(request.cwd, request.signal);
		const result = await this.execute(NATIVE_REVIEW_OPERATION.START, request.cwd, ["review", "start", "--cwd", request.cwd, ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...(request.policyPath ? ["--policy", request.policyPath] : []), ...(request.focus ? ["--focus", request.focus] : [])], true, request.signal);
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

	async finalize(request: NativeFinalizeRequest): Promise<NativeFinalizeResult> {
		await this.verifyVersion(request.cwd, request.signal);
		const needsStaging = request.lensResults !== undefined || request.refuterDocument !== undefined || request.validationDocument !== undefined || request.evidenceDocument !== undefined;
		const directory = needsStaging ? await mkdtemp(join(tmpdir(), "gentle-ai-finalize-")) : undefined;
		try {
			if (directory) await chmod(directory, 0o700);
			const resultFiles = directory && request.lensResults ? await Promise.all(request.lensResults.map((entry, index) => this.stageDocument(directory, `result-${index}`, entry.document))) : request.resultFiles ?? [];
			const refuterFile = directory && request.refuterDocument !== undefined ? await this.stageDocument(directory, "refuter", request.refuterDocument) : request.refuterFile;
			const validationFile = directory && request.validationDocument !== undefined ? await this.stageDocument(directory, "validation", request.validationDocument) : request.validationFile;
			const evidenceFile = directory && request.evidenceDocument !== undefined ? await this.stageDocument(directory, "evidence", request.evidenceDocument) : request.evidenceFile;
			const result = await this.execute(NATIVE_REVIEW_OPERATION.FINALIZE, request.cwd, ["review", "finalize", "--cwd", request.cwd, ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...resultFiles.flatMap((path) => ["--result", path]), ...(refuterFile ? ["--refuter", refuterFile] : []), ...(request.correctionLines === undefined ? [] : ["--correction-lines", String(request.correctionLines)]), ...(validationFile ? ["--validation", validationFile] : []), ...(evidenceFile ? ["--evidence", evidenceFile] : []), ...(request.failed ? ["--failed"] : [])], true, request.signal);
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
		const result = await this.execute(NATIVE_REVIEW_OPERATION.VALIDATE, request.cwd, ["review", "validate", "--gate", request.gate, "--cwd", request.cwd, ...(request.lineageId ? ["--lineage", request.lineageId] : []), ...(request.flags ?? [])], false, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.VALIDATE, false, () => {
			const body = exactObject(result, ["schema", "result", "allowed", "action", "reason", "gate_context"]);
			if (body.schema !== "gentle-ai.review-gate-result/v1" || (body.result !== "allow" && body.result !== "deny") || typeof body.allowed !== "boolean" || body.allowed !== (body.result === "allow")) throw new Error("wrong validate discriminator");
			const gateContext = decodeGateContext(body.gate_context);
			if (request.lineageId && gateContext.lineageId !== request.lineageId) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.VALIDATE, false, "native gate lineage mismatch");
			return { allowed: body.allowed, result: body.result, action: requiredString(body.action), reason: requiredString(body.reason), gateContext };
		});
	}

	async bindSdd(request: NativeBindSddRequest): Promise<NativeBindSddResult> {
		await this.verifyVersion(request.cwd, request.signal);
		const result = await this.execute(NATIVE_REVIEW_OPERATION.BIND_SDD, request.cwd, ["review", "bind-sdd", "--cwd", request.cwd, "--change", request.change, "--lineage", request.lineage, `--expected-binding-revision=${request.expectedBindingRevision}`], true, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.BIND_SDD, true, () => {
			const body = exactObject(result, ["schema", "repository", "change", "path", "lineage_id", "authority_revision", "receipt_hash", "binding_revision", "gate_context"]);
			if (body.schema !== "gentle-ai.review-sdd-binding/v1" || body.change !== request.change || body.lineage_id !== request.lineage) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.BIND_SDD, true, "native binding identity mismatch");
			const receiptHash = requiredString(body.receipt_hash);
			const gateContext = decodeGateContext(body.gate_context);
			if (gateContext.lineageId !== request.lineage || gateContext.receiptHash !== receiptHash) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.BIND_SDD, true, "native binding gate mismatch");
			requiredString(body.repository); requiredString(body.path); requiredString(body.authority_revision); requiredString(body.binding_revision);
			return {
				repository: requiredString(body.repository),
				change: requiredString(body.change),
				path: requiredString(body.path),
				lineageId: requiredString(body.lineage_id),
				authorityRevision: requiredString(body.authority_revision),
				receiptHash,
				bindingRevision: requiredString(body.binding_revision),
			};
		});
	}

	async sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusResult> {
		await this.verifyVersion(request.cwd, request.signal);
		const result = await this.execute(NATIVE_REVIEW_OPERATION.SDD_STATUS, request.cwd, ["sdd-status", request.change, "--cwd", request.cwd, "--json", "--instructions"], false, request.signal);
		return decode(NATIVE_REVIEW_OPERATION.SDD_STATUS, false, () => {
			const body = exactObject(result, ["schemaName", "schemaVersion", "changeName", "artifactStore", "planningHome", "changeRoot", "artifactPaths", "contextFiles", "artifacts", "taskProgress", "dependencies", "applyState", "actionContext", "relationships", "remediationState", "phaseInstructions", "nextRecommended", "blockedReasons"]);
			if (body.schemaName !== "gentle-ai.sdd-status" || body.schemaVersion !== 1 || body.changeName !== request.change || body.artifactStore !== "openspec" || !["blocked", "all_done", "ready", "not_applicable"].includes(body.applyState as string)) throw nativeError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.SDD_STATUS, false, "native status identity mismatch");
			const paths = ["proposal", "specs", "design", "tasks", "applyProgress", "verifyReport", "reviewPolicy", "reviewLedger", "reviewReceipt", "reviewBundle", "reviewContext", "reviewState"];
			const pathMap = (value: unknown) => { const parsed = exactObject(value, paths); for (const path of paths) stringArray(parsed[path]); };
			const planningHome = exactObject(body.planningHome, ["mode", "path"]);
			if (planningHome.mode !== "repo-local") throw new Error("invalid planning home");
			requiredString(planningHome.path); requiredString(body.changeRoot); pathMap(body.artifactPaths); pathMap(body.contextFiles);
			const artifactStates = paths.filter((path) => path !== "reviewPolicy");
			const artifacts = exactObject(body.artifacts, artifactStates);
			for (const path of artifactStates) if (!["missing", "done", "partial"].includes(artifacts[path] as string)) throw new Error("invalid artifact state");
			const taskProgress = exactObject(body.taskProgress, ["total", "completed", "pending", "allComplete"]);
			const total = nonNegativeInteger(taskProgress.total), completed = nonNegativeInteger(taskProgress.completed), pending = nonNegativeInteger(taskProgress.pending);
			if (typeof taskProgress.allComplete !== "boolean" || completed + pending !== total || taskProgress.allComplete !== (pending === 0)) throw new Error("invalid task progress");
			const dependencies = exactObject(body.dependencies, ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"]);
			for (const phase of ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"]) if (!["blocked", "ready", "all_done", "not_applicable"].includes(dependencies[phase] as string)) throw new Error("invalid dependency state");
			const actionContext = exactObject(body.actionContext, ["mode", "workspaceRoot", "allowedEditRoots"]);
			if (actionContext.mode !== "repo-local" || requiredString(actionContext.workspaceRoot).length === 0 || stringArray(actionContext.allowedEditRoots).length === 0) throw new Error("invalid action context");
			const relationships = exactObject(body.relationships, ["dependsOn", "supersedes", "amends", "conflictsWith", "sameDomainActiveChanges"]);
			for (const field of ["dependsOn", "supersedes", "amends", "conflictsWith", "sameDomainActiveChanges"]) stringArray(relationships[field]);
			const remediation = exactObject(body.remediationState, ["required", "complete", "failedEvidenceRevision", "lineageId", "generation", "fixBatch", "reason"]);
			if (typeof remediation.required !== "boolean" || typeof remediation.complete !== "boolean" || ["failedEvidenceRevision", "lineageId", "reason"].some((field) => typeof remediation[field] !== "string")) throw new Error("invalid remediation state");
			nonNegativeInteger(remediation.generation); nonNegativeInteger(remediation.fixBatch);
			const instructions = exactObject(body.phaseInstructions, ["apply", "verify", "remediate", "archive"]);
			for (const phase of ["apply", "verify", "remediate", "archive"]) stringArray(instructions[phase]);
			const nextRecommended = requiredString(body.nextRecommended);
			if (!(NATIVE_SDD_NEXT_ACTION as readonly string[]).includes(nextRecommended)) throw new Error("unknown SDD next action");
			const blockedReasons = stringArray(body.blockedReasons);
			return { ...body, ready: nextRecommended !== "resolve-review" && !blockedReasons.some((reason) => reason.startsWith("resolve-review")) };
		});
	}
}

export function createNativeReviewCli(adapter = createNodeExecFileAdapter()): NativeReviewCliV210 { return new NativeReviewCliV210(adapter); }
