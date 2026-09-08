import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	SelectList,
	Text,
	type Component,
	type SelectItem,
	type SelectListTheme,
} from "@earendil-works/pi-tui";

export const DEFAULT_HINT_TEXT =
	"type to filter · ↑/↓ navigate · Enter select · Esc cancel";

export type PickerTheme = {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
	bg: (color: string, text: string) => string;
};

export type PickerDone = (value: { value: string } | undefined) => void;

export type FuzzyRecallPickerOptions = {
	items: readonly { value: string }[];
	title: string;
	hint?: string;
	applySelection: (value: string) => void;
	applyCancel: () => void;
	requestRender: () => void;
	done: PickerDone;
};

export type FuzzyRecallPickerContext = {
	ui: { theme: PickerTheme };
};

function createPickerTheme(theme: PickerTheme): SelectListTheme {
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("dim", text),
	};
}

export function isPrintable(data: string): boolean {
	if (data.length !== 1) return false;
	const code = data.charCodeAt(0);
	return code >= 0x20 && code !== 0x7f;
}

export function dedupeNewestFirst(commands: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (let i = commands.length - 1; i >= 0; i--) {
		const command = commands[i];
		if (typeof command !== "string") continue;
		if (seen.has(command)) continue;
		seen.add(command);
		result.push(command);
	}
	return result;
}

export function scoreMatch(query: string, command: string): number {
	if (query.length === 0) return 1;
	if (command.length === 0) return 0;

	const haystack = command.toLowerCase();
	const needle = query.toLowerCase();

	const indexOf = haystack.indexOf(needle);
	if (indexOf === 0) return 100;
	if (indexOf > 0) return 50 - Math.min(indexOf, 49);

	let qi = 0;
	let ci = 0;
	let consecutive = 0;
	let lastMatch = -2;
	while (qi < needle.length && ci < haystack.length) {
		if (needle[qi] === haystack[ci]) {
			if (ci === lastMatch + 1) {
				consecutive += 1;
			}
			lastMatch = ci;
			qi += 1;
		}
		ci += 1;
	}

	if (qi < needle.length) return 0;
	let score = 10 + consecutive * 2;
	const coverage = needle.length / Math.max(haystack.length, 1);
	score += Math.round(coverage * 10);
	return score;
}

export function filterByQuery(
	commands: readonly string[],
	query: string,
): string[] {
	const filtered: { command: string; score: number }[] = [];
	for (const command of commands) {
		const score = scoreMatch(query, command);
		if (score <= 0) continue;
		filtered.push({ command, score });
	}
	filtered.sort((a, b) => b.score - a.score);
	return filtered.map((entry) => entry.command);
}

export function applySelection(
	apply: (value: string) => void,
	value: string,
): void {
	try {
		apply(value);
	} catch {
		// absorb RPC edge cases from the selection callback
	}
}

export function applyCancel(apply: () => void): void {
	try {
		apply();
	} catch {
		// absorb errors from the cancel callback
	}
}

/**
 * Picker root that owns keyboard input. Implements `handleInput` as a class
 * method (not a property assignment) so the prototype chain exposes it to the
 * TUI runtime, which dispatches keys via `component.handleInput(data)`.
 */
class PickerRoot extends Container {
	private readonly list: SelectList;
	private readonly queryLine: Text;
	private query = "";

	constructor(
		list: SelectList,
		queryLine: Text,
		children: Component[],
	) {
		super();
		this.list = list;
		this.queryLine = queryLine;
		for (const child of children) this.addChild(child);
		this.addChild(queryLine);
		this.addChild(list);
	}

	override handleInput(data: string): void {
		if (data === "\x7f" || data === "\b") {
			if (this.query.length > 0) {
				this.query = this.query.slice(0, -1);
				this.refreshQuery();
			}
			return;
		}
		if (isPrintable(data)) {
			this.query += data;
			this.refreshQuery();
			return;
		}
		// Up, Down, Enter, Escape, Ctrl+C and other SelectList-owned keys.
		// SelectList uses its own keybindings table internally.
		this.list.handleInput(data);
	}

	private refreshQuery(): void {
		this.queryLine.setText(`▸  ${this.query}_`);
		this.list.setFilter(this.query);
		this.invalidate();
	}
}

export function createFuzzyRecallPicker(
	options: FuzzyRecallPickerOptions,
	ctx: FuzzyRecallPickerContext,
): Component {
	const {
		items,
		title,
		hint,
		applySelection: onSelect,
		applyCancel: onCancel,
		requestRender: _requestRender,
		done,
	} = options;
	const hintText = hint ?? DEFAULT_HINT_TEXT;
	const theme = ctx.ui.theme;

	const selectItems: SelectItem[] = items.map((item) => ({
		label: item.value,
		value: item.value,
	}));

	const pickerTheme = createPickerTheme(theme);
	const list = new SelectList(selectItems, 10, pickerTheme);
	const accent = (text: string): string => theme.fg("accent", text);
	const topBorder = new DynamicBorder(accent);
	const bottomBorder = new DynamicBorder(accent);
	const titleText = new Text(theme.fg("accent", theme.bold(title)), 1, 0);
	const hintTextNode = new Text(theme.fg("dim", hintText), 1, 0);
	const queryLine = new Text(theme.fg("muted", `▸  ${""}`) + accent("_"), 0, 0);

	list.onSelect = (item): void => {
		applySelection(onSelect, item.value);
		done({ value: item.value });
	};

	list.onCancel = (): void => {
		applyCancel(onCancel);
		done(undefined);
	};

	const root = new PickerRoot(list, queryLine, [
		topBorder,
		titleText,
		hintTextNode,
		bottomBorder,
	]);
	list.setFilter("");
	return root;
}
