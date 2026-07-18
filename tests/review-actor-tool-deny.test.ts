import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Read-only review actors must deny omitted tools by DEFAULT, not by omission
// (parity with gentle-ai #1372). Each actor's tool map leads with the
// deny-all rule `"*": false` before its explicit allowances so globally
// enabled MCP namespaces and future tools stay denied unless listed.

const ROOT = join(import.meta.dirname, "..");
const ASSETS_AGENTS_DIR = join(ROOT, "assets", "agents");
const DENY_ALL_RULE = '"*": false';

const READ_ONLY_REVIEW_ACTORS = [
	"review-risk.md",
	"review-reliability.md",
	"review-resilience.md",
	"review-readability.md",
	"review-refuter.md",
	"review-validator.md",
	"jd-judge-a.md",
	"jd-judge-b.md",
] as const;

function readFrontmatter(path: string): string {
	const text = readFileSync(path, "utf8");
	const match = text.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(match, `${path} must have YAML frontmatter`);
	return match[1]!;
}

function readToolEntries(path: string): string[] {
	const lines = readFrontmatter(path).split("\n");
	const toolsIndex = lines.findIndex((line) => line === "tools:");
	assert.notEqual(toolsIndex, -1, `${path} must declare tools as a YAML array`);
	const entries: string[] = [];
	for (const line of lines.slice(toolsIndex + 1)) {
		if (!line.startsWith("  - ")) break;
		entries.push(line.slice(4).trim());
	}
	return entries;
}

// Mirrors the runtime consumption path (pi-subagents frontmatter parser +
// pi SDK allowlist): the declared array becomes a strict allowlist, and the
// session enables only registry tools whose exact name is declared.
function parseScalarLikeRuntime(value: string): string {
	const trimmed = value.trim();
	return trimmed.replace(/^['"]|['"]$/g, "");
}

function sanitizeLikeRuntime(tools: string[]): string[] {
	return tools.filter(
		(tool) => !tool.startsWith("subagent_"),
	);
}

function resolveActiveTools(
	declaredEntries: readonly string[],
	registry: readonly string[],
): string[] {
	const allowed = new Set(
		sanitizeLikeRuntime(declaredEntries.map(parseScalarLikeRuntime)),
	);
	return registry.filter((name) => allowed.has(name));
}

test("every read-only review actor leads its tool map with the deny-all rule", () => {
	for (const fileName of READ_ONLY_REVIEW_ACTORS) {
		const path = join(ASSETS_AGENTS_DIR, fileName);
		assert.ok(existsSync(path), `${fileName} must exist`);
		const entries = readToolEntries(path);
		assert.ok(entries.length >= 2, `${fileName} must declare the deny-all rule plus explicit allowances`);
		assert.equal(
			entries[0],
			DENY_ALL_RULE,
			`${fileName} must lead its tool map with ${DENY_ALL_RULE} so omitted tools are denied by default`,
		);
		for (const entry of entries.slice(1)) {
			assert.match(
				entry,
				/^[\w-]+$/,
				`${fileName} explicit allowance ${JSON.stringify(entry)} must be a plain tool name after the single leading deny-all rule`,
			);
		}
	}
});

test("a tool absent from the allowlist resolves to denied under the deny-all rule", () => {
	const registry = [
		"read",
		"grep",
		"glob",
		"find",
		"edit",
		"write",
		"bash",
		"mem_save",
		"codegraph_explore",
		"mcp__slack__slack_send_message",
		"subagent_run",
	] as const;

	const refuterEntries = readToolEntries(join(ASSETS_AGENTS_DIR, "review-refuter.md"));
	const refuterActive = resolveActiveTools(refuterEntries, registry);
	assert.deepEqual(refuterActive, ["read", "grep", "find"]);
	for (const omitted of ["edit", "write", "bash", "mem_save", "codegraph_explore", "mcp__slack__slack_send_message", "subagent_run"]) {
		assert.ok(!refuterActive.includes(omitted), `review-refuter must deny omitted tool ${omitted}`);
	}

	const riskEntries = readToolEntries(join(ASSETS_AGENTS_DIR, "review-risk.md"));
	const riskActive = resolveActiveTools(riskEntries, registry);
	assert.ok(riskActive.includes("bash"), "review-risk must keep its existing explicit bash allowance");
	assert.ok(!riskActive.includes("mem_save"), "review-risk must deny omitted memory tools");
	assert.ok(!riskActive.includes("mcp__slack__slack_send_message"), "review-risk must deny omitted MCP-namespaced tools");
});

test("the deny-all rule never enables a tool and never empties the runtime allowlist", () => {
	for (const fileName of READ_ONLY_REVIEW_ACTORS) {
		const entries = readToolEntries(join(ASSETS_AGENTS_DIR, fileName));
		const declared = sanitizeLikeRuntime(entries.map(parseScalarLikeRuntime));
		// Non-empty declared list: the runtime must never fall back to its
		// permissive configurable default toolset for these actors.
		assert.ok(declared.length > 0, `${fileName} must keep a non-empty runtime tools array`);
		// The parsed deny-all entry must not collide with any real tool name.
		const denyParsed = parseScalarLikeRuntime(DENY_ALL_RULE);
		assert.doesNotMatch(denyParsed, /^[\w-]+$/, "deny-all rule must not parse into a plausible tool name");
	}
});
