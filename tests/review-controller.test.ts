import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
import { domainHashV1 } from "../lib/review-canonical.ts";
import { destructiveResetReviewAuthorityV1 } from "../lib/review-reset.ts";
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
	description: string;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
	parameters: unknown;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	) => Promise<ReviewToolResult>;
}

function createLegacyReviewAuthority(repository: string): void {
	mkdirSync(join(repository, ".git", "gentle-ai", "reviews", "lineages", "legacy", "revisions"), { recursive: true });
	writeFileSync(join(repository, ".git", "gentle-ai", "reviews", "lineages", "legacy", "HEAD"), "legacy authority");
}

function rewriteResetState(
	repository: string,
	mutate: (body: Record<string, unknown>) => void,
): string {
	const path = join(repository, ".git", "gentle-ai", "reviews", "control", "reset-state.json");
	const envelope = JSON.parse(readFileSync(path, "utf8")) as {
		body: Record<string, unknown>;
		reset_state_hash: string;
	};
	mutate(envelope.body);
	envelope.reset_state_hash = domainHashV1("reset-state", envelope.body);
	const serialized = JSON.stringify(envelope);
	writeFileSync(path, serialized);
	return serialized;
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

function extensionContext(
	repository: string,
	hasUI = false,
	confirm: (title: string, message: string) => Promise<boolean> = async () => true,
): ExtensionContext {
	return {
		cwd: repository,
		hasUI,
		ui: {
			confirm,
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
		/exact string|confirmation|reset/i,
	);
});

test("controller routes legacy authority through explicit reset, verifies clean, and starts ordinary review", async (t) => {
	const fixture = createRepository(t, false);
	createLegacyReviewAuthority(fixture.repository);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);

	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	const blockedInspection = inspected.inspection as Record<string, unknown>;
	assert.equal(blockedInspection.outcome, "blocked-legacy");
	assert.equal(inspected.status, "blocked");
	assert.equal(inspected.next_action, "request-explicit-reset-authorization");

	const blockedStart = await controllerCall(controller, ctx, {
		operation: "start",
		lineageId: "blocked-before-reset",
		idempotencyKey: "blocked-before-reset-start",
		input: JSON.stringify({ mode: "ordinary", projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	assert.equal(blockedStart.status, "blocked");
	assert.equal(blockedStart.lineage_created, false);
	assert.equal(blockedStart.next_action, "request-explicit-reset-authorization");
	assert.equal((blockedStart.inspection as Record<string, unknown>).outcome, "blocked-legacy");

	const resetRequest = blockedInspection.reset_request as Record<string, unknown>;
	await assert.rejects(
		controller.execute("unauthorized-reset", { operation: "reset", input: JSON.stringify(resetRequest) }, undefined, undefined, ctx),
		/interactive Pi UI.*fails closed/i,
	);
	const stillBlocked = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal((stillBlocked.inspection as Record<string, unknown>).outcome, "blocked-legacy");
	assert.deepEqual((stillBlocked.inspection as Record<string, unknown>).reset_request, resetRequest);
	await assert.rejects(
		controller.execute("rejected-reset", { operation: "reset", input: JSON.stringify(resetRequest) }, undefined, undefined, extensionContext(fixture.repository, true, async () => false)),
		/not explicitly authorized/i,
	);
	const stillBlockedAfterRejection = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.deepEqual(stillBlockedAfterRejection.inspection, stillBlocked.inspection);

	const confirmations: Array<{ title: string; message: string }> = [];
	const authorizedCtx = extensionContext(fixture.repository, true, async (title, message) => {
		confirmations.push({ title, message });
		return true;
	});
	const reset = await controllerCall(controller, authorizedCtx, {
		operation: "reset",
		input: JSON.stringify(resetRequest),
	});
	assert.equal(confirmations.length, 1);
	assert.match(confirmations[0]?.title ?? "", /RESET/);
	assert.match(confirmations[0]?.message ?? "", new RegExp(String(resetRequest.confirmation).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.equal((reset.inspection as Record<string, unknown>).outcome, "clean");
	assert.equal(reset.next_action, "start-fresh-ordinary-review-after-verified-clean");

	const clean = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal((clean.inspection as Record<string, unknown>).outcome, "clean");
	assert.equal(clean.status, "ready");

	const started = await controllerCall(controller, ctx, {
		operation: "start",
		lineageId: "ordinary-after-reset",
		idempotencyKey: "ordinary-after-reset-start",
		input: JSON.stringify({ mode: "ordinary", projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	assert.equal(started.operation, "start");
	assert.equal((started.state as Record<string, unknown>).mode, "ordinary");
});

test("controller rejects altered destructive reset bindings without authority mutation", async (t) => {
	const fixture = createRepository(t, false);
	createLegacyReviewAuthority(fixture.repository);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	const original = (inspected.inspection as Record<string, unknown>).reset_request as Record<string, unknown>;

	for (const altered of [
		{ ...original, confirmation: `${String(original.confirmation)} altered` },
		{ ...original, inventoryHash: "0".repeat(64) },
	]) {
		await assert.rejects(
			controller.execute("altered-reset", { operation: "reset", input: JSON.stringify(altered) }, undefined, undefined, ctx),
			/exactly match/i,
		);
		const unchanged = await controllerCall(controller, ctx, { operation: "inspect" });
		assert.equal((unchanged.inspection as Record<string, unknown>).outcome, "blocked-legacy");
		assert.deepEqual((unchanged.inspection as Record<string, unknown>).reset_request, original);
		assert.equal(existsSync(join(fixture.repository, ".git", "gentle-ai", "reviews", "control", "reset-state.json")), false);
	}
});

test("controller INSPECT preserves the durable recovery request after interrupted RESET changes inventory", async (t) => {
	const fixture = createRepository(t, false);
	createLegacyReviewAuthority(fixture.repository);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	const original = (inspected.inspection as Record<string, unknown>).reset_request as Record<string, unknown>;

	assert.throws(
		() => destructiveResetReviewAuthorityV1({
			cwd: fixture.repository,
			repositoryId: String(original.repositoryId),
			commonDirHash: String(original.commonDirHash),
			inventoryHash: String(original.inventoryHash),
			confirmation: String(original.confirmation),
			faultAfterPhase: "deleting",
		}),
		/injected/i,
	);
	const interrupted = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal((interrupted.inspection as Record<string, unknown>).outcome, "reset-in-progress");
	assert.deepEqual((interrupted.inspection as Record<string, unknown>).reset_request, original);
	await assert.rejects(
		controller.execute("unauthorized-recover", { operation: "recover", input: JSON.stringify(original) }, undefined, undefined, ctx),
		/interactive Pi UI.*fails closed/i,
	);
	const stillInterrupted = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.deepEqual(stillInterrupted.inspection, interrupted.inspection);

	const recovered = await controllerCall(controller, extensionContext(fixture.repository, true), {
		operation: "recover",
		input: JSON.stringify(original),
	});
	assert.equal((recovered.inspection as Record<string, unknown>).outcome, "clean");
	assert.equal(recovered.next_action, "start-fresh-ordinary-review-after-verified-clean");
});

test("controller RECOVER rejects transplanted reset identity and common-directory hash without mutation", async (t) => {
	const source = createRepository(t, false);
	const target = createRepository(t, false);
	createLegacyReviewAuthority(source.repository);
	const { controller } = registerRuntime();
	const sourceCtx = extensionContext(source.repository);
	const sourceInspection = await controllerCall(controller, sourceCtx, { operation: "inspect" });
	const sourceRequest = (sourceInspection.inspection as Record<string, unknown>).reset_request as Record<string, unknown>;
	assert.throws(() => destructiveResetReviewAuthorityV1({
		cwd: source.repository,
		repositoryId: String(sourceRequest.repositoryId),
		commonDirHash: String(sourceRequest.commonDirHash),
		inventoryHash: String(sourceRequest.inventoryHash),
		confirmation: String(sourceRequest.confirmation),
		faultAfterPhase: "deleting",
	}), /injected/i);
	const sourceState = readFileSync(join(source.repository, ".git", "gentle-ai", "reviews", "control", "reset-state.json"), "utf8");

	const cleanTarget = await controllerCall(controller, extensionContext(target.repository), { operation: "inspect" });
	const targetRepositoryId = String((cleanTarget.inspection as Record<string, unknown>).repository_id);
	const targetControl = join(target.repository, ".git", "gentle-ai", "reviews", "control");
	mkdirSync(targetControl, { recursive: true });
	const targetStatePath = join(targetControl, "reset-state.json");
	writeFileSync(targetStatePath, sourceState);
	const sentinel = join(target.parent, "transplanted-sentinel.txt");
	writeFileSync(sentinel, "keep");

	await assert.rejects(
		controller.execute("transplanted-recovery", { operation: "recover", input: JSON.stringify(sourceRequest) }, undefined, undefined, extensionContext(target.repository, true)),
		/current repository authority|repository identity|common directory/i,
	);
	assert.equal(readFileSync(targetStatePath, "utf8"), sourceState);
	assert.equal(readFileSync(sentinel, "utf8"), "keep");
	assert.equal(existsSync(join(target.repository, ".git", "gentle-ai", "reviews", "graph-v1")), false);

	const targetInspection = await controllerCall(controller, extensionContext(target.repository), { operation: "inspect" }).catch(() => undefined);
	assert.equal(targetInspection, undefined);
	const foreignCommonHashState = rewriteResetState(target.repository, (body) => {
		body.repository_id = targetRepositoryId;
		body.common_directory_hash = "f".repeat(64);
		const confirmation = `DESTROY REVIEW AUTHORITY ${body.repository_id} AT ${body.common_directory_hash} INVENTORY ${body.authorized_inventory_hash}`;
		body.authorization_hash = domainHashV1("reset-authorization", confirmation);
	});
	await assert.rejects(
		controller.execute("transplanted-hash-recovery", { operation: "recover", input: JSON.stringify(sourceRequest) }, undefined, undefined, extensionContext(target.repository, true)),
		/current repository authority|common directory/i,
	);
	assert.equal(readFileSync(targetStatePath, "utf8"), foreignCommonHashState);
	assert.equal(readFileSync(sentinel, "utf8"), "keep");
});

test("controller RECOVER rejects malicious quarantine paths before external deletion or state mutation", async (t) => {
	const fixture = createRepository(t, false);
	createLegacyReviewAuthority(fixture.repository);
	const { controller } = registerRuntime();
	const inspected = await controllerCall(controller, extensionContext(fixture.repository), { operation: "inspect" });
	const request = (inspected.inspection as Record<string, unknown>).reset_request as Record<string, unknown>;
	assert.throws(() => destructiveResetReviewAuthorityV1({
		cwd: fixture.repository,
		repositoryId: String(request.repositoryId),
		commonDirHash: String(request.commonDirHash),
		inventoryHash: String(request.inventoryHash),
		confirmation: String(request.confirmation),
		faultAfterPhase: "deleting",
	}), /injected/i);
	const external = join(fixture.repository, ".git", "gentle-ai", "reviews", "external", "lineages");
	mkdirSync(external, { recursive: true });
	const sentinel = join(external, "sentinel");
	writeFileSync(sentinel, "keep");

	for (const quarantinePath of ["../external", "reset-quarantine/../external"]) {
		const state = rewriteResetState(fixture.repository, (body) => {
			body.quarantine_relative_path = quarantinePath;
		});
		await assert.rejects(
			controller.execute("malicious-quarantine-recovery", { operation: "recover", input: JSON.stringify(request) }, undefined, undefined, extensionContext(fixture.repository, true)),
			/quarantine|recovery path|reset state/i,
		);
		assert.equal(readFileSync(sentinel, "utf8"), "keep");
		assert.equal(readFileSync(join(fixture.repository, ".git", "gentle-ai", "reviews", "control", "reset-state.json"), "utf8"), state);
	}
});

test("controller successfully starts the explicitly supported judgment-day mode", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const started = await controllerCall(controller, extensionContext(fixture.repository), {
		operation: "start",
		lineageId: "judgment-day-start",
		idempotencyKey: "judgment-day-start-key",
		input: JSON.stringify({ mode: "judgment-day", projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	assert.equal(started.operation, "start");
	assert.equal((started.state as Record<string, unknown>).mode, "judgment-day");
});

test("failed START gives exact mode and serialization guidance and creates no lineage", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);

	await assert.rejects(
		controller.execute("unsupported-start", {
			operation: "start",
			lineageId: "unsupported-start",
			idempotencyKey: "unsupported-start-key",
			input: JSON.stringify({ mode: "standard" }),
		}, undefined, undefined, ctx),
		/only "ordinary" or "judgment-day".*JSON string.*no lineage was created.*do not call STATUS or ADVANCE/is,
	);
	await assert.rejects(
		controller.execute("nested-start-input", {
			operation: "start",
			lineageId: "nested-start-input",
			idempotencyKey: "nested-start-input-key",
			input: { mode: "ordinary" },
		}, undefined, undefined, ctx),
		/START input must be a JSON string.*no lineage was created.*do not call STATUS or ADVANCE/is,
	);
	await assert.rejects(
		controller.execute("invalid-json-start-input", {
			operation: "start",
			lineageId: "invalid-json-start-input",
			idempotencyKey: "invalid-json-start-input-key",
			input: "{not-json}",
		}, undefined, undefined, ctx),
		/START input must be a JSON string encoding an object.*no lineage was created.*do not call STATUS or ADVANCE/is,
	);
	assert.equal(existsSync(join(fixture.repository, ".git", "gentle-ai", "reviews", "graph-v1")), false);
});

test("ambiguous START output loss is recovered only by exact idempotent replay", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	const request = {
		operation: "start",
		lineageId: "ambiguous-start",
		idempotencyKey: "ambiguous-start-key",
		input: JSON.stringify({ mode: "ordinary", projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	};

	await controllerCall(controller, ctx, request); // Simulate committed authority whose response was lost.
	const replay = await controllerCall(controller, ctx, request);
	assert.deepEqual(replay.result, { lineage_id: "ambiguous-start", revision: 0, phase: "started" });
	await assert.rejects(
		controller.execute("changed-start-replay", { ...request, input: JSON.stringify({ mode: "ordinary", projection: { kind: "complete" }, policyHash: "c".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }) }, undefined, undefined, ctx),
		/idempotency key.*different.*request/i,
	);
});

test("shipped controller and orchestrator contracts specify inspect-first START without cascade", () => {
	const { controller } = registerRuntime();
	const toolContract = [
		controller.description,
		controller.promptSnippet ?? "",
		...(controller.promptGuidelines ?? []),
		JSON.stringify(controller.parameters),
	].join("\n");
	assert.match(toolContract, /operation.*start.*lineageId.*idempotencyKey.*input/is);
	assert.match(toolContract, /mode\\?":\\?"ordinary|mode.*ordinary/is);
	assert.match(toolContract, /ordinary.*judgment-day/is);
	assert.match(toolContract, /input.*JSON string/is);
	assert.match(toolContract, /blocked-legacy.*explicit.*authorization/is);
	assert.match(toolContract, /reset.*inspect.*clean.*start/is);
	assert.match(toolContract, /output.*lost|response.*lost|ambiguous.*START/is);
	assert.match(toolContract, /same lineageId.*idempotencyKey.*request/is);
	assert.doesNotMatch(toolContract, /START throws.*lineage does not exist/is);

	for (const path of ["assets/orchestrator-delegation.md", "skills/gentle-ai/SKILL.md"]) {
		const contract = readFileSync(path, "utf8");
		assert.match(contract, /INSPECT before START|inspect.*before.*start/is, path);
		assert.match(contract, /mode `ordinary`|mode.*ordinary/is, path);
		assert.match(contract, /Judgment Day.*explicit/is, path);
		assert.match(contract, /before authority access.*no lineage|pre-authority.*no lineage/is, path);
		assert.match(contract, /same `?lineageId`?.*`?idempotencyKey`?.*request/is, path);
	}
	for (const path of ["assets/orchestrator-delegation.md", "skills/gentle-ai/SKILL.md"]) {
		const recoveryContract = readFileSync(path, "utf8");
		assert.match(recoveryContract, /blocked-legacy.*explicit.*authoriz/is, path);
		assert.match(recoveryContract, /RESET.*RECOVER.*internally.*INSPECT|RESET.*RECOVER.*verified.*clean/is, path);
	}
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
