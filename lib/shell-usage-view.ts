import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderUsagePanel, type ActiveProvider, type UsageStore, type UsageTheme } from "./shell-usage.ts";

// Gentle Shell subscriptions overlay: a framed panel over the usage store.
// It reads the store on every render, so a refresh only needs to record.

export interface UsageViewDeps {
	theme: UsageTheme;
	now(): number;
	active(): ActiveProvider | undefined;
	onRefresh(): Promise<void>;
	onClose(): void;
	requestRender(): void;
}

const TITLE = "✿ Subscriptions";
const REFRESHING = "✿ Subscriptions · refreshing…";
const FRAME_ROLE = "border";
const TITLE_ROLE = "customMessageLabel";
const KEY_ROLE = "accent";
const KEY_TEXT_ROLE = "dim";
const KEYS = [
	["r", "refresh"],
	["esc", "close"],
] as const;

function rule(length: number): string {
	return "─".repeat(Math.max(0, length));
}

function fit(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export class UsageView {
	private readonly store: UsageStore;
	private readonly deps: UsageViewDeps;
	private refreshing = false;

	constructor(store: UsageStore, deps: UsageViewDeps) {
		this.store = store;
		this.deps = deps;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || data === "q") {
			this.deps.onClose();
			return;
		}
		if (data === "r" && !this.refreshing) {
			this.refreshing = true;
			this.deps.requestRender();
			void this.deps.onRefresh().finally(() => {
				this.refreshing = false;
				this.deps.requestRender();
			});
		}
	}

	render(width: number): string[] {
		const theme = this.deps.theme;
		const inner = width - 2;
		const title = this.refreshing ? REFRESHING : TITLE;
		const top = theme.fg(FRAME_ROLE, "╭─ ") + theme.fg(TITLE_ROLE, title) + theme.fg(FRAME_ROLE, ` ${rule(inner - visibleWidth(title) - 3)}╮`);
		const body = renderUsagePanel(this.store.all(), theme, inner - 2, this.deps.now(), this.deps.active()).map(
			(line) => `${theme.fg(FRAME_ROLE, "│")} ${fit(line, inner - 2)} ${theme.fg(FRAME_ROLE, "│")}`,
		);
		const keys = KEYS.map(([key, label]) => `${theme.fg(KEY_ROLE, key)} ${theme.fg(KEY_TEXT_ROLE, label)}`).join("   ");
		const keysLine = `${theme.fg(FRAME_ROLE, "│")} ${fit(keys, inner - 2)} ${theme.fg(FRAME_ROLE, "│")}`;
		const bottom = theme.fg(FRAME_ROLE, `╰${rule(inner)}╯`);
		return [top, ...body, keysLine, bottom];
	}

	invalidate(): void {}
}
