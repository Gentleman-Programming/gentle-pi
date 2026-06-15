/**
 * review-triggers.ts
 *
 * Pure trigger logic for the 4R review gate system. No I/O, fully unit-testable.
 * Ported 1:1 from gentle-ai/internal/catalog/triggers.go and
 * gentle-ai/internal/model/trigger.go.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerEvent =
	| "pre-commit"
	| "pre-push"
	| "pre-pr"
	| "post-sdd-phase"
	| "on-ci"
	| "on-schedule";

export type TriggerMode = "advisory" | "strong";

export interface TriggerWhen {
	always?: boolean;
	pathGlobs?: string[];
	minDiffLines?: number;
	phases?: string[];
	combine?: "" | "or" | "and";
}

export interface TriggerBinding {
	on: TriggerEvent;
	when: TriggerWhen;
	run: string[];
	mode: TriggerMode;
	reason: string;
}

export interface TriggerRuleSet {
	bindings: TriggerBinding[];
}

export interface ChangedDiff {
	changedPaths: string[];
	changedLines: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum number of changed lines in a diff that triggers the full 4R review
 * fan-out on pre-pr events. Mirrors defaultLargeChangedLineThreshold in triggers.go.
 */
export const LARGE_CHANGED_LINE_THRESHOLD = 400;

/**
 * Closed set of recognized agent identifiers.
 * Mirrors knownAgentList in triggers.go.
 */
export const KNOWN_AGENTS: readonly string[] = [
	// 4R review lenses
	"review-risk",
	"review-readability",
	"review-reliability",
	"review-resilience",
	// Adversarial verification
	"judgment-day",
	// SDD phase identifiers
	"sdd-explore",
	"sdd-propose",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-archive",
];

// ---------------------------------------------------------------------------
// Supported events (mirrors defaultRuleSet.Events in triggers.go)
// ---------------------------------------------------------------------------

const SUPPORTED_EVENTS: ReadonlySet<TriggerEvent> = new Set([
	"pre-commit",
	"pre-push",
	"pre-pr",
	"post-sdd-phase",
	"on-ci",
	"on-schedule",
]);

// ---------------------------------------------------------------------------
// Valid SDD phase identifiers for the When.phases field.
// Mirrors validSDDPhases in ValidateTriggerRuleSet.
// ---------------------------------------------------------------------------

const VALID_SDD_PHASES: ReadonlySet<string> = new Set([
	"sdd-explore",
	"sdd-propose",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-archive",
	// Short names used in post-sdd-phase conditions.
	"explore",
	"propose",
	"spec",
	"design",
	"tasks",
	"apply",
	"verify",
	"archive",
]);

// ---------------------------------------------------------------------------
// DEFAULT_RULE_SET
// Ported 1:1 from triggers.go defaultRuleSet.Bindings
// ---------------------------------------------------------------------------

export const DEFAULT_RULE_SET: TriggerRuleSet = {
	bindings: [
		{
			on: "pre-commit",
			when: { always: true },
			run: ["review-readability"],
			mode: "advisory",
			reason:
				"everyday event → ONE cheap advisory lens (~1x); full 4R fan-out reserved for pre-pr",
		},
		{
			on: "pre-push",
			when: { always: true },
			run: ["review-readability"],
			mode: "advisory",
			reason:
				"everyday event → ONE cheap advisory lens (~1x); 4R fan-out reserved for pre-pr on hot paths / large diffs",
		},
		{
			on: "pre-pr",
			when: {
				pathGlobs: ["**/auth/**", "**/update/**", "**/security/**", "**/payments/**"],
				minDiffLines: LARGE_CHANGED_LINE_THRESHOLD,
				combine: "or",
			},
			run: ["review-risk", "review-resilience", "review-readability", "review-reliability"],
			mode: "strong",
			reason:
				"full 4R fan-out (~4x) only on hot paths (auth/update/security/payments) or diffs exceeding 400 changed lines",
		},
		{
			on: "post-sdd-phase",
			when: { phases: ["design", "apply"] },
			run: ["judgment-day"],
			mode: "strong",
			reason:
				"adversarial verification (~4 + 3*findings cost) only at high-stakes SDD phases (design and apply)",
		},
	],
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Reports whether run contains all four 4R review agents.
 * Mirrors has4RFanOut in triggers.go.
 */
function has4RFanOut(run: readonly string[]): boolean {
	const found = new Set(run);
	return (
		found.has("review-risk") &&
		found.has("review-readability") &&
		found.has("review-reliability") &&
		found.has("review-resilience")
	);
}

/**
 * Validates each binding in set against the closed vocabularies.
 * Throws a descriptive Error on the first violation.
 * Mirrors ValidateTriggerRuleSet in triggers.go.
 */
export function validateTriggerRuleSet(set: TriggerRuleSet): void {
	const knownAgentsSet = new Set(KNOWN_AGENTS);
	const validCombine: ReadonlySet<string> = new Set(["", "or", "and"]);

	for (let i = 0; i < set.bindings.length; i++) {
		const b = set.bindings[i];

		// Validate On.
		if (!SUPPORTED_EVENTS.has(b.on)) {
			throw new Error(`binding[${i}]: unknown event "${b.on}"`);
		}

		// Validate Run.
		if (!b.run || b.run.length === 0) {
			throw new Error(`binding[${i}]: Run must not be empty`);
		}
		for (const agent of b.run) {
			if (!knownAgentsSet.has(agent)) {
				throw new Error(`binding[${i}]: unknown run agent "${agent}"`);
			}
		}

		// Validate Mode.
		if (b.mode !== "advisory" && b.mode !== "strong") {
			throw new Error(`binding[${i}]: unknown mode "${b.mode}"`);
		}

		// Validate When vocabulary.
		const w = b.when;

		// MinDiffLines when non-zero must be positive (> 0). Zero is unset/unused; negative rejected.
		// Check this BEFORE the "at least one condition" check so negative values get the right error.
		if (w.minDiffLines !== undefined && w.minDiffLines < 0) {
			throw new Error(`binding[${i}]: When.MinDiffLines must be a positive integer (> 0)`);
		}

		// PathGlobs non-nil but empty is invalid.
		if (w.pathGlobs !== undefined && w.pathGlobs.length === 0) {
			throw new Error(`binding[${i}]: When.pathGlobs must not be an empty slice`);
		}

		// Must have at least one condition set.
		const hasCondition =
			w.always === true ||
			(w.pathGlobs !== undefined && w.pathGlobs.length > 0) ||
			(w.minDiffLines !== undefined && w.minDiffLines > 0) ||
			(w.phases !== undefined && w.phases.length > 0);
		if (!hasCondition) {
			throw new Error(
				`binding[${i}]: When must have at least one condition (always, pathGlobs, minDiffLines, or phases)`,
			);
		}

		// Combine must be a recognized value.
		const combineVal: string = w.combine ?? "";
		if (!validCombine.has(combineVal)) {
			throw new Error(
				`binding[${i}]: When.combine "${combineVal}" is not in {"" "or" "and"}`,
			);
		}

		// Phases must be recognized SDD phase identifiers.
		if (w.phases) {
			for (const p of w.phases) {
				if (!VALID_SDD_PHASES.has(p)) {
					throw new Error(
						`binding[${i}]: When.phases entry "${p}" is not a recognized SDD phase identifier`,
					);
				}
			}
		}

		// Phases is only valid for post-sdd-phase event.
		if (w.phases && w.phases.length > 0 && b.on !== "post-sdd-phase") {
			throw new Error(
				`binding[${i}]: When.phases may only be used with the post-sdd-phase event (got "${b.on}")`,
			);
		}

		// Spec G prohibition: full 4R fan-out on everyday event with always=true is PROHIBITED.
		if ((b.on === "pre-commit" || b.on === "pre-push") && w.always === true) {
			if (has4RFanOut(b.run)) {
				throw new Error(
					`binding[${i}]: full 4R fan-out (review-risk, review-readability, review-reliability, review-resilience) ` +
						`on "${b.on}" with when.always=true is prohibited — everyday events must use a single advisory lens, ` +
						`not the full 4R fan-out (spec G token-budget rule)`,
				);
			}
		}
	}
}

// Validate DEFAULT_RULE_SET at module load — proves it's always valid.
validateTriggerRuleSet(DEFAULT_RULE_SET);

// ---------------------------------------------------------------------------
// matchPathGlobs
// ---------------------------------------------------------------------------

/**
 * Converts a glob pattern (using ** and *) to a RegExp.
 * Supports the doublestar/segment forms used by the trigger rule set.
 *
 * Key behavior: a leading doublestar-slash means "zero or more leading path
 * segments", so a pattern like auth-glob matches both "src/auth/login.ts"
 * AND "auth/login.ts" (zero leading segments). A doublestar in a non-leading
 * position expands to ".*". A single star expands to "[^/]*" (no separator
 * crossing). All other regex metacharacters are escaped.
 */
function globToRegExp(glob: string): RegExp {
	// Step 1: escape all regex metacharacters except * (which we handle below).
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");

	// Step 2: tokenize every ** before touching single *.
	const tokenized = escaped.replace(/\*\*/g, "__DS__");

	// Step 3: replace single * with [^/]* (no path-separator crossing).
	const withSingleStar = tokenized.replace(/\*/g, "[^/]*");

	// Step 4: convert a leading __DS__/ to "zero or more leading path segments",
	// so that a glob like the auth hot-path pattern matches both
	// "src/auth/login.ts" (leading segments) AND "auth/login.ts" (zero leading).
	const withLeading = withSingleStar.replace(/^__DS__\//, "(?:.*/)?");

	// Step 5: restore remaining __DS__ tokens as .* (match any chars including /).
	const withDoubleStar = withLeading.replace(/__DS__/g, ".*");

	return new RegExp(`^${withDoubleStar}$`);
}

/**
 * Returns true if any path in `paths` matches any glob in `globs`.
 * Supports the `**` wildcard matching any path segment.
 */
export function matchPathGlobs(paths: readonly string[], globs: readonly string[]): boolean {
	if (paths.length === 0 || globs.length === 0) return false;
	const regexps = globs.map(globToRegExp);
	return paths.some((p) => regexps.some((re) => re.test(p)));
}

// ---------------------------------------------------------------------------
// evaluateEvent
// ---------------------------------------------------------------------------

/**
 * Evaluates a trigger event against the DEFAULT_RULE_SET and the provided diff.
 *
 * Returns `{ run, mode, reason }` for the first binding that fires, or `null`
 * if no binding fires.
 *
 * Note: `post-sdd-phase` bindings use `phases` for firing, not diff conditions.
 * Passing a `post-sdd-phase` event here will always return null because the
 * phase parameter is not available in this diff-based entry point. Use
 * `evaluatePostSddPhaseEvent` for phase-driven triggering.
 */
export function evaluateEvent(
	event: TriggerEvent,
	diff: ChangedDiff,
): { run: string[]; mode: TriggerMode; reason: string } | null {
	for (const binding of DEFAULT_RULE_SET.bindings) {
		if (binding.on !== event) continue;

		const w = binding.when;

		// always → unconditional match
		if (w.always === true) {
			return { run: binding.run, mode: binding.mode, reason: binding.reason };
		}

		// post-sdd-phase uses phases, not diff conditions — skip here
		if (event === "post-sdd-phase") {
			continue;
		}

		// Evaluate path and line conditions using combine mode
		const combine = w.combine ?? "or";
		const pathMatches =
			w.pathGlobs && w.pathGlobs.length > 0
				? matchPathGlobs(diff.changedPaths, w.pathGlobs)
				: false;
		const lineMatches =
			w.minDiffLines !== undefined && w.minDiffLines > 0
				? diff.changedLines >= w.minDiffLines
				: false;

		const hasPathCondition = w.pathGlobs !== undefined && w.pathGlobs.length > 0;
		const hasLineCondition = w.minDiffLines !== undefined && w.minDiffLines > 0;

		let fires = false;
		if (combine === "and") {
			// Both conditions must hold (only when both are specified)
			if (hasPathCondition && hasLineCondition) {
				fires = pathMatches && lineMatches;
			} else if (hasPathCondition) {
				fires = pathMatches;
			} else if (hasLineCondition) {
				fires = lineMatches;
			}
		} else {
			// "or" or "" — any condition firing is enough
			fires = pathMatches || lineMatches;
		}

		if (fires) {
			return { run: binding.run, mode: binding.mode, reason: binding.reason };
		}
	}

	return null;
}

/**
 * Evaluates a post-sdd-phase trigger for a specific SDD phase name.
 * Returns `{ run, mode, reason }` if a binding matches, or `null`.
 */
export function evaluatePostSddPhaseEvent(
	phase: string,
): { run: string[]; mode: TriggerMode; reason: string } | null {
	for (const binding of DEFAULT_RULE_SET.bindings) {
		if (binding.on !== "post-sdd-phase") continue;
		const w = binding.when;
		if (w.phases && w.phases.includes(phase)) {
			return { run: binding.run, mode: binding.mode, reason: binding.reason };
		}
	}
	return null;
}
