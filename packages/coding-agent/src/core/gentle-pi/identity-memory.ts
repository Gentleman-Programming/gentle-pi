import {
	deriveEngramBridgeState,
	detectEngramBridgeConfigEvidence,
	type EngramBridgeConfigEvidence,
} from "./engram-bridge.js";
import {
	GENTLE_PI_MEMORY_FALLBACK,
	GENTLE_PI_MEMORY_STATUS,
	type GentlePiIdentityMemoryServices,
	type GentlePiIdentityProfile,
	type GentlePiIdentityPromptInput,
	type GentlePiMemoryCapability,
	type GentlePiMemoryDetectionInput,
	type GentlePiPackageRecommendation,
} from "./types.js";

export const GENTLE_PI_IDENTITY_PROFILE: GentlePiIdentityProfile = {
	name: "Gentle Pi",
	description: "Gentle Pi is a Pi-specific coding-agent harness for controlled SDD/OpenSpec work.",
	persona: [
		"Be direct, technical, and concise.",
		"When the user writes Spanish, answer in natural Rioplatense Spanish with voseo.",
		"Act as a senior architect and teacher: concepts before code, no shortcuts.",
		"Treat AI as a tool directed by the human; never present yourself as a default chatbot.",
	],
	selfDescription: [
		"When asked who or what you are, answer that you are Gentle Pi: a Pi-specific coding-agent harness with senior architect persona and runtime-detected memory capabilities.",
		"Describe yourself as Gentle Pi, a Pi-specific coding-agent harness.",
		"Mention SDD/OpenSpec phase artifacts, subagents, and memory only when truthful for the current runtime.",
		"Do not claim portability outside the Pi-specific runtime.",
	],
};

export const GENTLE_PI_PACKAGE_RECOMMENDATIONS: GentlePiPackageRecommendation[] = [
	{
		name: "pi-subagents",
		version: "0.24.0",
		role: "Native project agents/chains for SDD phase execution.",
		runtimeDefault: true,
	},
	{
		name: "pi-intercom",
		version: "0.6.0",
		role: "Optional supervisor handoff/progress companion for blocked decisions.",
		runtimeDefault: false,
	},
	{
		name: "pi-mcp-adapter",
		version: "2.5.4",
		role: "Optional direct MCP bridge when exposing Engram or other MCP tools through Pi.",
		runtimeDefault: false,
	},
];

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function collectConfiguredEvidence(input: GentlePiMemoryDetectionInput): string[] {
	const evidence: string[] = [];
	for (const item of input.configEvidence ?? []) {
		evidence.push(formatConfigEvidence(item));
	}
	for (const signal of input.configuredSignals ?? []) {
		if (signal.toLowerCase().includes("engram")) {
			evidence.push(signal);
		}
	}
	for (const filePath of input.configFiles ?? []) {
		if (filePath.toLowerCase().includes("engram")) {
			evidence.push(`config file: ${filePath}`);
		}
	}
	for (const packageName of input.packageNames ?? []) {
		if (packageName.toLowerCase().includes("engram")) {
			evidence.push(`package: ${packageName}`);
		}
	}
	return uniqueSorted(evidence);
}

function formatConfigEvidence(evidence: EngramBridgeConfigEvidence): string {
	return `config file: ${evidence.sourcePath} (server: ${evidence.serverName}, transport: ${evidence.transport})`;
}

export function detectGentlePiMemoryCapability(input: GentlePiMemoryDetectionInput = {}): GentlePiMemoryCapability {
	const configuredEvidence = collectConfiguredEvidence(input);
	const bridgeState = deriveEngramBridgeState({
		...input,
		configuredSignals: [...(input.configuredSignals ?? []), ...configuredEvidence],
	});
	const callableTools = bridgeState.callableTools;
	const callableEvidence = callableTools.map((toolName) => `callable tool: ${toolName}`);
	const evidence = uniqueSorted([...callableEvidence, ...configuredEvidence]);

	if (bridgeState.status === GENTLE_PI_MEMORY_STATUS.AVAILABLE) {
		return {
			provider: "engram",
			status: GENTLE_PI_MEMORY_STATUS.AVAILABLE,
			evidence,
			callableTools,
			configEvidence: bridgeState.configEvidence,
			canonicalOperations: bridgeState.canonicalOperations,
			fallback: GENTLE_PI_MEMORY_FALLBACK.OPENSPEC_ARTIFACTS,
		};
	}

	if (bridgeState.status === GENTLE_PI_MEMORY_STATUS.CONFIGURED) {
		return {
			provider: "engram",
			status: GENTLE_PI_MEMORY_STATUS.CONFIGURED,
			evidence: configuredEvidence,
			callableTools: [],
			configEvidence: bridgeState.configEvidence,
			canonicalOperations: bridgeState.canonicalOperations,
			fallback: GENTLE_PI_MEMORY_FALLBACK.OPENSPEC_ARTIFACTS,
		};
	}

	if (bridgeState.status === GENTLE_PI_MEMORY_STATUS.UNREACHABLE) {
		return {
			provider: "engram",
			status: GENTLE_PI_MEMORY_STATUS.UNREACHABLE,
			evidence: configuredEvidence,
			callableTools: [],
			configEvidence: bridgeState.configEvidence,
			canonicalOperations: bridgeState.canonicalOperations,
			fallback: GENTLE_PI_MEMORY_FALLBACK.OPENSPEC_ARTIFACTS,
		};
	}

	return {
		provider: "engram",
		status: bridgeState.status,
		evidence:
			bridgeState.status === GENTLE_PI_MEMORY_STATUS.UNAVAILABLE
				? ["active tools inspected; no Engram callable tools found"]
				: [],
		callableTools: [],
		configEvidence: bridgeState.configEvidence,
		canonicalOperations: bridgeState.canonicalOperations,
		fallback:
			bridgeState.status === GENTLE_PI_MEMORY_STATUS.UNAVAILABLE
				? GENTLE_PI_MEMORY_FALLBACK.OPENSPEC_ARTIFACTS
				: GENTLE_PI_MEMORY_FALLBACK.SESSION_ONLY,
	};
}

function renderMemoryProtocol(capability: GentlePiMemoryCapability): string {
	if (capability.status === GENTLE_PI_MEMORY_STATUS.AVAILABLE) {
		return [
			"Engram persistence is available from detected callable tools.",
			"Use the Engram-first memory harness for recall/search and durable saves when those callable tools exist.",
			`Evidence: ${capability.evidence.join("; ")}.`,
			"When the user asks to remember, recall, or discuss past work, recall/search Engram first.",
			"Save to Engram after decisions, bug fixes, and non-obvious discoveries; do not save noisy routine steps.",
		].join("\n");
	}

	if (capability.status === GENTLE_PI_MEMORY_STATUS.CONFIGURED) {
		return [
			"Engram configuration signals are detected, but the active tool surface has not been inspected yet.",
			`Evidence: ${capability.evidence.join("; ")}.`,
			"Do not claim usable persistent memory. Use session context and OpenSpec artifacts as degraded memory until callable tools exist.",
		].join("\n");
	}

	if (capability.status === GENTLE_PI_MEMORY_STATUS.UNREACHABLE) {
		return [
			"Engram is configured, but required callable Engram tools are unreachable in the active tool surface.",
			`Evidence: ${capability.evidence.join("; ")}.`,
			"Do not claim usable persistent memory or successful long-term writes. Use session context and OpenSpec artifacts as degraded memory until callable tools exist.",
		].join("\n");
	}

	if (capability.status === GENTLE_PI_MEMORY_STATUS.UNAVAILABLE) {
		return [
			"Engram is not available in the active tool surface.",
			"Operate in degraded memory mode using session context and OpenSpec artifacts; never fabricate Engram access.",
		].join("\n");
	}

	return [
		"Engram availability is unknown because no active tool surface has been inspected yet.",
		"State uncertainty truthfully and use session context as degraded memory until capability evidence exists.",
	].join("\n");
}

export function renderGentlePiIdentityPrompt(input: GentlePiIdentityPromptInput): string {
	const profile = GENTLE_PI_IDENTITY_PROFILE;
	return [
		"## Gentle Pi Identity and Memory",
		profile.description,
		"",
		"Persona:",
		...profile.persona.map((line) => `- ${line}`),
		"",
		"Self-description:",
		...profile.selfDescription.map((line) => `- ${line}`),
		"- You know about Gentle Pi harnesses, SDD/OpenSpec artifacts, pi-subagents, and Engram memory only to the extent detected at runtime.",
		"",
		"Memory protocol:",
		renderMemoryProtocol(input.capability),
		"",
		"Package notes:",
		"- pi-subagents is the installed/default SDD delegation package for project-local agents and chains.",
		"- pi-intercom and pi-mcp-adapter are companion recommendations for supervisor decisions and MCP tool exposure; they are not memory replacements.",
		"- Do not claim Pi memory extensions replace Engram unless a later explicit user decision exists.",
	].join("\n");
}

export function detectGentlePiMemoryConfigSignals(projectRoot: string, agentDir = projectRoot): string[] {
	const evidence = detectEngramBridgeConfigEvidence({ projectRoot, agentDir }).map((item) => item.sourcePath);
	if (process.env.ENGRAM_PROJECT || process.env.ENGRAM_DB || process.env.ENGRAM_MCP_URL) {
		evidence.push("environment: ENGRAM_* variable");
	}
	return uniqueSorted(evidence);
}

export function createGentlePiIdentityMemoryServices(
	baseInput: GentlePiMemoryDetectionInput = {},
): GentlePiIdentityMemoryServices {
	const detectMemoryCapability = (input: GentlePiMemoryDetectionInput = {}): GentlePiMemoryCapability =>
		detectGentlePiMemoryCapability({
			...baseInput,
			...input,
			configuredSignals: [...(baseInput.configuredSignals ?? []), ...(input.configuredSignals ?? [])],
			configFiles: [...(baseInput.configFiles ?? []), ...(input.configFiles ?? [])],
			configEvidence: [...(baseInput.configEvidence ?? []), ...(input.configEvidence ?? [])],
			packageNames: [...(baseInput.packageNames ?? []), ...(input.packageNames ?? [])],
		});

	return {
		detectMemoryCapability,
		renderPrompt: (input) => renderGentlePiIdentityPrompt({ capability: detectMemoryCapability(input) }),
		packageRecommendations: GENTLE_PI_PACKAGE_RECOMMENDATIONS,
		profile: GENTLE_PI_IDENTITY_PROFILE,
	};
}
