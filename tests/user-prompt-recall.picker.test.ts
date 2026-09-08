import assert from "node:assert/strict";
import test from "node:test";
import userPromptRecall from "../extensions/user-prompt-recall.ts";

interface CapturedComponent {
	render(width: number): string[];
}

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

const PASSTHROUGH_THEME = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
};

function makeTui(): { requestRender: () => void } {
	return { requestRender: () => {} };
}

function userEntry(content: unknown): {
	type: string;
	message: { role: string; content: unknown };
} {
	return {
		type: "message",
		message: { role: "user", content },
	};
}

test("in TUI mode with non-empty prompts, ctx.ui.custom is invoked exactly once", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	let customCalls = 0;
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: () => {},
			setEditorText: () => {},
			custom: (_factory: (...args: unknown[]) => unknown) => {
				customCalls += 1;
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => [userEntry("hola"), userEntry("como va")],
		},
	};

	await handler("", ctx);

	assert.equal(
		customCalls,
		1,
		"ctx.ui.custom should be invoked exactly once when prompts exist",
	);
});

test("the picker rendered output includes the prompts and the /input title", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	let component: CapturedComponent | undefined;
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: () => {},
			setEditorText: () => {},
			custom: (factory: (...args: unknown[]) => unknown) => {
				const tui = makeTui();
				const done = (_value: unknown) => {};
				component = factory(
					tui,
					PASSTHROUGH_THEME,
					undefined,
					done,
				) as CapturedComponent;
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => [
				userEntry("refactor the picker"),
				userEntry("add fuzzy match"),
			],
		},
	};

	await handler("", ctx);

	assert.ok(component, "factory should produce a component");
	const lines = component!.render(120);
	const rendered = lines.join("\n");
	assert.ok(
		rendered.includes("Busca un prompt"),
		`rendered output should contain the /input picker title, got: ${JSON.stringify(lines)}`,
	);
	assert.ok(rendered.includes("refactor the picker"));
	assert.ok(rendered.includes("add fuzzy match"));
});

test("selecting a prompt calls ctx.ui.setEditorText exactly once with that text", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const setEditorCalls: string[] = [];
	let capturedFactory: ((...args: unknown[]) => unknown) | undefined;

	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: () => {},
			setEditorText: (text: string) => {
				setEditorCalls.push(text);
			},
			custom: (factory: (...args: unknown[]) => unknown) => {
				capturedFactory = factory;
				const tui = makeTui();
				const done = (_value: unknown) => {};
				factory(tui, PASSTHROUGH_THEME, undefined, done);
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => [userEntry("hello editor")],
		},
	};

	await handler("", ctx);

	assert.ok(capturedFactory, "factory should have been captured");
	// Drill into the Container to find the SelectList and trigger its onSelect.
	// The Container is the return value of the factory. We need to inspect its
	// children: the first child is the title Text, the second is queryText,
	// the third is the SelectList (or similar ordering).
	// We poke at the Container by re-running the factory and inspecting children.
	let selectList: { onSelect?: (item: { value: string }) => void } | undefined;
	const captureCtx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: () => {},
			setEditorText: (text: string) => {
				setEditorCalls.push(text);
			},
			custom: (factory: (...args: unknown[]) => unknown) => {
				const tui = makeTui();
				const done = (_value: unknown) => {};
				const container = factory(tui, PASSTHROUGH_THEME, undefined, done) as {
					children?: { onSelect?: (item: { value: string }) => void }[];
				} & {
					render: (w: number) => string[];
				};
				// SelectList is the fourth child (topBorder, titleText, queryText, list)
				// but we search more defensively.
				const children = (container.children ?? []) as Array<{
					onSelect?: (item: { value: string }) => void;
					onCancel?: () => void;
				}>;
				selectList = children.find((c) => typeof c.onSelect === "function") as {
					onSelect?: (item: { value: string }) => void;
				};
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => [userEntry("hello editor")],
		},
	};

	setEditorCalls.length = 0;
	await handler("", captureCtx);

	assert.ok(selectList, "SelectList child should expose onSelect");
	assert.equal(typeof selectList!.onSelect, "function");
	selectList!.onSelect!({ value: "hello editor" });
	assert.deepEqual(setEditorCalls, ["hello editor"]);
});

test("cancel via Escape must NOT call ctx.ui.setEditorText", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	const setEditorCalls: string[] = [];
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: () => {},
			setEditorText: (text: string) => {
				setEditorCalls.push(text);
			},
			custom: (factory: (...args: unknown[]) => unknown) => {
				const tui = makeTui();
				const done = (_value: unknown) => {};
				const container = factory(tui, PASSTHROUGH_THEME, undefined, done) as {
					handleInput?: (data: string) => void;
				};
				// Send Escape to the container
				container.handleInput?.("\x1b");
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => [userEntry("never inject this")],
		},
	};

	await handler("", ctx);

	assert.equal(
		setEditorCalls.length,
		0,
		"Escape must not trigger setEditorText",
	);
});

test("multiple identical prompts are deduplicated in the picker", async () => {
	const pi = makePi();
	userPromptRecall(pi as never);
	const handler = pi.commands.get("input")!.handler;

	let component: CapturedComponent | undefined;
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: () => {},
			setEditorText: () => {},
			custom: (factory: (...args: unknown[]) => unknown) => {
				const tui = makeTui();
				const done = (_value: unknown) => {};
				component = factory(
					tui,
					PASSTHROUGH_THEME,
					undefined,
					done,
				) as CapturedComponent;
				return Promise.resolve(undefined);
			},
		},
		sessionManager: {
			getEntries: () => [
				userEntry("repeat me"),
				userEntry("other"),
				userEntry("repeat me"),
			],
		},
	};

	await handler("", ctx);

	const rendered = component!.render(120).join("\n");
	const occurrences = rendered.split("repeat me").length - 1;
	assert.equal(
		occurrences,
		1,
		"identical prompts must be deduplicated to a single picker entry",
	);
});
