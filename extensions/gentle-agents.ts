import { spawn } from "node:child_process";
import { recordReviewMutation } from "../lib/review-reminder-receipt.ts";
import { SessionWorktreeRegistry, resolveSessionWorktree, type WorktreeResolver } from "../lib/session-worktree-registry.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { keyHint, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { sidebarPart } from "../lib/shell-sidebar.ts";
import { AGENT_MODE, discoverAgents, loadAgentsConfig, resolveAgentProfile, type AgentDefinition, type AgentMode } from "../lib/agents-config.ts";
import { isFinished, TASK_STATUS, TaskStore, type AskRequest, type TaskRecord } from "../lib/agents-protocol.ts";
import { AgentRunner, piCommand, type AskAnswer, type RunnerDeps, type TaskRequest } from "../lib/agents-runner.ts";
import { ChildMessenger, type IpcEndpoint } from "../lib/agents-messaging.ts";
import { ActiveSessionClient, ActiveSessionListener, SessionPresenceRegistry, type PresenceRecord, type ReceivedNotification, type SentNotification, type SessionPresenceCandidate } from "../lib/agents-session-transport.ts";
import { WindowsActiveSessionClient, WindowsActiveSessionListener, WindowsSessionPresenceRegistry, type WindowsSessionRegistryPhaseObserver } from "../lib/windows-session-transport.ts";
import { hasReviewSessionPermission, resolveCanonicalGitRepositoryIdentitySync, type ReviewSessionManager } from "../lib/review-session-standing-permission.ts";
import { historyDir, loadStoredTask, pruneHistory, saveTask } from "../lib/agents-history.ts";
import { sessionToMarkdown } from "../lib/agents-transcript.ts";
import { AgentsView } from "../lib/agents-view.ts";
import { PresencePublisher } from "../lib/orchestrator-presence.ts";
import { createNativeFullscreenInteraction } from "../lib/native-fullscreen-interaction.ts";
import { AGENTS_GLYPH, renderAgentsCard, widgetExpiryMs, widgetRows } from "../lib/agents-widget.ts";
import { CARD_TONE, renderCard } from "../lib/shell-card.ts";
import { openInExternalEditor } from "./gentle-shell.ts";
import { resolveGentlePiAgentHome } from "../lib/agent-home.ts";

// Gentle Agents: subagents as isolated `pi --mode rpc` children, a task
// store that notifies per task, and a Gentle Shell card above the editor.
// The tool names match the retired pi-subagents package so prompts, skills,
// and gentle-ai's delegation rules keep working unchanged.

export const AGENTS_WIDGET_KEY = "gentle-agents";
export const AGENTS_COMMAND_NAME = "gentle:agents";
export const AGENTS_RESULT_TYPE = "gentle-agents.result";
export const AGENTS_MESSAGE_TYPE = "gentle-agents.message";
export const AGENTS_ORCHESTRATOR_MESSAGE_TYPE = "gentle-agents.orchestrator-message";
const COLLAPSE_KEY_DEFAULT = "ctrl+shift+a";
const VIEW_KEY_DEFAULT = "alt+a";
const STOP_KEY_DEFAULT = "alt+s";
const RENDER_COALESCE_MS = 400;
const CLOCK_TICK_MS = 1000;
const TOOL_PREFIX = "subagent_";

export interface SessionTransportRegistry {
	list(excludeSessionId?: string): Promise<readonly SessionPresenceCandidate[]>;
	listActivations(excludeSessionId?: string): Promise<readonly PresenceRecord[]>;
	close?(): Promise<void>;
}

export interface SessionTransportListener {
	readonly registry: SessionTransportRegistry;
	start(): Promise<void>;
	close(): Promise<void>;
}

export interface SessionTransportClient {
	close(): void;
	sendNotification(recipientSessionId: string, message: string, options?: { id?: string; expectedActivation?: PresenceRecord; beforeConnect?: () => boolean | Promise<boolean>; signal?: AbortSignal }): Promise<SentNotification>;
}

export interface SessionTransportFactory {
	createRegistry(agentHome: string, observeWindowsPhase?: WindowsSessionRegistryPhaseObserver): Promise<SessionTransportRegistry>;
	createListener(registry: SessionTransportRegistry, sessionId: string, onNotification: (notification: ReceivedNotification) => Promise<void>): SessionTransportListener;
	createClient(registry: SessionTransportRegistry, sessionId: string): SessionTransportClient;
}

export interface AgentsDeps extends RunnerDeps {
	home: string;
	agentHome?: string;
	childIpc?: IpcEndpoint;
	sessionTransport?: SessionTransportFactory;
	env: NodeJS.ProcessEnv;
	resolveWorktree: WorktreeResolver;
}

export function agentRuntimePaths(home: string, agentHome = join(home, ".pi", "agent")): { sessions: string; transcripts: string } {
	const root = join(agentHome, "gentle-agents");
	return { sessions: join(root, "sessions"), transcripts: join(root, "transcripts") };
}

interface ToolText {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	terminate?: boolean;
}

const defaultDeps = (env: NodeJS.ProcessEnv): AgentsDeps => ({
	spawn: (command, args, options) => spawn(command, args, { cwd: options.cwd, env: options.env, stdio: options.stdio ?? ["pipe", "pipe", "pipe"], windowsHide: true, detached: options.detached }),
	now: () => Date.now(),
	schedule: (fn, ms) => {
		const timer = setTimeout(fn, ms);
		timer.unref?.();
		return () => clearTimeout(timer);
	},
	pi: piCommand(),
	home: os.homedir(),
	resolveWorktree: resolveSessionWorktree,
	env,
});

export function agentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.GENTLE_PI_AGENTS_CHILD === "1") return false;
	const value = env.GENTLE_PI_AGENTS?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

// The retired pi-subagents package registers the same tool names. While it
// is still installed we stay out of the way and say how to switch.
export const LEGACY_SUBAGENTS_PACKAGE = "pi-subagents-j0k3r";

export function legacySubagentsInstalled(home: string): boolean {
	return legacySubagentsInstalledAt(join(home, ".pi", "agent"));
}

function legacySubagentsInstalledAt(agentHome: string): boolean {
	const settingsPath = join(agentHome, "settings.json");
	if (!existsSync(settingsPath)) return false;
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: unknown };
		return Array.isArray(settings.packages) && settings.packages.some((entry) => typeof entry === "string" && entry.includes(LEGACY_SUBAGENTS_PACKAGE));
	} catch {
		return false;
	}
}

export function agentsViewKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.GENTLE_PI_AGENTS_VIEW_KEY?.trim();
	if (value === undefined) return VIEW_KEY_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

export function agentsCollapseKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.GENTLE_PI_AGENTS_KEY?.trim();
	if (value === undefined) return COLLAPSE_KEY_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

export function agentsStopKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.GENTLE_PI_AGENTS_STOP_KEY?.trim();
	if (value === undefined) return STOP_KEY_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

function sanitizeTerminalText(value: string): string {
	return value.replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, (control) => `\\x${control.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("\n");
}

function ownedChildIpc(env: NodeJS.ProcessEnv, candidate: IpcEndpoint | undefined): IpcEndpoint | undefined {
	if (env.GENTLE_PI_AGENTS_CHILD !== "1" || !env.GENTLE_PI_AGENTS_OWNED_IPC || !candidate || typeof candidate.send !== "function" || typeof candidate.on !== "function") return undefined;
	return candidate;
}

function registerChildMessaging(pi: ExtensionAPI, ipc: IpcEndpoint): void {
	const messenger = new ChildMessenger(ipc);
	pi.registerTool({
		name: "subagent_parent_message",
		label: "Agent parent message",
		description: "Send a bounded notification or correlated query to this subagent's parent.",
		parameters: { type: "object", additionalProperties: false, required: ["message"], properties: { kind: { type: "string", enum: ["notification", "query"] }, message: { type: "string" } } } as never,
		async execute(_id, params) {
			const input = params as { kind?: unknown; message?: unknown };
			if (typeof input.message !== "string") throw new Error("parent messages require text");
			if (input.kind === undefined || input.kind === "notification") {
				await messenger.notify(input.message);
				return { content: [{ type: "text", text: "Notification accepted by the parent." }], details: {} };
			}
			if (input.kind !== "query") throw new Error("parent messages require notification or query kind");
			const reply = await messenger.query(input.message);
			return { content: [{ type: "text", text: reply }], details: { reply } };
		},
	});
}

const posixSessionTransport: SessionTransportFactory = {
	createRegistry(agentHome) { return SessionPresenceRegistry.create(agentHome); },
	createListener(registry: SessionPresenceRegistry, sessionId, onNotification) { return new ActiveSessionListener(registry, sessionId, onNotification); },
	createClient(registry: SessionPresenceRegistry, sessionId) { return new ActiveSessionClient(registry, sessionId); },
};

const windowsSessionTransport: SessionTransportFactory = {
	createRegistry(agentHome, observeWindowsPhase) { return WindowsSessionPresenceRegistry.create(agentHome, observeWindowsPhase); },
	createListener(registry: WindowsSessionPresenceRegistry, sessionId, onNotification) { return new WindowsActiveSessionListener(registry, sessionId, onNotification); },
	createClient(registry: WindowsSessionPresenceRegistry, sessionId) { return new WindowsActiveSessionClient(registry, sessionId); },
};

export function createDefaultSessionTransport(platform: NodeJS.Platform = process.platform): SessionTransportFactory {
	return platform === "win32" ? windowsSessionTransport : posixSessionTransport;
}

function text(value: string, details: Record<string, unknown> = {}, terminate = false): ToolText {
	return { content: [{ type: "text", text: value }], details, ...(terminate ? { terminate: true } : {}) };
}

function taskDetails(task: TaskRecord): Record<string, unknown> {
	return { gentleAgents: { taskId: task.id, agent: task.agent, status: task.status, mode: task.mode, cwd: task.cwd } };
}

export function describeTask(task: TaskRecord): string {
	const head = `${task.id} · ${task.agent} · ${task.status} · ${task.mode}`;
	const detail = task.error ? `\n${task.error}` : "";
	return `${head} · cwd: ${task.cwd} · ${task.turns} turns · ${task.toolCalls} tool calls · last: ${task.lastStep}${detail}`;
}

function finishedText(task: TaskRecord): string {
	if (task.status === "completed") return task.result ?? "(the subagent returned no text)";
	return `Subagent ${task.agent} ${task.status}${task.error ? `: ${task.error}` : ""}${task.result ? `\n\nLast answer:\n${task.result}` : ""}`;
}

// pi's keybinding hint needs a live theme; outside one (tests, headless) the
// plain words still tell the reader what the key does.
function expandHint(expanded: boolean): string {
	try {
		return keyHint("app.tools.expand", expanded ? "collapse" : "expand");
	} catch {
		return expanded ? "collapse" : "expand";
	}
}

// What the model reads when a background task ends: the outcome first, then
// the answer itself. The card renderer shows the same text.
export function completionText(task: TaskRecord): string {
	const outcome = task.status === "completed" ? "finished" : task.status.replace("_", " ");
	return `Subagent ${task.agent} (task ${task.id}, "${task.label}") ${outcome}.\n\n${finishedText(task)}`;
}

// Host-side answer to a child's dialog: the same ctx.ui the human already
// uses, so a subagent's question looks like any other pi dialog.
export async function answerThroughUi(ui: ExtensionContext["ui"] | undefined, ask: AskRequest, raw: Record<string, unknown>): Promise<AskAnswer> {
	if (!ui) return { cancelled: true };
	const title = `${AGENTS_GLYPH} ${ask.title}`;
	switch (ask.method) {
		case "select": {
			const options = Array.isArray(raw.options) ? raw.options.map(String) : [];
			const value = await ui.select(title, options);
			return value === undefined ? { cancelled: true } : { value };
		}
		case "confirm":
			return { confirmed: await ui.confirm(title, typeof raw.message === "string" ? raw.message : "") };
		case "input": {
			const value = await ui.input(title, typeof raw.placeholder === "string" ? raw.placeholder : undefined);
			return value === undefined ? { cancelled: true } : { value };
		}
		case "editor": {
			const value = await ui.editor(title, typeof raw.prefill === "string" ? raw.prefill : undefined);
			return value === undefined ? { cancelled: true } : { value };
		}
		default:
			return { cancelled: true };
	}
}

export default function gentleAgents(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, overrides: Partial<AgentsDeps> = {}): void {
	const childIpc = ownedChildIpc(env, overrides.childIpc ?? (process.send ? process as unknown as IpcEndpoint : undefined));
	if (env.GENTLE_PI_AGENTS_CHILD === "1") {
		if (childIpc) registerChildMessaging(pi, childIpc);
		return;
	}
	if (!agentsEnabled(env)) return;
	const deps: AgentsDeps = { ...defaultDeps(env), ...overrides };
	const selectedHome = overrides.agentHome ?? (overrides.home === undefined ? resolveGentlePiAgentHome(deps.env) : join(deps.home, ".pi", "agent"));
	// Expand environment tildes like Pi, but leave explicit path APIs literal.
	const environmentHome = overrides.agentHome === undefined && overrides.home === undefined;
	const expandedHome = environmentHome && selectedHome === "~" ? deps.home
		: environmentHome && (selectedHome.startsWith("~/") || (process.platform === "win32" && selectedHome.startsWith("~\\"))) ? join(deps.home, selectedHome.slice(2)) : selectedHome;
	// Freeze the host's root before a child uses a different session cwd.
	const agentHome = resolve(expandedHome);
	const sessionTransport = deps.sessionTransport ?? createDefaultSessionTransport();
	if (legacySubagentsInstalledAt(agentHome)) {
		pi.on("session_start", (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`${AGENTS_GLYPH} Gentle Agents is waiting: remove the old package first with "pi remove npm:${LEGACY_SUBAGENTS_PACKAGE}"`, "warning");
		});
		return;
	}
	const collapseKey = agentsCollapseKey(env);
	const viewKey = agentsViewKey(env);
	const stopKey = agentsStopKey(env);
	const store = new TaskStore();
	const restoredTaskIds = new Set<string>();
	const tasksDir = historyDir(deps.home, agentHome);
	let ui: ExtensionContext["ui"] | undefined;
	let host: { requestRender(): void } | undefined;
	let sessions: ExtensionContext["sessionManager"] | undefined;
	let presence: PresencePublisher | undefined;
	const overlays = new Set<AgentsView>();
	const publishActivity = () => {
		if (!sessions) return;
		try {
			if (!presence || presence.error) {
				presence = PresencePublisher.start({ profile: agentHome, sessionId: activeSessionId() ?? "",
					label: sessions.getSessionName?.() || sessions.getCwd().split(/[\\/]/).pop() || "Orchestrator", activity: [] });
			}
			presence?.update(store.list(activeSessionId()).filter((task) => !isFinished(task.status) && !restoredTaskIds.has(task.id)).map((task) => ({ task, thread: store.thread(task.id) })));
		} catch { presence?.dispose(); presence = undefined; }
	};
	let worktrees: SessionWorktreeRegistry | undefined;
	const registryFor = (ctx: ExtensionContext) => {
		if (!worktrees || worktrees.sessionId !== ctx.sessionManager.getSessionId()) {
			worktrees?.close();
			worktrees = new SessionWorktreeRegistry(pi, ctx.sessionManager, ctx.sessionManager.getCwd(), deps.resolveWorktree);
		}
		return worktrees;
	};
	let collapsed = false;
	let renderQueued = false;
	let cancelClock: (() => void) | undefined;
	const ownedTaskIds = new Set<string>();
	const stoppingTaskIds = new Set<string>();
	const yieldedTaskIds = new Set<string>();
	let stopAllConfirmation: Promise<void> | undefined;

	// The card and its clock follow the session pi has open right now; a task
	// started before /new or /resume stays in the store and comes back with
	// its session. Before the first session_start there is nothing to scope by.
	const activeSessionId = (): string | undefined => (sessions === undefined ? undefined : sessions.getSessionId() ?? "");
	const visibleTasks = (): TaskRecord[] => store.list(activeSessionId());
	type SessionTransport = { generation: number; sessionId: string; sessionManager: ExtensionContext["sessionManager"]; client: SessionTransportClient; listener: SessionTransportListener };
	let transportGeneration = 0;
	let activeSessionTransport: SessionTransport | undefined;
	let transportStartup: Promise<void> | undefined;
	const validTransportSessionId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
	const closeSessionTransport = async (transport: SessionTransport | undefined) => {
		if (!transport) return;
		transport.client.close();
		await transport.listener.close();
	};
	const startSessionTransport = (ctx: ExtensionContext) => {
		const previous = activeSessionTransport;
		const generation = ++transportGeneration;
		const sessionManager = ctx.sessionManager;
		activeSessionTransport = undefined;
		const operation = (async () => {
			let registry: SessionTransportRegistry | undefined;
			let listener: SessionTransportListener | undefined;
			let client: SessionTransportClient | undefined;
			const closeStartupTransport = async () => {
				client?.close();
				await listener?.close().catch(() => {});
				await registry?.close?.().catch(() => {});
			};
			try {
				await closeSessionTransport(previous);
				const sessionId = sessionManager.getSessionId();
				if (!validTransportSessionId(sessionId) || sessions !== sessionManager || generation !== transportGeneration) return;
				registry = await sessionTransport.createRegistry(agentHome);
				if (sessions !== sessionManager || generation !== transportGeneration) {
					await closeStartupTransport();
					return;
				}
				listener = sessionTransport.createListener(registry, sessionId, async (notification) => {
					const active = activeSessionTransport;
					if (!active || active.generation !== generation || active.sessionManager !== sessionManager || active.sessionId !== sessionId || sessions !== sessionManager || activeSessionId() !== sessionId) throw new Error("stale session transport");
					pi.sendMessage({ customType: AGENTS_ORCHESTRATOR_MESSAGE_TYPE, content: `Session message from ${notification.senderSessionId} (correlation ${notification.id}): ${notification.message}`, display: true, details: { gentleAgents: { senderSessionId: notification.senderSessionId, recipientSessionId: sessionId, correlationId: notification.id, direction: "incoming" } } }, { deliverAs: "followUp", triggerTurn: true });
				});
				client = sessionTransport.createClient(registry, sessionId);
				if (sessions !== sessionManager || generation !== transportGeneration || activeSessionId() !== sessionId) {
					await closeStartupTransport();
					return;
				}
				const transport = { generation, sessionId, sessionManager, client, listener };
				// The listener deliberately accepts while publishing. Bind its callback
				// first so a peer accepted in that interval remains current-session work.
				activeSessionTransport = transport;
				await listener.start();
				if (sessions !== sessionManager || generation !== transportGeneration || activeSessionId() !== sessionId) {
					if (activeSessionTransport === transport) activeSessionTransport = undefined;
					await closeStartupTransport();
					return;
				}
			} catch {
				if (activeSessionTransport?.generation === generation) activeSessionTransport = undefined;
				await closeStartupTransport();
			}
		})();
		transportStartup = operation;
		void operation.finally(() => { if (transportStartup === operation) transportStartup = undefined; });
		return operation;
	};
	const shutdownSessionTransport = async () => {
		const active = activeSessionTransport;
		activeSessionTransport = undefined;
		transportGeneration++;
		await Promise.allSettled([transportStartup, closeSessionTransport(active)].filter((operation): operation is Promise<void> => operation !== undefined));
	};
	const activeTransportFor = (ctx: ExtensionContext) => {
		const active = activeSessionTransport;
		const sessionId = ctx.sessionManager.getSessionId();
		return active && active.generation === transportGeneration && active.sessionManager === ctx.sessionManager && active.sessionId === sessionId && sessions === ctx.sessionManager ? active : undefined;
	};

	const requestRender = () => {
		if (renderQueued) return;
		renderQueued = true;
		deps.schedule(() => {
			renderQueued = false;
			host?.requestRender();
		}, RENDER_COALESCE_MS);
	};

	// The elapsed column ticks once a second while something runs. Once every
	// task is done, one frame is due when the next finished row leaves the
	// card, so an idle terminal still sees it clear.
	const tickClock = () => {
		cancelClock?.();
		cancelClock = undefined;
		if (!sessions) return;
		const tasks = visibleTasks();
		if (tasks.some((task) => !isFinished(task.status))) {
			cancelClock = deps.schedule(() => {
				requestRender();
				tickClock();
			}, CLOCK_TICK_MS);
			return;
		}
		const expiry = widgetExpiryMs(tasks, deps.now());
		if (expiry === undefined) return;
		cancelClock = deps.schedule(() => {
			host?.requestRender();
			tickClock();
		}, expiry);
	};

	// A finished task goes to disk once, after its child is gone; the history
	// is then trimmed to the configured size. Failures never reach the TUI.
	const persist = (task: TaskRecord) => {
		void saveTask(tasksDir, task, store.thread(task.id))
			.then(() => pruneHistory(tasksDir, loadAgentsConfig({ cwd: task.cwd, home: deps.home, agentHome }).historyMaxTasks))
			.catch(() => {});
	};

	// A background result is delivered as a message: queued behind the current
	// turn if the model is busy, or starting a turn right away if it is idle.
	const deliver = (task: TaskRecord) => {
		pi.sendMessage({ customType: AGENTS_RESULT_TYPE, content: completionText(task), display: true, details: taskDetails(task) }, { deliverAs: "followUp", triggerTurn: true });
	};

	const runner = new AgentRunner(store, loadAgentsConfig({ cwd: process.cwd(), home: deps.home, agentHome }), deps, {
		askUser: (_taskId, ask, raw) => answerThroughUi(ui, ask, raw),
		onNotification: (task, message) => {
			if (activeSessionId() !== task.parentSessionId) return false;
			pi.sendMessage({ customType: AGENTS_MESSAGE_TYPE, content: message, display: true, details: { gentleAgents: { taskId: task.id, agent: task.agent, parentSessionId: task.parentSessionId, kind: "notification" } } }, { deliverAs: "followUp", triggerTurn: true });
			return true;
		},
		onQuery: (task, requestId, message) => {
			if (activeSessionId() !== task.parentSessionId) return false;
			const hadYield = yieldedTaskIds.has(task.id);
			if (task.mode === AGENT_MODE.TASK) yieldedTaskIds.add(task.id);
			try {
				pi.sendMessage({ customType: AGENTS_MESSAGE_TYPE, content: `Subagent ${task.agent} asks:\nTask ID: ${task.id}\nRequest ID: ${requestId}\nQuestion: ${message}`, display: true, details: { gentleAgents: { taskId: task.id, agent: task.agent, parentSessionId: task.parentSessionId, requestId, kind: "query" } } }, { deliverAs: "followUp", triggerTurn: true });
				return true;
			} catch (error) {
				if (task.mode === AGENT_MODE.TASK && !hadYield) yieldedTaskIds.delete(task.id);
				throw error;
			}
		},
		onSuccessfulMutation: (task, tool) => {
			if (!sessions || !worktrees || task.parentSessionId !== activeSessionId() || !ownedTaskIds.has(task.id)) return;
			const root = deps.resolveWorktree(tool.path, task.cwd)?.root;
			const childRoot = deps.resolveWorktree(task.cwd, task.cwd)?.root;
			if (!root || root !== childRoot || !worktrees.roots().includes(root)) return;
			recordReviewMutation(pi, sessions, root, { source: "subagent", taskId: task.id, toolName: tool.toolName, toolCallId: tool.toolCallId });
		},
		onFinish: (task) => {
			ownedTaskIds.delete(task.id);
			requestRender();
			persist(task);
			const yielded = yieldedTaskIds.delete(task.id);
			if ((task.mode === AGENT_MODE.BACKGROUND && task.status !== TASK_STATUS.CANCELLED) || (yielded && task.status !== TASK_STATUS.CANCELLED && activeSessionId() === task.parentSessionId)) deliver(task);
		},
	});

	pi.registerMessageRenderer(AGENTS_MESSAGE_TYPE, (message, options, theme) => {
		const details = (message.details as { gentleAgents?: { taskId?: unknown; agent?: unknown } } | undefined)?.gentleAgents;
		const taskId = typeof details?.taskId === "string" ? details.taskId : "unknown";
		const agent = typeof details?.agent === "string" ? details.agent : "Subagent";
		const heading = `${sanitizeTerminalText(agent)} message · Task ${sanitizeTerminalText(taskId)}`;
		const body = sanitizeTerminalText(messageText(message.content));
		return new Text(`${theme.fg("customMessageLabel", heading)}\n${theme.fg("customMessageText", body)}`, options.outputPad, 0);
	});

	pi.registerMessageRenderer(AGENTS_ORCHESTRATOR_MESSAGE_TYPE, (message, options, theme) => {
		const details = (message.details as { gentleAgents?: { senderSessionId?: unknown } } | undefined)?.gentleAgents;
		const sender = typeof details?.senderSessionId === "string" ? details.senderSessionId : "unknown";
		const heading = `⇄ Orchestrator message · Received · From ${sanitizeTerminalText(sender)}`;
		const body = sanitizeTerminalText(messageText(message.content));
		return new Text(`${theme.fg("customMessageLabel", heading)}\n${theme.fg("customMessageText", body)}`, options.outputPad, 0);
	});

	pi.registerMessageRenderer(AGENTS_RESULT_TYPE, (message, options, theme) => {
		const details = (message.details as { gentleAgents?: { agent?: string; status?: string } } | undefined)?.gentleAgents;
		const content = message.content as string | Array<{ type: string; text?: string }>;
		const body = (typeof content === "string" ? content : content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n")).split("\n");
		const tone = details?.status === "completed" ? CARD_TONE.SUCCESS : CARD_TONE.ERROR;
		const hint = expandHint(options.expanded);
		return {
			render(width: number) {
				return renderCard({ title: "Agent result", subtitle: details?.agent, body, tone, glyph: AGENTS_GLYPH }, theme, width, { expanded: options.expanded, hint });
			},
			invalidate() {},
		};
	});

	const isOwnedActive = (task: TaskRecord | undefined): task is TaskRecord => task !== undefined && ownedTaskIds.has(task.id) && !isFinished(task.status);

	const stopSelected = async (task: TaskRecord, ctx: ExtensionContext): Promise<void> => {
		const selected = store.get(task.id);
		if (!isOwnedActive(selected)) return;
		if (selected.status === TASK_STATUS.QUEUED) {
			if (runner.cancel(selected.id)) ctx.ui.notify(`Stopped ${selected.agent}.`);
			else ctx.ui.notify(`Task ${selected.agent} already finished.`, "warning");
			return;
		}
		if (stoppingTaskIds.has(selected.id)) return;
		stoppingTaskIds.add(selected.id);
		try {
			const message = selected.status === TASK_STATUS.WAITING ? "Its pending question will be dismissed." : "Current work may be incomplete.";
			if (!await ctx.ui.confirm(`Stop ${selected.agent}?`, message)) return;
			const current = store.get(selected.id);
			if (!isOwnedActive(current)) {
				ctx.ui.notify(`Task ${selected.agent} already finished.`, "warning");
				return;
			}
			if (runner.cancel(current.id)) ctx.ui.notify(`Stopped ${current.agent}.`);
			else ctx.ui.notify(`Task ${current.agent} already finished.`, "warning");
		} finally {
			stoppingTaskIds.delete(selected.id);
		}
	};

	const stopAll = (ctx: ExtensionContext): Promise<void> => {
		if (stopAllConfirmation) return stopAllConfirmation;
		const active = store.list().filter(isOwnedActive);
		if (active.length === 0) {
			ctx.ui.notify("No active subagents to stop.");
			return Promise.resolve();
		}
		const count = active.length;
		const noun = count === 1 ? "subagent" : "subagents";
		const confirmation = (async () => {
			try {
				if (!await ctx.ui.confirm(`Stop ${count} active ${noun}?`, `Only these ${count} ${noun} will stop. Current work may be incomplete.`)) return;
				const cancelled = active.filter((task) => runner.cancel(task.id)).length;
				ctx.ui.notify(`Stopped ${cancelled} ${cancelled === 1 ? "subagent" : "subagents"}.`);
			} finally {
				stopAllConfirmation = undefined;
			}
		})();
		stopAllConfirmation = confirmation;
		return confirmation;
	};

	// Tasks from earlier sessions come back from disk on demand.
	const resolveTask = async (id: string): Promise<TaskRecord | undefined> => {
		const live = store.get(id);
		if (live) return live;
		const stored = await loadStoredTask(tasksDir, id);
		if (stored) {
			restoredTaskIds.add(stored.task.id);
			store.restore(stored.task, stored.thread);
		}
		return stored?.task;
	};

	const openOverlay = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (ctx.mode !== "tui") {
			ctx.ui.notify("The agents overlay requires TUI mode.", "warning");
			return;
		}
		let view: AgentsView | undefined;
		let overlayHost: { requestRender(force?: boolean): void; stop(): void; start(): void } | undefined;
		const chosen = await ctx.ui.custom<TaskRecord | null>(
			(tui, theme, _keybindings, done) => {
				overlayHost = tui;
				view = new AgentsView({
					theme,
					rows: () => Math.max(0, tui.terminal.rows),
					store,
					sessionId: ctx.sessionManager.getSessionId() ?? "",
					presence: {
						profile: agentHome,
						get target() { return presence?.target; },
					},
					now: () => deps.now(),
					onCancel: (task) => void stopSelected(task, ctx),
					canCancel: isOwnedActive,
					isLocalTask: (task) => !restoredTaskIds.has(task.id),
					onOpen: (task) => done(task),
					onClose: () => done(null),
					requestRender: () => tui.requestRender(),
				});
				overlays.add(view);
				const interaction = createNativeFullscreenInteraction({
					keyboardTarget: view,
					requestRender: () => tui.requestRender(),
					mouseObserver: view.mouseObserver(),
				});
				interaction.addChild(view);
				return interaction;
			},
			{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } },
		).finally(() => {
			view?.dispose();
			if (view) overlays.delete(view);
		});
		if (!chosen || !overlayHost) return;
		if (!chosen.sessionPath) {
			ctx.ui.notify("This task has no session file yet.", "warning");
			return;
		}
		// The child's session is JSONL; the reader gets a markdown transcript.
		let transcriptPath: string;
		try {
			transcriptPath = await writeTranscript(chosen);
		} catch (error) {
			ctx.ui.notify(`Could not read the task's session: ${error instanceof Error ? error.message : String(error)}`, "warning");
			return;
		}
		if (!openInExternalEditor(overlayHost, transcriptPath)) ctx.ui.notify("No editor configured. Set $VISUAL or $EDITOR.", "warning");
	};

	const writeTranscript = async (task: TaskRecord): Promise<string> => {
		const dir = agentRuntimePaths(deps.home, agentHome).transcripts;
		await mkdir(dir, { recursive: true });
		const markdown = sessionToMarkdown(await readFile(task.sessionPath ?? "", "utf8"), { title: `${task.agent} · ${task.label} · ${task.status}` });
		const path = join(dir, `${task.id}.md`);
		await writeFile(path, markdown, "utf8");
		return path;
	};
	// A status change is worth a frame right away; deltas inside a task are
	// coalesced so a chatty child cannot flood the terminal.
	store.subscribeSummary(() => {
		publishActivity();
		host?.requestRender();
		tickClock();
	});

	const showWidget = (ctx: ExtensionContext) => {
		ui = ctx.hasUI ? ctx.ui : undefined;
		sessions = ctx.sessionManager;
		tickClock();
		ui?.setWidget(AGENTS_WIDGET_KEY, (tui, theme) => {
			host = tui;
			return sidebarPart(tui, "agents", {
				render(width: number) {
					const lines = renderAgentsCard(visibleTasks(), theme, width, deps.now(), { collapsed, collapseKey, maxRows: widgetRows(tui.terminal?.rows), viewKey });
					return lines.length === 0 ? [] : [...lines, ""];
				},
				invalidate() {},
			}, {
				render: (width) => renderAgentsCard(visibleTasks(), theme, width, deps.now(), { collapsed, collapseKey, viewKey }),
				invalidate() {},
			});
		});
	};

	const roots = (ctx: ExtensionContext) => ({ cwd: ctx.sessionManager.getCwd(), home: deps.home, agentHome });

	const buildRequest = (ctx: ExtensionContext, agent: AgentDefinition, prompt: string, label: string | undefined, context: string | undefined, mode: AgentMode, resume?: string, workspaceRoot?: string): TaskRequest => {
		const registry = registryFor(ctx);
		const parentCwd = ctx.sessionManager.getCwd();
		// An explicit target is validated before any queue or session-dir writes.
		const parentIdentity = deps.resolveWorktree(parentCwd, parentCwd);
		// Preserve ordinary non-Git continuation, without admitting any new root.
		const sameNonGitContinuation = resume !== undefined && workspaceRoot === parentCwd && !parentIdentity;
		const target = workspaceRoot !== undefined && !sameNonGitContinuation ? registry.validate(workspaceRoot) : parentIdentity?.root;
		const config = loadAgentsConfig(roots(ctx));
		const profile = resolveAgentProfile(agent, config);
		const sessionDir = agentRuntimePaths(deps.home, agentHome).sessions;
		mkdirSync(sessionDir, { recursive: true });
		const parentSessionManager = ctx.sessionManager as unknown as ReviewSessionManager;
		const parentSessionId = ctx.sessionManager.getSessionId() ?? "";
		const parentWorktreeRoot = ctx.sessionManager.getCwd();
		const parentRepositoryIdentity = resolveCanonicalGitRepositoryIdentitySync(parentWorktreeRoot);
		return {
			agent,
			prompt,
			label,
			context,
			mode,
			cwd: target ?? parentWorktreeRoot,
			parentSessionId,
			...(target === undefined ? {} : { onLaunch: () => { registry.register(target, "subagent:spawn"); } }),
			model: profile.model,
			thinking: profile.thinking,
			sessionDir,
			resumeSessionPath: resume,
			env: deps.env,
			...(parentRepositoryIdentity === undefined ? {} : {
				authorizeParentStandingReviewPermission: (repositoryIdentity: string) => {
					try {
						return repositoryIdentity === parentRepositoryIdentity &&
							parentSessionManager.getSessionId() === parentSessionId &&
							parentSessionId.length > 0 &&
							hasReviewSessionPermission({
								sessionManager: parentSessionManager,
								sessionId: parentSessionId,
								worktreeRoot: parentWorktreeRoot,
								repositoryIdentity: parentRepositoryIdentity,
							});
					} catch {
						return false;
					}
				},
			}),
		};
	};

	const launch = async (ctx: ExtensionContext, request: TaskRequest): Promise<ToolText> => {
		const task = runner.run(request);
		ownedTaskIds.add(task.id);
		store.subscribe(task.id, () => { publishActivity(); requestRender(); });
		if (request.mode === AGENT_MODE.BACKGROUND) return text(`Started ${task.agent} in the background as task ${task.id}. Use subagent_status or subagent_result with that id.`, taskDetails(task));
		const query = await runner.waitForQuery(task.id);
		if (query) {
			const live = store.get(task.id) ?? task;
			return text(`Subagent ${live.agent} is waiting for your reply to request ${query.requestId}.`, { gentleAgents: { taskId: live.id, agent: live.agent, status: live.status, mode: live.mode, requestId: query.requestId } }, true);
		}
		const finished = await runner.waitFor(task.id);
		return text(finishedText(finished), taskDetails(finished));
	};

	const tool = (name: string, description: string, parameters: Record<string, unknown>, execute: (params: Record<string, unknown>, ctx: ExtensionContext) => Promise<ToolText>) => {
		pi.registerTool({
			name: `${TOOL_PREFIX}${name}`,
			renderShell: "self",
			label: `Agent ${name.replace(/_/g, " ")}`,
			description,
			parameters: { type: "object", additionalProperties: false, ...parameters } as never,
			renderCall(args, theme) {
				const params = args as { agent?: string; task_id?: string };
				return new Text(theme.fg("toolTitle", `${AGENTS_GLYPH} agent ${name.replace(/_/g, " ")}${params.agent ? ` · ${params.agent}` : params.task_id ? ` · ${params.task_id}` : ""}`), 0, 0);
			},
			renderResult(result, options, theme) {
				const body = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
				return new Text(options.expanded ? body : theme.fg("muted", body.split("\n")[0] ?? ""), 0, 0);
			},
			async execute(_id, params, _signal, _onUpdate, ctx) {
				return execute(params as Record<string, unknown>, ctx);
			},
		});
	};

	pi.registerTool({
		name: "orchestrator_session_id",
		label: "Orchestrator session ID",
		description: "Return this host session's active ID.",
		parameters: { type: "object", additionalProperties: false, properties: {} } as never,
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const transport = activeTransportFor(ctx);
			return transport ? text(`Active session ID: ${transport.sessionId}`, { gentleAgents: { senderSessionId: transport.sessionId } }) : text("Error: session messaging is not ready.", { error: "not ready" });
		},
	});
	pi.registerTool({
		name: "orchestrator_list",
		label: "List orchestrators",
		description: "List other sessions advertised by the trusted local profile. Advertised reachability is unknown and does not prove a session is live.",
		parameters: { type: "object", additionalProperties: false, properties: {} } as never,
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const transport = activeTransportFor(ctx);
			if (!transport) return text("Error: session discovery is not ready.", { error: "not ready" });
			try {
				const peers = await transport.listener.registry.list(transport.sessionId);
				if (activeTransportFor(ctx) !== transport) return text("Error: session discovery became unavailable before results were confirmed.", { error: "stale" });
				return peers.length === 0 ? text("No other sessions are currently advertised. Advertisements have unknown reachability and do not guarantee a live session.") : text(`Advertised sessions (reachability is unknown):\n${peers.map((peer) => `- ${peer.sessionId}`).join("\n")}`, { gentleAgents: { candidates: peers } });
			} catch {
				return text("Error: session discovery is unavailable.", { error: "unavailable" });
			}
		},
	});
	pi.registerTool({
		name: "orchestrator_send_message",
		label: "Send orchestrator message",
		description: "Send a notification to another active session in this trusted local profile. If recipient_session_id is omitted, the sole peer is selected or the user selects one. Acceptance means enqueued, not read or completed.",
		parameters: { type: "object", additionalProperties: false, required: ["message"], properties: { recipient_session_id: { type: "string" }, message: { type: "string" } } } as never,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const transport = activeTransportFor(ctx);
			const input = params as { recipient_session_id?: unknown; message?: unknown };
			if (!transport) return text("Error: session messaging is not ready.", { error: "not ready" });
			if (typeof input.message !== "string" || Buffer.byteLength(input.message, "utf8") > 8192) return text("Error: recipient session ID or message is invalid.", { error: "invalid input" });
			let recipient = input.recipient_session_id;
			let activation: PresenceRecord | undefined;
			if (recipient !== undefined && !validTransportSessionId(recipient)) return text("Error: recipient session ID or message is invalid.", { error: "invalid input" });
			if (recipient === undefined) {
				try {
					const candidates = (await transport.listener.registry.listActivations(transport.sessionId)).filter((candidate) => candidate.sessionId !== transport.sessionId);
					if (activeTransportFor(ctx) !== transport || signal?.aborted) return text("Message selection was cancelled.", { error: "cancelled" });
					if (candidates.length === 0) return text("No other sessions are currently advertised; message delivery is unavailable.", { error: "unavailable" });
					if (candidates.length === 1) {
						recipient = candidates[0].sessionId;
						activation = candidates[0];
					} else if (!ctx.hasUI) return text("Several recipient orchestrators are available. Ask the user to choose a recipient label; do not ask for a session ID.", { gentleAgents: { candidates: candidates.map((candidate) => ({ label: `Orchestrator ${candidate.sessionId}`, sessionId: candidate.sessionId })) } });
					else {
						const labels = candidates.map((candidate) => `Orchestrator ${candidate.sessionId}`);
						const selected = await ctx.ui.select("Select recipient orchestrator", labels, { signal });
						if (selected === undefined || activeTransportFor(ctx) !== transport || signal?.aborted) return text("Message selection was cancelled.", { error: "cancelled" });
						const index = labels.indexOf(selected);
						if (index < 0) return text("Message selection was cancelled.", { error: "cancelled" });
						recipient = candidates[index].sessionId;
						activation = candidates[index];
					}
				} catch {
					return text("Error: session discovery is unavailable.", { error: "unavailable" });
				}
			}
			if (recipient === transport.sessionId) return text("Error: cannot send a message to the active session.", { error: "self" });
			try {
				const accepted = await transport.client.sendNotification(recipient!, input.message, { signal, expectedActivation: activation, beforeConnect: () => activeTransportFor(ctx) === transport });
				return activeTransportFor(ctx) === transport ? text(`Message ${accepted.id} from ${transport.sessionId} to ${recipient} accepted for delivery; it is not a delivery or read receipt.`, { gentleAgents: { messageId: accepted.id, senderSessionId: transport.sessionId, recipientSessionId: recipient, state: "accepted" } }) : text("Error: session messaging is not ready.", { error: "stale" });
			} catch {
				return text("Error: session message was not accepted.", { error: "not accepted" });
			}
		},
	});

	tool("list_agents", "List the subagents defined for this project and user, with their descriptions.", { properties: {} }, async (_params, ctx) => {
		const { agents, errors } = discoverAgents(roots(ctx));
		const lines = agents.map((agent) => `- ${agent.name} (${agent.scope}): ${agent.description || "no description"}`);
		const problems = errors.map((error) => `! ${error}`);
		return text(lines.length === 0 ? "No subagents defined." : [...lines, ...problems].join("\n"));
	});

	tool(
		"run",
		"Delegate a task to a named subagent. Task mode waits for the answer; background mode returns a task id immediately.",
		{
			required: ["agent", "task"],
			properties: {
				agent: { type: "string", description: "Subagent name from subagent_list_agents." },
				task: { type: "string", description: "What the subagent must do, self-contained." },
				label: { type: "string", description: "Three to six words naming the work, shown on the agents card, e.g. 'map footer data sources'." },
				context: { type: "string", description: "Optional extra context appended to the task." },
				workspace_root: { type: "string", description: "Optional worktree in the same Git clone. Validated before queueing; the child runs at its canonical root and registers it on actual launch." },
				mode: { type: "string", enum: ["task", "background"], description: "task waits for the result (default); background returns immediately." },
			},
		},
		async (params, ctx) => {
			const { agents } = discoverAgents(roots(ctx));
			const agent = agents.find((candidate) => candidate.name === params.agent);
			if (!agent) return text(`Error: no subagent named "${String(params.agent)}". Known: ${agents.map((candidate) => candidate.name).join(", ") || "none"}`, { error: "unknown agent" });
			const mode = (params.mode as AgentMode | undefined) ?? agent.mode ?? loadAgentsConfig(roots(ctx)).defaultMode;
			return launch(ctx, buildRequest(ctx, agent, String(params.task ?? ""), typeof params.label === "string" ? params.label : undefined, typeof params.context === "string" ? params.context : undefined, mode, undefined, typeof params.workspace_root === "string" ? params.workspace_root : undefined));
		},
	);

	tool("status", "Report the status of one subagent task.", { required: ["task_id"], properties: { task_id: { type: "string" } } }, async (params) => {
		const task = await resolveTask(String(params.task_id));
		return task ? text(describeTask(task), taskDetails(task)) : text(`Error: no task ${String(params.task_id)}`, { error: "unknown task" });
	});

	tool("result", "Return the final answer of a finished subagent task, or its current state if it is still running.", { required: ["task_id"], properties: { task_id: { type: "string" } } }, async (params) => {
		const task = await resolveTask(String(params.task_id));
		if (!task) return text(`Error: no task ${String(params.task_id)}`, { error: "unknown task" });
		return text(isFinished(task.status) ? finishedText(task) : `Task ${task.id} is still ${task.status} (last: ${task.lastStep}).`, taskDetails(task));
	});

	tool("list_tasks", "List the subagent tasks of this session, newest first.", { properties: {} }, async (_params, ctx) => {
		const tasks = store.list(ctx.sessionManager.getSessionId() ?? "");
		return text(tasks.length === 0 ? "No subagent tasks in this session." : tasks.map(describeTask).join("\n"));
	});

	tool("reply", "Reply once to a live query from a child of the current parent session.", { required: ["task_id", "request_id", "message"], properties: { task_id: { type: "string" }, request_id: { type: "string" }, message: { type: "string" } } }, async (params, ctx) => {
		const accepted = await runner.reply(String(params.task_id), String(params.request_id), typeof params.message === "string" ? params.message : "", ctx.sessionManager.getSessionId() ?? "");
		return accepted ? text("Reply accepted for delivery.") : text("Error: query is unavailable.", { error: "query unavailable" });
	});

	tool("cancel",  "Cancel a queued or running subagent task.", { required: ["task_id"], properties: { task_id: { type: "string" } } }, async (params) => {
		const id = String(params.task_id);
		return runner.cancel(id) ? text(`Cancelled task ${id}.`) : text(`Error: task ${id} is not running.`, { error: "not running" });
	});

	tool("send_message", "Steer a running subagent with a message delivered before its next model call.", { required: ["task_id", "message"], properties: { task_id: { type: "string" }, message: { type: "string" } } }, async (params) => {
		const id = String(params.task_id);
		return runner.steer(id, String(params.message ?? "")) ? text(`Message queued for task ${id}.`) : text(`Error: task ${id} is not running.`, { error: "not running" });
	});

	tool(
		"continue",
		"Resume a finished subagent task in its own session with a follow-up prompt.",
		{ required: ["task_id", "prompt"], properties: { task_id: { type: "string" }, prompt: { type: "string" }, label: { type: "string", description: "Three to six words naming the follow-up." }, mode: { type: "string", enum: ["task", "background"] } } },
		async (params, ctx) => {
			const previous = await resolveTask(String(params.task_id));
			if (!previous) return text(`Error: no task ${String(params.task_id)}`, { error: "unknown task" });
			if (!isFinished(previous.status) || !previous.sessionPath) return text(`Error: task ${previous.id} cannot be continued yet (${previous.status}).`, { error: "not continuable" });
			const agent = discoverAgents(roots(ctx)).agents.find((candidate) => candidate.name === previous.agent);
			if (!agent) return text(`Error: subagent "${previous.agent}" is no longer defined.`, { error: "unknown agent" });
			const mode = (params.mode as AgentMode | undefined) ?? (previous.mode as AgentMode);
			return launch(ctx, buildRequest(ctx, agent, String(params.prompt ?? ""), typeof params.label === "string" ? params.label : undefined, undefined, mode, previous.sessionPath, previous.cwd));
		},
	);

	if (collapseKey) {
		pi.registerShortcut(collapseKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Collapse or expand the agents card",
			handler: async () => {
				collapsed = !collapsed;
				host?.requestRender();
			},
		});
	}

	pi.registerCommand(AGENTS_COMMAND_NAME, {
		description: "Show this session's active subagents; a lists open orchestrators in this profile. Peer threads are read-only; o opens a local task's transcript in $EDITOR.",
		handler: async (_args, ctx) => openOverlay(ctx),
	});
	if (viewKey) {
		pi.registerShortcut(viewKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Show the subagents overlay",
			handler: async (ctx) => openOverlay(ctx),
		});
	}
	if (stopKey) {
		pi.registerShortcut(stopKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Stop active subagent(s)",
			handler: async (ctx) => stopAll(ctx),
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		presence?.dispose();
		registryFor(ctx);
		showWidget(ctx);
		try {
			presence = PresencePublisher.start({ profile: agentHome, sessionId: activeSessionId() ?? "",
				label: ctx.sessionManager.getSessionName?.() || ctx.sessionManager.getCwd().split(/[\\/]/).pop() || "Orchestrator", activity: [] });
			publishActivity();
		} catch { presence = undefined; }
		await startSessionTransport(ctx);
	});
	pi.on("session_shutdown", async () => {
		presence?.dispose();
		presence = undefined;
		cancelClock?.();
		for (const view of overlays) { view.handleInput("q"); view.dispose(); }
		overlays.clear();
		sessions = undefined;
		worktrees?.close();
		worktrees = undefined;
		const stopped = shutdownSessionTransport();
		runner.cancelAll();
		await stopped;
	});
}
