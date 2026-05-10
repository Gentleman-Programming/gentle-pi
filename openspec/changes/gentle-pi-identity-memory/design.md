# Design: Gentle Pi Identity Memory

## Technical Approach

Add a typed Gentle Pi identity/memory layer under `packages/coding-agent/src/core/gentle-pi/` and inject its rendered prompt block through the existing `AgentSession` system-prompt rebuild path. Keep `packages/coding-agent` as the center: runtime services compute identity, memory capability, and SDD delegation guidance; `system-prompt.ts` only composes the text. Project SDD execution is represented as native `pi-subagents` assets in `.pi/agents` and `.pi/chains`, not generic orchestration prose.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Identity service | Create `gentle-pi/identity-memory.ts` with typed profile, persona, self-description, memory state, and prompt renderer | Static prompt-only edit | The failure is runtime truthfulness; typed services make persona and memory claims testable. |
| Memory detection | Detect Engram from active callable tools first, then direct MCP/config/package signals as non-callable evidence; return `available`, `configured`, `unavailable`, or `unknown` with evidence | Hardcode Engram absent/present | Prevents false claims. Config-only evidence must not be described as usable persistence. |
| Prompt assembly | Add `gentlePiIdentityPrompt?: string` to `BuildSystemPromptOptions`; append it before project context and skills, after core tool/guideline text | Put all text in AGENTS.md or append prompt files | Keeps custom prompts/project context from replacing runtime truth blocks and keeps tests focused. |
| Subagents | Commit project `.pi/agents/sdd-*.md` and `.pi/chains/*.chain.md` using `pi-subagents` frontmatter and chain syntax | Keep current phase bundle only | Native project agents/chains enable `/run`, `/chain`, `/parallel`, forked context, async, allowlists, and worktree paths. |
| Intercom | Recommend `pi-intercom` for blocked decisions/progress only; use `contact_supervisor` when available | Always require intercom | `pi-subagents` works without it; intercom is valuable for supervisor decisions without making setup brittle. |

## Data Flow

```txt
createAgentSessionServices
  -> createGentlePiServices(cwd, resourceLoader signals)
  -> AgentSession._refreshToolRegistry(active tools/extensions)
  -> detectGentlePiMemoryCapability(evidence)
  -> renderGentlePiIdentityPrompt()
  -> buildSystemPrompt()
```

SDD:

```txt
parent Pi -> /run|/chain|/parallel -> .pi/agents/sdd-* -> openspec artifacts
                         └─ optional pi-intercom decision path
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/coding-agent/src/core/gentle-pi/types.ts` | Modify | Add `GentlePiIdentityProfile`, `GentlePiMemoryCapability`, `GentlePiIdentityMemoryServices`, package recommendation types. |
| `packages/coding-agent/src/core/gentle-pi/identity-memory.ts` | Create | Detection, package evaluation notes, persona/self-description, memory protocol prompt rendering. |
| `packages/coding-agent/src/core/agent-session-services.ts` | Modify | Build identity/memory service from cwd/resource loader/env/config signals. |
| `packages/coding-agent/src/core/agent-session.ts` | Modify | Recompute memory capability with active tool definitions and pass prompt block to `buildSystemPrompt`. |
| `packages/coding-agent/src/core/system-prompt.ts` | Modify | Compose `gentlePiIdentityPrompt` for default and custom prompt paths. |
| `.pi/agents/sdd-{explore,proposal,spec,design,tasks,apply,verify,archive}.md` | Create | Phase agents with tool allowlists, fork defaults, no nested subagent delegation. |
| `.pi/chains/sdd-full.chain.md`, `.pi/chains/sdd-plan.chain.md`, `.pi/chains/sdd-verify.chain.md` | Create | Ordered and parallel SDD workflows using `{task}`, `{previous}`, outputs, and progress. |
| `.pi/settings.json` | Create/Modify | Project package notes/overrides for `pi-subagents`; optional companion package recommendations. |
| `GENTLE_PI_HARNESSES.md` | Modify | Document identity/memory harness and native subagent assets. |
| `packages/coding-agent/test/system-prompt.test.ts` | Modify | Assert prompt identity/memory protocol composition. |
| `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Create | Faux-provider regressions for self-description, Spanish style principles, and no false Engram claims. |

## Interfaces / Contracts

```ts
type GentlePiMemoryStatus = "available" | "configured" | "unavailable" | "unknown";
interface GentlePiMemoryCapability {
  provider: "engram";
  status: GentlePiMemoryStatus;
  evidence: string[];
  callableTools: string[];
  fallback: "session-only" | "openspec-artifacts";
}
```

Memory prompt contract: if `available`, instruct Engram-first save/search behavior; if `configured`, say Engram is detected but not callable; if `unavailable|unknown`, state degraded memory explicitly and use session/OpenSpec artifacts only.

Package notes: install/recommend `pi-subagents` (`npm:pi-subagents@0.24.0`) for delegation. Recommend optional `pi-intercom@0.6.0` for supervisor decisions, `pi-mcp-adapter@2.5.4` for direct `mcp:` tools, and `pi-web-access@0.10.7` only for researcher agents. Do not add generic memory packages as Engram replacements.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Detector statuses, prompt rendering, package recommendations | Direct Vitest against `identity-memory.ts`. |
| Integration | Session prompt gets identity/memory block with active tools/extensions | `test/suite/harness.ts`, resource-loader overrides, faux provider. |
| Regression | Persona/self-description, Spanish style principles, no false Engram claims | `test/suite/regressions/*`, principle assertions. |
| Config | `.pi/agents` and `.pi/chains` parse as project assets | File-shape tests using `pi-subagents` documented frontmatter/chain syntax where dependency is available; otherwise static parser fixtures. |

## Migration / Rollout

No data migration required. Roll out as default-on Gentle Pi services, with `PI_GENTLE_PI_DISABLED` preserving the existing opt-out.

## Open Questions

None.
