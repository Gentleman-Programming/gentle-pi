import type { GentlePiChainStrategy, GentlePiDeliveryStrategy, GentlePiPhase } from "./types.js";
import { GENTLE_PI_CHAIN_STRATEGY, GENTLE_PI_DELIVERY_STRATEGY, GENTLE_PI_ENVELOPE_STATUS } from "./types.js";

export interface GentlePiReadinessSuccess {
	status: "success";
	missingArtifacts: [];
}

export interface GentlePiReadinessBlocked {
	status: "blocked";
	missingArtifacts: string[];
	reason: string;
}

export type GentlePiReadinessResult = GentlePiReadinessSuccess | GentlePiReadinessBlocked;

export interface GentlePiPhaseBundle {
	changeName: string;
	phase: GentlePiPhase;
	isolated: true;
	prompt: string;
	delivery: {
		strategy: GentlePiDeliveryStrategy;
		chainStrategy: GentlePiChainStrategy;
	};
}

export interface ApplyProgressCheckpoint {
	task: string;
	status: string;
	evidence: string;
}

export type GentlePiReviewRisk = "Low" | "Medium" | "High";

const PHASE_REQUIREMENTS: Partial<Record<GentlePiPhase, string[]>> = {
	spec: ["proposal.md"],
	design: ["proposal.md", "specs/"],
	tasks: ["proposal.md", "design.md", "specs/"],
	apply: ["proposal.md", "design.md", "tasks.md", "specs/"],
	verify: ["proposal.md", "design.md", "tasks.md", "apply-progress.md", "specs/"],
	archive: ["verify-report.md"],
};

function hasArtifact(availableArtifacts: readonly string[], required: string): boolean {
	if (required.endsWith("/")) {
		return availableArtifacts.some((artifact) => artifact.startsWith(required));
	}
	return availableArtifacts.includes(required);
}

export function validateGentlePiPhaseReadiness(options: {
	phase: GentlePiPhase;
	availableArtifacts: readonly string[];
}): GentlePiReadinessResult {
	const requirements = PHASE_REQUIREMENTS[options.phase] ?? [];
	const missingArtifacts = requirements.filter((required) => !hasArtifact(options.availableArtifacts, required));
	if (missingArtifacts.length === 0) {
		return { status: GENTLE_PI_ENVELOPE_STATUS.SUCCESS, missingArtifacts: [] };
	}
	return {
		status: GENTLE_PI_ENVELOPE_STATUS.BLOCKED,
		missingArtifacts,
		reason: `missing-artifact:${missingArtifacts.join(",")}`,
	};
}

export function createGentlePiPhaseBundle(options: {
	changeName: string;
	phase: GentlePiPhase;
	standardsPrompt: string;
	artifacts: Record<string, string>;
	deliveryStrategy?: GentlePiDeliveryStrategy;
	chainStrategy?: GentlePiChainStrategy;
}): GentlePiPhaseBundle {
	const artifactSections = Object.entries(options.artifacts)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, content]) => `Artifact: ${name}\n${content}`)
		.join("\n\n");
	const prompt = [
		`Run SDD ${options.phase} phase for change \`${options.changeName}\`.`,
		options.standardsPrompt,
		artifactSections,
	].join("\n\n");
	return {
		changeName: options.changeName,
		phase: options.phase,
		isolated: true,
		prompt,
		delivery: {
			strategy: options.deliveryStrategy ?? GENTLE_PI_DELIVERY_STRATEGY.EXCEPTION_OK,
			chainStrategy: options.chainStrategy ?? GENTLE_PI_CHAIN_STRATEGY.SIZE_EXCEPTION,
		},
	};
}

export function validateGentlePiDeliveryDecision(options: {
	reviewRisk: GentlePiReviewRisk;
	chainedRecommended: boolean;
	deliveryStrategy?: GentlePiDeliveryStrategy;
	chainStrategy?: GentlePiChainStrategy;
}): { status: "success" } | { status: "blocked"; reason: "delivery-decision-required"; risks: string } {
	const strategy = options.deliveryStrategy;
	const chainStrategy = options.chainStrategy;
	const hasResolvedStrategy =
		strategy === GENTLE_PI_DELIVERY_STRATEGY.EXCEPTION_OK ||
		strategy === GENTLE_PI_DELIVERY_STRATEGY.AUTO_CHAIN ||
		(strategy === GENTLE_PI_DELIVERY_STRATEGY.SINGLE_PR && chainStrategy === GENTLE_PI_CHAIN_STRATEGY.SIZE_EXCEPTION);
	if (options.reviewRisk === "High" && options.chainedRecommended && !hasResolvedStrategy) {
		return {
			status: GENTLE_PI_ENVELOPE_STATUS.BLOCKED,
			reason: "delivery-decision-required",
			risks: "High review workload requires an explicit delivery strategy before apply",
		};
	}
	return { status: GENTLE_PI_ENVELOPE_STATUS.SUCCESS };
}

export function validateGentlePiResultEnvelope(
	value: unknown,
):
	| { status: "success"; missingFields: [] }
	| { status: "blocked"; missingFields: string[]; reason: "invalid-result-envelope" } {
	const requiredFields = ["status", "executive_summary", "artifacts", "next_recommended", "risks"] as const;
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const missingFields = requiredFields.filter((field) => {
		const fieldValue = record[field];
		if (field === "artifacts") return !Array.isArray(fieldValue);
		return typeof fieldValue !== "string" || fieldValue.length === 0;
	});
	if (missingFields.length === 0) {
		return { status: GENTLE_PI_ENVELOPE_STATUS.SUCCESS, missingFields: [] };
	}
	return { status: GENTLE_PI_ENVELOPE_STATUS.BLOCKED, missingFields, reason: "invalid-result-envelope" };
}

export function mergeApplyProgress(options: {
	previous: readonly ApplyProgressCheckpoint[];
	next: readonly ApplyProgressCheckpoint[];
}): ApplyProgressCheckpoint[] {
	const order: string[] = [];
	const merged = new Map<string, ApplyProgressCheckpoint>();
	for (const checkpoint of [...options.previous, ...options.next]) {
		if (!merged.has(checkpoint.task)) {
			order.push(checkpoint.task);
		}
		merged.set(checkpoint.task, { ...checkpoint });
	}
	return order
		.map((task) => merged.get(task))
		.filter((checkpoint): checkpoint is ApplyProgressCheckpoint => checkpoint !== undefined);
}
