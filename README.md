# gentle-pi

[![npm](https://img.shields.io/npm/v/gentle-pi?color=blue)](https://www.npmjs.com/package/gentle-pi)
[![pi package](https://img.shields.io/badge/Pi-package-6f42c1)](https://pi.dev/packages/gentle-pi)
[![license](https://img.shields.io/npm/l/gentle-pi?color=blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Gentleman-Programming/gentle-pi?style=flat&color=yellow)](https://github.com/Gentleman-Programming/gentle-pi/stargazers)
[![Gentle-AI](https://img.shields.io/badge/Gentle--AI-ecosystem-ff69b4)](https://github.com/Gentleman-Programming/gentle-ai)
[![Gentleman Programming](https://img.shields.io/badge/by-Gentleman%20Programming-black)](https://github.com/Gentleman-Programming)
[![YouTube](https://img.shields.io/badge/YouTube-Gentleman%20Programming-red?logo=youtube&logoColor=white)](https://www.youtube.com/c/GentlemanProgramming)
[![Discord](https://img.shields.io/badge/Discord-community-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/gentleman-programming-769863833996754944)
[![SDD/OpenSpec](https://img.shields.io/badge/SDD-OpenSpec-00ADD8)](#sddopenspec-flow)
[![Subagents](https://img.shields.io/badge/Pi-subagents-brightgreen)](#what-it-adds)

**Turn Pi from a powerful coding agent into a controlled development harness.**

`gentle-pi` installs **el Gentleman** in Pi: a senior-architect operating layer for Spec-Driven Development, focused subagents, strict TDD evidence, reviewable work units, safety guards, and project/user skill discovery.

Pi already has strong tools. `gentle-pi` adds the discipline for using them well.

`gentle-pi` is the Pi-native package from the [Gentle-AI ecosystem](https://github.com/Gentleman-Programming/gentle-ai), built by [Gentleman Programming](https://github.com/Gentleman-Programming): the broader open-source project for turning AI coding agents into disciplined engineering environments with SDD workflows, skills, memory integrations, model routing, and review guardrails across multiple agents.

Follow the project and the community around it:

- GitHub: [Gentleman-Programming](https://github.com/Gentleman-Programming)
- YouTube: [Gentleman Programming](https://www.youtube.com/c/GentlemanProgramming)
- Community Discord: [Gentleman Programming](https://discord.com/invite/gentleman-programming-769863833996754944)

Startup intro collaboration: thanks to [@aporcelli](https://github.com/aporcelli) for [`pi-gentle-startup`](https://github.com/aporcelli/pi-gentle-startup), which inspired the clean-screen startup animation, compact runtime panel, and pink visual treatment.

## The problem

Most coding-agent sessions fail for operational reasons, not model reasons:

- the agent jumps into code before requirements are clear;
- architectural decisions disappear into chat history;
- one request quietly becomes a huge multi-area diff;
- tests run late, or not at all;
- reviewers get handed a wall of changes;
- subagents are available, but the parent session has no orchestration discipline;
- project skills exist, but the model forgets to load them.

`gentle-pi` fixes the workflow around the agent.

## What it adds

| Capability                     | What it does                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **el Gentleman persona**       | Makes Pi behave like a senior architect and teacher, not a generic chatbot. Spanish responses use Rioplatense voseo by default; neutral mode is saved globally with project overrides. |
| **Configurable startup intro** | Adds a rose/text-logo startup intro, compact runtime panel, color presets, and commands to hide or show the decorative parts.                  |
| **Work routing discipline**    | Small tasks stay inline. Context-heavy exploration can be delegated. Large or risky changes go through SDD/OpenSpec.                          |
| **SDD/OpenSpec assets**        | Installs phase agents and chains for `init`, `onboard`, `explore`, `proposal`, `spec`, `design`, `tasks`, `apply`, `verify`, `sync`, and `archive`. |
| **Lazy SDD preflight**         | Asks once per session for SDD mode, artifact store, PR chaining strategy, and review budget before the first SDD flow.                        |
| **Subagent orchestration**     | Keeps one parent session responsible while child agents explore, implement, test, or review with focused context.                             |
| **Strict TDD support**         | When project config declares a test command, apply/verify phases must record RED → GREEN → TRIANGULATE → REFACTOR evidence.                   |
| **Reviewer protection**        | Surfaces review workload risk before a task turns into an oversized PR.                                                                       |
| **Per-agent model assignment** | Pi-native modal for assigning stronger or cheaper models to specific SDD/custom agents.                                                       |
| **Skill discovery registry**   | Maintains `.atl/skill-registry.md` from project and user skills so review/comment/PR workflows do not silently miss the right skill.          |
| **Skill creation workflow**    | Provides the `skill-creator`/`skill-improver` skills, `/skill-creation` prompt, and packaged style guide for LLM-first skills.                 |
| **Delivery skills**            | Includes issue-first PRs, chained PRs, work-unit commits, cognitive docs, comment writing, and Judgment Day review.                           |
| **Runtime safety**             | Blocks destructive shell commands, asks for confirmation for sensitive operations, and blocks direct read/write/edit access to sensitive paths. |

## Install

```bash
pi install npm:gentle-pi
```

Recommended companion packages:

```bash
pi install npm:pi-subagents-j0k3r
pi install npm:pi-intercom
pi install npm:gentle-engram
pi install npm:pi-web-access
pi install npm:pi-lens
pi install npm:@juicesharp/rpiv-todo
pi install npm:@juicesharp/rpiv-ask-user-question
```

Then start Pi in a project:

```bash
pi
```

`gentle-pi` provides SDD agents as global Pi runtime assets, not per-project setup. The first SDD flow in a session still runs a one-time SDD preflight for preferences; for natural-language requests, el Gentleman decides when SDD is needed and runs the explicit preflight first.

## Quick start

```text
/gentle-ai:status          Check package, SDD assets, OpenSpec, and global model config.
/gentle-ai:doctor          Run read-only diagnostics for SDD assets, config, tools, and guards.
/gentle-ai:sdd-preflight   Run or reuse the session SDD preflight explicitly.
/sdd-init                  Create or refresh openspec/config.yaml.
/gentle:models             Assign global model/effort routing to SDD/custom agents.
/gentle:persona            Switch between gentleman and neutral persona modes.
/gentle:banner             Configure startup rose, text logo, and color preset.
```

Typical flow:

1. Open Pi in your repo.
2. Run `/gentle-ai:status`.
3. Run `/sdd-init` once per project, or when test/project capabilities change. This also runs the session SDD preflight.
4. For a substantial change, ask Pi to use SDD. Natural-language requests are classified by the parent agent, not by brittle runtime regexes.
5. Review the phase artifacts instead of trusting floating chat context.

## How the harness decides what to do

`gentle-pi` routes through the smallest safe workflow:

| Request shape                                                               | Harness                      |
| --------------------------------------------------------------------------- | ---------------------------- |
| Small, clear, local edit                                                    | Inline direct work.          |
| Unknown codebase area or context-heavy investigation                        | Focused subagent delegation. |
| Large, ambiguous, architectural, product-facing, or high-review-risk change | SDD/OpenSpec flow.           |

The goal is not ceremony. The goal is to avoid accidental chaos. Once a task stops being small, delegation is mandatory.

### Delegation triggers

`gentle-pi` keeps the parent session thin and delegates at the narrowest useful point. When the Pi Subagents extension is installed, the preferred runtime is the `subagent_*` tool family because it runs the user's configured project/global subagent definitions and preserves history/background behavior. Use waiting/task mode when the parent must consume the result and continue the workflow; use background mode only for independent work where parent continuation is not required. If those tools are unavailable, the parent should fall back to Pi's native `Agent` tool or another available delegation mechanism. The requirement is delegation; the runtime is capability-dependent.

| Trigger                                                                                                                     | Required behavior                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Reading 4+ files to understand a flow                                                                                       | Launch `scout`, `context-builder`, or the closest read-only mapping subagent. |
| Touching 2+ non-trivial code files                                                                                          | Delegate one writer; do not continue inline unless delegation is unavailable. |
| Commit, push, or PR after code changes                                                                                      | Select a fresh-context review lens unless the diff is trivial docs/text.      |
| Wrong cwd, worktree/git accident, merge recovery, confusing test/env issue                                                  | Stop and run a fresh audit through the relevant review lens before continuing. |
| Long monolithic session with accumulating complexity, roughly 20 tool calls, 5 exploratory reads, or 2 non-mechanical edits | Pause and delegate the remaining work, or stop and explain the exact blocker. |

The intended balanced loop for a bounded bugfix is:

```text
parent git/status + clarify → scout when context-heavy → one worker writes → selected review lens audits → parent validates and reports
```

Fresh review lenses are intentionally not token-saving devices; they buy independent judgment. `scout`/`context-builder` save parent context by compressing broad exploration. `worker` preserves a single writer thread.

`reviewer` is not an installed subagent name. It is a routing intent. Select the concrete lens by risk profile:

| Context | Review lens |
| --- | --- |
| Clear naming, structure, maintainability, small refactors | `review-readability` |
| Behavior, state, tests, determinism, regressions | `review-reliability` |
| Shell/process integration, partial failures, recovery, degraded dependencies | `review-resilience` |
| Security, permissions, data exposure/loss, architecture, dependencies | `review-risk` |
| Large PR, hot path, or >400 changed lines | Full 4R: `review-risk`, `review-resilience`, `review-readability`, `review-reliability` |

If multiple rows match, run the narrow set that covers the risk. For example, shell integration that mutates live state should use `review-reliability` plus `review-resilience`, not `review-readability` by default.

## SDD/OpenSpec flow

```text
init
  ↓
explore → proposal → spec ─┬→ design ─┐
                            └─────────┴→ tasks → apply → verify → sync → archive
```

The main loop is intentionally file-backed when you choose `openspec` or `both`:

```text
planning artifacts                implementation evidence        canonical update
──────────────────                ───────────────────────        ────────────────
proposal/spec/design/tasks   →    apply-progress/verify-report → sync-report → archive-report
```

For substantial work, the parent session coordinates the flow and each phase writes artifacts. That gives you:

- explicit requirements and non-goals;
- design decisions that survive compaction;
- task plans reviewers can reason about;
- implementation evidence;
- verification reports;
- sync reports that update canonical specs while keeping the change active;
- archive notes for future agents.

### OpenSpec artifact model

`gentle-pi` treats OpenSpec-compatible behavior as part of the harness. You do not need to install the external OpenSpec CLI/package for SDD.

In file-backed modes, canonical accepted behavior lives in `openspec/specs/`, while active changes carry deltas under `openspec/changes/`:

```text
openspec/
├── specs/                                      # accepted source of truth
│   └── {domain}/spec.md
└── changes/
    ├── {change}/                              # active work
    │   ├── proposal.md
    │   ├── specs/{domain}/spec.md             # full spec or delta spec
    │   ├── design.md
    │   ├── tasks.md
    │   ├── apply-progress.md
    │   ├── verify-report.md
    │   └── sync-report.md
    └── archive/YYYY-MM-DD-{change}/           # immutable audit trail
```

Delta flow:

```text
openspec/changes/{change}/specs/{domain}/spec.md
        │
        │  sdd-sync applies ADDED / MODIFIED / REMOVED
        ▼
openspec/specs/{domain}/spec.md
        │
        │  sdd-archive moves the completed change folder
        ▼
openspec/changes/archive/YYYY-MM-DD-{change}/
```

When a canonical spec already exists, change specs use requirement operation sections:

```markdown
## ADDED Requirements

## MODIFIED Requirements

## REMOVED Requirements
```

`MODIFIED` requirements must include the full requirement block, including still-valid scenarios, because sync replaces the canonical block by requirement name. `sdd-sync` syncs file-backed deltas into `openspec/specs/{domain}/spec.md` while keeping the change active; `sdd-archive` then moves the synced change to `openspec/changes/archive/YYYY-MM-DD-{change}/`.

Engram-only mode is different by design: Engram is working memory and does not maintain a canonical spec merge layer. Use `openspec` or `both` (hybrid file + memory persistence) when you need canonical spec evolution.

## SDD preflight and project files

`gentle-pi` does not require SDD agents to be copied into every project. The package ensures global Pi SDD assets exist under the Pi agent home and treats project-local files only as overrides/debug copies. Slash SDD flows such as `/sdd-*`, `/sdd-init`, and the explicit `/gentle-ai:sdd-preflight` command run a lazy preflight and ask for session-scoped SDD preferences. For natural-language requests, the parent agent decides whether the work should use SDD and must run/reuse `/gentle-ai:sdd-preflight` before continuing.

```text
~/.pi/agent/agents/sdd-*.md
~/.pi/agent/chains/sdd-*.chain.md
~/.pi/agent/gentle-ai/support/strict-tdd*.md
```

The preflight choices are reused for later SDD flows in the same session:

- execution mode: `interactive` or `auto`;
- artifact store: `openspec`, or `engram`/`both` when callable memory tools are available;
- PR chaining strategy: `auto-forecast`, `ask-always`, `single-pr-default`, or `force-chained`;
- review budget line threshold.

It does **not** overwrite existing global assets unless you explicitly run:

```text
/gentle-ai:install-sdd --force
```

Manual preflight commands:

```text
/gentle-ai:sdd-preflight
/gentle:sdd-preflight
```

## Skill registry

`gentle-pi` keeps a local registry at:

```text
.atl/skill-registry.md
```

The registry scans project and user skill roots, not package-owned skills. It exists to catch workflow skills that are present on disk but not visible in Pi's injected skill list.

It scans common roots such as:

```text
./skills
.opencode/skills
.claude/skills
.gemini/skills
.cursor/skills
.github/skills
.codex/skills
.qwen/skills
.kiro/skills
.openclaw/skills
.pi/skills
.agent/skills
.agents/skills
.atl/skills
~/.pi/agent/skills
~/.config/agents/skills
~/.agents/skills
~/.kimi/skills
~/.config/opencode/skills
~/.config/kilo/skills
~/.claude/skills
~/.gemini/skills
~/.gemini/antigravity/skills
~/.cursor/skills
~/.copilot/skills
~/.codex/skills
~/.codeium/windsurf/skills
~/.qwen/skills
~/.kiro/skills
~/.openclaw/skills
```

Behavior:

- `.atl/` is added to `.gitignore` when needed;
- the registry refreshes on session start;
- startup refresh is skipped when Pi starts with `--no-skills` / `-ns`, `--no-skill-registry`, or `GENTLE_PI_NO_SKILL_REGISTRY=1`;
- `/skill-registry:refresh` forces regeneration;
- a best-effort watcher refreshes when skill files change;
- the registry indexes skill names, full descriptions, scope, and exact `SKILL.md` paths without copying skill body rules.

Skill discovery is a guardrail, not a workflow router: it helps Pi load the right skill without forcing extra ceremony.

`gentle-pi` also ships package-owned `skill-creator` and `skill-improver` skills plus the `/skill-creation` prompt for creating or updating project skills. Both skills use `docs/skill-style-guide.md` as their normative style contract. The workflow checks for duplicates, keeps `SKILL.md` concise, uses one-line trigger-rich frontmatter, and reminds maintainers to refresh the registry after skill changes.

Packaged skills include `cognitive-doc-design`, `comment-writer`, `judgment-day`, `skill-creator`, `skill-improver`, and the other delivery/review skills under `skills/`. SDD init is installed as the packaged `sdd-init` runtime agent under `assets/agents/` and refreshed with the SDD assets.

Delegation contract:

- parent/orchestrator resolves project/user skills from the registry and passes matching paths under `## Skills to load before work`;
- SDD subagents still use their assigned executor/phase skill;
- during normal runtime, subagents should not independently discover additional project/user `SKILL.md` files or the registry;
- fallback loading is degraded self-healing and must be reported via `skill_resolution` as `fallback-registry`, `fallback-path`, or `none`.

## Persona modes

```text
/gentle:persona
```

| Persona     | Behavior                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `gentleman` | Senior architect, teacher, direct technical feedback, Rioplatense Spanish/voseo when the user writes Spanish. |
| `neutral`   | Same discipline, warmer professional language, no regional expression.                                        |

Saved globally at:

```text
~/.pi/gentle-ai/persona.json
```

A project can still override the global default with:

```text
.pi/gentle-ai/persona.json
```

`/gentle:persona` writes the global config and updates an existing project override when one is present, so the current project does not stay stale. Run `/reload` or start a new Pi session after switching persona.

## Model and effort assignment

```text
/gentle:models
```

The modal discovers:

- project agents in `.pi/agents/` and `.agents/`;
- user agents in `~/.pi/agent/agents/` and `~/.agents/`;
- built-in agents from `pi-subagents-j0k3r` when present.

Recommended model/effort shape:

| Agent kind                 | Recommended model                                    | Recommended effort (`thinking`) |
| -------------------------- | ---------------------------------------------------- | ------------------------------- |
| Explore, proposal, archive | Fast and cheap is usually enough.                    | `off` to `low`                  |
| Spec, design, tasks        | Strong reasoning model.                              | `medium` to `high`              |
| Apply                      | Strong coding and tool-use model.                    | `medium` to `high`              |
| Verify / review            | Strong fresh-context model.                          | `high`                          |
| Tiny utilities             | Inherit active/default model unless they bottleneck. | `inherit`                       |

Saved globally at:

```text
~/.pi/gentle-ai/models.json
```

Existing project-local `.pi/gentle-ai/models.json` files are still read as a legacy fallback when no global model config exists, but `/gentle:models` writes the shared global config.

Inside `/gentle:models`, press `x` to export the saved routing to `~/.pi/gentle-ai/models.export.json`, or `r` to restore from that file after confirmation. Export uses a versioned envelope and restore writes the normal `models.json` shape before applying routing to agents.

Config shape (per agent):

```json
{
  "sdd-design": {
    "model": "anthropic/claude-sonnet-4",
    "thinking": "high"
  },
  "sdd-archive": {
    "model": "openai/gpt-5-mini"
  }
}
```

Legacy string entries are still accepted and treated as `model`-only config.

## Commands

| Command                          | What it does                                                        |
| -------------------------------- | ------------------------------------------------------------------- |
| `/gentle-ai:status`              | Shows package, SDD asset, OpenSpec, and global model config status. |
| `/gentle-ai:doctor`              | Runs read-only diagnostics for SDD assets, model/persona config, memory tools, and safety guards. |
| `/gentle:models`                 | Opens global model + effort assignment UI. Press `x` to export and `r` to restore saved routing. |
| `/gentle:persona`                | Switches global persona mode, with project override support.        |
| `/gentle:banner`                 | Configures startup banner rose, text logo, and color preset.        |
| `/gentle:toggle-rose`            | Toggles the startup rose.                                           |
| `/gentle:toggle-text-logo`       | Toggles the startup text logo.                                      |
| `/gentle:banner-color`           | Selects a startup banner color preset.                              |
| `/sdd-init`                      | Initializes or refreshes `openspec/config.yaml`.                    |
| `/gentle-ai:install-sdd`         | Repairs missing global SDD runtime assets without overwriting files. |
| `/gentle-ai:install-sdd --force` | Force-refreshes installed global SDD assets.                         |
| `/skill-registry:refresh`        | Regenerates `.atl/skill-registry.md`.                               |
| `/skill-creation`                | Creates or updates an LLM-first skill using the packaged `skill-creator` contract and style guide. |

Package-owned global SDD runtime assets are also refreshed automatically on session start when `gentle-pi` changes. Project-local `.pi/agents` and `.pi/chains` remain manual overrides and are never overwritten by startup refresh.

Startup banner settings are global and default to the current pink rose + text logo. Supported color presets are `pink`, `cyan`, `yellow`, and `green`. The `/gentle-ai:*` aliases are also available for every banner command.

Startup flag:

```text
pi --no-skill-registry
```

Use it when you want skills available normally but do not want Gentle AI to refresh/watch `.atl/skill-registry.md` on startup. `pi -ns` / `pi --no-skills` also skip the registry startup work because Pi is already disabling skill loading.

Compatibility aliases:

```text
/gentle-ai:models
/gentleman:models
/gentle-ai:persona
/gentleman:persona
/gentle-ai:banner
/gentle-ai:toggle-rose
/gentle-ai:toggle-text-logo
/gentle-ai:banner-color
```

## Included skills

- `gentle-ai` — harness discipline for controlled Pi work.
- `branch-pr` — issue-first PR preparation.
- `chained-pr` — split oversized changes into reviewable PR chains.
- `work-unit-commits` — commits as reviewable work units.
- `judgment-day` — blind dual review, fixes, and re-judgment.
- `cognitive-doc-design` — documentation that reduces cognitive load.
- `comment-writer` — concise, warm, postable collaboration comments.
- `issue-creation` — issue workflow with checks before creation.
- `skill-creator` — create LLM-first skills with valid frontmatter.
- `skill-improver` — audit and upgrade existing LLM-first skills.

## Memory

`gentle-pi` does **not** provide persistent memory by itself.

For memory, install the companion package:

```bash
pi install npm:gentle-engram
```

When memory tools are actually active, el Gentleman can save decisions, bug fixes, discoveries, user prompts, and session summaries across Pi sessions.

Memory contract for SDD delegation:

- parent/orchestrator owns memory retrieval and passes selected context into subagent prompts;
- subagents should not independently search memory during normal runtime unless explicitly instructed to retrieve a specific artifact or observation;
- subagents should save significant discoveries, decisions, bug fixes, and completed SDD phase artifacts before returning when memory tools are available;
- in memory/hybrid mode, SDD artifacts use stable topic keys such as `sdd/<change>/proposal`, `sdd/<change>/spec`, `sdd/<change>/design`, `sdd/<change>/tasks`, `sdd/<change>/apply-progress`, and `sdd/<change>/verify-report`.

## Package contents

| Path                           | Purpose                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `extensions/gentle-ai.ts`      | Injects identity, auto-refreshes global SDD assets, registers commands, applies model/persona config, exports/restores model routing, and enforces runtime safety. |
| `extensions/startup-banner.ts` | Shows and configures the startup intro, color presets, compact runtime panel, and collaboration credit.     |
| `extensions/sdd-init.ts`       | Registers `/sdd-init` for OpenSpec initialization.                                                         |
| `extensions/skill-registry.ts` | Maintains `.atl/skill-registry.md` from project/user skills and closes file watchers on shutdown.          |
| `assets/orchestrator.md`       | Parent-session orchestration contract.                                                                     |
| `assets/agents/`               | SDD agents installed as global Pi runtime assets.                                                          |
| `assets/chains/`               | SDD chains installed as global Pi runtime assets.                                                          |
| `assets/support/`              | Strict TDD support docs for apply/verify phases.                                                           |
| `skills/`                      | Gentle AI delivery and collaboration skills.                                                               |
| `prompts/`                     | Gentle-prefixed prompt templates, including `/skill-creation`.                                             |
| `docs/skill-style-guide.md`    | Normative style guide used by the packaged skill creation/improvement skills.                              |

## Development

Install from this repo:

```bash
pi install .
```

Validate before publishing:

```bash
pnpm test
bun build extensions/skill-registry.ts --target=node --format=esm --outfile=/tmp/skill-registry.js
node --experimental-strip-types --check extensions/gentle-ai.ts
node --experimental-strip-types --check extensions/sdd-init.ts
node --experimental-strip-types --check extensions/startup-banner.ts
npm pack --dry-run
```

Publish npm through GitHub Actions only:

```bash
gh workflow run publish.yml --repo Gentleman-Programming/gentle-pi --ref main -f dist-tag=latest
gh run watch <run-id> --repo Gentleman-Programming/gentle-pi --exit-status
npm view gentle-pi@<version> version --registry=https://registry.npmjs.org/
npm dist-tag ls gentle-pi --registry=https://registry.npmjs.org/
```

Do not run `npm publish` locally for `gentle-pi`; the GitHub workflow provides provenance, environment protection, and registry credentials.

## Principles

- Human control over agent momentum.
- Concepts before code.
- Artifacts over floating chat context.
- SDD when risk justifies it.
- Strict TDD when tests exist.
- One parent orchestrator, focused subagents.
- Reviewable changes over giant diffs.
