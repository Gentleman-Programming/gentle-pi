# Review Ledger Contract (shared across the 4R review lenses and judgment-day)

Canonical source of truth for the exhaustive first-pass loop, the persisted
findings ledger, the artifact-store persistence branches, and the scoped
re-review/re-judge contract. Every review-* subagent asset, every jd-*
subagent asset, the orchestrator's "Review Execution Contract" subsection,
and the judgment-day skill docs hand-copy the clauses below verbatim so a
single test (`tests/review-ledger-contract.test.ts`) can assert they stay in
sync across every Pi review surface.

Why this exists: the 4R lenses (review-risk / R1, review-readability / R2,
review-reliability / R3, review-resilience / R4) and judgment-day previously
ran a single-pass read with no memory across rounds — each pass sampled a
different subset of real issues, and re-review surfaced old issues as if new.
Iterating never converged. This contract replaces that with a bounded
exhaustive first pass, a persisted ledger, and a re-review scoped to the
ledger plus the fix diff.

## Canonical block (hand-copy verbatim into every adopting asset)

**Exhaustive first pass.** Loop until dry: sweep the diff repeatedly until N consecutive sweeps yield zero new findings, then stop; the loop MUST be finite. Default N = 2 consecutive dry sweeps. R2 Readability MAY use N = 1. Hard ceiling: 4 sweeps regardless of N.

**Findings ledger.** Emit a findings ledger with this schema for every entry:

| Field | Values |
|-------|--------|
| `id` | `{LENS}-{NNN}` (e.g. `R1-001`) |
| `lens` | risk \| readability \| reliability \| resilience \| judgment-day |
| `location` | `path/to/file.ext:line` or `:start-end` |
| `severity` | BLOCKER \| CRITICAL \| WARNING \| SUGGESTION |
| `status` | open \| fixed \| verified \| wont-fix \| info |
| `evidence` | why it matters |

If the first pass finds nothing, persist an empty ledger record rather than skip persistence.

**Ledger persistence honors the artifact store.**
- `openspec`: write `openspec/changes/{change-name}/review-ledger.md`.
- `engram`: upsert topic `sdd/{change-name}/review-ledger` (ad-hoc judgment-day without a change: `review/{target-slug}/ledger`, where `target-slug` = `pr-{number}` when reviewing a PR, else the current branch name kebab-cased, else a kebab-case slug of the user-stated review target). If the engram upsert fails or the memory tool is unavailable, fall back to keeping the ledger inline in the response and explicitly report the degradation — never continue as if persistence succeeded.
- `none`: keep the ledger inline in the response; do not write files or Engram artifacts — the ledger lives only in this conversation; complete the review → fix → re-review loop within the session because it is not persisted across compaction.

**Scoped re-review.** A re-review pass takes the persisted ledger and the fix diff as input. It MUST verify each ledger finding's resolution and MUST review only fix-touched lines; it MUST NOT re-read the full original diff. A finding on an untouched line MUST be logged with status `info` as a first-pass quality signal and MUST NOT by itself trigger another full round.

Subagent execution-mode: this agent runs its lens exhaustively as a dedicated Pi subagent and returns its own ledger rows in its Output; the orchestrator merges those ledger rows into the persisted ledger.

## Notes on the schema (not part of the hand-copied block)

**N and the ceiling.** N = 2 catches the single-pass sampling gap; the ceiling caps runaway review cost. R2 Readability is suggestion-heavy and cheap to re-run, so it may relax to N = 1.

**Status lifecycle.** `open` (first-pass finding) → `fixed` (fix agent changed code) → `verified` (re-review confirmed resolved). `wont-fix` = accepted/deferred with reason. `info` = a new finding on an untouched line (first-pass quality signal, NOT a re-round trigger), and also covers judgment-day's `WARNING (theoretical)` items — JD's real/theoretical distinction collapses onto `severity=WARNING` plus `status` (`open` vs `info`), so JD and the 4R lenses write the same table.

**Judgment-day.** The re-judge pass (following jd-fix-agent) follows this same scoped re-review contract: it verifies ledger findings and reviews only fix-touched lines.

## Execution mode

Pi is subagent-primary ONLY: every review-*/jd-* surface has a dedicated Pi
subagent, so there is a single execution mode — no inline-mode clause exists
for this contract (dropped entirely, aligning with `assets/orchestrator.md`'s
stop-not-inline delegation policy). Each review-* / jd-judge-* agent runs its
lens exhaustively and returns its own ledger rows in its Output contract; the
orchestrator merges those subagent ledger rows into the persisted ledger and
persists per the branch above. `jd-fix-agent` carries a distinct fix
execution-mode clause instead: it applies only confirmed ledger findings and
hands control back to the orchestrator, which runs the scoped re-judge.

## Interfaces / Contracts

Canonical ledger row, rendered identically in every asset:

```
| id     | lens         | location         | severity | status | evidence         |
|--------|--------------|------------------|----------|--------|------------------|
| R1-001 | risk         | lib/x.ts:42      | CRITICAL | open   | secret hardcoded |
| JD-004 | judgment-day | lib/y.ts:88      | WARNING  | info   | theoretical path |
```

## Adopting assets

Hand-copy the sections above (Exhaustive first-pass, Findings ledger schema,
Ledger persistence, Scoped re-review, Subagent execution-mode) into:

- `assets/agents/review-{risk,readability,reliability,resilience}.md`
- `assets/agents/jd-judge-{a,b}.md`
- `assets/orchestrator.md` (Review Execution Contract subsection)
- `skills/judgment-day/SKILL.md` and `references/prompts-and-formats.md`

Exception: `assets/agents/jd-fix-agent.md` is NOT a hand-copy target for this
judge-oriented block. It carries the distinct fix-agent clause set — the fix
role applies confirmed fixes and does NOT run the exhaustive first-pass sweep and does NOT emit a findings ledger; instead it reads the ledger
entries the orchestrator confirmed and passed in the delegate prompt, and
sets each addressed entry's `status` to `fixed`, never adding new ledger
rows.
`references/prompts-and-formats.md` carries both: judge clauses in the Judge
Prompt template, fix clauses in the Fix Agent Prompt template.

Each judge surface also states the shared Subagent execution-mode sentence
above; `jd-fix-agent` and the Fix Agent Prompt template state the fix
execution-mode sentence instead. `tests/review-ledger-contract.test.ts`
enforces this parity with named, frozen clause arrays per role.
