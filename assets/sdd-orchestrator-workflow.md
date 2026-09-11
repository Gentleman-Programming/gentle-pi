# SDD Orchestrator Workflow

This is the lazy-loaded SDD workflow surface for el Gentleman on Pi. Read this file before handling `/sdd-*`, natural-language SDD requests, SDD continuation/routing, apply/verify/sync/archive work, or SDD/Judgment-Day phase delegation.

## SDD Workflow

SDD phases:

```text
init → explore → research (optional) → proposal → spec → design → tasks → apply → verify → sync → archive
```

Dependency graph:

```text
explore → research (optional) → proposal
proposal → spec ─┬→ tasks → apply → verify → sync → archive
proposal → design ┘
```

`/gentle-sdd-status [change]` is the read-only status action for resolving the active change, artifact paths, task progress, dependency readiness, and action context before apply/verify/sync/archive.

## Native SDD Dispatcher

The user expresses intent; they should not have to administer phases manually. For natural-language SDD requests and `/gentle-sdd-continue`, the parent/orchestrator must use the native status engine as the state authority, decide the next phase, and delegate only the phase that status marks ready.

Flow:

```text
user intent → preflight/init guard → native status engine → phase decision → subagent gets status JSON + generated instructions → artifact/progress write → status recalculation → continue or stop
```

Rules:

- `/gentle-sdd-status` is a debug/status command, not the main UX.
- `/gentle-sdd-continue` is the native dispatcher command: resolve status, choose the next ready phase, and carry status/instructions into the subagent prompt.
- `sdd-apply`, `sdd-verify`, `sdd-sync`, and `sdd-archive` must obey parent-provided native status; they must not reconstruct readiness from prompt inference when status JSON is present.
- Apply the Bounded Planning Routing contract below: a blocked apply dependency is not a blanket veto on planning. Non-planning phases must still obey their own dependency gates.
- `sdd-archive` cannot proceed unless native status says `dependencies.archive` is `ready` or `all_done` — UNLESS the store carve-out is active (`nextRecommended: "resolve-via-engram"`), in which case resolve archive readiness from Engram instead of treating `not_applicable` as a gate failure.
- **Non-authoritative store carve-out:** when `nextRecommended: "resolve-via-engram"` is set, native status is **not authoritative**. This applies to `artifactStore: engram`, `artifactStore: none`, and `artifactStore: both` when the `openspec/` directory does not exist. For non-authoritative stores: resolve readiness from Engram using the Engram memory tools injected by the memory provider on the change topic keys (`sdd/{change-name}/proposal`, `sdd/{change-name}/spec`, `sdd/{change-name}/design`, `sdd/{change-name}/tasks`, etc.). Do **not** treat `blockedReasons` or `not_applicable` dependency states from the native engine as real blockers when the store carve-out is active.

## Bounded Planning Routing

For authoritative native status, route only by the bounded `nextRecommended` token and dependency states; never infer a route from prose. Keep human diagnostics in `blockedReasons`, not in `nextRecommended`, and report them without discarding them to enable a route.

| `nextRecommended` | Planning route |
| --- | --- |
| `propose` | `sdd-proposal` |
| `spec` | `sdd-spec` |
| `design` | `sdd-design` |
| `tasks` | `sdd-tasks` |
| `sdd-propose` | `sdd-proposal` |
| `sdd-spec` | `sdd-spec` |
| `sdd-design` | `sdd-design` |
| `sdd-tasks` | `sdd-tasks` |

The unprefixed tokens come from the native Gentle AI v2 status contract; the `sdd-*` tokens come from Gentle Pi's local resolver. Both forms authorize the same bounded planning routes.

These planning routes remain runnable when missing planning artifacts leave `dependencies.apply: blocked`; do not require apply readiness to produce those artifacts. This is a planning-only exception, not permission to run apply or another blocked non-planning phase.

Before any planning launch, stop for ambiguous change selection, unresolved session preflight, or unsafe action context. Carry `actionContext` and prove planned writes are within the authoritative workspace or allowed edit roots; workspace-planning without allowed edit roots remains read-only. Planning does not bypass the init guard, pre-proposal gate, or phase approval requirements.

## Bounded Execution Routing

Execution routes accept the native Gentle AI v2 tokens and Gentle Pi's local `sdd-*` tokens without rewriting status:

| `nextRecommended` | Execution route |
| --- | --- |
| `apply` | `sdd-apply` |
| `sdd-apply` | `sdd-apply` |
| `verify` | `sdd-verify` |
| `sdd-verify` | `sdd-verify` |
| `archive` | `sdd-archive` |
| `sdd-archive` | `sdd-archive` |
| `sdd-sync` | `sdd-sync` |
| `remediate` | `sdd-apply` |

Native `remediate` maps to the mutating `sdd-apply` executor, never to the independent `sdd-verify` executor. It authorizes only the fail-closed Native Remediation Mode defined by `sdd-apply`, with the provider's exact remediation state, failed-evidence revision, phase instructions, and runtime-attempt binding.

For ordinary non-planning phases, stop when that phase's dependency is `blocked`. The `remediate` route is the only dependency-blocked exception: it repairs the failed verification that keeps `dependencies.verify` blocked, and it proceeds only when the Native Remediation Mode validates every required field. To prevent unrelated blockers from authorizing mutation, remediation requires the sole blocker to equal `remediationState.reason`; `applyState` and `dependencies.apply` must be `all_done`, while `dependencies.verify` must be `blocked`. When `nextRecommended` is `blocked` or `resolve-blockers`, report `blockedReasons` and stop. Unknown tokens do not authorize a launch. Non-empty `blockedReasons` forbid ordinary apply, sync, and archive work; `verify` or `sdd-verify` may run only when the verify dependency permits it, while `remediate` may run only through the validated remediation mode. This alias table does not bypass preflight, selection, action-context, or runtime-attempt authority. The non-authoritative `resolve-via-engram` store carve-out remains separate and does not bypass those gates.

## SDD Status Contract

Before `/gentle-sdd-continue`, `sdd-apply`, `sdd-verify`, `sdd-sync`, or `sdd-archive`, resolve and carry structured status. Lookup order: parent-provided status, then project override `.pi/gentle-ai/support/sdd-status-contract.md`, then globally installed `~/.pi/agent/gentle-ai/support/sdd-status-contract.md`, then the embedded `sdd-status` prompt contract. Do not use `assets/support/...` as a runtime path; that is only the package source path before installation.

Status must include:

- active change selection and how it was resolved;
- artifact store and paths/topics for proposal, specs, design, tasks, apply-progress, verify-report, and sync-report;
- task progress with exact unchecked `- [ ]` implementation task lines;
- dependency states for apply, verify, sync, and archive;
- `actionContext` with mode, workspace root, allowed edit roots, and warnings;
- next recommended action.

Do not guess the active change. If change selection is ambiguous, ask the user and stop. If `actionContext.mode: workspace-planning` and no allowed edit roots are provided, stop before apply/verify/sync/archive and ask for an explicit implementation/edit scope.

## Lazy SDD Preflight

Do not ask SDD setup questions on session start. The first time the user initiates an SDD process in a Pi session, run the SDD preflight once and keep those choices for the rest of that session. Runtime trigger detection is intentionally deterministic: slash SDD flows and `/gentle-sdd-init` run preflight automatically; for natural-language requests, the parent/orchestrator decides semantically whether SDD is needed and must run/reuse `/gentle:sdd-preflight` before continuing.

**Hard gate:** `openspec/config.yaml`, existing SDD changes, installed `.pi`/global SDD assets, or a todo named "preflight" are not session preflight. They are project context only. Do not mark SDD preflight complete, start `sdd-init`, launch SDD subagents/chains, or move to explore/proposal/spec/design/tasks until this session has an injected `## SDD Session Preflight` block or an equivalent resolution from the canonical authority order below.

On the first SDD invocation of EACH new interactive session, confirm the preflight choices even when valid preferences are saved. Persisted preferences and canonical defaults are preselected suggestions, not current-session consent. Offer confirmation of the grouped suggestions or changes; cancellation leaves preflight unresolved. Explicit current-session choices take precedence and, once resolved, are reused throughout that session. If `/gentle:sdd-preflight` is unavailable, perform the same confirmation inline. Headless sessions retain canonical/persisted defaults without UI. Missing Engram constrains the artifact store to `openspec` unless an incompatible explicit request needs a human decision.

Preflight canonical defaults are execution `auto`, artifact store `openspec`, delivery strategy `ask-on-risk`, and review budget `400`; capability and already-selected constraints may narrow them.

The grouped session confirmation includes defaulted and capability-constrained suggestions. If changes are requested, preselect saved values and omit redundant one-option selectors. Never reinitialize project context merely because a new session needs confirmation. `chain_strategy` remains deferred, and `exception-ok` requires explicit `size:exception` acceptance and is never inferred.

The exact `delivery_strategy` domain accepted by `sdd-tasks` and `sdd-apply` is `ask-on-risk`, `auto-chain`, `single-pr`, or `exception-ok`; above the review threshold, `auto-chain` resolves without asking again.

The package should ensure SDD assets are present as global Pi runtime assets without the user needing to remember per-project setup commands. If assets are missing, install them non-destructively into:

```text
~/.pi/agent/agents/sdd-*.md
~/.pi/agent/chains/sdd-*.chain.md
```

Manual install commands are recovery/debug paths, not the happy path. `/gentle:sdd-preflight` is the explicit preflight command for agent/orchestrator use. If the user explicitly changes SDD preferences later in the same session, follow the new instruction.

## Init Guard

Before any SDD flow, make sure project context exists. Where that context lives depends on the session's artifact store, so qualify the check by store before acting on it.

When the store is `openspec` or `both`, the local artifact is:

```text
openspec/config.yaml
```

If it is missing, ask the user for the minimal information needed or run `/gentle-sdd-init` if available.

When the store is `engram` or `none`, `/gentle-sdd-init` never writes that file, so its absence is expected and is not a missing init. Never re-trigger `/gentle-sdd-init` over it. Resolve project context from the Engram `sdd-init/{project}` topic for `engram`, or inline from the session for `none`, and ask the user only when that context is genuinely absent.

This init guard runs after the session preflight gate above; project config presence or absence never substitutes for session preflight choices. Do not proceed with a substantial SDD flow while pretending project context, testing capability, or session preflight choices are known.

## Artifact Store Policy

This package does not provide persistent memory by itself.

- Default: `openspec` artifacts in the repo.
- If a separate memory package is installed and callable, memory/hybrid flows may be used.
- Never claim memory exists because Gentle AI is installed.

## Execution Mode

Use the session's SDD preflight choice:

- `auto`: phases run back-to-back without pausing, but the orchestrator gatekeeper validates after each phase before launching the next.
- `interactive`: after each phase, show a concise summary and ask whether to adjust or continue.

If the user doesn't specify, default to `auto`. After scope approval, expect zero further prompts on the happy path and at most one actionable prompt per recoverable failure; the gatekeeper summarizes phase progress instead of interrupting except on a second consecutive gate failure or a genuine scope/product decision.

In interactive mode, between phases:

1. show concise phase result;
2. state next phase;
3. ask whether to continue or adjust.

Interactive approval is phase-scoped. A user response such as "continue", "dale", or "go on" approves only the immediate next phase, not the rest of the SDD pipeline. Do not treat a generated artifact as approved until the user has had a chance to review or explicitly delegate that review.

Before `sdd-proposal` in interactive mode, offer the user a proposal question round instead of silently deciding whether the proposal is clear enough. Explain that the questions are meant to improve the PRD/proposal by uncovering business understanding, business rules, implications, impact, edge cases, and product tradeoffs. Prefer 3–5 concrete product questions per round, then summarize the resulting assumptions and ask whether the user wants to correct anything or run a second question round. Cover business/product/PRD decisions: business problem, target users and situations, business rules, product outcome, current-state gap, implications and impact, edge cases, decision gaps, first-slice scope boundaries, non-goals, product constraints, and business tradeoffs. Do not ask about test commands, PR shape, changed-line budget, or other harness mechanics at proposal time unless the user explicitly asks to discuss delivery.

## Research and Pre-Proposal Gate

This gate is MANDATORY and applies in both execution modes; in interactive mode it runs alongside the proposal question round above, and the two never contradict: the question round shapes the proposal, the gate decides whether `sdd-proposal` may launch at all.

- Offer `sdd-research` immediately after `sdd-explore`. Research is optional until selected; selection makes completion mandatory.
- Before every proposal, invoke `sdd-proposal` only when selected research is `done` or research is unselected, product decisions are `confirmed`, evidence references are valid, and the selected artifact-store state is ready.
- The orchestrator owns product discovery. In automatic mode, unresolved product choices require one lossless grouped prompt with all context, options, consequences, allowed answers, and exact tokens; the orchestrator MUST persist the pending pre-proposal state before prompting, then STOP without invoking `sdd-proposal`.
- The proposer receives a confirmed pre-proposal handoff and MUST NOT interview the user or infer consent.
- Pi's native `gentle-pi.sdd-status` contract remains the sole status contract. Research and pre-proposal state are orchestrator-owned prose and artifacts (`sdd/{change}/research`, `sdd/{change}/preproposal`, `openspec/changes/{change}/research.md`) layered on top — never a native status field.

Runtime mapping: use the injected `## SDD Research Capabilities` resolved from package-approved exact tool names intersected with active tools. Official documentation requires only `fetch_content`; open-web requires ALL FOUR tools: `web_search`, `source_check`, `fetch_content`, and `get_search_content`, each active and approved/reachable in the child. None is optional; inventory admission is not evidence of execution. Preserve explicit agent/source restrictions. The research child receives only reachable approved names in its CLI allowlist and rechecks child-local availability. Generic `mcp` and dynamic `mcp__context7` gateways do not imply authorization for arbitrary servers or remote methods; without a verified narrow route they grant nothing.

Selected supported research MUST run and persist source-backed claims with exact tool calls, URLs, publisher/version, retrieval times, supporting excerpts and claim-to-source IDs. Tool inventory and search snippets are not evidence. Block only genuinely unavailable classes, retain partial results without unvalidated claims, and keep proposal readiness false until every selected class is complete. Never recommend skipping research because of a fictitious blanket restriction, invent citations, or substitute bash for missing tools. SDD chains treat research as unselected.

## Delivery Strategy

On the first SDD chain request in a session, resolve the delivery strategy from preflight (or ask once) and cache it:

- `ask-on-risk` — default; ask only when the tasks forecast detects review-budget risk.
- `auto-chain` — automatically split into chained/stacked PR slices when needed.
- `single-pr` — proceed as one PR only if the size is within budget.
- `exception-ok` — user accepts `size:exception` when over budget. The preflight menu cannot select this; it is reached only when the user explicitly accepts `size:exception`, either up front or when `ask-on-risk` stops to ask.

These four are the whole domain. Pass `delivery_strategy` to `sdd-tasks` and `sdd-apply`.

## Chain Strategy

When delivery planning yields chained PRs, ask once for chain strategy and cache it:

- `stacked-to-main` — each PR targets the previous PR branch or main in sequence.
- `feature-branch-chain` — PR #1 targets the tracker branch; child PRs target the immediate previous PR branch; only the tracker merges to main.

When chained PRs are selected, treat the registry skill `gentle-ai-chained-pr` as a required skill match. Resolve and forward it by registry path to `sdd-tasks` and `sdd-apply`; do not hardcode its path.

Pass it as `chain_strategy` to `sdd-tasks` and `sdd-apply` prompts alongside `delivery_strategy`.

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

### Key Learnings closing block (routing)

Every installed SDD phase executor agent (`assets/agents/sdd-*.md`) carries the effective `## Key Learnings Closing` contract in its own loaded prompt; this workflow file documents routing only and is not the executor authority. Each phase executor closes its final report text with a `## Key Learnings` block that the Engram memory provider passively extracts. Generic delegated workers receive the same closing instruction via `assets/orchestrator-delegation.md`.

## Automatic Mode Gatekeeper

In `auto` execution mode, the parent/orchestrator is the quality gate between SDD phases. After a delegated phase returns and before launching the next phase, validate that the phase actually reached its objective. This validation is autonomous: do not ask the user on the happy path, but stop and report if the gate catches a real problem.

Check every phase result against the Result Contract:

- **Contract conformance:** the phase returned `status`, `executive_summary`, `artifacts`, `next_recommended`, `risks`, and `skill_resolution`, and `status` indicates success rather than partial, failed, or blocked.
- **Artifact existence:** every declared artifact exists and is readable in the active backend. For memory-backed flows, retrieve the topic with the available memory tools; for OpenSpec/file-backed flows, read the declared path. A successful phase with no retrievable artifact fails the gate.
- **No hallucinated references:** spot-check concrete file paths, symbols, commands, and artifacts the phase claims it created or used. Referenced paths or artifacts that do not resolve fail the gate.
- **No scope drift:** the output must stay consistent with its inputs and the dependency graph: spec stays within proposal scope, design answers the proposal, tasks cover spec and design, apply implements the tasks, verify checks the implementation against the spec, and sync reflects the verified state before archive.
- **Routing coherence:** `next_recommended` must follow the SDD dependency graph, and no unaddressed critical risk may be carried silently into the next phase.

Use cost-aware validation:

- For lower-risk phases (`sdd-explore`, `sdd-research`, `sdd-spec`, `sdd-tasks`, `sdd-sync`, `sdd-archive`), the parent may validate inline by reading artifacts back and checking claims.
- For higher-risk phases (`sdd-design`, `sdd-apply`), validate the artifact, declared paths, task state, and focused test evidence directly before continuing because errors there compound downstream.
- If a gate finds any smell — missing artifact, status mismatch, unresolved path, likely drift, or critical risk — rerun the same SDD phase once with corrective feedback. SDD phase validation does not start ordinary review or Judgment Day.

On gate pass, continue automatically to the next phase. On gate fail, rerun the same phase exactly once with corrective feedback naming the specific failures. Validate the rerun. If it fails again, stop the automatic chain and report the phase, failures from both attempts, and the recommended fix. Never advance to dependent phases on a failed gate.

The gatekeeper is additive: it does not relax the Review Workload Guard, Strict TDD Forwarding, native status dependency checks, or mandatory delegation rules. It never creates a post-SDD review pass.

## Native Runtime Attempt Authority

The package-local Gentle AI runtime owns the Git-common-dir compact SDD attempt ledger. It is the sole attempt and changed-line budget authority for both OpenSpec and Engram flows on Pi. Pi must not implement a local attempt mirror, counter, token store, state machine, or extension interception layer; such code would duplicate provider authority and could not truthfully settle all runs.

Before every runtime-bearing `sdd-apply`, `sdd-verify`, or remediation actor/harness launch, the orchestrator MUST call the compact acquire:

```text
gentle-ai sdd-attempt acquire --cwd <repo> --change <change> --request-id <id> --work-unit <label> --evidence-goal <goal> --max-attempts <count> --max-changed-lines <count>
```

Pass `--token` only to continue an active attempt; pass `--remediates-evidence-revision` only for an unmanaged remediation. Do not invent continuation or remediation state the provider has not returned.

The provider returns exactly one routing state from `proceed|blocked|complete`:

- `proceed`: launch only on `proceed`; retain the opaque token for settle.
- `blocked`: do not launch; stop and report.
- `complete`: do not launch; the objective is settled.

Never persist caller-authored attempt counters, tokens, or state in OpenSpec artifacts, Engram memory, prompts, or any Pi-owned state.

After the external run completes, call the compact settle with a request ID distinct from acquire, reusing an operation's own ID only for idempotent replay of that exact operation:

```text
gentle-ai sdd-attempt settle --cwd <repo> --change <change> --token <token> --request-id <id> --outcome <failed|interrupted|passed> [--evidence-revision <sha256:...>] --diagnosis <text> --harness-disposition <reused|invalidated> --cleanup-evidence <text> --process-evidence <text>
```

Every settle field except `evidence-revision` is required: `cwd`, `change`, `token`, `request-id`, `outcome`, `diagnosis`, `harness-disposition`, `cleanup-evidence`, and `process-evidence`. For `failed` or `passed`, include `--evidence-revision` with the `sha256:...` evidence hash. For `interrupted`, omit the entire `--evidence-revision` flag. Pass `--successor-lineage` only for a distinct approved successor; the current/bound lineage remains itself otherwise. Pass `--remediates-evidence-revision` only when repairing a specific failed evidence revision. Settle derives binding and remediation inputs; the orchestrator never invents them.

`status`, `begin`, `finish`, and `reset` are diagnostic/compatibility surfaces, not the normal runtime route. Route continuation only from the provider-returned `proceed|blocked|complete`. `reset` is never automatic and requires an explicit maintainer scope decision.

### Gatekeeper Reconciliation

The Automatic Mode Gatekeeper one-rerun rule above is a quality gate, not a launch authorization. A rerun never bypasses native attempt authority: every rerun still requires a fresh compact acquire, and the rerun must stop immediately if the provider returns `blocked` or `complete`. The gatekeeper quality rule is preserved and remains subordinate to this authority.

## SDD Phase Delegation Mode

Launch SDD phase subagents with `subagent_run` `mode: "task"` when the parent needs the phase result to route the next step. SDD phases, writers, dependent verify evidence, and archive are foreground-mandatory under the background subagent policy block in the delegation contract; background completion is a notification/history mechanism, not an orchestration resume guarantee.

## Model Assignments

Read this table before the first SDD/Judgment-Day phase delegation in a session, cache it, and use it only for SDD/Judgment-Day phase agents. If a phase is missing, use the `default` row. If the assigned tier is unavailable, use the runtime's default model and continue.

On Pi, phase model routing is user-owned and persisted, not prompt-passed: `/gentle:models` writes `.pi/gentle-ai/models.json`, and the package applies each saved assignment to the installed phase agent definitions (frontmatter `model:`/`thinking:`) or `.pi/settings.json` overrides. The table below is the default capability tier per phase when the user has saved no assignment.

**Mandatory phase model gate:** before launching an SDD/Judgment-Day phase agent, confirm the phase resolves through the saved model config or these defaults. Never pass an ad-hoc `model` parameter for SDD/Judgment-Day phases, and never apply this table to generic Pi delegation — generic subagents resolve model/thinking through `pi-subagents` config, and `model` is passed there only on an explicit user override.

| Phase        | Default tier   | Reason                                     |
| ------------ | -------------- | ------------------------------------------ |
| sdd-explore  | balanced       | Reads code, structural - not architectural |
| sdd-research | balanced       | Fail-closed evidence record keeping        |
| sdd-proposal | deep-reasoning | Architectural decisions                    |
| sdd-spec     | balanced       | Structured writing                         |
| sdd-design   | deep-reasoning | Architecture decisions                     |
| sdd-tasks    | balanced       | Mechanical breakdown                       |
| sdd-apply    | balanced       | Implementation                             |
| sdd-verify   | balanced       | Validation against spec                    |
| sdd-sync     | fast           | Reflect verified state                     |
| sdd-archive  | fast           | Copy and close                             |
| jd-judge-a   | deep-reasoning | Adversarial review                         |
| jd-judge-b   | deep-reasoning | Adversarial review                         |
| jd-fix-agent | balanced       | Surgical confirmed fixes                   |
| default      | balanced       | SDD/JD phase fallback                      |

## Sub-Agent Launch Deduplication

Maintain a session-scoped launch log of `(phase, task-fingerprint)` pairs. If the same pair already exists, do NOT launch again. Emit exactly one launch per distinct task and append the pair after launch.

## Sub-Agent Launch Protocol

Pre-flight before every SDD/Judgment-Day phase launch:

1. Identify the phase key (`sdd-apply`, `sdd-verify`, `jd-judge-a`, etc.).
2. Confirm its model routing per the Model Assignments gate above.
3. Resolve matching skill paths once per session from the registry and pass exact `SKILL.md` paths under `## Skills to load before work`.
4. If a delegated result reports `skill_resolution` as `fallback-registry`, `fallback-path`, or `none`, re-read the registry before subsequent delegations.

**Key Learnings closing (generic delegations):** when delegating to generic agents (`gentle-ai-explore`, `gentle-ai-worker`, `gentle-ai-verify`, scout/worker roles, or the native `Agent` fallback), apply the rule exactly as stated under "Key Learnings closing block" in `assets/orchestrator-delegation.md`. That file is the single statement of the rule; do not restate or paraphrase it here. SDD phase launch prompts need no such injection: every installed SDD phase executor already carries the effective contract in its own prompt (see "Key Learnings closing block (routing)" above).

## Strict TDD Forwarding

For `sdd-apply` and `sdd-verify`, read `openspec/config.yaml` when present.

If it declares strict TDD and a test command, include a non-negotiable instruction in the phase prompt:

```text
STRICT TDD MODE IS ACTIVE. Test runner: <command>. Follow RED, GREEN, TRIANGULATE, REFACTOR. Record evidence.
```

Do not rely on the child agent to discover this independently.

## Archive Final-State Handoff

When launching `sdd-archive`, forward explicit final-state facts for any work completed after `apply-progress`, `verify-report`, or `sync-report` were persisted — verify warnings fixed in later commits, blockers resolved, tasks finished, updated test or issue counts — with commit or evidence references where available. Those artifacts are intermediate snapshots, valid at the time they were written; the archive report records the state at close, and explicit final-state facts in the `sdd-archive` launch prompt outrank stale snapshot claims.

## Review Workload Guard

After `sdd-tasks` completes and before launching `sdd-apply`, inspect the task output's `Review Workload Forecast`.

If it says `Chained PRs recommended: Yes`, `400-line budget risk: High`, estimated changed lines exceed 400, or `Decision needed before apply: Yes`, apply the cached `delivery_strategy`:

- `ask-on-risk`: stop and ask whether to split or proceed with `size:exception`.
- `auto-chain`: split automatically; ask for `chain_strategy` only if missing.
- `single-pr`: stop and require/record `size:exception` before apply.
- `exception-ok`: continue and tell `sdd-apply` this run uses `size:exception`.

Any other `delivery_strategy` value is invalid. Do NOT pick the nearest branch and do NOT proceed: STOP, report the unrecognised value, and re-collect the delivery strategy before launching `sdd-apply`.

Always pass the resolved `delivery_strategy`, `chain_strategy`, and any chosen PR boundary/exception to `sdd-apply` in the launch prompt.

Any review transaction explicitly started outside SDD persists through its own artifact-store branch and budget. SDD completion itself launches no review actors and mints no review authority.

Automatic mode does not override reviewer burnout protection.

## Recovery

- `engram` → resolve state with the injected memory search/get tools on the change topic keys (`sdd/{change-name}/...`).
- `openspec` → read `openspec/changes/<change>/` artifacts and re-derive readiness through the native status engine.
- `none` → state is not persisted; explain the limitation.

## Provider Defect Handoff

When an SDD task encounters a possible Gentle AI provider defect, the full contract lives in `assets/orchestrator-delegation.md` under `#### Gentle AI Provider Defect Handoff (MANDATORY)`. This workflow intentionally provides no summary, alternate report route, or RDD lifecycle instruction.
