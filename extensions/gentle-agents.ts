import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { keyHint, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { AGENT_MODE, discoverAgents, loadAgentsConfig, resolveAgentProfile, type AgentDefinition, type AgentMode } from "../lib/agents-config.ts";
import { isFinished, TaskStore, type AskRequest, type TaskRecord } from "../lib/agents-protocol.ts";
import { AgentRunner, piCommand, type AskAnswer, type RunnerDeps, type TaskRequest } from "../lib/agents-runner.ts";
import { historyDir, loadHistory, loadStoredTask, pruneHistory, saveTask } from "../lib/agents-history.ts";
import { sessionToMarkdown } from "../lib/agents-transcript.ts";
import { AgentsView } from "../lib/agents-view.ts";
import { AGENTS_GLYPH, renderAgentsCard } from "../lib/agents-widget.ts";
import { CARD_TONE, renderCard } from "../lib/shell-card.ts";
import { openInExternalEditor } from "./gentle-shell.ts";

// Gentle Agents: subagents as isolated `pi --mode rpc` children, a task
// store that notifies per task, and a Gentle Shell card above the editor.
// The tool names match the retired pi-subagents package so prompts, skills,
// and gentle-ai's delegation rules keep working unchanged.

export const AGENTS_WIDGET_KEY = "gentle-agents";
export const AGENTS_COMMAND_NAME = "gentle:agents";
export const AGENTS_RESULT_TYPE = "gentle-agents.result";
const COLLAPSE_KEY_DEFAULT = "ctrl+shift+a";
const VIEW_KEY_DEFAULT = "alt+a";
const OVERLAY_HEIGHT_RATIO = 0.8;
const OVERLAY_MIN_ROWS = 12;
const RENDER_COALESCE_MS = 400;
const CLOCK_TICK_MS = 1000;
const TOOL_PREFIX = "subagent_";

export interface AgentsDeps extends RunnerDeps {
	home: string;
	env: NodeJS.ProcessEnv;
}

interface ToolText {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

const defaultDeps = (env: NodeJS.ProcessEnv): AgentsDeps => ({
	spawn: (command, args, options) => spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] }),
	now: () => Date.now(),
	schedule: (fn, ms) => {
		const timer = setTimeout(fn, ms);
		timer.unref?.();
		return () => clearTimeout(timer);
	},
	pi: piCommand(),
	home: os.homedir(),
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
	const settingsPath = join(home, ".pi", "agent", "settings.json");
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

function text(value: string, details: Record<string, unknown> = {}): ToolText {
	return { content: [{ type: "text", text: value }], details };
}

function taskDetails(task: TaskRecord): Record<string, unknown> {
	return { gentleAgents: { taskId: task.id, agent: task.agent, status: task.status, mode: task.mode } };
}

export function describeTask(task: TaskRecord): string {
	const head = `${task.id} · ${task.agent} · ${task.status} · ${task.mode}`;
	const detail = task.error ? `\n${task.error}` : "";
	return `${head} · ${task.turns} turns · ${task.toolCalls} tool calls · last: ${task.lastStep}${detail}`;
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
	if (!agentsEnabled(env)) return;
	const deps: AgentsDeps = { ...defaultDeps(env), ...overrides };
	if (legacySubagentsInstalled(deps.home)) {
		pi.on("session_start", (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`${AGENTS_GLYPH} Gentle Agents is waiting: remove the old package first with "pi remove npm:${LEGACY_SUBAGENTS_PACKAGE}"`, "warning");
		});
		return;
	}
	const collapseKey = agentsCollapseKey(env);
	const viewKey = agentsViewKey(env);
	const store = new TaskStore();
	const tasksDir = historyDir(deps.home);
	let ui: ExtensionContext["ui"] | undefined;
	let host: { requestRender(): void } | undefined;
	let collapsed = false;
	let renderQueued = false;
	let cancelClock: (() => void) | undefined;

	const requestRender = () => {
		if (renderQueued) return;
		renderQueued = true;
		deps.schedule(() => {
			renderQueued = false;
			host?.requestRender();
		}, RENDER_COALESCE_MS);
	};

	// The elapsed column ticks once a second, and only while something runs.
	const tickClock = () => {
		cancelClock?.();
		cancelClock = undefined;
		if (store.list().some((task) => !isFinished(task.status))) {
			cancelClock = deps.schedule(() => {
				requestRender();
				tickClock();
			}, CLOCK_TICK_MS);
		}
	};

	// A finished task goes to disk once, after its child is gone; the history
	// is then trimmed to the configured size. Failures never reach the TUI.
	const persist = (task: TaskRecord) => {
		void saveTask(tasksDir, task, store.thread(task.id))
			.then(() => pruneHistory(tasksDir, loadAgentsConfig({ cwd: task.cwd, home: deps.home }).historyMaxTasks))
			.catch(() => {});
	};

	// A background result is delivered as a message: queued behind the current
	// turn if the model is busy, or starting a turn right away if it is idle.
	const deliver = (task: TaskRecord) => {
		pi.sendMessage({ customType: AGENTS_RESULT_TYPE, content: completionText(task), display: true, details: taskDetails(task) }, { deliverAs: "followUp", triggerTurn: true });
	};

	const runner = new AgentRunner(store, loadAgentsConfig({ cwd: process.cwd(), home: deps.home }), deps, {
		askUser: (_taskId, ask, raw) => answerThroughUi(ui, ask, raw),
		onFinish: (task) => {
			requestRender();
			persist(task);
			if (task.mode === AGENT_MODE.BACKGROUND) deliver(task);
		},
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

	// Tasks from earlier sessions come back from disk on demand.
	const resolveTask = async (id: string): Promise<TaskRecord | undefined> => {
		const live = store.get(id);
		if (live) return live;
		const stored = await loadStoredTask(tasksDir, id);
		if (stored) store.restore(stored.task, stored.thread);
		return stored?.task;
	};

	const openOverlay = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		for (const stored of await loadHistory(tasksDir)) store.restore(stored.task, stored.thread);
		let view: AgentsView | undefined;
		let overlayHost: { requestRender(force?: boolean): void; stop(): void; start(): void } | undefined;
		const chosen = await ctx.ui.custom<TaskRecord | null>(
			(tui, theme, _keybindings, done) => {
				overlayHost = tui;
				view = new AgentsView({
					theme,
					rows: Math.max(OVERLAY_MIN_ROWS, Math.floor(tui.terminal.rows * OVERLAY_HEIGHT_RATIO)),
					store,
					now: () => deps.now(),
					onCancel: (task) => runner.cancel(task.id),
					onOpen: (task) => done(task),
					onClose: () => done(null),
					requestRender: () => tui.requestRender(),
				});
				return view;
			},
			{ overlay: true, overlayOptions: { width: "92%", anchor: "center" } },
		);
		view?.dispose();
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
		const dir = join(deps.home, ".pi", "agent", "gentle-agents", "transcripts");
		await mkdir(dir, { recursive: true });
		const markdown = sessionToMarkdown(await readFile(task.sessionPath ?? "", "utf8"), { title: `${task.agent} · ${task.label} · ${task.status}` });
		const path = join(dir, `${task.id}.md`);
		await writeFile(path, markdown, "utf8");
		return path;
	};
	// A status change is worth a frame right away; deltas inside a task are
	// coalesced so a chatty child cannot flood the terminal.
	store.subscribeSummary(() => {
		host?.requestRender();
		tickClock();
	});

	const showWidget = (ctx: ExtensionContext) => {
		ui = ctx.hasUI ? ctx.ui : undefined;
		ui?.setWidget(AGENTS_WIDGET_KEY, (tui, theme) => {
			host = tui;
			return {
				render(width: number) {
					const lines = renderAgentsCard(store.list(), theme, width, deps.now(), { collapsed, collapseKey });
					return lines.length === 0 ? [] : [...lines, ""];
				},
				invalidate() {},
			};
		});
	};

	const roots = (ctx: ExtensionContext) => ({ cwd: ctx.sessionManager.getCwd(), home: deps.home });

	const buildRequest = (ctx: ExtensionContext, agent: AgentDefinition, prompt: string, label: string | undefined, context: string | undefined, mode: AgentMode, resume?: string): TaskRequest => {
		const config = loadAgentsConfig(roots(ctx));
		const profile = resolveAgentProfile(agent, config);
		const sessionDir = join(deps.home, ".pi", "agent", "gentle-agents", "sessions");
		mkdirSync(sessionDir, { recursive: true });
		return {
			agent,
			prompt,
			label,
			context,
			mode,
			cwd: ctx.sessionManager.getCwd(),
			parentSessionId: ctx.sessionManager.getSessionId() ?? "",
			model: profile.model,
			thinking: profile.thinking,
			sessionDir,
			resumeSessionPath: resume,
			env: deps.env,
		};
	};

	const launch = async (ctx: ExtensionContext, request: TaskRequest): Promise<ToolText> => {
		const task = runner.run(request);
		store.subscribe(task.id, () => requestRender());
		if (request.mode === AGENT_MODE.BACKGROUND) return text(`Started ${task.agent} in the background as task ${task.id}. Use subagent_status or subagent_result with that id.`, taskDetails(task));
		const finished = await runner.waitFor(task.id);
		return text(finishedText(finished), taskDetails(finished));
	};

	const tool = (name: string, description: string, parameters: Record<string, unknown>, execute: (params: Record<string, unknown>, ctx: ExtensionContext) => Promise<ToolText>) => {
		pi.registerTool({
			name: `${TOOL_PREFIX}${name}`,
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
				mode: { type: "string", enum: ["task", "background"], description: "task waits for the result (default); background returns immediately." },
			},
		},
		async (params, ctx) => {
			const { agents } = discoverAgents(roots(ctx));
			const agent = agents.find((candidate) => candidate.name === params.agent);
			if (!agent) return text(`Error: no subagent named "${String(params.agent)}". Known: ${agents.map((candidate) => candidate.name).join(", ") || "none"}`, { error: "unknown agent" });
			const mode = (params.mode as AgentMode | undefined) ?? agent.mode ?? loadAgentsConfig(roots(ctx)).defaultMode;
			return launch(ctx, buildRequest(ctx, agent, String(params.task ?? ""), typeof params.label === "string" ? params.label : undefined, typeof params.context === "string" ? params.context : undefined, mode));
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

	tool("cancel", "Cancel a queued or running subagent task.", { required: ["task_id"], properties: { task_id: { type: "string" } } }, async (params) => {
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
			return launch(ctx, buildRequest(ctx, agent, String(params.prompt ?? ""), typeof params.label === "string" ? params.label : undefined, undefined, mode, previous.sessionPath));
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
		description: "Show the subagents of this and earlier sessions with their threads. Press o to open a task's session in $EDITOR.",
		handler: async (_args, ctx) => openOverlay(ctx),
	});
	if (viewKey) {
		pi.registerShortcut(viewKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Show the subagents overlay",
			handler: async (ctx) => openOverlay(ctx),
		});
	}

	pi.on("session_start", (_event, ctx) => showWidget(ctx));
	pi.on("session_shutdown", () => {
		runner.cancelAll();
	});
}
