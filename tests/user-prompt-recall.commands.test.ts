import assert from "node:assert/strict";
import test from "node:test";
import userPromptRecall, {
	__testing,
} from "../extensions/user-prompt-recall.ts";

interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: unknown) => unknown;
}

interface CapturingPi {
	commands: Map<string, RegisteredCommand>;
	registerCommand: (name: string, opts: RegisteredCommand) => void;
}

function makePi(): CapturingPi {
	const commands = new Map<string, RegisteredCommand>();
	return {
		commands,
		registerCommand(name, opts) {
			commands.set(name, opts);
		},
	};
}

interface FakeCtx {
	mode: string;
	hasUI: boolean;
	ui: {
		notify: (msg: string, level: string) => void;
		setEditorText: (text: string) => void;
		custom: (...args: unknown[]) => Promise<unknown>;
	};
	sessionManager: { getEntries: () => unknown[] };
}

function makeCtx(
	overrides: Partial<{
		mode: string;
		hasUI: boolean;
		getEntries: () => unknown[];
	}> = {},
): { ctx: FakeCtx; notified: Array<{ msg: string; level: string }> } {
	const notified: Array<{ msg: string; level: string }> = [];
	const ctx: FakeCtx = {
		mode: overrides.mode ?? "tui",
		hasUI: overrides.hasUI ?? true,
		ui: {
			notify: (msg: string, level: string) => {
				notified.push({ msg, level });
			},
			setEditorText: () => {},
			custom: () => Promise.resolve(undefined),
		},
		sessionManager: {
			getEntries:
				overrides.getEntries ??
				(() => {
					return [];
				}),
		},
	};
	return { ctx, notified };
}

test("registers both /input and /i commands with the right descriptions", () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	assert.ok(pi.commands.has("input"), "should register /input");
	assert.ok(pi.commands.has("i"), "should register /i");
	assert.equal(
		pi.commands.get("input")?.description,
		"Buscar en mis prompts enviados al LLM durante la sesión",
	);
	assert.equal(pi.commands.get("i")?.description, "Alias rápido para /input");
});

test("/input and /i share the same handler implementation", () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const inputHandler = pi.commands.get("input")?.handler;
	const aliasHandler = pi.commands.get("i")?.handler;
	assert.equal(typeof inputHandler, "function");
	assert.equal(typeof aliasHandler, "function");
	assert.strictEqual(
		inputHandler,
		aliasHandler,
		"/input and /i must share the same handler reference",
	);
});

test("handler runs without throwing when session has no entries", () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const { ctx, notified } = makeCtx();
	const handler = pi.commands.get("input")!.handler;
	assert.doesNotThrow(() => {
		handler("", ctx);
	});
	assert.equal(notified.length, 1);
	assert.equal(
		notified[0]?.msg,
		"No hay prompts en el historial de esta sesión.",
	);
	assert.equal(notified[0]?.level, "info");
});

test("exports testing helpers", () => {
	assert.equal(typeof __testing.collectUserPrompts, "function");
});
