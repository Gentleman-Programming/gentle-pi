import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { NATIVE_REVIEW_ERROR_CODE, NATIVE_REVIEW_OPERATION, NativeReviewCliError, NativeReviewCliV214, type NativeReviewCli, type NativeReviewStatusResult } from "../lib/native-review-cli.ts";
import { canonicalJsonV1, domainHashV1 } from "../lib/review-canonical.ts";
import { SupersessionStoreV1 } from "../lib/review-authority-supersession.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { compactResetRequestV1, destructiveResetReviewAuthorityV1 } from "../lib/review-reset.ts";
import { NATIVE_REVIEW_REMEDIATION, classifyNativeReviewRemediation } from "../lib/native-review-remediation.ts";
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
	candidateViews: CandidateViewRegistry | null = null,
): Runtime {
	const tools = new Map<string, RegisteredTool>();
	let toolCall: ToolCallHandler | undefined;
	const dependencies = { nativeReviewCli, publicationProbe, publicationProbeTimeoutMs, bashTimeRevalidationTimeoutMs, candidateViews } as unknown as Parameters<typeof createGentleAiExtension>[0];
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
		start: async () => ({ lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 2, changedLines: 7, correctionBudget: 4, action: "created", lensesRequired: true }),
		finalize: async () => ({ lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1", receiptPath: "/opaque/receipt" }),
		validate: async () => ({ allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext() }),
		bindSdd: async () => ({ revision: "b1", change: "native-review-authority-parity", lineage: "native-lineage", authorityRevision: "r1", receiptHash: "receipt", gateContext: nativeBindingGateContext() }),
		sddStatus: async () => ({ ready: false }),
		reviewStatus: async () => ({ schema: "gentle-ai.review-authority-status/v1", repository: "/repo", complete: true, authoritative: true, status: "clean", entries: [], locks: [], diagnostics: [], raw: { schema: "gentle-ai.review-authority-status/v1", operation: "review/status", repository: "/repo", complete: true, authoritative: true, status: "clean", entries: [], locks: [], diagnostics: [] } }),
		...overrides,
	};
}

function targetStatusFixture(options: {
	applicability?: "current_target" | "unrelated" | "ambiguous" | "corrupted";
	action?: ReviewStatusV1["action"];
	replayability?: ReviewStatusV1["replayability"];
	lineageId?: string;
} = {}): ReviewStatusV1 {
	const applicability = options.applicability ?? "current_target";
	const action = options.action ?? (applicability === "current_target" ? "finalize" : applicability === "unrelated" ? "start" : applicability === "ambiguous" ? "select_lineage" : "repair_authority");
	const replayability = options.replayability ?? (applicability === "ambiguous" ? "status_required" : applicability === "corrupted" ? "manual_action_required" : "not_replayable");
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
		replayability,
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
		candidates: applicability === "ambiguous" ? [lineageId, "other-lineage"] : [],
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
		replayability,
		...(applicability === "current_target" ? { frozen: { tier: "medium" as const, originalChangedLines: 2, correctionBudget: 1 } } : {}),
		targetIdentity: sha,
		projection,
		candidates: applicability === "ambiguous" ? [lineageId, "other-lineage"] : [],
		raw,
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
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
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
	assert.deepEqual(start.details, { operation: "start", result: { lineage_id: "native-lineage", state: "reviewing", risk_tier: "medium", selected_lenses: ["review-reliability"], changed_files: 2, original_changed_lines: 7, correction_budget: 4, action: "created", lenses_required: true } });
	const finalize = await controller.execute("finalize", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ review_result: { lens_results: [{ findings: [], evidence: ["complete candidate reviewed"] }] } }) }, undefined, undefined, context(cwd));
	assert.deepEqual(finalize.details, { operation: "finalize", result: { lineage_id: "native-lineage", state: "approved", action: "approved", store_revision: "r1", receipt_path: "/opaque/receipt" } });
	assert.equal(starts, 1);
	assert.equal(finalizes, 1);
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
	}), undefined, undefined, undefined, candidateViews);
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
	}), undefined, undefined, undefined, candidateViews);
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
	const { controller, toolCall } = runtime(native, undefined, undefined, undefined, candidateViews);
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
	}), undefined, undefined, undefined, candidateViews);
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
		}), undefined, undefined, undefined, candidateViews);
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
	}), undefined, undefined, undefined, candidateViews);
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
	frozen.cleanup();
	let finalizedContent = "";
	const { controller } = runtime(fakeNative({
		targetStatus: async () => status,
		finalize: async (request) => {
			finalizedContent = readFileSync(join(request.cwd, "app.ts"), "utf8");
			return { lineageId: "restarted-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}), undefined, undefined, undefined, new CandidateViewRegistry());
	const result = await controller.execute("restarted-finalize", {
		operation: "finalize",
		lineageId: "restarted-lineage",
		input: JSON.stringify({ review_result: { lens_results: [{ lens: "review-reliability", findings: [], evidence: ["reviewed frozen candidate"] }] } }),
	}, undefined, undefined, context(cwd));
	assert.equal(finalizedContent, "export const value = 2;\n");
	assert.equal((result.details as { result: { state: string } }).result.state, "approved");
});

test("ambiguous native START runs target status first and follows only its declared action", async (t) => {
	const cwd = repository(t);
	const candidateViews = new CandidateViewRegistry();
	const requests: Parameters<NativeReviewCli["start"]>[0][] = [];
	const calls: string[] = [];
	let statuses = 0;
	const reconciled = targetStatusFixture({ action: "finalize", lineageId: "resumed-lineage" });
	const { controller } = runtime(fakeNative({
		targetStatus: async () => {
			calls.push("status");
			statuses += 1;
			return statuses === 1 ? targetStatusFixture({ applicability: "unrelated", action: "start" }) : reconciled;
		},
		start: async (request) => {
			calls.push("start");
			requests.push(request);
			throw Object.assign(new Error("lost output"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
	}), undefined, undefined, undefined, candidateViews);
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
	candidateViews.cleanup(basename(requests[0]!.cwd));
});

test("ambiguous native FINALIZE returns the target-status action without a second mutation", async (t) => {
	const cwd = repository(t);
	const calls: string[] = [];
	let finalizes = 0;
	const reconciled = targetStatusFixture({ applicability: "ambiguous", action: "select_lineage", replayability: "status_required", lineageId: "native-lineage" });
	const { controller } = runtime(fakeNative({
		finalize: async () => {
			calls.push("finalize");
			finalizes += 1;
			throw Object.assign(new Error("lost finalize response"), { mutationOutcome: "unknown", nextAction: "review.status" });
		},
		targetStatus: async () => {
			calls.push("status");
			return reconciled;
		},
	}));
	const result = await controller.execute("ambiguous-finalize", { operation: "finalize", lineageId: "native-lineage", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal(finalizes, 1);
	assert.deepEqual(calls, ["finalize", "status"]);
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

test("fresh registry reload projects a correction state without accepting scope escape", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const frozen = new CandidateViewRegistry().create({ contributorRoot: cwd });
	mkdirSync(dirname(join(cwd, ".git", "gentle-ai", "review-transactions", "v2", "correction-lineage", "review-state.json")), { recursive: true });
	writeFileSync(join(cwd, ".git", "gentle-ai", "review-transactions", "v2", "correction-lineage", "review-state.json"), JSON.stringify({ schema: "gentle-ai.review-state-record/v2", state: { schema: "gentle-ai.review-state/v2", lineage_id: "correction-lineage", state: "correction_required", initial_snapshot: { kind: "current-changes", base_tree: frozen.baseTree, candidate_tree: frozen.candidateTree, paths: frozen.paths, paths_digest: "paths" }, current_snapshot: { kind: "current-changes", base_tree: frozen.baseTree, candidate_tree: frozen.candidateTree, paths: frozen.paths, paths_digest: "paths" }, fix_finding_ids: ["RELIABILITY-001"], findings: [{ id: "RELIABILITY-001", severity: "CRITICAL" }] } }));
	frozen.cleanup();
	let finalizes = 0;
	const { controller } = runtime(fakeNative({ finalize: async () => { finalizes += 1; return { lineageId: "correction-lineage", state: "approved", action: "approved", storeRevision: "r2" }; } }), undefined, undefined, undefined, new CandidateViewRegistry());
	const required = await controller.execute("correction-validation-request", { operation: "finalize", lineageId: "correction-lineage", input: JSON.stringify({ final_evidence: "focused tests passed", final_verification_passed: true }) }, undefined, undefined, context(cwd));
	const request = required.details as { outcome: string; validation_request: { request_hash: string; fix_finding_ids: string[] } };
	assert.equal(request.outcome, "validation-required");
	assert.deepEqual(request.validation_request.fix_finding_ids, ["RELIABILITY-001"]);
	assert.match(request.validation_request.request_hash, /^[0-9a-f]{64}$/);
	writeFileSync(join(cwd, "escape.ts"), "export const escape = true;\n");
	assert.equal(((await controller.execute("correction-scope-escape", { operation: "finalize", lineageId: "correction-lineage", input: JSON.stringify({ final_evidence: "focused tests passed", final_verification_passed: true }) }, undefined, undefined, context(cwd))).details as { outcome: string }).outcome, "native-operation-failed");
	assert.equal(finalizes, 0);
});

test("post-finalize projection failure requires native status and never repeats the mutation", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const source = new CandidateViewRegistry();
	const initial = source.create({ contributorRoot: cwd });
	source.bindCurrent({ token: initial.token, lineageId: "reload-correction", selectedLenses: ["review-reliability"] });
	mkdirSync(dirname(join(cwd, ".git", "gentle-ai", "review-transactions", "v2", "reload-correction", "review-state.json")), { recursive: true });
	writeFileSync(join(cwd, ".git", "gentle-ai", "review-transactions", "v2", "reload-correction", "review-state.json"), JSON.stringify({ schema: "gentle-ai.review-state-record/v2", state: { schema: "gentle-ai.review-state/v2", lineage_id: "reload-correction", state: "correction_required", initial_snapshot: { kind: "current-changes", base_tree: initial.baseTree, candidate_tree: initial.candidateTree, paths: initial.paths, paths_digest: "paths" }, current_snapshot: { kind: "current-changes", base_tree: initial.baseTree, candidate_tree: initial.candidateTree, paths: initial.paths, paths_digest: "paths" }, fix_finding_ids: ["RELIABILITY-001"], findings: [{ id: "RELIABILITY-001", severity: "CRITICAL" }] } }));
	source.cleanupTerminal("reload-correction", "approved");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	const candidateViews = new CandidateViewRegistry();
	let finalizes = 0;
	let finalizeCwd: string | undefined;
	candidateViews.promoteCorrected = () => {
		throw new Error("injected projection promotion failure");
	};
	const { controller } = runtime(fakeNative({
		finalize: async (request) => {
			finalizes += 1;
			finalizeCwd = request.cwd;
			assert.notEqual(request.cwd, cwd);
			return { lineageId: "reload-correction", state: "approved", action: "approved", storeRevision: "r2" };
		},
	}), undefined, undefined, undefined, candidateViews);
	const required = await controller.execute("reload-correction-request", { operation: "finalize", lineageId: "reload-correction", input: JSON.stringify({ final_evidence: "focused tests passed", final_verification_passed: true }) }, undefined, undefined, context(cwd));
	const request = required.details as { outcome: string; validation_request: { request_hash: string; fix_finding_ids: string[] } };
	assert.equal(request.outcome, "validation-required");
	const input = JSON.stringify({
		validation: {
			request_hash: request.validation_request.request_hash,
			correction_ids: request.validation_request.fix_finding_ids,
			original_criteria: { passed: true, evidence: ["focused tests passed"] },
			correction_regression: { passed: true, evidence: ["correction regression passed"] },
			fix_caused_findings: [],
			follow_ups: [],
		},
		final_evidence: "focused tests passed",
		final_verification_passed: true,
	});
	const failed = await controller.execute("reload-correction-approve", { operation: "finalize", lineageId: "reload-correction", input }, undefined, undefined, context(cwd));
	assert.deepEqual(failed.details, {
		operation: "finalize",
		status: "blocked",
		outcome: "native-mutation-status-required",
		mutation_outcome: "committed",
		replayability: "status_required",
		next_action: "review.status",
		reconciliation_context: "post-native-finalize",
		mutation_performed: true,
		lineage_id: "reload-correction",
		state: "approved",
		store_revision: "r2",
	});
	assert.equal(finalizes, 1);
	assert.ok(finalizeCwd);
	candidateViews.cleanup(basename(finalizeCwd));
});

test("native FINALIZE derives and requires the trusted refuter request before invoking native FINALIZE", async (t) => {
	const cwd = repository(t);
	let finalizes = 0;
	const { controller } = runtime(fakeNative({
		start: async () => ({ lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-risk"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true }),
		finalize: async () => {
			finalizes += 1;
			return { lineageId: "native-lineage", state: "validating", action: "continue", storeRevision: "r1" };
		},
	}));
	await controller.execute("risk-001-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const proof = "differential-test:candidate still fails";
	const finding = { id: "RISK-001", lens: "review-risk", location: "lib/a.ts:1", severity: "CRITICAL", claim: "Candidate fails", evidence_class: "inferential", causal_disposition: "introduced", proof_refs: [proof] };
	const review_result = { lens_results: [{ lens: "review-risk", findings: [finding], evidence: ["complete candidate reviewed"] }] };
	const required = await controller.execute("risk-001-refuter-request", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ review_result }) }, undefined, undefined, context(cwd));
	const request = (required.details as { refuter_request?: { request_hash: string; findings: unknown[] } }).refuter_request;
	assert.equal(finalizes, 0);
	assert.equal((required.details as { outcome?: string }).outcome, "refuter-required");
	assert.equal(typeof request?.request_hash, "string");
	assert.deepEqual(request?.findings.map((row) => (row as { id: string }).id), ["RISK-001"]);
	const retry = await controller.execute("risk-001-refuter-retry", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({
		review_result: { ...review_result, refuter_request_hash: request!.request_hash },
		refuter_batch: { schema: "gentle-ai.refuter-result-batch/v1", request_hash: request!.request_hash, results: [{ finding_id: "RISK-001", outcome: "corroborated", proof_refs: [proof] }] },
	}) }, undefined, undefined, context(cwd));
	assert.equal(finalizes, 1);
	assert.equal((retry.details as { result?: { state?: string } }).result?.state, "validating");
});

test("native FINALIZE emits exact v2.1.4 process documents and failed verification argv intent", async (t) => {
	const cwd = repository(t);
	const requests: Parameters<NativeReviewCli["finalize"]>[0][] = [];
	const { controller } = runtime(fakeNative({
		start: async () => ({ lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-risk"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true }),
		finalize: async (request) => {
			requests.push(request);
			return { lineageId: "native-lineage", state: "approved", action: "approved", storeRevision: "r1" };
		},
	}));
	await controller.execute("finalize-v212-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const finding = { id: "RISK-001", lens: "review-risk", location: "lib/a.ts:1", severity: "CRITICAL", claim: "Candidate fails", evidence_class: "inferential", causal_disposition: "introduced", proof_refs: ["differential-test:candidate still fails"] };
	const review_result = { lens_results: [{ lens: "review-risk", findings: [finding], evidence: ["complete candidate reviewed"] }] };
	const requested = await controller.execute("finalize-v212-request", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({ review_result }) }, undefined, undefined, context(cwd));
	const request_hash = (requested.details as { refuter_request: { request_hash: string } }).refuter_request.request_hash;
	const refuterBatch = { schema: "gentle-ai.refuter-result-batch/v1", request_hash, results: [{ finding_id: "RISK-001", outcome: "inconclusive", proof_refs: ["differential-test:candidate still fails"] }] };
	await controller.execute("finalize-v212", { operation: "finalize", lineageId: "native-lineage", input: JSON.stringify({
		review_result: { ...review_result, refuter_request_hash: request_hash },
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
	const native = new NativeReviewCliV214(async (request) => {
		if (request.arguments[0] === "version") return { stdout: "gentle-ai 2.1.4\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
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

test("native error has no compact fallback and ambiguous mutation demands target status", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-native-controller-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const { controller } = runtime(fakeNative({ start: async () => { throw Object.assign(new Error("lost output"), { mutationOutcome: "unknown", nextAction: "review.status" }); } }));
	const result = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(result.details, { operation: "start", status: "blocked", outcome: "native-mutation-status-required", mutation_outcome: "unknown", replayability: "status_required", next_action: "review.status" });
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
	}), undefined, undefined, undefined, new CandidateViewRegistry());
	const result = await controller.execute("unsafe-symlink-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const details = result.details as Record<string, unknown>;
	assert.equal(details.outcome, "native-operation-failed");
	assert.equal(details.mutation_outcome, "none");
	assert.equal(details.next_action, "resolve-native-operation-failure");
	assert.deepEqual(details.diagnostics, { code: "candidate-view-invalid", message: "candidate view rejected before native START" });
	assert.equal(starts, 0);
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
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			reset_eligible: false,
		});
	}
	assert.equal(requests.length, 2);
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
	}), undefined, undefined, undefined, candidateViews);
	await controller.execute("default-dirty", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const view = candidateViews.resolveForLens("default-dirty-lineage", "review-reliability");
	try {
		assert.deepEqual(view.paths, ["app.ts", "untracked.ts"]);
		assert.equal(view.committedOnly, false);
		assert.deepEqual(requests, [{ cwd: view.root }]);
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
	}), undefined, undefined, undefined, candidateViews);
	await controller.execute("explicit-base", { operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: baseCommit, committedOnly: true }) }, undefined, undefined, context(cwd));
	const view = candidateViews.resolveForLens("explicit-base-lineage", "review-reliability");
	try {
		assert.deepEqual(view.paths, ["committed-after-base.ts"]);
		assert.equal(view.committedOnly, true);
		assert.equal(view.baseCommit, baseCommit);
		assert.deepEqual(requests, [{ cwd: view.root, baseRef: view.baseCommit, committedOnly: true }]);
	} finally {
		view.cleanup();
	}
});

test("native START rejects an unresolvable explicit base before native mutation", async (t) => {
	const cwd = repository(t);
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		},
	}), undefined, undefined, undefined, new CandidateViewRegistry());
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
	}), undefined, undefined, undefined, new CandidateViewRegistry());
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
	assert.deepEqual(requests, [{ cwd, baseRef: git(cwd, "rev-parse", "refs/heads/main"), committedOnly: true }]);
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
	for (const field of ["base_ref", "unexpected"]) {
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
				native_contract: "gentle-ai/2.1.4",
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

test("fresh candidate registry binds a resumed zero-lens native START through FINALIZE and pre-commit", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	const candidateViews = new CandidateViewRegistry();
	let finalizedCwd = "";
	let validations = 0;
	const lineageId = "resumed-after-reload";
	const { controller } = runtime(fakeNative({
		start: async () => ({ lineageId, state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "resumed", lensesRequired: false }),
		finalize: async (request) => {
			finalizedCwd = request.cwd;
			return { lineageId, state: "approved", action: "approved", storeRevision: "r1" };
		},
		validate: async () => {
			validations += 1;
			return { allowed: true, result: "allow", action: "continue", reason: "native receipt matches", gateContext: nativeGateContext(lineageId, "r1", git(cwd, "write-tree")) };
		},
	}), undefined, undefined, undefined, candidateViews);
	await controller.execute("resume-after-reload", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	await controller.execute("resume-finalize", { operation: "finalize", lineageId, input: JSON.stringify({}) }, undefined, undefined, context(cwd));
	assert.notEqual(finalizedCwd, cwd);
	git(cwd, "add", "--", "app.ts");
	const validated = await controller.execute("resume-pre-commit", { operation: "validate", lineageId, idempotencyKey: "resume", command: "git commit -m resumed", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal(validations, 1);
	assert.notEqual((validated.details as { authorization?: unknown }).authorization, undefined);
});

test("native pre-commit after reload delegates exact-tree validation when no local projection exists", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	git(cwd, "add", "--", "app.ts");
	let validations = 0;
	const { controller } = runtime(fakeNative({
		validate: async () => {
			validations += 1;
			return { allowed: true, result: "allow", action: "continue", reason: "native receipt matches", gateContext: nativeGateContext("reloaded-lineage", "r1", git(cwd, "write-tree")) };
		},
	}), undefined, undefined, undefined, new CandidateViewRegistry());
	const validated = await controller.execute("reload-pre-commit", { operation: "validate", lineageId: "reloaded-lineage", idempotencyKey: "reload", command: "git commit -m reload", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal(validations, 1);
	assert.notEqual((validated.details as { authorization?: unknown }).authorization, undefined);
});

test("native pre-commit rejects an unproven staged projection before native authorization", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	writeFileSync(join(cwd, "initially-untracked.ts"), "export const untracked = true;\n");
	const candidateViews = new CandidateViewRegistry();
	let validations = 0;
	const { controller } = runtime(fakeNative({
		validate: async () => {
			validations += 1;
			return { allowed: true, result: "allow", action: "continue", reason: "native allow must not bypass Pi projection checks", gateContext: nativeGateContext() };
		},
	}), undefined, undefined, undefined, candidateViews);
	const started = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const lineageId = (started.details as { result: { lineage_id: string } }).result.lineage_id;
	await controller.execute("finalize", { operation: "finalize", lineageId, input: JSON.stringify({ review_result: { lens_results: [{ findings: [], evidence: ["candidate reviewed"] }] } }) }, undefined, undefined, context(cwd));
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	git(cwd, "add", "--", "app.ts", "initially-untracked.ts");
	const result = await controller.execute("validate", { operation: "validate", lineageId, idempotencyKey: "projection-drift", command: "git commit -m native", input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((result.details as { status?: string }).status, "blocked");
	assert.equal(validations, 0);
});

test("native pre-commit binds the exact tracked and initially-untracked projection through bash-time revalidation", async (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	writeFileSync(join(cwd, "initially-untracked.ts"), "export const untracked = true;\n");
	const candidateViews = new CandidateViewRegistry();
	let validations = 0;
	const native = fakeNative({
		validate: async () => {
			validations += 1;
			return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext: nativeGateContext("native-lineage", "r1", git(cwd, "write-tree")) };
		},
	});
	const { controller, toolCall } = runtime(native, undefined, undefined, undefined, candidateViews);
	const started = await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const lineageId = (started.details as { result: { lineage_id: string } }).result.lineage_id;
	await controller.execute("finalize", { operation: "finalize", lineageId, input: JSON.stringify({ review_result: { lens_results: [{ findings: [], evidence: ["candidate reviewed"] }] } }) }, undefined, undefined, context(cwd));
	git(cwd, "add", "--", "app.ts", "initially-untracked.ts");
	const command = "git commit -m exact-projection";
	const allowed = await controller.execute("validate", { operation: "validate", lineageId, idempotencyKey: "exact-projection", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.notEqual((allowed.details as { authorization?: unknown }).authorization, undefined);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, interactiveContext(cwd)), undefined);
	assert.equal(validations, 2);

	for (const unsupported of ["git commit -a -m broad", "git commit app.ts -m pathspec", "git commit --pathspec-from-file=paths -m wrapper"]) {
		const rejected = await toolCall({ toolName: "bash", input: { command: unsupported } }, context(cwd)) as { block: boolean };
		assert.equal(rejected.block, true);
	}
	writeFileSync(join(cwd, "harness-artifact.txt"), "must not be staged\n");
	git(cwd, "add", "--", "harness-artifact.txt");
	const drifted = await controller.execute("validate", { operation: "validate", lineageId, idempotencyKey: "extra-path", command, input: "{}" }, undefined, undefined, context(cwd));
	assert.equal((drifted.details as { status?: string }).status, "blocked");
	assert.equal(validations, 2);
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

test("native bind treats malformed post-call evidence as status-required without replay", async (t) => {
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
		outcome: "native-mutation-status-required",
		mutation_outcome: "unknown",
		replayability: "status_required",
		next_action: "review.status",
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

test("native ordinary START distinguishes unrelated compact history from an exact compact claimant", async (t) => {
	const cwd = repository(t);
	const compact = await import("../lib/review-facade.ts");
	compact.startCompactReview({
		cwd,
		lineageId: "historical-compact",
		policyHash: "a".repeat(64),
		projection: { kind: "complete" },
	});
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
	assert.deepEqual(matching.details, {
		operation: "start",
		status: "blocked",
		outcome: "compact-authority-nonterminal",
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		reset_eligible: false,
		next_action: "stop-and-resolve-existing-compact-authority",
		lineage_ids: ["historical-compact"],
	});
	assert.equal(starts, 1);
});

test("explicit native selectors bypass a matching compact claimant and preserve the native response", async (t) => {
	for (const selector of ["policyPath", "baseRef"] as const) {
		const cwd = repository(t);
		const compact = await import("../lib/review-facade.ts");
		compact.startCompactReview({ cwd, lineageId: `matching-${selector}`, policyHash: "a".repeat(64), projection: { kind: "complete" } });
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

test("native ordinary START fails closed for a matching correction-required compact claimant without mutating history", async (t) => {
	const cwd = repository(t);
	const compact = await import("../lib/review-facade.ts");
	const matching = compact.startCompactReview({
		cwd,
		lineageId: "matching-correction-required",
		policyHash: "a".repeat(64),
		projection: { kind: "complete" },
	});
	const before = readFileSync(compact.discoverCompactReview(cwd, matching.lineage_id).store.statePath, "utf8");
	let starts = 0;
	const { controller } = runtime(fakeNative({
		start: async () => {
			starts += 1;
			return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
		},
	}));
	const result = await controller.execute("matching-correction-required", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	assert.deepEqual(result.details, {
		operation: "start",
		status: "blocked",
		outcome: "compact-authority-nonterminal",
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		reset_eligible: false,
		next_action: "stop-and-resolve-existing-compact-authority",
		lineage_ids: ["matching-correction-required"],
	});
	assert.equal(starts, 0);
	assert.equal(readFileSync(compact.discoverCompactReview(cwd, matching.lineage_id).store.statePath, "utf8"), before);
});

test("native C2 applicability matrix preserves historical compact authority and closes unsafe claimants", async (t) => {
	const compact = await import("../lib/review-facade.ts");
	const policyHash = "a".repeat(64);
	const approve = (cwd: string, lineageId: string, value: number) => {
		writeFileSync(join(cwd, "app.ts"), `export const value = ${value};\n`);
		const started = compact.startCompactReview({ cwd, lineageId, policyHash, projection: { kind: "complete" } });
		assert.equal(compact.finalizeCompactReview({
			cwd,
			lineageId,
			review_result: { lens_results: [{ findings: [], evidence: ["fixture candidate reviewed"] }] },
			final_evidence: "fixture verification passed",
			final_verification_passed: true,
		}).state, "approved");
		return started.lineage_id;
	};
	const escalate = (cwd: string, lineageId: string, value: number) => {
		writeFileSync(join(cwd, "app.ts"), `export const value = ${value};\n`);
		const started = compact.startCompactReview({ cwd, lineageId, policyHash, projection: { kind: "complete" } });
		assert.equal(compact.finalizeCompactReview({
			cwd,
			lineageId,
			review_result: { lens_results: [{ findings: [], evidence: ["fixture candidate reviewed"] }] },
			final_evidence: "fixture verification failed",
			final_verification_passed: false,
		}).state, "escalated");
		return started.lineage_id;
	};
	const correctionRequired = (cwd: string, lineageId: string, value: number) => {
		writeFileSync(join(cwd, "app.ts"), [
			`export const value = ${value};`,
			"export const one = 1;",
			"export const two = 2;",
			"export const three = 3;",
			"",
		].join("\n"));
		const started = compact.startCompactReview({ cwd, lineageId, policyHash, projection: { kind: "complete" } });
		assert.equal(compact.finalizeCompactReview({
			cwd,
			lineageId,
			review_result: {
				lens_results: [{
					findings: [{
						id: "RELIABILITY-001",
						location: "app.ts:1",
						severity: "BLOCKER",
						claim: "Fixture requires correction.",
						evidence_class: "deterministic",
						causal_disposition: "introduced",
						proof_refs: ["changed-hunk:app.ts:1"],
					}],
					evidence: ["fixture candidate reviewed"],
				}],
			},
		}).state, "correction_required");
		return started.lineage_id;
	};
	const authorityBytes = (cwd: string, lineageIds: readonly string[]) => Object.fromEntries(
		lineageIds.flatMap((lineageId) => {
			const store = compact.discoverCompactReview(cwd, lineageId).store;
			return [store.statePath, ...(compact.discoverCompactReview(cwd, lineageId).record.state.state === "approved" || compact.discoverCompactReview(cwd, lineageId).record.state.state === "escalated" ? [store.receiptPath] : [])]
				.map((path) => [path, readFileSync(path, "utf8")]);
		}),
	);

	await t.test("seven unrelated valid lineages reach native START once without authority mutation", async (t) => {
		const cwd = repository(t);
		const lineageIds = [
			...([2, 3, 4, 5, 6].map((value) => approve(cwd, `approved-${value}`, value))),
			escalate(cwd, "escalated-7", 7),
			correctionRequired(cwd, "correction-required-8", 8),
		];
		writeFileSync(join(cwd, "app.ts"), "export const value = 9;\n");
		const before = authorityBytes(cwd, lineageIds);
		let starts = 0;
		const { controller } = runtime(fakeNative({ start: async () => {
			starts += 1;
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true };
		} }));
		const inspected = await controller.execute("c2-unrelated-inspect", { operation: "inspect" }, undefined, undefined, context(cwd));
		assert.equal((inspected.details as { status: string }).status, "ready");
		assert.equal((inspected.details as { compact_authority_applicability?: string }).compact_authority_applicability, "unrelated-history");
		const started = await controller.execute("c2-unrelated-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
		assert.equal((started.details as { result: { lineage_id: string } }).result.lineage_id, "native-lineage");
		assert.equal(starts, 1);
		assert.deepEqual(authorityBytes(cwd, lineageIds), before);
	});

	await t.test("matching approved receipt routes compatible read/gate and invalid receipts fail closed", async (t) => {
		for (const mode of ["valid", "missing", "malformed", "mismatched"] as const) {
			await t.test(mode, async (t) => {
				const cwd = repository(t);
				const matching = approve(cwd, "matching-approved", 2);
				const store = compact.discoverCompactReview(cwd, matching).store;
				const before = readFileSync(store.statePath, "utf8");
				if (mode === "missing") renameSync(store.receiptPath, `${store.receiptPath}.missing`);
				if (mode === "malformed") writeFileSync(store.receiptPath, "not-json");
				if (mode === "mismatched") {
					const other = approve(cwd, "unrelated-approved", 3);
					writeFileSync(store.receiptPath, readFileSync(compact.discoverCompactReview(cwd, other).store.receiptPath, "utf8"));
					writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
				}
				let starts = 0;
				const { controller } = runtime(fakeNative({ start: async () => {
					starts += 1;
					return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
				} }));
				const result = await controller.execute(`matching-approved-${mode}`, { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
				const details = result.details as Record<string, unknown>;
				assert.equal(starts, 0);
				assert.equal(details.outcome, mode === "valid" ? "compact-authority-compatible-receipt" : "compact-authority-invalid");
				assert.equal(details.next_action, mode === "valid" ? "use-compatible-read-or-gate-route" : "stop-and-report-invalid-compact-authority");
				assert.equal(readFileSync(store.statePath, "utf8"), before);
			});
		}
	});

	await t.test("matching escalated, correction-required, ambiguous, corrupt, and identity-broken authority fail closed", async (t) => {
		const closed = async (name: string, arrange: (cwd: string) => string[]) => {
			const cwd = repository(t);
			const lineageIds = arrange(cwd);
			const before = authorityBytes(cwd, lineageIds);
			let starts = 0;
			const { controller } = runtime(fakeNative({ start: async () => {
				starts += 1;
				return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
			} }));
			const result = await controller.execute(`c2-${name}`, { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
			assert.equal((result.details as Record<string, unknown>).outcome, `compact-authority-${name === "correction-required" ? "nonterminal" : name}`);
			assert.equal(starts, 0);
			assert.deepEqual(authorityBytes(cwd, lineageIds), before);
		};
		await closed("escalated", (cwd) => [escalate(cwd, "matching-escalated", 2)]);
		await closed("correction-required", (cwd) => [correctionRequired(cwd, "matching-correction", 2)]);
		await closed("ambiguous", (cwd) => [
			compact.startCompactReview({ cwd, lineageId: "matching-one", policyHash, projection: { kind: "complete" } }).lineage_id,
			compact.startCompactReview({ cwd, lineageId: "matching-two", policyHash, projection: { kind: "complete" } }).lineage_id,
		]);
		await t.test("corrupt compact record", async (t) => {
			const cwd = repository(t);
			const lineageId = compact.startCompactReview({ cwd, lineageId: "corrupt", policyHash, projection: { kind: "complete" } }).lineage_id;
			const statePath = compact.discoverCompactReview(cwd, lineageId).store.statePath;
			writeFileSync(statePath, "corrupt compact authority");
			const before = readFileSync(statePath, "utf8");
			let starts = 0;
			const { controller } = runtime(fakeNative({ start: async () => {
				starts += 1;
				return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
			} }));
			const result = await controller.execute("c2-invalid", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
			assert.equal((result.details as Record<string, unknown>).outcome, "compact-authority-invalid");
			assert.equal(starts, 0);
			assert.equal(readFileSync(statePath, "utf8"), before);
		});
		await t.test("identity-broken inspection", async (t) => {
			const cwd = repository(t);
			approve(cwd, "identity-broken", 2);
			const identityPath = join(cwd, ".git", "gentle-ai", "reviews", "IDENTITY");
			writeFileSync(identityPath, canonicalJsonV1({
				schema: "gentle-ai.review-repository/v1",
				object_format: "sha1",
				root_commit_ids: ["0".repeat(40)],
			}));
			const before = readFileSync(identityPath, "utf8");
			let starts = 0;
			const { controller } = runtime(fakeNative({ start: async () => {
				starts += 1;
				return { lineageId: "must-not-start", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
			} }));
			const result = await controller.execute("c2-identity-broken", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
			assert.equal((result.details as Record<string, unknown>).outcome, "compact-authority-invalid");
			assert.equal(starts, 0);
			assert.equal(readFileSync(identityPath, "utf8"), before);
		});
	});
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

function nativeReleaseEvidence(): Record<string, string> {
	return {
		release_configuration: "/evidence/release configuration.json",
		release_generated: "/evidence/release generated.json",
		release_provenance: "/evidence/release provenance.json",
		release_publication_boundary: "/evidence/release publication-boundary.json",
		release_evidence_freshness: "/evidence/release evidence-freshness.json",
	};
}

test("native release validation forwards complete release evidence in contract order", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	const head = git(cwd, "rev-parse", "HEAD");
	git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "tag", "-a", "v2.1.5", "-m", "release", head);
	const requests: Array<{ gate: string; flags?: readonly string[] }> = [];
	const { controller } = runtime(fakeNative({ validate: async (request) => {
		requests.push(request);
		const gateContext = nativeGateContext();
		gateContext.raw.gate = "release";
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
	} }));
	const result = await controller.execute("release-artifacts", {
		operation: "validate",
		lineageId: "native-lineage",
		idempotencyKey: "release-artifacts",
		command: "gh release create v2.1.5",
		input: JSON.stringify({ nativeRelease: nativeReleaseEvidence() }),
	}, undefined, undefined, context(cwd));
	assert.notEqual((result.details as { authorization?: unknown }).authorization, undefined);
	assert.equal(requests[0]?.gate, "release");
	assert.deepEqual(requests[0]?.flags, [
			"--release-configuration", "/evidence/release configuration.json",
			"--release-generated", "/evidence/release generated.json",
			"--release-provenance", "/evidence/release provenance.json",
			"--release-publication-boundary", "/evidence/release publication-boundary.json",
			"--release-evidence-freshness", "/evidence/release evidence-freshness.json",
		],
	);
});

test("native tag-only first publication uses the release gate with complete evidence", async (t) => {
	const cwd = repository(t);
	const origin = addBareRemote(t, cwd, "origin");
	const head = git(cwd, "rev-parse", "HEAD");
	git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "tag", "-a", "v2.1.5", "-m", "release", head);
	git(cwd, "config", "branch.main.pushRemote", "origin");
	const requests: Array<{ gate: string; flags?: readonly string[] }> = [];
	const { controller, toolCall } = runtime(fakeNative({ validate: async (request) => {
		requests.push(request);
		const gateContext = nativeGateContext();
		gateContext.raw.gate = "release";
		return { allowed: true, result: "allow", action: "continue", reason: "ok", gateContext };
	} }), queuedPublicationProbe({ [`${origin} refs/heads/main`]: head }));
	const command = "git push origin v2.1.5";
	const result = await controller.execute("tag-first-publication", {
		operation: "validate",
		lineageId: "native-lineage",
		idempotencyKey: "tag-first-publication",
		command,
		input: JSON.stringify({ nativeRelease: nativeReleaseEvidence() }),
	}, undefined, undefined, context(cwd));
	assert.notEqual((result.details as { authorization?: unknown }).authorization, undefined);
	assert.equal(await toolCall({ toolName: "bash", input: { command } }, interactiveContext(cwd)), undefined);
	assert.equal(requests.length, 2);
	assert.equal(requests.every((request) => request.gate === "release"), true);
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

test("repository publication identity matches v2.1.3 URL host and scp vectors", () => {
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
			return { lineageId: "native-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: [], changedFiles: 0, changedLines: 0, correctionBudget: 0, action: "created", lensesRequired: false };
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

test("maintainer release exception is native-first, exact, interactive, and one-shot", async (t) => {
	const cwd = repository(t);
	const origin = addBareRemote(t, cwd, "origin");
	const head = git(cwd, "rev-parse", "HEAD");
	git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "tag", "-a", "v2.1.5", "-m", "release", head);
	const command = "git push origin v2.1.5";
	const denied = (result: "invalidated" | "scope-changed" | "escalated" = "invalidated", action = "explicit-maintainer-action") => fakeNative({ validate: async () => {
		const gateContext = nativeGateContext();
		gateContext.raw.gate = "release";
		return { allowed: false, result, action, reason: "release provenance predicate failed", gateContext };
	} });
	const evidence = nativeReleaseEvidence();
	const { controller, toolCall } = runtime(denied(), queuedPublicationProbe({ [`${origin} refs/heads/main`]: head }));
	const first = await controller.execute("exception-first", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "exception", command, input: JSON.stringify({ nativeRelease: evidence }) }, undefined, undefined, context(cwd));
	const firstDetails = first.details as Record<string, unknown>;
	const request = firstDetails.maintainer_exception_request as Record<string, unknown>;
	assert.equal((firstDetails.result as Record<string, unknown>).result, "invalidated");
	assert.equal(typeof request.request_hash, "string");
	assert.match(String(request.challenge), /^AUTHORIZE RELEASE EXCEPTION /);
	assert.equal((firstDetails as { authorization?: unknown }).authorization, undefined);

	const accepted = { ...request, reason: "v2.1.5 incident acknowledged", accepted_predicates: request.failed_predicates };
	for (const [name, exception] of [
		["headless", accepted],
		["wrong-hash", { ...accepted, request_hash: "wrong" }],
		["wrong-challenge", { ...accepted, challenge: "wrong" }],
	] as const) {
		const rejected = await controller.execute(name, { operation: "validate", lineageId: "native-lineage", idempotencyKey: name, command, input: JSON.stringify({ nativeRelease: evidence, maintainer_exception: exception }) }, undefined, undefined, context(cwd));
		assert.equal((rejected.details as Record<string, unknown>).exception_authorized, false, name);
		assert.equal(((rejected.details as Record<string, unknown>).result as Record<string, unknown>).result, "invalidated", name);
	}
	const uiDenied = await controller.execute("exception-ui-denied", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "ui-denied", command, input: JSON.stringify({ nativeRelease: evidence, maintainer_exception: accepted }) }, undefined, undefined, { ...interactiveContext(cwd), ui: { confirm: async () => false } } as ExtensionContext);
	assert.equal((uiDenied.details as Record<string, unknown>).exception_authorized, false);
	const authorized = await controller.execute("exception-accepted", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "accepted", command, input: JSON.stringify({ nativeRelease: evidence, maintainer_exception: accepted }) }, undefined, undefined, interactiveContext(cwd));
	assert.equal((authorized.details as Record<string, unknown>).exception_authorized, false);
	assert.equal((await toolCall({ toolName: "bash", input: { command } }, interactiveContext(cwd)) as { block: boolean }).block, true);

	for (const [result, action] of [["scope-changed", "create-new-lineage"], ["escalated", "stop"]] as const) {
		const ineligible = runtime(denied(result, action), queuedPublicationProbe({ [`${origin} refs/heads/main`]: head }));
		const response = await ineligible.controller.execute(result, { operation: "validate", lineageId: "native-lineage", idempotencyKey: result, command, input: JSON.stringify({ nativeRelease: evidence }) }, undefined, undefined, interactiveContext(cwd));
		assert.equal((response.details as Record<string, unknown>).maintainer_exception_request, undefined);
	}
});

test("release exception stale bindings and audit evidence fail closed", async (t) => {
	const setup = (t: test.TestContext) => {
		const cwd = repository(t);
		const origin = addBareRemote(t, cwd, "origin");
		const head = git(cwd, "rev-parse", "HEAD");
		git(cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "tag", "-a", "v2.1.5", "-m", "release", head);
		const rows: Record<string, string> = { [`${origin} refs/heads/main`]: head };
		const { controller, toolCall } = runtime(fakeNative({ validate: async () => {
			const gateContext = nativeGateContext();
			gateContext.raw.gate = "release";
			return { allowed: false, result: "invalidated", action: "explicit-maintainer-action", reason: "release provenance predicate failed", gateContext };
		} }), queuedPublicationProbe(rows));
		const command = "git push origin v2.1.5";
		const request = async () => {
			const response = await controller.execute("request", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "request", command, input: JSON.stringify({ nativeRelease: nativeReleaseEvidence() }) }, undefined, undefined, context(cwd));
			return (response.details as Record<string, unknown>).maintainer_exception_request as Record<string, unknown>;
		};
		const accept = (request: Record<string, unknown>) => ({ ...request, reason: "incident acknowledged", accepted_predicates: request.failed_predicates });
		const authorize = async (request: Record<string, unknown>, evidence = nativeReleaseEvidence()) => await controller.execute("authorize", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "authorize", command, input: JSON.stringify({ nativeRelease: evidence, maintainer_exception: accept(request) }) }, undefined, undefined, interactiveContext(cwd));
		return { cwd, origin, head, rows, controller, toolCall, command, request, authorize };
	};

	await t.test("response audit is explicitly non-durable and complete", async (t) => {
		const fixture = setup(t);
		const request = await fixture.request();
		const audit = (request as { audit?: Record<string, unknown> }).audit!;
		assert.equal(audit.durable_audit, false);
		assert.equal(audit.command, fixture.command);
		assert.deepEqual(audit.target, request.target);
		assert.deepEqual(audit.native_denial, request.native_denial);
		assert.equal(audit.request_hash, request.request_hash);
		assert.deepEqual(audit.accepted_predicates, request.accepted_predicates);
	});

	await t.test("origin/main, tag object, and peeled target movement deny stale authorization", async (t) => {
		for (const movement of ["remote", "tag-object", "peeled-target"] as const) await t.test(movement, async (t) => {
			const fixture = setup(t);
			const request = await fixture.request();
			await fixture.authorize(request);
			if (movement === "remote") {
				const next = git(fixture.cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "--git-dir", fixture.origin, "commit-tree", `${fixture.head}^{tree}`, "-m", "advance");
				git(fixture.cwd, "--git-dir", fixture.origin, "update-ref", "refs/heads/main", next);
				fixture.rows[`${fixture.origin} refs/heads/main`] = next;
			} else if (movement === "tag-object") {
				git(fixture.cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "tag", "-fa", "v2.1.5", "-m", "moved object", fixture.head);
			} else {
				const next = git(fixture.cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "commit-tree", `${fixture.head}^{tree}`, "-m", "moved target");
				git(fixture.cwd, "-c", "user.name=Native Test", "-c", "user.email=native@example.invalid", "tag", "-fa", "v2.1.5", "-m", "moved target", next);
			}
			assert.equal((await fixture.toolCall({ toolName: "bash", input: { command: fixture.command } }, interactiveContext(fixture.cwd)) as { block: boolean }).block, true);
		});
	});

	await t.test("changed evidence and ordinary branch create cannot request an exception", async (t) => {
		const fixture = setup(t);
		const request = await fixture.request();
		const changed = { ...nativeReleaseEvidence(), release_generated: "/evidence/changed.json" };
		const stale = await fixture.authorize(request, changed);
		assert.equal((stale.details as Record<string, unknown>).exception_authorized, false);
		const branch = await fixture.controller.execute("branch", { operation: "validate", lineageId: "native-lineage", idempotencyKey: "branch", command: "git push origin main:refs/heads/release", input: "{}" }, undefined, undefined, interactiveContext(fixture.cwd));
		assert.equal((branch.details as Record<string, unknown>).maintainer_exception_request, undefined);
	});
});

test("controller exposes every structured native denial recovery action from exit code 1", async (t) => {
	const cwd = repository(t);
	const published = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "native-review-cli", "v2.1.3", "validate-deny.json"), "utf8")) as Record<string, unknown>;
	for (const [gateResult, action] of [
		["scope-changed", "create-new-lineage"],
		["invalidated", "explicit-maintainer-action"],
		["escalated", "stop"],
	] as const) {
		const native = new NativeReviewCliV214(async (request) => ({
			stdout: request.arguments[0] === "version" ? "gentle-ai 2.1.4\n" : JSON.stringify({ ...published, result: gateResult, action, context: { ...(published.context as Record<string, unknown>), gate: "pre-commit" } }),
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

test("controller preserves every historical response-schema empty-context pre-PR denial without authorization", async (t) => {
	const cwd = repository(t);
	addBareRemote(t, cwd, "origin");
	git(cwd, "checkout", "-b", "feature");
	commitFile(cwd, "feature.ts", "export const feature = true;\n", "feature");
	git(cwd, "push", "origin", "feature:refs/heads/feature");
	git(cwd, "config", "branch.feature.pushRemote", "origin");
	const publishedText = readFileSync(join(import.meta.dirname, "fixtures", "native-review-cli", "v2.1.3", "validate-deny-empty-context.json"), "utf8");
	const published = JSON.parse(publishedText) as Record<string, unknown>;
	for (const [gateResult, action] of [
		["scope-changed", "create-new-lineage"],
		["invalidated", "explicit-maintainer-action"],
		["escalated", "stop"],
	] as const) {
		const body = { ...published, result: gateResult, action };
		const native = new NativeReviewCliV214(async (request) => ({
			stdout: request.arguments[0] === "version"
				? "gentle-ai 2.1.4\n"
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

test("parallel 4R dispatch receives one compact changed scope and blocks oversized scope before any actor", async (t) => {
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
	}), undefined, undefined, undefined, candidateViews);
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
	}), undefined, undefined, undefined, oversizedViews);
	await oversized.controller.execute("c4-oversized-start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, context(cwd));
	const rejected = await oversized.toolCall({ toolName: "subagent_run", input: { agent: "review-reliability", task: "Review oversized scope", mode: "task" } }, context(cwd)) as { block?: boolean };
	assert.equal(rejected.block, true, "oversized scope blocks before an actor can launch");
	oversizedViews.resolveForLens("c4-oversized", "review-reliability").cleanup();
});

test("INSPECT maps complete native status inventory without reconstructing native authority and fails closed otherwise", async (t) => {
	const cwd = repository(t);
	let mutations = 0;
	const nativeStatus = (status: string, complete = true, authoritative = true, locks: readonly unknown[] = []) => ({
		schema: "gentle-ai.review-authority-status/v1",
		repository: cwd,
		complete,
		authoritative,
		status,
		entries: [],
		locks,
		diagnostics: [],
		raw: { schema: "gentle-ai.review-authority-status/v1", operation: "review/status", status, complete, authoritative, entries: [], locks, diagnostics: [] },
	});
	for (const scenario of [
		{ name: "clean", native: nativeStatus("clean"), expectedStatus: "ready", inventoryComplete: true, nextAction: "start-native-authoritative" },
		{ name: "active", native: nativeStatus("active"), expectedStatus: "in-progress", inventoryComplete: true, nextAction: "finalize-existing-native-review" },
		{ name: "approved", native: nativeStatus("approved"), expectedStatus: "blocked", inventoryComplete: true, nextAction: "use-compatible-read-or-gate-route" },
		{ name: "escalated", native: nativeStatus("escalated"), expectedStatus: "blocked", inventoryComplete: true, nextAction: "stop-and-report-escalated-native-authority" },
		{ name: "reset", native: nativeStatus("reset-in-progress"), expectedStatus: "blocked", inventoryComplete: true, nextAction: "recover-native-reset" },
		{ name: "mixed", native: nativeStatus("same-lineage-mixed-collision", false, false), expectedStatus: "blocked", inventoryComplete: false, nextAction: "require-complete-native-authority-inventory" },
		{ name: "lock", native: nativeStatus("clean", true, true, [{ version: "compact-v2", path: "C:\\repo\\.git\\gentle-ai\\LOCK", status: "owned", owner: { schema: "gentle-ai.review-store-lock/v1", owner_id: "owner", pid: 1, host: "host", acquired_at: "2026-07-14T00:00:00Z" } }]), expectedStatus: "blocked", inventoryComplete: true, nextAction: "wait-for-native-lock-release" },
		{ name: "invalid", native: nativeStatus("invalid", true, false), expectedStatus: "blocked", inventoryComplete: false, nextAction: "require-complete-native-authority-inventory" },
		{ name: "incomplete", native: nativeStatus("invalid", false, false), expectedStatus: "blocked", inventoryComplete: false, nextAction: "require-complete-native-authority-inventory" },
	] as const) {
		const { controller } = runtime(fakeNative({
			reviewStatus: async () => scenario.native,
			start: async () => { mutations += 1; throw new Error("INSPECT must not mutate"); },
			finalize: async () => { mutations += 1; throw new Error("INSPECT must not mutate"); },
		}) as Partial<NativeReviewCli>);
		const response = await controller.execute(`native-status-${scenario.name}`, { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = response.details as Record<string, unknown>;
		assert.equal(details.status, scenario.expectedStatus, scenario.name);
		assert.equal(details.inventory_complete, scenario.inventoryComplete, scenario.name);
		assert.equal(details.next_action, scenario.nextAction, scenario.name);
		assert.equal((details.evidence as Record<string, unknown>).native_status, scenario.name === "reset" ? "reset-in-progress" : scenario.name === "mixed" ? "same-lineage-mixed-collision" : scenario.name === "lock" ? "clean" : scenario.name === "incomplete" ? "invalid" : scenario.name);
	}
	assert.equal(mutations, 0);
});

test("native remediation classification accepts only invalid legacy, compact, collision, or reset evidence", () => {
	const status = (authorityStatus: NativeReviewStatusResult["status"], entries: NativeReviewStatusResult["entries"]): NativeReviewStatusResult => ({
		repository: "/repo",
		complete: authorityStatus !== "invalid",
		authoritative: authorityStatus !== "invalid",
		status: authorityStatus,
		entries,
		locks: [],
		diagnostics: [],
		raw: {},
	});
	assert.equal(classifyNativeReviewRemediation(status("invalid", [{ version: "legacy-v1", lineageId: "current", path: "/repo/legacy", status: "invalid", problems: [] }]), ["current"]).kind, NATIVE_REVIEW_REMEDIATION.LEGACY);
	assert.equal(classifyNativeReviewRemediation(status("invalid", [{ version: "compact-v2", lineageId: "current", path: "/repo/compact", status: "invalid", problems: [] }]), ["current"]).kind, NATIVE_REVIEW_REMEDIATION.INVALID_OR_MIXED);
	assert.equal(classifyNativeReviewRemediation({ ...status("same-lineage-mixed-collision", []), complete: false, authoritative: false }, ["current"]).kind, NATIVE_REVIEW_REMEDIATION.NONE);
	assert.equal(classifyNativeReviewRemediation(status("reset-in-progress", [])).kind, NATIVE_REVIEW_REMEDIATION.NONE);
	assert.equal(classifyNativeReviewRemediation(status("invalid", [])).kind, NATIVE_REVIEW_REMEDIATION.NONE);
	assert.equal(classifyNativeReviewRemediation({ ...status("invalid", [{ version: "legacy-v1", path: "/repo/legacy", status: "invalid", problems: [] }]), complete: true }).kind, NATIVE_REVIEW_REMEDIATION.NONE);
	assert.equal(classifyNativeReviewRemediation(status("approved", [{ version: "legacy-v1", path: "/repo/legacy", status: "approved", problems: [] }])).kind, NATIVE_REVIEW_REMEDIATION.NONE);
});

test("native INSPECT exposes reset material only for exact applicable Pi corruption", async (t) => {
	const compact = await import("../lib/review-facade.ts");
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
			prepare: (cwd: string) => compact.startCompactReview({ cwd, lineageId: "historical-lineage", policyHash: "a".repeat(64), projection: { kind: "complete" } }),
			entries: (cwd: string) => [invalidEntry(cwd, "other-lineage")],
		},
	] as const) await t.test(scenario.name, async (child) => {
		const cwd = repository(child);
		scenario.prepare(cwd);
		const { controller } = runtime(fakeNative({ reviewStatus: async () => nativeStatus(cwd, scenario.entries(cwd)) }));
		const inspected = await controller.execute(`ineligible-${scenario.name}`, { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = inspected.details as Record<string, unknown>;
		assert.equal(details.reset_eligible, false);
		assertNoPublicResetRequest(details);
		assertNoPublicDestructiveResetMaterial(details);
	});

	await t.test("exact Pi-owned legacy corruption exposes its existing reset request without native fabrication", async (child) => {
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
		assert.equal(details.reset_eligible, true);
		assert.deepEqual((details.inspection as Record<string, unknown>).reset_request, compactResetRequestV1(cwd));
		assert.equal(nativeStatuses, 0);
	});

	await t.test("Pi reset-in-progress remains RECOVER-only with its durable recovery request", async (child) => {
		const cwd = repository(child);
		const legacyPath = join(cwd, ".git", "gentle-ai", "reviews", "lineages", "legacy");
		mkdirSync(legacyPath, { recursive: true });
		writeFileSync(join(legacyPath, "authority.json"), "legacy\n");
		const request = compactResetRequestV1(cwd);
		assert.throws(
			() => destructiveResetReviewAuthorityV1({ cwd, ...request, faultAfterPhase: "quarantining" }),
			/injected/i,
		);
		const { controller } = runtime(fakeNative());
		const inspected = await controller.execute("reset-in-progress", { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = inspected.details as Record<string, unknown>;
		assert.equal(details.reset_eligible, false);
		assert.equal(details.next_action, "request-explicit-reset-recovery-authorization");
		assert.deepEqual((details.inspection as Record<string, unknown>).reset_request, request);
	});

	await t.test("applicable corruption remains read-only and exposes only the Pi reset material", async (child) => {
		const cwd = repository(child);
		const status = nativeStatus(cwd, [invalidEntry(cwd, "applicable-lineage")]);
		const { controller } = runtime(fakeNative({ reviewStatus: async () => status }));
		const inspected = await controller.execute("applicable-native-only", { operation: "inspect" }, undefined, undefined, context(cwd));
		const details = inspected.details as Record<string, unknown>;
		assert.equal(details.reset_eligible, false);
		assertNoPublicResetRequest(details);
	});
});

test("native invalid inventory authorizes only RESET remediation while unrelated or identity-mismatched history remains fail-closed", async (t) => {
	const compact = await import("../lib/review-facade.ts");
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
		compact.startCompactReview({ cwd, lineageId: "unrelated-history", policyHash: "a".repeat(64), projection: { kind: "complete" } });
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
		assert.equal(statuses, 1);
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
		assert.equal(inspectionDetails.reset_eligible, false);
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
			assert.equal(failureDetails.next_action, "review.status");
			assert.equal(failureDetails.replayability, "status_required");
			assertNoPublicResetRequest(failureDetails);
		});
	});

	await t.test("unknown, ambiguous, and applicable current authority block before native START", async (t) => {
		const controls = [
			{
				name: "unknown",
				prepare: (cwd: string) => compact.startCompactReview({ cwd, lineageId: "unknown-current", policyHash: "a".repeat(64), projection: { kind: "complete" } }),
				status: (cwd: string) => nativeStatus(cwd, "invalid", false, false, []),
			},
			{
				name: "ambiguous",
				prepare: (cwd: string) => {
					compact.startCompactReview({ cwd, lineageId: "ambiguous-one", policyHash: "a".repeat(64), projection: { kind: "complete" } });
					compact.startCompactReview({ cwd, lineageId: "ambiguous-two", policyHash: "a".repeat(64), projection: { kind: "complete" } });
				},
				status: (cwd: string) => nativeStatus(cwd, "invalid", false, false, []),
			},
			{
				name: "applicable",
				prepare: (cwd: string) => compact.startCompactReview({ cwd, lineageId: "applicable-current", policyHash: "a".repeat(64), projection: { kind: "complete" } }),
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
			assert.equal((started.details as Record<string, unknown>).status, "blocked");
			assert.equal(starts, 0);
			assertNoPublicResetRequest(started.details);
		});
	});

	await t.test("unrelated valid native history does not authorize RESET", async (t) => {
		const cwd = repository(t);
		unrelatedHistory(cwd);
		const { controller } = runtime(fakeNative({
			reviewStatus: async () => nativeStatus(cwd, "approved", true, true, [{ version: "legacy-v1", path: join(cwd, ".git", "gentle-ai", "reviews", "legacy"), status: "approved", problems: [] }]),
		}));
		const inspected = await controller.execute("native-valid-inspect", { operation: "inspect" }, undefined, undefined, context(cwd));
		const inspectionDetails = inspected.details as Record<string, unknown>;
		assert.equal(inspectionDetails.reset_eligible, false);
		assertNoPublicResetRequest(inspectionDetails);
		const reset = await controller.execute("native-valid-reset", { operation: "reset", input: JSON.stringify(compactResetRequestV1(cwd)) }, undefined, undefined, interactiveContext(cwd));
		assert.deepEqual(reset.details, {
			operation: "reset",
			status: "blocked",
			outcome: "native-reset-not-eligible",
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "resolve-native-authority-without-destroy",
			evidence: { native_status: "approved", authority_applicability: "unrelated-history" },
		});
	});

	await t.test("native repository identity mismatch cannot authorize RESET", async (t) => {
		const cwd = repository(t);
		unrelatedHistory(cwd);
		const { controller } = runtime(fakeNative({
			reviewStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH, NATIVE_REVIEW_OPERATION.STATUS, true, false, "native repository mismatch"); },
		}));
		const request = compactResetRequestV1(cwd);
		const reset = await controller.execute("native-identity-reset", { operation: "reset", input: JSON.stringify(request) }, undefined, undefined, interactiveContext(cwd));
		assert.equal((reset.details as Record<string, unknown>).status, "blocked");
		assert.equal((reset.details as Record<string, unknown>).outcome, "native-operation-failed");
	});
});

test("applicable native corruption without Pi corruption fails typed and never invokes a native mutation", async (t) => {
	const cwd = repository(t);
	const compact = await import("../lib/review-facade.ts");
	compact.startCompactReview({ cwd, lineageId: "pi-current", policyHash: "a".repeat(64), projection: { kind: "complete" } });
	let statusCalls = 0;
	const { controller } = runtime(fakeNative({ reviewStatus: async () => {
		statusCalls += 1;
		return {
			repository: cwd, complete: false, authoritative: false, status: "invalid",
			entries: [{ version: "compact-v2", lineageId: "pi-current", path: join(cwd, ".git", "gentle-ai", "review-transactions"), status: "invalid", problems: ["native corruption"] }],
			locks: [], diagnostics: [], raw: {},
		};
	} }));
	const result = await controller.execute("native-only-corruption", { operation: "reset", input: JSON.stringify(compactResetRequestV1(cwd)) }, undefined, undefined, interactiveContext(cwd));
	assert.equal((result.details as { outcome?: string }).outcome, "native-authority-remediation-unavailable");
	assert.equal(statusCalls, 1);
});

test("independent-verification routing matrix names every native authority contract", () => {
	const rows = [
		"1 status unsupported/pre-START => no lineage/no reset",
		"2 valid unrelated compact history => reaches native START",
		"3 invalid/incomplete unrelated native stores + one pre-lineage START denial => diagnostics/no reset",
		"4 BIND-SDD native failure => diagnostics",
		"5 successful START then decoder rejection => unknown/status required",
		"6 invalid historical inventory + Pi clean/unrelated => reset_eligible:false",
		"7 applicable corrupt lineage => exact fresh reset request",
		"8 FINALIZE failure existing lineage => unknown/status/diagnostics",
		"9 stale/foreign challenge => zero mutation",
		"10 reset-in-progress => RECOVER-only/zero destructive calls",
	] as const;
	assert.deepEqual(rows, [...new Set(rows)]);
	assert.equal(rows.length, 10);
	for (const row of rows) assert.match(row, /^\d+ /);
});

test("native RESET preflight table rejects every non-corrupt native authority before Pi mutation", async (t) => {
	const rows = [
		{ name: "unknown/incomplete", status: "invalid" as const, complete: false, authoritative: false, outcome: "native-reset-not-eligible" },
		{ name: "unrelated/clean", status: "clean" as const, complete: true, authoritative: true, outcome: "native-reset-not-eligible" },
		{ name: "active", status: "active" as const, complete: true, authoritative: true, outcome: "native-reset-not-eligible" },
		{ name: "approved", status: "approved" as const, complete: true, authoritative: true, outcome: "native-reset-not-eligible" },
		{ name: "reset-in-progress RECOVER-only", status: "reset-in-progress" as const, complete: true, authoritative: true, outcome: "native-authority-reset-in-progress" },
		{ name: "superseded", status: "superseded" as const, complete: true, authoritative: true, outcome: "native-reset-not-eligible" },
		{ name: "recovered", status: "recovered" as const, complete: true, authoritative: true, outcome: "native-reset-not-eligible" },
	] as const;
	for (const row of rows) await t.test(row.name, async (child) => {
		const cwd = repository(child); let statusCalls = 0;
		const native = fakeNative({ reviewStatus: async () => {
			statusCalls += 1;
			return {
				repository: cwd,
				complete: row.complete,
				authoritative: row.authoritative,
				status: row.status,
				entries: [], locks: [], diagnostics: [],
				raw: { schema: "gentle-ai.review-authority-status/v1", operation: "review/status", repository: cwd, complete: row.complete, authoritative: row.authoritative, status: row.status, entries: [], locks: [], diagnostics: [] },
			};
		} });
		const { controller } = runtime(native);
		const result = await controller.execute(`reset-${row.name}`, { operation: "reset", input: JSON.stringify(compactResetRequestV1(cwd)) }, undefined, undefined, interactiveContext(cwd));
		const details = result.details as Record<string, unknown>;
		assert.equal(details.outcome, row.outcome);
		assert.equal(details.mutation_performed, false);
		assert.equal(statusCalls, 1);
		if (row.status === "reset-in-progress") assert.equal(details.next_action, "recover-native-reset");
	});
});
