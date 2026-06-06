import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

function writeMarkdown(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

test("agent discovery skips skills directories", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dotAgents = join(root, ".agents");
	writeMarkdown(join(dotAgents, "reviewer.md"), "name: reviewer\n");
	writeMarkdown(join(dotAgents, "team", "worker.md"), "name: worker\n");
	writeMarkdown(join(dotAgents, "skills", "ai-sdk", "SKILL.md"), "name: ai-sdk\n");
	writeMarkdown(
		join(dotAgents, "skills", "ai-sdk", "references", "evaluation.md"),
		"name: Prompt Evaluation\n",
	);

	const syncAgents = __testing.listAgentsFromDir(dotAgents, "user");
	const asyncAgents = await __testing.listAgentsFromDirAsync(dotAgents, "user");

	assert.deepEqual(
		syncAgents.map((agent) => agent.name),
		["reviewer", "worker"],
	);
	assert.deepEqual(
		asyncAgents.map((agent) => agent.name),
		["reviewer", "worker"],
	);
});

test("orchestrator prompt refreshes from disk on each access", (t) => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gentle-pi-orchestrator-"));
	t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
	const promptFile = join(tmpDir, "orchestrator.md");

	// Write initial content
	writeFileSync(promptFile, "First version");
	const first = __testing.getOrchestratorPrompt(promptFile);
	assert.equal(first, "First version");

	// Update the file
	writeFileSync(promptFile, "Updated version");
	const second = __testing.getOrchestratorPrompt(promptFile);
	assert.equal(second, "Updated version");

	// Change it again to prove freshness on each call
	writeFileSync(promptFile, "Third version");
	const third = __testing.getOrchestratorPrompt(promptFile);
	assert.equal(third, "Third version");
});

test("orchestrator prompt returns empty string when file is missing", (t) => {
	// Build a deterministic, cross-platform missing path: the dir exists, the child does not.
	const tmpDir = mkdtempSync(join(tmpdir(), "gentle-pi-missing-"));
	t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
	const missingPath = join(tmpDir, "orchestrator.md");
	const result = __testing.getOrchestratorPrompt(missingPath);
	// Should not throw, should return empty string instead
	assert.equal(result, "");
});

test("context event handler builds reminder message", () => {
	const original: typeof __testing.buildContextReminder = (...args) => {
		throw new Error("Not implemented");
	};
	const reminder = __testing.buildContextReminder();
	assert.equal(reminder.role, "custom");
	assert.equal(reminder.customType, "gentle-harness-reminder");
	assert.equal(typeof reminder.content, "string");
	assert.equal(reminder.display, false);
	assert.equal(typeof reminder.timestamp, "number");
	assert(reminder.content.includes("Active discipline"));
	assert(reminder.content.includes("el Gentleman harness"));
	assert(reminder.content.includes("Keep the parent session as orchestrator"));
});

test("applyHarnessReminder appends reminder to messages without mutation", () => {
	const messages: typeof __testing.buildContextReminder[] = [];
	const result = __testing.applyHarnessReminder(messages);
	assert.notEqual(result, messages, "should return new array");
	assert.equal(messages.length, 0, "original should not be mutated");
	assert.equal(result.length, 1, "result should have one message");
	assert.equal(result[0].customType, "gentle-harness-reminder");
});

test("applyHarnessReminder deduplicates reminder messages", () => {
	const reminder = __testing.buildContextReminder();
	const messages = [
		{ role: "user", content: "hello" },
		reminder,
	];
	const result = __testing.applyHarnessReminder(messages);
	assert.equal(result.length, 2, "should not double-append duplicate reminder");
	assert.equal(result[result.length - 1].customType, "gentle-harness-reminder");
	// Verify only one reminder exists (dedup strips old and appends fresh)
	const reminderCount = result.filter((m: any) => m.customType === "gentle-harness-reminder").length;
	assert.equal(reminderCount, 1, "should have exactly one reminder");
});

test("applyHarnessReminder removes reminder from middle of message array", () => {
	const reminder = __testing.buildContextReminder();
	// Simulate scenario where reminder is not in last position
	const messages = [
		{ role: "user", content: "message 1" },
		reminder,
		{ role: "assistant", content: "response" },
	];
	const result = __testing.applyHarnessReminder(messages);
	// Original: 3 messages (user, old reminder, assistant)
	// After dedup: 3 messages (user, assistant, new reminder)
	assert.equal(result.length, 3, "should maintain message count");
	// Verify only one reminder and it is at the end
	const reminderCount = result.filter((m: any) => m.customType === "gentle-harness-reminder").length;
	assert.equal(reminderCount, 1, "should have exactly one reminder after dedup");
	assert.equal(result[result.length - 1].customType, "gentle-harness-reminder", "reminder should be last");
	assert.equal(result[0].role, "user", "first message should be user");
	assert.equal(result[1].role, "assistant", "second message should be assistant");
});

test("applyHarnessReminder handles empty messages", () => {
	const messages: typeof __testing.buildContextReminder[] = [];
	const result = __testing.applyHarnessReminder(messages);
	assert.equal(result.length, 1);
	assert.equal(result[0].customType, "gentle-harness-reminder");
});

test("applyHarnessReminder appends reminder as last message", () => {
	const messages = [
		{ role: "user", content: "message 1" },
		{ role: "user", content: "message 2" },
	];
	const result = __testing.applyHarnessReminder(messages);
	assert.equal(result[result.length - 1].customType, "gentle-harness-reminder");
	assert.equal(result.length, 3);
});

test("buildContextReminder with compaction pending includes post-compaction block", () => {
	__testing.setCompactionPending(true);
	const reminder = __testing.buildContextReminder();
	assert.equal(reminder.role, "custom");
	assert.equal(reminder.customType, "gentle-harness-reminder");
	assert(
		reminder.content.includes("Context was just compacted"),
		"should include post-compaction block when pending"
	);
	assert(
		reminder.content.includes("Re-check current SDD/OpenSpec state on disk"),
		"should include re-check instruction"
	);
	assert(
		reminder.content.includes("restate scope and acceptance criteria"),
		"should include restate instruction"
	);
	// Verify flag is cleared after building
	assert.equal(
		__testing.getCompactionPending(),
		false,
		"flag should be cleared after one-shot use"
	);
});

test("buildContextReminder without compaction pending returns standard reminder", () => {
	__testing.setCompactionPending(false);
	const reminder = __testing.buildContextReminder();
	const content = reminder.content;
	assert(!content.includes("Context was just compacted"), "should not include post-compaction block when not pending");
	assert(content.includes("Active discipline"), "should include standard discipline content");
});

test("setCompactionPending and getCompactionPending control flag", () => {
	__testing.setCompactionPending(true);
	assert.equal(__testing.getCompactionPending(), true);
	__testing.setCompactionPending(false);
	assert.equal(__testing.getCompactionPending(), false);
});

test("applyHarnessReminder multi-turn scenario: reminder persists and refreshes correctly", () => {
	// Simulate first context event
	__testing.setCompactionPending(false);
	let messages: any[] = [{ role: "user", content: "first message" }];
	let result = __testing.applyHarnessReminder(messages);
	assert.equal(result[result.length - 1].customType, "gentle-harness-reminder", "first turn should have reminder");
	const firstReminder = result[result.length - 1];

	// Simulate second context event with new message appended (tool result)
	messages = result;
	messages.push({ role: "tool", content: "tool result" });
	result = __testing.applyHarnessReminder(messages);

	// Should have exactly one reminder and it should be fresh (not the old one)
	const reminderCount = result.filter((m: any) => m.customType === "gentle-harness-reminder").length;
	assert.equal(reminderCount, 1, "should still have exactly one reminder after multi-turn");
	assert.equal(result[result.length - 1].customType, "gentle-harness-reminder", "reminder should be last");
	// Verify it's a fresh reminder (timestamp should be different)
	const secondReminder = result[result.length - 1];
	assert(secondReminder.timestamp >= firstReminder.timestamp, "fresh reminder should have equal or newer timestamp");
});

test("compaction flag resets when applyHarnessReminder builds fresh reminder", () => {
	__testing.setCompactionPending(true);
	assert.equal(__testing.getCompactionPending(), true, "flag should be set");

	const messages: any[] = [];
	const result = __testing.applyHarnessReminder(messages);

	// Flag should now be reset by buildContextReminder call
	assert.equal(__testing.getCompactionPending(), false, "flag should be reset after applyHarnessReminder");
	assert(result[0].content.includes("Context was just compacted"), "reminder should include compaction content");
});
