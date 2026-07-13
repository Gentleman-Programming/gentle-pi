import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { NativeReviewCliV212, type NativeReviewCli } from "../lib/native-review-cli.ts";
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

interface PublicationProbeRequestFixture {
	file: string;
	arguments: readonly string[];
	cwd: string;
	timeoutMs: number;
	maxBufferBytes: number;
	shell: false;
	signal?: AbortSignal;
}

interface PublicationProbeResultFixture {
	stdout: string;
	stderr: string;
	exitCode: number;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	outputLimitExceeded: boolean;
}

type PublicationProbeFixture = (request: PublicationProbeRequestFixture) => Promise<PublicationProbeResultFixture>;

function runtime(
	nativeReviewCli: NativeReviewCli | null,
	publicationProbe?: PublicationProbeFixture,
	publicationProbeTimeoutMs?: number,
	bashTimeRevalidationTimeoutMs?: number,
): Runtime {
	const tools = new Map<string, RegisteredTool>();
	let toolCall: ToolCallHandler | undefined;
	const dependencies = { nativeReviewCli, publicationProbe, publicationProbeTimeoutMs, bashTimeRevalidationTimeoutMs } as unknown as Parameters<typeof createGentleAiExtension>[0];
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

function context(cwd: string, signal?: AbortSignal): ExtensionContext {
	return { cwd, hasUI: false, signal, ui: { confirm: async () => true } } as unknown as ExtensionContext;
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
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", "initial"], { cwd });
	return cwd;
}

function git(cwd: string, ...arguments_: string[]): string {
	return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

function addBareRemote(t: test.TestContext, cwd: string, name: string): string {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-native-remote-"));
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const remote = join(parent, `${name}.git`);
	execFileSync("git", ["clone", "--bare", cwd, remote], { cwd: parent, stdio: "ignore" });
	git(cwd, "remote", "add", name, remote);
	git(cwd, "fetch", name);
	return remote;
}

function commitFile(cwd: string, path: string, content: string, message: string): void {
	writeFileSync(join(cwd, path), content);
	git(cwd, "add", path);
	git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", message);
}

function remoteIdentity(location: string): string {
	let normalized = location;
	try {
		const parsed = new URL(location);
		normalized = `${parsed.host.toLowerCase()}/${parsed.pathname.replace(/^\/+|\/+$/g, "")}`;
	} catch {
		const colon = location.indexOf(":");
		const slash = location.indexOf("/");
		if (colon > 0 && (slash < 0 || colon < slash)) {
			normalized = `${location.slice(0, colon).split("@").at(-1)!.toLowerCase()}/${location.slice(colon + 1)}`;
		}
	}
	normalized = normalized.replace(/\/+$/, "").replace(/\.git$/, "");
	return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function queuedPublicationProbe(rows: Readonly<Record<string, string>>, calls: PublicationProbeRequestFixture[] = []): PublicationProbeFixture {
	return async (request) => {
		calls.push(request);
		const ref = request.arguments.at(-1)!;
		const location = request.arguments.at(-2)!;
		const commit = rows[`${location} ${ref}`];
		return {
			stdout: commit === undefined ? "" : `${commit}\t${ref}\n`,
			stderr: "",
			exitCode: 0,
			signal: null,
			timedOut: false,
			outputLimitExceeded: false,
		};
	};
}

interface PrePrBoundaryFixture {
	selector: string;
	remote: string;
	remoteRef: string;
	commit: string;
	remoteIdentity: string;
}

function nativePrePrGateContext(boundary: PrePrBoundaryFixture): Awaited<ReturnType<NativeReviewCli["validate"]>>["gateContext"] {
	const gateContext = nativeGateContext();
	gateContext.raw.gate = "pre-pr";
	gateContext.raw.pre_pr_boundary = {
		source: "explicit",
		selector: boundary.selector,
		commit: boundary.commit,
		remote: boundary.remote,
		remote_ref: boundary.remoteRef,
		remote_identity: boundary.remoteIdentity,
	};
	return gateContext;
}

function fakeNative(overrides: Partial<NativeReviewCli> = {}): NativeReviewCli {
	return {
		start: async () => ({ lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4 }),
		finalize: async () => ({ lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" }),
		validate: async () => ({ allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() }),
		bindSdd: async () => ({ revision: "b1", change: "native-review-authority-parity", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeBindingGateContext() }),
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
	const finalize = await controller.execute("finalize", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ review_result: { lens_results: [{ findings: [], evidence: ["complete candidate reviewed"] }] } }) }, undefined, undefined, context(cwd));
	assert.deepEqual(finalize.details, { operation: "finalize", result: { lineage_id: "native-lineage", state: "approved", action: "approved", store_revision: "r1", receipt_path: "/opaque/receipt" } });
	assert.equal(starts, 1);
	assert.equal(finalizes, 1);
});

test("native FINALIZE emits exact v2.1.2 process documents and failed verification argv intent", async (t) => {
	const cwd = repository(t);
	const refuterBatch = {
		schema: "gentle-ai.refuter-result-batch/v1",
		request_hash: "a".repeat(64),
		results: [{ finding_id: "RISK-001", outcome: "inconclusive", proof_refs: ["differential-test:candidate still fails"] }],
	};
	const requests: Parameters<NativeReviewCli["finalize"]>[0][] = [];
	const { controller } = runtime(fakeNative({
		finalize: async (request) => {
			requests.push(request);
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}));
	const finding = { id: "RISK-001", lens: "review-risk", location: "lib/a.ts:1", severity: "CRITICAL", claim: "Candidate fails", evidence_class: "inferential", causal_disposition: "introduced", proof_refs: ["differential-test:candidate still fails"] };
	await controller.execute("finalize-v212", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({
		review_result: { lens_results: [{ lens: "review-risk", findings: [finding], evidence: ["complete candidate reviewed"] }], refuter_request_hash: "a".repeat(64) },
		refuter_batch: refuterBatch,
		validation: { request_hash: "b".repeat(64), correction_ids: ["RISK-001"], original_criteria: { passed: false, evidence: ["acceptance still fails"] }, correction_regression: { passed: true, evidence: ["regression suite passes"] }, fix_caused_findings: [], follow_ups: [{ finding_id: "RISK-001", location: "lib/a.ts:1", summary: "Track the remaining failure", proof_refs: ["differential-test:candidate still fails"] }] },
		final_evidence: "  focused verification failed\n\n",
		final_verification_passed: false,
	}) }, undefined, undefined, context(cwd));
	assert.deepEqual(requests, [{
		cwd,
		lineageId: "native-lineage",
		lensResults: [{ lens: "review-risk", document: { lens: "risk", findings: [{ ...finding, lens: "risk" }], evidence: ["complete candidate reviewed"] } }],
		refuterDocument: { results: refuterBatch.results },
		validationDocument: { original_criteria: { passed: false, evidence: ["acceptance still fails"] }, correction_regression: { passed: true, evidence: ["regression suite passes"] }, follow_ups: [{ observation: "Track the remaining failure", proof_refs: ["differential-test:candidate still fails"] }] },
		evidenceDocument: "  focused verification failed\n\n",
		failed: true,
	}]);
});

test("native FINALIZE rejects unpublished reviewer enums and empty arrays before native calls", async (t) => {
	const cwd = repository(t);
	let finalizes = 0;
	const { controller } = runtime(fakeNative({ finalize: async () => {
		finalizes += 1;
		return { lineageId: "native-lineage", state: "validating", action: "continue", storeRevision: "r1" };
	} }));
	const finding = { id: "RISK-001", lens: "review-risk", location: "lib/a.ts:1", severity: "CRITICAL", claim: "Candidate fails", evidence_class: "inferential", causal_disposition: "introduced", proof_refs: ["differential-test:candidate still fails"] };
	for (const lensResult of [
		{ lens: "review-unknown", findings: [finding], evidence: ["reviewed"] },
		{ lens: "review-risk", findings: [{ ...finding, lens: "review-unknown" }], evidence: ["reviewed"] },
		{ lens: "review-risk", findings: [{ ...finding, severity: "INFO" }], evidence: ["reviewed"] },
		{ lens: "review-risk", findings: [{ ...finding, evidence_class: "info" }], evidence: ["reviewed"] },
		{ lens: "review-risk", findings: [{ ...finding, evidence_class: "unknown" }], evidence: ["reviewed"] },
		{ lens: "review-risk", findings: [{ ...finding, causal_disposition: "candidate-caused" }], evidence: ["reviewed"] },
		{ lens: "review-risk", findings: [{ ...finding, proof_refs: [] }], evidence: ["reviewed"] },
		{ lens: "review-risk", findings: [], evidence: [] },
	]) {
		await assert.rejects(controller.execute("invalid-reviewer", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ review_result: { lens_results: [lensResult] } }) }, undefined, undefined, context(cwd)));
	}
	assert.equal(finalizes, 0);
});

test("native FINALIZE validates refuter request binding, completeness, and rows before native calls", async (t) => {
	const cwd = repository(t);
	let finalizes = 0;
	const { controller } = runtime(fakeNative({ finalize: async () => {
		finalizes += 1;
		return { lineageId: "native-lineage", state: "validating", action: "continue", storeRevision: "r1" };
	} }));
	const expectedHash = "a".repeat(64);
	const proof = "differential-test:candidate still fails";
	const finding = { id: "RISK-001", lens: "review-risk", location: "lib/a.ts:1", severity: "CRITICAL", claim: "Candidate fails", evidence_class: "inferential", causal_disposition: "introduced", proof_refs: [proof] };
	const row = { finding_id: finding.id, outcome: "corroborated", proof_refs: [proof] };
	for (const refuter_batch of [
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: "b".repeat(64), results: [row] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: expectedHash, results: [] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: expectedHash, results: [row, row] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: expectedHash, results: [{ ...row, finding_id: "RISK-002" }] },
		{ schema: "gentle-ai.refuter-result-batch/v1", request_hash: expectedHash, results: [{ ...row, proof_refs: [] }] },
	]) {
		await assert.rejects(controller.execute("invalid-refuter", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({
			review_result: { lens_results: [{ lens: "review-risk", findings: [finding], evidence: ["reviewed"] }], refuter_request_hash: expectedHash },
			refuter_batch,
		}) }, undefined, undefined, context(cwd)));
	}
	assert.equal(finalizes, 0);
});

test("controller preserves final evidence bytes through native staging", async (t) => {
	const cwd = repository(t);
	const evidence = " \tleading and trailing evidence\n\n";
	let staged = "";
	const native = new NativeReviewCliV212(async (request) => {
		if (request.arguments[0] === "version") return { stdout: "gentle-ai 2.1.2\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		const index = request.arguments.indexOf("--evidence");
		assert.ok(index >= 0);
		staged = readFileSync(request.arguments[index + 1]!, "utf8");
		return { stdout: JSON.stringify({ operation: "review/finalize", lineage_id: "native-lineage", state: "approved", action: "validate delivery", store_revision: "sha256:" + "a".repeat(64) }), stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
	});
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

test("repeated native FINALIZE keeps initial lenses one-shot", async (t) => {
	const cwd = repository(t);
	const requests: Parameters<NativeReviewCli["finalize"]>[0][] = [];
	const { controller } = runtime(fakeNative({ finalize: async (request) => {
		requests.push(request);
		return { lineageId: "native-lineage", state: "correction_required", action: "continue correction", storeRevision: `r${requests.length}` };
	} }));
	await controller.execute("initial", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ review_result: { lens_results: [{ findings: [], evidence: ["complete candidate reviewed"] }] } }) }, undefined, undefined, context(cwd));
	await controller.execute("retry", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ correction_line_forecast: 1 }) }, undefined, undefined, context(cwd));
	assert.equal(requests[0]?.lensResults?.length, 1);
	assert.equal(requests[1]?.lensResults, undefined);
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
				native_contract: "gentle-ai/2.1.2",
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
			return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() };
		},
	}));
	const command = "git commit -m native";
	const validated = await controller.execute("validate", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((validated.details as { authorization?: unknown }).authorization, undefined);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, interactiveContext(cwd)), undefined);
	const replay = await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean };
	assert.equal(replay.block, true);
	assert.equal(validates, 2);
});

test("native gate context mismatches create zero controller authorizations", async (t) => {
	for (const returnedGate of ["", "pre-push"]) {
		await t.test(returnedGate || "empty", async (t) => {
			const cwd = repository(t);
			const command = "git commit -m native";
			const { controller, toolCall } = runtime(fakeNative({
				validate: async () => {
					const gateContext = nativeGateContext();
					gateContext.raw.gate = returnedGate;
					return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
				},
			}));
			const result = await controller.execute("wrong-gate", { operation: "validate", lineageId: "native-lineage", idempotencyKey: returnedGate || "empty", command, input: "{}" }, undefined, undefined, context(cwd));
			assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
			assert.equal((result.details as { status?: string }).status, "blocked");
			assert.equal((await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
		});
	}
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

test("native bind treats malformed or mismatched post-call evidence as committed-or-ambiguous", async (t) => {
	const cwd = repository(t);
	mkdirSync(join(cwd, "openspec", "changes", "native-review-authority-parity"), { recursive: true });
	let bindCalls = 0;
	const { controller } = runtime(fakeNative({
		bindSdd: async () => {
			bindCalls += 1;
			return bindCalls === 1
				? { revision: "b1", change: "other-change", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeBindingGateContext() }
				: { revision: "", change: "native-review-authority-parity", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeBindingGateContext() };
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

test("native lifecycle routing blocks review and accepts verify/archive as post-review authority", async (t) => {
	const cwd = repository(t);
	const change = "native-review-authority-parity";
	const root = join(cwd, "openspec", "changes", change);
	mkdirSync(join(root, "specs", "review"), { recursive: true });
	writeFileSync(join(root, "proposal.md"), "# Proposal\n");
	writeFileSync(join(root, "specs", "review", "spec.md"), "# Spec\n");
	writeFileSync(join(root, "design.md"), "# Design\n");
	writeFileSync(join(root, "tasks.md"), "- [x] done\n");
	const nativeStatus = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "native-review-cli", "v2.1.2", "sdd-status.json"), "utf8")) as Record<string, unknown>;
	const client = (nextRecommended: "review" | "verify" | "archive") => new NativeReviewCliV212(async (request) => ({
		stdout: request.arguments[0] === "version" ? "gentle-ai 2.1.2\n" : JSON.stringify({ ...nativeStatus, nextRecommended }),
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
		const stalled = new NativeReviewCliV212(async (request) => {
			const operation = request.arguments[0]!;
			requests.push({ operation, signal: request.signal });
			if (operation === "version" && stalledOperation === "sdd-status") {
				return { stdout: "gentle-ai 2.1.2\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
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

test("native pre-PR validation uses and binds the exact advertised ordinary base on both validations", async (t) => {
	const cwd = repository(t);
	const origin = addBareRemote(t, cwd, "origin");
	const baseCommit = git(cwd, "rev-parse", "main");
	execFileSync("git", ["checkout", "-b", "feature"], { cwd });
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "push", "origin", "feature:refs/heads/feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const requests: Array<{ flags?: readonly string[] }> = [];
	let validates = 0;
	const boundary = { selector: "origin/main", remote: "origin", remoteRef: "refs/heads/main", commit: baseCommit, remoteIdentity: remoteIdentity(origin) };
	const { controller, toolCall } = runtime(fakeNative({
		validate: async (request) => {
			requests.push(request);
			validates += 1;
			return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
		},
	}));
	const command = "gh pr create --base main --head feature";
	const validated = await controller.execute("validate", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((validated.details as { authorization?: unknown }).authorization, undefined);
	assert.deepEqual(requests[0]?.flags, ["--base-ref", "origin/main"]);
	assert.equal((await toolCall({ toolName: "bash", input: { command: "gh pr create --base feature --head main" } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, context(cwd)), undefined);
	assert.deepEqual(requests[1]?.flags, ["--base-ref", "origin/main"]);
	assert.equal(validates, 2);
});

test("native pre-PR derives fork and chained bases from the gh repository context", async (t) => {
	await t.test("fork", async (t) => {
		const cwd = repository(t);
		addBareRemote(t, cwd, "upstream");
		const upstream = "git@github.com:base-owner/project.git";
		git(cwd, "remote", "set-url", "upstream", upstream);
		const baseCommit = git(cwd, "rev-parse", "main");
		git(cwd, "remote", "add", "origin", "git@github.com:fork-owner/project.git");
		git(cwd, "config", "remote.upstream.gh-resolved", "base");
		git(cwd, "checkout", "-b", "feature");
		commitFile(cwd, "fork.ts", "export const fork = true;\n", "fork feature");
		git(cwd, "config", "branch.feature.pushRemote", "origin");
		const headCommit = git(cwd, "rev-parse", "HEAD");
		const requests: Array<{ flags?: readonly string[] }> = [];
		const boundary = { selector: "upstream/main", remote: "upstream", remoteRef: "refs/heads/main", commit: baseCommit, remoteIdentity: remoteIdentity(upstream) };
		const origin = "git@github.com:fork-owner/project.git";
		const probe = queuedPublicationProbe({
			[`${upstream} refs/heads/main`]: baseCommit,
			[`${origin} refs/heads/feature`]: headCommit,
		});
		const { controller } = runtime(fakeNative({ validate: async (request) => {
			requests.push(request);
			return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
		} }), probe);
		const command = "gh pr create --base main --head fork-owner:feature";
		const result = await controller.execute("fork-pr", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "fork", command, input: "{}" }, undefined, undefined, context(cwd));
		assert.notEqual((result.details as { authorization?: unknown }).authorization, undefined);
		assert.deepEqual(requests[0]?.flags, ["--base-ref", "upstream/main"]);
	});

	await t.test("chain", async (t) => {
		const cwd = repository(t);
		const upstream = addBareRemote(t, cwd, "upstream");
		git(cwd, "config", "remote.upstream.gh-resolved", "base");
		git(cwd, "checkout", "-b", "parent");
		commitFile(cwd, "parent.ts", "export const parent = true;\n", "parent");
		const parentCommit = git(cwd, "rev-parse", "HEAD");
		git(cwd, "push", "upstream", "parent:refs/heads/parent");
		git(cwd, "fetch", "upstream", "parent");
		git(cwd, "checkout", "-b", "child");
		commitFile(cwd, "child.ts", "export const child = true;\n", "child");
		git(cwd, "push", "upstream", "child:refs/heads/child");
		git(cwd, "config", "branch.child.pushRemote", "upstream");
		const requests: Array<{ flags?: readonly string[] }> = [];
		const boundary = { selector: "upstream/parent", remote: "upstream", remoteRef: "refs/heads/parent", commit: parentCommit, remoteIdentity: remoteIdentity(upstream) };
		const { controller } = runtime(fakeNative({ validate: async (request) => {
			requests.push(request);
			return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
		} }));
		const command = "gh pr create --base parent --head child";
		const result = await controller.execute("chain-pr", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "chain", command, input: "{}" }, undefined, undefined, context(cwd));
		assert.notEqual((result.details as { authorization?: unknown }).authorization, undefined);
		assert.deepEqual(requests[0]?.flags, ["--base-ref", "upstream/parent"]);
	});
});

test("native pre-PR rejects non-branch and ambiguous bases before invocation", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	addBareRemote(t, cwd, "upstream");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "push", "origin", "feature:refs/heads/feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	let calls = 0;
	const { controller } = runtime(fakeNative({ validate: async () => {
		calls += 1;
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() };
	} }));
	for (const base of ["refs/heads/main", git(cwd, "rev-parse", "main"), "main"]) {
		try {
			const result = await controller.execute(`invalid-${base}`, { operation: "validate", lineageId: "native-lineage", idempotencyKey: base, command: `gh pr create --base ${base} --head feature`, input: "{}" }, undefined, undefined, context(cwd));
			assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
		} catch (error) {
			assert.match(error instanceof Error ? error.message : String(error), /base|advertised/i);
		}
	}
	assert.equal(calls, 0);
});

test("native pre-PR rejects non-branch heads and owner-qualified heads without a proven repository mapping", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "push", "origin", "feature:refs/heads/feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	let calls = 0;
	const { controller } = runtime(fakeNative({ validate: async () => {
		calls += 1;
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() };
	} }));
	for (const head of ["refs/heads/feature", git(cwd, "rev-parse", "HEAD"), "fork-owner:feature"]) {
		try {
			const result = await controller.execute(`invalid-head-${head}`, { operation: "validate", lineageId: "native-lineage", idempotencyKey: head, command: `gh pr create --base main --head ${head}`, input: "{}" }, undefined, undefined, context(cwd));
			assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
		} catch (error) {
			assert.match(error instanceof Error ? error.message : String(error), /head|repository/i);
		}
	}
	assert.equal(calls, 0);
});

test("native pre-PR refuses a returned publication boundary that differs from the command target", async (t) => {
	const cwd = repository(t);
	const origin = addBareRemote(t, cwd, "origin");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const wrong = { selector: "origin/main", remote: "origin", remoteRef: "refs/heads/main", commit: git(cwd, "rev-parse", "feature"), remoteIdentity: remoteIdentity(origin) };
	const { controller } = runtime(fakeNative({ validate: async () => ({ allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(wrong) }) }));
	const result = await controller.execute("wrong-boundary", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "wrong", command: "gh pr create --base main --head feature", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
});

test("native pre-push binds the exact existing destination as its advertised base", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	git(cwd, "push", "origin", "main:refs/heads/feature");
	git(cwd, "fetch", "origin", "feature");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	git(cwd, "config", "branch.feature.remote", "origin");
	git(cwd, "config", "branch.feature.merge", "refs/heads/main");
	const requests: Array<{ flags?: readonly string[] }> = [];
	const { controller, toolCall } = runtime(fakeNative({ validate: async (request) => {
		requests.push(request);
		const gateContext = nativeGateContext();
		gateContext.raw.gate = "pre-push";
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
	} }));
	const command = "git push origin feature:refs/heads/feature";
	const validated = await controller.execute("pre-push", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "push", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((validated.details as { authorization?: unknown }).authorization, undefined);
	assert.deepEqual(requests[0]?.flags, ["--base-ref", "origin/feature"]);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, interactiveContext(cwd)), undefined);
	assert.deepEqual(requests[1]?.flags, ["--base-ref", "origin/feature"]);
});

test("native pre-push rejects split fetch/push endpoints before native validation", async (t) => {
	for (const [shape, command] of [
		["ordinary", "git push origin feature:refs/heads/main"],
		["force", "git push --force origin feature:refs/heads/main"],
	] as const) {
		await t.test(shape, async (t) => {
			const cwd = repository(t);
			addBareRemote(t, cwd, "origin");
			const pushEndpoint = addBareRemote(t, cwd, "publication");
			git(cwd, "checkout", "-b", "feature");
			commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
			git(cwd, "config", "remote.origin.pushurl", pushEndpoint);
			git(cwd, "config", "branch.feature.pushRemote", "origin");
			const probes: PublicationProbeRequestFixture[] = [];
			let validations = 0;
			const { controller } = runtime(fakeNative({ validate: async () => {
				validations += 1;
				const gateContext = nativeGateContext();
				gateContext.raw.gate = "pre-push";
				return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
			} }), queuedPublicationProbe({}, probes));
			const response = await controller.execute(`split-${shape}`, { operation: "validate", lineageId: "native-lineage", idempotencyKey: `split-${shape}`, command, input: "{}" }, undefined, undefined, context(cwd));
			const details = response.details as Record<string, unknown>;
			assert.equal(details.outcome, "native-split-fetch-push-unsupported");
			assert.equal(details.next_action, "native-split-fetch-push-unsupported-until-upstream-supports-explicit-push-base");
			assert.match(String(details.reason), /upstream.*base-ref.*fetch-side/i);
			assert.equal(details.authorization, undefined);
			assert.equal(validations, 0);
			assert.equal(probes.length, 0);
		});
	}
});

test("native pre-PR keeps fetch-side probes when the push URL diverges", async (t) => {
	const cwd = repository(t);
	const fetchEndpoint = addBareRemote(t, cwd, "origin");
	const pushEndpoint = addBareRemote(t, cwd, "publication");
	const baseCommit = git(cwd, "rev-parse", "main");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	const headCommit = git(cwd, "rev-parse", "HEAD");
	git(cwd, "push", fetchEndpoint, "feature:refs/heads/feature");
	git(cwd, "config", "remote.origin.pushurl", pushEndpoint);
	git(cwd, "config", "remote.origin.gh-resolved", "base");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const probes: PublicationProbeRequestFixture[] = [];
	const probe = queuedPublicationProbe({
		[`${fetchEndpoint} refs/heads/main`]: baseCommit,
		[`${fetchEndpoint} refs/heads/feature`]: headCommit,
	}, probes);
	const boundary = { selector: "origin/main", remote: "origin", remoteRef: "refs/heads/main", commit: baseCommit, remoteIdentity: remoteIdentity(fetchEndpoint) };
	const { controller } = runtime(fakeNative({ validate: async () => ({ allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) }) }), probe);
	const result = await controller.execute("pre-pr-fetch-side", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "pre-pr-fetch-side", command: "gh pr create --base main --head feature", input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((result.details as { authorization?: unknown }).authorization, undefined);
	assert.equal(probes.length > 0, true);
	assert.equal(probes.every((request) => request.arguments.includes(fetchEndpoint)), true);
	assert.equal(probes.some((request) => request.arguments.includes(pushEndpoint)), false);
});

test("native pre-push rejects an older existing destination instead of validating from a reviewed parent", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	git(cwd, "checkout", "-b", "parent");
	commitFile(cwd, "parent.ts", "export const parent = true;\n", "parent");
	git(cwd, "push", "origin", "parent:refs/heads/parent");
	git(cwd, "fetch", "origin", "parent");
	git(cwd, "checkout", "-b", "child");
	commitFile(cwd, "child.ts", "export const child = true;\n", "child");
	git(cwd, "config", "branch.child.pushRemote", "origin");
	git(cwd, "config", "branch.child.remote", "origin");
	git(cwd, "config", "branch.child.merge", "refs/heads/parent");
	const requests: Array<{ flags?: readonly string[] }> = [];
	const { controller } = runtime(fakeNative({ validate: async (request) => {
		requests.push(request);
		const gateContext = nativeGateContext();
		gateContext.raw.gate = "pre-push";
		const exactDestination = request.flags?.[1] === "origin/main";
		return exactDestination
			? { allowed: false, result: "scope-changed", action: "create-new-lineage", reason: "destination range predates reviewed parent", gateContext }
			: { allowed: true, result: "allow", action: "continue", reason: "wrong parent range", gateContext };
	} }));
	const command = "git push origin child:refs/heads/main";
	const result = await controller.execute("older-destination", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "older-destination", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
	assert.deepEqual(requests.map((request) => request.flags), [["--base-ref", "origin/main"]]);
});

test("native pre-push rederives the bound destination range at bash time", async (t) => {
	const cwd = repository(t);
	const origin = addBareRemote(t, cwd, "origin");
	git(cwd, "push", "origin", "main:refs/heads/feature");
	git(cwd, "fetch", "origin", "feature");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	const featureCommit = git(cwd, "rev-parse", "HEAD");
	git(cwd, "push", "origin", "feature:refs/heads/moved");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	let validates = 0;
	const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
		validates += 1;
		const gateContext = nativeGateContext();
		gateContext.raw.gate = "pre-push";
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
	} }));
	const command = "git push origin feature:refs/heads/feature";
	const authorized = await controller.execute("bind-range", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "bind-range", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((authorized.details as { authorization?: unknown }).authorization, undefined);
	git(cwd, "--git-dir", origin, "update-ref", "refs/heads/feature", featureCommit);
	assert.equal((await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal(validates, 1);
});

test("native first pushes fail closed without a persisted explicit advertised base", async (t) => {
	await t.test("first push", async (t) => {
		const cwd = repository(t);
		const origin = addBareRemote(t, cwd, "origin");
		git(cwd, "update-ref", "-d", "refs/remotes/origin/main");
		git(cwd, "checkout", "-b", "feature");
		commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
		git(cwd, "config", "branch.feature.pushRemote", "origin");
		mkdirSync(join(cwd, ".gentle-ai", "reviews"), { recursive: true });
		writeFileSync(join(cwd, ".gentle-ai", "reviews", "operational.tmp"), "ignored\n");
		writeFileSync(join(cwd, ".git", "info", "exclude"), ".gentle-ai/\n");
		let validates = 0;
		const probes: PublicationProbeRequestFixture[] = [];
		const { controller } = runtime(fakeNative({ validate: async (request) => {
			void request;
			validates += 1;
			return { allowed: false, result: "scope-changed", action: "create-new-lineage", reason: "native owns ignored-state parsing", gateContext: nativeGateContext() };
		} }), queuedPublicationProbe({ [`${origin} refs/heads/main`]: git(cwd, "rev-parse", "main") }, probes));
		const result = await controller.execute("first-push", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "first", command: "git push origin feature:refs/heads/feature", input: "{}" }, undefined, undefined, context(cwd));
		const details = result.details as Record<string, unknown>;
		assert.equal(details.outcome, "native-publication-base-required");
		assert.equal(details.next_action, "native-first-push-unsupported-until-persisted-advertised-base-exists");
		assert.match(String(details.reason), /unsupported until Pi has a persisted explicit advertised-base source/i);
		assert.equal(validates, 0);
		assert.equal(probes.length, 0);
	});

	await t.test("chained first push", async (t) => {
		const cwd = repository(t);
		const origin = addBareRemote(t, cwd, "origin");
		git(cwd, "checkout", "-b", "parent");
		commitFile(cwd, "parent.ts", "export const parent = true;\n", "parent");
		const parentCommit = git(cwd, "rev-parse", "HEAD");
		git(cwd, "push", "origin", "parent:refs/heads/parent");
		git(cwd, "fetch", "origin", "parent");
		git(cwd, "checkout", "-b", "child");
		commitFile(cwd, "child.ts", "export const child = true;\n", "child");
		git(cwd, "config", "branch.child.pushRemote", "origin");
		let validates = 0;
		const probes: PublicationProbeRequestFixture[] = [];
		const { controller } = runtime(fakeNative({ validate: async (request) => {
			void request;
			validates += 1;
			return { allowed: false, result: "scope-changed", action: "create-new-lineage", reason: "test", gateContext: nativeGateContext() };
		} }), queuedPublicationProbe({ [`${origin} refs/heads/parent`]: parentCommit }, probes));
		const result = await controller.execute("chain-push", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "chain", command: "git push origin child:refs/heads/child", input: "{}" }, undefined, undefined, context(cwd));
		const details = result.details as Record<string, unknown>;
		assert.equal(details.outcome, "native-publication-base-required");
		assert.equal(details.next_action, "native-first-push-unsupported-until-persisted-advertised-base-exists");
		assert.match(String(details.reason), /unsupported until Pi has a persisted explicit advertised-base source/i);
		assert.equal(validates, 0);
		assert.equal(probes.length, 0);
	});
});

test("native pre-PR command binding detects push destination movement before bash-time revalidation", async (t) => {
	for (const movement of ["pushurl", "pushRemote"] as const) {
		await t.test(movement, async (t) => {
			const cwd = repository(t);
			const origin = addBareRemote(t, cwd, "origin");
			const replacement = addBareRemote(t, cwd, "replacement");
			git(cwd, "config", "remote.origin.gh-resolved", "base");
			git(cwd, "checkout", "-b", "feature");
			commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
			git(cwd, "push", "origin", "feature:refs/heads/feature");
			git(cwd, "config", "branch.feature.pushRemote", "origin");
			const boundary = { selector: "origin/main", remote: "origin", remoteRef: "refs/heads/main", commit: git(cwd, "rev-parse", "main"), remoteIdentity: remoteIdentity(origin) };
			let calls = 0;
			const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
				calls += 1;
				if (calls === 1) {
					if (movement === "pushurl") git(cwd, "config", "remote.origin.pushurl", replacement);
					else git(cwd, "config", "branch.feature.pushRemote", "replacement");
				}
				return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
			} }));
			const command = "gh pr create --base main --head feature";
			await controller.execute(movement, { operation: "validate", lineageId: "native-lineage", idempotencyKey: movement, command, input: "{}" }, undefined, undefined, context(cwd));
			const result = await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean };
			assert.equal(result.block, true);
			assert.equal(calls, 1);
		});
	}
});

test("repository publication identity matches v2.1.2 URL host and scp vectors", () => {
	const vectors = [
		["https://user:secret@example.com:8443/Owner/Repo.git", "sha256:3e219f5a846e2947fe5d3d92ec5e30197b3d25b9f303c2cc42cdb7d7783297bc"],
		["ssh://git@example.com:2222/Owner/Repo.git", "sha256:6ff118a31fd1ce7bd58c6709495b63bbdcf9bd2e0a2b1976e56acd356e76ad93"],
		["git@example.com:Owner/Repo.git", "sha256:2bceb05941bfaf7b288b5844de9cbccb96a1adcd0e31f4fe5995edd019727a73"],
	] as const;
	for (const [location, expected] of vectors) {
		assert.equal((__testing as unknown as { repositoryLocationIdentity: (cwd: string, location: string) => string }).repositoryLocationIdentity("/repo", location), expected);
	}
});

test("native pre-PR binds GH_REPO precedence and rejects environment drift", async (t) => {
	const cwd = repository(t);
	const originPath = addBareRemote(t, cwd, "origin");
	const upstreamPath = addBareRemote(t, cwd, "upstream");
	const origin = "git@github.com:wrong-owner/project.git";
	const upstream = "ssh://git@github.example.com:2222/target-owner/project.git";
	git(cwd, "remote", "set-url", "origin", origin);
	git(cwd, "remote", "set-url", "upstream", upstream);
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const baseCommit = git(cwd, "rev-parse", "main");
	const headCommit = git(cwd, "rev-parse", "HEAD");
	const calls: PublicationProbeRequestFixture[] = [];
	const probe = queuedPublicationProbe({
		[`${origin} refs/heads/main`]: baseCommit,
		[`${origin} refs/heads/feature`]: headCommit,
		[`${upstream} refs/heads/main`]: baseCommit,
		[`${upstream} refs/heads/feature`]: headCommit,
	}, calls);
	const boundary = { selector: "upstream/main", remote: "upstream", remoteRef: "refs/heads/main", commit: baseCommit, remoteIdentity: remoteIdentity(upstream) };
	let validates = 0;
	const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
		validates += 1;
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
	} }), probe);
	const previous = process.env.GH_REPO;
	t.after(() => {
		if (previous === undefined) delete process.env.GH_REPO;
		else process.env.GH_REPO = previous;
		void originPath;
		void upstreamPath;
	});
	process.env.GH_REPO = "github.example.com:2222/target-owner/project";
	const command = "gh pr create --base main --head feature";
	const authorized = await controller.execute("gh-repo", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "gh-repo", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((authorized.details as { authorization?: unknown }).authorization, undefined);
	assert.equal(calls.some((call) => call.arguments.includes(upstream)), true);
	process.env.GH_REPO = "wrong-owner/project";
	assert.equal((await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal(validates, 1);
});

test("explicit --repo overrides GH_REPO while malformed, duplicate, and unmapped targets fail before native validation", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	const upstreamPath = addBareRemote(t, cwd, "upstream");
	const upstream = "ssh://git@github.example.com:2222/target-owner/project.git";
	git(cwd, "remote", "set-url", "upstream", upstream);
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const baseCommit = git(cwd, "rev-parse", "main");
	const headCommit = git(cwd, "rev-parse", "HEAD");
	const probe = queuedPublicationProbe({
		[`${upstream} refs/heads/main`]: baseCommit,
		[`${upstream} refs/heads/feature`]: headCommit,
	});
	const boundary = { selector: "upstream/main", remote: "upstream", remoteRef: "refs/heads/main", commit: baseCommit, remoteIdentity: remoteIdentity(upstream) };
	let validates = 0;
	const { controller } = runtime(fakeNative({ validate: async () => {
		validates += 1;
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
	} }), probe);
	const previous = process.env.GH_REPO;
	t.after(() => {
		if (previous === undefined) delete process.env.GH_REPO;
		else process.env.GH_REPO = previous;
		void upstreamPath;
	});
	process.env.GH_REPO = "https://malformed.example/owner/repo";
	const malformed = await controller.execute("malformed-env", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "malformed-env", command: "gh pr create --base main --head feature", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((malformed.details as { authorization?: unknown }).authorization, undefined);
	const explicit = "gh pr create --repo github.example.com:2222/target-owner/project --base main --head feature";
	const explicitResult = await controller.execute("explicit", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "explicit", command: explicit, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((explicitResult.details as { authorization?: unknown }).authorization, undefined);
	for (const [id, command] of [
		["duplicate", "gh pr create --repo target-owner/project --repo wrong-owner/project --base main --head feature"],
		["unmapped", "gh pr create --repo missing-owner/project --base main --head feature"],
	] as const) {
		const result = await controller.execute(id, { operation: "validate", lineageId: "native-lineage", idempotencyKey: id, command, input: "{}" }, undefined, undefined, context(cwd));
		assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
	}
	assert.equal(validates, 1);
});

test("native pre-PR rejects missing, stale, and divergent advertised remote heads before native validation", async (t) => {
	for (const shape of ["missing", "stale", "divergent"] as const) {
		await t.test(shape, async (t) => {
			const cwd = repository(t);
			const origin = addBareRemote(t, cwd, "origin");
			const baseCommit = git(cwd, "rev-parse", "main");
			git(cwd, "checkout", "-b", "feature");
			commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
			git(cwd, "config", "branch.feature.pushRemote", "origin");
			if (shape === "stale") git(cwd, "--git-dir", origin, "update-ref", "refs/heads/feature", baseCommit);
			if (shape === "divergent") {
				git(cwd, "checkout", "-b", "divergent", "main");
				commitFile(cwd, "divergent.ts", "export const divergent = true;\n", "divergent");
				git(cwd, "push", "origin", "+divergent:refs/heads/feature");
				git(cwd, "checkout", "feature");
			}
			let validates = 0;
			const { controller } = runtime(fakeNative({ validate: async () => {
				validates += 1;
				return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() };
			} }));
			const result = await controller.execute(shape, { operation: "validate", lineageId: "native-lineage", idempotencyKey: shape, command: "gh pr create --base main --head feature", input: "{}" }, undefined, undefined, context(cwd));
			assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
			assert.equal(validates, 0);
		});
	}
});

test("native pre-PR re-probes the advertised head and denies a bash-time race", async (t) => {
	const cwd = repository(t);
	const origin = addBareRemote(t, cwd, "origin");
	const baseCommit = git(cwd, "rev-parse", "main");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "push", "origin", "feature:refs/heads/feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const boundary = { selector: "origin/main", remote: "origin", remoteRef: "refs/heads/main", commit: baseCommit, remoteIdentity: remoteIdentity(origin) };
	let validates = 0;
	const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
		validates += 1;
		if (validates === 1) git(cwd, "--git-dir", origin, "update-ref", "refs/heads/feature", baseCommit);
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
	} }));
	const command = "gh pr create --base main --head feature";
	const result = await controller.execute("head-race", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "head-race", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
	assert.equal((await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal(validates, 1);
});

test("native pre-PR denies remote-head movement during the second native validation", async (t) => {
	const cwd = repository(t);
	const origin = addBareRemote(t, cwd, "origin");
	const baseCommit = git(cwd, "rev-parse", "main");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "push", "origin", "feature:refs/heads/feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const boundary = { selector: "origin/main", remote: "origin", remoteRef: "refs/heads/main", commit: baseCommit, remoteIdentity: remoteIdentity(origin) };
	let validates = 0;
	const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
		validates += 1;
		if (validates === 2) git(cwd, "--git-dir", origin, "update-ref", "refs/heads/feature", baseCommit);
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativePrePrGateContext(boundary) };
	} }));
	const command = "gh pr create --base main --head feature";
	const authorized = await controller.execute("head-during-native", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "head-during-native", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((authorized.details as { authorization?: unknown }).authorization, undefined);
	assert.equal((await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal((await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);
	assert.equal(validates, 2);
});

test("publication probes are fixed-argv, shell-free, bounded, and controller-cancellable", async (t) => {
	for (const mode of ["timeout", "cancel"] as const) {
		await t.test(mode, async (t) => {
			const cwd = repository(t);
			addBareRemote(t, cwd, "origin");
			git(cwd, "checkout", "-b", "feature");
			commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
			git(cwd, "config", "branch.feature.pushRemote", "origin");
			const abort = new AbortController();
			const requests: PublicationProbeRequestFixture[] = [];
			const stalled: PublicationProbeFixture = (request) => {
				requests.push(request);
				if (mode === "cancel") abort.abort();
				return new Promise((_resolve, reject) => {
					const cancel = () => {
						const error = new Error("aborted publication probe");
						error.name = "AbortError";
						reject(error);
					};
					if (request.signal?.aborted) cancel();
					else request.signal?.addEventListener("abort", cancel, { once: true });
				});
			};
			let validates = 0;
			const { controller } = runtime(fakeNative({ validate: async () => {
				validates += 1;
				return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() };
			} }), stalled, 5);
			const result = await controller.execute(mode, { operation: "validate", lineageId: "native-lineage", idempotencyKey: mode, command: "gh pr create --base main --head feature", input: "{}" }, mode === "cancel" ? abort.signal : undefined, undefined, context(cwd));
			assert.equal((result.details as { authorization?: unknown }).authorization, undefined);
			assert.equal(validates, 0);
			assert.equal(requests.length, 1);
			assert.deepEqual(requests[0]?.arguments.slice(0, 2), ["ls-remote", "--heads"]);
			assert.equal(requests[0]?.file, "git");
			assert.equal(requests[0]?.shell, false);
			assert.equal(requests[0]?.timeoutMs, 5);
		});
	}
});

test("publication probe timeout and cancellation preserve typed fail-closed errors", async () => {
	const testing = __testing as unknown as {
		runPublicationProbeGit: (
			cwd: string,
			arguments_: readonly string[],
			probe: PublicationProbeFixture,
			timeoutMs: number,
			signal?: AbortSignal,
		) => Promise<string>;
		publicationProbeErrorCode: { TIMEOUT: string; CANCELLED: string };
	};
	for (const mode of ["timeout", "cancel"] as const) {
		const abort = new AbortController();
		const stalled: PublicationProbeFixture = (request) => {
			if (mode === "cancel") abort.abort();
			return new Promise((_resolve, reject) => {
				const cancel = () => {
					const error = new Error("aborted publication probe");
					error.name = "AbortError";
					reject(error);
				};
				if (request.signal?.aborted) cancel();
				else request.signal?.addEventListener("abort", cancel, { once: true });
			});
		};
		await assert.rejects(
			() => testing.runPublicationProbeGit("/repo", ["ls-remote", "--heads", "remote", "refs/heads/main"], stalled, 5, mode === "cancel" ? abort.signal : undefined),
			(error: unknown) => error instanceof Error &&
				error.name === "PublicationProbeError" &&
				"code" in error &&
				error.code === (mode === "cancel" ? testing.publicationProbeErrorCode.CANCELLED : testing.publicationProbeErrorCode.TIMEOUT),
		);
	}
});

test("native pre-push fails closed on remote disagreement and absent destinations", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	addBareRemote(t, cwd, "upstream");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	let calls = 0;
	const { controller } = runtime(fakeNative({ validate: async () => {
		calls += 1;
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() };
	} }));
	git(cwd, "config", "branch.feature.pushRemote", "upstream");
	const remoteMismatch = await controller.execute("remote-mismatch", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "remote", command: "git push origin feature:refs/heads/feature", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((remoteMismatch.details as { authorization?: unknown }).authorization, undefined);
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const absent = await controller.execute("absent-destination", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "base", command: "git push origin feature:refs/heads/feature", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((absent.details as { authorization?: unknown }).authorization, undefined);
	assert.equal((absent.details as { outcome?: string }).outcome, "native-publication-base-required");
	assert.equal(calls, 0);
});

test("native lifecycle authorization detects pushurl, remote, HEAD, and advertised-base movement", async (t) => {
	for (const movement of ["pushurl", "remote", "head", "advertised-base"] as const) {
		await t.test(movement, async (t) => {
			const cwd = repository(t);
			const origin = addBareRemote(t, cwd, "origin");
			const replacement = addBareRemote(t, cwd, "replacement");
			git(cwd, "push", "origin", "main:refs/heads/feature");
			git(cwd, "fetch", "origin", "feature");
			git(cwd, "checkout", "-b", "feature");
			commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
			git(cwd, "config", "branch.feature.pushRemote", "origin");
			git(cwd, "config", "branch.feature.remote", "origin");
			git(cwd, "config", "branch.feature.merge", "refs/heads/main");
			if (movement === "advertised-base") git(cwd, "push", "origin", "feature:refs/heads/moved");
			let calls = 0;
			const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
				calls += 1;
				if (calls === 1) {
					if (movement === "pushurl") git(cwd, "config", "remote.origin.pushurl", replacement);
					if (movement === "remote") git(cwd, "config", "branch.feature.pushRemote", "replacement");
					if (movement === "head") git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "--allow-empty", "-m", "move head");
					if (movement === "advertised-base") git(cwd, "--git-dir", origin, "update-ref", "refs/heads/feature", git(cwd, "rev-parse", "feature"));
				}
				const gateContext = nativeGateContext();
				gateContext.raw.gate = "pre-push";
				return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
			} }));
			const command = "git push origin feature:refs/heads/feature";
			await controller.execute(`authorize-${movement}`, { operation: "validate", lineageId: "native-lineage", idempotencyKey: movement, command, input: "{}" }, undefined, undefined, context(cwd));
			const result = await toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean };
			assert.equal(result.block, true);
			assert.equal(calls, 1);
		});
	}
});

test("native adapter preserves ancestry-sensitive hidden, reverted, and empty delivery requests", async (t) => {
	for (const shape of ["hidden", "reverted", "empty"] as const) {
		await t.test(shape, async (t) => {
			const cwd = repository(t);
			addBareRemote(t, cwd, "origin");
			git(cwd, "push", "origin", "main:refs/heads/feature");
			git(cwd, "fetch", "origin", "feature");
			git(cwd, "checkout", "-b", "feature");
			if (shape === "empty") {
				git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "--allow-empty", "-m", "empty delivery");
			} else {
				commitFile(cwd, "shape.ts", "export const shape = true;\n", `${shape} candidate`);
				if (shape === "reverted") git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "revert", "--no-edit", "HEAD");
				if (shape === "hidden") {
					rmSync(join(cwd, "shape.ts"));
					git(cwd, "add", "-A");
					git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit", "-m", "hide prior tree delta");
				}
			}
			git(cwd, "config", "branch.feature.pushRemote", "origin");
			const requests: Array<{ flags?: readonly string[] }> = [];
			const { controller } = runtime(fakeNative({ validate: async (request) => {
				requests.push(request);
				return { allowed: false, result: "scope-changed", action: "create-new-lineage", reason: "native checks the complete commit range", gateContext: nativeGateContext() };
			} }));
			await controller.execute(shape, { operation: "validate", lineageId: "native-lineage", idempotencyKey: shape, command: "git push origin feature:refs/heads/feature", input: "{}" }, undefined, undefined, context(cwd));
			assert.deepEqual(requests[0]?.flags, ["--base-ref", "origin/feature"]);
		});
	}
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

test("production tool_call forwards Pi cancellation and enforces one bash-time deadline", async (t) => {
	for (const mode of ["external-cancellation", "aggregate-deadline"] as const) {
		await t.test(mode, async (t) => {
			const cwd = repository(t);
			const external = new AbortController();
			let validations = 0;
			let receivedSignal: AbortSignal | undefined;
			const native = fakeNative({ validate: async (request) => {
				validations += 1;
				if (validations === 1) {
					return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() };
				}
				receivedSignal = request.signal;
				return await new Promise((_resolve, reject) => {
					const cancel = () => {
						const error = new Error("cancelled bash-time native validation");
						error.name = "AbortError";
						reject(error);
					};
					if (request.signal?.aborted) cancel();
					else request.signal?.addEventListener("abort", cancel, { once: true });
				});
			} });
			const { controller, toolCall } = runtime(native, undefined, undefined, 10);
			const command = "git commit -m native";
			const authorized = await controller.execute(mode, { operation: "validate", lineageId: "native-lineage", idempotencyKey: mode, command, input: "{}" }, undefined, undefined, context(cwd));
			assert.notEqual((authorized.details as { authorization?: unknown }).authorization, undefined);
			const pending = toolCall(
				{ toolName: "bash", input: { command } },
				context(cwd, mode === "external-cancellation" ? external.signal : undefined),
			);
			if (mode === "external-cancellation") external.abort();
			const result = await Promise.race([
				pending,
				new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("production tool_call did not cancel within its aggregate deadline")), 500)),
			]) as { block: boolean };
			assert.equal(result.block, true);
			assert.equal(receivedSignal?.aborted, true);
			assert.equal(validations, 2);
		});
	}
});

test("production post-allow pre-push remote probes obey Pi cancellation and the bash-time deadline", async (t) => {
	for (const mode of ["external-cancellation", "aggregate-deadline"] as const) {
		await t.test(mode, async (t) => {
			const cwd = repository(t);
			const remote = addBareRemote(t, cwd, "origin");
			git(cwd, "push", "origin", "main:refs/heads/feature");
			git(cwd, "fetch", "origin", "feature");
			git(cwd, "checkout", "-b", "feature");
			commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
			git(cwd, "config", "branch.feature.pushRemote", "origin");

			const countPath = join(cwd, ".git", "probe-count");
			const stallPath = join(cwd, ".git", "stall-probe");
			const uploadPack = join(cwd, ".git", "stall-upload-pack.sh");
			writeFileSync(uploadPack, [
				"#!/bin/sh",
				`count_file=${JSON.stringify(countPath)}`,
				`stall_file=${JSON.stringify(stallPath)}`,
				"count=0",
				'if [ -f "$count_file" ]; then read -r count < "$count_file"; fi',
				'count=$((count + 1))',
				'printf "%s\\n" "$count" > "$count_file"',
				'if [ -f "$stall_file" ] && [ "$count" -eq 3 ]; then exec sleep 1; fi',
				`exec git upload-pack ${JSON.stringify(remote)}`,
				"",
			].join("\n"), { mode: 0o755 });
			git(cwd, "config", "protocol.ext.allow", "always");
			git(cwd, "remote", "set-url", "origin", `ext::${uploadPack}`);

			const external = new AbortController();
			let validations = 0;
			const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
				validations += 1;
				if (mode === "external-cancellation" && validations === 2) external.abort();
				const gateContext = nativeGateContext();
				gateContext.raw.gate = "pre-push";
				return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
			} }), undefined, undefined, 150);
			const command = "git push origin feature:refs/heads/feature";
			const authorized = await controller.execute(mode, { operation: "validate", lineageId: "native-lineage", idempotencyKey: mode, command, input: "{}" }, undefined, undefined, context(cwd));
			assert.notEqual((authorized.details as { authorization?: unknown }).authorization, undefined);
			writeFileSync(countPath, "0\n");
			writeFileSync(stallPath, "stall\n");

			const started = Date.now();
			const result = await toolCall({ toolName: "bash", input: { command } }, interactiveContext(cwd, external.signal)) as { block: boolean; reason: string };
			assert.equal(result.block, true);
			assert.ok(Date.now() - started < 300, "post-allow remote probe exceeded its cancellation deadline");
			assert.equal(validations, 2, result.reason);
		});
	}
});

test("native deny, target drift, and bash-time errors never restore an authorization", async (t) => {
	const cwd = repository(t);
	const command = "git commit -m native";
	const denied = runtime(fakeNative({
		validate: async () => ({ allowed: false, result: "scope-changed", action: "create-new-lineage", reason: "denied", gateContext: nativeGateContext() }),
	}));
	const deniedResult = await denied.controller.execute("deny", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "key", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((deniedResult.details as { authorization?: unknown }).authorization, undefined);
	assert.equal((await denied.toolCall({ toolName: "bash", input: { command } }, context(cwd)) as { block: boolean }).block, true);

	let calls = 0;
	const drifting = runtime(fakeNative({
		validate: async () => {
			calls += 1;
			return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext("native-lineage", "r1", calls === 1 ? "target" : "changed-target") };
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

test("controller exposes every structured native denial recovery action from exit code 1", async (t) => {
	const cwd = repository(t);
	const published = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "native-review-cli", "v2.1.2", "validate-deny.json"), "utf8")) as Record<string, unknown>;
	for (const [gateResult, action] of [
		["scope-changed", "create-new-lineage"],
		["invalidated", "explicit-maintainer-action"],
		["escalated", "stop"],
	] as const) {
		const native = new NativeReviewCliV212(async (request) => ({
			stdout: request.arguments[0] === "version" ? "gentle-ai 2.1.2\n" : JSON.stringify({ ...published, result: gateResult, action, context: { ...(published.context as Record<string, unknown>), gate: "pre-commit" } }),
			stderr: request.arguments[0] === "version" ? "" : `Error: review gate denied: ${gateResult}\n`,
			exitCode: request.arguments[0] === "version" ? 0 : 1,
			signal: null,
			timedOut: false,
			outputLimitExceeded: false,
		}));
		const { controller } = runtime(native);
		const response = await controller.execute(`deny-${gateResult}`, { operation: "validate", lineageId: "issue136-contract-runtime", idempotencyKey: gateResult, command: "git commit -m denied", input: "{}" }, undefined, undefined, context(cwd));
		assert.deepEqual((response.details as { result: { result: string; allowed: boolean; action: string } }).result, {
			allowed: false,
			result: gateResult,
			action,
			reason: published.reason,
			context: { ...(published.context as Record<string, unknown>), gate: "pre-commit" },
		});
		assert.equal((response.details as { authorization?: unknown }).authorization, undefined);
	}
});

test("controller preserves every v2.1.2 empty-context pre-PR denial without authorization", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "push", "origin", "feature:refs/heads/feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const publishedText = readFileSync(join(import.meta.dirname, "fixtures", "native-review-cli", "v2.1.2", "validate-deny-empty-context.json"), "utf8");
	const published = JSON.parse(publishedText) as Record<string, unknown>;
	for (const [gateResult, action] of [
		["scope-changed", "create-new-lineage"],
		["invalidated", "explicit-maintainer-action"],
		["escalated", "stop"],
	] as const) {
		const body = { ...published, result: gateResult, action };
		const native = new NativeReviewCliV212(async (request) => ({
			stdout: request.arguments[0] === "version"
				? "gentle-ai 2.1.2\n"
				: gateResult === "invalidated" ? publishedText : JSON.stringify(body),
			stderr: request.arguments[0] === "version" ? "" : `Error: review gate denied: ${gateResult}\n`,
			exitCode: request.arguments[0] === "version" ? 0 : 1,
			signal: null,
			timedOut: false,
			outputLimitExceeded: false,
		}));
		const { controller } = runtime(native);
		const response = await controller.execute(`empty-context-${gateResult}`, { operation: "validate", lineageId: "native-lineage", idempotencyKey: `empty-context-${gateResult}`, command: "gh pr create --base main --head feature", input: "{}" }, undefined, undefined, context(cwd));
		assert.deepEqual((response.details as { result: unknown }).result, {
			allowed: false,
			result: gateResult,
			action,
			reason: published.reason,
			context: published.context,
		});
		assert.equal((response.details as { authorization?: unknown }).authorization, undefined);
	}
});
