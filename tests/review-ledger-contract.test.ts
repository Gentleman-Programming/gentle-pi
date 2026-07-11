import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const CANONICAL = "skills/_shared/review-ledger-contract.md";
const ORCHESTRATOR = ["assets/orchestrator.md", "assets/orchestrator-delegation.md"];
const REVIEW_LENSES = [
	"assets/agents/review-risk.md",
	"assets/agents/review-resilience.md",
	"assets/agents/review-readability.md",
	"assets/agents/review-reliability.md",
] as const;
const JUDGES = ["assets/agents/jd-judge-a.md", "assets/agents/jd-judge-b.md"] as const;
const REFUTER = "assets/agents/review-refuter.md";
const VALIDATOR = "assets/agents/review-validator.md";
const FIX_AGENT = "assets/agents/jd-fix-agent.md";
const JD_SKILL = "skills/judgment-day/SKILL.md";
const JD_PROMPTS = "skills/judgment-day/references/prompts-and-formats.md";
const GENTLE_SKILL = "skills/gentle-ai/SKILL.md";
const README = "README.md";
const CHAIN = "assets/chains/4r-review.chain.md";
const SDD_WORKFLOW = "assets/sdd-orchestrator-workflow.md";
const RELEASE_SKILL = "skills/release/SKILL.md";
const WORKER = "assets/agents/gentle-ai-worker.md";

function read(path: string): string {
	return readFileSync(join(ROOT, path), "utf8");
}

function union(paths: readonly string[]): string {
	return paths.map(read).join("\n");
}

function assertMatches(label: string, content: string, patterns: readonly RegExp[]): void {
	for (const pattern of patterns) assert.match(content, pattern, label);
}

function fencedBlock(path: string, heading: string): string {
	const lines = read(path).split("\n");
	const starts = lines.flatMap((line, index) => line === heading ? [index] : []);
	assert.equal(starts.length, 1, `${path} must contain one exact ${heading}`);
	const fenceStart = lines.findIndex((line, index) => index > starts[0]! && line.startsWith("```"));
	const relativeEnd = lines.slice(fenceStart + 1).findIndex((line) => line.startsWith("```"));
	assert.ok(fenceStart > starts[0]! && relativeEnd >= 0, `${path} must contain a complete fenced block`);
	return lines.slice(fenceStart + 1, fenceStart + 1 + relativeEnd).join("\n");
}

const JUDGMENT_DAY_PATTERNS = [
	/Judgment Day starts only when explicitly requested and replaces ordinary review for that lineage\./,
	/Judgment Day starts with exactly two blind judges and zero refuters\./,
	/Only Judgment Day may iterate, for at most two scoped fix\/re-judgment rounds\./,
	/Findings surviving round two escalate; no third-round transition exists\./,
] as const;

const JUDGMENT_DAY_REJUDGMENT_PATTERNS = [
	/Initial discovery and scoped re-judgment are separate modes\./,
	/On controller-requested scoped re-judgment, receive only requested frozen IDs, their exact hash-bound rows, and the fix diff\./,
	/Resolve only supplied IDs and fix-line regressions; do not add findings/,
	/Return one `verified \| corroborated \| regression` resolution per requested ID\./,
] as const;

const FIX_PATTERNS = [
	/Fix only the exact controller-authorized severe IDs in the one supplied batch\./,
	/Do not add findings, alter frozen claims, authorize transitions, deliver, publish, or start another actor\./,
] as const;

test("canonical contract defines compact risk, causal admission, correction, CAS, compatibility, and gates", () => {
	const content = read(CANONICAL);
	assertMatches(CANONICAL, content, [
		/start -> finalize -> validate/,
		/`low`[\s\S]*`medium`[\s\S]*`high`/,
		/min\(200, ceil\(original_changed_lines \/ 2\)\)/,
		/testdata\/golden\/\*\*/,
		/`reviewing`, `correction_required`, `validating`, `approved`, and `escalated`/,
		/`evidence_class`, `causal_disposition`, and concrete proof/,
		/`changed-hunk`[\s\S]*`candidate-created-path`[\s\S]*`differential-test`[\s\S]*`before-after`/,
		/Only severe `introduced`, `behavior-activated`, or `worsened` findings with valid proof can enter `correction_ids`/,
		/`pre-existing` and `base-only` findings become non-blocking follow-ups/,
		/one correction and one targeted validator/i,
		/content-derived revisions, compare-and-swap replacement, exact retry idempotency/i,
		/graph-v1 ordinary lineages remain readable, gate-validatable, and exportable, but reject new mutation/i,
		/Judgment Day remains mutable on graph-v1/i,
		/reloads authority and re-derives target\/publication evidence before allow/i,
		/one one-shot authorization for the exact subsequent command/i,
		/local orchestrator and same-user process are trusted/i,
		/reviewer and validator outputs remain semantically untrusted/i,
		/do not report.*trusted local orchestrator.*security finding/i,
		/untrusted repository content.*malformed inputs.*stale authority.*path drift.*external callers/i,
		...JUDGMENT_DAY_PATTERNS,
	]);
	assert.match(read(README), /Trust boundary:[\s\S]*separately privileged signer\/service/);
	assert.doesNotMatch(read(README), /Known limitation:[\s\S]*runtime-owned child-agent identity\/attestation/);
});

for (const path of REVIEW_LENSES) {
	test(`${path} requires causal evidence and remains a one-shot read-only result producer`, () => {
		const content = read(path);
		assertMatches(path, content, [
			/Run this selected lens exactly once against the supplied `initial_review_tree`/,
			/`evidence_class` \(`deterministic \| inferential \| insufficient`\)/,
			/`causal_disposition` \(`introduced \| behavior-activated \| worsened \| pre-existing \| base-only \| unknown`\)/,
			/`changed-hunk:`[\s\S]*`candidate-created-path:`[\s\S]*`differential-test:`[\s\S]*`before-after:`/,
			/Only candidate-caused BLOCKER or CRITICAL findings may require correction/,
			/Do not persist state, mutate claims, launch actors, request fixes, validate fixes, or deliver anything/,
		]);
	});
}

test("risk lens distinguishes trusted orchestration from concrete boundary bypasses", () => {
	const content = read("assets/agents/review-risk.md");
	assert.match(content, /local orchestrator and same-user process are trusted/i);
	assert.match(content, /reviewer and validator outputs remain semantically untrusted/i);
	assert.match(content, /do not report.*trusted local orchestrator.*security finding/i);
	assert.match(content, /untrusted repository content.*malformed inputs.*stale authority.*path drift.*external callers/i);
});

test("ordinary refuter is one complete read-only inferential batch with concrete proof", () => {
	const content = read(REFUTER);
	assertMatches(REFUTER, content, [
		/Receive the complete inferential-severe frozen-row list once/,
		/Return exactly one `refuted \| corroborated \| inconclusive` resolution for every supplied ID/,
		/`proof_refs`[\s\S]*`changed-hunk:`[\s\S]*`candidate-created-path:`[\s\S]*`differential-test:`[\s\S]*`before-after:`/,
		/Do not create findings, alter frozen claims, request fixes, launch actors, persist authority, or repeat/,
	]);
});

test("targeted validator checks only original criteria and correction regression without expanding scope", () => {
	const content = read(VALIDATOR);
	assertMatches(VALIDATOR, content, [
		/original-criteria proof/,
		/correction-regression proof/,
		/Validate the original criteria and correction regression only/,
		/Never expand paths, IDs, untracked scope, acceptance criteria, or correction purpose/,
		/empty `fix_caused_findings` array/,
		/Do not request another fix, launch actors, persist authority, or repeat/,
	]);
});

for (const path of JUDGES) {
	test(`${path} preserves graph-v1 Judgment Day discovery and scoped re-judgment`, () => {
		const content = read(path);
		assertMatches(path, content, JUDGMENT_DAY_PATTERNS);
		assertMatches(path, content, JUDGMENT_DAY_REJUDGMENT_PATTERNS);
	});
}

test("Judgment Day skill and prompts preserve bounded fix and re-judgment authority", () => {
	assertMatches(JD_SKILL, read(JD_SKILL), [...JUDGMENT_DAY_PATTERNS, ...JUDGMENT_DAY_REJUDGMENT_PATTERNS, ...FIX_PATTERNS]);
	assertMatches(JD_PROMPTS, fencedBlock(JD_PROMPTS, "## Judge Prompt"), JUDGMENT_DAY_PATTERNS);
	assertMatches(JD_PROMPTS, fencedBlock(JD_PROMPTS, "## Fix Agent Prompt"), FIX_PATTERNS);
	assertMatches(FIX_AGENT, read(FIX_AGENT), FIX_PATTERNS);
});

test("orchestrator, skill, and README agree on compact facade and compatibility", () => {
	for (const [label, content] of [
		["orchestrator", union(ORCHESTRATOR)],
		[GENTLE_SKILL, read(GENTLE_SKILL)],
		[README, read(README)],
	] as const) {
		assertMatches(label, content, [
			/start -> finalize -> validate/,
			/`evidence_class`[\s\S]*`causal_disposition`/,
			/one correction and one targeted validator/i,
			/graph-v1[\s\S]*(?:read-only|reject mutation)/i,
			/Judgment Day[\s\S]*graph-v1/i,
			/(?:one-shot|one exact one-shot)[\s\S]*(?:bash time|bash-time)/i,
		]);
	}
});

test("managed contracts retain no fresh lifecycle review directive", () => {
	const managed = union([...ORCHESTRATOR, SDD_WORKFLOW, RELEASE_SKILL, WORKER, GENTLE_SKILL, README]);
	for (const obsolete of [
		"A fresh review still follows delegated implementation.",
		"run a fresh-context review lens unless",
		"Run a fresh review before pushing a code release",
	]) assert.ok(!managed.includes(obsolete), `managed contracts retain ${obsolete}`);
	assert.match(read(SDD_WORKFLOW), /SDD phase validation does not start ordinary review or Judgment Day/);
});

test("static 4R chain runs each selected lens once and owns no orchestration", () => {
	const content = read(CHAIN);
	for (const lens of ["review-risk", "review-resilience", "review-readability", "review-reliability"]) {
		assert.equal(content.split(`## ${lens}`).length - 1, 1, `${CHAIN} must run ${lens} once`);
	}
	assert.equal(content.split("supplied `initial_review_tree`").length - 1, 4);
	for (const forbidden of ["review-refuter", "review-validator", "fix/re-review", "Ledger persistence", "final verification"]) {
		assert.ok(!content.includes(forbidden), `${CHAIN} contains ${forbidden}`);
	}
});
