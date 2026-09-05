import { visibleWidth } from "@earendil-works/pi-tui";
import { isFinished, TASK_STATUS, type TaskRecord, type TaskStatus } from "./agents-protocol.ts";
import { formatTokens } from "./shell-bar.ts";
import { CARD_TONE, cardInnerWidth, renderCard, type CardTheme, type CardTone } from "./shell-card.ts";

// Gentle Agents widget: the card above the editor. Reads task records only
// (status, prompt, counters, timestamps), so drawing it costs nothing per
// event. One row per task: glyph, agent, task summary, then
// model · tokens · cost · time right-aligned.

export const AGENTS_GLYPH = "❀";

export interface AgentsWidgetOptions {
	collapsed: boolean;
	collapseKey?: string;
}

interface StatusLook {
	glyph: string;
	role: string;
}

interface Columns {
	inner: number;
	name: number;
	task: number;
	meta: number;
	withModel: boolean;
}

const LOOK: Record<TaskStatus, StatusLook> = {
	[TASK_STATUS.QUEUED]: { glyph: "○", role: "muted" },
	[TASK_STATUS.RUNNING]: { glyph: "◐", role: "accent" },
	[TASK_STATUS.WAITING]: { glyph: "?", role: "warning" },
	[TASK_STATUS.COMPLETED]: { glyph: "✓", role: "success" },
	[TASK_STATUS.FAILED]: { glyph: "✗", role: "error" },
	[TASK_STATUS.CANCELLED]: { glyph: "–", role: "dim" },
	[TASK_STATUS.TIMED_OUT]: { glyph: "✗", role: "error" },
};
const FINISHED_TTL_MS = 60_000;
const MAX_FINISHED = 3;
const NAME_MAX = 20;
const TASK_MIN = 12;
const GLYPH_GAP = "  ";
const COLUMN_GAP = "  ";
const NAME_ROLE = "text";
const TASK_ROLE = "muted";
const META_ROLE = "dim";
const ELLIPSIS = "…";

export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function clip(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	let out = "";
	for (const char of text) {
		if (visibleWidth(out + char) > width - 1) break;
		out += char;
	}
	return `${out}${ELLIPSIS}`;
}

// Every active task plus the few that finished within the last minute, in
// the order they started, so a batch reads top to bottom like a timeline.
export function widgetTasks(tasks: readonly TaskRecord[], now: number): TaskRecord[] {
	const active = tasks.filter((task) => !isFinished(task.status));
	const finished = tasks
		.filter((task) => isFinished(task.status) && task.endedAt !== null && now - task.endedAt <= FINISHED_TTL_MS)
		.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
		.slice(0, MAX_FINISHED);
	return [...active, ...finished].sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt));
}

function elapsed(task: TaskRecord, now: number): string {
	return task.startedAt === null ? "" : formatElapsed((task.endedAt ?? now) - task.startedAt);
}

function modelLabel(task: TaskRecord): string {
	const id = task.model.includes("/") ? task.model.slice(task.model.lastIndexOf("/") + 1) : task.model;
	return id === "default" ? "" : id;
}

function meta(task: TaskRecord, now: number, withModel: boolean): string {
	if (task.status === TASK_STATUS.QUEUED) return "queued";
	const parts = [withModel ? modelLabel(task) : "", task.tokens > 0 ? formatTokens(task.tokens) : "", task.cost > 0 ? `$${task.cost.toFixed(2)}` : "", elapsed(task, now)];
	return parts.filter((part) => part.length > 0).join(" · ");
}

function taskText(task: TaskRecord): string {
	if (task.status === TASK_STATUS.WAITING) return task.lastStep;
	if (task.error) return task.error;
	return task.label;
}

// Narrow cards give up the task column first, then the model label.
function columns(tasks: readonly TaskRecord[], inner: number, now: number): Columns {
	const name = Math.min(NAME_MAX, Math.max(...tasks.map((task) => visibleWidth(task.agent))));
	const fixed = 1 + GLYPH_GAP.length + name + COLUMN_GAP.length;
	const metaWidth = (withModel: boolean) => Math.max(...tasks.map((task) => visibleWidth(meta(task, now, withModel))));
	const full = metaWidth(true);
	const task = inner - fixed - full - COLUMN_GAP.length;
	if (task >= TASK_MIN) return { inner, name, meta: full, task, withModel: true };
	return { inner, name, meta: metaWidth(false), task: 0, withModel: false };
}

function row(task: TaskRecord, theme: CardTheme, cols: Columns, now: number): string[] {
	const look = LOOK[task.status];
	const name = clip(task.agent, cols.name);
	const head = `${theme.fg(look.role, look.glyph)}${GLYPH_GAP}${theme.fg(NAME_ROLE, name)}${" ".repeat(cols.name - visibleWidth(name))}`;
	const tail = theme.fg(META_ROLE, meta(task, now, cols.withModel).padStart(cols.meta));
	if (cols.task === 0) return [`${head}${" ".repeat(Math.max(COLUMN_GAP.length, cols.inner - visibleWidth(head) - visibleWidth(tail)))}${tail}`];
	const text = clip(taskText(task), cols.task);
	return [`${head}${COLUMN_GAP}${theme.fg(TASK_ROLE, text)}${" ".repeat(cols.task - visibleWidth(text))}${COLUMN_GAP}${tail}`];
}

function counts(tasks: readonly TaskRecord[]): string {
	const labels: Array<[TaskStatus, string]> = [
		[TASK_STATUS.RUNNING, "active"],
		[TASK_STATUS.WAITING, "waiting"],
		[TASK_STATUS.QUEUED, "queued"],
		[TASK_STATUS.COMPLETED, "done"],
		[TASK_STATUS.FAILED, "failed"],
		[TASK_STATUS.TIMED_OUT, "timed out"],
		[TASK_STATUS.CANCELLED, "cancelled"],
	];
	return labels
		.map(([status, label]) => [tasks.filter((task) => task.status === status).length, label] as const)
		.filter(([count]) => count > 0)
		.map(([count, label]) => `${count} ${label}`)
		.join(" · ");
}

function tone(tasks: readonly TaskRecord[]): CardTone {
	if (tasks.some((task) => task.status === TASK_STATUS.WAITING)) return CARD_TONE.WARNING;
	if (tasks.some((task) => task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.TIMED_OUT)) return CARD_TONE.ERROR;
	return CARD_TONE.INFO;
}

// The batch clock: from the first start among the shown tasks until now, or
// until the last one ended when nothing is running.
function batchElapsed(tasks: readonly TaskRecord[], now: number): string | undefined {
	const starts = tasks.map((task) => task.startedAt).filter((value): value is number => value !== null);
	if (starts.length === 0) return undefined;
	const active = tasks.some((task) => !isFinished(task.status));
	const end = active ? now : Math.max(...tasks.map((task) => task.endedAt ?? now));
	return formatElapsed(end - Math.min(...starts));
}

export function renderAgentsCard(tasks: readonly TaskRecord[], theme: CardTheme, width: number, now: number, options: AgentsWidgetOptions): string[] {
	const shown = widgetTasks(tasks, now);
	if (shown.length === 0) return [];
	const cols = columns(shown, cardInnerWidth(width), now);
	const listed = options.collapsed ? [shown[0]] : shown;
	const hint = options.collapsed && options.collapseKey ? `${options.collapseKey} expand` : batchElapsed(shown, now);
	return renderCard(
		{ title: "Agents", subtitle: counts(shown), body: listed.flatMap((task) => row(task, theme, cols, now)), tone: tone(shown), glyph: AGENTS_GLYPH },
		theme,
		width,
		{ expanded: true, hint },
	);
}
