import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import gentleAi, { __testing } from "../extensions/gentle-ai.ts";
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
import { discoverCompactReview, startCompactReview } from "../lib/review-facade.ts";
import { canonicalJsonV1, domainHashV1 } from "../lib/review-canonical.ts";
import {
	inspectApprovedCompactSuccessorV1,
	inspectRecoverableGraphSourceV1,
	resolveReviewAuthorityForChange,
	SupersessionStoreV1,
} from "../lib/review-authority-supersession.ts";
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
	const state = start.state as { selected_lenses: string[] };
	const finalized = await controllerCall(controller, ctx, {
		operation: "finalize",
		lineageId,
		input: JSON.stringify({
			review_result: {
				lens_results: state.selected_lenses.map(() => ({ findings: [], evidence: [] })),
			},
			final_evidence: "controller fixture verification passed",
			final_verification_passed: true,
		}),
	});
	assert.equal((finalized.result as Record<string, unknown>).state, "approved");
	const status = await controllerCall(controller, ctx, {
		operation: "status",
		lineageId,
	});
	const terminal = status.state as Record<string, unknown>;
	assert.equal(terminal.state, "approved");
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
				genesisPaths: ["app.ts"],
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

function recoveryEvidence(
	state: ReturnType<typeof discoverCompactReview>["record"]["state"],
	receiptHash: string,
	ledgerHash: string,
) {
	return {
		base_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.base_tree),
		complete_snapshot_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.complete_snapshot_tree),
		initial_review_tree: domainHashV1("review-recovery-tree", state.initial_snapshot.initial_review_tree),
		final_candidate_tree: domainHashV1("review-recovery-tree", state.current_candidate_tree),
		review_projection_hash: domainHashV1("review-recovery-projection", state.initial_snapshot.review_projection),
		genesis_paths_hash: domainHashV1("compact-paths", state.genesis_paths),
		scope_digest: domainHashV1("review-recovery-scope", {
			base_tree: state.initial_snapshot.base_tree,
			complete_snapshot_tree: state.initial_snapshot.complete_snapshot_tree,
			initial_review_tree: state.initial_snapshot.initial_review_tree,
			final_candidate_tree: state.current_candidate_tree,
			genesis_paths: state.genesis_paths,
			intended_untracked: state.intended_untracked,
		}),
		intended_untracked_hash: domainHashV1("compact-untracked", state.intended_untracked),
		intended_untracked_proof_hash: domainHashV1("review-recovery-empty-untracked", { candidate_tree: state.current_candidate_tree, paths: [] }),
		policy_hash: state.policy_hash,
		policy_evidence_hash: domainHashV1("review-recovery-policy-evidence", { policy_hash: state.policy_hash, runtime_identity_hash: state.runtime_identity.identity_hash }),
		receipt_hash: receiptHash,
		ledger_hash: ledgerHash,
	};
}

function recoveryEquivalence(
	source: ReturnType<typeof inspectRecoverableGraphSourceV1>,
	successor: ReturnType<typeof inspectApprovedCompactSuccessorV1>,
	state: ReturnType<typeof discoverCompactReview>["record"]["state"],
) {
	return {
		repository: source.repository,
		change: source.change,
		source: source.source,
		successor,
		source_evidence: recoveryEvidence(state, source.source.receipt_hash, source.source.frozen_ledger_hash),
		successor_evidence: recoveryEvidence(state, successor.receipt_hash, successor.ledger_hash),
	};
}

test("controller publicly installs a supersession and exactly replays it with fresh approval", async (t) => {
	const fixture = createRepository(t, false);
	writeFileSync(join(fixture.repository, "app.ts"), "export const value = 2;\n");
	git(fixture.repository, "add", "app.ts");
	fixture.finalTree = git(fixture.repository, "write-tree");
	const sourceLineageId = "graph-v1-source";
	const successorLineageId = "compact-v2-successor";
	const changeName = "recover-legacy-review-authority";
	mkdirSync(join(fixture.repository, "openspec", "changes", changeName), { recursive: true });
	createTerminalAuthority(fixture, sourceLineageId);
	const { controller, toolCall } = registerRuntime();
	await approveTrackedWorktreeTransaction(controller, extensionContext(fixture.repository), successorLineageId);
	const source = inspectRecoverableGraphSourceV1(fixture.repository, changeName, sourceLineageId);
	const successor = inspectApprovedCompactSuccessorV1(fixture.repository, successorLineageId);
	const preparedInput = {
		operation_id: domainHashV1("controller-positive-supersession", { changeName, sourceLineageId, successorLineageId }),
		eligibility: source,
		equivalence: recoveryEquivalence(source, successor, discoverCompactReview(fixture.repository, successorLineageId).record.state),
	};
	const prepareParameters = {
		operation: "prepare-supersession",
		input: JSON.stringify({ changeName, sourceLineageId, successorLineageId, operationId: preparedInput.operation_id, prepared: preparedInput }),
	};
	const prepared = await controllerCall(controller, extensionContext(fixture.repository), prepareParameters);
	assert.equal(prepared.operation, "prepare-supersession");
	assert.equal(typeof prepared.request_hash, "string");
	assert.equal(typeof prepared.challenge, "string");
	assert.equal((prepared.body as { request_hash: string }).request_hash, prepared.request_hash);
	const supersedeParameters = {
		operation: "supersede",
		input: JSON.stringify({ changeName, sourceLineageId, successorLineageId, operationId: preparedInput.operation_id, prepared: preparedInput, request_hash: prepared.request_hash, challenge: prepared.challenge }),
	};
	let approvals = 0;
	const approvingContext = () => extensionContext(fixture.repository, true, async (title, message) => {
		approvals += 1;
		assert.equal(title, "Authorize review authority SUPERSESSION?");
		assert.ok(message.includes(`Exact challenge: ${prepared.challenge}`));
		return true;
	});
	const installed = await controllerCall(controller, approvingContext(), supersedeParameters);
	assert.equal(installed.operation, "supersede");
	assert.equal(installed.active_authority_id, successorLineageId);
	const recoveryId = installed.recovery_id as string;
	const store = SupersessionStoreV1.forRepository(fixture.repository);
	const chain = store.load(changeName);
	assert.deepEqual(chain.map((record) => record.recovery_id), [recoveryId]);
	const durableBytes = canonicalJsonV1(chain[0]!);
	assert.equal(resolveReviewAuthorityForChange(fixture.repository, changeName)?.record.state.lineage_id, successorLineageId);

	const command = "git commit -am recovered";
	await assert.rejects(
		controller.execute("missing-recovered-change", {
			operation: "validate",
			idempotencyKey: "missing-recovered-change",
			command,
			input: JSON.stringify({ scopeBudget: budget() }),
		}, undefined, undefined, extensionContext(fixture.repository)),
		/requires changeName and a valid supersession/i,
	);
	await assert.rejects(
		controller.execute("incorrect-recovered-change", {
			operation: "validate",
			changeName: "incorrect-recovered-change",
			idempotencyKey: "incorrect-recovered-change",
			command,
			input: JSON.stringify({ scopeBudget: budget() }),
		}, undefined, undefined, extensionContext(fixture.repository)),
		/recovery-required authority has no bound supersession record/i,
	);
	const validated = await controllerCall(controller, extensionContext(fixture.repository), {
		operation: "validate",
		changeName,
		idempotencyKey: "validated-recovered-change",
		command,
		input: JSON.stringify({ scopeBudget: budget() }),
	});
	const validationResult = validated.result as Record<string, unknown>;
	assert.equal(validationResult.status, "allow", JSON.stringify(validated));
	assert.equal(validationResult.receipt_hash, successor.receipt_hash);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, extensionContext(fixture.repository)), undefined);

	const replayed = await controllerCall(controller, approvingContext(), supersedeParameters);
	assert.deepEqual(replayed, installed);
	assert.equal(approvals, 2);
	assert.deepEqual(store.load(changeName).map((record) => record.recovery_id), [recoveryId]);
	assert.equal(canonicalJsonV1(store.load(changeName)[0]!), durableBytes);

	const changeRoot = join(fixture.repository, "openspec", "changes", changeName);
	mkdirSync(join(changeRoot, "specs", "review"), { recursive: true });
	writeFileSync(join(changeRoot, "proposal.md"), "# Proposal\n");
	writeFileSync(join(changeRoot, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(changeRoot, "design.md"), "# Design\n");
	writeFileSync(join(changeRoot, "tasks.md"), "- [x] 1.1 Done\n");
	writeFileSync(join(changeRoot, "verify-report.md"), "PASS\n");
	writeFileSync(join(changeRoot, "sync-report.md"), "PASS\n");
	unlinkSync(join(store.root, "recovery-required-v1", `${domainHashV1("openspec-change-name", changeName)}.json`));
	const status = __testing.resolveControllerSddStatus(fixture.repository, changeName, false, "openspec");
	assert.equal(status.dependencies.archive, "blocked");
	assert.equal(status.nextRecommended, "resolve-review");
});

test("controller SDD status treats removed OpenSpec recovery authority and deleted marker as blocking", (t) => {
	const fixture = createRepository(t, false);
	const changeName = "recover-legacy-review-authority";
	const changeRoot = join(fixture.repository, "openspec", "changes", changeName);
	mkdirSync(changeRoot, { recursive: true });
	writeFileSync(join(fixture.repository, "app.ts"), "export const value = 2;\n");
	git(fixture.repository, "add", "app.ts");
	fixture.finalTree = git(fixture.repository, "write-tree");
	createTerminalAuthority(fixture, "archived-graph-source");
	const store = SupersessionStoreV1.forRepository(fixture.repository);
	const marker = join(store.root, "recovery-required-v1", `${domainHashV1("openspec-change-name", changeName)}.json`);
	mkdirSync(join(store.root, "recovery-required-v1"), { recursive: true });
	writeFileSync(marker, "recovery-required");
	rmSync(changeRoot, { recursive: true, force: true });
	unlinkSync(marker);

	const status = __testing.resolveControllerSddStatus(fixture.repository, changeName, false, "openspec");

	assert.equal(status.dependencies.archive, "blocked");
	assert.equal(status.nextRecommended, "resolve-review");
	assert.match(status.blockedReasons.join("\n"), /recovery|required|graph/i);
});

test("controller SDD status blocks archive for a recovery-required marker without a supersession record", (t) => {
	const fixture = createRepository(t, false);
	const changeName = "recover-legacy-review-authority";
	const changeRoot = join(fixture.repository, "openspec", "changes", changeName);
	mkdirSync(join(changeRoot, "specs", "review"), { recursive: true });
	writeFileSync(join(changeRoot, "proposal.md"), "# Proposal\n");
	writeFileSync(join(changeRoot, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(changeRoot, "design.md"), "# Design\n");
	writeFileSync(join(changeRoot, "tasks.md"), "- [x] 1.1 Done\n");
	writeFileSync(join(changeRoot, "verify-report.md"), "PASS\n");
	writeFileSync(join(changeRoot, "sync-report.md"), "PASS\n");
	const store = SupersessionStoreV1.forRepository(fixture.repository);
	const markerDirectory = join(store.root, "recovery-required-v1");
	mkdirSync(markerDirectory, { recursive: true });
	writeFileSync(join(markerDirectory, `${domainHashV1("openspec-change-name", changeName)}.json`), "recovery-required");

	const status = __testing.resolveControllerSddStatus(fixture.repository, changeName, false, "openspec");

	assert.equal(status.dependencies.archive, "blocked");
	assert.equal(status.nextRecommended, "resolve-review");
	assert.match(status.blockedReasons.join("\n"), /recovery-required/i);
});

test("controller rejects headless or rejected supersession approval without creating recovery authority", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const request = {
		operation: "supersede",
		input: JSON.stringify({
			challenge: "SUPERSEDE REVIEW AUTHORITY test CHANGE recovery",
			request_hash: "a".repeat(64),
			prepared: {},
		}),
	};
	await assert.rejects(
		controller.execute("headless-supersession", request, undefined, undefined, extensionContext(fixture.repository)),
		/interactive Pi UI.*fails closed/i,
	);
	await assert.rejects(
		controller.execute("rejected-supersession", request, undefined, undefined, extensionContext(fixture.repository, true, async () => false)),
		/not explicitly authorized/i,
	);
	assert.equal(existsSync(join(fixture.repository, ".git", "gentle-ai", "reviews", "control", "authority-supersession-v1")), false);
});

test("controller keeps graph-v1 ordinary mutation read-only while preserving repository-file input confinement", async (t) => {
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
		/graph-v1 ordinary.*read-only/i,
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
	await assert.rejects(
		controller.execute("valid-read-only-validator-input", { operation: "advance", lineageId, idempotencyKey: "validate", transition: REVIEW_TRANSITION.ORDINARY_VALIDATION, inputPath }, undefined, undefined, ctx),
		/graph-v1 ordinary.*read-only/i,
	);
});

test("controller rejects graph-style ADVANCE for new compact ordinary authority", async (t) => {
	const fixture = createRepository(t, false);
	const lineageId = "controller-correction-evidence";
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	await controllerCall(controller, ctx, {
		operation: "start", lineageId, idempotencyKey: "start",
		input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	await assert.rejects(
		controller.execute("compact-advance", { operation: "advance", lineageId, idempotencyKey: "discover", transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY, input: JSON.stringify({ rows: [] }) }, undefined, undefined, ctx),
		/compact-v2 ordinary.*finalize/i,
	);
});

test("controller rejects malformed refuter payloads before compact authority mutation", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	const started = await controllerCall(controller, ctx, {
		operation: "start",
		input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	const result = started.result as { lineage_id: string };
	const state = started.state as { selected_lenses: string[] };
	const lens_results = state.selected_lenses.map(() => ({ findings: [{
		location: "app.ts:1",
		severity: "CRITICAL",
		claim: "The review cannot establish correctness.",
		evidence_class: "inferential",
		causal_disposition: "introduced",
		proof_refs: ["differential-test:tests/app.test.ts"],
	}], evidence: [] }));
	const pending = await controllerCall(controller, ctx, {
		operation: "finalize",
		lineageId: result.lineage_id,
		input: JSON.stringify({ review_result: { lens_results } }),
	});
	const pendingResult = pending.result as { refuter_request: { request_hash: string } };
	const before = discoverCompactReview(fixture.repository, result.lineage_id).record;
	await assert.rejects(
		controller.execute("malformed-refuter", {
			operation: "finalize",
			lineageId: result.lineage_id,
			input: JSON.stringify({ review_result: {
				lens_results,
				refuter_request_hash: pendingResult.refuter_request.request_hash,
				refuter_results: [null],
			} }),
		}, undefined, undefined, ctx),
		/review\/finalize\.review_result\.refuter_results\[0\]/,
	);
	const after = discoverCompactReview(fixture.repository, result.lineage_id).record;
	assert.equal(after.revision, before.revision);
	assert.equal(after.state.state, "reviewing");
});

test("controller requires an approved compact lineage to match its stored policy hash", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	const lineageId = "approved-policy-lineage";
	await approveTrackedWorktreeTransaction(controller, ctx, lineageId);

	await assert.rejects(
		controller.execute("stale-policy", {
			operation: "start",
			lineageId,
			input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, projection: { kind: "complete" }, policyHash: "c".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
		}, undefined, undefined, ctx),
		/policy hash.*does not match/i,
	);
});

test("controller prioritizes active compact authority over terminal history and reports terminals without active authority", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	await approveTrackedWorktreeTransaction(controller, ctx, "historical-terminal");

	const terminal = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal(terminal.status, "terminal");
	assert.equal(terminal.next_action, "validate-existing-terminal-receipt");
	assert.equal(((terminal.inspection as Record<string, unknown>).compact_authority as { outcome: string }).outcome, "approved");
	writeFileSync(join(fixture.repository, "app.ts"), "export const value = 3;\n");

	await controllerCall(controller, ctx, {
		operation: "start",
		lineageId: "active-after-terminal",
		input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	const active = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal(active.status, "in-progress");
	assert.equal(active.next_action, "finalize-existing-ordinary-review");
	assert.equal(((active.inspection as Record<string, unknown>).compact_authority as { outcome: string }).outcome, "active");
});

test("controller retains graph-v1 inspection and repair behavior without compact authority", async (t) => {
	const fixture = createRepository(t, true);
	createTerminalAuthority(fixture, "graph-only-authority");
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal(inspected.status, "ready");
	assert.equal(inspected.next_action, "start-ordinary-review");
	assert.equal((inspected.inspection as Record<string, unknown>).compact_authority, undefined);
	const repaired = await controllerCall(controller, ctx, { operation: "repair" });
	assert.equal(repaired.repaired, true);
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
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	await approveTrackedWorktreeTransaction(controller, ctx, "before-reset");
	const command = "git commit -am before-reset";
	await controllerCall(controller, ctx, { operation: "validate", lineageId: "before-reset", idempotencyKey: "before-reset-gate", command, input: "{}" });
	createLegacyReviewAuthority(fixture.repository);

	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	const blockedInspection = inspected.inspection as Record<string, unknown>;
	assert.equal(blockedInspection.outcome, "blocked-mixed");
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
	assert.equal((blockedStart.inspection as Record<string, unknown>).outcome, "blocked-mixed");

	const resetRequest = blockedInspection.reset_request as Record<string, unknown>;
	await assert.rejects(
		controller.execute("unauthorized-reset", { operation: "reset", input: JSON.stringify(resetRequest) }, undefined, undefined, ctx),
		/interactive Pi UI.*fails closed/i,
	);
	const stillBlocked = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal((stillBlocked.inspection as Record<string, unknown>).outcome, "blocked-mixed");
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
	const revoked = await toolCall({ toolName: "bash", input: { command } }, ctx);
	assert.equal(revoked?.block, true);

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

test("controller resets only invalid compact-v2 authority after an exact interactive challenge", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	const started = await controllerCall(controller, ctx, {
		operation: "start",
		lineageId: "invalid-compact-reset",
		input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, projection: { kind: "complete" }, policyHash: "a".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }),
	});
	const lineageId = (started.result as { lineage_id: string }).lineage_id;
	writeFileSync(discoverCompactReview(fixture.repository, lineageId).store.statePath, "malformed compact state");

	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal((inspected.inspection as Record<string, unknown>).outcome, "clean");
	assert.equal(((inspected.inspection as Record<string, unknown>).compact_authority as { outcome: string }).outcome, "invalid");
	assert.equal(inspected.status, "blocked");
	assert.equal(inspected.next_action, "request-explicit-reset-authorization");
	const request = (inspected.inspection as Record<string, unknown>).reset_request as Record<string, unknown>;
	await assert.rejects(
		controller.execute("wrong-invalid-compact-reset", { operation: "reset", input: JSON.stringify({ ...request, confirmation: `${String(request.confirmation)} altered` }) }, undefined, undefined, ctx),
		/exactly match/i,
	);
	const reset = await controllerCall(controller, ctx, { operation: "reset", input: JSON.stringify(request) });
	assert.equal((reset.inspection as Record<string, unknown>).outcome, "clean");
	assert.equal((reset.inspection as Record<string, unknown>).compact_authority, undefined);
	assert.equal(reset.next_action, "start-fresh-ordinary-review-after-verified-clean");
});

test("controller INSPECT treats a completed reset journal as history and routes a fresh compact-invalid reset", async (t) => {
	const fixture = createRepository(t, false);
	createLegacyReviewAuthority(fixture.repository);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	const original = await controllerCall(controller, ctx, { operation: "inspect" });
	await controllerCall(controller, ctx, {
		operation: "reset",
		input: JSON.stringify((original.inspection as Record<string, unknown>).reset_request),
	});
	const compact = startCompactReview({ cwd: fixture.repository, lineageId: "completed-journal-invalid", policyHash: "a".repeat(64) });
	writeFileSync(discoverCompactReview(fixture.repository, compact.lineage_id).store.statePath, "malformed compact state");

	const invalid = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal((invalid.inspection as Record<string, unknown>).outcome, "clean");
	assert.equal(((invalid.inspection as Record<string, unknown>).compact_authority as { outcome: string }).outcome, "invalid");
	assert.equal(invalid.status, "blocked");
	assert.equal(invalid.next_action, "request-explicit-reset-authorization");
	assert.notEqual(invalid.next_action, "request-explicit-reset-recovery-authorization");

	const reset = await controllerCall(controller, ctx, {
		operation: "reset",
		input: JSON.stringify((invalid.inspection as Record<string, unknown>).reset_request),
	});
	assert.equal((reset.inspection as Record<string, unknown>).outcome, "clean");
	assert.equal(reset.next_action, "start-fresh-ordinary-review-after-verified-clean");
});

test("controller keeps valid compact terminal authority non-resettable", async (t) => {
	const fixture = createRepository(t, false);
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	await approveTrackedWorktreeTransaction(controller, ctx, "terminal-compact-reset");
	const inspected = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal(inspected.status, "terminal");
	const request = (inspected.inspection as Record<string, unknown>).reset_request as Record<string, unknown>;
	await assert.rejects(
		controller.execute("terminal-compact-reset", { operation: "reset", input: JSON.stringify(request) }, undefined, undefined, ctx),
		/destructive reset requires/i,
	);
	const unchanged = await controllerCall(controller, ctx, { operation: "inspect" });
	assert.equal(unchanged.status, "terminal");
	assert.equal(((unchanged.inspection as Record<string, unknown>).compact_authority as { outcome: string }).outcome, "approved");
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
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository);
	await approveTrackedWorktreeTransaction(controller, ctx, "before-recover");
	const command = "git commit -am before-recover";
	await controllerCall(controller, ctx, { operation: "validate", lineageId: "before-recover", idempotencyKey: "before-recover-gate", command, input: "{}" });
	createLegacyReviewAuthority(fixture.repository);
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
	const revoked = await toolCall({ toolName: "bash", input: { command } }, ctx);
	assert.equal(revoked?.block, true);
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

	const committed = await controllerCall(controller, ctx, request); // Simulate committed authority whose response was lost.
	const replay = await controllerCall(controller, ctx, request);
	assert.deepEqual(replay.result, committed.result);
	await assert.rejects(
		controller.execute("changed-start-replay", { ...request, input: JSON.stringify({ mode: "ordinary", projection: { kind: "complete" }, policyHash: "c".repeat(64), evidenceHash: "b".repeat(64), budget: budget() }) }, undefined, undefined, ctx),
		/compare-and-swap|different.*request/i,
	);
});

test("shipped controller and orchestrator contracts specify inspect-first compact facade without cascade", () => {
	const { controller } = registerRuntime();
	const toolContract = [
		controller.description,
		controller.promptSnippet ?? "",
		...(controller.promptGuidelines ?? []),
		JSON.stringify(controller.parameters),
	].join("\n");
	assert.match(toolContract, /operation.*start.*finalize.*validate.*input/is);
	assert.match(toolContract, /mode\\?":\\?"ordinary|mode.*ordinary/is);
	assert.match(toolContract, /ordinary.*Judgment Day/is);
	assert.match(toolContract, /JSON(?:-serialized object)? string/is);
	assert.match(toolContract, /blocked-legacy.*explicit.*authorization/is);
	assert.match(toolContract, /reset.*inspect.*clean.*start/is);
	assert.match(toolContract, /output.*lost|response.*lost|ambiguous.*START/is);
	assert.match(toolContract, /ambiguous START or FINALIZE.*compact CAS/is);
	assert.doesNotMatch(toolContract, /START throws.*lineage does not exist/is);

	for (const path of ["assets/orchestrator-delegation.md", "skills/gentle-ai/SKILL.md"]) {
		const contract = readFileSync(path, "utf8");
		assert.match(contract, /INSPECT before START|inspect.*before.*start/is, path);
		assert.match(contract, /mode `ordinary`|mode.*ordinary|ordinary review/is, path);
		assert.match(contract, /Judgment Day.*explicit/is, path);
		assert.match(contract, /before authority access.*no lineage|pre-authority.*no lineage/is, path);
		assert.match(contract, /replay the exact START|replay the exact START or FINALIZE/is, path);
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
	git(fixture.repository, "remote", "add", "fork", "https://github.com/MarsSall/gentle-pi.git");
	git(fixture.repository, "config", "url.file://" + remotePath.replace(/\\/g, "/") + ".insteadOf", "https://github.com/MarsSall/gentle-pi.git");
	createTerminalAuthority(fixture, "controller-targets");
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);

	for (const [command, key] of [
		["git push origin main:main", "push"],
		["gh pr create --base base --head final", "pr"],
		["gh pr create --base base --head MarsSall:final", "fork-pr"],
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

	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/heads/final", fixture.baseCommit]);
	await assert.rejects(
		controller.execute(
			"divergent-fork-pr-head",
			{
				operation: "validate",
				lineageId: "controller-targets",
				idempotencyKey: "divergent-fork-pr-head",
				command: "gh pr create --base base --head MarsSall:final",
				input: JSON.stringify({ scopeBudget: budget() }),
			},
			undefined,
			undefined,
			ctx,
		),
	);

	for (const command of [
		"gh pr create --base base --head :final",
		"gh pr create --base base --head MarsSall:",
		"gh pr create --base base --head MarsSall:final:extra",
	]) {
		await assert.rejects(
			controller.execute(
				"malformed-fork-pr-head",
				{
					operation: "validate",
					lineageId: "controller-targets",
					idempotencyKey: `malformed-fork-pr-head-${command.length}`,
					command,
					input: JSON.stringify({ scopeBudget: budget() }),
				},
				undefined,
				undefined,
				ctx,
			),
			/exact owner:branch syntax/i,
		);
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
			/exactly derive|unsupported.*push|complete ref update|force push refspec/i,
		);
	}
	await t.test("rejects force refspecs and unsupported push --repo parsing", async () => {
		for (const [command, pattern] of [
			["git push origin +main:main", /force push refspec/i],
			["git push --repo attacker origin main:main", /unsupported push option.*--repo/i],
		] as const) {
			await assert.rejects(
				controller.execute(
					"unsafe-push-form",
					{
						operation: "validate",
						lineageId: "controller-targets",
						idempotencyKey: `unsafe-push-form-${command.length}`,
						command,
						input: JSON.stringify({ scopeBudget: budget() }),
					},
					undefined,
					undefined,
					ctx,
				),
				pattern,
			);
		}
	});
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

test("controller authorizes the exact first push after an approved intended-commit receipt", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit && fixture.finalTree);
	const fetchRemotePath = join(fixture.parent, "fetch.git");
	const pushRemotePath = join(fixture.parent, "push.git");
	execFileSync("git", ["clone", "--bare", fixture.repository, fetchRemotePath], {
		cwd: fixture.parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", fetchRemotePath, "update-ref", "refs/heads/feature/first-push", fixture.finalCommit]);
	execFileSync("git", ["clone", "--bare", fixture.repository, pushRemotePath], {
		cwd: fixture.parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", pushRemotePath, "update-ref", "refs/heads/main", fixture.baseCommit]);
	git(fixture.repository, "remote", "add", "origin", fetchRemotePath);
	git(fixture.repository, "remote", "set-url", "--add", "--push", "origin", pushRemotePath);
	git(fixture.repository, "branch", "feature/first-push", fixture.finalCommit);
	createTerminalAuthority(fixture, "controller-first-push");
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	const command = "git push -u origin feature/first-push";
	const validated = await controllerCall(controller, ctx, {
		operation: "validate",
		lineageId: "controller-first-push",
		idempotencyKey: "controller-first-push-gate",
		command,
		input: JSON.stringify({ scopeBudget: budget() }),
	});

	assert.equal((validated.result as Record<string, unknown>).status, "allow", JSON.stringify(validated));
	const derivedTarget = validated.derived_target as Record<string, unknown>;
	assert.equal((derivedTarget.updates as Array<Record<string, unknown>>)[0]?.kind, "create");
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, ctx), undefined);
});

test("controller resolves explicit abbreviated push destinations against advertised refs", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit && fixture.finalTree);
	const remotePath = join(fixture.parent, "destination-resolution.git");
	execFileSync("git", ["clone", "--bare", fixture.repository, remotePath], {
		cwd: fixture.parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/tags/publish-target", fixture.baseCommit]);
	git(fixture.repository, "remote", "add", "origin", remotePath);
	createTerminalAuthority(fixture, "controller-destination-resolution");
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	const validated = await controllerCall(controller, ctx, {
		operation: "validate",
		lineageId: "controller-destination-resolution",
		idempotencyKey: "controller-destination-tag",
		command: "git push origin final:publish-target",
		input: JSON.stringify({ scopeBudget: budget() }),
	});
	const update = (validated.derived_target as { updates: Array<Record<string, unknown>> }).updates[0];
	assert.equal(update?.destination_ref, "refs/tags/publish-target");

	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/heads/ambiguous-target", fixture.baseCommit]);
	execFileSync("git", ["--git-dir", remotePath, "update-ref", "refs/tags/ambiguous-target", fixture.baseCommit]);
	await assert.rejects(
		controller.execute(
			"ambiguous-push-destination",
			{
				operation: "validate",
				lineageId: "controller-destination-resolution",
				idempotencyKey: "controller-destination-ambiguous",
				command: "git push origin final:ambiguous-target",
				input: JSON.stringify({ scopeBudget: budget() }),
			},
			undefined,
			undefined,
			ctx,
		),
		/ambiguous/i,
	);
});

test("controller push probes preserve safe user URL rewriting and ordinary credentials", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit && fixture.finalTree);
	const fetchRemotePath = join(fixture.parent, "fetch.git");
	const pushRemotePath = join(fixture.parent, "push.git");
	const userHome = join(fixture.parent, "home");
	mkdirSync(userHome);
	execFileSync("git", ["init", "--bare", fetchRemotePath], { cwd: fixture.parent, stdio: ["ignore", "pipe", "pipe"] });
	execFileSync("git", ["clone", "--bare", fixture.repository, pushRemotePath], { cwd: fixture.parent, stdio: ["ignore", "pipe", "pipe"] });
	execFileSync("git", ["--git-dir", pushRemotePath, "update-ref", "refs/heads/main", fixture.baseCommit]);
	const logicalPushUrl = "https://github.com/example/first-push.git";
	execFileSync("git", ["config", "--global", `url.${pushRemotePath}.insteadOf`, logicalPushUrl], {
		env: { ...process.env, HOME: userHome },
	});
	git(fixture.repository, "remote", "add", "origin", fetchRemotePath);
	git(fixture.repository, "remote", "set-url", "--add", "--push", "origin", logicalPushUrl);
	git(fixture.repository, "branch", "feature/safe-config", fixture.finalCommit);
	createTerminalAuthority(fixture, "controller-safe-config");
	const { controller } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	const originalEnvironment = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries({
		HOME: userHome,
		GIT_ASKPASS: join(fixture.parent, "askpass"),
	})) {
		originalEnvironment.set(key, process.env[key]);
		process.env[key] = value;
	}
	t.after(() => {
		for (const [key, value] of originalEnvironment) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	const validated = await controllerCall(controller, ctx, {
		operation: "validate",
		lineageId: "controller-safe-config",
		idempotencyKey: "controller-safe-config-gate",
		command: "git push -u origin feature/safe-config",
		input: JSON.stringify({ scopeBudget: budget() }),
	});
	assert.equal((validated.result as Record<string, unknown>).status, "allow", JSON.stringify(validated));
});

test("controller blocks a previously authorized push when inherited Git config injection appears at execution", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit && fixture.finalTree);
	const pushRemotePath = join(fixture.parent, "execution-boundary-push.git");
	execFileSync("git", ["clone", "--bare", fixture.repository, pushRemotePath], {
		cwd: fixture.parent,
		stdio: ["ignore", "pipe", "pipe"],
	});
	execFileSync("git", ["--git-dir", pushRemotePath, "update-ref", "refs/heads/main", fixture.baseCommit]);
	git(fixture.repository, "remote", "add", "origin", pushRemotePath);
	git(fixture.repository, "branch", "feature/execution-boundary", fixture.finalCommit);
	createTerminalAuthority(fixture, "controller-execution-boundary");
	const { controller, toolCall } = registerRuntime();
	const ctx = extensionContext(fixture.repository, true);
	const command = "git push -u origin feature/execution-boundary";
	const validated = await controllerCall(controller, ctx, {
		operation: "validate",
		lineageId: "controller-execution-boundary",
		idempotencyKey: "controller-execution-boundary-gate",
		command,
		input: JSON.stringify({ scopeBudget: budget() }),
	});
	assert.equal((validated.result as Record<string, unknown>).status, "allow");

	const originalCount = process.env.GIT_CONFIG_COUNT;
	const originalKey = process.env.GIT_CONFIG_KEY_0;
	const originalValue = process.env.GIT_CONFIG_VALUE_0;
	process.env.GIT_CONFIG_COUNT = "1";
	process.env.GIT_CONFIG_KEY_0 = "remote.origin.pushurl";
	process.env.GIT_CONFIG_VALUE_0 = join(fixture.parent, "attacker.git");
	try {
		const blocked = await toolCall({ toolName: "bash", input: { command } }, ctx);
		assert.equal(blocked?.block, true);
		assert.match(blocked?.reason ?? "", /Git.*environment|routing|configuration override/i);
	} finally {
		if (originalCount === undefined) delete process.env.GIT_CONFIG_COUNT;
		else process.env.GIT_CONFIG_COUNT = originalCount;
		if (originalKey === undefined) delete process.env.GIT_CONFIG_KEY_0;
		else process.env.GIT_CONFIG_KEY_0 = originalKey;
		if (originalValue === undefined) delete process.env.GIT_CONFIG_VALUE_0;
		else process.env.GIT_CONFIG_VALUE_0 = originalValue;
	}
});

test("controller fails closed when a configured remote has multiple pushurl destinations", async (t) => {
	const fixture = createRepository(t, true);
	assert.ok(fixture.finalCommit);
	const fetchRemotePath = join(fixture.parent, "fetch.git");
	const firstPushPath = join(fixture.parent, "push-one.git");
	const secondPushPath = join(fixture.parent, "push-two.git");
	for (const path of [fetchRemotePath, firstPushPath, secondPushPath]) {
		execFileSync("git", ["init", "--bare", path], { cwd: fixture.parent, stdio: ["ignore", "pipe", "pipe"] });
	}
	git(fixture.repository, "remote", "add", "origin", fetchRemotePath);
	git(fixture.repository, "remote", "set-url", "--add", "--push", "origin", firstPushPath);
	git(fixture.repository, "remote", "set-url", "--add", "--push", "origin", secondPushPath);
	git(fixture.repository, "branch", "feature/multiple-pushurl", fixture.finalCommit);
	createTerminalAuthority(fixture, "controller-multiple-pushurl");
	const { controller } = registerRuntime();

	await assert.rejects(
		controller.execute("multiple-pushurl", {
			operation: "validate",
			lineageId: "controller-multiple-pushurl",
			idempotencyKey: "controller-multiple-pushurl-gate",
			command: "git push -u origin feature/multiple-pushurl",
			input: JSON.stringify({ scopeBudget: budget() }),
		}, undefined, undefined, extensionContext(fixture.repository, true)),
		/multiple pushurl|one effective push destination/i,
	);
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
