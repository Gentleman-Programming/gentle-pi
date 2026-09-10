import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { childArguments } from "../lib/agents-runner.ts";
import { resolveResearchCapabilities, researchAgent, renderResearchCapabilities } from "../lib/sdd-research-capabilities.ts";

const inventory = (names: string[]) => ({ getActiveTools: () => names, getAllTools: () => names.map(name => ({ name, sourceInfo: { source: "extension" } })) });
const agent = { name: "sdd-research", tools: ["read", "write", "fetch_content", "web_search", "source_check", "get_search_content"], instructions: "Research" } as never;

test("approved active external tools reach the actual child CLI allowlist", () => {
 const pi = inventory(["read", "write", "fetch_content", "web_search", "source_check", "get_search_content", "bash", "mcp"]);
 const result = researchAgent(agent, pi);
 const args = childArguments({ agent: result.agent, sessionDir: "sessions" } as never);
 assert.equal(args[args.indexOf("--tools") + 1], "read,write,fetch_content,web_search,source_check,get_search_content,subagent_parent_message");
 assert.equal(result.capabilities.documentation.status, "available");
 assert.equal(result.capabilities["open-web"].status, "available");
});
test("class-specific grants render and persist exactly, while child tools remain their union", () => {
 const names = ["web_search", "source_check", "fetch_content", "get_search_content"];
 const caps = resolveResearchCapabilities(inventory([...names, "unknown"]));
 assert.deepEqual(caps.documentation.tools, ["fetch_content"]);
 assert.deepEqual(caps["open-web"].tools, names);
 assert.match(renderResearchCapabilities(caps), /documentation: available; tools=\["fetch_content"\]/);
 assert.deepEqual(resolveResearchCapabilities(inventory(["web_search"])).documentation.tools, []);
 assert.deepEqual(resolveResearchCapabilities(inventory(["web_search"]))["open-web"].tools, ["web_search"]);
 assert.deepEqual(researchAgent(agent, inventory(names)).agent.tools, agent.tools);
 const instructions = readFileSync(new URL("../assets/agents/sdd-research.md", import.meta.url), "utf8");
 assert.match(instructions, /Persist grants per source class exactly as observed/);
 assert.match(instructions, /never copy the child tool union into each class/);
});
test("open-web requires all four canonical tools, each active and unrestricted", () => {
 const required = ["web_search", "source_check", "fetch_content", "get_search_content"];
 for (const missing of required) {
  const remaining = required.filter(name => name !== missing);
  for (const caps of [
   resolveResearchCapabilities(inventory(remaining)),
   resolveResearchCapabilities({ ...inventory(required), getActiveTools: () => remaining }),
   resolveResearchCapabilities(inventory(required), remaining),
   researchAgent(agent, inventory(remaining)).capabilities,
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
