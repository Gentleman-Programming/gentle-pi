import { keyHint, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "./terminal-theme.ts";

type GentleAiLifecycleColor = "warning" | "success" | "error" | "dim";

export interface GentleAiRenderTheme {
	bold(value: string): string;
	fg(color: GentleAiLifecycleColor, value: string): string;
}

export interface GentleAiRenderState {
	lifecycleComponent?: boolean; genericLocked?: boolean;
}

export interface GentleAiRenderContext {
	argsComplete?: boolean;
	executionStarted?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	lastComponent?: unknown;
	state?: unknown;
}

export function getGentleAiRenderState(state: unknown): GentleAiRenderState | undefined {
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const rowState = state as Record<string, unknown>, existing = rowState.gentleAiRender;
	if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing as GentleAiRenderState;
	return (rowState.gentleAiRender = {} as GentleAiRenderState);
}

export interface GentleAiResultRenderOptions {
	expanded?: boolean;
}

export function renderGentleAiResult(
	result: AgentToolResult<unknown>,
	options: GentleAiResultRenderOptions,
): Text {
	const textItems = result.content.flatMap((content) => (content.type === "text" ? [sanitizeTerminalText(content.text)] : []));
	const text = textItems.join("\n");
	const hasExpandableText = textItems.some((item) => item.length > 0);
	const output = !hasExpandableText ? "" : options.expanded ? text : keyHint("app.tools.expand", "to expand");
	return new Text(output, 0, 0);
}

export function renderGentleAiLifecycleCall(
	operationPath: string,
	theme: GentleAiRenderTheme,
	context?: GentleAiRenderContext,
	detail?: string,
): Text {
	const status = context?.isError
		? "failed"
		: context?.argsComplete === false
			? "preparing"
			: !context?.executionStarted || context.isPartial
				? "running"
				: "completed";
	const color = status === "preparing" || status === "running" ? "warning" : status === "completed" ? "success" : "error";
	const lines = [theme.fg(color, theme.bold(`🌹︎ Gentle AI · ${status} · ${operationPath}`))];
	if (detail) lines.push(theme.fg("dim", sanitizeTerminalText(detail)));
	const state = getGentleAiRenderState(context?.state);
	const component = context?.lastComponent instanceof Text && (!state || state.lifecycleComponent === true)
		? context.lastComponent
		: new Text("", 0, 0);
	if (state) state.lifecycleComponent = true;
	component.setText(lines.join("\n"));
	return component;
}
