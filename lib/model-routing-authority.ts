import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type ModelConfigTarget = "global" | "project";
export type AgentSource = "project" | "user" | "builtin";
export interface AgentRoutingEntry { model?: string; thinking?: ThinkingLevel }
export type AgentModelConfig = Record<string, AgentRoutingEntry>;
export type ModelConfigFileResult = { status: "missing" } | { status: "invalid"; path: string } | { status: "valid"; config: AgentModelConfig };
export interface ModelRoutingRoots { configHome?: string; agentHome?: string }
export class ModelRoutingPersistenceError extends Error {
	readonly path: string;
	constructor(message: string, path: string) { super(message); this.name = "ModelRoutingPersistenceError"; this.path = path; }
}
const AGENT_NAME = /^[A-Za-z0-9._:@/+%-]+$/;
const MODEL_ID = /^[A-Za-z0-9._~:@/+%-]+$/;
const object = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const invalid = (path: string) => new ModelRoutingPersistenceError(`model routing document is invalid: ${path}`, path);

export function normalizeModelId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const model = value.trim();
	return model && MODEL_ID.test(model) ? model : undefined;
}
export function normalizeRoutingEntry(value: unknown): AgentRoutingEntry | undefined {
	if (value === null || value === "inherit") return {};
	const input = typeof value === "string" ? { model: value } : object(value);
	if (!input) return undefined;
	const rawModel = input.model;
	const rawThinking = input.thinking ?? input.effort;
	const model = rawModel === undefined || rawModel === null || rawModel === "inherit" ? undefined : normalizeModelId(rawModel);
	const thinking = rawThinking === undefined || rawThinking === null || rawThinking === "inherit" ? undefined : THINKING_LEVELS.includes(rawThinking as ThinkingLevel) ? rawThinking as ThinkingLevel : undefined;
	if (rawModel !== undefined && rawModel !== null && rawModel !== "inherit" && !model) return undefined;
	if (rawThinking !== undefined && rawThinking !== null && rawThinking !== "inherit" && !thinking) return undefined;
	return { ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}
export function normalizeModelConfig(value: unknown): AgentModelConfig | undefined {
	const input = object(value);
	if (!input) return undefined;
	const config: AgentModelConfig = {};
	for (const [name, raw] of Object.entries(input)) if (AGENT_NAME.test(name)) {
		const entry = normalizeRoutingEntry(raw);
		if (!entry) return undefined;
		config[name] = entry;
	}
	return config;
}
function parse(path: string, content: string): ModelConfigFileResult {
	try {
		const config = normalizeModelConfig(JSON.parse(content));
		return config ? { status: "valid", config } : { status: "invalid", path };
	} catch { return { status: "invalid", path }; }
}
export function readModelConfigFile(path: string): ModelConfigFileResult {
	if (!existsSync(path)) return { status: "missing" };
	try { return parse(path, readFileSync(path, "utf8")); } catch { return { status: "invalid", path }; }
}
export async function readModelConfigFileAsync(path: string): Promise<ModelConfigFileResult> {
	try { return parse(path, await readFile(path, "utf8")); }
	catch { return existsSync(path) ? { status: "invalid", path } : { status: "missing" }; }
}
function configHome(roots?: ModelRoutingRoots): string { return roots?.configHome ?? process.env.GENTLE_PI_CONFIG_HOME ?? join(homedir(), ".pi", "gentle-ai"); }
function agentHome(roots?: ModelRoutingRoots): string { return roots?.agentHome ?? process.env.GENTLE_PI_AGENT_HOME ?? join(homedir(), ".pi", "agent"); }
export function resolveModelRoutingTarget(cwd: string, target: ModelConfigTarget, roots?: ModelRoutingRoots) {
	return target === "project"
		? { target, configPath: join(cwd, ".pi", "gentle-ai", "models.json"), profilePath: join(cwd, ".pi", "subagents.json") }
		: { target, configPath: join(configHome(roots), "models.json"), profilePath: join(agentHome(roots), "subagents.json") };
}
export function modelConfigPath(cwd: string, target: ModelConfigTarget = "global"): string { return resolveModelRoutingTarget(cwd, target).configPath; }
export function agentModelProfileConfigPath(cwd: string, source: AgentSource, roots?: ModelRoutingRoots): string {
	return resolveModelRoutingTarget(cwd, source === "project" ? "project" : "global", roots).profilePath;
}
export function readSavedModelConfig(cwd: string): ModelConfigFileResult {
	const global = readModelConfigFile(modelConfigPath(cwd));
	return global.status === "missing" ? readModelConfigFile(modelConfigPath(cwd, "project")) : global;
}
export async function readSavedModelConfigAsync(cwd: string): Promise<ModelConfigFileResult> {
	const global = await readModelConfigFileAsync(modelConfigPath(cwd));
	return global.status === "missing" ? readModelConfigFileAsync(modelConfigPath(cwd, "project")) : global;
}
export function readModelConfig(cwd: string): AgentModelConfig { const result = readSavedModelConfig(cwd); return result.status === "valid" ? result.config : {}; }
export async function readModelConfigAsync(cwd: string): Promise<AgentModelConfig> { const result = await readSavedModelConfigAsync(cwd); return result.status === "valid" ? result.config : {}; }
export function readModelConfigForTarget(cwd: string, target: ModelConfigTarget): ModelConfigFileResult { return readModelConfigFile(modelConfigPath(cwd, target)); }
export function readModelConfigForTargetAsync(cwd: string, target: ModelConfigTarget): Promise<ModelConfigFileResult> { return readModelConfigFileAsync(modelConfigPath(cwd, target)); }

function atomicSync(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try { writeFileSync(temporary, content, "utf8"); renameSync(temporary, path); }
	catch (error) {
		try { rmSync(temporary, { force: true }); } catch { /* preserve replacement failure */ }
		throw new ModelRoutingPersistenceError(`failed to replace model routing document ${path}: ${error instanceof Error ? error.message : String(error)}`, path);
	}
}
async function atomic(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try { await writeFile(temporary, content, "utf8"); await rename(temporary, path); }
	catch (error) {
		try { await rm(temporary, { force: true }); } catch { /* preserve replacement failure */ }
		throw new ModelRoutingPersistenceError(`failed to replace model routing document ${path}: ${error instanceof Error ? error.message : String(error)}`, path);
	}
}
function assertExisting(path: string): void { if (readModelConfigFile(path).status === "invalid") throw invalid(path); }
export function writeModelConfigFile(path: string, value: unknown): void {
	const config = normalizeModelConfig(value);
	if (!config) throw invalid(path);
	assertExisting(path);
	atomicSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
export async function writeModelConfigFileAsync(path: string, value: unknown): Promise<void> {
	const config = normalizeModelConfig(value);
	if (!config) throw invalid(path);
	if ((await readModelConfigFileAsync(path)).status === "invalid") throw invalid(path);
	await atomic(path, `${JSON.stringify(config, null, 2)}\n`);
}
export function writeModelConfig(cwd: string, value: unknown, target: ModelConfigTarget = "global"): void { writeModelConfigFile(modelConfigPath(cwd, target), value); }
export function writeModelConfigAsync(cwd: string, value: unknown, target: ModelConfigTarget = "global"): Promise<void> { return writeModelConfigFileAsync(modelConfigPath(cwd, target), value); }
export { atomicSync, atomic };
