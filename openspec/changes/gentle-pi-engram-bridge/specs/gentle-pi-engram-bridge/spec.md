# gentle-pi-engram-bridge Specification

## Purpose

Define truthful Engram memory capability detection and tool routing for Gentle Pi without secret ingestion or memory-provider substitution.

## Requirements

### Requirement: Capability State Truthfulness

The system MUST classify Engram bridge capability as `available`, `configured`, `unreachable`, `unavailable`, or `unknown` using runtime evidence, and MUST NOT claim `available` unless required memory operations are callable.

#### Scenario: Available when required operations are callable

- GIVEN active tools expose normalized operations for search, save, context, and get-observation
- WHEN capability is evaluated
- THEN status SHALL be `available`
- AND self-description SHALL state memory is actively available via Engram

#### Scenario: Configured but not callable

- GIVEN MCP config shape indicates Engram bridge intent
- AND active tools do not expose required callable operations
- WHEN capability is evaluated
- THEN status SHALL be `configured` or `unreachable` (per reachability evidence)
- AND prompt text MUST NOT claim active availability

#### Scenario: Unknown evidence path

- GIVEN contradictory or incomplete evidence that cannot determine reachability
- WHEN capability is evaluated
- THEN status MAY be `unknown`
- AND output SHALL include non-availability wording

### Requirement: Safe MCP Config Shape Detection

The system MUST detect Engram bridge configuration shape from approved config locations and metadata without reading or exposing secret/token values.

#### Scenario: Shape-only detection from config files

- GIVEN `.mcp.json`, `.pi/mcp.json`, or Pi-owned settings include Engram bridge structure
- WHEN config evidence is parsed
- THEN detector SHALL record configured evidence from structure/keys only
- AND detector MUST NOT read secret payload values

#### Scenario: No config signal

- GIVEN approved config locations have no Engram bridge structure
- WHEN capability is evaluated with no callable tools
- THEN status SHALL be `unavailable`

### Requirement: Canonical Memory Operation Mapping

The system MUST normalize direct, proxy, and prefixed tool names into canonical operations for `mem_search`, `mem_save`, `mem_get_observation`, `mem_context`, and session-summary equivalents.

#### Scenario: Direct names map to canonical operations

- GIVEN tools named `mem_search`, `mem_save`, `mem_get_observation`, `mem_context`, and `mem_session_summary`
- WHEN mapping runs
- THEN each SHALL resolve to its matching canonical operation

#### Scenario: Prefixed and proxy forms map consistently

- GIVEN tools are exposed as `engram_*`, `engram.*`, or proxy-style equivalents
- WHEN mapping runs
- THEN canonical operations SHALL resolve identically to direct forms
- AND missing required operations MUST block `available` status

### Requirement: Truthful Memory Protocol and Identity Text

The system MUST keep self-description and memory protocol statements aligned with evaluated capability status.

#### Scenario: Degraded messaging when not available

- GIVEN status is `configured`, `unreachable`, `unavailable`, or `unknown`
- WHEN system prompt is rebuilt
- THEN memory protocol text MUST describe degraded/non-active behavior
- AND it MUST NOT assert successful long-term memory writes

### Requirement: Provider Scope and Security Boundaries

The system SHALL NOT replace Engram with Pi memory packages unless an explicit decision artifact approves that change, and MUST prevent committing secrets or token values.

#### Scenario: No silent provider substitution

- GIVEN implementation planning or runtime fallback decisions
- WHEN no explicit decision artifact exists
- THEN Engram bridge SHALL remain the only targeted memory provider

#### Scenario: Secret-safe configuration and artifacts

- GIVEN config or test fixtures are added or updated
- WHEN artifacts are prepared for commit
- THEN token/secret literal values MUST NOT be present
- AND only env references or redacted placeholders MAY be used
