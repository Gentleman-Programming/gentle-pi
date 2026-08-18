import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { NATIVE_REVIEW_ERROR_CODE, NATIVE_REVIEW_OPERATION, NativeReviewCliError, NativeReviewCliV214 as NativeReviewCliV214Production, type NativeReviewCli, type NativeReviewStatusResult } from "../lib/native-review-cli.ts";

// Queued-adapter clients never execute a real process; default to a fixed absolute
// package-local path so these tests do not depend on an installed binary
// (for example while a re-pinned release's digests are still pending).
class NativeReviewCliV214 extends NativeReviewCliV214Production {
	constructor(...parameters: ConstructorParameters<typeof NativeReviewCliV214Production>) {
		const [adapter, executable, ...rest] = parameters;
		super(adapter, executable ?? "/package/.gentle-ai/gentle-ai", ...rest);
	}
}
import { canonicalJsonV1, domainHashV1 } from "../lib/review-canonical.ts";
import { CandidateViewError, CandidateViewRegistry, deriveChangedPathManifest } from "../lib/review-candidate-view.ts";
import { inspectLegacyReviewAuthorityV1 } from "../lib/review-legacy-detector.ts";
import { resolveRepositoryAuthorityV1 } from "../lib/review-repository.ts";
import type { AuthorityRepairAssessmentV1, ReviewStatusV3 } from "../lib/review-integration-v2.ts";

interface RegisteredTool {
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	) => Promise<{ details?: unknown }>;
}

type ToolCallHandler = (
	event: { toolName: string; input: unknown },
	ctx: ExtensionContext,
) => Promise<unknown>;

type SessionShutdownHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => Promise<unknown> | unknown;

interface Runtime {
	controller: RegisteredTool;
	scopeReader: RegisteredTool;
	toolCall: ToolCallHandler;
	shutdownSession: (ctx: ExtensionContext) => Promise<unknown>;
}

function runtime(
	nativeReviewCli: NativeReviewCli | null,
	bashTimeRevalidationTimeoutMs?: number,
	candidateViews: CandidateViewRegistry | null = null,
): Runtime {
	const tools = new Map<string, RegisteredTool>();
	let toolCall: ToolCallHandler | undefined;
	let sessionShutdown: SessionShutdownHandler | undefined;
	const dependencies = { nativeReviewCli, bashTimeRevalidationTimeoutMs, candidateViews } as unknown as Parameters<typeof createGentleAiExtension>[0];
	createGentleAiExtension(dependencies)({
		on(name: string, handler: ToolCallHandler | SessionShutdownHandler) {
			if (name === "tool_call") toolCall = handler as ToolCallHandler;
			if (name === "session_shutdown") sessionShutdown = handler as SessionShutdownHandler;
		},
		registerTool(definition: RegisteredTool & { name: string }) { tools.set(definition.name, definition); },
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	const scopeReader = tools.get("gentle_review_scope");
	assert.ok(controller);
	assert.ok(scopeReader);
	assert.ok(toolCall);
	assert.ok(sessionShutdown);
	return {
		controller,
		scopeReader,
		toolCall,
		shutdownSession: async (ctx) => await sessionShutdown!({}, ctx),
	};
}

function context(cwd: string, signal?: AbortSignal, sessionId?: string): ExtensionContext {
	return {
		cwd,
		hasUI: false,
		signal,
		ui: { confirm: async () => true },
		...(sessionId === undefined ? {} : { sessionManager: { getSessionId: () => sessionId } }),
	} as unknown as ExtensionContext;
}

function compactCandidateContextManifest(task: string): { encoded: string; sha256: string } {
	const match = /Frozen changed scope manifest \(gzip\+base64url\): `([A-Za-z0-9_-]+)`\.\nFrozen changed scope manifest SHA-256: `([0-9a-f]{64})`\./.exec(task);
	assert.ok(match, "expected a compact candidate context manifest");
	return { encoded: match[1]!, sha256: match[2]! };
}

function interactiveContext(cwd: string, signal?: AbortSignal): ExtensionContext {
	return { cwd, hasUI: true, signal, ui: { confirm: async () => true } } as unknown as ExtensionContext;
}

function nativeGateContext(lineageId = "native-lineage", storeRevision = "r1", candidateTree = "candidate"): Awaited<ReturnType<NativeReviewCli["validate"]>>["gateContext"] {
	return {
		lineageId,
		storeRevision,
		raw: {
			gate: "pre-commit",
			lineage_id: lineageId,
			generation: 1,
			store_revision: storeRevision,
			genesis_revision: storeRevision,
			chain_identity: storeRevision,
			bundle_digest: storeRevision,
			base_tree: "base",
			candidate_tree: candidateTree,
			paths_digest: "paths",
			fix_delta_hash: "fix",
			policy_hash: "policy",
			ledger_hash: "ledger",
			evidence_hash: "evidence",
			base_relationship_valid: true,
		},
	};
}

function nativeBindingGateContext(lineageId = "native-lineage", storeRevision = "r1"): Awaited<ReturnType<NativeReviewCli["validate"]>>["gateContext"] {
	const context = nativeGateContext(lineageId, storeRevision);
	context.raw.gate = "post-apply";
	return context;
}

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => {
		if (process.platform !== "win32") {
			try {
				execFileSync("chmod", ["-R", "u+w", cwd], { stdio: "ignore" });
			} catch {
				// The fixture may already have been removed by candidate-view cleanup.
			}
		}
		rmSync(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", "initial"], { cwd });
	return cwd;
}

function git(cwd: string, ...arguments_: string[]): string {
	return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

function commitFile(cwd: string, path: string, content: string, message: string): void {
	writeFileSync(join(cwd, path), content);
	git(cwd, "add", path);
	git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", message);
}

function craftDurableResetState(cwd: string): { repositoryId: string; commonDirHash: string; inventoryHash: string; confirmation: string } {
	const authority = resolveRepositoryAuthorityV1(cwd);
	const commonDirHash = domainHashV1("common-directory", authority.common_directory);
	const inventoryHash = "f".repeat(64);
	const confirmation = `DESTROY REVIEW AUTHORITY ${authority.repository_id} AT ${commonDirHash} INVENTORY ${inventoryHash}`;
	const resetId = "a".repeat(64);
	const body = {
		schema: "gentle-ai.review-reset-state/v1",
		reset_id: resetId,
		repository_id: authority.repository_id,
		common_directory_hash: commonDirHash,
		authorized_inventory_hash: inventoryHash,
		authorization_hash: domainHashV1("reset-authorization", confirmation),
		sequence: 0,
		phase: "marked",
		quarantine_relative_path: join("reset-quarantine", resetId),
		moved_roots: [],
		deleted_roots: [],
	};
	const control = join(authority.store_root, "control");
	mkdirSync(control, { recursive: true });
	writeFileSync(join(control, "reset-state.json"), JSON.stringify({ body, reset_state_hash: domainHashV1("reset-state", body) }));
	return { repositoryId: authority.repository_id, commonDirHash, inventoryHash, confirmation };
}

function writeRetiredCompactFixture(cwd: string, lineageId: string, contents = "retired compact authority\n"): string {
	const path = join(resolveRepositoryAuthorityV1(cwd).store_root, "compact-v2", lineageId, "review-state.json");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents);
	return path;
}

function fakeNative(overrides: Partial<NativeReviewCli> = {}): NativeReviewCli {
	return {
		start: async () => ({ lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true }),
		finalize: async () => ({ lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" }),
		validate: async () => ({ allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() }),
		bindSdd: async () => ({ revision: "b1", change: "native-review-authority-parity", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeBindingGateContext() }),
		sddStatus: async () => ({ ready: false }),
		reviewStatus: async () => ({ schema: "gentle-ai.review-authority-status/v1", repository: "/repo", complete: true, authoritative: true, status: "clean", entries: [], locks: [], diagnostics: [], raw: { schema: "gentle-ai.review-authority-status/v1", operation: "review/status", repository: "/repo", complete: true, authoritative: true, status: "clean", entries: [], locks: [], diagnostics: [] } }),
		targetStatus: async (request) => {
			const lineageId = request.lineageId ?? "";
			return lineageId === ""
				? candidateStartTargetStatus(request)
				: candidateFinalizeTargetStatus(request, lineageId);
		},
		...overrides,
	};
}

const UNSUPPORTED_REPAIR_ASSESSMENT: AuthorityRepairAssessmentV1 = {
	schema: "gentle-ai.review-authority-repair-assessment/v1",
	status: "unsupported",
	counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 },
	supportedOperations: ["review/complete-fix", "review/validate-fix"],
	authorizationSchema: "gentle-ai.review-repair-authorization/v1",
};

function targetStatusFixture(options: {
	applicability?: "current_target" | "unrelated" | "ambiguous" | "corrupted";
	action?: ReviewStatusV3["action"];
	replayability?: ReviewStatusV3["replayability"];
	lineageId?: string;
	authorityVersion?: "compact-v2" | "legacy-v1";
	authorityState?: NonNullable<ReviewStatusV3["authority"]>["state"];
	receiptStatus?: ReviewStatusV3["receipt"]["status"];
	baseTree?: string;
	currentCandidateTree?: string;
	paths?: readonly string[];
	projection?: "workspace" | "staged";
	intendedUntracked?: readonly string[];
} = {}): ReviewStatusV3 {
	const applicability = options.applicability ?? "current_target";
	const action = options.action ?? (applicability === "current_target" ? "finalize" : applicability === "unrelated" ? "start" : applicability === "ambiguous" ? "select_lineage" : "repair_authority");
	const replayability = options.replayability ?? (action === "reconcile_finalize" ? "status_required" : applicability === "ambiguous" ? "status_required" : applicability === "corrupted" ? "manual_action_required" : "not_replayable");
	const lineageId = options.lineageId ?? "native-lineage";
	const authorityVersion = options.authorityVersion ?? "compact-v2";
	const authorityState = options.authorityState ?? "reviewing";
	const receiptStatus = options.receiptStatus ?? (applicability === "current_target" ? "expected_missing" : "not_applicable");
	const sha = `sha256:${"a".repeat(64)}`;
	const tree = options.currentCandidateTree ?? "b".repeat(40);
	const baseTree = options.baseTree ?? tree;
	const paths = options.paths ?? ["app.ts"];
	const intendedUntracked = options.intendedUntracked ?? [];
	const projection = {
		schema: "gentle-ai.review-integration.projection/v1" as const,
		kind: "current-changes" as const,
		projection: options.projection ?? "workspace",
		baseTree,
		initialReviewTree: tree,
		currentCandidateTree: tree,
		pathsDigest: sha,
		paths,
		intendedUntracked,
		intendedUntrackedProof: sha,
		initialSnapshotIdentity: sha,
		currentSnapshotIdentity: sha,
	};
	const rawRepair = {
		schema: UNSUPPORTED_REPAIR_ASSESSMENT.schema,
		status: UNSUPPORTED_REPAIR_ASSESSMENT.status,
		counts: {
			lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0,
			eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0,
		},
		supported_operations: UNSUPPORTED_REPAIR_ASSESSMENT.supportedOperations,
		authorization_schema: UNSUPPORTED_REPAIR_ASSESSMENT.authorizationSchema,
	};
	const raw: Record<string, unknown> = {
		schema: "gentle-ai.review-integration.status/v3",
		contract: "gentle-ai.review-integration/v2",
		operation: "review.status",
		applicability,
		receipt: { status: receiptStatus },
		action,
		replayability,
		target_identity: sha,
		repair: rawRepair,
		projection: {
			schema: projection.schema,
			kind: projection.kind,
			projection: projection.projection,
			base_tree: baseTree,
			initial_review_tree: tree,
			current_candidate_tree: tree,
			paths_digest: sha,
			paths,
			intended_untracked: intendedUntracked,
			intended_untracked_proof: sha,
			initial_snapshot_identity: sha,
			current_snapshot_identity: sha,
		},
		candidates: applicability === "ambiguous" ? [lineageId, "other-lineage"] : [],
	};
	if (applicability === "current_target") {
		raw.authority = { version: authorityVersion, lineage_id: lineageId, state: authorityState, generation: 1, revision: sha };
		if (authorityVersion === "compact-v2") raw.frozen = { tier: "medium", original_changed_lines: 2, correction_budget: 1 };
	}
	if (action === "reconcile_finalize") raw.reconciliation = { required: true };
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability,
		...(applicability === "current_target" ? { authority: { version: authorityVersion, lineageId, state: authorityState, generation: 1, revision: sha } } : {}),
		receipt: { status: receiptStatus },
		action,
		replayability,
		...(applicability === "current_target" && authorityVersion === "compact-v2" ? { frozen: { tier: "medium" as const, originalChangedLines: 2, correctionBudget: 1 } } : {}),
		...(action === "reconcile_finalize" ? { reconciliation: { required: true as const } } : {}),
		targetIdentity: sha,
		projection,
		repair: UNSUPPORTED_REPAIR_ASSESSMENT,
		candidates: applicability === "ambiguous" ? [lineageId, "other-lineage"] : [],
		raw,
	};
}

interface CandidateStatusFixtureOptions {
	baseRef?: string;
	status?: (
		candidate: ReturnType<CandidateViewRegistry["create"]>,
		request: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0],
	) => ReviewStatusV3;
}

function candidateStartTargetStatus(
	request: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0],
	options: CandidateStatusFixtureOptions = {},
): ReviewStatusV3 {
	const fixtureCandidateViews = new CandidateViewRegistry();
	const baseRef = request.baseRef ?? options.baseRef;
	let candidate: ReturnType<CandidateViewRegistry["create"]> | undefined;
	try {
		candidate = fixtureCandidateViews.create({
			contributorRoot: request.cwd,
			...(baseRef === undefined ? {} : { baseRef, committedOnly: true }),
			...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
		});
		return options.status?.(candidate, request) ?? targetStatusFixture({
			applicability: "unrelated",
			action: "start",
			baseTree: candidate.baseTree,
			currentCandidateTree: candidate.candidateTree,
			paths: candidate.paths,
			projection: request.projection ?? "workspace",
			intendedUntracked: request.intendedUntracked,
		});
	} finally {
		candidate?.cleanup();
	}
}

test("candidate START fixture preserves materialization class, code, and message", (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-invalid-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	assert.throws(
		() => candidateStartTargetStatus({ cwd }),
		(error: unknown) => error instanceof CandidateViewError &&
			error.reason === "candidate-view-git-failure" &&
			error.message === "candidate-view Git command rev-parse failed; inspect the candidate state before any new START",
	);
});

function candidateFinalizeTargetStatus(request: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0], lineageId: string): ReviewStatusV3 {
	let candidate: ReturnType<CandidateViewRegistry["create"]> | undefined;
	try {
		candidate = new CandidateViewRegistry().create({ contributorRoot: request.cwd });
		return targetStatusFixture({
			lineageId,
			baseTree: candidate.baseTree,
			currentCandidateTree: candidate.candidateTree,
			paths: candidate.paths,
			projection: request.projection ?? "workspace",
		});
	} catch {
		return targetStatusFixture({ lineageId });
	} finally {
		candidate?.cleanup();
	}
}

function bindReviewerManifest(status: ReviewStatusV3, cwd: string, manifestHash = `sha256:${"7".repeat(64)}`): ReviewStatusV3 {
	const manifest = deriveChangedPathManifest(cwd, status.projection.baseTree, status.projection.currentCandidateTree).map((entry) => ({
		...entry,
		status: entry.status as "A" | "D" | "M" | "T",
		intendedUntracked: status.projection.intendedUntracked.includes(entry.path),
	}));
	const subject = {
		schema: "gentle-ai.review-artifact-subject/v2" as const,
		subjectHash: `sha256:${"8".repeat(64)}`,
		lineageId: status.authority!.lineageId,
		authorityRevision: status.authority!.revision,
		targetIdentity: status.targetIdentity,
		baseTree: status.projection.baseTree,
		candidateTree: status.projection.currentCandidateTree,
		changedPathManifestSha256: manifestHash,
		lens: "review-reliability" as const,
		selectedOrder: 0,
	};
	status.nextTransition = {
		kind: "collect",
		reasonCode: "reviewer_results_required",
		collect: { inputs: [{
			name: "reviewer_result",
			schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
			captureOperation: "review.capture-result",
			arguments: [
				{ name: "lineage", value: subject.lineageId, token: `--lineage=${subject.lineageId}` },
				{ name: "expected-revision", value: subject.authorityRevision, token: `--expected-revision=${subject.authorityRevision}` },
				{ name: "target", value: subject.targetIdentity, token: `--target=${subject.targetIdentity}` },
				{ name: "lens", value: subject.lens, token: `--lens=${subject.lens}` },
				{ name: "order", value: "0", token: "--order=0" },
				{ name: "subject-hash", value: subject.subjectHash, token: `--subject-hash=${subject.subjectHash}` },
			],
			artifactSubject: subject,
			baseTree: subject.baseTree,
			candidateTree: subject.candidateTree,
			changedPathManifest: manifest,
		}] },
	};
	return status;
}

function bindCorrectionCollection(status: ReviewStatusV3): ReviewStatusV3 {
	status.nextTransition = {
		kind: "collect",
		reasonCode: "verification_evidence_required",
		collect: { inputs: [{
			name: "verification_evidence",
			schema: "gentle-ai.review-verification-evidence/v2",
			captureOperation: "review.capture-evidence",
			arguments: [{ name: "lineage", value: status.authority!.lineageId }],
		}] },
	};
	delete status.validationRequest;
	return status;
}

function bindTargetedValidation(status: ReviewStatusV3, requestHash = `sha256:${"9".repeat(64)}`): ReviewStatusV3 {
	const request = {
		schema: "gentle-ai.review-targeted-validation-request/v1" as const,
		requestHash,
		lineageId: status.authority!.lineageId,
		expectedRevision: status.authority!.revision,
		targetIdentity: status.targetIdentity,
		fixFindingIds: [],
		projection: "workspace" as const,
		correctionCandidateTree: status.projection.currentCandidateTree,
		correctionTargetIdentity: status.targetIdentity,
		correctionPaths: status.projection.paths,
		correctionPathsDigest: status.projection.pathsDigest,
	};
	status.validationRequest = request;
	status.nextTransition = {
		kind: "collect",
		reasonCode: "targeted_validation_required",
		collect: { inputs: [{
			name: "targeted_validation",
			schema: request.schema,
			captureOperation: "external.run_targeted_validation",
			arguments: [{ name: "lineage", value: request.lineageId }],
			validationRequest: request,
		}] },
	};
	return status;
}

function capturedCorrectionEvidence(status: ReviewStatusV3, outcome: "passed" | "verification_failed" | "procedural_tooling_failed", identityDigit: string) {
	return {
		schema: "gentle-ai.review-verification-evidence/v2" as const,
		version: 2 as const,
		lineageId: status.authority!.lineageId,
		authorityRevision: status.authority!.revision,
		targetIdentity: status.targetIdentity,
		candidateTree: status.projection.currentCandidateTree,
		pathsDigest: status.projection.pathsDigest,
		paths: status.projection.paths,
		ledgerIds: [],
		rawPayloadSha256: `sha256:${identityDigit.repeat(64)}`,
		rawPayloadBytes: 8,
		outcome,
		recordDigest: `sha256:${identityDigit.repeat(64)}`,
	};
}

function findResetRequests(value: unknown): unknown[] {
	if (Array.isArray(value)) return value.flatMap(findResetRequests);
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) => [
		...(key === "reset_request" ? [child] : []),
		...findResetRequests(child),
	]);
}

function assertNoPublicNativeResetRequest(value: unknown): void {
	for (const request of findResetRequests(value)) {
		assert.equal("nativeEvidenceHash" in (request as Record<string, unknown>), false);
		assert.equal("piInventoryHash" in (request as Record<string, unknown>), false);
		assert.equal("applicableLineageId" in (request as Record<string, unknown>), false);
	}
}

const assertNoPublicResetRequest = assertNoPublicNativeResetRequest;

function assertNoPublicDestructiveResetMaterial(value: unknown): void {
	const serialized = JSON.stringify(value);
	assert.doesNotMatch(serialized, /DESTROY/);
	assert.doesNotMatch(serialized, /request-explicit-reset-authorization/);
	if (Array.isArray(value)) {
		for (const child of value) assertNoPublicDestructiveResetMaterial(child);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, child] of Object.entries(value)) {
		assert.equal(["reset_request", "confirmation", "challenge"].includes(key), false, `public INSPECT leaked ${key}`);
		assertNoPublicDestructiveResetMaterial(child);
	}
}

test("new ordinary START and native-lineage FINALIZE use exactly one native call and stable envelopes", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true };
		},
		finalize: async () => {
			finalizes += 1;
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" };
		},
	}));
	const start = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(start.details, { operation: "start", result: { lineage_id: "native-lineage", state: "reviewing", risk_tier: "medium", selected_lenses: ["review-reliability"], changed_files: 2, original_changed_lines: 7, correction_budget: 4, action: "created", lenses_required: true }, workspace_root: cwd });
	const finalize = await controller.execute("finalize", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.deepEqual(finalize.details, { operation: "finalize", result: { lineage_id: "native-lineage", state: "approved", action: "approved", store_revision: "r1", receipt_path: "/opaque/receipt" } });
	assert.equal(starts, 1);
	assert.equal(finalizes, 1);
});

test("native FINALIZE resolves STATUS and mutation against the verified frozen candidate root", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	writeFileSync(join(cwd, "selected.ts"), "export const selected = true;\n");
	const selection = {
		untrackedScope: "select" as const,
		expectedUntrackedInventory: `sha256:${"9".repeat(64)}`,
		intendedUntracked: ["selected.ts"],
	};
	class RecordingCandidateViews extends CandidateViewRegistry {
		lastCandidate: ReturnType<CandidateViewRegistry["createOrReuse"]> | undefined;
		override createOrReuse(request: Parameters<CandidateViewRegistry["createOrReuse"]>[0]): ReturnType<CandidateViewRegistry["createOrReuse"]> {
			this.lastCandidate = super.createOrReuse(request);
			return this.lastCandidate;
		}
	}
	const candidateViews = new RecordingCandidateViews();
	const startInput = JSON.stringify({ mode: "ordinary", ...selection });
	const startReplayKey = JSON.stringify({ cwd, lineageId: null, input: startInput, inputPath: null });
	const startCandidate = candidateViews.createOrReuse({ contributorRoot: cwd, replayKey: startReplayKey, intendedUntracked: selection.intendedUntracked });
	const startStatus = targetStatusFixture({
		applicability: "unrelated",
		action: "start",
		baseTree: startCandidate.baseTree,
		currentCandidateTree: startCandidate.candidateTree,
		paths: startCandidate.paths,
		intendedUntracked: startCandidate.intendedUntracked,
	});
	const statusRoots: string[] = [];
	const statusRequests: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	let finalizeRoot: string | undefined;
	let starts = 0;
	const native = fakeNative({
		targetStatus: async (request) => {
			if (request.lineageId === undefined) return startStatus;
			statusRoots.push(request.cwd);
			statusRequests.push(request);
			if (request.cwd === cwd || request.untrackedScope !== selection.untrackedScope) return targetStatusFixture({ applicability: "unrelated", action: "start" });
			const candidate = candidateViews.resolveForFinalize(request.lineageId);
			return targetStatusFixture({
				lineageId: request.lineageId,
				baseTree: candidate.baseTree,
				currentCandidateTree: candidate.candidateTree,
				paths: candidate.paths,
				intendedUntracked: selection.intendedUntracked,
			});
		},
		start: async () => {
			starts += 1;
			return {
				lineageId: "candidate-root-finalize",
				state: "reviewing",
				riskLevel: "medium",
				selectedLenses: ["review-reliability"],
				changedFiles: 1,
				changedLines: 1,
				correctionBudget: 1,
				action: "created",
				lensesRequired: true,
			};
		},
		finalize: async (request) => {
			finalizeRoot = request.cwd;
			return { lineageId: "candidate-root-finalize", state: "approved", action: "approved", storeRevision: "r1" };
		},
	});
	const { controller } = runtime(native, undefined, candidateViews);
	const started = await controller.execute("candidate-root-start", { operation: "start", input: startInput }, undefined, undefined, context(cwd));
	const startDetails = started.details as { result?: { lineage_id: string; state: string } };
	assert.ok(startDetails.result, `START must succeed before FINALIZE: ${JSON.stringify(started.details)}; native START count: ${starts}; STATUS: ${JSON.stringify(startStatus)}; candidate: ${JSON.stringify(candidateViews.lastCandidate === undefined ? undefined : { baseTree: candidateViews.lastCandidate.baseTree, candidateTree: candidateViews.lastCandidate.candidateTree, paths: candidateViews.lastCandidate.paths, intendedUntracked: candidateViews.lastCandidate.intendedUntracked })}`);
	assert.equal(starts, 1, `native START count: ${starts}; details: ${JSON.stringify(started.details)}`);
	assert.equal(startDetails.result.lineage_id, "candidate-root-finalize");
	assert.equal(startDetails.result.state, "reviewing");
	const candidateRoot = candidateViews.resolveForFinalize("candidate-root-finalize").root;
	const result = await controller.execute("candidate-root-finalize", {
		operation: "finalize",
		lineageId: "candidate-root-finalize",
		input: JSON.stringify({}),
	}, undefined, undefined, context(cwd));
	assert.deepEqual(statusRoots, [candidateRoot]);
	assert.deepEqual(statusRequests, [{ cwd: candidateRoot, lineageId: "candidate-root-finalize", agent: "pi", ...selection }]);
	assert.equal(finalizeRoot, candidateRoot);
	assert.equal((result.details as { result: { state: string } }).result.state, "approved");
	try {
		chmodSync(candidateRoot, 0o700);
	} catch {
		// FINALIZE may already have removed the terminal candidate view.
	}
});

test("session-scoped START selection matrix retains only controller-owned bindings", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "selected.ts"), "export const selected = true;\n");
	const selection = {
		untrackedScope: "select" as const,
		expectedUntrackedInventory: `sha256:${"e".repeat(64)}`,
		intendedUntracked: ["selected.ts"],
	};
	class TrackingCandidateViews extends CandidateViewRegistry {
		bindCurrentCalls = 0;
		override bindCurrent(request: Parameters<CandidateViewRegistry["bindCurrent"]>[0]): void {
			this.bindCurrentCalls += 1;
			super.bindCurrent(request);
		}
	}
	const candidateViews = new TrackingCandidateViews();
	const statusRequests: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	let starts = 0;
	let validationLineageId: string | undefined;
	const targetStatus: NonNullable<NativeReviewCli["targetStatus"]> = async (request) => {
		statusRequests.push(request);
		if (request.lineageId === undefined) return candidateStartTargetStatus(request);
		const selected = request.untrackedScope === selection.untrackedScope &&
			request.expectedUntrackedInventory === selection.expectedUntrackedInventory &&
			JSON.stringify(request.intendedUntracked) === JSON.stringify(selection.intendedUntracked);
		if (!selected) return targetStatusFixture({ applicability: "unrelated", action: "start" });
		return candidateStartTargetStatus(request, {
			status: (candidate) => {
				validationLineageId = request.lineageId;
				return bindTargetedValidationSubmission(targetStatusFixture({
					lineageId: validationLineageId,
					authorityState: "correction_required",
					baseTree: candidate.baseTree,
					currentCandidateTree: candidate.candidateTree,
					paths: candidate.paths,
					intendedUntracked: selection.intendedUntracked,
				}));
			},
		});
	};
	const native = fakeNative({
		targetStatus,
		start: async () => {
			starts += 1;
			return { lineageId: `matrix-lineage-${starts}`, state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 2, correctionBudget: 1, action: "created", lensesRequired: true };
		},
		finalizeSubmission: async () => ({ lineageId: validationLineageId!, state: "approved", action: "approved", storeRevision: "r1" }),
	});
	const registrationA = runtime(native, undefined, candidateViews);
	const registrationB = runtime(native, undefined, candidateViews);
	const sessionA = context(cwd, undefined, "matrix-session-a");
	const sessionB = context(cwd, undefined, "matrix-session-b");
	const validation = {
		request_hash: "9".repeat(64), correction_ids: [],
		original_criteria: { passed: true, evidence: ["acceptance passes"] },
		correction_regression: { passed: true, evidence: ["regression passes"] },
		fix_caused_findings: [], follow_ups: [],
	};

	await registrationA.controller.execute("matrix-status", { operation: "status", input: JSON.stringify(selection) }, undefined, undefined, sessionA);
	assert.equal(candidateViews.bindCurrentCalls, 0, "read-only STATUS must never bind the injected controller registry");
	assert.equal(candidateViews.hasCurrentBinding(cwd), false);

	const started = await registrationA.controller.execute("matrix-start", { operation: "start", input: JSON.stringify({ mode: "ordinary", ...selection }) }, undefined, undefined, sessionA);
	const lineageId = (started.details as { result?: { lineage_id?: string } }).result?.lineage_id;
	assert.equal(lineageId, "matrix-lineage-1");
	assert.equal(candidateViews.bindCurrentCalls, 1, "only controller START may bind the candidate view");
	assert.equal(starts, 1);

	await registrationB.controller.execute("matrix-foreign", { operation: "status", lineageId }, undefined, undefined, sessionB);
	assert.deepEqual(statusRequests.at(-1), { cwd, lineageId }, "a different session must not inherit START selection");

	const finalized = await registrationB.controller.execute("matrix-finalize", { operation: "finalize", lineageId, input: JSON.stringify({ validation }) }, undefined, undefined, sessionA);
	assert.equal(
		(finalized.details as { result?: { state?: string } }).result?.state,
		"approved",
		`the same session retains START selection into validation-only FINALIZE: ${JSON.stringify(finalized.details)}`,
	);

	const shutdownStart = await registrationA.controller.execute("matrix-shutdown-start", { operation: "start", input: JSON.stringify({ mode: "ordinary", ...selection }) }, undefined, undefined, sessionA);
	const shutdownLineageId = (shutdownStart.details as { result?: { lineage_id?: string } }).result?.lineage_id;
	await registrationA.shutdownSession(sessionA);
	await registrationB.controller.execute("matrix-shutdown-status", { operation: "status", lineageId: shutdownLineageId }, undefined, undefined, sessionA);
	assert.deepEqual(statusRequests.at(-1), { cwd, lineageId: shutdownLineageId }, "session shutdown must clear retained START selection");
	candidateViews.cleanupTerminal(shutdownLineageId!, "approved");
});

test("parent subagent_run mutates single and parallel review actors with one verified controller-owned candidate view", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const candidateViews = new CandidateViewRegistry();
	const { controller, toolCall } = runtime(fakeNative({
		start: async () => ({
			lineageId: "c3-lineage",
			state: "reviewing",
			riskLevel: "high",
			selectedLenses: ["review-risk", "review-resilience", "review-readability", "review-reliability"],
			changedFiles: 1,
			changedLines: 1,
			correctionBudget: 1,
			action: "created",
			lensesRequired: true,
		}),
	}), undefined, candidateViews);
	await controller.execute("c3-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const single = { agent: "review-risk", task: "Inspect the change", context: "ordinary review", mode: "task" };
	assert.equal(await toolCall({ toolName: "subagent_run", input: single }, context(cwd)), undefined);
	assert.match(single.task, /## Controller-owned candidate view/);
	assert.match(single.task, /Frozen candidate tree:/);
	assert.match(single.task, /ambient contributor working directory is out of scope/);
	const parallel = { agents: ["review-risk", "review-resilience", "review-readability", "review-reliability"], task: "Inspect the change", mode: "task" };
	assert.equal(await toolCall({ toolName: "subagent_run", input: parallel }, context(cwd)), undefined);
	assert.match(parallel.task, /review-risk, review-resilience, review-readability, review-reliability/);
	assert.match(parallel.task, /Frozen candidate tree:/);
	candidateViews.resolveForLens("c3-lineage", "review-risk").cleanup();
});

test("controller START binds the exact current lineage ahead of overlapping historical 4R candidate views", async (t) => {
	const cwd = repository(t);
	const candidateViews = new CandidateViewRegistry();
	const lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
	const historicalTokens: string[] = [];
	for (let index = 0; index < 3; index += 1) {
		writeFileSync(join(cwd, "app.ts"), `export const value = ${index + 2};\n`);
		const historical = candidateViews.create({ contributorRoot: cwd });
		candidateViews.bind({ token: historical.token, lineageId: `historical-${index}`, selectedLenses: lenses });
		historicalTokens.push(historical.token);
	}
	writeFileSync(join(cwd, "app.ts"), "export const value = 9;\n");
	const { controller, toolCall } = runtime(fakeNative({
		start: async () => ({ lineageId: "current-lineage", state: "reviewing", riskLevel: "high", selectedLenses: lenses, changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true }),
	}), undefined, candidateViews);
	await controller.execute("current-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const current = candidateViews.resolveForLens("current-lineage", "review-risk");
	try {
		const single = { agent: "review-risk", task: "review", mode: "task" };
		const parallel = { agents: [...lenses], task: "review", mode: "task" };
		assert.equal(await toolCall({ toolName: "subagent_run", input: single }, context(cwd)), undefined);
		assert.equal(await toolCall({ toolName: "subagent_run", input: parallel }, context(cwd)), undefined);
		for (const task of [single.task, parallel.task]) {
			assert.match(task, /Controller-owned review lineage: `current-lineage`/);
			assert.match(task, new RegExp(`Frozen candidate tree: \`${current.candidateTree}\``));
		}
	} finally {
		for (const token of [...historicalTokens, current.token]) candidateViews.cleanup(token);
	}
});

test("fresh registry reload restores the native resumed lineage only while the live candidate exactly matches", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const candidateViews = new CandidateViewRegistry();
	const native = new NativeReviewCliV214(async (request) => ({
		stdout: request.arguments[0] === "version"
			? "gentle-ai 2.1.5\n"
			: request.arguments[1] === "status"
				? JSON.stringify({ schema: "gentle-ai.review-authority-status/v1", operation: "review/status", repository: cwd, complete: true, authoritative: true, status: "clean", entries: [], locks: [], diagnostics: [] })
				: JSON.stringify({ operation: "review/start", lineage_id: "reloaded-lineage", state: "reviewing", risk_level: "medium", selected_lenses: ["review-reliability"], changed_files: 1, changed_lines: 1, correction_budget: 1, action: "resumed", lenses_required: true, projection: "workspace" }),
		stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false,
	}));
	native.targetStatus = async (request) => request.lineageId === undefined
		? candidateStartTargetStatus(request)
		: targetStatusFixture({ lineageId: request.lineageId });
	const { controller, toolCall } = runtime(native, undefined, candidateViews);
	await controller.execute("reload-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const dispatch = { agent: "review-reliability", task: "review", mode: "task" };
	assert.equal(await toolCall({ toolName: "subagent_run", input: dispatch }, context(cwd)), undefined);
	assert.match(dispatch.task, /Controller-owned review lineage: `reloaded-lineage`/);
	candidateViews.resolveForLens("reloaded-lineage", "review-reliability").cleanup();
});

test("parent subagent_run fails closed before child execution for malformed, mixed, stale, conflicting, unsafe, and non-task review dispatch", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const candidateViews = new CandidateViewRegistry();
	const { controller, toolCall } = runtime(fakeNative({
		start: async () => ({ lineageId: "c3-fail-closed", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true }),
	}), undefined, candidateViews);
	await controller.execute("c3-start-fail-closed", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	for (const input of [
		{ agent: "review-reliability", agents: ["review-reliability"], task: "review", mode: "task" },
		{ agents: ["review-reliability", "worker"], task: "review", mode: "task" },
		{ agent: "review-risk", task: "review", mode: "task" },
		{ agent: "review-reliability", task: "review", mode: "background" },
		{ agent: "review-reliability", task: "## Controller-owned candidate view", mode: "task" },
		{ agent: "review-reliability", task: "review", mode: "task", unexpected: true },
		{ agents: "review-reliability", task: "review", mode: "task" },
		{ agents: ["review-reliability", 42], task: "review", mode: "task" },
	]) {
		const result = await toolCall({ toolName: "subagent_run", input }, context(cwd)) as { block?: boolean };
		assert.equal(result.block, true);
	}
	const stale = candidateViews.resolveForLens("c3-fail-closed", "review-reliability");
	chmodSync(stale.root, 0o755);
	chmodSync(join(stale.root, "app.ts"), 0o644);
	writeFileSync(join(stale.root, "app.ts"), "corrupted frozen content\n");
	chmodSync(stale.root, 0o555);
	chmodSync(join(stale.root, "app.ts"), 0o444);
	const staleResult = await toolCall({ toolName: "subagent_run", input: { agent: "review-reliability", task: "review", mode: "task" } }, context(cwd)) as { block?: boolean };
	assert.equal(staleResult.block, true);
	candidateViews.cleanup(stale.token);
});

test("controller routes the authoritative START action/lenses_required matrix without local authority reconstruction", async (t) => {
	const cwd = repository(t);
	const scenarios = [
		{ action: "created", lensesRequired: true, riskLevel: "medium", selectedLenses: ["review-reliability"] },
		{ action: "created", lensesRequired: false, riskLevel: "low", selectedLenses: [] },
		{ action: "resumed", lensesRequired: true, riskLevel: "medium", selectedLenses: ["review-reliability"] },
		{ action: "resumed", lensesRequired: false, riskLevel: "medium", selectedLenses: ["review-reliability"] },
		{ action: "reuse-receipt", lensesRequired: false, riskLevel: "low", selectedLenses: [] },
		{ action: "blocked-scope-action", lensesRequired: false, riskLevel: "low", selectedLenses: [] },
	] as const;
	for (const [index, scenario] of scenarios.entries()) {
		const candidateViews = new CandidateViewRegistry();
		const lineageId = `native-lineage-${index}`;
		const { controller } = runtime(fakeNative({
			start: async () => ({ lineageId, state: scenario.action === "reuse-receipt" ? "approved" : "reviewing", riskLevel: scenario.riskLevel, selectedLenses: scenario.selectedLenses, changedFiles: 2, changedLines: 7, correctionBudget: 4, action: scenario.action, lensesRequired: scenario.lensesRequired }),
		}), undefined, candidateViews);
		const started = await controller.execute(`start-${scenario.action}-${scenario.lensesRequired}`, { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
		const result = (started.details as { result: Record<string, unknown> }).result;
		assert.equal(result.action, scenario.action);
		assert.equal(result.lenses_required, scenario.lensesRequired);
		if (scenario.lensesRequired) {
			const view = candidateViews.resolveForLens(lineageId, "review-reliability");
			view.cleanup();
		} else if (scenario.action === "created" || scenario.action === "resumed" || scenario.action === "reuse-receipt") {
			assert.equal(candidateViews.resolveProjection(lineageId, cwd).candidateTree, git(cwd, "write-tree"));
			candidateViews.cleanupTerminal(lineageId, "approved");
		} else {
			assert.throws(() => candidateViews.resolveProjection(lineageId, cwd), /missing|ambiguous/i);
		}
	}
});

test("low-risk native START retains its candidate view for the production zero-lens FINALIZE path", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const candidateViews = new CandidateViewRegistry();
	const finalizeCwds: string[] = [];
	const { controller } = runtime(fakeNative({
		start: async () => ({ lineageId: "low-risk-lineage", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false }),
		finalize: async (request) => {
			finalizeCwds.push(request.cwd);
			return { lineageId: "low-risk-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}), undefined, candidateViews);
	await controller.execute("low-risk-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const finalized = await controller.execute("low-risk-finalize", { operation: "finalize", lineageId: "low-risk-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.equal(finalizeCwds.length, 1);
	assert.notEqual(finalizeCwds[0], cwd);
	assert.equal((finalized.details as { result: { state: string } }).result.state, "approved");
});

test("fresh negotiated registries reconstruct the frozen candidate before FINALIZE", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const status = targetStatusFixture({ lineageId: "restarted-lineage" });
	status.projection.baseTree = frozen.baseTree;
	status.projection.initialReviewTree = frozen.candidateTree;
	status.projection.currentCandidateTree = frozen.candidateTree;
	status.projection.paths = frozen.paths;
	bindReviewerManifest(status, cwd);
	frozen.cleanup();
	let finalizedContent = "";
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		finalize: async (request) => {
			finalizedContent = readFileSync(join(request.cwd, "app.ts"), "utf8");
			return { lineageId: "restarted-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("restarted-finalize", {
		operation: "finalize",
		lineageId: "restarted-lineage",
		input: JSON.stringify({}),
	}, undefined, undefined, context(cwd));
	assert.equal(finalizedContent, "export const value = 2;\n");
	assert.equal((result.details as { result: { state: string } }).result.state, "approved");
});

test("forecast-only FINALIZE reconstructs the frozen candidate after a fresh process (#176)", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const status = targetStatusFixture({ lineageId: "forecast-lineage" });
	status.projection.baseTree = frozen.baseTree;
	status.projection.initialReviewTree = frozen.candidateTree;
	status.projection.currentCandidateTree = frozen.candidateTree;
	status.projection.paths = frozen.paths;
	frozen.cleanup();
	let statusCalls = 0;
	let finalizedContent = "";
	const finalizeRequests: Parameters<NativeReviewCli["finalize"]>[0][] = [];
	const candidateViews = new CandidateViewRegistry();
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statusCalls += 1;
			return status;
		},
		finalize: async (request) => {
			finalizeRequests.push(request);
			finalizedContent = readFileSync(join(request.cwd, "app.ts"), "utf8");
			return { lineageId: "forecast-lineage", state: "fixing", action: "correction-forecast-recorded", storeRevision: "r1" };
		},
	}), undefined, candidateViews);
	const result = await controller.execute("forecast-only-finalize", {
		operation: "finalize",
		lineageId: "forecast-lineage",
		input: JSON.stringify({ correction_line_forecast: 3 }),
	}, undefined, undefined, context(cwd));
	assert.equal(statusCalls, 1);
	assert.equal(finalizeRequests.length, 1);
	assert.equal(finalizeRequests[0]!.correctionLines, 3);
	assert.notEqual(finalizeRequests[0]!.cwd, cwd);
	assert.equal(finalizedContent, "export const value = 2;\n");
	assert.equal((result.details as { result: { state: string } }).result.state, "fixing");
	candidateViews.cleanupTerminal("forecast-lineage", "escalated");
});

test("ambiguous native START runs target status first and follows only its declared action", async (t) => {
	const cwd = repository(t);
	const candidateViews = new CandidateViewRegistry();
	const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const calls: string[] = [];
	let statuses = 0;
	const reconciled = targetStatusFixture({ action: "finalize", lineageId: "resumed-lineage" });
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			calls.push("status");
			statuses += 1;
			return statuses === 1 ? candidateStartTargetStatus(request) : reconciled;
		},
		start: async (request) => {
			calls.push("start");
			requests.push(request);
			throw Object.assign(new Error("lost output"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
	}), undefined, candidateViews);
	const request = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const ambiguous = await controller.execute("ambiguous-start", request, undefined, undefined, context(cwd));
	assert.equal(requests.length, 1);
	assert.deepEqual(calls, ["status", "start", "status"]);
	assert.deepEqual(ambiguous.details, {
		operation: "start",
		status: "blocked",
		outcome: "native-mutation-status-reconciled",
		mutation_outcome: "unknown",
		replayability: "not_replayable",
		next_action: "finalize",
		reconciliation: reconciled.raw,
		authority_applicability: "current_target",
		provider_action: "finalize",
	});
	assert.equal(requests[0]?.cwd, cwd);
	const replayKey = JSON.stringify({ cwd, lineageId: null, input: request.input, inputPath: null });
	candidateViews.createOrReuse({ contributorRoot: cwd, replayKey }).cleanup();
});

test("schema-invalid post-mutation FINALIZE performs one FINALIZE and target-scoped STATUS only", async (t) => {
	const cwd = repository(t);
	const calls: string[] = [];
	const statusRequests: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	const initial = targetStatusFixture({ action: "finalize", lineageId: "schema-invalid-finalize" });
	const reconciled = targetStatusFixture({
		applicability: "ambiguous",
		action: "select_lineage",
		replayability: "status_required",
		lineageId: "schema-invalid-finalize",
	});
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			calls.push("status");
			statusRequests.push(request);
			return statusRequests.length === 1 ? initial : reconciled;
		},
		finalize: async () => {
			calls.push("finalize");
			throw new NativeReviewCliError(
				NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
				NATIVE_REVIEW_OPERATION.FINALIZE,
				true,
				true,
				"native finalize response is schema incompatible",
			);
		},
		reviewStatus: async () => {
			throw new Error("schema-invalid finalize must not use inventory status");
		},
	}));
	const result = await controller.execute("schema-invalid-finalize", {
		operation: "finalize",
		lineageId: "schema-invalid-finalize",
		input: "{}",
	}, undefined, undefined, context(cwd));
	assert.deepEqual(calls, ["status", "finalize", "status"]);
	assert.deepEqual(statusRequests.map((request) => ({ cwd: request.cwd, lineageId: request.lineageId })), [
		{ cwd, lineageId: "schema-invalid-finalize" },
		{ cwd, lineageId: "schema-invalid-finalize" },
	]);
	assert.equal((result.details as { outcome?: string }).outcome, "native-mutation-status-reconciled");
});

test("ambiguous native FINALIZE returns the target-status action without a second mutation", async (t) => {
	const cwd = repository(t);
	const calls: string[] = [];
	let finalizes = 0;
	let statuses = 0;
	const reconciled = targetStatusFixture({ applicability: "ambiguous", action: "select_lineage", replayability: "status_required", lineageId: "native-lineage" });
	const { controller } = runtime(fakeNative({
		finalize: async () => {
			calls.push("finalize");
			finalizes += 1;
			throw Object.assign(new Error("lost finalize response"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
		targetStatus: async () => {
			calls.push("status");
			statuses += 1;
			return statuses === 1 ? targetStatusFixture({ action: "finalize", lineageId: "native-lineage" }) : reconciled;
		},
	}));
	const result = await controller.execute("ambiguous-finalize", { operation: "finalize", lineageId: "native-lineage", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal(finalizes, 1);
	assert.deepEqual(calls, ["status", "finalize", "status"]);
	assert.deepEqual(result.details, {
		operation: "finalize",
		status: "blocked",
		outcome: "native-mutation-status-reconciled",
		mutation_outcome: "unknown",
		replayability: "status_required",
		next_action: "select_lineage",
		reconciliation: reconciled.raw,
		authority_applicability: "ambiguous",
		provider_action: "select_lineage",
	});
});

test("status reporting finalize reconciliation routes to rerunning the same finalize and never starts a new review", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const reconcile = targetStatusFixture({ action: "reconcile_finalize", lineageId: "native-lineage" });
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			throw new Error("reconcile_finalize must never start a new review");
		},
		targetStatus: async () => reconcile,
	}));
	const result = await controller.execute("reconcile-status", { operation: "status", lineageId: "native-lineage" }, undefined, undefined, context(cwd));
	assert.deepEqual(result.details, {
		operation: "status",
		status: "in-progress",
		result: reconcile.raw,
		provider_action: "reconcile_finalize",
		replayability: "status_required",
		reconciliation_required: true,
		lineage_id: "native-lineage",
		next_action: "rerun-native-finalize-same-lineage",
		required_status_action: "Finalize reconciliation required: rerun review.finalize for lineage native-lineage with the original content-bound payload; native discovery resumes committed authority. Never start a new review, create a new budget, launch a lens, or fall back to inventory discovery.",
	});
	assert.equal(starts, 0);
});

test("lost FINALIZE reconciled to reconcile_finalize reruns the same facade operation without a new review", async (t) => {
	const cwd = repository(t);
	const calls: string[] = [];
	let starts = 0;
	let finalizes = 0;
	const reconcile = targetStatusFixture({ action: "reconcile_finalize", lineageId: "native-lineage" });
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			throw new Error("reconcile_finalize must never start a new review");
		},
		finalize: async () => {
			calls.push("finalize");
			finalizes += 1;
			if (finalizes === 1) throw Object.assign(new Error("interrupted before receipt publication"), { mutationOutcome: "unknown", nextAction: "review.status" });
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r2" };
		},
		targetStatus: async () => {
			calls.push("status");
			return reconcile;
		},
	}));
	const interrupted = await controller.execute("reconcile-finalize", { operation: "finalize", lineageId: "native-lineage", input: "{}" }, undefined, undefined, context(cwd));
	assert.deepEqual(interrupted.details, {
		operation: "finalize",
		status: "blocked",
		outcome: "native-mutation-status-reconciled",
		mutation_outcome: "unknown",
		replayability: "status_required",
		next_action: "rerun-native-finalize-same-lineage",
		reconciliation: reconcile.raw,
		authority_applicability: "current_target",
		provider_action: "reconcile_finalize",
		reconciliation_required: true,
		lineage_id: "native-lineage",
		required_status_action: "Finalize reconciliation required: rerun review.finalize for lineage native-lineage with the original content-bound payload; native discovery resumes committed authority. Never start a new review, create a new budget, launch a lens, or fall back to inventory discovery.",
	});
	assert.deepEqual(calls, ["status", "finalize", "status"]);
	const replay = await controller.execute("reconcile-finalize-replay", { operation: "finalize", lineageId: "native-lineage", input: "{}" }, undefined, undefined, context(cwd));
	assert.deepEqual(replay.details, { operation: "finalize", result: { lineage_id: "native-lineage", state: "approved", action: "approved", store_revision: "r2" } });
	assert.equal(finalizes, 2);
	assert.equal(starts, 0);
});

test("START consulting a target status already in finalize reconciliation returns the rerun routing without any START", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const reconcile = targetStatusFixture({ action: "reconcile_finalize", lineageId: "reconcile-start-lineage" });
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			throw new Error("reconcile_finalize must never start a new review");
		},
		targetStatus: async () => reconcile,
	}));
	const result = await controller.execute("reconcile-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.status, "in-progress");
	assert.equal(details.provider_action, "reconcile_finalize");
	assert.equal(details.next_action, "rerun-native-finalize-same-lineage");
	assert.equal(details.lineage_id, "reconcile-start-lineage");
	assert.equal(details.reconciliation_required, true);
	assert.equal(starts, 0);
});

test("START with an explicit lineage fails closed when reconciliation reports a foreign lineage", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const foreign = targetStatusFixture({ action: "reconcile_finalize", lineageId: "start-mismatch-foreign" });
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			throw new Error("a mismatched reconciliation must never start a new review");
		},
		targetStatus: async () => foreign,
	}));
	const result = await controller.execute("start-mismatch", { operation: "start", lineageId: "start-mismatch-requested", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.status, "blocked", JSON.stringify(details));
	assert.equal(details.provider_action, "reconcile_finalize");
	assert.equal(details.next_action, "stop-and-report-reconcile-lineage-mismatch");
	assert.equal(details.requested_lineage_id, "start-mismatch-requested");
	assert.equal(details.authority_lineage_id, "start-mismatch-foreign");
	assert.equal(details.lineage_id, undefined);
	assert.doesNotMatch(JSON.stringify(details), /rerun-native-finalize-same-lineage/);
	assert.equal(starts, 0);
});

test("finalize reconciliation for a foreign lineage fails closed without a rerun directive", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const foreign = targetStatusFixture({ action: "reconcile_finalize", lineageId: "foreign-lineage" });
	let statuses = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			throw new Error("a mismatched reconciliation must never start a new review");
		},
		finalize: async () => {
			throw Object.assign(new Error("lost finalize response"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
		targetStatus: async () => {
			statuses += 1;
			return statuses === 1 ? targetStatusFixture({ action: "finalize", lineageId: "native-lineage" }) : foreign;
		},
	}));
	const reconciled = await controller.execute("mismatch-finalize", { operation: "finalize", lineageId: "native-lineage", input: "{}" }, undefined, undefined, context(cwd));
	const reconciledDetails = reconciled.details as Record<string, unknown>;
	assert.equal(reconciledDetails.outcome, "native-mutation-status-reconciled");
	assert.equal(reconciledDetails.provider_action, "reconcile_finalize");
	assert.equal(reconciledDetails.next_action, "stop-and-report-reconcile-lineage-mismatch");
	assert.equal(reconciledDetails.requested_lineage_id, "native-lineage");
	assert.equal(reconciledDetails.authority_lineage_id, "foreign-lineage");
	assert.equal(reconciledDetails.lineage_id, undefined);
	assert.doesNotMatch(JSON.stringify(reconciledDetails), /rerun-native-finalize-same-lineage/);
	const status = await controller.execute("mismatch-status", { operation: "status", lineageId: "native-lineage" }, undefined, undefined, context(cwd));
	const statusDetails = status.details as Record<string, unknown>;
	assert.equal(statusDetails.status, "blocked");
	assert.equal(statusDetails.next_action, "stop-and-report-reconcile-lineage-mismatch");
	assert.doesNotMatch(JSON.stringify(statusDetails), /rerun-native-finalize-same-lineage/);
	assert.equal(starts, 0);
});

test("repeated status observations of finalize reconciliation never consume the rerun budget", async (t) => {
	const cwd = repository(t);
	const reconcile = targetStatusFixture({ action: "reconcile_finalize", lineageId: "observe-lineage" });
	const { controller } = runtime(fakeNative({ targetStatus: async () => reconcile }));
	for (let observation = 1; observation <= 6; observation += 1) {
		const details = (await controller.execute(`observe-${observation}`, { operation: "status", lineageId: "observe-lineage" }, undefined, undefined, context(cwd))).details as Record<string, unknown>;
		assert.equal(details.next_action, "rerun-native-finalize-same-lineage", `observation ${observation}`);
		assert.equal(details.status, "in-progress", `observation ${observation}`);
	}
});

test("only finalize-driven reruns are counted and escalate to explicit maintainer action at the cap", async (t) => {
	const cwd = repository(t);
	const reconcile = targetStatusFixture({ action: "reconcile_finalize", lineageId: "cap-lineage" });
	const { controller } = runtime(fakeNative({
		finalize: async () => {
			throw Object.assign(new Error("interrupted before receipt publication"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
		targetStatus: async () => reconcile,
	}));
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const details = (await controller.execute(`cap-${attempt}`, { operation: "finalize", lineageId: "cap-lineage", input: "{}" }, undefined, undefined, context(cwd))).details as Record<string, unknown>;
		assert.equal(details.next_action, "rerun-native-finalize-same-lineage", `attempt ${attempt}`);
	}
	const capped = (await controller.execute("cap-4", { operation: "finalize", lineageId: "cap-lineage", input: "{}" }, undefined, undefined, context(cwd))).details as Record<string, unknown>;
	assert.equal(capped.status, "blocked");
	assert.equal(capped.provider_action, "reconcile_finalize");
	assert.equal(capped.next_action, "stop-and-escalate-finalize-reconciliation");
	assert.match(String(capped.required_status_action), /explicit maintainer action/);
	assert.doesNotMatch(JSON.stringify(capped), /rerun-native-finalize-same-lineage/);
	const observedAfterCap = (await controller.execute("cap-observe", { operation: "status", lineageId: "cap-lineage" }, undefined, undefined, context(cwd))).details as Record<string, unknown>;
	assert.equal(observedAfterCap.next_action, "stop-and-escalate-finalize-reconciliation");
	assert.equal(observedAfterCap.status, "blocked");
});

test("status_required outcomes without a reachable target status surface an actionable required status action", async (t) => {
	const cwd = repository(t);
	let statusCalls = 0;
	const { controller } = runtime(fakeNative({
		finalize: async () => {
			throw Object.assign(new Error("lost finalize response"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
		targetStatus: async () => {
			statusCalls += 1;
			if (statusCalls > 1) throw new Error("target status unavailable");
			return targetStatusFixture({ action: "finalize", lineageId: "native-lineage" });
		},
	}));
	const result = await controller.execute("status-required-finalize", { operation: "finalize", lineageId: "native-lineage", input: "{}" }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "native-mutation-status-reconciliation-failed");
	assert.equal(details.replayability, "status_required");
	assert.equal(details.next_action, "review.status");
	assert.equal(details.required_status_action, "Run target-scoped review.status for lineage native-lineage and follow only its declared action; never start a new review, create a new budget, launch a lens, or fall back to inventory discovery.");
	assert.equal((details.reconciliation_failure as { outcome?: string }).outcome, "native-operation-failed");
});

test("fresh registry reload ignores raw correction state and follows the native projection", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	mkdirSync(dirname(join(cwd, ".git", "gentle-ai", "review-transactions", "v2", "correction-lineage", "review-state.json")), { recursive: true });
	writeFileSync(join(cwd, ".git", "gentle-ai", "review-transactions", "v2", "correction-lineage", "review-state.json"), JSON.stringify({ schema: "gentle-ai.review-state-record/v2", state: { schema: "gentle-ai.review-state/v2", lineage_id: "correction-lineage", state: "correction_required", initial_snapshot: { kind: "current-changes", base_tree: frozen.baseTree, candidate_tree: frozen.candidateTree, paths: frozen.paths, paths_digest: "paths" }, current_snapshot: { kind: "current-changes", base_tree: frozen.baseTree, candidate_tree: frozen.candidateTree, paths: frozen.paths, paths_digest: "paths" }, fix_finding_ids: ["RELIABILITY-001"], findings: [{ id: "RELIABILITY-001", severity: "CRITICAL" }] } }));
	const status = bindCorrectionCollection(targetStatusFixture({ lineageId: "correction-lineage", authorityState: "correction_required", baseTree: frozen.baseTree, currentCandidateTree: frozen.candidateTree, paths: frozen.paths }));
	const validationStatus = bindTargetedValidation(targetStatusFixture({ lineageId: "correction-lineage", authorityState: "validating", baseTree: frozen.baseTree, currentCandidateTree: frozen.candidateTree, paths: frozen.paths }));
	frozen.cleanup();
	let finalizes = 0;
	let statuses = 0;
	const candidateViews = new CandidateViewRegistry();
	const { controller } = runtime(fakeNative({
		finalize: async () => { finalizes += 1; return { lineageId: "correction-lineage", state: "approved", action: "approved", storeRevision: "r2" }; },
		targetStatus: async () => { statuses += 1; return statuses === 1 ? status : validationStatus; },
		captureEvidence: async () => capturedCorrectionEvidence(status, "passed", "6"),
	}), undefined, candidateViews);
	const required = await controller.execute("correction-validation-request", { operation: "finalize", lineageId: "correction-lineage", input: JSON.stringify({ final_evidence: "focused tests passed", final_verification_passed: true }) }, undefined, undefined, context(cwd));
	const request = required.details as { status: string; result: Record<string, unknown> };
	assert.equal(request.status, "in-progress");
	assert.equal(request.result.action, "finalize");
	assert.equal("validation_request" in request, false);
	writeFileSync(join(cwd, "escape.ts"), "export const escape = true;\n");
	assert.equal(((await controller.execute("correction-scope-escape", { operation: "finalize", lineageId: "correction-lineage", input: JSON.stringify({ final_evidence: "focused tests passed", final_verification_passed: true }) }, undefined, undefined, context(cwd))).details as { outcome: string }).outcome, "native-operation-failed");
	assert.equal(finalizes, 0);
	candidateViews.cleanupAll();
});

test("production correction routing captures evidence before validation and enforces all three outcomes", async (t) => {
	for (const [outcome, expectedKind] of [
		["passed", "run-targeted-validation"],
		["verification_failed", "recapture-required"],
		["procedural_tooling_failed", "terminal-escalation"],
	] as const) {
		await t.test(outcome, async (scenario) => {
			const cwd = repository(scenario);
			writeFileSync(join(cwd, "app.ts"), `export const outcome = ${JSON.stringify(outcome)};\n`);
			const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
			const beforeCapture = bindCorrectionCollection(targetStatusFixture({
				lineageId: `correction-${outcome.replaceAll("_", "-")}`,
				authorityState: "correction_required",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			}));
			const afterCapture = targetStatusFixture({
				lineageId: beforeCapture.authority!.lineageId,
				authorityState: outcome === "procedural_tooling_failed" ? "escalated" : outcome === "passed" ? "validating" : "correction_required",
				action: outcome === "procedural_tooling_failed" ? "stop" : "finalize",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			});
			if (outcome === "passed") bindTargetedValidation(afterCapture);
			else if (outcome === "verification_failed") bindCorrectionCollection(afterCapture);
			frozen.cleanup();
			const calls: string[] = [];
			let statuses = 0;
			let finalizes = 0;
			const { controller } = runtime(fakeNative({
				targetStatus: async () => {
					calls.push("status");
					statuses += 1;
					return statuses === 1 ? beforeCapture : afterCapture;
				},
				captureEvidence: async (request) => {
					calls.push("capture-evidence");
					assert.equal(request.outcome, outcome);
					return capturedCorrectionEvidence(beforeCapture, outcome, outcome === "passed" ? "1" : outcome === "verification_failed" ? "2" : "3");
				},
				finalize: async () => {
					calls.push("finalize");
					finalizes += 1;
					return { lineageId: beforeCapture.authority!.lineageId, state: "approved", action: "approved", storeRevision: "r-final" };
				},
			}), undefined, new CandidateViewRegistry());
			const validation = outcome === "passed" ? {
				request_hash: "9".repeat(64), correction_ids: [],
				original_criteria: { passed: true, evidence: ["acceptance passes"] },
				correction_regression: { passed: true, evidence: ["regression passes"] },
				fix_caused_findings: [], follow_ups: [],
			} : undefined;
			const result = await controller.execute(`correction-${outcome}`, {
				operation: "finalize",
				lineageId: beforeCapture.authority!.lineageId,
				input: JSON.stringify({ final_evidence: `evidence: ${outcome}`, final_verification_outcome: outcome, ...(validation === undefined ? {} : { validation }) }),
			}, undefined, undefined, context(cwd));
			const details = result.details as Record<string, unknown>;
			assert.deepEqual(calls.slice(0, 3), ["status", "capture-evidence", "status"], "STATUS must collect evidence before targeted validation can run");
			assert.equal((details.correction_step as { kind?: string } | undefined)?.kind, expectedKind);
			assert.equal(finalizes, outcome === "passed" ? 1 : 0);
			if (outcome === "passed") assert.deepEqual(calls, ["status", "capture-evidence", "status", "finalize"]);
			else assert.deepEqual(calls, ["status", "capture-evidence", "status"]);
		});
	}
});

test("production correction routing fails closed when targeted validation is offered before evidence capture", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const corrected = true;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const premature = bindTargetedValidation(targetStatusFixture({ lineageId: "premature-validation", authorityState: "validating", baseTree: frozen.baseTree, currentCandidateTree: frozen.candidateTree, paths: frozen.paths }));
	frozen.cleanup();
	let captures = 0;
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => premature,
		captureEvidence: async () => { captures += 1; return capturedCorrectionEvidence(premature, "passed", "4"); },
		finalize: async () => { finalizes += 1; return { lineageId: "premature-validation", state: "approved", action: "approved", storeRevision: "r1" }; },
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("premature-targeted-validation", {
		operation: "finalize",
		lineageId: "premature-validation",
		input: JSON.stringify({
			final_evidence: "evidence first",
			final_verification_outcome: "passed",
			validation: { request_hash: "9".repeat(64), correction_ids: [], original_criteria: { passed: true, evidence: ["passes"] }, correction_regression: { passed: true, evidence: ["passes"] }, fix_caused_findings: [], follow_ups: [] },
		}),
	}, undefined, undefined, context(cwd));
	assert.equal((result.details as { outcome?: string }).outcome, "native-operation-failed");
	assert.equal(captures, 0);
	assert.equal(finalizes, 0);
});

test("production correction routing rejects a second capture that reuses failed evidence identity", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const corrected = 1;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const status = bindCorrectionCollection(targetStatusFixture({ lineageId: "distinct-evidence", authorityState: "correction_required", baseTree: frozen.baseTree, currentCandidateTree: frozen.candidateTree, paths: frozen.paths }));
	frozen.cleanup();
	let captures = 0;
	let finalizes = 0;
	const candidateViews = new CandidateViewRegistry();
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		captureEvidence: async () => {
			captures += 1;
			return capturedCorrectionEvidence(status, "verification_failed", "5");
		},
		finalize: async () => { finalizes += 1; return { lineageId: "distinct-evidence", state: "approved", action: "approved", storeRevision: "r1" }; },
	}), undefined, candidateViews);
	const request = {
		operation: "finalize",
		lineageId: "distinct-evidence",
		input: JSON.stringify({ final_evidence: "verification failed", final_verification_outcome: "verification_failed" }),
	};
	const first = await controller.execute("distinct-first", request, undefined, undefined, context(cwd));
	assert.equal(((first.details as { correction_step?: { kind?: string } }).correction_step?.kind), "recapture-required");
	writeFileSync(join(cwd, "app.ts"), "export const corrected = 2;\n");
	const changed = new CandidateViewRegistry().create({ contributorRoot: cwd });
	status.projection.currentCandidateTree = changed.candidateTree;
	status.projection.paths = changed.paths;
	changed.cleanup();
	const second = await controller.execute("distinct-second", request, undefined, undefined, context(cwd));
	assert.equal((second.details as { outcome?: string }).outcome, "native-operation-failed");
	assert.match(JSON.stringify(second.details), /correction-evidence-replaced/);
	assert.equal(captures, 2);
	assert.equal(finalizes, 0);
	candidateViews.cleanupTerminal("distinct-evidence", "escalated");
	execFileSync("chmod", ["-R", "u+w", cwd]);
});

// Live-emitter correction shapes (probed 2026-08-16 against BOTH the pinned
// 2.2.3 binary and dev 2.4.0-main.b1afef46, scripted correction lane):
// - The evidence-collect status at `correction_required` carries the
//   `validation_request` CONTEXT alongside its single `review.capture-evidence`
//   input (reason correction_repository_verification_required). The request
//   context is not an offered validation step.
// - The post-evidence targeted-validation status keeps state
//   `correction_required` (never `validating`), and its
//   `external.run_targeted_validation` input embeds the identical
//   validation_request.
test("production correction routing accepts the live emitters' early validation-request context and correction_required post-evidence state", async (t) => {
	for (const [outcome, expectedKind] of [
		["passed", "run-targeted-validation"],
		["verification_failed", "recapture-required"],
	] as const) {
		await t.test(outcome, async (scenario) => {
			const cwd = repository(scenario);
			writeFileSync(join(cwd, "app.ts"), `export const live = ${JSON.stringify(outcome)};\n`);
			const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
			const beforeCapture = bindCorrectionCollection(targetStatusFixture({
				lineageId: `live-correction-${outcome.replaceAll("_", "-")}`,
				authorityState: "correction_required",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			}));
			// The live emitters publish the request context BEFORE evidence.
			beforeCapture.validationRequest = bindTargetedValidation(targetStatusFixture({
				lineageId: beforeCapture.authority!.lineageId,
				authorityState: "correction_required",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			})).validationRequest;
			const afterCapture = targetStatusFixture({
				lineageId: beforeCapture.authority!.lineageId,
				// Live post-evidence state on both emitters.
				authorityState: "correction_required",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			});
			if (outcome === "passed") bindTargetedValidation(afterCapture);
			else {
				bindCorrectionCollection(afterCapture);
				afterCapture.validationRequest = beforeCapture.validationRequest;
			}
			frozen.cleanup();
			const calls: string[] = [];
			let statuses = 0;
			let finalizes = 0;
			const { controller } = runtime(fakeNative({
				targetStatus: async () => {
					calls.push("status");
					statuses += 1;
					return statuses === 1 ? beforeCapture : afterCapture;
				},
				captureEvidence: async (request) => {
					calls.push("capture-evidence");
					assert.equal(request.outcome, outcome);
					return capturedCorrectionEvidence(beforeCapture, outcome, outcome === "passed" ? "7" : "8");
				},
				finalize: async () => {
					calls.push("finalize");
					finalizes += 1;
					return { lineageId: beforeCapture.authority!.lineageId, state: "approved", action: "approved", storeRevision: "r-final" };
				},
			}), undefined, new CandidateViewRegistry());
			const validation = outcome === "passed" ? {
				request_hash: "9".repeat(64), correction_ids: [],
				original_criteria: { passed: true, evidence: ["acceptance passes"] },
				correction_regression: { passed: true, evidence: ["regression passes"] },
				fix_caused_findings: [], follow_ups: [],
			} : undefined;
			const result = await controller.execute(`live-correction-${outcome}`, {
				operation: "finalize",
				lineageId: beforeCapture.authority!.lineageId,
				input: JSON.stringify({ final_evidence: `evidence: ${outcome}`, final_verification_outcome: outcome, ...(validation === undefined ? {} : { validation }) }),
			}, undefined, undefined, context(cwd));
			const details = result.details as Record<string, unknown>;
			assert.deepEqual(calls.slice(0, 3), ["status", "capture-evidence", "status"], "the early validation-request context must not block the evidence capture the state demands");
			assert.equal((details.correction_step as { kind?: string } | undefined)?.kind, expectedKind);
			assert.equal(finalizes, outcome === "passed" ? 1 : 0);
		});
	}
});

// Ordinary final verification (field defect, dev binary 2.4.0-main.b1afef46,
// reproduced identically on the pinned 2.2.3 binary): after FINALIZE with
// captured results the native state is `validating` and the provider collects
// exactly one `review.capture-evidence` record, then offers one execute
// `review.finalize --captured-evidence=true` transition. The controller must
// follow that transition faithfully — it must never demand its correction-lane
// targeted-validation phase, and never substitute the validate gate.
function bindFinalVerificationTransition(status: ReviewStatusV3, outcome: "passed" | "verification_failed" | "procedural_tooling_failed"): ReviewStatusV3 {
	const reasonCode = outcome === "passed"
		? "captured_verification_evidence_passed"
		: outcome === "verification_failed" ? "captured_verification_failed" : "captured_verification_tooling_failed";
	status.nextTransition = {
		kind: "execute",
		reasonCode,
		execute: {
			operation: "review.finalize",
			// The second argument deliberately omits `token` to pin the
			// provider's published hyphenation fallback (captured_evidence ->
			// --captured-evidence=true); the host never invents another form.
			arguments: [
				{ name: "lineage", value: status.authority!.lineageId, token: `--lineage=${status.authority!.lineageId}` },
				{ name: "captured_evidence", value: "true" },
			],
			preconditions: [{ name: "state", value: "validating" }, { name: "verification_outcome", value: outcome }],
			binding: { targetIdentity: status.targetIdentity, lineageId: status.authority!.lineageId },
		},
	};
	delete status.validationRequest;
	return status;
}

test("ordinary final verification at validating captures evidence then executes the provider finalize transition, never targeted validation", async (t) => {
	for (const [outcome, terminalState] of [
		["passed", "approved"],
		["verification_failed", "escalated"],
		["procedural_tooling_failed", "escalated"],
	] as const) {
		await t.test(outcome, async (scenario) => {
			const cwd = repository(scenario);
			writeFileSync(join(cwd, "app.ts"), `export const outcome = ${JSON.stringify(outcome)};\n`);
			const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
			const beforeCapture = bindCorrectionCollection(targetStatusFixture({
				lineageId: "final-verification",
				authorityState: "validating",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			}));
			const afterCapture = bindFinalVerificationTransition(targetStatusFixture({
				lineageId: "final-verification",
				authorityState: "validating",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			}), outcome);
			frozen.cleanup();
			const calls: string[] = [];
			const transitions: Array<readonly string[]> = [];
			let statuses = 0;
			const { controller } = runtime(fakeNative({
				targetStatus: async () => {
					calls.push("status");
					statuses += 1;
					return statuses === 1 ? beforeCapture : afterCapture;
				},
				captureEvidence: async (request) => {
					calls.push("capture-evidence");
					assert.equal(request.outcome, outcome);
					return capturedCorrectionEvidence(beforeCapture, outcome, "6");
				},
				finalize: async () => {
					calls.push("finalize");
					return { lineageId: "final-verification", state: terminalState, action: "terminal", storeRevision: "r2" };
				},
				finalizeTransition: async (request) => {
					calls.push("finalize-transition");
					transitions.push(request.argumentTokens);
					return { lineageId: "final-verification", state: terminalState, action: "terminal", storeRevision: "r2", receiptPath: "/opaque/receipt" };
				},
			}), undefined, new CandidateViewRegistry());
			const result = await controller.execute(`final-verification-${outcome}`, {
				operation: "finalize",
				lineageId: "final-verification",
				input: JSON.stringify({ final_evidence: `verification run: ${outcome}`, final_verification_outcome: outcome }),
			}, undefined, undefined, context(cwd));
			const details = result.details as Record<string, unknown>;
			assert.deepEqual(calls, ["status", "capture-evidence", "status", "finalize-transition"], "the controller must follow the provider transition after evidence capture");
			assert.deepEqual(transitions, [["--lineage=final-verification", "--captured-evidence=true"]]);
			assert.equal((details.result as { state?: string } | undefined)?.state, terminalState);
			assert.equal("correction_step" in details, false, "ordinary final verification is not a correction transaction");
		});
	}
});

test("ordinary final verification with advisory findings completes once without STATUS reconciliation", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const advisory = true;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const beforeCapture = bindCorrectionCollection(targetStatusFixture({
		lineageId: "advisory-final-verification",
		authorityState: "validating",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}));
	const afterCapture = bindFinalVerificationTransition(targetStatusFixture({
		lineageId: "advisory-final-verification",
		authorityState: "validating",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}), "passed");
	frozen.cleanup();
	const advisoryFindings = {
		statement: "Approval stands; these findings require no correction.",
		findings: [{
			id: "review-advisory-001",
			lens: "review-reliability",
			location: "lib/review.ts:12",
			severity: "WARNING",
			disposition: "informational",
		}],
	};
	const calls: string[] = [];
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			calls.push("status");
			return calls.filter((call) => call === "status").length === 1 ? beforeCapture : afterCapture;
		},
		captureEvidence: async () => {
			calls.push("capture-evidence");
			return capturedCorrectionEvidence(beforeCapture, "passed", "6");
		},
		finalizeTransition: async () => {
			calls.push("finalize-transition");
			return {
				lineageId: "advisory-final-verification",
				state: "approved",
				action: "terminal",
				storeRevision: "r2",
				advisoryFindings,
			};
		},
		finalize: async () => {
			throw new Error("ordinary final verification must use the provider finalize transition");
		},
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("advisory-final-verification", {
		operation: "finalize",
		lineageId: "advisory-final-verification",
		input: JSON.stringify({
			final_evidence: "verification run: passed",
			final_verification_outcome: "passed",
		}),
	}, undefined, undefined, context(cwd));
	const details = result.details as { result?: { advisory_findings?: unknown } };
	assert.deepEqual(calls, ["status", "capture-evidence", "status", "finalize-transition"]);
	assert.deepEqual(details.result?.advisory_findings, advisoryFindings);
});

test("ordinary final verification rejects a Pi-authored targeted validation document before any capture", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const status = bindCorrectionCollection(targetStatusFixture({
		lineageId: "final-verification",
		authorityState: "validating",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}));
	frozen.cleanup();
	let captures = 0;
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		captureEvidence: async () => { captures += 1; return capturedCorrectionEvidence(status, "passed", "4"); },
		finalize: async () => { finalizes += 1; return { lineageId: "final-verification", state: "approved", action: "approved", storeRevision: "r1" }; },
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("final-verification-validation-doc", {
		operation: "finalize",
		lineageId: "final-verification",
		input: JSON.stringify({
			final_evidence: "verification run: passed",
			final_verification_outcome: "passed",
			validation: { request_hash: "9".repeat(64), correction_ids: [], original_criteria: { passed: true, evidence: ["passes"] }, correction_regression: { passed: true, evidence: ["passes"] }, fix_caused_findings: [], follow_ups: [] },
		}),
	}, undefined, undefined, context(cwd));
	assert.equal((result.details as { outcome?: string }).outcome, "native-operation-failed");
	assert.match(JSON.stringify(result.details), /final-verification-provider-owned/);
	assert.equal(captures, 0, "an inadmissible payload must fail closed before the single evidence capture is consumed");
	assert.equal(finalizes, 0);
});

test("ordinary final verification fails closed without substituting a step when the provider offers no finalize transition", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const beforeCapture = bindCorrectionCollection(targetStatusFixture({
		lineageId: "final-verification",
		authorityState: "validating",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}));
	const afterCapture = targetStatusFixture({
		lineageId: "final-verification",
		authorityState: "validating",
		action: "stop",
		replayability: "manual_action_required",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	});
	frozen.cleanup();
	let statuses = 0;
	let finalizes = 0;
	let transitions = 0;
	let validates = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statuses += 1;
			return statuses === 1 ? beforeCapture : afterCapture;
		},
		captureEvidence: async () => capturedCorrectionEvidence(beforeCapture, "passed", "5"),
		finalize: async () => { finalizes += 1; return { lineageId: "final-verification", state: "approved", action: "approved", storeRevision: "r1" }; },
		finalizeTransition: async () => { transitions += 1; return { lineageId: "final-verification", state: "approved", action: "approved", storeRevision: "r1" }; },
		validate: async () => { validates += 1; return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() }; },
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("final-verification-no-transition", {
		operation: "finalize",
		lineageId: "final-verification",
		input: JSON.stringify({ final_evidence: "verification run: passed", final_verification_outcome: "passed" }),
	}, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "final-verification-transition-unavailable");
	assert.equal(details.mutation_performed, true, "the committed evidence capture must never be reported as zero mutations");
	assert.equal(details.mutation_outcome, "committed");
	assert.equal(finalizes, 0, "no substitute finalize form may be invented");
	assert.equal(transitions, 0);
	assert.equal(validates, 0, "the validate gate must never be substituted for a missing transition");
});

// gentle-pi#311 P4-roles fixture: one provider-rendered SELF-CONTAINED role
// capture vector (binding tokens + --agent=pi --execute=true, no submission).
function bindProviderRoleVector(status: ReviewStatusV3, role: "refuter" | "targeted-validator"): ReviewStatusV3 {
	const authority = status.authority!;
	const contextHandle = `rctx1_${"c".repeat(64)}`;
	const requestHash = `sha256:${"9".repeat(64)}`;
	const argumentsList = [
		{ name: "lineage", value: authority.lineageId, token: `--lineage=${authority.lineageId}` },
		{ name: "expected-revision", value: authority.revision, token: `--expected-revision=${authority.revision}` },
		{ name: "target", value: status.targetIdentity, token: `--target=${status.targetIdentity}` },
		{ name: "repository-context", value: contextHandle, token: `--repository-context=${contextHandle}` },
		...(role === "targeted-validator" ? [{ name: "request-hash", value: requestHash, token: `--request-hash=${requestHash}` }] : []),
		{ name: "agent", value: "pi", token: "--agent=pi" },
		{ name: "execute", value: "true", token: "--execute=true" },
	];
	status.nextTransition = {
		kind: "collect",
		reasonCode: role === "refuter" ? "provider_refuter_required" : "targeted_validation_required",
		collect: { inputs: [role === "refuter" ? {
			name: "provider_refuter",
			schema: "https://gentle-ai.dev/schema/review/refuter/v1",
			captureOperation: "review.capture-refuter",
			arguments: argumentsList,
		} : {
			name: "provider_targeted_validator",
			schema: "https://gentle-ai.dev/schema/review/validator/v1",
			captureOperation: "review.capture-validation",
			arguments: argumentsList,
			validationRequest: {
				schema: "gentle-ai.review-targeted-validation-request/v1" as const,
				requestHash,
				lineageId: authority.lineageId,
				expectedRevision: authority.revision,
				targetIdentity: status.targetIdentity,
				fixFindingIds: ["RISK-001"],
				projection: "workspace" as const,
				correctionCandidateTree: status.projection.currentCandidateTree,
				correctionTargetIdentity: status.targetIdentity,
				correctionPaths: status.projection.paths,
				correctionPathsDigest: status.projection.pathsDigest,
			},
		}] },
	};
	return status;
}

test("provider refuter vector executes exactly as rendered, then STATUS is re-queried", async (t) => {
	const cwd = repository(t);
	const executed: Array<{ captureOperation: string; argumentTokens: readonly string[]; cwd: string }> = [];
	let finalizes = 0;
	let statusCalls = 0;
	const roleStatus = bindProviderRoleVector(targetStatusFixture({ lineageId: "native-lineage" }), "refuter");
	const settledStatus = targetStatusFixture({ lineageId: "native-lineage", authorityState: "approved", action: "stop" });
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statusCalls += 1;
			return statusCalls === 1 ? roleStatus : settledStatus;
		},
		finalize: async () => {
			finalizes += 1;
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
		captureProviderRole: async (request) => {
			executed.push({ captureOperation: request.captureOperation, argumentTokens: request.argumentTokens, cwd: request.cwd });
			return { schema: "gentle-ai.review-provider-role-capture/v1", lineageId: "native-lineage", targetIdentity: roleStatus.targetIdentity, role: "refuter", captured: true };
		},
	}));
	const result = await controller.execute("role-vector", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.deepEqual(executed, [{
		captureOperation: "review.capture-refuter",
		argumentTokens: [
			"--lineage=native-lineage",
			`--expected-revision=sha256:${"a".repeat(64)}`,
			`--target=sha256:${"a".repeat(64)}`,
			`--repository-context=rctx1_${"c".repeat(64)}`,
			"--agent=pi",
			"--execute=true",
		],
		cwd,
	}]);
	assert.equal(finalizes, 0, "role vectors never route through document finalize");
	assert.equal(statusCalls, 2, "STATUS must be re-queried after the vector executes");
	const details = result.details as { provider_roles?: { transport?: string; executed_slots?: Array<Record<string, unknown>> } };
	assert.equal(details.provider_roles?.transport, "go_owned_pi_process");
	assert.deepEqual(details.provider_roles?.executed_slots?.map((slot) => slot.role), ["refuter"]);
	assert.equal((result.details as { result?: { authority?: { state?: string } } }).result?.authority?.state, "approved");
});

test("provider targeted-validator vector keeps the frozen request hash token verbatim", async (t) => {
	const cwd = repository(t);
	const executed: string[][] = [];
	let statusCalls = 0;
	const roleStatus = bindProviderRoleVector(targetStatusFixture({ lineageId: "native-lineage", authorityState: "validating" }), "targeted-validator");
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statusCalls += 1;
			return statusCalls === 1 ? roleStatus : targetStatusFixture({ lineageId: "native-lineage" });
		},
		captureProviderRole: async (request) => {
			executed.push([...request.argumentTokens]);
			return { schema: "gentle-ai.review-provider-role-capture/v1", lineageId: "native-lineage", targetIdentity: roleStatus.targetIdentity, role: "targeted-validator", captured: true };
		},
	}));
	await controller.execute("validator-vector", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.equal(executed.length, 1);
	assert.ok(executed[0]!.includes(`--request-hash=sha256:${"9".repeat(64)}`), "the frozen request hash token must pass through verbatim");
	assert.ok(executed[0]!.includes("--execute=true"));
});

test("document-free FINALIZE queries fresh STATUS after provider validation capture and executes only its transition", async (t) => {
	const cwd = repository(t);
	const lineageId = "fresh-provider-status";
	const roleStatus = bindProviderRoleVector(targetStatusFixture({ lineageId, authorityState: "validating" }), "targeted-validator");
	const providerFinalizeStatus = (repositoryContext: string): ReviewStatusV3 => {
		const status = targetStatusFixture({ lineageId, authorityState: "validating" });
		(status.raw as Record<string, unknown>).schema = "gentle-ai.review-integration.status/v5";
		status.nextTransition = {
			kind: "execute",
			reasonCode: "captured_evidence_ready",
			execute: {
				operation: "review.finalize",
				arguments: [
					{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
					{ name: "expected-revision", value: status.authority!.revision, token: `--expected-revision=${status.authority!.revision}` },
					{ name: "target", value: status.targetIdentity, token: `--target=${status.targetIdentity}` },
					{ name: "repository-context", value: repositoryContext, token: `--repository-context=${repositoryContext}` },
					{ name: "captured-evidence", value: "true", token: "--captured-evidence=true" },
				],
				preconditions: [],
				binding: { targetIdentity: status.targetIdentity, lineageId },
			},
		};
		return status;
	};
	const capturedStatus = providerFinalizeStatus(`rctx1_${"a".repeat(64)}`);
	const freshStatus = providerFinalizeStatus(`rctx1_${"b".repeat(64)}`);
	const transitions: Array<readonly string[]> = [];
	let statusCalls = 0;
	let captures = 0;
	let rawFinalizes = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statusCalls += 1;
			return [roleStatus, capturedStatus, freshStatus][statusCalls - 1]!;
		},
		captureProviderRole: async () => {
			captures += 1;
			return { schema: "gentle-ai.review-provider-role-capture/v1", lineageId, targetIdentity: roleStatus.targetIdentity, role: "targeted-validator", captured: true };
		},
		finalizeTransition: async (request) => {
			transitions.push(request.argumentTokens);
			return { lineageId, state: "approved", action: "approved", storeRevision: "r-final" };
		},
		finalize: async () => {
			rawFinalizes += 1;
			return { lineageId, state: "approved", action: "approved", storeRevision: "r-raw" };
		},
	}));
	await controller.execute("capture-provider-validation", { operation: "finalize", lineageId, input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.equal(captures, 1);
	assert.equal(statusCalls, 2, "provider validation capture must return its fresh mapped STATUS without retaining it");
	const finalized = await controller.execute("finalize-after-provider-validation", { operation: "finalize", lineageId, input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.equal(statusCalls, 3, "document-free FINALIZE must query negotiated STATUS again after provider validation capture");
	assert.deepEqual(transitions, [[
		`--lineage=${lineageId}`,
		`--expected-revision=${freshStatus.authority!.revision}`,
		`--target=${freshStatus.targetIdentity}`,
		`--repository-context=rctx1_${"b".repeat(64)}`,
		"--captured-evidence=true",
	]], "only the fresh STATUS transition may reach finalizeTransition");
	assert.equal(rawFinalizes, 0, "the fresh provider execute transition must win over raw captured-results fallback");
	assert.equal((finalized.details as { result?: { state?: string } }).result?.state, "approved");
});

test("a failed provider role vector surfaces the typed error and never auto-relaunches", async (t) => {
	const cwd = repository(t);
	let captures = 0;
	let statusCalls = 0;
	const roleStatus = bindProviderRoleVector(targetStatusFixture({ lineageId: "native-lineage" }), "refuter");
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statusCalls += 1;
			return roleStatus;
		},
		captureProviderRole: async () => {
			captures += 1;
			throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.CAPTURE_PROVIDER_ROLE, true, "provider refused the role capture");
		},
	}));
	const result = await controller.execute("role-vector-failure", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "provider-role-vector-failed");
	assert.equal(details.status, "blocked");
	assert.match(String(details.retry_discipline), /Re-query negotiated STATUS/);
	assert.equal(captures, 1, "a failed vector must not be relaunched from transcript inference");
	assert.equal(statusCalls, 1, "the failure envelope is surfaced without a blind relaunch loop");
});

test("negotiated FINALIZE executes the provider-rendered captured-results transition verbatim", async (t) => {
	const cwd = repository(t);
	const transitions: Array<{ cwd: string; argumentTokens: readonly string[] }> = [];
	let finalizes = 0;
	const status = targetStatusFixture({ lineageId: "native-lineage" });
	status.nextTransition = {
		kind: "execute",
		reasonCode: "captured_results_ready",
		execute: {
			operation: "review.finalize",
			// The second argument deliberately omits `token` to pin the
			// provider's published hyphenation fallback (captured_results ->
			// --captured-results=true); the host never invents another form.
			arguments: [
				{ name: "lineage", value: "native-lineage", token: "--lineage=native-lineage" },
				{ name: "captured_results", value: "true" },
			],
			preconditions: [{ name: "state", value: "reviewing" }],
			binding: { targetIdentity: status.targetIdentity, lineageId: "native-lineage" },
		},
	};
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		finalize: async () => {
			finalizes += 1;
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
		finalizeTransition: async (request) => {
			transitions.push({ cwd: request.cwd, argumentTokens: request.argumentTokens });
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" };
		},
	}));
	const result = await controller.execute("captured-results-finalize", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.deepEqual(transitions, [{ cwd, argumentTokens: ["--lineage=native-lineage", "--captured-results=true"] }]);
	assert.equal(finalizes, 0, "the provider-driven lane never assembles a document finalize");
	assert.deepEqual(result.details, { operation: "finalize", result: { lineage_id: "native-lineage", state: "approved", action: "approved", store_revision: "r1", receipt_path: "/opaque/receipt" } });
});

test("status/v5 FINALIZE refuses a provider transition without exact tokens before adapter invocation", async (t) => {
	const cwd = repository(t);
	let transitions = 0;
	let finalizes = 0;
	const status = targetStatusFixture({ lineageId: "native-lineage" });
	(status.raw as Record<string, unknown>).schema = "gentle-ai.review-integration.status/v5";
	status.nextTransition = {
		kind: "execute",
		reasonCode: "captured_results_ready",
		execute: {
			operation: "review.finalize",
			arguments: [
				{ name: "lineage", value: "native-lineage", token: "--lineage=native-lineage" },
				{ name: "captured_results", value: "true" },
			],
			preconditions: [],
			binding: { targetIdentity: status.targetIdentity, lineageId: "native-lineage" },
		},
	};
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		finalize: async () => {
			finalizes += 1;
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
		finalizeTransition: async () => {
			transitions += 1;
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}));
	const result = await controller.execute("v5-missing-finalize-token", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.equal((result.details as { outcome?: string }).outcome, "native-operation-failed");
	assert.match(JSON.stringify(result.details), /non-empty exact token/);
	assert.equal(transitions, 0, "a v5 transition missing an exact token must fail before finalizeTransition");
	assert.equal(finalizes, 0, "a v5 transition missing an exact token must not fall back to raw finalize");
});

test("negotiated FINALIZE refuses a finalize transition bound to a different lineage", async (t) => {
	const cwd = repository(t);
	let transitions = 0;
	const status = targetStatusFixture({ lineageId: "native-lineage" });
	status.nextTransition = {
		kind: "execute",
		reasonCode: "captured_results_ready",
		execute: {
			operation: "review.finalize",
			arguments: [{ name: "lineage", value: "other-lineage", token: "--lineage=other-lineage" }],
			preconditions: [],
			binding: { targetIdentity: status.targetIdentity, lineageId: "other-lineage" },
		},
	};
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		finalizeTransition: async () => {
			transitions += 1;
			return { lineageId: "other-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}));
	const result = await controller.execute("foreign-transition", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.equal((result.details as { outcome?: string }).outcome, "native-operation-failed");
	assert.match(JSON.stringify(result.details), /finalize-transition-binding-drift/);
	assert.equal(transitions, 0);
});

test("native FINALIZE rejects the retired Pi-authored payload fields before native calls", async (t) => {
	const cwd = repository(t);
	let finalizes = 0;
	const { controller } = runtime(fakeNative({ finalize: async () => {
		finalizes += 1;
		return { lineageId: "native-lineage", state: "validating", action: "continue", storeRevision: "r1" };
	} }));
	for (const retired of [
		{ review_result: { lens_results: [{ lens: "review-risk", findings: [], evidence: ["reviewed"] }] } },
		{ refuter_batch: { schema: "gentle-ai.refuter-result-batch/v1", request_hash: "a".repeat(64), results: [] } },
		{ validation_proof: { original_criteria: { passed: true, evidence: ["ok"] }, correction_regression: { passed: true, evidence: ["ok"] } } },
	]) {
		await assert.rejects(controller.execute("retired-field", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify(retired) }, undefined, undefined, context(cwd)));
	}
	assert.equal(finalizes, 0);
});

test("controller preserves final evidence bytes through native staging", async (t) => {
	const cwd = repository(t);
	const evidence = " \tleading and trailing evidence\n\n";
	let staged = "";
	const native = new NativeReviewCliV214(async (request) => {
		if (request.arguments[0] === "version") return { stdout: "gentle-ai 2.1.4\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		const index = request.arguments.indexOf("--evidence");
		assert.ok(index >= 0);
		staged = readFileSync(request.arguments[index + 1]!, "utf8");
		return { stdout: JSON.stringify({ operation: "review/finalize", lineage_id: "native-lineage", state: "approved", action: "approved", store_revision: "sha256:" + "a".repeat(64) }), stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
	});
	native.targetStatus = async () => targetStatusFixture({ lineageId: "native-lineage" });
	const { controller } = runtime(native);
	await controller.execute("evidence-bytes", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ final_evidence: evidence, final_verification_passed: true }) }, undefined, undefined, context(cwd));
	assert.equal(staged, evidence);
});

test("controller rejects zero-length final evidence before native calls", async (t) => {
	const cwd = repository(t);
	let finalizes = 0;
	const { controller } = runtime(fakeNative({ finalize: async () => {
		finalizes += 1;
		return { lineageId: "native-lineage", state: "approved", action: "continue", storeRevision: "r1" };
	} }));
	await assert.rejects(controller.execute("empty-evidence", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ final_evidence: "", final_verification_passed: true }) }, undefined, undefined, context(cwd)));
	assert.equal(finalizes, 0);
});

test("native FINALIZE never assembles reviewer documents and forwards only the correction forecast", async (t) => {
	const cwd = repository(t);
	const requests: Parameters<NativeReviewCli["finalize"]>[0][] = [];
	const { controller } = runtime(fakeNative({ finalize: async (request) => {
		requests.push(request);
		return { lineageId: "native-lineage", state: "correction_required", action: "continue correction", storeRevision: `r${requests.length}` };
	} }));
	await controller.execute("initial", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	await controller.execute("retry", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ correction_line_forecast: 1 }) }, undefined, undefined, context(cwd));
	assert.equal(requests[0]?.lensResults, undefined, "lens results are admitted natively, never Pi-assembled");
	assert.equal(requests[0]?.refuterDocument, undefined);
	assert.equal(requests[1]?.lensResults, undefined);
	assert.equal(requests[1]?.correctionLines, 1);
});

test("native error has no compact fallback and ambiguous mutation demands target status", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	let statusCalls = 0;
	const { controller } = runtime(fakeNative({
		start: async () => { throw Object.assign(new Error("lost output"), { mutationOutcome: "unknown", nextAction: "review.status" }); },
		targetStatus: async () => {
			statusCalls += 1;
			if (statusCalls > 1) throw new Error("target status unavailable");
			return targetStatusFixture({ applicability: "unrelated", action: "start" });
		},
	}));
	const result = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "native-mutation-status-reconciliation-failed");
	assert.equal(details.mutation_outcome, "unknown");
	assert.equal(details.replayability, "status_required");
	assert.equal(details.next_action, "review.status");
	assert.equal((details.reconciliation_failure as { outcome?: string }).outcome, "native-operation-failed");
});

test("native START preserves a candidate-view diagnostic before native invocation", async (t) => {
	const cwd = repository(t);
	try {
		symlinkSync("../escape", join(cwd, "unsafe-link"));
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("unsafe-symlink-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "native-operation-failed");
	assert.equal(details.mutation_outcome, "none");
	assert.equal(details.next_action, "resolve-native-operation-failure");
	assert.deepEqual(details.diagnostics, { code: "candidate-view-invalid", message: "candidate view symlink target escapes its frozen root or enters metadata" });
	assert.equal(starts, 0);
});

test("native START returns a structured pre-native candidate-view output-limit diagnostic without calling native START", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const candidateViews = new CandidateViewRegistry(() => {
		throw Object.assign(new Error("sensitive stderr and candidate bytes"), { code: "ENOBUFS", stderr: Buffer.from("sensitive stderr and candidate bytes") });
	});
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, candidateViews);
	const result = await controller.execute("candidate-view-output-limit", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "native-operation-failed");
	assert.equal(details.lineage_created, false);
	assert.equal(details.mutation_outcome, "none");
	assert.deepEqual(details.diagnostics, {
		phase: "candidate-view",
		category: "output-limit",
		git_subcommand: "rev-parse",
		timeout_ms: 10_000,
		max_buffer_bytes: 64 * 1024 * 1024,
		message: "candidate-view Git command rev-parse exceeded the 67108864-byte output limit; inspect the candidate state before any new START",
	});
	assert.doesNotMatch(JSON.stringify(details), /sensitive stderr|candidate bytes/);
	assert.equal(starts, 0);
});

test("ambiguous native START failure preserves rebuilt sanitized diagnostics across duplicated module instances", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const diagnostics = { operation: "review/start", error_code: "timeout", exit_code: 1, timed_out: true, output_limit_exceeded: false, stderr: "projection stalled token=abc123" };
	const foreignInstance = Object.assign(new Error("native process timed out"), { name: "NativeReviewCliError", code: "timeout", mutationOutcome: "unknown", nextAction: "replay-exact-native-operation", diagnostics });
	let statusCalls = 0;
	const { controller } = runtime(fakeNative({
		start: async () => { throw foreignInstance; },
		targetStatus: async () => {
			statusCalls += 1;
			if (statusCalls > 1) throw new Error("target status unavailable");
			return targetStatusFixture({ applicability: "unrelated", action: "start" });
		},
	}));
	const result = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "native-mutation-status-reconciliation-failed");
	assert.equal(details.mutation_outcome, "unknown");
	assert.deepEqual(details.diagnostics, { operation: "review/start", error_code: "timeout", exit_code: 1, timed_out: true, output_limit_exceeded: false, stderr: "projection stalled token=[REDACTED]" });
	assert.equal((details.reconciliation_failure as { outcome?: string }).outcome, "native-operation-failed");
});

test("foreign errors with unrecognized diagnostics shapes stay diagnostics-free", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const malformedShapes: Record<string, unknown>[] = [
		{ name: "NativeReviewCliError", code: "timeout", diagnostics: { operation: "review/start", error_code: "timeout", timed_out: "yes", output_limit_exceeded: false } },
		{ name: "NativeReviewCliError", code: "timeout", diagnostics: { operation: "review/start", error_code: "timeout", timed_out: true, output_limit_exceeded: false, unexpected: "extra" } },
		{ name: "NativeReviewCliError", code: "timeout", diagnostics: { operation: "not-an-operation", error_code: "timeout", timed_out: true, output_limit_exceeded: false } },
		{ name: "NativeReviewCliError", code: "timeout", diagnostics: { operation: "review/finalize", error_code: "timeout", timed_out: true, output_limit_exceeded: false } },
		{ name: "NativeReviewCliError", code: "version-incompatible", diagnostics: { operation: "review/start", error_code: "timeout", timed_out: true, output_limit_exceeded: false } },
		{ code: "timeout", diagnostics: { stderr: "raw unsanitized output" } },
	];
	for (const shape of malformedShapes) {
		const foreignError = Object.assign(new Error("boom"), { mutationOutcome: "unknown", ...shape });
		let statusCalls = 0;
		const { controller } = runtime(fakeNative({
			start: async () => { throw foreignError; },
			targetStatus: async () => {
				statusCalls += 1;
				if (statusCalls > 1) throw new Error("target status unavailable");
				return targetStatusFixture({ applicability: "unrelated", action: "start" });
			},
		}));
		const result = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
		const details = result.details as Record<string, unknown>;
		assert.equal(details.outcome, "native-mutation-status-reconciliation-failed", JSON.stringify(shape));
		assert.equal(details.mutation_outcome, "unknown", JSON.stringify(shape));
		assert.equal(details.diagnostics, undefined, JSON.stringify(shape));
		assert.equal((details.reconciliation_failure as { outcome?: string }).outcome, "native-operation-failed", JSON.stringify(shape));
	}
});

test("native START uses the default policy or a canonical safe policy path, and rejects unsafe policy inputs before native calls", async (t) => {
	const cwd = repository(t);
	const policyDirectory = join(cwd, ".gentle-ai", "policies");
	const policyPath = join(policyDirectory, "team policy.json");
	mkdirSync(policyDirectory, { recursive: true });
	writeFileSync(policyPath, "{\"name\":\"team\"}\n");
	writeFileSync(join(cwd, "outside.json"), "{}\n");
	symlinkSync(policyPath, join(policyDirectory, "linked.json"));
	const requests: Array<{ cwd: string; lineageId?: string; policyPath?: string }> = [];
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			requests.push(request);
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true };
		},
		targetStatus: async () => targetStatusFixture({ applicability: "unrelated", action: "start" }),
	}));
	await controller.execute("default-policy", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	await controller.execute("custom-policy", { operation: "start", input: JSON.stringify({ mode: "ordinary", policyPath: ".gentle-ai/policies/team policy.json" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(requests, [
		{ cwd, agent: "pi", targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" },
		{ cwd, agent: "pi", policyPath, targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" },
	]);
	for (const [input, outcome, reason] of [
		[{ mode: "ordinary", policyHash: "legacy" }, "native-start-legacy-policy-hash-unsupported", "legacy-policy-hash-unsupported"],
		[{ mode: "ordinary", policyHash: "legacy", policyPath: ".gentle-ai/policies/team policy.json" }, "native-start-legacy-policy-hash-unsupported", "legacy-policy-hash-unsupported"],
		[{ mode: "ordinary", policyPath: "outside.json" }, "native-start-policy-path-invalid", "policy-path-outside-scope"],
		[{ mode: "ordinary", policyPath: ".gentle-ai/policies/missing.json" }, "native-start-policy-path-invalid", "policy-path-not-regular"],
		[{ mode: "ordinary", policyPath: ".gentle-ai/policies/linked.json" }, "native-start-policy-path-invalid", "policy-path-symlink"],
	] as const) {
		const rejected = await controller.execute("invalid-policy", { operation: "start", input: JSON.stringify(input) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome,
			reason,
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	assert.equal(requests.length, 2);
});

test("native ordinary START forwards every allowed focus and leaves the native default omitted", async (t) => {
	const cwd = repository(t);
	const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			requests.push(request);
			return { lineageId: `native-${request.focus ?? "default"}`, state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true };
		},
		targetStatus: async () => targetStatusFixture({ applicability: "unrelated", action: "start" }),
	}));
	for (const focus of ["risk", "resilience", "readability", "reliability"] as const) {
		await controller.execute(`focused-${focus}`, { operation: "start", input: JSON.stringify({ mode: "ordinary", focus }) }, undefined, undefined, context(cwd));
	}
	await controller.execute("default-focus", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(requests, [
		...(["risk", "resilience", "readability", "reliability"] as const).map((focus) => ({ cwd, agent: "pi", focus, targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" as const })),
		{ cwd, agent: "pi", targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" },
	]);
});

test("native ordinary START rejects invalid focus before native calls", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
		targetStatus: async () => targetStatusFixture({ applicability: "unrelated", action: "start" }),
	}));
	for (const focus of ["", "risk ", "RISK", "all", 42, null, [], {}]) {
		const rejected = await controller.execute("invalid-focus", { operation: "start", input: JSON.stringify({ mode: "ordinary", focus }) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-input-invalid",
			reason: "focus-invalid",
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	assert.equal(starts, 0);
});

test("native ordinary START rejects malformed input before resolving the review-mode gate", async (t) => {
	const cwd = repository(t);
	let reviewModeCalls = 0;
	let starts = 0;
	let statuses = 0;
	const { controller } = runtime(fakeNative({
		reviewMode: async () => {
			reviewModeCalls += 1;
			throw new Error("review mode must not be resolved for malformed ordinary START input");
		},
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
		targetStatus: async () => {
			statuses += 1;
			throw new Error("target status must not run for malformed untracked selection");
		},
	}));
	for (const [input, reason] of [
		[{ mode: "ordinary", policyHash: "legacy" }, "legacy-policy-hash-unsupported"],
		[{ mode: "ordinary", focus: "all" }, "focus-invalid"],
		[{ mode: "ordinary", unexpected: true }, "unknown-field"],
		[{ mode: "ordinary", policyPath: "outside.json" }, "policy-path-outside-scope"],
		[{ mode: "ordinary", baseRef: " " }, "base-ref-invalid"],
		[{ mode: "ordinary", baseRef: "origin/main" }, "committed-only-required"],
		[{ mode: "ordinary", committedOnly: true }, "committed-only-invalid"],
		[{ mode: "ordinary", baseRef: "refs/heads/missing", committedOnly: true }, "base-ref-unresolvable"],
		[{ mode: "ordinary", untrackedScope: "exclude" }, "untracked-selection-invalid"],
		[{ mode: "ordinary", expectedUntrackedInventory: `sha256:${"a".repeat(64)}` }, "untracked-selection-invalid"],
		[{ mode: "ordinary", untrackedScope: "exclude", expectedUntrackedInventory: `sha256:${"a".repeat(64)}`, intendedUntracked: ["selected.ts"] }, "untracked-selection-invalid"],
		[{ mode: "ordinary", untrackedScope: "select", expectedUntrackedInventory: `sha256:${"a".repeat(64)}`, intendedUntracked: [] }, "untracked-selection-invalid"],
		[{ mode: "ordinary", untrackedScope: "select", expectedUntrackedInventory: `sha256:${"a".repeat(64)}`, intendedUntracked: ["../selected.ts"] }, "untracked-selection-invalid"],
	] as const) {
		const rejected = await controller.execute("malformed-start", { operation: "start", input: JSON.stringify(input) }, undefined, undefined, context(cwd));
		assert.equal((rejected.details as { reason?: unknown }).reason, reason);
	}
	assert.equal(reviewModeCalls, 0);
	assert.equal(statuses, 0);
	assert.equal(starts, 0);
});

test("ordinary START relays untracked selection without materializing a selectorless collect target", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 200;\n");
	writeFileSync(join(cwd, "selected.ts"), "export const selected = true;\n");
	writeFileSync(join(cwd, "extra.ts"), "export const extra = true;\n");
	assert.equal(
		git(cwd, "status", "--porcelain=v1", "--untracked-files=all"),
		"M app.ts\n?? extra.ts\n?? selected.ts",
		"the fixture must expose the tracked modification and both untracked paths before START",
	);
	class TrackingCandidateViews extends CandidateViewRegistry {
		creates = 0;
		override createOrReuse(request: Parameters<CandidateViewRegistry["createOrReuse"]>[0]): ReturnType<CandidateViewRegistry["createOrReuse"]> {
			this.creates += 1;
			return super.createOrReuse(request);
		}
	}
	const candidateViews = new TrackingCandidateViews();
	let starts = 0;
	const selectionRequired = targetStatusFixture({ applicability: "unrelated", action: "start" });
	selectionRequired.nextTransition = {
		kind: "collect",
		reasonCode: "intended_untracked_selection_required",
		collect: { inputs: [{ name: "intended_untracked_selection", schema: "gentle-ai.review-intended-untracked-selection/v1", captureOperation: "external.select_intended_untracked", arguments: [] }] },
	};
	let selectedTarget: ReviewStatusV3 | undefined;
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			if (request.untrackedScope === undefined) return selectionRequired;
			if (selectedTarget === undefined) throw new Error("selected target must be bound to the exact controller candidate");
			return selectedTarget;
		},
		start: async () => {
			starts += 1;
			return { lineageId: "selected-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 2, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, candidateViews);

	const blocked = await controller.execute("selection-required", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.equal((blocked.details as { status?: string }).status, "blocked");
	assert.equal((blocked.details as { result?: unknown }).result, selectionRequired.raw);
	assert.equal(starts, 0);
	assert.equal(candidateViews.creates, 0);

	const digest = `sha256:${"b".repeat(64)}`;
	const selectedInput = JSON.stringify({ mode: "ordinary", untrackedScope: "select", expectedUntrackedInventory: digest, intendedUntracked: ["selected.ts"] });
	const selectedReplayKey = JSON.stringify({ cwd, lineageId: null, input: selectedInput, inputPath: null });
	const selectedCandidate = candidateViews.createOrReuse({ contributorRoot: cwd, replayKey: selectedReplayKey, intendedUntracked: ["selected.ts"] });
	selectedTarget = targetStatusFixture({
		applicability: "unrelated",
		action: "start",
		baseTree: selectedCandidate.baseTree,
		currentCandidateTree: selectedCandidate.candidateTree,
		paths: selectedCandidate.paths,
		intendedUntracked: selectedCandidate.intendedUntracked,
	});
	const started = await controller.execute("selected-start", { operation: "start", input: selectedInput }, undefined, undefined, context(cwd));
	const startedDetails = started.details as { result?: { lineage_id: string } };
	assert.ok(startedDetails.result, `selected START must succeed: ${JSON.stringify(started.details)}`);
	assert.equal(startedDetails.result.lineage_id, "selected-lineage");
	assert.equal(starts, 1);
	const view = candidateViews.resolveForLens("selected-lineage", "review-reliability");
	try {
		assert.deepEqual(view.paths, ["app.ts", "selected.ts"]);
		assert.equal(lstatSync(join(view.root, "extra.ts"), { throwIfNoEntry: false }), undefined);
	} finally {
		view.cleanup();
	}
});

test("native START preserves the default dirty-inclusive candidate without base flags", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	writeFileSync(join(cwd, "untracked.ts"), "export const untracked = true;\n");
	const candidateViews = new CandidateViewRegistry();
	const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			requests.push(request);
			return { lineageId: "default-dirty-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 2, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, candidateViews);
	const started = await controller.execute("default-dirty", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const view = candidateViews.resolveForLens("default-dirty-lineage", "review-reliability");
	try {
		assert.deepEqual(view.paths, ["app.ts", "untracked.ts"]);
		assert.equal(view.committedOnly, false);
		assert.deepEqual(requests, [{ cwd, agent: "pi", targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" }]);
		const actorBinding = (started.details as { actor_binding: { workspace_root: string; candidate_root: string; candidate_tree: string; candidate_paths: readonly string[] } }).actor_binding;
		assert.equal(actorBinding.workspace_root, cwd);
		assert.equal(actorBinding.candidate_root, view.root);
		assert.notEqual(actorBinding.candidate_root, requests[0]?.cwd);
		assert.equal(actorBinding.candidate_tree, view.candidateTree);
		assert.deepEqual(actorBinding.candidate_paths, view.paths);
	} finally {
		view.cleanup();
	}
});

test("native START binds an acknowledged committed range and native identity to one frozen candidate view", async (t) => {
	const cwd = repository(t);
	const baseCommit = git(cwd, "rev-parse", "HEAD");
	commitFile(cwd, "committed-after-base.ts", "export const committedAfterBase = true;\n", "committed after base");
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	writeFileSync(join(cwd, "untracked.ts"), "export const untracked = true;\n");
	const candidateViews = new CandidateViewRegistry();
	const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			requests.push(request);
			return { lineageId: "explicit-base-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 2, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, candidateViews);
	await controller.execute("explicit-base", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: baseCommit, committedOnly: true }) }, undefined, undefined, context(cwd));
	const view = candidateViews.resolveForLens("explicit-base-lineage", "review-reliability");
	try {
		assert.deepEqual(view.paths, ["committed-after-base.ts"]);
		assert.equal(view.committedOnly, true);
		assert.equal(view.baseCommit, baseCommit);
		assert.deepEqual(requests, [{ cwd, agent: "pi", baseRef: view.baseCommit, committedOnly: true, targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" }]);
	} finally {
		view.cleanup();
	}
});

test("native START binds a default dirty-inclusive candidate on an unborn repository against Git's empty tree", async (t) => {
	// Unborn repository: symbolic HEAD, no commits, staged + untracked content.
	// The default targetStatus helper builds a REAL candidate view from this
	// repo, so this exercises the real resolveCandidateBase/materializeCandidate
	// path on an unborn repository, not a synthetic adapter stub.
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-unborn-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "staged.txt"), "first staged\n");
	execFileSync("git", ["add", "staged.txt"], { cwd });
	writeFileSync(join(cwd, "untracked.ts"), "export const untracked = true;\n");
	const emptyTree = execFileSync("git", ["-C", cwd, "mktree"], { encoding: "utf8", input: "" }).trim();
	const candidateViews = new CandidateViewRegistry();
	const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			requests.push(request);
			return { lineageId: "unborn-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 2, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, candidateViews);
	const started = await controller.execute("unborn-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const view = candidateViews.resolveForLens("unborn-lineage", "review-reliability");
	try {
		// The unborn candidate base is Git's empty tree, not a phantom commit.
		assert.equal(view.baseTree, emptyTree);
		assert.equal(view.baseCommit, "HEAD");
		assert.equal(view.committedOnly, false);
		// Staged and untracked workspace content is preserved in the candidate.
		assert.deepEqual(view.paths, ["staged.txt", "untracked.ts"]);
		// No baseRef is sent to native START: the unborn default uses the
		// workspace projection only, exactly as the provider expects.
		assert.deepEqual(requests, [{ cwd, agent: "pi", targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" }]);
		const actorBinding = (started.details as { actor_binding: { workspace_root: string; candidate_root: string; candidate_tree: string; candidate_paths: readonly string[] } }).actor_binding;
		assert.equal(actorBinding.workspace_root, cwd);
		assert.equal(actorBinding.candidate_tree, view.candidateTree);
		assert.deepEqual(actorBinding.candidate_paths, view.paths);
	} finally {
		view.cleanup();
	}
});

test("native START fails closed before mutation when the workspace target and immutable candidate view differ", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	let starts = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => targetStatusFixture({
			applicability: "unrelated",
			action: "start",
			baseTree: git(cwd, "rev-parse", "HEAD^{tree}"),
			currentCandidateTree: "b".repeat(40),
			paths: ["app.ts"],
		}),
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("target-view-drift", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.equal((result.details as { outcome: string }).outcome, "native-operation-failed");
	assert.deepEqual((result.details as { diagnostics: unknown }).diagnostics, {
		code: "candidate-target-projection-drift",
		message: "candidate view rejected before native START",
	});
	assert.equal(starts, 0);
});

test("native START re-verifies candidate-view integrity before granting workspace authority", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	class DriftingCandidateViewRegistry extends CandidateViewRegistry {
		override createOrReuse(request: Parameters<CandidateViewRegistry["createOrReuse"]>[0]): ReturnType<CandidateViewRegistry["createOrReuse"]> {
			const candidate = super.createOrReuse(request);
			chmodSync(candidate.root, 0o755);
			chmodSync(join(candidate.root, "app.ts"), 0o644);
			writeFileSync(join(candidate.root, "app.ts"), "corrupted frozen content\n");
			chmodSync(join(candidate.root, "app.ts"), 0o444);
			chmodSync(candidate.root, 0o555);
			return candidate;
		}
	}
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, new DriftingCandidateViewRegistry());
	const result = await controller.execute("candidate-view-drift", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.equal((result.details as { outcome: string }).outcome, "native-operation-failed");
	assert.deepEqual((result.details as { diagnostics: unknown }).diagnostics, {
		code: "candidate-view-invalid",
		message: "candidate view rejected before native START",
	});
	assert.equal(starts, 0);
});

test("native START preserves an explicit base-resolution timeout diagnostic without native START", async (t) => {
	const cwd = repository(t);
	const bin = join(cwd, "test-bin");
	mkdirSync(bin);
	const fakeGit = join(bin, "git");
	writeFileSync(fakeGit, "#!/bin/sh\nexec sleep 1\n");
	chmodSync(fakeGit, 0o755);
	const previousPath = process.env.PATH;
	const previousTimeout = process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS;
	t.after(() => {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		if (previousTimeout === undefined) delete process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS;
		else process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS = previousTimeout;
	});
	process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
	process.env.GENTLE_PI_CANDIDATE_GIT_TIMEOUT_MS = "1";
	let starts = 0;
	let statuses = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statuses += 1;
			throw new Error("target status must not run after base resolution fails");
		},
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, new CandidateViewRegistry());
	const result = await controller.execute("base-resolution-timeout", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: "refs/heads/main", committedOnly: true }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "native-operation-failed");
	assert.equal(details.lineage_created, false);
	assert.equal(details.mutation_outcome, "none");
	assert.deepEqual(details.diagnostics, {
		phase: "candidate-view",
		category: "timeout",
		git_subcommand: "for-each-ref",
		timeout_ms: 1,
		max_buffer_bytes: 64 * 1024 * 1024,
		message: "candidate-view Git command for-each-ref timed out after 1ms; inspect the candidate state before any new START",
	});
	assert.equal(statuses, 0);
	assert.equal(starts, 0);
});

test("native START rejects an unresolvable explicit base before native mutation", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, new CandidateViewRegistry());
	const rejected = await controller.execute("missing-explicit-base", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: "refs/heads/missing-base", committedOnly: true }) }, undefined, undefined, context(cwd));
	assert.deepEqual(rejected.details, {
		operation: "start",
		status: "blocked",
		outcome: "native-start-base-ref-unresolvable",
		reason: "base-ref-unresolvable",
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		reset_eligible: false,
	});
	assert.equal(starts, 0);
});

test("native START rejects same-name branch and tag base refs before native mutation", async (t) => {
	const cwd = repository(t);
	const baseCommit = git(cwd, "rev-parse", "HEAD");
	git(cwd, "branch", "same-commit", baseCommit);
	git(cwd, "tag", "same-commit", baseCommit);
	commitFile(cwd, "after-base.ts", "export const afterBase = true;\n", "after base");
	const tipCommit = git(cwd, "rev-parse", "HEAD");
	git(cwd, "branch", "different-commit", baseCommit);
	git(cwd, "tag", "different-commit", baseCommit);
	git(cwd, "branch", "-f", "different-commit", tipCommit);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, new CandidateViewRegistry());
	for (const baseRef of ["same-commit", "different-commit"]) {
		const rejected = await controller.execute(`ambiguous-${baseRef}`, { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef, committedOnly: true }) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-base-ref-ambiguous",
			reason: "base-ref-ambiguous",
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	assert.equal(starts, 0);
});

test("native START forwards an acknowledged base ref and rejects invalid values before native calls", async (t) => {
	const cwd = repository(t);
	const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			requests.push(request);
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true };
		},
	}));
	await controller.execute("committed-base", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: "refs/heads/main", committedOnly: true }) }, undefined, undefined, context(cwd));
	assert.deepEqual(requests, [{ cwd, agent: "pi", baseRef: git(cwd, "rev-parse", "refs/heads/main"), committedOnly: true, targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" }]);
	for (const baseRef of ["", "   ", " origin/main", "origin/main ", "origin\0main", "origin\nmain", "origin\rmain", "origin\tmain", "origin\u007fmain", 42, [], {}]) {
		const rejected = await controller.execute("invalid-base", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef }) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-base-ref-invalid",
			reason: "base-ref-invalid",
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	assert.equal(requests.length, 1);
});

test("native START rejects missing committed-only acknowledgement and invalid combinations before native calls", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}));
	for (const input of [
		{ mode: "ordinary", baseRef: "origin/main" },
		{ mode: "ordinary", baseRef: "origin/main", committedOnly: false },
		{ mode: "ordinary", baseRef: "origin/main", committedOnly: "true" },
	] as const) {
		const rejected = await controller.execute("missing-committed-only", { operation: "start", input: JSON.stringify(input) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-committed-only-required",
			reason: "committed-only-required",
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	for (const input of [
		{ mode: "ordinary", committedOnly: true },
		{ mode: "ordinary", committedOnly: false },
	] as const) {
		const rejected = await controller.execute("invalid-committed-only", { operation: "start", input: JSON.stringify(input) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-committed-only-invalid",
			reason: "committed-only-invalid",
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	assert.equal(starts, 0);
});

test("native ordinary START blocks unknown input fields before native calls", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true };
		},
	}));
	for (const field of ["base_ref", "focus_mode", "unexpected"]) {
		const rejected = await controller.execute("unknown-start-field", { operation: "start", input: JSON.stringify({ mode: "ordinary", [field]: "origin/main" }) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-input-invalid",
			reason: "unknown-field",
			field,
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	assert.equal(starts, 0);
});

test("ordinary START rejects a legacy policy hash before native availability", async (t) => {
	const cwd = repository(t);
	const { controller } = runtime(null);
	const result = await controller.execute("legacy-start", { operation: "start", input: JSON.stringify({ mode: "ordinary", policyHash: "a".repeat(64) }) }, undefined, undefined, context(cwd));
	assert.equal((result.details as { outcome?: string }).outcome, "native-start-legacy-policy-hash-unsupported");
});

test("INSPECT reports a missing package-local native binary with fail-closed reinstall guidance", async (t) => {
	const cwd = repository(t);
	const rawPath = "/private/workspace/.gentle-ai/gentle-ai";
	const rawSecret = "package-binary-secret";
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			throw new NativeReviewCliError(
				NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING,
				NATIVE_REVIEW_OPERATION.VERSION,
				false,
				false,
				`missing ${rawPath} token=${rawSecret}`,
			);
		},
	}));
	const response = await controller.execute("inspect-package-binary-missing", { operation: "inspect" }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-status-package-binary-missing");
	assert.deepEqual(details.diagnostics, {
		operation: NATIVE_REVIEW_OPERATION.VERSION,
		error_code: NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING,
		timed_out: false,
		output_limit_exceeded: false,
	});
	assert.equal(details.inventory_complete, false);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
	assert.equal(details.next_action, "reinstall-package-local-gentle-ai");
	assert.doesNotMatch(JSON.stringify(details), new RegExp(`${rawPath}|${rawSecret}`));
});

test("START reports a missing package-local native binary before any native mutation", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			throw new NativeReviewCliError(
				NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING,
				NATIVE_REVIEW_OPERATION.VERSION,
				false,
				false,
				"package-local binary missing",
			);
		},
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}));
	const response = await controller.execute("start-package-binary-missing", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-status-package-binary-missing");
	assert.equal(details.inventory_complete, false);
	assert.equal(details.lineage_created, false);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
	assert.equal(details.next_action, "reinstall-package-local-gentle-ai");
	assert.equal(starts, 0);
});

test("REPAIR reports a missing package-local native binary without touching authority", async (t) => {
	const cwd = repository(t);
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			throw new NativeReviewCliError(
				NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING,
				NATIVE_REVIEW_OPERATION.VERSION,
				false,
				false,
				"package-local binary missing",
			);
		},
	}));
	const response = await controller.execute("repair-package-binary-missing", { operation: "repair" }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-status-package-binary-missing");
	assert.equal(details.inventory_complete, false);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
	assert.equal(details.next_action, "reinstall-package-local-gentle-ai");
});

test("START preserves bounded sanitized version-process diagnostics before native mutation", async (t) => {
	const cwd = repository(t);
	const rawPath = "/private/workspace/gentle-ai";
	const rawSecret = "version-process-secret";
	const stderr = `version process failed token=${rawSecret}\n${"x".repeat(5_000)}`;
	const foreignError = Object.assign(new Error(`version process failed at ${rawPath} token=${rawSecret}`), {
		name: "NativeReviewCliError",
		code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
		diagnostics: {
			operation: NATIVE_REVIEW_OPERATION.VERSION,
			error_code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
			exit_code: 17,
			timed_out: false,
			output_limit_exceeded: false,
			stderr,
		},
	});
	let starts = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => { throw foreignError; },
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}));
	const response = await controller.execute("start-version-process-failure", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	const diagnostics = details.diagnostics as { operation?: string; error_code?: string; stderr?: string };
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-operation-failed");
	assert.equal(diagnostics.operation, NATIVE_REVIEW_OPERATION.VERSION);
	assert.equal(diagnostics.error_code, NATIVE_REVIEW_ERROR_CODE.NON_ZERO);
	assert.match(diagnostics.stderr ?? "", /token=\[REDACTED\]/);
	assert.ok((diagnostics.stderr?.length ?? 0) <= 4_096);
	assert.equal(details.lineage_created, false);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
	assert.equal(starts, 0);
	assert.doesNotMatch(JSON.stringify(details), new RegExp(`${rawPath}|${rawSecret}`));

	const inspect = await controller.execute("inspect-version-process-failure", { operation: "inspect" }, undefined, undefined, context(cwd));
	const inspectDetails = inspect.details as Record<string, unknown>;
	assert.equal(inspectDetails.status, "blocked");
	assert.equal(inspectDetails.outcome, "native-status-unavailable");
	assert.deepEqual(inspectDetails.diagnostics, details.diagnostics);
	assert.equal(inspectDetails.inventory_complete, false);
	assert.equal(inspectDetails.mutation_performed, false);
	assert.equal(inspectDetails.mutation_outcome, "none");
	assert.doesNotMatch(JSON.stringify(inspectDetails), new RegExp(`${rawPath}|${rawSecret}`));
});

test("INSPECT preserves bounded sanitized review/status process diagnostics and remains fail-closed", async (t) => {
	const cwd = repository(t);
	const rawPath = "/private/workspace/review-status";
	const rawSecret = "review-status-secret";
	const stderr = `review status failed token=${rawSecret}\n${"x".repeat(5_000)}`;
	const foreignError = Object.assign(new Error(`review status failed at ${rawPath} token=${rawSecret}`), {
		name: "NativeReviewCliError",
		code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
		diagnostics: {
			operation: NATIVE_REVIEW_OPERATION.STATUS,
			error_code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
			exit_code: 18,
			timed_out: false,
			output_limit_exceeded: false,
			stderr,
		},
	});
	const { controller } = runtime(fakeNative({
		targetStatus: async () => { throw foreignError; },
	}));
	const response = await controller.execute("inspect-review-status-process-failure", { operation: "inspect" }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	const diagnostics = details.diagnostics as { operation?: string; error_code?: string; stderr?: string };
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-status-unavailable");
	assert.equal(diagnostics.operation, NATIVE_REVIEW_OPERATION.STATUS);
	assert.equal(diagnostics.error_code, NATIVE_REVIEW_ERROR_CODE.NON_ZERO);
	assert.match(diagnostics.stderr ?? "", /token=\[REDACTED\]/);
	assert.ok((diagnostics.stderr?.length ?? 0) <= 4_096);
	assert.equal(details.inventory_complete, false);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
	assert.doesNotMatch(JSON.stringify(details), new RegExp(`${rawPath}|${rawSecret}`));
});

test("INSPECT keeps version-incompatible target status failures mapped to native-status-unsupported", async (t) => {
	const cwd = repository(t);
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			throw new NativeReviewCliError(
				NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE,
				NATIVE_REVIEW_OPERATION.VERSION,
				true,
				false,
				"native version is incompatible",
			);
		},
	}));
	const response = await controller.execute("inspect-version-incompatible", { operation: "inspect" }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-status-unsupported");
	assert.equal(details.inventory_complete, false);
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, undefined);
});

test("INSPECT preserves output-limit diagnostics from native review status and remains fail-closed", async (t) => {
	const cwd = repository(t);
	const diagnostics = {
		operation: NATIVE_REVIEW_OPERATION.STATUS,
		error_code: NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT,
		output_limit_exceeded: true,
		timed_out: false,
	};
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			throw new NativeReviewCliError(
				NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT,
				NATIVE_REVIEW_OPERATION.STATUS,
				true,
				false,
				"native process output exceeded limit",
				diagnostics,
			);
		},
	}));
	const response = await controller.execute("inspect-output-limit", { operation: "inspect" }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-status-unavailable");
	assert.deepEqual(details.diagnostics, diagnostics);
	assert.equal(details.inventory_complete, false);
	assert.equal(details.next_action, "require-complete-native-authority-inventory");
	assert.equal(details.mutation_performed, false);
	assert.equal(details.mutation_outcome, "none");
});

test("START preserves actionable review/status output-limit diagnostics before native mutation", async (t) => {
	const cwd = repository(t);
	const diagnostics = {
		operation: NATIVE_REVIEW_OPERATION.STATUS,
		error_code: NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT,
		output_limit_exceeded: true,
		timed_out: false,
		max_buffer_bytes: 16 * 1024 * 1024,
		configuration_hint: "Inspect native review state before any new START; GENTLE_PI_REVIEW_MAX_BUFFER_BYTES accepts a positive decimal up to 67108864.",
	};
	let starts = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			throw new NativeReviewCliError(
				NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT,
				NATIVE_REVIEW_OPERATION.STATUS,
				true,
				false,
				"native process output exceeded limit",
				diagnostics,
			);
		},
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}));
	const response = await controller.execute("start-status-output-limit", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = response.details as Record<string, unknown>;
	assert.equal(details.status, "blocked");
	assert.equal(details.outcome, "native-operation-failed");
	assert.deepEqual(details.diagnostics, diagnostics);
	assert.equal(details.lineage_created, false);
	assert.equal(details.mutation_outcome, "none");
	assert.equal(starts, 0);
});

test("general STATUS and INSPECT use negotiated target status without mutation or inventory reads", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	let calls = 0;
	const neverInvoke = async () => {
		calls += 1;
		throw new Error("must not run");
	};
	const { controller } = runtime(fakeNative({
		start: neverInvoke,
		finalize: neverInvoke,
		validate: neverInvoke,
		bindSdd: neverInvoke,
		sddStatus: neverInvoke,
		reviewStatus: neverInvoke,
		targetStatus: async () => targetStatusFixture({ applicability: "unrelated", action: "start" }),
	}));
	const status = await controller.execute("status", { operation: "status" }, undefined, undefined, context(cwd));
	const inspect = await controller.execute("inspect", { operation: "inspect" }, undefined, undefined, context(cwd));
	assert.equal(calls, 0);
	for (const result of [status, inspect]) {
		const details = result.details as Record<string, unknown>;
		assert.equal(details.operation, result === status ? "status" : "inspect");
		assert.equal(details.status, "ready");
		assert.equal((details.result as Record<string, unknown>).action, "start");
	}
});

test("legacy compact FINALIZE is a typed read-only rejection without native fallback", async (t) => {
	const cwd = repository(t);
	const lineageId = "legacy-compact";
	const statePath = writeRetiredCompactFixture(cwd, lineageId);
	const before = readFileSync(statePath, "utf8");
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		finalize: async () => {
			finalizes += 1;
			return { lineageId, state: "approved", action: "approved", storeRevision: "r1" };
		},
		targetStatus: async () => targetStatusFixture({ lineageId, authorityVersion: "legacy-v1", action: "stop" }),
	}));
	const result = await controller.execute(
		"legacy-finalize",
		{ operation: "finalize", lineageId, input: JSON.stringify({}) },
		undefined,
		undefined,
		context(cwd),
	);
	const details = result.details as Record<string, unknown>;
	assert.equal(details.operation, "finalize");
	assert.equal(details.status, "blocked");
	assert.equal((details.result as Record<string, unknown>).action, "stop");
	assert.equal(((details.result as Record<string, unknown>).authority as Record<string, unknown>).version, "legacy-v1");
	assert.equal(finalizes, 0);
	assert.equal(readFileSync(statePath, "utf8"), before);
});

test("legacy graph-v1 FINALIZE is a typed read-only rejection without native fallback", async (t) => {
	const cwd = repository(t);
	const lineageId = "legacy-graph";
	const [{ REVIEW_MODE, ReviewTransactionStore, createReviewState }, { REVIEW_LENS, REVIEW_ROUTE }, { testSnapshot }] = await Promise.all([
		import("../lib/review-transaction.ts"),
		import("../lib/review-triggers.ts"),
		import("./review-test-fixtures.ts"),
	]);
	const baseTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd, encoding: "utf8" }).trim();
	ReviewTransactionStore.forRepository(cwd).create(createReviewState({
		lineageId,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({ baseTree, completeTree: baseTree, route: REVIEW_ROUTE.STANDARD, lenses: [REVIEW_LENS.RISK] }),
		evidenceHash: "b".repeat(64),
		budget: { review_batches: 1, review_actors: 1, refuter_batches: 1, fix_batches: 1, validator_runs: 1, final_verifications: 1, judgment_rounds: 0, judge_runs: 0 },
	}), "start");
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		finalize: async () => {
			finalizes += 1;
			return { lineageId, state: "approved", action: "approved", storeRevision: "r1" };
		},
		targetStatus: async () => targetStatusFixture({ lineageId, authorityVersion: "legacy-v1", action: "stop" }),
	}));
	const result = await controller.execute(
		"legacy-graph-finalize",
		{ operation: "finalize", lineageId, input: JSON.stringify({}) },
		undefined,
		undefined,
		context(cwd),
	);
	assert.equal((result.details as { status: string }).status, "blocked", JSON.stringify(result.details));
	assert.equal(((result.details as { result: Record<string, unknown> }).result).action, "stop");
	assert.equal(finalizes, 0);
	assert.equal(ReviewTransactionStore.forRepository(cwd).read(lineageId).revision, 0);
});

test("explicit controller VALIDATE is informational and cannot decide later Bash delivery", async (t) => {
	const cwd = repository(t);
	let validations = 0;
	const { controller, toolCall } = runtime(fakeNative({
		validate: async () => {
			validations += 1;
			throw new Error("informational VALIDATE must not invoke native validation");
		},
	}));
	const command = "git commit -m native";
	const validated = await controller.execute("informational-validate", {
		operation: "validate",
		lineageId: "native-lineage",
		idempotencyKey: "informational-validate",
		command,
		input: "{}",
	}, undefined, undefined, context(cwd));
	const details = validated.details as Record<string, unknown>;
	assert.equal(details.status, "informational");
	assert.equal(details.outcome, "delivery-validation-retired");
	assert.equal(details.authorization, undefined);
	assert.equal(validations, 0);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, context(cwd)), undefined);
	assert.equal(validations, 0, "later Bash delivery remains outside controller VALIDATE");
});

test("native bind validates only request-known inputs and maps native-owned binding evidence", async (t) => {
	const cwd = repository(t);
	mkdirSync(join(cwd, "openspec", "changes", "native-review-authority-parity"), { recursive: true });
	let bindCalls = 0;
	const requests: Array<{ cwd: string; change: string; lineage: string; expectedBindingRevision: string }> = [];
	const { controller } = runtime(fakeNative({
		bindSdd: async (request) => {
			bindCalls += 1;
			requests.push(request);
			return {
				revision: bindCalls === 1 ? "b1" : "b2",
				change: "native-review-authority-parity",
				lineage: "native-lineage",
				authorityRevision: "r1",
				receiptHash: "receipt",
				gateContext: nativeBindingGateContext(),
			};
		},
	}));
	for (const input of [
		{ change: "../native-review-authority-parity", lineageId: "native-lineage", expectedBindingRevision: "" },
		{ change: "native-review-authority-parity", lineageId: "native lineage", expectedBindingRevision: "" },
		{ change: "native-review-authority-parity", lineageId: "native-lineage", expectedBindingRevision: "bad revision" },
		{ change: "missing-change", lineageId: "native-lineage", expectedBindingRevision: "" },
	]) {
		await assert.rejects(
			controller.execute("invalid-bind", { operation: "bind-sdd", input: JSON.stringify(input) }, undefined, undefined, context(cwd)),
		);
	}
	assert.equal(bindCalls, 0);

	const first = await controller.execute("bind", { operation: "bind-sdd", input: JSON.stringify({ change: "native-review-authority-parity", lineageId: "native-lineage", expectedBindingRevision: "" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(first.details, { operation: "bind-sdd", binding: { revision: "b1", change: "native-review-authority-parity", lineage: "native-lineage", authority_revision: "r1", receipt_hash: "receipt", gate_context: nativeBindingGateContext().raw } });
	const replay = await controller.execute("bind-replay", { operation: "bind-sdd", input: JSON.stringify({ change: "native-review-authority-parity", lineageId: "native-lineage", expectedBindingRevision: "b1" }) }, undefined, undefined, context(cwd));
	assert.equal((replay.details as { binding: { revision: string } }).binding.revision, "b2");
	assert.deepEqual(requests, [
		{ cwd, change: "native-review-authority-parity", lineage: "native-lineage", expectedBindingRevision: "" },
		{ cwd, change: "native-review-authority-parity", lineage: "native-lineage", expectedBindingRevision: "b1" },
	]);
});

test("native bind treats malformed post-call evidence as status-required without replay", async (t) => {
	const cwd = repository(t);
	mkdirSync(join(cwd, "openspec", "changes", "native-review-authority-parity"), { recursive: true });
	let bindCalls = 0;
	const { controller } = runtime(fakeNative({
		bindSdd: async () => {
			bindCalls += 1;
			if (bindCalls === 1) return { revision: "b1", change: "other-change", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeBindingGateContext() };
			if (bindCalls === 2) return { revision: "", change: "native-review-authority-parity", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeBindingGateContext() };
			return { revision: "b3", change: "native-review-authority-parity", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeGateContext() };
		},
		targetStatus: async () => { throw new Error("target status unavailable"); },
	}));
	const input = JSON.stringify({ change: "native-review-authority-parity", lineageId: "native-lineage", expectedBindingRevision: "" });
	const expected = {
		operation: "bind-sdd",
		status: "blocked",
		outcome: "native-mutation-status-reconciliation-failed",
		mutation_outcome: "unknown",
		replayability: "status_required",
		next_action: "review.status",
		required_status_action: "Run target-scoped review.status for lineage native-lineage and follow only its declared action; never start a new review, create a new budget, launch a lens, or fall back to inventory discovery.",
		reconciliation_failure: { operation: "status", status: "blocked", outcome: "native-operation-failed", lineage_created: false, mutation_performed: false, mutation_outcome: "none", next_action: "resolve-native-operation-failure" },
	};
	const mismatched = await controller.execute("mismatched-bind", { operation: "bind-sdd", input }, undefined, undefined, context(cwd));
	assert.deepEqual(mismatched.details, expected);
	const malformed = await controller.execute("malformed-bind", { operation: "bind-sdd", input }, undefined, undefined, context(cwd));
	assert.deepEqual(malformed.details, expected);
	const wrongGate = await controller.execute("wrong-gate-bind", { operation: "bind-sdd", input }, undefined, undefined, context(cwd));
	assert.deepEqual(wrongGate.details, expected);
	assert.equal(bindCalls, 3);
});

test("pending implementation skips unavailable native review readiness and routes sdd-apply", async (t) => {
	const cwd = repository(t);
	const change = "native-review-authority-parity";
	const root = join(cwd, "openspec", "changes", change);
	mkdirSync(join(root, "specs", "review"), { recursive: true });
	writeFileSync(join(root, "proposal.md"), "# Proposal\n");
	writeFileSync(join(root, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(root, "design.md"), "# Design\n");
	writeFileSync(join(root, "tasks.md"), "- [ ] 1.1 Implement status routing\n");
	let statuses = 0;
	const status = await (await import("../extensions/gentle-ai.ts")).__testing.resolveControllerSddStatus(
		cwd,
		change,
		false,
		"openspec",
		fakeNative({ sddStatus: async () => { statuses += 1; throw new Error("gentle-ai unavailable"); } }),
	);
	assert.equal(statuses, 0);
	assert.equal(status.nextRecommended, "sdd-apply");
	assert.equal(status.dependencies.apply, "ready");
});

test("completed implementation fails closed when native review readiness is unavailable", async (t) => {
	const cwd = repository(t);
	const root = join(cwd, "openspec", "changes", "native-review-authority-parity");
	mkdirSync(join(root, "specs", "review"), { recursive: true });
	writeFileSync(join(root, "proposal.md"), "# Proposal\n");
	writeFileSync(join(root, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(root, "design.md"), "# Design\n");
	writeFileSync(join(root, "tasks.md"), "- [x] done\n");
	let statuses = 0;
	const status = await (await import("../extensions/gentle-ai.ts")).__testing.resolveControllerSddStatus(
		cwd,
		"native-review-authority-parity",
		false,
		"openspec",
		fakeNative({ sddStatus: async () => { statuses += 1; throw new Error("gentle-ai unavailable"); } }),
	);
	assert.equal(statuses, 1);
	assert.equal(status.nextRecommended, "resolve-review");
	assert.match(status.blockedReasons.join("\n"), /gentle-ai unavailable/);
});

test("native lifecycle routing blocks review and accepts verify/archive as post-review authority", async (t) => {
	const cwd = repository(t);
	const change = "native-review-authority-parity";
	const root = join(cwd, "openspec", "changes", change);
	mkdirSync(join(root, "specs", "review"), { recursive: true });
	writeFileSync(join(root, "proposal.md"), "# Proposal\n");
	writeFileSync(join(root, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(root, "design.md"), "# Design\n");
	writeFileSync(join(root, "tasks.md"), "- [x] done\n");
	const nativeStatus = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "native-review-cli", "v2.1.3", "sdd-status.json"), "utf8")) as Record<string, unknown>;
	const client = (nextRecommended: "review" | "verify" | "archive") => new NativeReviewCliV214(async (request) => ({
		stdout: request.arguments[0] === "version" ? "gentle-ai 2.1.4\n" : JSON.stringify({ ...nativeStatus, nextRecommended }),
		stderr: "",
		exitCode: 0,
		signal: null,
		timedOut: false,
		outputLimitExceeded: false,
	}));

	const review = await __testing.resolveControllerSddStatus(cwd, change, false, "openspec", client("review"));
	assert.equal(review.nextRecommended, "resolve-review");
	assert.equal(review.dependencies.verify, "blocked");

	const verify = await __testing.resolveControllerSddStatus(cwd, change, false, "openspec", client("verify"));
	assert.equal(verify.nextRecommended, "sdd-verify");
	assert.equal(verify.dependencies.verify, "ready");

	writeFileSync(join(root, "verify-report.md"), "Status: PASS\n");
	writeFileSync(join(root, "sync-report.md"), "Status: PASS\n");
	const archive = await __testing.resolveControllerSddStatus(cwd, change, false, "openspec", client("archive"));
	assert.equal(archive.nextRecommended, "sdd-archive");
	assert.equal(archive.dependencies.archive, "ready");
});

test("startup native readiness aborts each stalled probe at the short startup bound", async (t) => {
	const cwd = repository(t);
	const change = "native-review-authority-parity";
	const root = join(cwd, "openspec", "changes", change);
	mkdirSync(join(root, "specs", "review"), { recursive: true });
	writeFileSync(join(root, "proposal.md"), "# Proposal\n");
	writeFileSync(join(root, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(root, "design.md"), "# Design\n");
	writeFileSync(join(root, "tasks.md"), "- [x] done\n");
	for (const stalledOperation of ["version", "sdd-status"] as const) {
		const requests: Array<{ operation: string; signal: AbortSignal | undefined }> = [];
		const stalled = new NativeReviewCliV214(async (request) => {
			const operation = request.arguments[0]!;
			requests.push({ operation, signal: request.signal });
			if (operation === "version" && stalledOperation === "sdd-status") {
				return { stdout: "gentle-ai 2.1.4\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
			}
			return new Promise<never>((_resolve, reject) => {
				const cancel = () => {
					const error = new Error("cancelled");
					error.name = "AbortError";
					reject(error);
				};
				if (request.signal?.aborted) return cancel();
				request.signal?.addEventListener("abort", cancel, { once: true });
			});
		});
		const status = await __testing.resolveStartupControllerSddStatus(cwd, change, false, "openspec", stalled, 1);
		assert.equal(status.nextRecommended, "resolve-review");
		assert.deepEqual(requests.map((request) => request.operation), stalledOperation === "version" ? ["version"] : ["version", "sdd-status"]);
		assert.equal(requests.at(-1)?.signal?.aborted, true);
	}
});

test("raw supersession recovery markers do not override pending implementation routing", async (t) => {
	const cwd = repository(t);
	const change = "native-review-authority-parity";
	const root = join(cwd, "openspec", "changes", change);
	mkdirSync(join(root, "specs", "review"), { recursive: true });
	writeFileSync(join(root, "proposal.md"), "# Proposal\n");
	writeFileSync(join(root, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(root, "design.md"), "# Design\n");
	writeFileSync(join(root, "tasks.md"), "- [ ] 1.1 Implement status routing\n");
	const markerDirectory = join(resolveRepositoryAuthorityV1(cwd).store_root, "control", "authority-supersession-v1", "recovery-required-v1");
	mkdirSync(markerDirectory, { recursive: true });
	writeFileSync(join(markerDirectory, `${domainHashV1("openspec-change-name", change)}.json`), "recovery-required");
	let statuses = 0;
	const status = await (await import("../extensions/gentle-ai.ts")).__testing.resolveControllerSddStatus(
		cwd,
		change,
		false,
		"openspec",
		fakeNative({ sddStatus: async () => { statuses += 1; throw new Error("gentle-ai unavailable"); } }),
	);
	assert.equal(statuses, 0);
	assert.equal(status.nextRecommended, "sdd-apply");
	assert.equal(status.dependencies.apply, "ready");
});

test("native ordinary START ignores raw compact history for every workspace candidate", async (t) => {
	const cwd = repository(t);
	writeRetiredCompactFixture(cwd, "historical-compact");
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
		},
	}));
	const unrelated = await controller.execute("unrelated-history", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.equal((unrelated.details as { result: { lineage_id: string } }).result.lineage_id, "native-lineage");
	assert.equal(starts, 1);

	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	const matching = await controller.execute("matching-history", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.equal((matching.details as { result: { lineage_id: string } }).result.lineage_id, "native-lineage");
	assert.equal(starts, 2);
});

test("explicit native selectors bypass a matching compact claimant and preserve the native response", async (t) => {
	for (const selector of ["policyPath", "baseRef"] as const) {
		const cwd = repository(t);
		writeRetiredCompactFixture(cwd, `matching-${selector}`);
		const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
		const { controller } = runtime(fakeNative({
			start: async (request) => {
				requests.push(request);
				return { lineageId: `native-${selector}`, state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "blocked-scope-action", lensesRequired: false };
			},
		}));
		const policyPath = join(cwd, ".gentle-ai", "policies", "alternate.json");
		if (selector === "policyPath") { mkdirSync(dirname(policyPath), { recursive: true }); writeFileSync(policyPath, "{}\n"); }
		const result = await controller.execute(`explicit-${selector}`, { operation: "start", input: JSON.stringify(selector === "policyPath" ? { mode: "ordinary", policyPath: ".gentle-ai/policies/alternate.json" } : { mode: "ordinary", baseRef: "refs/heads/main", committedOnly: true }) }, undefined, undefined, context(cwd));
		assert.equal(requests.length, 1);
		assert.equal((result.details as { result: { action: string } }).result.action, "blocked-scope-action");
		assert.equal(selector === "policyPath" ? requests[0]?.policyPath : requests[0]?.baseRef, selector === "policyPath" ? policyPath : git(cwd, "rev-parse", "refs/heads/main"));
		if (selector === "baseRef") assert.equal(requests[0]?.committedOnly, true);
	}
});

test("native ordinary START leaves a matching raw compact claimant untouched", async (t) => {
	const cwd = repository(t);
	const statePath = writeRetiredCompactFixture(cwd, "matching-correction-required", "correction-required raw authority\n");
	const before = readFileSync(statePath, "utf8");
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
		},
	}));
	const result = await controller.execute("matching-correction-required", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.equal((result.details as { result: { lineage_id: string } }).result.lineage_id, "must-not-start");
	assert.equal(starts, 1);
	assert.equal(readFileSync(statePath, "utf8"), before);
});


test("controller forwards its AbortSignal to mutating native requests", async (t) => {
	const cwd = repository(t);
	const abort = new AbortController();
	let received: AbortSignal | undefined;
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			received = request.signal;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
		},
	}));
	await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, abort.signal, undefined, context(cwd));
	assert.equal(received, abort.signal);
});

test("parallel 4R dispatch receives readable and compact changed scopes before any actor", async (t) => {
	const cwd = repository(t);
	for (let index = 0; index < 248; index += 1) {
		writeFileSync(join(cwd, `unchanged-${String(index).padStart(3, "0")}.txt`), "base\n");
	}
	git(cwd, "add", ".");
	git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", "many unchanged entries");
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	for (let index = 0; index < 44; index += 1) {
		writeFileSync(join(cwd, `added-${String(index).padStart(3, "0")}.ts`), "export const changed = true;\n");
	}
	const candidateViews = new CandidateViewRegistry();
	const lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
	const { controller, toolCall } = runtime(fakeNative({
		start: async () => ({ lineageId: "c4-compact", state: "reviewing", riskLevel: "high", selectedLenses: lenses, changedFiles: 45, changedLines: 45, correctionBudget: 23, action: "created", lensesRequired: true }),
	}), undefined, candidateViews);
	await controller.execute("c4-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const dispatch = { agents: [...lenses], task: "Review compact scope", mode: "task" };
	assert.equal(await toolCall({ toolName: "subagent_run", input: dispatch }, context(cwd)), undefined, "compact scope would launch the 4R actors");
	assert.match(dispatch.task, /Frozen changed scope by mode:/);
	assert.doesNotMatch(dispatch.task, /unchanged-000\.txt/);
	assert.ok(Buffer.byteLength(dispatch.task, "utf8") <= 4_096 + "Review compact scope".length);
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	const divergentDispatch = { agents: [...lenses], task: "Review compact scope", mode: "task" };
	const rejectedDrift = await toolCall({ toolName: "subagent_run", input: divergentDispatch }, context(cwd)) as { block?: boolean };
	assert.equal(rejectedDrift.block, true, "live candidate drift blocks all actors before old candidate bytes can be injected");
	assert.equal(divergentDispatch.task, "Review compact scope");
	candidateViews.resolveForLens("c4-compact", "review-risk").cleanup();

	for (let index = 0; index < 80; index += 1) {
		writeFileSync(join(cwd, `oversized-${String(index).padStart(3, "0")}-${"x".repeat(80)}.ts`), "export const oversized = true;\n");
	}
	const oversizedViews = new CandidateViewRegistry();
	const oversized = runtime(fakeNative({
		start: async () => ({ lineageId: "c4-oversized", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 80, changedLines: 80, correctionBudget: 40, action: "created", lensesRequired: true }),
	}), undefined, oversizedViews);
	await oversized.controller.execute("c4-oversized-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const oversizedDispatch = { agent: "review-reliability", task: "Review oversized scope", mode: "task" };
	assert.equal(await oversized.toolCall({ toolName: "subagent_run", input: oversizedDispatch }, context(cwd)), undefined, "a compressible oversized scope reaches the actor through its compact manifest");
	assert.match(oversizedDispatch.task, /Frozen changed scope manifest \(gzip\+base64url\):/);
	assert.match(oversizedDispatch.task, /Call `gentle_review_scope`/);
	assert.ok(Buffer.byteLength(oversizedDispatch.task, "utf8") <= 4_096 + "Review oversized scope".length);
	const compact = compactCandidateContextManifest(oversizedDispatch.task);
	const actorEntries: Array<{ path: string; mode: string; gitlinkObjectId?: string }> = [];
	let cursor: number | undefined = 0;
	while (cursor !== undefined) {
		const result = await oversized.scopeReader.execute("actor-scope", { manifest: compact.encoded, sha256: compact.sha256, cursor }, undefined, undefined, context(cwd));
		const page = result.details as { entries: typeof actorEntries; nextCursor?: number; totalPaths: number };
		actorEntries.push(...page.entries);
		cursor = page.nextCursor;
	}
	const actorCandidate = oversizedViews.resolveForLens("c4-oversized", "review-reliability");
	assert.deepEqual(actorEntries.map((entry) => entry.path).sort(), [...actorCandidate.paths].sort(), "the actual actor tool recovers every compressed changed path");
	assert.equal(actorEntries.some((entry) => entry.path.startsWith("unchanged-")), false, "the actor tool never falls back to the ambient or full candidate tree");
	actorCandidate.cleanup();
});

test("INSPECT relays negotiated target status without inventory reconstruction or mutation", async (t) => {
	const cwd = repository(t);
	let mutations = 0;
	for (const scenario of [
		{ name: "unrelated", native: targetStatusFixture({ applicability: "unrelated", action: "start" }), expectedStatus: "ready", expectedAction: "start" },
		{ name: "current", native: targetStatusFixture({ action: "finalize", lineageId: "native-lineage" }), expectedStatus: "in-progress", expectedAction: "finalize" },
		{ name: "ambiguous", native: targetStatusFixture({ applicability: "ambiguous", action: "select_lineage" }), expectedStatus: "blocked", expectedAction: "select_lineage" },
		{ name: "corrupted", native: targetStatusFixture({ applicability: "corrupted", action: "repair_authority" }), expectedStatus: "blocked", expectedAction: "repair_authority" },
	] as const) {
		let inventoryReads = 0;
		const { controller } = runtime(fakeNative({
			targetStatus: async () => scenario.native,
			reviewStatus: async () => { inventoryReads += 1; throw new Error("INSPECT must not read inventory status"); },
			start: async () => { mutations += 1; throw new Error("INSPECT must not mutate"); },
			finalize: async () => { mutations += 1; throw new Error("INSPECT must not mutate"); },
		}) as Partial<NativeReviewCli>);
		const response = await controller.execute(`native-status-${scenario.name}`, { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = response.details as Record<string, unknown>;
		assert.equal(details.status, scenario.expectedStatus, scenario.name);
		assert.equal((details.result as Record<string, unknown>).action, scenario.expectedAction, scenario.name);
		assert.equal(inventoryReads, 0, scenario.name);
	}
	assert.equal(mutations, 0);
});

test("native INSPECT never reconstructs reset material from raw Pi corruption", async (t) => {
	const nativeStatus = (cwd: string, entries: NativeReviewStatusResult["entries"]): NativeReviewStatusResult => ({
		repository: cwd,
		complete: false,
		authoritative: false,
		status: "invalid",
		entries,
		locks: [],
		diagnostics: [],
		raw: { schema: "gentle-ai.review-authority-status/v1", operation: "review/status", repository: cwd, complete: false, authoritative: false, status: "invalid", entries, locks: [], diagnostics: [] },
	});
	const invalidEntry = (cwd: string, lineageId?: string) => ({
		version: "compact-v2" as const,
		path: join(cwd, ".git", "gentle-ai", "compact-v2"),
		status: "invalid" as const,
		problems: ["malformed compact authority"],
		...(lineageId === undefined ? {} : { lineageId }),
	});

	for (const scenario of [
		{
			name: "pre-lineage",
			prepare: (_cwd: string) => undefined,
			entries: (cwd: string) => [invalidEntry(cwd)],
		},
		{
			name: "unknown",
			prepare: (_cwd: string) => undefined,
			entries: (_cwd: string) => [],
		},
		{
			name: "unrelated",
			prepare: (cwd: string) => writeRetiredCompactFixture(cwd, "historical-lineage"),
			entries: (cwd: string) => [invalidEntry(cwd, "other-lineage")],
		},
	] as const) await t.test(scenario.name, async (child) => {
		const cwd = repository(child);
		scenario.prepare(cwd);
		const { controller } = runtime(fakeNative({ reviewStatus: async () => nativeStatus(cwd, scenario.entries(cwd)) }));
		const inspected = await controller.execute(`ineligible-${scenario.name}`, { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = inspected.details as Record<string, unknown>;
		assert.equal(details.status, "ready");
		assert.equal((details.result as Record<string, unknown>).action, "start");
		assert.equal(details.reset_eligible, undefined);
		assertNoPublicResetRequest(details);
		assertNoPublicDestructiveResetMaterial(details);
	});

	await t.test("exact Pi-owned legacy corruption remains private", async (child) => {
		const cwd = repository(child);
		const legacyPath = join(cwd, ".git", "gentle-ai", "reviews", "lineages", "legacy");
		mkdirSync(legacyPath, { recursive: true });
		writeFileSync(join(legacyPath, "authority.json"), "legacy\n");
		let nativeStatuses = 0;
		const { controller } = runtime(fakeNative({ reviewStatus: async () => {
			nativeStatuses += 1;
			return nativeStatus(cwd, []);
		} }));
		const inspected = await controller.execute("eligible-pi-corruption", { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = inspected.details as Record<string, unknown>;
		assert.equal(details.status, "ready");
		assertNoPublicResetRequest(details);
		assert.equal(nativeStatuses, 0);
	});

	await t.test("Pi reset-in-progress does not alter negotiated INSPECT", async (child) => {
		const cwd = repository(child);
		const legacyPath = join(cwd, ".git", "gentle-ai", "reviews", "lineages", "legacy");
		mkdirSync(legacyPath, { recursive: true });
		writeFileSync(join(legacyPath, "authority.json"), "legacy\n");
		craftDurableResetState(cwd);
		const { controller } = runtime(fakeNative());
		const inspected = await controller.execute("reset-in-progress", { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = inspected.details as Record<string, unknown>;
		assert.equal(details.status, "ready");
		assertNoPublicResetRequest(details);
	});

	await t.test("applicable corruption remains read-only and exposes only the Pi reset material", async (child) => {
		const cwd = repository(child);
		const status = nativeStatus(cwd, [invalidEntry(cwd, "applicable-lineage")]);
		const { controller } = runtime(fakeNative({ reviewStatus: async () => status }));
		const inspected = await controller.execute("applicable-native-only", { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = inspected.details as Record<string, unknown>;
		assert.equal(details.status, "ready");
		assertNoPublicResetRequest(details);
	});
});

test("raw native inventory cannot authorize START, INSPECT, or RESET remediation", async (t) => {
	const nativeStatus = (cwd: string, status: string, complete: boolean, authoritative: boolean, entries: readonly Record<string, unknown>[]) => ({
		repository: cwd,
		complete,
		authoritative,
		status,
		entries,
		locks: [],
		diagnostics: [],
		raw: { schema: "gentle-ai.review-authority-status/v1", operation: "review/status", repository: cwd, complete, authoritative, status, entries, locks: [], diagnostics: [] },
	});
	const unrelatedHistory = (cwd: string) => {
		writeRetiredCompactFixture(cwd, "unrelated-history");
		writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	};
	const invalidLegacy = (cwd: string) => nativeStatus(cwd, "invalid", false, false, [{ version: "legacy-v1", path: join(cwd, ".git", "gentle-ai", "reviews", "legacy"), status: "invalid", problems: ["malformed legacy authority"] }]);

	await t.test("a freshly clean empty native inventory reaches START", async (t) => {
		const cwd = repository(t);
		let statuses = 0;
		let starts = 0;
		const { controller } = runtime(fakeNative({
			reviewStatus: async () => { statuses += 1; return nativeStatus(cwd, "clean", true, true, []); },
			start: async () => { starts += 1; return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false }; },
		}));
		const started = await controller.execute("native-clean-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
		assert.equal((started.details as { result?: { lineage_id?: string } }).result?.lineage_id, "native-lineage");
		assert.equal(statuses, 0);
		assert.equal(starts, 1);
	});

	await t.test("invalid/incomplete unrelated multi-store inventory delegates one native START and preserves no-reset evidence", async (t) => {
		const cwd = repository(t);
		unrelatedHistory(cwd);
		const status = nativeStatus(cwd, "invalid", false, false, [
			{ version: "legacy-v1", lineageId: "foreign-legacy", path: join(cwd, ".git", "gentle-ai", "reviews", "foreign-legacy"), status: "invalid", problems: ["malformed legacy authority"] },
			{ version: "compact-v2", lineageId: "foreign-compact", path: join(cwd, ".git", "gentle-ai", "compact-v2", "foreign-compact"), status: "invalid", problems: ["malformed compact authority"] },
		]);
		let starts = 0;
		const diagnostics = { operation: NATIVE_REVIEW_OPERATION.START, error_code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO, exit_code: 1, timed_out: false, output_limit_exceeded: false, denial: { schema: "gentle-ai.review-gate-result/v1" as const, result: "invalidated" as const, action: "pre-lineage-denial", reason: "native target has no applicable lineage", denial: { stage: "authority", code: "unrelated-history" } } };
		const { controller } = runtime(fakeNative({
			reviewStatus: async () => status,
			start: async () => {
				starts += 1;
				throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, NATIVE_REVIEW_OPERATION.START, true, false, "native pre-lineage denial", diagnostics);
			},
		}));
		const inspected = await controller.execute("native-unrelated-inspect", { operation: "inspect" }, undefined, undefined, context(cwd));
		const inspectionDetails = inspected.details as Record<string, unknown>;
		assert.equal(inspectionDetails.reset_eligible, undefined);
		assertNoPublicResetRequest(inspectionDetails);
		const started = await controller.execute("native-unrelated-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
		assert.equal(starts, 1);
		assert.deepEqual(started.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-operation-failed",
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
			diagnostics,
			next_action: "resolve-native-operation-failure",
		});
		assertNoPublicResetRequest(started.details);

		for (const [name, failure] of [
			["unproven-invocation", () => new Error("native START output was lost")],
			["decoder-rejection", () => new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE, NATIVE_REVIEW_OPERATION.START, true, true, "native START decoder rejected the response")],
		] as const) await t.test(name, async () => {
			let failedStarts = 0;
			const { controller: failingController } = runtime(fakeNative({
				reviewStatus: async () => status,
				start: async () => {
					failedStarts += 1;
					throw failure();
				},
			}));
			const failed = await failingController.execute(`native-${name}-start`, { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
			const failureDetails = failed.details as Record<string, unknown>;
			assert.equal(failedStarts, 1);
			assert.equal(failureDetails.lineage_created, undefined);
			assert.equal(failureDetails.mutation_outcome, "unknown");
			assert.equal(failureDetails.outcome, "native-mutation-status-reconciled");
			assert.equal(failureDetails.next_action, "start");
			assert.equal(failureDetails.replayability, "not_replayable");
			assertNoPublicResetRequest(failureDetails);
		});
	});

	await t.test("unknown, ambiguous, and applicable raw authority cannot block native START", async (t) => {
		const controls = [
			{
				name: "unknown",
				prepare: (cwd: string) => writeRetiredCompactFixture(cwd, "unknown-current"),
				status: (cwd: string) => nativeStatus(cwd, "invalid", false, false, []),
			},
			{
				name: "ambiguous",
				prepare: (cwd: string) => {
					writeRetiredCompactFixture(cwd, "ambiguous-one");
					writeRetiredCompactFixture(cwd, "ambiguous-two");
				},
				status: (cwd: string) => nativeStatus(cwd, "invalid", false, false, []),
			},
			{
				name: "applicable",
				prepare: (cwd: string) => writeRetiredCompactFixture(cwd, "applicable-current"),
				status: (cwd: string) => nativeStatus(cwd, "invalid", false, false, [{ version: "compact-v2", lineageId: "applicable-current", path: join(cwd, ".git", "gentle-ai", "compact-v2", "applicable-current"), status: "invalid", problems: ["malformed current authority"] }]),
			},
		] as const;
		for (const control of controls) await t.test(control.name, async (child) => {
			const cwd = repository(child);
			control.prepare(cwd);
			let starts = 0;
			const { controller } = runtime(fakeNative({
				reviewStatus: async () => control.status(cwd),
				start: async () => {
					starts += 1;
					return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
				},
			}));
			const started = await controller.execute(`native-${control.name}-start`, { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
			assert.equal((((started.details as Record<string, unknown>).result) as Record<string, unknown>).lineage_id, "must-not-start");
			assert.equal(starts, 1);
			assertNoPublicResetRequest(started.details);
		});
	});

	await t.test("RESET without the audited native inputs blocks and never invokes a native mutation", async (t) => {
		const cwd = repository(t);
		unrelatedHistory(cwd);
		let reclaims = 0;
		const { controller } = runtime(fakeNative({
			reviewStatus: async () => nativeStatus(cwd, "approved", true, true, [{ version: "legacy-v1", path: join(cwd, ".git", "gentle-ai", "reviews", "legacy"), status: "approved", problems: [] }]),
			reclaim: async () => { reclaims += 1; return { record: {} }; },
		}));
		const inspected = await controller.execute("native-valid-inspect", { operation: "inspect" }, undefined, undefined, context(cwd));
		const inspectionDetails = inspected.details as Record<string, unknown>;
		assert.equal(inspectionDetails.reset_eligible, undefined);
		assertNoPublicResetRequest(inspectionDetails);
		const request = inspectLegacyReviewAuthorityV1(cwd).reset_request;
		const reset = await controller.execute("native-valid-reset", { operation: "reset", input: JSON.stringify(request) }, undefined, undefined, interactiveContext(cwd));
		assert.deepEqual(reset.details, {
			operation: "reset",
			status: "blocked",
			outcome: "native-input-required",
			native_operation: "review reclaim",
			missing_input: ["lineage", "actor", "reason"],
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "resubmit-with-exact-native-recovery-input",
		});
		assert.equal(reclaims, 0);
	});

	await t.test("a native reclaim failure surfaces as a typed native operation failure", async (t) => {
		const cwd = repository(t);
		unrelatedHistory(cwd);
		const { controller } = runtime(fakeNative({
			reclaim: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.RECLAIM, true, true, "native repository mismatch"); },
		}));
		const request = { ...inspectLegacyReviewAuthorityV1(cwd).reset_request, lineage: "stuck", actor: "maintainer", reason: "invalid authority" };
		const reset = await controller.execute("native-identity-reset", { operation: "reset", input: JSON.stringify(request) }, undefined, undefined, interactiveContext(cwd));
		assert.equal((reset.details as Record<string, unknown>).status, "blocked");
		assert.equal((reset.details as Record<string, unknown>).outcome, "native-operation-failed");
	});
});

test("RESET no longer consults status preflight; it either requests native inputs or runs audited native reclaim", async (t) => {
	const cwd = repository(t);
	writeRetiredCompactFixture(cwd, "pi-current");
	let statusCalls = 0;
	const reclaims: Array<Record<string, unknown>> = [];
	const record = { schema: "gentle-ai.review-reclaim-audit/v1", lineage: "pi-current" };
	const { controller } = runtime(fakeNative({
		reviewStatus: async () => { statusCalls += 1; throw new Error("status must not gate native recovery"); },
		reclaim: async (request) => { reclaims.push(request as unknown as Record<string, unknown>); return { record }; },
	}));
	const base = { repositoryId: "repo", commonDirHash: "c".repeat(64), inventoryHash: "d".repeat(64), confirmation: "DESTROY REVIEW AUTHORITY repo" };
	const missing = await controller.execute("native-missing-input", { operation: "reset", input: JSON.stringify(base) }, undefined, undefined, interactiveContext(cwd));
	assert.equal((missing.details as { outcome?: string }).outcome, "native-input-required");
	const reset = await controller.execute("native-reclaim", { operation: "reset", input: JSON.stringify({ ...base, lineage: "pi-current", actor: "maintainer", reason: "invalid authority" }) }, undefined, undefined, interactiveContext(cwd));
	const details = reset.details as Record<string, unknown>;
	assert.equal(details.native_operation, "review reclaim");
	assert.equal(details.mutation_performed, true);
	assert.equal(details.mutation_outcome, "committed");
	assert.deepEqual(details.result, record);
	assert.equal(details.next_action, "inspect");
	assert.equal(reclaims.length, 1);
	assert.equal(reclaims[0]?.lineage, "pi-current");
	assert.equal(reclaims[0]?.actor, "maintainer");
	assert.equal(statusCalls, 0);
});

test("independent-verification routing matrix names every native authority contract", () => {
	const rows = [
		"1 status unsupported/pre-START => no lineage/no reset",
		"2 valid unrelated compact history => reaches native START",
		"3 invalid/incomplete unrelated native stores + one pre-lineage START denial => diagnostics/no reset",
		"4 BIND-SDD native failure => diagnostics",
		"5 successful START then decoder rejection => unknown/status required",
		"6 invalid historical inventory + Pi clean/unrelated => reset_eligible:false",
		"7 authorized RESET/RECOVER => audited native reclaim/recover only",
		"8 FINALIZE failure existing lineage => unknown/status/diagnostics",
		"9 missing native recovery input => native-input-required/zero mutation",
		"10 Pi reset-in-progress => durable RECOVER challenge via INSPECT",
	] as const;
	assert.deepEqual(rows, [...new Set(rows)]);
	assert.equal(rows.length, 10);
	for (const row of rows) assert.match(row, /^\d+ /);
});

test("authorized RECOVER routes to native review recover with the exact successor binding", async (t) => {
	const cwd = repository(t);
	const recovers: Array<Record<string, unknown>> = [];
	const record = { schema: "gentle-ai.review-recovery/v1", successor_lineage: "successor" };
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			const status = targetStatusFixture({ lineageId: "broken", action: "recover" });
			return {
				...status,
				actionDisposition: "invalidated",
				authority: { ...status.authority!, revision: "rev-1" },
			};
		},
		recover: async (request) => { recovers.push(request as unknown as Record<string, unknown>); return { record }; },
	}));
	const base = { repositoryId: "repo", commonDirHash: "c".repeat(64), inventoryHash: "d".repeat(64), confirmation: "DESTROY REVIEW AUTHORITY repo" };
	const missing = await controller.execute("native-recover-missing", { operation: "recover", input: JSON.stringify(base) }, undefined, undefined, interactiveContext(cwd));
	assert.equal((missing.details as Record<string, unknown>).outcome, "native-input-required");
	assert.deepEqual((missing.details as Record<string, unknown>).missing_input, ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "disposition", "actor", "reason"]);
	assert.equal(recovers.length, 0);
	const recovered = await controller.execute("native-recover", {
		operation: "recover",
		input: JSON.stringify({ ...base, predecessorLineage: "broken", expectedPredecessorRevision: "rev-1", successorLineage: "successor", disposition: "invalidated", actor: "maintainer", reason: "invalid authority" }),
	}, undefined, undefined, interactiveContext(cwd));
	const details = recovered.details as Record<string, unknown>;
	assert.equal(details.native_operation, "review recover");
	assert.equal(details.mutation_performed, true);
	assert.deepEqual(details.result, record);
	assert.equal(recovers.length, 1);
	assert.equal(recovers[0]?.predecessorLineage, "broken");
	assert.equal(recovers[0]?.disposition, "invalidated");
});

test("RECOVER rechecks a committed range against its frozen base instead of the workspace", async (t) => {
	const cwd = repository(t);
	const baseRef = git(cwd, "rev-parse", "HEAD");
	const candidateViews = new CandidateViewRegistry();
	const statusRequests: Array<Record<string, unknown>> = [];
	const recovers: Array<Record<string, unknown>> = [];
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			statusRequests.push(request as Record<string, unknown>);
			if (request.lineageId === undefined) return candidateStartTargetStatus(request);
			assert.equal(request.baseRef, baseRef);
			const status = targetStatusFixture({ lineageId: "native-lineage", action: "recover" });
			return { ...status, actionDisposition: "invalidated", authority: { ...status.authority!, revision: "rev-1" } };
		},
		recover: async (request) => {
			recovers.push(request as Record<string, unknown>);
			return { record: { schema: "gentle-ai.review-recovery/v1" } };
		},
	}), undefined, candidateViews);

	await controller.execute("committed-range-start", {
		operation: "start",
		input: JSON.stringify({ mode: "ordinary", baseRef, committedOnly: true }),
	}, undefined, undefined, context(cwd));
	const recoveryAuthorization = { repositoryId: "repo", commonDirHash: "c".repeat(64), inventoryHash: "d".repeat(64), confirmation: "DESTROY REVIEW AUTHORITY repo" };
	const recovered = await controller.execute("committed-range-recover", {
		operation: "recover",
		input: JSON.stringify({ ...recoveryAuthorization, predecessorLineage: "native-lineage", expectedPredecessorRevision: "rev-1", successorLineage: "successor", disposition: "invalidated", actor: "maintainer", reason: "invalid authority" }),
	}, undefined, undefined, interactiveContext(cwd));

	assert.equal((recovered.details as Record<string, unknown>).mutation_outcome, "committed");
	assert.equal(statusRequests.filter((request) => request.lineageId === "native-lineage")[0]?.baseRef, baseRef);
	assert.equal(recovers.length, 1);
	candidateViews.cleanupTerminal("native-lineage", "approved");
});

test("dangerous push confirmation stops before repository inspection outside a repository", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-non-repository-push-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const { toolCall } = runtime(fakeNative({}));
	const interactive = interactiveContext(cwd);
	const deniedContext = { ...interactive, ui: { ...interactive.ui, confirm: async () => false } };
	const result = await toolCall(
		{ toolName: "bash", input: { command: "git push" } },
		deniedContext,
	) as { block: boolean; reason: string };
	assert.equal(result.block, true);
	assert.match(result.reason, /not confirmed/);
});

function gitStdin(cwd: string, arguments_: readonly string[], input: string): string {
	return execFileSync("git", [...arguments_], { cwd, encoding: "utf8", input }).trim();
}

test("large repository end-to-end: tiny candidate diff reaches START, reviewer dispatch, and FINALIZE", async (t) => {
	// Build a genuinely large synthetic repository (5000 unchanged entries) from a single
	// blob via `git mktree`, avoiding thousands of per-file filesystem writes/subprocesses.
	// The candidate diff is exactly one modified entry — the smallest review scope — so the
	// frozen candidate view materializes the full 5000-entry tree through the production
	// checkout-index path while the reviewer dispatch carries only the one changed path.
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-large-repo-e2e-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	const baseBlob = gitStdin(cwd, ["hash-object", "-w", "--stdin"], "base\n");
	const largeCount = 5_000;
	const baseTreeInput = Array.from({ length: largeCount }, (_, index) =>
		`100644 blob ${baseBlob}\tunchanged-${String(index).padStart(4, "0")}.txt`,
	).join("\n");
	const baseTree = gitStdin(cwd, ["mktree"], baseTreeInput);
	const candidateBlob = gitStdin(cwd, ["hash-object", "-w", "--stdin"], "candidate\n");
	const candidateTreeInput = Array.from({ length: largeCount }, (_, index) =>
		index === 0
			? `100644 blob ${candidateBlob}\tunchanged-0000.txt`
			: `100644 blob ${baseBlob}\tunchanged-${String(index).padStart(4, "0")}.txt`,
	).join("\n");
	const candidateTree = gitStdin(cwd, ["mktree"], candidateTreeInput);
	const commitIdentity = ["-c", "user.name=Large Repo E2E", "-c", "user.email=large@example.invalid"];
	const baseCommit = git(cwd, ...commitIdentity, "commit-tree", baseTree, "-m", "large base");
	const candidateCommit = git(cwd, ...commitIdentity, "commit-tree", candidateTree, "-p", baseCommit, "-m", "tiny candidate");
	git(cwd, "update-ref", "refs/heads/main", candidateCommit);

	const candidateViews = new CandidateViewRegistry();
	const lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
	const lineageId = "large-repo-e2e";
	let starts = 0;
	let finalizes = 0;
	let finalizeRoot: string | undefined;
	const { controller, toolCall } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId, state: "reviewing", riskLevel: "high", selectedLenses: lenses, changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
		finalize: async (request) => {
			finalizes += 1;
			finalizeRoot = request.cwd;
			return { lineageId, state: "approved", action: "approved", storeRevision: "r1" };
		},
		targetStatus: async (request) => {
			if (request.lineageId === undefined) return candidateStartTargetStatus(request);
			return candidateStartTargetStatus(request, {
				baseRef: baseCommit,
				status: (candidate) => targetStatusFixture({
					lineageId,
					baseTree: candidate.baseTree,
					currentCandidateTree: candidate.candidateTree,
					paths: candidate.paths,
					projection: request.projection ?? "workspace",
					intendedUntracked: request.intendedUntracked,
				}),
			});
		},
	}), undefined, candidateViews);

	// START binds the frozen candidate view for the large repository.
	const start = await controller.execute("large-repo-start", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: baseCommit, committedOnly: true }) }, undefined, undefined, context(cwd));
	const startDetails = start.details as { result?: { lineage_id: string } };
	assert.ok(startDetails.result, `START must succeed before dispatch and FINALIZE: ${JSON.stringify(start.details)}`);
	assert.equal(starts, 1, `native START count: ${starts}; details: ${JSON.stringify(start.details)}`);
	assert.equal(startDetails.result.lineage_id, lineageId);
	const frozen = candidateViews.resolveForLens(lineageId, "review-risk");
	try {
		// Immutable candidate identity: the frozen view binds the exact synthetic trees.
		assert.equal(frozen.baseTree, baseTree);
		assert.equal(frozen.candidateTree, candidateTree);
		assert.deepEqual(frozen.paths, ["unchanged-0000.txt"]);
		assert.equal(readdirSync(frozen.root).filter((entry) => entry !== ".git").length, largeCount);
		assert.equal(readFileSync(join(frozen.root, "unchanged-0000.txt"), "utf8"), "candidate\n");
		assert.equal(readFileSync(join(frozen.root, "unchanged-4999.txt"), "utf8"), "base\n");

		// Reviewer dispatch injects the controller-owned candidate view carrying only the
		// tiny changed scope — never the 5000-entry unchanged repository bulk.
		const dispatch = { agents: [...lenses], task: "Review the tiny candidate diff in a large repository", mode: "task" };
		assert.equal(await toolCall({ toolName: "subagent_run", input: dispatch }, context(cwd)), undefined);
		assert.match(dispatch.task, /## Controller-owned candidate view/);
		assert.match(dispatch.task, new RegExp(`Frozen candidate tree: \`${candidateTree}\``));
		assert.match(dispatch.task, /unchanged-0000\.txt/);
		assert.doesNotMatch(dispatch.task, /unchanged-0001\.txt/);
		assert.doesNotMatch(dispatch.task, /unchanged-0499\.txt/);
		assert.ok(Buffer.byteLength(dispatch.task, "utf8") <= 4_096 + "Review the tiny candidate diff in a large repository".length);

		// No live-worktree fallback: a rogue untracked file in the contributor working
		// directory (invisible to the committedOnly candidate view) cannot reach the dispatch.
		writeFileSync(join(cwd, "rogue-untracked.ts"), "export const rogue = true;\n");
		const rogueDispatch = { agent: "review-risk", task: "review after rogue", mode: "task" };
		assert.equal(await toolCall({ toolName: "subagent_run", input: rogueDispatch }, context(cwd)), undefined);
		assert.doesNotMatch(rogueDispatch.task, /rogue-untracked\.ts/);
		assert.match(rogueDispatch.task, new RegExp(`Frozen candidate tree: \`${candidateTree}\``));

		// FINALIZE mutates against the frozen candidate root, not the contributor working directory.
		const finalize = await controller.execute("large-repo-finalize", { operation: "finalize", lineageId, input: JSON.stringify({}) }, undefined, undefined, context(cwd));
		const finalizeDetails = finalize.details as { result?: { state: string } };
		assert.ok(finalizeDetails.result, `FINALIZE must succeed after START: ${JSON.stringify({ started: start.details, starts, finalized: finalize.details })}`);
		assert.equal(finalizeDetails.result.state, "approved");
		assert.equal(finalizes, 1);
		assert.notEqual(finalizeRoot, cwd);
		assert.equal(finalizeRoot, frozen.root);

	} finally {
		frozen.cleanup();
	}
});

// Field defect (fambig, 2026-08-16, dev binary 2.4.0-main): at every
// evidence-pending sub-state the provider renders the `review.capture-evidence`
// collect slot with the identity native demands — for a correction that is the
// FIX-DIFF `--target` identity plus an opaque `--repository-context`, never the
// top-level live workspace snapshot identity. Rebinding the capture to
// `negotiatedStatus.targetIdentity` failed deterministically with
// "verification evidence binding does not match the current authority
// revision". Collect satisfaction must execute the slot's rendered submission
// tokens verbatim, exactly like captureResult does.
const EVIDENCE_SLOT_FIX_TARGET = `sha256:${"e".repeat(64)}`;
const EVIDENCE_SLOT_REPOSITORY_CONTEXT = `rctx1_${"f".repeat(64)}`;

function bindEvidenceSubmissionCollection(status: ReviewStatusV3, fixTargetIdentity = EVIDENCE_SLOT_FIX_TARGET, repositoryContext = EVIDENCE_SLOT_REPOSITORY_CONTEXT): ReviewStatusV3 {
	const lineageId = status.authority!.lineageId;
	const revision = status.authority!.revision;
	const argumentTokens = [
		`--lineage=${lineageId}`,
		`--expected-revision=${revision}`,
		`--target=${fixTargetIdentity}`,
		`--repository-context=${repositoryContext}`,
		"--outcome={{outcome}}",
		"--input={{input}}",
	];
	status.nextTransition = {
		kind: "collect",
		reasonCode: "correction_repository_verification_required",
		collect: { inputs: [{
			name: "evidence",
			schema: "https://gentle-ai.dev/schema/review/verification-evidence/v1",
			captureOperation: "review.capture-evidence",
			arguments: [
				{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
				{ name: "expected-revision", value: revision, token: `--expected-revision=${revision}` },
				{ name: "target", value: fixTargetIdentity, token: `--target=${fixTargetIdentity}` },
				{ name: "repository-context", value: repositoryContext, token: `--repository-context=${repositoryContext}` },
			],
			submissionDescriptor: {
				operationToken: "capture-evidence",
				argumentTokens,
				values: [
					{ slot: "outcome", domain: "verification_outcome", allowedValues: ["passed", "verification_failed", "procedural_tooling_failed"], substitutionLocation: 4 },
					{ slot: "input", domain: "artifact_path_or_stdin", schema: "https://gentle-ai.dev/schema/review/verification-evidence/v1", substitutionLocation: 5 },
				],
			},
		}] },
	};
	delete status.validationRequest;
	return status;
}

// The record the live binary returns for a slot-bound capture: it binds the
// slot's fix-diff target identity, and its paths digest covers the record's
// own (fix-diff) paths — NOT the frozen projection digest (captured 2026-08-16,
// lineage review-2b6206ed68fb9128: record paths ["calc.go"] against projection
// paths ["calc.go", "util.go"]).
function capturedSlotEvidence(status: ReviewStatusV3, outcome: "passed" | "verification_failed" | "procedural_tooling_failed", identityDigit: string) {
	return {
		...capturedCorrectionEvidence(status, outcome, identityDigit),
		targetIdentity: EVIDENCE_SLOT_FIX_TARGET,
		pathsDigest: `sha256:${identityDigit.repeat(64)}`,
	};
}

test("correction evidence capture executes the collect slot's rendered submission tokens verbatim", async (t) => {
	for (const [outcome, expectedKind] of [
		["passed", "run-targeted-validation"],
		["verification_failed", "recapture-required"],
	] as const) {
		await t.test(outcome, async (scenario) => {
			const cwd = repository(scenario);
			writeFileSync(join(cwd, "app.ts"), `export const outcome = ${JSON.stringify(outcome)};\n`);
			const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
			const beforeCapture = bindEvidenceSubmissionCollection(targetStatusFixture({
				lineageId: `slot-correction-${outcome.replaceAll("_", "-")}`,
				authorityState: "correction_required",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			}));
			const expectedTokens = beforeCapture.nextTransition!.collect!.inputs[0]!.submissionDescriptor!.argumentTokens;
			const afterCapture = targetStatusFixture({
				lineageId: beforeCapture.authority!.lineageId,
				authorityState: outcome === "passed" ? "validating" : "correction_required",
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
			});
			if (outcome === "passed") bindTargetedValidation(afterCapture);
			else bindEvidenceSubmissionCollection(afterCapture);
			frozen.cleanup();
			const misboundCaptures: Array<Record<string, unknown>> = [];
			const submissions: Array<Record<string, unknown>> = [];
			let statuses = 0;
			let finalizes = 0;
			const { controller } = runtime(fakeNative({
				targetStatus: async () => {
					statuses += 1;
					return statuses === 1 ? beforeCapture : afterCapture;
				},
				captureEvidence: async (request) => {
					misboundCaptures.push(request as unknown as Record<string, unknown>);
					throw new Error("misbound capture: the collect slot's rendered submission tokens were bypassed");
				},
				captureEvidenceSubmission: async (request: Record<string, unknown>) => {
					submissions.push(request);
					return capturedSlotEvidence(beforeCapture, outcome, outcome === "passed" ? "1" : "2");
				},
				finalize: async () => {
					finalizes += 1;
					return { lineageId: beforeCapture.authority!.lineageId, state: "approved", action: "approved", storeRevision: "r-final" };
				},
			} as unknown as Partial<NativeReviewCli>), undefined, new CandidateViewRegistry());
			const validation = outcome === "passed" ? {
				request_hash: "9".repeat(64), correction_ids: [],
				original_criteria: { passed: true, evidence: ["acceptance passes"] },
				correction_regression: { passed: true, evidence: ["regression passes"] },
				fix_caused_findings: [], follow_ups: [],
			} : undefined;
			const result = await controller.execute(`slot-correction-${outcome}`, {
				operation: "finalize",
				lineageId: beforeCapture.authority!.lineageId,
				input: JSON.stringify({ final_evidence: `evidence: ${outcome}`, final_verification_outcome: outcome, ...(validation === undefined ? {} : { validation }) }),
			}, undefined, undefined, context(cwd));
			const details = result.details as Record<string, unknown>;
			assert.deepEqual(misboundCaptures, [], "capture-evidence must never rebind to the top-level live workspace identity");
			assert.equal(submissions.length, 1, "the slot submission must be executed exactly once");
			const submission = submissions[0]!;
			assert.deepEqual(submission.argumentTokens, expectedTokens, "the provider-rendered submission tokens must be passed verbatim, in provider order");
			assert.equal(submission.outcomeSubstitutionLocation, 4);
			assert.equal(submission.inputSubstitutionLocation, 5);
			assert.equal(submission.cwd, undefined, "the slot's --repository-context is authoritative; never pass --cwd alongside it");
			assert.equal(submission.outcome, outcome);
			assert.equal(submission.evidenceDocument, `evidence: ${outcome}`);
			assert.equal((details.correction_step as { kind?: string } | undefined)?.kind, expectedKind);
			assert.equal(finalizes, outcome === "passed" ? 1 : 0);
		});
	}
});

test("ordinary final verification at validating captures evidence through the slot's rendered submission tokens", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const finalSlot = true;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const beforeCapture = bindEvidenceSubmissionCollection(targetStatusFixture({
		lineageId: "final-verification-slot",
		authorityState: "validating",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}));
	const expectedTokens = beforeCapture.nextTransition!.collect!.inputs[0]!.submissionDescriptor!.argumentTokens;
	const afterCapture = bindFinalVerificationTransition(targetStatusFixture({
		lineageId: "final-verification-slot",
		authorityState: "validating",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}), "passed");
	frozen.cleanup();
	const misboundCaptures: Array<Record<string, unknown>> = [];
	const submissions: Array<Record<string, unknown>> = [];
	const transitions: Array<readonly string[]> = [];
	let statuses = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statuses += 1;
			return statuses === 1 ? beforeCapture : afterCapture;
		},
		captureEvidence: async (request) => {
			misboundCaptures.push(request as unknown as Record<string, unknown>);
			throw new Error("misbound capture: the collect slot's rendered submission tokens were bypassed");
		},
		captureEvidenceSubmission: async (request: Record<string, unknown>) => {
			submissions.push(request);
			return capturedSlotEvidence(beforeCapture, "passed", "3");
		},
		finalizeTransition: async (request) => {
			transitions.push(request.argumentTokens);
			return { lineageId: "final-verification-slot", state: "approved", action: "terminal", storeRevision: "r2", receiptPath: "/opaque/receipt" };
		},
	} as unknown as Partial<NativeReviewCli>), undefined, new CandidateViewRegistry());
	const result = await controller.execute("final-verification-slot", {
		operation: "finalize",
		lineageId: "final-verification-slot",
		input: JSON.stringify({ final_evidence: "verification run: passed", final_verification_outcome: "passed" }),
	}, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.deepEqual(misboundCaptures, [], "capture-evidence must never rebind to the top-level live workspace identity");
	assert.equal(submissions.length, 1);
	assert.deepEqual(submissions[0]!.argumentTokens, expectedTokens);
	assert.equal(submissions[0]!.cwd, undefined, "the slot's --repository-context is authoritative; never pass --cwd alongside it");
	assert.deepEqual(transitions, [["--lineage=final-verification-slot", "--captured-evidence=true"]]);
	assert.equal((details.result as { state?: string } | undefined)?.state, "approved");
});

// Field defect amplifier (fambig, 2026-08-16): an envelope-less mutating
// failure is stamped mutationOutcome "unknown", and the reconciler KEPT
// "unknown" even after fresh STATUS proved the authority revision identical to
// the pre-operation revision — reporting a replay prohibition for an operation
// that provably never mutated. A proven non-mutation must be reported as
// mutation_outcome none with the proof named; a genuinely ambiguous result
// (revision moved, or STATUS unavailable) stays fail-closed unknown.
test("finalize reconciliation downgrades an envelope-less unknown to proven non-mutation when the authority revision is unchanged", async (t) => {
	const cwd = repository(t);
	let statuses = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statuses += 1;
			return targetStatusFixture({ lineageId: "unchanged-revision" });
		},
		finalize: async () => {
			throw Object.assign(new Error("stderr-only native failure without a typed envelope"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
	}));
	const details = (await controller.execute("proven-none", { operation: "finalize", lineageId: "unchanged-revision", input: "{}" }, undefined, undefined, context(cwd))).details as Record<string, unknown>;
	assert.equal(details.outcome, "native-mutation-status-reconciled");
	assert.equal(details.mutation_performed, false, "a reconciled unchanged revision proves the operation did not mutate");
	assert.equal(details.mutation_outcome, "none");
	assert.match(String(details.mutation_outcome_reason), /revision unchanged/i, "the downgrade must name its proof");
	assert.equal("replayability" in details, false, "a proven non-mutation must not claim replay prohibition");
	assert.equal(details.next_action, "finalize");
	assert.equal(statuses, 2);
});

test("finalize reconciliation preserves fail-closed unknown when the reconciled authority revision moved", async (t) => {
	const cwd = repository(t);
	const moved = targetStatusFixture({ lineageId: "moved-revision" });
	moved.authority!.revision = `sha256:${"b".repeat(64)}`;
	let statuses = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			statuses += 1;
			return statuses === 1 ? targetStatusFixture({ lineageId: "moved-revision" }) : moved;
		},
		finalize: async () => {
			throw Object.assign(new Error("stderr-only native failure without a typed envelope"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
	}));
	const details = (await controller.execute("kept-unknown", { operation: "finalize", lineageId: "moved-revision", input: "{}" }, undefined, undefined, context(cwd))).details as Record<string, unknown>;
	assert.equal(details.outcome, "native-mutation-status-reconciled");
	assert.equal(details.mutation_outcome, "unknown", "a moved revision is genuinely ambiguous and must stay fail-closed");
	assert.equal(details.replayability, "not_replayable");
});

// Same misbinding class, remaining finalize-form slots (live smoke,
// 2026-08-16, dev binary 2.4.0-main): the correction PLAN and TARGETED
// VALIDATION collect slots render `finalize` submission descriptors whose
// tokens carry --contract/--lineage/--expected-revision/--target/
// --request-hash/--repository-context plus one {{value}} slot. The legacy
// reconstructed `finalize --correction-lines/--validation` argv fails on the
// live emitter with "reconcile compact predecessor effects: repository
// context effect binding or payload does not match committed intent". Collect
// satisfaction must execute the rendered tokens verbatim.
function bindPlanSubmissionCollection(status: ReviewStatusV3, repositoryContext = EVIDENCE_SLOT_REPOSITORY_CONTEXT): ReviewStatusV3 {
	const lineageId = status.authority!.lineageId;
	const revision = status.authority!.revision;
	status.nextTransition = {
		kind: "collect",
		reasonCode: "correction_plan_required",
		collect: { inputs: [{
			name: "correction_lines",
			schema: "gentle-ai.review-correction-plan/v1",
			captureOperation: "external.plan_correction",
			arguments: [
				{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
				{ name: "expected-revision", value: revision, token: `--expected-revision=${revision}` },
				{ name: "target", value: status.targetIdentity, token: `--target=${status.targetIdentity}` },
			],
			submissionDescriptor: {
				operationToken: "finalize",
				argumentTokens: [
					"--contract=gentle-ai.review-integration/v2",
					`--lineage=${lineageId}`,
					`--expected-revision=${revision}`,
					`--target=${status.targetIdentity}`,
					`--request-hash=sha256:${"c".repeat(64)}`,
					`--repository-context=${repositoryContext}`,
					"--correction-lines={{value}}",
				],
				value: { slot: "correction_lines", domain: "positive_correction_lines", minimum: 1, maximum: 9, substitutionLocation: 6 },
			},
		}] },
	};
	delete status.validationRequest;
	return status;
}

test("correction plan forecast executes the collect slot's rendered finalize submission tokens verbatim", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const plan = true;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const status = bindPlanSubmissionCollection(targetStatusFixture({
		lineageId: "plan-submission",
		authorityState: "correction_required",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}));
	const expectedTokens = status.nextTransition!.collect!.inputs[0]!.submissionDescriptor!.argumentTokens;
	frozen.cleanup();
	const legacyFinalizes: Array<Record<string, unknown>> = [];
	const submissions: Array<Record<string, unknown>> = [];
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		finalize: async (request) => {
			legacyFinalizes.push(request as unknown as Record<string, unknown>);
			throw new Error("misbound plan: the collect slot's rendered finalize submission tokens were bypassed");
		},
		finalizeSubmission: async (request: Record<string, unknown>) => {
			submissions.push(request);
			return { lineageId: "plan-submission", state: "correction_required", action: "continue the current review state", storeRevision: "r-plan" };
		},
	} as unknown as Partial<NativeReviewCli>), undefined, new CandidateViewRegistry());
	const planned = await controller.execute("plan-submission", {
		operation: "finalize",
		lineageId: "plan-submission",
		input: JSON.stringify({ correction_line_forecast: 2 }),
	}, undefined, undefined, context(cwd));
	const details = planned.details as Record<string, unknown>;
	assert.deepEqual(legacyFinalizes, [], "the legacy reconstructed --correction-lines argv must never run when the slot renders submission tokens");
	assert.equal(submissions.length, 1);
	assert.deepEqual(submissions[0]!.argumentTokens, expectedTokens, "the provider-rendered submission tokens must be passed verbatim, in provider order");
	assert.equal(submissions[0]!.valueSubstitutionLocation, 6);
	assert.equal(submissions[0]!.valueLiteral, "2");
	assert.equal((details.result as { state?: string } | undefined)?.state, "correction_required");

	// An out-of-bounds forecast fails closed before any native launch.
	const outOfBounds = await controller.execute("plan-submission-oob", {
		operation: "finalize",
		lineageId: "plan-submission",
		input: JSON.stringify({ correction_line_forecast: 99 }),
	}, undefined, undefined, context(cwd));
	assert.equal((outOfBounds.details as { outcome?: string }).outcome, "native-operation-failed");
	assert.match(JSON.stringify(outOfBounds.details), /correction-forecast-out-of-bounds/);
	assert.equal(submissions.length, 1);
	assert.deepEqual(legacyFinalizes, []);
	execFileSync("chmod", ["-R", "u+w", cwd]);
});

function bindTargetedValidationSubmission(status: ReviewStatusV3): ReviewStatusV3 {
	bindTargetedValidation(status);
	const input = status.nextTransition!.collect!.inputs[0]! as { submissionDescriptor?: unknown };
	const lineageId = status.authority!.lineageId;
	const revision = status.authority!.revision;
	input.submissionDescriptor = {
		operationToken: "finalize",
		argumentTokens: [
			"--contract=gentle-ai.review-integration/v2",
			`--lineage=${lineageId}`,
			`--expected-revision=${revision}`,
			`--target=${status.targetIdentity}`,
			`--request-hash=${status.validationRequest!.requestHash}`,
			`--repository-context=${EVIDENCE_SLOT_REPOSITORY_CONTEXT}`,
			"--validation={{value}}",
			"--captured-evidence=true",
		],
		value: { slot: "validation", domain: "artifact_path_or_stdin", substitutionLocation: 6 },
	};
	return status;
}

test("validation-only targeted validation executes the collect slot's rendered finalize submission tokens verbatim", async (t) => {
	const cwd = repository(t);
	commitFile(cwd, "unrelated.ts", "export const unrelated = false;\n", "add unrelated");
	writeFileSync(join(cwd, "app.ts"), "export const validated = true;\n");
	writeFileSync(join(cwd, "unrelated.ts"), "export const unrelated = true;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const targeted = bindTargetedValidationSubmission(targetStatusFixture({
		lineageId: "validation-submission",
		authorityState: "correction_required",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}));
	(targeted.raw as Record<string, unknown>).schema = "gentle-ai.review-integration.status/v5";
	targeted.validationRequest!.correctionPaths = ["app.ts"];
	targeted.validationRequest!.correctionPathsDigest = `sha256:${"f".repeat(64)}`;
	const expectedTokens = (targeted.nextTransition!.collect!.inputs[0]! as { submissionDescriptor: { argumentTokens: readonly string[] } }).submissionDescriptor.argumentTokens;
	const selection = { untrackedScope: "select" as const, expectedUntrackedInventory: `sha256:${"e".repeat(64)}`, intendedUntracked: ["selected-a.ts"] };
	frozen.cleanup();
	const statusRequests: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	const legacyFinalizes: Array<Record<string, unknown>> = [];
	const submissions: Array<Record<string, unknown>> = [];
	let captures = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			statusRequests.push(request);
			return targeted;
		},
		captureEvidence: async () => { captures += 1; throw new Error("targeted validation must not capture evidence"); },
		finalize: async (request) => {
			legacyFinalizes.push(request as unknown as Record<string, unknown>);
			throw new Error("misbound validation: the collect slot's rendered finalize submission tokens were bypassed");
		},
		finalizeSubmission: async (request: Record<string, unknown>) => {
			submissions.push(request);
			return { lineageId: "validation-submission", state: "approved", action: "approved", storeRevision: "r-approved" };
		},
	} as unknown as Partial<NativeReviewCli>), undefined, new CandidateViewRegistry());
	await controller.execute("validation-submission-selection", { operation: "status", lineageId: "validation-submission", input: JSON.stringify(selection) }, undefined, undefined, context(cwd));
	const validation = {
		request_hash: "9".repeat(64), correction_ids: [],
		original_criteria: { passed: true, evidence: ["acceptance passes"] },
		correction_regression: { passed: true, evidence: ["regression passes"] },
		fix_caused_findings: [], follow_ups: [],
	};
	const completed = await controller.execute("validation-submission", {
		operation: "finalize", lineageId: "validation-submission", input: JSON.stringify({ validation }),
	}, undefined, undefined, context(cwd));
	const details = completed.details as Record<string, unknown>;
	assert.deepEqual(legacyFinalizes, [], "the direct native finalize fallback must not bypass the rendered validation submission");
	assert.equal(captures, 0, "validation-only finalize must not capture evidence");
	assert.equal(submissions.length, 1);
	assert.deepEqual(submissions[0]!.argumentTokens, expectedTokens, "the provider-rendered submission tokens must be passed verbatim, in provider order");
	assert.equal(submissions[0]!.cwd, cwd, "the rendered validation submission runs from the canonical workspace root");
	assert.equal(submissions[0]!.valueSubstitutionLocation, 6);
	const staged = JSON.parse(String(submissions[0]!.valueDocument)) as Record<string, unknown>;
	assert.equal(staged.targeted_validation_request_hash, targeted.validationRequest!.requestHash);
	assert.equal(staged.correction_target_identity, targeted.validationRequest!.correctionTargetIdentity);
	assert.deepEqual(staged.original_criteria, { passed: true, evidence: ["acceptance passes"] });
	assert.deepEqual(statusRequests.map(({ untrackedScope, expectedUntrackedInventory, intendedUntracked }) => ({ untrackedScope, expectedUntrackedInventory, intendedUntracked })), [selection, selection, selection]);
	assert.equal(statusRequests[0]!.cwd, cwd);
	assert.equal(statusRequests[2]!.cwd, cwd);
	assert.equal((details.result as { state?: string } | undefined)?.state, "approved");
	for (const correctionPaths of [[], ["outside.ts"]] as const) {
		targeted.validationRequest!.correctionPaths = correctionPaths;
		const rejected = await controller.execute(`validation-submission-${correctionPaths.length}`, {
			operation: "finalize", lineageId: "validation-submission", input: JSON.stringify({ validation }),
		}, undefined, undefined, context(cwd));
		assert.equal((rejected.details as { outcome?: string }).outcome, "native-operation-failed");
	}
	assert.equal(submissions.length, 1, "invalid correction paths fail before native mutation");
	assert.deepEqual(legacyFinalizes, []);
	assert.equal(captures, 0);
	await controller.execute("validation-submission-terminal-clear", { operation: "status", lineageId: "validation-submission" }, undefined, undefined, context(cwd));
	assert.deepEqual(statusRequests.at(-1), { cwd, lineageId: "validation-submission" });
});

// Live smoke root cause (2026-08-16, dev binary 2.4.0-main): status/v5 mints
// the opaque --repository-context handle BOUND TO THE STATUS QUERY ROOT, and
// every rendered payload embeds it. The finalize lane queries negotiated
// STATUS from a frozen candidate-view root, so every rendered submission it
// executed carried a context bound to the wrong root and failed the live
// emitter's committed-intent reconciliation ("repository context effect
// binding or payload does not match committed intent"). On v5 the lane must
// rebind its negotiated STATUS to the workspace root before executing any
// rendered payload; pinned pre-v5 emitters keep the frozen-view status.
test("status/v5 finalize lane rebinds negotiated status to the workspace root before executing rendered payloads", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const rebind = true;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	const viewContext = `rctx1_${"a".repeat(64)}`;
	const workspaceContext = `rctx1_${"b".repeat(64)}`;
	const makeBefore = (repositoryContext: string) => {
		const status = bindEvidenceSubmissionCollection(targetStatusFixture({
			lineageId: "v5-rebind",
			authorityState: "correction_required",
			baseTree: frozen.baseTree,
			currentCandidateTree: frozen.candidateTree,
			paths: frozen.paths,
		}), EVIDENCE_SLOT_FIX_TARGET, repositoryContext);
		(status.raw as Record<string, unknown>).schema = "gentle-ai.review-integration.status/v5";
		return status;
	};
	const viewBefore = makeBefore(viewContext);
	const workspaceBefore = makeBefore(workspaceContext);
	const workspaceAfter = bindTargetedValidationSubmission(targetStatusFixture({
		lineageId: "v5-rebind",
		authorityState: "validating",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
	}));
	(workspaceAfter.raw as Record<string, unknown>).schema = "gentle-ai.review-integration.status/v5";
	// Live post-evidence shape (2026-08-16): the validation request binds the
	// FROZEN authority target identity while the top-level target identity is
	// the live workspace snapshot (which now contains the fix).
	workspaceAfter.authorityTargetIdentity = workspaceAfter.validationRequest!.targetIdentity;
	workspaceAfter.targetIdentity = `sha256:${"d".repeat(64)}`;
	const expectedEvidenceTokens = workspaceBefore.nextTransition!.collect!.inputs[0]!.submissionDescriptor!.argumentTokens;
	const expectedValidationTokens = (workspaceAfter.nextTransition!.collect!.inputs[0]! as { submissionDescriptor: { argumentTokens: readonly string[] } }).submissionDescriptor.argumentTokens;
	frozen.cleanup();
	const selection = {
		untrackedScope: "select" as const,
		expectedUntrackedInventory: `sha256:${"e".repeat(64)}`,
		intendedUntracked: ["selected-b.ts", "selected-a.ts"],
	};
	const statusRoots: string[] = [];
	const statusRequests: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	const evidenceSubmissions: Array<Record<string, unknown>> = [];
	const finalizeSubmissions: Array<Record<string, unknown>> = [];
	let workspaceStatuses = 0;
	let terminal = false;
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			statusRoots.push(request.cwd);
			statusRequests.push(request);
			const selected = request.untrackedScope === selection.untrackedScope &&
				request.expectedUntrackedInventory === selection.expectedUntrackedInventory &&
				JSON.stringify(request.intendedUntracked) === JSON.stringify(selection.intendedUntracked);
			if (!terminal && request.lineageId === "v5-rebind" && !selected) return targetStatusFixture({ applicability: "unrelated", action: "start" });
			if (request.cwd !== cwd) return viewBefore;
			workspaceStatuses += 1;
			return workspaceStatuses <= 2 ? workspaceBefore : workspaceAfter;
		},
		captureEvidenceSubmission: async (request: Record<string, unknown>) => {
			evidenceSubmissions.push(request);
			return capturedSlotEvidence(workspaceBefore, "passed", "8");
		},
		finalizeSubmission: async (request: Record<string, unknown>) => {
			finalizeSubmissions.push(request);
			terminal = true;
			return { lineageId: "v5-rebind", state: "approved", action: "approved", storeRevision: "r-approved" };
		},
	} as unknown as Partial<NativeReviewCli>), undefined, new CandidateViewRegistry());
	await controller.execute("v5-rebind-selection", {
		operation: "status",
		lineageId: "v5-rebind",
		input: JSON.stringify(selection),
	}, undefined, undefined, context(cwd));
	const staleSelection = { ...selection, expectedUntrackedInventory: `sha256:${"f".repeat(64)}` };
	await controller.execute("v5-rebind-stale-selection", {
		operation: "status",
		lineageId: "v5-rebind",
		input: JSON.stringify(staleSelection),
	}, undefined, undefined, context(cwd));
	const completed = await controller.execute("v5-rebind", {
		operation: "finalize",
		lineageId: "v5-rebind",
		input: JSON.stringify({
			final_evidence: "evidence: passed",
			final_verification_outcome: "passed",
			validation: {
				request_hash: "9".repeat(64), correction_ids: [],
				original_criteria: { passed: true, evidence: ["acceptance passes"] },
				correction_regression: { passed: true, evidence: ["regression passes"] },
				fix_caused_findings: [], follow_ups: [],
			},
		}),
	}, undefined, undefined, context(cwd));
	const details = completed.details as Record<string, unknown>;
	assert.notEqual(statusRoots[2], cwd, "the initial FINALIZE status query still freezes through the candidate view root");
	assert.equal(statusRoots[3], cwd, "a v5 status must be rebound to the workspace root before any rendered payload executes");
	assert.equal(evidenceSubmissions.length, 1);
	assert.deepEqual(evidenceSubmissions[0]!.argumentTokens, expectedEvidenceTokens, "the evidence submission must carry the workspace-root-minted tokens");
	assert.equal(finalizeSubmissions.length, 1);
	assert.deepEqual(finalizeSubmissions[0]!.argumentTokens, expectedValidationTokens, "the validation submission must carry the workspace-root-minted tokens");
	assert.equal(statusRoots.filter((root) => root === cwd).length, 4, "the public, stale, rebound, and post-evidence statuses must use the workspace root");
	assert.deepEqual(
		statusRequests.map((request) => ({
			untrackedScope: request.untrackedScope,
			expectedUntrackedInventory: request.expectedUntrackedInventory,
			intendedUntracked: request.intendedUntracked,
		})),
		[selection, staleSelection, selection, selection, selection],
	);
	assert.equal((details.result as { state?: string } | undefined)?.state, "approved");
	await controller.execute("v5-rebind-terminal-clear", { operation: "status", lineageId: "v5-rebind" }, undefined, undefined, context(cwd));
	assert.deepEqual(statusRequests.at(-1), { cwd, lineageId: "v5-rebind" });
});
