# Exploration — persona-single-channel

## Problem

A Pi main session receives persona/identity/language content through MULTIPLE always-on channels (2026-07-08 audit, measured):

1. ~/.pi/agent/APPEND_SYSTEM.md (37,276 B ≈ 9,320 tokens) — written by gentle-ai's Pi adapter (starts with `<!-- gentle-ai:persona -->` marker; carries the full persona plus other gentle-ai marker sections). OUT OF SCOPE to modify from this repo, but its existence defines the dedup target.
2. gentle-pi's own runtime injection (extensions/gentle-ai.ts buildGentlePrompt :166-201, injected at :2208): "## el Gentleman Identity and Harness" wrapper (~1.9KB: identity contract + harness principles + language boundary) + GENTLEMAN_PERSONA_PROMPT (:148-154, ~430 B) or NEUTRAL_PERSONA_PROMPT (:156-164, ~560 B) selected from persona.json.
3. assets/orchestrator.md (22,626 B, appended right after the wrapper in the SAME injection) carries its OWN `## Identity Contract` (:5-21) and `## Language Boundary` (:28-42), repeating the wrapper's rules.

Net duplication: persona 2x across tools (APPEND_SYSTEM vs gentle-pi injection), identity contract 2x and language boundary 2x WITHIN gentle-pi's own injection, language/voseo rules 3x total across all channels.

## Verified facts

- The wrapper and orchestrator.md are concatenated into one systemPrompt append per parent session (gentle-ai.ts:2204-2208; named/SDD agents get a different branch).
- gentle-ai's persona-canonical-channel change (shipped today, archived at /home/gentleman/work/gentle-ai/openspec/changes/archive/2026-07-08-persona-canonical-channel/) established the pattern: ONE canonical tone channel per adapter, residual keeps only action/tooling directives, union reconciliation with nothing lost, migration tests with HEAD-frozen fixtures.
- Pi has no output-style mechanism; the candidate canonical channels are (a) gentle-ai's APPEND_SYSTEM persona section or (b) gentle-pi's own injection.

## Decision space for proposal

- Ownership: recommend gentle-pi OWNS Pi-session identity/persona (it is the Pi-native package; gentle-ai's Pi adapter would later slim its persona section — that is a gentle-ai follow-up change, out of scope here but the contract/expectation should be documented like the engram --protocol upstream contract was).
- Within gentle-pi: ONE statement of identity/language — dedupe wrapper vs orchestrator.md (keep in one place, pointer in the other), single persona constant source.
- Union rule from gentle-ai's lesson: reconcile as a union against the pre-change text with frozen-fixture migration tests — nothing lost (three real content losses were caught in gentle-ai's equivalent change today).

## Constraints

- Strict TDD (pnpm test); coordinate with orchestrator-lazy-diet (parallel change) — BOTH touch orchestrator.md and gentle-ai.ts: define file-region ownership or sequence the applies.
