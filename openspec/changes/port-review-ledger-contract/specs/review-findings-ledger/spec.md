# Review findings ledger contract

## Purpose

Define the exhaustive first-pass, persisted findings ledger, judge/fix role split, and scoped re-review contract shared by the 4R review lenses (review-risk, review-readability, review-reliability, review-resilience) and judgment-day, replicated across every gentle-pi review surface and enforced by a drift-guard test.

## ADDED Requirements

### Requirement: Exhaustive first-pass loop-until-dry termination

Each 4R lens and judgment-day judge pass MUST run its first review as a bounded loop that keeps sweeping the target until a design-defined number of consecutive sweeps (N) yield zero new findings, instead of a single read. The loop MUST be finite, capped by a design-defined sweep ceiling. Default values are deferred to design; gentle-ai's shipped defaults (N = 2 consecutive dry sweeps, ceiling 4 sweeps, review-readability MAY relax to N = 1) apply unless design states otherwise.

#### Scenario: First pass loops until dry

- GIVEN a lens or judge begins its first pass on a target
- WHEN each sweep runs
- THEN the lens MUST keep sweeping until N consecutive sweeps yield no new findings, then stop and finalize the ledger

#### Scenario: Loop is bounded

- GIVEN a first pass reaches the design-defined sweep ceiling
- WHEN termination is evaluated
- THEN the lens MUST stop and MUST NOT sweep indefinitely, even if dry-sweep count N has not yet been reached

---

### Requirement: Persisted findings ledger

The first pass MUST emit a structured findings ledger. Each entry MUST identify the finding (id), file:line location, lens, severity, and resolution status. Exact field names, id format, and severity/status vocabularies are deferred to design; gentle-ai's shipped schema (`id`, `lens`, `location`, `severity`, `status`, `evidence`) applies as the default.

#### Scenario: Ledger captures required fields

- GIVEN a lens or judge completes an exhaustive first pass
- WHEN it emits the ledger
- THEN each entry MUST include an id, file:line location, lens, severity, and status

#### Scenario: Zero findings still produce a ledger record

- GIVEN a first pass finds nothing
- WHEN the ledger is finalized
- THEN the system MUST persist an empty ledger record rather than skip persistence

---

### Requirement: Ledger persistence honors the artifact store

Ledger persistence MUST follow the session's configured artifact store: an OpenSpec change artifact when the store is `openspec`, an Engram topic when the store is `engram`, or in-context only (no file or topic write) when the store is `none`.

#### Scenario: Store selects persistence target

- GIVEN the artifact store is `openspec`, `engram`, or `none`
- WHEN a lens or judge finalizes its ledger
- THEN it MUST be persisted respectively as a change artifact, an Engram topic scoped to the change (or review target, for ad-hoc judgment-day runs without a change), or kept in-context only

#### Scenario: None store writes nothing

- GIVEN the artifact store is `none`
- WHEN a lens or judge finalizes its ledger
- THEN no file or Engram artifact MUST be written, and the ledger MUST remain scoped to the current session

---

### Requirement: Scoped re-review contract

A re-review pass MUST take the persisted ledger and the fix diff as input and scope its work to (a) verifying each ledger finding's resolution and (b) reviewing only fix-touched lines. It MUST NOT re-read the full original target. A finding on an untouched line MUST be logged with a status distinguishing it as a first-pass quality signal, and MUST NOT by itself trigger another full round.

#### Scenario: Re-review verifies ledger findings within scope

- GIVEN a persisted ledger with open findings and a fix diff addressing them
- WHEN the re-review pass runs
- THEN it MUST update each finding's status to reflect resolution
- AND it MUST NOT perform a fresh full read of lines outside the fix diff

#### Scenario: Untouched-line finding is logged, not escalated

- GIVEN a re-review observes an issue on an untouched line
- WHEN the finding is recorded
- THEN it MUST be appended to the ledger tagged as a first-pass quality signal (never a new round trigger)
- AND it MUST NOT by itself cause a full review round to restart

---

### Requirement: Judge and fix-agent role split

Judge-role surfaces (review-* lenses, jd-judge-a, jd-judge-b) MUST run the exhaustive first-pass loop and emit findings ledger rows. The fix-agent role (jd-fix-agent) MUST NOT run an exhaustive sweep and MUST NOT emit new findings ledger rows; it is limited to applying confirmed fixes and updating each addressed finding's status to reflect completion.

#### Scenario: Judge surfaces sweep and emit findings

- GIVEN a review-* lens or a jd-judge agent runs its pass
- WHEN the pass completes
- THEN it MUST have run the exhaustive first-pass loop and emitted ledger rows for its findings

#### Scenario: Fix agent applies fixes without sweeping or emitting rows

- GIVEN jd-fix-agent receives a set of confirmed ledger findings to address
- WHEN it applies fixes
- THEN it MUST update each addressed finding's status to reflect completion
- AND it MUST NOT run an exhaustive sweep of its own
- AND it MUST NOT add new findings ledger rows

---

### Requirement: Judgment-day ledger and scoped re-judge

Judgment-day's judge agents (jd-judge-a, jd-judge-b) MUST apply the same exhaustive first-pass and persisted-ledger contract, and the re-judge pass following jd-fix-agent MUST follow the same scoped re-review contract as the 4R lenses.

#### Scenario: Judgment-day first pass is exhaustive and ledgered

- GIVEN jd-judge-a or jd-judge-b runs a first judgment pass
- WHEN the pass completes
- THEN it MUST loop until dry and persist a findings ledger per the artifact-store contract

#### Scenario: Re-judge is scoped

- GIVEN jd-fix-agent has applied fixes for ledgered findings
- WHEN the re-judge pass runs
- THEN it MUST verify ledger findings and review only fix-touched lines

---

### Requirement: Clauses live inside copy-pasteable prompt templates

The exhaustive-pass, ledger schema, and persistence clauses MUST be embedded inside the copy-pasteable prompt template body of each adopting asset, not in surrounding narrative or trailing prose that is not part of the template a caller copies and runs. The scoped re-review clause and both named execution-mode clauses govern the round AFTER a prompt is issued — not the prompt content itself — and instead live in the adopting asset's documented "## Ledger and Re-Judge Contract" prose section: a scoped re-judge prompt is composed by the orchestrator from the persisted ledger and the fix diff, not copied verbatim from the round-1 Judge Prompt template, so this subset does not need fence embedding to reach the caller.

#### Scenario: Clause is inside the template fence

- GIVEN an adopting asset defines a copy-pasteable prompt template
- WHEN the template's content boundaries are inspected
- THEN the exhaustive-pass, ledger schema, and persistence clauses MUST fall within those boundaries, not outside them in commentary text
- AND the scoped re-review and execution-mode clauses MUST be documented in the asset's "## Ledger and Re-Judge Contract" prose section instead

---

### Requirement: Contract coverage across every review surface

The exhaustive-pass, ledger, judge/fix role split, and scoped re-review contract MUST be present, worded per its role, across every inventoried gentle-pi review surface: the four review-* lens assets, jd-judge-a, jd-judge-b, jd-fix-agent (fix-role clause set only), the judgment-day skill and its reference documents, the orchestrator's 4R review section, and the SDD workflow's Review Workload Guard.

#### Scenario: Every judge surface carries the judge clause set

- GIVEN the four review-* lens assets and jd-judge-a/jd-judge-b are inspected
- WHEN their prompt templates are checked for the contract
- THEN each MUST contain the exhaustive-pass, ledger, persistence, and scoped re-review clauses

#### Scenario: Fix-agent surface carries only the fix clause set

- GIVEN jd-fix-agent's prompt template is inspected
- WHEN it is checked for the contract
- THEN it MUST contain only the fix-role clause set and MUST NOT contain exhaustive-pass or ledger-emission clauses

#### Scenario: Judgment-day skill, orchestrator, and workflow guard reference the contract

- GIVEN the judgment-day skill and its reference documents, the orchestrator's 4R review section, and the SDD workflow's Review Workload Guard are inspected
- WHEN each is checked for the contract
- THEN each MUST reference ledger persistence and scoped re-review consistent with its role

#### Scenario: No inventoried surface is left uncovered

- GIVEN all inventoried review surfaces are enumerated
- WHEN contract coverage is evaluated
- THEN every surface MUST include the contract, worded for its role (judge, fix, skill doc, or orchestrator section)

---

### Requirement: Drift-guard test enforces per-role clause parity

A TypeScript test MUST assert, per role, that each adopting asset's copy-pasteable prompt template contains its required clause slice, and MUST fail if any adopting asset's template diverges from the canonical clause wording for its role.

#### Scenario: Test fails on judge clause drift

- GIVEN a review-* lens or jd-judge asset's prompt template omits or alters a required judge clause
- WHEN the drift-guard test runs
- THEN the test MUST fail

#### Scenario: Test fails on fix-agent clause contamination

- GIVEN jd-fix-agent's prompt template contains an exhaustive-pass or ledger-emission clause that belongs only to the judge clause set
- WHEN the drift-guard test runs
- THEN the test MUST fail

#### Scenario: Test passes when all surfaces match the canonical clause set

- GIVEN every adopting asset's prompt template matches its role's required clause slice verbatim
- WHEN the drift-guard test runs
- THEN the test MUST pass
