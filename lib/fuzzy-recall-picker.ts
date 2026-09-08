import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	SelectList,
	Text,
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
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		noMatch: (text) => theme.fg("dim", text),
	};
}

export function isPrintable(data: string): boolean {
	if (data.length !== 1) return false;
	const code = data.charCodeAt(0);
	return code >= 0x20 && code !== 0x7f;
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

export function createFuzzyRecallPicker(
	options: FuzzyRecallPickerOptions,
	ctx: FuzzyRecallPickerContext,
): Container {
	const {
		items,
		title,
		hint,
		applySelection: onSelect,
		applyCancel: onCancel,
		requestRender,
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

	const buildQueryLine = (q: string): string =>
		theme.fg("muted", `▸  ${q}`) + accent("_");

	let query = "";
	const queryText = new Text(buildQueryLine(query), 0, 0);

	const container = new Container();
	container.addChild(topBorder);
	container.addChild(titleText);
	container.addChild(queryText);
	container.addChild(list);
	container.addChild(hintTextNode);
	container.addChild(bottomBorder);

	const refresh = (): void => {
		queryText.setText(buildQueryLine(query));
		list.setFilter(query);
		requestRender();
	};

	list.onSelect = (item): void => {
		applySelection(onSelect, item.value);
		done({ value: item.value });
	};

	list.onCancel = (): void => {
		applyCancel(onCancel);
		done(undefined);
	};

	container.handleInput = (data: string): void => {
		if (matchesKey(data, Key.escape)) {
			applyCancel(onCancel);
			done(undefined);
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			if (query.length > 0) {
				query = query.slice(0, -1);
				refresh();
			}
			return;
		}
		if (isPrintable(data)) {
			query += data;
			refresh();
			return;
		}
		// Up, Down, Enter, Ctrl+C and other SelectList-owned keys
		// reach the SelectList via handleInput.
		list.handleInput(data);
	};

	refresh();
	return container;
}
