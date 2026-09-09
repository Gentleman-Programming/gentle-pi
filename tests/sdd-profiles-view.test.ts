import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ALL_KNOWN_AGENTS, SDD_AGENT_CATEGORIES, type Profile, type ProfileSummary } from "../lib/sdd-profiles-catalog.ts";
import type { SddProfileManager } from "../lib/sdd-profiles-manager.ts";
import {
	ASSIGN_ALL_EFFORT_KEY,
	ASSIGN_ALL_SUBAGENTS_KEY,
	ASSIGN_CATEGORY_KEY,
	ROLE,
	SddProfilesView,
} from "../lib/sdd-profiles-view.ts";
import installGentleSddProfile, { GENTLE_SDD_PROFILE_COMMAND } from "../extensions/gentle-sdd-profile.ts";

const theme = { fg: (_role: string, text: string) => text };

const summaries: ProfileSummary[] = [
	{ name: "gentle-default", description: "Balanced", default_model: "m/a", agent_count: 2, scope: "builtin", is_active: true },
	{ name: "gentle-economy", agent_count: 1, scope: "global", is_active: false, path: "/tmp/speed.json" },
];

const profiles: Record<string, Profile> = {
	"gentle-default": {
		name: "gentle-default",
		default_model: "anthropic/claude-sonnet-5",
		default_effort: "medium",
		model_profiles: {
			"sdd-explore": { model: "openai/gpt-5-mini", effort: "low" },
			"sdd-verify": { model: "openai/gpt-5-mini" },
		},
	},
	"gentle-economy": {
		name: "gentle-economy",
		model_profiles: { "sdd-explore": { model: "openai/gpt-5-mini", effort: "low" } },
	},
};

const MODELS = ["openai/gpt-5-mini", "anthropic/claude-sonnet-5"];

interface FakeState {
	saved: Profile[];
	renamed: Array<[string, string]>;
	deleted: string[];
	activated: string[];
}

function makeFakeManager(state: FakeState, live: Record<string, Profile> = profiles) {
	return {
		listProfiles: () => summaries,
		loadProfile: (name: string) => (live[name] ? JSON.parse(JSON.stringify(live[name])) : null),
		saveProfile: (profile: Profile) => {
			state.saved.push(JSON.parse(JSON.stringify(profile)));
			return `/tmp/${profile.name}.json`;
		},
		renameProfile: (oldName: string, newName: string) => {
			state.renamed.push([oldName, newName]);
			return { success: true, message: `Renamed "${oldName}" to "${newName}".` };
		},
		deleteProfile: (name: string) => {
			state.deleted.push(name);
			return true;
		},
		getActiveProfileName: () => "gentle-default",
		sanitizeName: (name: string) => name.trim().toLowerCase(),
	} as unknown as SddProfileManager;
}

function newState(): FakeState {
	return { saved: [], renamed: [], deleted: [], activated: [] };
}

function makeView(onClose: () => void = () => {}) {
	const manager = {
		listProfiles: () => summaries,
		loadProfile: (name: string) => profiles[name] ?? null,
	} as unknown as SddProfileManager;
	return new SddProfilesView({ manager, theme, rows: 16, onClose, requestRender: () => {} });
}

function makeFullView(state: FakeState, opts: { activated?: (p: Profile) => void; closed?: () => void } = {}) {
	return new SddProfilesView({
		manager: makeFakeManager(state),
		availableModels: MODELS,
		theme,
		rows: 16,
		onProfileActivated: opts.activated ?? ((p) => void state.activated.push(p.name)),
		onClose: opts.closed ?? (() => {}),
		requestRender: () => {},
	});
}

function type(view: SddProfilesView, value: string): void {
	for (const ch of value) view.handleInput(ch);
}

function text(view: SddProfilesView): string {
	return view.render(80).join("\n");
}

describe("SddProfilesView PART 1", () => {
	it("list shows profile names with the active marker", () => {
		const out = text(makeView());
		assert.match(out, /gentle-default/);
		assert.match(out, /gentle-economy/);
		assert.match(out, /❀.*gentle-default|gentle-default.*❀/);
		assert.match(out, /ACTIVE/);
	});

	it("enter opens read-only agent-by-agent detail", () => {
		const view = makeView();
		view.handleInput("\r");
		const out = text(view);
		assert.match(out, /sdd-explore: openai\/gpt-5-mini/);
		assert.match(out, /sdd-verify: openai\/gpt-5-mini/);
		assert.match(out, /Orchestrator:.*anthropic\/claude-sonnet-5/);
	});

	it("j/k moves selection and esc closes detail then the view", () => {
		let closed = false;
		const view = makeView(() => { closed = true; });
		view.handleInput("j");
		view.handleInput("\r");
		assert.match(text(view), /gentle-economy/);
		assert.match(text(view), /sdd-explore/);
		view.handleInput("\x1b");
		assert.equal(closed, false);
		assert.match(text(view), /gentle-default/);
		view.handleInput("\x1b");
		assert.equal(closed, true);
	});

	it("a activates and calls back with the profile name", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("a");
		assert.deepEqual(state.activated, ["gentle-default"]);
	});

	it("editor stages a per-agent model/effort and saves it", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("e");
		assert.match(text(view), /editing: gentle-default/);
		view.handleInput("j");
		view.handleInput("\r");
		assert.match(text(view), /Model for:/);
		view.handleInput("\x1b[B");
		view.handleInput("\r");
		assert.match(text(view), /Reasoning effort/);
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("\r");
		assert.match(text(view), /modified/);
		view.handleInput("s");
		assert.equal(state.saved.length, 1);
		const agent = ALL_KNOWN_AGENTS[0];
		assert.equal(state.saved[0].model_profiles[agent]?.model, MODELS[1]);
		assert.equal(state.saved[0].model_profiles[agent]?.effort, "low");
	});

	it("model-picker live filter narrows items", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("e");
		view.handleInput("\r");
		assert.match(text(view), /openai\/gpt-5-mini/);
		type(view, "sonnet");
		const out = text(view);
		assert.match(out, /anthropic\/claude-sonnet-5/);
		assert.doesNotMatch(out, /openai\/gpt-5-mini/);
		assert.equal(out.includes("\x1b"), false);
	});

	it("create wizard produces a saved profile via the manager", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("n");
		assert.match(text(view), /Step 1/);
		type(view, "my-prof");
		view.handleInput("\r");
		assert.match(text(view), /Step 2/);
		type(view, "fresh purpose");
		view.handleInput("\r");
		assert.equal(state.saved.length, 1);
		assert.equal(state.saved[0].name, "my-prof");
		assert.equal(state.saved[0].description, "fresh purpose");
		assert.match(text(view), /Created/);
	});

	it("modal with hasUI=false falls back to list text", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-profiles-modal-"));
		const cwd = path.join(root, "work");
		const globalDir = path.join(root, "global-profiles");
		fs.mkdirSync(cwd, { recursive: true });
		const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<any> }>();
		const pi: any = {
			registerCommand: (name: string, reg: any) => void commands.set(name, reg),
			registerShortcut: () => {},
			registerTool: () => {},
			on: () => {},
		};
		(installGentleSddProfile as (pi: unknown, env?: unknown) => void)(pi, {});
		const handler = commands.get(GENTLE_SDD_PROFILE_COMMAND)!.handler;
		const ctx: any = {
			cwd,
			globalDir,
			hasUI: false,
			sessionManager: { getCwd: () => cwd },
			ui: { notify: () => {} },
		};
		const out = (await handler("modal", ctx)) as string;
		assert.match(out, /gentle-default/);
		assert.match(out, /gentle-economy/);
	});

	it("editor renders two-pane with agent rows left and detail right", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("e");
		const out = text(view);
		assert.match(out, /editing: gentle-default/);
		assert.match(out, /│/);
		assert.match(out, /orchestrator \(default\)/);
		assert.match(out, /Model:/);
		assert.match(out, /Effort:/);
		assert.match(out, /anthropic\/claude-sonnet-5/);
		assert.doesNotMatch(out, /Row:/);
	});

	it("paints only through known theme roles (recording theme)", () => {
		const seen = new Set<string>();
		const recording = { fg: (role: string, text: string) => { seen.add(role); return text; } };
		const manager = {
			listProfiles: () => summaries,
			loadProfile: (name: string) => profiles[name] ?? null,
		} as unknown as SddProfileManager;
		const view = new SddProfilesView({ manager, theme: recording, rows: 16, onClose: () => {}, requestRender: () => {} });
		const known = new Set(Object.values(ROLE));
		const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		const check = (label: string) => {
			seen.clear();
			const out = view.render(80).map(strip).join("\n");
			for (const role of seen) assert.ok(known.has(role), `${label}: unknown theme role "${role}"`);
			assert.ok(seen.size > 0, `${label}: expected at least one themed role`);
			return out;
		};
		assert.match(check("list"), /gentle-default/);
		view.handleInput("\r");
		assert.match(check("detail"), /sdd-explore/);
		view.handleInput("\x1b");
		view.handleInput("e");
		assert.match(check("editor"), /orchestrator \(default\)/);
	});

	it("passthrough theme renders list and detail content", () => {
		// No zero-escape assertion here: truncateToWidth appends reset codes
		// when it clips a line, so passthrough output can legally contain
		// escapes. Content is the contract under test.
		const view = makeView();
		assert.match(text(view), /gentle-default/);
		view.handleInput("\r");
		assert.match(text(view), /sdd-explore/);
	});

	it("every rendered line strictly matches target width across views", () => {
		const state = newState();
		const view = makeFullView(state);
		const targetWidth = 80;

		const checkWidths = (label: string) => {
			const lines = view.render(targetWidth);
			for (let i = 0; i < lines.length; i++) {
				// Visible width, not raw length: fit() keeps trailing resets
				// (agents-view parity), so raw length includes escapes.
				assert.equal(
					visibleWidth(lines[i] ?? ""),
					targetWidth,
					`${label}: line ${i} width ${visibleWidth(lines[i] ?? "")} !== ${targetWidth}`,
				);
			}
		};

		checkWidths("list view");
		view.handleInput("\r");
		checkWidths("detail view");
		view.handleInput("\x1b");
		view.handleInput("e");
		checkWidths("editor view");
	});

	it("bulk model-assign stages the model for every agent", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("e");
		for (let i = 0; i < ALL_KNOWN_AGENTS.length + 1; i++) view.handleInput("j");
		assert.match(text(view), new RegExp(ASSIGN_ALL_SUBAGENTS_KEY));
		view.handleInput("\r");
		assert.match(text(view), /ALL agents/);
		view.handleInput("\x1b[B");
		view.handleInput("\r");
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("\r");
		assert.match(text(view), /modified/);
		view.handleInput("s");
		assert.equal(state.saved.length, 1);
		for (const agent of ALL_KNOWN_AGENTS) {
			assert.equal(state.saved[0].model_profiles[agent]?.model, MODELS[1]);
			assert.equal(state.saved[0].model_profiles[agent]?.effort, "low");
		}
	});

	it("bulk effort-assign stages the effort for every agent", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("e");
		for (let i = 0; i < ALL_KNOWN_AGENTS.length + 2; i++) view.handleInput("j");
		assert.match(text(view), new RegExp(ASSIGN_ALL_EFFORT_KEY));
		view.handleInput("\r");
		assert.match(text(view), /Reasoning effort/);
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("\r");
		view.handleInput("s");
		assert.equal(state.saved.length, 1);
		for (const agent of ALL_KNOWN_AGENTS) {
			assert.equal(state.saved[0].model_profiles[agent]?.effort, "low");
		}
		assert.equal(state.saved[0].model_profiles["sdd-explore"]?.model, "openai/gpt-5-mini");
	});

	it("category pick applies only to category members", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("e");
		for (let i = 0; i < ALL_KNOWN_AGENTS.length + 3; i++) view.handleInput("j");
		assert.match(text(view), new RegExp(ASSIGN_CATEGORY_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		view.handleInput("\r");
		assert.match(text(view), new RegExp(SDD_AGENT_CATEGORIES[0].name));
		view.handleInput("\r");
		assert.match(text(view), new RegExp(`category \\[${SDD_AGENT_CATEGORIES[0].id}\\]`));
		view.handleInput("\x1b[B");
		view.handleInput("\r");
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("j");
		view.handleInput("\r");
		view.handleInput("s");
		assert.equal(state.saved.length, 1);
		for (const agent of SDD_AGENT_CATEGORIES[0].agents) {
			assert.equal(state.saved[0].model_profiles[agent]?.model, MODELS[1]);
			assert.equal(state.saved[0].model_profiles[agent]?.effort, "low");
		}
		const outsider = SDD_AGENT_CATEGORIES[1].agents[0];
		assert.equal(state.saved[0].model_profiles[outsider], undefined);
	});
});

describe("SddProfilesView current-model marker and delete guardrail", () => {
	it("model picker marks the currently assigned model", () => {
		const view = makeFullView(newState());
		view.handleInput("e");
		view.handleInput("\r");
		const out = text(view);
		assert.match(out, /model picker/);
		assert.match(out, /anthropic\/claude-sonnet-5.*● current/);
	});

	it("d on the active profile refuses with feedback and deletes nothing", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("d");
		const out = text(view);
		assert.match(out, /Cannot delete active profile/);
		assert.equal(state.deleted.length, 0);
	});

	it("d on an inactive profile opens confirm and y deletes it", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("j");
		view.handleInput("d");
		assert.match(text(view), /confirm delete/);
		view.handleInput("y");
		assert.deepEqual(state.deleted, ["gentle-economy"]);
		assert.match(text(view), /Deleted "gentle-economy"/);
	});

	it("d on the active profile from detail view refuses too", () => {
		const state = newState();
		const view = makeFullView(state);
		view.handleInput("\r");
		view.handleInput("d");
		assert.match(text(view), /Cannot delete active profile/);
		assert.equal(state.deleted.length, 0);
	});
});
