import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../lib/terminal-theme.ts";
import {
	framePromptLines,
	PROMPT_STATE,
	petalGlyph,
	petalTone,
	withPromptHint,
	type PromptFrameOptions,
} from "../lib/shell-prompt.ts";

// The Gentle Shell prompt wraps pi's editor output (a top rule, padded content
// lines, a bottom rule) in a rounded frame with a petal that shows the agent
// state. Framing is pure: it takes the editor's lines and returns new ones.

const CURSOR = "\x1b[7m \x1b[0m";

function options(overrides: Partial<PromptFrameOptions> = {}): PromptFrameOptions {
	return {
		state: PROMPT_STATE.IDLE,
		tick: 0,
		borderColor: (text) => text,
		fg: (color, text) => `<${color}>${text}</${color}>`,
		...overrides,
	};
}

function editorLines(width: number, content: string[] = [` ${CURSOR}`]): string[] {
	const inner = width - 2;
	return ["─".repeat(inner), ...content.map((line) => line + " ".repeat(inner - visibleWidth(line))), "─".repeat(inner)];
}

test("framePromptLines draws rounded corners, side rules, and keeps every line at width", () => {
	const width = 40;
	const lines = framePromptLines(editorLines(width), width, options({ fg: (_c, t) => t }));
	assert.equal(lines.length, 3);
	for (const line of lines) assert.equal(visibleWidth(line), width, `line "${stripAnsi(line)}" is not ${width} wide`);
	assert.match(stripAnsi(lines[0]), /^╭─ ✿ ─+╮$/);
	assert.match(stripAnsi(lines[1]), /^│ .* │$/);
	assert.match(stripAnsi(lines[2]), /^╰─+╯$/);
});

test("framePromptLines paints the frame with the editor border color and the petal with the state tone", () => {
	const lines = framePromptLines(editorLines(40), 40, options({ borderColor: (text) => `[b]${text}[/b]` }));
	assert.match(lines[0], /^\[b\]╭─ \[\/b\]<accent>✿<\/accent>\[b\] ─+╮\[\/b\]$/);
	assert.match(lines[1], /^\[b\]│\[\/b\].*\[b\]│\[\/b\]$/);
	assert.match(lines[2], /^\[b\]╰─+╯\[\/b\]$/);
});

test("petalTone stays rose while working and turns to warning when messages are queued", () => {
	assert.equal(petalTone(PROMPT_STATE.IDLE), "accent");
	assert.equal(petalTone(PROMPT_STATE.WORKING), "accent");
	assert.equal(petalTone(PROMPT_STATE.QUEUED), "warning");
});

test("petalGlyph spins through the flowers while working and rests otherwise", () => {
	assert.equal(petalGlyph(PROMPT_STATE.IDLE, 3), "✿");
	assert.deepEqual([0, 1, 2, 3, 4].map((tick) => petalGlyph(PROMPT_STATE.WORKING, tick)), ["✿", "❀", "❁", "✾", "✿"]);
	assert.equal(petalGlyph(PROMPT_STATE.QUEUED, 1), "❀");
});

test("framePromptLines spins the petal silently while working and labels only the queued state", () => {
	const plain = (_color: string, text: string) => text;
	const working = framePromptLines(editorLines(40), 40, options({ state: PROMPT_STATE.WORKING, tick: 1 }));
	assert.match(working[0], /<accent>❀<\/accent>/);
	assert.doesNotMatch(working[0], /working/);
	const workingPlain = framePromptLines(editorLines(40), 40, options({ state: PROMPT_STATE.WORKING, tick: 1, fg: plain }));
	assert.match(stripAnsi(workingPlain[0]), /^╭─ ❀ ─+╮$/);
	assert.equal(visibleWidth(workingPlain[0]), 40);

	const queued = framePromptLines(editorLines(40), 40, options({ state: PROMPT_STATE.QUEUED }));
	assert.match(queued[0], /<warning>✿<\/warning>/);
	assert.match(queued[0], /<muted>queued<\/muted>/);
	const queuedPlain = framePromptLines(editorLines(40), 40, options({ state: PROMPT_STATE.QUEUED, fg: plain }));
	assert.match(stripAnsi(queuedPlain[0]), /^╭─ ✿ queued ─+╮$/);
	assert.equal(visibleWidth(queuedPlain[0]), 40);
});

test("framePromptLines keeps the editor scroll indicators inside the frame", () => {
	const width = 40;
	const inner = width - 2;
	const top = `─── ↑ 2 more ${"─".repeat(inner - 13)}`;
	const bottom = `─── ↓ 3 more ${"─".repeat(inner - 13)}`;
	const lines = framePromptLines([top, ` x${" ".repeat(inner - 2)}`, bottom], width, options({ fg: (_c, t) => t }));
	assert.match(stripAnsi(lines[0]), /^╭─ ✿ ↑ 2 more ─+╮$/);
	assert.match(stripAnsi(lines[2]), /^╰─ ↓ 3 more ─+╯$/);
	for (const line of lines) assert.equal(visibleWidth(line), width);
});

test("withPromptHint places a dim hint after the cursor on an empty editor line", () => {
	const inner = 38;
	const line = ` ${CURSOR}${" ".repeat(inner - 2)}`;
	const hinted = withPromptHint(line, "type, or / for commands", (color, text) => `<${color}>${text}</${color}>`);
	assert.match(hinted, /\x1b\[7m \x1b\[0m <dim>type, or \/ for commands<\/dim> +$/);
	const hintedPlain = withPromptHint(line, "type, or / for commands", (_c, t) => t);
	assert.equal(visibleWidth(hintedPlain), inner);
});

test("withPromptHint leaves the line alone when the hint does not fit", () => {
	const line = ` ${CURSOR}${" ".repeat(6)}`;
	const hinted = withPromptHint(line, "type, or / for commands", (_c, t) => t);
	assert.equal(hinted, line);
});
