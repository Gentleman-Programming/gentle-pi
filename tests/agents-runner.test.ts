import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_MODE, type AgentDefinition } from "../lib/agents-config.ts";
import { TASK_STATUS, TaskStore } from "../lib/agents-protocol.ts";
import { AgentRunner, childArguments, JsonLines, piCommand, abortReasonText, type ChildLike, type RunnerDeps, type RunnerHooks, type TaskRequest } from "../lib/agents-runner.ts";
import { fakeChild, type FakeChild } from "./agents-fake-child.ts";

// Gentle Agents runner: every subagent is a child `pi --mode rpc` process.
// The host only parses JSON lines, applies deltas to the store, answers
// dialogs, and enforces its inactivity watchdog. These tests drive a fake child.

const explorer: AgentDefinition = { name: "explore", description: "maps", filePath: "/a/explore.md", scope: "global", instructions: "You map things.", model: undefined, thinking: undefined, mode: undefined, tools: ["read", "grep"] };

function request(overrides: Partial<TaskRequest> = {}): TaskRequest {
	return { agent: explorer, prompt: "Map the repo", label: undefined, context: undefined, mode: AGENT_MODE.TASK, cwd: "/repo", parentSessionId: "s1", model: { provider: "openai-codex", id: "gpt-5.6-terra" }, thinking: "high", sessionDir: "/sessions", resumeSessionPath: undefined, env: {}, ...overrides };
}

interface Harness {
	store: TaskStore;
	runner: AgentRunner;
	children: FakeChild[];
	timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>;
	asks: Array<{ taskId: string; method: string }>;
	finishes: string[];
	spawnOptions: Array<{ env: NodeJS.ProcessEnv; stdio?: string[] }>;
}

function harness(options: { maxConcurrency?: number; answer?: Record<string, unknown>; exitOnKill?: boolean; state?: Record<string, unknown>; stateSuccess?: boolean; onNotification?: RunnerHooks["onNotification"]; onSuccessfulMutation?: RunnerHooks["onSuccessfulMutation"]; onFinish?: RunnerHooks["onFinish"] } = {}): Harness {
	const children: FakeChild[] = [];
	const timers: Harness["timers"] = [];
	const asks: Harness["asks"] = [];
	const finishes: string[] = [];
	const spawnOptions: Harness["spawnOptions"] = [];
	let clock = 1000;
	const deps: RunnerDeps = {
		spawn: (_command, _args, launchOptions) => {
			spawnOptions.push({ env: launchOptions.env, stdio: launchOptions.stdio });
			const fake = fakeChild({ exitOnKill: options.exitOnKill });
			if (options.state !== undefined) {
				fake.child.stdin.removeAllListeners("data");
				fake.child.stdin.on("data", (chunk) => {
					const command = JSON.parse(String(chunk));
					fake.written.push(command);
					fake.emit({ type: "response", id: command.id, success: command.type !== "get_state" || options.stateSuccess !== false,
						data: command.type === "get_state" ? options.state : undefined });
				});
			}
			children.push(fake);
			return fake.child;
		},
		now: () => (clock += 1),
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		pi: { command: "pi", args: [] },
	};
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: options.maxConcurrency ?? 2, stallTimeoutMs: 10_000 }, deps, {
		askUser: async (taskId, ask) => {
			asks.push({ taskId, method: ask.method });
			return options.answer ?? { value: "yes" };
		},
		onFinish: (task, observations) => { finishes.push(task.id); options.onFinish?.(task, observations); },
		onNotification: options.onNotification,
		onSuccessfulMutation: options.onSuccessfulMutation,
	});
	return { store, runner, children, timers, asks, finishes, spawnOptions };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("synchronous cancellation before dequeue never invokes the policy callback", async () => {
	const h = harness(); let checks = 0;
	const task = h.runner.run(request({ prepareResponseObservations: async () => { checks++; return true; } }));
	h.runner.cancel(task.id);
	await tick();
	assert.equal(checks, 0);
	assert.equal(h.children.length, 0);
});

test("hanging preparation never blocks spawn or queued core work; late grants are dropped", async () => {
	const h = harness({ maxConcurrency: 1 });
	let grant!: (value: boolean) => void;
	let checks = 0;
	const first = h.runner.run(request({ prepareResponseObservations: () => { checks++; return new Promise(resolve => { grant = resolve; }); } }));
	const second = h.runner.run(request());
	await tick();
	assert.equal(checks, 1);
	assert.equal(h.children.length, 1);
	assert.equal(h.store.get(second.id)?.status, TASK_STATUS.QUEUED);
	assert.equal(h.runner.cancel(first.id), true);
	await tick();
	assert.equal(h.children.length, 2);
	grant(true);
	await tick();
	assert.equal(h.children.length, 2);
	assert.equal((await h.runner.waitFor(first.id)).status, TASK_STATUS.CANCELLED);
	h.runner.cancel(second.id);
});

for (const outcome of ["ready", "late", "reject", "throw"] as const) {
	test(`parallel preparation ${outcome} cannot delay execution or revive dropped observations`, async () => {
		const snapshots: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1][] = [];
		const h = harness({ onFinish: (_task, snapshot) => snapshots.push(snapshot) });
		let grant!: (value: boolean) => void;
		const task = h.runner.run(request({ prepareResponseObservations: () => {
			if (outcome === "throw") throw new Error("preparation failed");
			if (outcome === "reject") return Promise.reject(new Error("preparation failed"));
			return new Promise(resolve => { grant = resolve; });
		} }));
		await tick();
		assert.equal(h.children.length, 1);
		if (outcome === "ready") { grant(true); await tick(); }
		const message = { type: "message_end", message: { role: "assistant", provider: "openai", model: "gpt-4o", stopReason: "stop", content: [{ type: "text", text: "done" }] } };
		h.children[0].emit(message);
		if (outcome === "late") { grant(true); await tick(); }
		h.children[0].emit(message);
		h.children[0].emit({ type: "agent_end" });
		h.children[0].emit({ type: "agent_settled" });
		await h.runner.waitFor(task.id);
		assert.equal(snapshots.length, 1);
		assert.equal(snapshots[0]?.responses.length, outcome === "ready" ? 2 : undefined);
	});
}

for (const checkpoint of ["launch", "stream", "finish", "throw"] as const) {
	test(`child observation guard discards permanently at ${checkpoint} without changing task execution`, async () => {
		let allowed = checkpoint !== "launch";
		let calls = 0;
		const snapshots: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1][] = [];
		const h = harness({ onFinish: (_task, snapshot) => snapshots.push(snapshot) });
		const task = h.runner.run(request({ collectResponseObservations: true,
			canCollectResponseObservations: () => {
				calls++;
				if (checkpoint === "throw") throw new Error("private policy failure");
				return allowed;
			} }));
		await tick();
		const child = h.children[0];
		const response = { type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { input: 3 } } };
		child.emit(response);
		if (checkpoint === "stream") {
			allowed = false;
			child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "progress" } });
			allowed = true;
			child.emit(response);
		}
		if (checkpoint === "finish") allowed = false;
		h.runner.cancel(task.id);
		await tick();
		assert.equal((await h.runner.waitFor(task.id)).status, TASK_STATUS.CANCELLED);
		assert.deepEqual(snapshots, [undefined]);
		assert.ok(calls > 0);
	});
}

test("child observation guard is never consulted when collection is default-off", async () => {
	let calls = 0;
	const h = harness();
	const task = h.runner.run(request({ canCollectResponseObservations: () => { calls++; return true; } }));
	await tick();
	h.children[0].emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
	h.runner.cancel(task.id);
	await tick();
	assert.equal(calls, 0);
});

for (const ending of ["cancel", "failure", "hook-error", "hook-async-error"] as const) {
	test(`successful child mutations require paired RPC events and survive ${ending}`, async () => {
		const mutations: unknown[] = [];
		const h = harness({ onSuccessfulMutation: (task, tool) => {
			mutations.push({ taskId: task.id, parent: task.parentSessionId, ...tool });
			if (ending === "hook-error") throw new Error("receipt append unavailable");
			if (ending === "hook-async-error") return Promise.reject(new Error("async receipt append unavailable"));
		} });
		const task = h.runner.run(request());
		await tick();
		const child = h.children[0];
		const start = (id: string, toolName: string) => child.emit({ type: "tool_execution_start", toolCallId: id, toolName, args: { path: "src/file.ts" } });
		const end = (id: string, isError: unknown = false) => child.emit({ type: "tool_execution_end", toolCallId: id, isError, result: { content: [] } });
		assert.deepEqual(mutations, [], "spawn is not mutation evidence");
		end("missing");
		for (const name of ["read", "bash", "subagent_run"]) { start(name, name); end(name); }
		start("failed", "write"); end("failed", true);
		start("unknown", "edit"); end("unknown", null);
		child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "I edited files" } });
		assert.deepEqual(mutations, []);
		for (const name of ["write", "edit"]) { start(name, name); end(name); end(name); }
		assert.deepEqual(mutations, ["write", "edit"].map((toolName) => ({ taskId: task.id, parent: "s1", toolName, toolCallId: toolName, path: "src/file.ts" })));
		start("unfinished", "write");
		if (ending === "failure") child.fail("later failure");
		else h.runner.cancel(task.id);
		await tick();
		end("unfinished"); start("late", "write"); end("late");
		assert.equal(mutations.length, 2, "terminal cleanup rejects late events without retracting successful writes");
	});
}

test("launch registration waits for actual spawn, including queued launches, and ignores failed spawns", async () => {
	const launches: string[] = [];
	const spawns: Array<() => void> = [];
	const children: FakeChild[] = [];
	const cwds: string[] = [];
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 1000 }, {
		spawn: (_command, _args, options) => {
			cwds.push(options.cwd);
			if (options.cwd === "/throws") throw new Error("missing executable");
			const fake = fakeChild();
			const on = fake.child.on.bind(fake.child);
			fake.child.on = ((event: string, listener: () => void) => {
				if (event === "spawn") spawns.push(listener);
				else on(event as "exit", listener);
				return fake.child;
			}) as typeof fake.child.on;
			children.push(fake);
			return fake.child;
		},
		now: () => 1000, schedule: () => () => {}, pi: { command: "pi", args: [] },
	}, { askUser: async () => ({ cancelled: true }) });
	const first = runner.run(request({ cwd: "/child", onLaunch: () => launches.push("s1:/child") }));
	const second = runner.run(request({ cwd: "/queued", onLaunch: () => launches.push("s1:/queued") }));
	assert.deepEqual(launches, []);
	await tick();
	assert.deepEqual(launches, [], "returning a child handle is not successful spawn");
	assert.equal(typeof spawns[0], "function");
	spawns[0]();
	assert.deepEqual(launches, ["s1:/child"]);
	runner.cancel(first.id);
	await tick();
	assert.equal(store.get(second.id)?.cwd, "/queued");
	spawns[1]();
	assert.deepEqual(launches, ["s1:/child", "s1:/queued"]);
	runner.cancel(second.id);
	await tick();
	const failed = runner.run(request({ cwd: "/missing", onLaunch: () => launches.push("bad") }));
	await tick();
	children[2].fail("ENOENT");
	await tick();
	assert.equal(store.get(failed.id)?.status, TASK_STATUS.FAILED);
	const thrown = runner.run(request({ cwd: "/throws", onLaunch: () => launches.push("bad") }));
	await tick();
	assert.equal(store.get(thrown.id)?.status, TASK_STATUS.FAILED);
	assert.deepEqual(launches, ["s1:/child", "s1:/queued"]);
	assert.deepEqual(cwds, ["/child", "/queued", "/missing", "/throws"]);
});

test("runner captures resolved model and effort, retaining omitted launch values", async () => {
	for (const scenario of [
		{ state: { model: { provider: "anthropic", id: "resolved-model" }, thinkingLevel: "off" }, model: "anthropic/resolved-model", thinking: "off" },
		{ state: { thinkingLevel: "max" }, model: "openai-codex/gpt-5.6-terra", thinking: "max" },
		{ state: {}, model: "openai-codex/gpt-5.6-terra", thinking: "high" },
		{ state: { model: null }, model: "default", thinking: "high" },
		{ state: { model: { id: 7 }, thinkingLevel: 7 }, model: "openai-codex/gpt-5.6-terra", thinking: "high" },
	]) {
		const h = harness({ state: scenario.state });
		const task = h.runner.run(request());
		await tick();
		assert.equal(h.store.get(task.id)?.model, scenario.model);
		assert.equal(h.store.get(task.id)?.thinking, scenario.thinking);
		h.runner.cancel(task.id);
	}
	const h = harness({ state: { model: { provider: "wrong", id: "wrong" }, thinkingLevel: "low" }, stateSuccess: false });
	const task = h.runner.run(request({ model: undefined, thinking: undefined }));
	await tick();
	assert.equal(h.store.get(task.id)?.model, "default");
	assert.equal(h.store.get(task.id)?.thinking, undefined);
	h.runner.cancel(task.id);
});

test("runner delivers each response combination once at finish, never attributing launch selection", async () => {
	const snapshots: NonNullable<Parameters<NonNullable<RunnerHooks["onFinish"]>>[1]>[] = [];
	const h = harness({ exitOnKill: false, state: { model: { provider: "anthropic", id: "launch" }, thinkingLevel: "max" },
		onFinish: (_task, snapshot) => { assert.ok(snapshot); snapshots.push(snapshot); } });
	const task = h.runner.run(request({ collectResponseObservations: true }));
	await tick();
	const child = h.children[0];
	const responses = [
		{ provider: "openai", model: "gpt-4o", providerThinkingLevel: "low", stopReason: "error" },
		{ provider: "anthropic", model: "claude-sonnet-4", providerThinkingLevel: "high", stopReason: "toolUse" },
		{ provider: "openai", model: "gpt-4o", providerThinkingLevel: "high", stopReason: "stop" },
	];
	for (const response of responses) {
		const message = { role: "assistant", ...response, usage: { input: 10, totalTokens: 10, cost: { total: 0.1 } }, content: [{ type: "text", text: "private report" }] };
		child.emit({ type: "message_start", message });
		child.emit({ type: "message_end", message });
		child.emit({ type: "turn_end", message });
		child.emit({ type: "agent_end", messages: [message] });
	}
	assert.deepEqual(snapshots, [], "agent_end is not settlement");
	child.emit({ type: "agent_settled" });
	assert.deepEqual(snapshots, [], "settlement still waits for process cleanup");
	child.exit(0);
	await tick();
	assert.equal(snapshots.length, 1);
	const snapshot = snapshots[0];
	assert.equal(snapshot.agentSettled, true);
	assert.equal(snapshot.droppedResponses, 0);
	assert.equal(snapshot.coverage, "final_assistant_messages_only");
	assert.deepEqual(snapshot.responses.map((response) => [response.provider, response.model, response.providerThinkingLevel]),
		responses.map((response) => [response.provider, response.model, response.providerThinkingLevel].map((value) => ({ state: "observed", value }))));
	assert.ok(snapshot.responses.every((response) => Object.values(response.selected).every((field) => field.state === "unavailable")));
	assert.equal(h.store.get(task.id)?.tokens, 30);
	assert.equal(h.store.get(task.id)?.cost, 0.1 + 0.1 + 0.1);
	assert.equal(h.store.get(task.id)?.model, "anthropic/launch");
	assert.deepEqual(child.written.map((command) => command.type), ["get_state", "prompt"]);
	assert.doesNotMatch(JSON.stringify(snapshot), /private|launch|s1|modelVersion/);
	assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.responses) && Object.isFrozen(snapshot.responses[0].tokens.input));
	child.emit({ type: "agent_settled" }); child.exit(0);
	assert.equal(snapshots.length, 1);
});

for (const ending of ["cancel", "exit", "error", "timeout", "settled-error"] as const) test(`bounded response coverage survives ${ending} honestly`, async () => {
	let snapshot: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1];
	const h = harness({ onFinish: (_task, observations) => { snapshot = observations; } });
	const task = h.runner.run(request({ collectResponseObservations: true }));
	await tick();
	const child = h.children[0];
	for (let index = 0; index < 130; index++) child.emit({ type: "message_end", message: {
		role: "assistant", model: `model-${index}`, stopReason: "error", usage: { totalTokens: 1 } } });
	if (ending === "cancel") h.runner.cancel(task.id);
	else if (ending === "exit") child.exit(1);
	else if (ending === "error") child.fail("private process error");
	else if (ending === "timeout") h.timers.filter((timer) => !timer.cancelled && timer.ms === 10_000).at(-1)!.fn();
	else { child.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] }); child.emit({ type: "agent_settled" }); }
	await h.runner.waitFor(task.id);
	assert.ok(snapshot);
	assert.equal(snapshot.responses.length, 128);
	assert.equal(snapshot.droppedResponses, 2);
	assert.equal(snapshot.agentSettled, ending === "settled-error");
	assert.equal(h.store.get(task.id)?.tokens, 130, "buffer cap never caps existing UI totals");
	assert.notEqual(h.store.get(task.id)?.status, TASK_STATUS.COMPLETED);
	child.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
	assert.equal(snapshot.responses.length, 128);
	assert.equal(h.finishes.length, 1);
});

test("response buffering is disabled by default and absent for tasks cancelled before launch", async () => {
	const snapshots: unknown[] = [];
	const h = harness({ maxConcurrency: 1, onFinish: (_task, snapshot) => snapshots.push(snapshot) });
	const task = h.runner.run(request());
	const queued = h.runner.run(request({ collectResponseObservations: true }));
	await tick();
	h.children[0].emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { totalTokens: 7 } } });
	h.runner.cancel(queued.id); h.runner.cancel(task.id);
	await tick();
	assert.deepEqual(snapshots, [undefined, undefined]);
	assert.equal(h.store.get(task.id)?.tokens, 7);
});

test("childArguments builds an rpc launch with model, thinking, tools, session dir, and instructions", () => {
	const args = childArguments(request());
	assert.deepEqual(args.slice(0, 2), ["--mode", "rpc"]);
	assert.ok(args.includes("--session-dir") && args[args.indexOf("--session-dir") + 1] === "/sessions");
	assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-5.6-terra:high");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,subagent_parent_message");
	assert.equal(args[args.indexOf("--append-system-prompt") + 1], "You map things.");
	assert.ok(!args.includes("--session"));
	const resumed = childArguments(request({ resumeSessionPath: "/sessions/old.jsonl", model: undefined, thinking: undefined, agent: { ...explorer, tools: [] } }));
	assert.equal(resumed[resumed.indexOf("--session") + 1], "/sessions/old.jsonl");
	assert.ok(!resumed.includes("--model") && !resumed.includes("--tools"));
});

test("childArguments grants every child the notification-only parent message tool", () => {
	const args = childArguments(request());
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,subagent_parent_message");
});

test("AgentRunner admits strict live notifications once and closes IPC before Stop", async () => {
	const notifications: string[] = [];
	const { runner, children, spawnOptions } = harness({ onNotification: (task, message) => task.parentSessionId === "s1" && (notifications.push(message), true) });
	const task = runner.run(request());
	await tick();
	children[0].message({ id: "n1", kind: "notification", message: "checkpoint" });
	children[0].message({ id: "n1", kind: "notification", message: "checkpoint" });
	children[0].message({ id: "n2", kind: "notification", message: "x".repeat(8 * 1024 + 1) });
	children[0].message({ id: "q3", kind: "query", message: "unsupported" });
	children[0].message({ id: "n4", kind: "notification", message: "\uD800" });
	children[0].message({ id: "n5", kind: "notification", message: "forged field", sender: "forged" });
	children[0].message({ id: "n0", kind: "notification", message: "invalid correlation" });
	children[0].message({ id: `n${"1".repeat(1_000)}`, kind: "notification", message: "invalid correlation" });
	await tick();
	assert.deepEqual(spawnOptions[0]?.stdio, ["pipe", "pipe", "pipe", "ipc"]);
	assert.deepEqual(notifications, ["checkpoint"]);
	assert.deepEqual(children[0].sent, [
		{ id: "n1", kind: "ack", accepted: true },
		{ id: "n2", kind: "ack", accepted: false, error: "invalid child IPC message" },
		{ id: "q3", kind: "reply", error: "task parent cannot accept queries" },
		{ id: "n4", kind: "ack", accepted: false, error: "invalid child IPC message" },
		{ id: "n5", kind: "ack", accepted: false, error: "invalid child IPC frame" },
	]);
	runner.cancel(task.id);
	children[0].message({ id: "after-stop", kind: "notification", message: "ignored" });
	await tick();
	assert.equal(children[0].sent.length, 5);
	assert.ok(children[0].disconnects > 0);
});

test("AgentRunner rejects notifications from an inactive parent session with a static acknowledgement", async () => {
	const { runner, children } = harness({ onNotification: () => false });
	runner.run(request());
	await tick();
	children[0].message({ id: "n1", kind: "notification", message: "not active" });
	await tick();
	assert.deepEqual(children[0].sent, [{ id: "n1", kind: "ack", accepted: false, error: "task parent is not the active host session" }]);
});

test("AgentRunner retains only a 64-notification duplicate window", async () => {
	const notifications: string[] = [];
	const { runner, children } = harness({ onNotification: (_task, message) => { notifications.push(message); } });
	runner.run(request());
	await tick();
	for (let index = 1; index <= 65; index += 1) children[0].message({ id: `n${index}`, kind: "notification", message: `message ${index}` });
	children[0].message({ id: "n1", kind: "notification", message: "message 1 again" });
	await tick();
	assert.equal(notifications.length, 66, "an ID evicted from the recent 64-ack window can be admitted again");
});

test("piCommand reuses the running pi entry point and honors the override", () => {
	assert.deepEqual(piCommand({ execPath: "/bin/node", argv: ["/bin/node", "/x/dist/cli.js"], env: {} }), { command: "/bin/node", args: ["/x/dist/cli.js"] });
	assert.deepEqual(piCommand({ execPath: "/bin/node", argv: ["/bin/node", "/x/other.js"], env: {} }), { command: "pi", args: [] });
	assert.deepEqual(piCommand({ execPath: "/bin/node", argv: [], env: { GENTLE_PI_AGENTS_PI: "/opt/pi --flag" } }), { command: "/opt/pi", args: ["--flag"] });
});

test("JsonLines splits on LF only, tolerates CRLF, and skips lines that are not JSON", () => {
	const seen: unknown[] = [];
	const lines = new JsonLines((value) => seen.push(value));
	lines.push('{"a":1}\r\n{"b":"x y"}\nnot json\n{"c":');
	lines.push("3}\n");
	assert.deepEqual(seen, [{ a: 1 }, { b: "x y" }, { c: 3 }]);
});

test("AgentRunner runs a task end to end: prompt, deltas into the store, completion with the last answer", async () => {
	const { store, runner, children } = harness();
	const task = runner.run(request());
	assert.equal(task.status, TASK_STATUS.QUEUED);
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING);
	const [child] = children;
	await tick();
	assert.deepEqual(children[0].written.map((command) => command.type), ["get_state", "prompt"]);
	assert.equal(children[0].written[1].message, "Map the repo");
	child.emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "grep", args: {} });
	child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Found it" } });
	child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Found it" }] }] });
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, "agent_end retains the latest answer while queued follow-up may still run");
	assert.equal(children[0].killed.length, 0, "the child remains available until Pi reports settlement");
	child.emit({ type: "agent_settled" });
	await tick();
	const finished = store.get(task.id);
	assert.equal(finished?.status, TASK_STATUS.COMPLETED);
	assert.equal(finished?.result, "Found it");
	assert.equal(finished?.toolCalls, 1);
	assert.equal(finished?.sessionPath, "/sessions/child.jsonl");
	assert.equal(finished?.label, "Map the repo");
	assert.ok(children[0].killed.length > 0, "the child is stopped once the answer is in");
	assert.equal(store.thread(task.id).items.length, 2);
	assert.equal((await runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED);
});

test("AgentRunner waits for child exit after settlement before releasing its queue slot or finishing twice", async () => {
	const { store, runner, children, finishes } = harness({ maxConcurrency: 1, exitOnKill: false });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "Second" }));
	await tick();
	assert.equal(children.length, 1);
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Answer" }] }] });
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.RUNNING, "agent_end ends one run, not the session");
	assert.equal(store.get(first.id)?.result, "Answer", "agent_end retains the final run output");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED, "the slot stays occupied until settlement");
	assert.deepEqual(finishes, []);
	children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.RUNNING, "terminal RPC state does not release a live process");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED);
	children[0].exit(0);
	await tick();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.COMPLETED);
	assert.deepEqual(finishes, [first.id], "settlement delivers completion once");
	assert.equal(children.length, 2, "child exit releases the queue slot");
	children[0].emit({ type: "agent_settled" });
	await tick();
	assert.deepEqual(finishes, [first.id], "duplicate terminal events do not finalize twice");
});

test("AgentRunner queues beyond max concurrency and starts the next task when one finishes", async () => {
	const { store, runner, children } = harness({ maxConcurrency: 1 });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "Second" }));
	await tick();
	assert.equal(children.length, 1);
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED);
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "First complete." }], stopReason: "stop" }] });
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.RUNNING, "the concurrency slot remains held through a queued follow-up");
	children[0].emit({ type: "agent_settled" });
	await tick();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.COMPLETED);
	assert.equal(children.length, 2);
	assert.equal(store.get(second.id)?.status, TASK_STATUS.RUNNING);
});

test("AgentRunner classifies terminal assistant outcomes only after settlement", async () => {
	const scenarios = [
		{ name: "error", messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "WebSocket error: secret=never-copy" }], status: TASK_STATUS.FAILED, error: /assistant reported an error/ },
		{ name: "aborted", messages: [{ role: "assistant", content: [], stopReason: "aborted" }], status: TASK_STATUS.FAILED, error: /assistant aborted/ },
		{ name: "empty", messages: [{ role: "assistant", content: [], stopReason: "stop" }], status: TASK_STATUS.FAILED, error: /no final report/ },
		{ name: "success", messages: [{ role: "assistant", content: [{ type: "text", text: "final report" }], stopReason: "stop" }], status: TASK_STATUS.COMPLETED, error: null },
	] as const;
	for (const scenario of scenarios) {
		const { store, runner, children } = harness();
		const task = runner.run(request());
		await tick();
		children[0].emit({ type: "agent_end", messages: scenario.messages });
		assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, `${scenario.name} stays running until settlement`);
		children[0].emit({ type: "agent_settled" });
		const finished = await runner.waitFor(task.id);
		assert.equal(finished.status, scenario.status, scenario.name);
		if (scenario.error) assert.match(finished.error ?? "", scenario.error);
		else assert.equal(finished.result, "final report");
	}
});

test("AgentRunner clears an earlier answer after a later error, but permits a successful retry before settlement", async () => {
	const first = harness();
	const failedTask = first.runner.run(request());
	await tick();
	first.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "stale success" }], stopReason: "stop" }] });
	first.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "provider detail must not persist" }] });
	first.children[0].emit({ type: "agent_settled" });
	const failed = await first.runner.waitFor(failedTask.id);
	assert.equal(failed.status, TASK_STATUS.FAILED);
	assert.equal(failed.result, null, "a later error must not report stale successful text");

	const retry = harness();
	const retryTask = retry.runner.run(request());
	await tick();
	retry.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [], stopReason: "error" }] });
	retry.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "retry report" }], stopReason: "stop" }] });
	retry.children[0].emit({ type: "agent_settled" });
	const recovered = await retry.runner.waitFor(retryTask.id);
	assert.equal(recovered.status, TASK_STATUS.COMPLETED);
	assert.equal(recovered.result, "retry report");
});

test("AgentRunner fails if the child exits after agent_end but before agent_settled", async () => {
	const { store, runner, children } = harness();
	const task = runner.run(request());
	await tick();
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "partial answer" }] }] });
	await tick();
	children[0].exit(0);
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(task.id)?.error ?? "", /before agent_settled/);
	assert.equal(store.get(task.id)?.result, "partial answer", "the final observed answer remains available for diagnostics");
});

for (const [platform, detached] of [["win32", false], ["linux", true]] as const) test(`AgentRunner selects detached=${detached} for ${platform} without changing the launch contract`, async () => {
	const store = new TaskStore();
	const launches: Array<{ command: string; args: string[]; options: Parameters<RunnerDeps["spawn"]>[2] }> = [];
	const child = fakeChild();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 1_000 }, {
		spawn: (command, args, options) => {
			launches.push({ command, args, options });
			return child.child;
		},
		now: () => 1,
		schedule: () => () => {},
		pi: { command: "pi-fixture", args: ["--from-host"] },
		process: { platform, kill: () => {} },
	}, { askUser: async () => ({ cancelled: true }) });
	const task = runner.run(request({ env: { PATH: "/fixture", KEEP: "yes" } }));
	await tick();
	const ownedIpc = launches[0]?.options.env.GENTLE_PI_AGENTS_OWNED_IPC;
	assert.match(ownedIpc ?? "", /^\d+-[a-z0-9]+$/, "the runner creates an opaque owned-IPC marker");
	assert.deepEqual(launches, [{
		command: "pi-fixture",
		args: ["--from-host", "--mode", "rpc", "--session-dir", "/sessions", "--model", "openai-codex/gpt-5.6-terra:high", "--tools", "read,grep,subagent_parent_message", "--append-system-prompt", "You map things."],
		options: { cwd: "/repo", env: { PATH: "/fixture", KEEP: "yes", GENTLE_PI_AGENTS_CHILD: "1", GENTLE_PI_AGENTS_OWNED_IPC: ownedIpc }, detached, stdio: ["pipe", "pipe", "pipe", "ipc"] },
	}]);
	child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "platform checked" }], stopReason: "stop" }] });
	child.emit({ type: "agent_settled" });
	assert.equal((await runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED);
});

function ipcCleanupHarness(connected: boolean | undefined) {
	const child = fakeChild({ exitOnKill: false });
	const disconnectListeners: Array<(...args: unknown[]) => void> = [];
	const originalOn = child.child.on as unknown as (event: string, listener: (...args: unknown[]) => void) => unknown;
	child.child.on = ((event: string, listener: (...args: unknown[]) => void) => {
		if (event === "disconnect") disconnectListeners.push(listener);
		return originalOn(event, listener);
	}) as ChildLike["on"];
	child.child.connected = connected;
	let resolveAnswer!: (answer: { cancelled: true }) => void;
	const answer = new Promise<{ cancelled: true }>((resolve) => { resolveAnswer = resolve; });
	const runner = new AgentRunner(new TaskStore(), { maxConcurrency: 1, stallTimeoutMs: 1_000 }, {
		spawn: () => child.child,
		now: () => 1,
		schedule: () => () => {},
		pi: { command: "pi", args: [] },
	}, { askUser: async () => answer });
	return {
		child,
		runner,
		resolveAnswer,
		emitNativeDisconnect: () => {
			assert.equal(disconnectListeners.length, 1, "the runner listens for the native disconnect event");
			disconnectListeners[0]();
		},
	};
}

test("AgentRunner primary IPC cleanup respects native connection state", async () => {
	for (const scenario of [
		{ name: "connected=false finalize", connected: false, ending: "finalize", expectedDisconnects: 0, reentrant: false },
		{ name: "connected=false cancel", connected: false, ending: "cancel", expectedDisconnects: 0, reentrant: false },
		{ name: "connected=true reentrant cleanup", connected: true, ending: "cancel", expectedDisconnects: 1, reentrant: true },
		{ name: "partial fake without connected", connected: undefined, ending: "cancel", expectedDisconnects: 1, reentrant: false },
	] as const) {
		const h = ipcCleanupHarness(scenario.connected);
		const task = h.runner.run(request());
		await tick();
		h.child.emit({ type: "extension_ui_request", id: "pending", method: "confirm", title: "Pending?" });
		await tick();
		h.emitNativeDisconnect();
		if (scenario.reentrant) h.emitNativeDisconnect();
		assert.equal(h.child.disconnects, scenario.expectedDisconnects, `${scenario.name}: native disconnect does not duplicate the physical close`);
		h.resolveAnswer({ cancelled: true });
		await tick();
		assert.equal(h.child.written.filter((command) => command.type === "extension_ui_response").length, 1, `${scenario.name}: IPC closure does not suppress the independent live RPC UI response`);
		if (scenario.ending === "finalize") {
			h.child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }] });
			h.child.emit({ type: "agent_settled" });
			h.child.exit(0);
			assert.equal((await h.runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED, `${scenario.name}: later finalization remains intact`);
		} else {
			h.runner.cancel(task.id);
			h.child.exit(0);
			assert.equal((await h.runner.waitFor(task.id)).status, TASK_STATUS.CANCELLED, `${scenario.name}: later cancellation remains intact`);
		}
		assert.equal(h.child.disconnects, scenario.expectedDisconnects, `${scenario.name}: later cleanup remains idempotent`);
	}
});

test("AgentRunner retains permission broker fd3 and assigns messaging IPC to fd4", async () => {
	const { runner, children, spawnOptions } = harness();
	const task = runner.run(request({ authorizeParentStandingReviewPermission: () => true }));
	await tick();
	const launch = spawnOptions[0];
	const permissionChannelStdio = process.platform === "win32" ? "overlapped" : "pipe";
	assert.match(launch?.env.GENTLE_PI_AGENTS_OWNED_IPC ?? "", /^\d+-[a-z0-9]+$/, "the owned-IPC marker has the runner's opaque shape");
	assert.deepEqual(launch?.env, { GENTLE_PI_AGENTS_CHILD: "1", GENTLE_PI_AGENTS_OWNED_IPC: launch?.env.GENTLE_PI_AGENTS_OWNED_IPC, GENTLE_PI_AGENTS_PARENT_PERMISSION_FD: "3" });
	assert.deepEqual(launch?.stdio, ["pipe", "pipe", "pipe", permissionChannelStdio, "ipc"]);
	assert.equal(launch?.stdio?.length, 5);
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "channel checked" }], stopReason: "stop" }] });
	children[0].emit({ type: "agent_settled" });
	assert.equal((await runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED);
});

test("AgentRunner platform matrix scopes permission fd3 transport", async () => {
	for (const platform of ["win32", "linux", "darwin"] as const) {
		for (const eligible of [false, true]) {
			const launches: Array<Parameters<RunnerDeps["spawn"]>[2]> = [];
			const child = fakeChild();
			const runner = new AgentRunner(new TaskStore(), { maxConcurrency: 1, stallTimeoutMs: 1_000 }, {
				spawn: (_command, _args, options) => {
					launches.push(options);
					return child.child;
				},
				now: () => 1,
				schedule: () => () => {},
				pi: { command: "pi-fixture", args: [] },
				process: { platform, kill: () => {} },
			}, { askUser: async () => ({ cancelled: true }) });
			const task = runner.run(request({ authorizeParentStandingReviewPermission: eligible ? () => true : undefined }));
			await tick();
			const launch = launches[0];
			assert.ok(launch, `${platform} ${eligible ? "eligible" : "ineligible"} child launches`);
			assert.equal(launch.env.GENTLE_PI_AGENTS_PARENT_PERMISSION_FD, eligible ? "3" : undefined, "only eligible children receive the fd3 marker");
			assert.deepEqual(launch.stdio, eligible ? ["pipe", "pipe", "pipe", platform === "win32" ? "overlapped" : "pipe", "ipc"] : ["pipe", "pipe", "pipe", "ipc"]);
			assert.equal(launch.stdio?.indexOf("ipc"), eligible ? 4 : 3, "messaging IPC follows fd3 only for eligible children");
			runner.cancel(task.id);
		}
	}
});

test("AgentRunner answers dialogs through askUser in task mode and cancels them in background mode", async () => {
	const { store, runner, children, asks } = harness({ answer: { confirmed: true } });
	const task = runner.run(request());
	const background = runner.run(request({ mode: AGENT_MODE.BACKGROUND }));
	await tick();
	children[0].emit({ type: "extension_ui_request", id: "u1", method: "confirm", title: "Delete?" });
	children[1].emit({ type: "extension_ui_request", id: "u2", method: "select", title: "Pick", options: ["a"] });
	children[1].emit({ type: "extension_ui_request", id: "u3", method: "notify", message: "hi" });
	await tick();
	await tick();
	assert.deepEqual(asks, [{ taskId: task.id, method: "confirm" }]);
	assert.deepEqual(children[0].written.at(-1), { type: "extension_ui_response", id: "u1", confirmed: true });
	assert.deepEqual(children[1].written.at(-1), { type: "extension_ui_response", id: "u2", cancelled: true });
	assert.equal(store.get(background.id)?.status, TASK_STATUS.RUNNING);
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, "answered questions do not leave the task waiting");
});

test("AgentRunner cancels and fails when the child exits early", async () => {
	const { store, runner, children } = harness({ maxConcurrency: 3 });
	const cancelled = runner.run(request());
	const crashed = runner.run(request());
	await tick();
	runner.cancel(cancelled.id);
	await tick();
	assert.equal(store.get(cancelled.id)?.status, TASK_STATUS.CANCELLED);
	assert.ok(children[0].written.some((command) => command.type === "abort"));
	children[1].exit(1);
	await tick();
	assert.equal(store.get(crashed.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(crashed.id)?.error ?? "", /exited with code 1/);
	assert.ok(runner.steer(cancelled.id, "x") === false, "a finished task cannot be steered");
});

test("AgentRunner has no total-duration watchdog but keeps active work alive and times out true silence", async () => {
	const { store, runner, children, timers } = harness();
	const task = runner.run(request({ mode: AGENT_MODE.BACKGROUND }));
	await tick();
	assert.deepEqual(timers.filter((timer) => !timer.cancelled).map((timer) => timer.ms), [10_000], "only the inactivity watchdog is scheduled");
	const initialStall = timers[0];
	children[0].emit({ type: "response", id: "r1", success: true });
	await tick();
	assert.equal(initialStall.cancelled, true, "every child RPC event, including a response, re-arms the inactivity watchdog");
	children[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "still working" } });
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, "ongoing RPC activity keeps a long-running task active");
	const stall = timers.filter((timer) => timer.ms === 10_000 && !timer.cancelled).at(-1);
	assert.ok(stall);
	stall.fn();
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.TIMED_OUT);
	assert.match(store.get(task.id)?.error ?? "", /stalled/);
});

test("AgentRunner.cancelAll stops every queued and running task", async () => {
	const { store, runner, children } = harness({ maxConcurrency: 1 });
	const running = runner.run(request());
	const queued = runner.run(request());
	await tick();
	assert.equal(runner.cancelAll(), 2);
	await tick();
	assert.equal(store.get(running.id)?.status, TASK_STATUS.CANCELLED);
	assert.equal(store.get(queued.id)?.status, TASK_STATUS.CANCELLED);
	assert.deepEqual(children[0].killed, ["SIGTERM"]);
	assert.equal(children.length, 1, "nothing else starts after cancelAll");
});

test("AgentRunner fails only the task when the child cannot start, and the queue moves on", async () => {
	const { store, runner, children, timers } = harness({ maxConcurrency: 1 });
	const broken = runner.run(request());
	const next = runner.run(request({ prompt: "After" }));
	await tick();
	children[0].fail("spawn pi ENOENT");
	await tick();
	assert.equal(store.get(broken.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(broken.id)?.error ?? "", /could not start pi: spawn pi ENOENT/);
	assert.equal((await runner.waitFor(broken.id)).status, TASK_STATUS.FAILED, "waiters settle");
	await tick();
	assert.equal(children.length, 2, "the next queued task starts");
	assert.equal(store.get(next.id)?.status, TASK_STATUS.RUNNING);
	assert.ok(timers.filter((timer) => timer.ms === 10_000).some((timer) => timer.cancelled), "the failed task's inactivity watchdog is cancelled");
});

test("AgentRunner turns a synchronous spawn exception into a failed task", async () => {
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 1000 }, {
		spawn: () => {
			throw new Error("ENOENT: pi not found");
		},
		now: () => 1,
		schedule: () => () => {},
		pi: { command: "missing-pi", args: [] },
	}, { askUser: async () => ({ cancelled: true }) });
	const task = runner.run(request());
	const finished = await runner.waitFor(task.id);
	assert.equal(finished.status, TASK_STATUS.FAILED);
	assert.match(finished.error ?? "", /could not start pi: ENOENT/);
});

for (const lateEvents of [false, true]) test(`AgentRunner releases quarantined capacity only on proven exit (late events: ${lateEvents})`, async () => {
	const store = new TaskStore();
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	let now = 0;
	let groupGone = false;
	let launches = 0;
	let asks = 0;
	const finishes: string[] = [];
	const observations: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1][] = [];
	let resolveAnswer!: (answer: { value: string }) => void;
	const answer = new Promise<{ value: string }>((resolve) => { resolveAnswer = resolve; });
	const child = fakeChild({ exitOnKill: false, pid: 71 });
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 10_000 }, {
		spawn: () => { launches += 1; return launches === 1 ? child.child : fakeChild().child; },
		now: () => now,
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => { timer.cancelled = true; };
		},
		pi: { command: "pi", args: [] },
		process: { platform: "linux", kill: (_pid, signal) => {
			if (signal === 0) throw Object.assign(new Error("group probe"), { code: groupGone ? "ESRCH" : "EPERM" });
		} },
	}, { askUser: async () => { asks += 1; return answer; }, onFinish: (task, snapshot) => { finishes.push(task.id); observations.push(snapshot); } });
	const first = runner.run(request({ collectResponseObservations: true }));
	const second = runner.run(request({ prompt: "queued" }));
	await tick();
	const waiter = runner.waitFor(first.id);
	child.emit({ type: "message_end", message: { role: "assistant", stopReason: "aborted", usage: { input: 3 } } });
	if (lateEvents) child.emit({ type: "extension_ui_request", id: "early", method: "input", title: "Pending?" });
	runner.cancel(first.id);
	const grace = timers.find((timer) => timer.ms === 250);
	assert.ok(grace);
	grace.fn();
	now = 2_000;
	const check = timers.filter((timer) => timer.ms === 25).at(-1);
	assert.ok(check);
	check.fn();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.FAILED);
	assert.equal((await waiter).status, TASK_STATUS.FAILED);
	assert.match(store.get(first.id)?.error ?? "", /cleanup unconfirmed/);
	assert.equal(observations.length, 1);
	assert.equal(observations[0]?.agentSettled, false);
	assert.equal(observations[0]?.responses.length, 1);
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED, "the unconfirmed group retains its capacity");
	assert.equal(timers.filter((timer) => timer.ms === 25 && !timer.cancelled).length, 0, "confirmation polling stops at its deadline");
	const finished = structuredClone(store.get(first.id));
	if (lateEvents) {
		const thread = structuredClone(store.thread(first.id));
		const timerCount = timers.length;
		const writes = child.written.length;
		resolveAnswer({ value: "too late" });
		await tick();
		child.emit({ type: "extension_ui_request", id: "late", method: "input", title: "Reopen?" });
		child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "late result" }] }] });
		child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "late" } });
		child.emit({ type: "agent_settled" });
		await tick();
		assert.equal(asks, 1, "late dialogs must not reopen");
		assert.equal(child.written.length, writes, "pending answers must not reach a terminal child");
		assert.equal(timers.length, timerCount, "late activity must not rearm the stall watchdog");
		assert.deepEqual(store.get(first.id), finished);
		assert.deepEqual(store.thread(first.id), thread);
		assert.equal(launches, 1, "late events are not process-exit proof");
	}
	groupGone = true;
	child.exit(0);
	await tick();
	assert.equal(launches, 2, "proven late exit must pump queued work");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.RUNNING);
	child.exit(0);
	await tick();
	assert.deepEqual(finishes, [first.id], "cleanup must not finish the quarantined task twice");
	assert.equal(observations.length, 1, "late cleanup does not redeliver observations");
	assert.deepEqual(store.get(first.id), finished);
});

test("a confirmed-gone group completes the exit and frees its slot without an observed exit", async () => {
	// The group probe reports ESRCH (the group is gone) while the child never emits
	// its exit event. Returning without finishing left the task terminal in memory
	// with no record and no retry; finishing without releasing the live entry would
	// keep the concurrency slot occupied and never pump queued work.
	const store = new TaskStore();
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	const finishes: string[] = [];
	let now = 1_000;
	let launches = 0;
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 10_000 }, {
		spawn: () => fakeChild({ exitOnKill: false, pid: 90 + (launches += 1) }).child,
		now: () => now,
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => { timer.cancelled = true; };
		},
		pi: { command: "pi", args: [] },
		process: { platform: "linux", kill: (_pid, signal) => {
			if (signal === 0) throw Object.assign(new Error("group probe"), { code: "ESRCH" });
		} },
	}, { askUser: async () => ({ value: "yes" }), onFinish: (task) => { finishes.push(task.id); } });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "queued" }));
	await tick();
	const waiter = runner.waitFor(first.id);
	runner.cancel(first.id);
	const grace = timers.find((timer) => timer.ms === 250);
	assert.ok(grace, "termination grace is scheduled");
	grace.fn();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.CANCELLED);
	assert.equal((await waiter).status, TASK_STATUS.CANCELLED, "the waiter receives the recorded outcome");
	assert.equal(finishes.length, 1, "the run is recorded exactly once");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.RUNNING, "the freed slot starts queued work");
});

test("an unprobeable process group quarantines at its deadline and still records the run", async () => {
	// On win32 the child is not detached, so there is no process group to probe and
	// an observed exit is the only confirmation available. With no exit event the
	// run must still be recorded at the deadline, and its slot must be retained
	// rather than freed on an unproven assumption.
	const store = new TaskStore();
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	const finishes: string[] = [];
	let now = 1_000;
	let launches = 0;
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 10_000 }, {
		spawn: () => fakeChild({ exitOnKill: false, pid: 90 + (launches += 1) }).child,		now: () => now,
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => { timer.cancelled = true; };
		},
		pi: { command: "pi", args: [] },
		process: { platform: "win32", kill: () => {} },
	}, { askUser: async () => ({ value: "yes" }), onFinish: (task) => { finishes.push(task.id); } });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "queued" }));
	await tick();
	runner.cancel(first.id);
	const grace = timers.find((timer) => timer.ms === 250);
	assert.ok(grace, "termination grace is scheduled");
	grace.fn();
	now = 5_000;
	const check = timers.filter((timer) => timer.ms === 25).at(-1);
	assert.ok(check, "an unprobeable group must keep polling instead of stopping silently");
	check.fn();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(first.id)?.error ?? "", /capacity quarantined/);
	assert.equal(finishes.length, 1, "the run is recorded exactly once");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED, "an unconfirmed exit retains its capacity");
	assert.equal(launches, 1, "no further launch happens while the slot is quarantined");
});

test("abortReasonText renders an Error, a string, and nothing for unknown reasons", () => {
	assert.equal(abortReasonText(undefined), "");
	assert.equal(abortReasonText(new Error("interrupted by user")), " (interrupted by user)");
	assert.equal(abortReasonText("host timeout"), " (host timeout)");
	assert.equal(abortReasonText(new Error("")), "");
	assert.equal(abortReasonText(42), "");
});
