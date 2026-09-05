import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Gentle Shell changes: what the agent touched during this session. Git is
// the source of truth; this module turns raw `git diff --numstat` and
// `git status --porcelain -z` output into a model and renders the widget.

export const CHANGE_STATUS = {
	MODIFIED: "modified",
	ADDED: "added",
	DELETED: "deleted",
	RENAMED: "renamed",
	UNTRACKED: "untracked",
} as const;

export type ChangeStatus = (typeof CHANGE_STATUS)[keyof typeof CHANGE_STATUS];

export interface ChangedFile {
	path: string;
	added: number;
	deleted: number;
	status: ChangeStatus;
}

export interface ChangesModel {
	files: ChangedFile[];
	added: number;
	deleted: number;
}

export interface ChangesSnapshot {
	numstat: string;
	porcelain: string;
}

export interface ChangesTheme {
	fg(color: string, text: string): string;
}

interface NumstatEntry {
	path: string;
	added: number;
	deleted: number;
}

export const CHANGES_COMMAND = "/gentle:changes";
const WIDGET_GLYPH = "✎";
const STATUS_BY_CODE: Record<string, ChangeStatus> = {
	A: CHANGE_STATUS.ADDED,
	D: CHANGE_STATUS.DELETED,
	R: CHANGE_STATUS.RENAMED,
	C: CHANGE_STATUS.ADDED,
	"?": CHANGE_STATUS.UNTRACKED,
};
const RENAME_BRACES = /\{([^{}]*) => ([^{}]*)\}/g;
const HAS_RENAME_BRACES = /\{[^{}]* => [^{}]*\}/;
const RENAME_ARROW = " => ";

export function emptyChanges(): ChangesModel {
	return { files: [], added: 0, deleted: 0 };
}

function renamedPath(path: string): string {
	if (HAS_RENAME_BRACES.test(path)) return path.replace(RENAME_BRACES, "$2").replace(/\/\//g, "/");
	const arrow = path.indexOf(RENAME_ARROW);
	return arrow === -1 ? path : path.slice(arrow + RENAME_ARROW.length);
}

function count(value: string): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNumstat(text: string): NumstatEntry[] {
	const entries: NumstatEntry[] = [];
	for (const line of text.split("\n")) {
		const [added, deleted, ...rest] = line.split("\t");
		if (added === undefined || deleted === undefined || rest.length === 0) continue;
		entries.push({ path: renamedPath(rest.join("\t")), added: count(added), deleted: count(deleted) });
	}
	return entries;
}

export function parsePorcelain(text: string): Map<string, ChangeStatus> {
	const statuses = new Map<string, ChangeStatus>();
	const records = text.split("\0").filter((record) => record.length > 0);
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		const code = record.slice(0, 2);
		const path = record.slice(3);
		const status = STATUS_BY_CODE[code[0]] ?? STATUS_BY_CODE[code[1]] ?? CHANGE_STATUS.MODIFIED;
		statuses.set(path, status);
		if (code[0] === "R" || code[0] === "C") index += 1;
	}
	return statuses;
}

export function snapshotChanges(snapshot: ChangesSnapshot): ChangedFile[] {
	const counts = new Map(parseNumstat(snapshot.numstat).map((entry) => [entry.path, entry]));
	const files: ChangedFile[] = [];
	for (const [path, status] of parsePorcelain(snapshot.porcelain)) {
		const entry = counts.get(path);
		files.push({ path, added: entry?.added ?? 0, deleted: entry?.deleted ?? 0, status });
	}
	return files;
}

function fingerprint(file: ChangedFile): string {
	return `${file.status}:${file.added}:${file.deleted}`;
}

export function sessionChanges(current: ChangedFile[], baseline: ChangedFile[]): ChangesModel {
	const untouched = new Map(baseline.map((file) => [file.path, fingerprint(file)]));
	const files = current
		.filter((file) => untouched.get(file.path) !== fingerprint(file))
		.sort((a, b) => a.path.localeCompare(b.path));
	return {
		files,
		added: files.reduce((total, file) => total + file.added, 0),
		deleted: files.reduce((total, file) => total + file.deleted, 0),
	};
}

export function changesSummary(model: ChangesModel): string {
	const noun = model.files.length === 1 ? "file" : "files";
	return `${model.files.length} ${noun} · +${model.added} −${model.deleted}`;
}

export function renderChangesWidget(model: ChangesModel, theme: ChangesTheme, width: number): string[] {
	if (model.files.length === 0) return [];
	const noun = model.files.length === 1 ? "file" : "files";
	const head = `${theme.fg("accent", WIDGET_GLYPH)} ${theme.fg("text", `${model.files.length} ${noun}`)} ${theme.fg("muted", "·")} ${theme.fg("success", `+${model.added}`)} ${theme.fg("error", `−${model.deleted}`)}`;
	const hint = `${theme.fg("muted", "·")} ${theme.fg("dim", CHANGES_COMMAND)}`;
	const list = theme.fg("muted", model.files.map((file) => file.path).join(", "));
	const full = `${head} ${theme.fg("muted", "·")} ${list} ${hint}`;
	if (visibleWidth(full) <= width) return [full];
	const short = `${head} ${hint}`;
	return [truncateToWidth(visibleWidth(short) <= width ? short : head, width, "…")];
}

export interface GitResult {
	stdout: string;
	code: number;
}

export type GitRunner = (args: string[]) => Promise<GitResult>;

const NUMSTAT_ARGS = ["diff", "--numstat", "HEAD"];
const PORCELAIN_ARGS = ["status", "--porcelain=v1", "--untracked-files=all", "-z"];

// Tracks session changes against a baseline captured at session start.
// Concurrent refreshes coalesce: one git round-trip runs at a time and a
// refresh requested meanwhile triggers exactly one more.
export class ChangesTracker {
	private readonly git: GitRunner;
	private baseline: ChangedFile[] = [];
	private current: ChangesModel = emptyChanges();
	private available = false;
	private inFlight: Promise<ChangesModel> | undefined;
	private queued = false;

	constructor(git: GitRunner) {
		this.git = git;
	}

	get model(): ChangesModel {
		return this.current;
	}

	async start(): Promise<void> {
		const files = await this.capture();
		this.available = files !== undefined;
		this.baseline = files ?? [];
		this.current = emptyChanges();
	}

	async refresh(): Promise<ChangesModel> {
		if (!this.available) return this.current;
		if (this.inFlight) {
			this.queued = true;
			return this.inFlight;
		}
		this.inFlight = this.runRefresh();
		try {
			return await this.inFlight;
		} finally {
			this.inFlight = undefined;
		}
	}

	private async runRefresh(): Promise<ChangesModel> {
		do {
			this.queued = false;
			const files = await this.capture();
			if (files) this.current = sessionChanges(files, this.baseline);
		} while (this.queued);
		return this.current;
	}

	private async capture(): Promise<ChangedFile[] | undefined> {
		const [numstat, porcelain] = await Promise.all([this.git(NUMSTAT_ARGS), this.git(PORCELAIN_ARGS)]);
		if (numstat.code !== 0 || porcelain.code !== 0) return undefined;
		return snapshotChanges({ numstat: numstat.stdout, porcelain: porcelain.stdout });
	}
}
