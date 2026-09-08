import { Key, matchesKey, truncateToWidth, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { CHANGE_STATUS, changesSummary, type ChangedFile, type ChangesModel } from "./shell-changes.ts";

// Gentle Shell changes overlay: a framed two-pane view with the working
// tree's changed files on the left and the selected file's diff on the right.
// Git access is injected so the component renders without a repository.

export interface ChangesViewTheme {
	fg(color: string, text: string): string;
}

export interface ChangesViewDeps {
	theme: ChangesViewTheme;
	rows: number | (() => number);
	loadDiff(file: ChangedFile): Promise<string>;
	onOpen(file: ChangedFile): void;
	onClose(): void;
	requestRender(): void;
}

const ROLE = {
	FRAME: "border",
	TITLE: "customMessageLabel",
	SELECTED: "accent",
	PATH: "text",
	PATH_IDLE: "muted",
	ADDED: "success",
	REMOVED: "error",
	NEW: "success",
	HUNK: "customMessageLabel",
	KEY: "accent",
	KEY_TEXT: "dim",
	EMPTY: "dim",
} as const;

const HEADER_PREFIXES = ["diff --git", "index ", "--- ", "+++ ", "new file mode", "deleted file mode", "similarity index", "rename from", "rename to", "Binary files"];
const LIST_MAX_WIDTH = 36;
const LIST_RATIO = 0.35;
const CHROME_ROWS = 3;
const MIN_BODY_ROWS = 1;
const EMPTY_DIFF = "no diff for this file";
const CLEAN_TREE = "working tree is clean";
const KEYS = [
	["j/k", "file"],
	["ctrl+j/k", "scroll"],
	["o", "open in editor"],
	["esc", "close"],
] as const;

function rule(length: number): string {
	return "─".repeat(Math.max(0, length));
}

export function colorDiff(text: string, theme: ChangesViewTheme): string[] {
	const lines: string[] = [];
	for (const line of text.split("\n")) {
		if (line === "" || HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
		if (line.startsWith("@@")) lines.push(theme.fg(ROLE.HUNK, line));
		else if (line.startsWith("+")) lines.push(theme.fg("toolDiffAdded", line));
		else if (line.startsWith("-")) lines.push(theme.fg("toolDiffRemoved", line));
		else lines.push(theme.fg("toolDiffContext", line));
	}
	return lines;
}

function fileCounts(file: ChangedFile, theme: ChangesViewTheme): string {
	if (file.status === CHANGE_STATUS.UNTRACKED || file.status === CHANGE_STATUS.ADDED) {
		return `${theme.fg(ROLE.ADDED, `+${file.added}`)} ${theme.fg(ROLE.NEW, "new")}`;
	}
	return `${theme.fg(ROLE.ADDED, `+${file.added}`)} ${theme.fg(ROLE.REMOVED, `−${file.deleted}`)}`;
}

function fit(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function fingerprint(file: ChangedFile): string {
	return `${file.status}:${file.added}:${file.deleted}`;
}

interface PointerLayout {
	width: number;
	height: number;
	bodyRows: number;
	listStart: number;
	listEnd: number;
	diffStart: number;
	diffEnd: number;
}

export class ChangesView {
	private model: ChangesModel;
	private readonly deps: ChangesViewDeps;
	private selected = 0;
	private fileScroll = 0;
	private diffScroll = 0;
	private pointerLayout: PointerLayout | undefined;
	private disposed = false;
	private readonly diffs = new Map<string, string[]>();

	constructor(model: ChangesModel, deps: ChangesViewDeps) {
		this.model = model;
		this.deps = deps;
		this.loadSelected();
	}

	// Replace the model while open: keep the selection by path and drop cached
	// diffs for files whose counts moved so they reload.
	update(model: ChangesModel): void {
		if (this.disposed) return;
		this.pointerLayout = undefined;
		const selectedPath = this.model.files[this.selected]?.path;
		const before = new Map(this.model.files.map((file) => [file.path, fingerprint(file)]));
		for (const file of model.files) {
			if (before.get(file.path) !== fingerprint(file)) this.diffs.delete(file.path);
		}
		for (const path of this.diffs.keys()) {
			if (!model.files.some((file) => file.path === path)) this.diffs.delete(path);
		}
		this.model = model;
		const index = model.files.findIndex((file) => file.path === selectedPath);
		const selectionChanged = index === -1;
		this.selected = selectionChanged ? Math.max(0, Math.min(this.selected, model.files.length - 1)) : index;
		this.fileScroll = this.clampFileScroll(this.fileScroll, this.bodyRows());
		if (selectionChanged) this.ensureSelectedVisible();
		this.loadSelected();
		this.deps.requestRender();
	}

	dispose(): void {
		this.disposed = true;
		this.pointerLayout = undefined;
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		if (matchesKey(data, Key.escape) || data === "q") {
			this.deps.onClose();
			return;
		}
		// ctrl+j arrives as a bare line feed, which pi also reads as enter, so
		// the scroll keys are checked before the open key; a real Enter is CR.
		if (data === "j" || matchesKey(data, Key.down)) this.select(this.selected + 1);
		else if (data === "k" || matchesKey(data, Key.up)) this.select(this.selected - 1);
		else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("j"))) this.scrollBy(this.bodyRows());
		else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("k"))) this.scrollBy(-this.bodyRows());
		else if (data === "o" || matchesKey(data, Key.enter)) {
			const file = this.model.files[this.selected];
			if (file) this.deps.onOpen(file);
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.disposed) return { handled: true, render: false };
		const layout = this.pointerLayout;
		if (!layout || event.width !== layout.width || event.height !== layout.height) return { handled: true, render: false };
		const inBody = event.y >= 1 && event.y <= layout.bodyRows;
		const inFiles = inBody && event.x >= layout.listStart && event.x < layout.listEnd;
		const inDiff = inBody && event.x >= layout.diffStart && event.x < layout.diffEnd;
		if (event.type === "wheel") {
			if (inFiles) return { handled: true, render: this.scrollFiles(event.wheelDelta ?? 0, layout.bodyRows) };
			if (inDiff) return { handled: true, render: this.scrollDiff(event.wheelDelta ?? 0, layout.bodyRows) };
			return undefined;
		}
		if (!inFiles) return undefined;
		if (event.type === "press") return { handled: true, capture: true, render: false };
		if (event.type === "release") return { handled: true, render: false };
		if (event.type !== "click" || event.button !== "left") return undefined;
		const index = this.fileScroll + event.y - 1;
		if (index < 0 || index >= this.model.files.length) return { handled: true, render: false };
		const changed = index !== this.selected;
		this.select(index);
		return { handled: true, render: changed };
	}

	render(width: number): string[] {
		const theme = this.deps.theme;
		const inner = width - 2;
		const listWidth = Math.min(LIST_MAX_WIDTH, Math.floor(inner * LIST_RATIO));
		const diffWidth = inner - listWidth - 4;
		const titleText = `✎ Changes · ${changesSummary(this.model)}`;
		const top = theme.fg(ROLE.FRAME, "╭─ ") + theme.fg(ROLE.TITLE, titleText) + theme.fg(ROLE.FRAME, ` ${rule(inner - visibleWidth(titleText) - 3)}╮`);
		const rows = this.bodyRows();
		this.fileScroll = this.clampFileScroll(this.fileScroll, rows);
		const diff = this.visibleDiff(rows);
		const body: string[] = [];
		for (let row = 0; row < rows; row += 1) {
			const left = fit(this.fileLine(row), listWidth);
			const right = fit(diff[row] ?? "", diffWidth);
			body.push(`${theme.fg(ROLE.FRAME, "│")} ${left} ${theme.fg(ROLE.FRAME, "│")} ${right}${theme.fg(ROLE.FRAME, "│")}`);
		}
		const keys = KEYS.map(([key, label]) => `${theme.fg(ROLE.KEY, key)} ${theme.fg(ROLE.KEY_TEXT, label)}`).join("   ");
		const keysLine = `${theme.fg(ROLE.FRAME, "│")} ${fit(keys, inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`;
		const bottom = theme.fg(ROLE.FRAME, `╰${rule(inner)}╯`);
		this.pointerLayout = { width, height: rows + CHROME_ROWS, bodyRows: rows, listStart: 2, listEnd: 2 + listWidth, diffStart: 5 + listWidth, diffEnd: 5 + listWidth + diffWidth };
		return [top, ...body, keysLine, bottom];
	}

	invalidate(): void {
		this.pointerLayout = undefined;
	}

	private bodyRows(): number {
		const rows = typeof this.deps.rows === "function" ? this.deps.rows() : this.deps.rows;
		return Math.max(MIN_BODY_ROWS, rows - CHROME_ROWS);
	}

	private fileLine(row: number): string {
		const index = this.fileScroll + row;
		const file = this.model.files[index];
		if (!file) return "";
		const theme = this.deps.theme;
		const marker = index === this.selected ? theme.fg(ROLE.SELECTED, "▸") : " ";
		const path = theme.fg(index === this.selected ? ROLE.PATH : ROLE.PATH_IDLE, file.path);
		return `${marker} ${path}  ${fileCounts(file, theme)}`;
	}

	private visibleDiff(rows: number): string[] {
		const file = this.model.files[this.selected];
		if (!file) return [this.deps.theme.fg(ROLE.EMPTY, CLEAN_TREE)];
		const lines = this.diffs.get(file.path);
		if (!lines) return [];
		if (lines.length === 0) return [this.deps.theme.fg(ROLE.EMPTY, EMPTY_DIFF)];
		this.diffScroll = Math.min(this.diffScroll, Math.max(0, lines.length - rows));
		return lines.slice(this.diffScroll, this.diffScroll + rows);
	}

	private select(index: number): void {
		const next = Math.max(0, Math.min(this.model.files.length - 1, index));
		if (next === this.selected) return;
		this.selected = next;
		this.diffScroll = 0;
		this.ensureSelectedVisible();
		this.loadSelected();
		this.deps.requestRender();
	}

	private scrollBy(delta: number): void {
		this.scrollDiff(delta, this.bodyRows());
		this.deps.requestRender();
	}

	private scrollFiles(delta: number, rows: number): boolean {
		const next = this.clampFileScroll(this.fileScroll + Math.trunc(delta), rows);
		if (next === this.fileScroll) return false;
		this.fileScroll = next;
		return true;
	}

	private scrollDiff(delta: number, rows: number): boolean {
		const file = this.model.files[this.selected];
		const lines = file ? this.diffs.get(file.path) : undefined;
		if (!lines) return false;
		const next = Math.max(0, Math.min(Math.max(0, lines.length - rows), this.diffScroll + Math.trunc(delta)));
		if (next === this.diffScroll) return false;
		this.diffScroll = next;
		return true;
	}

	private clampFileScroll(scroll: number, rows: number): number {
		return Math.max(0, Math.min(Math.max(0, this.model.files.length - rows), scroll));
	}

	private ensureSelectedVisible(): void {
		const rows = this.bodyRows();
		if (this.selected < this.fileScroll) this.fileScroll = this.selected;
		else if (this.selected >= this.fileScroll + rows) this.fileScroll = this.selected - rows + 1;
		this.fileScroll = this.clampFileScroll(this.fileScroll, rows);
	}

	private loadSelected(): void {
		const file = this.model.files[this.selected];
		if (!file || this.diffs.has(file.path)) return;
		void this.deps.loadDiff(file).then(
			(text) => {
				if (this.disposed) return;
				this.diffs.set(file.path, colorDiff(text, this.deps.theme));
				this.deps.requestRender();
			},
			() => {
				if (this.disposed) return;
				this.diffs.set(file.path, []);
				this.deps.requestRender();
			},
		);
	}
}
