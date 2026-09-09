import type { Component, TUI } from "@earendil-works/pi-tui";

// Store on the terminal, not a module singleton: extension loaders may isolate
// modules, while Pi keeps this terminal across regular/fullscreen transitions.
const STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
export interface SidebarState {
	active: boolean;
	width: number;
	ownsHost?: () => boolean;
	parts: Map<string, Component>;
}
export function sidebarState(tui: TUI): SidebarState {
	const terminal = tui.terminal as unknown as Record<symbol, SidebarState>;
	const state = terminal[STATE] ??= { active: false, width: 50, parts: new Map() };
	// Migrate terminal-owned state created by an older extension instance.
	if (!Number.isFinite(state.width)) state.width = 50;
	return state;
}

/** Keep the original bottom component mounted, suppressing only its paint. */
export function sidebarPart<T extends Component & { dispose?(): void }>(tui: TUI, key: string, bottom: T, rail: Component = bottom): T {
	// Minimal extension hosts cannot share terminal-owned layout state.
	if (!tui.terminal) return bottom;
	const state = sidebarState(tui);
	state.parts.set(key, rail);
	return {
		...bottom,
		render: (width: number) => state.active && state.ownsHost?.() ? [] : bottom.render(width),
		dispose() {
			if (state.parts.get(key) === rail) state.parts.delete(key);
			bottom.dispose?.();
		},
	};
}
