import type { Readable, Writable } from "node:stream";
import { formatModelRef, type AgentDefinition, type AgentMode, type ModelRef } from "./agents-config.ts";
import { isFinished, normalizeRpcEvent, TASK_EVENT, TASK_STATUS, taskLabel, type AskRequest, type TaskRecord, type TaskStore } from "./agents-protocol.ts";

// Gentle Agents runner. Every subagent is its own `pi --mode rpc` process:
// the host never runs subagent work on the TUI thread. It writes JSON
// commands, reads JSON lines, applies deltas to the store, answers dialogs,
// and enforces a total timeout plus a stall watchdog per task.

export interface ChildLike {
	pid: number | undefined;
	stdin: Writable;
	stdout: Readable;
	stderr: Readable | null | undefined;
	kill(signal?: NodeJS.Signals): boolean;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
}

export interface SpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildLike;

export interface PiCommand {
	command: string;
	args: string[];
}

export interface RunnerDeps {
	spawn: Spawn;
	now(): number;
	schedule(fn: () => void, ms: number): () => void;
	pi: PiCommand;
}

export interface RunnerLimits {
	maxConcurrency: number;
	timeoutMs: number;
	stallTimeoutMs: number;
}

export interface AskAnswer {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

export interface RunnerHooks {
	askUser(taskId: string, request: AskRequest, raw: Record<string, unknown>): Promise<AskAnswer>;
	onFinish?(task: TaskRecord): void;
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
}

interface ProcessLike {
	execPath: string;
	argv: string[];
	env: NodeJS.ProcessEnv;
}

interface Pending {
	resolve(value: Record<string, unknown>): void;
}

interface LiveTask {
	child: ChildLike;
	pending: Map<string, Pending>;
	cancelTimeout: () => void;
	cancelStall: () => void;
	cancelling: boolean;
	nextId: number;
}

const CHILD_MARKER = "GENTLE_PI_AGENTS_CHILD";
const DEFAULT_TOOLS: readonly string[] = [];

export function childArguments(request: TaskRequest): string[] {
	const args = ["--mode", "rpc", "--session-dir", request.sessionDir];
	if (request.resumeSessionPath) args.push("--session", request.resumeSessionPath);
	if (request.model) args.push("--model", request.thinking ? `${formatModelRef(request.model)}:${request.thinking}` : formatModelRef(request.model));
	else if (request.thinking) args.push("--thinking", request.thinking);
	const tools = request.agent.tools.length > 0 ? request.agent.tools : DEFAULT_TOOLS;
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
	private readonly queue: Array<{ task: TaskRecord; request: TaskRequest }> = [];
	private readonly live = new Map<string, LiveTask>();
	private readonly waiters = new Map<string, Array<(task: TaskRecord) => void>>();
	private counter = 0;

	constructor(store: TaskStore, limits: RunnerLimits, deps: RunnerDeps, hooks: RunnerHooks) {
		this.store = store;
		this.limits = limits;
		this.deps = deps;
		this.hooks = hooks;
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

	cancel(id: string): boolean {
		const queued = this.queue.findIndex((entry) => entry.task.id === id);
		if (queued >= 0) {
			this.queue.splice(queued, 1);
			this.finish(id, TASK_STATUS.CANCELLED, "cancelled before start");
			return true;
		}
		const live = this.live.get(id);
		if (!live) return false;
		live.cancelling = true;
		void this.send(id, { type: "abort" });
		this.finish(id, TASK_STATUS.CANCELLED, "cancelled");
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
	// spawn exceptions, the process error event, and stdin errors all settle
	// through finish() instead of surfacing as uncaught errors in the host.
	private launch(id: string, request: TaskRequest): void {
		const env = { ...request.env, [CHILD_MARKER]: "1" };
		let child: ChildLike;
		try {
			child = this.deps.spawn(this.deps.pi.command, [...this.deps.pi.args, ...childArguments(request)], { cwd: request.cwd, env });
		} catch (error) {
			this.store.update(id, { status: TASK_STATUS.RUNNING, startedAt: this.deps.now(), lastStep: "starting" });
			this.finish(id, TASK_STATUS.FAILED, `could not start pi: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const live: LiveTask = { child, pending: new Map(), cancelTimeout: () => {}, cancelStall: () => {}, cancelling: false, nextId: 0 };
		this.live.set(id, live);
		this.store.update(id, { status: TASK_STATUS.RUNNING, startedAt: this.deps.now(), lastStep: "starting" });
		child.on("error", (error) => this.finish(id, TASK_STATUS.FAILED, `could not start pi: ${error.message}`));
		child.stdin.on("error", () => {});
		live.cancelTimeout = this.deps.schedule(() => this.finish(id, TASK_STATUS.TIMED_OUT, `timed out after ${Math.round(this.limits.timeoutMs / 60_000)} min`), this.limits.timeoutMs);
		this.armStall(id, live);
		const lines = new JsonLines((value) => this.receive(id, request, value));
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => lines.push(chunk));
		child.stderr?.on("data", () => {});
		child.on("exit", (code) => {
			if (!this.live.has(id)) return;
			const current = this.store.get(id);
			if (current && !isFinished(current.status)) this.finish(id, live.cancelling ? TASK_STATUS.CANCELLED : TASK_STATUS.FAILED, `pi exited with code ${code ?? "unknown"}`);
		});
		void this.send(id, { type: "get_state" }).then((response) => {
			const data = response.data as { sessionFile?: string } | undefined;
			if (data?.sessionFile) this.store.update(id, { sessionPath: data.sessionFile });
		});
		void this.send(id, { type: "prompt", message: promptText(request) }).then((response) => {
			if (response.success === false) this.finish(id, TASK_STATUS.FAILED, String(response.error ?? "prompt rejected"));
		});
	}

	private armStall(id: string, live: LiveTask): void {
		live.cancelStall();
		live.cancelStall = this.deps.schedule(() => this.finish(id, TASK_STATUS.TIMED_OUT, `stalled for ${Math.round(this.limits.stallTimeoutMs / 60_000)} min`), this.limits.stallTimeoutMs);
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

	private write(live: LiveTask, payload: Record<string, unknown>): void {
		try {
			live.child.stdin.write(`${JSON.stringify(payload)}\n`);
		} catch {
			// the child is gone; the exit handler settles the task
		}
	}

	private receive(id: string, request: TaskRequest, value: unknown): void {
		const live = this.live.get(id);
		if (!live || !value || typeof value !== "object") return;
		const raw = value as Record<string, unknown>;
		if (raw.type === "response") {
			const pending = typeof raw.id === "string" ? live.pending.get(raw.id) : undefined;
			if (pending) {
				live.pending.delete(raw.id as string);
				pending.resolve(raw);
			}
			return;
		}
		this.armStall(id, live);
		for (const event of normalizeRpcEvent(raw)) {
			this.store.apply(id, event, this.deps.now());
			if (event.type === TASK_EVENT.ASK) void this.answer(id, request, live, event.request, raw);
			if (event.type === TASK_EVENT.AGENT_END) this.finish(id, TASK_STATUS.COMPLETED, null);
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
		this.write(live, { type: "extension_ui_response", id: ask.id, ...answer });
		const current = this.store.get(id);
		if (current?.status === TASK_STATUS.WAITING) this.store.update(id, { status: TASK_STATUS.RUNNING, lastStep: answer.cancelled ? "question dismissed" : "answered" });
	}

	private finish(id: string, status: TaskRecord["status"], error: string | null): void {
		const current = this.store.get(id);
		if (!current || isFinished(current.status)) return;
		const live = this.live.get(id);
		if (live) {
			live.cancelTimeout();
			live.cancelStall();
			this.live.delete(id);
			try {
				live.child.kill("SIGTERM");
			} catch {
				// already gone
			}
		}
		const finished = this.store.update(id, { status, endedAt: this.deps.now(), error, lastStep: error ?? "done" });
		if (finished) {
			this.hooks.onFinish?.(finished);
			for (const resolve of this.waiters.get(id) ?? []) resolve(finished);
			this.waiters.delete(id);
		}
		queueMicrotask(() => this.pump());
	}
}
