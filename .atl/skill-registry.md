# Skill Registry — gentle-pi

Last updated: 2026-05-10
Scope: sdd-init bootstrap for `gentle-pi` (openspec mode)

## Sources scanned

- User skills: `~/.config/opencode/skills`, `~/.claude/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.copilot/skills`
- Project skills: none detected in `.claude/skills`, `.agent/skills`, `skills/`
- Project conventions: `AGENTS.md`, `GENTLE_PI_HARNESSES.md`

Dedup rule applied: prefer project-level skills (none), then user-level. Excluded: `_shared`, `skill-registry`, and all `sdd-*` skills.

## Project standards (compiled)

1. Product direction is **specialized for Pi** (not generic ecosystem portability).
2. Keep implementation centered on `packages/coding-agent` unless scope is explicitly expanded.
3. Strict TDD is expected when testing capability exists.
4. After code changes, quality gate is `npm run check`.
5. Do not run `npm run dev`, `npm run build`, or repo-level `npm test` during agent execution.
6. For coding-agent suite tests, use local harness/faux-provider strategy.
7. Respect non-destructive git safety constraints and explicit user approval for commits/pushes.

## Selected skills and compact rules

### typescript
- Path: `/Users/alanbuscaglia/.config/opencode/skills/typescript/SKILL.md`
- Trigger: TypeScript strict patterns and best practices.
- Rules:
  - Preserve strict typing and avoid implicit/unsafe type widening.
  - Favor explicit domain types over broad utility fallbacks.
  - Validate API surface changes against existing type contracts.

### go-testing
- Path: `/Users/alanbuscaglia/.config/opencode/skills/go-testing/SKILL.md`
- Trigger: Go testing work (available but currently non-primary stack).
- Rules:
  - Use only when Go test paths are in scope.
  - Keep tests deterministic and isolated.
  - Maintain focused assertions and fixture clarity.

### playwright
- Path: `/Users/alanbuscaglia/.config/opencode/skills/playwright/SKILL.md`
- Trigger: Browser E2E tests.
- Rules:
  - Use page-object style and stable selectors.
  - Prefer deterministic setup/teardown.
  - Keep network/environment assumptions explicit.

### work-unit-commits
- Path: `/Users/alanbuscaglia/.config/opencode/skills/work-unit-commits/SKILL.md`
- Trigger: commit slicing and reviewable batches.
- Rules:
  - Group changes by coherent behavior slice.
  - Keep test and docs updates with the behavior they validate.
  - Optimize for reviewer cognitive load, not bulk throughput.

### chained-pr
- Path: `/Users/alanbuscaglia/.config/opencode/skills/chained-pr/SKILL.md`
- Trigger: large changes or stacked review strategy.
- Rules:
  - Split oversized work into dependency-aware PR slices.
  - Preserve independent verifiability per PR.
  - Avoid coupling unrelated risk in one review unit.

### branch-pr
- Path: `/Users/alanbuscaglia/.config/opencode/skills/branch-pr/SKILL.md`
- Trigger: preparing/opening PRs.
- Rules:
  - Validate issue linkage and branch readiness first.
  - Summarize intent, risk, and verification evidence.
  - Keep PR body concise and technically auditable.

### pr-review
- Path: `/Users/alanbuscaglia/.config/opencode/skills/pr-review/SKILL.md`
- Trigger: structured PR/issue reviews.
- Rules:
  - Evaluate correctness, risk, and test evidence before style.
  - Flag missing contracts/spec alignment explicitly.
  - Prioritize actionable comments with concrete remediation.

### comment-writer
- Path: `/Users/alanbuscaglia/.config/opencode/skills/comment-writer/SKILL.md`
- Trigger: comments in GitHub/Jira/Slack/etc.
- Rules:
  - Keep tone direct, warm, and technical.
  - Prefer concise statements over narrative prose.
  - Post one final corrected comment when publishing.

### docs-writer
- Path: `/Users/alanbuscaglia/.config/opencode/skills/docs-writer/SKILL.md`
- Trigger: README/guides/reference docs.
- Rules:
  - Optimize for operational clarity and onboarding speed.
  - Keep docs aligned with actual runtime behavior.
  - Avoid aspirational content unsupported by code.

### cognitive-doc-design
- Path: `/Users/alanbuscaglia/.config/opencode/skills/cognitive-doc-design/SKILL.md`
- Trigger: architecture and review-facing docs.
- Rules:
  - Reduce cognitive load with explicit structure.
  - Separate decisions, constraints, and examples.
  - Keep high-signal summaries near the top.

### repo-hardening
- Path: `/Users/alanbuscaglia/.config/opencode/skills/repo-hardening/SKILL.md`
- Trigger: contribution gates/templates/policies.
- Rules:
  - Enforce contributor and review guardrails in automation.
  - Keep policy intent explicit in workflow files.
  - Prevent silent bypass paths for governance controls.

### release-note-safety
- Path: `/Users/alanbuscaglia/.config/opencode/skills/release-note-safety/SKILL.md`
- Trigger: release notes and multiline markdown safety.
- Rules:
  - Preserve markdown integrity for shell/CLI rendering.
  - Escape sensitive formatting boundaries correctly.
  - Validate generated text before publishing.

## Activation hint for orchestrator

- Default stack path for next phases: `typescript` + `work-unit-commits` + `pr-review`.
- Add `chained-pr` when workload forecast indicates high review risk.
- Add `playwright` only if browser E2E becomes explicit scope.
