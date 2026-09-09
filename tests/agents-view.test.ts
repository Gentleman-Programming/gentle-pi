import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { emptyThread, TASK_EVENT, TASK_STATUS, TaskStore, type TaskRecord } from "../lib/agents-protocol.ts";
import { renderThreadItem } from "../lib/agents-thread-view.ts";
import { AgentsView, taskHeader } from "../lib/agents-view.ts";
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

test("renderThreadItem renders labeled text, thinking, tool-output, and note blocks", () => {
	assert.deepEqual(renderThreadItem({ kind: "text", text: "one two three four" }, plainTheme, 9), ["Text", "  one two", "  three", "  four"]);
	assert.deepEqual(renderThreadItem({ kind: "thinking", text: "deep\nthoughts" }, plainTheme, 20), ["Thinking", "  deep", "  thoughts"]);
	const output = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
	const tool = renderThreadItem({ kind: "tool", callId: "c", name: "bash", args: { command: "ls  -la" }, output, running: true, isError: false }, plainTheme, 30);
	assert.equal(tool[0], "Tool · bash · Running");
	assert.equal(tool.length, 12, "head, output label, and every retained output line");
	assert.equal(tool[1], "  Output");
	assert.equal(tool[2], "    line 0");
	assert.equal(tool[11], "    line 9");
	// A long output line wraps instead of being clipped, so nothing is hidden.
	const wide = renderThreadItem({ kind: "tool", callId: "c", name: "bash", args: {}, output: "alpha beta gamma delta", running: false, isError: false }, plainTheme, 12);
	assert.deepEqual(wide.slice(2), ["    alpha", "    beta", "    gamma", "    delta"]);
	assert.deepEqual(renderThreadItem({ kind: "note", text: "error: boom" }, plainTheme, 30), ["Note", "  error: boom"]);
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
	assert.match(plain[0], /^╭─ ❀ Agents · 1 active · 1 finished ─+ \[× Close\]╮$/);
	assert.match(plain[1], /▾ Orchestrator s · 2 Subag….*explore · running · gpt-5\.6-terra · 34k · \$0\.27 · 1m00s/);
	assert.match(plain[2], /▸ └ ◐ Subagent explore.*line 3/, "the thread window follows the tail");
	assert.match(plain[3], /└ ✓ Subagent worker.*line 4/);
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
	assert.deepEqual(events, ["cancel:a", "open:a"]);
	for (let index = 0; index < 12; index += 1) store.apply("a", { type: TASK_EVENT.TEXT, text: `l${index}\n` }, 2000);
	view.handleInput("\x1b[5~");
	assert.match(stripAnsi(view.render(80)[2]), /│ Text +│$/, "page up leaves follow mode and shows the top block label");
	assert.match(stripAnsi(view.render(80)[3]), /│   l0 +│$/, "page up leaves follow mode and shows the top block body");
	view.handleInput("\x0a");
	assert.match(stripAnsi(view.render(80)[2]), /│   l3 +│$/, "ctrl+j scrolls one page down across the labeled block");
	view.handleInput("\x0b");
	assert.match(stripAnsi(view.render(80)[2]), /│ Text +│$/, "ctrl+k scrolls one page up to the labeled block");
	assert.match(stripAnsi(view.render(80)[3]), /│   l0 +│$/, "ctrl+k restores the top block body");
	view.handleInput("f");
	assert.match(stripAnsi(view.render(80)[2]), /│   l9 +│$/, "f follows the tail again");
	view.handleInput("\x1b");
	assert.deepEqual(events, ["cancel:a", "open:a", "close"]);
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

	assert.equal(view.handleMouse(mouse(4, 3, 80, lines.length))?.handled, true, "hover consumes only the task row");
	assert.equal(view.selectedTask()?.id, "a", "hover never changes keyboard selection or the displayed thread");
	assert.equal(view.handleMouse(mouse(4, 3, 80, lines.length, "click"))?.handled, true);
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

test("AgentsView retains narrow keyboard mode after selection and store invalidation", () => {
	const { store, view, events } = harness(6);
	store.add(task("a"));
	store.add(task("b", { agent: "b" }));
	for (let index = 0; index < 3; index += 1) store.apply("b", { type: TASK_EVENT.TEXT, text: `thread ${index}\n` }, 2000);
	const frame = view.render(40);
	assert.equal(view.handleMouse(mouse(4, 3, 40, frame.length, "click"))?.handled, true, "pointer selection invalidates hit bounds");
	view.handleInput("\t");
	assert.match(view.render(40).map(stripAnsi).join("\n"), /thread 2/, "Tab still enters Details before a pointer-invalidating selection rerenders");
	view.handleInput("\t");
	view.handleInput("\t");
	assert.match(view.render(40).map(stripAnsi).join("\n"), /thread 2/, "repeated Tab toggles semantically before a frame");
	view.handleInput("\t");
	store.apply("b", { type: TASK_EVENT.TEXT, text: "after update\n" }, 2000);
	view.handleInput("\t");
	assert.match(view.render(40).map(stripAnsi).join("\n"), /after update/, "a selected-task update does not discard narrow keyboard knowledge");
	view.handleInput("k");
	view.handleInput("k");
	view.handleInput("\t");
	assert.equal(view.selectedTask(), undefined, "Tab remains inert for a heading");
	view.handleInput("\x1b[D");
	view.handleInput("\x1b[C");
	view.handleInput("j");
	assert.ok(view.selectedTask(), "heading Left/Right keeps its existing group behavior");
	assert.deepEqual(events, [], "Tab never opens the editor");
	view.dispose();
});

test("AgentsView uses a narrow List/Details viewport without changing task, group, editor, or close semantics", () => {
	const { store, view, events } = harness(6);
	store.add(task("a"));
	store.add(task("b", { agent: "b" }));
	for (let index = 0; index < 8; index += 1) store.apply("b", { type: TASK_EVENT.TEXT, text: `thread ${index}\n` }, 2000);
	let frame = view.render(40);
	let top = stripAnsi(frame[0] ?? "");
	assert.match(top, /\[Details\].*\[×\]/, "narrow headers expose Details and compact Close when both fit");
	assert.equal(view.handleMouse(mouse(4, 3, 40, frame.length, "click"))?.handled, true);
	assert.equal(view.selectedTask()?.id, "b", "a narrow task click selects only");
	assert.deepEqual(events, [], "selecting never opens or stops a task");
	frame = view.render(40);
	top = stripAnsi(frame[0] ?? "");
	const detailsX = visibleWidth(top.slice(0, top.indexOf("[Details]")));
	assert.equal(view.handleMouse(mouse(detailsX, 0, 40, frame.length, "click"))?.handled, true);
	assert.equal(view.handleMouse(mouse(detailsX, 0, 40, frame.length, "click")), undefined, "a mode change invalidates old pointer bounds before render");
	frame = view.render(40);
	top = stripAnsi(frame[0] ?? "");
	assert.match(top, /\[← Back\]/);
	assert.match(frame.map(stripAnsi).join("\n"), /thread 7/, "Details is the local thread viewport");
	assert.equal(view.handleMouse(mouse(4, 2, 40, frame.length, "wheel", -1))?.handled, true, "the detail viewport owns its wheel");
	const backX = visibleWidth(top.slice(0, top.indexOf("[← Back]")));
	assert.equal(view.handleMouse(mouse(backX, 0, 40, frame.length, "click"))?.handled, true, "Back is an explicit pointer control");
	assert.match(view.render(40).map(stripAnsi).join("\n"), /Subagent b/, "Back restores the local List viewport");
	view.handleInput("\t");
	assert.match(view.render(40).map(stripAnsi).join("\n"), /thread 7/, "Tab enters Details only for a selected task");
	view.handleInput("\t");
	assert.match(view.render(40).map(stripAnsi).join("\n"), /Subagent b/, "Tab returns to List");
	view.handleInput("\t");
	view.handleInput("k");
	view.handleInput("k");
	assert.equal(view.selectedTask(), undefined, "selecting a heading clears detail state");
	view.handleInput("\t");
	assert.doesNotMatch(stripAnsi(view.render(40)[0] ?? ""), /\[← Back\]/, "headings keep Tab and Details inert");
	view.handleInput("\x1b[D");
	view.handleInput("\x1b[C");
	view.handleInput("j");
	view.handleInput("\x0d");
	view.handleInput("o");
	assert.deepEqual(events, ["open:a", "open:a"], "Enter and o keep their editor action");
	assert.equal(view.render(11).length, 1, "width below 12 uses the control-free fallback");
	assert.equal(view.handleMouse(mouse(0, 0, 11, 1)), undefined);
	view.handleInput("\x1b");
	view.handleInput("q");
	assert.deepEqual(events, ["open:a", "open:a", "close"], "Escape and q close once without cancelling");
	view.dispose();
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
	dispatch(mouse(4, 3, 80, lines.length));
	assert.match(stripAnsi(view.render(80)[3]), /▹/, "the hovered row is styled without changing selection");
	dispatch(mouse(4, 3, 80, lines.length, "wheel", -1));
	assert.match(stripAnsi(view.render(80)[3]), /▹/, "a list wheel event at its boundary preserves hover");
	dispatch(mouse(4, 3, 80, lines.length, "wheel", 1));
	assert.doesNotMatch(stripAnsi(view.render(80).join("\n")), /▹/, "list scrolling clears hover so it cannot remain on the task formerly under the pointer");
	dispatch(mouse(4, 3, 80, lines.length));
	dispatch(mouse(50, 3, 80, lines.length));
	assert.doesNotMatch(stripAnsi(view.render(80)[3]), /▹/, "the root observer clears hover outside a child region");
	dispatch(mouse(4, 3, 80, lines.length));
	view.render(81);
	assert.doesNotMatch(stripAnsi(view.render(81)[3]), /▹/, "resize clears hover before the next frame");
	dispatch(mouse(4, 3, 81, lines.length));
	store.apply("a", { type: TASK_EVENT.TEXT, text: "update" }, 2000);
	assert.doesNotMatch(stripAnsi(view.render(81)[3]), /▹/, "task updates clear the actual hovered task row");
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

test("AgentsView close control, Escape, and q share rendered bounds and one idempotent close", () => {
	const { store, view, events } = harness(8);
	store.add(task("active"));
	const wide = 80;
	let lines = view.render(wide);
	let top = stripAnsi(lines[0]);
	assert.equal(visibleWidth(top), wide, "the full close header fits its rendered width");
	assert.match(top, /\[× Close\]/, "wide headers show the labelled close control");
	let closeX = visibleWidth(top.slice(0, top.indexOf("[× Close]")));
	assert.equal(view.handleMouse(mouse(closeX, 0, wide, lines.length))?.render, true, "hover targets only the rendered close bounds");
	assert.equal(view.selectedTask()?.id, "active", "close hover never changes task selection");
	assert.equal(view.handleMouse(mouse(closeX, 0, wide, lines.length, "press")), undefined, "press is inert");
	assert.equal(view.handleMouse({ ...mouse(closeX, 0, wide, lines.length, "click"), button: "right" }), undefined, "right click is inert");
	assert.equal(view.handleMouse({ ...mouse(closeX, 0, wide, lines.length, "click"), button: "middle" }), undefined, "middle click is inert");
	assert.equal(view.handleMouse(mouse(closeX, 0, wide + 1, lines.length, "click")), undefined, "stale width is inert");
	assert.equal(view.handleMouse(mouse(closeX, 0, wide, lines.length + 1, "click")), undefined, "stale height is inert");

	lines = view.render(59);
	top = stripAnsi(lines[0]);
	assert.equal(visibleWidth(top), 59, "the narrow header fits its rendered width");
	assert.match(top, /\[Details\].*\[×\]/, "width 59 uses its narrow mode controls instead of the fallback");
	assert.doesNotMatch(top, /Follow|Open session/, "narrow mode keeps footer controls out when they do not fit");

	lines = view.render(wide);
	top = stripAnsi(lines[0]);
	closeX = visibleWidth(top.slice(0, top.indexOf("[× Close]")));
	assert.equal(view.handleMouse(mouse(closeX, 0, wide, lines.length, "click"))?.handled, true);
	view.handleInput("\x1b");
	view.handleInput("q");
	assert.deepEqual(events, ["close"], "pointer and close keys share one idempotent close action without cancelling");
	assert.equal(view.handleMouse(mouse(closeX, 0, wide, lines.length, "click")), undefined, "late pointer events are inert after close");
	const { store: keyStore, view: keyView, events: keyEvents } = harness(8);
	keyStore.add(task("key-close"));
	keyView.handleInput("\x1b");
	keyView.handleInput("q");
	assert.deepEqual(keyEvents, ["close"], "Escape and q themselves close only once");
	keyView.dispose();
	view.dispose();
	assert.equal(view.handleMouse(mouse(closeX, 0, wide, lines.length)), undefined, "disposed close controls stay inert");
});

test("AgentsView scrolls the task list so the selection stays visible when there are more tasks than rows", () => {
	const { store, view } = harness(6);
	for (let index = 0; index < 6; index += 1) store.add(task(`t${index}`, { agent: `agent${index}`, createdAt: 1000 - index, lastActivityAt: 1000 - index }));
	const listed = () => view.render(80).slice(1, 4).map((line) => stripAnsi(line).slice(0, 24));
	assert.match(listed()[0], /Orchestrator s/);
	assert.match(listed()[1], /▸ └ ◐ Subagent agent0/);
	assert.match(listed()[2], /Subagent agent1/);
	for (let index = 0; index < 4; index += 1) view.handleInput("j");
	assert.equal(view.selectedTask()?.id, "t4");
	assert.match(listed()[2], /▸ └ ◐ Subagent agent4/, "the list scrolls down until the selection is the last visible row");
	assert.match(listed()[0], /Subagent agent2/);
	view.handleInput("j");
	view.handleInput("j");
	assert.equal(view.selectedTask()?.id, "t5", "the selection stops at the last task");
	assert.match(listed()[2], /▸ └ ◐ Subagent agent5/);
	for (let index = 0; index < 4; index += 1) view.handleInput("k");
	assert.match(listed()[0], /▸ └ ◐ Subagent agent1/, "moving up scrolls the list back");
	assert.match(listed()[2], /Subagent agent3/);
});

test("AgentsView lists the active session's recent tasks by default and a toggles every session", () => {
	const { store, view } = harness(12, "s");
	store.add(task("mine", { agent: "mine" }));
	store.add(task("theirs", { agent: "theirs", parentSessionId: "other", createdAt: 900, lastActivityAt: 900 }));
	store.add(task("fresh", { agent: "fresh", status: TASK_STATUS.COMPLETED, endedAt: 61_000 - 60_000, createdAt: 850, lastActivityAt: 850 }));
	store.add(task("stale", { agent: "stale", status: TASK_STATUS.COMPLETED, endedAt: 61_000 - 16 * 60_000, createdAt: 800, lastActivityAt: 800 }));
	const names = () => view.render(80).map(stripAnsi).filter((line) => /[◐✓] Subagent /.test(line)).map((line) => line.match(/[◐✓] Subagent (\w+)/)?.[1]);
	let plain = view.render(80).map(stripAnsi);
	assert.match(plain[0], /^╭─ ❀ Agents · this session · 1 active · 1 finished ─+ \[× Close\]╮$/);
	assert.deepEqual(names(), ["mine", "fresh"], "another session's task and one finished over fifteen minutes ago stay out");
	assert.match(plain.at(-2) ?? "", /a all sessions/);
	view.handleInput("a");
	plain = view.render(80).map(stripAnsi);
	assert.match(plain[0], /^╭─ ❀ Agents · all sessions · 2 active · 2 finished ─+ \[× Close\]╮$/);
	assert.deepEqual(names(), ["mine", "fresh", "stale", "theirs"], "children stay beneath their actual parent-session heading");
	assert.match(plain.at(-2) ?? "", /a this session/);
	view.handleInput("j");
	assert.equal(view.selectedTask()?.id, "fresh", "child-first navigation stays within the current orchestrator group");
	view.handleInput("a");
	assert.equal(view.selectedTask()?.id, "mine", "a new scope reads from the top");
	assert.deepEqual(names(), ["mine", "fresh"]);
});

test("AgentsView footer buttons follow, open only a session-backed selection, and clear stale geometry", () => {
	const { store, view, events } = harness(8, "s");
	store.add(task("a", { sessionPath: "/sessions/a.jsonl" }));
	for (let index = 0; index < 12; index += 1) store.apply("a", { type: TASK_EVENT.TEXT, text: `line ${index}\n` }, 2000);
	const width = 160;
	const lines = view.render(width);
	const footerY = lines.length - 2;
	const followX = 131;
	const openX = 142;
	assert.match(stripAnsi(lines.at(-2) ?? ""), /\[ Follow \].*\[ Open session \]/, "buttons render only after the full key-hint row fits");

	view.handleInput("\x1b[5~");
	assert.match(stripAnsi(view.render(width)[2]), /line 5/, "page up leaves follow mode before the button restores it");
	assert.equal(view.handleMouse(mouse(followX, footerY, width, lines.length))?.render, true, "button hover requests a distinct frame");
	assert.equal(view.handleMouse(mouse(followX, footerY, width, lines.length, "press")), undefined, "press is inert");
	assert.equal(view.handleMouse({ ...mouse(followX, footerY, width, lines.length, "click"), button: "right" }), undefined, "right click is inert");
	assert.equal(view.handleMouse({ ...mouse(followX, footerY, width, lines.length, "click"), button: "middle" }), undefined, "middle click is inert");
	assert.equal(view.handleMouse(mouse(followX, footerY, width, lines.length, "click"))?.handled, true);
	assert.match(stripAnsi(view.render(width)[2]), /line 9/, "Follow returns the selected thread to its tail");
	assert.equal(view.handleMouse(mouse(openX, footerY, width, lines.length, "click"))?.handled, true);
	assert.deepEqual(events, ["open:a"], "Open delegates the selected task to the existing callback");
	assert.equal(view.handleMouse(mouse(followX, footerY, width + 1, lines.length, "click")), undefined, "a pre-render resize makes the prior footer geometry inert");

	store.update("a", { sessionPath: null });
	view.render(width);
	assert.equal(view.handleMouse(mouse(openX, footerY, width, lines.length, "click")), undefined, "Open is disabled when the selected task loses its session path");
	assert.deepEqual(events, ["open:a"]);
	view.render(200);
	assert.equal(view.handleMouse(mouse(followX, footerY, 200, lines.length, "click")), undefined, "resize discards the old footer geometry before routing clicks");
	assert.doesNotMatch(stripAnsi(view.render(44).at(-2) ?? ""), /\[ Follow \]|\[ Open session \]/, "buttons hide instead of truncating when the rendered key hints do not fit");
	view.handleInput("a");
	assert.equal(view.handleMouse(mouse(followX, footerY, width, lines.length, "click")), undefined, "a scope change clears old footer geometry until the next frame");
	view.dispose();
	assert.equal(view.handleMouse(mouse(followX, footerY, width, lines.length, "click")), undefined, "disposed footer controls stay inert");
	const { view: empty } = harness(8, "s");
	const emptyLines = empty.render(width);
	assert.equal(empty.handleMouse(mouse(followX, footerY, width, emptyLines.length, "click")), undefined, "Follow is disabled with no selected task");
	assert.equal(empty.handleMouse(mouse(openX, footerY, width, emptyLines.length, "click")), undefined, "Open is disabled with no selected session");
	empty.dispose();
});

test("AgentsView reads live rows, preserves manual scroll and selection, and invalidates stale pointer bounds", () => {
	const store = new TaskStore();
	let rows = 8;
	const view = new AgentsView({
		theme: plainTheme,
		rows: () => rows,
		store,
		sessionId: "s",
		now: () => 61_000,
		onCancel() {},
		onOpen() {},
		onClose() {},
		requestRender() {},
	});
	for (let index = 0; index < 6; index += 1) store.add(task(`t${index}`, { agent: `agent${index}`, createdAt: 1000 - index, lastActivityAt: 1000 - index }));
	for (let index = 0; index < 10; index += 1) store.apply("t4", { type: TASK_EVENT.TEXT, text: `line ${index}\n` }, 2000);
	for (let index = 0; index < 4; index += 1) view.handleInput("j");
	view.render(80);
	view.handleInput("\x1b[5~");
	rows = 6;
	const resized = view.render(80).map(stripAnsi);
	assert.equal(resized.length, 6, "the frame uses the live terminal height budget");
	assert.equal(view.selectedTask()?.id, "t4", "resize never changes the selected task");
	assert.match(resized[3] ?? "", /▸ └ ◐ Subagent agent4/, "the list scroll clamps while retaining the selected row");
	assert.doesNotMatch(resized.join("\n"), /line 9/, "manual thread scroll survives resize instead of returning to the tail");
	assert.equal(view.handleMouse(mouse(4, 2, 80, 8, "click")), undefined, "old-height pointer input is stale after resize");
	view.render(40);
	view.handleInput("\t");
	const narrow = view.render(40).map(stripAnsi);
	rows = 5;
	const narrower = view.render(40).map(stripAnsi);
	assert.equal(view.selectedTask()?.id, "t4", "a narrow resize retains the selection");
	assert.doesNotMatch(narrow.join("\n"), /line 9/);
	assert.doesNotMatch(narrower.join("\n"), /line 9/, "a narrow resize preserves manual detail scrolling");
	rows = 2;
	assert.equal(view.render(80).length, 1, "a tiny terminal gets one bounded fallback line, never forced chrome");
	view.dispose();
});

test("AgentsView rejects cached-height pointer input before the live resize renders", () => {
	const store = new TaskStore();
	let rows = 8;
	const view = new AgentsView({
		theme: plainTheme,
		rows: () => rows,
		store,
		now: () => 61_000,
		onCancel() {},
		onOpen() {},
		onClose() {},
		requestRender() {},
	});
	store.add(task("a"));
	for (let index = 0; index < 12; index += 1) store.apply("a", { type: TASK_EVENT.TEXT, text: `l${index}\n` }, 2000);
	view.handleInput("\x1b[5~");
	const oldFrame = view.render(80);
	assert.match(stripAnsi(oldFrame[3] ?? ""), /l0/, "manual scrolling establishes a stable pre-resize position");
	rows = 6;
	assert.equal(view.handleMouse(mouse(50, 2, 80, oldFrame.length, "wheel", 1)), undefined, "old-height wheel input is inert before the resize frame");
	const resized = view.render(80);
	assert.match(stripAnsi(resized[3] ?? ""), /l0/, "the stale wheel leaves manual thread scroll unchanged");
	assert.equal(view.handleMouse(mouse(50, 2, 80, resized.length, "wheel", 1))?.handled, true, "the new-height wheel reaches the rendered thread region");
	assert.match(stripAnsi(view.render(80)[2] ?? ""), /l0/, "the live wheel scrolls past the semantic block label after the new frame");
	view.dispose();
});
