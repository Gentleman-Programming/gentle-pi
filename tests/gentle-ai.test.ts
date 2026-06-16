import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

function writeMarkdown(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

test("agent discovery skips skills directories", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dotAgents = join(root, ".agents");
	writeMarkdown(join(dotAgents, "reviewer.md"), "name: reviewer\n");
	writeMarkdown(join(dotAgents, "team", "worker.md"), "name: worker\n");
	writeMarkdown(join(dotAgents, "skills", "ai-sdk", "SKILL.md"), "name: ai-sdk\n");
	writeMarkdown(
		join(dotAgents, "skills", "ai-sdk", "references", "evaluation.md"),
		"name: Prompt Evaluation\n",
	);

	const syncAgents = __testing.listAgentsFromDir(dotAgents, "user");
	const asyncAgents = await __testing.listAgentsFromDirAsync(dotAgents, "user");

	assert.deepEqual(
		syncAgents.map((agent) => agent.name),
		["reviewer", "worker"],
	);
	assert.deepEqual(
		asyncAgents.map((agent) => agent.name),
		["reviewer", "worker"],
	);
});

test("orchestrator prompt refreshes from disk on each access", (t) => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gentle-pi-orchestrator-"));
	t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
	const promptFile = join(tmpDir, "orchestrator.md");

	// Write initial content
	writeFileSync(promptFile, "First version");
	const first = __testing.getOrchestratorPrompt(promptFile);
	assert.equal(first, "First version");

	// Update the file
	writeFileSync(promptFile, "Updated version");
	const second = __testing.getOrchestratorPrompt(promptFile);
	assert.equal(second, "Updated version");

	// Change it again to prove freshness on each call
	writeFileSync(promptFile, "Third version");
	const third = __testing.getOrchestratorPrompt(promptFile);
	assert.equal(third, "Third version");
});

test("orchestrator prompt returns empty string when file is missing", (t) => {
	// Build a deterministic, cross-platform missing path: the dir exists, the child does not.
	const tmpDir = mkdtempSync(join(tmpdir(), "gentle-pi-missing-"));
	t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
	const missingPath = join(tmpDir, "orchestrator.md");
	const result = __testing.getOrchestratorPrompt(missingPath);
	// Should not throw, should return empty string instead
	assert.equal(result, "");
});
