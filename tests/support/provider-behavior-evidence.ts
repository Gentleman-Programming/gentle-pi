import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

// #1819 (corrected-delivery topology, selector-free receipt discovery) and
// #1915 (retry-successor authority, evidence-graph validation) are
// provider-owned. Pi consumes immutable-release evidence produced by the
// `consume-gentle-ai-release-artifacts` foundation and asserts only
// transport and outcome -- it never reconstructs those algorithms itself.
// This module is the thin, pure assertion layer that enforces that
// boundary. It owns no pin, mirror, lock, archive format, or acquisition
// path, and it is test-only support code, never shipped production
// authority under `lib/` or `extensions/`.

export const PROVIDER_BEHAVIOR_ISSUE = {
	CORRECTED_DELIVERY: "1819",
	RETRY_SUCCESSOR: "1915",
} as const;
export type ProviderBehaviorIssue = (typeof PROVIDER_BEHAVIOR_ISSUE)[keyof typeof PROVIDER_BEHAVIOR_ISSUE];

export const EVIDENCE_CLASS = {
	BOOTSTRAP: "development/bootstrap",
	LIVE_SIGNED_RELEASE: "live/signed-release",
} as const;
export type EvidenceClass = (typeof EVIDENCE_CLASS)[keyof typeof EVIDENCE_CLASS];

export type ProviderBehaviorOutcome = "allow" | "deny" | "approved" | "escalated";

export interface ProviderBehaviorAssertion {
	readonly issue: ProviderBehaviorIssue;
	readonly evidenceClass: EvidenceClass;
	readonly expectedOutcome: ProviderBehaviorOutcome;
}

// `evidenceClass`/`outcome` stay untyped strings at this boundary (not the
// narrower union types above) on purpose: the evaluator below must prove at
// runtime, not only at compile time, that an evidence record outside the two
// allowlisted classes is refused -- exactly the "mutable provider build
// refused" scenario the spec requires.
export interface ProviderBehaviorEvidenceRecord {
	readonly evidenceClass: string;
	readonly outcome: string;
	readonly releaseIdentity?: string;
}

export type AssertionResult =
	| { readonly status: "pass"; readonly releaseIdentity?: string }
	| { readonly status: "blocked"; readonly missingDependency: string }
	| { readonly status: "unsupported"; readonly capability: string };

export const MISSING_EVIDENCE_DEPENDENCY = "consume-gentle-ai-release-artifacts";

// Pure: no I/O, no process spawn, no provider-topology computation. It
// asserts transport -- does the evidence carry the expected class and
// outcome? -- and never recomputes a delivery-topology or authority-graph
// verdict of its own.
export function evaluateProviderBehaviorAssertion(assertion: ProviderBehaviorAssertion, evidence: ProviderBehaviorEvidenceRecord | undefined): AssertionResult {
	if (evidence === undefined) return { status: "blocked", missingDependency: MISSING_EVIDENCE_DEPENDENCY };
	if (evidence.evidenceClass === EVIDENCE_CLASS.BOOTSTRAP) return { status: "unsupported", capability: "final-acceptance-requires-live-signed-release" };
	if (evidence.evidenceClass !== EVIDENCE_CLASS.LIVE_SIGNED_RELEASE) return { status: "unsupported", capability: "mutable-provider-build-refused" };
	if (evidence.outcome !== assertion.expectedOutcome) return { status: "blocked", missingDependency: MISSING_EVIDENCE_DEPENDENCY };
	return evidence.releaseIdentity === undefined ? { status: "pass" } : { status: "pass", releaseIdentity: evidence.releaseIdentity };
}

// --- Design Decision 6: zero-reconstruction static guard -------------------

const FORBIDDEN_SYMBOL_FRAGMENTS = ["squash", "pathdrift", "receiptdiscovery", "evidencedigestevolution", "authoritygraph", "deliverytopology", "retrysuccessor", "correctionaccounting"] as const;

// Declaration sites only -- never bare substring occurrences -- so
// provider-owned opaque vocabulary Pi legitimately forwards or names (a
// `--squash` git-commit flag, an `exact_gate_receipt_discovery`
// capability-negotiation string) never false-positives. A hit here means Pi
// DECLARED a symbol implementing one of these provider-owned concepts,
// which Decision 6 forbids.
const DECLARATION_PATTERN = /\b(?:function|class|interface|type|const|let|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

export interface ReconstructionViolation {
	readonly file: string;
	readonly symbol: string;
}

// `root` may name either a directory (scanned recursively) or a single file
// (returned as-is when its extension qualifies) -- callers such as the
// fixture/journey-naming scan pass individually-selected file paths rather
// than a directory.
function listFilesWithExtensions(root: string, extensions: readonly string[]): readonly string[] {
	const stat = statSync(root);
	if (stat.isFile()) return extensions.includes(extname(root)) ? [root] : [];
	const out: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const full = join(root, entry.name);
		if (entry.isDirectory()) {
			out.push(...listFilesWithExtensions(full, extensions));
			continue;
		}
		if (entry.isFile() && extensions.includes(extname(entry.name))) out.push(full);
	}
	return out;
}

export function scanForReconstructionSymbols(roots: readonly string[]): readonly ReconstructionViolation[] {
	const violations: ReconstructionViolation[] = [];
	for (const root of roots) {
		for (const file of listFilesWithExtensions(root, [".ts"])) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(DECLARATION_PATTERN)) {
				const symbol = match[1]!;
				const lowered = symbol.toLowerCase();
				if (FORBIDDEN_SYMBOL_FRAGMENTS.some((fragment) => lowered.includes(fragment))) violations.push({ file, symbol });
			}
		}
	}
	return violations;
}

// --- Design Decision 7: #2074 / #910 absence --------------------------------

export interface PatternMatch {
	readonly file: string;
	readonly line: number;
}

// `pattern` MUST NOT carry the `g` flag -- callers pass a fresh non-global
// regex so `.test()` per line stays stateless.
export function scanForPattern(roots: readonly string[], pattern: RegExp, extensions: readonly string[] = [".ts", ".mjs", ".js"]): readonly PatternMatch[] {
	const matches: PatternMatch[] = [];
	for (const root of roots) {
		for (const file of listFilesWithExtensions(root, extensions)) {
			const lines = readFileSync(file, "utf8").split("\n");
			for (const [index, line] of lines.entries()) {
				if (pattern.test(line)) matches.push({ file, line: index + 1 });
			}
		}
	}
	return matches;
}

export function listTestFiles(testsRoot: string, exclude: readonly string[]): readonly string[] {
	return readdirSync(testsRoot, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts") && !exclude.includes(entry.name))
		.map((entry) => join(testsRoot, entry.name));
}
