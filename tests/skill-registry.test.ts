import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/skill-registry.ts";

test("project skill dirs include supported workspace roots", () => {
	const cwd = "/repo";
	const dirs = __testing.projectSkillDirs(cwd);
	for (const want of [
		"skills",
		".opencode/skills",
		".claude/skills",
		".gemini/skills",
		".cursor/skills",
		".github/skills",
		".codex/skills",
		".qwen/skills",
		".kiro/skills",
		".openclaw/skills",
		".pi/skills",
		".agent/skills",
		".agents/skills",
		".atl/skills",
	]) {
		assert.ok(dirs.includes(join(cwd, want)), `missing ${want}`);
	}
});

test("Compact Rules are preferred over fallback sections", () => {
	const rules = __testing.extractCompactRulesSection(`## Compact Rules

- Explicit compact rule.

## Hard Rules

- Hard rule should not be copied.
`);

	assert.deepEqual(rules, ["Explicit compact rule."]);
});

test("LLM-first and legacy sections extract bullets, ordered lists, and tables", () => {
	const rules = __testing.extractCompactRulesSection(`## Hard Rules

- Prefer focused tests.

## Critical Rules

1. Link an approved issue.
2. Keep PRs within review budget.

## Voice Rules

| Rule | Requirement |
|------|-------------|
| Be warm | Sound like a teammate. |

## Decision Gates

| Target | Test pattern |
|---|---|
| File operations | Use t.TempDir(). |
`);

	assert.deepEqual(rules, [
		"Prefer focused tests.",
		"Link an approved issue.",
		"Keep PRs within review budget.",
		"Be warm: Sound like a teammate.",
		"File operations: Use t.TempDir().",
	]);
});

test("description trigger text is extracted when present", () => {
	assert.equal(
		__testing.extractTriggerDescription("Write comments. Trigger: PR feedback, issue replies."),
		"PR feedback, issue replies.",
	);
	assert.equal(__testing.extractTriggerDescription("No explicit trigger."), "No explicit trigger.");
});

test("fallback extraction is capped at 15 rules", () => {
	const body = `## Hard Rules

${Array.from({ length: 16 }, (_, i) => `- Rule ${String(i + 1).padStart(2, "0")}.`).join("\n")}
`;
	const rules = __testing.extractCompactRulesSection(body);

	assert.equal(rules.length, 15);
	assert.equal(rules.at(-1), "Rule 15.");
});

test("project-scoped duplicate wins over user duplicate", () => {
	const cwd = join(tmpdir(), `gentle-pi-registry-${Date.now()}`);
	const projectPath = join(cwd, ".opencode/skills/dup/SKILL.md");
	const userPath = join(cwd + "-home", ".config/opencode/skills/dup/SKILL.md");
	const entries = [
		{ name: "dup", path: userPath, description: "user", rules: ["User rule."] },
		{ name: "dup", path: projectPath, description: "project", rules: ["Project rule."] },
	];

	const [chosen] = __testing.dedupeBySkillName(entries, cwd);
	assert.equal(chosen.path, projectPath);
});

test("uniqueExistingDirs normalizes duplicates and ignores missing roots", () => {
	const root = join(tmpdir(), `gentle-pi-existing-${Date.now()}`);
	const existing = join(root, "skills");
	mkdirSync(existing, { recursive: true });

	assert.deepEqual(__testing.uniqueExistingDirs([existing, join(root, "skills/"), join(root, "missing")]), [existing]);
});
