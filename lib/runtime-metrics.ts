import { readFileSync } from "node:fs";
import { classifyPiCatalogName } from "./runtime-metrics-pi-identity.ts";

const runtimeSchema = JSON.parse(readFileSync(new URL("../contracts/telemetry/runtime-aggregate-v1.schema.json", import.meta.url), "utf8"));

// Pure local accounting, not a telemetry transport or Pi event adapter.
// Callers supply finalized assistant responses and authoritative classifications.
// Never infer executor, usage availability, or measured timings from SDK defaults.
const EXECUTORS = ["orchestrator", "worker", "reviewer", "unknown"] as const;
const PROVIDERS = ["anthropic", "openai", "openai-codex", "google", "google-vertex", "amazon-bedrock", "openrouter", "custom", "unknown"] as const;
// Stable families, not model IDs/versions: new models need no catalog update.
// Callers map known native metadata to families; private aliases stay custom.
const FAMILIES = ["claude", "gpt", "o-series", "gemini", "llama", "qwen", "deepseek", "kimi", "custom", "unknown"] as const;
// Pi 0.85.1 docs/models.md, Thinking Level Map. These are selected Pi levels,
// not inferred provider effort or a claim that each model supports every level.
export const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "not_selected", "unsupported", "unavailable"] as const;
const ERRORS = ["none", "aborted", "rate_limit", "authentication", "network", "provider", "unknown"] as const;
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"] as const;
declare const agentClassBrand: unique symbol;
export type AgentClass = string & { readonly [agentClassBrand]: "AgentClass" };

function agentClasses(): readonly AgentClass[] {
	const values: unknown = runtimeSchema?.$defs?.row?.properties?.agent_class?.enum;
	if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== "string")) {
		throw new Error("Invalid runtime telemetry agent_class schema");
	}
	return Object.freeze([...values]) as readonly AgentClass[];
}

// The mirrored transport contract is the runtime source of truth. Keeping this
// data-driven lets packaged agent updates follow the closed enum without a
// second name registry drifting in TypeScript.
export const AGENT_CLASSES = agentClasses();
export function parseAgentClass(value: unknown): AgentClass | undefined {
	return typeof value === "string" && (AGENT_CLASSES as readonly string[]).includes(value) ? value as AgentClass : undefined;
}
function requiredAgentClass(value: string): AgentClass {
	const parsed = parseAgentClass(value);
	if (!parsed) throw new Error(`Runtime telemetry schema is missing required agent_class ${value}`);
	return parsed;
}
export const UNKNOWN_AGENT_CLASS = requiredAgentClass("unknown");
export const ORCHESTRATOR_AGENT_CLASS = requiredAgentClass("orchestrator");

function registeredModels(): ReadonlySet<string> {
	const rules: unknown = runtimeSchema?.$defs?.model?.oneOf;
	if (!Array.isArray(rules) || !rules.length) throw new Error("Invalid runtime telemetry model schema");
	const values = (rule: unknown, field: "provider" | "id"): string[] => {
		if (!object(rule)) throw new Error("Invalid runtime telemetry model schema");
		const properties = rule.properties;
		if (!object(properties) || !object(properties[field])) throw new Error("Invalid runtime telemetry model schema");
		const property = properties[field];
		const candidates = typeof property.const === "string" ? [property.const] : property.enum;
		if (!Array.isArray(candidates) || !candidates.length || candidates.some(value => typeof value !== "string")) {
			throw new Error("Invalid runtime telemetry model schema");
		}
		return candidates as string[];
	};
	const models = new Set<string>();
	for (const rule of rules) for (const provider of values(rule, "provider")) {
		for (const id of values(rule, "id")) models.add(JSON.stringify([provider, id]));
	}
	return models;
}

const REGISTERED_MODELS = registeredModels();

/** The mirrored transport registry is authoritative before the optional Pi
 * catalog. Unknown registry pairs still pass through the existing privacy
 * classifier, so private IDs can only become custom/unknown.
 */
export function classifyRuntimeModelId(provider: unknown, modelId: unknown,
	classifyModel: typeof classifyPiCatalogName = classifyPiCatalogName): string {
	if (typeof provider === "string" && typeof modelId === "string"
		&& REGISTERED_MODELS.has(JSON.stringify([provider, modelId]))) return modelId;
	return classifyModel({ provider, modelId }).modelId;
}

type Missing = { state: "unavailable" | "unsupported" };
export type TokenMeasurement = Missing | { state: "reported"; value: number };
export type DurationMeasurement = Missing | { state: "measured"; value: number };
export interface FinalResponse {
	kind: "final_assistant_response";
	/** Local dedupe only: 1..128 UTF-16 code units; never exported. */
	responseId: string;
	/** Caller-observed selected SDK model ID, never dispatched/response identity.
	 * Catalog must be loaded before accounting; only public catalog names survive.
	 */
	selectedModelId?: string;
	/** Selection namespace, independent from observed response provider.
	 * Omission preserves legacy same-provider callers; adapters must pass it explicitly.
	 */
	selectedProvider?: typeof PROVIDERS[number];
	agentClass?: AgentClass;
	/** Public catalog names from SDK response metadata, never endpoint proof. */
	observedModelId?: string;
	responseModelId?: string;
	providerThinkingLevel?: typeof EFFORTS[number];
	executor: typeof EXECUTORS[number];
	provider: typeof PROVIDERS[number];
	modelFamily: typeof FAMILIES[number];
	effort: typeof EFFORTS[number];
	error: typeof ERRORS[number];
	/** Separate native counters; do not add cached tokens into input here. */
	tokens: Record<"input" | "output" | "cacheRead" | "cacheWrite", TokenMeasurement>
		& Partial<Record<"reasoning" | "totalTokens", TokenMeasurement>>;
	/** Request start to response headers; not first token or full response. */
	responseHeadersMs: DurationMeasurement;
	/** Same request start to completed response; only explicitly measured values. */
	fullResponseMs: DurationMeasurement;
}

interface TokenTotals { reported: number; unavailable: number; unsupported: number; sum: number }
interface DurationTotals { measured: number; unavailable: number; unsupported: number; sum: number }
export interface RuntimeMetricBucket {
	hostAgent: "pi";
	agentClass: AgentClass;
	observedModelId: string;
	responseModelId: string;
	providerThinkingLevel: typeof EFFORTS[number];
	selectedModelId: string;
	selectedProvider: FinalResponse["provider"];
	executor: FinalResponse["executor"];
	provider: FinalResponse["provider"];
	modelFamily: FinalResponse["modelFamily"];
	effort: FinalResponse["effort"];
	error: FinalResponse["error"];
	responses: number;
	tokens: Record<typeof TOKEN_FIELDS[number], TokenTotals>;
	responseHeadersMs: DurationTotals;
	fullResponseMs: DurationTotals;
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function member<T extends string>(values: readonly T[], value: unknown): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function category<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
	return member(values, value) ? value : fallback;
}

function measurement(value: unknown, present: "reported" | "measured"): boolean {
	if (!object(value)) return false;
	if (value.state === "unavailable" || value.state === "unsupported") return !("value" in value);
	if (value.state !== present || typeof value.value !== "number") return false;
	const n = value.value;
	// Hard ceilings keep every sum finite/exact for integer counters, even at capacity.
	return Number.isFinite(n) && n >= 0 && (present === "reported"
		? Number.isSafeInteger(n) && n <= 1_000_000_000
		: n <= 86_400_000);
}

export function validRuntimeResponse(value: unknown): value is FinalResponse {
	if (!object(value) || value.kind !== "final_assistant_response") return false;
	if (typeof value.responseId !== "string" || value.responseId.length < 1 || value.responseId.length > 128) return false;
	if (!member(EFFORTS, value.effort) || !member(ERRORS, value.error)) return false;
	const tokens = value.tokens;
	if (!object(tokens) || !TOKEN_FIELDS.every(key => measurement(tokens[key] === undefined && ["reasoning", "totalTokens"].includes(key)
		? { state: "unavailable" } : tokens[key], "reported"))) return false;
	if (!measurement(value.responseHeadersMs, "measured") || !measurement(value.fullResponseMs, "measured")) return false;
	const headers = value.responseHeadersMs as DurationMeasurement;
	const full = value.fullResponseMs as DurationMeasurement;
	return headers.state !== "measured" || full.state !== "measured" || headers.value <= full.value;
}

function tokenTotals(): TokenTotals {
	return { reported: 0, unavailable: 0, unsupported: 0, sum: 0 };
}

function durationTotals(): DurationTotals {
	return { measured: 0, unavailable: 0, unsupported: 0, sum: 0 };
}

function addDuration(totals: DurationTotals, value: DurationMeasurement): void {
	totals[value.state] += 1;
	if (value.state === "measured") totals.sum += value.value;
}

/**
 * At most 1024 accepted responses/IDs, 64 dimension buckets, and 128 code units
 * per ID. No eviction: once capacity is reached, new records are rejected
 * atomically (including existing buckets); accepted IDs remain deduplicated.
 * Invalid/rejected IDs are not reserved. A new instance starts a new accounting
 * window with NO cross-instance/lifetime dedupe guarantee. No reset/flush API:
 * window ownership and delivery remain future work. Runtime consumption stays
 * separate from deterministic SDD/RDD counts; no closure attribution or bridge.
 * Snapshots contain only closed dimensions and bounded numeric aggregates.
 */
export class RuntimeMetrics {
	#ids = new Set<string>();
	#buckets = new Map<string, RuntimeMetricBucket>();
	#maxResponses: number;
	#maxBuckets: number;
	#classifyModel: typeof classifyPiCatalogName;

	constructor({ maxResponses = 1024, maxBuckets = 64, classifyModel = classifyPiCatalogName }:
		{ maxResponses?: number; maxBuckets?: number; classifyModel?: typeof classifyPiCatalogName } = {}) {
		if (!Number.isInteger(maxResponses) || maxResponses < 1 || maxResponses > 1024
			|| !Number.isInteger(maxBuckets) || maxBuckets < 1 || maxBuckets > 64) {
			throw new RangeError("Invalid runtime metrics capacity");
		}
		this.#maxResponses = maxResponses;
		this.#maxBuckets = maxBuckets;
		this.#classifyModel = classifyModel;
	}

	record(response: FinalResponse): "recorded" | "duplicate" | "invalid" | "capacity" {
		if (!validRuntimeResponse(response)) return "invalid";
		if (this.#ids.has(response.responseId)) return "duplicate";
		const selectedProvider = response.selectedProvider ?? response.provider;
		const dimensions = {
			hostAgent: "pi" as const,
			agentClass: category(AGENT_CLASSES, response.agentClass, UNKNOWN_AGENT_CLASS),
			observedModelId: classifyRuntimeModelId(response.provider, response.observedModelId, this.#classifyModel),
			responseModelId: classifyRuntimeModelId(response.provider, response.responseModelId, this.#classifyModel),
			providerThinkingLevel: category(EFFORTS, response.providerThinkingLevel, "unavailable"),
			selectedModelId: classifyRuntimeModelId(selectedProvider, response.selectedModelId, this.#classifyModel),
			selectedProvider: category(PROVIDERS, selectedProvider, typeof selectedProvider === "string" && selectedProvider ? "custom" : "unknown"),
			executor: category(EXECUTORS, response.executor, "unknown"),
			provider: category(PROVIDERS, response.provider, typeof response.provider === "string" && response.provider ? "custom" : "unknown"),
			modelFamily: category(FAMILIES, response.modelFamily, typeof response.modelFamily === "string" && response.modelFamily ? "custom" : "unknown"),
			effort: response.effort,
			error: response.error,
		};
		const key = JSON.stringify(dimensions);
		let bucket = this.#buckets.get(key);
		if (this.#ids.size >= this.#maxResponses || (!bucket && this.#buckets.size >= this.#maxBuckets)) return "capacity";
		if (!bucket) {
			bucket = {
				...dimensions, responses: 0,
				tokens: { input: tokenTotals(), output: tokenTotals(), cacheRead: tokenTotals(), cacheWrite: tokenTotals(), reasoning: tokenTotals(), totalTokens: tokenTotals() },
				responseHeadersMs: durationTotals(), fullResponseMs: durationTotals(),
			};
			this.#buckets.set(key, bucket);
		}
		this.#ids.add(response.responseId);
		bucket.responses += 1;
		for (const field of TOKEN_FIELDS) {
			const value = response.tokens[field] ?? { state: "unavailable" as const };
			bucket.tokens[field][value.state] += 1;
			if (value.state === "reported") bucket.tokens[field].sum += value.value;
		}
		addDuration(bucket.responseHeadersMs, response.responseHeadersMs);
		addDuration(bucket.fullResponseMs, response.fullResponseMs);
		return "recorded";
	}

	snapshot(): RuntimeMetricBucket[] {
		return structuredClone([...this.#buckets.values()]);
	}
}
