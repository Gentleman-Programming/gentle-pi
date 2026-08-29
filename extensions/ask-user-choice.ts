import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const CHOICE_TOOL_NAME = "ask_user_choice";
const ASK_USER_CHOICE_BLOCKED_EVENT = "gentle-pi:ask-user-choice:blocked";

const ChoiceOptionSchema = Type.Object(
	{
		label: Type.String({ description: "User-facing option label" }),
		description: Type.String({ description: "User-facing option description" }),
		value: Type.String({ description: "Opaque envelope-owned answer token returned only after selection" }),
	},
	{ additionalProperties: false },
);

const ChoiceParamsSchema = Type.Object(
	{
		question: Type.String({ description: "The one question to display" }),
		options: Type.Array(ChoiceOptionSchema, {
			minItems: 2,
			maxItems: 4,
			description: "Two to four ordered closed options",
		}),
	},
	{ additionalProperties: false },
);

type ChoiceOption = Static<typeof ChoiceOptionSchema>;
type ChoiceParams = Static<typeof ChoiceParamsSchema>;

interface ChoiceSelection {
	value: string;
	label: string;
	index: number;
}

interface ChoiceDetails {
	question: string;
	options: ChoiceOption[];
	selection?: ChoiceSelection;
	cancelled?: true;
}

function reconcileToolAvailability(pi: ExtensionAPI, interactiveTui: boolean): void {
	const active = pi.getActiveTools();
	const isActive = active.includes(CHOICE_TOOL_NAME);
	if (interactiveTui === isActive) return;
	const next = interactiveTui
		? [...new Set([...active, CHOICE_TOOL_NAME])]
		: active.filter((name) => name !== CHOICE_TOOL_NAME);
	pi.setActiveTools(next);
}

function resultDetails(params: ChoiceParams): ChoiceDetails {
	return { question: params.question, options: params.options };
}

export default function askUserChoice(pi: ExtensionAPI): void {
	pi.registerTool({
		name: CHOICE_TOOL_NAME,
		label: "Ask User Choice",
		description: "Ask one strictly closed single-select question with two to four ordered options. It never accepts free-text or multiple selections.",
		promptGuidelines: [
			"Use ask_user_choice only for one exactly representable closed single-select question with 2-4 ordered options; never use it for free-text or multi-select input.",
		],
		parameters: ChoiceParamsSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params: ChoiceParams, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				throw new Error("ask_user_choice is unavailable outside the interactive TUI");
			}

			const items: SelectItem[] = params.options.map((option) => ({
				value: option.value,
				label: option.label,
				description: option.description,
			}));
			let selection: ChoiceSelection | undefined;
			try {
				pi.events.emit(ASK_USER_CHOICE_BLOCKED_EVENT, { active: true });
				selection = await ctx.ui.custom<ChoiceSelection | undefined>((tui, theme, _keybindings, done) => {
					const container = new Container();
					container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
					container.addChild(new Text(theme.fg("accent", theme.bold(params.question)), 1, 0));
					const list = new SelectList(items, items.length, {
						selectedPrefix: (text) => theme.fg("accent", text),
						selectedText: (text) => theme.fg("accent", text),
						description: (text) => theme.fg("muted", text),
						scrollInfo: (text) => theme.fg("dim", text),
						noMatch: (text) => theme.fg("warning", text),
					});
					list.onSelect = (item) => {
						const index = items.indexOf(item);
						done({ value: item.value, label: item.label, index: index + 1 });
					};
					list.onCancel = () => done(undefined);
					container.addChild(list);
					container.addChild(new Text(theme.fg("dim", "↑↓ navigate • Enter select • Esc cancel"), 1, 0));
					container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
					return {
						render: (width) => container.render(width),
						invalidate: () => container.invalidate(),
						handleInput: (data) => {
							list.handleInput(data);
							tui.requestRender();
						},
					};
				});
			} finally {
				pi.events.emit(ASK_USER_CHOICE_BLOCKED_EVENT, { active: false });
			}

			if (selection === undefined) {
				return {
					content: [{ type: "text", text: "User cancelled the choice" }],
					details: { ...resultDetails(params), cancelled: true },
				};
			}
			return {
				content: [{ type: "text", text: `User selected: ${selection.index}. ${selection.label} (value: ${selection.value})` }],
				details: { ...resultDetails(params), selection },
			};
		},
		renderCall(args, theme) {
			const options = Array.isArray(args.options) ? args.options : [];
			const labels = options
				.map((option) => (typeof option === "object" && option !== null && "label" in option && typeof option.label === "string" ? option.label : ""))
				.filter((label) => label.length > 0);
			return new Text(
				theme.fg("toolTitle", theme.bold("ask_user_choice ")) +
				theme.fg("muted", typeof args.question === "string" ? args.question : "") +
				(labels.length > 0 ? theme.fg("dim", ` (${labels.join(", ")})`) : ""),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as ChoiceDetails | undefined;
			if (details?.selection) {
				return new Text(theme.fg("success", `✓ ${details.selection.index}. ${details.selection.label}`), 0, 0);
			}
			return new Text(theme.fg("warning", "Cancelled"), 0, 0);
		},
	});

	pi.on("before_agent_start", (_event, ctx) => {
		reconcileToolAvailability(pi, ctx.mode === "tui");
	});
}
