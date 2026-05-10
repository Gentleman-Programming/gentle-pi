import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { EngramBridgeConfigEvidence, EngramOperation } from "./engram-bridge.js";

export const GENTLE_PI_PHASE = {
	EXPLORE: "explore",
	PROPOSAL: "proposal",
	SPEC: "spec",
	DESIGN: "design",
	TASKS: "tasks",
	APPLY: "apply",
	VERIFY: "verify",
	ARCHIVE: "archive",
} as const;

export type GentlePiPhase = (typeof GENTLE_PI_PHASE)[keyof typeof GENTLE_PI_PHASE];

export const GENTLE_PI_ENVELOPE_STATUS = {
	SUCCESS: "success",
	PARTIAL: "partial",
	BLOCKED: "blocked",
} as const;

export type GentlePiEnvelopeStatus = (typeof GENTLE_PI_ENVELOPE_STATUS)[keyof typeof GENTLE_PI_ENVELOPE_STATUS];

export const GENTLE_PI_DELIVERY_STRATEGY = {
	ASK_ON_RISK: "ask-on-risk",
	AUTO_CHAIN: "auto-chain",
	SINGLE_PR: "single-pr",
	EXCEPTION_OK: "exception-ok",
} as const;

export type GentlePiDeliveryStrategy = (typeof GENTLE_PI_DELIVERY_STRATEGY)[keyof typeof GENTLE_PI_DELIVERY_STRATEGY];

export const GENTLE_PI_CHAIN_STRATEGY = {
	STACKED_TO_MAIN: "stacked-to-main",
	FEATURE_BRANCH_CHAIN: "feature-branch-chain",
	SIZE_EXCEPTION: "size-exception",
	PENDING: "pending",
} as const;

export type GentlePiChainStrategy = (typeof GENTLE_PI_CHAIN_STRATEGY)[keyof typeof GENTLE_PI_CHAIN_STRATEGY];

export interface GentlePiResultEnvelope {
	status: GentlePiEnvelopeStatus;
	executive_summary: string;
	artifacts: string[];
	next_recommended: string;
	risks: string;
}

export const GENTLE_PI_COMMAND_ACTION = {
	ALLOW: "allow",
	DENY: "deny",
	CONFIRM: "confirm",
} as const;

export type GentlePiCommandAction = (typeof GENTLE_PI_COMMAND_ACTION)[keyof typeof GENTLE_PI_COMMAND_ACTION];

export interface GentlePiCommandDecision {
	action: GentlePiCommandAction;
	reason: string;
	checkpoint: boolean;
}

export interface GentlePiPhaseBlocker extends GentlePiResultEnvelope {
	status: "blocked";
	reason: string;
	missing: string[];
}

export interface GentlePiRoute {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
}

export type GentlePiRouteTable = Partial<Record<GentlePiPhase, GentlePiRoute>>;

export const GENTLE_PI_MEMORY_STATUS = {
	AVAILABLE: "available",
	CONFIGURED: "configured",
	UNREACHABLE: "unreachable",
	UNAVAILABLE: "unavailable",
	UNKNOWN: "unknown",
} as const;

export type GentlePiMemoryStatus = (typeof GENTLE_PI_MEMORY_STATUS)[keyof typeof GENTLE_PI_MEMORY_STATUS];

export const GENTLE_PI_MEMORY_FALLBACK = {
	SESSION_ONLY: "session-only",
	OPENSPEC_ARTIFACTS: "openspec-artifacts",
} as const;

export type GentlePiMemoryFallback = (typeof GENTLE_PI_MEMORY_FALLBACK)[keyof typeof GENTLE_PI_MEMORY_FALLBACK];

export interface GentlePiMemoryCapability {
	provider: "engram";
	status: GentlePiMemoryStatus;
	evidence: string[];
	callableTools: string[];
	configEvidence?: EngramBridgeConfigEvidence[];
	canonicalOperations?: EngramOperation[];
	fallback: GentlePiMemoryFallback;
}

export interface GentlePiMemoryDetectionInput {
	activeToolNames?: readonly string[];
	configuredSignals?: readonly string[];
	configFiles?: readonly string[];
	configEvidence?: readonly EngramBridgeConfigEvidence[];
	packageNames?: readonly string[];
}

export interface GentlePiIdentityProfile {
	name: "Gentle Pi";
	description: string;
	persona: string[];
	selfDescription: string[];
}

export interface GentlePiPackageRecommendation {
	name: string;
	version: string;
	role: string;
	runtimeDefault: boolean;
}

export interface GentlePiIdentityPromptInput {
	capability: GentlePiMemoryCapability;
}

export interface GentlePiIdentityMemoryServices {
	detectMemoryCapability: (input?: GentlePiMemoryDetectionInput) => GentlePiMemoryCapability;
	renderPrompt: (input?: GentlePiMemoryDetectionInput) => string;
	packageRecommendations: GentlePiPackageRecommendation[];
	profile: GentlePiIdentityProfile;
}

export interface GentlePiServices {
	enabled: boolean;
	phase?: GentlePiPhase;
	changeName?: string;
	projectRoot?: string;
	identityMemory?: GentlePiIdentityMemoryServices;
	standardsPrompt?: string;
	routes?: GentlePiRouteTable;
	commandPolicy?: (context: { command: string; phase?: GentlePiPhase }) => GentlePiCommandDecision;
	checkpointHook?: (context: {
		command: string;
		cwd: string;
		decision: GentlePiCommandDecision;
	}) => void | Promise<void>;
}
