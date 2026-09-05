import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "./terminal-theme.ts";

// Gentle Shell prompt frame. pi's editor renders a top rule, padded content
// lines, and a bottom rule; this module wraps those lines in a rounded frame
// with a petal that shows what the agent is doing. Everything here is pure.

export const PROMPT_STATE = {
	IDLE: "idle",
	WORKING: "working",
	QUEUED: "queued",
} as const;

export type PromptState = (typeof PROMPT_STATE)[keyof typeof PROMPT_STATE];

const PETAL_TONE = {
	BRIGHT: "borderAccent",
	ROSE: "accent",
	SOFT: "thinkingHigh",
	DEEP: "mdQuoteBorder",
	WARNING: "warning",
} as const;

export type PetalTone = (typeof PETAL_TONE)[keyof typeof PETAL_TONE];

// The Gentle themes map these to the rose ramp: active pink, rose, soft
// rose, deep pink. The spin walks the ramp one shade per frame.
const PETAL_TONE_FRAMES = [PETAL_TONE.BRIGHT, PETAL_TONE.ROSE, PETAL_TONE.SOFT, PETAL_TONE.DEEP] as const;

export interface PromptFrameOptions {
	state: PromptState;
	tick: number;
	borderColor: (text: string) => string;
	fg: (color: string, text: string) => string;
	bold?: (text: string) => string;
	/** Paints a finished line, e.g. with the panel background. */
	paint?: (line: string) => string;
}

// A terminal cell cannot grow, so the petal earns presence with weight and
// the brightest rose in the theme. Working spins through four flowers.
export const PROMPT_PETAL = "✿";
const PETAL_FRAMES = ["✿", "❀", "❁", "✾"] as const;
export const PROMPT_HINT = "type, or / for commands";
const LABEL_ROLE = "muted";
const HINT_ROLE = "dim";
const FAKE_CURSOR = "\x1b[7m \x1b[0m";
const SCROLL_INDICATOR = /[↑↓] \d+ more/;
const STATE_LABEL: Record<PromptState, string | undefined> = {
	[PROMPT_STATE.IDLE]: undefined,
	[PROMPT_STATE.WORKING]: "working",
	[PROMPT_STATE.QUEUED]: "queued",
};

export function petalTone(state: PromptState, tick: number): PetalTone {
	if (state === PROMPT_STATE.QUEUED) return PETAL_TONE.WARNING;
	if (state === PROMPT_STATE.WORKING) return PETAL_TONE_FRAMES[tick % PETAL_TONE_FRAMES.length];
	return PETAL_TONE.BRIGHT;
}

export function petalGlyph(state: PromptState, tick: number): string {
	if (state === PROMPT_STATE.IDLE) return PROMPT_PETAL;
	return PETAL_FRAMES[tick % PETAL_FRAMES.length];
}

function scrollIndicator(rule: string): string | undefined {
	return stripAnsi(rule).match(SCROLL_INDICATOR)?.[0];
}

function rule(length: number): string {
	return "─".repeat(Math.max(0, length));
}

function topRule(width: number, options: PromptFrameOptions, indicator: string | undefined): string {
	const label = indicator ?? STATE_LABEL[options.state];
	const glyph = petalGlyph(options.state, options.tick);
	const petal = options.fg(petalTone(options.state, options.tick), options.bold ? options.bold(glyph) : glyph);
	const labelText = label ? ` ${options.fg(LABEL_ROLE, label)}` : "";
	const labelWidth = label ? label.length + 1 : 0;
	const fill = width - 3 - visibleWidth(glyph) - labelWidth - 1 - 1;
	return options.borderColor("╭─ ") + petal + labelText + options.borderColor(` ${rule(fill)}╮`);
}

function bottomRule(width: number, options: PromptFrameOptions, indicator: string | undefined): string {
	if (!indicator) return options.borderColor(`╰${rule(width - 2)}╯`);
	const fill = width - 3 - indicator.length - 1 - 1;
	return options.borderColor("╰─ ") + options.fg(LABEL_ROLE, indicator) + options.borderColor(` ${rule(fill)}╯`);
}

function sideRules(line: string, innerWidth: number, options: PromptFrameOptions): string {
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
	return options.borderColor("│") + line + padding + options.borderColor("│");
}

export function framePromptLines(lines: string[], width: number, options: PromptFrameOptions): string[] {
	if (lines.length < 2) return lines;
	const innerWidth = width - 2;
	const top = lines[0];
	const bottom = lines[lines.length - 1];
	const content = lines.slice(1, -1).map((line) => sideRules(line, innerWidth, options));
	const paint = options.paint ?? ((line: string) => line);
	return [topRule(width, options, scrollIndicator(top)), ...content, bottomRule(width, options, scrollIndicator(bottom))].map(paint);
}

export function withPromptHint(line: string, hint: string, fg: PromptFrameOptions["fg"]): string {
	const cursorAt = line.indexOf(FAKE_CURSOR);
	if (cursorAt === -1) return line;
	const afterCursor = cursorAt + FAKE_CURSOR.length;
	const trailing = line.slice(afterCursor);
	if (trailing.trim() !== "" || trailing.length < hint.length + 1) return line;
	return `${line.slice(0, afterCursor)} ${fg(HINT_ROLE, hint)}${" ".repeat(trailing.length - hint.length - 1)}`;
}

// Paints a line with a background that survives the resets pi's editor
// emits around the cursor, so the panel color runs edge to edge.
export function panelPainter(bgAnsi: string): (line: string) => string {
	const RESET = "\x1b[0m";
	return (line) => `${bgAnsi}${line.split(RESET).join(`${RESET}${bgAnsi}`)}\x1b[49m`;
}
