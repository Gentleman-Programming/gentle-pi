import assert from "node:assert/strict";
import test from "node:test";
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
	name: string;
	parameters: ChoiceParameters;
	execute: (...args: unknown[]) => Promise<ChoiceResult>;
}

interface ChoiceLifecycleEvent {
	channel: string;
	data: { active: boolean };
}

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
			custom: async (factory: (tui: { requestRender(): void }, theme: { fg(_color: string, text: string): string; bold(text: string): string }, keybindings: unknown, done: (value: unknown) => void) => { render(width: number): string[]; handleInput(data: string): void }) => {
				let result: unknown;
				const component = factory(
					{ requestRender() {} },
					{ fg: (_color, text) => text, bold: (text) => text },
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
	assert.equal(selected.details.selection?.value, "preserve_requested_hash");
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
