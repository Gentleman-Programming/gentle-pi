import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { emptyThread, TASK_EVENT, TASK_STATUS, TaskStore, type TaskRecord } from "../lib/agents-protocol.ts";
import { AgentsView, itemLines, taskHeader } from "../lib/agents-view.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

// Gentle Agents overlay: list left, selected thread right, tail-following,
// and only the selected task subscribed.

const plainTheme = { fg: (_color: string, text: string) => text };

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
	return { id, agent: "explore", mode: "task", prompt: "p", label: "p", cwd: "/r", parentSessionId: "s", status: TASK_STATUS.RUNNING, createdAt: 1000, startedAt: 1000, endedAt: null, model: "gpt-5.6-terra", thinking: undefined, sessionPath: "/sessions/x.jsonl", error: null, result: null, lastStep: "grep", lastActivityAt: 1000, turns: 0, toolCalls: 0, tokens: 34_000, cost: 0.27, ...overrides };
}

function harness(rows = 8, sessionId?: string) {
	const store = new TaskStore();
	const events: string[] = [];
	let renders = 0;
	const view = new AgentsView({
		theme: plainTheme,
		rows,
		store,
		sessionId,
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

function mouse(x: number, y: number, width: number, height: number, type: TuiMouseEvent["type"] = "move", wheelDelta?: number): TuiMouseEvent {
	return { type, button: type === "move" || type === "wheel" ? "none" : "left", x, y, screenX: x, screenY: y, width, height, shift: false, alt: false, ctrl: false, wheelDelta };
}

test("AgentsView pointer regions hover and select task rows without activating, and keep list and thread wheels independent", () => {
	const { store, view, events } = harness(6);
	for (const id of ["a", "b", "c", "d", "e"]) store.add(task(id, { agent: id }));
	for (let index = 0; index < 8; index += 1) store.apply("b", { type: TASK_EVENT.TEXT, text: `thread ${index}\n` }, 2000);
	const lines = view.render(80);

	assert.equal(view.handleMouse(mouse(4, 2, 80, lines.length))?.handled, true, "hover consumes only the task row");
	assert.equal(view.selectedTask()?.id, "a", "hover never changes keyboard selection or the displayed thread");
	assert.equal(view.handleMouse(mouse(4, 2, 80, lines.length, "click"))?.handled, true);
	assert.equal(view.selectedTask()?.id, "b", "click selects the task and displays its thread");
	assert.deepEqual(events, [], "click selects the task only; it never opens or cancels");
	view.render(80);
	assert.equal(view.handleMouse(mouse(50, 2, 80, lines.length, "wheel", -1))?.handled, true, "thread wheel is handled by its viewport");
	assert.match(stripAnsi(view.render(80)[2]), /thread 6/, "thread wheel moves only the selected thread");
	assert.equal(view.handleMouse(mouse(4, 2, 80, lines.length, "wheel", 1))?.handled, true, "list wheel is handled by its viewport");
	assert.match(stripAnsi(view.render(80)[1]), / b /, "list wheel changes only the task-list viewport");
	assert.equal(view.handleMouse(mouse(50, 2, 80, lines.length, "click")), undefined, "thread clicks are inert");
	view.dispose();
	assert.equal(view.handleMouse(mouse(4, 2, 80, lines.length)), undefined, "late pointer events are inert after disposal");
});

test("AgentsView clears hover on leave, list scrolling, resize, updates, empty lists, and disposal", () => {
	const { store, view } = harness(6);
	store.add(task("a"));
	store.add(task("b", { agent: "b" }));
	store.add(task("c", { agent: "c" }));
	store.add(task("d", { agent: "d" }));
	const lines = view.render(80);
	const observer = view.mouseObserver();
	const dispatch = (event: TuiMouseEvent) => {
		observer.beforeMouse(event);
		try {
			return view.handleMouse(event);
		} finally {
			observer.afterMouse(event);
		}
	};
	dispatch(mouse(4, 2, 80, lines.length));
	assert.match(stripAnsi(view.render(80)[2]), /▹/, "the hovered row is styled without changing selection");
	dispatch(mouse(4, 2, 80, lines.length, "wheel", -1));
	assert.match(stripAnsi(view.render(80)[2]), /▹/, "a list wheel event at its boundary preserves hover");
	dispatch(mouse(4, 2, 80, lines.length, "wheel", 1));
	assert.doesNotMatch(stripAnsi(view.render(80).join("\n")), /▹/, "list scrolling clears hover so it cannot remain on the task formerly under the pointer");
	dispatch(mouse(4, 2, 80, lines.length));
	dispatch(mouse(50, 2, 80, lines.length));
	assert.doesNotMatch(stripAnsi(view.render(80)[2]), /▹/, "the root observer clears hover outside a child region");
	dispatch(mouse(4, 2, 80, lines.length));
	view.render(81);
	assert.doesNotMatch(stripAnsi(view.render(81)[2]), /▹/, "resize clears hover before the next frame");
	dispatch(mouse(4, 2, 81, lines.length));
	store.apply("a", { type: TASK_EVENT.TEXT, text: "update" }, 2000);
	assert.doesNotMatch(stripAnsi(view.render(81)[2]), /▹/, "task updates clear hover");
	view.dispose();
	const { view: empty } = harness(6);
	empty.render(80);
	assert.equal(empty.handleMouse(mouse(4, 1, 80, 6)), undefined, "empty task rows are inert");
	empty.dispose();
});

test("AgentsView advertises s to stop an active selection, retains c as an alias, and hides stopping for finished tasks", () => {
	const { store, view, events } = harness(8);
	store.add(task("active"));
	assert.match(stripAnsi(view.render(80).at(-2) ?? ""), /s Stop selected/);
	view.handleInput("s");
	view.handleInput("c");
	assert.deepEqual(events, ["cancel:active", "cancel:active"]);
	store.update("active", { status: TASK_STATUS.CANCELLED, endedAt: 2000 });
	assert.doesNotMatch(stripAnsi(view.render(80).at(-2) ?? ""), /Stop selected/);
	view.handleInput("s");
	assert.deepEqual(events, ["cancel:active", "cancel:active"], "finished tasks never stop");
});

test("AgentsView Escape and q close an active selection without cancelling it", () => {
	const { store, view, events } = harness(8);
	store.add(task("active"));
	view.handleInput("\x1b");
	view.handleInput("q");
	assert.deepEqual(events, ["close", "close"], "close keys never invoke selected-task cancellation");
});

test("AgentsView scrolls the task list so the selection stays visible when there are more tasks than rows", () => {
	const { store, view } = harness(6);
	for (let index = 0; index < 6; index += 1) store.add(task(`t${index}`, { agent: `agent${index}`, createdAt: 1000 - index, lastActivityAt: 1000 - index }));
	const listed = () => view.render(80).slice(1, 4).map((line) => stripAnsi(line).slice(0, 24));
	assert.match(listed()[0], /▸ ◐ agent0/);
	assert.match(listed()[2], /agent2/);
	for (let index = 0; index < 4; index += 1) view.handleInput("j");
	assert.equal(view.selectedTask()?.id, "t4");
	assert.match(listed()[2], /▸ ◐ agent4/, "the list scrolls down until the selection is the last visible row");
	assert.match(listed()[0], /agent2/);
	view.handleInput("j");
	view.handleInput("j");
	assert.equal(view.selectedTask()?.id, "t5", "the selection stops at the last task");
	assert.match(listed()[2], /▸ ◐ agent5/);
	for (let index = 0; index < 4; index += 1) view.handleInput("k");
	assert.match(listed()[0], /▸ ◐ agent1/, "moving up scrolls the list back");
	assert.match(listed()[2], /agent3/);
});

test("AgentsView lists the active session's recent tasks by default and a toggles every session", () => {
	const { store, view } = harness(8, "s");
	store.add(task("mine", { agent: "mine" }));
	store.add(task("theirs", { agent: "theirs", parentSessionId: "other", createdAt: 900, lastActivityAt: 900 }));
	store.add(task("fresh", { agent: "fresh", status: TASK_STATUS.COMPLETED, endedAt: 61_000 - 60_000, createdAt: 850, lastActivityAt: 850 }));
	store.add(task("stale", { agent: "stale", status: TASK_STATUS.COMPLETED, endedAt: 61_000 - 16 * 60_000, createdAt: 800, lastActivityAt: 800 }));
	const names = () => view.render(80).map(stripAnsi).filter((line) => /[◐✓] /.test(line)).map((line) => line.match(/[◐✓] (\w+)/)?.[1]);
	let plain = view.render(80).map(stripAnsi);
	assert.match(plain[0], /^╭─ ❀ Agents · this session · 1 active · 1 finished ─+╮$/);
	assert.deepEqual(names(), ["mine", "fresh"], "another session's task and one finished over fifteen minutes ago stay out");
	assert.match(plain.at(-2) ?? "", /a all sessions/);
	view.handleInput("a");
	plain = view.render(80).map(stripAnsi);
	assert.match(plain[0], /^╭─ ❀ Agents · all sessions · 2 active · 2 finished ─+╮$/);
	assert.deepEqual(names(), ["mine", "theirs", "fresh", "stale"]);
	assert.match(plain.at(-2) ?? "", /a this session/);
	view.handleInput("j");
	assert.equal(view.selectedTask()?.id, "theirs");
	view.handleInput("a");
	assert.equal(view.selectedTask()?.id, "mine", "a new scope reads from the top");
	assert.deepEqual(names(), ["mine", "fresh"]);
});
