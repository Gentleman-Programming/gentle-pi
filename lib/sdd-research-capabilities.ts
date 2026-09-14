import { isAbsolute, resolve, dirname, basename } from "node:path";
import { realpathSync, lstatSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import type { AgentDefinition } from "./agents-config.ts";

// Exact registered Pi names, not provider display namespaces. MCP's generic
// `mcp` and dynamic `mcp__context7` gateways are deliberately NOT grants: an
// active gateway does not prove which remote methods it can safely expose.
export const RESEARCH_TOOLS = ["fetch_content", "web_search", "source_check", "get_search_content"] as const;
export const RESEARCH_CHILD_TOOLS_ENV = "GENTLE_PI_RESEARCH_TOOLS";
export const RESEARCH_SELECTION_ENV = "GENTLE_PI_RESEARCH_SELECTION";
export interface ResearchGrant {
	tools: string[];
	extensions: Record<string, string>;
}
export type ResearchSelection = Partial<Record<keyof ResearchCapabilities, ResearchGrant>>;
type Inventory = {
	getActiveTools?: () => string[];
	getAllTools?: () => Array<{ name: string; sourceInfo?: { source?: string; path?: string } }>;
};
type Capability = { status: "available" | "blocked"; tools: string[]; reason: string };
export type ResearchCapabilities = Record<"documentation" | "open-web", Capability>;

export function resolveResearchCapabilities(pi: Inventory, restriction?: readonly string[]): ResearchCapabilities {
	let names: string[] = [];
	try {
		const active = new Set(pi.getActiveTools?.() ?? []);
		names = (pi.getAllTools?.() ?? [])
			.filter(tool => active.has(tool.name) && tool.sourceInfo?.source !== "sdk" &&
				(restriction === undefined || restriction.includes(tool.name)))
			.map(tool => tool.name);
	} catch { /* Inventory failure is not a grant. */ }
	const tools = RESEARCH_TOOLS.filter(name => names.includes(name));
	const capability = (required: string[], guidance: string): Capability => {
		const missing = required.filter(name => !tools.includes(name as typeof RESEARCH_TOOLS[number]));
		return {
			status: missing.length === 0 ? "available" : "blocked",
			tools: required.filter(name => tools.includes(name as typeof RESEARCH_TOOLS[number])),
			reason: `${missing.length === 0 ? "" : `Missing active, approved, child-reachable tools: ${missing.join(", ")}. `}${guidance}`,
		};
	};
	return {
		documentation: capability(["fetch_content"], "Fetch official documentation URLs; validate publisher and version before citing."),
		"open-web": capability(["web_search", "source_check", "fetch_content", "get_search_content"], "All four tools are required. Search, check sources and retrieve original content; inventory and search snippets alone are not evidence."),
	};
}

export function renderResearchCapabilities(capabilities: ResearchCapabilities): string {
	return [
		"## SDD Research Capabilities",
		"Package-approved mapping intersected with active runtime tools and explicit agent restrictions:",
		...Object.entries(capabilities).map(([kind, value]) => `- ${kind}: ${value.status}; tools=${JSON.stringify(value.tools)}. ${value.reason}`),
		"Availability is not evidence or proposal admission. Run selected supported classes, record tool calls, source URLs, retrieval time, publisher/version, excerpts and claim-to-source IDs. Child-local inventory must confirm availability before evidence collection.",
		"Missing required tools block only the affected class. Any selected unavailable or partial class keeps proposal_ready=false. Preserve explicit source restrictions; never recommend skipping selected research because of a blanket denial.",
		"Generic MCP and dynamic namespace gateways are not approved evidence routes. Never infer remote method access from gateway names, tool descriptions, bash, persistence tools, or remembered facts.",
	].join("\n");
}

export function researchAgent(agent: AgentDefinition, pi: Inventory, selection?: unknown) {
	const capabilities = resolveResearchCapabilities(pi, agent.tools);
	const extensionPaths = new Set<string>();
	const requested = selection && typeof selection === "object" && !Array.isArray(selection)
		? selection as Record<string, unknown> : {};
	let registered: ReturnType<NonNullable<Inventory["getAllTools"]>> = [];
	try { registered = pi.getAllTools?.() ?? []; } catch { /* No provenance, no route. */ }
	for (const [kind, capability] of Object.entries(capabilities)) {
		const value = requested[kind];
		const grant = value && typeof value === "object" ? value as Partial<ResearchGrant> : {};
		const required = kind === "documentation" ? ["fetch_content"] : ["web_search", "source_check", "fetch_content", "get_search_content"];
		const exact = Object.keys(requested).every(key => Object.hasOwn(capabilities, key)) &&
			Array.isArray(grant.tools) && grant.tools.length === required.length &&
			required.every(name => grant.tools!.includes(name)) &&
			grant.extensions && Object.keys(grant.extensions).length === required.length;
		const paths = required.map(name => registered.find(tool => tool.name === name)?.sourceInfo?.path);
		capability.tools = exact ? required.filter((name, i) => capability.tools.includes(name) &&
			typeof paths[i] === "string" && isAbsolute(paths[i]!) && paths[i] === grant.extensions![name]) : [];
		if (capability.tools.length !== required.length) {
			capability.status = "blocked";
			capability.reason = `Selected exact grants and matching active extension provenance required. ${capability.reason}`;
		} else {
			for (const path of paths) extensionPaths.add(path!);
		}
	}
	const available = new Set(Object.values(capabilities).filter(value => value.status === "available").flatMap(value => value.tools));
	const local = new Set(["read", "grep", "find", "edit", "write", "mem_search", "mem_get_observation", "mem_save"]);
	const tools = agent.tools.filter(name => local.has(name) || available.has(name));
	return { agent: { ...agent, tools, instructions: `${agent.instructions}\n\n${renderResearchCapabilities(capabilities)}` }, capabilities, extensionPaths: [...extensionPaths] };
}

export const RESEARCH_ARTIFACT_ENV = "GENTLE_PI_RESEARCH_ARTIFACT";
const ARTIFACT_STORES = ["openspec", "engram", "both", "none"] as const;
interface EngramLocator {
	id: number;
	project: string;
	topic_key: string;
	revision_count: number;
}
export interface ResearchWriteIdentity {
	revision: number;
	digest: string;
}
interface ResearchLocator extends ResearchWriteIdentity {
	artifact: string;
	path?: string;
	engram?: EngramLocator;
}
export interface ResearchArtifactIntent {
	store: typeof ARTIFACT_STORES[number];
	worktree: string;
	changeName: string;
	retainedIntent: string;
	locators: ResearchLocator[];
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
// Missing leaves are allowed for diagnostic persistence; existing symlinks are not.
export function canonicalArtifactPath(path: string): string {
	try { lstatSync(path); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
		return resolve(canonicalArtifactPath(dirname(path)), basename(path));
	}
	return realpathSync(path);
}
export function parseResearchArtifactIntent(value: unknown, cwd: string, previous?: ResearchArtifactIntent): ResearchArtifactIntent {
	const input = record(value);
	if (!ARTIFACT_STORES.includes(input.store as ResearchArtifactIntent["store"])
		|| input.worktree !== realpathSync(cwd) || input.worktree !== cwd) throw new Error("Research artifact worktree/store scope mismatch.");
	if (typeof input.changeName !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(input.changeName)
		|| typeof input.retainedIntent !== "string" || !input.retainedIntent.trim() || !Array.isArray(input.locators)) throw new Error("Missing bounded research scope/retained intent.");
	const scope = structuredClone(input) as unknown as ResearchArtifactIntent;
	const local = scope.store === "openspec" || scope.store === "both";
	const memory = scope.store === "engram" || scope.store === "both";
	if (scope.locators.length > 3 || (scope.store === "none" ? scope.locators.length !== 0 : scope.locators.length === 0)) throw new Error("Invalid research locator scope.");
	const names = new Set<string>();
	for (const locator of scope.locators) {
		const item = record(locator), engram = record(item.engram);
		if (!["research", "preproposal", "explore"].includes(String(item.artifact))
			|| names.has(String(item.artifact))
			|| !positive(item.revision) || typeof item.digest !== "string" || !/^[a-f0-9]{64}$/.test(item.digest)) throw new Error("Invalid research identity scope.");
		names.add(locator.artifact);
		const path = resolve(cwd, "openspec/changes", scope.changeName, `${locator.artifact}.md`);
		if (local ? item.path !== path || canonicalArtifactPath(path) !== path : item.path !== undefined) throw new Error("OpenSpec locator outside exact scope.");
		if (memory ? !positive(engram.id) || !positive(engram.revision_count) || typeof engram.project !== "string" || !engram.project.trim() || engram.topic_key !== `sdd/${scope.changeName}/${locator.artifact}` : item.engram !== undefined) throw new Error("Engram locator outside exact scope.");
	}
	if (previous) {
		if (scope.store !== previous.store || scope.worktree !== previous.worktree
			|| scope.changeName !== previous.changeName || scope.retainedIntent !== previous.retainedIntent || scope.locators.length !== previous.locators.length) throw new Error("Research continuation cannot replace retained scope.");
		for (const next of scope.locators) {
			const old = previous.locators.find(item => item.artifact === next.artifact);
			if (!old || old.path !== next.path || old.engram?.id !== next.engram?.id
				|| old.engram?.project !== next.engram?.project || old.engram?.topic_key !== next.engram?.topic_key) throw new Error("Research continuation cannot broaden scope.");
			if (next.revision < old.revision || (next.engram?.revision_count ?? 0) < (old.engram?.revision_count ?? 0)
				|| next.revision === old.revision && next.digest !== old.digest) throw new Error("Research continuation has stale/divergent scope.");
		}
	}
	return scope;
}

// Negative intersection only: callers must still enforce host permissions/inventory.
export function researchArtifactCall(scope: ResearchArtifactIntent, cwd: string, tool: string, input: Record<string, unknown>): number {
	if (realpathSync(cwd) !== scope.worktree) throw new Error("Research artifact worktree changed.");
	const index = scope.locators.findIndex(locator => {
		if (locator.artifact === "explore" && ["write", "edit", "mem_save"].includes(tool)) return false;
		if (["read", "write", "edit", "grep"].includes(tool)) {
			if (!locator.path || typeof input.path !== "string") return false;
			const path = resolve(cwd, input.path);
			return path === locator.path && canonicalArtifactPath(path) === path;
		}
		if (!locator.engram) return false;
		if (tool === "mem_get_observation") return input.id === locator.engram.id && Object.keys(input).every(key => key === "id");
		if (tool === "mem_search") return input.project === locator.engram.project && input.query === locator.engram.topic_key && input.all_projects !== true;
		if (tool === "mem_save") return input.project === locator.engram.project && input.topic_key === locator.engram.topic_key;
		return false;
	});
	if (index < 0) throw new Error("Tool arguments outside retained research artifact scope.");
	return index;
}

// Consume actual child tool results, never transported success assertions.
export function researchArtifactReadback(locator: ResearchLocator, tool: string, returned: unknown, afterWrite = false): boolean {
	let bytes: unknown = returned;
	if (tool === "mem_get_observation") {
		const value = record(returned), expected = locator.engram;
		if (!expected || value.id !== expected.id || value.project !== expected.project || value.topic_key !== expected.topic_key
			|| (afterWrite ? !positive(value.revision_count) || Number(value.revision_count) <= expected.revision_count : value.revision_count !== expected.revision_count)) return false;
		bytes = value.content;
	} else if (tool !== "read") return false;
	if (typeof bytes !== "string" || createHash("sha256").update(bytes).digest("hex") !== locator.digest) return false;
	try { return record(JSON.parse(bytes)).revision === locator.revision; } catch { return false; }
}

export const RESEARCH_PERSISTENCE_ENTRY = "gentle-sdd-research-persistence";
export function parseResearchPersistence(value: unknown, scope: ResearchArtifactIntent, cwd: string) {
	const saved = record(value), previous = parseResearchArtifactIntent(saved.scope, cwd);
	parseResearchArtifactIntent(scope, cwd, previous);
	if (saved.version !== 1 || !saved.accepted || typeof saved.accepted !== "object" || Array.isArray(saved.accepted) || !saved.writes || typeof saved.writes !== "object" || Array.isArray(saved.writes)) throw new Error("Invalid research persistence snapshot");
	const accepted = record(saved.accepted) as Record<string, ResearchLocator>, writes = record(saved.writes) as Record<string, ResearchWriteIdentity>;
	const tools = scope.store === "both" ? ["read", "mem_get_observation"] : [scope.store === "openspec" ? "read" : "mem_get_observation"];
	for (const key of new Set([...Object.keys(accepted), ...Object.keys(writes)])) {
		const [index, tool] = key.split(":"), old = previous.locators[Number(index)];
		if (!/^[0-2]:(read|mem_get_observation)$/.test(key) || !old || !tools.includes(tool)) throw new Error("Research persistence key outside scope");
		if (Object.hasOwn(accepted, key)) parseResearchArtifactIntent({ ...previous, locators: [accepted[key]] }, cwd, { ...previous, locators: [old] });
		const desired = writes[key];
		if (Object.hasOwn(writes, key) && (!desired || !positive(desired.revision) || desired.revision <= (accepted[key] ?? old).revision || typeof desired.digest !== "string" || !/^[a-f0-9]{64}$/.test(desired.digest))) throw new Error("Invalid durable desired identity");
	}
	for (const [index, locator] of scope.locators.entries()) {
		const identities = [previous.locators[index], ...tools.map(tool => ({ ...(accepted[`${index}:${tool}`] ?? previous.locators[index]), ...writes[`${index}:${tool}`] }))];
		const advanced = identities.slice(1).filter(item => item.revision > previous.locators[index].revision);
		if (scope.store === "both" && advanced.length === 2 && (advanced[0].revision !== advanced[1].revision || advanced[0].digest !== advanced[1].digest)) throw new Error("Divergent durable hybrid desired identity");
		if (!identities.some(item => item.revision === locator.revision && item.digest === locator.digest && item.engram?.revision_count === locator.engram?.revision_count)) throw new Error("Transported research identity differs from retained operation");
	}
	return structuredClone({ accepted, writes });
}

// Pi may defer custom entries in an in-memory/unflushed session. Verify the
// actual bounded tail, not appendEntry's void return or an in-memory receipt.
export function assertResearchCheckpoint(file: string, expected: unknown): void {
	const fd = openSync(file, "r");
	try {
		const size = fstatSync(fd).size, length = Math.min(size, 65_536), tail = Buffer.alloc(length);
		if (readSync(fd, tail, 0, length, size - length) !== length) throw new Error("Incomplete research checkpoint read");
		const text = tail.toString("utf8");
		if (!text.endsWith("\n")) throw new Error("Research checkpoint append incomplete");
		const last = JSON.parse(text.trimEnd().split("\n").at(-1)!);
		if (last.type !== "custom" || last.customType !== RESEARCH_PERSISTENCE_ENTRY || JSON.stringify(last.data) !== JSON.stringify(expected)) throw new Error("Research checkpoint not durably retained");
	} finally { closeSync(fd); }
}
