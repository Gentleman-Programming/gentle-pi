import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseResearchArtifactIntent, researchArtifactCall, researchArtifactReadback, type ResearchArtifactIntent } from "../lib/sdd-research-capabilities.ts";
import { childArguments } from "../lib/agents-runner.ts";
import { resolveResearchCapabilities, researchAgent, renderResearchCapabilities } from "../lib/sdd-research-capabilities.ts";
import type { AgentDefinition } from "../lib/agents-config.ts";

const inventory = (names: string[]) => ({ getActiveTools: () => names, getAllTools: () => names.map(name => ({ name, sourceInfo: { source: "extension", path: "/installed/web.ts" } })) });
const grant = (tools: string[]) => ({ tools, extensions: Object.fromEntries(tools.map(name => [name, "/installed/web.ts"])) });
const documentation = { documentation: grant(["fetch_content"]) };
const both = { ...documentation, "open-web": grant(["web_search", "source_check", "fetch_content", "get_search_content"]) };
const agent: AgentDefinition = { name: "sdd-research", description: "Research", filePath: "/agents/sdd-research.md", scope: "global", tools: ["read", "write", "fetch_content", "web_search", "source_check", "get_search_content"], instructions: "Research", model: undefined, thinking: undefined, mode: undefined };

test("approved active external tools reach the actual child CLI allowlist", () => {
 const pi = inventory(["read", "write", "fetch_content", "web_search", "source_check", "get_search_content", "bash", "mcp"]);
 const result = researchAgent(agent, pi, both);
 const args = childArguments({ agent: result.agent, sessionDir: "sessions" } as never);
 assert.equal(args[args.indexOf("--tools") + 1], "read,write,fetch_content,web_search,source_check,get_search_content,subagent_parent_message");
 assert.equal(result.capabilities.documentation.status, "available");
 assert.equal(result.capabilities["open-web"].status, "available");
});
test("class-specific grants remain exact when both classes are explicitly selected", () => {
 const names = ["web_search", "source_check", "fetch_content", "get_search_content"];
 const caps = resolveResearchCapabilities(inventory([...names, "unknown"]));
 assert.deepEqual(caps.documentation.tools, ["fetch_content"]);
 assert.deepEqual(caps["open-web"].tools, names);
 assert.match(renderResearchCapabilities(caps), /documentation: available; tools=\["fetch_content"\]/);
 assert.deepEqual(resolveResearchCapabilities(inventory(["web_search"])).documentation.tools, []);
 assert.deepEqual(resolveResearchCapabilities(inventory(["web_search"]))["open-web"].tools, ["web_search"]);
 assert.deepEqual(researchAgent(agent, inventory(names), both).agent.tools, agent.tools);
 const instructions = readFileSync(new URL("../assets/agents/sdd-research.md", import.meta.url), "utf8");
 assert.match(instructions, /Persist grants per source class exactly as observed/);
 assert.match(instructions, /never copy the child tool union into each class/);
 assert.match(instructions, /research_selection/);
 assert.match(instructions, /sourceInfo\.path/);
 assert.match(instructions, /--extension/);
 assert.match(instructions, /research_artifact/);
 assert.match(instructions, /revision_count/);
 assert.match(instructions, /full bounded write/);
 assert.match(instructions, /identical store.*worktree/);
});
test("open-web requires all four canonical tools, each active and unrestricted", () => {
 const required = ["web_search", "source_check", "fetch_content", "get_search_content"];
 for (const missing of required) {
  const remaining = required.filter(name => name !== missing);
  for (const caps of [
   resolveResearchCapabilities(inventory(remaining)),
   resolveResearchCapabilities({ ...inventory(required), getActiveTools: () => remaining }),
   resolveResearchCapabilities(inventory(required), remaining),
   researchAgent(agent, inventory(remaining), both).capabilities,
  ]) {
   assert.equal(caps["open-web"].status, "blocked", `${missing} must deny open-web`);
   assert.match(caps["open-web"].reason, new RegExp(missing));
   assert.equal(caps.documentation.status, missing === "fetch_content" ? "blocked" : "available");
  }
 }
});
test("restrictions, inactive tools and unknown tools never become grants", () => {
 const pi = inventory(["fetch_content", "web_search", "mcp", "mcp__context7", "bash"]);
 const caps = resolveResearchCapabilities(pi, ["web_search"]);
 assert.equal(caps.documentation.status, "blocked");
 assert.equal(caps["open-web"].status, "blocked");
 assert.deepEqual(researchAgent({ ...agent, tools: ["read", "write"] } as never, pi).agent.tools, ["read", "write"]);
 assert.equal(resolveResearchCapabilities(inventory(["mcp", "mcp__context7"])).documentation.status, "blocked");
 const inactive = { ...pi, getActiveTools: () => [] };
 assert.equal(resolveResearchCapabilities(inactive).documentation.status, "blocked");
});
test("documentation can run independently of unavailable open-web search", () => {
 const caps = resolveResearchCapabilities(inventory(["fetch_content"]));
 assert.equal(caps.documentation.status, "available");
 assert.equal(caps["open-web"].status, "blocked");
 assert.match(renderResearchCapabilities(caps), /official/);
 assert.match(renderResearchCapabilities(caps), /not evidence/);
});
test("SDK-only tools and unavailable inventory fail closed", () => {
 const pi = { getActiveTools: () => ["fetch_content"], getAllTools: () => [{ name: "fetch_content", sourceInfo: { source: "sdk" } }] };
 assert.equal(resolveResearchCapabilities(pi).documentation.status, "blocked");
 assert.equal(resolveResearchCapabilities({}).documentation.status, "blocked");
});

test("selected documentation never inherits available open-web routes or arbitrary extensions", () => {
 const result = researchAgent(agent, inventory(agent.tools), documentation);
 assert.deepEqual(result.agent.tools, ["read", "write", "fetch_content"]);
 assert.deepEqual(result.extensionPaths, ["/installed/web.ts"]);
 assert.equal(result.capabilities["open-web"].status, "blocked");
 for (const selection of [undefined, {}, { documentation: grant(["fetch_content", "web_search"]) }, { documentation: { tools: ["fetch_content"], extensions: { fetch_content: "/other.ts" } } }]) {
  assert.deepEqual(researchAgent(agent, inventory(agent.tools), selection).agent.tools, ["read", "write"]);
 }
});

test("selected grants refuse missing, inactive, SDK, restricted and unknown routes without removing local authorization", () => {
 const local = ["read", "grep", "find", "edit", "write", "mem_search", "mem_get_observation", "mem_save"];
 const definition = { ...agent, tools: [...local, ...both["open-web"].tools, "bash", "mcp"] };
 for (const missing of both["open-web"].tools) {
  const full = inventory(definition.tools);
  for (const [pi, tools] of [
   [inventory(definition.tools.filter(name => name !== missing)), definition.tools],
   [{ ...full, getActiveTools: () => definition.tools.filter(name => name !== missing) }, definition.tools],
   [{ ...full, getAllTools: () => full.getAllTools().map(tool => tool.name === missing ? { ...tool, sourceInfo: { ...tool.sourceInfo, source: "sdk" } } : tool) }, definition.tools],
   [full, definition.tools.filter(name => name !== missing)],
  ] as const) {
   const result = researchAgent({ ...definition, tools: [...tools] }, pi, { "open-web": both["open-web"] });
   assert.deepEqual(result.agent.tools, local, missing);
   assert.equal(result.capabilities["open-web"].status, "blocked");
   assert.deepEqual(result.capabilities["open-web"].tools, both["open-web"].tools.filter(name => name !== missing));
  }
 }
 for (const selection of [{ unknown: grant(["fetch_content"]), ...documentation }, { toString: {}, ...documentation }, { documentation: grant(["mcp"]) }]) {
  assert.deepEqual(researchAgent(definition, inventory(definition.tools), selection).agent.tools, local);
 }
 const allowed = researchAgent(definition, inventory(definition.tools), { "open-web": both["open-web"] });
 assert.deepEqual(allowed.agent.tools, [...local, ...both["open-web"].tools]);
 assert.deepEqual(allowed.capabilities.documentation.tools, []);
});

const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
test("artifact intent narrows exact paths and topics without granting tools or replacement scope", () => {
 const cwd = mkdtempSync(join(tmpdir(), "research-bounds-"));
 try {
  const path = join(cwd, "openspec/changes/demo/research.md");
  mkdirSync(join(cwd, "openspec/changes/demo"), { recursive: true });
  const bytes = '{"revision":1,"outcome":"blocked"}';
  writeFileSync(path, bytes);
  const locator = { artifact: "research", revision: 1, digest: digest(bytes), path, engram: { id: 7, project: "pi", topic_key: "sdd/demo/research", revision_count: 2 } };
  const intent: ResearchArtifactIntent = { store: "both", worktree: cwd, changeName: "demo", retainedIntent: "docs requested; fetch missing", locators: [locator] };
  const scope = parseResearchArtifactIntent(intent, cwd);
  for (const name of ["read", "edit", "write", "grep"]) assert.equal(researchArtifactCall(scope, cwd, name, { path }), 0);
  assert.equal(researchArtifactCall(scope, cwd, "mem_get_observation", { id: 7 }), 0);
  assert.equal(researchArtifactCall(scope, cwd, "mem_save", { project: "pi", topic_key: "sdd/demo/research" }), 0);
  assert.equal(researchArtifactCall(scope, cwd, "mem_search", { project: "pi", query: "sdd/demo/research" }), 0);
  for (const [name, input] of [["write", { path: join(cwd, "source.ts") }], ["read", {}], ["find", { path: cwd }], ["mem_get_observation", { id: 8 }], ["mem_search", { project: "pi", query: "sdd/demo/research", all_projects: true }], ["mem_save", { project: "other", topic_key: "sdd/demo/research" }]] as const) {
   assert.throws(() => researchArtifactCall(scope, cwd, name, input), /scope/);
  }
  assert.throws(() => researchArtifactCall(scope, tmpdir(), "write", { path }), /worktree/);
  symlinkSync(path, join(cwd, "alias"));
  assert.throws(() => researchArtifactCall(scope, cwd, "read", { path: join(cwd, "alias") }), /scope/);
  rmSync(path);
  symlinkSync(join(cwd, "missing-target"), path);
  assert.throws(() => researchArtifactCall(scope, cwd, "write", { path }), /ENOENT|scope/);
  rmSync(path);
  writeFileSync(path, bytes);
  for (const patch of [{ worktree: tmpdir() }, { store: "engram" }, { retainedIntent: "replacement" }, { locators: [{ ...locator, digest: "0".repeat(64) }] }]) {
   assert.throws(() => parseResearchArtifactIntent({ ...intent, ...patch }, cwd, scope), /scope|worktree|stale/);
  }
  const none = parseResearchArtifactIntent({ ...intent, store: "none", locators: [] }, cwd);
  assert.throws(() => researchArtifactCall(none, cwd, "write", { path }), /scope/);
  const explore = parseResearchArtifactIntent({ ...intent, store: "openspec", locators: [{ ...locator, artifact: "explore", path: join(cwd, "openspec/changes/demo/explore.md"), engram: undefined }] }, cwd);
  assert.throws(() => researchArtifactCall(explore, cwd, "write", { path: explore.locators[0].path }), /scope/);
  const corrected = { ...intent, locators: [{ ...locator, revision: 2, digest: digest("corrected"), engram: { ...locator.engram, revision_count: 3 } }] };
  assert.equal(parseResearchArtifactIntent(corrected, cwd, scope).retainedIntent, intent.retainedIntent);
  assert.throws(() => parseResearchArtifactIntent({ ...intent, locators: [{ ...locator, path: cwd }] }, cwd), /scope/);
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("only actual exact OpenSpec bytes and Engram metadata satisfy readback identity", () => {
 const cwd = mkdtempSync(join(tmpdir(), "research-readback-"));
 try {
  const bytes = '{"revision":3,"outcome":"done"}';
  const locator = { artifact: "research", revision: 3, digest: digest(bytes), path: join(cwd, "openspec/changes/demo/research.md"), engram: { id: 7, project: "pi", topic_key: "sdd/demo/research", revision_count: 4 } };
  const scope = parseResearchArtifactIntent({ store: "both", worktree: cwd, changeName: "demo", retainedIntent: "docs", locators: [locator] }, cwd);
  const observation = { ...locator.engram, content: bytes };
  assert.equal(researchArtifactReadback(scope.locators[0], "read", bytes), true);
  assert.equal(researchArtifactReadback(scope.locators[0], "mem_get_observation", observation), true);
  for (const patch of [{ id: 9 }, { project: "other" }, { topic_key: "sdd/other/research" }, { revision_count: 3 }, { revision_count: undefined }, { content: bytes + " " }]) {
   assert.equal(researchArtifactReadback(scope.locators[0], "mem_get_observation", { ...observation, ...patch }), false);
  }
  for (const bad of ["", bytes + " ", '{"revision":2,"outcome":"done"}', { verified: true }, null]) assert.equal(researchArtifactReadback(scope.locators[0], "read", bad), false);
  assert.equal(researchArtifactReadback(scope.locators[0], "mem_search", [observation]), false, "search is discovery, not full readback");
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});


test("R4 research write crash reload requires durable desired identity and actual backend readback", async t => {
 const { default: gentleAgents } = await import("../extensions/gentle-agents.ts");
 const { appendFileSync } = await import("node:fs");
 const cwd = mkdtempSync(join(tmpdir(), "research-crash-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
 for (const store of ["openspec", "engram", "both"] as const) {
  const path = join(cwd, "openspec/changes/demo/research.md"), history = join(cwd, `${store}.jsonl`), memory = join(cwd, `${store}-memory.json`);
  mkdirSync(join(cwd, "openspec/changes/demo"), { recursive: true }); writeFileSync(history, "");
  const bytes = '{"revision":1}', next = '{"revision":2}', digest = value => createHash("sha256").update(value).digest("hex");
  const engram = { id: 12, project: "pi", topic_key: "sdd/demo/research", revision_count: 1 };
  writeFileSync(path, bytes); writeFileSync(memory, JSON.stringify({ ...engram, content: bytes }));
  const scope: ResearchArtifactIntent = { store, worktree: cwd, changeName: "demo", retainedIntent: "retain uncertainty", locators: [{ artifact: "research", revision: 1, digest: digest(bytes), ...(store !== "engram" ? { path } : {}), ...(store !== "openspec" ? { engram } : {}) }] };
  const entries = () => readFileSync(history, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const start = (durable = true) => {
   const hooks = new Map(), active = ["read", "write", "mem_get_observation", "mem_save"];
   const pi = { on: (name, fn) => hooks.set(name, fn), getAllTools: () => active.map(name => ({ name })), getActiveTools: () => active, appendEntry: (customType, data) => appendFileSync(history, JSON.stringify({ type: "custom", customType, data }) + "\n") };
   const ctx = { cwd, sessionManager: { getEntries: entries, getSessionFile: () => durable ? history : undefined } };
   gentleAgents(pi as never, { GENTLE_PI_AGENTS_CHILD: "1", GENTLE_PI_RESEARCH_TOOLS: JSON.stringify(active), GENTLE_PI_RESEARCH_ARTIFACT: JSON.stringify(scope) });
   hooks.get("before_agent_start")({ systemPrompt: "research" }, ctx);
   const call = (toolName, input, toolCallId = "call") => hooks.get("tool_call")({ toolName, input, toolCallId }, ctx);
   const read = toolName => {
    const input = toolName === "read" ? { path } : { id: 12 }; assert.equal(call(toolName, input), undefined);
    return hooks.get("tool_result")({ toolName, input, toolCallId: "call", content: [{ type: "text", text: readFileSync(toolName === "read" ? path : memory, "utf8") }], isError: false }, ctx);
   };
   return { call, read, result: (toolName, input, toolCallId) => hooks.get("tool_result")({ toolName, input, toolCallId, content: [{ type: "text", text: "saved" }], isError: false }, ctx) };
  };
  const unpersisted = start(false); if (store !== "engram") unpersisted.read("read"); if (store !== "openspec") unpersisted.read("mem_get_observation");
  assert.equal(unpersisted.call(store === "engram" ? "mem_save" : "write", store === "engram" ? { project: "pi", topic_key: engram.topic_key, content: next } : { path, content: next })?.block, true, "in-memory session cannot authorize durable mutation");
  writeFileSync(history, "");
  let child = start(); if (store !== "engram") child.read("read"); if (store !== "openspec") child.read("mem_get_observation");
  const local = store !== "engram", tool = local ? "write" : "mem_save", input = local ? { path, content: next } : { project: "pi", topic_key: engram.topic_key, content: next };
  assert.equal(child.call(tool, input, "crash-write"), undefined);
  assert.ok(JSON.stringify(entries()).includes(digest(next)), "desired identity must precede backend mutation");
  if (store === "both") {
   child.result(tool, input, "crash-write");
   const before = readFileSync(history, "utf8");
   for (const content of ['{"revision":3}', '{"revision":2,"different":true}']) {
    assert.equal(child.call("mem_save", { project: "pi", topic_key: engram.topic_key, content }, "diverge")?.block, true);
    assert.equal(readFileSync(history, "utf8"), before, "mismatch refused before checkpoint or mutation");
   }
   assert.equal(child.call("mem_save", { project: "pi", topic_key: engram.topic_key, content: next }, "matching"), undefined);
  }
  if (local) writeFileSync(path, next); else writeFileSync(memory, JSON.stringify({ ...engram, content: next, revision_count: 2 }));
  // Recreate extension solely from retained session bytes; no mutation result delivered.
  child = start(); const readback = child.read(local ? "read" : "mem_get_observation");
  if (store === "both") {
   assert.equal(child.read("mem_get_observation").isError, true, "partial hybrid never converges");
   assert.equal(child.call(tool, { ...input, content: '{"revision":3}' })?.block, true);
  } else {
   assert.match(readback.content.at(-1).text, /all selected stores/);
   child = start(); assert.match(child.read(local ? "read" : "mem_get_observation").content.at(-1).text, /all selected stores/, "accepted recovery survives another reload");
   assert.equal(child.call(tool, { ...input, content: '{"revision":3}' }), undefined);
   child = start(); assert.equal(child.read(local ? "read" : "mem_get_observation").isError, true, "crash before actual mutation refuses stale bytes");
   assert.equal(child.call(tool, { ...input, content: '{"revision":4}' })?.block, true);
  }
 }
});


test("R4 corrupted or broadened durable research scope is not a restart grant", async t => {
 const { parseResearchPersistence } = await import("../lib/sdd-research-capabilities.ts");
 const cwd = mkdtempSync(join(tmpdir(), "research-journal-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
 const locator = { artifact: "research", revision: 1, digest: "a".repeat(64), engram: { id: 12, project: "pi", topic_key: "sdd/demo/research", revision_count: 1 } };
 const scope: ResearchArtifactIntent = { store: "engram", worktree: cwd, changeName: "demo", retainedIntent: "retain uncertainty", locators: [locator] };
 const snapshot = { version: 1, scope, accepted: {}, writes: { "0:mem_get_observation": { revision: 2, digest: "b".repeat(64) } }, operation: { toolCallId: "write", tool: "mem_save", index: 0 } };
 assert.doesNotThrow(() => parseResearchPersistence(snapshot, scope, cwd));
 const hybrid: ResearchArtifactIntent = { ...scope, store: "both", locators: [{ ...locator, path: join(cwd, "openspec/changes/demo/research.md") }] };
 for (const desired of [{ revision: 3, digest: "b".repeat(64) }, { revision: 2, digest: "c".repeat(64) }]) {
  assert.throws(() => parseResearchPersistence({ ...snapshot, scope: hybrid, writes: { ...snapshot.writes, "0:read": desired } }, hybrid, cwd), /divergent/i);
 }
 assert.doesNotThrow(() => parseResearchPersistence({ ...snapshot, scope: hybrid, writes: { ...snapshot.writes, "0:read": snapshot.writes["0:mem_get_observation"] } }, hybrid, cwd));
 for (const bad of [{ ...snapshot, accepted: "unknown" }, { ...snapshot, writes: { "0:mem_get_observation": null } }, { ...snapshot, accepted: { "0:mem_get_observation": null } }, { ...snapshot, scope: { ...scope, store: "none", locators: [] } }, { ...snapshot, writes: { "0:mem_get_observation": { revision: 1, digest: "a".repeat(64) } } }]) assert.throws(() => parseResearchPersistence(bad, scope, cwd));
 for (const engram of [{ ...locator.engram, id: 13 }, { ...locator.engram, project: "other" }, { ...locator.engram, topic_key: "sdd/other/research" }]) assert.throws(() => parseResearchPersistence(snapshot, { ...scope, locators: [{ ...locator, engram }] }, cwd));
});


test("research actor explains crash readback without store substitution or replay", () => {
 const text = readFileSync("assets/agents/sdd-research.md", "utf8");
 assert.match(text, /physical session history/); assert.match(text, /crash.*desired identity/);
 assert.match(text, /checkpoint.*not.*readback/i);
});
