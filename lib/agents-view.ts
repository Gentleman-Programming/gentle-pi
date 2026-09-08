import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { measureAgentsViewLayout, type AgentsViewLayout } from "./agents-view-layout.ts";
import { isFinished, TASK_STATUS, type TaskRecord, type TaskStore, type TaskThread, type ThreadItem } from "./agents-protocol.ts";
import { renderThreadItem, type AgentsThreadTheme } from "./agents-thread-view.ts";
import { formatElapsed } from "./agents-widget.ts";
import { createNativePointerScope, type NativePointerRegion } from "./native-pointer-region.ts";
import { formatTokens } from "./shell-bar.ts";

// Gentle Agents overlay: tasks on the left, the selected task's thread on
// the right. Only the selected task is subscribed, thread items are rendered
// once each (they are immutable until replaced), and the viewport shows the
// tail unless the human scrolls up. The list opens on the active session's
// work (active tasks plus those finished in the last quarter hour); `a`
// widens it to every task of every session, including the stored history.

export interface AgentsViewTheme extends AgentsThreadTheme {}

export const VIEW_SCOPE = {
	SESSION: "session",
	ALL: "all",
} as const;

export type ViewScope = (typeof VIEW_SCOPE)[keyof typeof VIEW_SCOPE];

export interface AgentsViewDeps {
	theme: AgentsViewTheme;
	rows: number | (() => number);
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
	HOVER: "warning",
	NAME: "text",
	NAME_IDLE: "muted",
	META: "dim",
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
export const SESSION_FINISHED_TTL_MS = 15 * 60_000;
const SCOPE_LABEL: Record<ViewScope, string> = { [VIEW_SCOPE.SESSION]: "this session", [VIEW_SCOPE.ALL]: "all sessions" };
const SCOPE_KEY: Record<ViewScope, string> = { [VIEW_SCOPE.SESSION]: "all sessions", [VIEW_SCOPE.ALL]: "this session" };
const EMPTY_LIST = "no tasks yet";
const EMPTY_THREAD = "waiting for the first event";
const FOLLOW_BUTTON = "[ Follow ]";
const OPEN_BUTTON = "[ Open session ]";
const CLOSE_BUTTON = "[× Close]";
const FOOTER_BUTTONS_WIDTH = FOLLOW_BUTTON.length + 1 + OPEN_BUTTON.length;
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

interface PointerButtonLayout {
	x: number;
	width: number;
}

interface PointerLayout extends AgentsViewLayout {
	closeButton?: PointerButtonLayout;
	followButton?: PointerButtonLayout;
	openButton?: PointerButtonLayout;
}

interface SessionGroup {
	id: string;
	sessionId: string | undefined;
	tasks: TaskRecord[];
}

type VisibleRow =
	| { id: string; kind: "heading"; group: SessionGroup }
	| { id: string; kind: "task"; group: SessionGroup; task: TaskRecord };

function rule(length: number): string {
	return "─".repeat(Math.max(0, length));
}

function fit(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export function taskHeader(task: TaskRecord, now: number): string {
	const parts = [task.agent, task.status, task.model, task.tokens > 0 ? formatTokens(task.tokens) : "", task.cost > 0 ? `$${task.cost.toFixed(2)}` : "", task.startedAt === null ? "" : formatElapsed((task.endedAt ?? now) - task.startedAt)];
	return parts.filter((part) => part.length > 0).join(" · ");
}

export class AgentsView {
	private readonly deps: AgentsViewDeps;
	private tasks: TaskRecord[] = [];
	private selectedId: string | undefined;
	private hoveredId: string | undefined;
	private readonly expanded = new Map<string, boolean>();
	private listScroll = 0;
	private scope: ViewScope;
	private scroll = 0;
	private follow = true;
	private readonly pointerScope = createNativePointerScope();
	private readonly taskRegions = new Map<number, NativePointerRegion>();
	private readonly listRegion: NativePointerRegion;
	private readonly threadRegion: NativePointerRegion;
	private readonly followRegion: NativePointerRegion;
	private readonly openRegion: NativePointerRegion;
	private readonly closeRegion: NativePointerRegion;
	private hoveredControl: "follow" | "open" | "close" | undefined;
	private pointerLayout: PointerLayout | undefined;
	private closed = false;
	private unsubscribeTask: (() => void) | undefined;
	private subscribedTaskId: string | undefined;
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
		this.followRegion = this.pointerScope.wrap(EMPTY_COMPONENT, {
			onHover: () => this.hoverControl("follow"),
			onLeave: () => this.clearHoveredControl("follow"),
			onClick: (event) => this.clickFollow(event),
		});
		this.openRegion = this.pointerScope.wrap(EMPTY_COMPONENT, {
			onHover: () => this.hoverControl("open"),
			onLeave: () => this.clearHoveredControl("open"),
			onClick: (event) => this.clickOpen(event),
		});
		this.closeRegion = this.pointerScope.wrap(EMPTY_COMPONENT, {
			onHover: () => this.hoverControl("close"),
			onLeave: () => this.clearHoveredControl("close"),
			onClick: (event) => this.clickClose(event),
		});
		this.refreshTasks();
		this.unsubscribeSummary = deps.store.subscribeSummary(() => {
			this.clearFooterLayout();
			this.refreshTasks();
			this.deps.requestRender();
		});
		this.subscribeSelected();
	}

	dispose(): void {
		this.closed = true;
		this.pointerLayout = undefined;
		this.pointerScope.dispose();
		this.unsubscribeTask?.();
		this.unsubscribeTask = undefined;
		this.subscribedTaskId = undefined;
		this.unsubscribeSummary();
	}

	mouseObserver(): ReturnType<typeof this.pointerScope.createMouseObserver> {
		return this.pointerScope.createMouseObserver(() => this.deps.requestRender());
	}

	selectedTask(): TaskRecord | undefined {
		const row = this.selectedRow();
		return row?.kind === "task" ? row.task : undefined;
	}

	handleInput(data: string): void {
		if (this.closed) return;
		if (matchesKey(data, Key.escape) || data === "q") {
			this.close();
			return;
		}
		const rows = this.visibleRows();
		const selected = this.selectedRow(rows);
		const index = selected ? rows.findIndex((row) => row.id === selected.id) : -1;
		if (data === "j" || matchesKey(data, Key.down)) this.select(index + 1, rows);
		else if (data === "k" || matchesKey(data, Key.up)) this.select(index - 1, rows);
		else if (matchesKey(data, Key.left) && selected?.kind === "heading") this.setExpanded(selected.group, false);
		else if (matchesKey(data, Key.right) && selected?.kind === "heading") this.setExpanded(selected.group, true);
		else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("j"))) this.scrollBy(this.pageRows());
		else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("k"))) this.scrollBy(-this.pageRows());
		else if (data === "f" && selected?.kind === "task") {
			this.follow = true;
			this.deps.requestRender();
		} else if (data === "a" && this.deps.sessionId !== undefined) this.toggleScope();
		else if ((data === "s" || data === "c") && selected?.kind === "task" && this.canCancel(selected.task)) this.deps.onCancel(selected.task);
		else if ((data === "o" || matchesKey(data, Key.enter)) && selected?.kind === "task" && this.canOpen(selected.task)) this.deps.onOpen(selected.task);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const layout = this.pointerLayout;
		if (this.closed || !layout || event.width !== layout.width || event.height !== layout.height || event.x < 0 || event.y < 0 || event.x >= layout.width || event.y >= layout.height) return undefined;
		const live = this.layout(layout.width);
		if (live.mode !== "panes" || live.height !== layout.height) return undefined;
		if (event.y === 0 && this.isInButton(event.x, layout.closeButton)) return this.closeRegion.handleMouse(event);
		if (event.y >= 1 && event.y < 1 + layout.bodyRows) {
			const row = event.y - 1;
			if (event.x >= layout.listX && event.x < layout.listX + layout.listWidth) {
				if (event.type === "wheel") return this.listRegion.handleMouse(event);
				const visible = this.visibleRows()[this.listScroll + row];
				return visible ? this.taskRegion(row).handleMouse(event) : undefined;
			}
			if (event.x >= layout.threadX && event.x < layout.threadX + layout.threadWidth && event.type === "wheel") {
				return this.threadRegion.handleMouse(event);
			}
		}
		if (event.y === layout.footerY) {
			if (this.isInButton(event.x, layout.followButton)) return this.followRegion.handleMouse(event);
			if (this.isInButton(event.x, layout.openButton)) return this.openRegion.handleMouse(event);
		}
		return undefined;
	}

	render(width: number): string[] {
		const layout = this.layout(width);
		if (layout.width === 0 || layout.height === 0) {
			this.clearFooterLayout();
			return [];
		}
		if (layout.mode === "fallback") {
			this.clearFooterLayout();
			return [fit("Agents", layout.width)];
		}
		// Finished rows age out of the session scope while the overlay is open;
		// the list is otherwise reordered only when a status changes.
		const now = this.deps.now();
		if (this.tasks.some((task) => !this.inScope(task, now))) this.refreshTasks();
		if (this.pointerLayout && (this.pointerLayout.width !== layout.width || this.pointerLayout.height !== layout.height)) this.clearFooterLayout();
		const theme = this.deps.theme;
		const inner = layout.width - 2;
		const closeLabel = this.closeLabel();
		this.closeRegion.setDisabled(closeLabel === undefined);
		this.followSelection(layout.bodyRows);
		this.pointerLayout = {
			...layout,
			closeButton: closeLabel ? { x: layout.width - 1 - visibleWidth(closeLabel), width: visibleWidth(closeLabel) } : undefined,
		};
		this.listRegion.render(layout.listWidth);
		this.threadRegion.render(layout.threadWidth);
		if (closeLabel) this.closeRegion.render(visibleWidth(closeLabel));
		const scope = this.deps.sessionId === undefined ? "" : `${SCOPE_LABEL[this.scope]} · `;
		const title = truncateToWidth(`❀ Agents · ${scope}${this.counts()}`, Math.max(0, inner - 3 - (closeLabel ? visibleWidth(closeLabel) + 1 : 0)), "…");
		const close = closeLabel ? ` ${theme.fg(this.hoveredControl === "close" ? "warning" : ROLE.KEY, closeLabel)}` : "";
		const top = theme.fg(ROLE.FRAME, "╭─ ") + theme.fg(ROLE.TITLE, title) + theme.fg(ROLE.FRAME, ` ${rule(inner - visibleWidth(title) - 3 - (closeLabel ? visibleWidth(closeLabel) + 1 : 0))}`) + close + theme.fg(ROLE.FRAME, "╮");
		const right = this.threadWindow(layout.bodyRows, layout.threadWidth);
		const body: string[] = [];
		for (let row = 0; row < layout.bodyRows; row += 1) {
			body.push(`${theme.fg(ROLE.FRAME, "│")} ${fit(this.taskLine(row), layout.listWidth)} ${theme.fg(ROLE.FRAME, "│")} ${fit(right[row] ?? "", layout.threadWidth)}${theme.fg(ROLE.FRAME, "│")}`);
		}
		const keyHints = this.selectedRow()?.kind === "heading" ? [["←/→", "group"] as const, ...this.keys()] : this.keys();
		const keys = keyHints.map(([key, label]) => `${theme.fg(ROLE.KEY, key)} ${theme.fg(ROLE.KEY_TEXT, label)}`).join("   ");
		const footer = this.footer(keys, inner - 2);
		const keysLine = `${theme.fg(ROLE.FRAME, "│")} ${fit(footer, inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`;
		return [top, ...body, keysLine, theme.fg(ROLE.FRAME, `╰${rule(inner)}╯`)];
	}

	invalidate(): void {
		this.clearFooterLayout();
	}

	private counts(): string {
		const active = this.tasks.filter((task) => !isFinished(task.status)).length;
		return `${active} active · ${this.tasks.length - active} finished`;
	}

	private canCancel(task: TaskRecord): boolean {
		return !isFinished(task.status) && (this.deps.canCancel?.(task) ?? true);
	}

	private canOpen(task: TaskRecord | undefined): boolean {
		return Boolean(task?.sessionPath);
	}

	private keys(): ReadonlyArray<readonly [string, string]> {
		const task = this.selectedTask();
		const stop = task && this.canCancel(task) ? [["s", "Stop selected"]] as const : [];
		const scope = this.deps.sessionId === undefined ? [] : [["a", SCOPE_KEY[this.scope]]] as const;
		return [...KEYS.slice(0, 3), ...stop, ...scope, ...KEYS.slice(3)];
	}

	// A new scope reads from the top: selection, list window, and thread reset.
	private toggleScope(): void {
		this.clearFooterLayout();
		this.scope = this.scope === VIEW_SCOPE.SESSION ? VIEW_SCOPE.ALL : VIEW_SCOPE.SESSION;
		this.tasks = [];
		this.selectedId = undefined;
		this.listScroll = 0;
		this.hoveredId = undefined;
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
		const selected = this.selectedRow();
		const index = selected ? this.visibleRows().findIndex((row) => row.id === selected.id) : -1;
		if (index >= 0 && index < this.listScroll) this.listScroll = index;
		else if (index >= this.listScroll + rows) this.listScroll = index - rows + 1;
		this.listScroll = Math.max(0, Math.min(this.listScroll, Math.max(0, this.visibleRows().length - rows)));
	}

	private layout(width = this.pointerLayout?.width ?? 80): AgentsViewLayout {
		const rows = typeof this.deps.rows === "function" ? this.deps.rows() : this.deps.rows;
		return measureAgentsViewLayout(width, rows);
	}

	private bodyRows(): number {
		return this.layout().bodyRows;
	}

	private refreshTasks(): void {
		const now = this.deps.now();
		this.tasks = this.deps.store.list().filter((task) => this.inScope(task, now));
		const rows = this.visibleRows();
		if (!this.selectedId || !rows.some((row) => row.id === this.selectedId)) {
			this.selectedId = rows.find((row) => row.kind === "task")?.id ?? rows[0]?.id;
		}
		this.listScroll = Math.max(0, Math.min(this.listScroll, Math.max(0, rows.length - this.bodyRows())));
		if (this.hoveredId && !rows.some((row) => row.id === this.hoveredId)) this.hoveredId = undefined;
		this.subscribeSelected();
	}

	private sessionGroups(): SessionGroup[] {
		const groups = new Map<string, SessionGroup>();
		for (const task of this.tasks) {
			const sessionId = task.parentSessionId.trim() || undefined;
			const id = sessionId ? `session:${sessionId}` : `unknown:${task.id}`;
			const group = groups.get(id) ?? { id, sessionId, tasks: [] };
			if (!groups.has(id)) groups.set(id, group);
			group.tasks.push(task);
		}
		return [...groups.values()];
	}

	private visibleRows(): VisibleRow[] {
		const rows: VisibleRow[] = [];
		for (const group of this.sessionGroups()) {
			rows.push({ id: `heading:${group.id}`, kind: "heading", group });
			if (this.isExpanded(group)) {
				for (const task of group.tasks) rows.push({ id: `task:${task.id}`, kind: "task", group, task });
			}
		}
		return rows;
	}

	private selectedRow(rows = this.visibleRows()): VisibleRow | undefined {
		return rows.find((row) => row.id === this.selectedId);
	}

	private isExpanded(group: SessionGroup): boolean {
		return this.expanded.get(group.id) ?? group.tasks.some((task) => !isFinished(task.status));
	}

	private setExpanded(group: SessionGroup, expanded: boolean): void {
		if (this.isExpanded(group) === expanded) return;
		this.expanded.set(group.id, expanded);
		if (!expanded) this.selectedId = `heading:${group.id}`;
		this.listScroll = Math.min(this.listScroll, Math.max(0, this.visibleRows().length - this.bodyRows()));
		this.subscribeSelected();
		this.deps.requestRender();
	}

	private subscribeSelected(): void {
		const task = this.selectedTask();
		if (task?.id === this.subscribedTaskId) return;
		this.unsubscribeTask?.();
		this.unsubscribeTask = undefined;
		this.subscribedTaskId = task?.id;
		if (!task) return;
		this.unsubscribeTask = this.deps.store.subscribe(task.id, () => {
			this.clearFooterLayout();
			this.refreshTasks();
			this.deps.requestRender();
		});
	}

	private taskLine(row: number): string {
		const visible = this.visibleRows();
		if (visible.length === 0) return row === 0 ? this.deps.theme.fg(ROLE.EMPTY, EMPTY_LIST) : "";
		const entry = visible[this.listScroll + row];
		if (!entry) return "";
		const theme = this.deps.theme;
		this.taskRegion(row).render(this.pointerLayout?.listWidth ?? 1);
		const selected = entry.id === this.selectedId;
		const hovered = entry.id === this.hoveredId;
		const emphasis = selected ? ROLE.SELECTED : hovered ? ROLE.HOVER : undefined;
		const marker = emphasis ? theme.fg(emphasis, selected ? "▸" : "▹") : " ";
		if (entry.kind === "heading") {
			const state = this.isExpanded(entry.group) ? "▾" : "▸";
			return `${marker}${theme.fg(emphasis ?? ROLE.SELECTED, state)} ${theme.fg(emphasis ?? ROLE.NAME_IDLE, this.groupHeading(entry.group))}`;
		}
		const task = entry.task;
		const glyph = theme.fg(GLYPH_ROLE[task.status] ?? ROLE.META, GLYPH[task.status] ?? "?");
		const name = theme.fg(emphasis ?? ROLE.NAME_IDLE, `Subagent ${task.agent}`);
		const time = task.startedAt === null ? "" : theme.fg(ROLE.META, formatElapsed((task.endedAt ?? this.deps.now()) - task.startedAt));
		return `${marker} ${theme.fg(ROLE.META, "└")} ${glyph} ${name}  ${time}`;
	}

	private groupHeading(group: SessionGroup): string {
		const count = `${group.tasks.length} ${group.tasks.length === 1 ? "Subagent" : "Subagents"}`;
		if (!this.isExpanded(group)) return `${this.groupTitle(group)} · ${count}`;
		const active = group.tasks.filter((task) => !isFinished(task.status)).length;
		return `${this.groupTitle(group)} · ${count} · ${active} active`;
	}

	private groupTitle(group: SessionGroup): string {
		if (!group.sessionId) return "Unknown session";
		if (group.sessionId === this.deps.sessionId) return "Current orchestrator";
		return `Orchestrator ${group.sessionId.slice(0, 8)}`;
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
				rendered = renderThreadItem(item, this.deps.theme, width);
				this.cache.set(item, rendered);
			}
			lines.push(...rendered);
		}
		return lines;
	}

	private threadWindow(rows: number, width: number): string[] {
		const task = this.selectedTask();
		if (!task) return [this.deps.theme.fg(ROLE.EMPTY, "Select a task to inspect its thread")];
		const theme = this.deps.theme;
		const header = theme.fg(ROLE.META, truncateToWidth(taskHeader(task, this.deps.now()), width, "…"));
		const lines = this.threadLines(this.deps.store.thread(task.id), width);
		if (lines.length === 0) return [header, theme.fg(ROLE.EMPTY, task.error ?? EMPTY_THREAD)];
		const visible = rows - 1;
		const maxScroll = Math.max(0, lines.length - visible);
		this.scroll = this.follow ? maxScroll : Math.min(this.scroll, maxScroll);
		return [header, ...lines.slice(this.scroll, this.scroll + visible)];
	}

	private select(index: number, rows = this.visibleRows()): void {
		const next = rows[Math.max(0, Math.min(rows.length - 1, index))];
		if (!next || next.id === this.selectedId) return;
		this.selectedId = next.id;
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

	private clearFooterLayout(): void {
		this.pointerLayout = undefined;
		this.hoveredControl = undefined;
		this.pointerScope.invalidate();
	}

	private footer(keys: string, width: number): string {
		const showButtons = visibleWidth(keys) + FOOTER_BUTTONS_WIDTH + 1 <= width;
		const task = this.selectedTask();
		this.followRegion.setDisabled(!showButtons || !task);
		this.openRegion.setDisabled(!showButtons || !this.canOpen(task));
		if (!showButtons) return keys;
		this.followRegion.render(FOLLOW_BUTTON.length);
		this.openRegion.render(OPEN_BUTTON.length);
		const buttonX = 2 + width - FOOTER_BUTTONS_WIDTH;
		if (this.pointerLayout) {
			this.pointerLayout.followButton = { x: buttonX, width: FOLLOW_BUTTON.length };
			this.pointerLayout.openButton = { x: buttonX + FOLLOW_BUTTON.length + 1, width: OPEN_BUTTON.length };
		}
		const followRole = task && this.hoveredControl === "follow" ? "warning" : task ? ROLE.KEY : ROLE.META;
		const openRole = this.canOpen(task) && this.hoveredControl === "open" ? "warning" : this.canOpen(task) ? ROLE.KEY : ROLE.META;
		return `${fit(keys, width - FOOTER_BUTTONS_WIDTH - 1)} ${this.deps.theme.fg(followRole, FOLLOW_BUTTON)} ${this.deps.theme.fg(openRole, OPEN_BUTTON)}`;
	}

	private closeLabel(): string {
		return CLOSE_BUTTON;
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		this.pointerScope.invalidate();
		this.deps.onClose();
	}

	private isInButton(x: number, button: PointerButtonLayout | undefined): boolean {
		return button !== undefined && x >= button.x && x < button.x + button.width;
	}

	private hoverControl(control: "follow" | "open" | "close"): TuiMouseEventResult {
		if (this.hoveredControl === control) return { handled: true };
		this.hoveredControl = control;
		return { handled: true, render: true };
	}

	private clearHoveredControl(control: "follow" | "open" | "close"): void {
		if (this.hoveredControl !== control) return;
		this.hoveredControl = undefined;
		this.deps.requestRender();
	}

	private clickFollow(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left" || !this.selectedTask()) return undefined;
		this.follow = true;
		return { handled: true, render: true };
	}

	private clickOpen(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		const task = this.selectedTask();
		if (!this.canOpen(task)) return undefined;
		this.deps.onOpen(task!);
		return { handled: true, render: true };
	}

	private clickClose(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		this.close();
		return { handled: true, render: true };
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
		const entry = this.visibleRows()[this.listScroll + row];
		if (!entry || this.hoveredId === entry.id) return { handled: true };
		this.hoveredId = entry.id;
		return { handled: true, render: true };
	}

	private clearHoveredTask(row: number): void {
		const entry = this.visibleRows()[this.listScroll + row];
		if (!entry || this.hoveredId !== entry.id) return;
		this.hoveredId = undefined;
		this.deps.requestRender();
	}

	private clickTask(row: number, event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		const entry = this.visibleRows()[this.listScroll + row];
		if (!entry) return undefined;
		if (entry.kind === "heading") this.setExpanded(entry.group, !this.isExpanded(entry.group));
		else this.select(this.listScroll + row);
		return { handled: true, render: true };
	}

	private wheelList(event: TuiMouseEvent): TuiMouseEventResult {
		const delta = event.wheelDelta ?? 0;
		const next = Math.max(0, Math.min(Math.max(0, this.visibleRows().length - this.bodyRows()), this.listScroll + delta));
		if (next === this.listScroll) return { handled: true, render: false };
		this.listScroll = next;
		this.hoveredId = undefined;
		return { handled: true, render: true };
	}

	private wheelThread(event: TuiMouseEvent): TuiMouseEventResult {
		const delta = event.wheelDelta ?? 0;
		if (delta === 0) return { handled: true, render: false };
		this.scrollBy(delta);
		return { handled: true, render: true };
	}
}
