import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AGENT_MODE, type AgentDefinition } from "../lib/agents-config.ts";
import { AgentRunner, type TaskRequest } from "../lib/agents-runner.ts";
import { TaskStore } from "../lib/agents-protocol.ts";
import { createNodeExecFileAdapter, NativeReviewCliV216, decodeNativeSddStatusV2, NATIVE_REVIEW_ERROR_CODE, NativeReviewCliError } from "../lib/native-review-cli.ts";
import { createGentleAiExtension, __testing } from "../extensions/gentle-ai.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NativeReviewCli, NativeSddStatusV2 } from "../lib/native-review-cli.ts";
import { ensureSddPreflight } from "../lib/sdd-preflight.ts";
import { fakeChild } from "./agents-fake-child.ts";

const applyAgent: AgentDefinition = {
	name: "sdd-apply",
	description: "Apply the selected change.",
	filePath: "/agents/sdd-apply.md",
	scope: "global",
	instructions: "SDD apply executor",
	model: undefined,
	thinking: undefined,
	mode: undefined,
	tools: ["read"],
};

function request(sddChange: { changeName: string; workspaceRoot: string; phase: "apply" }): TaskRequest {
	return {
		agent: applyAgent,
		prompt: "Apply selected change.",
		label: undefined,
		context: undefined,
		mode: AGENT_MODE.BACKGROUND,
		cwd: sddChange.workspaceRoot,
		parentSessionId: "parent",
		model: undefined,
		thinking: undefined,
		sessionDir: "/sessions",
		resumeSessionPath: undefined,
		env: {},
		sddChange,
	};
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function workspace(t: test.TestContext): string {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-sdd-selection-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "openspec", "changes", "alpha"), { recursive: true });
	mkdirSync(join(root, "openspec", "changes", "beta"), { recursive: true });
	return realpathSync(root);
}

test("remediation read tools are limited to canonical relative paths inside the confirmed worktree", async (t) => {
	const { remediationToolAllowed } = await import("../extensions/gentle-agents.ts");
	const cwd = workspace(t), outside = mkdtempSync(join(tmpdir(), "gentle-pi-remediation-outside-"));
	t.after(() => rmSync(outside, { recursive: true, force: true }));
	symlinkSync(outside, join(cwd, "escape"));
	const scope = { cwd, editPaths: [], commands: ["pnpm test"], allowedEditRoots: [cwd] };
	for (const tool of ["read", "grep", "find"]) {
		assert.equal(remediationToolAllowed(scope, cwd, tool, {}), true, `${tool} defaults to cwd`);
		assert.equal(remediationToolAllowed(scope, cwd, tool, { path: "openspec" }), true);
		for (const path of [join(cwd, "openspec"), "../outside", "escape", "", 7]) assert.equal(remediationToolAllowed(scope, cwd, tool, { path }), false, `${tool} denies malformed or escaping paths`);
	}
	assert.equal(remediationToolAllowed(scope, cwd, "write", { path: "openspec" }), false);
	assert.equal(remediationToolAllowed(scope, cwd, "bash", { command: "pnpm test" }), true);
	assert.equal(remediationToolAllowed(scope, cwd, "subagent_parent_message", {}), true);
});

test("selected SDD change snapshots at task construction and reaches child startup in a multi-change workspace", async (t) => {
	const root = workspace(t);
	const selection = { changeName: "alpha", workspaceRoot: root, phase: "apply" as const };
	const spawned: string[][] = [];
	const runner = new AgentRunner(new TaskStore(), { maxConcurrency: 2, stallTimeoutMs: 1_000 }, {
		spawn: (_command, args) => {
			spawned.push(args);
			return fakeChild().child;
		},
		now: () => 1,
		schedule: () => () => {},
		pi: { command: "pi", args: [] },
	}, { askUser: async () => ({ cancelled: true }) });

	runner.run(request(selection));
	selection.changeName = "beta";
	runner.run(request({ changeName: "beta", workspaceRoot: root, phase: "apply" }));
	await tick();
	const serialized = spawned[0]![spawned[0]!.indexOf("--gentle-sdd-change") + 1]!;
	const concurrent = spawned[1]![spawned[1]!.indexOf("--gentle-sdd-change") + 1]!;
	assert.deepEqual(JSON.parse(serialized), { changeName: "alpha", workspaceRoot: root, phase: "apply" });
	assert.deepEqual(JSON.parse(concurrent), { changeName: "beta", workspaceRoot: root, phase: "apply" });
	const startup = __testing.resolveSddChangeStartup(serialized, root, "sdd-apply");
	assert.equal(startup.status.changeName, "alpha");
	assert.equal(startup.status.nextRecommended, "sdd-propose");
});

test("selected native v2 archive authority is injected whole and never falls back to the local resolver", async (t) => {
	const root = workspace(t);
	const serialized = JSON.stringify({ changeName: "alpha", workspaceRoot: root, phase: "archive" });
	const nativeAuthority = {
		schemaName: "gentle-ai.sdd-status",
		schemaVersion: 2,
		changeName: "alpha",
		artifactStore: "openspec",
		planningHome: { mode: "repo-local", path: join(root, "openspec") },
		changeRoot: join(root, "openspec/changes/alpha"),
		actionContext: { mode: "repo-local", workspaceRoot: root, allowedEditRoots: [root] },
		dependencies: { proposal: "all_done", specs: "all_done", design: "all_done", tasks: "all_done", apply: "all_done", verify: "all_done", archive: "ready" },
		phaseInstructions: { apply: ["done"], verify: ["done"], remediate: ["failed evidence"], archive: ["archive now"] },
		blockedReasons: [],
		nextRecommended: "archive",
	};
	const nativeCalls: unknown[] = [];
	let localResolverCalls = 0;
	const startup = await (__testing as unknown as {
		resolveSelectedNativeSddChangeStartup(
			serialized: unknown,
			cwd: string,
			agentName: string,
			native: { sddStatus?: (request: unknown) => Promise<unknown> },
			localResolver: () => unknown,
		): Promise<{ selection: { changeName: string; workspaceRoot: string; phase: string }; status: unknown }>;
	}).resolveSelectedNativeSddChangeStartup(serialized, root, "sdd-archive", {
		sddStatus: async (request) => { nativeCalls.push(request); return nativeAuthority; },
	}, () => {
		localResolverCalls += 1;
		// Simulates local v1's missing sync-report.md result: it must never
		// overlay the native archive-ready authority.
		return { dependencies: { verify: "all_done", sync: "blocked", archive: "blocked" } };
	});

	assert.deepEqual(startup.selection, { changeName: "alpha", workspaceRoot: root, phase: "archive" });
	assert.equal(startup.status, nativeAuthority, "the validated native status object is injected without a local overlay");
	assert.deepEqual(nativeCalls, [{ changeName: "alpha", workspaceRoot: root }]);
	assert.equal(localResolverCalls, 0);
});

test("selected native v2 failures fail closed without consulting the local resolver", async (t) => {
	const root = workspace(t);
	const serialized = JSON.stringify({ changeName: "alpha", workspaceRoot: root, phase: "archive" });
	const valid = {
		schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha", artifactStore: "openspec",
		planningHome: { mode: "repo-local", path: join(root, "openspec") }, changeRoot: join(root, "openspec/changes/alpha"),
		actionContext: { mode: "repo-local", workspaceRoot: root, allowedEditRoots: [root] },
		dependencies: { proposal: "all_done", specs: "all_done", design: "all_done", tasks: "all_done", apply: "all_done", verify: "all_done", archive: "blocked" },
		phaseInstructions: { apply: ["done"], verify: ["done"], remediate: ["failed evidence"], archive: ["blocked"] },
		blockedReasons: ["native archive blocker"], nextRecommended: "verify",
	};
	const failures: Array<{ sddStatus?: () => Promise<unknown> }> = [
		{},
		{ sddStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.TIMEOUT, "sdd-status", true, false, "native timeout"); } },
		{ sddStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, "sdd-status", true, false, "native nonzero"); } },
		{ sddStatus: async () => { throw new Error("native command threw"); } },
		{ sddStatus: async () => ({}) },
		{ sddStatus: async () => ({ ...valid, schemaVersion: 1 }) },
		{ sddStatus: async () => ({ ...valid, changeName: "other" }) },
		{ sddStatus: async () => ({ ...valid, actionContext: { workspaceRoot: "/other" } }) },
		{ sddStatus: async () => ({ ...valid, dependencies: { apply: "all_done", verify: "all_done" } }) },
		{ sddStatus: async () => ({ ...valid, phaseInstructions: { apply: ["done"], verify: ["done"] } }) },
		{ sddStatus: async () => ({ ...valid, blockedReasons: "invalid" }) },
	];
	for (const native of failures) {
		let localResolverCalls = 0;
		await assert.rejects(
			() => (__testing as unknown as {
				resolveSelectedNativeSddChangeStartup(
					serialized: unknown, cwd: string, agentName: string,
					native: { sddStatus?: () => Promise<unknown> }, localResolver: () => unknown,
				): Promise<unknown>;
			}).resolveSelectedNativeSddChangeStartup(serialized, root, "sdd-archive", native, () => { localResolverCalls += 1; return {}; }),
			/SDD selection native status/i,
		);
		assert.equal(localResolverCalls, 0);
	}

	await assert.rejects(
		() => (__testing as unknown as {
			resolveSelectedNativeSddChangeStartup(
				serialized: unknown, cwd: string, agentName: string,
				native: { sddStatus?: () => Promise<unknown> }, localResolver: () => unknown,
			): Promise<unknown>;
		}).resolveSelectedNativeSddChangeStartup(serialized, root, "sdd-archive", { sddStatus: async () => valid }, () => {
			throw new Error("local resolver must not run");
		}),
		/native status.*blocks|cannot execute/i,
	);

	const syncSerialized = JSON.stringify({ changeName: "alpha", workspaceRoot: root, phase: "sync" });
	const localStatus = __testing.resolveSddChangeStartup(syncSerialized, root, "sdd-sync").status;
	const syncNativeCalls: unknown[] = [];
	const syncLocalCalls: unknown[] = [];
	const sync = await (__testing as unknown as {
		resolveSelectedNativeSddChangeStartup(
			serialized: unknown, cwd: string, agentName: string,
			native: { sddStatus?: (request: unknown) => Promise<unknown> }, localResolver: (options: unknown) => unknown,
		): Promise<{ status: unknown }>;
	}).resolveSelectedNativeSddChangeStartup(syncSerialized, root, "sdd-sync", {
		sddStatus: async (request) => { syncNativeCalls.push(request); throw new Error("native must not run"); },
	}, (options) => {
		syncLocalCalls.push(options);
		return localStatus;
	});
	assert.equal(sync.status, localStatus, "selected sync injects the exact local status");
	assert.deepEqual(syncLocalCalls, [{ cwd: root, workspaceRoot: root, changeName: "alpha", includeInstructions: true }]);
	assert.deepEqual(syncNativeCalls, []);

	await assert.rejects(
		() => (__testing as unknown as {
			resolveSelectedNativeSddChangeStartup(
				serialized: unknown, cwd: string, agentName: string,
				native: { sddStatus?: () => Promise<unknown> }, localResolver: () => typeof localStatus,
			): Promise<unknown>;
		}).resolveSelectedNativeSddChangeStartup(syncSerialized, root, "sdd-sync", undefined, () => ({ ...localStatus, changeName: "beta" })),
		/mismatched status/i,
	);
});

function nativeStartup(
	serialized: unknown,
	cwd: string,
	agentName: string,
	native: { sddStatus: (request: unknown) => Promise<unknown> },
) {
	return (__testing as unknown as {
		resolveSelectedNativeSddChangeStartup(
			serialized: unknown, cwd: string, agentName: string,
			native: { sddStatus?: (request: unknown) => Promise<unknown> },
		): Promise<{ selection: { changeName: string; workspaceRoot: string; phase: string }; status: NativeSddStatusV2 }>;
	}).resolveSelectedNativeSddChangeStartup(serialized, cwd, agentName, native);
}

function verifyRefreshAuthority(root: string, blockedReasons: readonly string[]) {
	return {
		schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha", artifactStore: "openspec",
		planningHome: { mode: "repo-local", path: join(root, "openspec") }, changeRoot: join(root, "openspec/changes/alpha"),
		actionContext: { mode: "repo-local", workspaceRoot: root, allowedEditRoots: [root] },
		dependencies: { proposal: "all_done", specs: "all_done", design: "all_done", tasks: "all_done", apply: "all_done", verify: "ready", archive: "blocked" },
		phaseInstructions: { apply: ["done"], verify: ["rerun SDD verification"], remediate: ["failed evidence"], archive: ["blocked"] },
		blockedReasons: [...blockedReasons], nextRecommended: "verify",
	};
}

test("a native verify evidence-refresh route starts under its own blocker while every other phase stays closed", async (t) => {
	const root = workspace(t);
	const refreshReason = "failed verification evidence is incomplete; rerun SDD verification";
	const authority = verifyRefreshAuthority(root, [refreshReason]);
	const startup = await nativeStartup(
		JSON.stringify({ changeName: "alpha", workspaceRoot: root, phase: "verify" }),
		root,
		"sdd-verify",
		{ sddStatus: async () => authority },
	);
	assert.deepEqual(startup.selection, { changeName: "alpha", workspaceRoot: root, phase: "verify" });
	assert.equal(startup.status, authority, "the validated native status is injected whole, blockers included");
	assert.deepEqual(startup.status.blockedReasons, [refreshReason], "the blocking reason is preserved for reporting");

	for (const phase of ["apply", "archive"] as const) {
		const gated = {
			...verifyRefreshAuthority(root, [refreshReason]),
			nextRecommended: phase,
			dependencies: { ...authority.dependencies, [phase]: "ready", verify: "all_done" },
		};
		await assert.rejects(
			() => nativeStartup(
				JSON.stringify({ changeName: "alpha", workspaceRoot: root, phase }),
				root,
				`sdd-${phase}`,
				{ sddStatus: async () => gated },
			),
			/native status blocks phase/i,
		);
	}
});

test("a throwing SDD selection flag reader fails closed without resolving an unselected status", (t) => {
	const root = workspace(t);
	assert.equal(__testing.readSddChangeFlag({ getFlag: () => false } as never), undefined);
	const selection = __testing.readSddChangeFlag({
		getFlag() { throw new Error("flag reader failed"); },
	} as never);
	let resolverCalls = 0;
	assert.throws(
		() => __testing.resolveSddChangeStartup(selection, root, "sdd-apply", () => {
			resolverCalls += 1;
			throw new Error("status resolver must not run");
		}),
		/SDD selection must be a JSON string/i,
	);
	assert.equal(resolverCalls, 0);
});

test("selected SDD startup fails closed for malformed identity, root, phase, symlink, and resolver errors", (t) => {
	const root = workspace(t);
	const selected = JSON.stringify({ changeName: "alpha", workspaceRoot: root, phase: "apply" });
	const outside = mkdtempSync(join(tmpdir(), "gentle-pi-sdd-selection-outside-"));
	t.after(() => rmSync(outside, { recursive: true, force: true }));
	const escaped = join(root, "escaped-root");
	symlinkSync(outside, escaped);

	for (const value of [
		undefined,
		null,
		"not-json",
		JSON.stringify({ changeName: "alpha", workspaceRoot: root, phase: "apply", extra: true }),
		JSON.stringify({ changeName: "alpha", workspaceRoot: join(root, "wrong"), phase: "apply" }),
		JSON.stringify({ changeName: "alpha", workspaceRoot: escaped, phase: "apply" }),
	]) {
		assert.throws(() => __testing.resolveSddChangeStartup(value, root, "sdd-apply"), /SDD selection/i);
	}
	assert.throws(() => __testing.resolveSddChangeStartup(selected, root, "sdd-verify"), /phase/i);
	assert.throws(
		() => __testing.resolveSddChangeStartup(selected, root, "sdd-apply", () => { throw new Error("resolver failed"); }),
		/resolver failed/i,
	);
});

// Use the packaged executor body without an unsupported agent-name event field.
test("before_agent_start resolves the unnamed packaged executor and renders native v2 selection", async (t) => {
	const root = workspace(t);
	const systemPrompt = readFileSync(new URL("../assets/agents/sdd-apply.md", import.meta.url), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
	const selection = { changeName: "alpha", workspaceRoot: root, phase: "apply" };
	const status = {
		schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha", artifactStore: "openspec",
		planningHome: { mode: "repo-local", path: join(root, "openspec") }, changeRoot: join(root, "openspec/changes/alpha"),
		actionContext: { mode: "repo-local", workspaceRoot: root, allowedEditRoots: [root] },
		dependencies: { proposal: "all_done", specs: "all_done", design: "all_done", tasks: "all_done", apply: "ready", verify: "blocked", archive: "blocked" },
		phaseInstructions: { apply: ["Read proposal, specs, design, and tasks before editing."], verify: ["Verify implementation."], remediate: ["Bind failed evidence."], archive: ["Archive after verification."] },
		blockedReasons: [], nextRecommended: "apply",
	};
	let serialized: unknown = JSON.stringify(selection);
	let nativeReply: unknown = status;
	const calls: unknown[] = [];
	type Hook = (event: unknown, ctx: ExtensionContext) => Promise<{ systemPrompt: string }>;
	const hooks = new Map<string, Hook>();
	const pi = {
		on(name: string, hook: Hook) { hooks.set(name, hook); },
		events: { emit() {} }, registerCommand() {}, registerTool() {},
		getFlag: () => serialized, getActiveTools: () => [],
	} as unknown as ExtensionAPI;
	const ctx = { cwd: root, hasUI: false, sessionManager: { getSessionId: () => root } } as unknown as ExtensionContext;
	await ensureSddPreflight(ctx, { pi, installAssets: () => ({ agents: 0, chains: 0, support: 0, skipped: 0 }) });
	createGentleAiExtension({
		nativeReviewCli: { sddStatus: async (request: unknown) => { calls.push(request); return nativeReply; } } as unknown as NativeReviewCli,
		processEnv: {},
		resolveTelemetryTriggerBinary: () => { throw new Error("no telemetry in hook tests"); },
	})(pi);
	const result = await hooks.get("before_agent_start")!({ systemPrompt }, ctx);
	assert.doesNotMatch(result.systemPrompt, /SDD selection blocked:/);
	assert.deepEqual(calls, [{ changeName: "alpha", workspaceRoot: root }]);
	assert.match(result.systemPrompt, /### apply instructions/);
	assert.ok(result.systemPrompt.includes(status.phaseInstructions.apply[0]!));
	assert.ok(result.systemPrompt.includes(JSON.stringify(status, null, 2)));
	for (const [name, event] of [
		["contradictory names", { systemPrompt, agentName: "sdd-apply", name: "sdd-verify" }],
		["contradictory named phase", { systemPrompt, agentName: "sdd-verify" }],
		["unknown explicit name", { systemPrompt, agentName: "worker" }],
		["ambiguous executor body", { systemPrompt: `${systemPrompt}\nSDD verify executor` }],
		["unknown executor body", { systemPrompt: "SDD unknown executor" }],
	] as const) {
		await t.test(name, async () => {
			calls.length = 0;
			assert.match((await hooks.get("before_agent_start")!(event, ctx)).systemPrompt, /SDD selection blocked:/);
			assert.deepEqual(calls, []);
		});
	}
	for (const invalid of [null, "not-json", { ...selection, phase: "verify" }, { ...selection, workspaceRoot: "/other" }]) {
		serialized = typeof invalid === "object" && invalid !== null ? JSON.stringify(invalid) : invalid;
		calls.length = 0;
		assert.match((await hooks.get("before_agent_start")!({ systemPrompt }, ctx)).systemPrompt, /SDD selection blocked:/);
		assert.deepEqual(calls, []);
	}
	serialized = JSON.stringify(selection);
	for (const invalid of [{ ...status, phaseInstructions: undefined }, { ...status, nextRecommended: "unknown" }]) {
		nativeReply = invalid;
		assert.match((await hooks.get("before_agent_start")!({ systemPrompt }, ctx)).systemPrompt, /SDD selection blocked:/);
	}
	serialized = undefined;
	nativeReply = status;
	calls.length = 0;
	await hooks.get("before_agent_start")!({ systemPrompt }, ctx);
	assert.deepEqual(calls, [{ changeName: undefined, workspaceRoot: root }], "unselected startup reads native discovery, never local readiness");
	const callTool = hooks.get("tool_call")! as unknown as (event: { toolName: string; input: Record<string, unknown> }, context: ExtensionContext) => Promise<{ block?: boolean } | undefined>;
	const assertStartupBlocked = async (reply: unknown) => {
		serialized = undefined; nativeReply = reply;
		assert.match((await hooks.get("before_agent_start")!({ systemPrompt }, ctx)).systemPrompt, /SDD selection blocked:/);
		for (const [toolName, input] of [["write", { path: "allowed.ts" }], ["edit", { path: "allowed.ts" }], ["bash", { command: "echo unsafe" }]] as const) {
			assert.equal((await callTool({ toolName, input }, ctx))?.block, true, `${toolName} is mechanically blocked after ambiguous native startup`);
		}
		assert.equal(await callTool({ toolName: "subagent_parent_message", input: {} }, ctx), undefined, "parent messaging remains available");
	};
	for (const invalid of [{ ...status, changeName: null }, { ...status, phaseInstructions: undefined }, { ...status, nextRecommended: "unknown" }, { ...status, nextRecommended: "propose" }, { ...status, nextRecommended: "verify" }]) await assertStartupBlocked(invalid);
	for (const phase of ["apply", "verify", "remediate", "archive"] as const) {
		const phasePrompt = readFileSync(new URL(`../assets/agents/sdd-${phase}.md`, import.meta.url), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
		serialized = undefined;
		nativeReply = { ...status, nextRecommended: phase, ...(phase === "remediate" ? { remediationState: { required: true, complete: false, failedEvidenceRevision: `sha256:${"a".repeat(64)}` } } : {}) };
		assert.doesNotMatch((await hooks.get("before_agent_start")!({ systemPrompt: phasePrompt }, ctx)).systemPrompt, /SDD selection blocked:/);
		assert.equal((await callTool({ toolName: "read", input: {} }, ctx))?.block, undefined, `${phase} accepts its matching native recommendation`);
	}
	const syncPrompt = readFileSync(new URL("../assets/agents/sdd-sync.md", import.meta.url), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
	calls.length = 0; nativeReply = { ...status, changeName: null };
	assert.doesNotMatch((await hooks.get("before_agent_start")!({ systemPrompt: syncPrompt }, ctx)).systemPrompt, /SDD selection blocked:/);
	assert.deepEqual(calls, [], "manual sync remains local and never consults native discovery");
	serialized = JSON.stringify(selection);
	for (const blockedReply of [
		{ ...status, dependencies: { ...status.dependencies, apply: "blocked" }, blockedReasons: ["missing native prerequisite"] },
		{ ...status, nextRecommended: "verify" },
	]) {
		nativeReply = blockedReply;
		const blocked = await hooks.get("before_agent_start")!({ systemPrompt }, ctx);
		assert.match(blocked.systemPrompt, /SDD selection blocked:/);
		assert.equal((await callTool({ toolName: "write", input: { path: "unsafe.ts" } }, ctx))?.block, true);
	}

});

// Opt-in controlled producer proof; never resolves or installs a global binary.
test("producer v2 preservation: selected status is read-only and retains all seven dependencies", { skip: !process.env.SDD_TEST_PRODUCER }, async (t) => {
	const root = workspace(t);
	execFileSync("git", ["init", "--quiet", root]);
	const args = ["sdd-status", "alpha", "--cwd", root, "--json", "--instructions"];
	const first = execFileSync(process.env.SDD_TEST_PRODUCER!, args, { encoding: "utf8" });
	const second = execFileSync(process.env.SDD_TEST_PRODUCER!, args, { encoding: "utf8" });
	assert.equal(first, second);
	const status = decodeNativeSddStatusV2(JSON.parse(first), { changeName: "alpha", workspaceRoot: root });
	assert.deepEqual(Object.keys(status.dependencies).sort(), ["apply", "archive", "design", "proposal", "specs", "tasks", "verify"]);
	assert.deepEqual(Object.keys(status.phaseInstructions!).sort(), ["apply", "archive", "remediate", "verify"]);
	assert.equal(status.nextRecommended, "propose");
	const verbs: string[] = [];
	const adapter = createNodeExecFileAdapter();
	const native = new NativeReviewCliV216(async (request) => { verbs.push(request.arguments[0]!); return adapter(request); }, process.env.SDD_TEST_PRODUCER!);
	const h = commandHarness(root, status, true, true, native);
	await h.run("status");
	assert.deepEqual(JSON.parse(h.notices[0]!), status);
	assert.deepEqual(verbs, ["sdd-status"]);
	await h.run("continue");
	assert.deepEqual(verbs, ["sdd-status", "sdd-status", "sdd-continue"]);
	assert.equal(JSON.parse(h.notices[1]!).nextRecommended, "propose");
	assert.throws(() => readFileSync(join(root, "openspec/changes/alpha/.gentle-ai-instance")), /ENOENT/);
});

function commandHarness(root: string, status: unknown, answer?: unknown, hasUI = true, native?: NativeReviewCli) {
	const calls: string[] = [];
	const notices: string[] = [];
	const confirmations: string[] = [];
	const commands = new Map<string, (args: string, ctx: ExtensionContext) => Promise<void>>();
	const pi = {
		on() {}, events: { emit() {} }, registerTool() {},
		registerCommand(name: string, command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) { commands.set(name, command.handler); },
		sendUserMessage() { calls.push("launch"); }, sendMessage() { calls.push("launch"); },
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: native ?? {
		sddStatus: async () => { calls.push("status"); return status; },
		sddContinue: async () => { calls.push("continue"); return status; },
	} as unknown as NativeReviewCli, processEnv: {} })(pi);
	const ctx = { cwd: root, hasUI, ui: {
		notify: (text: string) => notices.push(text),
		confirm: async (title: string, text: string) => { confirmations.push(`${title}\n${text}`); return answer; },
	} } as unknown as ExtensionContext;
	return { calls, notices, confirmations, ctx, run: (verb: string) => commands.get(`gentle-sdd-${verb}`)!("alpha --json", ctx) };
}

function commandStatus(root: string) {
	return {
		schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha", artifactStore: "openspec",
		planningHome: { mode: "repo-local", path: join(root, "openspec") }, changeRoot: join(root, "openspec/changes/alpha"),
		actionContext: { mode: "repo-local", workspaceRoot: root, allowedEditRoots: [root] },
		dependencies: { proposal: "ready", specs: "blocked", design: "blocked", tasks: "blocked", apply: "blocked", verify: "blocked", archive: "blocked" },
		phaseInstructions: { apply: ["misleading prose: apply now"], verify: [], remediate: [], archive: [] },
		blockedReasons: ["prepare only; source roots remain ungranted"], nextRecommended: "propose",
	};
}

test("status command renders native facts without confirmation, mutation, or phase launch", async (t) => {
	const root = workspace(t);
	const status = commandStatus(root);
	const h = commandHarness(root, status, true);
	await h.run("status");
	assert.deepEqual(h.calls, ["status"]);
	assert.deepEqual(JSON.parse(h.notices[0]!), status);
	assert.deepEqual(h.confirmations, []);
});

test("only exact marker confirmation permits continuation, never source authority or launch", async (t) => {
	const root = workspace(t);
	const status = commandStatus(root);
	const h = commandHarness(root, status, true);
	await h.run("continue");
	assert.deepEqual(h.calls, ["status", "continue"]);
	assert.equal(h.confirmations.length, 1);
	assert.ok(h.confirmations[0]!.includes(join(root, "openspec/changes/alpha/.gentle-ai-instance")));
	assert.match(h.confirmations[0]!, /no source.*no persistent/i);
	assert.deepEqual(JSON.parse(h.notices[0]!), status);
});

test("read-only, excluded-marker, cancellation and headless scope suppress every mutation", async (t) => {
	const root = workspace(t);
	for (const [answer, hasUI] of [[false, true], [undefined, true], ["yes", true], [true, false]]) {
		const h = commandHarness(root, commandStatus(root), answer, hasUI as boolean);
		await h.run("continue");
		assert.deepEqual(h.calls, ["status"]);
	}
});

test("malformed recommendation and misleading prose refuse before continuation or phase launch", async (t) => {
	const root = workspace(t);
	for (const nextRecommended of ["sdd-apply", "unknown", null]) {
		const h = commandHarness(root, { ...commandStatus(root), nextRecommended });
		await assert.rejects(() => h.run("continue"), /native SDD|recommendation|enum|expected string/i);
		assert.deepEqual(h.calls, ["status"]);
		assert.deepEqual(h.confirmations, []);
	}
});

test("continuation rejects workspace mismatch and missing UI; marker-only confirmation grants no roots", async (t) => {
	const root = workspace(t);
	const mismatch = commandHarness(root, { ...commandStatus(root), actionContext: { workspaceRoot: "/other" } }, true);
	await assert.rejects(() => mismatch.run("continue"), /workspace/);
	assert.deepEqual(mismatch.calls, ["status"]);
	const missingUI = commandHarness(root, commandStatus(root), true);
	Object.assign(missingUI.ctx, { ui: undefined });
	await missingUI.run("continue");
	assert.deepEqual(missingUI.calls, ["status"]);
	const status = commandStatus(root);
	status.actionContext.allowedEditRoots = [];
	const markerOnly = commandHarness(root, status, true);
	await assert.rejects(() => markerOnly.run("continue"), /allowed edit roots/i);
	assert.deepEqual(markerOnly.calls, ["status"]);
});

test("managed apply guidance refuses local reconstruction and preserves native authority", () => {
	const guidance = readFileSync(new URL("../assets/agents/sdd-apply.md", import.meta.url), "utf8");
	assert.doesNotMatch(guidance, /resolve-via-engram|produce the same fields|Proceed with implementation once those artifacts/);
	assert.match(guidance, /native.*v2/i);
});

test("unsafe planning context and marker symlink refuse before mutation", async (t) => {
	const root = workspace(t);
	for (const patch of [{ artifactStore: "engram" }, { actionContext: { mode: "unknown", workspaceRoot: root } }]) {
		const h = commandHarness(root, { ...commandStatus(root), ...patch }, true);
		await assert.rejects(() => h.run("continue"), /native SDD/i);
		assert.deepEqual(h.calls, ["status"]);
	}
	symlinkSync(join(root, "openspec/changes/beta"), join(root, "openspec/changes/alpha/.gentle-ai-instance"));
	const h = commandHarness(root, commandStatus(root), true);
	await assert.rejects(() => h.run("continue"), /marker/i);
	assert.deepEqual(h.calls, ["status"]);
});


test("typed remediation selection preserves native failed evidence and refuses stale binding", async (t) => {
	const root = workspace(t), revision = `sha256:${"a".repeat(64)}`;
	const selection = { changeName: "alpha", workspaceRoot: root, phase: "remediate", failedEvidenceRevision: revision };
	const fixture: NativeSddStatusV2 = { schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha", artifactStore: "openspec", planningHome: { mode: "repo-local", path: join(root, "openspec") }, changeRoot: join(root, "openspec/changes/alpha"), actionContext: { mode: "repo-local", workspaceRoot: root, allowedEditRoots: [root] }, dependencies: Object.fromEntries(["proposal", "specs", "design", "tasks", "apply", "verify", "archive"].map(key => [key, "ready"])) as NativeSddStatusV2["dependencies"], phaseInstructions: { apply: [], verify: [], remediate: ["Correct failed evidence"], archive: [] }, blockedReasons: [], nextRecommended: "remediate", remediationState: { required: true, complete: false, failedEvidenceRevision: revision } };
	const result = await __testing.resolveSelectedNativeSddChangeStartup(JSON.stringify(selection), root, "sdd-remediate", { sddStatus: async () => fixture });
	assert.equal(result.selection.failedEvidenceRevision, revision);
	await assert.rejects(__testing.resolveSelectedNativeSddChangeStartup(JSON.stringify({ ...selection, failedEvidenceRevision: `sha256:${"b".repeat(64)}` }), root, "sdd-remediate", { sddStatus: async () => fixture }), /remediation/);
	assert.throws(() => decodeNativeSddStatusV2({ ...fixture, remediationState: { failedEvidenceRevision: "bad" } }, { workspaceRoot: root, changeName: "alpha" }), /remediation/);
});
