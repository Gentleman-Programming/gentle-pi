/**
 * Engram — pi extension adapter
 *
 * Port 1:1 of the OpenCode plugin (plugin/opencode/engram.ts) adapted to pi's
 * hook surface. Same Go HTTP server (engram serve, port 7437), same MCP tools,
 * same Memory Protocol, same passive capture. Hook mapping:
 *
 *   OpenCode hook                            pi hook
 *   ─────────────────────────────────────────────────────────────────────
 *   session.created                          session_start (via ensureSession)
 *   session.deleted                          session_shutdown
 *   chat.message                             before_agent_start (event.prompt)
 *   tool.execute.after                       tool_execution_end
 *   experimental.chat.system.transform       before_agent_start (return.systemPrompt)
 *   experimental.session.compacting          session_compact + before_agent_start
 *
 * Differences from OpenCode plugin:
 *   - Sub-agent session inflation (issue #116) does not apply to pi: pi-subagents
 *     runs sub-agents inside the parent session, so subAgentSessions stays empty
 *     here but the structural skip is preserved for future-proofing.
 *   - The compressor-context hook does not exist in pi. The recovery notice is
 *     delivered to the post-compact agent via the next before_agent_start system
 *     prompt instead of being embedded in the compacted summary.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── Configuration ───────────────────────────────────────────────────────────

const ENGRAM_PORT = Number.parseInt(process.env.ENGRAM_PORT ?? "7437", 10);
const ENGRAM_URL = `http://127.0.0.1:${ENGRAM_PORT}`;
const ENGRAM_BIN = process.env.ENGRAM_BIN ?? "engram";

// Engram's own MCP tools — don't count these as "tool calls" for session stats
const ENGRAM_TOOLS = new Set([
	"mem_search",
	"mem_save",
	"mem_update",
	"mem_delete",
	"mem_suggest_topic_key",
	"mem_save_prompt",
	"mem_session_summary",
	"mem_context",
	"mem_stats",
	"mem_timeline",
	"mem_get_observation",
	"mem_session_start",
	"mem_session_end",
]);

// ─── Memory Instructions ─────────────────────────────────────────────────────
// Injected into the system prompt on every agent run so the agent always knows
// to call mem_save / mem_search / mem_session_summary. Verbatim from the
// OpenCode plugin.

const MEMORY_INSTRUCTIONS = `## Engram Persistent Memory — Protocol

You have access to Engram, a persistent memory system that survives across sessions and compactions.

### WHEN TO SAVE (mandatory — not optional)

Call \`mem_save\` IMMEDIATELY after any of these:
- Bug fix completed
- Architecture or design decision made
- Non-obvious discovery about the codebase
- Configuration change or environment setup
- Pattern established (naming, structure, convention)
- User preference or constraint learned

Format for \`mem_save\`:
- **title**: Verb + what — short, searchable (e.g. "Fixed N+1 query in UserList", "Chose Zustand over Redux")
- **type**: bugfix | decision | architecture | discovery | pattern | config | preference
- **scope**: \`project\` (default) | \`personal\`
- **topic_key** (optional, recommended for evolving decisions): stable key like \`architecture/auth-model\`
- **content**:
  **What**: One sentence — what was done
  **Why**: What motivated it (user request, bug, performance, etc.)
  **Where**: Files or paths affected
  **Learned**: Gotchas, edge cases, things that surprised you (omit if none)

Topic rules:
- Different topics must not overwrite each other (e.g. architecture vs bugfix)
- Reuse the same \`topic_key\` to update an evolving topic instead of creating new observations
- If unsure about the key, call \`mem_suggest_topic_key\` first and then reuse it
- Use \`mem_update\` when you have an exact observation ID to correct

### WHEN TO SEARCH MEMORY

When the user asks to recall something — any variation of "remember", "recall", "what did we do",
"how did we solve", "recordar", "acordate", "qué hicimos", or references to past work:
1. First call \`mem_context\` — checks recent session history (fast, cheap)
2. If not found, call \`mem_search\` with relevant keywords (FTS5 full-text search)
3. If you find a match, use \`mem_get_observation\` for full untruncated content

Also search memory PROACTIVELY when:
- Starting work on something that might have been done before
- The user mentions a topic you have no context on — check if past sessions covered it
- The user's FIRST message references the project, a feature, or a problem — call \`mem_search\` with keywords from their message to check for prior work before responding

### SESSION CLOSE PROTOCOL (mandatory)

Before ending a session or saying "done" / "listo" / "that's it", you MUST:
1. Call \`mem_session_summary\` with this structure:

## Goal
[What we were working on this session]

## Instructions
[User preferences or constraints discovered — skip if none]

## Discoveries
- [Technical findings, gotchas, non-obvious learnings]

## Accomplished
- [Completed items with key details]

## Next Steps
- [What remains to be done — for the next session]

## Relevant Files
- path/to/file — [what it does or what changed]

This is NOT optional. If you skip this, the next session starts blind.

### AFTER COMPACTION

If you see a message about compaction or context reset, or if you see "FIRST ACTION REQUIRED" in your context:
1. IMMEDIATELY call \`mem_session_summary\` with the compacted summary content — this persists what was done before compaction
2. Then call \`mem_context\` to recover any additional context from previous sessions
3. Only THEN continue working

Do not skip step 1. Without it, everything done before compaction is lost from memory.
`;

// ─── HTTP Client ─────────────────────────────────────────────────────────────

interface FetchOpts {
	method?: string;
	body?: unknown;
}

async function engramFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T | null> {
	try {
		const res = await fetch(`${ENGRAM_URL}${path}`, {
			method: opts.method ?? "GET",
			headers: opts.body ? { "Content-Type": "application/json" } : undefined,
			body: opts.body ? JSON.stringify(opts.body) : undefined,
		});
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

async function isEngramRunning(): Promise<boolean> {
	try {
		const res = await fetch(`${ENGRAM_URL}/health`, {
			signal: AbortSignal.timeout(500),
		});
		return res.ok;
	} catch {
		return false;
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractProjectName(directory: string): string {
	// Try git remote origin URL
	try {
		const result = spawnSync("git", ["-C", directory, "remote", "get-url", "origin"], {
			encoding: "utf8",
		});
		if (result.status === 0) {
			const url = result.stdout?.trim();
			if (url) {
				const name = url.replace(/\.git$/, "").split(/[/:]/).pop();
				if (name) return name;
			}
		}
	} catch {}

	// Fallback: git root directory name (works in worktrees)
	try {
		const result = spawnSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
		});
		if (result.status === 0) {
			const root = result.stdout?.trim();
			if (root) return root.split("/").pop() ?? "unknown";
		}
	} catch {}

	// Final fallback: cwd basename
	return directory.split("/").pop() ?? "unknown";
}

function truncate(str: string, max: number): string {
	if (!str) return "";
	return str.length > max ? `${str.slice(0, max)}...` : str;
}

/**
 * Strip <private>...</private> tags before sending to engram.
 * Double safety: the Go binary also strips, but we strip here too
 * so sensitive data never even hits the wire.
 */
function stripPrivateTags(str: string): string {
	if (!str) return "";
	return str.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]").trim();
}

// ─── Module State ───────────────────────────────────────────────────────────
// One pi extension instance per pi session, so module state is per-session.

let initialized = false;
let project = "unknown";
let directory = "";

// Track which sessions we've already ensured exist in engram. ensureSession()
// is idempotent on the server (INSERT OR IGNORE) but we cache locally to avoid
// the round trip.
const knownSessions = new Set<string>();

// Sub-agent sessions to suppress (issue #116 from OpenCode). pi-subagents in
// pi runs sub-agents inside the parent session so this stays empty in current
// pi versions, but the structural filter is preserved.
const subAgentSessions = new Set<string>();

// In-memory tool counters per session.
const toolCounts = new Map<string, number>();

// Recovery notice queued by session_compact, drained by next before_agent_start.
let pendingRecoveryNotice: string | undefined;

async function ensureSession(sessionId: string): Promise<void> {
	if (!sessionId || knownSessions.has(sessionId)) return;
	if (subAgentSessions.has(sessionId)) return;
	knownSessions.add(sessionId);
	await engramFetch("/sessions", {
		method: "POST",
		body: {
			id: sessionId,
			project,
			directory,
		},
	});
}

async function initOnce(cwd: string): Promise<void> {
	if (initialized) return;
	initialized = true;
	directory = cwd;

	const oldProject = cwd.split("/").pop() ?? "unknown";
	project = extractProjectName(cwd);

	// Try to start engram server if not running
	const running = await isEngramRunning();
	if (!running) {
		try {
			const proc = spawn(ENGRAM_BIN, ["serve"], {
				detached: true,
				stdio: "ignore",
			});
			proc.unref();
			await new Promise((r) => setTimeout(r, 500));
		} catch {
			// Binary not found or can't start — extension will silently no-op
		}
	}

	// Migrate project name if it changed (one-time, idempotent).
	// Must run AFTER server startup to ensure the endpoint is available.
	if (oldProject !== project) {
		await engramFetch("/projects/migrate", {
			method: "POST",
			body: { old_project: oldProject, new_project: project },
		});
	}

	// Auto-import: if .engram/manifest.json exists in the project repo, run
	// `engram sync --import` to load any new chunks into the local DB. This is
	// how git-synced memories get loaded when cloning a repo or pulling
	// changes. Each chunk is imported only once (tracked by ID).
	try {
		const manifestFile = `${cwd}/.engram/manifest.json`;
		if (existsSync(manifestFile)) {
			const proc = spawn(ENGRAM_BIN, ["sync", "--import"], {
				cwd,
				detached: true,
				stdio: "ignore",
			});
			proc.unref();
		}
	} catch {
		// Manifest doesn't exist or binary not found — silently skip
	}
}

// ─── Plugin Export ───────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await initOnce(ctx.cwd);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (sessionId) {
			toolCounts.delete(sessionId);
			knownSessions.delete(sessionId);
			subAgentSessions.delete(sessionId);
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (sessionId) {
			await ensureSession(sessionId);
		}

		// Inject context from previous sessions
		const data = await engramFetch<{ context?: string }>(
			`/context?project=${encodeURIComponent(project)}`,
		);

		// Tell the post-compact agent to persist the compacted summary to Engram.
		// In OpenCode this text is fed to the compressor (which embeds it at the
		// top of its summary); in pi the compressor surface is not exposed to
		// extensions, so the next before_agent_start delivers it as a system
		// prompt addendum instead.
		const recovery =
			`CRITICAL INSTRUCTION FOR COMPACTED SUMMARY:\n` +
			`The agent has access to Engram persistent memory via MCP tools.\n` +
			`You MUST include the following instruction at the TOP of the compacted summary:\n\n` +
			`"FIRST ACTION REQUIRED: Call mem_session_summary with the content of this compacted summary. ` +
			`Use project: '${project}'. This preserves what was accomplished before compaction. Do this BEFORE any other work."\n\n` +
			`This is NOT optional. Without this, everything done before compaction is lost from memory.`;

		const parts: string[] = [];
		if (data?.context) parts.push(data.context);
		parts.push(recovery);
		pendingRecoveryNotice = parts.join("\n\n");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		await initOnce(ctx.cwd);
		const sessionId = ctx.sessionManager.getSessionId();
		const e = event as { systemPrompt: string; prompt?: string };

		// Always-on Memory Protocol injection. Append to the chained system
		// prompt instead of pushing a new system block — pi's systemPrompt is
		// already a single string, so concatenation matches the OpenCode
		// "append to last system entry" semantics (see Qwen/Mistral note).
		let systemPrompt =
			e.systemPrompt.length > 0 ? `${e.systemPrompt}\n\n${MEMORY_INSTRUCTIONS}` : MEMORY_INSTRUCTIONS;

		if (pendingRecoveryNotice !== undefined) {
			systemPrompt = `${systemPrompt}\n\n${pendingRecoveryNotice}`;
			pendingRecoveryNotice = undefined;
		}

		// User prompt capture (chat.message analog).
		const userPrompt = e.prompt;
		if (sessionId && typeof userPrompt === "string") {
			const finalContent = userPrompt.trim();
			if (finalContent.length > 10) {
				await ensureSession(sessionId);
				await engramFetch("/prompts", {
					method: "POST",
					body: {
						session_id: sessionId,
						content: stripPrivateTags(truncate(finalContent, 2000)),
						project,
					},
				});
			}
		}

		return { systemPrompt };
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const e = event as { toolName?: string; result?: unknown; isError?: boolean };
		const toolName = e.toolName ?? "";
		if (ENGRAM_TOOLS.has(toolName.toLowerCase())) return;

		const sessionId = ctx.sessionManager.getSessionId();
		if (sessionId) {
			await ensureSession(sessionId);
			toolCounts.set(sessionId, (toolCounts.get(sessionId) ?? 0) + 1);
		}

		// Passive capture: extract learnings from Task tool output.
		if (toolName === "Task" && e.result !== undefined && sessionId) {
			const text = typeof e.result === "string" ? e.result : JSON.stringify(e.result);
			if (text.length > 50) {
				await engramFetch("/observations/passive", {
					method: "POST",
					body: {
						session_id: sessionId,
						content: stripPrivateTags(text),
						project,
						source: "task-complete",
					},
				});
			}
		}
	});
}
