import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TASK_STATUS, type TaskRecord } from "../lib/agents-protocol.ts";
import { formatElapsed, renderAgentsCard, widgetTasks } from "../lib/agents-widget.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

// Gentle Agents widget: the card above the editor that shows what the
// subagents are doing, drawn from task records only (never from threads).
// Layout: glyph, agent, task summary (wrapped), then model · tokens · cost · time.

const plainTheme = { fg: (_color: string, text: string) => text };

function task(overrides: Partial<TaskRecord>): TaskRecord {
	return { id: "t", agent: "sdd-explore", mode: "task", prompt: "map footer data sources", label: "map footer data sources", cwd: "/r", parentSessionId: "s", status: TASK_STATUS.RUNNING, createdAt: 1000, startedAt: 1000, endedAt: null, model: "anthropic/claude-sonnet-5", thinking: undefined, sessionPath: null, error: null, result: null, lastStep: "grep", lastActivityAt: 1000, turns: 0, toolCalls: 0, tokens: 34_000, cost: 0.27, ...overrides };
}

test("formatElapsed renders seconds, minutes, and hours compactly", () => {
	assert.equal(formatElapsed(4_000), "4s");
	assert.equal(formatElapsed(65_000), "1m05s");
	assert.equal(formatElapsed(3_720_000), "1h02m");
	assert.equal(formatElapsed(-5), "0s");
});

test("widgetTasks keeps active tasks in start order and only recently finished ones", () => {
	const tasks = [
		task({ id: "old-done", status: TASK_STATUS.COMPLETED, endedAt: 10_000 }),
		task({ id: "new-done", status: TASK_STATUS.FAILED, endedAt: 95_000 }),
		task({ id: "queued", status: TASK_STATUS.QUEUED, createdAt: 3000, startedAt: null }),
		task({ id: "running", createdAt: 2000, startedAt: 2000 }),
	];
	assert.deepEqual(widgetTasks(tasks, 100_000).map((entry) => entry.id), ["new-done", "running", "queued"]);
	assert.deepEqual(widgetTasks([], 100_000), []);
});

test("renderAgentsCard draws columns for agent, task, and model · tokens · cost · time, with the batch time in the rule", () => {
	const tasks = [
		task({ id: "a", status: TASK_STATUS.COMPLETED, startedAt: 1000, endedAt: 26_000 }),
		task({ id: "b", agent: "sdd-apply", label: "write gentle-shell footer", startedAt: 44_000, tokens: 12_000, cost: 0.09 }),
	];
	const lines = renderAgentsCard(tasks, plainTheme, 84, 85_000, { collapsed: false });
	for (const line of lines) assert.equal(visibleWidth(line), 84, `"${stripAnsi(line)}" is not 84 wide`);
	const plain = lines.map(stripAnsi);
	assert.match(plain[0], /^╭─ ❀ Agents · 1 active · 1 done ─+ 1m24s ╮$/);
	assert.match(plain[1], /^│ ✓  sdd-explore  map footer data sources +claude-sonnet-5 · 34k · \$0\.27 · 25s │$/);
	assert.match(plain[2], /^│ ◐  sdd-apply    write gentle-shell footer +claude-sonnet-5 · 12k · \$0\.09 · 41s │$/);
	assert.match(plain[3], /^╰─+╯$/);
	assert.deepEqual(renderAgentsCard([], plainTheme, 60, 0, { collapsed: false }), []);
});

test("renderAgentsCard keeps every task on one line, clipping long labels, and drops the task column when the card is narrow", () => {
	const tasks = [task({ id: "a", label: "write the gentle shell footer and all of its tests before lunch" })];
	const wide = renderAgentsCard(tasks, plainTheme, 84, 5_000, { collapsed: false }).map(stripAnsi);
	assert.equal(wide.length, 3);
	assert.match(wide[1], /^│ ◐  sdd-explore  write the gentle shell foot… +claude-sonnet-5 · 34k · \$0\.27 · 4s │$/);
	const narrow = renderAgentsCard(tasks, plainTheme, 44, 5_000, { collapsed: false }).map(stripAnsi);
	assert.equal(narrow.length, 3);
	assert.match(narrow[1], /^│ ◐  sdd-explore +34k · \$0\.27 · 4s │$/);
});

test("renderAgentsCard shows questions and failures in place of the task, and collapses to the first row", () => {
	const tasks = [
		task({ id: "a", status: TASK_STATUS.WAITING, lastStep: "asked: Delete?", tokens: 0, cost: 0 }),
		task({ id: "b", status: TASK_STATUS.FAILED, endedAt: 2000, error: "pi exited with code 1", lastStep: "pi exited with code 1" }),
		task({ id: "c", status: TASK_STATUS.QUEUED, createdAt: 1500, startedAt: null, tokens: 0, cost: 0 }),
	];
	const plain = renderAgentsCard(tasks, plainTheme, 80, 3000, { collapsed: false }).map(stripAnsi);
	assert.match(plain[0], /^╭─ ❀ Agents · 1 waiting · 1 queued · 1 failed ─+ 2s ╮$/);
	assert.match(plain[1], /^│ \?  sdd-explore  asked: Delete\? +claude-sonnet-5 · 2s │$/);
	assert.match(plain[2], /^│ ✗  sdd-explore  pi exited with code 1 +claude-sonnet-5 · 34k · \$0\.27 · 1s │$/);
	assert.match(plain[3], /^│ ○  sdd-explore  map footer data sources +queued │$/);
	const collapsed = renderAgentsCard(tasks, plainTheme, 80, 3000, { collapsed: true, collapseKey: "ctrl+shift+a" }).map(stripAnsi);
	assert.equal(collapsed.length, 3);
	assert.match(collapsed[0], /ctrl\+shift\+a expand ╮$/);
	assert.match(collapsed[1], /^│ \?  sdd-explore  asked: Delete\?/);
});
