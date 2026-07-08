import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/skill-registry.ts";

const repoRoot = join(import.meta.dirname, "..");

function readSkillName(dir: string): string | undefined {
	const source = readFileSync(join(repoRoot, "skills", dir, "SKILL.md"), "utf8");
	return __testing.parseFrontmatter(source).name;
}

const PREFIXED_NAMES: Record<string, string> = {
	"branch-pr": "gentle-ai-branch-pr",
	"chained-pr": "gentle-ai-chained-pr",
	"issue-creation": "gentle-ai-issue-creation",
	"judgment-day": "gentle-ai-judgment-day",
	"skill-creator": "gentle-ai-skill-creator",
	"skill-improver": "gentle-ai-skill-improver",
};

const UNPREFIXED_DIRS = [
	"skill-registry",
	"release",
	"work-unit-commits",
	"gentle-ai",
	"comment-writer",
	"cognitive-doc-design",
];

for (const [dir, expectedName] of Object.entries(PREFIXED_NAMES)) {
	test(`skills/${dir}/SKILL.md frontmatter name is prefixed`, () => {
		assert.equal(readSkillName(dir), expectedName);
	});
}

for (const dir of UNPREFIXED_DIRS) {
	test(`skills/${dir}/SKILL.md frontmatter name carries no gentle-ai- prefix`, () => {
		const name = readSkillName(dir);
		assert.ok(name, `expected a name for ${dir}`);
		assert.ok(!name?.startsWith("gentle-ai-"), `${dir} should not be prefixed, got ${name}`);
	});
}
