import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { quietToolsEnabled } from "../lib/quiet-tools-config.ts";
import { sanitizeTerminalText } from "../lib/terminal-theme.ts";

type QuietToolName = "read" | "bash" | "grep" | "find" | "ls" | "edit" | "write";
type ThemeLike = {
	bold(value: string): string;
	fg(color: string, value: string): string;
};

const TOOL_CREATORS = {
	read: createReadTool,
	bash: createBashTool,
	grep: createGrepTool,
	find: createFindTool,
	ls: createLsTool,
	edit: createEditTool,
	write: createWriteTool,
} satisfies Record<QuietToolName, (cwd: string) => any>;

const COLLAPSED_COUNT_LABELS: Partial<Record<QuietToolName, string>> = {
	grep: "matches",
	find: "files",
	ls: "entries",
};

const NO_COLLAPSED_RESULT_TOOLS = new Set<QuietToolName>(["read", "bash"]);
const COLLAPSED_TAIL_TOOLS = new Set<QuietToolName>(["edit", "write"]);
const COLLAPSED_TAIL_LINE_LIMIT = 10;

const EMPTY_RESULT_MESSAGES: Partial<Record<QuietToolName, string[]>> = {
	grep: ["No matches found"],
	find: ["No files found matching pattern"],
	ls: ["Directory is empty"],
};

const toolCache = new Map<string, Record<QuietToolName, any>>();

function createBuiltInTools(cwd: string): Record<QuietToolName, any> {
	return Object.fromEntries(
		(Object.entries(TOOL_CREATORS) as [QuietToolName, (cwd: string) => any][]).map(
			([name, createTool]) => [name, createTool(cwd)],
		),
	) as Record<QuietToolName, any>;
}

function getBuiltInTools(cwd: string): Record<QuietToolName, any> {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = createBuiltInTools(cwd);
		toolCache.set(cwd, tools);
	}
	return tools;
}

function shortenPath(path: unknown): string {
	if (typeof path !== "string" || path.length === 0) return "";
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function countNonEmptyLines(text: string): number {
	return text.split("\n").filter((line) => line.trim().length > 0).length;
}

export function tailLines(text: string, limit: number): string {
	const lines = text.split("\n");
	return lines.slice(Math.max(0, lines.length - limit)).join("\n");
}

export function extractTextContent(result: AgentToolResult<unknown>): string {
	return result.content
		.flatMap((content) => (content.type === "text" ? [content.text] : []))
		.join("\n");
}

function safeText(value: string): string {
	return sanitizeTerminalText(value);
}

function isEmptyResultMessage(toolName: QuietToolName, text: string): boolean {
	const normalized = text.trim();
	return EMPTY_RESULT_MESSAGES[toolName]?.some((message) => normalized.startsWith(message)) ?? false;
}

function isGitCommand(args: Record<string, unknown> | undefined): boolean {
	const command = typeof args?.command === "string" ? args.command.trim() : "";
	return /^(?:env\s+\S+=\S+\s+|command\s+|\w+=\S+\s+)*git(?:\s|$)/.test(command);
}

interface ToolResultFormatOptions {
	expanded: boolean;
	isError?: boolean;
	args?: Record<string, unknown>;
}

export function formatToolResultOutput(
	toolName: QuietToolName,
	result: AgentToolResult<unknown>,
	{ expanded, isError = false, args }: ToolResultFormatOptions,
): string {
	const text = safeText(extractTextContent(result));
	if (expanded || isError) return text ? `\n${text}` : "";

	if (toolName === "bash" && isGitCommand(args)) {
		const tail = tailLines(text, COLLAPSED_TAIL_LINE_LIMIT);
		return tail ? `\n${tail}` : "";
	}
	if (NO_COLLAPSED_RESULT_TOOLS.has(toolName)) return "";
	if (COLLAPSED_TAIL_TOOLS.has(toolName)) {
		const tail = tailLines(text, COLLAPSED_TAIL_LINE_LIMIT);
		return tail ? `\n${tail}` : "";
	}
	if (isEmptyResultMessage(toolName, text)) return "";

	const summaryLabel = COLLAPSED_COUNT_LABELS[toolName];
	if (!summaryLabel) return "";

	const count = countNonEmptyLines(text);
	return count > 0 ? ` → ${count} ${summaryLabel}` : "";
}

function lineRangeSuffix(args: Record<string, unknown>, theme: ThemeLike): string {
	if (args.offset === undefined && args.limit === undefined) return "";
	const startLine = typeof args.offset === "number" ? args.offset : 1;
	const endLine = typeof args.limit === "number" ? startLine + args.limit - 1 : undefined;
	return theme.fg("warning", `:${startLine}${endLine === undefined ? "" : `-${endLine}`}`);
}

function formatToolCall(toolName: QuietToolName, args: Record<string, unknown>, theme: ThemeLike): string {
	switch (toolName) {
		case "read": {
			const path = safeText(shortenPath(args.path) || "...");
			return `${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", path)}${lineRangeSuffix(args, theme)}`;
		}
		case "bash": {
			const command = safeText(asString(args.command, "..."));
			const timeout = typeof args.timeout === "number" ? theme.fg("muted", ` (timeout ${args.timeout}s)`) : "";
			return `${theme.fg("toolTitle", theme.bold(`$ ${command}`))}${timeout}`;
		}
		case "grep": {
			let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${safeText(asString(args.pattern))}/`)} in ${safeText(shortenPath(args.path) || ".")}`;
			if (typeof args.glob === "string") text += theme.fg("toolOutput", ` (${safeText(args.glob)})`);
			if (typeof args.limit === "number") text += theme.fg("toolOutput", ` limit ${args.limit}`);
			return text;
		}
		case "find": {
			let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", safeText(asString(args.pattern, "*")))} in ${safeText(shortenPath(args.path) || ".")}`;
			if (typeof args.limit === "number") text += theme.fg("toolOutput", ` limit ${args.limit}`);
			return text;
		}
		case "ls": {
			let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", safeText(shortenPath(args.path) || "."))}`;
			if (typeof args.limit === "number") text += theme.fg("toolOutput", ` limit ${args.limit}`);
			return text;
		}
		case "edit":
			return `${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", safeText(shortenPath(args.path) || "..."))}`;
		case "write": {
			const content = typeof args.content === "string" ? args.content : "";
			const lineInfo = content.length > 0 ? theme.fg("muted", ` (${content.split("\n").length} lines)`) : "";
			return `${theme.fg("toolTitle", theme.bold("write"))} ${theme.fg("accent", safeText(shortenPath(args.path) || "..."))}${lineInfo}`;
		}
	}
}

function partialLabel(toolName: QuietToolName): string {
	return toolName === "bash" ? "Running..." : `${toolName}...`;
}

function registerQuietTool(pi: ExtensionAPI, toolName: QuietToolName): void {
	const registrationTool = getBuiltInTools(process.cwd())[toolName];

	pi.registerTool({
		...registrationTool,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const runtimeTool = getBuiltInTools(ctx.cwd)[toolName];
			return runtimeTool.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme) {
			return new Text(formatToolCall(toolName, args as Record<string, unknown>, theme), 0, 0);
		},
		renderResult(result, options, theme, context) {
			if (options.isPartial) {
				return new Text(theme.fg("warning", partialLabel(toolName)), 0, 0);
			}
			const output = formatToolResultOutput(toolName, result, {
				expanded: options.expanded,
				isError: options.isError,
				args: context.args as Record<string, unknown> | undefined,
			});
			const color = options.expanded ? "toolOutput" : options.isError ? "error" : "muted";
			return new Text(output ? theme.fg(color, output) : "", 0, 0);
		},
	});
}

export default function quietTools(pi: ExtensionAPI): void {
	if (!quietToolsEnabled()) return;
	for (const toolName of Object.keys(TOOL_CREATORS) as QuietToolName[]) {
		registerQuietTool(pi, toolName);
	}
}
