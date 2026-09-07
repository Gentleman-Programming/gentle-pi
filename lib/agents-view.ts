import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { createNativePointerScope, type NativePointerRegion } from "./native-pointer-region.ts";
import { isFinished, TASK_STATUS, THREAD_ITEM, type TaskRecord, type TaskStore, type TaskThread, type ThreadItem, type ToolItem } from "./agents-protocol.ts";
import { formatElapsed } from "./agents-widget.ts";
import { formatTokens } from "./shell-bar.ts";

// Gentle Agents overlay: tasks on the left, the selected task's thread on
// the right. Only the selected task is subscribed, thread items are rendered
// once each (they are immutable until replaced), and the viewport shows the
// tail unless the human scrolls up. The list opens on the active session's
// work (active tasks plus those finished in the last quarter hour); `a`
// widens it to every task of every session, including the stored history.

export interface AgentsViewTheme {
	fg(color: string, text: string): string;
}

export const VIEW_SCOPE = {
	SESSION: "session",
	ALL: "all",
} as const;

export type ViewScope = (typeof VIEW_SCOPE)[keyof typeof VIEW_SCOPE];

export interface AgentsViewDeps {
	theme: AgentsViewTheme;
	rows: number;
	store: TaskStore;
	// The active session; without it there is nothing to scope by and the
	// list shows every task.
	sessionId?: string;
	now(): number;
	onCancel(task: TaskRecord): void;
	canCancel?(task: TaskRecord): boolean;
	onOpen(task: TaskRecord): void;
	onClose(): void;
	requestRender(): void;
}

const ROLE = {
	FRAME: "border",
	TITLE: "customMessageLabel",
	SELECTED: "accent",
	NAME: "text",
	NAME_IDLE: "muted",
	META: "dim",
	TEXT: "text",
	THINKING: "dim",
	TOOL: "accent",
	TOOL_ERROR: "error",
	OUTPUT: "muted",
	NOTE: "muted",
	NOTE_ERROR: "warning",
	KEY: "accent",
	KEY_TEXT: "dim",
	EMPTY: "dim",
} as const;

const GLYPH: Record<string, string> = {
	[TASK_STATUS.QUEUED]: "○",
	[TASK_STATUS.RUNNING]: "◐",
	[TASK_STATUS.WAITING]: "?",
	[TASK_STATUS.COMPLETED]: "✓",
	[TASK_STATUS.FAILED]: "✗",
	[TASK_STATUS.CANCELLED]: "–",
	[TASK_STATUS.TIMED_OUT]: "✗",
};
const GLYPH_ROLE: Record<string, string> = {
	[TASK_STATUS.QUEUED]: "muted",
	[TASK_STATUS.RUNNING]: "accent",
	[TASK_STATUS.WAITING]: "warning",
	[TASK_STATUS.COMPLETED]: "success",
	[TASK_STATUS.FAILED]: "error",
	[TASK_STATUS.CANCELLED]: "dim",
	[TASK_STATUS.TIMED_OUT]: "error",
};
const LIST_MAX_WIDTH = 34;
const LIST_RATIO = 0.32;
const CHROME_ROWS = 3;
const MIN_BODY_ROWS = 1;
export const SESSION_FINISHED_TTL_MS = 15 * 60_000;
const SCOPE_LABEL: Record<ViewScope, string> = { [VIEW_SCOPE.SESSION]: "this session", [VIEW_SCOPE.ALL]: "all sessions" };
const SCOPE_KEY: Record<ViewScope, string> = { [VIEW_SCOPE.SESSION]: "all sessions", [VIEW_SCOPE.ALL]: "this session" };
const EMPTY_LIST = "no tasks yet";
const EMPTY_THREAD = "waiting for the first event";
const KEYS = [
	["j/k", "task"],
	["ctrl+j/k", "scroll"],
	["f", "follow"],
	["o", "open session"],
	["esc", "close"],
] as const;

const EMPTY_COMPONENT: Component = {
	render: () => [],
	invalidate() {},
};

interface PointerLayout {
	width: number;
	height: number;
	listX: number;
	listWidth: number;
	threadX: number;
	threadWidth: number;
	bodyRows: number;
}

function rule(length: number): string {
	return "─".repeat(Math.max(0, length));
}

function fit(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function argsSummary(item: ToolItem): string {
	const values = Object.values(item.args).filter((value) => typeof value === "string") as string[];
	return (values[0] ?? "").replace(/\s+/g, " ").trim();
}

function toolLines(item: ToolItem, theme: AgentsViewTheme, width: number): string[] {
	const role = item.isError ? ROLE.TOOL_ERROR : ROLE.TOOL;
	const head = truncateToWidth(`▸ ${item.name} ${argsSummary(item)}`, width, "…");
	const lines = [theme.fg(role, head)];
	// The whole captured output, wrapped: the thread pane scrolls, so nothing
	// is hidden here. The store already keeps only the last maxOutputChars of a
	// tool's output and marks the cut with a leading ellipsis.
	for (const line of item.output.split("\n").filter((line) => line.length > 0)) {
		for (const wrapped of wrapTextWithAnsi(line, Math.max(1, width - 2))) lines.push(theme.fg(ROLE.OUTPUT, `  ${wrapped}`));
	}
	if (item.running) lines.push(theme.fg(ROLE.META, "  …"));
	return lines;
}

function thinkingLines(text: string, theme: AgentsViewTheme, width: number): string[] {
	const lines: string[] = [];
	for (const [index, line] of text.split("\n").filter((line) => line.length > 0).entries()) {
		const prefix = index === 0 ? "∴ " : "  ";
		for (const wrapped of wrapTextWithAnsi(line, Math.max(1, width - 2))) lines.push(theme.fg(ROLE.THINKING, `${prefix}${wrapped}`));
	}
	return lines;
}

export function itemLines(item: ThreadItem, theme: AgentsViewTheme, width: number): string[] {
	switch (item.kind) {
		case THREAD_ITEM.TEXT:
			return wrapTextWithAnsi(item.text, width).map((line) => theme.fg(ROLE.TEXT, line));
		case THREAD_ITEM.THINKING:
			return thinkingLines(item.text, theme, width);
		case THREAD_ITEM.TOOL:
			return toolLines(item, theme, width);
		case THREAD_ITEM.NOTE:
			return [theme.fg(item.text.startsWith("error") ? ROLE.NOTE_ERROR : ROLE.NOTE, truncateToWidth(`· ${item.text}`, width, "…"))];
		default:
			return [];
	}
}

export function taskHeader(task: TaskRecord, now: number): string {
	const parts = [task.agent, task.status, task.model, task.tokens > 0 ? formatTokens(task.tokens) : "", task.cost > 0 ? `$${task.cost.toFixed(2)}` : "", task.startedAt === null ? "" : formatElapsed((task.endedAt ?? now) - task.startedAt)];
	return parts.filter((part) => part.length > 0).join(" · ");
}

export class AgentsView {
	private readonly deps: AgentsViewDeps;
	private tasks: TaskRecord[] = [];
	private selected = 0;
	private hovered: number | undefined;
	private listScroll = 0;
	private scope: ViewScope;
	private scroll = 0;
	private follow = true;
	private readonly pointerScope = createNativePointerScope();
	private readonly taskRegions = new Map<number, NativePointerRegion>();
	private readonly listRegion: NativePointerRegion;
	private readonly threadRegion: NativePointerRegion;
	private pointerLayout: PointerLayout | undefined;
	private unsubscribeTask: (() => void) | undefined;
	private readonly unsubscribeSummary: () => void;
	private cache = new WeakMap<ThreadItem, string[]>();
	private cacheWidth = -1;

	constructor(deps: AgentsViewDeps) {
		this.deps = deps;
		this.scope = deps.sessionId === undefined ? VIEW_SCOPE.ALL : VIEW_SCOPE.SESSION;
		this.listRegion = this.pointerScope.wrap(EMPTY_COMPONENT, {
			onWheel: (event) => this.wheelList(event),
		});
		this.threadRegion = this.pointerScope.wrap(EMPTY_COMPONENT, {
			onWheel: (event) => this.wheelThread(event),
		});
		this.refreshTasks();
		this.unsubscribeSummary = deps.store.subscribeSummary(() => {
			this.pointerScope.invalidate();
			this.refreshTasks();
			this.deps.requestRender();
		});
		this.subscribeSelected();
	}

	dispose(): void {
		this.pointerLayout = undefined;
		this.pointerScope.dispose();
		this.unsubscribeTask?.();
		this.unsubscribeSummary();
	}

	mouseObserver(): ReturnType<typeof this.pointerScope.createMouseObserver> {
		return this.pointerScope.createMouseObserver(() => this.deps.requestRender());
	}

	selectedTask(): TaskRecord | undefined {
		return this.tasks[this.selected];
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || data === "q") {
			this.deps.onClose();
			return;
		}
		const task = this.selectedTask();
		if (data === "j" || matchesKey(data, Key.down)) this.select(this.selected + 1);
		else if (data === "k" || matchesKey(data, Key.up)) this.select(this.selected - 1);
		else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("j"))) this.scrollBy(this.pageRows());
		else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("k"))) this.scrollBy(-this.pageRows());
		else if (data === "f") {
			this.follow = true;
			this.deps.requestRender();
		} else if (data === "a" && this.deps.sessionId !== undefined) this.toggleScope();
		else if ((data === "s" || data === "c") && task && this.canCancel(task)) this.deps.onCancel(task);
		else if ((data === "o" || matchesKey(data, Key.enter)) && task) this.deps.onOpen(task);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const layout = this.pointerLayout;
		if (!layout || event.x < 0 || event.y < 0 || event.x >= layout.width || event.y >= layout.height) return undefined;
		if (event.y >= 1 && event.y < 1 + layout.bodyRows) {
			const row = event.y - 1;
			if (event.x >= layout.listX && event.x < layout.listX + layout.listWidth) {
				if (event.type === "wheel") return this.listRegion.handleMouse(event);
				const task = this.tasks[this.listScroll + row];
				return task ? this.taskRegion(row).handleMouse(event) : undefined;
			}
			if (event.x >= layout.threadX && event.x < layout.threadX + layout.threadWidth && event.type === "wheel") {
				return this.threadRegion.handleMouse(event);
			}
		}
		return undefined;
	}

	render(width: number): string[] {
		// Finished rows age out of the session scope while the overlay is open;
		// the list is otherwise reordered only when a status changes.
		const now = this.deps.now();
		if (this.tasks.some((task) => !this.inScope(task, now))) this.refreshTasks();
		const theme = this.deps.theme;
		const inner = width - 2;
		const listWidth = Math.min(LIST_MAX_WIDTH, Math.floor(inner * LIST_RATIO));
		const threadWidth = inner - listWidth - 4;
		const rows = this.bodyRows();
		this.followSelection(rows);
		this.pointerLayout = { width, height: rows + CHROME_ROWS, listX: 2, listWidth, threadX: listWidth + 5, threadWidth, bodyRows: rows };
		this.listRegion.render(listWidth);
		this.threadRegion.render(threadWidth);
		const scope = this.deps.sessionId === undefined ? "" : `${SCOPE_LABEL[this.scope]} · `;
		const title = `❀ Agents · ${scope}${this.counts()}`;
		const top = theme.fg(ROLE.FRAME, "╭─ ") + theme.fg(ROLE.TITLE, title) + theme.fg(ROLE.FRAME, ` ${rule(inner - visibleWidth(title) - 3)}╮`);
		const right = this.threadWindow(rows, threadWidth);
		const body: string[] = [];
		for (let row = 0; row < rows; row += 1) {
			body.push(`${theme.fg(ROLE.FRAME, "│")} ${fit(this.taskLine(row), listWidth)} ${theme.fg(ROLE.FRAME, "│")} ${fit(right[row] ?? "", threadWidth)}${theme.fg(ROLE.FRAME, "│")}`);
		}
		const keys = this.keys().map(([key, label]) => `${theme.fg(ROLE.KEY, key)} ${theme.fg(ROLE.KEY_TEXT, label)}`).join("   ");
		const keysLine = `${theme.fg(ROLE.FRAME, "│")} ${fit(keys, inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`;
		return [top, ...body, keysLine, theme.fg(ROLE.FRAME, `╰${rule(inner)}╯`)];
	}

	invalidate(): void {
		this.pointerScope.invalidate();
	}

	private counts(): string {
		const active = this.tasks.filter((task) => !isFinished(task.status)).length;
		return `${active} active · ${this.tasks.length - active} finished`;
	}

	private canCancel(task: TaskRecord): boolean {
		return !isFinished(task.status) && (this.deps.canCancel?.(task) ?? true);
	}

	private keys(): ReadonlyArray<readonly [string, string]> {
		const task = this.selectedTask();
		const stop = task && this.canCancel(task) ? [["s", "Stop selected"]] as const : [];
		const scope = this.deps.sessionId === undefined ? [] : [["a", SCOPE_KEY[this.scope]]] as const;
		return [...KEYS.slice(0, 3), ...stop, ...scope, ...KEYS.slice(3)];
	}

	// A new scope reads from the top: selection, list window, and thread reset.
	private toggleScope(): void {
		this.scope = this.scope === VIEW_SCOPE.SESSION ? VIEW_SCOPE.ALL : VIEW_SCOPE.SESSION;
		this.tasks = [];
		this.selected = 0;
		this.listScroll = 0;
		this.hovered = undefined;
		this.scroll = 0;
		this.follow = true;
		this.refreshTasks();
		this.deps.requestRender();
	}

	// The session scope: this session's active tasks plus those that finished
	// within the last quarter hour. Everything else waits under "all sessions".
	private inScope(task: TaskRecord, now: number): boolean {
		if (this.scope === VIEW_SCOPE.ALL) return true;
		if (task.parentSessionId !== this.deps.sessionId) return false;
		return !isFinished(task.status) || task.endedAt === null || now - task.endedAt < SESSION_FINISHED_TTL_MS;
	}

	// Keep the selected row inside the list window, moving the window by the
	// least amount needed; the wheel moves the same window on its own.
	private followSelection(rows: number): void {
		if (this.selected < this.listScroll) this.listScroll = this.selected;
		else if (this.selected >= this.listScroll + rows) this.listScroll = this.selected - rows + 1;
		this.listScroll = Math.max(0, Math.min(this.listScroll, Math.max(0, this.tasks.length - rows)));
	}

	private bodyRows(): number {
		return Math.max(MIN_BODY_ROWS, this.deps.rows - CHROME_ROWS);
	}

	private refreshTasks(): void {
		const selectedId = this.tasks[this.selected]?.id;
		const now = this.deps.now();
		this.tasks = this.deps.store.list().filter((task) => this.inScope(task, now));
		const index = this.tasks.findIndex((task) => task.id === selectedId);
		this.selected = index === -1 ? Math.max(0, Math.min(this.selected, this.tasks.length - 1)) : index;
		this.listScroll = Math.max(0, Math.min(this.listScroll, Math.max(0, this.tasks.length - this.bodyRows())));
		if (this.hovered !== undefined && !this.tasks[this.hovered]) this.hovered = undefined;
		if (index === -1) this.subscribeSelected();
	}

	private subscribeSelected(): void {
		this.unsubscribeTask?.();
		const task = this.selectedTask();
		this.unsubscribeTask = task ? this.deps.store.subscribe(task.id, () => {
			this.pointerScope.invalidate();
			this.deps.requestRender();
		}) : undefined;
	}

	private taskLine(row: number): string {
		if (this.tasks.length === 0) return row === 0 ? this.deps.theme.fg(ROLE.EMPTY, EMPTY_LIST) : "";
		const index = this.listScroll + row;
		const task = this.tasks[index];
		if (!task) return "";
		const theme = this.deps.theme;
		this.taskRegion(row).render(this.pointerLayout?.listWidth ?? 1);
		const marker = index === this.selected ? theme.fg(ROLE.SELECTED, "▸") : index === this.hovered ? theme.fg(ROLE.SELECTED, "▹") : " ";
		const glyph = theme.fg(GLYPH_ROLE[task.status], GLYPH[task.status]);
		const name = theme.fg(index === this.selected || index === this.hovered ? ROLE.NAME : ROLE.NAME_IDLE, task.agent);
		const time = task.startedAt === null ? "" : theme.fg(ROLE.META, formatElapsed((task.endedAt ?? this.deps.now()) - task.startedAt));
		return `${marker} ${glyph} ${name}  ${time}`;
	}

	private threadLines(thread: TaskThread, width: number): string[] {
		if (this.cacheWidth !== width) {
			this.cache = new WeakMap();
			this.cacheWidth = width;
		}
		const lines: string[] = [];
		if (thread.dropped > 0) lines.push(this.deps.theme.fg(ROLE.META, `… ${thread.dropped} earlier items not kept`));
		for (const item of thread.items) {
			let rendered = this.cache.get(item);
			if (!rendered) {
				rendered = itemLines(item, this.deps.theme, width);
				this.cache.set(item, rendered);
			}
			lines.push(...rendered);
		}
		return lines;
	}

	private threadWindow(rows: number, width: number): string[] {
		const task = this.selectedTask();
		if (!task) return [];
		const theme = this.deps.theme;
		const header = theme.fg(ROLE.META, truncateToWidth(taskHeader(task, this.deps.now()), width, "…"));
		const lines = this.threadLines(this.deps.store.thread(task.id), width);
		if (lines.length === 0) return [header, theme.fg(ROLE.EMPTY, task.error ?? EMPTY_THREAD)];
		const visible = rows - 1;
		const maxScroll = Math.max(0, lines.length - visible);
		this.scroll = this.follow ? maxScroll : Math.min(this.scroll, maxScroll);
		return [header, ...lines.slice(this.scroll, this.scroll + visible)];
	}

	private select(index: number): void {
		const next = Math.max(0, Math.min(this.tasks.length - 1, index));
		if (next === this.selected) return;
		this.selected = next;
		this.scroll = 0;
		this.follow = true;
		this.subscribeSelected();
		this.deps.requestRender();
	}

	// One page is the thread area: the body minus its header row.
	private pageRows(): number {
		return Math.max(1, this.bodyRows() - 1);
	}

	private scrollBy(delta: number): void {
		this.follow = false;
		this.scroll = Math.max(0, this.scroll + delta);
		this.deps.requestRender();
	}

	private taskRegion(row: number): NativePointerRegion {
		let region = this.taskRegions.get(row);
		if (!region) {
			region = this.pointerScope.wrap(EMPTY_COMPONENT, {
				onHover: () => this.hoverTask(row),
				onLeave: () => this.clearHoveredTask(row),
				onClick: (event) => this.clickTask(row, event),
			});
			this.taskRegions.set(row, region);
		}
		return region;
	}

	private hoverTask(row: number): TuiMouseEventResult | undefined {
		const index = this.listScroll + row;
		if (!this.tasks[index] || this.hovered === index) return { handled: true };
		this.hovered = index;
		return { handled: true, render: true };
	}

	private clearHoveredTask(row: number): void {
		if (this.hovered !== this.listScroll + row) return;
		this.hovered = undefined;
		this.deps.requestRender();
	}

	private clickTask(row: number, event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		this.select(this.listScroll + row);
		return { handled: true, render: true };
	}

	private wheelList(event: TuiMouseEvent): TuiMouseEventResult {
		const delta = event.wheelDelta ?? 0;
		const next = Math.max(0, Math.min(Math.max(0, this.tasks.length - this.bodyRows()), this.listScroll + delta));
		if (next === this.listScroll) return { handled: true, render: false };
		this.listScroll = next;
		this.hovered = undefined;
		return { handled: true, render: true };
	}

	private wheelThread(event: TuiMouseEvent): TuiMouseEventResult {
		const delta = event.wheelDelta ?? 0;
		if (delta === 0) return { handled: true, render: false };
		this.scrollBy(delta);
		return { handled: true, render: true };
	}
}
