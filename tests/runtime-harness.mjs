#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
		getAllTools() {
			return [
				{ name: "read" },
				{ name: "bash" },
				{ name: "edit" },
				{ name: "write" },
			];
		},
	};

	return { pi, hooks, commands, flags };
}

function createUi() {
	const notifications = [];
	return {
		notifications,
		notify(message, level = "info") {
			notifications.push({ message, level });
		},
		async confirm() {
			return false;
		},
		async select(_label, options) {
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

function createCtx(cwd, hasUI = false) {
	return {
		cwd,
		hasUI,
		ui: createUi(),
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
	const { pi, hooks, commands, flags } = createPi();
	await loadExtensions(pi);

	for (const name of EXPECTED_COMMANDS) {
		assert.ok(commands.has(name), `missing command ${name}`);
	}
	assert.ok(flags.has("no-skill-registry"), "missing no-skill-registry flag");
	assert.ok(hooks.has("session_start"), "missing session_start hook");
	assert.ok(hooks.has("before_agent_start"), "missing before_agent_start hook");
	assert.ok(hooks.has("tool_call"), "missing tool_call hook");

	const promptCwd = await tempWorkspace();
	try {
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(promptResult.systemPrompt, /base/);
		assert.match(promptResult.systemPrompt, /el Gentleman/);
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
	} finally {
		await rm(noUiCwd, { recursive: true, force: true });
	}

	const installCwd = await tempWorkspace();
	try {
		const ctx = createCtx(installCwd, true);
		await commands.get("gentle-ai:install-sdd").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD assets installed/);
	} finally {
		await rm(installCwd, { recursive: true, force: true });
	}

	const sddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(sddCwd, true);
		await commands.get("sdd-init").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Wrote openspec\/config\.yaml/);
	} finally {
		await rm(sddCwd, { recursive: true, force: true });
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
