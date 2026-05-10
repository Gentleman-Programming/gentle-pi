import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GENTLE_PI_MEMORY_STATUS, type GentlePiMemoryStatus } from "./types.js";

export const ENGRAM_OPERATION = {
	MEM_SEARCH: "mem_search",
	MEM_CONTEXT: "mem_context",
	MEM_GET_OBSERVATION: "mem_get_observation",
	MEM_SAVE: "mem_save",
	MEM_SAVE_PROMPT: "mem_save_prompt",
	MEM_SESSION_SUMMARY: "mem_session_summary",
} as const;

export type EngramOperation = (typeof ENGRAM_OPERATION)[keyof typeof ENGRAM_OPERATION];

export const ENGRAM_CONFIG_TRANSPORT = {
	COMMAND: "command",
	URL: "url",
	UNKNOWN: "unknown",
} as const;

export type EngramConfigTransport = (typeof ENGRAM_CONFIG_TRANSPORT)[keyof typeof ENGRAM_CONFIG_TRANSPORT];

export interface EngramBridgeConfigEvidence {
	sourcePath: string;
	serverName: string;
	transport: EngramConfigTransport;
}

export interface EngramBridgeConfigDiscoveryInput {
	projectRoot: string;
	agentDir: string;
}

export interface EngramBridgeStateInput {
	activeToolNames?: readonly string[];
	configEvidence?: readonly EngramBridgeConfigEvidence[];
	configuredSignals?: readonly string[];
}

export interface EngramBridgeState {
	status: GentlePiMemoryStatus;
	configEvidence: EngramBridgeConfigEvidence[];
	configuredSignals: string[];
	callableTools: string[];
	canonicalOperations: EngramOperation[];
}

const REQUIRED_AVAILABLE_OPERATIONS = [
	ENGRAM_OPERATION.MEM_SEARCH,
	ENGRAM_OPERATION.MEM_SAVE,
	ENGRAM_OPERATION.MEM_CONTEXT,
	ENGRAM_OPERATION.MEM_GET_OBSERVATION,
] as const;

const OPERATION_VALUES = Object.values(ENGRAM_OPERATION);
const CONFIG_CONTAINER_KEYS = ["mcpServers", "servers"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringField(value: Record<string, unknown>, field: string): boolean {
	return typeof value[field] === "string" && value[field].trim().length > 0;
}

function getTransport(server: Record<string, unknown>): EngramConfigTransport {
	if (hasStringField(server, "command")) {
		return ENGRAM_CONFIG_TRANSPORT.COMMAND;
	}
	if (hasStringField(server, "url") || hasStringField(server, "uri")) {
		return ENGRAM_CONFIG_TRANSPORT.URL;
	}
	return ENGRAM_CONFIG_TRANSPORT.UNKNOWN;
}

function serverReferencesEngram(name: string, server: Record<string, unknown>): boolean {
	const lowerName = name.toLowerCase();
	if (lowerName.includes("engram")) {
		return true;
	}

	const serverName = server.name;
	if (typeof serverName === "string" && serverName.toLowerCase().includes("engram")) {
		return true;
	}

	const command = server.command;
	if (typeof command === "string" && command.toLowerCase().includes("engram")) {
		return true;
	}

	const url = server.url ?? server.uri;
	return typeof url === "string" && url.toLowerCase().includes("engram");
}

function readJsonFile(filePath: string): unknown | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
	} catch {
		return undefined;
	}
}

function collectServerEvidence(sourcePath: string, root: Record<string, unknown>): EngramBridgeConfigEvidence[] {
	const evidence: EngramBridgeConfigEvidence[] = [];
	const containers: Record<string, unknown>[] = [];
	for (const key of CONFIG_CONTAINER_KEYS) {
		const container = root[key];
		if (isRecord(container)) {
			containers.push(container);
		}
	}
	containers.push(root);

	for (const container of containers) {
		for (const [serverName, serverValue] of Object.entries(container)) {
			if (!isRecord(serverValue) || !serverReferencesEngram(serverName, serverValue)) {
				continue;
			}
			evidence.push({
				sourcePath,
				serverName,
				transport: getTransport(serverValue),
			});
		}
	}

	return uniqueConfigEvidence(evidence);
}

function uniqueConfigEvidence(evidence: readonly EngramBridgeConfigEvidence[]): EngramBridgeConfigEvidence[] {
	const seen = new Set<string>();
	const unique: EngramBridgeConfigEvidence[] = [];
	for (const item of evidence) {
		const key = `${item.sourcePath}\0${item.serverName}\0${item.transport}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(item);
	}
	return unique.sort((a, b) => `${a.sourcePath}:${a.serverName}`.localeCompare(`${b.sourcePath}:${b.serverName}`));
}

export function detectEngramBridgeConfigEvidence(
	input: EngramBridgeConfigDiscoveryInput,
): EngramBridgeConfigEvidence[] {
	const candidatePaths = [
		join(input.projectRoot, ".mcp.json"),
		join(input.projectRoot, ".pi", "mcp.json"),
		join(input.agentDir, "mcp.json"),
		join(homedir(), ".config", "mcp", "mcp.json"),
	];
	const evidence: EngramBridgeConfigEvidence[] = [];
	for (const filePath of candidatePaths) {
		const parsed = readJsonFile(filePath);
		if (isRecord(parsed)) {
			evidence.push(...collectServerEvidence(filePath, parsed));
		}
	}
	return uniqueConfigEvidence(evidence);
}

function stripKnownPrefix(normalized: string): string {
	if (normalized.startsWith("engram_")) {
		return normalized.slice("engram_".length);
	}
	if (normalized.startsWith("engram.")) {
		return normalized.slice("engram.".length);
	}
	if (normalized.startsWith("mcp__engram__")) {
		return normalized.slice("mcp__engram__".length);
	}
	if (normalized.startsWith("mcp_engram_")) {
		return normalized.slice("mcp_engram_".length);
	}
	return normalized;
}

export function normalizeEngramToolName(toolName: string): EngramOperation | undefined {
	const normalized = stripKnownPrefix(toolName.trim().toLowerCase());
	return OPERATION_VALUES.find((operation) => normalized === operation);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}

function uniqueSortedOperations(values: readonly EngramOperation[]): EngramOperation[] {
	return [...new Set(values)].sort();
}

function hasConfiguredEvidence(input: EngramBridgeStateInput): boolean {
	return (input.configEvidence?.length ?? 0) > 0 || (input.configuredSignals?.length ?? 0) > 0;
}

export function deriveEngramBridgeState(input: EngramBridgeStateInput = {}): EngramBridgeState {
	const activeToolNames = input.activeToolNames;
	const configEvidence = uniqueConfigEvidence(input.configEvidence ?? []);
	const configuredSignals = uniqueSorted(input.configuredSignals ?? []);
	const callableTools: string[] = [];
	const canonicalOperations: EngramOperation[] = [];

	for (const toolName of activeToolNames ?? []) {
		const operation = normalizeEngramToolName(toolName);
		if (!operation) {
			continue;
		}
		callableTools.push(toolName);
		canonicalOperations.push(operation);
	}

	const operations = uniqueSortedOperations(canonicalOperations);
	const hasRequiredOperations = REQUIRED_AVAILABLE_OPERATIONS.every((operation) => operations.includes(operation));
	let status: GentlePiMemoryStatus;
	if (hasRequiredOperations) {
		status = GENTLE_PI_MEMORY_STATUS.AVAILABLE;
	} else if (hasConfiguredEvidence(input) && activeToolNames) {
		status = GENTLE_PI_MEMORY_STATUS.UNREACHABLE;
	} else if (hasConfiguredEvidence(input)) {
		status = GENTLE_PI_MEMORY_STATUS.CONFIGURED;
	} else if (activeToolNames) {
		status = GENTLE_PI_MEMORY_STATUS.UNAVAILABLE;
	} else {
		status = GENTLE_PI_MEMORY_STATUS.UNKNOWN;
	}

	return {
		status,
		configEvidence,
		configuredSignals,
		callableTools: uniqueSorted(callableTools),
		canonicalOperations: operations,
	};
}
