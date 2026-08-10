import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const skillPath = join(repoRoot, "skills", "issue-creation", "SKILL.md");
const skill = readFileSync(skillPath, "utf8");

test("skills/issue-creation/SKILL.md exists and is non-empty", () => {
	assert.ok(skill.length > 0, "skill file should not be empty");
});

test("Pre-publication Discovery section contains required discovery commands", () => {
	assert.match(
		skill,
		/## Pre-publication Discovery[\s\S]*?gh api repos\/\{owner\}\/\{repo\}/,
		"Discovery section must reference gh api repos/{owner}/{repo}",
	);
	assert.match(
		skill,
		/## Pre-publication Discovery[\s\S]*?gh api repos\/\{owner\}\/\{repo\}\/labels/,
		"Discovery section must reference gh api repos/{owner}/{repo}/labels",
	);
	assert.match(
		skill,
		/## Pre-publication Discovery[\s\S]*?gh api repos\/\{owner\}\/\{repo\}\/issue_templates/,
		"Discovery section must reference gh api repos/{owner}/{repo}/issue_templates",
	);
});

test("Duplicate Reuse section searches both open and closed issues", () => {
	assert.match(
		skill,
		/## Duplicate Reuse[\s\S]*?--state all/,
		"Duplicate Reuse section must use --state all to search open AND closed issues",
	);
	assert.match(
		skill,
		/## Duplicate Reuse[\s\S]*?occurrence comment/,
		"Duplicate Reuse section must mention adding an occurrence comment instead of duplicating",
	);
});

test("Label Policy section restricts labels to the discovered set", () => {
	assert.match(
		skill,
		/## Label Policy[\s\S]*?only labels that exist in the discovered label set/,
		"Label Policy must restrict applied labels to the discovered set",
	);
	assert.match(
		skill,
		/## Label Policy[\s\S]*?Never invent or assume label names/,
		"Label Policy must forbid inventing or assuming labels",
	);
});

test("Privacy Scrub section defines all six placeholder tokens", () => {
	const section = (() => {
		const start = skill.indexOf("## Privacy Scrub");
		assert.ok(start !== -1, "Privacy Scrub section must exist");
		const nextHeader = skill.indexOf("\n## ", start + 1);
		return skill.slice(start, nextHeader === -1 ? undefined : nextHeader);
	})();

	const tokens = [
		"<private-project>",
		"<username>",
		"<hostname>",
		"<home-path>",
		"<credential>",
		"<internal-endpoint>",
	];
	for (const token of tokens) {
		assert.ok(
			section.includes(token),
			`Privacy Scrub section must define the ${token} placeholder token`,
		);
	}
});

test("Privacy Scrub section forbids publishing raw argv, paths, and env values", () => {
	assert.match(
		skill,
		/## Privacy Scrub[\s\S]*?Never publish raw argv, absolute paths, or environment values/,
		"Privacy Scrub must forbid publishing raw argv, absolute paths, or environment values",
	);
});

test("Questions vs Issues routes to Discussions only when has_discussions is true", () => {
	assert.match(
		skill,
		/has_discussions/,
		"Skill must reference the has_discussions flag rather than hardcoding a Discussions URL",
	);
});

test("skill does not hardcode the agent-teams-lite repo or its Discussions URL", () => {
	assert.doesNotMatch(
		skill,
		/agent-teams-lite/,
		"skill must not hardcode the agent-teams-lite repo name",
	);
	assert.doesNotMatch(
		skill,
		/github\.com\/Gentleman-Programming\/agent-teams-lite\/discussions/,
		"skill must not hardcode the agent-teams-lite Discussions URL",
	);
});

test("skill does not assert blank issues are disabled as a hardcoded rule", () => {
	assert.doesNotMatch(
		skill,
		/Blank issues are disabled/,
		"skill must discover blank-issue policy rather than hardcode it",
	);
});

test("Critical Rules require discovery before creation", () => {
	assert.match(
		skill,
		/## Critical Rules[\s\S]*?Discover blank-issue policy before creating/,
		"Critical Rules must require discovering blank-issue policy before creating",
	);
	assert.match(
		skill,
		/## Critical Rules[\s\S]*?Discover Discussions support/,
		"Critical Rules must require discovering Discussions support",
	);
});

test("Workflow places discovery as step 0 and privacy scrub before submission", () => {
	assert.match(
		skill,
		/## Workflow[\s\S]*?0\. Pre-publication Discovery/,
		"Workflow must place discovery as step 0",
	);
	assert.match(
		skill,
		/## Workflow[\s\S]*?Privacy-scrub title and body before submission/,
		"Workflow must place privacy scrub before submission",
	);
});

test("Commands section lists discovery, duplicate search, and maintainer actions", () => {
	assert.match(skill, /### Discovery/);
	assert.match(skill, /### Duplicate search/);
	assert.match(skill, /--state all --search/);
	assert.match(skill, /gh issue edit <number> --add-label "status:approved"/);
});