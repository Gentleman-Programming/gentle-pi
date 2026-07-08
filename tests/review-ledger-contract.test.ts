import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");

function read(relPath: string): string {
	return readFileSync(join(repoRoot, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Named clause groups (frozen, explicit arrays — no positional slicing).
//
// These encode the exhaustive first-pass loop, the persisted findings-ledger
// schema, the artifact-store persistence branches, and the scoped re-review
// contract defined in
// openspec/changes/port-review-ledger-contract/{spec,design}.md, ported
// near-verbatim from gentle-ai's
// internal/assets/skills/_shared/review-ledger-contract.md.
//
// Every clause is chosen so it does NOT already exist in any unmodified Pi
// asset (verified against the pre-change repo state) — this keeps the first
// run of this suite a true RED before any asset is edited.
// ---------------------------------------------------------------------------

const exhaustiveFirstPassClauses = Object.freeze([
	"Loop until dry: sweep the diff repeatedly until N consecutive sweeps yield zero new findings",
	"Default N = 2 consecutive dry sweeps",
	"R2 Readability MAY use N = 1",
	"Hard ceiling: 4 sweeps regardless of N",
]);

// Ledger schema fields. Full enum strings, not truncated prefixes: a prefix
// match would still pass if a replicated asset dropped a trailing enum value
// (JD-004 mitigation).
const ledgerSchemaClauses = Object.freeze([
	"`id` | `{LENS}-{NNN}`",
	"`lens` | risk \\| readability \\| reliability \\| resilience \\| judgment-day |",
	"`location` | `path/to/file.ext:line` or `:start-end`",
	"`severity` | BLOCKER \\| CRITICAL \\| WARNING \\| SUGGESTION |",
	"`status` | open \\| fixed \\| verified \\| wont-fix \\| info |",
	"`evidence` | why it matters |",
	"persist an empty ledger record rather than skip persistence",
]);

// Persistence branches on the artifact store.
const ledgerPersistenceClauses = Object.freeze([
	"write `openspec/changes/{change-name}/review-ledger.md`",
	"upsert topic `sdd/{change-name}/review-ledger`",
	"ad-hoc judgment-day without a change: `review/{target-slug}/ledger`",
	// target-slug derivation rule: deterministic so ad-hoc sessions don't guess
	// divergent keys.
	"`target-slug` = `pr-{number}` when reviewing a PR, else the current branch name kebab-cased, else a kebab-case slug of the user-stated review target",
	"do not write files or Engram artifacts",
	"the ledger lives only in this conversation",
	// Compaction caveat for the `none` store, folded into the hand-copied
	// `none` bullet instead of living only in a non-copied note.
	"complete the review → fix → re-review loop within the session because it is not persisted across compaction",
]);

// Scoped re-review contract.
const scopedReReviewClauses = Object.freeze([
	"MUST verify each ledger finding's resolution and MUST review only fix-touched lines",
	"MUST NOT re-read the full original diff",
	"MUST be logged with status `info` as a first-pass quality signal",
	"MUST NOT by itself trigger another full round",
]);

// Pi is subagent-primary ONLY (real review-*/jd-* subagents); there is no
// inline-mode clause — dropped entirely, aligning with the stop-not-inline
// delegation policy at assets/orchestrator.md:92.
const subagentExecutionModeClause =
	"Subagent execution-mode: this agent runs its lens exhaustively as a dedicated Pi subagent and returns its own ledger rows in its Output; the orchestrator merges those ledger rows into the persisted ledger.";

const fixExecutionModeClause =
	"Fix execution-mode: jd-fix-agent applies only confirmed ledger findings and hands control back to the orchestrator, which runs the scoped re-judge.";

// requiredJudgePromptClauses is the subset that belongs INSIDE the fenced
// Judge Prompt template itself (JD-013): the exhaustive first-pass loop, the
// findings-ledger schema, and the ledger-persistence branches. The scoped
// re-review contract governs the re-judge round that follows the fix agent,
// not the judge's own prompt, so it is excluded here.
//
// Authored as its OWN explicit named array, NOT derived by positional slicing
// off requiredJudgeClauses — canonical gentle-ai's
// `requiredJudgePromptClauses = requiredLedgerClauses[:len(requiredLedgerClauses)-4]`
// is index-fragile: reordering the source array silently changes which
// clauses the fence check covers. This port names each sub-array explicitly
// so no clause's membership depends on array position.
const requiredJudgePromptClauses = Object.freeze([
	...exhaustiveFirstPassClauses,
	...ledgerSchemaClauses,
	...ledgerPersistenceClauses,
]);

// requiredJudgeClauses is the full clause set asserted on every whole-file
// judge surface: the four review-* lenses, jd-judge-a, jd-judge-b, and the
// judgment-day SKILL.md "Ledger and Re-Judge Contract" section.
const requiredJudgeClauses = Object.freeze([
	...requiredJudgePromptClauses,
	...scopedReReviewClauses,
	subagentExecutionModeClause,
]);

// requiredFixAgentClauses are the fix-specific clauses jd-fix-agent.md (and
// the Fix Agent Prompt fence) must carry instead of requiredJudgeClauses. The
// fix agent applies confirmed fixes; it does not run the exhaustive first
// pass and does not emit a findings ledger, so pasting the judge contract
// verbatim contradicts its own "fix ONLY confirmed issues" rules (JD-001).
const requiredFixAgentClauses = Object.freeze([
	"does NOT run the exhaustive first-pass sweep and does NOT emit a findings ledger",
	"Read the ledger entries the orchestrator confirmed and passed in the delegate prompt",
	"set that entry's `status` to `fixed`",
	"Never add new ledger rows: if fixing surfaces a new problem, report it back to the orchestrator instead of fixing it or logging it yourself",
	fixExecutionModeClause,
]);

// judgeOnlyMarkers are judge-role clauses that must NOT appear in fix-agent
// surfaces. If the judge contract block (exhaustive first pass, findings
// ledger emission, judge execution mode) is ever pasted back into a
// fix-agent surface alongside the fix clauses, these markers catch it
// (JD-001/JD-011 regression guard).
const judgeOnlyMarkers = Object.freeze([
	"**Exhaustive first pass.**",
	"Emit a findings ledger with this schema for every entry",
	subagentExecutionModeClause,
]);

// requiredEnumFragments are the bare severity/status/lens enum strings
// asserted, complete and untruncated, wherever the ledger schema is present
// — including jd-fix-agent, which needs the valid `status` enum to set
// entries to `fixed` even though it never emits new ledger rows (JD-004).
const requiredEnumFragments = Object.freeze([
	"BLOCKER \\| CRITICAL \\| WARNING \\| SUGGESTION",
	"open \\| fixed \\| verified \\| wont-fix \\| info",
	"risk \\| readability \\| reliability \\| resilience \\| judgment-day",
]);

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

const judgeWholeFileSurfaces = Object.freeze([
	"assets/agents/review-risk.md",
	"assets/agents/review-readability.md",
	"assets/agents/review-reliability.md",
	"assets/agents/review-resilience.md",
	"assets/agents/jd-judge-a.md",
	"assets/agents/jd-judge-b.md",
	"skills/judgment-day/SKILL.md",
]);

const fixAgentSurface = "assets/agents/jd-fix-agent.md";

const enumFragmentSurfaces = Object.freeze([...judgeWholeFileSurfaces, fixAgentSurface]);

const promptsAndFormatsPath = "skills/judgment-day/references/prompts-and-formats.md";

const orchestratorPath = "assets/orchestrator.md";

const chainPath = "assets/chains/4r-review.chain.md";

const canonicalPath = "skills/_shared/review-ledger-contract.md";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertContainsAll(label: string, content: string, clauses: readonly string[]): void {
	for (const clause of clauses) {
		assert.ok(content.includes(clause), `${label} missing required ledger clause: ${JSON.stringify(clause)}`);
	}
}

function assertContainsNone(label: string, content: string, markers: readonly string[]): void {
	for (const marker of markers) {
		assert.ok(!content.includes(marker), `${label} must NOT contain judge-only marker: ${JSON.stringify(marker)}`);
	}
}

// extractFencedBlockAfterHeading returns the contents of the first fenced
// code block that follows the given markdown heading in content. The heading
// is matched by EXACT LINE EQUALITY (not substring) — deliberate Pi-side
// hardening beyond canonical gentle-ai, whose own
// extractFencedBlockAfterHeading (review_ledger_contract_test.go:191-198)
// still uses a substring search and carries an unresolved prefix-collision
// risk (archived ledger JD-014, status `info`). A clause that lives in prose
// outside the fence (placement drift, JD-013) cannot silently satisfy a
// whole-file `includes` check because we scope the assertion to the
// extracted fence body only.
function extractFencedBlockAfterHeading(label: string, content: string, heading: string): string {
	const lines = content.split("\n");
	const headingOccurrences = lines.filter((line) => line === heading).length;
	assert.ok(headingOccurrences !== 0, `${label}: heading ${JSON.stringify(heading)} not found (exact line match)`);
	assert.ok(
		headingOccurrences === 1,
		`${label}: heading ${JSON.stringify(heading)} occurs ${headingOccurrences} times (exact line match) — extraction requires a unique heading`,
	);
	const headingIndex = lines.findIndex((line) => line === heading);

	let fenceStart = -1;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		if (lines[i]?.startsWith("```")) {
			fenceStart = i;
			break;
		}
	}
	assert.ok(fenceStart !== -1, `${label}: no fenced block found after heading ${JSON.stringify(heading)}`);

	let fenceEnd = -1;
	for (let i = fenceStart + 1; i < lines.length; i++) {
		if (lines[i]?.startsWith("```")) {
			fenceEnd = i;
			break;
		}
	}
	assert.ok(fenceEnd !== -1, `${label}: unterminated fenced block after heading ${JSON.stringify(heading)}`);

	return lines.slice(fenceStart + 1, fenceEnd).join("\n");
}

// ---------------------------------------------------------------------------
// extractFencedBlockAfterHeading — synthetic unit tests
// ---------------------------------------------------------------------------

test("extractFencedBlockAfterHeading throws loudly on a duplicated heading", () => {
	const content = ["## Heading", "```", "first block", "```", "## Heading", "```", "second block", "```"].join(
		"\n",
	);
	assert.throws(
		() => extractFencedBlockAfterHeading("synthetic", content, "## Heading"),
		/occurs 2 times/,
		"duplicate heading must fail loudly instead of silently extracting the first match",
	);
});

test("extractFencedBlockAfterHeading throws when the heading is missing", () => {
	const content = ["## Other Heading", "```", "block", "```"].join("\n");
	assert.throws(
		() => extractFencedBlockAfterHeading("synthetic", content, "## Heading"),
		/not found \(exact line match\)/,
	);
});

test("extractFencedBlockAfterHeading throws when the fenced block is unterminated", () => {
	const content = ["## Heading", "```", "unterminated block, no closing fence"].join("\n");
	assert.throws(
		() => extractFencedBlockAfterHeading("synthetic", content, "## Heading"),
		/unterminated fenced block/,
	);
});

test("extractFencedBlockAfterHeading extracts the correct block for a unique heading", () => {
	const content = ["## Heading", "```", "the content", "```"].join("\n");
	assert.equal(extractFencedBlockAfterHeading("synthetic", content, "## Heading"), "the content");
});

test("canonical review-ledger-contract source carries the full judge clause set", () => {
	const content = read(canonicalPath);
	assertContainsAll(canonicalPath, content, requiredJudgeClauses);
	assertContainsAll(canonicalPath, content, requiredEnumFragments);
});

test("canonical source carries the fix-agent clause set for reference", () => {
	const content = read(canonicalPath);
	// The canonical doc documents the fix-role clause set as an exception, not
	// a hand-copy target for the judge block — but the no-sweep/no-emit fix
	// clause fragment should still be traceable in the doc's adopting-assets
	// notes.
	assertContainsAll(canonicalPath, content, [
		"does NOT run the exhaustive first-pass sweep and does NOT emit a findings ledger",
	]);
});

for (const surface of judgeWholeFileSurfaces) {
	test(`${surface} carries the full judge clause set`, () => {
		const content = read(surface);
		assertContainsAll(surface, content, requiredJudgeClauses);
	});
}

for (const surface of enumFragmentSurfaces) {
	test(`${surface} carries complete, untruncated enum rows`, () => {
		const content = read(surface);
		assertContainsAll(surface, content, requiredEnumFragments);
	});
}

test(`${fixAgentSurface} carries only the fix-role clause set`, () => {
	const content = read(fixAgentSurface);
	assertContainsAll(fixAgentSurface, content, requiredFixAgentClauses);
	assertContainsNone(fixAgentSurface, content, judgeOnlyMarkers);
});

test(`${promptsAndFormatsPath} Judge Prompt fence carries requiredJudgePromptClauses`, () => {
	const content = read(promptsAndFormatsPath);
	const judgeBlock = extractFencedBlockAfterHeading(promptsAndFormatsPath, content, "## Judge Prompt");
	assertContainsAll(`${promptsAndFormatsPath} Judge Prompt fence`, judgeBlock, requiredJudgePromptClauses);
});

test(`${promptsAndFormatsPath} Fix Agent Prompt fence carries requiredFixAgentClauses and no judge-only markers`, () => {
	const content = read(promptsAndFormatsPath);
	const fixBlock = extractFencedBlockAfterHeading(promptsAndFormatsPath, content, "## Fix Agent Prompt");
	assertContainsAll(`${promptsAndFormatsPath} Fix Agent Prompt fence`, fixBlock, requiredFixAgentClauses);
	// Pi-side hardening beyond canonical (archived ledger JD-015, status
	// `info`): scope the negative marker assertion to the extracted fence
	// content, not just the whole file.
	assertContainsNone(`${promptsAndFormatsPath} Fix Agent Prompt fence`, fixBlock, judgeOnlyMarkers);
});

// Per port-review-ledger-contract's spec amendment ("Clauses live inside
// copy-pasteable prompt templates"): the scoped-re-review contract and both
// named execution-mode clauses are documented outside the Judge/Fix Prompt
// fences, in the file's "## Ledger and Re-Judge Contract" prose section
// (they govern the re-judge round AFTER a prompt is issued, not the prompt
// content itself). This whole-file assertion guards that prose section so a
// future edit cannot silently delete it — mirrors gentle-ai's
// judgment_day_skill_assets subtest, which asserts the same clauses on
// SKILL.md's whole-file body.
test(`${promptsAndFormatsPath} documents the scoped re-review contract and both execution-mode clauses outside the fences`, () => {
	const content = read(promptsAndFormatsPath);
	assertContainsAll(promptsAndFormatsPath, content, scopedReReviewClauses);
	assertContainsAll(promptsAndFormatsPath, content, [subagentExecutionModeClause, fixExecutionModeClause]);
});

test(`${orchestratorPath} Review Execution Contract carries persistence branches and both execution-mode clauses`, () => {
	// orchestrator-lazy-diet: the persistence-branch bullets stay verbatim in
	// the always-on core; the empty-ledger rule and both execution-mode
	// clauses moved to assets/orchestrator-delegation.md. Union read so this
	// assertion is repointed, not weakened.
	const content = read(orchestratorPath) + read("assets/orchestrator-delegation.md");
	assertContainsAll(orchestratorPath, content, ledgerPersistenceClauses);
	assertContainsAll(orchestratorPath, content, [
		"persist an empty ledger record rather than skip persistence",
		subagentExecutionModeClause,
		fixExecutionModeClause,
	]);
});

test(`${chainPath} replaces the four "No findings." lines with the canonical empty-ledger-record clause`, () => {
	const content = read(chainPath);
	assert.ok(
		!content.includes("say exactly: `No findings.`"),
		`${chainPath} must not carry the old "say exactly: No findings." wording`,
	);
	const occurrences = content.split("persist an empty ledger record rather than skip persistence").length - 1;
	assert.equal(
		occurrences,
		4,
		`${chainPath} must carry the canonical empty-ledger-record clause once per lens section (risk, readability, reliability, resilience)`,
	);
});
