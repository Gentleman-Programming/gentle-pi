import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { GAUGE_CELLS, gaugeTone, paintGauge, renderGauge, type GaugeTone } from "./shell-gauge.ts";
import { renderUsageBar, type ProviderUsage } from "./shell-usage.ts";
import type { RddModeScope, RddModeValue } from "./rdd-mode-status.ts";
import { sanitizeTerminalText } from "./terminal-theme.ts";
import { CARD_TONE, cardInnerWidth, renderCard } from "./shell-card.ts";

export { gaugeTone, renderGauge, type GaugeTone };

// Gentle Shell status bar: one line of segments that replaces pi's built-in
// three-line footer. Everything here is pure so the bar can be rendered and
// verified without a live TUI.

export interface ShellBarModel {
	profile?: string;
	cwd: string;
	branch: string | null;
	dirty: number | undefined;
	sessionName: string | undefined;
	modelId: string;
	effort: string | undefined;
	contextPercent: number | null;
	contextWindow: number;
	costTotal: number;
	subscription: boolean;
	usage: ProviderUsage | undefined;
	statuses: string[];
	rddMode?: RddModeValue;
	rddScope?: RddModeScope;
}

export interface ShellBarTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

// Theme roles the bar paints with. Keys are pi theme colors; the Gentle themes
// map them to the rose palette (accent = rose, syntaxFunction = powder blue).
const ROLE = {
	BRAND: "accent",
	SEPARATOR: "dim",
	PATH: "muted",
	BRANCH: "text",
	DIRTY: "warning",
	MODEL: "text",
	EFFORT: "syntaxFunction",
	LABEL: "muted",
	VALUE: "text",
	STATUS: "muted",
	RDD: "syntaxFunction",
	SESSION: "dim",
} as const;

export const SHELL_BAR_BRAND = "✿ gentle-pi";
export const SHELL_BAR_SEPARATOR = "⟡";
export const SHELL_BAR_GAUGE_CELLS = GAUGE_CELLS;
const RIGHT_PADDING = 2;
const COMPACT_BRANCH_WIDTH = 15;
const COLUMN_GAP = 3;
const CONTEXT_COLUMN_MIN_WIDTH = 15;
const USAGE_COLUMN_MIN_WIDTH = 16;

type SidebarGroup = { title: string; lines: string[] };

export function shellEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.GENTLE_PI_AGENTS_CHILD === "1") return false;
	const value = env.GENTLE_PI_SHELL?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function formatCost(total: number, subscription: boolean): string {
	const amount = total >= 1 ? total.toFixed(2) : total.toFixed(3);
	return subscription ? `$${amount} sub` : `$${amount}`;
}

// Extensions may paint their status themselves (pi-mcp-adapter does); the bar
// owns the palette, so their escapes go and the text takes the status role.
function sanitizeStatus(text: string): string {
	return sanitizeTerminalText(text.replace(/[\r\n\t]/g, " ")).replace(/ +/g, " ").trim();
}

export function rddModeToken(mode: RddModeValue | undefined): string {
	return `RDD: ${mode === "on" ? "ON" : mode === "off" ? "OFF" : "?"}`;
}

function rddScopeToken(mode: RddModeValue | undefined, scope: RddModeScope | undefined): string | undefined {
	return mode === "unknown" || mode === undefined || scope === undefined ? undefined : `Scope: ${scope}`;
}

function buildSegments(model: ShellBarModel, theme: ShellBarTheme): string[] {
	const dirty = model.dirty ? ` ${theme.fg(ROLE.DIRTY, `±${model.dirty}`)}` : "";
	const location = model.branch
		? `${theme.fg(ROLE.PATH, model.cwd)} ${theme.fg(ROLE.BRANCH, model.branch)}${dirty}`
		: theme.fg(ROLE.PATH, model.cwd) + dirty;
	const modelSegment = model.effort
		? `${theme.fg(ROLE.MODEL, model.modelId)} ${theme.fg(ROLE.LABEL, "·")} ${theme.fg(ROLE.EFFORT, model.effort)}`
		: theme.fg(ROLE.MODEL, model.modelId);
	const percentText = model.contextPercent === null ? "?%" : `${Math.round(model.contextPercent)}%`;
	const context = `${theme.fg(ROLE.LABEL, "ctx")} ${paintGauge(model.contextPercent, theme)} ${theme.fg(ROLE.VALUE, percentText)}`;
	const cost = theme.fg(ROLE.VALUE, formatCost(model.costTotal, model.subscription));
	const usage = model.usage ? renderUsageBar(model.usage, theme) : undefined;
	const statuses = model.statuses.map((status) => theme.fg(ROLE.STATUS, sanitizeStatus(status)));
	const rdd = theme.fg(ROLE.RDD, rddModeToken(model.rddMode));
	return [theme.fg(ROLE.BRAND, SHELL_BAR_BRAND), rdd, location, modelSegment, context, cost, ...(usage ? [usage] : []), ...statuses];
}

// When the line overflows, the location gives way first: the path shrinks to
// its last segment and a long branch is clipped, so the trailing statuses
// (MCP servers, extension notices) survive on ordinary terminal widths.
function projectName(cwd: string): string {
	return cwd.split("/").filter((part) => part.length > 0).pop() ?? cwd;
}

function compactModel(model: ShellBarModel): ShellBarModel {
	const cwd = projectName(model.cwd);
	const branch = model.branch && visibleWidth(model.branch) > COMPACT_BRANCH_WIDTH ? clipText(model.branch, COMPACT_BRANCH_WIDTH) : model.branch;
	return { ...model, cwd, branch };
}

// Plain clip: pi's truncateToWidth wraps the result in resets, which would end
// up inside a painted segment.
function clipText(text: string, max: number): string {
	let clipped = "";
	for (const char of text) {
		if (visibleWidth(clipped + char) > max - 1) break;
		clipped += char;
	}
	return `${clipped}…`;
}

function joinSegments(segments: string[], theme: ShellBarTheme): string {
	return segments.join(` ${theme.fg(ROLE.SEPARATOR, SHELL_BAR_SEPARATOR)} `);
}

function padToWidth(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function wrappedGroup(group: SidebarGroup, label: (text: string) => string, innerWidth: number): string[] {
	const inset = Math.min(1, innerWidth - 1);
	return [
		label(group.title),
		...group.lines.flatMap((line) => wrapTextWithAnsi(line, innerWidth - inset).map((part) => " ".repeat(inset) + part)),
	];
}

function columnGroups(left: SidebarGroup, right: SidebarGroup, label: (text: string) => string, innerWidth: number): string[] {
	if (innerWidth < CONTEXT_COLUMN_MIN_WIDTH + COLUMN_GAP + USAGE_COLUMN_MIN_WIDTH) {
		return [...wrappedGroup(left, label, innerWidth), "", ...wrappedGroup(right, label, innerWidth)];
	}
	const available = innerWidth - COLUMN_GAP;
	const leftWidth = Math.floor(available / 2);
	const rightWidth = available - leftWidth;
	const leftLines = [label(left.title), ...left.lines.flatMap((line) => wrapTextWithAnsi(line, leftWidth))];
	const rightLines = [label(right.title), ...right.lines.flatMap((line) => wrapTextWithAnsi(line, rightWidth))];
	return Array.from({ length: Math.max(leftLines.length, rightLines.length) }, (_, index) =>
		`${padToWidth(leftLines[index] ?? "", leftWidth)}${" ".repeat(COLUMN_GAP)}${rightLines[index] ?? ""}`,
	);
}

function renderSidebarUsage(usage: ProviderUsage, theme: ShellBarTheme): string | undefined {
	const [first, ...rest] = usage.limits[0]?.windows ?? [];
	if (!first) return undefined;
	const head = `${theme.fg(ROLE.LABEL, first.label)} ${paintGauge(first.usedPercent, theme)} ${theme.fg(ROLE.VALUE, `${Math.round(first.usedPercent)}%`)}`;
	const tail = rest.map((window) => `${theme.fg(ROLE.SEPARATOR, "·")} ${theme.fg(ROLE.LABEL, window.label)} ${theme.fg(ROLE.VALUE, `${Math.round(window.usedPercent)}%`)}`);
	return [head, ...tail].join(" ");
}

// Sidebar groups use structured fields, never positional compact-bar segments
// or inferred meanings from opaque extension status strings.
export function renderShellSidebarBar(model: ShellBarModel, theme: ShellBarTheme, width: number): string[] {
	const value = (text: string) => theme.fg(ROLE.VALUE, theme.bold(text));
	const label = (text: string) => theme.fg(ROLE.LABEL, text);
	const percent = model.contextPercent === null ? "?%" : `${Math.round(model.contextPercent)}%`;
	const usage = model.usage ? renderSidebarUsage(model.usage, theme) : undefined;
	const branchStatus = [
		...(model.branch ? [`${theme.fg(ROLE.BRANCH, "")} ${value(model.branch)}`] : []),
		...(model.dirty ? [theme.fg(ROLE.DIRTY, `+${model.dirty}`)] : []),
	].join(" ");
	const project = [
		value(projectName(model.cwd)),
		...(branchStatus ? [branchStatus] : []),
		...(model.sessionName ? [`${label("Session")} ${value(model.sessionName)}`] : []),
	];
	const scope = rddScopeToken(model.rddMode, model.rddScope);
	const effort = model.effort ? `${model.effort[0]?.toUpperCase()}${model.effort.slice(1)}` : undefined;
	const modelGroup: SidebarGroup = {
		title: "Model",
		lines: [
			effort ? `${value(model.modelId)} ${label("·")} ${theme.fg(ROLE.EFFORT, effort)}` : value(model.modelId),
			...(model.profile ? [`${label("Profile")} ${value(sanitizeStatus(model.profile))}`] : []),
		],
	};
	const reviewGroup: SidebarGroup = {
		title: "Review",
		lines: [value(rddModeToken(model.rddMode)), ...(scope ? [value(scope)] : [])],
	};
	const contextGroup: SidebarGroup = {
		title: "Context",
		lines: [`${paintGauge(model.contextPercent, theme)} ${value(percent)}`, label(`${formatTokens(model.contextWindow)} tokens`)],
	};
	const usageGroup: SidebarGroup = {
		title: "Usage",
		lines: [`${label("Cost")} ${value(formatCost(model.costTotal, model.subscription))}`, ...(usage ? [usage] : [])],
	};
	const integrations: SidebarGroup | undefined = model.statuses.length
		? { title: "Integrations", lines: model.statuses.map((status) => theme.fg(ROLE.STATUS, sanitizeStatus(status))) }
		: undefined;
	const innerWidth = cardInnerWidth(width);
	const body = [
		...project.flatMap((line) => wrapTextWithAnsi(line, innerWidth)),
		"",
		...columnGroups(modelGroup, reviewGroup, label, innerWidth),
		"",
		...columnGroups(contextGroup, usageGroup, label, innerWidth),
		...(integrations ? ["", ...wrappedGroup(integrations, label, innerWidth)] : []),
	];
	return renderCard({ title: "Status", body, tone: CARD_TONE.INFO }, theme, width, { expanded: true });
}

export function renderShellBar(model: ShellBarModel, theme: ShellBarTheme, width: number): string[] {
	let segments = buildSegments(model, theme);
	const right = model.sessionName ? theme.fg(ROLE.SESSION, model.sessionName) : undefined;

	let left = joinSegments(segments, theme);
	if (right && visibleWidth(left) + RIGHT_PADDING + visibleWidth(right) <= width) {
		const padding = " ".repeat(width - visibleWidth(left) - visibleWidth(right));
		return [left + padding + right];
	}

	if (visibleWidth(left) > width) {
		segments = buildSegments(compactModel(model), theme);
		left = joinSegments(segments, theme);
	}
	while (segments.length > 1 && visibleWidth(left) > width) {
		segments.pop();
		left = joinSegments(segments, theme);
	}
	return [truncateToWidth(left, width, "…")];
}
