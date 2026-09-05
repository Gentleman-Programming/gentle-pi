import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { renderShellBar, shellEnabled, type ShellBarModel, type ShellBarTheme } from "../lib/shell-bar.ts";
import { CHANGE_STATUS, ChangesTracker, renderChangesWidget, type ChangedFile, type ChangesModel, type GitRunner, type LineCounter } from "../lib/shell-changes.ts";
import { ChangesView } from "../lib/shell-changes-view.ts";
import { CARD_TONE, renderCard, type Card, type CardTheme } from "../lib/shell-card.ts";
import { GentleAiDevBinaryOverrideError, resolveGentleAiDevBinaryOverride } from "../lib/gentle-ai-binary.ts";
import { framePromptLines, PROMPT_HINT, PROMPT_STATE, withPromptHint, type PromptState } from "../lib/shell-prompt.ts";
import { accountIdFromToken, CODEX_PROVIDER, CODEX_USAGE_URL, parseCodexUsage, parseUsageHeaders, UsageStore, type ProviderUsage } from "../lib/shell-usage.ts";
import { UsageView } from "../lib/shell-usage-view.ts";

// Gentle Shell: the visual layer gentle-pi puts on top of pi. It installs the
// status bar, the petal prompt, the working-tree changes widget and overlay,
// the subscription usage view, and the cards Gentle notices are drawn with.

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
	dirty?: number;
	usage?: ProviderUsage;
}

export type DevBinaryNotice = { state: "active"; path: string; sha256: string } | { state: "invalid"; reason: string };

export interface ShellDeps {
	fetch: typeof fetch;
	now(): number;
	devBinary(): DevBinaryNotice | undefined;
}

function ambientDevBinary(): DevBinaryNotice | undefined {
	try {
		const override = resolveGentleAiDevBinaryOverride();
		return override ? { state: "active", path: override.path, sha256: override.sha256 } : undefined;
	} catch (error) {
		if (error instanceof GentleAiDevBinaryOverrideError) return { state: "invalid", reason: error.message };
		return undefined;
	}
}

const defaultShellDeps: ShellDeps = { fetch: (...args) => globalThis.fetch(...args), now: () => Date.now(), devBinary: ambientDevBinary };

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
		dirty: options.dirty,
		sessionName: ctx.sessionManager.getSessionName(),
		modelId: model?.id ?? "no-model",
		effort: model?.reasoning ? pi.getThinkingLevel() : undefined,
		contextPercent: usage?.percent ?? null,
		contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
		costTotal: sessionCost(ctx),
		subscription: model ? ctx.modelRegistry.isUsingOAuth(model) : false,
		usage: options.usage,
		statuses,
	};
}

export function createShellBarComponent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	host: ShellRenderHost,
	theme: ShellBarTheme,
	footerData: ShellFooterData,
	dirty: () => number | undefined = () => undefined,
	usage: () => ProviderUsage | undefined = () => undefined,
): ShellBarComponent {
	const unsubscribe = footerData.onBranchChange(() => host.requestRender());
	return {
		render(width: number) {
			return renderShellBar(buildShellBarModel(pi, ctx, footerData, { dirty: dirty(), usage: usage() }), theme, width);
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

const PETAL_PULSE_MS = 160;

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

const CHANGES_WIDGET_KEY = "gentle-shell-changes";
const CHANGES_COMMAND_NAME = "gentle:changes";
const CHANGES_SHORTCUT_DEFAULT = "alt+g";
const CHANGES_POLL_DEFAULT_MS = 2000;
const CHANGES_WATCH_DEFAULT_MS = 5000;
const GIT_TIMEOUT_MS = 5000;
const OVERLAY_HEIGHT_RATIO = 0.8;
const OVERLAY_MIN_ROWS = 8;

function gitRunner(pi: ExtensionAPI, cwd: string): GitRunner {
	return async (args: string[]) => {
		const result = await pi.exec("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout, code: result.code };
	};
}

function lineCounter(cwd: string): LineCounter {
	return async (path: string) => {
		const text = await readFile(join(cwd, path), "utf8");
		if (text.length === 0) return 0;
		return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
	};
}

export async function loadFileDiff(git: GitRunner, file: ChangedFile): Promise<string> {
	const args = file.status === CHANGE_STATUS.UNTRACKED ? ["diff", "--no-index", "--", "/dev/null", file.path] : ["diff", "HEAD", "--", file.path];
	const result = await git(args);
	return result.code === 0 || result.code === 1 ? result.stdout : "";
}

export interface ExternalEditorHost {
	stop(): void;
	start(): void;
	requestRender(force?: boolean): void;
}

export function openInExternalEditor(host: ExternalEditorHost, path: string, env: NodeJS.ProcessEnv = process.env, spawn: typeof spawnSync = spawnSync): boolean {
	const command = env.VISUAL || env.EDITOR;
	if (!command) return false;
	const [editor, ...editorArgs] = command.split(" ");
	host.stop();
	try {
		spawn(editor, [...editorArgs, path], { stdio: "inherit", shell: process.platform === "win32" });
	} finally {
		host.start();
		host.requestRender(true);
	}
	return true;
}

export function changesShortcut(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.GENTLE_PI_SHELL_CHANGES_KEY?.trim();
	if (value === undefined) return CHANGES_SHORTCUT_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

function positiveMs(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function changesPollMs(env: NodeJS.ProcessEnv): number {
	return positiveMs(env.GENTLE_PI_SHELL_CHANGES_POLL_MS, CHANGES_POLL_DEFAULT_MS);
}

// Background watch: the widget and the bar follow edits made outside pi.
// 0 or "off" disables it; tool events still refresh.
function changesWatchMs(env: NodeJS.ProcessEnv): number | undefined {
	const value = env.GENTLE_PI_SHELL_CHANGES_WATCH_MS?.trim().toLowerCase();
	if (value === "0" || value === "off") return undefined;
	return positiveMs(value, CHANGES_WATCH_DEFAULT_MS);
}

function changesFingerprint(model: ChangesModel): string {
	return model.files.map((file) => `${file.path}:${file.status}:${file.added}:${file.deleted}`).join("|");
}

interface OverlayDeps {
	git: GitRunner;
	refresh(): Promise<ChangesModel>;
	apply(ctx: ExtensionContext, model: ChangesModel): void;
	pollMs: number;
}

// While the overlay is open, git is polled so edits made outside pi (nvim,
// another agent, a git checkout) show up without reopening it.
async function showChangesOverlay(ctx: ExtensionContext, model: ChangesModel, deps: OverlayDeps): Promise<void> {
	let host: ExternalEditorHost | undefined;
	let view: ChangesView | undefined;
	const poll = setInterval(async () => {
		const latest = await deps.refresh();
		view?.update(latest);
		deps.apply(ctx, latest);
	}, deps.pollMs);
	poll.unref();
	try {
		const chosen = await ctx.ui.custom<ChangedFile | null>(
			(tui, theme, _keybindings, done) => {
				host = tui;
				view = new ChangesView(model, {
					theme,
					rows: Math.max(OVERLAY_MIN_ROWS, Math.floor(tui.terminal.rows * OVERLAY_HEIGHT_RATIO)),
					loadDiff: (file) => loadFileDiff(deps.git, file),
					onOpen: (file) => done(file),
					onClose: () => done(null),
					requestRender: () => tui.requestRender(),
				});
				return view;
			},
			{ overlay: true, overlayOptions: { width: "92%", anchor: "center" } },
		);
		if (!chosen || !host) return;
		if (!openInExternalEditor(host, chosen.path)) ctx.ui.notify("No editor configured. Set $VISUAL or $EDITOR.", "warning");
	} finally {
		clearInterval(poll);
	}
}

function showChanges(ctx: ExtensionContext, model: ChangesModel): void {
	if (model.files.length === 0) {
		ctx.ui.setWidget(CHANGES_WIDGET_KEY, undefined);
		return;
	}
	ctx.ui.setWidget(
		CHANGES_WIDGET_KEY,
		(_tui, theme) => ({
			render(width: number) {
				return renderChangesWidget(model, theme, width);
			},
			invalidate() {},
		}),
		{ placement: "belowEditor" },
	);
}

const USAGE_COMMAND_NAME = "gentle:usage";
const REVIEW_PREFLIGHT_TYPE = "gentle-pi.review-preflight";
const DEV_BINARY_WIDGET_KEY = "gentle-shell-dev-binary";
const SHA_PREFIX_LENGTH = 16;

function messageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

function cardComponent(card: Card, theme: CardTheme, expanded: boolean) {
	return {
		render(width: number) {
			return renderCard(card, theme, width, { expanded });
		},
		invalidate() {},
	};
}

// Widgets above the editor sit flush against the prompt frame; a blank line
// after the card keeps the two frames apart.
function spaced(component: { render(width: number): string[]; invalidate(): void }) {
	return {
		render(width: number) {
			return [...component.render(width), ""];
		},
		invalidate() {},
	};
}

export function devBinaryCard(notice: DevBinaryNotice): Card {
	if (notice.state === "invalid") {
		return { title: "Gentle AI", subtitle: "dev binary override invalid", body: [notice.reason], tone: CARD_TONE.ERROR };
	}
	return {
		title: "Gentle AI",
		subtitle: "dev binary override · field-test only",
		body: [`${notice.path} · sha256:${notice.sha256.slice(0, SHA_PREFIX_LENGTH)}`],
		tone: CARD_TONE.WARNING,
	};
}

const USAGE_REFRESH_MS = 5 * 60_000;

// The Codex usage endpoint is what the Codex CLI itself reads. The OAuth
// token pi already holds carries the account id; nothing else is sent.
export async function fetchCodexUsage(token: string | undefined, fetchFn: typeof fetch, now: number): Promise<ProviderUsage | undefined> {
	if (!token) return undefined;
	const accountId = accountIdFromToken(token);
	if (!accountId) return undefined;
	try {
		const response = await fetchFn(CODEX_USAGE_URL, {
			headers: { Authorization: `Bearer ${token}`, "chatgpt-account-id": accountId, originator: "pi", "User-Agent": "gentle-pi" },
		});
		if (!response.ok) return undefined;
		return parseCodexUsage(await response.json(), now);
	} catch {
		return undefined;
	}
}

export default function gentleShell(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, overrides: Partial<ShellDeps> = {}): void {
	if (!shellEnabled(env)) return;
	const deps: ShellDeps = { ...defaultShellDeps, ...overrides };
	const usage = new UsageStore();
	let renderHost: ShellRenderHost | undefined;
	let usageFetchedAt = 0;
	const refreshUsage = async (ctx: ExtensionContext, force: boolean) => {
		const provider = ctx.model?.provider;
		if (provider !== CODEX_PROVIDER) return;
		const now = deps.now();
		if (!force && now - usageFetchedAt < USAGE_REFRESH_MS) return;
		usageFetchedAt = now;
		const token = await ctx.modelRegistry.getApiKeyForProvider(CODEX_PROVIDER).catch(() => undefined);
		const fetched = await fetchCodexUsage(token, deps.fetch, deps.now());
		if (!fetched) return;
		usage.record(fetched);
		renderHost?.requestRender();
	};
	pi.on("after_provider_response", (event) => {
		const parsed = parseUsageHeaders(event.headers, deps.now());
		if (!parsed) return;
		usage.record(parsed);
		renderHost?.requestRender();
	});
	pi.registerMessageRenderer(REVIEW_PREFLIGHT_TYPE, (message, options, theme) => {
		const body = messageText(message.content as string | Array<{ type: string; text?: string }>).split("\n");
		return cardComponent({ title: "Gentle AI", subtitle: "review preflight", body, tone: CARD_TONE.INFO }, theme, options.expanded);
	});
	pi.registerCommand(USAGE_COMMAND_NAME, {
		description: "Show subscription usage windows for the connected providers. Press r to refetch.",
		handler: async (_args, ctx) => {
			await refreshUsage(ctx, true);
			await ctx.ui.custom<null>(
				(tui, theme, _keybindings, done) =>
					new UsageView(usage, {
						theme,
						now: () => deps.now(),
						active: () => (ctx.model ? { provider: ctx.model.provider } : undefined),
						onRefresh: () => refreshUsage(ctx, true),
						onClose: () => done(null),
						requestRender: () => tui.requestRender(),
					}),
				{ overlay: true, overlayOptions: { width: "70%", minWidth: 60, anchor: "center" } },
			);
		},
	});
	let prompt: GentlePromptEditor | undefined;
	let changes: ChangesTracker | undefined;
	let watch: NodeJS.Timeout | undefined;
	let shown = "";
	const applyChanges = (ctx: ExtensionContext, model: ChangesModel) => {
		const fingerprint = changesFingerprint(model);
		if (fingerprint === shown) return;
		shown = fingerprint;
		showChanges(ctx, model);
	};
	const refreshChanges = async (ctx: ExtensionContext) => {
		if (!changes || !ctx.hasUI) return;
		applyChanges(ctx, await changes.refresh());
	};
	const stopWatch = () => {
		if (watch) clearInterval(watch);
		watch = undefined;
	};
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		changes = new ChangesTracker(gitRunner(pi, ctx.cwd), lineCounter(ctx.cwd));
		const tracker = changes;
		ctx.ui.setFooter((tui, theme, footerData) => {
			renderHost = tui;
			return createShellBarComponent(pi, ctx, tui, theme, footerData, () => tracker.model.files.length, () => usage.get(ctx.model?.provider ?? ""));
		});
		void refreshUsage(ctx, true);
		installPrompt(ctx, (created) => {
			prompt = created;
		});
		// The petal already says the agent is working; pi's own "Working" row would say it twice.
		ctx.ui.setWorkingVisible(false);
		const notice = deps.devBinary();
		ctx.ui.setWidget(DEV_BINARY_WIDGET_KEY, notice ? (_tui, theme) => spaced(cardComponent(devBinaryCard(notice), theme, true)) : undefined);
		await tracker.start();
		shown = "";
		applyChanges(ctx, tracker.model);
		stopWatch();
		const watchMs = changesWatchMs(env);
		if (watchMs) {
			watch = setInterval(() => void refreshChanges(ctx), watchMs);
			watch.unref();
		}
	});
	pi.on("session_shutdown", () => stopWatch());
	const openChanges = async (ctx: ExtensionContext) => {
		if (!changes) return;
		const tracker = changes;
		const model = await tracker.refresh();
		if (model.files.length === 0) {
			ctx.ui.notify("No changes in the working tree.", "info");
			return;
		}
		await showChangesOverlay(ctx, model, { git: gitRunner(pi, ctx.cwd), refresh: () => tracker.refresh(), apply: applyChanges, pollMs: changesPollMs(env) });
	};
	pi.registerCommand(CHANGES_COMMAND_NAME, {
		description: "Show the working tree changes against HEAD, with diffs. Press o to open a file in $EDITOR.",
		handler: async (_args, ctx) => openChanges(ctx),
	});
	const shortcut = changesShortcut(env);
	if (shortcut) {
		pi.registerShortcut(shortcut as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Open the working tree changes",
			handler: async (ctx) => openChanges(ctx),
		});
	}
	pi.on("agent_start", (_event, ctx) => {
		prompt?.setWorking(true);
		// The dev-binary card is a startup notice: it leaves with the first prompt.
		if (ctx.hasUI) ctx.ui.setWidget(DEV_BINARY_WIDGET_KEY, undefined);
	});
	pi.on("agent_end", async (_event, ctx) => {
		prompt?.setWorking(false);
		await refreshChanges(ctx);
		void refreshUsage(ctx, false);
	});
	pi.on("tool_execution_end", async (_event, ctx) => {
		await refreshChanges(ctx);
	});
}
