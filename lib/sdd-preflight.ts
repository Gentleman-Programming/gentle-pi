import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");

export type SddExecutionMode = "interactive" | "auto";
export type SddArtifactStore = "openspec" | "engram" | "both";
export type SddChainedPrStrategy =
	| "auto-forecast"
	| "ask-always"
	| "single-pr-default"
	| "force-chained";

export interface SddPreflightPreferences {
	executionMode: SddExecutionMode;
	artifactStore: SddArtifactStore;
	chainedPrStrategy: SddChainedPrStrategy;
	reviewBudgetLines: number;
	engramAvailable: boolean;
}

interface SddPreflightCallbacks {
	pi: ExtensionAPI;
	installAssets?: (cwd: string) =>
		| {
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }
		| Promise<{
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }>;
	applyModelConfig?: (
		cwd: string,
	) =>
		| { updated: number; skipped: number }
		| Promise<{ updated: number; skipped: number }>;
}

const DEFAULT_SDD_PREFLIGHT: SddPreflightPreferences = {
	executionMode: "interactive",
	artifactStore: "openspec",
	chainedPrStrategy: "auto-forecast",
	reviewBudgetLines: 400,
	engramAvailable: false,
};

const sddPreflightBySession = new Map<string, SddPreflightPreferences>();
const sddPreflightInFlight = new Map<string, Promise<SddPreflightPreferences>>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyDirectoryFiles(
	sourceDir: string,
	targetDir: string,
	force: boolean,
): { copied: number; skipped: number } {
	if (!existsSync(sourceDir)) return { copied: 0, skipped: 0 };
	mkdirSync(targetDir, { recursive: true });
	let copied = 0;
	let skipped = 0;
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			const child = copyDirectoryFiles(sourcePath, targetPath, force);
			copied += child.copied;
			skipped += child.skipped;
			continue;
		}
		if (!entry.isFile()) continue;
		if (!force && existsSync(targetPath)) {
			skipped += 1;
			continue;
		}
		writeFileSync(targetPath, readFileSync(sourcePath));
		copied += 1;
	}
	return { copied, skipped };
}

export function installSddAssets(
	cwd: string,
	force: boolean,
): { agents: number; chains: number; support: number; skipped: number } {
	const agents = copyDirectoryFiles(
		join(ASSETS_DIR, "agents"),
		join(cwd, ".pi", "agents"),
		force,
	);
	const chains = copyDirectoryFiles(
		join(ASSETS_DIR, "chains"),
		join(cwd, ".pi", "chains"),
		force,
	);
	const support = copyDirectoryFiles(
		join(ASSETS_DIR, "support"),
		join(cwd, ".pi", "gentle-ai", "support"),
		force,
	);
	return {
		agents: agents.copied,
		chains: chains.copied,
		support: support.copied,
		skipped: agents.skipped + chains.skipped + support.skipped,
	};
}

export function isSddPreflightTrigger(text: string): boolean {
	return /^\/sdd-[^\s]*(?:\s|$)/i.test(text.trim());
}

export function sddPreflightSessionKey(ctx: ExtensionContext): string {
	const manager = (ctx as unknown as { sessionManager?: unknown }).sessionManager;
	if (isRecord(manager)) {
		const getSessionFile = manager.getSessionFile;
		if (typeof getSessionFile === "function") {
			const value = getSessionFile.call(manager);
			if (typeof value === "string" && value.length > 0) return value;
		}
		const getSessionId = manager.getSessionId;
		if (typeof getSessionId === "function") {
			const value = getSessionId.call(manager);
			if (typeof value === "string" && value.length > 0) return value;
		}
	}
	return ctx.cwd;
}

function hasWritableEngramTool(pi: ExtensionAPI): boolean {
	try {
		const getActiveTools = (pi as unknown as { getActiveTools?: () => unknown[] })
			.getActiveTools;
		if (typeof getActiveTools !== "function") return false;
		const tools = getActiveTools.call(pi);
		return tools.some((tool) => {
			const name =
				typeof tool === "string"
					? tool
					: isRecord(tool) && typeof tool.name === "string"
						? tool.name
						: "";
			return (
				name === "mem_save" ||
				name === "engram_mem_save" ||
				name.endsWith(".mem_save") ||
				name.endsWith(".engram_mem_save")
			);
		});
	} catch {
		return false;
	}
}

function normalizeSddReviewBudget(value: string): number {
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 400;
}

async function collectSddPreflightPreferences(
	ctx: ExtensionContext,
	engramAvailable: boolean,
): Promise<SddPreflightPreferences> {
	if (!ctx.hasUI) return { ...DEFAULT_SDD_PREFLIGHT, engramAvailable };
	const executionMode = await ctx.ui.select("SDD execution mode", [
		"interactive",
		"auto",
	]);
	const artifactOptions = engramAvailable
		? ["openspec", "engram", "both"]
		: ["openspec"];
	const artifactStore = await ctx.ui.select("SDD artifact store", artifactOptions);
	const chainedPrStrategy = await ctx.ui.select("SDD PR chaining", [
		"auto-forecast",
		"ask-always",
		"single-pr-default",
		"force-chained",
	]);
	const reviewBudgetLines = normalizeSddReviewBudget(
		(await ctx.ui.input("SDD review budget lines", "400")) ?? "400",
	);
	return {
		executionMode:
			executionMode === "auto" ? "auto" : DEFAULT_SDD_PREFLIGHT.executionMode,
		artifactStore:
			artifactStore === "engram" || artifactStore === "both"
				? artifactStore
				: DEFAULT_SDD_PREFLIGHT.artifactStore,
		chainedPrStrategy:
			chainedPrStrategy === "ask-always" ||
			chainedPrStrategy === "single-pr-default" ||
			chainedPrStrategy === "force-chained"
				? chainedPrStrategy
				: DEFAULT_SDD_PREFLIGHT.chainedPrStrategy,
		reviewBudgetLines,
		engramAvailable,
	};
}

export function renderSddPreflightPrompt(prefs: SddPreflightPreferences): string {
	return [
		"## SDD Session Preflight",
		"The user already chose these SDD preferences for this Pi session. Reuse them unless the user explicitly changes them.",
		`- Execution mode: ${prefs.executionMode}`,
		`- Artifact store: ${prefs.artifactStore}${prefs.engramAvailable ? "" : " (Engram unavailable in this session)"}`,
		`- Chained PR strategy: ${prefs.chainedPrStrategy}`,
		`- Review budget: ${prefs.reviewBudgetLines} changed lines`,
		"- If task/workload forecasts conflict with these preferences, pause before sdd-apply and ask the user for a delivery decision.",
	].join("\n");
}

export async function ensureSddPreflight(
	ctx: ExtensionContext,
	callbacks: SddPreflightCallbacks,
): Promise<SddPreflightPreferences> {
	const sessionKey = sddPreflightSessionKey(ctx);
	const existing = sddPreflightBySession.get(sessionKey);
	if (existing) return existing;
	const inFlight = sddPreflightInFlight.get(sessionKey);
	if (inFlight) return inFlight;
	const promise = (async () => {
		const engramAvailable = hasWritableEngramTool(callbacks.pi);
		const prefs = await collectSddPreflightPreferences(ctx, engramAvailable);
		const result =
			(await callbacks.installAssets?.(ctx.cwd)) ??
			installSddAssets(ctx.cwd, false);
		const modelResult = (await callbacks.applyModelConfig?.(ctx.cwd)) ?? {
			updated: 0,
			skipped: 0,
		};
		if (ctx.hasUI) {
			ctx.ui.notify(
				[
					"Gentle AI SDD preflight complete.",
					`Mode: ${prefs.executionMode}`,
					`Artifacts: ${prefs.artifactStore}`,
					`PR chaining: ${prefs.chainedPrStrategy}`,
					`Review budget: ${prefs.reviewBudgetLines} changed lines`,
					`Assets installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} skipped.`,
					`Model-routed agents updated: ${modelResult.updated}`,
				].join("\n"),
				"info",
			);
		}
		sddPreflightBySession.set(sessionKey, prefs);
		return prefs;
	})();
	sddPreflightInFlight.set(sessionKey, promise);
	try {
		return await promise;
	} finally {
		sddPreflightInFlight.delete(sessionKey);
	}
}

export function getSddPreflightPreferences(
	ctx: ExtensionContext,
): SddPreflightPreferences | undefined {
	return sddPreflightBySession.get(sddPreflightSessionKey(ctx));
}
