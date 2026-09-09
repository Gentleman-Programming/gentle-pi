import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import askUserChoice from "../extensions/ask-user-choice.ts";

interface ChoiceResult {
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
}

interface ChoiceOptionSchema {
	additionalProperties?: boolean;
	properties?: Record<string, unknown>;
}

interface ChoiceParameters {
	additionalProperties?: boolean;
	properties?: {
		question?: unknown;
		options?: {
			minItems?: number;
			maxItems?: number;
			items?: ChoiceOptionSchema;
		};
	};
}

interface ChoiceTool {
	renderShell?: string;
	name: string;
	parameters: ChoiceParameters;
	execute: (...args: unknown[]) => Promise<ChoiceResult>;
}

interface ChoiceLifecycleEvent {
	channel: string;
	data: { active: boolean };
}

interface NativeChoiceComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	handleMouse?: (event: Record<string, unknown>) => NativeChoiceMouseResult | undefined;
}

interface NativeChoiceMouseResult {
	handled?: boolean;
	focus?: boolean;
	render?: boolean;
}

interface ChoiceTui {
	requestRender(): void;
}

interface ChoiceTheme {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

type ChoiceCustomFactory = (
	tui: ChoiceTui,
	theme: ChoiceTheme,
	keybindings: unknown,
	done: (value: unknown) => void,
) => NativeChoiceComponent;

type BeforeAgentStart = (event: unknown, ctx: { mode: string }) => void | Promise<void>;

function registerChoiceTool(
	initialTools: string[] = [],
	onLifecycleEvent?: (event: ChoiceLifecycleEvent) => void,
) {
	let activeTools = initialTools;
	let runtimeActionsAllowed = false;
	let getActiveToolsCalls = 0;
	let setActiveToolsCalls = 0;
	let tool: ChoiceTool | undefined;
	const hooks: BeforeAgentStart[] = [];
	const registeredToolNames: string[] = [];
	const emittedEvents: ChoiceLifecycleEvent[] = [];
	const pi = {
		getActiveTools: () => {
			getActiveToolsCalls++;
			if (!runtimeActionsAllowed) {
				throw new Error("runtime actions are unavailable while the extension is loading");
			}
			return activeTools;
		},
		setActiveTools: (names: string[]) => {
			setActiveToolsCalls++;
			if (!runtimeActionsAllowed) {
				throw new Error("runtime actions are unavailable while the extension is loading");
			}
			activeTools = names;
		},
		registerTool: (candidate: unknown) => {
			tool = candidate as ChoiceTool;
			registeredToolNames.push(tool.name);
		},
		on: (event: string, handler: BeforeAgentStart) => {
			if (event === "before_agent_start") hooks.push(handler);
		},
		events: {
			emit(channel: string, data: { active: boolean }) {
				const event = { channel, data };
				emittedEvents.push(event);
				onLifecycleEvent?.(event);
			},
		},
	};
	askUserChoice(pi as never);
	assert.ok(tool, "ask_user_choice must register");
	return {
		hooks,
		tool,
		registeredToolNames,
		activeTools: () => [...activeTools],
		emittedEvents: () => [...emittedEvents],
		runtimeActionCalls: () => ({ getActiveTools: getActiveToolsCalls, setActiveTools: setActiveToolsCalls }),
		allowRuntimeActions: () => {
			runtimeActionsAllowed = true;
		},
	};
}

const options = [
	{ label: "Authorize observed hash", description: "Accept the baseline hash observed in this runtime.", value: "authorize_observed_hash" },
	{ label: "Preserve requested hash", description: "Keep the hash from the original request.", value: "preserve_requested_hash" },
];

function tuiContext(inputs: readonly string[], rendered: { value: string }) {
	return {
		mode: "tui",
		ui: {
			custom: async (factory: ChoiceCustomFactory) => {
				let result: unknown;
				const component = factory(
					{ requestRender() {} },
					{ fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
					{},
					(value) => {
						result = value;
					},
				);
				rendered.value = component.render(100).join("\n");
				for (const input of inputs) component.handleInput(input);
				return result;
			},
		},
	};
}

test("ask_user_choice transcript opts out of Pi's painted tool shell", () => {
	assert.equal(registerChoiceTool().tool.renderShell, "self");
});

test("ask_user_choice registers without runtime actions or overriding the open questionnaire", () => {
	const registration = registerChoiceTool(["read", "ask_user_question"]);

	assert.deepEqual(registration.registeredToolNames, ["ask_user_choice"]);
	assert.deepEqual(registration.runtimeActionCalls(), { getActiveTools: 0, setActiveTools: 0 });
	assert.deepEqual(registration.activeTools(), ["read", "ask_user_question"]);
});

test("ask_user_choice exposes a strict closed single-select schema", () => {
	const { tool } = registerChoiceTool();
	const optionsSchema = tool.parameters.properties?.options;
	const optionSchema = optionsSchema?.items;

	assert.equal(tool.name, "ask_user_choice");
	assert.equal(tool.parameters.additionalProperties, false);
	assert.deepEqual(Object.keys(tool.parameters.properties ?? {}).sort(), ["options", "question"]);
	assert.equal(optionsSchema?.minItems, 2);
	assert.equal(optionsSchema?.maxItems, 4);
	assert.equal(optionSchema?.additionalProperties, false);
	assert.deepEqual(Object.keys(optionSchema?.properties ?? {}).sort(), ["description", "label", "value"]);
});

test("ask_user_choice hover preserves the keyboard-selected opaque value", async () => {
	const { tool } = registerChoiceTool();
	let completionCalls = 0;
	const result = await tool.execute("call", { question: "Proceed?", options }, new AbortController().signal, undefined, {
		mode: "tui",
		ui: { custom: async (factory: ChoiceCustomFactory) => {
			let completed: unknown;
			const component = factory({ requestRender() {} }, {
				fg: (_color, text) => `\u001b[38;5;39m${text}\u001b[39m`,
				bg: (_color, text) => `\u001b[48;5;236m${text}\u001b[49m`, bold: (text) => text,
			}, {}, (value) => { completionCalls++; completed = value; });
			const lines = component.render(80);
			const first = lines.findIndex((line) => stripTerminalSequences(line).includes(options[0]!.label));
			const second = lines.findIndex((line) => stripTerminalSequences(line).includes(options[1]!.label));
			assert.ok(first >= 0 && second >= 0);
			const hover = {
				type: "move", button: "none", x: 0, y: second,
				screenX: 0, screenY: second, width: 80, height: lines.length,
				shift: false, alt: false, ctrl: false,
			};
			assert.equal(component.handleMouse?.(hover)?.render, true);
			assert.equal(completed, undefined, "hover never submits");
			const hovered = component.render(80);
			assert.ok(hovered[second]?.includes("\u001b[48;5;236m"), "only the second option is hovered");
			assert.ok(
				hovered[first]?.includes("\u001b[38;5;39m") && !hovered[first]?.includes("\u001b[48;5;236m"),
				"hover does not change keyboard selection",
			);
			component.handleInput("\r");
			component.handleInput("\r");
			return completed;
		} },
	});
	assert.deepEqual(result.details.selection, { value: options[0]!.value, label: options[0]!.label, index: 1 });
	assert.equal(completionCalls, 1);
});

test("ask_user_choice retains native rendered hit testing for mouse selection", async () => {
	const longOptions = [
		{
			label: "Authorize the observed baseline hash after independent verification",
			description: "Accept the observed baseline after a long description that verifies layout offsets.",
			value: "authorize_observed_hash",
		},
		{
			label: "Preserve the originally requested hash without changing the envelope",
			description: "Keep the original opaque answer token after the user confirms the requested value.",
			value: "preserve_requested_hash",
		},
	];
	const { tool } = registerChoiceTool();
	let completionCalls = 0;
	const result = await tool.execute(
		"call",
		{
			question: "A deliberately long question verifies that the rendered header does not shift native option hit bounds.",
			options: longOptions,
		},
		new AbortController().signal,
		undefined,
		{
			mode: "tui",
			ui: {
				custom: async (factory: ChoiceCustomFactory) => {
					let completed: unknown;
					const component = factory(
						{ requestRender() {} },
						{ fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
						{},
						(value) => {
							completionCalls++;
							completed = value;
						},
					) as NativeChoiceComponent;
					const narrow = component.render(24);
					assert.ok(narrow.length > 0, "the real component renders before a narrow-to-wide resize");
					const wide = component.render(100);
					const secondRow = wide.findIndex((line) => line.includes(longOptions[1]!.label.slice(0, 24)));
					assert.ok(secondRow >= 0, "the test locates the actual rendered option row");
					const event = (type: string, button: string, y: number, wheelDelta?: number) => ({
						type,
						button,
						x: 1,
						y,
						screenX: 1,
						screenY: y,
						width: 100,
						height: wide.length,
						shift: false,
						alt: false,
						ctrl: false,
						wheelDelta,
					});
					assert.equal(typeof component.handleMouse, "function", "native mouse dispatch must survive the custom UI adapter");
					const wheel = component.handleMouse?.(event("wheel", "none", secondRow, 1));
					assert.equal(wheel?.handled, true);
					assert.equal(wheel?.render, true);
					assert.equal(completed, undefined, "wheel changes focus without answering");
					assert.equal(component.handleMouse?.(event("release", "left", secondRow)), undefined);
					assert.equal(component.handleMouse?.(event("click", "right", secondRow)), undefined);
					assert.equal(component.handleMouse?.(event("click", "left", wide.length)), undefined);
					assert.equal(component.handleMouse?.({ type: "click" }), undefined);
					const press = component.handleMouse?.(event("press", "left", secondRow));
					assert.equal(press?.handled, true);
					assert.equal(press?.focus, true);
					assert.equal(completed, undefined, "press focuses and selects but never answers");
					component.handleMouse?.(event("click", "left", secondRow));
					component.handleMouse?.(event("click", "left", secondRow));
					component.handleInput("\r");
					return completed;
				},
			},
		},
	);
	assert.deepEqual(result.details.selection, {
		value: "preserve_requested_hash",
		label: longOptions[1]!.label,
		index: 2,
	});
	assert.equal(completionCalls, 1, "late keyboard input cannot complete the choice twice");
});

test("ask_user_choice handles a closed Kilo hash decision with an opaque envelope value", async () => {
	const { tool } = registerChoiceTool(["read"]);
	const rendered = { value: "" };
	const result = await tool.execute("call", { question: "Proceed?", options }, new AbortController().signal, undefined, tuiContext(["\x1b[B", "\r"], rendered));
	assert.match(rendered.value, /Proceed\?|Authorize observed hash|Accept the baseline hash|Preserve requested hash|Keep the hash/);
	assert.doesNotMatch(rendered.value, /Type something|authorize_observed_hash|preserve_requested_hash/);
	assert.deepEqual(result.details.selection, { value: "preserve_requested_hash", label: "Preserve requested hash", index: 2 });
	assert.equal(result.content[0]?.text, "User selected: 2. Preserve requested hash (value: preserve_requested_hash)");
});

test("ask_user_choice cancels without a value and remains unavailable outside the TUI", async () => {
	const { tool } = registerChoiceTool();
	const rendered = { value: "" };
	const cancelled = await tool.execute("call", { question: "Proceed?", options }, new AbortController().signal, undefined, tuiContext(["\x1b"], rendered));
	assert.equal(cancelled.details.selection, undefined);
	assert.equal(cancelled.details.cancelled, true);
	await assert.rejects(
		() => tool.execute("call", { question: "Proceed?", options }, new AbortController().signal, undefined, { mode: "print" }),
		/unavailable outside the interactive TUI/,
	);
});

test("ask_user_choice emits a private balanced lifecycle around selection and cancellation", async () => {
	const sequence: string[] = [];
	const selectedRegistration = registerChoiceTool([], ({ data }) => {
		sequence.push(data.active ? "active" : "inactive");
	});
	const selected = await selectedRegistration.tool.execute(
		"call",
		{ question: "private choice question", options },
		new AbortController().signal,
		undefined,
		{
			mode: "tui",
			ui: {
				custom: async () => {
					sequence.push("custom");
					return { value: "preserve_requested_hash", label: "Preserve requested hash", index: 2 };
				},
			},
		},
	);
	const selection = selected.details.selection;
	assert.ok(selection !== null && typeof selection === "object" && "value" in selection);
	assert.equal(selection.value, "preserve_requested_hash");
	assert.deepEqual(sequence, ["active", "custom", "inactive"]);
	assert.deepEqual(selectedRegistration.emittedEvents(), [
		{ channel: "gentle-pi:ask-user-choice:blocked", data: { active: true } },
		{ channel: "gentle-pi:ask-user-choice:blocked", data: { active: false } },
	]);
	assert.doesNotMatch(
		JSON.stringify(selectedRegistration.emittedEvents()),
		/private choice question|Authorize observed hash|Accept the baseline hash|preserve_requested_hash/,
	);

	const cancelledRegistration = registerChoiceTool();
	const cancelled = await cancelledRegistration.tool.execute(
		"call",
		{ question: "Proceed?", options },
		new AbortController().signal,
		undefined,
		{ mode: "tui", ui: { custom: async () => undefined } },
	);
	assert.equal(cancelled.details.cancelled, true);
	assert.deepEqual(cancelledRegistration.emittedEvents(), [
		{ channel: "gentle-pi:ask-user-choice:blocked", data: { active: true } },
		{ channel: "gentle-pi:ask-user-choice:blocked", data: { active: false } },
	]);
});

test("ask_user_choice settles its lifecycle after a custom UI error and emits nothing outside the TUI", async () => {
	const failedRegistration = registerChoiceTool();
	const customError = new Error("custom UI failed");
	await assert.rejects(
		failedRegistration.tool.execute(
			"call",
			{ question: "Proceed?", options },
			new AbortController().signal,
			undefined,
			{ mode: "tui", ui: { custom: async () => { throw customError; } } },
		),
		(error) => error === customError,
	);
	assert.deepEqual(failedRegistration.emittedEvents(), [
		{ channel: "gentle-pi:ask-user-choice:blocked", data: { active: true } },
		{ channel: "gentle-pi:ask-user-choice:blocked", data: { active: false } },
	]);

	const nonTuiRegistration = registerChoiceTool();
	let customCalled = false;
	await assert.rejects(
		nonTuiRegistration.tool.execute(
			"call",
			{ question: "Proceed?", options },
			new AbortController().signal,
			undefined,
			{
				mode: "print",
				ui: {
					custom: async () => {
						customCalled = true;
						return undefined;
					},
				},
			},
		),
		/unavailable outside the interactive TUI/,
	);
	assert.equal(customCalled, false);
	assert.deepEqual(nonTuiRegistration.emittedEvents(), []);
});

test("ask_user_choice is offered only for interactive TUI turns and preserves the open questionnaire", async () => {
	const registration = registerChoiceTool(["read", "ask_user_question"]);
	registration.allowRuntimeActions();

	for (const hook of registration.hooks) await hook({}, { mode: "tui" });
	assert.deepEqual(registration.activeTools(), ["read", "ask_user_question", "ask_user_choice"]);
	for (const hook of registration.hooks) await hook({}, { mode: "print" });
	assert.deepEqual(registration.activeTools(), ["read", "ask_user_question"]);
});
