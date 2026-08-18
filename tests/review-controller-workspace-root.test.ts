import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
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

interface Runtime {
	controller: RegisteredTool;
	toolCall: ToolCallHandler;
}

function runtime(
	nativeReviewCli: NativeReviewCli | null,
	candidateViews: CandidateViewRegistry | null = null,
): Runtime {
	const tools = new Map<string, RegisteredTool>();
	let toolCall: ToolCallHandler | undefined;
	const dependencies = { nativeReviewCli, candidateViews } as unknown as Parameters<typeof createGentleAiExtension>[0];
	createGentleAiExtension(dependencies)({
		on(name: string, handler: ToolCallHandler) {
			if (name === "tool_call") toolCall = handler;
		},
		registerTool(definition: RegisteredTool & { name: string }) { tools.set(definition.name, definition); },
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	assert.ok(controller);
	assert.ok(toolCall);
	return { controller, toolCall };
}

function context(cwd: string): ExtensionContext {
	return { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext;
}

function repository(t: test.TestContext, prefix = "gentle-pi-workspace-root-"): string {
	const cwd = mkdtempSync(join(tmpdir(), prefix));
	t.after(() => {
		if (process.platform !== "win32") {
			try { execFileSync("chmod", ["-R", "u+w", cwd], { stdio: "ignore" }); } catch { /* best effort */ }
		}
		rmSync(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Workspace Test", "-c", "user.email=workspace@example.invalid", "commit", "-m", "initial"], { cwd });
	return cwd;
}

function addWorktree(t: test.TestContext, cwd: string, branch: string): string {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-workspace-worktrees-"));
	t.after(() => {
		try { execFileSync("git", ["worktree", "remove", "--force", join(parent, branch)], { cwd }); } catch {}
		rmSync(parent, { recursive: true, force: true });
	});
	const worktree = join(parent, branch);
	execFileSync("git", ["worktree", "add", "-b", branch, worktree], { cwd });
	return worktree;
}

function fakeNative(overrides: Partial<NativeReviewCli> = {}): NativeReviewCli {
	return {
		start: async () => ({ lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true }),
		finalize: async () => ({ lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" }),
		validate: async () => { throw new Error("validate is not expected in workspace-root tests"); },
		bindSdd: async () => { throw new Error("bind-sdd is not expected in workspace-root tests"); },
		sddStatus: async () => ({ ready: false }),
		reviewStatus: async () => ({ schema: "gentle-ai.review-authority-status/v1", repository: "/repo", complete: true, authoritative: true, status: "clean", entries: [], locks: [], diagnostics: [], raw: { schema: "gentle-ai.review-authority-status/v1", operation: "review/status", repository: "/repo", complete: true, authoritative: true, status: "clean", entries: [], locks: [], diagnostics: [] } }),
		targetStatus: async (request) => request.lineageId === undefined
			? candidateStartTargetStatus(request)
			: candidateFinalizeTargetStatus(request, request.lineageId),
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
	applicability?: "current_target" | "unrelated";
	action?: ReviewStatusV3["action"];
	lineageId?: string;
	authorityState?: NonNullable<ReviewStatusV3["authority"]>["state"];
	baseTree?: string;
	currentCandidateTree?: string;
	paths?: readonly string[];
	intendedUntracked?: readonly string[];
} = {}): ReviewStatusV3 {
	const applicability = options.applicability ?? "current_target";
	const action = options.action ?? (applicability === "current_target" ? "finalize" : "start");
	const lineageId = options.lineageId ?? "native-lineage";
	const authorityState = options.authorityState ?? "reviewing";
	const sha = `sha256:${"a".repeat(64)}`;
	const tree = options.currentCandidateTree ?? "b".repeat(40);
	const baseTree = options.baseTree ?? tree;
	const paths = options.paths ?? ["app.ts"];
	const intendedUntracked = options.intendedUntracked ?? [];
	const projection = {
		schema: "gentle-ai.review-integration.projection/v1" as const,
		kind: "current-changes" as const,
		projection: "workspace" as const,
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
		receipt: { status: applicability === "current_target" ? "expected_missing" : "not_applicable" },
		action,
		replayability: "not_replayable",
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
		candidates: [],
	};
	if (applicability === "current_target") {
		raw.authority = { version: "compact-v2", lineage_id: lineageId, state: authorityState, generation: 1, revision: sha };
		raw.frozen = { tier: "medium", original_changed_lines: 2, correction_budget: 1 };
	}
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability,
		...(applicability === "current_target" ? { authority: { version: "compact-v2" as const, lineageId, state: authorityState, generation: 1, revision: sha } } : {}),
		receipt: { status: applicability === "current_target" ? "expected_missing" : "not_applicable" },
		action,
		replayability: "not_replayable",
		...(applicability === "current_target" ? { frozen: { tier: "medium" as const, originalChangedLines: 2, correctionBudget: 1 } } : {}),
		targetIdentity: sha,
		projection,
		repair: UNSUPPORTED_REPAIR_ASSESSMENT,
		candidates: [],
		raw,
	};
}

function candidateStartTargetStatus(request: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0]): ReviewStatusV3 {
	let candidate: ReturnType<CandidateViewRegistry["create"]> | undefined;
	try {
		candidate = new CandidateViewRegistry().create({
			contributorRoot: request.cwd,
			...(request.baseRef === undefined ? {} : { baseRef: request.baseRef, committedOnly: true }),
			...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
		});
		return targetStatusFixture({
			applicability: "unrelated",
			action: "start",
			baseTree: candidate.baseTree,
			currentCandidateTree: candidate.candidateTree,
			paths: candidate.paths,
			intendedUntracked: request.intendedUntracked,
		});
	} finally {
		candidate?.cleanup();
	}
}

function candidateFinalizeTargetStatus(request: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0], lineageId: string): ReviewStatusV3 {
	let candidate: ReturnType<CandidateViewRegistry["create"]> | undefined;
	try {
		candidate = new CandidateViewRegistry().create({ contributorRoot: request.cwd });
		return targetStatusFixture({
			lineageId,
			baseTree: candidate.baseTree,
			currentCandidateTree: candidate.candidateTree,
			paths: candidate.paths,
		});
	} finally {
		candidate?.cleanup();
	}
}

test("same-session registrations retain START selection for validation-only FINALIZE", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "selected.ts"), "export const selected = true;\n");
	const selection = { untrackedScope: "select" as const, expectedUntrackedInventory: `sha256:${"e".repeat(64)}`, intendedUntracked: ["selected.ts"] };
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd, intendedUntracked: selection.intendedUntracked });
	const target = targetStatusFixture({
		lineageId: "retained-untracked",
		authorityState: "correction_required",
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
		intendedUntracked: selection.intendedUntracked,
	});
	frozen.cleanup();
	const request = { schema: "gentle-ai.review-targeted-validation-request/v1" as const, requestHash: `sha256:${"9".repeat(64)}`, lineageId: target.authority!.lineageId, expectedRevision: target.authority!.revision, targetIdentity: target.targetIdentity, fixFindingIds: [], projection: "workspace" as const, correctionCandidateTree: target.projection.currentCandidateTree, correctionTargetIdentity: target.targetIdentity, correctionPaths: target.projection.paths, correctionPathsDigest: target.projection.pathsDigest };
	target.validationRequest = request;
	target.nextTransition = { kind: "collect", reasonCode: "targeted_validation_required", collect: { inputs: [{ name: "targeted_validation", schema: request.schema, captureOperation: "external.run_targeted_validation", arguments: [], validationRequest: request }] } };
	const calls: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	const targetStatus: NonNullable<NativeReviewCli["targetStatus"]> = async (status) => {
		calls.push(status);
		return status.lineageId === undefined ? candidateStartTargetStatus(status) : target;
	};
	const sessionId = "cross-registration-untracked-selection";
	const ctx = { ...context(cwd), sessionManager: { getSessionId: () => sessionId } } as ExtensionContext;
	const { controller: start } = runtime(fakeNative({
		targetStatus,
		start: async () => ({ lineageId: "retained-untracked", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 2, correctionBudget: 1, action: "created", lensesRequired: true }),
	}));
	const { controller: finalize } = runtime(fakeNative({ targetStatus }));
	const started = await start.execute("retained-start", { operation: "start", input: JSON.stringify({ mode: "ordinary", ...selection }) }, undefined, undefined, ctx);
	assert.equal((started.details as { result: { lineage_id: string } }).result.lineage_id, "retained-untracked");
	const completed = await finalize.execute("retained-finalize", { operation: "finalize", lineageId: "retained-untracked", input: JSON.stringify({ validation: { request_hash: request.requestHash.slice(7), correction_ids: [], original_criteria: { passed: true, evidence: ["acceptance passes"] }, correction_regression: { passed: true, evidence: ["regression passes"] }, fix_caused_findings: [], follow_ups: [] } }) }, undefined, undefined, ctx);
	assert.doesNotMatch(JSON.stringify(completed.details), /evidence-first-ordering/);
	assert.ok(calls.length > 1 && calls.every(({ untrackedScope, expectedUntrackedInventory, intendedUntracked }) => untrackedScope === selection.untrackedScope && expectedUntrackedInventory === selection.expectedUntrackedInventory && JSON.stringify(intendedUntracked) === JSON.stringify(selection.intendedUntracked)));
});

test("INSPECT and STATUS operate on the explicit workspace root while the session cwd stays elsewhere", async (t) => {
	const sessionCwd = repository(t);
	const worktree = addWorktree(t, sessionCwd, "feat-binding");
	const observedCwds: string[] = [];
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			observedCwds.push(request.cwd);
			return targetStatusFixture();
		},
	}));
	await controller.execute("inspect-b", { operation: "inspect", workspaceRoot: worktree }, undefined, undefined, context(sessionCwd));
	await controller.execute("status-b", { operation: "status", lineageId: "native-lineage", workspaceRoot: worktree }, undefined, undefined, context(sessionCwd));
	await controller.execute("inspect-default", { operation: "inspect" }, undefined, undefined, context(sessionCwd));
	assert.deepEqual(observedCwds, [realpathSync(worktree), realpathSync(worktree), sessionCwd]);
});

test("START freezes the candidate from the explicit workspace root and returns the actor binding envelope", async (t) => {
	const sessionCwd = repository(t);
	writeFileSync(join(sessionCwd, "unrelated.ts"), "export const unrelated = true;\n");
	const worktree = addWorktree(t, sessionCwd, "feat-candidate");
	writeFileSync(join(worktree, "app.ts"), "export const value = 2; // worktree candidate\n");
	const candidateViews = new CandidateViewRegistry();
	const startRequests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const { controller, toolCall } = runtime(fakeNative({
		start: async (request) => {
			startRequests.push(request);
			return { lineageId: "worktree-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), candidateViews);
	const started = await controller.execute("start-b", { operation: "start", workspaceRoot: worktree, input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(sessionCwd));
	const details = started.details as {
		workspace_root: string;
		actor_binding: { workspace_root: string; candidate_root: string; candidate_tree: string; candidate_paths: readonly string[] };
	};
	const root = realpathSync(worktree);
	assert.equal(details.workspace_root, root);
	assert.equal(details.actor_binding.workspace_root, root);
	assert.deepEqual(details.actor_binding.candidate_paths, ["app.ts"]);
	const view = candidateViews.resolveForLens("worktree-lineage", "review-reliability");
	assert.equal(details.actor_binding.candidate_root, view.root);
	assert.equal(details.actor_binding.candidate_tree, view.candidateTree);
	assert.deepEqual(startRequests, [{ cwd: root, agent: "pi", targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" }]);
	assert.notEqual(startRequests[0]?.cwd, view.root);
	assert.equal(readFileSync(join(view.root, "app.ts"), "utf8"), "export const value = 2; // worktree candidate\n");
	assert.equal(view.paths.includes("unrelated.ts"), false);
	const dispatch = { agent: "review-reliability", task: "review the change", mode: "task" };
	assert.equal(await toolCall({ toolName: "subagent_run", input: dispatch }, context(sessionCwd)), undefined);
	assert.match(dispatch.task, /Controller-owned review lineage: `worktree-lineage`/);
	assert.ok(dispatch.task.includes(view.root));
	assert.ok(dispatch.task.includes(view.candidateTree));
	candidateViews.cleanup(view.token);
});

test("an omitted workspaceRoot canonicalizes a nested same-worktree session before every lifecycle operation", async (t) => {
	const root = repository(t);
	const sessionCwd = join(root, "nested");
	mkdirSync(sessionCwd);
	writeFileSync(join(root, "app.ts"), "export const value = 3;\n");
	const candidateViews = new CandidateViewRegistry();
	const targetStatusCwds: string[] = [];
	const startRequests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const finalizeCwds: string[] = [];
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => { targetStatusCwds.push(request.cwd); return request.lineageId === undefined ? candidateStartTargetStatus(request) : candidateFinalizeTargetStatus(request, request.lineageId); },
		start: async (request) => {
			startRequests.push(request);
			return { lineageId: "session-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
		finalize: async (request) => { finalizeCwds.push(request.cwd); return { lineageId: "session-lineage", state: "approved", action: "approved", storeRevision: "r1" }; },
	}), candidateViews);
	const ctx = context(sessionCwd);
	await controller.execute("inspect-session", { operation: "inspect" }, undefined, undefined, ctx);
	const started = await controller.execute("start-session", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, ctx);
	const status = await controller.execute("status-session", { operation: "status", lineageId: "session-lineage" }, undefined, undefined, ctx);
	const details = started.details as { workspace_root: string; actor_binding: { workspace_root: string; candidate_root: string; candidate_paths: readonly string[] } };
	assert.equal(details.workspace_root, root);
	assert.equal(details.actor_binding.workspace_root, root);
	assert.equal((status.details as { workspace_root: string }).workspace_root, root);
	assert.deepEqual(details.actor_binding.candidate_paths, ["app.ts"]);
	assert.deepEqual(startRequests, [{ cwd: root, agent: "pi", targetIdentity: `sha256:${"a".repeat(64)}`, projection: "workspace" }]);
	const view = candidateViews.resolveForLens("session-lineage", "review-reliability");
	assert.equal(details.actor_binding.candidate_root, view.root);
	const finalized = await controller.execute("finalize-session", { operation: "finalize", lineageId: "session-lineage", input: JSON.stringify({}) }, undefined, undefined, ctx);
	assert.equal((finalized.details as { workspace_root: string }).workspace_root, root);
	assert.ok(targetStatusCwds.every((cwd) => cwd === root), JSON.stringify(targetStatusCwds));
	assert.deepEqual(finalizeCwds, [root]);
});

test("an explicit nested foreign workspace root canonically owns inspect, status, START, and omitted-root FINALIZE", async (t) => {
	const sessionCwd = repository(t, "gentle-pi-session-a-");
	const target = repository(t, "gentle-pi-target-b-");
	const nested = join(target, "nested");
	mkdirSync(nested);
	writeFileSync(join(target, "app.ts"), "export const value = 2; // target B\n");
	const root = realpathSync(target);
	const targetStatusCwds: string[] = [];
	const targetStatusRequests: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	const startCwds: string[] = [];
	const finalizeCwds: string[] = [];
	const candidateViews = new CandidateViewRegistry();
	let initialCrossRootStatus = true;
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			targetStatusCwds.push(request.cwd);
			targetStatusRequests.push(request);
			if (request.lineageId === "cross-root-lineage" && initialCrossRootStatus) {
				initialCrossRootStatus = false;
				return request.untrackedScope === "select"
					? targetStatusFixture({ lineageId: request.lineageId, authorityState: "correction_required" })
					: targetStatusFixture({ applicability: "unrelated", action: "start" });
			}
			return request.lineageId === undefined
				? candidateStartTargetStatus(request)
				: candidateFinalizeTargetStatus(request, request.lineageId);
		},
		start: async (request) => {
			startCwds.push(request.cwd);
			return { lineageId: "cross-root-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
		finalize: async (request) => {
			finalizeCwds.push(request.cwd);
			return { lineageId: "cross-root-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}), candidateViews);

	const digest = `sha256:${"b".repeat(64)}`;
	const intendedUntracked = ["selected-b.ts", "selected-a.ts"];
	const inspect = await controller.execute("inspect-target-b", { operation: "inspect", workspaceRoot: nested }, undefined, undefined, context(sessionCwd));
	const status = await controller.execute("status-target-b", { operation: "status", lineageId: "cross-root-lineage", workspaceRoot: nested, input: JSON.stringify({ untrackedScope: "select", expectedUntrackedInventory: digest, intendedUntracked }) }, undefined, undefined, context(sessionCwd));
	const started = await controller.execute("start-target-b", { operation: "start", workspaceRoot: nested, input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(sessionCwd));
	const finalized = await controller.execute("finalize-target-b", { operation: "finalize", lineageId: "cross-root-lineage", input: JSON.stringify({}) }, undefined, undefined, context(sessionCwd));

	for (const result of [inspect, status, started, finalized]) {
		assert.equal((result.details as { workspace_root?: string }).workspace_root, root);
	}
	const statusDetails = status.details as { status?: string; result?: { authority?: { state?: string } } };
	assert.equal(statusDetails.status, "in-progress");
	assert.equal(statusDetails.result?.authority?.state, "correction_required");
	assert.deepEqual(targetStatusRequests[1], { cwd: root, lineageId: "cross-root-lineage", untrackedScope: "select", expectedUntrackedInventory: digest, intendedUntracked });
	assert.deepEqual(targetStatusRequests[3], { cwd: root, lineageId: "cross-root-lineage", agent: "pi", untrackedScope: "select", expectedUntrackedInventory: digest, intendedUntracked });
	assert.ok(targetStatusCwds.every((cwd) => cwd === root), JSON.stringify(targetStatusCwds));
	assert.deepEqual(startCwds, [root]);
	assert.deepEqual(finalizeCwds, [root]);
});


test("STATUS relays exclude selection and rejects malformed input before native status", async (t) => {
	const cwd = repository(t);
	const requests: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0][] = [];
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			requests.push(request);
			return targetStatusFixture({ lineageId: request.lineageId });
		},
	}));
	const digest = `sha256:${"c".repeat(64)}`;
	const excluded = await controller.execute("status-exclude", { operation: "status", lineageId: "excluded-lineage", input: JSON.stringify({ untrackedScope: "exclude", expectedUntrackedInventory: digest, intendedUntracked: [] }) }, undefined, undefined, context(cwd));
	assert.equal((excluded.details as { status?: string }).status, "in-progress");
	assert.deepEqual(requests, [{ cwd, lineageId: "excluded-lineage", untrackedScope: "exclude", expectedUntrackedInventory: digest, intendedUntracked: [] }]);

	for (const [input, reason] of [
		[{}, "untracked-selection-invalid"],
		[{ untrackedScope: "select", expectedUntrackedInventory: digest, intendedUntracked: [] }, "untracked-selection-invalid"],
		[{ untrackedScope: "select" }, "untracked-selection-invalid"],
		[{ untrackedScope: "exclude", expectedUntrackedInventory: digest, intendedUntracked: [], unexpected: true }, "unknown-field"],
	] as const) {
		const rejected = await controller.execute("status-invalid", { operation: "status", input: JSON.stringify(input) }, undefined, undefined, context(cwd));
		assert.equal((rejected.details as { reason?: string }).reason, reason);
	}
	assert.equal(requests.length, 1);
});

test("an explicit foreign workspace root works when the Pi session cwd is not a Git repository", async (t) => {
	const target = repository(t, "gentle-pi-target-b-non-git-session-");
	const nested = join(target, "nested");
	mkdirSync(nested);
	const nonGit = mkdtempSync(join(tmpdir(), "gentle-pi-non-git-session-"));
	t.after(() => rmSync(nonGit, { recursive: true, force: true }));
	const observed: string[] = [];
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			observed.push(request.cwd);
			return targetStatusFixture();
		},
	}));
	const result = await controller.execute("inspect-target-from-non-git", { operation: "inspect", workspaceRoot: nested }, undefined, undefined, context(nonGit));
	assert.equal((result.details as { workspace_root?: string }).workspace_root, realpathSync(target));
	assert.deepEqual(observed, [realpathSync(target)]);
});

test("omitted workspaceRoot fails closed for the same lineage bound to two target repositories", async (t) => {
	const rootA = repository(t, "gentle-pi-ambiguous-a-");
	const rootB = repository(t, "gentle-pi-ambiguous-b-");
	const candidateViews = new CandidateViewRegistry();
	const viewA = candidateViews.create({ contributorRoot: rootA });
	const viewB = candidateViews.create({ contributorRoot: rootB });
	candidateViews.bindCurrent({ token: viewA.token, lineageId: "shared-lineage", selectedLenses: ["review-reliability"] });
	candidateViews.bindCurrent({ token: viewB.token, lineageId: "shared-lineage", selectedLenses: ["review-reliability"] });
	let nativeCalls = 0;
	const { controller } = runtime(fakeNative({
		targetStatus: async (request) => {
			nativeCalls += 1;
			return targetStatusFixture({ lineageId: request.lineageId });
		},
	}), candidateViews);
	await assert.rejects(
		controller.execute("ambiguous-omission", { operation: "status", lineageId: "shared-lineage" }, undefined, undefined, context(rootA)),
		/workspaceRoot/,
	);
	assert.equal(nativeCalls, 0);
	const explicit = await controller.execute("explicit-b", { operation: "status", lineageId: "shared-lineage", workspaceRoot: rootB }, undefined, undefined, context(rootA));
	assert.equal((explicit.details as { workspace_root?: string }).workspace_root, realpathSync(rootB));
	assert.equal(nativeCalls, 1);
	candidateViews.cleanupTerminal("shared-lineage", "approved", rootA);
	candidateViews.cleanupTerminal("shared-lineage", "approved", rootB);
});

test("workspaceRoot fails closed before any native call for invalid target paths", async (t) => {
	const sessionCwd = repository(t);
	const worktree = addWorktree(t, sessionCwd, "feat-guard");
	const nonGit = mkdtempSync(join(tmpdir(), "gentle-pi-non-git-"));
	t.after(() => rmSync(nonGit, { recursive: true, force: true }));
	const filePath = join(worktree, "app.ts");
	let nativeCalls = 0;
	const counting = fakeNative({
		start: async () => { nativeCalls += 1; throw new Error("native start must not run"); },
		targetStatus: async () => { nativeCalls += 1; throw new Error("native status must not run"); },
		reviewStatus: async () => { nativeCalls += 1; throw new Error("native review status must not run"); },
	});
	const { controller } = runtime(counting);
	const rejected: Array<{ label: string; workspaceRoot: string }> = [
		{ label: "non-git directory", workspaceRoot: nonGit },
		{ label: "missing directory", workspaceRoot: join(nonGit, "missing") },
		{ label: "file path", workspaceRoot: filePath },
		{ label: "relative path", workspaceRoot: "relative/worktree" },
	];
	for (const { label, workspaceRoot } of rejected) {
		for (const operation of ["inspect", "start", "status"] as const) {
			await assert.rejects(
				controller.execute(`${operation}-${label}`, {
					operation,
					...(operation === "start" ? { input: JSON.stringify({ mode: "ordinary" }) } : {}),
					...(operation === "status" ? { lineageId: "native-lineage" } : {}),
					workspaceRoot,
				}, undefined, undefined, context(sessionCwd)),
				/workspaceRoot/,
				`${operation} must fail closed for ${label}`,
			);
		}
	}
	assert.equal(nativeCalls, 0);
});

test("FINALIZE gives an explicit linked-worktree workspaceRoot precedence over the candidate view", async (t) => {
	const sessionCwd = repository(t);
	const worktree = addWorktree(t, sessionCwd, "feat-finalize");
	writeFileSync(join(worktree, "app.ts"), "export const value = 4;\n");
	const candidateViews = new CandidateViewRegistry();
	const finalizeCwds: string[] = [];
	const { controller } = runtime(fakeNative({
		start: async () => ({ lineageId: "finalize-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true }),
		finalize: async (request) => {
			finalizeCwds.push(request.cwd);
			return { lineageId: "finalize-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}), candidateViews);
	await controller.execute("start-finalize-b", { operation: "start", workspaceRoot: worktree, input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(sessionCwd));
	const candidateRoot = candidateViews.resolveForLens("finalize-lineage", "review-reliability").root;
	const input = JSON.stringify({});
	const finalized = await controller.execute("finalize-explicit-root", { operation: "finalize", lineageId: "finalize-lineage", workspaceRoot: worktree, input }, undefined, undefined, context(sessionCwd));
	const root = realpathSync(worktree);
	assert.equal((finalized.details as { workspace_root?: string }).workspace_root, root);
	assert.equal((finalized.details as { result?: { state?: string } }).result?.state, "approved");
	assert.deepEqual(finalizeCwds, [root]);
	assert.notEqual(finalizeCwds[0], candidateRoot);
	assert.notEqual(finalizeCwds[0], sessionCwd);
});
