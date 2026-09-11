import { spawn } from "node:child_process";
import { recordReviewMutation } from "../lib/review-reminder-receipt.ts";
import { SessionWorktreeRegistry, resolveSessionWorktree, type WorktreeResolver } from "../lib/session-worktree-registry.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { keyHint, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import { sidebarPart } from "../lib/shell-sidebar.ts";
import { invalidateSidebar } from "../lib/shell-sidebar-layout.ts";
import { createCompletionQueue } from "../lib/agents-completion-delivery.ts";
import { AGENT_MODE, discoverAgents, loadAgentsConfig, resolveAgentProfile, type AgentDefinition, type AgentMode } from "../lib/agents-config.ts";
import { isFinished, TASK_STATUS, TaskStore, type AskRequest, type TaskRecord } from "../lib/agents-protocol.ts";
import { AgentRunner, piCommand, type AskAnswer, type RunnerDeps, type SddChangeSelection, type TaskRequest } from "../lib/agents-runner.ts";
import { ChildMessenger, type IpcEndpoint } from "../lib/agents-messaging.ts";
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
import { researchAgent, resolveResearchCapabilities, renderResearchCapabilities, RESEARCH_CHILD_TOOLS_ENV } from "../lib/sdd-research-capabilities.ts";
import { CHILD_METRICS_EVENT, CHILD_METRICS_REVOKED, childEvent, launchSelection, type LaunchSelection } from "../lib/runtime-metrics-children.ts";
import { lookupPiCatalogName } from "../lib/runtime-metrics-pi-identity.ts";
import { runtimeMetricsEnvAllows, type RuntimeMetricsPolicyDeps } from "../lib/runtime-metrics-policy.ts";

// Gentle Agents: subagents as isolated `pi --mode rpc` children, a task
// store that notifies per task, and a Gentle Shell card above the editor.
// The tool names match the retired pi-subagents package so prompts, skills,
// and gentle-ai's delegation rules keep working unchanged.

export const AGENTS_WIDGET_KEY = "gentle-agents";
export const AGENTS_COMMAND_NAME = "gentle:agents";
export const AGENTS_RESULT_TYPE = "gentle-agents.result";
export const AGENTS_MESSAGE_TYPE = "gentle-agents.message";
export const AGENTS_STALE_RESULT_TYPE = "gentle-agents.stale-result";
const COLLAPSE_KEY_DEFAULT = "ctrl+shift+a";
const VIEW_KEY_DEFAULT = "alt+a";
const STOP_KEY_DEFAULT = "alt+s";
const RENDER_COALESCE_MS = 400;
const CLOCK_TICK_MS = 1000;
const TOOL_PREFIX = "subagent_";
const SDD_PHASE_BY_AGENT = {
	"sdd-apply": "apply",
	"sdd-verify": "verify",
	"sdd-sync": "sync",
	"sdd-archive": "archive",
} as const;

function sddPhaseForAgent(name: string): SddChangeSelection["phase"] | undefined {
	return SDD_PHASE_BY_AGENT[name as keyof typeof SDD_PHASE_BY_AGENT];
}

function parseSddChange(value: unknown, agentName: string): SddChangeSelection | undefined {
	if (value === undefined) return undefined;
	const expectedPhase = sddPhaseForAgent(agentName);
	if (!expectedPhase) throw new Error("sdd_change is allowed only for SDD apply, verify, sync, or archive agents.");
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("sdd_change must be an object with changeName, workspaceRoot, and phase.");
	const selection = value as Record<string, unknown>;
	const keys = Object.keys(selection).sort();
	if (keys.join(",") !== "changeName,phase,workspaceRoot" ||
		typeof selection.changeName !== "string" || selection.changeName.length === 0 ||
		typeof selection.workspaceRoot !== "string" || selection.workspaceRoot.length === 0 ||
		selection.phase !== expectedPhase) {
		throw new Error("sdd_change must contain only a non-empty changeName, workspaceRoot, and the agent's matching phase.");
	}
	return { changeName: selection.changeName, workspaceRoot: selection.workspaceRoot, phase: selection.phase };
}

export interface AgentsDeps extends RunnerDeps {
	home: string;
	agentHome?: string;
	childIpc?: IpcEndpoint;
	env: NodeJS.ProcessEnv;
	resolveWorktree: WorktreeResolver;
	runtimeMetricsPolicy?: RuntimeMetricsPolicyDeps;
	metricsNow?: () => number;
	metricsSchedule?: RunnerDeps["schedule"];
	lookupPiCatalogName?: typeof lookupPiCatalogName;
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
	if (env.GENTLE_PI_AGENTS_CHILD === "1" && env[RESEARCH_CHILD_TOOLS_ENV] !== undefined) {
		let allowed: string[] = [];
		try {
			const parsed: unknown = JSON.parse(env[RESEARCH_CHILD_TOOLS_ENV]!);
			if (Array.isArray(parsed) && parsed.every(value => typeof value === "string")) allowed = parsed;
		} catch { /* Invalid launch restrictions deny every tool. */ }
		pi.on("before_agent_start", event => ({ systemPrompt: `${event.systemPrompt}\n\n${renderResearchCapabilities(resolveResearchCapabilities(pi, allowed))}` }));
		pi.on("tool_call", event => {
			if (!allowed.includes(event.toolName) || !pi.getActiveTools().includes(event.toolName)) {
				return { block: true, reason: "Tool is outside the research child's active launch allowlist." };
			}
		});
	}
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
	let sidebarTui: TUI | undefined;
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
	const metricsNow = deps.metricsNow ?? (() => performance.now());
	const catalogLookup = deps.lookupPiCatalogName ?? lookupPiCatalogName;
	let metricsOwner = {};
	const metricTasks = new Map<string, { selection?: LaunchSelection; started: number; launched: boolean; finished: boolean; current(): boolean; valid(): boolean }>();
	const unsubscribeMetrics = pi.events.on(CHILD_METRICS_REVOKED, id => {
		if (id === activeSessionId()) {
			metricsOwner = {};
			for (const taskId of metricTasks.keys()) runner.discardResponseObservations(taskId);
			metricTasks.clear();
		}
	});
	const clearTaskMetrics = () => {
		metricsOwner = {};
		for (const taskId of metricTasks.keys()) runner.discardResponseObservations(taskId);
		metricTasks.clear();
	};
	pi.on("session_start", clearTaskMetrics);
	pi.on("session_shutdown", () => {
		clearTaskMetrics();
		unsubscribeMetrics();
	});
	let stopAllConfirmation: Promise<void> | undefined;

	// The card and its clock follow the session pi has open right now; a task
	// started before /new or /resume stays in the store and comes back with
	// its session. Before the first session_start there is nothing to scope by.
	const activeSessionId = (): string | undefined => (sessions === undefined ? undefined : sessions.getSessionId() ?? "");
	const visibleTasks = (): TaskRecord[] => store.list(activeSessionId());

	const requestRender = () => {
		if (renderQueued) return;
		renderQueued = true;
		deps.schedule(() => {
			renderQueued = false;
			if (sidebarTui) invalidateSidebar(sidebarTui);
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
			if (sidebarTui) invalidateSidebar(sidebarTui);
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

	// A background result used to be handed straight to the host as a followUp
	// message, but the host only drains that queue when the parent agent stops
	// calling tools entirely, so in a long orchestrator run the notification
	// could land nearly an hour after the parent pulled the same result (#867).
	// Gentle Agents now owns the pending completions: they settle here, are
	// flushed at the next turn boundary, and a stale one never re-enters the
	// conversation.
	const completions = createCompletionQueue<TaskRecord>();
	let activeAgentRuns = 0;

	const deliver = (task: TaskRecord) => {
		// Ownership is consulted at delivery time, matching onNotification and
		// onQuery: a completion owned by another session is dropped, not delivered.
		if (activeSessionId() !== task.parentSessionId) return;
		// "steer" + triggerTurn keeps delivery bounded to the current turn. While
		// the parent streams, the host polls steering each turn and injects the
		// message before the next LLM call; "followUp" is NOT acceptable here
		// because the host drains the follow-up queue only in the run loop's stop
		// branch, so a parent that keeps calling tools would see the completion
		// only when the whole run ends — the original #867 delay. When the parent
		// is idle, triggerTurn runs the prompt immediately, preserving wake-up.
		pi.sendMessage({ customType: AGENTS_RESULT_TYPE, content: completionText(task), display: true, details: taskDetails(task) }, { deliverAs: "steer", triggerTurn: true });
	};

	// A stale completion must not re-enter the LLM conversation, so it is
	// delivered as durable TUI-only content and the human still sees it.
	const deliverStale = (task: TaskRecord, settledAt: number) => {
		if (activeSessionId() !== task.parentSessionId) return;
		const ageSeconds = Math.max(0, Math.round((deps.now() - settledAt) / 1000));
		pi.appendEntry(AGENTS_STALE_RESULT_TYPE, { taskId: task.id, agent: task.agent, label: task.label, status: task.status, ageSeconds });
	};

	const flushCompletions = () => {
		for (const { task, settledAt, stale } of completions.takeDeliverable(deps.now())) {
			try {
				if (stale) deliverStale(task, settledAt);
				else deliver(task);
			} catch { /* Best-effort delivery: at most once, even if forwarding fails. */ }
		}
	};

	// A completion settles into our queue. An idle parent flushes right away so
	// the wake-up behavior is unchanged; a busy parent flushes at the next turn
	// boundary, and the steer mode injects it before that turn's next LLM call
	// instead of parking it behind the whole run.
	const settleCompletion = (task: TaskRecord) => {
		completions.enqueue(task, deps.now());
		if (activeAgentRuns === 0) flushCompletions();
	};

	// `agent_start`/`agent_end` bracket a parent agent run; `turn_end` fires at
	// every turn boundary inside one, so with steering delivery a held
	// completion is injected before the next LLM call and never outlives the
	// current turn. `agent_end` stays a flush trigger for runs that end without
	// a final `turn_end` (an aborted run, or the host's early post-run return
	// when a run produced no assistant message; the host compensates via
	// hasQueuedMessages() + continue(), so steering there is still bounded).
	// `agent_settled` is the final idle boundary after retries — normally a
	// no-op safety net, since anything enqueued while idle flushes right away.
	pi.on("agent_start", () => { activeAgentRuns += 1; });
	pi.on("agent_end", () => {
		activeAgentRuns = Math.max(0, activeAgentRuns - 1);
		flushCompletions();
	});
	pi.on("agent_settled", () => flushCompletions());
	pi.on("turn_end", () => flushCompletions());

	const runner = new AgentRunner(store, loadAgentsConfig({ cwd: process.cwd(), home: deps.home, agentHome }), deps, {
		askUser: (_taskId, ask, raw) => answerThroughUi(ui, ask, raw),
		onNotification: (task, message) => {
			if (activeSessionId() !== task.parentSessionId) return false;
			pi.sendMessage({ customType: AGENTS_MESSAGE_TYPE, content: message, display: false, details: { gentleAgents: { taskId: task.id, agent: task.agent, parentSessionId: task.parentSessionId, kind: "notification" } } }, { deliverAs: "followUp", triggerTurn: true });
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
		onFinish: (task, observations) => {
			// Completion is the only forwarding opportunity. No pending event, policy
			// query or promise survives this callback; the receiver drops when busy.
			const { id, parentSessionId, status } = task;
			const metrics = metricTasks.get(id);
			metricTasks.delete(id); // Deliver at most once, even if forwarding fails.
			try {
				const authorized = metrics?.valid();
				if (metrics) metrics.finished = true;
				if (authorized && metrics?.launched && metrics.selection && observations) {
					const event = childEvent(parentSessionId, id, metrics.selection, status, observations, metrics.started);
					if (event && metrics.current()) pi.events.emit(CHILD_METRICS_EVENT, event);
				}
			} catch { /* Metrics must never interrupt task finalization. */ }
			try {
				ownedTaskIds.delete(task.id);
				requestRender();
				persist(task);
				const yielded = yieldedTaskIds.delete(task.id);
				if ((task.mode === AGENT_MODE.BACKGROUND && task.status !== TASK_STATUS.CANCELLED) || (yielded && task.status !== TASK_STATUS.CANCELLED && activeSessionId() === task.parentSessionId)) settleCompletion(task);
			} catch { /* Best-effort completion bookkeeping cannot strand runner waiters. */ }
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

	// A stale completion is appended as a custom entry: durable transcript
	// content for the human that never participates in the LLM context.
	pi.registerEntryRenderer(AGENTS_STALE_RESULT_TYPE, (entry, options, theme) => {
		const data = (entry.data ?? {}) as { taskId?: unknown; agent?: unknown; label?: unknown; status?: unknown; ageSeconds?: unknown };
		const taskId = typeof data.taskId === "string" ? data.taskId : "unknown";
		const agent = typeof data.agent === "string" ? data.agent : "Subagent";
		const label = typeof data.label === "string" ? data.label : "";
		const status = typeof data.status === "string" ? data.status.replace("_", " ") : "unknown";
		const ageSeconds = typeof data.ageSeconds === "number" && Number.isFinite(data.ageSeconds) ? Math.max(0, Math.round(data.ageSeconds)) : 0;
		const age = ageSeconds < 90 ? `${ageSeconds}s` : ageSeconds < 3600 ? `${Math.round(ageSeconds / 60)}m` : `${Math.round(ageSeconds / 3600)}h`;
		const body = [
			`Subagent ${sanitizeTerminalText(agent)} (task ${sanitizeTerminalText(taskId)}, "${sanitizeTerminalText(label)}") ${sanitizeTerminalText(status)} about ${age} ago, while the orchestrator was still busy.`,
			"Marked stale: the result was not replayed into the conversation. It stays available through subagent_status and subagent_result.",
		];
		return {
			render(width: number) {
				return renderCard({ title: "Stale agent result", subtitle: `${agent} · task ${taskId}`, body, tone: CARD_TONE.WARNING, glyph: AGENTS_GLYPH }, theme, width, { expanded: options.expanded, hint: expandHint(options.expanded) });
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
		if (sidebarTui) invalidateSidebar(sidebarTui);
		host?.requestRender();
		tickClock();
	});

	const showWidget = (ctx: ExtensionContext) => {
		ui = ctx.hasUI ? ctx.ui : undefined;
		sessions = ctx.sessionManager;
		tickClock();
		ui?.setWidget(AGENTS_WIDGET_KEY, (tui, theme) => {
			host = tui;
			sidebarTui = tui;
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

	const buildRequest = (ctx: ExtensionContext, agent: AgentDefinition, prompt: string, label: string | undefined, context: string | undefined, mode: AgentMode, resume?: string, workspaceRoot?: string, sddChange?: SddChangeSelection): TaskRequest => {
		const registry = registryFor(ctx);
		const parentCwd = ctx.sessionManager.getCwd();
		// An explicit target is validated before any queue or session-dir writes.
		const parentIdentity = deps.resolveWorktree(parentCwd, parentCwd);
		const selectedRoot = workspaceRoot ?? sddChange?.workspaceRoot;
		// Preserve ordinary non-Git continuation, without admitting any new root.
		const sameNonGitContinuation = resume !== undefined && selectedRoot === parentCwd && !parentIdentity;
		const target = selectedRoot !== undefined && !sameNonGitContinuation ? registry.validate(selectedRoot) : parentIdentity?.root;
		if (sddChange && target !== sddChange.workspaceRoot && target !== resolve(sddChange.workspaceRoot)) {
			throw new Error("sdd_change workspaceRoot must resolve to the selected child worktree.");
		}
		const launchSddChange = sddChange === undefined || target === undefined
			? undefined
			: { ...sddChange, workspaceRoot: target };
		const config = loadAgentsConfig(roots(ctx));
		const profile = resolveAgentProfile(agent, config);
		const research = agent.name === "sdd-research" ? researchAgent(agent, pi) : undefined;
		const sessionDir = agentRuntimePaths(deps.home, agentHome).sessions;
		mkdirSync(sessionDir, { recursive: true });
		const parentSessionManager = ctx.sessionManager as unknown as ReviewSessionManager;
		const parentSessionId = ctx.sessionManager.getSessionId() ?? "";
		const parentWorktreeRoot = ctx.sessionManager.getCwd();
		const parentRepositoryIdentity = resolveCanonicalGitRepositoryIdentitySync(parentWorktreeRoot);
		return {
			agent: research?.agent ?? agent,
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
			env: research ? { ...deps.env, [RESEARCH_CHILD_TOOLS_ENV]: JSON.stringify(research.agent.tools) } : deps.env,
			...(launchSddChange === undefined ? {} : { sddChange: launchSddChange }),
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
		// Bounded live observation only. Native send owns the fresh policy decision;
		// child execution never starts a telemetry policy process or renewal timer.
		const owner = metricsOwner;
		const metrics = { selection: undefined as LaunchSelection | undefined,
			started: 0, launched: false, finished: false,
			current: () => owner === metricsOwner && request.parentSessionId === activeSessionId() && runtimeMetricsEnvAllows(deps.env),
			valid: () => !metrics.finished && metrics.current() };
		const observe = runtimeMetricsEnvAllows(deps.env) && metricTasks.size < 256;
		const task = runner.run({ ...request, collectResponseObservations: false,
			onLaunch: () => { metrics.launched = true; request.onLaunch?.(); },
			...(observe ? { canCollectResponseObservations: metrics.valid, prepareResponseObservations: async () => {
				if (metrics.finished || owner !== metricsOwner || request.parentSessionId !== activeSessionId() || !runtimeMetricsEnvAllows(deps.env)) return false;
				void catalogLookup({ provider: "openai", modelId: "gpt-4o" }).catch(() => {});
				if (!metrics.valid()) return false;
				metrics.selection = launchSelection(request.agent, request.model, request.thinking);
				metrics.started = metricsNow();
				return metrics.valid();
			} } : {}),
		});
		if (observe) metricTasks.set(task.id, metrics);
		ownedTaskIds.add(task.id);
		store.subscribe(task.id, () => { publishActivity(); requestRender(); });
		if (request.mode === AGENT_MODE.BACKGROUND) return text(`Started ${task.agent} in the background as task ${task.id}. Use subagent_status or subagent_result with that id.`, taskDetails(task));
		const query = await runner.waitForQuery(task.id);
		if (query) {
			const live = store.get(task.id) ?? task;
			return text(`Subagent ${live.agent} is waiting for your reply to request ${query.requestId}.`, { gentleAgents: { taskId: live.id, agent: live.agent, status: live.status, mode: live.mode, requestId: query.requestId } }, true);
		}
		const finished = await runner.waitFor(task.id);
		completions.consume(finished.id);
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
				sdd_change: { type: "object", additionalProperties: false, required: ["changeName", "workspaceRoot", "phase"], properties: { changeName: { type: "string" }, workspaceRoot: { type: "string" }, phase: { type: "string", enum: ["apply", "verify", "sync", "archive"] } }, description: "Launch-local selected SDD identity, accepted only by matching SDD phase agents." },
				mode: { type: "string", enum: ["task", "background"], description: "task waits for the result (default); background returns immediately." },
			},
		},
		async (params, ctx) => {
			const { agents } = discoverAgents(roots(ctx));
			const agent = agents.find((candidate) => candidate.name === params.agent);
			if (!agent) return text(`Error: no subagent named "${String(params.agent)}". Known: ${agents.map((candidate) => candidate.name).join(", ") || "none"}`, { error: "unknown agent" });
			const mode = (params.mode as AgentMode | undefined) ?? agent.mode ?? loadAgentsConfig(roots(ctx)).defaultMode;
			let sddChange: SddChangeSelection | undefined;
			try { sddChange = parseSddChange(params.sdd_change, agent.name); }
			catch (error) { return text(`Error: ${error instanceof Error ? error.message : String(error)}`, { error: "invalid sdd_change" }); }
			return launch(ctx, buildRequest(ctx, agent, String(params.task ?? ""), typeof params.label === "string" ? params.label : undefined, typeof params.context === "string" ? params.context : undefined, mode, undefined, typeof params.workspace_root === "string" ? params.workspace_root : undefined, sddChange));
		},
	);

	tool("status", "Report the status of one subagent task.", { required: ["task_id"], properties: { task_id: { type: "string" } } }, async (params) => {
		const task = await resolveTask(String(params.task_id));
		return task ? text(describeTask(task), taskDetails(task)) : text(`Error: no task ${String(params.task_id)}`, { error: "unknown task" });
	});

	tool("result", "Return the final answer of a finished subagent task, or its current state if it is still running.", { required: ["task_id"], properties: { task_id: { type: "string" } } }, async (params) => {
		const task = await resolveTask(String(params.task_id));
		if (!task) return text(`Error: no task ${String(params.task_id)}`, { error: "unknown task" });
		// The parent just pulled a finished result; its pending completion must
		// never be replayed on top of it.
		if (isFinished(task.status)) completions.consume(task.id);
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
		{ required: ["task_id", "prompt"], properties: { task_id: { type: "string" }, prompt: { type: "string" }, label: { type: "string", description: "Three to six words naming the follow-up." }, sdd_change: { type: "object", additionalProperties: false, required: ["changeName", "workspaceRoot", "phase"], properties: { changeName: { type: "string" }, workspaceRoot: { type: "string" }, phase: { type: "string", enum: ["apply", "verify", "sync", "archive"] } }, description: "Fresh launch-local selected SDD identity, required when continuing an SDD phase agent." }, mode: { type: "string", enum: ["task", "background"] } } },
		async (params, ctx) => {
			const previous = await resolveTask(String(params.task_id));
			if (!previous) return text(`Error: no task ${String(params.task_id)}`, { error: "unknown task" });
			if (!isFinished(previous.status) || !previous.sessionPath) return text(`Error: task ${previous.id} cannot be continued yet (${previous.status}).`, { error: "not continuable" });
			// Continuing acts on the previous result, so any pending completion for
			// it is already consumed by the parent.
			completions.consume(previous.id);
			const agent = discoverAgents(roots(ctx)).agents.find((candidate) => candidate.name === previous.agent);
			if (!agent) return text(`Error: subagent "${previous.agent}" is no longer defined.`, { error: "unknown agent" });
			const mode = (params.mode as AgentMode | undefined) ?? (previous.mode as AgentMode);
			let sddChange: SddChangeSelection | undefined;
			try { sddChange = parseSddChange(params.sdd_change, agent.name); }
			catch (error) { return text(`Error: ${error instanceof Error ? error.message : String(error)}`, { error: "invalid sdd_change" }); }
			if (sddPhaseForAgent(agent.name) && !sddChange) return text("Error: continuing an SDD phase agent requires a fresh sdd_change selection.", { error: "missing sdd_change" });
			return launch(ctx, buildRequest(ctx, agent, String(params.prompt ?? ""), typeof params.label === "string" ? params.label : undefined, undefined, mode, previous.sessionPath, sddChange?.workspaceRoot ?? previous.cwd, sddChange));
		},
	);

	if (collapseKey) {
		pi.registerShortcut(collapseKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Collapse or expand the agents card",
			handler: async () => {
				collapsed = !collapsed;
				if (sidebarTui) invalidateSidebar(sidebarTui);
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

	pi.on("session_start", (_event, ctx) => {
		// A resumed, reloaded, or replaced session starts with an empty completion
		// queue so nothing pending from another session can replay here.
		completions.dropAll();
		presence?.dispose();
		registryFor(ctx);
		showWidget(ctx);
		try {
			presence = PresencePublisher.start({ profile: agentHome, sessionId: activeSessionId() ?? "",
				label: ctx.sessionManager.getSessionName?.() || ctx.sessionManager.getCwd().split(/[\\/]/).pop() || "Orchestrator", activity: [] });
			publishActivity();
		} catch { presence = undefined; }
	});
	pi.on("session_shutdown", () => {
		completions.dropAll();
		activeAgentRuns = 0;
		presence?.dispose();
		presence = undefined;
		cancelClock?.();
		for (const view of overlays) { view.handleInput("q"); view.dispose(); }
		overlays.clear();
		sessions = undefined;
		sidebarTui = undefined;
		worktrees?.close();
		worktrees = undefined;
		runner.cancelAll();
	});
}
