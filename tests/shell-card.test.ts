import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CARD_TONE, renderCard, type Card } from "../lib/shell-card.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

// Cards are how Gentle notices look: a titled line and a left rule beside
// the body. They collapse to the title plus one line when pi asks for it.

const plainTheme = {
	fg(_color: string, text: string) {
		return text;
	},
};

const taggedTheme = {
	fg(color: string, text: string) {
		return `<${color}>${text}</${color}>`;
	},
};

function card(overrides: Partial<Card> = {}): Card {
	return {
		title: "Gentle AI",
		subtitle: "review preflight",
		body: ["Receipt-driven development is enabled, and this worktree holds an unreviewed candidate.", "", "Call the gentle_review tool with inspect and follow the transition it returns."],
		tone: CARD_TONE.INFO,
		...overrides,
	};
}

test("renderCard draws a titled line, a left rule beside each body line, and wraps to width", () => {
	const lines = renderCard(card(), plainTheme, 48, { expanded: true }).map(stripAnsi);
	assert.equal(lines[0], "✿ Gentle AI · review preflight");
	assert.match(lines[1], /^▏ Receipt-driven development is enabled, and$/);
	for (const line of lines.slice(1)) assert.ok(visibleWidth(line) <= 48, `too wide: ${line}`);
	assert.ok(lines.some((line) => line === "▏"), "blank body lines keep the rule");
	assert.ok(lines.some((line) => line.includes("gentle_review")), "every paragraph is rendered when expanded");
});

test("renderCard collapses to the title and the first body line with an expand hint", () => {
	const lines = renderCard(card(), plainTheme, 60, { expanded: false }).map(stripAnsi);
	assert.equal(lines.length, 2);
	assert.match(lines[1], /^▏ Receipt-driven development is enabled.*…$/);
	assert.ok(visibleWidth(lines[1]) <= 60);
});

test("renderCard colors the glyph, title, and rule by tone and leaves the body muted", () => {
	const info = renderCard(card(), taggedTheme, 80, { expanded: true });
	assert.match(info[0], /^<customMessageLabel>✿ Gentle AI<\/customMessageLabel> <muted>·<\/muted> <muted>review preflight<\/muted>$/);
	assert.match(info[1], /^<customMessageLabel>▏<\/customMessageLabel> <text>/);

	const warning = renderCard(card({ tone: CARD_TONE.WARNING, subtitle: undefined }), taggedTheme, 80, { expanded: true });
	assert.match(warning[0], /^<warning>✿ Gentle AI<\/warning>$/);
	assert.match(warning[1], /^<warning>▏<\/warning>/);

	const error = renderCard(card({ tone: CARD_TONE.ERROR }), taggedTheme, 80, { expanded: true });
	assert.match(error[0], /^<error>✿ Gentle AI<\/error>/);
});

test("renderCard accepts a custom glyph and an empty body", () => {
	const lines = renderCard(card({ glyph: "✎", body: [] }), plainTheme, 40, { expanded: true }).map(stripAnsi);
	assert.deepEqual(lines, ["✎ Gentle AI · review preflight"]);
});
