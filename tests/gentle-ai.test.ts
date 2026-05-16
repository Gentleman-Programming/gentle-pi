import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

function writeMarkdown(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

test("agent discovery can skip .agents skills directories", () => {
	const root = join(tmpdir(), `gentle-pi-agents-${Date.now()}`);
	const dotAgents = join(root, ".agents");
	writeMarkdown(
		join(dotAgents, "reviewer.md"),
		`---
name: reviewer
---

# Reviewer
`,
	);
	writeMarkdown(
		join(dotAgents, "skills", "ai-sdk", "SKILL.md"),
		`---
name: ai-sdk
description: AI SDK skill.
---

# AI SDK
`,
	);
	writeMarkdown(
		join(dotAgents, "skills", "ai-sdk", "references", "evaluation.md"),
		`---
name: Prompt Evaluation
---

# Prompt Evaluation
`,
	);

	const agents = __testing.listAgentsFromDir(dotAgents, "user", {
		skipDirectoryNames: ["skills"],
	});

	assert.deepEqual(
		agents.map((agent) => agent.name),
		["reviewer"],
	);
});

test("agent discovery still scans non-skill subdirectories", () => {
	const root = join(tmpdir(), `gentle-pi-nested-agents-${Date.now()}`);
	const dotAgents = join(root, ".agents");
	writeMarkdown(
		join(dotAgents, "team", "worker.md"),
		`---
name: worker
---

# Worker
`,
	);

	const agents = __testing.listAgentsFromDir(dotAgents, "project", {
		skipDirectoryNames: ["skills"],
	});

	assert.deepEqual(
		agents.map((agent) => agent.name),
		["worker"],
	);
});
