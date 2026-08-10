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
		/## Pre-publication Discovery[\s\S]*?gh api --paginate 'repos\/\{owner\}\/\{repo\}\/labels\?per_page=100' --jq '\.\[\]\.name'/,
		"Discovery section must paginate the complete label set",
	);
	assert.match(
		skill,
		/## Pre-publication Discovery[\s\S]*?gh api --include repos\/\{owner\}\/\{repo\}\/contents\/\.github\/ISSUE_TEMPLATE/,
		"Discovery section must enumerate the Contents API template directory",
	);
	assert.doesNotMatch(
		skill,
		/\/issue_templates\b/,
		"skill must not rely on the deprecated issue_templates endpoint",
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

test("Privacy Scrub covers cross-platform home and non-home absolute paths safely", () => {
	const start = skill.indexOf("## Privacy Scrub");
	assert.ok(start !== -1, "Privacy Scrub section must exist");
	const end = skill.indexOf("\n## ", start + 1);
	const section = skill.slice(start, end === -1 ? undefined : end);
	for (const value of [
		"/home/<username>/work/<private-project>",
		"/Users/<username>/work/<private-project>",
		"<home-path>/work/<private-project>",
		"C:\\Users\\<username>\\work\\<private-project>",
		"<home-path>\\work\\<private-project>",
		"/var/lib/<private-project>/...",
	]) {
		assert.ok(section.includes(value), `Privacy Scrub must include safe path example ${value}`);
	}
	assert.doesNotMatch(
		section,
		/\/(?:home|Users)\/(?!<username>)[^/\s`]+/,
		"Unix home examples must not contain raw usernames",
	);
	assert.doesNotMatch(
		section,
		/[A-Z]:\\Users\\(?!<username>)[^\\\s`]+/,
		"Windows home examples must not contain raw usernames",
	);
	assert.doesNotMatch(
		section,
		/\/var\/lib\/(?!<private-project>)[^/\s`]+/,
		"non-home absolute path examples must not expose private components",
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

test("both discovery presentations use Contents inventory and preserve optional 404 handling", () => {
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
		assert.ok(
			section.includes(
				'DISCOVERED_TEMPLATE_PATH="<exact-path-returned-by-contents-inventory>"',
			),
			"discovery must retain each exact Contents inventory path",
		);
		assert.ok(
			section.includes(
				'gh api "repos/{owner}/{repo}/contents/$DISCOVERED_TEMPLATE_PATH" --jq \'.content\' | base64 -d',
			),
			"discovery must fetch and decode each exact discovered path",
		);
		assert.match(
			section,
			/every exact discovered `\.yml` or `\.yaml` path[\s\S]*?decoded content from the shared fetch command[\s\S]*?YAML issue-form metadata `name` and `description`/i,
			"YAML forms must require decoded name and description metadata",
		);
		assert.match(
			section,
			/every exact discovered `\.md` path[\s\S]*?decoded content from the shared fetch command[\s\S]*?Markdown frontmatter metadata `name` and `about`/i,
			"Markdown templates must require decoded name and about frontmatter",
		);
		assert.match(
			section,
			/Other extensions remain unroutable template types/,
			"other extensions must remain unroutable",
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

test("template selection uses decoded extension-specific metadata and a confirmed route", () => {
	const discoveryStart = skill.indexOf("### Discover issue templates");
	assert.ok(discoveryStart !== -1, "Discover issue templates section must exist");
	const discoveryEnd = skill.indexOf("\n### Discover labels", discoveryStart + 1);
	const discovery = skill.slice(
		discoveryStart,
		discoveryEnd === -1 ? undefined : discoveryEnd,
	);
	assert.match(
		discovery,
		/Contents API directory response as the authoritative template inventory/,
		"Contents directory enumeration must be the authoritative inventory",
	);
	assert.match(
		discovery,
		/exact discovered `\.yml` or `\.yaml` path[\s\S]*?YAML issue-form metadata `name` and `description`/,
		"YAML candidates must be decoded and inspected for name and description metadata",
	);
	assert.match(
		discovery,
		/exact discovered `\.md` path[\s\S]*?Markdown frontmatter metadata `name` and `about`/,
		"Markdown candidates must be decoded and inspected for name and about frontmatter",
	);
	assert.match(
		discovery,
		/Classify each candidate's purpose as `bug`, `feature`, or `other` from declared metadata; never classify purpose or select from a guessed filename/,
		"candidate purpose must use declared metadata rather than filenames",
	);
	assert.match(
		discovery,
		/Assign `TEMPLATE_ID` only from a confirmed matching Markdown candidate/,
		"TEMPLATE_ID must come only from a confirmed matching Markdown candidate",
	);
	assert.match(
		discovery,
		/If no candidate matches[\s\S]*?blank-issue path only when blank issues are allowed; otherwise stop for maintainer guidance/,
		"no-match flow must use an allowed blank issue or stop for maintainer guidance",
	);
});

test("form/YAML routes use the web chooser while Markdown routes use --template", () => {
	const formStart = skill.indexOf("### Form/YAML Issue Forms");
	assert.ok(formStart !== -1, "Form/YAML Issue Forms section must exist");
	const formEnd = skill.indexOf("\n### Bug Report", formStart + 1);
	const formGuidance = skill.slice(formStart, formEnd === -1 ? undefined : formEnd);
	assert.match(formGuidance, /gh issue create --web/);
	assert.doesNotMatch(formGuidance, /gh issue create --template/);

	const createStart = skill.indexOf("### Create");
	assert.ok(createStart !== -1, "Create section must exist");
	const createEnd = skill.indexOf("\n### ", createStart + 1);
	const create = skill.slice(createStart, createEnd === -1 ? undefined : createEnd);
	const formRouteStart = create.indexOf("# Confirmed matching form/YAML candidate");
	const markdownRouteStart = create.indexOf("# Confirmed matching Markdown candidate");
	const blankRouteStart = create.indexOf("# Other type or no confirmed metadata match");
	assert.ok(formRouteStart !== -1 && markdownRouteStart > formRouteStart);
	assert.ok(blankRouteStart > markdownRouteStart);
	const formRoute = create.slice(formRouteStart, markdownRouteStart);
	const markdownRoute = create.slice(markdownRouteStart, blankRouteStart);
	assert.match(formRoute, /gh issue create --web/);
	assert.doesNotMatch(formRoute, /gh issue create --template/);
	assert.match(
		markdownRoute,
		/TEMPLATE_ID="<confirmed-matching-markdown-template-identifier>"[\s\S]*?gh issue create --template "\$TEMPLATE_ID"/,
	);
	assert.doesNotMatch(markdownRoute, /--web|--body/);
});

test("decision tree checks questions and duplicates before template or blank routing", () => {
	const start = skill.indexOf("## Decision Tree");
	assert.ok(start !== -1, "Decision Tree section must exist");
	const tree = skill.slice(start);
	const question = tree.indexOf("Is it a question?");
	const duplicate = tree.indexOf("Is it a duplicate (open/closed)?");
	assert.ok(question !== -1 && duplicate !== -1);
	assert.match(tree, /Is it a question\?[\s\S]*?Discussions, only when has_discussions = true/);
	assert.match(tree, /Is it a duplicate \(open\/closed\)\?[\s\S]*?Add occurrence comment to existing issue/);
	for (const branch of [
		"Purpose metadata matches issue?",
		"Confirmed candidate type = form/YAML?",
		"Confirmed candidate type = Markdown?",
		"Other type or no confirmed match?",
	]) {
		const position = tree.indexOf(branch);
		assert.ok(position !== -1, `Decision Tree must include ${branch}`);
		assert.ok(question < position, `question routing must precede ${branch}`);
		assert.ok(duplicate < position, `duplicate reuse must precede ${branch}`);
	}
});

test("both label discovery commands paginate exactly 100 labels per page", () => {
	const command =
		"gh api --paginate 'repos/{owner}/{repo}/labels?per_page=100' --jq '.[].name'";
	assert.equal(
		skill.split(command).length - 1,
		2,
		"the complete paginated label discovery command must appear exactly twice",
	);
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

test("Markdown template commands use a confirmed identifier and blank creation owns CLI body", () => {
	const section = (() => {
		const start = skill.indexOf("### Create");
		assert.ok(start !== -1, "Create section must exist");
		const nextHeader = skill.indexOf("\n### ", start + 1);
		return skill.slice(start, nextHeader === -1 ? undefined : nextHeader);
	})();
	assert.match(
		section,
		/TEMPLATE_ID="<confirmed-matching-markdown-template-identifier>"[\s\S]*?gh issue create --template "\$TEMPLATE_ID"/,
		"Create section must assign a confirmed matching Markdown identifier before use",
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
	const issueTemplatesStart = skill.indexOf("## Issue Templates");
	const issueTemplatesEnd = skill.indexOf("\n## Label System", issueTemplatesStart + 1);
	const issueTemplates = skill.slice(issueTemplatesStart, issueTemplatesEnd);
	assert.doesNotMatch(
		issueTemplates,
		/--body/,
		"form/YAML and Markdown template examples must not create CLI bodies",
	);
	assert.match(
		section,
		/Apply a label only after confirming an exact matching label exists in the discovered label set/,
		"Create section must note the discovered-label rule for manual --label",
	);
});
