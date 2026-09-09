import { ScrollView, visibleWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { sidebarState } from "./shell-sidebar.ts";
import type { ShellBarTheme } from "./shell-bar.ts";
import { renderSidebarBanner } from "./shell-sidebar-banner.ts";

export const SIDEBAR_BREAKPOINT = 140;
export const SIDEBAR_MIN_WIDTH = 32;
const SIDEBAR_MAX_WIDTH = 80;
const TRANSCRIPT_MIN_WIDTH = 60;
const RAIL_PADDING = 1;
// Experimental Pi 0.85.1 internals. Only the fullscreen layout tree is adapted;
// regular mode keeps native scrollback and the original bottom components.
const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
type LayoutNode = { type: string; entries?: unknown[]; gap?: number; align?: string };
type LayoutRoot = Component & { [NODE]?: () => LayoutNode };
type Host = TUI & { mode?: string; layoutRoot?: LayoutRoot };

export function installSidebar(tui: TUI, theme: ShellBarTheme): () => void {
	if (!tui.terminal) return () => {};
	const host = tui as Host;
	const state = sidebarState(tui);
	const cleanups: Array<() => void> = [];
	const roots = new Set<LayoutRoot>();
	let stopped = false;
	let failed = false;
	let railLines: string[] = [];
	state.active = false;
	state.ownsHost = () => !stopped && host.mode === "fullscreen" && !!host.layoutRoot && roots.has(host.layoutRoot);
	const rail: Component = {
		render: () => railLines,
		invalidate() { for (const part of state.parts.values()) part.invalidate(); },
	};
	const scroll = new ScrollView(rail, {
		follow: "none",
		primary: false,
		overscroll: "contain",
		scrollbar: "always",
		scrollbarTrackStyle: (text) => theme.fg("border", text),
		scrollbarThumbStyle: (text) => theme.fg("accent", text),
	});
	const nativeMouse = scroll.handleMouse.bind(scroll);
	scroll.handleMouse = (event) => {
		if (event.type !== "wheel") return nativeMouse(event);
		// Consume even at the boundary or over blank rail space: Pi 0.85.1
		// can send unconsumed delta to the primary transcript despite containment.
		scroll.scrollBy(event.wheelDelta ?? 0);
		return {
			handled: true,
			render: true,
			target: { component: scroll, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height },
		};
	};
	let dragX: number | undefined;
	const maximumWidth = () => Math.min(SIDEBAR_MAX_WIDTH, tui.terminal.columns - TRANSCRIPT_MIN_WIDTH);
	const handle: Component = {
		render: () => Array.from({ length: tui.terminal.rows ?? 1 }, () => theme.fg("border", "│")),
		invalidate() {},
		handleMouse(event: TuiMouseEvent) {
			if (event.button !== "left") return undefined;
			if (event.type === "press") {
				dragX = event.screenX;
				return { handled: true as const, capture: true };
			}
			if (event.type === "release") {
				dragX = undefined;
				return { handled: true as const };
			}
			if ((event.type !== "drag" && event.type !== "move") || dragX === undefined) return undefined;
			const delta = dragX - event.screenX;
			dragX = event.screenX;
			state.width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maximumWidth(), state.width + delta));
			tui.requestRender();
			return { handled: true as const, render: true };
		},
	};
	const prepare = (width: number): boolean => {
		state.active = false;
		if (stopped || failed || host.mode !== "fullscreen" || width < SIDEBAR_BREAKPOINT) return false;
		try {
			state.width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maximumWidth(), state.width));
			const contentWidth = scroll.getContentWidth(state.width);
			const sections = ["footer", "changes", "agents", "todo"].map((key) => {
				const lines = [...(state.parts.get(key)?.render(contentWidth - RAIL_PADDING * 2) ?? [])];
				while (lines.length && lines[lines.length - 1]?.trim() === "") lines.pop();
				return lines;
			}).filter((lines) => lines.length > 0);
			const branding = renderSidebarBanner(theme, contentWidth - RAIL_PADDING * 2);
			if (sections.length && branding.length) sections.unshift(branding);
			railLines = sections.flatMap((lines, index) => [
				...(index === 0 ? [] : [""]),
				...lines.map((line) => " ".repeat(RAIL_PADDING) + line + " ".repeat(RAIL_PADDING)),
			]);
			// Height is owned by the native ScrollView, never by the transcript.
			if (!railLines.length || railLines.some((line) => visibleWidth(line) > contentWidth)) return false;
			state.active = true;
			return true;
		} catch {
			failed = true;
			return false;
		}
	};
	const attach = () => {
		if (stopped || failed) return;
		if (host.mode !== "fullscreen") { state.active = false; return; }
		try {
			const root = host.layoutRoot;
			if (!root || typeof root[NODE] !== "function") { state.active = false; return; }
			if (roots.has(root)) return;
			const original = root[NODE]!;
			const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
			const left = { render: (width: number) => root.render(width), invalidate() {}, [NODE]: () => original.call(root) };
			const replacement = () => prepare(tui.terminal.columns)
				? { type: "hstack", gap: 0, align: "stretch", entries: [
					{ component: left, basis: 0, grow: 1, shrink: 1, minSize: 1 },
					{ component: handle, basis: 1, grow: 0, shrink: 0, minSize: 1 },
					{ component: scroll, basis: state.width, grow: 0, shrink: 0, minSize: state.width },
				] }
				: original.call(root);
			root[NODE] = replacement;
			roots.add(root);
			tui.requestRender();
			cleanups.push(() => {
				if (root[NODE] !== replacement) return;
				if (descriptor) Object.defineProperty(root, NODE, descriptor);
				else Reflect.deleteProperty(root, NODE);
			});
		} catch {
			failed = true;
			state.active = false;
		}
	};
	attach();
	// Pi replaces renderers without a session event. Rebind only that transition;
	// resize and scroll remain owned by Pi's native layout/render loop.
	const timer = setInterval(attach, 100);
	timer.unref();
	return () => {
		stopped = true;
		state.active = false;
		clearInterval(timer);
		scroll.hideTransientScrollbar();
		for (const cleanup of cleanups.reverse()) cleanup();
		tui.requestRender();
	};
}
