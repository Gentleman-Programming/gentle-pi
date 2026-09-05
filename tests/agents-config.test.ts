import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import {
	AGENT_MODE,
	discoverAgents,
	parseAgentDefinition,
	parseAgentsConfig,
	parseFrontmatter,
	parseModelRef,
	resolveAgentProfile,
} from "../lib/agents-config.ts";

// Gentle Agents configuration: markdown agent definitions (the same files
// gentle-ai installs) and subagents.json, both parsed without touching pi.

const root = mkdtempSync(join(tmpdir(), "gentle-agents-config-"));
after(() => rmSync(root, { recursive: true, force: true }));

const EXPLORER = `---
name: gentle-ai-explore
description: Read-only exploration and mapping.
model: openai-codex/gpt-5.6-terra
thinking: high
tools:
  - read
  - grep
  - codegraph
---

You are the read-only explorer.
Map files and return a compressed handoff.
`;

test("parseFrontmatter reads scalars, inline lists, and block lists, and keeps the body", () => {
	const { data, body } = parseFrontmatter("---\nname: a\ntools: [read, grep]\nlist:\n  - one\n  - two\nquoted: \"x: y\"\n---\nBody here\n");
	assert.deepEqual(data, { name: "a", tools: ["read", "grep"], list: ["one", "two"], quoted: "x: y" });
	assert.equal(body, "Body here");
	assert.deepEqual(parseFrontmatter("no frontmatter"), { data: {}, body: "no frontmatter" });
});

test("parseModelRef splits provider/id and accepts a bare id", () => {
	assert.deepEqual(parseModelRef("openai-codex/gpt-5.6-terra"), { provider: "openai-codex", id: "gpt-5.6-terra" });
	assert.deepEqual(parseModelRef("sonnet"), { provider: undefined, id: "sonnet" });
	assert.equal(parseModelRef("   "), undefined);
});

test("parseAgentDefinition builds a definition from the gentle-ai agent format", () => {
	const agent = parseAgentDefinition(EXPLORER, "/home/x/.pi/agent/agents/gentle-ai-explore.md", "global");
	assert.ok(!("error" in agent));
	assert.equal(agent.name, "gentle-ai-explore");
	assert.equal(agent.description, "Read-only exploration and mapping.");
	assert.deepEqual(agent.model, { provider: "openai-codex", id: "gpt-5.6-terra" });
	assert.equal(agent.thinking, "high");
	assert.deepEqual(agent.tools, ["read", "grep", "codegraph"]);
	assert.equal(agent.mode, undefined);
	assert.equal(agent.scope, "global");
	assert.match(agent.instructions, /^You are the read-only explorer\./);
});

test("parseAgentDefinition accepts effort and subagent_mode aliases, csv tools, and names from the file", () => {
	const agent = parseAgentDefinition("---\ndescription: d\neffort: low\nsubagent_mode: background\ntools: read, bash\n---\nbody", "/p/.pi/agents/worker.md", "project");
	assert.ok(!("error" in agent));
	assert.equal(agent.name, "worker");
	assert.equal(agent.thinking, "low");
	assert.equal(agent.mode, AGENT_MODE.BACKGROUND);
	assert.deepEqual(agent.tools, ["read", "bash"]);
});

test("parseAgentDefinition rejects unknown thinking levels, modes, and empty bodies", () => {
	assert.match((parseAgentDefinition("---\nname: a\nthinking: extreme\n---\nbody", "/a.md", "global") as { error: string }).error, /thinking "extreme"/);
	assert.match((parseAgentDefinition("---\nname: a\nsubagent_mode: forever\n---\nbody", "/a.md", "global") as { error: string }).error, /mode "forever"/);
	assert.match((parseAgentDefinition("---\nname: a\n---\n   \n", "/a.md", "global") as { error: string }).error, /no instructions/);
});

test("discoverAgents merges the four directories with project over global and subagents over agents", () => {
	const home = join(root, "home");
	const cwd = join(root, "project");
	for (const dir of [".pi/agent/agents", ".pi/agent/subagents"]) mkdirSync(join(home, dir), { recursive: true });
	for (const dir of [".pi/agents", ".pi/subagents"]) mkdirSync(join(cwd, dir), { recursive: true });
	writeFileSync(join(home, ".pi/agent/agents/explore.md"), EXPLORER);
	writeFileSync(join(home, ".pi/agent/agents/shared.md"), "---\ndescription: global agents\n---\nglobal");
	writeFileSync(join(home, ".pi/agent/subagents/shared.md"), "---\ndescription: global subagents\n---\nglobal sub");
	writeFileSync(join(cwd, ".pi/agents/shared.md"), "---\ndescription: project agents\n---\nproject");
	writeFileSync(join(cwd, ".pi/agents/broken.md"), "---\nthinking: nope\n---\nx");
	writeFileSync(join(cwd, ".pi/agents/notes.txt"), "ignored");
	const { agents, errors } = discoverAgents({ cwd, home });
	assert.deepEqual(agents.map((agent) => `${agent.name}:${agent.description}:${agent.scope}`), ["gentle-ai-explore:Read-only exploration and mapping.:global", "shared:project agents:project"]);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /broken\.md/);
	assert.deepEqual(discoverAgents({ cwd: join(root, "empty"), home: join(root, "nohome") }), { agents: [], errors: [] });
});

test("parseAgentsConfig applies defaults, validates values, and lets the project file win", () => {
	const config = parseAgentsConfig({ default_model: "openai-codex/gpt-6-astra", default_effort: "medium", max_concurrency: 3, timeout_ms: 1000, model_profiles: { explore: { model: "openai-codex/gpt-5.6-terra", effort: "high" } } }, { max_concurrency: 2, model_profiles: { explore: { effort: "low" }, worker: { model: "anthropic/claude-sonnet-5" } } });
	assert.deepEqual(config.defaultModel, { provider: "openai-codex", id: "gpt-6-astra" });
	assert.equal(config.defaultThinking, "medium");
	assert.equal(config.maxConcurrency, 2);
	assert.equal(config.timeoutMs, 1000);
	assert.deepEqual(config.modelProfiles.explore, { model: { provider: "openai-codex", id: "gpt-5.6-terra" }, thinking: "low" });
	assert.deepEqual(config.modelProfiles.worker, { model: { provider: "anthropic", id: "claude-sonnet-5" }, thinking: undefined });
	const defaults = parseAgentsConfig(undefined, undefined);
	assert.equal(defaults.maxConcurrency, 5);
	assert.equal(defaults.timeoutMs, 20 * 60_000);
	assert.equal(defaults.stallTimeoutMs, 4 * 60_000);
	assert.equal(defaults.defaultMode, AGENT_MODE.TASK);
	assert.equal(defaults.historyMaxTasks, 200);
	assert.equal(parseAgentsConfig({ max_concurrency: "many", default_effort: "wild", default_mode: "background" }, undefined).maxConcurrency, 5);
	assert.equal(parseAgentsConfig({ default_mode: "background" }, undefined).defaultMode, AGENT_MODE.BACKGROUND);
});

test("resolveAgentProfile prefers the profile, then the definition, then the defaults", () => {
	const config = parseAgentsConfig({ default_model: "openai-codex/gpt-6-astra", default_effort: "medium", model_profiles: { "gentle-ai-explore": { effort: "high" } } }, undefined);
	const explore = parseAgentDefinition(EXPLORER, "/x/explore.md", "global");
	assert.ok(!("error" in explore));
	assert.deepEqual(resolveAgentProfile(explore, config), { model: { provider: "openai-codex", id: "gpt-5.6-terra" }, thinking: "high", source: { model: "definition", thinking: "profile" } });
	const bare = parseAgentDefinition("---\nname: bare\n---\nbody", "/x/bare.md", "global");
	assert.ok(!("error" in bare));
	assert.deepEqual(resolveAgentProfile(bare, config), { model: { provider: "openai-codex", id: "gpt-6-astra" }, thinking: "medium", source: { model: "default", thinking: "default" } });
	assert.deepEqual(resolveAgentProfile(bare, parseAgentsConfig(undefined, undefined)).source, { model: "unresolved", thinking: "unresolved" });
});
