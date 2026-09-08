import assert from "node:assert/strict";
import test from "node:test";
import userPromptRecall from "../extensions/user-prompt-recall.ts";

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

interface FakeUi {
	notify: (msg: string, level: string) => void;
	setEditorText: (text: string) => void;
	custom: (...args: unknown[]) => Promise<unknown>;
}

interface FakeCtx {
	mode: string;
	hasUI: boolean;
	ui: FakeUi;
	sessionManager: { getEntries: () => unknown[] };
}

function makeCtx(
	mode: string,
	hasUI: boolean,
	entries: unknown[] = [],
): {
	ctx: FakeCtx;
	notifyCalls: Array<{ msg: string; level: string }>;
	setEditorTextCalls: string[];
	customCalls: unknown[];
} {
	const notifyCalls: Array<{ msg: string; level: string }> = [];
	const setEditorTextCalls: string[] = [];
	const customCalls: unknown[] = [];
	const ctx: FakeCtx = {
		mode,
		hasUI,
		ui: {
			notify: (msg, level) => {
				notifyCalls.push({ msg, level });
			},
			setEditorText: (text) => {
				setEditorTextCalls.push(text);
			},
			custom: (...args: unknown[]) => {
				customCalls.push(args);
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => entries,
		},
	};
	return { ctx, notifyCalls, setEditorTextCalls, customCalls };
}

test("rpc mode with hasUI=false posts only the availability notify", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const { ctx, notifyCalls, setEditorTextCalls, customCalls } = makeCtx(
		"rpc",
		false,
		[{ type: "message", message: { role: "user", content: "hello" } }],
	);

	await handler("", ctx);

	assert.equal(setEditorTextCalls.length, 0, "setEditorText must not be called");
	assert.equal(customCalls.length, 0, "ui.custom must not be called");
	assert.equal(notifyCalls.length, 1, "exactly one notify should be posted");
	assert.equal(
		notifyCalls[0]?.msg,
		"Comando /input solo disponible en modo TUI.",
	);
	assert.equal(notifyCalls[0]?.level, "info");
});

test("print mode with hasUI=true still does not open the picker or mutate the editor", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("i")!.handler;

	const { ctx, notifyCalls, setEditorTextCalls, customCalls } = makeCtx(
		"print",
		true,
		[{ type: "message", message: { role: "user", content: "hello" } }],
	);

	await handler("", ctx);

	assert.equal(setEditorTextCalls.length, 0);
	assert.equal(customCalls.length, 0);
	assert.equal(notifyCalls.length, 1);
	assert.equal(
		notifyCalls[0]?.msg,
		"Comando /input solo disponible en modo TUI.",
	);
});

test("rpc mode with hasUI=true still does not open the picker or mutate the editor", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const { ctx, notifyCalls, setEditorTextCalls, customCalls } = makeCtx(
		"rpc",
		true,
		[{ type: "message", message: { role: "user", content: "hello" } }],
	);

	await handler("", ctx);

	assert.equal(setEditorTextCalls.length, 0);
	assert.equal(customCalls.length, 0);
	assert.equal(notifyCalls.length, 1);
	assert.equal(
		notifyCalls[0]?.msg,
		"Comando /input solo disponible en modo TUI.",
	);
});

test("non-TUI mode with empty entries still posts only the availability notify", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const { ctx, notifyCalls, customCalls } = makeCtx("rpc", false, []);

	await handler("", ctx);

	assert.equal(customCalls.length, 0);
	assert.equal(notifyCalls.length, 1);
	assert.equal(
		notifyCalls[0]?.msg,
		"Comando /input solo disponible en modo TUI.",
	);
});

test("TUI mode with empty entries still posts only the empty-history notify", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const { ctx, notifyCalls, setEditorTextCalls, customCalls } = makeCtx(
		"tui",
		true,
		[],
	);

	await handler("", ctx);

	assert.equal(customCalls.length, 0);
	assert.equal(setEditorTextCalls.length, 0);
	assert.equal(notifyCalls.length, 1);
	assert.equal(
		notifyCalls[0]?.msg,
		"No hay prompts en el historial de esta sesión.",
	);
	assert.equal(notifyCalls[0]?.level, "info");
});

test("throw during entry scan is caught and falls back to the generic-error notify", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const notifyCalls: Array<{ msg: string; level: string }> = [];
	const setEditorTextCalls: string[] = [];
	const customCalls: unknown[] = [];

	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: (msg: string, level: string) => {
				notifyCalls.push({ msg, level });
			},
			setEditorText: (text: string) => {
				setEditorTextCalls.push(text);
			},
			custom: (...args: unknown[]) => {
				customCalls.push(args);
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => {
				throw new Error("boom");
			},
		},
	};

	await handler("", ctx);

	assert.equal(customCalls.length, 0, "picker must not be opened on scan error");
	assert.equal(setEditorTextCalls.length, 0);
	assert.equal(notifyCalls.length, 1);
	assert.equal(notifyCalls[0]?.msg, "gentle-pi /input: error inesperado");
	assert.equal(notifyCalls[0]?.level, "error");
});

test("missing sessionManager does not throw and falls back to the empty-history notify", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const notifyCalls: Array<{ msg: string; level: string }> = [];
	const customCalls: unknown[] = [];

	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: (msg: string, level: string) => {
				notifyCalls.push({ msg, level });
			},
			setEditorText: () => {},
			custom: (...args: unknown[]) => {
				customCalls.push(args);
				return Promise.resolve(undefined);
			},
		},
		// sessionManager missing on purpose
	};

	await handler("", ctx);

	assert.equal(customCalls.length, 0);
	assert.equal(notifyCalls.length, 1);
	assert.equal(
		notifyCalls[0]?.msg,
		"No hay prompts en el historial de esta sesión.",
	);
});
