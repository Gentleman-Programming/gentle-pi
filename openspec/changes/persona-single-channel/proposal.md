# Proposal: Persona single channel

## Intent

**Problem.** A Pi parent session receives identity/persona/language rules through duplicated always-on channels. Within gentle-pi's own single injection (`gentle-ai.ts` wrapper `buildGentlePrompt` :166-201 + `orchestrator.md`, concatenated at :2204-2208), the **Identity Contract** appears twice (wrapper :179-184 vs `orchestrator.md` :5-21) and the **Language Boundary** appears twice (wrapper persona/`languageBoundary` :168-188 vs `orchestrator.md` :28-42). Persona intent is also duplicated across tools (gentle-ai's `APPEND_SYSTEM.md` persona section vs gentle-pi injection). Duplication drifts, wastes tokens every session, and makes "who owns identity" unclear.

## Scope

### In Scope
- ONE authoritative statement of identity + persona + language boundary inside gentle-pi's always-on injection; the other location becomes a short pointer (nothing lost).
- Union reconciliation against pre-change text: every normative rule from both copies is preserved (per `persona-canonical-channel` lesson — 3 real losses caught there).
- Single persona-constant source feeding the canonical block.
- Frozen-fixture migration test under `pnpm test` asserting the union (no normative rule dropped) and the measured byte delta.
- Documented cross-tool ownership contract: gentle-pi owns Pi-session identity/persona.

### Out of Scope
- Modifying gentle-ai's Pi adapter / `APPEND_SYSTEM.md`. Slimming its persona section is a **follow-up in the gentle-ai repo**, captured as an expectation doc (pattern: `engram-protocol-dedup/upstream-protocol-flag-contract.md`).
- Always-on vs lazy PLACEMENT of `orchestrator.md` sections — owned by `orchestrator-lazy-diet`.

## Capabilities

### New Capabilities
- `session-persona`: single-source identity/persona/language injection for a Pi parent session, with cross-tool ownership contract.

### Modified Capabilities
- None (no existing specs in `openspec/specs/`).

## Approach

Choose one canonical home inside the injection (recommend the wrapper block, since it carries the runtime `Current persona mode:` line and persona-constant selection). Reconcile the wrapper and `orchestrator.md` copies as a union into that home; replace the redundant copy with a one-line pointer. Keep a single persona constant. Static text, no runtime detection. RED-first frozen-fixture test locks the pre-change union before slimming.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extensions/gentle-ai.ts` (:148-201) | Modified | Canonical identity/persona/language block; single constant source |
| `assets/orchestrator.md` (:5-21, :28-42) | Modified | Duplicate Identity Contract + Language Boundary → pointer |
| test fixtures (`pnpm test`) | New | Frozen-fixture union + byte-delta migration test |
| cross-tool contract doc | New | gentle-pi ownership; gentle-ai follow-up expectation |

### Measured before/after (per parent session)

| Channel | Before | After | Note |
|---------|--------|-------|------|
| gentle-pi wrapper | ~1.9 KB | ~1.9 KB | canonical home (union) |
| `orchestrator.md` | 22,626 B | ~22.6 KB − dup | Identity (~0.9 KB) + Lang Boundary (~2.4 KB) copies → ~0.2 KB pointer |
| gentle-pi injection dedup | — | **≈ −3.1 KB** | exact delta frozen in apply RED test (chars/4 + byte assert) |
| gentle-ai `APPEND_SYSTEM.md` | 37,276 B | unchanged here | slimmed in gentle-ai follow-up |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dropping a normative rule during dedup | Med | Union reconciliation + frozen-fixture RED test |
| Conflict with `orchestrator-lazy-diet` (both touch same files) | High | This change lands FIRST (owns content); diet then relocates the deduped result (owns placement) |
| Cross-tool persona drift after gentle-ai follow-up | Low | Ownership contract doc states gentle-pi is canonical for Pi sessions |

## Rollback Plan

Single-repo revert of the `gentle-ai.ts` + `orchestrator.md` + test-fixture commits; `pnpm test` re-baselines. No data migration.

## Dependencies

- Sequencing with `orchestrator-lazy-diet` (parallel): land this change first.
- gentle-ai repo follow-up (out of scope): Pi adapter slims `APPEND_SYSTEM.md` persona per the ownership-contract expectation doc.

## Success Criteria

- [ ] Identity/persona/language stated once in gentle-pi's injection; other location is a pointer.
- [ ] Frozen-fixture test proves union (zero normative rules lost) and asserts the measured byte reduction.
- [ ] `pnpm test` green.
- [ ] Cross-tool ownership contract documented (gentle-pi owns Pi-session identity; gentle-ai follow-up recorded).
