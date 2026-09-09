import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import installGentleSddProfile, {
	GENTLE_SDD_PROFILE_COMMAND,
	GENTLE_SDD_PROFILE_DELETE_COMMAND,
	GENTLE_SDD_PROFILE_LIST_COMMAND,
	GENTLE_SDD_PROFILE_RENAME_COMMAND,
	GENTLE_SDD_PROFILE_SAVE_COMMAND,
	SDD_PROFILE_TOOL_DELETE,
	SDD_PROFILE_TOOL_LIST,
	SDD_PROFILE_TOOL_RENAME,
	SDD_PROFILE_TOOL_USE,
	sddProfileShortcut,
} from "../extensions/gentle-sdd-profile.ts";
import { SddProfileManager } from "../lib/sdd-profiles-manager.ts";

type Handler = (args: string, ctx: any) => Promise<string | void>;

interface Setup {
	handler: Handler;
	commands: Map<string, { handler: Handler }>;
	ctx: any;
	manager: SddProfileManager;
	notices: Array<{ message: string; level?: string }>;
	shortcuts: Map<string, { handler: (ctx: any) => Promise<unknown> }>;
	tools: Map<string, { execute: (...args: any[]) => Promise<any> }>;
	events: Map<string, (...args: any[]) => unknown>;
	pi: any;
}

function setup(env: NodeJS.ProcessEnv = {}): Setup {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gentle-sdd-profile-"));
	const cwd = path.join(root, "work");
	const globalDir = path.join(root, "global-profiles");
	fs.mkdirSync(cwd, { recursive: true });
	const notices: Setup["notices"] = [];
	const commands = new Map<string, { handler: Handler }>();
	const shortcuts: Setup["shortcuts"] = new Map();
	const tools: Setup["tools"] = new Map();
	const events: Setup["events"] = new Map();
	const pi: any = {
		registerCommand(name: string, registration: { handler: Handler }) {
			commands.set(name, registration);
		},
		registerShortcut(name: string, registration: { handler: (ctx: any) => Promise<unknown> }) {
			shortcuts.set(name, registration);
		},
		registerTool(definition: { name: string; execute: (...args: any[]) => Promise<any> }) {
			tools.set(definition.name, definition);
		},
		on(event: string, handler: (...args: any[]) => unknown) {
			events.set(event, handler);
		},
	};
	(installGentleSddProfile as (pi: unknown, env?: unknown) => void)(pi, env);
	assert.ok(commands.has(GENTLE_SDD_PROFILE_COMMAND), "command registered");
	const handler = commands.get(GENTLE_SDD_PROFILE_COMMAND)!.handler;
	const ctx = {
		cwd,
		globalDir,
		activeStatePath: path.join(globalDir, ".active"),
		globalSubagentsPath: path.join(root, "subagents.json"),
		sessionManager: { getCwd: () => cwd },
		ui: {
			notify: (message: string, level?: string) => {
				notices.push({ message, level });
			},
		},
	};
	const manager = new SddProfileManager({
		globalDir,
		projectDir: path.join(cwd, ".pi", "profiles"),
		projectSubagentsPath: path.join(cwd, ".pi", "subagents.json"),
		activeStatePath: path.join(globalDir, ".active"),
		globalSubagentsPath: path.join(root, "subagents.json"),
	});
	return { handler, ctx, manager, notices, shortcuts, tools, events, pi, commands };
}

function saveForTest(manager: SddProfileManager, name: string): void {
	manager.saveProfile(
		{ name, description: `${name} fixture`, model_profiles: {} },
		"global",
	);
}

test("list names profiles and marks the active one", async () => {
	const { handler, ctx, manager } = setup();
	saveForTest(manager, "alpha");
	saveForTest(manager, "beta");
	manager.activateProfile("alpha");

	const out = (await handler("list", ctx)) as string;
	assert.match(out, /alpha/);
	assert.match(out, /beta/);
	assert.match(out, /gentle-default/);
	assert.match(out, /\* alpha/);
	assert.doesNotMatch(out, /\* beta/);
});

test("use activates a profile and reports", async () => {
	const { handler, ctx, manager, notices } = setup();
	const out = (await handler("use gentle-economy", ctx)) as string;
	assert.match(out, /gentle-economy/);
	assert.equal(manager.getActiveProfileName(), "gentle-economy");
	assert.ok(notices.some((n) => n.message === out && n.level === "info"));
});

test("use of a missing profile reports not-found", async () => {
	const { handler, ctx, notices } = setup();
	const out = (await handler("use nope", ctx)) as string;
	assert.match(out, /not found/i);
	assert.ok(notices.some((n) => n.message === out && n.level === "error"));
});

test("save persists so loadProfile finds it", async () => {
	const { handler, ctx, manager } = setup();
	const out = (await handler("save snap snap description", ctx)) as string;
	assert.match(out, /snap/);
	const loaded = manager.loadProfile("snap");
	assert.ok(loaded, "saved profile loads back");
	assert.equal(loaded.description, "snap description");
});

test("rename moves the profile", async () => {
	const { handler, ctx, manager } = setup();
	saveForTest(manager, "old");
	const out = (await handler("rename old new", ctx)) as string;
	assert.match(out, /new/);
	assert.ok(manager.loadProfile("new"), "renamed profile loads");
	assert.equal(manager.loadProfile("old"), null);
});

test("delete of the active profile refuses", async () => {
	const { handler, ctx, manager } = setup();
	saveForTest(manager, "live");
	manager.activateProfile("live");
	const out = (await handler("delete live", ctx)) as string;
	assert.match(out, /active/i);
	assert.ok(manager.loadProfile("live"), "active profile kept");
});

test("delete of a missing profile reports not-found", async () => {
	const { handler, ctx, notices } = setup();
	const out = (await handler("delete ghost", ctx)) as string;
	assert.match(out, /not found/i);
	assert.ok(notices.some((n) => n.message === out && n.level === "warning"));
});

test("bare profile name activates it, unknown token prints usage", async () => {
	const { handler, ctx, manager } = setup();
	const activated = (await handler("gentle-economy", ctx)) as string;
	assert.match(activated, /gentle-economy/);
	assert.equal(manager.getActiveProfileName(), "gentle-economy");
	const usage = (await handler("frobnicate", ctx)) as string;
	assert.match(usage, /Usage:/);
});

test("shortcut default is platform-dependent, env overrides, off disables", () => {
	assert.equal(sddProfileShortcut({}, "darwin"), "ctrl+shift+m");
	assert.equal(sddProfileShortcut({}, "linux"), "alt+m");
	assert.equal(sddProfileShortcut({ GENTLE_PI_SDD_PROFILES_KEY: "ctrl+x" }, "darwin"), "ctrl+x");
	assert.equal(sddProfileShortcut({ GENTLE_PI_SDD_PROFILES_KEY: "off" }, "linux"), undefined);
	assert.equal(sddProfileShortcut({ GENTLE_PI_SDD_PROFILES_KEY: "OFF" }, "darwin"), undefined);
	assert.equal(sddProfileShortcut({ GENTLE_PI_SDD_PROFILES_KEY: "" }, "linux"), undefined);
});

test("shortcut is registered once and returns the profile list text", async () => {
	const { shortcuts, ctx, manager } = setup();
	assert.equal(shortcuts.size, 1);
	saveForTest(manager, "alpha");
	manager.activateProfile("alpha");
	const entry = [...shortcuts.values()][0];
	const out = (await entry.handler(ctx)) as string;
	assert.match(out, /alpha/);
	assert.match(out, /\* alpha/);
});

test("env off disables the shortcut registration", () => {
	const { shortcuts } = setup({ GENTLE_PI_SDD_PROFILES_KEY: "off" });
	assert.equal(shortcuts.size, 0);
});

test("session_start syncs model and thinking when setters exist", async () => {
	const { events, ctx, manager, pi } = setup();
	manager.activateProfile("gentle-economy");
	const modelCalls: unknown[] = [];
	const thinkingCalls: unknown[] = [];
	pi.setModel = async (model: unknown) => {
		modelCalls.push(model);
		return true;
	};
	pi.setThinkingLevel = (level: unknown) => {
		thinkingCalls.push(level);
	};
	ctx.modelRegistry = { find: (provider: string, id: string) => ({ provider, id }) };
	const onStart = events.get("session_start") as (event: unknown, ctx: unknown) => unknown;
	assert.ok(onStart, "session_start subscribed");
	await onStart({}, ctx);
	// gentle-economy carries default_model openai/gpt-5-mini and default_effort low.
	assert.deepEqual(modelCalls, [{ provider: "openai", id: "gpt-5-mini" }]);
	assert.deepEqual(thinkingCalls, ["low"]);
});

test("session_start works with ui with or without setStatus and no pi setters", async () => {
	const statusCalls: unknown[][] = [];
	const variants = [
		{ notify: () => {} },
		{ notify: () => {}, setStatus: (...args: unknown[]) => void statusCalls.push(args) },
	];
	for (const ui of variants) {
		const { events, ctx, manager } = setup();
		manager.activateProfile("gentle-economy");
		const before = manager.getActiveProfileName();
		const onStart = events.get("session_start") as (event: unknown, ctx: unknown) => unknown;
		await onStart({}, { ...ctx, ui });
		assert.equal(manager.getActiveProfileName(), before);
	}
	// PR8: footer segment deferred, session_start never depends on setStatus.
	assert.equal(statusCalls.length, 0);
});

test("sdd_profile_list tool returns profiles as JSON", async () => {
	const { tools, ctx, manager } = setup();
	manager.activateProfile("gentle-economy");
	const list = tools.get(SDD_PROFILE_TOOL_LIST);
	assert.ok(list, "list tool registered");
	const result = await list.execute("id", {}, undefined, undefined, ctx);
	const parsed = JSON.parse(result.content.map((part: any) => part.text).join("\n"));
	assert.equal(parsed.active_profile, "gentle-economy");
	assert.ok(Array.isArray(parsed.profiles));
	assert.ok(parsed.profiles.some((p: any) => p.name === "gentle-economy"));
});

test("sdd_profile_use tool roundtrips and errors on a missing profile", async () => {
	const { tools, ctx, manager } = setup();
	const use = tools.get(SDD_PROFILE_TOOL_USE);
	assert.ok(use, "use tool registered");
	const result = await use.execute("id", { profile_name: "gentle-reasoning", scope: "global" }, undefined, undefined, ctx);
	const parsed = JSON.parse(result.content[0].text);
	assert.equal(parsed.active_profile, "gentle-reasoning");
	assert.equal(manager.getActiveProfileName(), "gentle-reasoning");
	await assert.rejects(
		() => use.execute("id", { profile_name: "nope" }, undefined, undefined, ctx),
		/not found/i,
	);
});

test("modal picker gets non-empty models without a list() registry", async () => {
	const probe = setup();
	probe.ctx.hasUI = true;
	probe.ctx.modelRegistry = {}; // No list(), no getAvailable(): fallback must kick in.
	let captured: unknown = undefined;
	probe.ctx.ui.custom = async (render: (...a: any[]) => any) => {
		const fakeTui = { terminal: { rows: 24 }, requestRender: () => {} };
		const view = render(fakeTui, { fg: (_c: string, t: string) => t }, {}, () => {});
		captured = (view as { availableModels?: unknown }).availableModels;
		return null;
	};
	const entry = [...probe.shortcuts.values()][0];
	assert.ok(entry, "shortcut registered");
	await entry.handler(probe.ctx);
	assert.ok(Array.isArray(captured), "models passed to view");
	assert.ok((captured as string[]).length > 0, "picker models non-empty via fallback");
	assert.ok((captured as string[]).some((m) => m.includes("/")), "provider/model shape");
});

test("show prints detail, errors when missing", async () => {
	const { handler, ctx, manager } = setup();
	saveForTest(manager, "alpha");
	const out = (await handler("show alpha", ctx)) as string;
	assert.match(out, /Profile: alpha/);
	const missing = (await handler("show ghost", ctx)) as string;
	assert.match(missing, /not found/i);
	const usage = (await handler("show", ctx)) as string;
	assert.match(usage, /Usage:/);
});

test("create makes a profile, duplicate errors", async () => {
	const { handler, ctx, manager, notices } = setup();
	const out = (await handler("create brand-new openai/gpt-4o", ctx)) as string;
	assert.match(out, /brand-new/);
	assert.ok(manager.loadProfile("brand-new"), "created profile loads");
	const dup = (await handler("create brand-new", ctx)) as string;
	assert.match(dup, /already exists/i);
	assert.ok(notices.some((n) => n.message === dup && n.level === "error"));
	const usage = (await handler("create", ctx)) as string;
	assert.match(usage, /Usage:/);
});

test("set assigns agent model, errors on unknown agent and missing profile", async () => {
	const { handler, ctx, manager } = setup();
	saveForTest(manager, "alpha");
	const out = (await handler("set alpha sdd-explore openai/gpt-4o", ctx)) as string;
	assert.match(out, /sdd-explore/);
	assert.equal(manager.loadProfile("alpha")?.model_profiles?.["sdd-explore"]?.model, "openai/gpt-4o");
	const unknownAgent = (await handler("set alpha nope-agent openai/gpt-4o", ctx)) as string;
	assert.match(unknownAgent, /Unknown agent/i);
	const missing = (await handler("set ghost sdd-explore openai/gpt-4o", ctx)) as string;
	assert.match(missing, /not found/i);
	const usage = (await handler("set alpha", ctx)) as string;
	assert.match(usage, /Usage:/);
});

test("helper commands list/save/rename/delete roundtrip", async () => {
	const { commands, ctx, manager } = setup();
	for (const name of [GENTLE_SDD_PROFILE_LIST_COMMAND, GENTLE_SDD_PROFILE_SAVE_COMMAND, GENTLE_SDD_PROFILE_RENAME_COMMAND, GENTLE_SDD_PROFILE_DELETE_COMMAND]) {
		assert.ok(commands.has(name), `${name} registered`);
	}
	saveForTest(manager, "alpha");
	const list = (await commands.get(GENTLE_SDD_PROFILE_LIST_COMMAND)!.handler("", ctx)) as string;
	assert.match(list, /alpha/);
	const saved = (await commands.get(GENTLE_SDD_PROFILE_SAVE_COMMAND)!.handler("snap snap desc", ctx)) as string;
	assert.match(saved, /snap/);
	assert.ok(manager.loadProfile("snap"), "helper save persists");
	const renamed = (await commands.get(GENTLE_SDD_PROFILE_RENAME_COMMAND)!.handler("snap snap2", ctx)) as string;
	assert.match(renamed, /snap2/);
	manager.activateProfile("alpha");
	const deleted = (await commands.get(GENTLE_SDD_PROFILE_DELETE_COMMAND)!.handler("snap2", ctx)) as string;
	assert.match(deleted, /Deleted/i);
	assert.equal(manager.loadProfile("snap2"), null);
});

test("helper delete refuses the active profile", async () => {
	const { commands, ctx, manager } = setup();
	saveForTest(manager, "live");
	manager.activateProfile("live");
	const out = (await commands.get(GENTLE_SDD_PROFILE_DELETE_COMMAND)!.handler("live", ctx)) as string;
	assert.match(out, /active/i);
	assert.ok(manager.loadProfile("live"), "active profile kept");
});

test("sdd_profile_rename and sdd_profile_delete tools roundtrip with guards", async () => {
	const { tools, ctx, manager } = setup();
	const rename = tools.get(SDD_PROFILE_TOOL_RENAME);
	const del = tools.get(SDD_PROFILE_TOOL_DELETE);
	assert.ok(rename, "rename tool registered");
	assert.ok(del, "delete tool registered");
	saveForTest(manager, "old");
	const r = await rename.execute("id", { old_name: "old", new_name: "new" }, undefined, undefined, ctx);
	assert.match(JSON.parse(r.content[0].text).message, /new/);
	assert.ok(manager.loadProfile("new"), "renamed profile loads");
	saveForTest(manager, "live");
	manager.activateProfile("live");
	const refused = await del.execute("id", { profile_name: "live" }, undefined, undefined, ctx);
	assert.match(JSON.parse(refused.content[0].text).message, /active/i);
	assert.ok(manager.loadProfile("live"), "active profile kept");
	const missing = await del.execute("id", { profile_name: "ghost" }, undefined, undefined, ctx);
	assert.match(JSON.parse(missing.content[0].text).message, /not found/i);
	manager.activateProfile("new");
	const okDel = await del.execute("id", { profile_name: "live" }, undefined, undefined, ctx);
	// live is no longer active (new is), so delete succeeds.
	assert.equal(JSON.parse(okDel.content[0].text).success, true);
});
