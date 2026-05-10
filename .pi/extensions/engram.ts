import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ENGRAM_PORT = process.env.ENGRAM_PORT ?? "7437";
const ENGRAM_URL = `http://127.0.0.1:${ENGRAM_PORT}`;
const REQUEST_TIMEOUT_MS = 5_000;
const PROMPT_MIN_LENGTH = 10;
const PASSIVE_CAPTURE_TOOLS = new Set(["task", "agent", "subagent"]);
const PASSIVE_CAPTURE_MIN_LENGTH = 50;

const MEMORY_PROTOCOL = `## Engram Persistent Memory — Protocol

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

Do not skip step 1. Without it, everything done before compaction is lost from memory.`;

const MEMORY_PROTOCOL_MARKER = "## Engram Persistent Memory — Protocol";

let currentSessionId: string | undefined;
let pendingRecoveryNotice: string | undefined;
let engramAvailable = false;

interface FetchOpts {
	method?: "GET" | "POST" | "PATCH" | "DELETE";
	body?: unknown;
}

async function engramFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const res = await fetch(`${ENGRAM_URL}${path}`, {
			method: opts.method ?? "GET",
			headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
			signal: controller.signal,
		});
		if (!res.ok) return undefined;
		const ct = res.headers.get("content-type") ?? "";
		if (!ct.includes("application/json")) return undefined;
		return (await res.json()) as T;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function isEngramHealthy(): Promise<boolean> {
	const health = await engramFetch<{ status?: string }>("/health");
	return Boolean(health?.status);
}

function stripPrivateTags(text: string): string {
	return text.replace(/<private>[\s\S]*?<\/private>/g, "").trim();
}

function deriveProject(cwd: string): string {
	return basename(cwd);
}

interface EngramContext {
	summary?: string;
	observations?: unknown[];
	prompts?: unknown[];
}

function formatRecoveryNotice(context: EngramContext | undefined): string {
	const parts: string[] = [
		"## FIRST ACTION REQUIRED — POST-COMPACTION RECOVERY",
		"",
		"Before responding to anything else, you MUST:",
		"1. Call `mem_session_summary` with the compacted summary content (persists what was done before compaction).",
		"2. Call `mem_context` to recover prior session context.",
		"3. Only after that, continue with the user's request.",
	];
	if (context?.summary) {
		parts.push("", "### Prior session summary (from Engram /context)", "", context.summary);
	}
	return parts.join("\n");
}

export default function (pi: ExtensionAPI) {
	if (process.env.ENGRAM_DISABLE === "1") {
		return;
	}

	pi.on("session_start", async (event, ctx) => {
		const reason = (event as { reason?: string }).reason;
		if (reason === "reload") {
			engramAvailable = await isEngramHealthy();
			return;
		}

		engramAvailable = await isEngramHealthy();
		if (!engramAvailable) {
			currentSessionId = undefined;
			return;
		}

		const id = randomUUID();
		const created = await engramFetch<{ id?: string }>("/sessions", {
			method: "POST",
			body: {
				id,
				project: deriveProject(ctx.cwd),
				directory: ctx.cwd,
			},
		});
		if (!created) {
			currentSessionId = undefined;
			return;
		}
		currentSessionId = id;
		if (ctx.hasUI) {
			ctx.ui.notify(`Engram session ready (${deriveProject(ctx.cwd)})`, "info");
		}
	});

	pi.on("session_shutdown", async () => {
		if (!currentSessionId) return;
		const id = currentSessionId;
		currentSessionId = undefined;
		await engramFetch(`/sessions/${id}/end`, { method: "POST" });
	});

	pi.on("session_compact", async (_event, ctx) => {
		if (!engramAvailable) return;
		const project = deriveProject(ctx.cwd);
		const query = `?project=${encodeURIComponent(project)}&directory=${encodeURIComponent(ctx.cwd)}`;
		const context = await engramFetch<EngramContext>(`/context${query}`);
		pendingRecoveryNotice = formatRecoveryNotice(context);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		let systemPrompt = (event as { systemPrompt: string }).systemPrompt;
		const userPrompt = (event as { prompt?: string }).prompt;

		if (pendingRecoveryNotice !== undefined) {
			systemPrompt = `${systemPrompt}\n\n${pendingRecoveryNotice}`;
			pendingRecoveryNotice = undefined;
		}

		if (!systemPrompt.includes(MEMORY_PROTOCOL_MARKER)) {
			systemPrompt = `${systemPrompt}\n\n${MEMORY_PROTOCOL}`;
		}

		if (currentSessionId && typeof userPrompt === "string") {
			const cleaned = stripPrivateTags(userPrompt);
			if (cleaned.length >= PROMPT_MIN_LENGTH) {
				engramFetch("/prompts", {
					method: "POST",
					body: {
						session_id: currentSessionId,
						project: deriveProject(ctx.cwd),
						content: cleaned,
					},
				}).catch(() => undefined);
			}
		}

		return { systemPrompt };
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (!currentSessionId) return;
		const e = event as { toolName?: string; result?: unknown; isError?: boolean };
		if (e.isError) return;
		const toolName = (e.toolName ?? "").toLowerCase();
		if (!PASSIVE_CAPTURE_TOOLS.has(toolName)) return;
		const result = typeof e.result === "string" ? e.result : JSON.stringify(e.result);
		if (!result || result.length < PASSIVE_CAPTURE_MIN_LENGTH) return;
		engramFetch("/observations/passive", {
			method: "POST",
			body: {
				session_id: currentSessionId,
				project: deriveProject(ctx.cwd),
				content: result,
			},
		}).catch(() => undefined);
	});

	pi.registerCommand("engram:status", {
		description: "Show Engram connection status and current session.",
		handler: async (_args, ctx) => {
			const healthy = await isEngramHealthy();
			const project = deriveProject(ctx.cwd);
			const lines = [
				`URL: ${ENGRAM_URL}`,
				`Health: ${healthy ? "ok" : "unreachable"}`,
				`Session: ${currentSessionId ?? "—"}`,
				`Project: ${project}`,
			];
			ctx.ui.notify(lines.join(" · "), healthy ? "info" : "warning");
		},
	});
}
