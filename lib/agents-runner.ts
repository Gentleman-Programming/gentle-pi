import type { Duplex, Readable, Writable } from "node:stream";
import { AGENT_MODE, formatModelRef, type AgentDefinition, type AgentMode, type ModelRef } from "./agents-config.ts";
import { CHILD_QUERY_MAX_INFLIGHT, CHILD_QUERY_TIMEOUT_MS, parseChildFrame, validChildMessage, validChildQueryId } from "./agents-messaging.ts";
import { ParentStandingReviewPermissionBroker } from "./review-session-standing-permission-ipc.ts";
import { isFinished, normalizeRpcEvent, TASK_EVENT, TASK_STATUS, taskLabel, type AskRequest, type TaskRecord, type TaskStore } from "./agents-protocol.ts";

// Gentle Agents runner. Every subagent is its own `pi --mode rpc` process:
// the host never runs subagent work on the TUI thread. It writes JSON
// commands, reads JSON lines, applies deltas to the store, answers dialogs,
// and enforces an inactivity watchdog per task.

export interface ChildLike {
	pid: number | undefined;
	stdin: Writable;
	stdout: Readable;
	stderr: Readable | null | undefined;
	stdio?: Array<Duplex | null | undefined>;
	kill(signal?: NodeJS.Signals): boolean;
	send?(message: Record<string, unknown>, callback?: (error: Error | null) => void): boolean;
	disconnect?(): void;
	channel?: { unref?(): void };
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "spawn" | "message" | "disconnect", listener: (...args: unknown[]) => void): unknown;
}

export interface SpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	detached?: boolean;
	stdio?: Array<"pipe" | "ignore" | "inherit" | "ipc">;
}

export type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildLike;

export interface ProcessControl {
	platform: NodeJS.Platform;
	kill(pid: number, signal: NodeJS.Signals | 0): void;
}

export interface PiCommand {
	command: string;
	args: string[];
}

export interface RunnerDeps {
	spawn: Spawn;
	now(): number;
	schedule(fn: () => void, ms: number): () => void;
	pi: PiCommand;
	process?: ProcessControl;
}

export interface RunnerLimits {
	maxConcurrency: number;
	stallTimeoutMs: number;
}

export interface AskAnswer {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

export interface TaskQuery {
	taskId: string;
	requestId: string;
}

export interface RunnerHooks {
	askUser(taskId: string, request: AskRequest, raw: Record<string, unknown>): Promise<AskAnswer>;
	onFinish?(task: TaskRecord): void;
	// Accepts a child notification only while the originating parent session is active.
	onNotification?(task: TaskRecord, message: string): boolean | void;
	onQuery?(task: TaskRecord, requestId: string, message: string): boolean | void;
	// Parent-only observation of a paired successful filesystem tool, not prose.
	onSuccessfulMutation?(task: TaskRecord, tool: { toolName: "write" | "edit"; toolCallId: string; path: string }): void | Promise<void>;
}

export interface TaskRequest {
	agent: AgentDefinition;
	prompt: string;
	label: string | undefined;
	context: string | undefined;
	mode: AgentMode;
	cwd: string;
	parentSessionId: string;
	model: ModelRef | undefined;
	thinking: string | undefined;
	sessionDir: string;
	resumeSessionPath: string | undefined;
	env: NodeJS.ProcessEnv;
	// Captures the originating session; invoked only after successful OS spawn.
	onLaunch?: () => void;
	// This closure stays only in the parent process. Its presence creates an
	// inherited fd, never an environment boolean or model-visible permission.
	authorizeParentStandingReviewPermission?: (repositoryIdentity: string) => boolean;
}

interface ProcessLike {
	execPath: string;
	argv: string[];
	env: NodeJS.ProcessEnv;
}

interface Pending {
	resolve(value: Record<string, unknown>): void;
}

interface PendingQuery {
	cancel: () => void;
	replying: boolean;
}

interface PendingReply {
	resolve(value: boolean): void;
}

interface LiveTask {
	child: ChildLike;
	pending: Map<string, Pending>;
	queries: Map<string, PendingQuery>;
	replies: Map<string, PendingReply>;
	cancelStall: () => void;
	cancelGrace: () => void;
	processGroup: number | undefined;
	terminal: { status: TaskRecord["status"]; error: string | null } | undefined;
	childExit: number | null | undefined;
	cleanupDeadlineAt: number | undefined;
	quarantined: boolean;
	nextId: number;
	permissionBroker?: ParentStandingReviewPermissionBroker;
	ipcClosed: boolean;
	acknowledgedIpcIds: Set<string>;
	acknowledgedIpcOrder: string[];
	mutationStarts: Map<string, { toolName: "write" | "edit"; toolCallId: string; path: string }>;
}

const CHILD_MARKER = "GENTLE_PI_AGENTS_CHILD";
const IPC_MARKER = "GENTLE_PI_AGENTS_OWNED_IPC";
const PARENT_NOTIFICATION_TOOL = "subagent_parent_message";
const DEFAULT_TOOLS: readonly string[] = [];
const TERMINATION_GRACE_MS = 250;
const GROUP_CONFIRM_MS = 25;
const GROUP_CONFIRM_DEADLINE_MS = 1_000;
const QUERY_REJECTION_ERRORS = new Set([
	"invalid child IPC frame",
	"invalid child IPC correlation",
	"unsupported child IPC kind",
	"invalid child IPC message",
	"task is not a live owned recipient",
	"task parent cannot accept queries",
	"task parent is not the active host session",
	"duplicate query request",
	"too many pending parent queries",
	"parent query timed out",
	"parent rejected query",
]);
const QUERY_REJECTION = Symbol("query rejection");

function rejectQuery(error: string): never {
	throw { [QUERY_REJECTION]: error };
}

function queryRejection(error: unknown): string {
	if (error && typeof error === "object" && QUERY_REJECTION in error) {
		const value = (error as { [QUERY_REJECTION]?: unknown })[QUERY_REJECTION];
		if (typeof value === "string" && QUERY_REJECTION_ERRORS.has(value)) return value;
	}
	return "parent rejected query";
}

const hostProcess: ProcessControl = { platform: process.platform, kill: (pid, signal) => process.kill(pid, signal) };

export function childArguments(request: TaskRequest): string[] {
	const args = ["--mode", "rpc", "--session-dir", request.sessionDir];
	if (request.resumeSessionPath) args.push("--session", request.resumeSessionPath);
	if (request.model) args.push("--model", request.thinking ? `${formatModelRef(request.model)}:${request.thinking}` : formatModelRef(request.model));
	else if (request.thinking) args.push("--thinking", request.thinking);
	const tools = request.agent.tools.length > 0 ? [...new Set([...request.agent.tools, PARENT_NOTIFICATION_TOOL])] : DEFAULT_TOOLS;
	if (tools.length > 0) args.push("--tools", tools.join(","));
	if (request.agent.instructions.length > 0) args.push("--append-system-prompt", request.agent.instructions);
	return args;
}

// The child is the same pi that is running us: node plus its cli entry.
// GENTLE_PI_AGENTS_PI overrides it with a command line.
export function piCommand(proc: ProcessLike = process): PiCommand {
	const override = proc.env.GENTLE_PI_AGENTS_PI?.trim();
	if (override) {
		const [command, ...args] = override.split(/\s+/);
		return { command, args };
	}
	const entry = proc.argv[1];
	if (entry && /(^|[\\/])cli\.js$/.test(entry)) return { command: proc.execPath, args: [entry] };
	return { command: "pi", args: [] };
}

// RPC framing is strict JSONL: LF only, optional CR. Lines that do not parse
// are dropped (pi's own parse errors arrive as responses anyway).
export class JsonLines {
	private buffer = "";
	private readonly onValue: (value: unknown) => void;

	constructor(onValue: (value: unknown) => void) {
		this.onValue = onValue;
	}

	push(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const raw of lines) {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			if (line.length === 0) continue;
			try {
				this.onValue(JSON.parse(line));
			} catch {
				// not JSON: ignore
			}
		}
	}
}

export function promptText(request: TaskRequest): string {
	return request.context ? `${request.prompt}\n\n## Context\n${request.context}` : request.prompt;
}

export class AgentRunner {
	private readonly store: TaskStore;
	private readonly limits: RunnerLimits;
	private readonly deps: RunnerDeps;
	private readonly hooks: RunnerHooks;
	private readonly processControl: ProcessControl;
	private readonly queue: Array<{ task: TaskRecord; request: TaskRequest }> = [];
	private readonly live = new Map<string, LiveTask>();
	private readonly waiters = new Map<string, Array<(task: TaskRecord) => void>>();
	private readonly queryWaiters = new Map<string, Array<(query: TaskQuery | undefined) => void>>();
	private readonly firstQueries = new Map<string, TaskQuery>();
	private counter = 0;

	constructor(store: TaskStore, limits: RunnerLimits, deps: RunnerDeps, hooks: RunnerHooks) {
		this.store = store;
		this.limits = limits;
		this.deps = deps;
		this.hooks = hooks;
		this.processControl = deps.process ?? hostProcess;
	}

	run(request: TaskRequest): TaskRecord {
		const now = this.deps.now();
		this.counter += 1;
		const task: TaskRecord = {
			id: `${now.toString(36)}-${this.counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
			agent: request.agent.name,
			mode: request.mode,
			prompt: request.prompt,
			label: taskLabel(request.prompt, request.label),
			cwd: request.cwd,
			parentSessionId: request.parentSessionId,
			status: TASK_STATUS.QUEUED,
			createdAt: now,
			startedAt: null,
			endedAt: null,
			model: formatModelRef(request.model),
			thinking: request.thinking,
			sessionPath: request.resumeSessionPath ?? null,
			error: null,
			result: null,
			lastStep: "queued",
			lastActivityAt: now,
			turns: 0,
			toolCalls: 0,
			tokens: 0,
			cost: 0,
		};
		this.store.add(task);
		this.queue.push({ task, request });
		queueMicrotask(() => this.pump());
		return task;
	}

	waitFor(id: string): Promise<TaskRecord> {
		const current = this.store.get(id);
		if (!current) return Promise.reject(new Error(`no task ${id}`));
		if (isFinished(current.status)) return Promise.resolve(current);
		return new Promise((resolve) => {
			const list = this.waiters.get(id) ?? [];
			list.push(resolve);
			this.waiters.set(id, list);
		});
	}

	waitForQuery(id: string): Promise<TaskQuery | undefined> {
		const current = this.store.get(id);
		if (!current || isFinished(current.status)) return Promise.resolve(undefined);
		const first = this.firstQueries.get(id);
		if (first) return Promise.resolve(first);
		return new Promise((resolve) => {
			const list = this.queryWaiters.get(id) ?? [];
			list.push(resolve);
			this.queryWaiters.set(id, list);
		});
	}

	async reply(id: string, requestId: string, message: string, parentSessionId: string): Promise<boolean> {
		const task = this.store.get(id);
		const live = this.live.get(id);
		if (!task || !live || live.terminal || task.parentSessionId !== parentSessionId || !validChildMessage(message)) return false;
		const query = live.queries.get(requestId);
		if (!query || query.replying) return false;
		query.replying = true;
		const accepted = await this.sendReply(live, requestId, { id: requestId, kind: "reply", message });
		if (live.queries.get(requestId) === query) {
			query.cancel();
			live.queries.delete(requestId);
		}
		return accepted;
	}

	cancel(id: string): boolean {
		const queued = this.queue.findIndex((entry) => entry.task.id === id);
		if (queued >= 0) {
			this.queue.splice(queued, 1);
			this.finish(id, TASK_STATUS.CANCELLED, "cancelled before start");
			return true;
		}
		if (!this.live.has(id)) return false;
		this.requestStop(id, TASK_STATUS.CANCELLED, "cancelled", true);
		return true;
	}

	cancelAll(): number {
		const ids = [...this.queue.map((entry) => entry.task.id), ...this.live.keys()];
		return ids.filter((id) => this.cancel(id)).length;
	}

	steer(id: string, message: string): boolean {
		if (!this.live.has(id)) return false;
		void this.send(id, { type: "steer", message });
		this.store.apply(id, { type: TASK_EVENT.NOTE, text: `steered: ${message}` }, this.deps.now());
		return true;
	}

	private pump(): void {
		while (this.live.size < this.limits.maxConcurrency && this.queue.length > 0) {
			const entry = this.queue.shift();
			if (entry) this.launch(entry.task.id, entry.request);
		}
	}

	// A child that cannot start (missing pi, bad cwd) fails only its task:
	// spawn exceptions and process errors settle without uncaught host errors.
	private launch(id: string, request: TaskRequest): void {
		const detached = this.processControl.platform !== "win32";
		const hasParentPermissionChannel = request.authorizeParentStandingReviewPermission !== undefined;
		const env = {
			...request.env,
			[CHILD_MARKER]: "1",
			[IPC_MARKER]: `${this.deps.now()}-${Math.random().toString(36).slice(2)}`,
			...(hasParentPermissionChannel ? { GENTLE_PI_AGENTS_PARENT_PERMISSION_FD: "3" } : {}),
		};
		let child: ChildLike;
		try {
			child = this.deps.spawn(this.deps.pi.command, [...this.deps.pi.args, ...childArguments(request)], {
				cwd: request.cwd,
				env,
				detached,
				stdio: hasParentPermissionChannel ? ["pipe", "pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe", "ipc"],
			});
		} catch (error) {
			this.store.update(id, { status: TASK_STATUS.RUNNING, startedAt: this.deps.now(), lastStep: "starting" });
			this.finish(id, TASK_STATUS.FAILED, `could not start pi: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const processGroup = detached && typeof child.pid === "number" && child.pid > 0 ? child.pid : undefined;
		const live: LiveTask = { child, mutationStarts: new Map(), pending: new Map(), queries: new Map(), replies: new Map(), cancelStall: () => {}, cancelGrace: () => {}, processGroup, terminal: undefined, childExit: undefined, cleanupDeadlineAt: undefined, quarantined: false, nextId: 0, ipcClosed: false, acknowledgedIpcIds: new Set(), acknowledgedIpcOrder: [] };
		this.live.set(id, live);
		const permissionPipe = child.stdio?.[3];
		if (hasParentPermissionChannel && permissionPipe !== undefined && permissionPipe !== null) {
			live.permissionBroker = new ParentStandingReviewPermissionBroker(
				{ readable: permissionPipe, writable: permissionPipe },
				(repositoryIdentity) => this.live.get(id) === live && !live.terminal && request.authorizeParentStandingReviewPermission?.(repositoryIdentity) === true,
			);
		}
		this.store.update(id, { status: TASK_STATUS.RUNNING, startedAt: this.deps.now(), lastStep: "starting" });
		child.channel?.unref?.();
		child.on("error", (error) => this.childError(id, error));
		child.on("message", (value) => this.receiveChildMessage(id, value));
		child.on("disconnect", () => this.closeIpc(live));
		let announced = false;
		child.on("spawn", () => {
			if (announced || this.live.get(id) !== live || live.terminal) return;
			announced = true;
			try { request.onLaunch?.(); }
			catch (error) { this.requestStop(id, TASK_STATUS.FAILED, `could not register launched worktree: ${error instanceof Error ? error.message : String(error)}`); }
		});
		child.stdin.on("error", () => {});
		this.armStall(id, live);
		const lines = new JsonLines((value) => this.receive(id, request, value));
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => lines.push(chunk));
		child.stderr?.on("data", () => {});
		child.on("exit", (code) => this.exited(id, code));
		void this.send(id, { type: "get_state" }).then((response) => {
			const data = response.data as { sessionFile?: unknown; model?: { provider?: unknown; id?: unknown } | null; thinkingLevel?: unknown } | undefined;
			if (response.success !== true || live.terminal || this.live.get(id) !== live || !data) return;
			const resolved: Partial<TaskRecord> = {};
			if (typeof data.sessionFile === "string" && data.sessionFile) resolved.sessionPath = data.sessionFile;
			if (data.model === null) resolved.model = "default";
			else if (typeof data.model?.provider === "string" && data.model.provider && typeof data.model.id === "string" && data.model.id) {
				resolved.model = formatModelRef({ provider: data.model.provider, id: data.model.id });
			}
			if (typeof data.thinkingLevel === "string" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(data.thinkingLevel)) resolved.thinking = data.thinkingLevel;
			this.store.update(id, resolved);
		});
		void this.send(id, { type: "prompt", message: promptText(request) }).then((response) => {
			if (response.success === false) this.requestStop(id, TASK_STATUS.FAILED, String(response.error ?? "prompt rejected"));
		});
	}

	private armStall(id: string, live: LiveTask): void {
		live.cancelStall();
		live.cancelStall = this.deps.schedule(() => this.requestStop(id, TASK_STATUS.TIMED_OUT, `stalled for ${Math.round(this.limits.stallTimeoutMs / 60_000)} min`), this.limits.stallTimeoutMs);
	}

	private send(id: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
		const live = this.live.get(id);
		if (!live) return Promise.resolve({ success: false, error: "task is not running" });
		live.nextId += 1;
		const requestId = `r${live.nextId}`;
		return new Promise((resolve) => {
			live.pending.set(requestId, { resolve });
			this.write(live, { id: requestId, ...command });
		});
	}

	private receiveChildMessage(id: string, value: unknown): void {
		const live = this.live.get(id);
		if (!live || live.ipcClosed) return;
		const parsed = parseChildFrame(value);
		if (!parsed.frame) {
			if (parsed.id && validChildQueryId(parsed.id)) this.sendQueryError(live, parsed.id, parsed.error ?? "invalid child IPC frame");
			else if (parsed.id) this.acknowledge(live, parsed.id, false, parsed.error ?? "invalid child IPC frame");
			return;
		}
		const task = this.store.get(id);
		if (!task || live.terminal || isFinished(task.status) || task.parentSessionId === "") {
			if (parsed.frame.kind === "notification") this.acknowledge(live, parsed.frame.id, false, "task is not a live owned recipient");
			else this.sendQueryError(live, parsed.frame.id, "task is not a live owned recipient");
			return;
		}
		if (parsed.frame.kind === "notification") {
			if (live.acknowledgedIpcIds.has(parsed.frame.id)) return;
			try {
				if (this.hooks.onNotification?.(task, parsed.frame.message) === false) this.acknowledge(live, parsed.frame.id, false, "task parent is not the active host session");
				else this.acknowledge(live, parsed.frame.id, true);
			} catch { this.acknowledge(live, parsed.frame.id, false, "parent rejected notification"); }
			return;
		}
		let query: PendingQuery | undefined;
		try {
			if (live.queries.has(parsed.frame.id)) rejectQuery("duplicate query request");
			if (live.queries.size >= CHILD_QUERY_MAX_INFLIGHT) rejectQuery("too many pending parent queries");
			query = { replying: false, cancel: this.deps.schedule(() => this.expireQuery(live, parsed.frame!.id), CHILD_QUERY_TIMEOUT_MS) };
			live.queries.set(parsed.frame.id, query);
			if (!this.hooks.onQuery) rejectQuery("task parent cannot accept queries");
			if (this.hooks.onQuery(task, parsed.frame.id, parsed.frame.message) === false) rejectQuery("task parent is not the active host session");
			if (task.mode === AGENT_MODE.TASK && !this.firstQueries.has(id)) {
				const first = { taskId: id, requestId: parsed.frame.id };
				this.firstQueries.set(id, first);
				for (const resolve of this.queryWaiters.get(id) ?? []) resolve(first);
				this.queryWaiters.delete(id);
			}
		} catch (error) {
			if (query && live.queries.get(parsed.frame.id) === query) {
				query.cancel();
				live.queries.delete(parsed.frame.id);
			}
			this.sendQueryError(live, parsed.frame.id, queryRejection(error));
		}
	}

	private expireQuery(live: LiveTask, id: string): void {
		const query = live.queries.get(id);
		if (!query) return;
		live.queries.delete(id);
		if (query.replying) this.settleReply(live, id, false);
		else this.sendQueryError(live, id, "parent query timed out");
	}

	private sendQueryError(live: LiveTask, id: string, error: string): void {
		const safeError = QUERY_REJECTION_ERRORS.has(error) ? error : "parent rejected query";
		try { live.child.send?.({ id, kind: "reply", error: safeError }, () => {}); }
		catch { /* Child-owned IPC callback reports transport failure. */ }
	}

	private acknowledge(live: LiveTask, id: string, accepted: boolean, error?: string): void {
		if (live.ipcClosed || live.acknowledgedIpcIds.has(id) || !live.child.send) return;
		live.acknowledgedIpcIds.add(id);
		live.acknowledgedIpcOrder.push(id);
		if (live.acknowledgedIpcOrder.length > 64) live.acknowledgedIpcIds.delete(live.acknowledgedIpcOrder.shift()!);
		try { live.child.send({ id, kind: "ack", accepted, ...(error ? { error } : {}) }, () => {}); }
		catch { /* Child-owned IPC callback reports transport failure. */ }
	}

	private sendReply(live: LiveTask, id: string, frame: Record<string, unknown>): Promise<boolean> {
		return new Promise((resolve) => {
			live.replies.set(id, { resolve });
			try {
				if (!live.child.send) this.settleReply(live, id, false);
				else live.child.send(frame, (error) => this.settleReply(live, id, !error));
			} catch { this.settleReply(live, id, false); }
		});
	}

	private settleReply(live: LiveTask, id: string, accepted: boolean): void {
		const pending = live.replies.get(id);
		if (!pending) return;
		live.replies.delete(id);
		pending.resolve(accepted);
	}

	private closeIpc(live: LiveTask): void {
		if (live.ipcClosed) return;
		live.ipcClosed = true;
		for (const query of live.queries.values()) query.cancel();
		live.queries.clear();
		for (const pending of live.replies.values()) pending.resolve(false);
		live.replies.clear();
		live.child.channel?.unref?.();
		try { live.child.disconnect?.(); }
		catch { /* Channel may already be disconnected. */ }
	}

	private write(live: LiveTask, payload: Record<string, unknown>): void {
		try {
			live.child.stdin.write(`${JSON.stringify(payload)}\n`);
		} catch {
			// the child is gone; the exit handler settles the task
		}
	}

	private receive(id: string, request: TaskRequest, value: unknown): void {
		const live = this.live.get(id);
		if (!live || live.terminal || !value || typeof value !== "object") return;
		const raw = value as Record<string, unknown>;
		this.armStall(id, live);
		if (raw.type === "response") {
			const pending = typeof raw.id === "string" ? live.pending.get(raw.id) : undefined;
			if (pending) {
				live.pending.delete(raw.id as string);
				pending.resolve(raw);
			}
			return;
		}
		for (const event of normalizeRpcEvent(raw)) {
			this.store.apply(id, event, this.deps.now());
			if (event.type === TASK_EVENT.TOOL_START && event.callId) {
				live.mutationStarts.delete(event.callId);
				if ((event.name === "write" || event.name === "edit") && typeof event.args.path === "string" && event.args.path.trim()) {
					live.mutationStarts.set(event.callId, { toolName: event.name, toolCallId: event.callId, path: event.args.path });
				}
			}
			if (event.type === TASK_EVENT.TOOL_END) {
				const mutation = live.mutationStarts.get(event.callId);
				live.mutationStarts.delete(event.callId);
				const task = this.store.get(id);
				if (mutation && task && raw.isError === false && !event.isError) {
					try { void Promise.resolve(this.hooks.onSuccessfulMutation?.(task, mutation)).catch(() => {}); }
					catch { /* Bookkeeping failure must not rewrite a successful tool or stop the child. */ }
				}
			}
			if (event.type === TASK_EVENT.ASK) void this.answer(id, request, live, event.request, raw);
			if (event.type === TASK_EVENT.AGENT_SETTLED) {
				const terminal = this.store.get(id);
				if (terminal?.error) this.requestStop(id, TASK_STATUS.FAILED, terminal.error);
				else if (terminal?.result) this.requestStop(id, TASK_STATUS.COMPLETED, null);
				else this.requestStop(id, TASK_STATUS.FAILED, "assistant settled without a final report");
			}
		}
	}

	// Task-mode subagents may ask the human through the host; background ones
	// get their dialog cancelled so they never block on nobody.
	private async answer(id: string, request: TaskRequest, live: LiveTask, ask: AskRequest, raw: Record<string, unknown>): Promise<void> {
		let answer: AskAnswer = { cancelled: true };
		if (request.mode === "task") {
			try {
				answer = await this.hooks.askUser(id, ask, raw);
			} catch {
				answer = { cancelled: true };
			}
		}
		if (this.live.get(id) !== live || live.terminal) return;
		this.write(live, { type: "extension_ui_response", id: ask.id, ...answer });
		const current = this.store.get(id);
		if (current?.status === TASK_STATUS.WAITING) this.store.update(id, { status: TASK_STATUS.RUNNING, lastStep: answer.cancelled ? "question dismissed" : "answered" });
	}

	// POSIX children start detached, so their PID is the owned process-group ID.
	// Windows uses ChildProcess.kill only: Node has no equivalent tree guarantee.
	private signal(live: LiveTask, signal: NodeJS.Signals): void {
		if (live.processGroup !== undefined) {
			try {
				this.processControl.kill(-live.processGroup, signal);
				return;
			} catch {
				// The owned group is already gone; the child handle may still observe exit.
			}
		}
		try {
			live.child.kill(signal);
		} catch {
			// already gone
		}
	}

	private requestStop(id: string, status: TaskRecord["status"], error: string | null, abort = false): void {
		const live = this.live.get(id);
		if (!live || live.terminal) return;
		live.terminal = { status, error };
		live.mutationStarts.clear();
		live.cleanupDeadlineAt = this.deps.now() + GROUP_CONFIRM_DEADLINE_MS;
		live.permissionBroker?.close();
		this.closeIpc(live);
		live.cancelStall();
		if (abort) void this.send(id, { type: "abort" });
		this.signal(live, "SIGTERM");
		live.cancelGrace = this.deps.schedule(() => {
			if (this.live.get(id) !== live) return;
			this.signal(live, "SIGKILL");
			this.confirmGroupExit(id, live);
		}, TERMINATION_GRACE_MS);
	}

	private groupExists(live: LiveTask): boolean {
		if (live.processGroup === undefined) return false;
		try {
			this.processControl.kill(-live.processGroup, 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code !== "ESRCH";
		}
	}

	private confirmGroupExit(id: string, live: LiveTask): void {
		if (this.live.get(id) !== live) return;
		if (this.groupExists(live)) {
			if (this.deps.now() >= (live.cleanupDeadlineAt ?? 0)) {
				live.cancelGrace();
				live.quarantined = true;
				this.finish(id, TASK_STATUS.FAILED, `process cleanup unconfirmed after ${GROUP_CONFIRM_DEADLINE_MS}ms; capacity quarantined`);
				return;
			}
			live.cancelGrace = this.deps.schedule(() => this.confirmGroupExit(id, live), GROUP_CONFIRM_MS);
			return;
		}
		if (live.childExit !== undefined) this.completeExit(id, live);
	}

	private childError(id: string, error: Error): void {
		const live = this.live.get(id);
		if (!live) return;
		// Node leaves pid undefined when spawn failed; a live PID must still exit
		// before its slot is released, even if its handle later emits an error.
		if (live.child.pid !== undefined) {
			this.requestStop(id, TASK_STATUS.FAILED, `pi process error: ${error.message}`);
			return;
		}
		live.permissionBroker?.close();
		this.closeIpc(live);
		live.cancelStall();
		live.cancelGrace();
		this.live.delete(id);
		this.finish(id, TASK_STATUS.FAILED, `could not start pi: ${error.message}`);
	}

	private exited(id: string, code: number | null): void {
		const live = this.live.get(id);
		if (!live) return;
		live.childExit = code;
		if (this.groupExists(live)) {
			if (!live.terminal) this.requestStop(id, TASK_STATUS.FAILED, `pi exited with code ${code ?? "unknown"} before agent_settled`);
			return;
		}
		this.completeExit(id, live);
	}

	private completeExit(id: string, live: LiveTask): void {
		live.permissionBroker?.close();
		this.closeIpc(live);
		live.cancelStall();
		live.cancelGrace();
		this.live.delete(id);
		// Quarantine already notified completion, but its retained slot is now free.
		if (live.quarantined) {
			queueMicrotask(() => this.pump());
			return;
		}
		const terminal = live.terminal;
		this.finish(id, terminal ? terminal.status : TASK_STATUS.FAILED, terminal ? terminal.error : `pi exited with code ${live.childExit ?? "unknown"} before agent_settled`);
	}

	private finish(id: string, status: TaskRecord["status"], error: string | null): void {
		const current = this.store.get(id);
		if (!current || isFinished(current.status)) return;
		const finished = this.store.update(id, { status, endedAt: this.deps.now(), error, lastStep: error ?? "done" });
		if (finished) {
			this.hooks.onFinish?.(finished);
			for (const resolve of this.waiters.get(id) ?? []) resolve(finished);
			this.waiters.delete(id);
			for (const resolve of this.queryWaiters.get(id) ?? []) resolve(undefined);
			this.queryWaiters.delete(id);
			this.firstQueries.delete(id);
		}
		queueMicrotask(() => this.pump());
	}
}
