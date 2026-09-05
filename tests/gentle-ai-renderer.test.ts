import assert from "node:assert/strict";
import test from "node:test";
import { renderGentleAiResult, GentleAiCallCard } from "../lib/gentle-ai-renderer.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

// Rose cards: exactly one component closes the frame in every state. While
// a call runs, the call card draws the bottom rule (a partial result never
// does); once the final result is in, the result card closes the frame.

const plainTheme = { fg: (_color: string, text: string) => text };

test("a running call card closes its own frame and a completed one leaves that to the result", () => {
	const card = new GentleAiCallCard();
	card.update("running", "review capture · reliability", plainTheme);
	const running = card.render(60).map(stripAnsi);
	assert.equal(running.length, 2);
	assert.match(running[0], /^╭─ 🌹︎ Gentle AI · running · review capture · reliability ─*╮$/);
	assert.match(running[1], /^╰─+╯$/);
	card.update("preparing", "review status", plainTheme, "$ gentle-ai review status");
	assert.match(card.render(60).map(stripAnsi)[2], /^╰─+╯$/);
	card.update("completed", "review status", plainTheme, undefined, "ctrl+o to expand");
	const completed = card.render(60).map(stripAnsi);
	assert.equal(completed.length, 1);
	assert.match(completed[0], /ctrl\+o to expand ╮$/);
});

test("a partial result draws no bottom rule and a final one draws exactly one", () => {
	const partial = renderGentleAiResult({ content: [{ type: "text", text: "half" }] }, { expanded: false, isPartial: true }, plainTheme).render(60).map(stripAnsi);
	assert.deepEqual(partial.map((line) => line.slice(0, 1)), ["│"], "only the count row, no closing rule");
	const final = renderGentleAiResult({ content: [{ type: "text", text: "one\ntwo" }] }, { expanded: false }, plainTheme).render(60).map(stripAnsi);
	assert.equal(final.length, 2);
	assert.match(final[0], /^│ 2 lines +│$/);
	assert.match(final[1], /^╰─+╯$/);
	const empty = renderGentleAiResult({ content: [] }, { expanded: false }, plainTheme).render(60).map(stripAnsi);
	assert.deepEqual(empty.map((line) => line.slice(0, 1)), ["╰"]);
});

test("promoting the shared state to finished invalidates after the render returns, never inside it", async () => {
	const state: Record<string, unknown> = {};
	let invalidations = 0;
	const context = { state, invalidate: () => (invalidations += 1) };
	renderGentleAiResult({ content: [{ type: "text", text: "done" }] }, { expanded: false }, plainTheme, context as never);
	assert.equal(invalidations, 0, "no reentrant invalidate while rendering");
	await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
	assert.equal(invalidations, 1);
	renderGentleAiResult({ content: [{ type: "text", text: "done" }] }, { expanded: false }, plainTheme, context as never);
	await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
	assert.equal(invalidations, 1, "an unchanged state does not invalidate again");
});
