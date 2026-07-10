import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import gentleAi from "../extensions/gentle-ai.ts";
import {
	REVIEW_MODE,
	REVIEW_TRANSITION,
	ReviewTransactionStore,
	createReviewState,
	setReleaseGhCommandRunnerForTestingV1,
	setReviewMutationLockPlatformForTesting,
	type ReviewBudgetV1,
} from "../lib/review-transaction.ts";
import { ordinaryValidatorRequest } from "../lib/review-policy-ordinary.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import { qualifiedReviewLockPlatform, testSnapshot } from "./review-test-fixtures.ts";

setReviewMutationLockPlatformForTesting(qualifiedReviewLockPlatform());
// The release fast path independently derives required CI success via the
// gh CLI; these controller-level fixtures are local bare clones with no real
// GitHub remote, so a deterministic stub stands in for `gh` in tests.
setReleaseGhCommandRunnerForTestingV1(() => ({ status: 0, stdout: "success" }));

interface ReviewToolResult {
	content: Array<{ type: string; text: string }>;
	details?: unknown;
}

interface RegisteredReviewTool {
	name: string;
	parameters: unknown;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	) => Promise<ReviewToolResult>;
}

type ToolCallHandler = (
	event: { toolName: string; input: unknown },
	ctx: ExtensionContext,
) => Promise<ToolCallEventResult | undefined>;

interface RuntimeRegistration {
	controller: RegisteredReviewTool;
	toolCall: ToolCallHandler;
}

interface RepositoryFixture {
	parent: string;
	repository: string;
	baseCommit: string;
	baseTree: string;
	finalCommit?: string;
	finalTree?: string;
	tagObject?: string;
}

function budget(): ReviewBudgetV1 {
	return {
		review_batches: 1,
		review_actors: 1,
		refuter_batches: 1,
		fix_batches: 1,
		validator_runs: 1,
		final_verifications: 1,
		judgment_rounds: 0,
		judge_runs: 0,
	};
}

function registerRuntime(): RuntimeRegistration {
	const handlers = new Map<string, ToolCallHandler>();
	const tools = new Map<string, RegisteredReviewTool>();
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		registerTool(definition: RegisteredReviewTool) {
			tools.set(definition.name, definition);
		},
		registerCommand() {},
	} as unknown as ExtensionAPI;
	gentleAi(pi);
	const controller = tools.get("gentle_review");
	const toolCall = handlers.get("tool_call");
	assert.ok(controller, "the supported review controller tool must be registered");
	assert.ok(toolCall, "the lifecycle gate hook must be registered");
	return { controller, toolCall };
}

function extensionContext(repository: string, confirmDangerous = false): ExtensionContext {
	return {
		cwd: repository,
		hasUI: confirmDangerous,
		ui: {
			confirm: async () => true,
		},
	} as unknown as ExtensionContext;
}

function git(repository: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd: repository,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function createRepository(t: test.TestContext, commitFinal: boolean): RepositoryFixture {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-review-controller-"));
	const repository = join(parent, "repo");
	mkdirSync(repository);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	git(repository, "init", "-b", "main");
	writeFileSync(join(repository, "app.ts"), "export const value = 1;\n");
	git(repository, "add", ".");
	git(
		repository,
		"-c",
		"user.name=Review Controller",
		"-c",
		"user.email=review-controller@example.invalid",
		"commit",
		"-m",
		"base",
	);
	const baseCommit = git(repository, "rev-parse", "HEAD");
	const baseTree = git(repository, "rev-parse", "HEAD^{tree}");
	git(repository, "branch", "base", baseCommit);
	writeFileSync(join(repository, "app.ts"), "export const value = 2;\n");
	if (!commitFinal) return { parent, repository, baseCommit, baseTree };
	git(repository, "add", ".");
	git(
		repository,
		"-c",
		"user.name=Review Controller",
		"-c",
		"user.email=review-controller@example.invalid",
		"commit",
		"-m",
		"final",
	);
	const finalCommit = git(repository, "rev-parse", "HEAD");
	const finalTree = git(repository, "rev-parse", "HEAD^{tree}");
	git(repository, "branch", "final", finalCommit);
	git(
		repository,
		"-c",
		"user.name=Review Controller",
		"-c",
		"user.email=review-controller@example.invalid",
		"tag",
		"-a",
		"v1.2.3",
		"-m",
		"release",
		finalCommit,
	);
	const tagObject = git(repository, "rev-parse", "refs/tags/v1.2.3^{object}");
	return {
		parent,
		repository,
		baseCommit,
		baseTree,
		finalCommit,
		finalTree,
		tagObject,
	};
}

function details(result: ReviewToolResult): Record<string, unknown> {
	assert.ok(result.details && typeof result.details === "object");
	return result.details as Record<string, unknown>;
}

async function controllerCall(
	controller: RegisteredReviewTool,
	ctx: ExtensionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	return details(await controller.execute("review-tool-call", params, undefined, undefined, ctx));
}

async function approveTrackedWorktreeTransaction(
	controller: RegisteredReviewTool,
	ctx: ExtensionContext,
	lineageId: string,
): Promise<void> {
	const start = await controllerCall(controller, ctx, {
		operation: "start",
		lineageId,
		idempotencyKey: `${lineageId}-start`,
		input: JSON.stringify({
			mode: REVIEW_MODE.ORDINARY,
			projection: { kind: "complete" },
			policyHash: "a".repeat(64),
			evidenceHash: "b".repeat(64),
			budget: budget(),
		}),
	});
	assert.equal(start.operation, "start");
	for (const [transition, input, suffix] of [
		[REVIEW_TRANSITION.ORDINARY_DISCOVERY, { rows: [] }, "discovery"],
		[REVIEW_TRANSITION.ORDINARY_EVIDENCE, { deterministicResults: [] }, "evidence"],
		[REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION, { passed: true }, "verify"],
	] as const) {
		const advanced = await controllerCall(controller, ctx, {
			operation: "advance",
			lineageId,
			idempotencyKey: `${lineageId}-${suffix}`,
			transition,
			input: JSON.stringify(input),
		});
		assert.equal(advanced.operation, "advance");
	}
	const status = await controllerCall(controller, ctx, {
		operation: "status",
		lineageId,
	});
	const state = status.state as Record<string, unknown>;
	assert.equal(state.terminal_state, "approved");
	assert.equal(typeof status.receipt, "object");
}

function createTerminalAuthority(fixture: RepositoryFixture, lineageId: string): void {
	assert.ok(fixture.finalTree);
	const store = ReviewTransactionStore.forRepository(fixture.repository, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	store.create(
		createReviewState({
			lineageId,
			mode: REVIEW_MODE.ORDINARY,
			snapshot: testSnapshot({
				baseTree: fixture.baseTree,
				completeTree: fixture.finalTree,
				route: REVIEW_ROUTE.STANDARD,
				lenses: [REVIEW_LENS.READABILITY],
			}),
			evidenceHash: "c".repeat(64),
			budget: budget(),
		}),
		`${lineageId}-start`,
	);
	for (const [transition, input, suffix] of [
		[REVIEW_TRANSITION.ORDINARY_DISCOVERY, { rows: [] }, "discovery"],
		[REVIEW_TRANSITION.ORDINARY_EVIDENCE, { deterministicResults: [] }, "evidence"],
		[REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION, { passed: true }, "verify"],
	] as const) {
		store.runReducerOperation({
			lineageId,
			transition,
			idempotencyKey: `${lineageId}-${suffix}`,
			input,
		});
	}
}

test("controller advances an ordinary validator request from a repository file and rejects altered or escaped input", async (t) => {
	const fixture = createRepository(t, false);
	const lineageId = "controller-file-validator";
	const store = ReviewTransactionStore.forRepository(fixture.repository, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	store.create(createReviewState({
		lineageId,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({
			baseTree: fixture.baseTree,
			completeTree: fixture.baseTree,
			route: REVIEW_ROUTE.STANDARD,
			lenses: [REVIEW_LENS.RISK],
		}),
		evidenceHash: "c".repeat(64),
		budget: budget(),
	}), "start");
	store.runReducerOperation({
		lineageId,
		transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		idempotencyKey: "freeze",
		input: { rows: [{
			id: "RISK-001",
			lens: REVIEW_LENS.RISK,
			location: "src/auth.ts:10",
			severity: "BLOCKER",
			status_at_freeze: "open",
			evidence_class: "deterministic",
			evidence_claim: "The access check is absent on the protected branch.",
		}] },
	});
	store.runReducerOperation({
		lineageId,
		transition: REVIEW_TRANSITION.ORDINARY_EVIDENCE,
		idempotencyKey: "evidence",
		input: { deterministicResults: [{ id: "RISK-001", outcome: "corroborated" }] },
	});
	store.runReducerOperation({
		lineageId,
		transition: REVIEW_TRANSITION.ORDINARY_FIX,
		idempotencyKey: "fix",
		input: { candidateTree: "d".repeat(40), fixedIds: ["RISK-001"], fixDiff: "diff --git a/src/auth.ts b/src/auth.ts\n", changedPaths: ["src/auth.ts"] },
	});
	const validatorInput = JSON.stringify({
		request: ordinaryValidatorRequest(store.read(lineageId), {
			originalAcceptanceTests: { passed: true, evidenceHash: "a".repeat(64) },
			correctionRegressions: [{ findingId: "RISK-001", evidenceHash: "b".repeat(64), passed: true }],
			originalCriterionRegressions: [],
			followUps: [],
		}),
		results: [{ id: "RISK-001", outcome: "verified" }],
	});
	const inputPath = join(fixture.repository, "validator-input.json");
	writeFileSync(inputPath, validatorInput);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);

	writeFileSync(inputPath, JSON.stringify({ request: {}, results: [] }));
	await assert.rejects(
		controller.execute("modified-validator-input", { operation: "advance", lineageId, idempotencyKey: "modified", transition: REVIEW_TRANSITION.ORDINARY_VALIDATION, inputPath }, undefined, undefined, ctx),
		/validator request.*exact frozen scope/i,
	);
	await assert.rejects(
		controller.execute("escaped-validator-input", { operation: "advance", lineageId, idempotencyKey: "escaped", transition: REVIEW_TRANSITION.ORDINARY_VALIDATION, inputPath: join(fixture.parent, "escaped.json") }, undefined, undefined, ctx),
		/repository/i,
	);
	await assert.rejects(
		controller.execute("ambiguous-validator-input", { operation: "advance", lineageId, idempotencyKey: "ambiguous", transition: REVIEW_TRANSITION.ORDINARY_VALIDATION, input: validatorInput, inputPath }, undefined, undefined, ctx),
		/exactly one/i,
	);
	const symlinkPath = join(fixture.repository, "validator-input-link.json");
	symlinkSync(inputPath, symlinkPath);
	await assert.rejects(
		controller.execute("symlink-validator-input", { operation: "advance", lineageId, idempotencyKey: "symlink", transition: REVIEW_TRANSITION.ORDINARY_VALIDATION, inputPath: symlinkPath }, undefined, undefined, ctx),
		/regular non-symlink/i,
	);

	writeFileSync(inputPath, validatorInput);
	const advanced = await controllerCall(controller, ctx, {
		operation: "advance",
		lineageId,
		idempotencyKey: "validate",
		transition: REVIEW_TRANSITION.ORDINARY_VALIDATION,
		inputPath,
	});
	assert.equal((advanced.state as Record<string, unknown>).phase, "final-verification");
});

test("controller rejects a manually supplied correction that lacks Git-derived scope evidence", async (t) => {
	const fixture = createRepository(t, false);
	const lineageId = "controller-correction-evidence";
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	await controllerCall(controller, ctx, {
		operation: "start", lineageId, idempotencyKey: "start",
		input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	await controllerCall(controller, ctx, {
		operation: "advance", lineageId, idempotencyKey: "discover", transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		input: JSON.stringify({ rows: [{ id: "READ-001", lens: REVIEW_LENS.READABILITY, location: "app.ts:1", severity: "BLOCKER", status_at_freeze: "open", evidence_class: "deterministic", evidence_claim: "missing check" }] }),
	});
	await controllerCall(controller, ctx, {
		operation: "advance", lineageId, idempotencyKey: "evidence", transition: REVIEW_TRANSITION.ORDINARY_EVIDENCE,
		input: JSON.stringify({ deterministicResults: [{ id: "READ-001", outcome: "corroborated" }] }),
	});
	await assert.rejects(
		controller.execute("unbound-fix", { operation: "advance", lineageId, idempotencyKey: "fix", transition: REVIEW_TRANSITION.ORDINARY_FIX, input: JSON.stringify({ candidateTree: "d".repeat(40), fixedIds: ["READ-001"], fixDiff: "manual" }) }, undefined, undefined, ctx),
		/Git-derived correction evidence/i,
	);
});

test("controller inspect reports lock state and recover never force-steals an absent lock", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.deepEqual(inspected.lock, { status: "absent" });
	await assert.rejects(
		controller.execute("recover-absent", { operation: "recover-lock", input: JSON.stringify({ ownerHash: "a".repeat(64) }) }, undefined, undefined, ctx),
		/absent|ambiguous/i,
	);
	await assert.rejects(
		controller.execute("recover-reset-requires-confirmation", { operation: "recover", input: JSON.stringify({ ownerHash: "a".repeat(64) }) }, undefined, undefined, ctx),
		/confirmation|reset/i,
	);
});

test("registered controller creates, advances, reports, and authorizes an exact all-tracked commit once", async (t) => {
	const fixture = createRepository(t, false);
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	await approveTrackedWorktreeTransaction(controller, ctx, "controller-lifecycle");

	const command = "git commit -am bounded";
	const validated = await controllerCall(controller, ctx, {
		operation: "validate",
		lineageId: "controller-lifecycle",
		idempotencyKey: "controller-lifecycle-gate",
		command,
		input: JSON.stringify({ scopeBudget: budget() }),
	});
	const result = validated.result as Record<string, unknown>;
	assert.equal(result.status, "allow", JSON.stringify(validated));
	assert.equal(result.actor_count, 0);
	assert.equal(typeof validated.authorization, "object");
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, ctx), undefined);

	const replay = await toolCall({ toolName: "bash", input: { command } }, ctx);
	assert.equal(replay?.block, true);
	assert.match(replay?.reason ?? "", /registered review controller authorization/i);

	const splitAllCommand = "git commit -a -m bounded";
	const splitAllValidated = await controllerCall(controller, ctx, {
		operation: "validate",
		lineageId: "controller-lifecycle",
		idempotencyKey: "controller-lifecycle-gate-split-all",
		command: splitAllCommand,
		input: JSON.stringify({ scopeBudget: budget() }),
	});
	assert.equal(
		(splitAllValidated.result as Record<string, unknown>).status,
		"allow",
		JSON.stringify(splitAllValidated),
	);
	assert.equal(
		await toolCall({ toolName: "bash", input: { command: splitAllCommand } }, ctx),
		undefined,
	);

	const fabricated = await toolCall(
		{
			toolName: "bash",
			input: {
				command: "git commit -m bounded",
				reviewGate: {
					target: { kind: "intended-commit", intended_commit_tree: result.target_hash },
				},
			},
		},
		ctx,
	);
	assert.equal(fabricated?.block, true);
	assert.match(fabricated?.reason ?? "", /registered review controller authorization/i);
});

test("controller binds push, PR, and release authorization to exact command arguments", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit && fixture.finalTree && fixture.tagObject);
	const remotePath = join(fixture.parent, "remote.git");
	execFileSync("git", ["clone", "--bare", fixture.repository, remotePath], {
		cwd: fixture.parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/heads/main", fixture.baseCommit]);
	git(fixture.repository, "remote", "add", "origin", remotePath);
	createTerminalAuthority(fixture, "controller-targets");
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);

	for (const [command, key] of [
		["git push origin main:main", "push"],
		["gh pr create --base base --head final", "pr"],
		["gh release create v1.2.3 --notes bounded", "release"],
	] as const) {
		const validated = await controllerCall(controller, ctx, {
			operation: "validate",
			lineageId: "controller-targets",
			idempotencyKey: `controller-targets-${key}`,
			command,
			input: JSON.stringify({ scopeBudget: budget() }),
		});
		assert.equal((validated.result as Record<string, unknown>).status, "allow", command);
		assert.equal(await toolCall({ toolName: "bash", input: { command } }, ctx), undefined, command);
	}

	for (const command of [
		"git push --all origin",
		"git push origin main:main final:feature",
		"git push --follow-tags origin main:main",
		"git push origin --follow-tags main:main",
		"git push origin main:main --follow-tags",
	]) {
		await assert.rejects(
			controller.execute(
				"unsupported-push",
				{
					operation: "validate",
					lineageId: "controller-targets",
					idempotencyKey: `unsupported-${command.length}`,
					command,
					input: JSON.stringify({ scopeBudget: budget() }),
				},
				undefined,
				undefined,
				ctx,
			),
			/exactly derive|unsupported.*push|complete ref update/i,
		);
	}
	for (const [command, key] of [
		["env SAFE=1 git push --follow-tags origin main:main", "env"],
		["command git push origin --follow-tags main:main", "command"],
		["sh -c 'git push origin main:main --follow-tags'", "shell"],
	] as const) {
		await assert.rejects(
			controller.execute(
				"unsupported-wrapped-follow-tags-push",
				{
					operation: "validate",
					lineageId: "controller-targets",
					idempotencyKey: `unsupported-wrapped-follow-tags-push-${key}`,
					command,
					input: JSON.stringify({ scopeBudget: budget() }),
				},
				undefined,
				undefined,
				ctx,
			),
			/compound or wrapped lifecycle command.*fail closed/i,
		);
	}
	for (const [command, key] of [
		["gh release create v1.2.3 --repo other/project", "long"],
		["gh release create v1.2.3 -Rother/project", "short"],
	] as const) {
		await assert.rejects(
			controller.execute(
				"unsupported-release-repository",
				{
					operation: "validate",
					lineageId: "controller-targets",
					idempotencyKey: `unsupported-release-repository-${key}`,
					command,
					input: JSON.stringify({ scopeBudget: budget() }),
				},
				undefined,
				undefined,
				ctx,
			),
			/exact local review repository|--repo/i,
		);
	}

	await controllerCall(controller, ctx, {
		operation: "validate",
		lineageId: "controller-targets",
		idempotencyKey: "controller-targets-release-mismatch",
		command: "gh release create v1.2.3",
		input: JSON.stringify({ scopeBudget: budget() }),
	});
	git(
		fixture.repository,
		"-c",
		"user.name=Review Controller",
		"-c",
		"user.email=review-controller@example.invalid",
		"tag",
		"-a",
		"v9.9.9",
		"-m",
		"different release argument",
		fixture.finalCommit,
	);
	const mismatchedRelease = await toolCall(
		{
			toolName: "bash",
			input: {
				command: "gh release create v9.9.9",
				reviewGate: {
					target: {
						kind: "release",
						tag_ref: "refs/tags/v1.2.3",
						tag_object: fixture.tagObject,
						peeled_commit: fixture.finalCommit,
						tree: fixture.finalTree,
					},
				},
			},
		},
		ctx,
	);
	assert.equal(mismatchedRelease?.block, true);
	assert.match(mismatchedRelease?.reason ?? "", /registered review controller authorization/i);
});

test("controller release fast path bypasses receipt validation only for the proven immutable origin/main SHA", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit && fixture.finalTree && fixture.tagObject);
	const remotePath = join(fixture.parent, "remote.git");
	execFileSync("git", ["clone", "--bare", fixture.repository, remotePath], {
		cwd: fixture.parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/heads/main", fixture.finalCommit]);
	git(fixture.repository, "remote", "add", "origin", remotePath);
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	// Local publication inputs must be irrelevant: dirty worktree during validation.
	writeFileSync(join(fixture.repository, "app.ts"), "export const value = 3; // dirty worktree\n");
	const releaseEvidence = {
		protected_ref: "refs/heads/main",
		remote: "origin",
		ci: { revision: fixture.finalCommit, status: "success" },
		external_evidence: "none",
		post_incident: false,
	};

	const command = "gh release create v1.2.3 --notes bounded";
	const validated = await controllerCall(controller, ctx, {
		operation: "validate",
		idempotencyKey: "release-fast-path",
		command,
		input: JSON.stringify({ scopeBudget: budget(), release: releaseEvidence }),
	});
	const result = validated.result as Record<string, unknown>;
	assert.equal(result.status, "allow", JSON.stringify(validated));
	assert.equal(result.actor_count, 0);
	const fastPath = validated.release_fast_path as Record<string, unknown>;
	assert.equal(fastPath.eligible, true);
	assert.equal(fastPath.remote_head, fixture.finalCommit);
	assert.equal(typeof validated.authorization, "object");
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, ctx), undefined);

	const revalidated = await controllerCall(controller, ctx, {
		operation: "validate",
		idempotencyKey: "release-fast-path-recheck",
		command,
		input: JSON.stringify({ scopeBudget: budget(), release: releaseEvidence }),
	});
	assert.equal((revalidated.result as Record<string, unknown>).status, "allow");
	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/heads/main", fixture.baseCommit]);
	const advanced = await toolCall({ toolName: "bash", input: { command } }, ctx);
	assert.equal(advanced?.block, true);
	assert.match(advanced?.reason ?? "", /advanced|re-proven/i);
});

test("failed or unprovable release fast-path conditions fall back to native receipt validation and fail closed", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit && fixture.finalTree);
	const remotePath = join(fixture.parent, "remote.git");
	execFileSync("git", ["clone", "--bare", fixture.repository, remotePath], {
		cwd: fixture.parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/heads/main", fixture.finalCommit]);
	git(fixture.repository, "remote", "add", "origin", remotePath);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);

	for (const [key, release] of [
		["failed-ci", { protected_ref: "refs/heads/main", remote: "origin", ci: { revision: fixture.finalCommit, status: "failure" }, external_evidence: "none", post_incident: false }],
		["post-incident", { protected_ref: "refs/heads/main", remote: "origin", ci: { revision: fixture.finalCommit, status: "success" }, external_evidence: "none", post_incident: true }],
		["escalating-evidence", { protected_ref: "refs/heads/main", remote: "origin", ci: { revision: fixture.finalCommit, status: "success" }, external_evidence: "escalating", post_incident: false }],
	] as const) {
		await assert.rejects(
			controller.execute(
				"release-fast-path-fallback",
				{
					operation: "validate",
					idempotencyKey: `release-fast-path-fallback-${key}`,
					command: "gh release create v1.2.3 --notes bounded",
					input: JSON.stringify({ scopeBudget: budget(), release }),
				},
				undefined,
				undefined,
				ctx,
			),
			/lineageId/i,
			key,
		);
	}

	await assert.rejects(
		controller.execute(
			"release-evidence-wrong-event",
			{
				operation: "validate",
				lineageId: "controller-fast-path-wrong-event",
				idempotencyKey: "release-evidence-wrong-event",
				command: "git commit -am bounded",
				input: JSON.stringify({
					scopeBudget: budget(),
					release: { protected_ref: "refs/heads/main", remote: "origin", ci: { revision: fixture.finalCommit, status: "success" }, external_evidence: "none", post_incident: false },
				}),
			},
			undefined,
			undefined,
			ctx,
		),
		/pre-release/i,
	);

	const receiptFallback = await (async () => {
		createTerminalAuthority(fixture, "controller-fast-path-fallback");
		return controllerCall(controller, ctx, {
			operation: "validate",
			lineageId: "controller-fast-path-fallback",
			idempotencyKey: "release-fast-path-receipt-fallback",
			command: "gh release create v1.2.3 --notes bounded",
			input: JSON.stringify({
				scopeBudget: budget(),
				release: { protected_ref: "refs/heads/main", remote: "origin", ci: { revision: fixture.finalCommit, status: "failure" }, external_evidence: "none", post_incident: false },
			}),
		});
	})();
	assert.equal((receiptFallback.result as Record<string, unknown>).status, "allow");
	const fallbackFastPath = receiptFallback.release_fast_path as Record<string, unknown>;
	assert.equal(fallbackFastPath.eligible, false);
	assert.match(String(fallbackFastPath.reason), /required CI/i);
});
