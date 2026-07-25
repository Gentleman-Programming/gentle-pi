# Organic Review Parity Specification

## Purpose

Bring gentle-ai's organic review-mode behaviors (kill switch, consent, risk-evidence presentation, empty-candidate hint) to Pi's non-interactive runtime, gated behind capability negotiation so the parity code stays inert until a compatible gentle-ai release ships.

## Requirements

### Requirement: Capability-gated activation

The system MUST treat every organic-parity behavior (kill-switch consultation, native consent, `risk_evidence` presentation, empty-candidate hint) as inert unless `NATIVE_CLI_CONTRACTS` for the negotiated gentle-ai version reports the corresponding capability key (`mode`, `riskEvidence`, `hint`, `delivery`) as `true`. Every shipped `NATIVE_CLI_CONTRACTS` row, including 2.1.11, MUST report these keys `false` or absent.

#### Scenario: Pinned 2.1.11 stays inert

- GIVEN the negotiated gentle-ai version is the pinned 2.1.11
- WHEN a review flow starts
- THEN no organic-parity behavior activates and existing review behavior is unchanged

#### Scenario: Future capable version activates parity

- GIVEN a negotiated version's contract row reports `mode`, `riskEvidence`, `hint`, and `delivery` as `true`
- WHEN a review flow starts
- THEN the corresponding organic-parity behavior activates

### Requirement: Kill-switch consultation

Before any review flow that would consult consent or present risk evidence, the system MUST consult `review mode status` and MUST NOT proceed as if review were enabled unless status reports enabled. No code path may silently re-enable review mode once disabled; enabling review mode MUST occur only through the explicit `gentle:review-mode enable` command.

#### Scenario: Disabled by prior decision

- GIVEN `review mode status` reports disabled
- WHEN a review-eligible flow runs
- THEN the flow does not enable review mode implicitly and honors the disabled state

#### Scenario: Command-only re-enable

- GIVEN review mode is disabled
- WHEN no explicit `gentle:review-mode enable` command has run
- THEN automation MUST NOT toggle review mode to enabled

### Requirement: Kill-switch command surface

The system MUST expose a `gentle:review-mode` command supporting `status`, `disable`, and `enable` sub-actions, each requiring explicit user invocation.

#### Scenario: Status query

- GIVEN the user runs `gentle:review-mode status`
- WHEN the command executes
- THEN the current enabled/disabled state is reported without mutation

#### Scenario: Explicit disable

- GIVEN the user runs `gentle:review-mode disable`
- WHEN the command executes
- THEN review mode is recorded disabled for the current clone

#### Scenario: Explicit enable (recovery path)

- GIVEN the user runs `gentle:review-mode enable`
- WHEN the command executes
- THEN review mode is recorded enabled for the current clone

### Requirement: Native two-option consent

When review mode is enabled and no persisted per-clone consent latch exists, the system MUST ask the user a two-option consent question via `ctx.ui.confirm` (or the headless equivalent), presenting the native `risk_evidence` as the Why. Accepting MUST persist a per-clone (git common dir) latch that suppresses future prompts. Declining MUST NOT persist anything and MUST apply only to the current work unit.

#### Scenario: First-time accept

- GIVEN no consent latch exists for the current clone
- WHEN the user accepts the consent prompt
- THEN a per-clone latch is recorded and no further prompt occurs for this clone

#### Scenario: Decline is scoped

- GIVEN no consent latch exists for the current clone
- WHEN the user declines the consent prompt
- THEN nothing is persisted and the current work unit proceeds without the accepted behavior

#### Scenario: Existing latch skips the prompt

- GIVEN a persisted accept latch exists for the current clone
- WHEN a subsequent review-eligible flow runs
- THEN no consent prompt is shown

### Requirement: Headless consent semantics

When `ctx.hasUI === false`, the system MUST run the review, MUST NOT consume or persist the one-time consent question, and MUST surface a notice through Pi's logging/output channel. The system MUST NOT block on headless invocations and MUST NOT silently skip the review.

#### Scenario: Headless invocation

- GIVEN `ctx.hasUI` is `false` and no consent latch exists
- WHEN a review-eligible flow runs
- THEN the review runs, the consent question remains unconsumed, and a notice is logged

### Requirement: Empty-candidate hint surfaced

When the native start result reports an empty candidate with a `hint`, the system MUST surface that hint verbatim to the user rather than reporting only an empty/failure result.

#### Scenario: Empty candidate with hint

- GIVEN the native start result has an empty candidate and a non-empty `hint`
- WHEN the result is rendered
- THEN the hint text is shown to the user alongside the empty-candidate outcome

## Acceptance Criteria

All scenarios MUST be verifiable through automated tests against gating behavior, kill-switch state, consent persistence, headless notice emission, and hint rendering.
