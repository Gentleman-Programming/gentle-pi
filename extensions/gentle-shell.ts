import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import { renderShellBar, shellEnabled, type ShellBarModel, type ShellBarTheme } from "../lib/shell-bar.ts";

// Gentle Shell: the visual layer gentle-pi puts on top of pi. This slice
// installs the status bar; later slices add the prompt frame, the changes
// view, subscription usage, and cards.

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

export default function gentleShell(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
	if (!shellEnabled(env)) return;
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui, theme, footerData) => createShellBarComponent(pi, ctx, tui, theme, footerData));
	});
}
