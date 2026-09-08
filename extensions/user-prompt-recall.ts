import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	createFuzzyRecallPicker,
	dedupeNewestFirst,
	type PickerTheme,
} from "../lib/fuzzy-recall-picker.ts";

const EMPTY_HISTORY_MESSAGE = "No hay prompts en el historial de esta sesión.";
const NON_TUI_MESSAGE = "Comando /input solo disponible en modo TUI.";
const GENERIC_ERROR_MESSAGE = "gentle-pi /input: error inesperado";
const PICKER_TITLE = "🔍 [gentle-pi] Busca un prompt:";

const INPUT_COMMAND_DESCRIPTION =
	"Buscar en mis prompts enviados al LLM durante la sesión";
const INPUT_ALIAS_DESCRIPTION = "Alias rápido para /input";

export type UserPromptSessionEntry = {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	message?: unknown;
};

export type UserPromptBlock = {
	type?: string;
	text?: unknown;
};

export function collectUserPrompts(
	entries: readonly UserPromptSessionEntry[],
): string[] {
	const out: string[] = [];
	for (const entry of entries) {
		if (!entry || entry.type !== "message") continue;
		const message = entry.message;
		if (!isObject(message)) continue;
		if (message.role !== "user") continue;
		const text = extractUserText(message.content);
		if (text.length > 0) out.push(text);
	}
	return out;
}

function extractUserText(content: unknown): string {
	if (typeof content === "string") {
		const trimmed = content.trim();
		return trimmed;
	}
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (!isObject(block)) continue;
			if (block.type !== "text") continue;
			const text = block.text;
			if (typeof text === "string" && text.length > 0) parts.push(text);
		}
		return parts.join("\n").trim();
	}
	return "";
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function runInputCommand(ctx: ExtensionCommandContext): Promise<void> {
	try {
		if (ctx.mode !== "tui" || ctx.hasUI !== true) {
			ctx.ui.notify(NON_TUI_MESSAGE, "info");
			return;
		}
		const sessionManager = ctx.sessionManager;
		const entries: readonly UserPromptSessionEntry[] =
			sessionManager && typeof sessionManager.getEntries === "function"
				? (sessionManager.getEntries() as readonly UserPromptSessionEntry[])
				: [];
		const raw = collectUserPrompts(entries);
		const prompts = dedupeNewestFirst(raw);
		if (prompts.length === 0) {
			ctx.ui.notify(EMPTY_HISTORY_MESSAGE, "info");
			return;
		}
		await ctx.ui.custom<{ value: string } | undefined>(
			(tui, theme, _keybindings, done) => {
				return createFuzzyRecallPicker(
					{
						items: prompts.map((value) => ({ value })),
						title: PICKER_TITLE,
						applySelection: (value: string) => {
							ctx.ui.setEditorText(value);
						},
						applyCancel: () => {
							// no-op: cancel closes the picker without editor mutation
						},
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

export default function userPromptRecall(pi: ExtensionAPI): void {
	const handler = async (
		_args: string,
		ctx: ExtensionCommandContext,
	): Promise<void> => {
		await runInputCommand(ctx);
	};
	pi.registerCommand("input", {
		description: INPUT_COMMAND_DESCRIPTION,
		handler,
	});
	pi.registerCommand("i", {
		description: INPUT_ALIAS_DESCRIPTION,
		handler,
	});
}

export const __testing = {
	collectUserPrompts,
	extractUserText,
};
