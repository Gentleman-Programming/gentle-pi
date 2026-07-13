import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";
import { domainHashV1 } from "../lib/review-canonical.ts";
import { SupersessionStoreV1 } from "../lib/review-authority-supersession.ts";

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

function runtime(nativeReviewCli: NativeReviewCli | null): Runtime {
	const tools = new Map<string, RegisteredTool>();
	let toolCall: ToolCallHandler | undefined;
	createGentleAiExtension({ nativeReviewCli })({
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

function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", "initial"], { cwd });
	return cwd;
}

function fakeNative(overrides: Partial<NativeReviewCli> = {}): NativeReviewCli {
	return {
		start: async () => ({ lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4 }),
		finalize: async () => ({ lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" }),
		validate: async () => ({ allowed: true, result: "allow", action: "allow", reason: "ok", gateContext: { lineageId: "native-lineage", storeRevision: "r1", receiptHash: "receipt", targetHash: "target" } }),
		bindSdd: async () => ({ repository: "repo-1", change: "native-review-authority-parity", path: "openspec/changes/native-review-authority-parity", lineageId: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", bindingRevision: "b1" }),
		sddStatus: async () => ({ ready: false }),
		...overrides,
	};
}

test("new ordinary START and native-lineage FINALIZE use exactly one native call and stable envelopes", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	let starts = 0;
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4 };
		},
		finalize: async () => {
			finalizes += 1;
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" };
		},
	}));
	const start = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(start.details, { operation: "start", result: { lineage_id: "native-lineage", state: "reviewing", risk_tier: "medium", selected_lenses: ["review-reliability"], changed_files: 2, original_changed_lines: 7, correction_budget: 4 } });
	const finalize = await controller.execute("finalize", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ review_result: { lens_results: [{ findings: [], evidence: [] }] } }) }, undefined, undefined, context(cwd));
	assert.deepEqual(finalize.details, { operation: "finalize", result: { lineage_id: "native-lineage", state: "approved", action: "approved", store_revision: "r1", receipt_path: "/opaque/receipt" } });
	assert.equal(starts, 1);
	assert.equal(finalizes, 1);
});

test("native FINALIZE validates and forwards the exact refuter document", async (t) => {
	const cwd = repository(t);
	const refuterDocument = {
		schema: "gentle-ai.refuter-result-batch/v1",
		request_hash: "a".repeat(64),
		results: [],
	};
	const requests: Array<{ cwd: string; lineageId?: string; refuterDocument?: unknown }> = [];
	const { controller } = runtime(fakeNative({
		finalize: async (request) => {
			requests.push(request);
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}));
	await controller.execute("finalize-refuter", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ refuter_batch: refuterDocument }) }, undefined, undefined, context(cwd));
	assert.deepEqual(requests, [{ cwd, lineageId: "native-lineage", refuterDocument }]);
	await assert.rejects(
		controller.execute("finalize-invalid", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ refuter_batch: refuterDocument, unexpected: true }) }, undefined, undefined, context(cwd)),
		/unknown field unexpected/,
	);
	assert.equal(requests.length, 1);
});

test("native error has no compact fallback and ambiguous mutation demands exact replay", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const { controller } = runtime(fakeNative({ start: async () => { throw Object.assign(new Error("lost output"), { mutationOutcome: "unknown", nextAction: "replay-exact-native-operation" }); } }));
	const result = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(result.details, { operation: "start", status: "blocked", outcome: "native-operation-failed", mutation_performed: false, mutation_outcome: "unknown", next_action: "replay-exact-native-operation" });
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
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4 };
		},
	}));
	await controller.execute("default-policy", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	await controller.execute("custom-policy", { operation: "start", input: JSON.stringify({ mode: "ordinary", policyPath: ".gentle-ai/policies/team policy.json" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(requests, [
		{ cwd },
		{ cwd, policyPath },
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
			mutation_performed: false,
			mutation_outcome: "none",
		});
	}
	assert.equal(requests.length, 2);
});

test("native START forwards a validated base ref and rejects invalid values before native calls", async (t) => {
	const cwd = repository(t);
	const requests: Array<{ cwd: string; baseRef?: string }> = [];
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			requests.push(request);
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4 };
		},
	}));
	await controller.execute("committed-base", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: "origin/main" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(requests, [{ cwd, baseRef: "origin/main" }]);
	for (const baseRef of ["", "   ", " origin/main", "origin/main ", "origin\0main", "origin\nmain", "origin\rmain", "origin\tmain", "origin\u007fmain", 42, [], {}]) {
		const rejected = await controller.execute("invalid-base", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef }) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-base-ref-invalid",
			reason: "base-ref-invalid",
			mutation_performed: false,
			mutation_outcome: "none",
		});
	}
	assert.equal(requests.length, 1);
});

test("native ordinary START blocks unknown input fields before native calls", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4 };
		},
	}));
	for (const field of ["base_ref", "unexpected"]) {
		const rejected = await controller.execute("unknown-start-field", { operation: "start", input: JSON.stringify({ mode: "ordinary", [field]: "origin/main" }) }, undefined, undefined, context(cwd));
		assert.deepEqual(rejected.details, {
			operation: "start",
			status: "blocked",
			outcome: "native-start-input-invalid",
			reason: "unknown-field",
			field,
			mutation_performed: false,
			mutation_outcome: "none",
		});
	}
	assert.equal(starts, 0);
});

test("legacy compact START retains its policyHash contract", async (t) => {
	const cwd = repository(t);
	const { controller } = runtime(null);
	const result = await controller.execute("legacy-start", { operation: "start", input: JSON.stringify({ mode: "ordinary", policyHash: "a".repeat(64) }) }, undefined, undefined, context(cwd));
	assert.notEqual((result.details as { result?: unknown }).result, undefined);
});

test("general STATUS and complete mixed inventory are unsupported without native invocation", async (t) => {
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
	}));
	const status = await controller.execute("status", { operation: "status" }, undefined, undefined, context(cwd));
	const inspect = await controller.execute("inspect", { operation: "inspect" }, undefined, undefined, context(cwd));
	assert.equal(calls, 0);
	for (const result of [status, inspect]) {
		assert.deepEqual(result.details, {
			operation: result === status ? "status" : "inspect",
			status: "blocked",
			outcome: "native-status-unsupported",
			mutation_performed: false,
			inventory_complete: false,
			next_action: "require-upstream-read-only-native-status-inventory",
			evidence: {
				native_contract: "gentle-ai/2.1.0",
				general_status: "unsupported",
				claimant_inventory: "unsupported",
			},
		});
	}
});

test("legacy compact FINALIZE is a typed read-only rejection without native fallback", async (t) => {
	const cwd = repository(t);
	const lineageId = "legacy-compact";
	const compact = (await import("../lib/review-facade.ts")).startCompactReview({
		cwd,
		lineageId,
		policyHash: "a".repeat(64),
		projection: { kind: "complete" },
	});
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		finalize: async () => {
			finalizes += 1;
			return { lineageId, state: "approved", action: "approved", storeRevision: "r1" };
		},
	}));
	const result = await controller.execute(
		"legacy-finalize",
		{ operation: "finalize", lineageId, input: JSON.stringify({ review_result: { lens_results: [] } }) },
		undefined,
		undefined,
		context(cwd),
	);
	assert.deepEqual(result.details, {
		operation: "finalize",
		status: "blocked",
		outcome: "legacy-read-only",
		mutation_performed: false,
		next_action: "use-compatible-read-or-gate-route",
	});
	assert.equal(finalizes, 0);
	assert.equal((await import("../lib/review-facade.ts")).discoverCompactReview(cwd, compact.lineage_id).record.state.state, "reviewing");
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
	}));
	const result = await controller.execute(
		"legacy-graph-finalize",
		{ operation: "finalize", lineageId, input: JSON.stringify({ review_result: { lens_results: [] } }) },
		undefined,
		undefined,
		context(cwd),
	);
	assert.equal((result.details as { outcome: string }).outcome, "legacy-read-only");
	assert.equal(finalizes, 0);
	assert.equal(ReviewTransactionStore.forRepository(cwd).read(lineageId).revision, 0);
});

test("native allow registers one authorization and bash-time revalidation consumes it", async (t) => {
	const cwd = repository(t);
	let validates = 0;
	const { controller, toolCall } = runtime(fakeNative({
		validate: async () => {
			validates += 1;
			return { allowed: true, result: "allow", action: "allow", reason: "ok", gateContext: { lineageId: "native-lineage", storeRevision: "r1", receiptHash: "receipt", targetHash: "target" } };
		},
	}));
	const command = "git commit -m native";
	const validated = await controller.execute("validate", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((validated.details as { authorization?: unknown }).authorization, undefined);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, context(cwd)), undefined);
	const replay = await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean };
	assert.equal(replay.block, true);
	assert.equal(validates, 2);
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
				repository: "repo-1",
				change: "native-review-authority-parity",
				path: "openspec/changes/native-review-authority-parity",
				lineageId: "native-lineage",
				authorityRevision: "r1",
				receiptHash: "receipt",
				bindingRevision: bindCalls === 1 ? "b1" : "b2",
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
	assert.deepEqual(first.details, { operation: "bind-sdd", binding: { repository: "repo-1", change: "native-review-authority-parity", path: "openspec/changes/native-review-authority-parity", lineage_id: "native-lineage", authority_revision: "r1", receipt_hash: "receipt", binding_revision: "b1" } });
	const replay = await controller.execute("bind-replay", { operation: "bind-sdd", input: JSON.stringify({ change: "native-review-authority-parity", lineageId: "native-lineage", expectedBindingRevision: "b1" }) }, undefined, undefined, context(cwd));
	assert.equal((replay.details as { binding: { binding_revision: string } }).binding.binding_revision, "b2");
	assert.deepEqual(requests, [
		{ cwd, change: "native-review-authority-parity", lineage: "native-lineage", expectedBindingRevision: "" },
		{ cwd, change: "native-review-authority-parity", lineage: "native-lineage", expectedBindingRevision: "b1" },
	]);
});

test("native bind treats malformed or mismatched post-call evidence as committed-or-ambiguous", async (t) => {
	const cwd = repository(t);
	mkdirSync(join(cwd, "openspec", "changes", "native-review-authority-parity"), { recursive: true });
	let bindCalls = 0;
	const { controller } = runtime(fakeNative({
		bindSdd: async () => {
			bindCalls += 1;
			return bindCalls === 1
				? { repository: "repo-1", change: "other-change", path: "openspec/changes/native-review-authority-parity", lineageId: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", bindingRevision: "b1" }
				: { repository: "", change: "native-review-authority-parity", path: "openspec/changes/native-review-authority-parity", lineageId: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", bindingRevision: "b1" };
		},
	}));
	const input = JSON.stringify({ change: "native-review-authority-parity", lineageId: "native-lineage", expectedBindingRevision: "" });
	const expected = {
		operation: "bind-sdd",
		status: "blocked",
		outcome: "native-operation-failed",
		mutation_performed: false,
		mutation_outcome: "unknown",
		next_action: "replay-exact-native-operation",
	};
	const mismatched = await controller.execute("mismatched-bind", { operation: "bind-sdd", input }, undefined, undefined, context(cwd));
	assert.deepEqual(mismatched.details, expected);
	const malformed = await controller.execute("malformed-bind", { operation: "bind-sdd", input }, undefined, undefined, context(cwd));
	assert.deepEqual(malformed.details, expected);
	assert.equal(bindCalls, 2);
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

test("recovery obligation blocks pending implementation before native review readiness", async (t) => {
	const cwd = repository(t);
	const change = "native-review-authority-parity";
	const root = join(cwd, "openspec", "changes", change);
	mkdirSync(join(root, "specs", "review"), { recursive: true });
	writeFileSync(join(root, "proposal.md"), "# Proposal\n");
	writeFileSync(join(root, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(root, "design.md"), "# Design\n");
	writeFileSync(join(root, "tasks.md"), "- [ ] 1.1 Implement status routing\n");
	const store = SupersessionStoreV1.forRepository(cwd);
	mkdirSync(join(store.root, "recovery-required-v1"), { recursive: true });
	writeFileSync(join(store.root, "recovery-required-v1", `${domainHashV1("openspec-change-name", change)}.json`), "recovery-required");
	let statuses = 0;
	const status = await (await import("../extensions/gentle-ai.ts")).__testing.resolveControllerSddStatus(
		cwd,
		change,
		false,
		"openspec",
		fakeNative({ sddStatus: async () => { statuses += 1; throw new Error("gentle-ai unavailable"); } }),
	);
	assert.equal(statuses, 0);
	assert.equal(status.nextRecommended, "resolve-review");
	assert.equal(status.dependencies.apply, "blocked");
});

test("native ordinary START blocks every discovered legacy claimant before any native call", async (t) => {
	const cwd = repository(t);
	(await import("../lib/review-facade.ts")).startCompactReview({
		cwd,
		lineageId: "legacy-compact",
		policyHash: "a".repeat(64),
		projection: { kind: "complete" },
	});
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0 };
		},
	}));
	const result = await controller.execute("legacy-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.equal((result.details as { status: string }).status, "blocked");
	assert.equal(starts, 0);
});

test("native validation binds the exact command and derived pre-PR base to its returned tuple", async (t) => {
	const cwd = repository(t);
	execFileSync("git", ["checkout", "-b", "feature"], { cwd });
	writeFileSync(join(cwd, "feature.ts"), "export const feature = true;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", "feature"], { cwd });
	const requests: Array<{ flags?: readonly string[] }> = [];
	let validates = 0;
	const { controller, toolCall } = runtime(fakeNative({
		validate: async (request) => {
			requests.push(request);
			validates += 1;
			return { allowed: true, result: "allow", action: "allow", reason: "ok", gateContext: { lineageId: "native-lineage", storeRevision: "r1", receiptHash: "receipt", targetHash: validates === 1 ? "native-target" : "changed-native-target" } };
		},
	}));
	const command = "gh pr create --base main --head feature";
	await controller.execute("validate", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.deepEqual(requests[0]?.flags, ["--base-ref", "refs/heads/main"]);
	assert.equal((await toolCall({ toolName: "bash", input: { command: "gh pr create --base feature --head main" } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal((await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal(validates, 2);
});

test("controller forwards its AbortSignal to mutating native requests", async (t) => {
	const cwd = repository(t);
	const abort = new AbortController();
	let received: AbortSignal | undefined;
	const { controller } = runtime(fakeNative({
		start: async (request) => {
			received = request.signal;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0 };
		},
	}));
	await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, abort.signal, undefined, context(cwd));
	assert.equal(received, abort.signal);
});

test("native deny, target drift, and bash-time errors never restore an authorization", async (t) => {
	const cwd = repository(t);
	const command = "git commit -m native";
	const denied = runtime(fakeNative({
		validate: async () => ({ allowed: false, result: "deny", action: "block", reason: "denied", gateContext: { lineageId: "native-lineage", storeRevision: "r1", receiptHash: "receipt", targetHash: "target" } }),
	}));
	const deniedResult = await denied.controller.execute("deny", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((deniedResult.details as { authorization?: unknown }).authorization, undefined);
	assert.equal((await denied.toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);

	let calls = 0;
	const drifting = runtime(fakeNative({
		validate: async () => {
			calls += 1;
			return { allowed: true, result: "allow", action: "allow", reason: "ok", gateContext: { lineageId: "native-lineage", storeRevision: "r1", receiptHash: "receipt", targetHash: calls === 1 ? "target" : "changed-target" } };
		},
	}));
	await drifting.controller.execute("allow", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((await drifting.toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal((await drifting.toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal(calls, 2);

	const failing = runtime(fakeNative({
		validate: async () => { throw new Error("native connection lost"); },
	}));
	const failure = await failing.controller.execute("error", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((failure.details as { authorization?: unknown }).authorization, undefined);
});
