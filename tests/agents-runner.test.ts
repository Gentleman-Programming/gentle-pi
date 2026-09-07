import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_MODE, type AgentDefinition } from "../lib/agents-config.ts";
import { TASK_STATUS, TaskStore } from "../lib/agents-protocol.ts";
import { AgentRunner, childArguments, JsonLines, piCommand, type RunnerDeps, type TaskRequest } from "../lib/agents-runner.ts";
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
	spawnOptions: Array<{ stdio?: string[] }>;
}

function harness(options: { maxConcurrency?: number; answer?: Record<string, unknown> } = {}): Harness {
	const children: FakeChild[] = [];
	const timers: Harness["timers"] = [];
	const asks: Harness["asks"] = [];
	const spawnOptions: Harness["spawnOptions"] = [];
	let clock = 1000;
	const deps: RunnerDeps = {
		spawn: (_command, _args, options) => {
			spawnOptions.push({ stdio: options.stdio });
			const fake = fakeChild();
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
	});
	return { store, runner, children, timers, asks, spawnOptions };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("childArguments builds an rpc launch with model, thinking, tools, session dir, and instructions", () => {
	const args = childArguments(request());
	assert.deepEqual(args.slice(0, 2), ["--mode", "rpc"]);
	assert.ok(args.includes("--session-dir") && args[args.indexOf("--session-dir") + 1] === "/sessions");
	assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-5.6-terra:high");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
	assert.equal(args[args.indexOf("--append-system-prompt") + 1], "You map things.");
	assert.ok(!args.includes("--session"));
	const resumed = childArguments(request({ resumeSessionPath: "/sessions/old.jsonl", model: undefined, thinking: undefined, agent: { ...explorer, tools: [] } }));
	assert.equal(resumed[resumed.indexOf("--session") + 1], "/sessions/old.jsonl");
	assert.ok(!resumed.includes("--model") && !resumed.includes("--tools"));
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

test("AgentRunner reserves a parent-owned fourth stdio fd only for package-child authorization", async () => {
	const { runner, children, spawnOptions } = harness();
	const task = runner.run(request({ authorizeParentStandingReviewPermission: () => true }));
	await tick();
	assert.deepEqual(spawnOptions[0]?.stdio, ["pipe", "pipe", "pipe", "pipe"]);
	assert.equal((spawnOptions[0] as { stdio?: string[] } | undefined)?.stdio?.length, 4);
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "channel checked" }], stopReason: "stop" }] });
	children[0].emit({ type: "agent_settled" });
	assert.equal((await runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED);
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
