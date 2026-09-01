import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const PACKAGE_ROOT = join(process.cwd());
const ASSETS_AGENTS_DIR = join(PACKAGE_ROOT, "assets", "agents");

// The helpers below mirror the pi-subagents agent-frontmatter parsing contract
// that turned gentle-pi's YAML tool blocks into real child allowlists.
//
// Upstream contract (pin deliberately if it changes):
// - pi-subagents >= 0.35.0 (2026-07-17), nicobailon/pi-subagents#507:
//   `parseFrontmatterList` accepts simple-scalar newline block lists for
//   `tools` (and reads/skills/...) while preserving comma-separated syntax.
// - pi-subagents <= 0.34.0 split `tools` on commas only, so a YAML block
//   collapsed into one garbage token and packaged agents started with no
//   filesystem tools — the failure reported in gentle-pi#62.
// - `splitToolList` partitions `mcp:`-prefixed entries into MCP direct tools.
//
// gentle-pi supports BOTH subagent packages (see SUBAGENTS_PACKAGE_NAMES in
// extensions/gentle-ai.ts: "pi-subagents-j0k3r" and "pi-subagents"), so the
// j0k3r parsing rules are mirrored below as well. gentle-pi deliberately does
// not depend on either package at build time; if either upstream changes its
// parsing semantics, update these mirrors as a conscious contract decision,
// not as drift.

function parseFrontmatterList(raw: string | undefined): string[] | undefined {
	if (raw === undefined) return undefined;
	return raw
		.split("\n")
		.flatMap((line) => {
			const value = line.trim();
			const listItem = value.match(/^-\s+(.+)$/);
			return (listItem?.[1] ?? value).split(",");
		})
		.map((value) => value.trim())
		.filter(Boolean);
}

function splitToolList(rawTools: string[] | undefined): { tools: string[]; mcpDirectTools: string[] } {
	const mcpDirectTools: string[] = [];
	const tools: string[] = [];
	for (const tool of rawTools ?? []) {
		if (tool.startsWith("mcp:")) {
			mcpDirectTools.push(tool.slice(4));
		} else {
			tools.push(tool);
		}
	}
	return { tools, mcpDirectTools };
}

const DENY_ALL_MARKER = '"*": false';

interface ParsedAgentTools {
	builtinTools: string[];
	mcpDirectTools: string[];
	declaresDenyAll: boolean;
}

function parsePackagedAgentTools(file: string): ParsedAgentTools {
	const source = readFileSync(file, "utf8");
	const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
	assert.ok(frontmatter, `${file} must have YAML frontmatter`);
	const lines = frontmatter.split("\n");
	const toolsIndex = lines.findIndex((line) => line === "tools:");
	assert.notEqual(toolsIndex, -1, `${file} must declare tools`);

	const blockLines: string[] = [];
	for (const line of lines.slice(toolsIndex + 1)) {
		if (!line.startsWith("  - ") && line.trim() !== "") break;
		if (line.trim() !== "") blockLines.push(line);
	}
	assert.ok(blockLines.length > 0, `${file} must declare a YAML tools block`);

	const parsed = parseFrontmatterList(blockLines.join("\n"));
	assert.ok(parsed !== undefined, `${file} tools block must parse`);
	const { tools, mcpDirectTools } = splitToolList(parsed);
	return {
		builtinTools: tools,
		mcpDirectTools,
		declaresDenyAll: tools.includes(DENY_ALL_MARKER),
	};
}

test("issue #62 regression: packaged YAML tool blocks parse to real allowlists under the pi-subagents parsing contract (>= 0.35.0)", () => {
	const agentFiles = readdirSync(ASSETS_AGENTS_DIR).flatMap((entry) =>
		entry.endsWith(".md") ? [join(ASSETS_AGENTS_DIR, entry)] : [],
	);
	assert.ok(agentFiles.length > 0, "gentle-pi must ship packaged agents");

	for (const file of agentFiles) {
		const { builtinTools, declaresDenyAll } = parsePackagedAgentTools(file);
		const label = file.split("/").pop() ?? file;

		// The #62 failure signature: a comma-only parser collapses the whole
		// block into one token carrying embedded newlines or list markers.
		for (const tool of builtinTools) {
			assert.ok(
				!tool.includes("\n") && !tool.startsWith("- "),
				`${label}: tool token ${JSON.stringify(tool)} collapsed YAML lines — the parsing contract regressed (gentle-pi#62)`,
			);
		}

		assert.ok(builtinTools.length > 0, `${label} must parse to a non-empty allowlist`);
		assert.ok(
			builtinTools.includes("read"),
			`${label} must retain the read tool after parsing`,
		);

		if (declaresDenyAll) {
			// The `"*": false` deny-all prefix must survive as its own inert
			// token and never swallow the tools declared after it.
			const toolsAfterMarker = builtinTools.filter((tool) => tool !== DENY_ALL_MARKER);
			assert.ok(
				toolsAfterMarker.length > 0,
				`${label}: the "*": false marker swallowed every following tool`,
			);
			assert.ok(
				toolsAfterMarker.includes("read"),
				`${label}: read must survive after the "*": false marker`,
			);
		}
	}
});

test("the vendored parsing contract handles YAML blocks, comma scalars, and mcp partitioning identically", () => {
	const yamlBlock = ["  - read", "  - grep", "  - find", "  - mcp:engram"].join("\n");
	const commaScalar = "read, grep, find, mcp:engram";

	const fromBlock = splitToolList(parseFrontmatterList(yamlBlock));
	const fromScalar = splitToolList(parseFrontmatterList(commaScalar));

	assert.deepEqual(fromBlock.tools, ["read", "grep", "find"]);
	assert.deepEqual(fromBlock.mcpDirectTools, ["engram"]);
	assert.deepEqual(fromBlock, fromScalar, "block and scalar forms must parse identically");

	// Documents why the mirror exists: the pre-0.35.0 comma-only split
	// collapses a YAML block into exactly the garbage this suite rejects.
	const commaOnlyLegacy = (yamlBlock ?? "").split(",");
	for (const token of commaOnlyLegacy) {
		if (token.includes("\n")) {
			assert.match(token, /\n/, "legacy comma-only parsing collapses YAML lines into one token");
			break;
		}
	}
});

// Mirrors pi-subagents-j0k3r 1.5.6 frontmatter semantics (src/config.ts):
// `- item` list lines append scalar tokens to the current key; a non-empty
// `tools:` value means inline comma syntax; declaring BOTH formats on one
// agent is ambiguous and that package refuses to load the agent.
function parseJ0k3rTools(frontmatter: string): { tools: string[]; ambiguous: boolean } {
	const tools: string[] = [];
	let toolsFormat: "inline" | "multiline" | undefined;
	let ambiguous = false;
	let currentKey: string | undefined;
	for (const line of frontmatter.split("\n")) {
		if (!line.trim()) continue;
		const list = line.match(/^\s*-\s+(.+)$/);
		if (list && currentKey) {
			if (currentKey === "tools") {
				if (toolsFormat === "inline") ambiguous = true;
				toolsFormat ??= "multiline";
				tools.push(list[1].trim());
			}
			continue;
		}
		const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
		if (!match) continue;
		currentKey = match[1];
		if (currentKey === "tools") {
			const format = match[2].trim() ? "inline" : "multiline";
			if (toolsFormat !== undefined && format !== toolsFormat) ambiguous = true;
			toolsFormat = format;
			if (format === "inline") {
				tools.push(...match[2].split(",").map((item) => item.trim()).filter(Boolean));
			}
		}
	}
	return { tools, ambiguous };
}

// Non-array `tools` scalars are verified upstream behavior, not a mirror bug:
// pi-subagents-j0k3r@1.5.6 turns `tools: false` into data.tools === ["false"]
// (parseScalar("false") -> boolean false -> String(false) -> "false", kept by
// filter(Boolean)), and `tools: true` into ["true"]. The DEFAULT_TOOLS fallback
// at the agent-load boundary (config.ts:343) fires only when the `tools` key is
// absent entirely. Mirroring that quirk is a conscious contract decision;
// "fixing" it into a fallback here would be drift from the pinned contract.
test("j0k3r contract quirk: non-array tools scalars stay as inert tokens; only undeclared tools hit the DEFAULT_TOOLS fallback", () => {
	const { tools: falseTools, ambiguous } = parseJ0k3rTools("name: a\ndescription: d\ntools: false");
	assert.deepEqual(falseTools, ["false"], "tools: false must mirror upstream's inert \"false\" token, not a fallback");
	assert.ok(!ambiguous, "a lone non-array scalar is not format-ambiguous upstream");

	const { tools: trueTools } = parseJ0k3rTools("name: a\ndescription: d\ntools: true");
	assert.deepEqual(trueTools, ["true"], "tools: true mirrors upstream's inert \"true\" token");

	// Undeclared `tools` is the only non-array case upstream: the frontmatter
	// scan leaves data.tools undefined and the agent-load boundary resolves it
	// to DEFAULT_TOOLS (['read', 'memory_context', 'memory_search',
	// 'memory_recall', 'memory_get'] in j0k3r config.ts). This mirror stops at
	// the empty declaration; the fallback lives in the package, not here.
	const { tools: undeclared } = parseJ0k3rTools("name: a\ndescription: d\nmodel: sonnet");
	assert.deepEqual(undeclared, [], "an absent tools key parses to no tokens; upstream adds DEFAULT_TOOLS at load");
});

test("issue #62 regression: packaged agents also satisfy the pi-subagents-j0k3r multiline parsing rules", () => {
	const agentFiles = readdirSync(ASSETS_AGENTS_DIR).flatMap((entry) =>
		entry.endsWith(".md") ? [join(ASSETS_AGENTS_DIR, entry)] : [],
	);
	assert.ok(agentFiles.length > 0, "gentle-pi must ship packaged agents");

	for (const file of agentFiles) {
		const source = readFileSync(file, "utf8");
		const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
		assert.ok(frontmatter, `${file} must have YAML frontmatter`);
		const label = file.split("/").pop() ?? file;

		const { tools, ambiguous } = parseJ0k3rTools(frontmatter);
		assert.ok(!ambiguous, `${label}: j0k3r treats mixed inline+multiline tools as ambiguous and refuses to load the agent`);
		assert.ok(tools.length > 0, `${label} must parse to a non-empty j0k3r tool list`);
		assert.ok(tools.includes("read"), `${label} must retain read under j0k3r parsing`);
		for (const tool of tools) {
			assert.ok(
				!tool.includes("\n") && !tool.startsWith("- "),
				`${label}: j0k3r token ${JSON.stringify(tool)} collapsed YAML lines`,
			);
		}
	}
});
