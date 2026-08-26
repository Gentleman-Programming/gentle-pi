import { randomUUID } from "node:crypto";

export const AGENT_ACTIVITY_VERSION = "gentle-pi.agent-activity/v1" as const;
export const AGENT_ACTIVITY_REQUEST_CHANNEL = "gentle-pi:agent-activity:v1:request" as const;
export const AGENT_ACTIVITY_CHANGED_CHANNEL = "gentle-pi:agent-activity:v1:changed" as const;
export const AGENT_ACTIVITY_INPUT_LIMIT = 1_000;
export const AGENT_ACTIVITY_OUTPUT_LIMIT = 100;

export type AgentActivityState = "queued" | "running" | "waiting-for-input" | "blocked" | "stopping" | "completed" | "failed" | "cancelled" | "interrupted";
export type AgentActivityPhase = "starting" | "preparing" | "running-tool" | "streaming" | "waiting" | "stopping" | "done";
export interface AgentActivityEntry { id: string; name: string; kind: "managed-task"; state: AgentActivityState; parent_id?: string; activity?: AgentActivityPhase; tool_name?: string; model_provider?: string; model_id?: string; effort?: string; started_at_ms?: number; ended_at_ms?: number; input_tokens?: number; output_tokens?: number; cached_tokens?: number; total_tokens?: number; context_window_tokens?: number }
export type AgentActivityEntryInput = Record<string, unknown>;
export interface AgentActivitySnapshot { version: typeof AGENT_ACTIVITY_VERSION; source_generation: string | null; revision: number; availability: "available" | "unavailable"; tasks: readonly AgentActivityEntry[]; total_count: number; truncated: boolean; reason?: "not-started" | "starting" | "replacing" | "shutdown" }
export interface AgentActivityEventBus { on(channel: string, handler: (data: unknown) => void): () => void; emit(channel: string, data: unknown): void }
export interface AgentActivityProducer { publish(candidate: readonly AgentActivityEntryInput[]): void; dispose(): void }
export interface AgentActivityProjection { getSnapshot(): AgentActivitySnapshot; registerProducer(): AgentActivityProducer }
export interface AgentActivityConsumer { getSnapshot(): AgentActivitySnapshot | undefined; subscribe(listener: (snapshot: AgentActivitySnapshot | undefined) => void): () => void; request(): void }

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GENERATION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOOL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EFFORT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const STATES = new Set<AgentActivityState>(["queued", "running", "waiting-for-input", "blocked", "stopping", "completed", "failed", "cancelled", "interrupted"]);
const PHASES = new Set<AgentActivityPhase>(["starting", "preparing", "running-tool", "streaming", "waiting", "stopping", "done"]);
const unavailableReasons = new Set(["not-started", "starting", "replacing", "shutdown"]);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safe = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const valid = (value: unknown, grammar: RegExp): value is string => typeof value === "string" && grammar.test(value);
const fail = (message: string): never => { throw new TypeError(`Invalid agent activity: ${message}`); };

function entry(value: unknown): AgentActivityEntry {
	if (!isRecord(value) || !valid(value.id, ID) || !valid(value.name, NAME) || value.kind !== "managed-task" || typeof value.state !== "string" || !STATES.has(value.state as AgentActivityState)) fail("required entry field");
	const out: AgentActivityEntry = { id: value.id as string, name: value.name as string, kind: "managed-task", state: value.state as AgentActivityState };
	const optional = (key: keyof AgentActivityEntry, value: unknown, grammar?: RegExp) => { if (value === undefined || value === null || (grammar ? !valid(value, grammar) : !PHASES.has(value as AgentActivityPhase))) return; (out as Record<string, unknown>)[key] = value; };
	optional("parent_id", value.parent_id, ID); optional("activity", value.activity); optional("tool_name", value.tool_name, TOOL); optional("model_provider", value.model_provider, PROVIDER); optional("model_id", value.model_id, MODEL); optional("effort", value.effort, EFFORT);
	const start = safe(value.started_at_ms) ? value.started_at_ms : undefined; const end = safe(value.ended_at_ms) && (start === undefined || value.ended_at_ms >= start) ? value.ended_at_ms : undefined;
	if (start !== undefined) out.started_at_ms = start; if (end !== undefined) out.ended_at_ms = end;
	for (const key of ["input_tokens", "output_tokens", "cached_tokens", "total_tokens", "context_window_tokens"] as const) if (safe(value[key])) out[key] = value[key];
	return Object.freeze(out);
}

export function validateAgentActivityCandidate(value: unknown): readonly AgentActivityEntry[] {
	if (!Array.isArray(value) || value.length > AGENT_ACTIVITY_INPUT_LIMIT) fail("candidate size");
	const out = value.map(entry); if (new Set(out.map((item) => item.id)).size !== out.length) fail("duplicate entry id"); return Object.freeze(out);
}

const snapshot = (value: { source_generation: string | null; revision: number; availability: "available" | "unavailable"; tasks: readonly AgentActivityEntry[]; total_count: number; truncated: boolean; reason?: AgentActivitySnapshot["reason"] }): AgentActivitySnapshot => Object.freeze({ version: AGENT_ACTIVITY_VERSION, ...value, tasks: Object.freeze([...value.tasks]) });
const initial = (): AgentActivitySnapshot => snapshot({ source_generation: null, revision: 0, availability: "unavailable", tasks: [], total_count: 0, truncated: false, reason: "not-started" });

export function validateAgentActivitySnapshot(value: unknown): AgentActivitySnapshot {
	if (!isRecord(value) || value.version !== AGENT_ACTIVITY_VERSION || !safe(value.revision) || (value.availability !== "available" && value.availability !== "unavailable") || !Array.isArray(value.tasks)) fail("snapshot envelope");
	const generation = value.source_generation === null ? null : valid(value.source_generation, GENERATION) ? value.source_generation : fail("generation");
	const tasks = validateAgentActivityCandidate(value.tasks); if (tasks.length > AGENT_ACTIVITY_OUTPUT_LIMIT) fail("snapshot task cap");
	if (!safe(value.total_count) || value.total_count > AGENT_ACTIVITY_INPUT_LIMIT || value.total_count < tasks.length || typeof value.truncated !== "boolean") fail("derived count");
	if (value.availability === "available") { if (generation === null || value.revision === 0 || Object.hasOwn(value, "reason") || value.truncated !== (value.total_count > tasks.length)) fail("available envelope"); return snapshot({ source_generation: generation, revision: value.revision, availability: "available", tasks, total_count: value.total_count, truncated: value.truncated }); }
	if (tasks.length !== 0 || value.total_count !== 0 || value.truncated !== false || typeof value.reason !== "string" || !unavailableReasons.has(value.reason) || (generation === null ? value.reason !== "not-started" || value.revision !== 0 : value.reason === "not-started") || ((value.reason === "starting" || value.reason === "replacing") ? value.revision !== 0 : value.reason === "shutdown" && value.revision === 0)) fail("unavailable envelope");
	return snapshot({ source_generation: generation, revision: value.revision, availability: "unavailable", tasks: [], total_count: 0, truncated: false, reason: value.reason as AgentActivitySnapshot["reason"] });
}

export function createAgentActivityProjection(events: AgentActivityEventBus): AgentActivityProjection {
	let current = initial(); let registered = false; let active: symbol | undefined;
	const changed = () => events.emit(AGENT_ACTIVITY_CHANGED_CHANNEL, current);
	events.on(AGENT_ACTIVITY_REQUEST_CHANNEL, () => changed());
	return { getSnapshot: () => current, registerProducer: () => {
		const token = randomUUID(); const capability = Symbol(token); const replacing = registered; active = capability; registered = true; current = snapshot({ source_generation: token, revision: 0, availability: "unavailable", tasks: [], total_count: 0, truncated: false, reason: replacing ? "replacing" : "starting" }); changed(); let revision = 0; let disposed = false;
		return { publish(candidate) { if (active !== capability || disposed) return; const tasks = validateAgentActivityCandidate(candidate); revision += 1; current = snapshot({ source_generation: token, revision, availability: "available", tasks: tasks.slice(0, AGENT_ACTIVITY_OUTPUT_LIMIT), total_count: tasks.length, truncated: tasks.length > AGENT_ACTIVITY_OUTPUT_LIMIT }); changed(); }, dispose() { if (active !== capability || disposed) return; disposed = true; revision += 1; current = snapshot({ source_generation: token, revision, availability: "unavailable", tasks: [], total_count: 0, truncated: false, reason: "shutdown" }); changed(); } };
	} };
}

export function createAgentActivityConsumer(events: AgentActivityEventBus): AgentActivityConsumer {
	let current: AgentActivitySnapshot | undefined; const listeners = new Set<(snapshot: AgentActivitySnapshot | undefined) => void>();
	events.on(AGENT_ACTIVITY_CHANGED_CHANNEL, (value) => { try { current = validateAgentActivitySnapshot(value); } catch { current = undefined; } for (const listener of listeners) listener(current); });
	return { getSnapshot: () => current, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, request() { events.emit(AGENT_ACTIVITY_REQUEST_CHANNEL, undefined); } };
}
