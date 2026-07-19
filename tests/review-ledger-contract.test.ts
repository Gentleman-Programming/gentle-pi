import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { REVIEW_LENS_PARITY_PATTERNS } from "./support/review-lens-parity.ts";

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
const CANONICAL_LIFECYCLE_SPECS = [
	"openspec/specs/review-orchestration/spec.md",
	"openspec/specs/review-transaction/spec.md",
] as const;
const HISTORICAL_LIFECYCLE_SPECS = [
	"openspec/changes/complete-native-review-lifecycle/specs/review-orchestration/spec.md",
	"openspec/changes/complete-native-review-lifecycle/specs/review-transaction/spec.md",
] as const;

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
	const fence = lines[fenceStart]!.match(/^(`+)/)?.[1];
	const relativeEnd = lines.slice(fenceStart + 1).findIndex((line) => line === fence);
	assert.ok(fenceStart > starts[0]! && relativeEnd >= 0, `${path} must contain a complete fenced block`);
	return lines.slice(fenceStart + 1, fenceStart + 1 + relativeEnd).join("\n");
}

function jsonBlocks(path: string): unknown[] {
	return [...read(path).matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!));
}

function assertNativeJsonHasNoMetadata(path: string, value: unknown): void {
	const serialized = JSON.stringify(value);
	for (const forbidden of ["summary", "skill_resolution", "orchestration", "prose"]) {
		assert.ok(!serialized.includes(forbidden), `${path} native JSON contains ${forbidden}`);
	}
}

const JUDGMENT_DAY_PATTERNS = [
	/Judgment Day starts only when explicitly requested and replaces ordinary review for that lineage\./,
	/Judgment Day starts with exactly two blind judges and zero refuters\./,
	/Judgment Day alone may iterate discovery and scoped re-judgment, for at most two rounds\./,
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
		/one correction transaction/i,
		/original budget/i,
		/frozen findings and genesis scope/i,
		/content-derived revisions, compare-and-swap replacement, exact retry idempotency/i,
		/graph-v1 ordinary lineages remain readable and gate-validatable but reject new mutation/i,
		/Legacy graph bundle export\/import is retired/i,
		/Judgment Day remains mutable on graph-v1/i,
		/reloads authority and re-derives target\/publication evidence before allow/i,
		/one one-shot authorization for the exact subsequent command/i,
		/gentle-ai\.review-integration\/v1/i,
		/durable hook\/native-validation transaction/i,
		/Pi-owned `review-publication-gate` module isolates command projection and publication revalidation/i,
		/local orchestrator and same-user process are trusted/i,
		/reviewer and validator outputs remain semantically untrusted/i,
		/do not report.*trusted local orchestrator.*security finding/i,
		/untrusted repository content.*malformed inputs.*stale authority.*path drift.*external callers/i,
		...JUDGMENT_DAY_PATTERNS,
	]);
	assert.match(read(README), /Trust boundary:[\s\S]*separately privileged signer\/service/);
	assert.doesNotMatch(read(README), /Known limitation:[\s\S]*runtime-owned child-agent identity\/attestation/);
	assert.match(read(README), /split fetch\/push[\s\S]*unsupported[\s\S]*upstream[\s\S]*base-ref/i);
	assert.match(read(README), /Residual gap \(separate follow-up\): native first-push authorization remains unsupported until Pi has a persisted explicit advertised-base source\./);
	const lifecycleSpec = read("openspec/specs/review-transaction/spec.md");
	assert.match(lifecycleSpec, /split fetch\/push[\s\S]*upstream contract limitation/i);
	assert.match(lifecycleSpec, /allow response MUST return the exact requested gate/i);
	assert.match(lifecycleSpec, /non-authorizing denial MAY return an empty gate[\s\S]*pre_pr_boundary/i);
	assert.match(lifecycleSpec, /one aggregate bash-time deadline/i);
});

for (const path of REVIEW_LENSES) {
	test(`${path} requires causal evidence and remains a one-shot read-only result producer`, () => {
		const content = read(path);
		assertMatches(path, content, REVIEW_LENS_PARITY_PATTERNS);
	});
}

test("ordinary lens prompts contain the literal compact-v2 native result envelope", () => {
	const expectedLenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"];
	for (const [index, path] of REVIEW_LENSES.entries()) {
		const blocks = jsonBlocks(path);
		assert.equal(blocks.length, 1, `${path} must contain one native JSON example`);
		const envelope = blocks[0] as Record<string, unknown>;
		assert.deepEqual(Object.keys(envelope), ["review_result"]);
		const reviewResult = envelope.review_result as Record<string, unknown>;
		assert.deepEqual(Object.keys(reviewResult), ["lens_results"]);
		const lensResults = reviewResult.lens_results as Array<Record<string, unknown>>;
		assert.equal(lensResults.length, 1);
		assert.deepEqual(Object.keys(lensResults[0]!), ["lens", "findings", "evidence"]);
		assert.equal(lensResults[0]!.lens, expectedLenses[index]);
		const findings = lensResults[0]!.findings as Array<Record<string, unknown>>;
		assert.equal(findings[0]!.lens, expectedLenses[index]);
		assert.deepEqual(Object.keys(findings[0]!), [
			"id",
			"lens",
			"location",
			"severity",
			"claim",
			"evidence_class",
			"causal_disposition",
			"proof_refs",
		]);
		assertNativeJsonHasNoMetadata(path, envelope);
		assert.match(read(path), /Do not put `summary`, `skill_resolution`, prose, or orchestration metadata inside or beside the native JSON result/);
		assert.match(read(path), /If clean, use an empty `findings` array and a non-empty `evidence` array/);
		assert.doesNotMatch(read(path), /Use empty `findings` and `evidence` arrays when clean/);
	}
});

test("canonical ordinary review specs preserve the negotiated one-correction contract", () => {
	for (const path of CANONICAL_LIFECYCLE_SPECS) {
		const content = read(path);
		assert.match(content, /one correction transaction/i, path);
		assert.match(content, /original.*budget|budget.*original/i, path);
		assert.match(content, /never reruns initial lenses|without rerunning initial (?:lenses|review)/i, path);
		assert.match(content, /correction_required/, path);
		assert.match(content, /failure escalates|failed.*escalates|MUST escalate/i, path);
		assert.match(content, /forecast/i, path);
		assert.doesNotMatch(content, /up to three failed targeted attempts|third failed attempt/i, path);
	}
});

test("historical lifecycle change specs preserve their completed one-attempt design context", () => {
	for (const path of HISTORICAL_LIFECYCLE_SPECS) {
		const content = read(path);
		assert.match(content, /at most one correction|one correction batch|After the one correction|GIVEN one exact ordinary correction|one validator and one final verification/i, path);
		assert.doesNotMatch(content, /up to three failed targeted attempts/i, path);
	}
});

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
		/`gentle-ai\.refuter-result-batch\/v1`/,
		/`request_hash`[\s\S]*`finding_id`/,
		/`proof_refs`[\s\S]*`changed-hunk:`[\s\S]*`candidate-created-path:`[\s\S]*`differential-test:`[\s\S]*`before-after:`/,
		/independent concrete refuter proof is valid and need not repeat reviewer `proof_refs`/,
		/Use `inconclusive` when the supplied evidence supports neither `refuted` nor `corroborated`/,
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
		/Do not request another fix or attempt, launch actors, persist authority, or repeat yourself/,
	]);
});

for (const path of JUDGES) {
	test(`${path} preserves graph-v1 Judgment Day discovery and scoped re-judgment`, () => {
		const content = read(path);
		assertMatches(path, content, JUDGMENT_DAY_PATTERNS);
		assertMatches(path, content, JUDGMENT_DAY_REJUDGMENT_PATTERNS);
	});
}

test("Judgment Day judge prompts contain distinct graph-v1 discovery and re-judgment shapes", () => {
	for (const path of [...JUDGES, JD_PROMPTS]) {
		const blocks = jsonBlocks(path);
		assert.equal(blocks.length, 2, `${path} must contain discovery and re-judgment JSON examples`);
		const discovery = blocks[0] as Record<string, unknown>;
		assert.deepEqual(Object.keys(discovery), ["rows"]);
		const rows = discovery.rows as Array<Record<string, unknown>>;
		assert.deepEqual(Object.keys(rows[0]!), [
			"id",
			"lens",
			"location",
			"severity",
			"status_at_freeze",
			"evidence_class",
			"evidence_claim",
		]);
		assert.equal(rows[0]!.lens, "judgment-day");

		const rejudgment = blocks[1] as Record<string, unknown>;
		assert.deepEqual(Object.keys(rejudgment), ["resolutions"]);
		const resolutions = rejudgment.resolutions as Array<Record<string, unknown>>;
		assert.deepEqual(Object.keys(resolutions[0]!), ["id", "outcome"]);
		for (const block of blocks) assertNativeJsonHasNoMetadata(path, block);
		assert.match(read(path), /Do not put `summary`, `skill_resolution`, prose, or orchestration metadata inside or beside (?:either )?(?:the )?native JSON result/);
	}
	const judgePrompt = fencedBlock(JD_PROMPTS, "## Judge Prompt");
	assert.match(judgePrompt, /```json\n\{\n  "rows":/);
	assert.match(judgePrompt, /Do not put `summary`, `skill_resolution`, prose, or orchestration metadata inside or beside the native JSON result/);
	assert.doesNotMatch(judgePrompt, /End with `Skill Resolution:/);
});

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
			/one correction transaction/i,
			/(?:graph-v1|legacy)[\s\S]*(?:read-only|reject mutation)/i,
			/Judgment Day[\s\S]*(?:explicit|separate)/i,
			/(?:one-shot|one exact one-shot)[\s\S]*(?:bash time|bash-time)/i,
		]);
	}
});

test("README documents the exact native pairing and authority-preserving rollback boundary", () => {
	const content = read(README);
	assert.match(content, /package-local Gentle AI v2\.1\.8 executable/i);
	assert.match(content, /independently hashes it[\s\S]*negotiates `gentle-ai\.review-integration\/v1`/i);
	assert.match(content, /Capabilities are cached by that executable digest/i);
	assert.match(content, /Every START, target status, FINALIZE, validate, and BIND-SDD request passes the same contract identifier/i);
	assert.match(content, /rollback MUST preserve every native store and receipt/);
	assert.match(content, /MUST NOT run a downgraded binary/i);
	assert.match(content, /existing branch.*advertised commit equals.*old object/is);
	assert.match(content, /never guesses? a base.*upstream.*default branch.*nearest ancestor/is);
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
