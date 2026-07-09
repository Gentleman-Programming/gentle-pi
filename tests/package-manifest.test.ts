import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installSddAssets } from "../lib/sdd-preflight.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

interface PackageJsonPiManifest {
	extensions?: string[];
}

interface PackageJson {
	dependencies?: Record<string, string>;
	bundledDependencies?: string[];
	bundleDependencies?: string[];
	pi?: PackageJsonPiManifest;
}

function readPackageJson(): PackageJson {
	const rawPackageJson = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");

	try {
		return JSON.parse(rawPackageJson) as PackageJson;
	} catch (error) {
		throw new Error("package.json must contain valid JSON", { cause: error });
	}
}

test("package manifest installs pi-pretty through a wrapper without bundling native optional dependencies", () => {
	const packageJson = readPackageJson();

	assert.equal(
		packageJson.dependencies?.["@heyhuynhgiabuu/pi-pretty"],
		"0.6.14",
		"gentle-pi must install the tested pi-pretty version as a normal dependency",
	);
	assert.ok(
		packageJson.pi?.extensions?.includes("./extensions"),
		"gentle-pi must load packaged extension wrappers",
	);
	assert.ok(
		!packageJson.pi?.extensions?.includes(
			"./node_modules/@heyhuynhgiabuu/pi-pretty/dist/index.js",
		),
		"gentle-pi must not reference pnpm-unportable nested node_modules paths",
	);
	assert.ok(
		existsSync(join(PACKAGE_ROOT, "extensions", "pi-pretty.ts")),
		"gentle-pi must expose pi-pretty through a packaged wrapper extension",
	);
	assert.ok(
		existsSync(join(PACKAGE_ROOT, "extensions", "quiet-tools.ts")),
		"gentle-pi must expose quiet built-in tool rendering through a packaged extension",
	);
	assert.ok(
		!packageJson.bundledDependencies?.includes("@heyhuynhgiabuu/pi-pretty"),
		"pi-pretty must not be bundled because its native optional dependencies are platform-specific",
	);
	assert.ok(
		!packageJson.bundleDependencies?.includes("@heyhuynhgiabuu/pi-pretty"),
		"pi-pretty must not be bundled because its native optional dependencies are platform-specific",
	);
});


function readAgentFrontmatter(file: string): string {
	const source = readFileSync(file, "utf8");
	const match = source.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(match, `${file} must have frontmatter`);
	return match[1];
}

function readAgentDefinition(file: string): {
	name: string;
	source: string;
	tools: string[];
} {
	const source = readFileSync(file, "utf8");
	const frontmatter = readAgentFrontmatter(file);
	const name = frontmatter.match(/^name:\s*(\S+)$/m)?.[1];
	assert.ok(name, `${file} must declare a frontmatter name`);
	const toolsBlock = frontmatter.match(/^tools:\n((?: {2}- [\w-]+\n?)+)/m)?.[1];
	assert.ok(toolsBlock, `${file} must declare a YAML tool list`);
	const tools = [...toolsBlock.matchAll(/^ {2}- ([\w-]+)$/gm)].map(
		(match) => match[1],
	);

	return { name, source, tools };
}

function readTextContract(source: string, heading: string): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = source.match(
		new RegExp(`^## ${escapedHeading}\\n[\\s\\S]*?\\n\\x60\\x60\\x60text\\n([\\s\\S]*?)\\n\\x60\\x60\\x60`, "m"),
	);
	assert.ok(match, `${heading} must include a text contract block`);
	return match[1];
}

function contractFields(contract: string, indentation = 0): string[] {
	const prefix = " ".repeat(indentation);
	return contract
		.split("\n")
		.flatMap((line) => {
			const match = line.match(new RegExp(`^${prefix}([a-z_]+):`));
			return match ? [match[1]] : [];
		});
}

function nestedContractFields(contract: string, parent: string): string[] {
	const lines = contract.split("\n");
	const parentIndexes = lines.flatMap((line, index) =>
		line.startsWith(`${parent}:`) ? [index] : [],
	);
	assert.equal(parentIndexes.length, 1, `${parent} must appear exactly once at top level`);

	const tail = lines.slice(parentIndexes[0] + 1);
	const relativeEnd = tail.findIndex((line) => /^\S/.test(line));
	const nestedBlock = relativeEnd === -1 ? tail : tail.slice(0, relativeEnd);

	return contractFields(nestedBlock.join("\n"), 2);
}

function readMarkdownSection(source: string, heading: string): string {
	const lines = source.split(/\r?\n/);
	const matches = lines.flatMap((line, index) => {
		const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
		return match?.[2] === heading
			? [{ index, level: match[1].length }]
			: [];
	});
	assert.equal(matches.length, 1, `Markdown must contain exactly one ${heading} section`);

	const [{ index: start, level }] = matches;
	const relativeEnd = lines.slice(start + 1).findIndex((line) => {
		const match = line.match(/^(#{1,6})\s+/);
		return match !== null && match[1].length <= level;
	});
	const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;

	return lines.slice(start + 1, end).join("\n").trim();
}

function assertWorkerFallbackRouting(section: string, sectionName: string): void {
	const boundedWriterPolicy = section.match(
		/For bounded multi-file writes,[\s\S]*?(?=\n\n|\n\s*\d+\.|$)/,
	)?.[0];
	assert.ok(boundedWriterPolicy, `${sectionName} must define bounded writer routing`);

	const preferred = boundedWriterPolicy.indexOf("`gentle-ai-worker`");
	const configuredFallback = boundedWriterPolicy.indexOf("user-configured `worker`");
	const nativeFallback = boundedWriterPolicy.indexOf("native `Agent`");

	assert.ok(preferred >= 0, `${sectionName} must reference exact gentle-ai-worker name`);
	assert.ok(
		configuredFallback > preferred,
		`${sectionName} must prefer the package-owned worker before a user-configured worker`,
	);
	assert.ok(
		nativeFallback > configuredFallback,
		`${sectionName} must place native Agent after both named worker definitions`,
	);
	assert.match(
		boundedWriterPolicy,
		/If neither (?:worker )?definition exists[^.]*native `Agent`[^.]*even when `subagent_\*` tools are available\./,
		`${sectionName} must choose native Agent when neither worker definition exists`,
	);
	assert.match(
		section,
		/If no delegation mechanism is available, stop/,
		`${sectionName} must stop when delegation is impossible`,
	);
}

test("Markdown section extraction isolates policy text from sibling sections", () => {
	const markdown = [
		"# Agent",
		"## Context contract",
		"context-only policy",
		"### Context detail",
		"nested context policy",
		"## Tool safety",
		"tool-only policy",
	].join("\n");

	const context = readMarkdownSection(markdown, "Context contract");

	assert.match(context, /context-only policy/);
	assert.match(context, /nested context policy/);
	assert.doesNotMatch(context, /tool-only policy/);
});

test("packaged agents use YAML list syntax for tool allowlists", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentFiles = readdirSync(agentsDir).flatMap((entry) =>
		entry.endsWith(".md") ? [join(agentsDir, entry)] : [],
	);

	assert.ok(agentFiles.length > 0, "gentle-pi must ship packaged agents");

	for (const file of agentFiles) {
		const frontmatter = readAgentFrontmatter(file);
		assert.doesNotMatch(
			frontmatter,
			/^tools:\s*[^\n,]+(?:,\s*[^\n,]+)+$/m,
			`${file} must not use comma-separated inline tools; pi-subagents expects a YAML list`,
		);
		assert.match(frontmatter, /^tools:\n(?: {2}- [\w-]+\n?)+/m, `${file} must declare tools as a YAML list`);
	}
});

test("jd-fix-agent packaged allowlist includes write tools", () => {
	const frontmatter = readAgentFrontmatter(
		join(PACKAGE_ROOT, "assets", "agents", "jd-fix-agent.md"),
	);

	for (const tool of ["read", "edit", "write", "bash"]) {
		assert.match(frontmatter, new RegExp(`^  - ${tool}$`, "m"));
	}
});

test("gentle-ai-worker packages the exact scoped writer contract", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentPath = join(agentsDir, "gentle-ai-worker.md");
	assert.ok(existsSync(agentPath), "gentle-pi must package gentle-ai-worker.md");
	for (const genericName of ["worker.md", "generic-writer.md"]) {
		assert.ok(
			!existsSync(join(agentsDir, genericName)),
			`the package-owned writer must not use collision-prone ${genericName}`,
		);
	}

	const { name, source, tools } = readAgentDefinition(agentPath);
	assert.equal(name, "gentle-ai-worker");
	assert.deepEqual(tools, [
		"read",
		"grep",
		"find",
		"edit",
		"write",
		"bash",
		"mem_save",
	]);
	assert.ok(
		tools.every((tool) => !tool.startsWith("subagent_")),
		"a subagent must not be able to delegate",
	);
	assert.ok(!tools.includes("glob"), "the unsupported glob tool must not return");

	const interactionContract = readMarkdownSection(source, "Interaction contract");
	assert.doesNotMatch(
		interactionContract,
		/```text/,
		"the interaction section must not define a second normative envelope",
	);
	assert.match(interactionContract, /stop editing/i);
	assert.match(interactionContract, /full schema in the Return contract/);
	assert.match(interactionContract, /`status: interaction_required`/);
	assert.match(interactionContract, /nested `interaction_required` payload/);

	const returnContract = readTextContract(source, "Return contract");
	assert.deepEqual(contractFields(returnContract), [
		"status",
		"summary",
		"files_changed",
		"tdd_evidence",
		"validation",
		"risks",
		"review_focus",
		"skill_resolution",
		"interaction_required",
	]);
	assert.deepEqual(nestedContractFields(returnContract, "interaction_required"), [
		"question",
		"reason",
		"options",
		"unblock_response",
	]);
	assert.match(
		returnContract,
		/skill_resolution: paths-injected \| paths-invalid \| none/,
	);
	assert.equal(
		(source.match(/```text/g) ?? []).length,
		1,
		"the Return contract must be the single authoritative full handoff schema",
	);
	assert.doesNotMatch(source, /fallback-(?:registry|path)/);

	const returnContractSection = readMarkdownSection(source, "Return contract");
	assert.match(
		returnContractSection,
		/Use `skill_resolution: paths-invalid` only when the parent injected one or more exact skill paths and any supplied path cannot be read/,
	);
	assert.match(
		returnContractSection,
		/With `skill_resolution: paths-invalid`, keep `status: blocked`/,
	);

	const contextContract = readMarkdownSection(source, "Context contract");
	assert.match(contextContract, /pre-existing untracked targets explicitly listed by the parent/);
	assert.match(contextContract, /new files required by the delegated task/);

	const implementationRules = readMarkdownSection(source, "Implementation rules");
	assert.match(implementationRules, /`blocked` only for a non-human technical blocker/);

	const toolSafety = readMarkdownSection(source, "Tool safety");
	assert.match(toolSafety, /sensitive files/);
	assert.match(toolSafety, /stage, commit, push, publish/);

	const memorySafety = readMarkdownSection(source, "Memory safety");
	assert.match(memorySafety, /secrets, credentials, personal data/);
	assert.match(memorySafety, /raw untrusted repository/);

	const testDiscipline = readMarkdownSection(source, "Test discipline");
	assert.match(testDiscipline, /Strict TDD is active/);
	assert.match(testDiscipline, /not active/);
	assert.match(
		testDiscipline,
		/Broad suites, builds, formatters, or linters may run only when explicitly authorized by the parent\./,
	);
	assert.match(testDiscipline, /Keep every command exact and verify its scope before execution\./);
	assert.doesNotMatch(testDiscipline, /clearly required by the repository contract/);
});

test("installSddAssets installs gentle-ai-worker with a loader-compatible scoped identity", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-agent-home-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);

		const installedAgentsDir = join(temporaryAgentHome, "agents");
		const installedAgentPath = join(installedAgentsDir, "gentle-ai-worker.md");
		assert.ok(existsSync(installedAgentPath), "the production installer must install gentle-ai-worker.md");
		for (const genericName of ["worker.md", "generic-writer.md"]) {
			assert.ok(
				!existsSync(join(installedAgentsDir, genericName)),
				`the installer must not create collision-prone ${genericName}`,
			);
		}

		const { name, source, tools } = readAgentDefinition(installedAgentPath);
		const normalizedRuntimeIdentity = name.trim().toLowerCase();
		assert.equal(normalizedRuntimeIdentity, "gentle-ai-worker");
		assert.deepEqual(tools, [
			"read",
			"grep",
			"find",
			"edit",
			"write",
			"bash",
			"mem_save",
		]);
		assert.doesNotMatch(
			readAgentFrontmatter(installedAgentPath),
			/^package\s*:/m,
			"package frontmatter must not alter external loader identity",
		);
		assert.doesNotMatch(source, /^name:\s*(?:worker|generic-writer)$/m);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}

	assert.equal(process.env.GENTLE_PI_AGENT_HOME, previousAgentHome);
	assert.ok(
		!existsSync(temporaryAgentHome),
		"the integration test must delete only its temporary agent home",
	);
});

test("bounded implementation routing uses the same explicit fallback in both policy sections", () => {
	const routing = readFileSync(
		join(PACKAGE_ROOT, "assets", "orchestrator-delegation.md"),
		"utf8",
	);
	const simpleDelegation = readMarkdownSection(routing, "2. Simple Delegation");
	const mandatoryDelegation = readMarkdownSection(routing, "Mandatory Delegation Triggers");

	assertWorkerFallbackRouting(simpleDelegation, "Simple Delegation");
	assertWorkerFallbackRouting(mandatoryDelegation, "Mandatory Delegation Triggers");
	assert.doesNotMatch(
		routing,
		/non-normative compatibility quotation|former wording is retained|no-runtime inline exception|superseded by the stop requirement/,
		"model-facing routing must not retain contradictory dead prose",
	);
	assert.doesNotMatch(
		routing,
		/`generic-writer`/,
		"routing must not revive the collision-prone generic package name",
	);
});

test("pi-pretty wrapper uses real package path resolution for pnpm symlink installs", () => {
	const wrapper = readFileSync(
		join(PACKAGE_ROOT, "extensions", "pi-pretty.ts"),
		"utf8",
	);

	assert.match(wrapper, /realpathSync/);
	assert.match(wrapper, /createRequire/);
	assert.match(wrapper, /@heyhuynhgiabuu\/pi-pretty/);
	assert.match(wrapper, /PI_PRETTY_SUPPRESSED_TOOL_NAMES/);
	assert.match(wrapper, /quietToolsEnabled/);
});
