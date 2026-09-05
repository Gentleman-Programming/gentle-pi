import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Gentle Shell cards: the shape every Gentle notice takes in the transcript
// and above the editor. The same rounded frame as the prompt and the
// overlays, with the title in the card's tone. Pure: strings in, lines out.

export const CARD_TONE = {
	INFO: "info",
	WARNING: "warning",
	ERROR: "error",
} as const;

export type CardTone = (typeof CARD_TONE)[keyof typeof CARD_TONE];

export interface Card {
	title: string;
	subtitle?: string;
	body: string[];
	tone: CardTone;
	glyph?: string;
}

export interface CardTheme {
	fg(color: string, text: string): string;
}

export interface CardRenderOptions {
	expanded: boolean;
}

export const CARD_GLYPH = "✿";
const TONE_ROLE: Record<CardTone, string> = {
	[CARD_TONE.INFO]: "customMessageLabel",
	[CARD_TONE.WARNING]: "warning",
	[CARD_TONE.ERROR]: "error",
};
const FRAME_ROLE = "border";
const SUBTITLE_ROLE = "muted";
const BODY_ROLE = "text";
const SEPARATOR = "·";
const FRAME_COLUMNS = 4;

function rule(length: number): string {
	return "─".repeat(Math.max(0, length));
}

function titleText(card: Card, theme: CardTheme): { styled: string; width: number } {
	const head = `${card.glyph ?? CARD_GLYPH} ${card.title}`;
	const styled = card.subtitle
		? `${theme.fg(TONE_ROLE[card.tone], head)} ${theme.fg(SUBTITLE_ROLE, SEPARATOR)} ${theme.fg(SUBTITLE_ROLE, card.subtitle)}`
		: theme.fg(TONE_ROLE[card.tone], head);
	return { styled, width: head.length + (card.subtitle ? card.subtitle.length + 3 : 0) };
}

function bodyLines(card: Card, innerWidth: number): string[] {
	return card.body.flatMap((paragraph) => (paragraph === "" ? [""] : wrapTextWithAnsi(paragraph, innerWidth)));
}

function frameLine(text: string, innerWidth: number, theme: CardTheme): string {
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(text)));
	return `${theme.fg(FRAME_ROLE, "│")} ${text}${padding} ${theme.fg(FRAME_ROLE, "│")}`;
}

export function renderCard(card: Card, theme: CardTheme, width: number, options: CardRenderOptions): string[] {
	const innerWidth = Math.max(1, width - FRAME_COLUMNS);
	const title = titleText(card, theme);
	const top = theme.fg(FRAME_ROLE, "╭─ ") + title.styled + theme.fg(FRAME_ROLE, ` ${rule(width - title.width - 5)}╮`);
	const bottom = theme.fg(FRAME_ROLE, `╰${rule(width - 2)}╯`);
	const lines = bodyLines(card, innerWidth);
	if (lines.length === 0) return [top, bottom];
	if (!options.expanded) {
		const first = lines.find((line) => line !== "") ?? "";
		const clipped = lines.length > 1 ? truncateToWidth(first, Math.max(1, innerWidth - 1), "") + "…" : first;
		return [top, frameLine(theme.fg(BODY_ROLE, clipped), innerWidth, theme), bottom];
	}
	return [top, ...lines.map((line) => frameLine(line === "" ? "" : theme.fg(BODY_ROLE, line), innerWidth, theme)), bottom];
}
