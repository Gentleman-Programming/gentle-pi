import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	createFuzzyRecallPicker,
	dedupeNewestFirst,
	filterByQuery,
	scoreMatch,
	type PickerTheme,
} from "../lib/fuzzy-recall-picker.ts";

const EMPTY_HISTORY_MESSAGE =
	"No hay comandos de bash en el historial de esta sesión.";
const NON_TUI_MESSAGE = "Comando /history solo disponible en modo TUI.";
const GENERIC_ERROR_MESSAGE = "gentle-pi /history: error inesperado";
const PICKER_TITLE = "🔍 [gentle-pi] Selecciona un comando";

const HISTORY_COMMAND_DESCRIPTION =
	"Buscar en el historial de comandos de terminal de la sesión";
const HISTORY_ALIAS_DESCRIPTION = "Alias rápido para /history";

export type SessionEntry = {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	message?: unknown;
};

type BashExecutionMessage = {
	role: "bashExecution";
	command: string;
};

type ToolCallBlock = {
	type: "toolCall";
	name?: string;
	arguments?: Record<string, unknown> | null;
};

type AssistantMessage = {
	role: "assistant";
	content?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function readBashCommandFromEntry(entry: SessionEntry): string | null {
	if (!entry || entry.type !== "message") return null;
	const message: unknown = entry.message;
	if (!isObject(message)) return null;

	const role: unknown = message.role;
	if (role === "bashExecution") {
		const candidate: unknown = (message as BashExecutionMessage).command;
		return isString(candidate) && candidate.length > 0 ? candidate : null;
	}

	if (role === "assistant") {
		const content: unknown = (message as AssistantMessage).content;
		if (!Array.isArray(content)) return null;
		for (const block of content) {
			if (!isObject(block)) continue;
			if (block.type !== "toolCall") continue;
			const toolCall = block as ToolCallBlock;
			if (toolCall.name !== "bash") continue;
			const args = toolCall.arguments;
			if (!args || !isObject(args)) continue;
			const command = args.command;
			if (isString(command) && command.length > 0) return command;
		}
	}

	return null;
}

export function collectBashCommands(
	entries: readonly SessionEntry[],
): string[] {
	const out: string[] = [];
	for (const entry of entries) {
		const command = readBashCommandFromEntry(entry);
		if (command !== null) out.push(command);
	}
	return out;
}

export { dedupeNewestFirst, scoreMatch, filterByQuery };

function bindApplySelection(
	ctx: ExtensionCommandContext,
): (value: string) => void {
	return (value: string): void => {
		ctx.ui.setEditorText(value);
	};
}

function bindApplyCancel(_ctx: ExtensionCommandContext): () => void {
	return (): void => {
		// no-op: the cancel path only closes the picker
	};
}

async function runHistoryCommand(ctx: ExtensionCommandContext): Promise<void> {
	try {
		if (ctx.mode !== "tui" || ctx.hasUI !== true) {
			ctx.ui.notify(NON_TUI_MESSAGE, "info");
			return;
		}
		const sessionManager = ctx.sessionManager;
		const entries: readonly SessionEntry[] =
			sessionManager && typeof sessionManager.getEntries === "function"
				? (sessionManager.getEntries() as readonly SessionEntry[])
				: [];
		const raw = collectBashCommands(entries);
		const commands = dedupeNewestFirst(raw);
		if (commands.length === 0) {
			ctx.ui.notify(EMPTY_HISTORY_MESSAGE, "info");
			return;
		}
		await ctx.ui.custom<{ value: string } | undefined>(
			(tui, theme, _keybindings, done) => {
				return createFuzzyRecallPicker(
					{
						items: commands.map((command) => ({ value: command })),
						title: PICKER_TITLE,
						applySelection: bindApplySelection(ctx),
						applyCancel: bindApplyCancel(ctx),
						requestRender: () => tui.requestRender(),
						done,
					},
					{ ui: { theme: theme as PickerTheme } },
				);
			},
		);
	} catch {
		try {
			ctx.ui.notify(GENERIC_ERROR_MESSAGE, "error");
		} catch {
			// last-resort: nothing more we can do
		}
	}
}

export default function historySearch(pi: ExtensionAPI): void {
	pi.registerCommand("history", {
		description: HISTORY_COMMAND_DESCRIPTION,
		handler: async (_args, ctx) => {
			await runHistoryCommand(ctx);
		},
	});
	pi.registerCommand("r", {
		description: HISTORY_ALIAS_DESCRIPTION,
		handler: async (_args, ctx) => {
			await runHistoryCommand(ctx);
		},
	});
}

export const __testing = {
	collectBashCommands,
	dedupeNewestFirst,
	scoreMatch,
	filterByQuery,
	readBashCommandFromEntry,
};
