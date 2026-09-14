import assert from "node:assert/strict";
import test from "node:test";
import { upsertAgentFrontmatterRouting } from "../lib/agent-frontmatter.ts";

const MODEL = "model: deepseek/deepseek-v4-flash";
const DESCRIPTION_LINE =
	"  Adversarial review lens evaluating security risks, data exposure, and permission flaws.";

const BLOCK_SCALAR_AGENT = [
	"---",
	"name: review-risk",
	'role: "Security Risk Auditor"',
	"description: >",
	DESCRIPTION_LINE,
	"subagent: true",
	"---",
	"",
	"Body stays untouched.",
	"",
].join("\n");

function lines(...values: readonly string[]): string {
	return values.join("\n");
}

test("routing keys follow a block scalar description instead of breaking it", () => {
	const updated = upsertAgentFrontmatterRouting(BLOCK_SCALAR_AGENT, [MODEL]);
	assert.equal(
		updated,
		lines(
			"---",
			"name: review-risk",
			'role: "Security Risk Auditor"',
			"description: >",
			DESCRIPTION_LINE,
			MODEL,
			"subagent: true",
			"---",
			"",
			"Body stays untouched.",
			"",
		),
	);
});

test("the block scalar keeps its continuation line adjacent to its header", () => {
	const updated = upsertAgentFrontmatterRouting(BLOCK_SCALAR_AGENT, [MODEL]);
	const frontmatter = updated.split("\n");
	const header = frontmatter.indexOf("description: >");
	assert.equal(frontmatter[header + 1], DESCRIPTION_LINE);
	assert.equal(frontmatter[header + 2], MODEL);
});

test("re-applying the same routing is idempotent", () => {
	const once = upsertAgentFrontmatterRouting(BLOCK_SCALAR_AGENT, [MODEL]);
	const twice = upsertAgentFrontmatterRouting(once, [MODEL]);
	assert.equal(twice, once);
});

test("an existing routing key is replaced, never duplicated", () => {
	const once = upsertAgentFrontmatterRouting(BLOCK_SCALAR_AGENT, ["model: old/model"]);
	const twice = upsertAgentFrontmatterRouting(once, [MODEL]);
	assert.equal((twice.match(/^model:/gm) ?? []).length, 1);
	assert.ok(twice.includes(MODEL));
	assert.ok(!twice.includes("old/model"));
});

test("routing keys land after every continuation line of a multi-line block", () => {
	const content = lines(
		"---",
		"name: multi",
		"description: >",
		"  first paragraph",
		"",
		"  second paragraph",
		"model: old/model",
		"subagent: true",
		"---",
		"",
	);
	assert.equal(
		upsertAgentFrontmatterRouting(content, [MODEL]),
		lines(
			"---",
			"name: multi",
			"description: >",
			"  first paragraph",
			"",
			"  second paragraph",
			MODEL,
			"subagent: true",
			"---",
			"",
		),
	);
});

test("literal and chomped block scalar descriptions are handled", () => {
	for (const header of ["description: |", "description: |-", "description: >-", "description: |2"]) {
		const content = lines("---", "name: literal", header, "  literal line", "---", "");
		assert.equal(
			upsertAgentFrontmatterRouting(content, [MODEL]),
			lines("---", "name: literal", header, "  literal line", MODEL, "---", ""),
			`header ${header}`,
		);
	}
});

test("a plain scalar description keeps routing keys on the following line", () => {
	const content = lines(
		"---",
		"name: judge",
		"description: Judgment Day blind reviewer.",
		"tools: [read]",
		"---",
		"",
	);
	assert.equal(
		upsertAgentFrontmatterRouting(content, [MODEL]),
		lines(
			"---",
			"name: judge",
			"description: Judgment Day blind reviewer.",
			MODEL,
			"tools: [read]",
			"---",
			"",
		),
	);
});

test("thinking keys are upserted alongside model keys", () => {
	const updated = upsertAgentFrontmatterRouting(BLOCK_SCALAR_AGENT, [
		MODEL,
		"thinking: high",
	]);
	assert.equal(
		updated,
		lines(
			"---",
			"name: review-risk",
			'role: "Security Risk Auditor"',
			"description: >",
			DESCRIPTION_LINE,
			MODEL,
			"thinking: high",
			"subagent: true",
			"---",
			"",
			"Body stays untouched.",
			"",
		),
	);
});

test("an empty routing list only strips existing routing keys", () => {
	const withRouting = upsertAgentFrontmatterRouting(BLOCK_SCALAR_AGENT, [MODEL]);
	assert.equal(upsertAgentFrontmatterRouting(withRouting, []), BLOCK_SCALAR_AGENT);
});

test("content without frontmatter is returned unchanged", () => {
	const content = "no frontmatter here\n";
	assert.equal(upsertAgentFrontmatterRouting(content, [MODEL]), content);
});

test("a definition without a description keeps the previous insertion point", () => {
	const content = lines("---", "name: nodesc", "tools: [read]", "---", "");
	assert.equal(
		upsertAgentFrontmatterRouting(content, [MODEL]),
		lines("---", "name: nodesc", MODEL, "tools: [read]", "---", ""),
	);
});

test("the agent body is never modified", () => {
	const updated = upsertAgentFrontmatterRouting(BLOCK_SCALAR_AGENT, [MODEL]);
	const body = BLOCK_SCALAR_AGENT.split("\n---\n")[1];
	assert.ok(updated.endsWith(body));
});

test("trailing blank lines in a block scalar are preserved before routing keys", () => {
	const content = lines(
		"---",
		"name: trailing-blank",
		"description: >+",
		"  first line",
		"  second line",
		"",
		"subagent: true",
		"---",
		"",
	);
	assert.equal(
		upsertAgentFrontmatterRouting(content, [MODEL]),
		lines(
			"---",
			"name: trailing-blank",
			"description: >+",
			"  first line",
			"  second line",
			"",
			MODEL,
			"subagent: true",
			"---",
			"",
		),
	);
});
