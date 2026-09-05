import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import gentleShell, { buildShellBarModel, type GentlePromptEditor } from "../extensions/gentle-shell.ts";
import type { ShellBarTheme } from "../lib/shell-bar.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";

// The Gentle Shell extension wires the pure bar renderer into pi's footer
// slot. These tests drive it with a fake ExtensionAPI and context.

const plainTheme: ShellBarTheme = {
	fg(_color: string, value: string) {
		return value;
	},
	bold(value: string) {
		return value;
	},
};

interface FakeUi {
	footerFactory: unknown;
	editorFactory: unknown;
}

function fakePi(): { pi: ExtensionAPI; handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>> } {
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	const pi = {
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		getThinkingLevel() {
			return "medium";
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers };
}

function fakeContext(options: { hasUI?: boolean; entries?: unknown[]; oauth?: boolean; pending?: boolean; editorFactory?: unknown } = {}): { ctx: ExtensionContext; ui: FakeUi } {
	const ui: FakeUi = { footerFactory: undefined, editorFactory: options.editorFactory };
	const ctx = {
		hasUI: options.hasUI ?? true,
		hasPendingMessages: () => options.pending ?? false,
		cwd: "/repo",
		model: { id: "gpt-5.5", provider: "openai-codex", reasoning: true, contextWindow: 272_000 },
		sessionManager: {
			getCwd: () => "/repo",
			getSessionName: () => "Release notes",
			getEntries: () => options.entries ?? [],
		},
		modelRegistry: { isUsingOAuth: () => options.oauth ?? true },
		getContextUsage: () => ({ tokens: 122_400, contextWindow: 272_000, percent: 45 }),
		ui: {
			theme: plainTheme,
			setFooter(factory: unknown) {
				ui.footerFactory = factory;
			},
			setEditorComponent(factory: unknown) {
				ui.editorFactory = factory;
			},
			getEditorComponent() {
				return ui.editorFactory;
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, ui };
}

function assistantEntry(usage: { input: number; output: number; cost: number }) {
	return {
		type: "message",
		message: {
			role: "assistant",
			usage: { input: usage.input, output: usage.output, cacheRead: 0, cacheWrite: 0, cost: { total: usage.cost } },
		},
	};
}

test("buildShellBarModel reads session, model, and footer data", () => {
	const { pi } = fakePi();
	const { ctx } = fakeContext({
		entries: [assistantEntry({ input: 1000, output: 200, cost: 0.5 }), assistantEntry({ input: 500, output: 100, cost: 0.25 }), { type: "message", message: { role: "user" } }],
	});
	const footerData = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map([["mcp", "MCP: 3 servers enabled"]]),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
	const built = buildShellBarModel(pi, ctx, footerData, { home: "/home/alan" });
	assert.equal(built.cwd, "/repo");
	assert.equal(built.branch, "main");
	assert.equal(built.sessionName, "Release notes");
	assert.equal(built.modelId, "gpt-5.5");
	assert.equal(built.effort, "medium");
	assert.equal(built.contextPercent, 45);
	assert.equal(built.costTotal, 0.75);
	assert.equal(built.subscription, true);
	assert.deepEqual(built.statuses, ["MCP: 3 servers enabled"]);
});

test("buildShellBarModel shortens the home directory and hides effort for non-reasoning models", () => {
	const { pi } = fakePi();
	const { ctx } = fakeContext();
	(ctx as unknown as { model: { reasoning: boolean } }).model.reasoning = false;
	(ctx.sessionManager as unknown as { getCwd: () => string }).getCwd = () => "/home/alan/work/gentle-pi";
	const footerData = {
		getGitBranch: () => null,
		getExtensionStatuses: () => new Map(),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
	const built = buildShellBarModel(pi, ctx, footerData, { home: "/home/alan" });
	assert.equal(built.cwd, "~/work/gentle-pi");
	assert.equal(built.effort, undefined);
	assert.equal(built.branch, null);
});

test("gentleShell installs the footer on session_start when a UI exists", () => {
	const { pi, handlers } = fakePi();
	gentleShell(pi, {});
	const { ctx, ui } = fakeContext();
	for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
	assert.equal(typeof ui.footerFactory, "function");

	const factory = ui.footerFactory as (tui: unknown, theme: ShellBarTheme, footerData: unknown) => { render(width: number): string[] };
	const component = factory(
		{ requestRender() {} },
		plainTheme,
		{ getGitBranch: () => "main", getExtensionStatuses: () => new Map(), getAvailableProviderCount: () => 1, onBranchChange: () => () => {} },
	);
	const lines = component.render(120);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /main ⟡ gpt-5\.5 · medium/);
});

test("gentleShell stays out of the way without a UI or when disabled", () => {
	const disabled = fakePi();
	gentleShell(disabled.pi, { GENTLE_PI_SHELL: "0" });
	assert.equal(disabled.handlers.size, 0);

	const headless = fakePi();
	gentleShell(headless.pi, {});
	const { ctx, ui } = fakeContext({ hasUI: false });
	for (const handler of headless.handlers.get("session_start") ?? []) handler({}, ctx);
	assert.equal(ui.footerFactory, undefined);
});

const fakeTui = { terminal: { rows: 40, columns: 120 }, requestRender() {} };
const editorTheme = { borderColor: (text: string) => text, selectList: {} };
const fakeKeybindings = { matches: () => false };

function installedPrompt(ctx: ExtensionContext, ui: FakeUi, handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>): GentlePromptEditor {
	for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
	const factory = ui.editorFactory as (tui: unknown, theme: unknown, keybindings: unknown) => GentlePromptEditor;
	return factory(fakeTui, editorTheme, fakeKeybindings);
}

test("gentleShell frames the editor with the petal prompt and a hint while empty", () => {
	const { pi, handlers } = fakePi();
	gentleShell(pi, {});
	const { ctx, ui } = fakeContext();
	const editor = installedPrompt(ctx, ui, handlers);
	editor.focused = true;
	const lines = editor.render(60).map(stripAnsi);
	assert.match(lines[0], /^╭─ ✿ ─+╮$/);
	assert.match(lines[1], /^│.*type, or \/ for commands +│$/);
	assert.match(lines[lines.length - 1], /^╰─+╯$/);
	editor.setText("hola");
	assert.doesNotMatch(editor.render(60).map(stripAnsi)[1], /type, or/);
	editor.dispose();
});

test("gentleShell shows working while the agent runs and queued when messages wait", () => {
	const { pi, handlers } = fakePi();
	gentleShell(pi, {});
	const pending = { value: false };
	const { ctx, ui } = fakeContext();
	(ctx as unknown as { hasPendingMessages: () => boolean }).hasPendingMessages = () => pending.value;
	const editor = installedPrompt(ctx, ui, handlers);

	for (const handler of handlers.get("agent_start") ?? []) handler({}, ctx);
	assert.match(stripAnsi(editor.render(60)[0]), /^╭─ ✿ working ─+╮$/);
	pending.value = true;
	assert.match(stripAnsi(editor.render(60)[0]), /^╭─ ✿ queued ─+╮$/);
	for (const handler of handlers.get("agent_end") ?? []) handler({}, ctx);
	pending.value = false;
	assert.match(stripAnsi(editor.render(60)[0]), /^╭─ ✿ ─+╮$/);
	editor.dispose();
});

test("gentleShell leaves an editor another extension already installed", () => {
	const { pi, handlers } = fakePi();
	gentleShell(pi, {});
	const theirs = () => ({});
	const { ctx, ui } = fakeContext({ editorFactory: theirs });
	for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
	assert.equal(ui.editorFactory, theirs);
});
