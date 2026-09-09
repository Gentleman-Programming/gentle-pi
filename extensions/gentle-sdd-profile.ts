import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Profile, ProfileSummary } from "../lib/sdd-profiles-catalog.ts";
import { resolveAvailableModels, SddProfileManager } from "../lib/sdd-profiles-manager.ts";
import { SddProfilesView } from "../lib/sdd-profiles-view.ts";

export const GENTLE_SDD_PROFILE_COMMAND = "gentle-sdd-profile";
export const SDD_PROFILE_TOOL_LIST = "sdd_profile_list";
export const SDD_PROFILE_TOOL_USE = "sdd_profile_use";
export const SDD_PROFILE_TOOL_RENAME = "sdd_profile_rename";
export const SDD_PROFILE_TOOL_DELETE = "sdd_profile_delete";
export const GENTLE_SDD_PROFILE_LIST_COMMAND = "gentle-sdd-profile-list";
export const GENTLE_SDD_PROFILE_SAVE_COMMAND = "gentle-sdd-profile-save";
export const GENTLE_SDD_PROFILE_RENAME_COMMAND = "gentle-sdd-profile-rename";
export const GENTLE_SDD_PROFILE_DELETE_COMMAND = "gentle-sdd-profile-delete";

const SDD_PROFILE_SHORTCUT_DEFAULT_DARWIN = "ctrl+shift+m";
const SDD_PROFILE_SHORTCUT_DEFAULT = "alt+m";

export function sddProfileShortcut(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	const value = env.GENTLE_PI_SDD_PROFILES_KEY?.trim();
	if (value === undefined) {
		return platform === "darwin" ? SDD_PROFILE_SHORTCUT_DEFAULT_DARWIN : SDD_PROFILE_SHORTCUT_DEFAULT;
	}
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

const USAGE =
	"Usage: /gentle-sdd-profile list | show <name> | use <name> [--project|--global] | save <name> [description] [--project|--global] | create <name> [default_model] [effort] [--project] | set <profile> <agent> <model> [effort] | rename <old> <new> | delete <name>";

function getManager(ctx?: ExtensionContext): SddProfileManager {
	const cwd =
		ctx?.sessionManager?.getCwd?.() ?? (ctx as { cwd?: string })?.cwd ?? process.cwd();
	const extra = ctx as unknown as {
		globalDir?: string;
		activeStatePath?: string;
		globalSubagentsPath?: string;
	};
	return new SddProfileManager({
		globalDir: extra?.globalDir,
		projectDir: join(cwd, ".pi", "profiles"),
		projectSubagentsPath: join(cwd, ".pi", "subagents.json"),
		activeStatePath: extra?.activeStatePath,
		globalSubagentsPath: extra?.globalSubagentsPath,
	});
}

function formatProfileList(profiles: ProfileSummary[], activeName: string | null): string {
	if (profiles.length === 0) {
		return "No profiles. Save one: /gentle-sdd-profile save <name>.";
	}
	const lines = ["SDD profiles:"];
	for (const p of profiles) {
		const isActive = Boolean(
			activeName && p.name.toLowerCase() === activeName.toLowerCase(),
		);
		const marker = isActive ? "*" : " ";
		const detail = p.default_model ? `default ${p.default_model}` : `${p.agent_count} agents`;
		const desc = p.description ? ` - ${p.description}` : "";
		lines.push(`${marker} ${p.name} [${p.scope}] (${detail})${desc}`);
	}
	return lines.join("\n");
}

function notify(
	ctx: ExtensionContext,
	message: string,
	level: "info" | "warning" | "error",
): string {
	ctx.ui?.notify?.(message, level);
	return message;
}

function listProfilesText(ctx: ExtensionContext): string {
	const manager = getManager(ctx);
	return formatProfileList(manager.listProfiles(), manager.getActiveProfileName());
}

function formatProfileDetail(profile: Profile, isActive: boolean): string {
	const lines = [
		`Profile: ${profile.name}${isActive ? " (active)" : ""}`,
		`Description: ${profile.description ?? "None"}`,
		`Default model: ${profile.default_model ?? "None"}`,
		`Default effort: ${profile.default_effort ?? "None"}`,
		`Updated: ${profile.updated_at ?? "N/A"}`,
		"Agents:",
	];
	const entries = Object.entries(profile.model_profiles ?? {});
	if (entries.length === 0) {
		lines.push("  (none, inherits default)");
	} else {
		for (const [agent, cfg] of entries) {
			const effort = cfg.effort ? ` [effort: ${cfg.effort}]` : "";
			lines.push(`  - ${agent}: ${cfg.model}${effort}`);
		}
	}
	return lines.join("\n");
}

async function availableModels(ctx: ExtensionContext): Promise<string[]> {
	const found = new Set<string>();
	const registry = ctx.modelRegistry as unknown as { list?: () => Array<{ provider?: string; id?: string; name?: string }> } | undefined;
	try {
		const models = registry?.list?.() ?? [];
		for (const m of models) {
			const name = m.provider && m.id ? `${m.provider}/${m.id}` : m.name;
			if (typeof name === "string" && name.length > 0) found.add(name);
		}
	} catch {
		// Fall through to resolveAvailableModels.
	}
	for (const m of await resolveAvailableModels(ctx)) found.add(m);
	return [...found];
}

const OVERLAY_WIDTH = "92%";
const OVERLAY_HEIGHT_RATIO = 0.8;
const OVERLAY_MIN_ROWS = 10;

// Modal overlay for /gentle-sdd-profile and its shortcut. Headless (no UI)
// falls back to the plain list text.
async function openProfilesModal(ctx: ExtensionContext): Promise<string | null> {
	const manager = getManager(ctx);
	if (!ctx.hasUI || typeof ctx.ui?.custom !== "function") {
		return formatProfileList(manager.listProfiles(), manager.getActiveProfileName());
	}
	const models = await availableModels(ctx);
	await ctx.ui.custom<null>(
		(tui, theme, _keybindings, done) => {
			const view = new SddProfilesView({
				manager,
				availableModels: models,
				theme: theme as unknown as { fg: (color: string, text: string) => string },
				rows: () => Math.max(OVERLAY_MIN_ROWS, Math.floor(tui.terminal.rows * OVERLAY_HEIGHT_RATIO)),
				onProfileActivated: (profile) => {
					const res = manager.activateProfile(profile.name, "global");
					ctx.ui?.notify?.(res.message, res.success ? "info" : "error");
					done(null);
				},
				onClose: () => done(null),
				requestRender: () => tui.requestRender(),
			});
			return view;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: OVERLAY_WIDTH,
			},
		},
	);
	return null;
}

async function syncActiveProfile(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const manager = getManager(ctx);
	const activeName = manager.getActiveProfileName();
	if (!activeName) return;
	const profile = manager.loadProfile(activeName);
	if (!profile) return;
	// PR8: footer segment. lib/ has no setStatus implementation (only a
	// mention in agents-protocol.ts), so session_start skips the status
	// indicator instead of inventing a footer widget.
	const session = pi as unknown as {
		setModel?: (model: unknown) => Promise<unknown>;
		setThinkingLevel?: (level: unknown) => void;
	};
	if (profile.default_model && typeof session.setModel === "function") {
		const slash = profile.default_model.indexOf("/");
		if (slash > 0) {
			try {
				const model = ctx.modelRegistry?.find?.(
					profile.default_model.slice(0, slash),
					profile.default_model.slice(slash + 1),
				);
				if (model) await session.setModel(model);
			} catch {
				// Best-effort sync: never break session start.
			}
		}
	}
	if (profile.default_effort && typeof session.setThinkingLevel === "function") {
		try {
			session.setThinkingLevel(profile.default_effort);
		} catch {
			// Best-effort sync: never break session start.
		}
	}
}

export default function gentleSddProfile(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
	pi.registerCommand(GENTLE_SDD_PROFILE_COMMAND, {
		description: "Manage SDD model profiles for subagents.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const manager = getManager(ctx);
			const trimmed = (args || "").trim();
			if (!trimmed) return openProfilesModal(ctx);

			const parts = trimmed.split(/\s+/);
			const sub = parts[0].toLowerCase();
			const scope = parts.includes("--project") ? "project" : "global";

			if (sub === "modal") return openProfilesModal(ctx);

			switch (sub) {
				case "list": {
					const profiles = manager.listProfiles();
					return formatProfileList(profiles, manager.getActiveProfileName());
				}

				case "use": {
					const name = parts[1];
					if (!name || name.startsWith("--")) {
						return notify(
							ctx,
							"Usage: /gentle-sdd-profile use <name> [--project|--global]",
							"warning",
						);
					}
					const result = manager.activateProfile(name, scope);
					return notify(ctx, result.message, result.success ? "info" : "error");
				}

				case "show": {
					const name = parts[1];
					if (!name || name.startsWith("--")) {
						return notify(ctx, "Usage: /gentle-sdd-profile show <name>", "warning");
					}
					const profile = manager.loadProfile(name);
					if (!profile) return notify(ctx, `Profile "${name}" not found.`, "error");
					const active = manager.getActiveProfileName();
					const isActive = Boolean(active && active.toLowerCase() === name.toLowerCase());
					return formatProfileDetail(profile, isActive);
				}

				case "save": {
					const name = parts[1];
					if (!name || name.startsWith("--")) {
						return notify(
							ctx,
							"Usage: /gentle-sdd-profile save <name> [description] [--project|--global]",
							"warning",
						);
					}
					const words = parts.slice(2).filter((w) => w !== "--project" && w !== "--global");
					const description = words.length > 0 ? words.join(" ") : undefined;
					const result = manager.saveCurrentAsProfile(name, description, scope);
					return notify(ctx, result.message, result.success ? "info" : "error");
				}

				case "create": {
					const name = parts[1];
					if (!name || name.startsWith("--")) {
						return notify(
							ctx,
							"Usage: /gentle-sdd-profile create <name> [default_model] [effort] [--project]",
							"warning",
						);
					}
					const rawModel = parts[2];
					const rawEffort = parts[3];
					const result = manager.createProfile({
						name,
						default_model: rawModel && rawModel !== "--project" ? rawModel : undefined,
						default_effort: rawEffort && rawEffort !== "--project" ? (rawEffort as never) : undefined,
						scope,
					});
					return notify(ctx, result.message, result.success ? "info" : "error");
				}

				case "set": {
					const profileName = parts[1];
					const agentName = parts[2];
					const model = parts[3];
					const effort = parts[4];
					if (!profileName || !agentName || !model) {
						return notify(ctx, "Usage: /gentle-sdd-profile set <profile> <agent> <model> [effort]", "warning");
					}
					const result = manager.setAgentInProfile({
						profileName,
						agentName,
						model,
						effort: effort as never,
					});
					return notify(ctx, result.message, result.success ? "info" : "error");
				}

				case "rename": {
					const oldName = parts[1];
					const newName = parts[2];
					if (!oldName || !newName) {
						return notify(
							ctx,
							"Usage: /gentle-sdd-profile rename <old> <new>",
							"warning",
						);
					}
					const res = manager.renameProfile(oldName, newName);
					return notify(ctx, res.message, res.success ? "info" : "warning");
				}

				case "delete": {
					const name = parts[1];
					if (!name) {
						return notify(ctx, "Usage: /gentle-sdd-profile delete <name>", "warning");
					}
					if (!manager.loadProfile(name)) {
						return notify(ctx, `Profile "${name}" not found.`, "warning");
					}
					const active = manager.getActiveProfileName();
					if (active && manager.sanitizeName(active) === manager.sanitizeName(name)) {
						return notify(
							ctx,
							`Cannot delete active profile "${name}". Activate another profile first.`,
							"warning",
						);
					}
					const deleted = manager.deleteProfile(name);
					return notify(
						ctx,
						deleted ? `Deleted profile "${name}".` : `Could not delete profile "${name}".`,
						deleted ? "info" : "warning",
					);
				}

				default: {
					if (!manager.loadProfile(parts[0])) return notify(ctx, USAGE, "warning");
					const result = manager.activateProfile(parts[0], scope);
					return notify(ctx, result.message, result.success ? "info" : "error");
				}
			}
		},
	});

	const shortcut = sddProfileShortcut(env);
	if (shortcut) {
		pi.registerShortcut(shortcut as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Show SDD model profiles",
			handler: async (ctx) => openProfilesModal(ctx),
		});
	}

	pi.on("session_start", (_event, ctx) => {
		void syncActiveProfile(pi, ctx);
	});

	pi.registerTool({
		name: SDD_PROFILE_TOOL_LIST,
		label: "List SDD profiles",
		description: "List available SDD model profiles and which one is active.",
		parameters: { type: "object", properties: {}, additionalProperties: false } as never,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);
			const profiles = manager.listProfiles();
			const active_profile = manager.getActiveProfileName();
			const text = JSON.stringify({ active_profile, profiles }, null, 2);
			return { content: [{ type: "text", text }], details: { active_profile, profiles } };
		},
	});

	pi.registerTool({
		name: SDD_PROFILE_TOOL_USE,
		label: "Use SDD profile",
		description: "Activate an SDD model profile by name, in the global or project scope.",
		parameters: {
			type: "object",
			required: ["profile_name"],
			additionalProperties: false,
			properties: {
				profile_name: { type: "string", description: "Profile name to activate." },
				scope: { type: "string", enum: ["global", "project"], description: "Where to record the active profile." },
			},
		} as never,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as { profile_name?: unknown; scope?: unknown };
			const manager = getManager(ctx);
			const scope = args.scope === "project" ? "project" : "global";
			const result = manager.activateProfile(String(args.profile_name ?? ""), scope);
			if (!result.success) throw new Error(result.message);
			const active_profile = manager.getActiveProfileName();
			const text = JSON.stringify({ success: true, message: result.message, active_profile }, null, 2);
			return { content: [{ type: "text", text }], details: { success: true, message: result.message, active_profile } };
		},
	});

	pi.registerCommand(GENTLE_SDD_PROFILE_LIST_COMMAND, {
		description: "List SDD model profiles.",
		handler: async (_args: string, ctx: ExtensionContext) => listProfilesText(ctx),
	});

	pi.registerCommand(GENTLE_SDD_PROFILE_SAVE_COMMAND, {
		description: "Save current subagents config as a profile.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const manager = getManager(ctx);
			const trimmed = (args || "").trim();
			if (!trimmed) return notify(ctx, "Usage: /gentle-sdd-profile-save <name> [description]", "warning");
			const [name, ...rest] = trimmed.split(/\s+/);
			const res = manager.saveCurrentAsProfile(name, rest.join(" ") || undefined, "global");
			return notify(ctx, res.message, res.success ? "info" : "error");
		},
	});

	pi.registerCommand(GENTLE_SDD_PROFILE_RENAME_COMMAND, {
		description: "Rename an SDD model profile.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const manager = getManager(ctx);
			const parts = (args || "").trim().split(/\s+/);
			if (!parts[0] || !parts[1]) return notify(ctx, "Usage: /gentle-sdd-profile-rename <old> <new>", "warning");
			const res = manager.renameProfile(parts[0], parts[1]);
			return notify(ctx, res.message, res.success ? "info" : "warning");
		},
	});

	pi.registerCommand(GENTLE_SDD_PROFILE_DELETE_COMMAND, {
		description: "Delete an SDD model profile.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const manager = getManager(ctx);
			const target = (args || "").trim();
			if (!target) return notify(ctx, "Usage: /gentle-sdd-profile-delete <name>", "warning");
			if (!manager.loadProfile(target)) return notify(ctx, `Profile "${target}" not found.`, "warning");
			const active = manager.getActiveProfileName();
			if (active && manager.sanitizeName(active) === manager.sanitizeName(target)) {
				return notify(ctx, `Cannot delete active profile "${target}". Activate another profile first.`, "warning");
			}
			const deleted = manager.deleteProfile(target);
			return notify(ctx, deleted ? `Deleted profile "${target}".` : `Could not delete profile "${target}".`, deleted ? "info" : "warning");
		},
	});

	pi.registerTool({
		name: SDD_PROFILE_TOOL_RENAME,
		label: "Rename SDD profile",
		description: "Rename an existing SDD model profile.",
		parameters: {
			type: "object",
			required: ["old_name", "new_name"],
			additionalProperties: false,
			properties: {
				old_name: { type: "string", description: "Current profile name." },
				new_name: { type: "string", description: "New profile name." },
			},
		} as never,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as { old_name?: unknown; new_name?: unknown };
			const manager = getManager(ctx);
			const res = manager.renameProfile(String(args.old_name ?? ""), String(args.new_name ?? ""));
			const text = JSON.stringify(res, null, 2);
			return { content: [{ type: "text", text }], details: res };
		},
	});

	pi.registerTool({
		name: SDD_PROFILE_TOOL_DELETE,
		label: "Delete SDD profile",
		description: "Delete an existing SDD model profile. Refuses the active profile.",
		parameters: {
			type: "object",
			required: ["profile_name"],
			additionalProperties: false,
			properties: {
				profile_name: { type: "string", description: "Profile name to delete." },
			},
		} as never,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as { profile_name?: unknown };
			const manager = getManager(ctx);
			const name = String(args.profile_name ?? "");
			if (!manager.loadProfile(name)) {
				const res = { success: false, message: `Profile "${name}" not found.` };
				return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res };
			}
			const active = manager.getActiveProfileName();
			if (active && manager.sanitizeName(active) === manager.sanitizeName(name)) {
				const res = { success: false, message: `Cannot delete active profile "${name}". Activate another profile first.` };
				return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res };
			}
			const deleted = manager.deleteProfile(name);
			const res = { success: deleted, message: deleted ? `Deleted profile "${name}".` : `Could not delete profile "${name}".` };
			return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res };
		},
	});
}
