import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Box, visibleWidth } from "@earendil-works/pi-tui";
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
	const completed = card.render(80).map(stripAnsi);
	assert.equal(completed.length, 1);
	assert.match(completed[0], /ctrl\+o to expand ╮$/);
	assert.equal(visibleWidth(completed[0]), 80);
});

test("completed review cards fit Pi's default Box at terminal width 57", () => {
	for (const operationPath of ["review inspect", "review status", "review capture · reliability", "review acknowledge approved"]) {
		const card = new GentleAiCallCard();
		card.update("completed", operationPath, plainTheme, undefined, "ctrl+o to expand");
		const box = new Box(1, 1);
		box.addChild(card);
		const lines = box.render(57).map(stripAnsi);
		for (const line of lines) assert.equal(visibleWidth(line), 57, `${operationPath}: ${JSON.stringify(line)}`);
		if (operationPath === "review inspect") {
			assert.equal(lines[1], " ╭─ 🌹︎ Gentle AI · completed · review inspect ─────────╮ ");
		}
	}
});

test("review registrations own their shell and capture backgrounds exclude all frame cells", () => {
	const source = readFileSync(new URL("../extensions/gentle-ai.ts", import.meta.url), "utf8");
	assert.equal((source.match(/renderShell: "self"/g) ?? []).length, 4, "review registrations must opt out of Pi's painted Box");
	const theme = { ...plainTheme, bg: (_role: string, text: string) => `\x1b[44m${text}\x1b[49m` };
	for (const expanded of [true, false]) {
		const call = new GentleAiCallCard();
		call.update("completed", "review capture", theme, "$ capture");
		const lines = [...call.render(40), ...renderGentleAiResult({ content: [{ type: "text", text: "Result" }] }, { expanded }, theme).render(40)];
		for (const [row, line] of lines.entries()) {
			let bg = false, column = 0;
			for (const token of line.match(/\x1b\[[\d;]*m|[^\x1b]/gu) ?? []) {
				if (token === "\x1b[44m") bg = true;
				else if (token === "\x1b[49m" || token === "\x1b[0m") bg = false;
				else if (!token.startsWith("\x1b")) {
					assert.equal(bg, row > 0 && row < lines.length - 1 && column > 0 && column < 39);
					column += visibleWidth(token);
				}
			}
			assert.equal(bg, false);
			assert.equal(visibleWidth(line), 40);
		}
	}
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
