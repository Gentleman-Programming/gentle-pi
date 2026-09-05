import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Gentle Shell cards: the shape every Gentle notice takes in the transcript
// and above the editor. A titled line, then the body beside a left rule in
// the card's tone. Pure: takes strings, returns lines.

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
const RULE = "▏";
const TONE_ROLE: Record<CardTone, string> = {
	[CARD_TONE.INFO]: "customMessageLabel",
	[CARD_TONE.WARNING]: "warning",
	[CARD_TONE.ERROR]: "error",
};
const SUBTITLE_ROLE = "muted";
const BODY_ROLE = "text";
const SEPARATOR = "·";

function titleLine(card: Card, theme: CardTheme): string {
	const head = theme.fg(TONE_ROLE[card.tone], `${card.glyph ?? CARD_GLYPH} ${card.title}`);
	if (!card.subtitle) return head;
	return `${head} ${theme.fg(SUBTITLE_ROLE, SEPARATOR)} ${theme.fg(SUBTITLE_ROLE, card.subtitle)}`;
}

function bodyLines(card: Card, width: number): string[] {
	const wrapWidth = Math.max(1, width - 2);
	return card.body.flatMap((paragraph) => (paragraph === "" ? [""] : wrapTextWithAnsi(paragraph, wrapWidth)));
}

export function renderCard(card: Card, theme: CardTheme, width: number, options: CardRenderOptions): string[] {
	const rule = theme.fg(TONE_ROLE[card.tone], RULE);
	const lines = bodyLines(card, width);
	if (lines.length === 0) return [titleLine(card, theme)];
	if (!options.expanded) {
		const first = lines.find((line) => line !== "") ?? "";
		const clipped = lines.length > 1 ? truncateToWidth(first, Math.max(1, width - 3), "") + "…" : first;
		return [titleLine(card, theme), `${rule} ${theme.fg(BODY_ROLE, clipped)}`];
	}
	return [titleLine(card, theme), ...lines.map((line) => (line === "" ? rule : `${rule} ${theme.fg(BODY_ROLE, line)}`))];
}
