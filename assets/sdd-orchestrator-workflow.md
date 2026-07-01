# SDD Orchestrator Workflow

This is the lazy-loaded SDD workflow surface for el Gentleman on Pi. Read this file before handling `/sdd-*`, natural-language SDD requests, SDD continuation/routing, apply/verify/sync/archive work, or SDD/Judgment-Day phase delegation.

## SDD Workflow

SDD phases:

```text
init → explore → proposal → spec → design → tasks → apply → verify → sync → archive
```

Dependency graph:

```text
proposal → spec ─┬→ tasks → apply → verify → sync → archive
proposal → design ┘
```

`/sdd-status [change]` is the read-only status action for resolving the active change, artifact paths, task progress, dependency readiness, and action context before apply/verify/sync/archive.

## Native SDD Dispatcher

The user expresses intent; they should not have to administer phases manually. For natural-language SDD requests and `/sdd-continue`, the parent/orchestrator must use the native status engine as the state authority, decide the next phase, and delegate only the phase that status marks ready.

Flow:

```text
user intent → preflight/init guard → native status engine → phase decision → subagent gets status JSON + generated instructions → artifact/progress write → status recalculation → continue or stop
```

Rules:

- `/sdd-status` is a debug/status command, not the main UX.
- `/sdd-continue` is the native dispatcher command: resolve status, choose the next ready phase, and carry status/instructions into the subagent prompt.
- `sdd-apply`, `sdd-verify`, `sdd-sync`, and `sdd-archive` must obey parent-provided native status; they must not reconstruct readiness from prompt inference when status JSON is present.
- Do not launch a phase when native status marks that dependency `blocked`.
- `sdd-archive` cannot proceed unless native status says `dependencies.archive` is `ready` or `all_done` — UNLESS the store carve-out is active (`nextRecommended: "resolve-via-engram"`), in which case resolve archive readiness from Engram instead of treating `not_applicable` as a gate failure.
- **Non-authoritative store carve-out:** when `nextRecommended: "resolve-via-engram"` is set, native status is **not authoritative**. This applies to `artifactStore: engram`, `artifactStore: none`, and `artifactStore: both` when the `openspec/` directory does not exist. For non-authoritative stores: resolve readiness from Engram using the Engram memory tools injected by the memory provider on the change topic keys (`sdd/{change-name}/proposal`, `sdd/{change-name}/spec`, `sdd/{change-name}/design`, `sdd/{change-name}/tasks`, etc.). Do **not** treat `blockedReasons` or `not_applicable` dependency states from the native engine as real blockers when the store carve-out is active.

## SDD Status Contract

Before `/sdd-continue`, `sdd-apply`, `sdd-verify`, `sdd-sync`, or `sdd-archive`, resolve and carry structured status. Lookup order: parent-provided status, then project override `.pi/gentle-ai/support/sdd-status-contract.md`, then globally installed `~/.pi/agent/gentle-ai/support/sdd-status-contract.md`, then the embedded `sdd-status` prompt contract. Do not use `assets/support/...` as a runtime path; that is only the package source path before installation.

Status must include:

- active change selection and how it was resolved;
- artifact store and paths/topics for proposal, specs, design, tasks, apply-progress, verify-report, and sync-report;
- task progress with exact unchecked `- [ ]` implementation task lines;
- dependency states for apply, verify, sync, and archive;
- `actionContext` with mode, workspace root, allowed edit roots, and warnings;
- next recommended action.

Do not guess the active change. If change selection is ambiguous, ask the user and stop. If `actionContext.mode: workspace-planning` and no allowed edit roots are provided, stop before apply/verify/sync/archive and ask for an explicit implementation/edit scope.

## Lazy SDD Preflight

Do not ask SDD setup questions on session start. The first time the user initiates an SDD process in a Pi session, run the SDD preflight once and keep those choices for the rest of that session. Runtime trigger detection is intentionally deterministic: slash SDD flows and `/sdd-init` run preflight automatically; for natural-language requests, the parent/orchestrator decides semantically whether SDD is needed and must run/reuse `/gentle-ai:sdd-preflight` before continuing.

**Hard gate:** `openspec/config.yaml`, existing SDD changes, installed `.pi`/global SDD assets, or a todo named "preflight" are not session preflight. They are project context only. Do not mark SDD preflight complete, start `sdd-init`, launch SDD subagents/chains, or move to explore/proposal/spec/design/tasks until this session has either:

1. an injected `## SDD Session Preflight` block, or
2. an explicit user answer in the current conversation covering all four preflight choices below.

If neither exists and `/gentle-ai:sdd-preflight` cannot be invoked from the current context, ask the four choices manually with `ask_user_question` before any SDD phase work. Treat missing Engram availability as a reason to ask/confirm artifact store, not as permission to assume defaults.

The preflight captures:

- execution mode: `interactive` or `auto`;
- artifact store: `openspec`, `engram`, or `both` when callable memory tools are available;
- chained PR strategy: `auto-forecast`, `ask-always`, `single-pr-default`, or `force-chained`;
- review budget in changed lines.

The package should ensure SDD assets are present as global Pi runtime assets without the user needing to remember per-project setup commands. If assets are missing, install them non-destructively into:

```text
~/.pi/agent/agents/sdd-*.md
~/.pi/agent/chains/sdd-*.chain.md
```

Manual install commands are recovery/debug paths, not the happy path. `/gentle-ai:sdd-preflight` and `/gentle:sdd-preflight` are the explicit preflight commands for agent/orchestrator use. If the user explicitly changes SDD preferences later in the same session, follow the new instruction.

## Init Guard

Before any SDD flow, make sure project context exists.

In this Pi package, the default local artifact is:

```text
openspec/config.yaml
```

If it is missing, ask the user for the minimal information needed or run `/sdd-init` if available. This init guard runs after the session preflight gate above; project config presence or absence never substitutes for session preflight choices. Do not proceed with a substantial SDD flow while pretending project context, testing capability, or session preflight choices are known.

## Artifact Store Policy

This package does not provide persistent memory by itself.

- Default: `openspec` artifacts in the repo.
- If a separate memory package is installed and callable, memory/hybrid flows may be used.
- Never claim memory exists because Gentle AI is installed.

## Execution Mode

Use the session's SDD preflight choice:

- `interactive`: default, pause between major phases and ask whether to continue.
- `auto`: run phases back-to-back when the user explicitly wants speed and trusts the flow.

In interactive mode, between phases:

1. show concise phase result;
2. state next phase;
3. ask whether to continue or adjust.

Interactive approval is phase-scoped. A user response such as "continue", "dale", or "go on" approves only the immediate next phase, not the rest of the SDD pipeline. Do not treat a generated artifact as approved until the user has had a chance to review or explicitly delegate that review.

Before `sdd-proposal` in interactive mode, offer the user a proposal question round instead of silently deciding whether the proposal is clear enough. Explain that the questions are meant to improve the PRD/proposal by uncovering business understanding, business rules, implications, impact, edge cases, and product tradeoffs. Prefer 3–5 concrete product questions per round, then summarize the resulting assumptions and ask whether the user wants to correct anything or run a second question round. Cover business/product/PRD decisions: business problem, target users and situations, business rules, product outcome, current-state gap, implications and impact, edge cases, decision gaps, first-slice scope boundaries, non-goals, product constraints, and business tradeoffs. Do not ask about test commands, PR shape, changed-line budget, or other harness mechanics at proposal time unless the user explicitly asks to discuss delivery.

## Result Contract

Every phase result should include:

```text
status
executive_summary
artifacts
next_recommended
risks
skill_resolution
```

The parent should synthesize these envelopes, not paste long raw reports unless needed.

## Strict TDD Forwarding

For `sdd-apply` and `sdd-verify`, read `openspec/config.yaml` when present.

If it declares strict TDD and a test command, include a non-negotiable instruction in the phase prompt:

```text
STRICT TDD MODE IS ACTIVE. Test runner: <command>. Follow RED, GREEN, TRIANGULATE, REFACTOR. Record evidence.
```

Do not rely on the child agent to discover this independently.

## Review Workload Guard

After `sdd-tasks` and before `sdd-apply`, inspect the task output for review workload risk.

If estimated changed lines exceed 400, chained PRs are recommended, or a decision is needed, pause and ask unless the user already approved a delivery strategy.

Automatic mode does not override reviewer burnout protection.
