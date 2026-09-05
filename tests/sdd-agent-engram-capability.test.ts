import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	declaresMemoryTools,
	resolveEngramExtensionEntry,
	stripEngramCapabilityLines,
	updateFrontmatterEngramCapability,
} from "../lib/sdd-agent-engram-capability.ts";
import { installSddAssets } from "../lib/sdd-preflight.ts";

const repoRoot = join(import.meta.dirname, "..");

const AGENT_DECLARING_MEMORY = `---
name: sdd-explore
description: Explore an SDD change idea before proposal.
tools:
  - read
  - grep
  - mem_save
---

You are the SDD explore executor for Gentle AI.
`;

const AGENT_WITHOUT_MEMORY = `---
name: sdd-status
description: Read SDD status.
tools:
  - read
  - grep
---

You are the SDD status executor.
`;

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function writeFakeEngramExtension(agentHome: string): string {
	const packageDir = join(agentHome, "npm", "node_modules", "gentle-engram");
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({
			name: "gentle-engram",
			version: "0.1.11",
			pi: { extensions: ["./index.ts"] },
		}),
	);
	const entry = join(packageDir, "index.ts");
	writeFileSync(entry, "export default async function () {}\n");
	return entry;
}

test("resolveEngramExtensionEntry returns the installed extension entry path", () => {
	const agentHome = mkdtempSync(join(tmpdir(), "gentle-pi-engram-resolve-"));
	try {
		const entry = writeFakeEngramExtension(agentHome);
		assert.equal(resolveEngramExtensionEntry(agentHome), entry);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test("resolveEngramExtensionEntry is undefined when gentle-engram is not installed", () => {
	const agentHome = mkdtempSync(join(tmpdir(), "gentle-pi-engram-missing-"));
	try {
		assert.equal(resolveEngramExtensionEntry(agentHome), undefined);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test("resolveEngramExtensionEntry is undefined without pi.extensions metadata", () => {
	const agentHome = mkdtempSync(join(tmpdir(), "gentle-pi-engram-nometa-"));
	try {
		const packageDir = join(agentHome, "npm", "node_modules", "gentle-engram");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "gentle-engram", version: "0.1.11" }),
		);
		assert.equal(resolveEngramExtensionEntry(agentHome), undefined);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test("declaresMemoryTools detects mem_* allowlist entries", () => {
	assert.equal(declaresMemoryTools(AGENT_DECLARING_MEMORY), true);
	assert.equal(declaresMemoryTools(AGENT_WITHOUT_MEMORY), false);
	assert.equal(declaresMemoryTools("no frontmatter at all"), false);
});

test("updateFrontmatterEngramCapability stamps a single CSV line after the tools block", () => {
	const stamped = updateFrontmatterEngramCapability(
		AGENT_DECLARING_MEMORY,
		"/opt/engram/index.ts",
	);
	assert.match(stamped, /^subagentOnlyExtensions: \/opt\/engram\/index\.ts$/m);
	assert.match(stamped, /^tools:\n {2}- read\n {2}- grep\n {2}- mem_save\nsubagentOnlyExtensions:/m);
	assert.ok(stamped.endsWith("\nYou are the SDD explore executor for Gentle AI.\n"));
});

test("updateFrontmatterEngramCapability is idempotent", () => {
	const once = updateFrontmatterEngramCapability(AGENT_DECLARING_MEMORY, "/opt/engram/index.ts");
	const twice = updateFrontmatterEngramCapability(once, "/opt/engram/index.ts");
	assert.equal(twice, once);
});

test("updateFrontmatterEngramCapability replaces a stale entry path", () => {
	const stale = updateFrontmatterEngramCapability(AGENT_DECLARING_MEMORY, "/old/engram/index.ts");
	const refreshed = updateFrontmatterEngramCapability(stale, "/new/engram/index.ts");
	assert.doesNotMatch(refreshed, /\/old\/engram\/index\.ts/);
	assert.match(refreshed, /^subagentOnlyExtensions: \/new\/engram\/index\.ts$/m);
	const occurrences = refreshed.match(/^subagentOnlyExtensions:.*$/gm) ?? [];
	assert.equal(occurrences.length, 1);
});

test("updateFrontmatterEngramCapability strips the line when engram is unavailable", () => {
	const stale = updateFrontmatterEngramCapability(AGENT_DECLARING_MEMORY, "/opt/engram/index.ts");
	const stripped = updateFrontmatterEngramCapability(stale, undefined);
	assert.equal(stripped, AGENT_DECLARING_MEMORY);
});

test("updateFrontmatterEngramCapability never stamps agents without mem_* tools", () => {
	assert.equal(
		updateFrontmatterEngramCapability(AGENT_WITHOUT_MEMORY, "/opt/engram/index.ts"),
		AGENT_WITHOUT_MEMORY,
	);
	const edited = AGENT_WITHOUT_MEMORY.replace(
		"tools:",
		"subagentOnlyExtensions: /opt/engram/index.ts\ntools:",
	);
	assert.equal(updateFrontmatterEngramCapability(edited, "/opt/engram/index.ts"), AGENT_WITHOUT_MEMORY);
});

test("stripEngramCapabilityLines removes capability lines and preserves the rest", () => {
	const stamped = updateFrontmatterEngramCapability(AGENT_DECLARING_MEMORY, "/opt/engram/index.ts");
	assert.equal(stripEngramCapabilityLines(stamped), AGENT_DECLARING_MEMORY);
});

test("installSddAssets stamps installed memory agents when gentle-engram is present", () => {
	const agentHome = mkdtempSync(join(tmpdir(), "gentle-pi-engram-stamp-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	try {
		process.env.GENTLE_PI_AGENT_HOME = agentHome;
		const entry = writeFakeEngramExtension(agentHome);
		const result = installSddAssets(repoRoot, true);
		assert.ok(result.agents > 0);

		const installedExplore = readFileSync(join(agentHome, "agents", "sdd-explore.md"), "utf8");
		assert.match(installedExplore, new RegExp(`^subagentOnlyExtensions: ${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
		assert.match(installedExplore, /- mem_save\nsubagentOnlyExtensions:/);

		const installedStatus = readFileSync(join(agentHome, "agents", "sdd-status.md"), "utf8");
		assert.match(installedStatus, /^subagentOnlyExtensions: /m);
		const installedVerify = readFileSync(join(agentHome, "agents", "gentle-ai-verify.md"), "utf8");
		assert.doesNotMatch(installedVerify, /^subagentOnlyExtensions:/m);

		const packagedExplore = readFileSync(join(repoRoot, "assets", "agents", "sdd-explore.md"), "utf8");
		assert.doesNotMatch(packagedExplore, /^subagentOnlyExtensions:/m);

		const manifest = JSON.parse(
			readFileSync(join(agentHome, "gentle-ai", "managed-assets.json"), "utf8"),
		) as { assets: Record<string, string> };
		assert.equal(manifest.assets["agents/sdd-explore.md"], sha256(installedExplore));
		assert.equal(manifest.assets["agents/sdd-status.md"], sha256(installedStatus));
		assert.equal(manifest.assets["agents/gentle-ai-verify.md"], sha256(installedVerify));
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test("installSddAssets leaves installed agents pristine without gentle-engram", () => {
	const agentHome = mkdtempSync(join(tmpdir(), "gentle-pi-engram-pristine-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	try {
		process.env.GENTLE_PI_AGENT_HOME = agentHome;
		installSddAssets(repoRoot, true);
		const installedExplore = readFileSync(join(agentHome, "agents", "sdd-explore.md"), "utf8");
		const packagedExplore = readFileSync(join(repoRoot, "assets", "agents", "sdd-explore.md"), "utf8");
		assert.equal(installedExplore, packagedExplore);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test("installSddAssets self-heals the stamp when gentle-engram disappears", () => {
	const agentHome = mkdtempSync(join(tmpdir(), "gentle-pi-engram-heal-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	try {
		process.env.GENTLE_PI_AGENT_HOME = agentHome;
		writeFakeEngramExtension(agentHome);
		installSddAssets(repoRoot, true);
		const stamped = readFileSync(join(agentHome, "agents", "sdd-explore.md"), "utf8");
		assert.match(stamped, /^subagentOnlyExtensions:/m);

		rmSync(join(agentHome, "npm"), { recursive: true, force: true });
		const result = installSddAssets(repoRoot, false);
		assert.ok((result as { engramStamps?: number }).engramStamps !== undefined);
		const healed = readFileSync(join(agentHome, "agents", "sdd-explore.md"), "utf8");
		assert.doesNotMatch(healed, /^subagentOnlyExtensions:/m);
		assert.equal(
			healed,
			readFileSync(join(repoRoot, "assets", "agents", "sdd-explore.md"), "utf8"),
		);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test("installSddAssets does not touch user-edited agents even when engram is present", () => {
	const agentHome = mkdtempSync(join(tmpdir(), "gentle-pi-engram-user-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	try {
		process.env.GENTLE_PI_AGENT_HOME = agentHome;
		writeFakeEngramExtension(agentHome);
		installSddAssets(repoRoot, true);

		const explorePath = join(agentHome, "agents", "sdd-explore.md");
		const userEdited = readFileSync(explorePath, "utf8").replace(
			"You are the SDD explore executor for Gentle AI.",
			"You are the user-customized SDD explore executor.",
		);
		writeFileSync(explorePath, userEdited);

		installSddAssets(repoRoot, false);
		assert.equal(readFileSync(explorePath, "utf8"), userEdited);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(agentHome, { recursive: true, force: true });
	}
});
