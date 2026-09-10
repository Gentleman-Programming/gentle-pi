import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { initTheme, keyHint } from "@earendil-works/pi-coding-agent";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { __testing, applyModelConfig, createGentleAiExtension } from "../extensions/gentle-ai.ts";
import { NATIVE_REVIEW_ERROR_CODE, NativeReviewCliError, type NativeReviewCli } from "../lib/native-review-cli.ts";
import { CandidateViewError, type CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { installPackageAssets } from "../lib/sdd-preflight.ts";
import type { ReviewCollectInputV3, ReviewStatusV3 } from "../lib/review-integration-v2.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { cardBody, cardHint, cardTitle, cardTone } from "./gentle-card-text.ts";

initTheme("dark");

function writeMarkdown(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

const lifecycleTheme = {
	bold(value: string): string {
		return value;
	},
	fg(color: string, value: string): string {
		return `<${color}>${value}</${color}>`;
	},
};

function renderComponent(component: { render(width: number): string[] }): string {
	return component.render(120).map((line) => line.replace(/[ \t]+$/g, "")).join("\n");
}

function registeredGentleTools(): Map<string, any> {
	const tools = new Map<string, any>();
	const pi = {
		on() {},
		registerCommand() {},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	return tools;
}

function lifecycleContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		executionStarted: false,
		isPartial: true,
		isError: false,
		lastComponent: undefined,
		...overrides,
	};
}

test("missing package-local binaries give a direct recovery without attributing the cause to lifecycle scripts", async () => {
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "inspect" },
		process.cwd(),
		{
			targetStatus: async () => {
				throw new NativeReviewCliError(
					NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING,
					"review/status",
					false,
					false,
					"package binary missing",
				);
			},
		} as unknown as NativeReviewCli,
	);

	assert.equal(result.outcome, "native-status-package-binary-missing");
	assert.equal(result.recovery_command, "node scripts/install-gentle-ai.mjs");
	assert.match(String(result.next_action), /installed gentle-pi package directory/);
	assert.match(String(result.next_action), /GENTLE_PI_SKIP_GENTLE_AI_INSTALL/);
	assert.match(String(result.next_action), /remove or unset it before/);
	assert.match(String(result.reason), /does not prove install lifecycle scripts were disabled/);
});

test("registered Gentle Review tools render reusable rose lifecycle call rows", () => {
	const tools = registeredGentleTools();
	const cases = [
		["gentle_review", { operation: "status" }, "review status"],
		["gentle_review", { operation: "future-operation", secret: "/private" }, "review"],
		["gentle_review_scope", {}, "review scope"],
		["gentle_review_capture_group", {}, "review capture group"],
		[
			"gentle_review_capture",
			{
				lineageId: "lineage-id",
				collectBinding: "binding-id",
				sha256: "sha256:hash-value",
				secret: "secret-value",
				arbitrary: "arbitrary-value",
			},
			"review capture",
		],
	] as const;

	assert.deepEqual(
		[...new Set(cases.map(([name]) => name))].sort(),
		[...tools.keys()].filter((name) => name.startsWith("gentle_")).sort(),
	);

	for (const [name, args, operationPath] of cases) {
		const tool = tools.get(name);
		assert.ok(tool, `missing ${name}`);
		const initial = tool.renderCall(args, lifecycleTheme, lifecycleContext());
		const initialText = renderComponent(initial);
		const running = tool.renderCall(
			args,
			lifecycleTheme,
			lifecycleContext({ executionStarted: true, lastComponent: initial }),
		);
		const runningText = renderComponent(running);
		const completed = tool.renderCall(
			args,
			lifecycleTheme,
			lifecycleContext({ executionStarted: true, isPartial: false, lastComponent: running }),
		);
		const completedText = renderComponent(completed);
		const failed = tool.renderCall(
			args,
			lifecycleTheme,
			lifecycleContext({ executionStarted: true, isPartial: false, isError: true, lastComponent: completed }),
		);
		const failedText = renderComponent(failed);

		assert.strictEqual(initial, running);
		assert.strictEqual(running, completed);
		assert.strictEqual(completed, failed);
		assert.equal(cardTitle(initialText), `🌹︎ Gentle AI · running · ${operationPath}`); assert.equal(cardTone(initialText), "warning");
		assert.equal(cardTitle(runningText), `🌹︎ Gentle AI · running · ${operationPath}`); assert.equal(cardTone(runningText), "warning");
		assert.equal(cardTitle(completedText), `🌹︎ Gentle AI · completed · ${operationPath}`); assert.equal(cardTone(completedText), "success");
		assert.equal(cardTitle(failedText), `🌹︎ Gentle AI · failed · ${operationPath}`); assert.equal(cardTone(failedText), "error");
		assert.doesNotMatch(renderComponent(failed), /future-operation|secret|private/);
		for (const forbiddenValue of ["lineage-id", "binding-id", "sha256:hash-value", "secret-value", "arbitrary-value"]) {
			assert.doesNotMatch(failedText, new RegExp(forbiddenValue));
		}
	}
});

test("registered Gentle Review tools preserve result envelopes and redact collapsed result rendering", async () => {
	const tools = registeredGentleTools();
	const scope = tools.get("gentle_review_scope");
	const manifest = { version: 1, scopeByMode: { "100644": ["src/file.ts"] }, gitlinks: {} };
	const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
	const encoded = gzipSync(bytes, { mtime: 0 }).toString("base64url");
	const sha256 = createHash("sha256").update(bytes).digest("hex");

	const result = await scope.execute(
		"scope-call",
		{ manifest: encoded, sha256, cursor: 0 },
		undefined,
		undefined,
		{ cwd: process.cwd() } as ExtensionContext,
	);
	const visibleEnvelope = JSON.parse(result.content[0].text);
	assert.deepEqual(visibleEnvelope, {
		version: 1,
		sha256,
		cursor: 0,
		totalPaths: 1,
		entries: [{ path: "src/file.ts", mode: "100644" }],
	});
	assert.deepEqual(result.details, visibleEnvelope);

	const resultText = "safe result\x1b[31m\nlineage=secret body=private";
	const expandHint = keyHint("app.tools.expand", "to expand");
	for (const name of ["gentle_review", "gentle_review_scope", "gentle_review_capture"]) {
		const tool = tools.get(name);
		assert.equal(typeof tool?.renderResult, "function", `${name} must define result rendering`);
		for (const options of [
			{ expanded: false, isPartial: true, isError: false },
			{ expanded: false, isPartial: false, isError: false },
			{ expanded: false, isPartial: false, isError: true },
		]) {
			const collapsed = renderComponent(tool.renderResult({ content: [{ type: "text", text: resultText }] }, options, lifecycleTheme, {}));
			assert.match(cardBody(collapsed), /\d+ lines?\b/, `${name} collapsed output must contain one expand hint`);
			assert.match(cardBody(collapsed), /\d+ lines?\b/, `${name} collapsed output must start with the hint`);
			assert.doesNotMatch(collapsed, /safe result|lineage=secret|private/);
		}
		const expanded = renderComponent(tool.renderResult({ content: [{ type: "text", text: resultText }] }, { expanded: true, isPartial: false, isError: true }, lifecycleTheme, {}));
		assert.equal(cardBody(expanded).split("\n")[0], "safe result");
		assert.match(expanded, /safe result/);
		assert.match(expanded, /lineage=secret body=private/);
		assert.doesNotMatch(expanded, /to expand/);
		assert.doesNotMatch(cardBody(expanded), /\x1b\[/);
		const nonText = renderComponent(tool.renderResult({ content: [{ type: "image", data: "opaque", mimeType: "image/png" }] }, { expanded: true, isPartial: false }, lifecycleTheme, {}));
		assert.equal(cardBody(nonText), "");
		const empty = renderComponent(tool.renderResult({ content: [{ type: "text", text: "" }] }, { expanded: false, isPartial: false }, lifecycleTheme, {}));
		assert.equal(cardBody(empty), "");
	}
});

function routingConsumerFixture(t: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-routing-consumers-"));
	const configHome = join(root, "global");
	const agentHome = join(root, "agent-home");
	const projectPath = join(root, ".pi", "gentle-ai", "models.json");
	const globalPath = join(configHome, "models.json");
	const exportPath = join(configHome, "models.export.json");
	for (const dir of [dirname(projectPath), join(root, "agents"), join(agentHome, "agents"), join(agentHome, "subagents")]) {
		mkdirSync(dir, { recursive: true });
	}
	writeMarkdown(join(root, ".pi", "agents", "worker.md"), "---\nname: worker\ndescription: Worker\n---\nbody\n");
	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	process.env.GENTLE_PI_CONFIG_HOME = configHome;
	process.env.GENTLE_PI_AGENT_HOME = agentHome;
	t.after(() => {
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(root, { recursive: true, force: true });
	});
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	createGentleAiExtension({ nativeReviewCli: null })({
		on() {},
		registerTool() {},
		registerCommand(name, command) { commands.set(name, command); },
	} as ExtensionAPI);
	const notifications: Array<{ message: string; severity: string }> = [];
	let panelVisits = 0;
	const panels: string[] = [];
	let onPanel = () => ({ type: "cancel", config: {} });
	const ctx = {
		cwd: root,
		hasUI: true,
		modelRegistry: { getAvailable: async () => [] },
		ui: {
			notify(message: string, severity: string) { notifications.push({ message, severity }); },
			custom: async (factory: (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => { render(width: number): string[] }) => {
				panels.push(stripAnsi(renderComponent(factory(undefined, { fg: (_color: string, text: string) => text } as unknown as Theme, undefined, () => {}))));
				panelVisits += 1;
				return onPanel();
			},
		},
	} as unknown as Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
	return {
		configHome, projectPath, globalPath, exportPath, notifications, panels,
		panelVisits: () => panelVisits,
		onPanel(action: typeof onPanel) { onPanel = action; },
		run: (name: string) => commands.get(name)!.handler("", ctx),
	};
}

test("models rejects invalid project routing with its selected source path", async (t) => {
	const fixture = routingConsumerFixture(t);
	writeFileSync(fixture.projectPath, "[]");
	await fixture.run("gentle:models");
	assert.equal(fixture.notifications[0]?.severity, "warning");
	assert.ok(fixture.notifications[0]?.message.includes(fixture.projectPath));
	assert.equal(fixture.panelVisits(), 0);
});

test("export re-reads saved routing and rejects invalid project before creating its destination parent", async (t) => {
	const fixture = routingConsumerFixture(t);
	writeFileSync(fixture.projectPath, '{"worker":"openai/gpt-5"}');
	fixture.onPanel(() => {
		if (fixture.panelVisits() > 1) return { type: "cancel", config: {} };
		writeFileSync(fixture.projectPath, "[]");
		return { type: "export", config: {} };
	});
	await fixture.run("gentle:models");
	assert.equal(fixture.notifications[0]?.severity, "warning");
	assert.ok(fixture.notifications[0]?.message.includes(`Invalid model config: ${fixture.projectPath}`));
	assert.equal(existsSync(fixture.exportPath), false);
	assert.equal(existsSync(fixture.configHome), false);
});

test("status reports invalid saved routing path instead of default agent routing", async (t) => {
	const fixture = routingConsumerFixture(t);
	writeFileSync(fixture.projectPath, "[]");
	await fixture.run("gentle:status");
	const report = fixture.notifications.at(-1)!;
	assert.match(report.message, /Saved model routing: invalid/);
	assert.ok(report.message.includes(fixture.projectPath));
	assert.equal(report.severity, "warning");
	assert.doesNotMatch(report.message, /worker: model=/);
});

test("models exports missing, normalized project, and global-precedence saved routing", async (t) => {
	for (const source of ["missing", "project", "global"] as const) {
		await t.test(source, async (t) => {
			const fixture = routingConsumerFixture(t);
			if (source !== "missing") writeFileSync(fixture.projectPath, '{"worker":" openai/gpt-5 ","ignored":null}');
			if (source === "global") writeMarkdown(fixture.globalPath, '{"worker":{"model":" anthropic/opus ","thinking":"high"}}');
			fixture.onPanel(() => ({ type: fixture.panelVisits() === 1 ? "export" : "cancel", config: {} }));
			await fixture.run("gentle:models");
			const agents = source === "missing" ? {} : source === "project"
				? { worker: { model: "openai/gpt-5" } }
				: { worker: { model: "anthropic/opus", thinking: "high" } };
			assert.deepEqual(JSON.parse(readFileSync(fixture.exportPath, "utf8")).agents, agents);
			assert.equal(fixture.notifications[0]?.severity, "info");
			assert.match(fixture.notifications[0]!.message, /exported/);
			assert.equal(fixture.panelVisits(), 2);
			await fixture.run("gentle:status");
			const report = fixture.notifications.at(-1)!.message;
			assert.ok(report.includes(`Saved model routing: ${source === "missing" ? "missing" : "valid"}`));
			assert.ok(report.includes(`Global model config: ${source === "global" ? "present" : "missing"}`));
			const expectedRouting = source === "missing" ? "inherit, effort=inherit"
				: source === "project" ? "openai/gpt-5, effort=inherit" : "anthropic/opus, effort=high";
			assert.ok(report.includes(`worker: model=${expectedRouting}`), report);
			assert.ok(fixture.panels[0].includes(`model=${expectedRouting}`), fixture.panels[0]);
		});
	}
});

test("invalid global routing overrides valid project in models, status, and export re-read", async (t) => {
	for (const atExport of [false, true]) {
		await t.test(atExport ? "invalidated during panel" : "invalid before panel", async (t) => {
			const fixture = routingConsumerFixture(t);
			writeFileSync(fixture.projectPath, '{"worker":"openai/gpt-5"}');
			if (!atExport) writeMarkdown(fixture.globalPath, "[]");
			fixture.onPanel(() => {
				if (fixture.panelVisits() > 1) return { type: "cancel", config: {} };
				writeMarkdown(fixture.globalPath, "[]");
				return { type: "export", config: {} };
			});
			await fixture.run("gentle:models");
			assert.equal(fixture.notifications[0]?.severity, "warning");
			assert.ok(fixture.notifications[0]?.message.includes(fixture.globalPath));
			assert.match(fixture.notifications[0]!.message, atExport ? /export failed/ : /cannot open model config/);
			assert.equal(fixture.panelVisits(), atExport ? 2 : 0);
			assert.equal(existsSync(fixture.exportPath), false);
			await fixture.run("gentle:status");
			const report = fixture.notifications.at(-1)!;
			assert.match(report.message, /Global model config: present\nSaved model routing: invalid/);
			assert.ok(report.message.includes(fixture.globalPath));
			assert.doesNotMatch(report.message, /worker: model=/);
			assert.equal(report.severity, "warning");
		});
	}
});

test("session startup reports invalid project routing without mutating the profile", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-model-routing-startup-"));
	const configHome = join(root, "global");
	const projectConfigDir = join(root, ".pi", "gentle-ai");
	const projectAgentsDir = join(root, ".pi", "agents");
	const projectProfileDir = join(root, ".pi");
	const rootAgentsDir = join(root, "agents");
	const agentHome = join(root, "agent-home");
	const agentHomeAgentsDir = join(agentHome, "agents");
	const agentHomeSubagentsDir = join(agentHome, "subagents");
	mkdirSync(configHome, { recursive: true });
	mkdirSync(projectConfigDir, { recursive: true });
	mkdirSync(projectAgentsDir, { recursive: true });
	mkdirSync(projectProfileDir, { recursive: true });
	mkdirSync(rootAgentsDir, { recursive: true });
	mkdirSync(agentHomeAgentsDir, { recursive: true });
	mkdirSync(agentHomeSubagentsDir, { recursive: true });
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	process.env.GENTLE_PI_CONFIG_HOME = configHome;
	process.env.GENTLE_PI_AGENT_HOME = agentHome;
	t.after(() => {
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
	});

	writeFileSync(join(projectConfigDir, "models.json"), "[]");
	writeMarkdown(join(projectAgentsDir, "worker.md"), "---\nname: worker\ndescription: Worker\n---\nbody\n");
	const profilePath = join(projectProfileDir, "subagents.json");
	const profileBytes = `${JSON.stringify({ unrelated: { keep: true } }, null, 2)}\n`;
	writeFileSync(profilePath, profileBytes);
	const before = readFileSync(profilePath, "utf8");

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
	await sessionStart!({}, {
		cwd: root,
		hasUI: true,
		ui: {
			notify(message: string, severity: string) {
				notifications.push({ message, severity });
			},
		},
	} as unknown as ExtensionContext);

	const warning = notifications.find((entry) => entry.message.includes(join(projectConfigDir, "models.json")));
	assert.ok(warning, JSON.stringify(notifications));
	assert.equal(warning!.severity, "warning");
	assert.match(warning!.message, /skipped model config/);
	assert.equal(readFileSync(profilePath, "utf8"), before);

	writeFileSync(join(projectConfigDir, "models.json"), '{"worker":"openai/gpt-5"}');
	const globalPath = join(configHome, "models.json");
	writeFileSync(globalPath, "[]");
	notifications.length = 0;
	await sessionStart!({}, {
		cwd: root,
		hasUI: true,
		ui: { notify(message: string, severity: string) { notifications.push({ message, severity }); } },
	} as unknown as ExtensionContext);
	const globalWarning = notifications.find((entry) => entry.message.includes(globalPath));
	assert.ok(globalWarning, JSON.stringify(notifications));
	assert.equal(globalWarning.severity, "warning");
	assert.match(globalWarning.message, /skipped model config/);
	assert.equal(readFileSync(profilePath, "utf8"), before);
});

test("agent discovery skips skills directories", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dotAgents = join(root, ".agents");
	writeMarkdown(join(dotAgents, "review-risk.md"), "name: review-risk\n");
	writeMarkdown(join(dotAgents, "team", "worker.md"), "name: worker\n");
	writeMarkdown(join(dotAgents, "skills", "ai-sdk", "SKILL.md"), "name: ai-sdk\n");
	writeMarkdown(
		join(dotAgents, "skills", "ai-sdk", "references", "evaluation.md"),
		"name: Prompt Evaluation\n",
	);

	const syncAgents = __testing.listAgentsFromDir(dotAgents, "user");
	const asyncAgents = await __testing.listAgentsFromDirAsync(dotAgents, "user");

	assert.deepEqual(
		syncAgents.map((agent) => agent.name),
		["review-risk", "worker"],
	);
	assert.deepEqual(
		asyncAgents.map((agent) => agent.name),
		["review-risk", "worker"],
	);
});

test("managed routing timeout leaves its profile, agent, and manifest unchanged", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-managed-routing-timeout-"));
	const agentHome = join(root, "agent-home");
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	t.after(() => {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(root, { recursive: true, force: true });
	});

	process.env.GENTLE_PI_AGENT_HOME = agentHome;
	installPackageAssets(root, false, ["sdd"]);
	const agentPath = join(agentHome, "agents", "sdd-apply.md");
	const manifestPath = join(agentHome, "gentle-ai", "managed-assets.json");
	const profilePath = join(agentHome, "subagents.json");
	const profileBefore = "{\n  \"unrelated\": true\n}\n";
	writeFileSync(profilePath, profileBefore);
	const agentBefore = readFileSync(agentPath, "utf8");
	const manifestBefore = readFileSync(manifestPath, "utf8");
	writeFileSync(
		join(agentHome, "gentle-ai", "managed-assets.lock"),
		JSON.stringify({ schemaVersion: 1, token: "foreign", pid: process.pid, createdAtMs: Date.now() }),
	);

	assert.throws(
		() => applyModelConfig(root, { "sdd-apply": { model: "test/managed", thinking: "high" } }),
		/Timed out acquiring managed-assets lock file/i,
	);
	assert.equal(readFileSync(profilePath, "utf8"), profileBefore);
	assert.equal(readFileSync(agentPath, "utf8"), agentBefore);
	assert.equal(readFileSync(manifestPath, "utf8"), manifestBefore);
});

test("a later alias keeps managed-root precedence and manifest ownership", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-agent-root-alias-"));
	const agentHome = join(root, "agent-home");
	const home = join(root, "home");
	const cwd = join(root, "project");
	const managed = join(agentHome, "agents");
	const intervening = join(agentHome, "subagents");
	const alias = join(home, ".agents");
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	t.after(() => {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		rmSync(root, { recursive: true, force: true });
	});

	process.env.GENTLE_PI_AGENT_HOME = agentHome;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	installPackageAssets(cwd, false, ["sdd"]);
	writeMarkdown(join(intervening, "sdd-apply.md"), "---\nname: sdd-apply\n---\nintervening override\n");
	mkdirSync(home, { recursive: true });
	try {
		symlinkSync(managed, alias, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		t.skip(`directory aliases unavailable: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	const selected = __testing.listDiscoverableAgents(cwd).find((agent) => agent.name === "sdd-apply");
	assert.equal(selected?.filePath, join(managed, "sdd-apply.md"));
	applyModelConfig(cwd, { "sdd-apply": { model: "test/managed", thinking: "high" } });
	const manifest = JSON.parse(readFileSync(join(agentHome, "gentle-ai", "managed-assets.json"), "utf8")) as { assets: Record<string, string> };
	const routed = readFileSync(join(managed, "sdd-apply.md"), "utf8");
	assert.match(routed, /^model: test\/managed$/m);
	assert.equal(manifest.assets["agents/sdd-apply.md"], createHash("sha256").update(routed).digest("hex"));
});

test("runtime guidance keeps review policy out of the static orchestrator", () => {
	const staticReferences = ["README.md", "skills/gentle-ai/SKILL.md"];
	const forbiddenGenericRoutes = [
		/fresh-context `reviewer`/,
		/fresh reviewer audits/,
		/reviewer fresh audits/,
		/run a fresh-context `reviewer`/,
	];

	for (const file of staticReferences) {
		const content = readFileSync(file, "utf8");
		assert.match(content, /Review Lens Selection|review lens/);
		assert.match(content, /review-risk/);
		assert.match(content, /review-reliability/);
		assert.match(content, /review-resilience/);
		assert.match(content, /review-readability/);
		for (const forbidden of forbiddenGenericRoutes) {
			assert.doesNotMatch(content, forbidden, `${file} must not route to generic reviewer`);
		}
	}

	const orchestrator = readFileSync("assets/orchestrator.md", "utf8")
		+ readFileSync("assets/orchestrator-delegation.md", "utf8");
	assert.match(orchestrator, /injects the mirrored provider-bundle review execution contract/);
	assert.match(orchestrator, /this package invents no lifecycle instructions/);
	for (const lifecycleMarker of ["review-risk", "review-reliability", "review-resilience", "review-readability", "Authority-First Terminal Procedure", "reconcile-terminal-mirrors"]) {
		assert.doesNotMatch(orchestrator, new RegExp(lifecycleMarker), `static orchestrator must not mirror ${lifecycleMarker}`);
	}
});

test("ordinary native capture exposes a registered schema and STATUS binding copied unchanged to one slot", async (t) => {
	const tools = new Map<string, { name: string; parameters: { required?: readonly string[] } }>();
	const pi = {
		on() {},
		registerCommand() {},
		registerTool(tool: { name: string; parameters: { required?: readonly string[] } }) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);

	assert.ok(tools.has("gentle_review_capture"));
	assert.deepEqual(tools.get("gentle_review_capture")?.parameters.required, ["lineageId", "collectBinding"]);

	const sha = `sha256:${"a".repeat(64)}`;
	const lineageId = "ordinary-capture";
	const collectInput: ReviewCollectInputV3 = {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "target", value: sha, token: `--target=${sha}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "materialize", value: "true", token: "--materialize=true" },
		],
		submission: {
			operationToken: "capture-result",
			argumentTokens: ["--lineage=ordinary-capture", `--target=${sha}`, "--agent=pi", "--materialize=true", "--input={{value}}"],
			values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: 4 }],
		},
	};
	const currentStatus = {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: "reviewing", generation: 1, revision: sha },
		action: "stop",
		replayability: "not_replayable",
		targetIdentity: sha,
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: "b".repeat(40),
			initialReviewTree: "b".repeat(40),
			currentCandidateTree: "b".repeat(40),
			pathsDigest: sha,
			paths: ["app.ts"],
			intendedUntracked: [],
			intendedUntrackedProof: sha,
			initialSnapshotIdentity: sha,
			currentSnapshotIdentity: sha,
		},
		candidates: [],
		nextTransition: { kind: "collect", reasonCode: "capture_required", collect: { inputs: [collectInput] } },
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
	const native = { targetStatus: async () => currentStatus } as unknown as NativeReviewCli;

	const publicStatus = await __testing.executeReviewControllerOperation({ operation: "status" }, process.cwd(), native);
	const bindings = publicStatus.collectBindings as readonly { collectBinding: unknown }[];
	assert.equal(bindings.length, 1);
	assert.equal(typeof bindings[0]?.collectBinding, "string");

	let launches = 0;
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		launches += 1;
		return { promptByteLength: 1, resultByteLength: 1, submission: "{}" };
	});
	const captured = await __testing.executeReviewCaptureOperation({
		lineageId,
		collectBinding: bindings[0]!.collectBinding,
		reviewerRunAcknowledged: true,
	}, process.cwd(), native);
	assert.equal(captured.status, "captured");
	assert.equal(launches, 1);
});

test("ordinary START reports candidate-owner preparation failure as pre-native no mutation", async () => {
	let nativeStarts = 0;
	const target = {
		contract: "gentle-ai.review-integration/v2",
		applicability: "unrelated",
		action: "start",
		replayability: "not_replayable",
		targetIdentity: "a".repeat(64),
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: "b".repeat(40),
			initialReviewTree: "b".repeat(40),
			currentCandidateTree: "b".repeat(40),
			pathsDigest: "a".repeat(64),
			paths: [],
			intendedUntracked: [],
			intendedUntrackedProof: "a".repeat(64),
			initialSnapshotIdentity: "a".repeat(64),
			currentSnapshotIdentity: "a".repeat(64),
		},
		candidates: [],
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
	const native = {
		targetStatus: async () => target,
		start: async () => { nativeStarts += 1; throw new Error("native START must not run"); },
	} as unknown as NativeReviewCli;
	const candidateViews = {
		createOrReuse: () => { throw new CandidateViewError("candidate view owner preparation failed", "candidate-owner-preparation-failed"); },
	} as unknown as CandidateViewRegistry;
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		process.cwd(),
		native,
		undefined,
		candidateViews,
	);
	assert.equal(nativeStarts, 0);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.deepEqual(result.diagnostics, {
		code: "candidate-owner-preparation-failed",
		message: "candidate view rejected before native START",
	});

	let statusCalls = 0;
	const afterNative = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		process.cwd(),
		{
			targetStatus: async () => { statusCalls += 1; return target; },
			start: async () => {
				nativeStarts += 1;
				throw new CandidateViewError("post-native candidate verification failed", "candidate-view-timeout", {
					phase: "candidate-view",
					category: "timeout",
					git_subcommand: "worktree",
					timeout_ms: 10_000,
					max_buffer_bytes: 64 * 1024 * 1024,
					message: "candidate-view Git command worktree timed out after 10000ms; inspect the candidate state before any new START",
				});
			},
		} as unknown as NativeReviewCli,
		undefined,
		null,
	);
	assert.equal(nativeStarts, 1);
	assert.equal(statusCalls, 2, "a post-native diagnostic must reconcile STATUS");
	assert.equal(afterNative.mutation_outcome, "unknown");
	assert.deepEqual(afterNative.diagnostics, {
		code: "candidate-view-timeout",
		message: "post-native candidate verification failed",
	});
});

test("agent model discovery prioritizes SDD and Judgment Day agents", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-model-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeMarkdown(join(root, "zeta.md"), "name: zeta\n");
	writeMarkdown(join(root, "jd-fix-agent.md"), "name: jd-fix-agent\n");
	writeMarkdown(join(root, "sdd-apply.md"), "name: sdd-apply\n");
	writeMarkdown(join(root, "alpha.md"), "name: alpha\n");
	writeMarkdown(join(root, "jd-judge-b.md"), "name: jd-judge-b\n");
	writeMarkdown(join(root, "sdd-init.md"), "name: sdd-init\n");
	writeMarkdown(join(root, "jd-judge-a.md"), "name: jd-judge-a\n");

	const discovered = __testing.listAgentsFromDir(root, "user");
	const ordered = __testing.orderDiscoverableAgents(discovered);

	assert.deepEqual(
		ordered.map((agent) => agent.name),
		[
			"sdd-init",
			"sdd-apply",
			"jd-judge-a",
			"jd-judge-b",
			"jd-fix-agent",
			"alpha",
			"zeta",
		],
	);
});

test("discoverable model agents include installed Judgment Day agents", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-installed-agents-"));
	const previousHome = process.env.GENTLE_PI_AGENT_HOME;
	process.env.GENTLE_PI_AGENT_HOME = root;
	t.after(() => {
		if (previousHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousHome;
		rmSync(root, { recursive: true, force: true });
	});
	writeMarkdown(join(root, "agents", "jd-judge-a.md"), "name: jd-judge-a\n");
	writeMarkdown(join(root, "agents", "jd-judge-b.md"), "name: jd-judge-b\n");
	writeMarkdown(join(root, "agents", "jd-fix-agent.md"), "name: jd-fix-agent\n");

	const discovered = __testing.listDiscoverableAgents(root).map((agent) => agent.name);

	assert.deepEqual(
		discovered.filter((name) => name.startsWith("jd-")),
		["jd-judge-a", "jd-judge-b", "jd-fix-agent"],
	);
});

test("model panel render does not auto-apply the Gentle theme and sanitizes agent labels", () => {
	const lines = __testing.renderSddModelPanel(
		{},
		["openai/gpt-5.5"],
		["safe-agent\x1b[31m"],
		72,
	);
	const rendered = lines.join("\n");
	const plain = stripAnsi(rendered);

	assert.doesNotMatch(cardBody(rendered), /\x1b\[38;2;71;85;105m/);
	assert.doesNotMatch(cardBody(rendered), /\x1b\[38;2;125;211;252m/);
	assert.match(plain, /Assign Models and Effort to Agents/);
	assert.match(plain, /safe-agent\s+model=inherit, effort=inherit/);
	assert.doesNotMatch(plain, /\[31m/);
});

test("model panel render uses the Pi-provided current theme when supplied", () => {
	const currentTheme = {
		fg(_color: string, text: string): string {
			return `\x1b[35m${text}\x1b[39m`;
		},
	} as unknown as Theme;

	const rendered = __testing
		.renderSddModelPanel({}, ["openai/gpt-5.5"], ["safe-agent"], 72, currentTheme)
		.join("\n");

	assert.match(rendered, /\x1b\[35m/);
	assert.match(stripAnsi(rendered), /Assign Models and Effort to Agents/);
});

test("delivery commands bypass RDD under every mode outcome while command safety remains independent", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const commands = [
		"git commit -m relay",
		"git push origin feature/relay",
		"gh pr create --base main --head feature/relay",
		"gh release create v1.2.3",
		"git status && git commit -m relay",
		"env SAFE=1 git push origin feature/relay",
		"sh -c 'gh pr create --base main --head feature/relay'",
		"sh -c 'gh release create v1.2.3'",
	] as const;
	const modes = [
		{ label: "no native CLI", nativeReviewCli: null },
		{ label: "RDD off", nativeReviewCli: { reviewMode: async () => ({ status: { effective: "off" } }) } },
		{ label: "RDD on", nativeReviewCli: { reviewMode: async () => ({ status: { effective: "on" } }) } },
		{ label: "mode failure", nativeReviewCli: { reviewMode: async () => { throw new Error("mode unavailable"); } } },
	] as const;

	for (const mode of modes) {
		const handlers = new Map<string, ToolCallHandler>();
		const pi = {
			on(name: string, handler: ToolCallHandler) {
				handlers.set(name, handler);
			},
			events: { emit() {} },
			registerCommand() {},
			registerTool() {},
		} as unknown as ExtensionAPI;
		createGentleAiExtension({ nativeReviewCli: mode.nativeReviewCli as never })(pi);
		const toolCall = handlers.get("tool_call");
		assert.equal(typeof toolCall, "function", mode.label);
		const ctx = {
			cwd: process.cwd(),
			hasUI: true,
			ui: { confirm: async () => true },
		} as ExtensionContext;

		for (const command of commands) {
			const result = await toolCall!({ toolName: "bash", input: { command } }, ctx);
			assert.equal(result, undefined, `${mode.label}: ${command}`);
		}
	}
});

test("guarded command confirmation emits a generic correlated permission lifecycle", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	type PermissionEvent = {
		channel: string;
		data: {
			requestId: string;
			state: "waiting" | "approved" | "denied";
			source: "tool_call";
			message: string;
			toolName: "bash";
		};
	};
	type HerdrBlockedEvent = {
		channel: "herdr:blocked";
		data: { active: boolean; label?: string };
	};
	type EmittedEvent = PermissionEvent | HerdrBlockedEvent;
	const handlers = new Map<string, ToolCallHandler>();
	const emitted: EmittedEvent[] = [];
	const sequence: string[] = [];
	let confirm!: () => Promise<boolean>;
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: {
			emit(channel: string, data: EmittedEvent["data"]) {
				sequence.push(
					channel === "herdr:blocked"
						? `herdr:${"active" in data && data.active ? "active" : "inactive"}`
						: `event:${data.state}`,
				);
				emitted.push({ channel, data } as EmittedEvent);
			},
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-permission-request-"));
	try {
		const ctx = {
			cwd,
			hasUI: true,
			ui: {
				confirm: async () => {
					sequence.push("confirm");
					return confirm();
				},
			},
		} as ExtensionContext;
		let resolveConfirmation!: (approved: boolean) => void;
		confirm = () => new Promise<boolean>((resolve) => { resolveConfirmation = resolve; });
		const denied = toolCall!({
			toolName: "bash",
			input: { command: "git rebase main --secret-command-content" },
		}, ctx);

		await Promise.resolve();
		assert.equal(emitted[0].channel, "pi-permission-system:permission-request");
		assert.equal(emitted[0].data.state, "waiting");
		assert.deepEqual(emitted[1], {
			channel: "herdr:blocked",
			data: { active: true, label: "Guarded command confirmation" },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm"]);
		const deniedRequestId = emitted[0].data.requestId;
		assert.match(deniedRequestId, /^[0-9a-f-]{36}$/);
		assert.deepEqual(emitted[0].data, {
			requestId: deniedRequestId,
			state: "waiting",
			source: "tool_call",
			message: "Gentle AI safety policy requires confirmation for this tool call.",
			toolName: "bash",
		});
		assert.equal(Object.keys(emitted[0].data).includes("command"), false);
		assert.equal(Object.keys(emitted[0].data).includes("preview"), false);
		assert.doesNotMatch(JSON.stringify(emitted), /secret-command-content|git rebase/);

		resolveConfirmation(false);
		assert.deepEqual(await denied, {
			block: true,
			reason: "Gentle AI safety policy blocked the command because it was not confirmed.",
		});
		assert.deepEqual(emitted[2], {
			channel: "pi-permission-system:permission-request",
			data: {
				requestId: deniedRequestId,
				state: "denied",
				source: "tool_call",
				message: "Gentle AI safety policy requires confirmation for this tool call.",
				toolName: "bash",
			},
		});
		assert.deepEqual(emitted[3], {
			channel: "herdr:blocked",
			data: { active: false },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm", "event:denied", "herdr:inactive"]);

		emitted.length = 0;
		sequence.length = 0;
		confirm = async () => true;
		assert.equal(await toolCall!({ toolName: "bash", input: { command: "git rebase main" } }, ctx), undefined);
		assert.equal(emitted.length, 4);
		assert.equal(emitted[0].data.state, "waiting");
		assert.deepEqual(emitted[1], {
			channel: "herdr:blocked",
			data: { active: true, label: "Guarded command confirmation" },
		});
		assert.equal(emitted[2].data.state, "approved");
		assert.equal(emitted[0].data.requestId, emitted[2].data.requestId);
		assert.notEqual(emitted[0].data.requestId, deniedRequestId);
		assert.deepEqual(emitted[3], {
			channel: "herdr:blocked",
			data: { active: false },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm", "event:approved", "herdr:inactive"]);

		emitted.length = 0;
		sequence.length = 0;
		const confirmationError = new Error("confirmation unavailable");
		confirm = async () => { throw confirmationError; };
		await assert.rejects(
			toolCall!({ toolName: "bash", input: { command: "git rebase main" } }, ctx),
			(error) => error === confirmationError,
		);
		assert.equal(emitted.length, 4);
		assert.equal(emitted[0].data.state, "waiting");
		assert.deepEqual(emitted[1], {
			channel: "herdr:blocked",
			data: { active: true, label: "Guarded command confirmation" },
		});
		assert.equal(emitted[2].data.state, "denied");
		assert.equal(emitted[0].data.requestId, emitted[2].data.requestId);
		assert.deepEqual(emitted[3], {
			channel: "herdr:blocked",
			data: { active: false },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm", "event:denied", "herdr:inactive"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("concurrent guarded confirmations coalesce the Herdr lifecycle per extension instance", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	type EmittedEvent = {
		channel: string;
		data: {
			requestId?: string;
			state?: "waiting" | "approved" | "denied";
			active?: boolean;
			label?: string;
		};
	};
	const createHarness = () => {
		const handlers = new Map<string, ToolCallHandler>();
		const emitted: EmittedEvent[] = [];
		const confirmations: Array<(approved: boolean) => void> = [];
		const pi = {
			on(name: string, handler: ToolCallHandler) {
				handlers.set(name, handler);
			},
			events: { emit(channel: string, data: EmittedEvent["data"]) { emitted.push({ channel, data }); } },
			registerCommand() {},
			registerTool() {},
		} as unknown as ExtensionAPI;
		createGentleAiExtension({ nativeReviewCli: null })(pi);
		return { handlers, emitted, confirmations };
	};
	const first = createHarness();
	const second = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-permission-concurrent-"));
	try {
		const context = (confirmations: Array<(approved: boolean) => void>) => ({
			cwd,
			hasUI: true,
			ui: {
				confirm: async () => new Promise<boolean>((resolve) => { confirmations.push(resolve); }),
			},
		} as ExtensionContext);
		const firstRequest = first.handlers.get("tool_call")!({ toolName: "bash", input: { command: "git rebase main" } }, context(first.confirmations));
		const secondRequest = first.handlers.get("tool_call")!({ toolName: "bash", input: { command: "git rebase main --another-command" } }, context(first.confirmations));
		await Promise.resolve();
		assert.deepEqual(first.emitted.map(({ channel, data }) => ({ channel, state: data.state, active: data.active })), [
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: true },
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
		]);
		assert.equal(first.confirmations.length, 2);
		const waitingEvents = first.emitted.filter(({ channel, data }) => channel === "pi-permission-system:permission-request" && data.state === "waiting");
		assert.notEqual(waitingEvents[0]?.data.requestId, waitingEvents[1]?.data.requestId);

		first.confirmations[0]!(false);
		assert.deepEqual(await firstRequest, {
			block: true,
			reason: "Gentle AI safety policy blocked the command because it was not confirmed.",
		});
		assert.deepEqual(first.emitted.map(({ channel, data }) => ({ channel, state: data.state, active: data.active })), [
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: true },
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "pi-permission-system:permission-request", state: "denied", active: undefined },
		]);

		const independentRequest = second.handlers.get("tool_call")!({ toolName: "bash", input: { command: "git rebase main --independent-command" } }, context(second.confirmations));
		await Promise.resolve();
		assert.equal(second.emitted.filter(({ channel }) => channel === "herdr:blocked").length, 1);
		assert.equal(second.emitted.find(({ channel }) => channel === "herdr:blocked")?.data.active, true);
		assert.equal(second.confirmations.length, 1);

		first.confirmations[1]!(true);
		assert.equal(await secondRequest, undefined);
		assert.equal(first.emitted.filter(({ channel, data }) => channel === "herdr:blocked" && data.active === false).length, 1);
		second.confirmations[0]!(true);
		assert.equal(await independentRequest, undefined);
		assert.deepEqual(second.emitted.map(({ channel, data }) => ({ channel, state: data.state, active: data.active })), [
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: true },
			{ channel: "pi-permission-system:permission-request", state: "approved", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: false },
		]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});


test("RPIV questionnaire blockers emit only a private, balanced Herdr projection", () => {
	type HerdrBlockedEvent = { active: boolean; label?: string };
	const eventHandlers = new Map<string, (data: unknown) => void>();
	const published: Array<{ channel: string; data: unknown }> = [];
	const herdrEvents: HerdrBlockedEvent[] = [];
	const pi = {
		on() {},
		events: {
			emit(channel: string, data: unknown) {
				published.push({ channel, data });
				if (channel === "herdr:blocked") herdrEvents.push(data as HerdrBlockedEvent);
				const handler = eventHandlers.get(channel);
				if (handler) handler(data);
			},
			on(channel: string, handler: (data: unknown) => void) {
				eventHandlers.set(channel, handler);
				return () => eventHandlers.delete(channel);
			},
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	assert.equal(eventHandlers.size, 2);
	assert.equal(eventHandlers.has("gentle-pi:ask-user-choice:blocked"), true);
	assert.equal(eventHandlers.has("rpiv:ask-user:blocked"), true);

	const source = {
		active: true,
		question: "private questionnaire text",
		answer: "private questionnaire answer",
		path: "/private/questionnaire-path",
		command: "private questionnaire command",
		arbitrary: { nested: "private questionnaire field" },
	};
	pi.events.emit("rpiv:ask-user:blocked", source);
	assert.strictEqual(published[0]?.data, source, "the RPIV event remains the source event");
	assert.deepEqual(herdrEvents, [{ active: true, label: "Questionnaire awaiting input" }]);
	assert.doesNotMatch(JSON.stringify(herdrEvents), /private questionnaire|questionnaire-path/i);

	pi.events.emit("rpiv:ask-user:blocked", { active: true, duplicate: true });
	pi.events.emit("rpiv:ask-user:blocked", { active: "true" });
	pi.events.emit("rpiv:ask-user:blocked", { active: null });
	pi.events.emit("rpiv:ask-user:blocked", []);
	pi.events.emit("rpiv:ask-user:blocked", null);
	pi.events.emit("rpiv:ask-user:other", { active: false });
	assert.deepEqual(herdrEvents, [{ active: true, label: "Questionnaire awaiting input" }]);

	pi.events.emit("rpiv:ask-user:blocked", { active: false });
	pi.events.emit("rpiv:ask-user:blocked", { active: false, duplicate: true });
	pi.events.emit("rpiv:ask-user:blocked", { active: true });
	pi.events.emit("rpiv:ask-user:blocked", { active: false });
	assert.deepEqual(herdrEvents, [
		{ active: true, label: "Questionnaire awaiting input" },
		{ active: false },
		{ active: true, label: "Questionnaire awaiting input" },
		{ active: false },
	]);
});

test("Herdr coordinates guarded confirmations and RPIV labels without inactive relabel pulses", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	type HerdrBlockedEvent = { active: boolean; label?: string };
	const createHarness = () => {
		const handlers = new Map<string, ToolCallHandler>();
		const eventHandlers = new Map<string, (data: unknown) => void>();
		const herdrEvents: HerdrBlockedEvent[] = [];
		const confirmations: Array<(approved: boolean) => void> = [];
		const pi = {
			on(name: string, handler: ToolCallHandler) {
				handlers.set(name, handler);
			},
			events: {
				emit(channel: string, data: unknown) {
					if (channel === "herdr:blocked") herdrEvents.push(data as HerdrBlockedEvent);
					const handler = eventHandlers.get(channel);
					if (handler) handler(data);
				},
				on(channel: string, handler: (data: unknown) => void) {
					eventHandlers.set(channel, handler);
					return () => eventHandlers.delete(channel);
				},
			},
			registerCommand() {},
			registerTool() {},
		} as unknown as ExtensionAPI;
		createGentleAiExtension({ nativeReviewCli: null })(pi);
		const context = {
			cwd: process.cwd(),
			hasUI: true,
			ui: {
				confirm: async () => new Promise<boolean>((resolve) => { confirmations.push(resolve); }),
			},
		} as ExtensionContext;
		return { confirmations, context, herdrEvents, pi, toolCall: handlers.get("tool_call")! };
	};

	const guardedFirst = createHarness();
	const guardedRequest = guardedFirst.toolCall(
		{ toolName: "bash", input: { command: "git rebase main" } },
		guardedFirst.context,
	);
	await Promise.resolve();
	guardedFirst.pi.events.emit("rpiv:ask-user:blocked", { active: true });
	guardedFirst.confirmations[0]!(true);
	assert.equal(await guardedRequest, undefined);
	assert.deepEqual(guardedFirst.herdrEvents, [
		{ active: true, label: "Guarded command confirmation" },
		{ active: true, label: "Questionnaire awaiting input" },
	]);
	guardedFirst.pi.events.emit("rpiv:ask-user:blocked", { active: false });
	assert.deepEqual(guardedFirst.herdrEvents, [
		{ active: true, label: "Guarded command confirmation" },
		{ active: true, label: "Questionnaire awaiting input" },
		{ active: false },
	]);

	const questionnaireFirst = createHarness();
	questionnaireFirst.pi.events.emit("rpiv:ask-user:blocked", { active: true });
	const questionnaireRequest = questionnaireFirst.toolCall(
		{ toolName: "bash", input: { command: "git rebase main" } },
		questionnaireFirst.context,
	);
	await Promise.resolve();
	questionnaireFirst.pi.events.emit("rpiv:ask-user:blocked", { active: false });
	questionnaireFirst.confirmations[0]!(false);
	await questionnaireRequest;
	assert.deepEqual(questionnaireFirst.herdrEvents, [
		{ active: true, label: "Questionnaire awaiting input" },
		{ active: true, label: "Guarded command confirmation" },
		{ active: false },
	]);
});

test("closed choice blockers retain the visible choice label through guarded-confirmation overlap", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	type HerdrBlockedEvent = { active: boolean; label?: string };
	const handlers = new Map<string, ToolCallHandler>();
	const eventHandlers = new Map<string, (data: unknown) => void>();
	const herdrEvents: HerdrBlockedEvent[] = [];
	const choiceEvents: Array<{ active: boolean }> = [];
	const confirmations: Array<(approved: boolean) => void> = [];
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: {
			emit(channel: string, data: unknown) {
				if (channel === "herdr:blocked") herdrEvents.push(data as HerdrBlockedEvent);
				if (channel === "gentle-pi:ask-user-choice:blocked") choiceEvents.push(data as { active: boolean });
				eventHandlers.get(channel)?.(data);
			},
			on(channel: string, handler: (data: unknown) => void) {
				eventHandlers.set(channel, handler);
				return () => eventHandlers.delete(channel);
			},
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	assert.equal(eventHandlers.has("gentle-pi:ask-user-choice:blocked"), true);

	pi.events.emit("gentle-pi:ask-user-choice:blocked", { active: true });
	assert.deepEqual(choiceEvents, [{ active: true }]);
	assert.deepEqual(herdrEvents, [{ active: true, label: "Choice awaiting input" }]);

	const guardedRequest = handlers.get("tool_call")!(
		{ toolName: "bash", input: { command: "git rebase main" } },
		{
			cwd: process.cwd(),
			hasUI: true,
			ui: {
				confirm: async () => new Promise<boolean>((resolve) => { confirmations.push(resolve); }),
			},
		} as ExtensionContext,
	);
	await Promise.resolve();
	assert.equal(confirmations.length, 1);
	assert.deepEqual(herdrEvents, [{ active: true, label: "Choice awaiting input" }]);

	pi.events.emit("gentle-pi:ask-user-choice:blocked", { active: false });
	assert.deepEqual(choiceEvents, [{ active: true }, { active: false }]);
	assert.deepEqual(herdrEvents, [
		{ active: true, label: "Choice awaiting input" },
		{ active: true, label: "Guarded command confirmation" },
	]);
	assert.equal(herdrEvents.some((event) => event.active === false), false);

	confirmations[0]!(true);
	assert.equal(await guardedRequest, undefined);
	assert.deepEqual(herdrEvents, [
		{ active: true, label: "Choice awaiting input" },
		{ active: true, label: "Guarded command confirmation" },
		{ active: false },
	]);
});

test("permission lifecycle is inactive for unguarded and headless commands", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const handlers = new Map<string, ToolCallHandler>();
	const emitted: unknown[] = [];
	let confirmations = 0;
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: { emit(_channel: string, data: unknown) { emitted.push(data); } },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-permission-headless-"));
	try {
		const confirm = async () => {
			confirmations += 1;
			return true;
		};
		assert.equal(await toolCall!({ toolName: "bash", input: { command: "echo safe --secret-command-content" } }, {
			cwd,
			hasUI: false,
			ui: { confirm },
		} as ExtensionContext), undefined);
		assert.deepEqual(await toolCall!({ toolName: "bash", input: { command: "git rebase main" } }, {
			cwd,
			hasUI: false,
			ui: { confirm },
		} as ExtensionContext), {
			block: true,
			reason: "Gentle AI safety policy requires interactive confirmation before this command.",
		});
		assert.equal(confirmations, 0);
		assert.deepEqual(emitted, []);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
test("registered Gentle Review capture tools name the lens they run", () => {
	const tools = registeredGentleTools();
	const binding = (lens: string) => JSON.stringify({ name: "reviewer_result", captureOperation: "review.capture-result", arguments: [], artifactSubject: { lens } });
	const single = tools.get("gentle_review_capture")!.renderCall({ lineageId: "l", collectBinding: binding("review-risk") }, lifecycleTheme, lifecycleContext({ executionStarted: true }));
	assert.equal(cardTitle(renderComponent(single)), "🌹︎ Gentle AI · running · review capture · risk");
	const bare = tools.get("gentle_review_capture")!.renderCall({ lineageId: "l", collectBinding: "{not json" }, lifecycleTheme, lifecycleContext({ executionStarted: true }));
	assert.equal(cardTitle(renderComponent(bare)), "🌹︎ Gentle AI · running · review capture");
	const group = tools.get("gentle_review_capture_group")!.renderCall(
		{ lineageId: "l", collectBindings: [binding("review-risk"), binding("review-resilience"), binding("review-readability"), binding("review-reliability")] },
		lifecycleTheme,
		lifecycleContext({ executionStarted: true }),
	);
	assert.equal(cardTitle(renderComponent(group)), "🌹︎ Gentle AI · running · review capture group · risk · resilience · readability · reliability");
});

test("bash tool_call confirms a late guarded npm publish and denies on non-approval", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;

	const confirmArgs: Array<[string, string]> = [];
	const handlers = new Map<string, ToolCallHandler>();
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");

	const configHome = mkdtempSync(join(tmpdir(), "gentle-pi-guard-confirm-"));
	const ctx = {
		cwd: process.cwd(),
		hasUI: true,
		ui: {
			confirm: async (title: string, message: string) => {
				confirmArgs.push([title, message]);
				return false;
			},
		},
	} as ExtensionContext;

	const prefix = "noise ".repeat(80);
	const command = `${prefix}npm publish --tag beta`;
	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_CONFIG_HOME = configHome;
	try {
		const result = await toolCall!({ toolName: "bash", input: { command } }, ctx);
		assert.deepEqual(result, {
			block: true,
			reason:
				"Gentle AI safety policy blocked the command because it was not confirmed.",
		});
	} finally {
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
		rmSync(configHome, { recursive: true, force: true });
	}

	assert.equal(confirmArgs.length, 1, "guard asks exactly one confirmation before denying");
	const [title, preview] = confirmArgs[0];
	assert.equal(title, "Allow guarded npm publish?");
	assert.match(preview, /npm publish --tag beta/);
	assert.ok(preview.startsWith("…"), "preview elides leading context near a late match");
});

test("bash tool_call confirms every compound action and centers a long git -C push", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const confirmArgs: Array<[string, string]> = [];
	const handlers = new Map<string, ToolCallHandler>();
	const pi = {
		on(name: string, handler: ToolCallHandler) { handlers.set(name, handler); },
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");

	const configHome = mkdtempSync(join(tmpdir(), "gentle-pi-guard-compound-"));
	const previousConfigHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_CONFIG_HOME = configHome;
	try {
		const command = `git -C /${"very-long-path/".repeat(30)} push origin main && npm publish --tag beta`;
		const result = await toolCall!({ toolName: "bash", input: { command } }, {
			cwd: process.cwd(),
			hasUI: true,
			ui: { confirm: async (title: string, message: string) => (confirmArgs.push([title, message]), false) },
		} as ExtensionContext);
		assert.deepEqual(result, {
			block: true,
			reason: "Gentle AI safety policy blocked the command because it was not confirmed.",
		});
	} finally {
		if (previousConfigHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousConfigHome;
		rmSync(configHome, { recursive: true, force: true });
	}

	assert.equal(confirmArgs.length, 1);
	const [title, preview] = confirmArgs[0];
	assert.equal(title, "Allow guarded actions: git push; npm publish?");
	assert.match(preview, /push origin main && npm publish --tag beta/);
	assert.ok(preview.startsWith("…"));
});
