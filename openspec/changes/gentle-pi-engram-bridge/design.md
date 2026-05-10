# Design: Gentle Pi Engram Bridge

## Technical Approach

Add a Pi-specific typed Engram bridge module and leave prompt rendering in `identity-memory.ts`. The bridge will safely inspect MCP config shape, normalize active tool names into canonical Engram operations, and derive `available | configured | unreachable | unavailable | unknown` without reading secrets or probing networks. No delta spec files exist for this change yet; this design follows `proposal.md` and `exploration.md`.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Bridge ownership | Create `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Keep all logic in `identity-memory.ts` | Keeps config parsing, alias normalization, and state derivation testable without bloating prompt code. |
| Config evidence | Parse known MCP JSON shapes and report sanitized path/server evidence only | Current substring scan | Prevents `.pi/settings.json` notes or secret values from becoming false “configured” evidence. |
| Availability | Require callable normalized tools for `available`; configured-without-callable becomes `unreachable` when tool surface was inspected | Treat config as usable | Matches runtime truth: config is not capability. |
| Scope | Support Engram direct/proxy aliases only | Generic MCP marketplace | Preserves Gentle Pi’s Pi-specific harness direction. |

## Data Flow

    createAgentSessionServices(cwd, agentDir)
      └─ discoverEngramBridgeConfig(project/user/global paths)
    AgentSession._rebuildSystemPrompt(active tools)
      └─ identityMemory.renderPrompt(activeToolNames)
           └─ deriveEngramBridgeState(config evidence + normalized tools)
                └─ truthful prompt + self-description

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Create | Typed discovery, config-shape parsing, operation alias normalization, and status derivation. |
| `packages/coding-agent/src/core/gentle-pi/types.ts` | Modify | Add `UNREACHABLE`, bridge evidence/operation types, and optional config evidence on detection input. |
| `packages/coding-agent/src/core/gentle-pi/identity-memory.ts` | Modify | Delegate detection to bridge module; render distinct available/configured/unreachable/unavailable protocol text. |
| `packages/coding-agent/src/core/agent-session-services.ts` | Modify | Pass `cwd` and `agentDir` into bridge discovery; remove broad `.pi/settings.json` text evidence. |
| `packages/coding-agent/src/core/agent-session.ts` | Modify | Continue passing active tool names per rebuild; no direct tool invocation or secret exposure. |
| `packages/coding-agent/src/core/system-prompt.ts` | Modify | Keep identity prompt placement; adjust tests only if wording changes. |
| `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Modify | Add bridge matrix tests and update legacy config expectations. |
| `packages/coding-agent/test/system-prompt.test.ts` | Modify | Assert truthful self-description/no false availability claims. |

## Interfaces / Contracts

```ts
type EngramOperation =
  | "mem_search" | "mem_context" | "mem_get_observation"
  | "mem_save" | "mem_save_prompt" | "mem_session_summary";

interface EngramBridgeConfigEvidence {
  sourcePath: string;          // sanitized path only
  serverName: string;          // e.g. "engram"
  transport: "command" | "url" | "unknown";
}
```

Config discovery reads only existing JSON at project `.mcp.json`, project `.pi/mcp.json`, user `${agentDir}/mcp.json`, and common global `~/.config/mcp/mcp.json`. It accepts `mcpServers`, `servers`, or top-level named server objects whose key/name contains `engram` or whose command/url references Engram. Evidence MUST NOT include env values, args, headers, tokens, or full command strings.

Tool normalization maps direct `mem_*`, prefixed `engram_mem_*` / `engram.mem_*`, and proxy forms ending in canonical operation names, including `mcp__engram__mem_search` and `mcp_engram_mem_search`. Unknown operations do not count as callable memory.

Status policy: callable required operations present → `available`; config evidence + inspected tool surface + no callable tools → `unreachable`; config evidence before inspection → `configured`; inspected with no config/callables → `unavailable`; uninspected/no evidence → `unknown`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Config parsing and secret redaction | Temp JSON fixtures for `.mcp.json`, `.pi/mcp.json`, user/global paths. |
| Unit | Alias normalization | Table tests for direct, prefixed, dotted, and MCP proxy forms. |
| Integration | Prompt state derivation | Existing regression harness with active tools/config combinations. |
| Prompt | No false self-description | `system-prompt.test.ts` and identity prompt assertions. |

## Migration / Rollout

No migration required. Existing absent Engram runtime remains degraded. Existing broad `.pi/settings.json` evidence will be intentionally narrowed.

## Open Questions

None.
