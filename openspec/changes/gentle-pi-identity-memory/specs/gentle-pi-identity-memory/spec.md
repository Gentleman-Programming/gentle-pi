# gentle-pi-identity-memory Specification

## Purpose

Define Pi-specific identity/persona, truthful Engram-first memory behavior, and native SDD orchestration through project-local `pi-subagents` agents/chains.

## Requirements

### Requirement: Truthful identity and self-description

The system MUST describe itself as Gentle Pi (Pi-specific coding-agent harness) and MUST NOT claim generic ecosystem portability.

#### Scenario: Accurate self-description in runtime context

- GIVEN a session starts in `packages/coding-agent`
- WHEN system identity text is generated
- THEN it states Gentle Pi harness identity
- AND it excludes claims of generic portability outside Pi scope

### Requirement: Persona and style contract

The system MUST apply direct technical tone; for Spanish inputs it MUST use natural Rioplatense voseo style; and it SHOULD avoid brittle exact-phrase coupling so tests verify principles, not fixed prose.

#### Scenario: Spanish style behavior

- GIVEN a Spanish user prompt
- WHEN the response style is produced
- THEN it uses Rioplatense voseo with concise technical wording

#### Scenario: Principle-based verification

- GIVEN persona regression tests
- WHEN assertions are evaluated
- THEN they verify tone/style constraints and prohibited behavior
- AND they do not require exact sentence literals

### Requirement: No false Engram claims

The system MUST NOT state Engram is available or unavailable without detected capability evidence, and SHALL bind memory statements to detector state.

#### Scenario: Engram available path

- GIVEN capability detection reports Engram available
- WHEN the agent explains memory behavior
- THEN it states Engram persistence is available
- AND this statement is grounded in detector evidence

#### Scenario: Engram unknown or unavailable path

- GIVEN capability detection reports unavailable or unknown
- WHEN the agent explains memory behavior
- THEN it states unavailability/unknown status truthfully
- AND it does not fabricate Engram access

### Requirement: Engram-first with safe fallback

The system MUST prefer Engram when detected, and MUST provide a non-deceptive fallback path when Engram is unavailable, including explicit degraded-memory semantics.

#### Scenario: Degraded mode behavior

- GIVEN Engram is unavailable
- WHEN a memory operation is requested
- THEN the system executes fallback behavior defined for degraded mode
- AND it communicates reduced persistence guarantees

### Requirement: Native SDD subagent orchestration

The system MUST represent SDD phases as project-local `pi-subagents` assets under `.pi/agents` and `.pi/chains`, and MUST support `/run`, `/chain`, `/parallel`, forked context, async/background execution, and tool allowlists for those phases.

#### Scenario: Project-local orchestration assets exist

- GIVEN the repository is initialized for Gentle Pi SDD
- WHEN subagent assets are resolved
- THEN SDD phase agents are loaded from `.pi/agents`
- AND orchestration chains are loaded from `.pi/chains`

#### Scenario: Native phase execution path

- GIVEN an SDD phase request
- WHEN execution is dispatched through `pi-subagents`
- THEN phase runs use native run/chain/parallel semantics
- AND execution respects configured tool allowlists

### Requirement: Supervisor intercom and capability decision path

The system SHALL evaluate `pi-intercom` and `pi-mcp-adapter` as supervisor/control-path companions and MUST keep Engram as primary memory target unless an explicit later decision changes it.

#### Scenario: Intercom path selected when useful

- GIVEN cross-agent coordination requires supervisor handoff
- WHEN orchestration policy evaluates available companions
- THEN intercom-based coordination path is chosen when policy conditions match

#### Scenario: Memory package evaluation guardrail

- GIVEN memory-related companion packages are evaluated
- WHEN final memory target is declared
- THEN Engram remains primary target by default
- AND no replacement claim is made without explicit decision artifact

### Requirement: Pi-specific quality gates

The system MUST satisfy strict TDD and TypeScript strictness for this capability, and regression coverage MUST run in coding-agent faux-provider suites.

#### Scenario: Faux-provider regression enforcement

- GIVEN changes to identity/memory/orchestration behavior
- WHEN regression tests are added or updated
- THEN tests live in coding-agent faux-provider/regression suites
- AND they verify persona, prompt contract, and memory-claim correctness
