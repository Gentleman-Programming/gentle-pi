// Shared gauge primitives for the Gentle Shell bar and panels.

const GAUGE_TONE = {
	ACCENT: "accent",
	WARNING: "warning",
	ERROR: "error",
	DIM: "dim",
} as const;

export type GaugeTone = (typeof GAUGE_TONE)[keyof typeof GAUGE_TONE];

export interface GaugeTheme {
	fg(color: string, text: string): string;
}

export const GAUGE_CELLS = 8;
const GAUGE_FILLED = "▰";
const GAUGE_EMPTY = "▱";
const GAUGE_EMPTY_ROLE = "border";
const WARNING_THRESHOLD = 80;
const ERROR_THRESHOLD = 95;

export function renderGauge(percent: number | null, cells: number = GAUGE_CELLS): string {
	const clamped = Math.max(0, Math.min(100, percent ?? 0));
	const filled = Math.round((clamped / 100) * cells);
	return GAUGE_FILLED.repeat(filled) + GAUGE_EMPTY.repeat(cells - filled);
}

export function gaugeTone(percent: number | null): GaugeTone {
	if (percent === null) return GAUGE_TONE.DIM;
	if (percent >= ERROR_THRESHOLD) return GAUGE_TONE.ERROR;
	if (percent >= WARNING_THRESHOLD) return GAUGE_TONE.WARNING;
	return GAUGE_TONE.ACCENT;
}

export function paintGauge(percent: number | null, theme: GaugeTheme, cells: number = GAUGE_CELLS): string {
	const gauge = renderGauge(percent, cells);
	const filled = gauge.replace(new RegExp(`${GAUGE_EMPTY}+$`), "");
	return theme.fg(gaugeTone(percent), filled) + theme.fg(GAUGE_EMPTY_ROLE, gauge.slice(filled.length));
}
