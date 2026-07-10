import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyModelConfig } from "../extensions/gentle-ai.ts";
import { installSddAssets } from "../lib/sdd-preflight.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REVIEW_REFUTER_FILE = "review-refuter.md";
const REVIEW_RISK_FILE = "review-risk.md";
const V013_REVIEW_RISK_FIXTURE = join(
	PACKAGE_ROOT,
	"tests",
	"fixtures",
	"v0.13",
	"assets",
	"agents",
	REVIEW_RISK_FILE,
);
const V013_MANAGED_ASSETS = join(
	PACKAGE_ROOT,
	"assets",
	"migrations",
	"managed-assets-v0.13.json",
);
const REVIEW_REFUTER_TOOLS = ["read", "grep", "find"];
const FORBIDDEN_REFUTER_TOOLS = [
	"bash",
	"edit",
	"write",
	"task",
	"subagent",
	"subagent_run",
	"mem_save",
	"mem_update",
];

interface ManagedAssetsManifest {
	schemaVersion: number;
	assets: Record<string, string>;
}

interface LegacyManagedAssetsManifest extends ManagedAssetsManifest {
	packageVersion: string;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

interface PackageJsonPiManifest {
	extensions?: string[];
}

interface PackageJson {
	version?: string;
	files?: string[];
	scripts?: Record<string, string>;
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

test("package source defines review-refuter with the exact read-only boundary", () => {
	const refuterPath = join(PACKAGE_ROOT, "assets", "agents", REVIEW_REFUTER_FILE);
	assert.ok(existsSync(refuterPath), "gentle-pi must package review-refuter.md");

	const { name, tools } = readAgentDefinition(refuterPath);
	assert.equal(name, "review-refuter");
	assert.deepEqual(tools, REVIEW_REFUTER_TOOLS);
	for (const tool of FORBIDDEN_REFUTER_TOOLS) {
		assert.ok(!tools.includes(tool), `review-refuter must deny ${tool}`);
	}
});

test("forced package installation preserves same-path user-authored agents and separate shadows", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-refuter-home-"));
	const temporaryProject = mkdtempSync(join(tmpdir(), "gentle-pi-refuter-project-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const samePathUserAgent = join(temporaryAgentHome, "agents", REVIEW_REFUTER_FILE);
	const userShadow = join(temporaryAgentHome, "subagents", REVIEW_REFUTER_FILE);
	const projectOverride = join(temporaryProject, ".pi", "agents", REVIEW_REFUTER_FILE);
	const userAgentSource = [
		"---",
		"name: review-refuter",
		"tools:",
		"  - read",
		"  - bash",
		"---",
		"user-authored permission policy",
		"",
	].join("\n");

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(projectOverride), { recursive: true });
		writeFileSync(projectOverride, "project override must stay\n");
		mkdirSync(dirname(userShadow), { recursive: true });
		writeFileSync(userShadow, "user shadow must stay\n");
		mkdirSync(dirname(samePathUserAgent), { recursive: true });
		writeFileSync(samePathUserAgent, userAgentSource);

		installSddAssets(temporaryProject, true);

		assert.deepEqual(
			readFileSync(samePathUserAgent),
			Buffer.from(userAgentSource),
			"force refresh must not claim a same-path user agent by filename",
		);
		assert.equal(
			readFileSync(projectOverride, "utf8"),
			"project override must stay\n",
			"package refresh must preserve explicit project overrides",
		);
		assert.equal(
			readFileSync(userShadow, "utf8"),
			"user shadow must stay\n",
			"package refresh must preserve separate user shadows",
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
		rmSync(temporaryProject, { recursive: true, force: true });
	}
});

test("v0.13 ownership evidence is bundled and matches the self-contained upgrade fixture", () => {
	const legacyManifest = JSON.parse(
		readFileSync(V013_MANAGED_ASSETS, "utf8"),
	) as LegacyManagedAssetsManifest;
	const legacyReviewRisk = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8");

	assert.equal(legacyManifest.packageVersion, "0.13.0");
	assert.equal(
		legacyManifest.assets[`agents/${REVIEW_RISK_FILE}`],
		sha256(legacyReviewRisk),
		"published migration evidence must fingerprint the exact v0.13 package asset",
	);
});

test("first forced sync migrates untouched v0.13 assets, preserves routing, and owns new assets", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v013-upgrade-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const installedRefuter = join(temporaryAgentHome, "agents", REVIEW_REFUTER_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);
	const legacySource = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8");
	const routedLegacySource = legacySource.replace(
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\n",
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\nmodel: private/legacy-model\nthinking: xhigh\n",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, routedLegacySource);
		assert.equal(existsSync(managedAssetsManifest), false, "v0.13 had no ownership manifest");

		installSddAssets(PACKAGE_ROOT, true);

		const migrated = readFileSync(installedReviewRisk, "utf8");
		const currentPackageSource = readFileSync(
			join(PACKAGE_ROOT, "assets", "agents", REVIEW_RISK_FILE),
			"utf8",
		);
		assert.notEqual(migrated, routedLegacySource, "the stale v0.13 review contract must refresh");
		assert.match(migrated, /^model: private\/legacy-model$/m);
		assert.match(migrated, /^thinking: xhigh$/m);
		assert.equal(
			migrated.replace(/^model: .*\n|^thinking: .*\n/gm, ""),
			currentPackageSource,
			"migration must update the package body without losing user routing",
		);
		assert.equal(
			readFileSync(installedRefuter, "utf8"),
			readFileSync(join(PACKAGE_ROOT, "assets", "agents", REVIEW_REFUTER_FILE), "utf8"),
			"an asset missing from v0.13 must install normally",
		);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(manifest.assets[`agents/${REVIEW_RISK_FILE}`], sha256(migrated));
		assert.equal(
			manifest.assets[`agents/${REVIEW_REFUTER_FILE}`],
			sha256(readFileSync(installedRefuter, "utf8")),
		);

		const userEditedMigration = migrated.replace(
			"**Precision limits.**",
			"**Precision limits with a user-authored note.**",
		);
		assert.notEqual(userEditedMigration, migrated, "the fixture must exercise post-migration drift");
		writeFileSync(installedReviewRisk, userEditedMigration);
		installSddAssets(PACKAGE_ROOT, true);
		assert.deepEqual(
			readFileSync(installedReviewRisk),
			Buffer.from(userEditedMigration),
			"exact full-content ownership must protect edits made after migration",
		);
		const postEditManifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(postEditManifest.assets[`agents/${REVIEW_RISK_FILE}`], undefined);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("first forced sync preserves a body-edited v0.13 asset byte-for-byte", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v013-edited-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const editedLegacySource = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8").replace(
		"Find security risks; do not fix them.",
		"Find security risks; preserve this user-authored body edit.",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, editedLegacySource);

		installSddAssets(PACKAGE_ROOT, true);

		assert.deepEqual(readFileSync(installedReviewRisk), Buffer.from(editedLegacySource));
		const manifest = JSON.parse(
			readFileSync(join(temporaryAgentHome, "gentle-ai", "managed-assets.json"), "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(manifest.assets[`agents/${REVIEW_RISK_FILE}`], undefined);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("forced package installation refreshes an asset recorded as package-managed", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-malformed-refuter-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedRefuter = join(temporaryAgentHome, "agents", REVIEW_REFUTER_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);
	const previousPackageSource =
		"---\nname: review-refuter\ntools:\n  - read\n  - bash\n---\nprevious package version\n";
	const routedPreviousPackageSource = previousPackageSource.replace(
		"name: review-refuter\n",
		"name: review-refuter\nmodel: openai/previous-package\nthinking: high\n",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);
		assert.ok(existsSync(installedRefuter), "a missing package asset must install");
		assert.ok(
			existsSync(managedAssetsManifest),
			"the installer must record ownership independently from the filename",
		);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		writeFileSync(installedRefuter, routedPreviousPackageSource);
		manifest.assets[`agents/${REVIEW_REFUTER_FILE}`] = sha256(
			routedPreviousPackageSource,
		);
		writeFileSync(managedAssetsManifest, JSON.stringify(manifest, null, 2));

		installSddAssets(PACKAGE_ROOT, true);

		const refreshed = readAgentDefinition(installedRefuter);
		assert.deepEqual(refreshed.tools, REVIEW_REFUTER_TOOLS);
		assert.doesNotMatch(refreshed.source, /^  - bash$/m);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

function assertManagedAgentUserEditIsPreserved(
	editLabel: string,
	editSource: (source: string) => string,
): void {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-managed-edit-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedRefuter = join(temporaryAgentHome, "agents", REVIEW_REFUTER_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);
		const installedSource = readFileSync(installedRefuter, "utf8");
		const userEditedSource = editSource(installedSource);
		assert.notEqual(userEditedSource, installedSource, `${editLabel} must alter the asset`);
		writeFileSync(installedRefuter, userEditedSource);

		installSddAssets(PACKAGE_ROOT, true);

		assert.deepEqual(
			readFileSync(installedRefuter),
			Buffer.from(userEditedSource),
			`${editLabel} must invalidate ownership and survive force refresh byte-for-byte`,
		);
		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(
			manifest.assets[`agents/${REVIEW_REFUTER_FILE}`],
			undefined,
			`${editLabel} must remove package ownership`,
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
}

test("forced package installation preserves a model-only edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("a model-only user edit", (source) =>
		source.replace(
			"name: review-refuter\n",
			"name: review-refuter\nmodel: private/user-model\n",
		),
	);
});

test("forced package installation preserves a thinking-only edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("a thinking-only user edit", (source) =>
		source.replace(
			"name: review-refuter\n",
			"name: review-refuter\nthinking: xhigh\n",
		),
	);
});

test("forced package installation preserves an ordinary body edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("an ordinary body edit", (source) =>
		source.replace(
			"Challenge severe review findings",
			"Preserve this user-authored body change and challenge severe review findings",
		),
	);
});

test("package model assignment keeps only package-managed agents owned", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-model-ownership-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedRefuter = join(temporaryAgentHome, "agents", REVIEW_REFUTER_FILE);
	const userAgent = join(temporaryAgentHome, "agents", "user-router.md");
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);
	const userAgentSource = "---\nname: user-router\n---\nuser-owned body\n";

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);
		writeFileSync(userAgent, userAgentSource);

		applyModelConfig(PACKAGE_ROOT, {
			"review-refuter": { model: "package/selected-model", thinking: "high" },
			"user-router": { model: "user/selected-model", thinking: "low" },
		});

		const routedRefuter = readFileSync(installedRefuter, "utf8");
		const routedUserAgent = readFileSync(userAgent, "utf8");
		assert.match(routedRefuter, /^model: package\/selected-model$/m);
		assert.match(routedRefuter, /^thinking: high$/m);
		assert.match(routedUserAgent, /^model: user\/selected-model$/m);
		assert.match(routedUserAgent, /^thinking: low$/m);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(
			manifest.assets[`agents/${REVIEW_REFUTER_FILE}`],
			sha256(routedRefuter),
			"package-controlled routing must update the managed asset hash coherently",
		);
		assert.equal(
			manifest.assets["agents/user-router.md"],
			undefined,
			"routing an arbitrary user agent must not relabel it as package-owned",
		);

		installSddAssets(PACKAGE_ROOT, true);
		assert.equal(
			readFileSync(installedRefuter, "utf8"),
			readFileSync(join(PACKAGE_ROOT, "assets", "agents", REVIEW_REFUTER_FILE), "utf8"),
			"a routed package-managed agent must remain eligible for package refresh",
		);
		assert.equal(
			readFileSync(userAgent, "utf8"),
			routedUserAgent,
			"package refresh must preserve the routed arbitrary user agent",
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
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

test("v0.14.0 release package and runtime stop before delivery or publication", () => {
	const packageJson = readPackageJson();
	assert.equal(packageJson.version, "0.14.0", "the release manifest must remain explicitly pinned to v0.14.0");
	assert.equal(
		packageJson.scripts?.test,
		"node --experimental-strip-types --test tests/*.test.ts && pnpm run test:harness",
	);
	assert.ok(packageJson.files?.includes("assets/"));

	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");
	assert.match(verifier, /assets\/agents\/review-refuter\.md/);
	assert.match(verifier, /assets\/migrations\/managed-assets-v0\.13\.json/);

	const runtime = readFileSync(join(PACKAGE_ROOT, "extensions", "gentle-ai.ts"), "utf8");
	assert.doesNotMatch(runtime, /execFileSync\("git", \["(?:commit|push|tag)"/);
	assert.doesNotMatch(runtime, /execFileSync\("(?:npm|pnpm)", \["publish"/);
});

test("README documents final review routing and the honest installed permission boundary", () => {
	const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
	for (const clause of [
		"400 changed lines remains standard; 401 changed lines routes to full 4R.",
		"Review advice never blocks commands.",
		"Dangerous-command confirmation remains independently authoritative.",
		"`review-refuter` uses exactly `read`, `grep`, and `find`",
		"package-managed isolated installation",
		"Project and user overrides may shadow the package asset",
	]) {
		assert.ok(readme.includes(clause), `README missing review v2 clause: ${clause}`);
	}
});
