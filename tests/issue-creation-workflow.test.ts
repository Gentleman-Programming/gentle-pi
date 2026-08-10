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
	assert.match(skill, /--state all --limit 1000 --search/);
	assert.match(skill, /gh issue edit <number> --add-label "status:approved"/);
});

test("Discover issue templates reads config.yml and honors blank_issues_enabled", () => {
	const section = (() => {
		const start = skill.indexOf("### Discover issue templates");
		assert.ok(start !== -1, "Discover issue templates section must exist");
		const nextHeader = skill.indexOf("\n### ", start + 1);
		return skill.slice(start, nextHeader === -1 ? undefined : nextHeader);
	})();

	assert.match(
		section,
		/gh api --include repos\/\{owner\}\/\{repo\}\/contents\/\.github\/ISSUE_TEMPLATE\/config\.yml/,
		"Discover section must inspect the HTTP status for .github/ISSUE_TEMPLATE/config.yml",
	);
	assert.match(
		section,
		/On HTTP 200 for `config\.yml`, decode the response body's `\.content` field from base64/,
		"Discover section must decode config.yml content after a successful lookup",
	);
	assert.ok(
		section.includes("blank_issues_enabled"),
		"Discover section must reference blank_issues_enabled",
	);
	assert.match(
		section,
		/blank_issues_enabled: false[\s\S]*?do not create a blank issue/,
		"Discover section must forbid a blank issue when blank_issues_enabled is false",
	);
	assert.match(
		section,
		/(use a discovered template|maintainer guidance)/,
		"Discover section must direct to a discovered template or maintainer guidance",
	);
});

test("both discovery presentations continue only for 404 on optional template paths", () => {
	const sections = [
		["### Discover issue templates", "\n### Discover labels"],
		["### Discovery (run before creating any issue)", "\n### Duplicate search"],
	].map(([heading, nextHeading]) => {
		const start = skill.indexOf(heading);
		assert.ok(start !== -1, `${heading} section must exist`);
		const end = skill.indexOf(nextHeading, start + 1);
		return skill.slice(start, end === -1 ? undefined : end);
	});

	for (const section of sections) {
		assert.ok(
			section.includes(
				"gh api --include repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE\n",
			),
			"discovery must inspect the optional .github/ISSUE_TEMPLATE path",
		);
		assert.ok(
			section.includes(
				"gh api --include repos/{owner}/{repo}/contents/.github/ISSUE_TEMPLATE/config.yml",
			),
			"discovery must inspect the optional .github/ISSUE_TEMPLATE/config.yml path",
		);
		assert.match(
			section,
			/HTTP 404 means "not configured"; continue to the blank-issue fallback policy/,
			"HTTP 404 must continue to the blank-issue fallback policy",
		);
		assert.match(
			section,
			/Any non-404 failure \(including authentication, authorization, rate-limit, network, 5xx, malformed, or unknown failures\) is blocking: surface the failure and stop/,
			"authentication, authorization, rate-limit, network, 5xx, malformed, and unknown failures must remain blocking",
		);
	}
});

test("both duplicate-search commands use --limit 1000", () => {
	const commands = skill.match(
		/gh issue list --state all --limit 1000 --search/g,
	);
	assert.ok(
		commands && commands.length >= 2,
		`expected at least 2 duplicate-search commands with --limit 1000, found ${commands ? commands.length : 0}`,
	);
});

test("template gh issue create commands use a discovered identifier and do not pass --label", () => {
	const section = (() => {
		const start = skill.indexOf("### Create");
		assert.ok(start !== -1, "Create section must exist");
		const nextHeader = skill.indexOf("\n### ", start + 1);
		return skill.slice(start, nextHeader === -1 ? undefined : nextHeader);
	})();
	assert.match(
		section,
		/TEMPLATE_ID="<discovered-template-identifier>"[\s\S]*?gh issue create --template "\$TEMPLATE_ID"/,
		"Create section must select the discovered template identifier before use",
	);

	const templateCreates = [
		...skill.matchAll(/gh issue create --template[^\n]*/g),
	].map((m) => m[0]);
	assert.ok(
		templateCreates.length >= 4,
		`expected at least 4 template create commands, found ${templateCreates.length}`,
	);
	assert.doesNotMatch(
		skill,
		/(?:bug_report|feature_request)\.ya?ml/,
		"skill must not require repository-specific template filenames",
	);
	for (const command of templateCreates) {
		assert.match(
			command,
			/--template "\$TEMPLATE_ID"/,
			"template create commands must pass the identifier selected from discovery",
		);
		assert.doesNotMatch(
			command,
			/--label/,
			"template create commands must not pass --label",
		);
	}

	assert.match(
		section,
		/gh issue create --title "fix\(scope\): description" --body "\.\.\."/,
		"blank-issue create command must remain intact",
	);
	assert.match(
		section,
		/Apply a label only after confirming an exact matching label exists in the discovered label set/,
		"Create section must note the discovered-label rule for manual --label",
	);
});
