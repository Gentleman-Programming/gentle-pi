import { existsSync, readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";

export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface AgentRoutingEntry {
	model?: string;
	thinking?: ThinkingLevel;
}

export type AgentModelConfig = Record<string, AgentRoutingEntry>;

export type ModelConfigFileResult =
	| { status: "missing" }
	| { status: "invalid"; path: string }
	| { status: "valid"; config: AgentModelConfig };

const SAFE_MODEL_ID_PATTERN = /^[A-Za-z0-9._~:@/+%-]+$/;
const UNSAFE_AGENT_NAME_CHARACTERS = /["'\u0000-\u001F\u007F-\u009F]/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		typeof value === "string" &&
		(THINKING_LEVELS as readonly string[]).includes(value)
	);
}

export function normalizeModelId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const model = value.trim();
	if (model.length === 0) return undefined;
	if (!SAFE_MODEL_ID_PATTERN.test(model)) return undefined;
	return model;
}

/** Canonical names allow unknown punctuation and internal whitespace. */
export function normalizeAgentName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const name = value.trim();
	return name.length > 0 && !UNSAFE_AGENT_NAME_CHARACTERS.test(name) ? name : undefined;
}

export function normalizeRoutingEntry(value: unknown): AgentRoutingEntry | undefined {
	if (typeof value === "string") {
		const model = normalizeModelId(value);
		return model ? { model } : undefined;
	}
	if (!isRecord(value)) return undefined;
	const model = normalizeModelId(value.model);
	const thinking = isThinkingLevel(value.thinking) ? value.thinking : undefined;
	if (!model && !thinking) {
		return Object.keys(value).length === 0 ? {} : undefined;
	}
	return { model, thinking };
}

export function normalizeModelConfig(value: unknown): AgentModelConfig | undefined {
	if (!isRecord(value)) return undefined;
	const cleaned: AgentModelConfig = {};
	for (const [name, entryValue] of Object.entries(value)) {
		const canonicalName = normalizeAgentName(name);
		const entry = normalizeRoutingEntry(entryValue);
		if (canonicalName && entry) cleaned[canonicalName] = entry;
	}
	return cleaned;
}

function decodeSavedRoutingEntry(value: unknown): AgentRoutingEntry | undefined {
	if (typeof value === "string") {
		const model = normalizeModelId(value);
		return model ? { model } : undefined;
	}
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value);
	if (entries.some(([key]) => key !== "model" && key !== "thinking")) {
		return undefined;
	}
	if (entries.length === 0) return {};

	const modelEntry = entries.find(([key]) => key === "model");
	const thinkingEntry = entries.find(([key]) => key === "thinking");
	const model = modelEntry ? normalizeModelId(modelEntry[1]) : undefined;
	const thinking = thinkingEntry && isThinkingLevel(thinkingEntry[1]) ? thinkingEntry[1] : undefined;
	if ((modelEntry && !model) || (thinkingEntry && !thinking)) return undefined;
	return { model, thinking };
}

function parseModelConfigFileValue(value: Record<string, unknown>): AgentModelConfig | undefined {
	const config: AgentModelConfig = {};
	for (const [name, entryValue] of Object.entries(value)) {
		const canonicalName = normalizeAgentName(name);
		const entry = decodeSavedRoutingEntry(entryValue);
		if (!canonicalName || canonicalName !== name || !entry) return undefined;
		config[canonicalName] = entry;
	}
	return config;
}

export function readModelConfigFile(path: string): ModelConfigFileResult {
	if (!existsSync(path)) return { status: "missing" };
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return { status: "invalid", path };
		const config = parseModelConfigFileValue(parsed);
		return config === undefined ? { status: "invalid", path } : { status: "valid", config };
	} catch {
		return { status: "invalid", path };
	}
}

export async function readModelConfigFileAsync(
	path: string,
): Promise<ModelConfigFileResult> {
	if (!(await pathExists(path))) return { status: "missing" };
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isRecord(parsed)) return { status: "invalid", path };
		const config = parseModelConfigFileValue(parsed);
		return config === undefined ? { status: "invalid", path } : { status: "valid", config };
	} catch {
		return { status: "invalid", path };
	}
}

export function readSavedModelConfig(
	globalPath: string,
	projectPath: string,
): ModelConfigFileResult {
	const globalResult = readModelConfigFile(globalPath);
	if (globalResult.status !== "missing") return globalResult;
	return readModelConfigFile(projectPath);
}

export async function readSavedModelConfigAsync(
	globalPath: string,
	projectPath: string,
): Promise<ModelConfigFileResult> {
	const globalResult = await readModelConfigFileAsync(globalPath);
	if (globalResult.status !== "missing") return globalResult;
	return readModelConfigFileAsync(projectPath);
}
