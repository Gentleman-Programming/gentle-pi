import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AGENT_MODE, type AgentDefinition } from "../lib/agents-config.ts";
import { AgentRunner, type TaskRequest } from "../lib/agents-runner.ts";
import { TaskStore } from "../lib/agents-protocol.ts";
import { NATIVE_REVIEW_ERROR_CODE, NativeReviewCliError } from "../lib/native-review-cli.ts";
import { __testing } from "../extensions/gentle-ai.ts";
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
		actionContext: { workspaceRoot: root },
		dependencies: { apply: "all_done", verify: "all_done", archive: "ready" },
		instructions: { apply: ["done"], verify: ["done"], archive: ["archive now"] },
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
		schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha",
		actionContext: { workspaceRoot: root },
		dependencies: { apply: "all_done", verify: "all_done", archive: "blocked" },
		instructions: { apply: ["done"], verify: ["done"], archive: ["blocked"] },
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
		{ sddStatus: async () => ({ ...valid, instructions: { apply: ["done"], verify: ["done"] } }) },
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

	const blocked = await (__testing as unknown as {
		resolveSelectedNativeSddChangeStartup(
			serialized: unknown, cwd: string, agentName: string,
			native: { sddStatus?: () => Promise<unknown> }, localResolver: () => unknown,
		): Promise<{ status: typeof valid }>;
	}).resolveSelectedNativeSddChangeStartup(serialized, root, "sdd-archive", { sddStatus: async () => valid }, () => {
		throw new Error("local resolver must not run");
	});
	assert.deepEqual(blocked.status, valid, "a native archive blocker remains authoritative over a locally-ready result");

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
