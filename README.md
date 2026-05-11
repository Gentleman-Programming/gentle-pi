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

| Capability                     | What it does                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **el Gentleman persona**       | Makes Pi behave like a senior architect and teacher, not a generic chatbot. Spanish responses use Rioplatense voseo by default.      |
| **Work routing discipline**    | Small tasks stay inline. Context-heavy exploration can be delegated. Large or risky changes go through SDD/OpenSpec.                 |
| **SDD/OpenSpec assets**        | Installs phase agents and chains for `init`, `explore`, `proposal`, `spec`, `design`, `tasks`, `apply`, `verify`, and `archive`.     |
| **Subagent orchestration**     | Keeps one parent session responsible while child agents explore, implement, test, or review with focused context.                    |
| **Strict TDD support**         | When project config declares a test command, apply/verify phases must record RED → GREEN → TRIANGULATE → REFACTOR evidence.          |
| **Reviewer protection**        | Surfaces review workload risk before a task turns into an oversized PR.                                                              |
| **Per-agent model assignment** | Pi-native modal for assigning stronger or cheaper models to specific SDD/custom agents.                                              |
| **Skill discovery registry**   | Maintains `.atl/skill-registry.md` from project and user skills so review/comment/PR workflows do not silently miss the right skill. |
| **Delivery skills**            | Includes issue-first PRs, chained PRs, work-unit commits, cognitive docs, comment writing, and Judgment Day review.                  |
| **Shell safety**               | Blocks destructive shell commands and asks for confirmation for sensitive operations.                                                |

## Install

```bash
pi install npm:gentle-pi
```

Recommended companion packages:

```bash
pi install npm:pi-subagents
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

On session start, `gentle-pi` installs local SDD assets without overwriting your edits.

## Quick start

```text
/gentle-ai:status      Check package, SDD assets, OpenSpec, and model config.
/sdd-init              Create or refresh openspec/config.yaml.
/gentle:models         Assign models to SDD/custom agents.
/gentle:persona        Switch between gentleman and neutral persona modes.
```

Typical flow:

1. Open Pi in your repo.
2. Run `/gentle-ai:status`.
3. Run `/sdd-init` once per project, or when test/project capabilities change.
4. For a substantial change, ask Pi to use SDD.
5. Review the phase artifacts instead of trusting floating chat context.

## How the harness decides what to do

`gentle-pi` routes through the smallest safe workflow:

| Request shape                                                               | Harness                      |
| --------------------------------------------------------------------------- | ---------------------------- |
| Small, clear, local edit                                                    | Inline direct work.          |
| Unknown codebase area or context-heavy investigation                        | Focused subagent delegation. |
| Large, ambiguous, architectural, product-facing, or high-review-risk change | SDD/OpenSpec flow.           |

The goal is not ceremony. The goal is to avoid accidental chaos.

## SDD/OpenSpec flow

```text
init → explore → proposal → spec → design → tasks → apply → verify → archive
```

For substantial work, the parent session coordinates the flow and each phase writes artifacts. That gives you:

- explicit requirements and non-goals;
- design decisions that survive compaction;
- task plans reviewers can reason about;
- implementation evidence;
- verification reports;
- archive notes for future agents.

## Project files installed

On Pi `session_start`, `gentle-pi` copies these assets if they are missing:

```text
.pi/agents/sdd-*.md
.pi/chains/sdd-*.chain.md
.pi/gentle-ai/support/strict-tdd.md
.pi/gentle-ai/support/strict-tdd-verify.md
```

It does **not** overwrite existing files unless you explicitly run:

```text
/gentle-ai:install-sdd --force
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
.pi/skills
.agent/skills
.agents/skills
.claude/skills
.gemini/skills
~/.config/opencode/skills
~/.claude/skills
~/.gemini/skills
~/.cursor/skills
~/.copilot/skills
```

Behavior:

- `.atl/` is added to `.gitignore` when needed;
- the registry refreshes on session start;
- `/skill-registry:refresh` forces regeneration;
- a best-effort watcher refreshes when skill files change;
- skills without `## Compact Rules` are still listed with an instruction to load the full skill file.

Skill discovery is a guardrail, not a workflow router: it helps Pi load the right skill without forcing extra ceremony.

## Persona modes

```text
/gentle:persona
```

| Persona     | Behavior                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `gentleman` | Senior architect, teacher, direct technical feedback, Rioplatense Spanish/voseo when the user writes Spanish. |
| `neutral`   | Same discipline, warmer professional language, no regional expression.                                        |

Saved at:

```text
.pi/gentle-ai/persona.json
```

Run `/reload` or start a new Pi session after switching persona.

## Model assignment

```text
/gentle:models
```

The modal discovers:

- project agents in `.pi/agents/` and `.agents/`;
- user agents in `~/.pi/agent/agents/` and `~/.agents/`;
- built-in agents from `pi-subagents`.

Recommended model shape:

| Agent kind                 | Recommended model                                    |
| -------------------------- | ---------------------------------------------------- |
| Explore, proposal, archive | Fast and cheap is usually enough.                    |
| Spec, design, tasks        | Strong reasoning model.                              |
| Apply                      | Strong coding and tool-use model.                    |
| Verify / review            | Strong fresh-context model.                          |
| Tiny utilities             | Inherit active/default model unless they bottleneck. |

Saved at:

```text
.pi/gentle-ai/models.json
```

## Commands

| Command                          | What it does                                                 |
| -------------------------------- | ------------------------------------------------------------ |
| `/gentle-ai:status`              | Shows package, SDD asset, OpenSpec, and model config status. |
| `/gentle:models`                 | Opens model assignment UI.                                   |
| `/gentle:persona`                | Switches persona mode.                                       |
| `/sdd-init`                      | Initializes or refreshes `openspec/config.yaml`.             |
| `/gentle-ai:install-sdd`         | Reinstalls SDD assets without overwriting local files.       |
| `/gentle-ai:install-sdd --force` | Force-refreshes installed SDD assets.                        |
| `/skill-registry:refresh`        | Regenerates `.atl/skill-registry.md`.                        |

Compatibility aliases:

```text
/gentle-ai:models
/gentleman:models
/gentle-ai:persona
/gentleman:persona
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

## Memory

`gentle-pi` does **not** provide persistent memory by itself.

For memory, install the companion package:

```bash
pi install npm:gentle-engram
```

When memory tools are actually active, el Gentleman can save decisions, bug fixes, discoveries, user prompts, and session summaries across Pi sessions.

## Package contents

| Path                           | Purpose                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `extensions/gentle-ai.ts`      | Injects identity, installs assets, registers commands, applies model config, and protects shell execution. |
| `extensions/sdd-init.ts`       | Registers `/sdd-init` for OpenSpec initialization.                                                         |
| `extensions/skill-registry.ts` | Maintains `.atl/skill-registry.md` from project/user skills.                                               |
| `assets/orchestrator.md`       | Parent-session orchestration contract.                                                                     |
| `assets/agents/`               | SDD agents copied into `.pi/agents/`.                                                                      |
| `assets/chains/`               | SDD chains copied into `.pi/chains/`.                                                                      |
| `assets/support/`              | Strict TDD support docs for apply/verify phases.                                                           |
| `skills/`                      | Gentle AI delivery and collaboration skills.                                                               |
| `prompts/`                     | Gentle-prefixed prompt templates.                                                                          |

## Development

Install from this repo:

```bash
pi install .
```

Validate before publishing:

```bash
bun build extensions/skill-registry.ts --target=node --format=esm --outfile=/tmp/skill-registry.js
node --experimental-strip-types --check extensions/gentle-ai.ts
npm pack --dry-run
```

Publish:

```bash
npm publish
```

## Principles

- Human control over agent momentum.
- Concepts before code.
- Artifacts over floating chat context.
- SDD when risk justifies it.
- Strict TDD when tests exist.
- One parent orchestrator, focused subagents.
- Reviewable changes over giant diffs.
