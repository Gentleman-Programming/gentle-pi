import assert from "node:assert/strict";
import test from "node:test";
import { type TuiMouseEvent } from "@earendil-works/pi-tui";
import { TASK_STATUS, TaskStore, type TaskRecord } from "../lib/agents-protocol.ts";
import { AgentsView, SESSION_FINISHED_TTL_MS } from "../lib/agents-view.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

const plainTheme = { fg: (_color: string, text: string) => text };

function task(id: string, parentSessionId: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id,
		agent: "worker",
		mode: "task",
		prompt: "p",
		label: "p",
		cwd: "/r",
		parentSessionId,
		status: TASK_STATUS.RUNNING,
		createdAt: 1000,
		startedAt: 1000,
		endedAt: null,
		model: "gpt",
		thinking: undefined,
		sessionPath: "/sessions/child.jsonl",
		error: null,
		result: null,
		lastStep: "working",
		lastActivityAt: 1000,
		turns: 0,
		toolCalls: 0,
		tokens: 0,
		cost: 0,
		...overrides,
	};
}

function harness(rows = 12, now = () => 10_000) {
	const store = new TaskStore();
	const view = new AgentsView({
		theme: plainTheme,
		rows,
		store,
		sessionId: "current-session-id",
		now,
		onCancel: () => {},
		onOpen: () => {},
		onClose: () => {},
		requestRender: () => {},
	});
	return { store, view };
}

function mouse(x: number, y: number, width: number, height: number, type: TuiMouseEvent["type"] = "move"): TuiMouseEvent {
	return { type, button: type === "move" ? "none" : "left", x, y, screenX: x, screenY: y, width, height, shift: false, alt: false, ctrl: false };
}

test("AgentsView shows direct current children and groups only open orchestrators in the directory", () => {
	const { store, view } = harness();
	store.add(task("current", "current-session-id", { agent: "current-worker" }));
	store.add(task("other", "other-session-123456", { agent: "other-worker" }));

	const plain = view.render(100).map(stripAnsi).join("\n");
	assert.doesNotMatch(plain, /Current orchestrator/);
	assert.match(plain, /Subagent current-worker/);
	assert.doesNotMatch(plain, /other-worker/, "the default scope excludes another parent session");
	view.handleInput("a");
	assert.doesNotMatch(view.render(100).map(stripAnsi).join("\n"), /Orchestrator other-se/);
	assert.match(view.render(100).join("\n"), /Current orchestrator/);
	view.dispose();
});

test("AgentsView never infers unknown open sessions and keeps manual directory expansion", () => {
	const { store, view } = harness();
	store.add(task("current", "current-session-id", { lastActivityAt: 500 }));
	store.add(task("other", "other-session-123456", { lastActivityAt: 400 }));
	store.add(task("unknown-active", "", { agent: "unknown-active", lastActivityAt: 300 }));
	store.add(task("unknown-terminal", "", { agent: "unknown-terminal", status: TASK_STATUS.COMPLETED, endedAt: 9000, lastActivityAt: 200 }));
	view.handleInput("a");

	let lines = view.render(100);
	let plain = lines.map(stripAnsi).join("\n");
	assert.doesNotMatch(plain, /Unknown session|unknown-active|other-worker/, "retained origins are not presence evidence");
	assert.doesNotMatch(plain, /unknown-terminal/, "a terminal-only group starts collapsed");
	const terminalHeading = lines.map(stripAnsi).findIndex((line) => /Current orchestrator/.test(line));
	assert.equal(view.handleMouse(mouse(4, terminalHeading, 100, lines.length, "click"))?.handled, true, "left click toggles a heading");
	assert.doesNotMatch(view.render(100).map(stripAnsi).join("\n"), /Subagent worker/, "click collapses the local directory group");
	store.update("unknown-terminal", { status: TASK_STATUS.FAILED });
	assert.doesNotMatch(view.render(100).map(stripAnsi).join("\n"), /Subagent worker/, "manual collapse persists across unrelated updates");
	view.handleMouse(mouse(4, terminalHeading, 100, lines.length, "click"));
	store.update("unknown-terminal", { status: TASK_STATUS.CANCELLED });
	assert.match(view.render(100).map(stripAnsi).join("\n"), /Subagent worker/, "manual expansion persists across unrelated updates");
	assert.doesNotMatch(view.render(100).join("\n"), /unknown-termina/, "unknown terminal history remains excluded");
	view.dispose();
});

test("AgentsView keeps headings non-actionable and clears a hidden selected child thread", () => {
	const { store, view } = harness();
	store.add(task("first", "current-session-id", { createdAt: 2000, lastActivityAt: 200 }));
	store.add(task("child", "current-session-id", { lastActivityAt: 100 }));
	assert.equal(view.selectedTask()?.id, "first", "the first visible child starts selected");
	view.handleInput("a");
	view.handleInput("k");
	view.handleInput("\x1b[D");
	assert.equal(view.selectedTask(), undefined, "collapsing selects the heading instead of a hidden child");
	assert.match(view.render(100).map(stripAnsi).join("\n"), /Select a task to inspect its thread/);
	view.handleInput("\x1b[C");
	assert.equal(view.selectedTask(), undefined, "expanding preserves heading focus until a child is selected");
	view.handleInput("s");
	view.handleInput("o");
	view.dispose();
});

test("AgentsView removes terminal children immediately without deleting retained threads", () => {
	let now = 10_000;
	const { store, view } = harness(12, () => now);
	store.add(task("live", "current-session-id", { agent: "retained" }));
	store.add(task("other", "other-session", { agent: "excluded" }));
	store.apply("live", { type: "text", text: "kept thread" }, now);
	store.update("live", { status: TASK_STATUS.COMPLETED, endedAt: now });
	for (const elapsed of [0, SESSION_FINISHED_TTL_MS - 1]) {
		now = 10_000 + elapsed;
		const output = view.render(100).map(stripAnsi).join("\n");
		assert.doesNotMatch(output, /Subagent retained|kept thread/);
		assert.equal(store.thread("live").items.length, 1, "retained thread remains available outside the panel");
		assert.doesNotMatch(output, /excluded/);
		assert.equal(view.selectedTask(), undefined);
	}
	now = 10_000 + SESSION_FINISHED_TTL_MS;
	assert.doesNotMatch(view.render(100).join("\n"), /Subagent retained/);
	assert.equal(view.selectedTask(), undefined);
	store.add(task("archive", "current-session-id", { agent: "archived", status: TASK_STATUS.COMPLETED, endedAt: now }));
	assert.doesNotMatch(view.render(100).join("\n"), /Subagent archived/, "absent groups lose implicit expansion");
	view.dispose();
});

test("AgentsView retains an idle open heading and explicit collapse after the final child finishes", () => {
	const { store, view } = harness();
	store.add(task("live", "current-session-id", { agent: "hidden" }));
	view.handleInput("a");
	view.render(100);
	view.handleInput("k");
	view.handleInput("\x1b[D");
	store.update("live", { status: TASK_STATUS.COMPLETED, endedAt: 10_000 });
	assert.doesNotMatch(view.render(100).join("\n"), /Subagent hidden/);
	view.handleInput("\x1b[C");
	assert.doesNotMatch(view.render(100).join("\n"), /Subagent hidden/);
	assert.match(view.render(100).join("\n"), /Current orchestrator.*0/);
	store.add(task("replacement", "current-session-id", { agent: "replacement" }));
	assert.match(view.render(100).join("\n"), /Subagent replacement/);
	view.dispose();
});

test("AgentsView orders children by creation then ID, not renewed activity", () => {
	const { store, view } = harness();
	store.add(task("old", "current-session-id", { agent: "old", createdAt: 100 }));
	store.add(task("b", "current-session-id", { agent: "new-b", createdAt: 200 }));
	store.add(task("a", "current-session-id", { agent: "new-a", createdAt: 200 }));
	store.update("old", { lastActivityAt: 20_000 });
	const output = view.render(100).join("\n");
	assert.ok(output.indexOf("Subagent new-a") < output.indexOf("Subagent new-b"));
	assert.ok(output.indexOf("Subagent new-b") < output.indexOf("Subagent old"));
	assert.equal(view.selectedTask()?.id, "old", "reordering preserves selection");
	view.dispose();
});

test("AgentsView keeps its selected listener stable while another listener receives a stream update", () => {
	const { store, view } = harness();
	store.add(task("stream", "current-session-id"));
	let notifications = 0;
	const unsubscribe = store.subscribe("stream", () => {
		notifications += 1;
		if (notifications > 1) throw new Error("selected listener was re-added during notification");
	});
	store.apply("stream", { type: "text", text: "one" }, 2000);
	assert.equal(notifications, 1, "a live listener set never revisits the same streaming update");
	unsubscribe();
	view.dispose();
});
