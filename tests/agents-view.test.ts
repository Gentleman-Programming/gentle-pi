import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { emptyThread, TASK_EVENT, TASK_STATUS, TaskStore, type TaskRecord } from "../lib/agents-protocol.ts";
import { AgentsView, itemLines, taskHeader } from "../lib/agents-view.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

// Gentle Agents overlay: list left, selected thread right, tail-following,
// and only the selected task subscribed.

const plainTheme = { fg: (_color: string, text: string) => text };

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
	return { id, agent: "explore", mode: "task", prompt: "p", label: "p", cwd: "/r", parentSessionId: "s", status: TASK_STATUS.RUNNING, createdAt: 1000, startedAt: 1000, endedAt: null, model: "gpt-5.6-terra", thinking: undefined, sessionPath: "/sessions/x.jsonl", error: null, result: null, lastStep: "grep", lastActivityAt: 1000, turns: 0, toolCalls: 0, tokens: 34_000, cost: 0.27, ...overrides };
}

function harness(rows = 8) {
	const store = new TaskStore();
	const events: string[] = [];
	let renders = 0;
	const view = new AgentsView({
		theme: plainTheme,
		rows,
		store,
		now: () => 61_000,
		onCancel: (entry) => events.push(`cancel:${entry.id}`),
		onOpen: (entry) => events.push(`open:${entry.id}`),
		onClose: () => events.push("close"),
		requestRender: () => (renders += 1),
	});
	return { store, view, events, renders: () => renders };
}

test("itemLines renders text, thinking, tools with an output tail, and notes", () => {
	assert.deepEqual(itemLines({ kind: "text", text: "one two three four" }, plainTheme, 9), ["one two", "three", "four"]);
	assert.deepEqual(itemLines({ kind: "thinking", text: "deep\nthoughts" }, plainTheme, 20), ["∴ deep"]);
	const output = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
	const tool = itemLines({ kind: "tool", callId: "c", name: "bash", args: { command: "ls  -la" }, output, running: true, isError: false }, plainTheme, 30);
	assert.equal(tool[0], "▸ bash ls -la");
	assert.equal(tool.length, 10, "head, eight tail lines, running marker");
	assert.equal(tool[1], "  line 2");
	assert.equal(tool[9], "  …");
	assert.deepEqual(itemLines({ kind: "note", text: "error: boom" }, plainTheme, 30), ["· error: boom"]);
	assert.equal(taskHeader(task("a"), 61_000), "explore · running · gpt-5.6-terra · 34k · $0.27 · 1m00s");
});

test("AgentsView renders the frame with the task list and the selected thread's tail, at width", () => {
	const { store, view } = harness(8);
	store.add(task("a"));
	store.add(task("b", { agent: "worker", status: TASK_STATUS.COMPLETED, endedAt: 5000, createdAt: 900, lastActivityAt: 900 }));
	for (let index = 0; index < 6; index += 1) store.apply("a", { type: TASK_EVENT.TEXT, text: `line ${index}\n` }, 2000);
	const lines = view.render(90);
	for (const line of lines) assert.equal(visibleWidth(line), 90, `"${stripAnsi(line)}" is not 90 wide`);
	const plain = lines.map(stripAnsi);
	assert.equal(plain.length, 8);
	assert.match(plain[0], /^╭─ ❀ Agents · 1 active · 1 finished ─+╮$/);
	assert.match(plain[1], /^│ ▸ ◐ explore  1m00s +│ explore · running · gpt-5\.6-terra · 34k · \$0\.27 · 1m00s +│$/);
	assert.match(plain[2], /^│   ✓ worker  4s +│ line 3 +│$/, "the thread window follows the tail");
	assert.match(plain[4], /line 5/);
	assert.match(plain[6], /j\/k task .* esc close/);
	assert.match(plain[7], /^╰─+╯$/);
});

test("AgentsView keys move the selection, scroll, follow, cancel, open, and close", () => {
	const { store, view, events } = harness(8);
	store.add(task("a"));
	store.add(task("b", { createdAt: 900, lastActivityAt: 900, status: TASK_STATUS.COMPLETED, endedAt: 5000 }));
	assert.equal(view.selectedTask()?.id, "a");
	view.handleInput("j");
	assert.equal(view.selectedTask()?.id, "b");
	view.handleInput("c");
	assert.deepEqual(events, [], "finished tasks cannot be cancelled");
	view.handleInput("k");
	view.handleInput("c");
	view.handleInput("o");
	view.handleInput("\x1b");
	assert.deepEqual(events, ["cancel:a", "open:a", "close"]);
	for (let index = 0; index < 12; index += 1) store.apply("a", { type: TASK_EVENT.TEXT, text: `l${index}\n` }, 2000);
	view.handleInput("\x1b[5~");
	assert.match(stripAnsi(view.render(80)[2]), /│ l0 +│$/, "page up leaves follow mode and shows the top");
	view.handleInput("\x0a");
	assert.match(stripAnsi(view.render(80)[2]), /│ l4 +│$/, "ctrl+j scrolls one page down");
	view.handleInput("\x0b");
	assert.match(stripAnsi(view.render(80)[2]), /│ l0 +│$/, "ctrl+k scrolls one page up");
	view.handleInput("f");
	assert.match(stripAnsi(view.render(80)[2]), /│ l9 +│$/, "f follows the tail again");
});

test("AgentsView subscribes only to the selected task and survives an empty store", () => {
	const { store, view, renders } = harness(6);
	assert.match(stripAnsi(view.render(60)[1]), /no tasks yet/);
	store.add(task("a"));
	store.add(task("b", { createdAt: 900, lastActivityAt: 900 }));
	const before = renders();
	store.apply("b", { type: TASK_EVENT.TEXT, text: "quiet" }, 2000);
	assert.equal(renders(), before, "an event on the unselected task renders nothing");
	store.apply("a", { type: TASK_EVENT.TEXT, text: "loud" }, 2000);
	assert.equal(renders(), before + 1);
	view.dispose();
	store.apply("a", { type: TASK_EVENT.TEXT, text: "after" }, 2000);
	assert.equal(renders(), before + 1, "disposed views stay quiet");
});
