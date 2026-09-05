import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import {
	inspectWorktreeWorkspaceConfig,
	renderWorktreeWorkspaceConfigStatusLine,
	renderWorktreeWorkspaceConfigWarning,
	REVIEW_RELAY_HANDSHAKE,
} from "../lib/worktree-workspace-config.ts";

// gentle-pi#370. A linked Git worktree never receives the project-local `.pi`
// configuration, because Git does not copy ignored files into a worktree.
// Four reporters on published 2.4.0 then read the downstream symptom -- a
// gentle-ai refusal naming `pi` as an unsupported runtime -- as a statement
// about runtime support. These tests pin the opposite: the configuration gap
// is detected and named at the boundary where it is created, so it can never
// again present itself as a runtime-support question.

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A committed repository whose main worktree is the parent workspace. */
function parentWorkspace(t: test.TestContext): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-worktree-config-parent-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	git(root, "init", "-b", "main");
	writeFileSync(join(root, "app.ts"), "export const value = 1;\n");
	writeFileSync(join(root, ".gitignore"), ".pi/\n");
	git(root, "add", ".");
	git(root, "-c", "user.name=Worktree Test", "-c", "user.email=worktree@example.invalid", "commit", "-m", "initial");
	return root;
}

function addLinkedWorktree(t: test.TestContext, parent: string, branch: string): string {
	const holder = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-worktree-config-linked-")));
	const worktree = join(holder, branch);
	git(parent, "worktree", "add", "-b", branch, worktree);
	t.after(() => {
		try {
			git(parent, "worktree", "remove", "--force", worktree);
		} catch {
			// The parent may already be gone; the holder removal below is enough.
		}
		rmSync(holder, { recursive: true, force: true });
	});
	return realpathSync(worktree);
}

/** The project-local `.pi` configuration a real workspace accumulates. */
function provisionProjectPiConfig(root: string): void {
	mkdirSync(join(root, ".pi", "npm", "node_modules", "gentle-pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "npm", "node_modules", "gentle-pi", "package.json"), '{"name":"gentle-pi"}\n');
	mkdirSync(join(root, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(join(root, ".pi", "gentle-ai", "runtime-guardrails.json"), '{"autonomousMode":false}\n');
	writeFileSync(join(root, ".pi", "settings.json"), "{}\n");
}

test("the main worktree is never reported as a linked worktree, even with project config present", (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	assert.equal(inspectWorktreeWorkspaceConfig(parent).status, "not-a-linked-worktree");
});

test("a linked worktree missing the parent's project-local .pi configuration is detected", (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	const worktree = addLinkedWorktree(t, parent, "feature");

	const report = inspectWorktreeWorkspaceConfig(worktree);
	assert.equal(report.status, "missing");
	assert.equal(report.status === "missing" && report.worktreeRoot, worktree);
	assert.equal(report.status === "missing" && report.parentWorkspaceRoot, parent);
	assert.ok(report.status === "missing");
	const relative = report.missing.map((entry) => entry.relativePath);
	assert.deepEqual(
		relative,
		[join(".pi", "npm", "node_modules"), join(".pi", "settings.json"), join(".pi", "gentle-ai")],
		JSON.stringify(relative),
	);
	for (const entry of report.missing) {
		assert.equal(entry.worktreePath, join(worktree, entry.relativePath));
		assert.equal(entry.parentPath, join(parent, entry.relativePath));
		assert.ok(entry.capability.length > 0);
	}
});

test("the report names the missing path, the parent that has it, and what stays broken", (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	const worktree = addLinkedWorktree(t, parent, "feature");

	const warning = renderWorktreeWorkspaceConfigWarning(inspectWorktreeWorkspaceConfig(worktree));
	assert.ok(warning, "a missing project-local configuration must render a warning");
	// Names the missing path and the parent that has it.
	assert.ok(warning.includes(join(worktree, ".pi", "npm", "node_modules")), warning);
	assert.ok(warning.includes(join(parent, ".pi", "npm", "node_modules")), warning);
	assert.ok(warning.includes(worktree), warning);
	assert.ok(warning.includes(parent), warning);
	// Names what will not work, and names it as a configuration gap rather
	// than as a statement about which runtimes gentle-ai supports.
	assert.ok(warning.includes(REVIEW_RELAY_HANDSHAKE), warning);
	assert.match(warning, /unsupported runtime|not a supported runtime|refuses the `pi` runtime/i);
	assert.match(warning, /worktree/i);
	// Never instructs anyone to work around the handshake, disable review, or
	// pick a different runtime: the refusal itself is correct behavior.
	assert.doesNotMatch(warning, /review mode disable|--agent[= ](?:claude-code|opencode|codex)/i);
});

test("a linked worktree carrying the same project-local configuration reports nothing", (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	const worktree = addLinkedWorktree(t, parent, "feature");
	provisionProjectPiConfig(worktree);

	const report = inspectWorktreeWorkspaceConfig(worktree);
	assert.equal(report.status, "provisioned");
	assert.equal(renderWorktreeWorkspaceConfigWarning(report), undefined);
	assert.equal(renderWorktreeWorkspaceConfigStatusLine(report), undefined);
});

test("a parent workspace with no project-local configuration leaves nothing to report", (t) => {
	const parent = parentWorkspace(t);
	const worktree = addLinkedWorktree(t, parent, "feature");

	const report = inspectWorktreeWorkspaceConfig(worktree);
	assert.equal(report.status, "provisioned");
	assert.equal(renderWorktreeWorkspaceConfigWarning(report), undefined);
});

test("only the paths the worktree actually lacks are reported", (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	const worktree = addLinkedWorktree(t, parent, "feature");
	mkdirSync(join(worktree, ".pi", "npm", "node_modules"), { recursive: true });
	writeFileSync(join(worktree, ".pi", "settings.json"), "{}\n");

	const report = inspectWorktreeWorkspaceConfig(worktree);
	assert.ok(report.status === "missing");
	assert.deepEqual(report.missing.map((entry) => entry.relativePath), [join(".pi", "gentle-ai")]);
});

test("a path that is not a Git worktree is undetermined, never a false alarm", async (t) => {
	const outside = realpathSync(await mkdtemp(join(tmpdir(), "gentle-pi-worktree-config-outside-")));
	t.after(() => rmSync(outside, { recursive: true, force: true }));
	const report = inspectWorktreeWorkspaceConfig(outside);
	assert.equal(report.status, "undetermined");
	assert.equal(renderWorktreeWorkspaceConfigWarning(report), undefined);
});

test("session start reports the missing worktree configuration instead of leaving it to surface as a runtime refusal", async (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	const worktree = addLinkedWorktree(t, parent, "feature");

	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_AGENT_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-worktree-config-agent-home-"));
	process.env.GENTLE_PI_CONFIG_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-worktree-config-config-home-"));
	t.after(() => {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
	});

	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
	const pi = {
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) {
			handlers.set(name, handler);
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const sessionStart = handlers.get("session_start");
	assert.equal(typeof sessionStart, "function");

	const notifications: Array<{ message: string; severity: string }> = [];
	const ctx = {
		cwd: worktree,
		hasUI: true,
		ui: {
			notify(message: string, severity: string) {
				notifications.push({ message, severity });
			},
		},
	} as unknown as ExtensionContext;
	await sessionStart!({}, ctx);

	const announcement = notifications.find((entry) => entry.message.includes(join(worktree, ".pi", "npm", "node_modules")));
	assert.ok(announcement, JSON.stringify(notifications));
	assert.equal(announcement.severity, "warning");
	assert.ok(announcement.message.includes(parent), announcement.message);
	assert.ok(announcement.message.includes(REVIEW_RELAY_HANDSHAKE), announcement.message);
});

test("session start stays silent in a worktree that carries the configuration", async (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	const worktree = addLinkedWorktree(t, parent, "feature");
	provisionProjectPiConfig(worktree);

	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_AGENT_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-worktree-config-agent-home-"));
	process.env.GENTLE_PI_CONFIG_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-worktree-config-config-home-"));
	t.after(() => {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
	});

	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
	const pi = {
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) {
			handlers.set(name, handler);
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const notifications: Array<{ message: string; severity: string }> = [];
	await handlers.get("session_start")!({}, {
		cwd: worktree,
		hasUI: true,
		ui: {
			notify(message: string, severity: string) {
				notifications.push({ message, severity });
			},
		},
	} as unknown as ExtensionContext);

	assert.equal(
		notifications.filter((entry) => /linked Git worktree/i.test(entry.message)).length,
		0,
		JSON.stringify(notifications),
	);
});

test("gentle:status names the gap for anyone already investigating the refusal", async (t) => {
	const parent = parentWorkspace(t);
	provisionProjectPiConfig(parent);
	const worktree = addLinkedWorktree(t, parent, "feature");

	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_AGENT_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-worktree-config-agent-home-"));
	process.env.GENTLE_PI_CONFIG_HOME = await mkdtemp(join(tmpdir(), "gentle-pi-worktree-config-config-home-"));
	t.after(() => {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
	});

	const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
	createGentleAiExtension({ nativeReviewCli: null })({
		on() {},
		registerCommand(name: string, registration: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) {
			commands.set(name, registration);
		},
		registerTool() {},
	} as unknown as ExtensionAPI);

	const notifications: Array<{ message: string; severity: string }> = [];
	await commands.get("gentle:status")!.handler("", {
		cwd: worktree,
		hasUI: true,
		ui: {
			notify(message: string, severity: string) {
				notifications.push({ message, severity });
			},
		},
	} as unknown as ExtensionContext);

	assert.equal(notifications.length, 1, JSON.stringify(notifications));
	assert.match(notifications[0]!.message, /Linked worktree config:/);
	assert.ok(notifications[0]!.message.includes(parent), notifications[0]!.message);
	assert.equal(notifications[0]!.severity, "warning");
});
