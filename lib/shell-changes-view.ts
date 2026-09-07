import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CHANGE_STATUS, changesSummary, type ChangedFile, type ChangesModel } from "./shell-changes.ts";

// Gentle Shell changes overlay: a framed two-pane view with the working
// tree's changed files on the left and the selected file's diff on the right.
// Git access is injected so the component renders without a repository.

export interface ChangesViewTheme {
	fg(color: string, text: string): string;
}

export interface ChangesViewDeps {
	theme: ChangesViewTheme;
	rows: number;
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

export class ChangesView {
	private model: ChangesModel;
	private readonly deps: ChangesViewDeps;
	private selected = 0;
	private scroll = 0;
	private readonly diffs = new Map<string, string[]>();

	constructor(model: ChangesModel, deps: ChangesViewDeps) {
		this.model = model;
		this.deps = deps;
		this.loadSelected();
	}

	// Replace the model while open: keep the selection by path and drop cached
	// diffs for files whose counts moved so they reload.
	update(model: ChangesModel): void {
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
		this.selected = index === -1 ? Math.max(0, Math.min(this.selected, model.files.length - 1)) : index;
		this.loadSelected();
		this.deps.requestRender();
	}

	handleInput(data: string): void {
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

	render(width: number): string[] {
		const theme = this.deps.theme;
		const inner = width - 2;
		const listWidth = Math.min(LIST_MAX_WIDTH, Math.floor(inner * LIST_RATIO));
		const diffWidth = inner - listWidth - 4;
		const titleText = `✎ Changes · ${changesSummary(this.model)}`;
		const top = theme.fg(ROLE.FRAME, "╭─ ") + theme.fg(ROLE.TITLE, titleText) + theme.fg(ROLE.FRAME, ` ${rule(inner - visibleWidth(titleText) - 3)}╮`);
		const rows = this.bodyRows();
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
		return [top, ...body, keysLine, bottom];
	}

	invalidate(): void {}

	private bodyRows(): number {
		return Math.max(MIN_BODY_ROWS, this.deps.rows - CHROME_ROWS);
	}

	private fileLine(row: number): string {
		const file = this.model.files[row];
		if (!file) return "";
		const theme = this.deps.theme;
		const marker = row === this.selected ? theme.fg(ROLE.SELECTED, "▸") : " ";
		const path = theme.fg(row === this.selected ? ROLE.PATH : ROLE.PATH_IDLE, file.path);
		return `${marker} ${path}  ${fileCounts(file, theme)}`;
	}

	private visibleDiff(rows: number): string[] {
		const file = this.model.files[this.selected];
		if (!file) return [this.deps.theme.fg(ROLE.EMPTY, CLEAN_TREE)];
		const lines = this.diffs.get(file.path);
		if (!lines) return [];
		if (lines.length === 0) return [this.deps.theme.fg(ROLE.EMPTY, EMPTY_DIFF)];
		const maxScroll = Math.max(0, lines.length - rows);
		this.scroll = Math.min(this.scroll, maxScroll);
		return lines.slice(this.scroll, this.scroll + rows);
	}

	private select(index: number): void {
		const next = Math.max(0, Math.min(this.model.files.length - 1, index));
		if (next === this.selected) return;
		this.selected = next;
		this.scroll = 0;
		this.loadSelected();
		this.deps.requestRender();
	}

	private scrollBy(delta: number): void {
		this.scroll = Math.max(0, this.scroll + delta);
		this.deps.requestRender();
	}

	private loadSelected(): void {
		const file = this.model.files[this.selected];
		if (!file || this.diffs.has(file.path)) return;
		void this.deps.loadDiff(file).then(
			(text) => {
				this.diffs.set(file.path, colorDiff(text, this.deps.theme));
				this.deps.requestRender();
			},
			() => {
				this.diffs.set(file.path, []);
				this.deps.requestRender();
			},
		);
	}
}
