## Exploration: gentle-pi-engram-bridge

### Current State
Gentle Pi memory truth is currently driven by `detectGentlePiMemoryCapability()` in `packages/coding-agent/src/core/gentle-pi/identity-memory.ts`, and prompt injection happens through `AgentSession._rebuildSystemPrompt()` via `gentlePi.identityMemory.renderPrompt(...)`. The detector only exposes `available | configured | unavailable | unknown` and treats callable Engram as tool-name pattern matching (`engram_`, `engram.`, or suffix `_mem_*`), while config evidence is coarse string scanning of `.mcp.json`, `.pi/mcp.json`, `.pi/settings.json`, `engram.json`, and `ENGRAM_*` env presence.

In this repo runtime today, `.mcp.json`, `.pi/mcp.json`, and `~/.config/mcp/mcp.json` are absent, and no `ENGRAM_*` env keys are set. `.pi/settings.json` exists and contains only package metadata/notes (including the `pi-mcp-adapter` recommendation), not a real callable MCP bridge. So runtime can honestly reach `configured` (from settings text) or `unavailable` depending on active tools, but it cannot currently express "configured but unreachable" as required by this change intent.

Pi tool visibility itself is prompt-snippet based (`system-prompt.ts`), and non-snippet custom tools are intentionally hidden from the "Available tools" section while still active at runtime. Tests already cover identity/memory truthful prompt claims (`test/suite/regressions/gentle-pi-identity-memory.test.ts`) and system-prompt behavior (`test/system-prompt.test.ts`), but there is no dedicated test matrix yet for MCP direct/proxy naming normalization or unreachable bridge state.

### Affected Areas
- `packages/coding-agent/src/core/gentle-pi/identity-memory.ts` — currently owns status model, tool-name matching, config signal scan, and memory protocol prompt text.
- `packages/coding-agent/src/core/gentle-pi/types.ts` — `GentlePiMemoryStatus` and capability typing must evolve to include truthful unreachable state and evidence.
- `packages/coding-agent/src/core/agent-session.ts` — passes active tool names into memory detector during system-prompt rebuild; key seam for truthful runtime claims.
- `packages/coding-agent/src/core/agent-session-services.ts` — seeds configured signals and package names at service creation; likely seam for richer MCP config probing inputs.
- `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` — existing regression anchor for memory truthfulness; should expand to direct/proxy mappings + unreachable state.
- `packages/coding-agent/test/system-prompt.test.ts` — protects identity prompt assembly/placement and available-tools self-description semantics.
- `.pi/settings.json` — currently package-notes only; if used for bridge hints, shape must remain secret-free and non-authoritative for availability.

### Approaches
1. **Enhance existing detector in-place** — Extend `identity-memory.ts` with MCP bridge shape parsing + normalized tool alias mapping + new `unreachable` state.
   - Pros: Minimal file spread, reuses existing prompt and service integration points, fast to land.
   - Cons: Risks turning one file into mixed concerns (config parsing, alias resolution, status policy); harder long-term maintainability.
   - Effort: Medium.

2. **Split detector into typed Engram bridge module (recommended)** — Keep prompt rendering in `identity-memory.ts` but move bridge discovery/normalization/state derivation into `gentle-pi/engram-bridge.ts` with strict typed inputs/outputs.
   - Pros: Cleaner separation (discovery vs policy vs prompt text), easier strict-TDD matrix, clearer Pi-specific MCP semantics without generic platform drift.
   - Cons: Slightly more refactor churn across imports/types/tests.
   - Effort: Medium.

### Recommendation
Use **Approach 2**. The requested outcome is not wording; it is runtime truthfulness across multiple evidence channels (callable tools, config hints, reachability). A dedicated typed bridge module keeps Pi-specific logic explicit and testable while preserving current `AgentSession` and prompt assembly seams.

### Risks
- False positives from config text scans (e.g., notes mentioning "Engram") can still inflate `configured` unless config parsing becomes shape-aware.
- Alias normalization for direct/prefixed/proxy tool names can miss edge naming conventions and produce wrong `available`/`unreachable` claims.
- Reachability checks must avoid secret reads and network side effects; over-aggressive probing could violate safety or slow startup.
- Prompt claims can drift from runtime capability if detector inputs and active tool surface are not synchronized per rebuild.

### Ready for Proposal
Yes — proposal should lock: (1) canonical Engram operation map (`search/save/context/get/...`) across direct/prefixed/proxy names, (2) explicit `configured-but-unreachable` contract and evidence semantics, (3) safe MCP config-shape handling with no secret ingestion, and (4) strict TDD regression matrix for truthful self-description and tool-availability states.
