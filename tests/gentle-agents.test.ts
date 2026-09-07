import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import gentleAgents, { agentsCollapseKey, agentsEnabled, agentsStopKey, agentsViewKey, answerThroughUi, completionText, legacySubagentsInstalled, type AgentsDeps } from "../extensions/gentle-agents.ts";
import { historyDir, loadHistory, saveTask } from "../lib/agents-history.ts";
import { emptyThread, TASK_STATUS, type TaskRecord } from "../lib/agents-protocol.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { fakeChild, type FakeChild } from "./agents-fake-child.ts";

// Gentle Agents extension: the subagent_* tools drive isolated pi children,
// the card above the editor follows the store, and dialogs reach the host UI.

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
interface Registered {
	name: string;
	execute(id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
	renderCall(args: unknown, theme: unknown): { render(width: number): string[] };
}

const plainTheme = { fg: (_color: string, text: string) => text };
const fakeTui = { requestRender() {} };
const root = mkdtempSync(join(tmpdir(), "gentle-agents-ext-"));
after(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home");
const cwd = join(root, "project");
mkdirSync(join(home, ".pi", "agent", "agents"), { recursive: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(join(home, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\nmodel: openai-codex/gpt-5.6-terra\nthinking: high\ntools: [read, grep]\n---\nYou map things.");
writeFileSync(join(home, ".pi", "agent", "subagents.json"), JSON.stringify({ max_concurrency: 2, model_profiles: { explore: { effort: "low" } } }));

function fakePi() {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, Registered>();
	const shortcuts = new Map<string, { description: string; handler(ctx: ExtensionContext): Promise<void> }>();
	const commands = new Map<string, { handler(args: string, ctx: ExtensionContext): Promise<void> }>();
	const sent: Array<{ message: Record<string, unknown>; options: Record<string, unknown> }> = [];
	const renderers = new Map<string, (message: unknown, options: { expanded: boolean }, theme: unknown) => { render(width: number): string[] }>();
	const pi = {
		sendMessage: (message: Record<string, unknown>, options: Record<string, unknown>) => sent.push({ message, options }),
		registerMessageRenderer: (type: string, renderer: (message: unknown, options: { expanded: boolean }, theme: unknown) => { render(width: number): string[] }) => renderers.set(type, renderer),
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		registerTool: (tool: Registered) => tools.set(tool.name, tool),
		registerShortcut: (key: string, registration: { description: string; handler(ctx: ExtensionContext): Promise<void> }) => shortcuts.set(key, registration),
		registerCommand: (name: string, registration: { handler(args: string, ctx: ExtensionContext): Promise<void> }) => commands.set(name, registration),
	} as unknown as ExtensionAPI;
	const fire = async (event: string, ctx: ExtensionContext, payload: unknown = {}) => {
		for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
	};
	return { pi, tools, shortcuts, commands, fire, sent, renderers };
}

function fakeContext(tui: { requestRender(): void } = fakeTui, confirmResult: (title: string, message: string) => Promise<boolean> = async () => true, inputResult: (title: string, placeholder: string | undefined) => Promise<string | undefined> = async () => undefined) {
	const widgets = new Map<string, (tui: unknown, theme: unknown) => { render(width: number): string[] }>();
	const dialogs: string[] = [];
	const overlays: Array<{ render(width: number): string[]; handleInput(data: string): void }> = [];
	const ctx = {
		hasUI: true,
		sessionManager: { getSessionId: () => "s1", getCwd: () => cwd },
		ui: {
			notify: (message: string) => dialogs.push(`notify:${message}`),
			custom: (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => { render(width: number): string[]; handleInput(data: string): void }) =>
				new Promise((resolve) => {
					const component = factory({ terminal: { rows: 30 }, requestRender() {} }, plainTheme, {}, resolve);
					overlays.push(component);
				}),
			setWidget(key: string, content: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined) {
				if (content === undefined) widgets.delete(key);
				else widgets.set(key, content);
			},
			select: async (title: string, options: string[]) => {
				dialogs.push(`select:${title}:${options.join("|")}`);
				return options[0];
			},
			confirm: async (title: string, message: string) => {
				dialogs.push(`confirm:${title}:${message}`);
				return confirmResult(title, message);
			},
			input: async (title: string, placeholder: string | undefined) => {
				dialogs.push(`input:${title}`);
				return inputResult(title, placeholder);
			},
			editor: async () => "edited",
		},
	} as unknown as ExtensionContext;
	const widget = () => {
		const factory = widgets.get("gentle-agents");
		return factory ? factory(tui, plainTheme).render(72).map(stripAnsi) : undefined;
	};
	return { ctx, widget, dialogs, overlays };
}

function deps(): { deps: Partial<AgentsDeps>; children: FakeChild[]; spawned: string[][] } {
	const children: FakeChild[] = [];
	const spawned: string[][] = [];
	let clock = 1000;
	return {
		children,
		spawned,
		deps: {
			spawn: (command, args) => {
				spawned.push([command, ...args]);
				const child = fakeChild();
				children.push(child);
				return child.child;
			},
			now: () => (clock += 500),
			schedule: () => () => {},
			pi: { command: "pi", args: [] },
			home,
			env: { PATH: "/bin" },
		},
	};
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("agentsEnabled and agentsCollapseKey read their flags and stay off inside a child", () => {
	assert.equal(agentsEnabled({}), true);
	assert.equal(agentsEnabled({ GENTLE_PI_AGENTS: "off" }), false);
	assert.equal(agentsEnabled({ GENTLE_PI_AGENTS_CHILD: "1" }), false);
	assert.equal(agentsCollapseKey({}), "ctrl+shift+a");
	assert.equal(agentsCollapseKey({ GENTLE_PI_AGENTS_KEY: "off" }), undefined);
	assert.equal(agentsViewKey({}), "alt+a");
	assert.equal(agentsViewKey({ GENTLE_PI_AGENTS_VIEW_KEY: "off" }), undefined);
	assert.equal(agentsStopKey({}), "alt+s");
	assert.equal(agentsStopKey({ GENTLE_PI_AGENTS_STOP_KEY: "" }), undefined);
	assert.equal(agentsStopKey({ GENTLE_PI_AGENTS_STOP_KEY: "off" }), undefined);
	const off = fakePi();
	gentleAgents(off.pi, { GENTLE_PI_AGENTS: "0" });
	assert.equal(off.tools.size, 0);
});

test("while pi-subagents-j0k3r is still installed the tools stay unregistered and the user is told how to switch", async () => {
	const legacyHome = join(root, "legacy-home");
	mkdirSync(join(legacyHome, ".pi", "agent"), { recursive: true });
	writeFileSync(join(legacyHome, ".pi", "agent", "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents-j0k3r", "../../work/gentle-pi"] }));
	assert.equal(legacySubagentsInstalled(legacyHome), true);
	assert.equal(legacySubagentsInstalled(home), false);
	assert.equal(legacySubagentsInstalled(join(root, "missing")), false);
	const { pi, tools, fire } = fakePi();
	gentleAgents(pi, {}, { ...deps().deps, home: legacyHome });
	assert.equal(tools.size, 0);
	const notices: string[] = [];
	const ctx = { hasUI: true, ui: { notify: (message: string, level: string) => notices.push(`${level}:${message}`) } } as unknown as ExtensionContext;
	await fire("session_start", ctx);
	assert.match(notices[0] ?? "", /^warning:❀ Gentle Agents is waiting: remove the old package first with "pi remove npm:pi-subagents-j0k3r"/);
});

test("subagent_list_agents and subagent_run in task mode launch a child with the resolved profile and return its answer", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, widget } = fakeContext();
	await fire("session_start", ctx);
	assert.deepEqual([...tools.keys()].sort(), ["subagent_cancel", "subagent_continue", "subagent_list_agents", "subagent_list_tasks", "subagent_result", "subagent_run", "subagent_send_message", "subagent_status"]);
	const listed = await tools.get("subagent_list_agents")!.execute("c0", {}, undefined, undefined, ctx);
	assert.match(listed.content[0].text, /- explore \(global\): maps things/);

	const running = tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Map lib/ and report every module.", label: "map lib modules", context: "Focus on agents-*.ts" }, undefined, undefined, ctx);
	await tick();
	const [args] = harness.spawned;
	assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-5.6-terra:low", "the profile effort overrides the definition");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
	await tick();
	assert.match(String(harness.children[0].written[1].message), /Map lib\/ and report every module\.\n\n## Context\nFocus on agents-\*\.ts/);
	assert.match(widget()![0], /^╭─ ❀ Agents · 1 active ─+ \d+s ╮$/);
	assert.match(widget()![1], /^│ ◐  explore  map lib modules +gpt-5\.6-terra · \d+s │$/);
	harness.children[0].emit({ type: "tool_execution_start", toolCallId: "c", toolName: "grep", args: {} });
	harness.children[0].emit({ type: "message_end", message: { role: "assistant", usage: { totalTokens: 12_000, cost: { total: 0.09 } } } });
	await tick();
	assert.match(widget()![1], /◐  explore  map lib modules +gpt-5\.6-terra · 12k · \$0\.09 · \d+s │$/);
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "lib has three agent files." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	const result = await running;
	assert.equal(result.content[0].text, "lib has three agent files.");
	assert.equal((result.details.gentleAgents as { status: string }).status, "completed");
	assert.match(widget()![1], /✓  explore  map lib modules/);
	const orphan = tools.get("subagent_run")!.execute("c9", { agent: "explore", task: "Orphan", mode: "background" }, undefined, undefined, ctx);
	await orphan;
	await tick();
	await fire("session_shutdown", ctx);
	await tick();
	assert.deepEqual(harness.children[1].killed, ["SIGTERM"], "closing pi stops the running children");
	assert.match(tools.get("subagent_run")!.renderCall({ agent: "explore" }, plainTheme).render(60).join(""), /❀ agent run · explore/);
});

test("background runs return at once; status, result, send_message, cancel, and continue follow the task", async () => {
	const { pi, tools, fire, sent, renderers } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Long job", mode: "background" }, undefined, undefined, ctx);
	const id = (started.details.gentleAgents as { taskId: string }).taskId;
	assert.match(started.content[0].text, new RegExp(`background as task ${id}`));
	await tick();
	assert.match((await tools.get("subagent_status")!.execute("c2", { task_id: id }, undefined, undefined, ctx)).content[0].text, /running · background/);
	assert.match((await tools.get("subagent_result")!.execute("c3", { task_id: id }, undefined, undefined, ctx)).content[0].text, /still running/);
	assert.match((await tools.get("subagent_send_message")!.execute("c4", { task_id: id, message: "Skip tests" }, undefined, undefined, ctx)).content[0].text, /queued/);
	await tick();
	assert.equal(harness.children[0].written.at(-1)?.message, "Skip tests");
	assert.match((await tools.get("subagent_continue")!.execute("c5", { task_id: id, prompt: "more" }, undefined, undefined, ctx)).content[0].text, /cannot be continued yet/);
	assert.match((await tools.get("subagent_list_tasks")!.execute("c6", {}, undefined, undefined, ctx)).content[0].text, new RegExp(`^${id} · explore · running`));
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "All done." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal((await tools.get("subagent_result")!.execute("c7", { task_id: id }, undefined, undefined, ctx)).content[0].text, "All done.");
	assert.equal(sent.length, 1, "a background result is delivered to the model once");
	assert.equal(sent[0].message.customType, "gentle-agents.result");
	assert.deepEqual(sent[0].options, { deliverAs: "followUp", triggerTurn: true });
	assert.match(String(sent[0].message.content), new RegExp(`^Subagent explore \\(task ${id}, "Long job"\\) finished\\.\n\nAll done\\.$`));
	const card = renderers.get("gentle-agents.result")!(sent[0].message, { expanded: true }, plainTheme).render(70).map(stripAnsi);
	assert.match(card[0], /^╭─ ❀ Agent result · explore ─+ collapse ╮$/);
	assert.match(card[1], /Subagent explore/);
	assert.match(card[card.length - 2], /All done\./);
	const resumed = tools.get("subagent_continue")!.execute("c8", { task_id: id, prompt: "Now summarize", mode: "task" }, undefined, undefined, ctx);
	await tick();
	const args = harness.spawned[1];
	assert.equal(args[args.indexOf("--session") + 1], "/sessions/child.jsonl");
	await tick();
	harness.children[1].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Summary." }] }] });
	harness.children[1].emit({ type: "agent_settled" });
	assert.equal((await resumed).content[0].text, "Summary.");
	assert.match((await tools.get("subagent_cancel")!.execute("c9", { task_id: id }, undefined, undefined, ctx)).content[0].text, /not running/);
	assert.match((await tools.get("subagent_status")!.execute("c10", { task_id: "nope" }, undefined, undefined, ctx)).content[0].text, /Error: no task nope/);
	assert.match((await tools.get("subagent_run")!.execute("c11", { agent: "ghost", task: "x" }, undefined, undefined, ctx)).content[0].text, /no subagent named "ghost"\. Known: explore/);
});

test("once the last task is done the card asks for one frame when its finished row expires, so an idle terminal clears it", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	let clock = 1000;
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	harness.deps.now = () => clock;
	harness.deps.schedule = (fn, ms) => {
		const timer = { fn, ms, cancelled: false };
		timers.push(timer);
		return () => {
			timer.cancelled = true;
		};
	};
	gentleAgents(pi, {}, harness.deps);
	let frames = 0;
	const { ctx, widget } = fakeContext({ requestRender: () => (frames += 1) });
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Short job", mode: "background" }, undefined, undefined, ctx);
	await tick();
	widget();
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.match(widget()![1], /✓  explore  Short job/);
	const expiry = timers.filter((timer) => !timer.cancelled && timer.ms === 60_000);
	assert.equal(expiry.length, 1, "exactly one timer waits for the finished row to leave the card");
	clock += 60_000;
	const before = frames;
	expiry[0].fn();
	assert.equal(frames, before + 1, "the expiry asks the terminal for a frame");
	assert.deepEqual(widget(), [], "the card is gone");
	assert.equal(timers.filter((timer) => !timer.cancelled && timer.ms === 60_000).length, 0, "nothing is rescheduled once the card is empty");
});

test("completionText names the outcome before the answer", () => {
	const base = { id: "t1", agent: "explore", mode: "background", prompt: "p", label: "map lib", cwd: "/r", parentSessionId: "s", status: "failed" as const, createdAt: 1, startedAt: 1, endedAt: 2, model: "m", thinking: undefined, sessionPath: null, error: "pi exited with code 1", result: null, lastStep: "x", lastActivityAt: 2, turns: 0, toolCalls: 0, tokens: 0, cost: 0 };
	assert.equal(completionText(base), 'Subagent explore (task t1, "map lib") failed.\n\nSubagent explore failed: pi exited with code 1');
	assert.equal(completionText({ ...base, status: "timed_out", error: "stalled for 4 min" }), 'Subagent explore (task t1, "map lib") timed out.\n\nSubagent explore timed_out: stalled for 4 min');
});

test("a task-mode child's dialog reaches the host UI and the answer goes back to the child", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, widget } = fakeContext();
	await fire("session_start", ctx);
	const running = tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Ask me" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].emit({ type: "extension_ui_request", id: "u1", method: "select", title: "Which file?", options: ["a.ts", "b.ts"] });
	await tick();
	await tick();
	assert.deepEqual(dialogs, ["select:❀ Which file?:a.ts|b.ts"]);
	assert.deepEqual(harness.children[0].written.at(-1), { type: "extension_ui_response", id: "u1", value: "a.ts" });
	assert.match(widget()![1], /◐  explore  Ask me/);
	harness.children[0].emit({ type: "agent_end", messages: [] });
	harness.children[0].emit({ type: "agent_settled" });
	await running;
	assert.deepEqual(await answerThroughUi(ctx.ui, { id: "u2", method: "confirm", title: "Sure?" }, { message: "really" }), { confirmed: true });
	assert.deepEqual(await answerThroughUi(ctx.ui, { id: "u3", method: "input", title: "Name" }, {}), { cancelled: true });
	assert.deepEqual(await answerThroughUi(ctx.ui, { id: "u4", method: "editor", title: "Edit" }, {}), { value: "edited" });
	assert.deepEqual(await answerThroughUi(undefined, { id: "u5", method: "select", title: "x" }, {}), { cancelled: true });
});

test("finished tasks are written to history, come back through resolveTask, and the overlay lists them", async () => {
	const { pi, tools, fire, commands, shortcuts } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, overlays } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Persist me", mode: "background" }, undefined, undefined, ctx);
	const id = (started.details.gentleAgents as { taskId: string }).taskId;
	await tick();
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Kept." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	const tasksDir = join(home, ".pi", "agent", "gentle-agents", "tasks");
	let stored = await loadHistory(tasksDir);
	for (let attempt = 0; attempt < 40 && !stored.some((entry) => entry.task.id === id); attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		stored = await loadHistory(tasksDir);
	}
	assert.ok(stored.some((entry) => entry.task.id === id && entry.task.result === "Kept."), "the finished task is on disk");

	const fresh = fakePi();
	gentleAgents(fresh.pi, {}, deps().deps);
	const again = fakeContext();
	await fresh.fire("session_start", again.ctx);
	assert.equal((await fresh.tools.get("subagent_result")!.execute("c2", { task_id: id }, undefined, undefined, again.ctx)).content[0].text, "Kept.");

	assert.ok(commands.has("gentle:agents") && shortcuts.has("alt+a"));
	const opened = commands.get("gentle:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	const overlay = overlays[0];
	assert.ok(overlay, "the overlay component was created");
	assert.match(stripAnsi(overlay.render(80)[0]), /^╭─ ❀ Agents · this session · 0 active · \d+ finished/);
	assert.ok(overlay.render(80).map(stripAnsi).some((line) => /✓ explore/.test(line)), "the finished task is listed");
	overlay.handleInput("\x1b");
	await opened;
});

test("the overlay confirms a running task once and reports when it finishes during confirmation", async () => {
	const { pi, tools, fire, commands, sent } = fakePi();
	const harness = deps();
	const modalHome = join(root, "modal-home");
	mkdirSync(join(modalHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(modalHome, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\nmodel: openai-codex/gpt-5.6-terra\n---\nYou map things.");
	writeFileSync(join(modalHome, ".pi", "agent", "subagents.json"), JSON.stringify({ max_concurrency: 2 }));
	harness.deps.home = modalHome;
	let answerConfirmation: (confirmed: boolean) => void = () => {};
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext(fakeTui, () => new Promise((resolve) => {
		answerConfirmation = resolve;
	}));
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Race", mode: "background" }, undefined, undefined, ctx);
	await tick();
	const opened = commands.get("gentle:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	const overlay = overlays[0];
	assert.ok(overlay, "the overlay component was created");
	overlay.handleInput("s");
	overlay.handleInput("c");
	await tick();
	assert.deepEqual(dialogs, ["confirm:Stop explore?:Current work may be incomplete."], "s and its compatibility alias share one confirmation");
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Finished first." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	answerConfirmation(true);
	await tick();
	assert.match(dialogs.at(-1) ?? "", /^notify:Task explore already finished\.$/);
	assert.equal(sent.length, 1, "a normal completion during confirmation still reaches the parent");
	overlay.handleInput("\x1b");
	await opened;
});

test("the overlay stops a queued selection immediately without confirmation", async () => {
	const { pi, tools, fire, commands } = fakePi();
	const harness = deps();
	const queueHome = join(root, "queue-home");
	mkdirSync(join(queueHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(queueHome, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\n---\nYou map things.");
	writeFileSync(join(queueHome, ".pi", "agent", "subagents.json"), JSON.stringify({ max_concurrency: 1 }));
	harness.deps.home = queueHome;
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext();
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "First", mode: "background" }, undefined, undefined, ctx);
	await tick();
	const queued = await tools.get("subagent_run")!.execute("c2", { agent: "explore", task: "Queued", mode: "background" }, undefined, undefined, ctx);
	const queuedId = (queued.details.gentleAgents as { taskId: string }).taskId;
	const opened = commands.get("gentle:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	overlays[0]!.handleInput("s");
	await tick();
	assert.deepEqual(dialogs, ["notify:Stopped explore."], "queued work stops without confirmation");
	assert.match((await tools.get("subagent_status")!.execute("c3", { task_id: queuedId }, undefined, undefined, ctx)).content[0].text, /cancelled/);
	overlays[0]!.handleInput("\x1b");
	await opened;
});

test("the overlay explains that stopping a waiting subagent dismisses its question", async () => {
	const { pi, tools, fire, commands } = fakePi();
	const harness = deps();
	const waitingHome = join(root, "waiting-home");
	mkdirSync(join(waitingHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(waitingHome, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\n---\nYou map things.");
	harness.deps.home = waitingHome;
	let answerInput: (value: string | undefined) => void = () => {};
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext(fakeTui, async () => true, () => new Promise<string | undefined>((resolve) => {
		answerInput = resolve;
	}));
	await fire("session_start", ctx);
	const running = tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Ask", mode: "task" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].emit({ type: "extension_ui_request", id: "wait", method: "input", title: "Need input" });
	await tick();
	const opened = commands.get("gentle:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	overlays[0]!.handleInput("s");
	await tick();
	assert.ok(dialogs.includes("confirm:Stop explore?:Its pending question will be dismissed."));
	assert.match((await running).content[0].text, /cancelled/);
	answerInput(undefined);
	overlays[0]!.handleInput("\x1b");
	await opened;
});

test("restored task history cannot execute stop", async () => {
	const { pi, fire, commands } = fakePi();
	const harness = deps();
	const historyHome = join(root, "history-home");
	const historical: TaskRecord = { id: "history-running", agent: "explore", mode: "background", prompt: "p", label: "p", cwd, parentSessionId: "old", status: TASK_STATUS.RUNNING, createdAt: 1, startedAt: 1, endedAt: null, model: "m", thinking: undefined, sessionPath: null, error: null, result: null, lastStep: "working", lastActivityAt: 1, turns: 0, toolCalls: 0, tokens: 0, cost: 0 };
	await saveTask(historyDir(historyHome), historical, emptyThread());
	harness.deps.home = historyHome;
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext();
	await fire("session_start", ctx);
	const opened = commands.get("gentle:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	assert.doesNotMatch(stripAnsi(overlays[0]!.render(80).at(-2) ?? ""), /Stop selected/);
	overlays[0]!.handleInput("s");
	overlays[0]!.handleInput("c");
	await tick();
	assert.deepEqual(dialogs, []);
	overlays[0]!.handleInput("\x1b");
	await opened;
});

test("Alt+S confirms a snapshot of active subagents and suppresses their follow-up delivery", async () => {
	const { pi, tools, fire, shortcuts, sent } = fakePi();
	const harness = deps();
	let answerConfirmation: (confirmed: boolean) => void = () => {};
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs } = fakeContext(fakeTui, () => new Promise<boolean>((resolve) => {
		answerConfirmation = resolve;
	}));
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "First", mode: "background" }, undefined, undefined, ctx);
	await tick();
	const shortcut = shortcuts.get("alt+s");
	assert.ok(shortcut, "Alt+S is registered by default");
	assert.equal(shortcut.description, "Stop active subagent(s)");
	const stopping = shortcut.handler(ctx);
	await tick();
	await tools.get("subagent_run")!.execute("c2", { agent: "explore", task: "Second", mode: "background" }, undefined, undefined, ctx);
	await tick();
	answerConfirmation(true);
	await stopping;
	assert.deepEqual(dialogs, ["confirm:Stop 1 active subagent?:Only these 1 subagent will stop. Current work may be incomplete.", "notify:Stopped 1 subagent."]);
	assert.equal(sent.length, 0, "intentional cancellation does not start a follow-up turn");
	assert.match((await tools.get("subagent_list_tasks")!.execute("c3", {}, undefined, undefined, ctx)).content[0].text, /running/, "a subagent started during confirmation remains active");
	const secondConfirmation = shortcut.handler(ctx);
	await tick();
	assert.match(dialogs.at(-1) ?? "", /^confirm:Stop 1 active subagent\?/);
	answerConfirmation(false);
	await secondConfirmation;
	await fire("session_shutdown", ctx);
});

test("the card follows the active session: after /new the earlier session's tasks leave it, and come back on /resume", async () => {
	const { pi, tools, commands, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, widget, overlays } = fakeContext();
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Long job", mode: "background" }, undefined, undefined, ctx);
	await tick();
	assert.match(widget()![1], /◐  explore  Long job/);
	const sessions = ctx as unknown as { sessionManager: { getSessionId(): string; getCwd(): string } };
	sessions.sessionManager = { getSessionId: () => "s2", getCwd: () => cwd };
	await fire("session_start", ctx, { type: "session_start", reason: "new" });
	assert.deepEqual(widget(), [], "the new session starts with an empty card");
	assert.match((await tools.get("subagent_list_tasks")!.execute("c2", {}, undefined, undefined, ctx)).content[0].text, /No subagent tasks in this session/);
	const opened = commands.get("gentle:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	const overlay = overlays[0]!;
	assert.match(stripAnsi(overlay.render(80)[0]), /this session · 0 active · 0 finished/, "the overlay opens on the active session");
	overlay.handleInput("a");
	assert.ok(overlay.render(80).map(stripAnsi).some((line) => /◐ explore/.test(line)), "all sessions still reaches the running task");
	overlay.handleInput("\x1b");
	await opened;
	sessions.sessionManager = { getSessionId: () => "s1", getCwd: () => cwd };
	await fire("session_start", ctx, { type: "session_start", reason: "resume" });
	assert.match(widget()![1], /◐  explore  Long job/, "resuming the first session shows its task again");
});

test("the card caps its rows to the terminal height and says how many tasks are hidden", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, widget } = fakeContext({ requestRender() {}, terminal: { rows: 20 } } as { requestRender(): void });
	await fire("session_start", ctx);
	for (let index = 0; index < 6; index += 1) await tools.get("subagent_run")!.execute(`c${index}`, { agent: "explore", task: `Job ${index}`, label: `job ${index}`, mode: "background" }, undefined, undefined, ctx);
	await tick();
	const card = widget()!;
	assert.equal(card.length, 8, "a 20-row terminal gets five card rows (four tasks and the overflow line) inside the frame, then the spacer");
	assert.match(card[0], /2 active · 4 queued/);
	assert.match(card[5], /^│ … 2 more · alt\+a to view +│$/);
});
