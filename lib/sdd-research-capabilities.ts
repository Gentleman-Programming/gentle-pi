import type { AgentDefinition } from "./agents-config.ts";

// Exact registered Pi names, not provider display namespaces. MCP's generic
// `mcp` and dynamic `mcp__context7` gateways are deliberately NOT grants: an
// active gateway does not prove which remote methods it can safely expose.
export const RESEARCH_TOOLS = ["fetch_content", "web_search", "source_check", "get_search_content"] as const;
export const RESEARCH_CHILD_TOOLS_ENV = "GENTLE_PI_RESEARCH_TOOLS";
type Inventory = {
	getActiveTools?: () => string[];
	getAllTools?: () => Array<{ name: string; sourceInfo?: { source?: string } }>;
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

export function researchAgent(agent: AgentDefinition, pi: Inventory): { agent: AgentDefinition; capabilities: ResearchCapabilities } {
	const capabilities = resolveResearchCapabilities(pi, agent.tools);
	const available = new Set(Object.values(capabilities).flatMap(value => value.tools));
	const local = new Set(["read", "grep", "find", "edit", "write", "mem_search", "mem_get_observation", "mem_save"]);
	const tools = agent.tools.filter(name => local.has(name) || available.has(name));
	return { agent: { ...agent, tools, instructions: `${agent.instructions}\n\n${renderResearchCapabilities(capabilities)}` }, capabilities };
}
