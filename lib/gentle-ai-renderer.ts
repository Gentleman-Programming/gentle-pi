import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "./terminal-theme.ts";

type GentleAiLifecycleColor = "warning" | "success" | "error" | "dim";

export interface GentleAiRenderTheme {
	bold(value: string): string;
	fg(color: GentleAiLifecycleColor, value: string): string;
}

export interface GentleAiRenderContext {
	executionStarted?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	lastComponent?: unknown;
}

export interface GentleAiResultRenderOptions {
	expanded?: boolean;
}

export function renderGentleAiResult(
	result: AgentToolResult<unknown>,
	options: GentleAiResultRenderOptions,
): Text {
	const text = result.content
		.flatMap((content) => (content.type === "text" ? [sanitizeTerminalText(content.text)] : []))
		.join("\n");
	return new Text(options.expanded && text.length > 0 ? `\n${text}` : "", 0, 0);
}

export function renderGentleAiLifecycleCall(
	operationPath: string,
	theme: GentleAiRenderTheme,
	context?: GentleAiRenderContext,
): Text {
	const status = context?.isError
		? "failed"
		: !context?.executionStarted || context.isPartial
			? "running"
			: "completed";
	const color = status === "running" ? "warning" : status === "completed" ? "success" : "error";
	const lines = [
		theme.fg(color, theme.bold(`🌹︎ Gentle AI · ${status} · ${operationPath}`)),
	];
	const component = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	component.setText(lines.join("\n"));
	return component;
}
