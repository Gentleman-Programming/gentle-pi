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
import type { ReviewStatusV1 } from "../lib/review-integration-v1.ts";

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
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
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
		...overrides,
	};
}

function targetStatusFixture(options: {
	applicability?: "current_target" | "unrelated";
	action?: ReviewStatusV1["action"];
	lineageId?: string;
} = {}): ReviewStatusV1 {
	const applicability = options.applicability ?? "current_target";
	const action = options.action ?? (applicability === "current_target" ? "finalize" : "start");
	const lineageId = options.lineageId ?? "native-lineage";
	const sha = `sha256:${"a".repeat(64)}`;
	const tree = "b".repeat(40);
	const projection = {
		schema: "gentle-ai.review-integration.projection/v1" as const,
		kind: "current-changes" as const,
		projection: "workspace" as const,
		baseTree: tree,
		initialReviewTree: tree,
		currentCandidateTree: tree,
		pathsDigest: sha,
		paths: ["app.ts"],
		intendedUntracked: [],
		intendedUntrackedProof: sha,
		initialSnapshotIdentity: sha,
		currentSnapshotIdentity: sha,
	};
	const raw: Record<string, unknown> = {
		schema: "gentle-ai.review-integration.status/v1",
		contract: "gentle-ai.review-integration/v1",
		operation: "review.status",
		applicability,
		receipt: { status: applicability === "current_target" ? "expected_missing" : "not_applicable" },
		action,
		replayability: "not_replayable",
		target_identity: sha,
		projection: {
			schema: projection.schema,
			kind: projection.kind,
			projection: projection.projection,
			base_tree: tree,
			initial_review_tree: tree,
			current_candidate_tree: tree,
			paths_digest: sha,
			paths: projection.paths,
			intended_untracked: [],
			intended_untracked_proof: sha,
			initial_snapshot_identity: sha,
			current_snapshot_identity: sha,
		},
		candidates: [],
	};
	if (applicability === "current_target") {
		raw.authority = { version: "compact-v2", lineage_id: lineageId, state: "reviewing", generation: 1, revision: sha };
		raw.frozen = { tier: "medium", original_changed_lines: 2, correction_budget: 1 };
	}
	return {
		contract: "gentle-ai.review-integration/v1",
		applicability,
		...(applicability === "current_target" ? { authority: { version: "compact-v2" as const, lineageId, state: "reviewing", generation: 1, revision: sha } } : {}),
		receipt: { status: applicability === "current_target" ? "expected_missing" : "not_applicable" },
		action,
		replayability: "not_replayable",
		...(applicability === "current_target" ? { frozen: { tier: "medium" as const, originalChangedLines: 2, correctionBudget: 1 } } : {}),
		targetIdentity: sha,
		projection,
		candidates: [],
		raw,
	};
}

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
	const startCwds: string[] = [];
	const { controller, toolCall } = runtime(fakeNative({
		start: async (request) => {
			startCwds.push(request.cwd);
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
	assert.deepEqual(startCwds, [view.root]);
	assert.equal(readFileSync(join(view.root, "app.ts"), "utf8"), "export const value = 2; // worktree candidate\n");
	assert.equal(view.paths.includes("unrelated.ts"), false);
	const dispatch = { agent: "review-reliability", task: "review the change", mode: "task" };
	assert.equal(await toolCall({ toolName: "subagent_run", input: dispatch }, context(sessionCwd)), undefined);
	assert.match(dispatch.task, /Controller-owned review lineage: `worktree-lineage`/);
	assert.ok(dispatch.task.includes(view.root));
	assert.ok(dispatch.task.includes(view.candidateTree));
	candidateViews.cleanup(view.token);
});

test("absent workspaceRoot keeps the session-cwd flow and still reports the actor binding envelope", async (t) => {
	const sessionCwd = repository(t);
	writeFileSync(join(sessionCwd, "app.ts"), "export const value = 3;\n");
	const candidateViews = new CandidateViewRegistry();
	const { controller } = runtime(fakeNative({
		start: async () => ({ lineageId: "session-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true }),
	}), candidateViews);
	const started = await controller.execute("start-session", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(sessionCwd));
	const details = started.details as {
		workspace_root: string;
		actor_binding: { workspace_root: string; candidate_root: string; candidate_paths: readonly string[] };
	};
	assert.equal(details.workspace_root, sessionCwd);
	assert.equal(details.actor_binding.workspace_root, sessionCwd);
	assert.deepEqual(details.actor_binding.candidate_paths, ["app.ts"]);
	const view = candidateViews.resolveForLens("session-lineage", "review-reliability");
	assert.equal(details.actor_binding.candidate_root, view.root);
	candidateViews.cleanup(view.token);
});

test("workspaceRoot fails closed before any native call for non-worktree and foreign targets", async (t) => {
	const sessionCwd = repository(t);
	const worktree = addWorktree(t, sessionCwd, "feat-guard");
	const foreign = repository(t, "gentle-pi-foreign-root-");
	const nonGit = mkdtempSync(join(tmpdir(), "gentle-pi-non-git-"));
	t.after(() => rmSync(nonGit, { recursive: true, force: true }));
	const nested = join(worktree, "nested");
	mkdirSync(nested);
	const filePath = join(worktree, "app.ts");
	let nativeCalls = 0;
	const counting = fakeNative({
		start: async () => { nativeCalls += 1; throw new Error("native start must not run"); },
		targetStatus: async () => { nativeCalls += 1; throw new Error("native status must not run"); },
		reviewStatus: async () => { nativeCalls += 1; throw new Error("native review status must not run"); },
	});
	const { controller } = runtime(counting);
	const rejected: Array<{ label: string; workspaceRoot: string; ctx: string }> = [
		{ label: "non-git directory", workspaceRoot: nonGit, ctx: sessionCwd },
		{ label: "missing directory", workspaceRoot: join(nonGit, "missing"), ctx: sessionCwd },
		{ label: "file path", workspaceRoot: filePath, ctx: sessionCwd },
		{ label: "relative path", workspaceRoot: "relative/worktree", ctx: sessionCwd },
		{ label: "worktree subdirectory", workspaceRoot: nested, ctx: sessionCwd },
		{ label: "foreign repository", workspaceRoot: foreign, ctx: sessionCwd },
		{ label: "session outside a repository", workspaceRoot: worktree, ctx: nonGit },
	];
	for (const { label, workspaceRoot, ctx } of rejected) {
		for (const operation of ["inspect", "start", "status"] as const) {
			await assert.rejects(
				controller.execute(`${operation}-${label}`, {
					operation,
					...(operation === "start" ? { input: JSON.stringify({ mode: "ordinary" }) } : {}),
					...(operation === "status" ? { lineageId: "native-lineage" } : {}),
					workspaceRoot,
				}, undefined, undefined, context(ctx)),
				/workspaceRoot/,
				`${operation} must fail closed for ${label}`,
			);
		}
	}
	assert.equal(nativeCalls, 0);
});

test("workspaceRoot rejection reports both roots for a shared-common-dir mismatch", async (t) => {
	const sessionCwd = repository(t);
	const foreign = repository(t, "gentle-pi-foreign-report-");
	const { controller } = runtime(fakeNative());
	await assert.rejects(
		controller.execute("inspect-foreign", { operation: "inspect", workspaceRoot: foreign }, undefined, undefined, context(sessionCwd)),
		(error: Error) => {
			assert.match(error.message, /workspaceRoot/);
			assert.ok(error.message.includes(realpathSync(foreign)));
			assert.ok(error.message.includes(sessionCwd));
			return true;
		},
	);
});

test("FINALIZE fails closed when the frozen projection belongs to a different workspace than requested", async (t) => {
	const sessionCwd = repository(t);
	const worktree = addWorktree(t, sessionCwd, "feat-finalize");
	writeFileSync(join(worktree, "app.ts"), "export const value = 4;\n");
	const candidateViews = new CandidateViewRegistry();
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		start: async () => ({ lineageId: "finalize-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true }),
		finalize: async () => {
			finalizes += 1;
			return { lineageId: "finalize-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}), candidateViews);
	await controller.execute("start-finalize-b", { operation: "start", workspaceRoot: worktree, input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(sessionCwd));
	const input = JSON.stringify({ review_result: { lens_results: [{ lens: "review-reliability", findings: [], evidence: ["reviewed frozen candidate"] }] } });
	const mismatch = await controller.execute("finalize-wrong-root", { operation: "finalize", lineageId: "finalize-lineage", input }, undefined, undefined, context(sessionCwd));
	assert.equal((mismatch.details as { outcome?: string }).outcome, "native-operation-failed");
	assert.equal(finalizes, 0);
	const matched = await controller.execute("finalize-right-root", { operation: "finalize", lineageId: "finalize-lineage", workspaceRoot: worktree, input }, undefined, undefined, context(sessionCwd));
	assert.equal((matched.details as { result?: { state?: string } }).result?.state, "approved");
	assert.equal(finalizes, 1);
});
