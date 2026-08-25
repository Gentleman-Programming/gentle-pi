import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadToolDefinition,
	createWriteTool,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { quietToolsEnabled } from "../lib/quiet-tools-config.ts";
import { renderGentleAiLifecycleCall, type GentleAiRenderContext } from "../lib/gentle-ai-renderer.ts";
import { sanitizeTerminalText } from "../lib/terminal-theme.ts";

type QuietToolName = "read" | "bash" | "grep" | "find" | "ls" | "edit" | "write";
type ThemeLike = {
	bold(value: string): string;
	fg(color: string, value: string): string;
};

const TOOL_CREATORS = {
	read: createReadToolDefinition,
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

const COLLAPSED_TAIL_LINE_LIMIT = 10;
const PREVIEW_LINE_LIMIT = 3;

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

function outputLines(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
	return normalized.length > 0 ? normalized.split("\n") : [];
}

function firstLines(text: string, limit: number): string {
	return outputLines(text).slice(0, limit).join("\n");
}

function lastOutputLines(text: string, limit: number): string {
	return outputLines(text).slice(-limit).join("\n");
}

function semanticJsonPreview(text: string): string | undefined {
	const trimmed = text.trim();
	if (!/^[\[{]/.test(trimmed)) return undefined;
	try {
		JSON.parse(trimmed);
	} catch {
		return undefined;
	}
	return outputLines(trimmed)
		.filter((line) => !/^[\s{}\[\],]*$/.test(line))
		.slice(0, PREVIEW_LINE_LIMIT)
		.join("\n");
}

export function extractTextContent(result: AgentToolResult<unknown>): string {
	return result.content
		.flatMap((content) => (content.type === "text" ? [content.text] : []))
		.join("\n");
}

function safeText(value: string): string {
	return sanitizeTerminalText(value);
}

function sanitizeValue(value: unknown): unknown {
	if (typeof value === "string") return safeText(value);
	if (Array.isArray(value)) return value.map(sanitizeValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
	}
	return value;
}

function sanitizedArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
	return (sanitizeValue(args ?? {}) as Record<string, unknown>) ?? {};
}

function sanitizedResult(result: AgentToolResult<unknown>): AgentToolResult<unknown> {
	return {
		...result,
		content: result.content.map((content) => sanitizeValue(content) as typeof content),
		details: sanitizeValue(result.details),
	};
}

function isEmptyResultMessage(toolName: QuietToolName, text: string): boolean {
	const normalized = text.trim();
	return EMPTY_RESULT_MESSAGES[toolName]?.some((message) => normalized.startsWith(message)) ?? false;
}

function isGitCommand(args: Record<string, unknown> | undefined): boolean {
	const command = typeof args?.command === "string" ? args.command.trim() : "";
	return /^(?:env\s+\S+=\S+\s+|command\s+|\w+=\S+\s+)*git(?:\s|$)/.test(command);
}

export type GentleAiRoutineCommand = "sdd-status" | "sdd-continue" | "sdd-attempt" | "review";

const SHELL_COMMAND_ASSIGNMENT = String.raw`\w+=(?:'[^']*'|"[^"]*"|\S+)`;
const SHELL_COMMAND_PREFIX = String.raw`(?:env\s+(?:${SHELL_COMMAND_ASSIGNMENT}\s+)?|command(?:\s+--)?\s+|${SHELL_COMMAND_ASSIGNMENT}\s+)*`;
const GENTLE_AI_EXECUTABLE = String.raw`(?:gentle-ai(?:\.exe)?|'gentle-ai(?:\.exe)?'|"gentle-ai(?:\.exe)?"|gentle\\-ai(?:\.exe|\\\.exe)?|(?:\.{1,2}[\\/]|(?:[A-Za-z]:)?(?:[\\/][^\\/\s]+)*[\\/])\.gentle-ai[\\/]v\d+\.\d+\.\d+[\\/]gentle-ai(?:\.exe)?)`;
const GENTLE_AI_COMMAND_ARGUMENTS = new RegExp(String.raw`^${SHELL_COMMAND_PREFIX}${GENTLE_AI_EXECUTABLE}(?:\s+(.*))?$`);
const SHELL_EXPANSION_OR_COMPOSITION = /[;&|`<>\r\n$#]/;
const SDD_ATTEMPT_VERBS = new Set(["acquire", "settle", "grant"]);

const REVIEW_DIRECT_OPERATIONS = new Set([
	"capabilities",
	"start",
	"finalize",
	"status",
	"repair",
	"invalidate",
	"abandon",
	"recover",
	"reclaim",
	"validate",
	"capture-result",
	"capture-refuter",
	"capture-validation",
	"capture-evidence",
	"preserve-result",
	"lens-context",
	"retry-final-verification",
	"store-reset",
	"inspect-authority",
	"inspect-candidate",
	"dispose-result",
	"reopen-results",
	"opencode-transport",
	"bind-sdd",
]);
const REVIEW_MODE_VALUES = new Set(["enable", "disable", "status"]);
const REVIEW_VALIDATE_GATES = new Set(["post-apply", "pre-commit", "pre-push", "pre-pr", "release"]);
const REVIEW_SCHEMA_NAMES = new Set([
	"capture-result-dry-run",
	"final-verification-incident",
	"refuter",
	"reviewer",
	"validator",
	"verification-evidence",
	"verification-evidence-record",
]);

function gentleAiCommandTokens(args: Record<string, unknown> | undefined): string[] | undefined {
	const rawCommand = typeof args?.command === "string" ? args.command : "";
	if (SHELL_EXPANSION_OR_COMPOSITION.test(rawCommand)) return undefined;
	const command = rawCommand.trim();
	const match = GENTLE_AI_COMMAND_ARGUMENTS.exec(command);
	if (!match) return undefined;
	const argumentsText = match[1]?.trim();
	return argumentsText === undefined || argumentsText.length === 0
		? []
		: argumentsText.split(/\s+/);
}

function displayToken(token: string): string {
	return token.replace(/-/g, " ");
}

function validateGate(tokens: string[]): string | undefined {
	const gateFlag = tokens.findIndex((token) => token === "--gate" || token.startsWith("--gate="));
	if (gateFlag < 0) return undefined;
	const gate = tokens[gateFlag]!.startsWith("--gate=")
		? tokens[gateFlag]!.slice("--gate=".length)
		: tokens[gateFlag + 1];
	return gate !== undefined && REVIEW_VALIDATE_GATES.has(gate) ? gate : "";
}

/**
 * Matches only supported routine Gentle AI CLI calls, including bounded
 * package-local paths, not arbitrary shell output that merely mentions
 * gentle-ai. These commands otherwise emit machine-readable SDD/RDD data.
 */
export function isGentleAiDirectCommand(args: Record<string, unknown> | undefined): boolean {
	return gentleAiCommandTokens(args) !== undefined;
}

export function gentleAiRoutineCommand(args: Record<string, unknown> | undefined): GentleAiRoutineCommand | undefined {
	const tokens = gentleAiCommandTokens(args);
	if (!tokens) return undefined;
	if (tokens[0] === "sdd-status") return "sdd-status";
	if (tokens[0] === "sdd-continue") return "sdd-continue";
	if (tokens[0] === "sdd-attempt" && SDD_ATTEMPT_VERBS.has(tokens[1] ?? "")) return "sdd-attempt";
	if (tokens[0] === "review") return "review";
	return undefined;
}

export function gentleAiOperationPath(args: Record<string, unknown> | undefined): string | undefined {
	const tokens = gentleAiCommandTokens(args);
	if (!tokens) return undefined;

	if (tokens[0] === "sdd-status") return "sdd status";
	if (tokens[0] === "sdd-continue") return "sdd continue";
	if (tokens[0] === "sdd-attempt") {
		return SDD_ATTEMPT_VERBS.has(tokens[1] ?? "")
			? `sdd attempt ${tokens[1]}`
			: "sdd attempt";
	}
	if (tokens[0] === "version") return "version";
	if (tokens[0] !== "review") return "command";

	const operation = tokens[1];
	if (operation === undefined) return "review";
	if (operation === "mode") {
		const mode = tokens[2];
		return mode !== undefined && REVIEW_MODE_VALUES.has(mode) ? `review mode ${displayToken(mode)}` : "review";
	}
	if (operation === "validate") {
		const gate = validateGate(tokens);
		if (gate === "") return "review";
		return gate === undefined ? "review validate" : `review validate ${displayToken(gate)}`;
	}
	if (operation === "schema") {
		const schema = tokens[2];
		return schema !== undefined && REVIEW_SCHEMA_NAMES.has(schema) ? `review schema ${displayToken(schema)}` : "review schema";
	}
	return REVIEW_DIRECT_OPERATIONS.has(operation) ? `review ${displayToken(operation)}` : "review";
}

export function isGentleAiGrantCommand(args: Record<string, unknown> | undefined): boolean {
	const tokens = gentleAiCommandTokens(args);
	return tokens?.[0] === "sdd-attempt" && tokens[1] === "grant";
}

interface ToolResultFormatOptions {
	expanded: boolean;
	isError?: boolean;
	args?: Record<string, unknown>;
}

function detailsRecord(result: AgentToolResult<unknown>): Record<string, unknown> {
	const details = sanitizeValue(result.details);
	return details && typeof details === "object" && !Array.isArray(details)
		? details as Record<string, unknown>
		: {};
}

function diffStats(diff: string): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		if (line.startsWith("-") && !line.startsWith("---")) removals++;
	}
	return { additions, removals };
}

function editSummary(result: AgentToolResult<unknown>): string {
	const diff = detailsRecord(result).diff;
	if (typeof diff === "string") {
		const stats = diffStats(diff);
		return `✓ +${stats.additions} / -${stats.removals}`;
	}
	return "✓ applied";
}

function writeSummary(text: string): string {
	const bytes = text.match(/(?:Successfully )?wrote\s+(\d+)\s+bytes/i)?.[1];
	return `✓ ${bytes ? `wrote ${bytes} bytes` : "written"}`;
}

function expandedResultText(toolName: QuietToolName, result: AgentToolResult<unknown>, text: string): string {
	if (toolName === "edit") {
		const diff = detailsRecord(result).diff;
		if (typeof diff === "string") return diff;
	}
	return text;
}

export function formatToolResultOutput(
	toolName: QuietToolName,
	result: AgentToolResult<unknown>,
	{ expanded, isError = false, args }: ToolResultFormatOptions,
): string {
	const text = safeText(extractTextContent(result));
	if (expanded) {
		const detail = expandedResultText(toolName, result, text);
		return detail ? `\n${detail}` : "";
	}
	if (isError) {
		const tail = lastOutputLines(text, PREVIEW_LINE_LIMIT);
		return tail ? `\n${tail}` : "";
	}
	const summaryLabel = COLLAPSED_COUNT_LABELS[toolName];
	if (summaryLabel) {
		if (isEmptyResultMessage(toolName, text)) return "";
		const count = countNonEmptyLines(text);
		return count > 0 ? ` → ${count} ${summaryLabel}` : "";
	}
	if (toolName === "bash" && isGentleAiDirectCommand(args)) return "";

	if (toolName === "bash" && isGitCommand(args)) {
		const tail = tailLines(text, COLLAPSED_TAIL_LINE_LIMIT);
		return tail ? `\n${tail}` : "";
	}
	if (toolName === "read") {
		const head = firstLines(text, PREVIEW_LINE_LIMIT);
		return head ? `\n${head}` : "";
	}
	if (toolName === "bash") {
		const preview = semanticJsonPreview(text);
		const tail = preview ?? lastOutputLines(text, PREVIEW_LINE_LIMIT);
		return tail ? `\n${tail}` : "";
	}
	if (toolName === "edit") return `\n${editSummary(result)}`;
	if (toolName === "write") return `\n${writeSummary(text)}`;
	return "";
}

function lineRangeSuffix(args: Record<string, unknown>, theme: ThemeLike): string {
	if (args.offset === undefined && args.limit === undefined) return "";
	const startLine = typeof args.offset === "number" ? args.offset : 1;
	const endLine = typeof args.limit === "number" ? startLine + args.limit - 1 : undefined;
	return theme.fg("warning", `:${startLine}${endLine === undefined ? "" : `-${endLine}`}`);
}

interface ToolRenderContextLike {
	args?: Record<string, unknown>;
	executionStarted?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	lastComponent?: unknown;
	cwd?: string;
	[key: string]: unknown;
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

function partialLabel(toolName: QuietToolName, text: string): string {
	const lineCount = outputLines(text).length;
	return lineCount === 0
		? `… ${toolName}`
		: `… ${toolName} · ${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
}

function hasImageContent(result: AgentToolResult<unknown>): boolean {
	return result.content.some((content) => content.type === "image");
}

function hasExpandableContent(toolName: QuietToolName, result: AgentToolResult<unknown>, text: string): boolean {
	if (COLLAPSED_COUNT_LABELS[toolName] && isEmptyResultMessage(toolName, text)) return false;
	if (text.length > 0 || hasImageContent(result)) return true;
	const diff = detailsRecord(result).diff;
	return toolName === "edit" && typeof diff === "string" && diff.length > 0;
}

function sanitizedRenderContext(context: ToolRenderContextLike | undefined): ToolRenderContextLike {
	if (!context) return { args: {} };
	return {
		...context,
		args: sanitizedArgs(context.args),
		cwd: typeof context.cwd === "string" ? safeText(context.cwd) : context.cwd,
	};
}

function registerQuietTool(pi: ExtensionAPI, toolName: QuietToolName): void {
	const registrationTool = getBuiltInTools(process.cwd())[toolName];
	const officialRenderResult = registrationTool.renderResult;

	pi.registerTool({
		...registrationTool,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const runtimeTool = getBuiltInTools(ctx.cwd)[toolName];
			return runtimeTool.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			const callArgs = args as Record<string, unknown>;
			const operationPath = toolName === "bash" ? gentleAiOperationPath(callArgs) : undefined;
			if (operationPath) {
				return renderGentleAiLifecycleCall(
					operationPath,
					theme,
					sanitizedRenderContext(context as ToolRenderContextLike | undefined) as GentleAiRenderContext,
					isGentleAiGrantCommand(callArgs) ? safeText(asString(callArgs.command)) : undefined,
				);
			}
			return new Text(formatToolCall(toolName, callArgs, theme), 0, 0);
		},
		renderResult(result, options, theme, context) {
			const renderContext = context as ToolRenderContextLike | undefined;
			const safeResult = sanitizedResult(result);
			const text = safeText(extractTextContent(safeResult));
			const isError = renderContext?.isError ?? options.isError ?? false;
			const directCommand = toolName === "bash" && isGentleAiDirectCommand(renderContext?.args);
			if (options.isPartial) {
				if (directCommand && !isError && !options.expanded) return new Text("", 0, 0);
				const visible = options.expanded ? text : lastOutputLines(text, PREVIEW_LINE_LIMIT);
				const label = theme.fg("warning", partialLabel(toolName, text));
				const output = visible ? `${label}\n${theme.fg("muted", visible)}` : label;
				return new Text(output, 0, 0);
			}
			if (options.expanded && toolName === "read" && hasImageContent(safeResult) && officialRenderResult) {
				return officialRenderResult(
					safeResult,
					options,
					theme,
					sanitizedRenderContext(renderContext) as any,
				);
			}
			const output = formatToolResultOutput(toolName, safeResult, {
				expanded: options.expanded,
				isError,
				args: renderContext?.args,
			});
			const hint = !options.expanded && !directCommand && hasExpandableContent(toolName, safeResult, text)
				? `\n${keyHint("app.tools.expand", "to expand")}`
				: "";
			const color = options.expanded ? "toolOutput" : isError ? "error" : "muted";
			return new Text(output || hint ? theme.fg(color, `${output}${hint}`) : "", 0, 0);
		},
	});
}

export default function quietTools(pi: ExtensionAPI): void {
	if (!quietToolsEnabled()) return;
	for (const toolName of Object.keys(TOOL_CREATORS) as QuietToolName[]) {
		registerQuietTool(pi, toolName);
	}
}
