export const REVIEW_EVENT = {
	PRE_COMMIT: "pre-commit",
	PRE_PUSH: "pre-push",
	PRE_PR: "pre-pr",
	POST_SDD_PHASE: "post-sdd-phase",
	ON_CI: "on-ci",
	ON_SCHEDULE: "on-schedule",
} as const;

export type TriggerEvent = (typeof REVIEW_EVENT)[keyof typeof REVIEW_EVENT];

export const REVIEW_ROUTE = {
	TRIVIAL: "trivial",
	STANDARD: "standard",
	FULL_4R: "full-4R",
} as const;

export type ReviewRoute = (typeof REVIEW_ROUTE)[keyof typeof REVIEW_ROUTE];

export const REVIEW_LENS = {
	RISK: "review-risk",
	RESILIENCE: "review-resilience",
	READABILITY: "review-readability",
	RELIABILITY: "review-reliability",
} as const;

export type ReviewLens = (typeof REVIEW_LENS)[keyof typeof REVIEW_LENS];

export const TRIVIALITY = {
	PROVEN: "proven-trivial",
	UNPROVEN: "unproven",
	NON_TRIVIAL: "non-trivial",
} as const;

export type Triviality = (typeof TRIVIALITY)[keyof typeof TRIVIALITY];

export const EVENT_CEILING = {
	STANDARD: REVIEW_ROUTE.STANDARD,
	FULL_4R: REVIEW_ROUTE.FULL_4R,
} as const;

export type EventCeiling = (typeof EVENT_CEILING)[keyof typeof EVENT_CEILING];

export const LARGE_CHANGED_LINE_THRESHOLD = 400;

export const FULL_4R_LENSES: readonly ReviewLens[] = Object.freeze([
	REVIEW_LENS.RISK,
	REVIEW_LENS.RESILIENCE,
	REVIEW_LENS.READABILITY,
	REVIEW_LENS.RELIABILITY,
]);

export interface ChangedDiff {
	changedPaths: string[];
	changedLines: number;
}

export interface DiffEvidence {
	event: TriggerEvent;
	changedLines: number;
	triviality: Triviality;
	evidenceComplete: boolean;
	executableChanged: boolean;
	configurationChanged: boolean;
	hotPathChanged: boolean;
	riskSignal: boolean;
	resilienceSignal: boolean;
	reliabilitySignal: boolean;
}

export interface ReviewPlan {
	route: ReviewRoute;
	lenses: readonly ReviewLens[];
	reason: string;
}

const DOCUMENTATION_PATH = /(?:^|\/)(?:readme|changelog|contributing|license)(?:\.(?:md|mdx|rst|adoc|txt))?$|(?:^|\/)(?:docs?|documentation)\/.+\.(?:md|mdx|rst|adoc|txt)$/i;
const CONFIGURATION_PATH = /(?:^|\/)(?:requirements(?:-[^/]*)?\.txt|cmakelists\.txt|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]*)?\.json|dockerfile|makefile|\.env(?:\.[^/]*)?|[^/]+\.(?:jsonc?|ya?ml|toml|ini|conf|config|lock))$/i;
const SENSITIVE_CONFIGURATION_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|(?:env(?:ironment)?|credentials?|secrets?|tokens?|permissions?|polic(?:y|ies)|security)\.(?:jsonc?|ya?ml|toml|ini|conf|config))$/i;
const PACKAGE_RUNTIME_MARKDOWN_PATH = /(?:^|\/)(?:assets\/agents\/[^/]+\.md|skills\/[^/]+\/skill\.md)$/i;
const HOT_PATH = /(?:^|\/)(?:auth|update|security|payments)(?:\/|$)/i;
const RISK_PATH = /(?:^|\/)(?:auth|security|payments|permissions?|secrets?|credentials?|tokens?|polic(?:y|ies))(?:\/|$)|(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/i;
const RESILIENCE_PATH = /(?:^|\/)(?:update|deploy|deployment|infra|infrastructure|ops|migrations?|rollback|recovery)(?:\/|$)/i;
const RELIABILITY_PATH = /(?:^|\/)(?:tests?|specs?|runtime|api)(?:\/|$)|(?:\.test|\.spec)\.[^/]+$/i;

function pathMatchesAny(paths: readonly string[], pattern: RegExp): boolean {
	return paths.some((path) => pattern.test(path));
}

function isDocumentationPath(path: string): boolean {
	return DOCUMENTATION_PATH.test(path) &&
		!isConfigurationPath(path) &&
		!PACKAGE_RUNTIME_MARKDOWN_PATH.test(path);
}

function isConfigurationPath(path: string): boolean {
	return CONFIGURATION_PATH.test(path);
}

function eventCeiling(event: TriggerEvent): EventCeiling {
	return event === REVIEW_EVENT.PRE_COMMIT || event === REVIEW_EVENT.PRE_PUSH
		? EVENT_CEILING.STANDARD
		: EVENT_CEILING.FULL_4R;
}

function dominantLens(evidence: DiffEvidence): ReviewLens {
	if (evidence.riskSignal) return REVIEW_LENS.RISK;
	if (evidence.resilienceSignal) return REVIEW_LENS.RESILIENCE;
	if (evidence.reliabilitySignal) return REVIEW_LENS.RELIABILITY;
	return REVIEW_LENS.READABILITY;
}

export function buildDiffEvidence(
	event: TriggerEvent,
	diff: ChangedDiff,
	evidenceComplete = true,
): DiffEvidence {
	const configurationChanged = pathMatchesAny(diff.changedPaths, CONFIGURATION_PATH);
	const executableChanged = diff.changedPaths.some(
		(path) => !isDocumentationPath(path) && !isConfigurationPath(path),
	);
	const documentationOnly =
		diff.changedPaths.length > 0 && diff.changedPaths.every(isDocumentationPath);

	return {
		event,
		changedLines: diff.changedLines,
		triviality:
			evidenceComplete && documentationOnly && !configurationChanged && !executableChanged
				? TRIVIALITY.PROVEN
				: TRIVIALITY.UNPROVEN,
		evidenceComplete,
		executableChanged,
		configurationChanged,
		hotPathChanged: pathMatchesAny(diff.changedPaths, HOT_PATH),
		riskSignal:
			pathMatchesAny(diff.changedPaths, RISK_PATH) ||
			pathMatchesAny(diff.changedPaths, SENSITIVE_CONFIGURATION_PATH),
		resilienceSignal: pathMatchesAny(diff.changedPaths, RESILIENCE_PATH),
		reliabilitySignal: pathMatchesAny(diff.changedPaths, RELIABILITY_PATH),
	};
}

export function classifyReviewRoute(evidence: DiffEvidence): ReviewPlan {
	const objectivelyTrivial =
		evidence.evidenceComplete &&
		evidence.triviality === TRIVIALITY.PROVEN &&
		!evidence.executableChanged &&
		!evidence.configurationChanged;

	if (objectivelyTrivial) {
		return {
			route: REVIEW_ROUTE.TRIVIAL,
			lenses: [],
			reason: "objective triviality proven for every changed path",
		};
	}

	const requestsFull4R =
		evidence.hotPathChanged ||
		evidence.changedLines > LARGE_CHANGED_LINE_THRESHOLD;
	if (requestsFull4R && eventCeiling(evidence.event) === EVENT_CEILING.FULL_4R) {
		return {
			route: REVIEW_ROUTE.FULL_4R,
			lenses: FULL_4R_LENSES,
			reason: evidence.hotPathChanged
				? "non-trivial hot-path diff requires full 4R"
				: `diff exceeds ${LARGE_CHANGED_LINE_THRESHOLD} changed lines`,
		};
	}

	return {
		route: REVIEW_ROUTE.STANDARD,
		lenses: [dominantLens(evidence)],
		reason: requestsFull4R
			? `${evidence.event} is capped at one standard lens`
			: "non-trivial or unproven diff uses one dominant-risk lens",
	};
}
