import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import * as os from "node:os";
import { renderShellBar, shellEnabled, type ShellBarModel, type ShellBarTheme } from "../lib/shell-bar.ts";
import { framePromptLines, PROMPT_HINT, PROMPT_STATE, withPromptHint, type PromptState } from "../lib/shell-prompt.ts";

// Gentle Shell: the visual layer gentle-pi puts on top of pi. It installs the
// status bar and the petal prompt; later slices add the changes view,
// subscription usage, and cards.

export interface ShellFooterData {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(callback: () => void): () => void;
}

interface ShellRenderHost {
	requestRender(): void;
}

interface ShellBarComponent {
	render(width: number): string[];
	invalidate(): void;
	dispose(): void;
}

interface BuildOptions {
	home?: string;
}

interface AssistantUsageEntry {
	type: string;
	message?: {
		role?: string;
		usage?: {
			cost?: { total?: number };
		};
	};
}

function shortenHome(cwd: string, home: string | undefined): string {
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function sessionCost(ctx: ExtensionContext): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getEntries() as AssistantUsageEntry[]) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		total += entry.message.usage?.cost?.total ?? 0;
	}
	return total;
}

export function buildShellBarModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	footerData: ShellFooterData,
	options: BuildOptions = {},
): ShellBarModel {
	const home = options.home ?? os.homedir();
	const usage = ctx.getContextUsage();
	const model = ctx.model;
	const statuses = Array.from(footerData.getExtensionStatuses().entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => text);
	return {
		cwd: shortenHome(ctx.sessionManager.getCwd(), home),
		branch: footerData.getGitBranch(),
		sessionName: ctx.sessionManager.getSessionName(),
		modelId: model?.id ?? "no-model",
		effort: model?.reasoning ? pi.getThinkingLevel() : undefined,
		contextPercent: usage?.percent ?? null,
		contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
		costTotal: sessionCost(ctx),
		subscription: model ? ctx.modelRegistry.isUsingOAuth(model) : false,
		statuses,
	};
}

export function createShellBarComponent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	host: ShellRenderHost,
	theme: ShellBarTheme,
	footerData: ShellFooterData,
): ShellBarComponent {
	const unsubscribe = footerData.onBranchChange(() => host.requestRender());
	return {
		render(width: number) {
			return renderShellBar(buildShellBarModel(pi, ctx, footerData), theme, width);
		},
		invalidate() {},
		dispose() {
			unsubscribe();
		},
	};
}

interface PromptEditorDeps {
	fg: (color: string, text: string) => string;
	requestRender(): void;
	pending(): boolean;
}

const PETAL_PULSE_MS = 600;

export class GentlePromptEditor extends CustomEditor {
	private promptState: PromptState = PROMPT_STATE.IDLE;
	private tick = 0;
	private pulse: NodeJS.Timeout | undefined;
	private readonly deps: PromptEditorDeps;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, deps: PromptEditorDeps) {
		super(tui, theme, keybindings);
		this.deps = deps;
	}

	setWorking(working: boolean): void {
		this.promptState = working ? PROMPT_STATE.WORKING : PROMPT_STATE.IDLE;
		this.stopPulse();
		if (working) {
			this.pulse = setInterval(() => {
				this.tick += 1;
				this.deps.requestRender();
			}, PETAL_PULSE_MS);
			this.pulse.unref();
		}
		this.deps.requestRender();
	}

	render(width: number): string[] {
		const lines = super.render(Math.max(1, width - 2));
		if (this.getText() === "" && lines.length === 3) lines[1] = withPromptHint(lines[1], PROMPT_HINT, this.deps.fg);
		const state = this.promptState === PROMPT_STATE.WORKING && this.deps.pending() ? PROMPT_STATE.QUEUED : this.promptState;
		return framePromptLines(lines, width, { state, tick: this.tick, borderColor: this.borderColor, fg: this.deps.fg });
	}

	dispose(): void {
		this.stopPulse();
	}

	private stopPulse(): void {
		if (this.pulse) clearInterval(this.pulse);
		this.pulse = undefined;
		this.tick = 0;
	}
}

function installPrompt(ctx: ExtensionContext, onCreated: (prompt: GentlePromptEditor) => void): void {
	if (ctx.ui.getEditorComponent()) return;
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		const prompt = new GentlePromptEditor(tui, theme, keybindings, {
			fg: (color, text) => ctx.ui.theme.fg(color as Parameters<typeof ctx.ui.theme.fg>[0], text),
			requestRender: () => tui.requestRender(),
			pending: () => ctx.hasPendingMessages(),
		});
		onCreated(prompt);
		return prompt;
	});
}

export default function gentleShell(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
	if (!shellEnabled(env)) return;
	let prompt: GentlePromptEditor | undefined;
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui, theme, footerData) => createShellBarComponent(pi, ctx, tui, theme, footerData));
		installPrompt(ctx, (created) => {
			prompt = created;
		});
	});
	pi.on("agent_start", () => prompt?.setWorking(true));
	pi.on("agent_end", () => prompt?.setWorking(false));
}
