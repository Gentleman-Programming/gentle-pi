import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AGENT_MODE, type AgentDefinition } from "../lib/agents-config.ts";
import { AgentRunner, type TaskRequest } from "../lib/agents-runner.ts";
import { TaskStore } from "../lib/agents-protocol.ts";
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
