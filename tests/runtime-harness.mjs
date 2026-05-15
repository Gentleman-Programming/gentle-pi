#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXTENSIONS = [
	"extensions/gentle-ai.ts",
	"extensions/skill-registry.ts",
	"extensions/sdd-init.ts",
	"extensions/startup-banner.ts",
];

const EXPECTED_COMMANDS = [
	"gentle-ai:install-sdd",
	"gentle-ai:sdd-preflight",
	"gentle:sdd-preflight",
	"gentle:models",
	"gentle-ai:models",
	"gentleman:models",
	"gentle:persona",
	"gentle-ai:persona",
	"gentleman:persona",
	"gentle-ai:status",
	"sdd-init",
	"skill-registry:refresh",
];

function createPi() {
	const hooks = new Map();
	const commands = new Map();
	const flags = new Map();
	const flagValues = new Map([["no-skill-registry", true]]);
	let activeTools = ["read", "bash", "edit", "write"];

	const pi = {
		on(name, handler) {
			const list = hooks.get(name) ?? [];
			list.push(handler);
			hooks.set(name, list);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerFlag(name, definition) {
			flags.set(name, definition);
		},
		getFlag(name) {
			return flagValues.get(name) ?? false;
		},
		setFlag(name, value) {
			flagValues.set(name, value);
		},
		getCommands() {
			return Array.from(commands, ([name, definition]) => ({ name, ...definition }));
		},
		getActiveTools() {
			return activeTools;
		},
		setActiveTools(value) {
			activeTools = value;
		},
		getAllTools() {
			return [
				{ name: "read" },
				{ name: "bash" },
				{ name: "edit" },
				{ name: "write" },
				{ name: "mem_save" },
			];
		},
	};

	return { pi, hooks, commands, flags };
}

function createUi() {
	const notifications = [];
	const selections = [];
	return {
		notifications,
		selections,
		notify(message, level = "info") {
			notifications.push({ message, level });
		},
		async confirm() {
			return false;
		},
		async select(label, options) {
			selections.push({ label, options });
			return options[0];
		},
		async input(_label, placeholder) {
			return placeholder;
		},
		custom() {
			return Promise.resolve({ type: "cancel" });
		},
	};
}

function createCtx(cwd, hasUI = false, sessionId = "session-1") {
	return {
		cwd,
		hasUI,
		ui: createUi(),
		sessionManager: {
			getSessionFile() {
				return join(cwd, `${sessionId}.jsonl`);
			},
			getSessionId() {
				return sessionId;
			},
		},
		modelRegistry: {
			async getAvailable() {
				return [];
			},
		},
	};
}

async function tempWorkspace() {
	return mkdtemp(join(tmpdir(), "gentle-pi-runtime-"));
}

async function loadExtensions(pi) {
	for (const [index, rel] of EXTENSIONS.entries()) {
		const mod = await import(`${pathToFileURL(join(ROOT, rel)).href}?runtime-harness=${index}`);
		assert.equal(typeof mod.default, "function", `${rel} must export a default function`);
		mod.default(pi);
	}
}

async function run() {
	const globalConfigHome = await tempWorkspace();
	process.env.GENTLE_PI_CONFIG_HOME = globalConfigHome;
	const globalModelsPath = join(globalConfigHome, "models.json");
	const { pi, hooks, commands, flags } = createPi();
	await loadExtensions(pi);

	for (const name of EXPECTED_COMMANDS) {
		assert.ok(commands.has(name), `missing command ${name}`);
	}
	assert.ok(flags.has("no-skill-registry"), "missing no-skill-registry flag");
	assert.ok(hooks.has("session_start"), "missing session_start hook");
	assert.ok(hooks.has("input"), "missing input hook");
	assert.ok(hooks.has("before_agent_start"), "missing before_agent_start hook");
	assert.ok(hooks.has("tool_call"), "missing tool_call hook");

	const discovered = await discoverAndLoadExtensions(["./extensions"], ROOT);
	assert.deepEqual(
		discovered.errors,
		[],
		"declared extension directory must load without invalid helper modules",
	);

	const promptCwd = await tempWorkspace();
	try {
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(promptResult.systemPrompt, /base/);
		assert.match(promptResult.systemPrompt, /el Gentleman/);
		assert.equal(
			existsSync(join(promptCwd, ".pi", "agents", "sdd-apply.md")),
			false,
			"normal agent startup must not run SDD preflight",
		);
	} finally {
		await rm(promptCwd, { recursive: true, force: true });
	}

	const toolCwd = await tempWorkspace();
	try {
		const toolHook = hooks.get("tool_call")[0];
		assert.equal(await toolHook({ toolName: "bash", input: { command: "git status" } }, createCtx(toolCwd)), undefined);
		const denied = await toolHook({ toolName: "bash", input: { command: "rm -rf /" } }, createCtx(toolCwd));
		assert.equal(denied.block, true);
		assert.match(denied.reason, /destructive/);
		const needsConfirm = await toolHook({ toolName: "bash", input: { command: "git push" } }, createCtx(toolCwd));
		assert.equal(needsConfirm.block, true);
		assert.match(needsConfirm.reason, /confirmation/);
	} finally {
		await rm(toolCwd, { recursive: true, force: true });
	}

	const noUiCwd = await tempWorkspace();
	try {
		for (const handler of hooks.get("session_start")) {
			await handler({ reason: "startup" }, createCtx(noUiCwd, false));
		}
		assert.equal(
			existsSync(join(noUiCwd, ".pi", "agents", "sdd-apply.md")),
			false,
			"session_start must not install SDD agents before first SDD intent",
		);
		assert.equal(
			existsSync(join(noUiCwd, ".pi", "chains", "sdd-full.chain.md")),
			false,
			"session_start must not install SDD chains before first SDD intent",
		);
	} finally {
		await rm(noUiCwd, { recursive: true, force: true });
	}

	const lazySddCwd = await tempWorkspace();
	try {
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": { model: "openai/gpt-5", thinking: "high" } }, null, 2),
		);
		const ctx = createCtx(lazySddCwd, true);
		const inputHook = hooks.get("input")[0];
		assert.deepEqual(
			await inputHook({ text: "hola, solo mirando", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "what is SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "what can I do with SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "how do I use SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "Can I use SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "don't use sdd for this", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "sin usar SDD por ahora", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "let's not use SDD for this", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "never use SDD here", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "no quiero usar SDD por ahora", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "I use SDD sometimes", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "I'm using SDD in another repo", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);

		assert.deepEqual(
			await inputHook({ text: "please use sdd for this change", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "/sdd", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "/sdd plan", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "/sdd:plan", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);

		assert.deepEqual(
			await inputHook({ text: "/sdd-plan this change", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "chains", "sdd-full.chain.md")), true);
		const lazyAppliedAgent = await readFile(
			join(lazySddCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(lazyAppliedAgent, /model: openai\/gpt-5/);
		assert.match(lazyAppliedAgent, /thinking: high/);
		assert.equal(ctx.ui.selections.length, 3);
		assert.deepEqual(ctx.ui.selections[1].options, ["openspec"]);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD preflight complete/);

		await inputHook({ text: "/sdd-plan another change", source: "interactive" }, ctx);
		assert.equal(ctx.ui.selections.length, 3, "preflight should run only once per session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook({ systemPrompt: "base" }, ctx);
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.match(promptResult.systemPrompt, /Execution mode: interactive/);
	} finally {
		await rm(lazySddCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const commandSddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(commandSddCwd, true, "command-session");
		await commands.get("gentle-ai:sdd-preflight").handler("", ctx);
		assert.equal(existsSync(join(commandSddCwd, ".pi", "agents", "sdd-apply.md")), true);
		assert.equal(ctx.ui.selections.length, 3);
		await commands.get("gentle:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.selections.length, 3, "manual preflight command should reuse session choices");
	} finally {
		await rm(commandSddCwd, { recursive: true, force: true });
	}

	const sddAgentGuardCwd = await tempWorkspace();
	try {
		const ctx = createCtx(sddAgentGuardCwd, true, "sdd-agent-guard-session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook(
			{
				systemPrompt: "You are the SDD proposal executor for Gentle AI.",
			},
			ctx,
		);
		assert.equal(existsSync(join(sddAgentGuardCwd, ".pi", "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(sddAgentGuardCwd, ".pi", "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 3);
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD preflight complete/);

		await promptHook(
			{
				agentName: "sdd-tasks",
				systemPrompt: "You are the SDD tasks executor for Gentle AI.",
			},
			ctx,
		);
		assert.equal(ctx.ui.selections.length, 3, "SDD agent guard should reuse session choices");
	} finally {
		await rm(sddAgentGuardCwd, { recursive: true, force: true });
	}

	const invalidPreflightCwd = await tempWorkspace();
	try {
		await writeFile(globalModelsPath, "{ invalid json");
		const ctx = createCtx(invalidPreflightCwd, true, "invalid-preflight-session");
		await commands.get("gentle-ai:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.notifications.at(-1).level, "warning");
		assert.match(ctx.ui.notifications.at(-1).message, /Model routing skipped:/);
		assert.match(ctx.ui.notifications.at(-1).message, /invalid JSON or not an object/);
	} finally {
		await rm(invalidPreflightCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const engramSddCwd = await tempWorkspace();
	try {
		pi.setActiveTools(["read", "bash", "edit", "write", "mem_save"]);
		const ctx = createCtx(engramSddCwd, true, "engram-session");
		await commands.get("gentle-ai:sdd-preflight").handler("", ctx);
		assert.deepEqual(ctx.ui.selections[1].options, ["openspec", "engram", "both"]);
	} finally {
		pi.setActiveTools(["read", "bash", "edit", "write"]);
		await rm(engramSddCwd, { recursive: true, force: true });
	}

	const installCwd = await tempWorkspace();
	try {
		const ctx = createCtx(installCwd, true);
		await commands.get("gentle-ai:install-sdd").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD assets installed/);
	} finally {
		await rm(installCwd, { recursive: true, force: true });
	}

	const staleAssetsCwd = await tempWorkspace();
	try {
		await mkdir(join(staleAssetsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(join(staleAssetsCwd, ".pi", "chains"), { recursive: true });
		await writeFile(join(staleAssetsCwd, ".pi", "agents", "sdd-apply.md"), "stale apply\n");
		await writeFile(join(staleAssetsCwd, ".pi", "agents", "sdd-spec.md"), "stale spec\n");
		await writeFile(join(staleAssetsCwd, ".pi", "chains", "sdd-full.chain.md"), "stale chain\n");
		const ctx = createCtx(staleAssetsCwd, true);
		await commands.get("gentle-ai:status").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD assets stale: \d+ file\(s\)/);
		assert.match(ctx.ui.notifications.at(-1).message, /gentle-ai:install-sdd --force/);
	} finally {
		await rm(staleAssetsCwd, { recursive: true, force: true });
	}

	const sddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(sddCwd, true);
		await commands.get("sdd-init").handler("", ctx);
		assert.equal(existsSync(join(sddCwd, ".pi", "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(sddCwd, ".pi", "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(sddCwd, ".pi", "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 3);
		assert.match(ctx.ui.notifications[0].message, /SDD preflight complete/);
		assert.match(ctx.ui.notifications.at(-1).message, /Wrote openspec\/config\.yaml/);

		await commands.get("gentle-ai:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.selections.length, 3, "/sdd-init preflight should be reused by later manual preflight");
	} finally {
		await rm(sddCwd, { recursive: true, force: true });
	}

	const invalidSddInitCwd = await tempWorkspace();
	try {
		await mkdir(join(invalidSddInitCwd, ".pi", "agents"), { recursive: true });
		await writeFile(
			join(invalidSddInitCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\nmodel: keep/provider-model\n---\n\nbody\n`,
		);
		await writeFile(globalModelsPath, "{ invalid json");
		const ctx = createCtx(invalidSddInitCwd, true, "invalid-sdd-init-session");
		await commands.get("sdd-init").handler("", ctx);
		assert.equal(ctx.ui.notifications[0].level, "warning");
		assert.match(ctx.ui.notifications[0].message, /Model routing skipped:/);
		assert.match(ctx.ui.notifications[0].message, /models\.json/);
		assert.match(ctx.ui.notifications.at(-1).message, /Wrote openspec\/config\.yaml/);
		const preservedAgent = await readFile(
			join(invalidSddInitCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(preservedAgent, /model: keep\/provider-model/);
	} finally {
		await rm(invalidSddInitCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const legacyModelsCwd = await tempWorkspace();
	try {
		await mkdir(join(legacyModelsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(join(legacyModelsCwd, ".pi", "gentle-ai"), { recursive: true });
		await writeFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\n---\n\nbody\n`,
		);
		await writeFile(
			join(legacyModelsCwd, ".pi", "gentle-ai", "models.json"),
			JSON.stringify({ "sdd-apply": "legacy/provider-model" }, null, 2),
		);
		const legacyCtx = createCtx(legacyModelsCwd, true);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const legacyAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(legacyAgent, /model: legacy\/provider-model/);
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": "global/provider-model" }, null, 2),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const globalWinsAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(globalWinsAgent, /model: global\/provider-model/);
		assert.doesNotMatch(globalWinsAgent, /model: legacy\/provider-model/);
		await writeFile(globalModelsPath, "{ invalid json");
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const invalidGlobalSkippedAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(invalidGlobalSkippedAgent, /model: global\/provider-model/);
		assert.doesNotMatch(invalidGlobalSkippedAgent, /model: legacy\/provider-model/);
		assert.equal(legacyCtx.ui.notifications.at(-1).level, "warning");
		assert.match(legacyCtx.ui.notifications.at(-1).message, /skipped model config/);
		let modelPanelOpened = false;
		legacyCtx.ui.custom = () => {
			modelPanelOpened = true;
			return Promise.resolve({ type: "save", config: {} });
		};
		await commands.get("gentle:models").handler("", legacyCtx);
		assert.equal(modelPanelOpened, false);
		assert.equal(await readFile(globalModelsPath, "utf8"), "{ invalid json");
		assert.equal(legacyCtx.ui.notifications.at(-1).level, "warning");
		assert.match(legacyCtx.ui.notifications.at(-1).message, /cannot open model config/);
		await writeFile(globalModelsPath, JSON.stringify({}, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const emptyGlobalSuppressesLegacyAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.doesNotMatch(emptyGlobalSuppressesLegacyAgent, /model:/);
	} finally {
		await rm(legacyModelsCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const modelsCwd = await tempWorkspace();
	try {
		await mkdir(join(modelsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(
			join(modelsCwd, ".pi", "npm", "node_modules", "pi-subagents", "agents"),
			{ recursive: true },
		);
		await writeFile(
			join(
				modelsCwd,
				".pi",
				"npm",
				"node_modules",
				"pi-subagents",
				"agents",
				"worker.md",
			),
			`---\nname: worker\ndescription: Builtin worker\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\n---\n\nbody\n`,
		);
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": "openai/gpt-5" }, null, 2),
		);

		const ctx = createCtx(modelsCwd, true);
		await hooks.get("session_start")[0]({ reason: "startup" }, ctx);
		const legacyAppliedAgent = await readFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(legacyAppliedAgent, /model: openai\/gpt-5/);
		assert.doesNotMatch(legacyAppliedAgent, /thinking:/);

		ctx.ui.custom = () =>
			Promise.resolve({
				type: "save",
				config: {
					"sdd-apply": { model: "openai/gpt-5", thinking: "high" },
					worker: { model: "openai/gpt-5-mini", thinking: "low" },
				},
			});
		await commands.get("gentle:models").handler("", ctx);

		const savedConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(savedConfig["sdd-apply"], {
			model: "openai/gpt-5",
			thinking: "high",
		});
		assert.equal(
			existsSync(join(modelsCwd, ".pi", "gentle-ai", "models.json")),
			false,
			"/gentle:models must save model routing globally, not per project",
		);

		const applyAgent = await readFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(applyAgent, /model: openai\/gpt-5/);
		assert.match(applyAgent, /thinking: high/);

		const settings = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "settings.json"), "utf8"),
		);
		assert.equal(
			settings.subagents.agentOverrides.worker.model,
			"openai/gpt-5-mini",
		);
		assert.equal(settings.subagents.agentOverrides.worker.thinking, "low");

		let customPanelCalls = 0;
		ctx.ui.input = async () => "custom/provider-model";
		ctx.ui.custom = (factory) =>
			new Promise((resolve) => {
				customPanelCalls += 1;
				const panel = factory(null, null, null, resolve);
				if (customPanelCalls === 1) {
					panel.handleInput("e"); // effort picker for all agents
					for (let i = 0; i < 4; i++) panel.handleInput("j"); // medium
					panel.handleInput("\r");
					panel.handleInput("c"); // custom model from the same unsaved draft
					return;
				}
				panel.handleInput("\u0013"); // ctrl+s saves the draft reopened after custom model input
			});
		await commands.get("gentle:models").handler("", ctx);

		const customSavedConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(customSavedConfig["sdd-apply"], {
			model: "custom/provider-model",
			thinking: "medium",
		});
	} finally {
		await rm(modelsCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const registryCwd = await tempWorkspace();
	try {
		const ctx = createCtx(registryCwd, true);
		await commands.get("skill-registry:refresh").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Skill registry:/);
	} finally {
		await rm(registryCwd, { recursive: true, force: true });
	}
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
