import { extname } from "node:path";
import type { ReviewLens } from "./review-triggers.ts";
import { FULL_4R_LENSES, REVIEW_LENS } from "./review-triggers.ts";

export const REVIEW_RISK_TIER = {
	LOW: "low",
	MEDIUM: "medium",
	HIGH: "high",
} as const;

export type ReviewRiskTier =
	(typeof REVIEW_RISK_TIER)[keyof typeof REVIEW_RISK_TIER];

export const MAX_CORRECTION_CHANGED_LINES = 200;
export const LARGE_AUTHORED_CHANGE_LINES = 400;

export interface ReviewDiffStat {
	path: string;
	additions: number;
	deletions: number;
	binary: boolean;
	mode_only: boolean;
}

export interface ReviewRiskClassification {
	tier: ReviewRiskTier;
	original_changed_lines: number;
	correction_budget: number;
	selected_lenses: readonly ReviewLens[];
}

// This deliberately excludes only generated adapter goldens. Ordinary tests,
// fixtures, snapshots, and files merely containing "golden" remain authored.
export const GENERATED_GOLDEN_PATH = /^testdata\/golden(?:\/|$)/;

const DOCUMENTATION_PATH = /(?:^|\/)(?:readme|changelog|contributing|license)(?:\.(?:md|mdx|rst|adoc|txt))?$|(?:^|\/)(?:docs?|documentation)\/.+\.(?:md|mdx|rst|adoc|txt)$/i;
const CONFIGURATION_PATH = /(?:^|\/)(?:requirements(?:-[^/]*)?\.txt|cmakelists\.txt|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]*)?\.json|dockerfile|makefile|\.env(?:\.[^/]*)?|[^/]+\.(?:jsonc?|ya?ml|toml|ini|conf|config|lock))$/i;
const HIGH_RISK_TOKEN = /^(?:auth|authentication|authorization|update|updater|security|payments?|permissions?|shell|process|processes|secrets?|credentials?|tokens?)$/i;
const HIGH_RISK_PHRASE = /(?:data[-_/ ]?(?:exposure|loss)|privilege[-_/ ]?escalation)/i;
const RELIABILITY_PATH = /(?:^|\/)(?:tests?|specs?|runtime|api)(?:\/|$)|(?:\.test|\.spec)\.[^/]+$/i;
const RESILIENCE_PATH = /(?:^|\/)(?:update|deploy|deployment|infra|infrastructure|ops|migrations?|rollback|recovery)(?:\/|$)/i;

function assertCanonicalPath(path: string): void {
	if (
		path.length === 0 ||
		path.startsWith("/") ||
		path.includes("\\") ||
		path.split("/").some((part) => part === "" || part === "." || part === "..")
	) {
		throw new Error(`Review diff path is not canonical: ${path}`);
	}
}

export function isGeneratedGoldenPath(path: string): boolean {
	assertCanonicalPath(path);
	return GENERATED_GOLDEN_PATH.test(path);
}

export function countAuthoredChangedLines(
	stats: readonly ReviewDiffStat[],
): number {
	const seen = new Set<string>();
	let total = 0;
	for (const stat of stats) {
		assertCanonicalPath(stat.path);
		if (seen.has(stat.path)) throw new Error(`Duplicate review diff path: ${stat.path}`);
		seen.add(stat.path);
		if (
			!Number.isSafeInteger(stat.additions) ||
			!Number.isSafeInteger(stat.deletions) ||
			stat.additions < 0 ||
			stat.deletions < 0
		) {
			throw new Error(`Review diff stat is invalid for ${stat.path}`);
		}
		if (isGeneratedGoldenPath(stat.path) || stat.binary || stat.mode_only) continue;
		total += stat.additions + stat.deletions;
	}
	return total;
}

export function correctionBudget(originalChangedLines: number): number {
	if (!Number.isSafeInteger(originalChangedLines) || originalChangedLines < 0) {
		throw new Error("Original changed lines must be a non-negative integer");
	}
	return Math.min(
		MAX_CORRECTION_CHANGED_LINES,
		Math.ceil(originalChangedLines / 2),
	);
}

function pathTokens(path: string): string[] {
	return path.toLowerCase().split(/[\/._-]+/).filter(Boolean);
}

function isHighRiskPath(path: string): boolean {
	return HIGH_RISK_PHRASE.test(path) || pathTokens(path).some((token) => HIGH_RISK_TOKEN.test(token));
}

function dominantLens(paths: readonly string[]): ReviewLens {
	if (paths.some(isHighRiskPath)) return REVIEW_LENS.RISK;
	if (paths.some((path) => RESILIENCE_PATH.test(path))) return REVIEW_LENS.RESILIENCE;
	if (paths.some((path) => RELIABILITY_PATH.test(path))) return REVIEW_LENS.RELIABILITY;
	return REVIEW_LENS.READABILITY;
}

function isDocumentationPath(path: string): boolean {
	if (DOCUMENTATION_PATH.test(path)) return true;
	return [".md", ".mdx", ".rst", ".adoc"].includes(extname(path).toLowerCase());
}

export function classifyReviewRisk(
	stats: readonly ReviewDiffStat[],
): ReviewRiskClassification {
	const originalChangedLines = countAuthoredChangedLines(stats);
	const candidateStats = stats.filter((stat) => !isGeneratedGoldenPath(stat.path));
	const candidatePaths = candidateStats
		.map((stat) => stat.path);
	const hasOpaqueCandidate = candidateStats.some((stat) => stat.binary || stat.mode_only);
	const high =
		originalChangedLines > LARGE_AUTHORED_CHANGE_LINES ||
		candidatePaths.some(isHighRiskPath);
	const low =
		!high &&
		!hasOpaqueCandidate &&
		!candidatePaths.some((path) => CONFIGURATION_PATH.test(path)) &&
		candidatePaths.every(isDocumentationPath);
	const tier = high
		? REVIEW_RISK_TIER.HIGH
		: low
			? REVIEW_RISK_TIER.LOW
			: REVIEW_RISK_TIER.MEDIUM;
	const selectedLenses = tier === REVIEW_RISK_TIER.LOW
		? []
		: tier === REVIEW_RISK_TIER.HIGH
			? [...FULL_4R_LENSES]
			: [dominantLens(candidatePaths)];
	return {
		tier,
		original_changed_lines: originalChangedLines,
		correction_budget: correctionBudget(originalChangedLines),
		selected_lenses: Object.freeze(selectedLenses),
	};
}
