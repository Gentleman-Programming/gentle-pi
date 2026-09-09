import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
	ALL_KNOWN_AGENTS,
	SDD_AGENT_CATEGORIES,
	type Profile,
	type ProfileSummary,
	type ReasoningEffort,
} from "./sdd-profiles-catalog.ts";
import type { SddProfileManager } from "./sdd-profiles-manager.ts";

export interface SddProfilesTheme {
	fg(color: string, text: string): string;
}

export interface SddProfilesViewDeps {
	manager: SddProfileManager;
	availableModels?: string[];
	theme: SddProfilesTheme;
	rows?: number | (() => number);
	onProfileActivated?: (profile: Profile) => void;
	onClose(result?: { action: "activated" | "saved" | "closed"; profileName?: string }): void;
	requestRender(): void;
}

export type ModalView =
	| "profiles-list"
	| "create-profile"
	| "rename-profile"
	| "confirm-delete"
	| "profile-editor"
	| "model-picker"
	| "effort-picker"
	| "category-picker";

export const ORCHESTRATOR_ROW = "orchestrator (default)";
export const ASSIGN_ALL_SUBAGENTS_KEY = "assign model to ALL";
export const ASSIGN_ALL_EFFORT_KEY = "assign effort to ALL";
export const ASSIGN_CATEGORY_KEY = "assign by category...";

export const EFFORT_OPTIONS: Array<ReasoningEffort | "default"> = [
	"default",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

// Role table copied from lib/agents-view.ts (FRAME/TITLE/SELECTED/NAME/META/
// TEXT/KEY); ACTIVE added for the active-profile marker. All painting goes
// through theme.fg — zero raw ANSI in this file.
export const ROLE = {
	FRAME: "border",
	TITLE: "customMessageLabel",
	SELECTED: "accent",
	NAME: "text",
	NAME_IDLE: "muted",
	MODEL: "syntaxFunction",
	META: "dim",
	TEXT: "text",
	KEY: "accent",
	KEY_TEXT: "dim",
	EMPTY: "dim",
	ACTIVE: "success",
	ERROR: "error",
} as const;

function rule(length: number): string {
	return "─".repeat(Math.max(0, length));
}

// Shared two-pane join: left + right columns joined with a │ splitter.
// Mirrors the list-shell pattern so the editor reuses the exact layout.
function fit(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

// Two-pane profiles shell: profile list on the left, a read-only detail pane
// on the right. Enter focuses a full agent-by-agent detail view; esc goes
// back (or closes the overlay when already on the list). `a` activates the
// selected profile via onProfileActivated; `e` opens the per-agent editor,
// `n`/`r`/`d` run the create/rename/delete wizards.
export class SddProfilesView implements Component {
	private readonly manager: SddProfileManager;
	private readonly availableModels: string[];
	private readonly theme: SddProfilesTheme;
	private readonly rows: () => number;
	private readonly onClose: NonNullable<SddProfilesViewDeps["onClose"]>;
	private readonly requestRender: () => void;
	private readonly onProfileActivated?: (profile: Profile) => void;

	private view: ModalView = "profiles-list";
	private detailOpen = false;
	private profiles: ProfileSummary[] = [];
	private selectedIndex = 0;
	private scrollOffset = 0;
	private feedback: string | null = null;

	// Create / rename / delete wizard state.
	private textInput = "";
	private creationStep: "name" | "description" = "name";
	private pendingName = "";
	private descriptionInput = "";
	private renamingOldName = "";
	private deletingName = "";
	private error: string | null = null;

	// Editor state: staged copy, saved explicitly with `s`.
	private editing: Profile | null = null;
	private editorIndex = 0;
	private editorScroll = 0;
	private dirty = false;

	// Picker state: model-picker feeds stagedModel into effort-picker.
	private pickerItems: string[] = [];
	private pickerIndex = 0;
	private pickerScroll = 0;
	private pickerTarget: "default-model" | "agent-model" | "all-models" | "category-models" = "agent-model";
	private targetCategory?: string;
	private stagedModel?: string;
	private modelFilter = "";

	constructor(deps: SddProfilesViewDeps) {
		this.manager = deps.manager;
		this.availableModels = deps.availableModels ?? [];
		this.theme = deps.theme;
		this.rows = typeof deps.rows === "function" ? deps.rows : () => Math.max(12, deps.rows ?? 16);
		this.onClose = deps.onClose;
		this.requestRender = deps.requestRender;
		this.onProfileActivated = deps.onProfileActivated;
		this.refreshProfiles();
	}

	invalidate(): void {}

	private editorRows(): string[] {
		// Bulk rows sit after the agents so per-agent j/k navigation is stable.
		return [ORCHESTRATOR_ROW, ...ALL_KNOWN_AGENTS, ASSIGN_ALL_SUBAGENTS_KEY, ASSIGN_ALL_EFFORT_KEY, ASSIGN_CATEGORY_KEY];
	}

	private isBulkRow(row: string): boolean {
		return row === ASSIGN_ALL_SUBAGENTS_KEY || row === ASSIGN_ALL_EFFORT_KEY || row === ASSIGN_CATEGORY_KEY;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(40, Math.floor(width || 80));
		const inner = safeWidth - 2;
		const bodyRows = Math.max(8, this.rows() - 3);
		const theme = this.theme;

		if (this.view !== "profiles-list") return this.renderModal(inner, bodyRows);
		if (this.detailOpen) return this.renderDetail(safeWidth, inner, bodyRows);

		const listWidth = Math.max(20, Math.min(30, Math.floor(inner * 0.35)));
		const rightWidth = Math.max(10, inner - listWidth - 4);
		const active = this.profiles.find((p) => p.is_active)?.name ?? "none";
		const titleText = `✿ Profiles · active: ${active} · ${this.profiles.length} profiles`;
		const top = this.topBar(titleText, inner);
		const leftLines = this.renderListPane(listWidth, bodyRows);
		const rightLines = this.renderSummaryPane(rightWidth, bodyRows);
		const body = this.joinTwoPane(leftLines, rightLines, listWidth, rightWidth, bodyRows);
		const keys: Array<[string, string]> = [
			["j/k", "navigate"],
			["enter", "details"],
			["a", "activate"],
			["e", "edit"],
			["n/r/d", "new/rename/delete"],
			["esc", "close"],
		];
		const formatted = keys.map(([key, label]) => `${theme.fg(ROLE.KEY, key)} ${theme.fg(ROLE.KEY_TEXT, label)}`).join("   ");
		return [top, ...body, `${theme.fg(ROLE.FRAME, "│")} ${fit(formatted, inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`, theme.fg(ROLE.FRAME, `╰${rule(inner)}╯`)];
	}

	handleInput(data: string): void {
		switch (this.view) {
			case "profile-editor":
				this.handleEditorInput(data);
				break;
			case "model-picker":
				this.handleModelPickerInput(data);
				break;
			case "effort-picker":
				this.handleEffortPickerInput(data);
				break;
		case "category-picker":
			this.handleCategoryPickerInput(data);
			break;
			case "create-profile":
			case "rename-profile":
				this.handleTextInput(data);
				break;
			case "confirm-delete":
				this.handleConfirmDeleteInput(data);
				break;
			default:
				this.handleListInput(data);
		}
		this.requestRender();
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			if (this.detailOpen) this.detailOpen = false;
			else this.onClose({ action: "closed" });
			return;
		}
		if (this.detailOpen) {
			if (data === "a" || data === "A") this.activateSelected();
			else if (data === "d" || data === "D") {
				const selected = this.profiles[this.selectedIndex];
				if (!selected) return;
				this.detailOpen = false;
				if (selected.is_active) {
					this.feedback = `Cannot delete active profile "${selected.name}". Activate another first.`;
					return;
				}
				this.deletingName = selected.name;
				this.view = "confirm-delete";
			}
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			if (this.selectedIndex > 0) this.selectedIndex -= 1;
		} else if (matchesKey(data, Key.down) || data === "j") {
			if (this.selectedIndex < this.profiles.length - 1) this.selectedIndex += 1;
		} else if (matchesKey(data, Key.enter)) {
			if (this.profiles[this.selectedIndex]) this.detailOpen = true;
		} else if (data === "a" || data === "A") {
			this.activateSelected();
		} else if (data === "e" || data === "E") {
			this.openEditor();
		} else if (data === "n" || data === "N") {
			this.textInput = "";
			this.descriptionInput = "";
			this.creationStep = "name";
			this.pendingName = "";
			this.error = null;
			this.view = "create-profile";
		} else if (data === "r" || data === "R") {
			const selected = this.profiles[this.selectedIndex];
			if (selected) {
				this.renamingOldName = selected.name;
				this.textInput = selected.name;
				this.error = null;
				this.view = "rename-profile";
			}
		} else if (data === "d" || data === "D") {
			const selected = this.profiles[this.selectedIndex];
			if (!selected) return;
			if (selected.is_active) {
				this.feedback = `Cannot delete active profile "${selected.name}". Activate another first.`;
				return;
			}
			this.deletingName = selected.name;
			this.view = "confirm-delete";
		}
	}

	private activateSelected(): void {
		const selected = this.profiles[this.selectedIndex];
		if (!selected) return;
		const full = this.manager.loadProfile(selected.name);
		if (!full) {
			this.feedback = `Profile "${selected.name}" not found.`;
			return;
		}
		this.onProfileActivated?.(full);
	}

	private openEditor(): void {
		const selected = this.profiles[this.selectedIndex];
		if (!selected) return;
		const full = this.manager.loadProfile(selected.name);
		if (!full) return;
		this.editing = JSON.parse(JSON.stringify(full)) as Profile;
		this.editorIndex = 0;
		this.editorScroll = 0;
		this.dirty = false;
		this.view = "profile-editor";
	}

	private handleEditorInput(data: string): void {
		const rows = this.editorRows();
		if (matchesKey(data, Key.escape)) {
			this.refreshProfiles();
			this.view = "profiles-list";
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			if (this.editorIndex > 0) this.editorIndex -= 1;
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			if (this.editorIndex < rows.length - 1) this.editorIndex += 1;
			return;
		}
		if (data === "s" || data === "S") {
			if (this.editing) {
				this.manager.saveProfile(this.editing, "global");
				this.dirty = false;
				this.feedback = `Saved "${this.editing.name}".`;
				this.refreshProfiles();
				this.view = "profiles-list";
			}
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const row = rows[this.editorIndex];
			if (row === ORCHESTRATOR_ROW) {
				this.pickerTarget = "default-model";
			this.targetCategory = undefined;
			this.modelFilter = "";
				this.applyModelFilter();
				this.view = "model-picker";
			} else if (row === ASSIGN_ALL_SUBAGENTS_KEY) {
				this.pickerTarget = "all-models";
				this.targetCategory = undefined;
				this.modelFilter = "";
				this.applyModelFilter();
				this.view = "model-picker";
			} else if (row === ASSIGN_ALL_EFFORT_KEY) {
				this.pickerTarget = "all-models";
				this.targetCategory = undefined;
				this.stagedModel = undefined;
				this.pickerIndex = 0;
				this.pickerScroll = 0;
				this.view = "effort-picker";
			} else if (row === ASSIGN_CATEGORY_KEY) {
				this.pickerIndex = 0;
				this.pickerScroll = 0;
				this.view = "category-picker";
			} else {
				this.pickerTarget = "agent-model";
				this.targetCategory = undefined;
				this.modelFilter = "";
				this.applyModelFilter();
				this.view = "model-picker";
			}
		}
	}

	private applyModelFilter(): void {
		const tokens = this.modelFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
		this.pickerItems =
			tokens.length === 0
				? [...this.availableModels]
				: this.availableModels.filter((m) => {
						const lower = m.toLowerCase();
						return tokens.every((t) => lower.includes(t));
					});
		this.pickerIndex = 0;
		this.pickerScroll = 0;
	}

	private handleModelPickerInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.view = "profile-editor";
			return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.pickerIndex > 0) this.pickerIndex -= 1;
			return;
		}
		if (matchesKey(data, Key.down)) {
			if (this.pickerIndex < this.pickerItems.length - 1) this.pickerIndex += 1;
			return;
		}
		if (matchesKey(data, Key.backspace) || data === "" || data === "\b") {
			if (this.modelFilter.length > 0) {
				this.modelFilter = this.modelFilter.slice(0, -1);
				this.applyModelFilter();
			}
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const chosen = this.pickerItems[this.pickerIndex];
			if (!chosen) return;
			this.stagedModel = chosen;
			this.pickerIndex = 0;
			this.pickerScroll = 0;
			this.view = "effort-picker";
			return;
		}
		if (data.length === 1 && data >= " " && data <= "~") {
			this.modelFilter += data;
			this.applyModelFilter();
		}
	}

	private handleEffortPickerInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.view = "profile-editor";
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			if (this.pickerIndex > 0) this.pickerIndex -= 1;
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			if (this.pickerIndex < EFFORT_OPTIONS.length - 1) this.pickerIndex += 1;
			return;
		}
		if (!matchesKey(data, Key.enter)) return;
		const choice = EFFORT_OPTIONS[this.pickerIndex];
		const effort = choice === "default" ? undefined : choice;
		const profile = this.editing;
		if (profile) {
			if (this.pickerTarget === "default-model") {
				if (this.stagedModel) {
					profile.default_model = this.stagedModel;
					profile.default_effort = effort;
					this.dirty = true;
				}
			} else if (this.pickerTarget === "all-models") {
				for (const agent of ALL_KNOWN_AGENTS) {
					profile.model_profiles[agent] = {
						model: this.stagedModel ?? profile.model_profiles[agent]?.model ?? profile.default_model ?? "anthropic/claude-sonnet-4-5",
						effort,
					};
				}
				this.dirty = true;
			} else if (this.pickerTarget === "category-models" && this.targetCategory) {
				const cat = SDD_AGENT_CATEGORIES.find((c) => c.id === this.targetCategory);
			if (cat) {
					for (const agent of cat.agents) {
						profile.model_profiles[agent] = {
							model: this.stagedModel ?? profile.model_profiles[agent]?.model ?? profile.default_model ?? "anthropic/claude-sonnet-4-5",
							effort,
						};
					}
					this.dirty = true;
				}
			} else {
				const agent = this.editorRows()[this.editorIndex];
				if (agent && agent !== ORCHESTRATOR_ROW && !this.isBulkRow(agent) && this.stagedModel) {
					profile.model_profiles[agent] = { model: this.stagedModel, effort };
					this.dirty = true;
				}
			}
		}
		this.stagedModel = undefined;
		this.targetCategory = undefined;
		this.view = "profile-editor";
	}

	private handleCategoryPickerInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.view = "profile-editor";
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			if (this.pickerIndex > 0) this.pickerIndex -= 1;
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			if (this.pickerIndex < SDD_AGENT_CATEGORIES.length - 1) this.pickerIndex += 1;
			return;
		}
		if (!matchesKey(data, Key.enter)) return;
		const cat = SDD_AGENT_CATEGORIES[this.pickerIndex];
		if (!cat) return;
		this.pickerTarget = "category-models";
		this.targetCategory = cat.id;
		this.modelFilter = "";
		this.applyModelFilter();
		this.view = "model-picker";
	}

	private handleTextInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			if (this.view === "create-profile" && this.creationStep === "description") {
				this.creationStep = "name";
				this.error = null;
				return;
			}
			this.view = "profiles-list";
			return;
		}
		const editingDescription = this.view === "create-profile" && this.creationStep === "description";
		if (matchesKey(data, Key.backspace) || data === "" || data === "\b") {
			if (editingDescription) {
				if (this.descriptionInput.length > 0) this.descriptionInput = this.descriptionInput.slice(0, -1);
			} else if (this.textInput.length > 0) {
				this.textInput = this.textInput.slice(0, -1);
			}
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (this.view === "create-profile") {
				if (this.creationStep === "name") {
					const name = this.textInput.trim();
					if (!name) {
						this.error = "Name cannot be empty.";
						return;
					}
					if (this.manager.loadProfile(name)) {
						this.error = `Profile "${name}" already exists.`;
						return;
					}
					this.pendingName = name;
					this.creationStep = "description";
					this.descriptionInput = "";
					this.error = null;
					return;
				}
				this.manager.saveProfile(
					{ name: this.pendingName, description: this.descriptionInput.trim() || undefined, model_profiles: {} },
					"global",
				);
				this.refreshProfiles();
				const idx = this.profiles.findIndex((p) => p.name.toLowerCase() === this.pendingName.toLowerCase());
				if (idx !== -1) this.selectedIndex = idx;
				this.feedback = `Created "${this.pendingName}".`;
				this.view = "profiles-list";
				return;
			}
			const trimmed = this.textInput.trim();
			if (!trimmed) {
				this.error = "Name cannot be empty.";
				return;
			}
			const res = this.manager.renameProfile(this.renamingOldName, trimmed);
			if (res.success) {
				this.refreshProfiles();
				this.feedback = res.message;
				this.view = "profiles-list";
			} else {
				this.error = res.message;
			}
			return;
		}
		if (data.length === 1 && data >= " " && data <= "~") {
			if (editingDescription) this.descriptionInput += data;
			else this.textInput += data;
			this.error = null;
		}
	}

	private handleConfirmDeleteInput(data: string): void {
		if (data === "y" || data === "Y") {
			const active = this.manager.getActiveProfileName();
			if (active && this.manager.sanitizeName(active) === this.manager.sanitizeName(this.deletingName)) {
				this.feedback = `Cannot delete active profile "${this.deletingName}".`;
				this.view = "profiles-list";
				return;
			}
			const deleted = this.manager.deleteProfile(this.deletingName);
			this.refreshProfiles();
			this.feedback = deleted ? `Deleted "${this.deletingName}".` : `Could not delete "${this.deletingName}".`;
			this.view = "profiles-list";
			return;
		}
		if (data === "n" || data === "N" || matchesKey(data, Key.escape)) {
			this.view = "profiles-list";
		}
	}

	private refreshProfiles(): void {
		this.profiles = this.manager.listProfiles();
		if (this.selectedIndex >= this.profiles.length) {
			this.selectedIndex = Math.max(0, this.profiles.length - 1);
		}
	}

	private renderListPane(width: number, rows: number): string[] {
		const theme = this.theme;
		if (this.profiles.length === 0) return [theme.fg(ROLE.EMPTY, "no profiles yet")];
		if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex;
		else if (this.selectedIndex >= this.scrollOffset + rows) this.scrollOffset = this.selectedIndex - rows + 1;
		const visible = this.profiles.slice(this.scrollOffset, this.scrollOffset + rows);
		return visible.map((p, i) => {
			const actualIndex = this.scrollOffset + i;
			const isSelected = actualIndex === this.selectedIndex;
			const marker = isSelected ? theme.fg(ROLE.SELECTED, "▶") : " ";
			const glyph = p.is_active ? theme.fg(ROLE.ACTIVE, "❀") : theme.fg(ROLE.META, "○");
			const name = theme.fg(isSelected || p.is_active ? ROLE.SELECTED : ROLE.NAME_IDLE, p.name);
			const scope = theme.fg(ROLE.META, `[${p.scope[0]}]`);
			return `${marker} ${glyph} ${name} ${scope}`;
		});
	}

	private renderSummaryPane(width: number, rows: number): string[] {
		const theme = this.theme;
		const selected = this.profiles[this.selectedIndex];
		if (!selected) return [theme.fg(ROLE.EMPTY, "select a profile to inspect")];
		const full: Profile | null = this.manager.loadProfile(selected.name);
		const lines: string[] = [];
		if (this.feedback) {
			lines.push(theme.fg(ROLE.SELECTED, `❀ ${this.feedback}`));
			lines.push("");
		}
		const activeTag = selected.is_active ? theme.fg(ROLE.ACTIVE, "❀ ACTIVE") : theme.fg(ROLE.META, "INACTIVE");
		lines.push(`${theme.fg(ROLE.TITLE, selected.name)}  ${activeTag}`);
		if (full?.description) lines.push(theme.fg(ROLE.META, full.description));
		lines.push(theme.fg(ROLE.META, `Scope: ${selected.scope} · Location: ${selected.path ?? "builtin"}`));
		lines.push(rule(Math.min(width - 2, 40)));
		const agentCount = Object.keys(full?.model_profiles ?? {}).length;
		lines.push(`${theme.fg(ROLE.SELECTED, "Agents:")} ${theme.fg(ROLE.TEXT, String(agentCount))}`);
		lines.push(`${theme.fg(ROLE.SELECTED, "Default model:")} ${theme.fg(ROLE.MODEL, full?.default_model ?? "default")}`);
		lines.push("");
		lines.push(theme.fg(ROLE.META, "Press enter for details, a to activate, e to edit."));
		return lines.slice(0, rows);
	}

	private renderDetail(safeWidth: number, inner: number, bodyRows: number): string[] {
		const theme = this.theme;
		const selected = this.profiles[this.selectedIndex];
		const full: Profile | null = selected ? this.manager.loadProfile(selected.name) : null;
		const titleText = `✿ Profile · ${selected?.name ?? "unknown"}`;
		const top = this.topBar(titleText, inner);
		const lines: string[] = [];
		if (selected) {
			const activeTag = selected.is_active ? theme.fg(ROLE.ACTIVE, "❀ ACTIVE") : theme.fg(ROLE.META, "INACTIVE");
			lines.push(`${theme.fg(ROLE.TITLE, selected.name)}  ${activeTag}`);
			if (full?.description) lines.push(theme.fg(ROLE.META, full.description));
			const defEffort = full?.default_effort ? ` [${full.default_effort}]` : "";
			lines.push(`${theme.fg(ROLE.SELECTED, "Orchestrator:")} ${theme.fg(ROLE.MODEL, full?.default_model ?? "default")}${theme.fg(ROLE.META, defEffort)}`);
			lines.push(rule(Math.min(inner - 2, 40)));
			const entries = Object.entries(full?.model_profiles ?? {});
			lines.push(theme.fg(ROLE.TITLE, `Configured agents (${entries.length}):`));
			for (const [agent, cfg] of entries) {
				const effort = cfg.effort ? ` [${cfg.effort}]` : "";
				lines.push(`  ${theme.fg(ROLE.NAME, agent)}: ${theme.fg(ROLE.MODEL, cfg.model)}${theme.fg(ROLE.META, effort)}`);
			}
		}
		const body: string[] = [];
		for (let row = 0; row < bodyRows; row += 1) {
			body.push(`${theme.fg(ROLE.FRAME, "│")} ${fit(lines[row] ?? "", inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`);
		}
		const keys: Array<[string, string]> = [
			["a", "activate"],
			["esc", "back to list"],
		];
		const formatted = keys.map(([key, label]) => `${theme.fg(ROLE.KEY, key)} ${theme.fg(ROLE.KEY_TEXT, label)}`).join("   ");
		return [top, ...body, `${theme.fg(ROLE.FRAME, "│")} ${fit(formatted, inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`, theme.fg(ROLE.FRAME, `╰${rule(inner)}╯`)];
	}

	// Single-pane modal frame for pickers (model-picker, effort-picker) and
	// wizards (create/rename/confirm-delete). Accepted: transient overlays stay
	// single column; only the list shell and the profile editor are two-pane.
	// Fullscreen chrome shared by every state: title left, [× Close] right
	// (esc closes; no pointer region, mirroring the agents-view top bar).
	private topBar(titleText: string, inner: number): string {
		const theme = this.theme;
		const close = "[× Close]";
		const gap = Math.max(1, inner - visibleWidth(titleText) - 3 - visibleWidth(close) - 1);
		return (
			theme.fg(ROLE.FRAME, "╭─ ") +
			theme.fg(ROLE.TITLE, titleText) +
			theme.fg(ROLE.FRAME, ` ${rule(gap)}`) +
			theme.fg(ROLE.KEY, ` ${close}`) +
			theme.fg(ROLE.FRAME, "╮")
		);
	}

	private chrome(subtitle: string, lines: string[], keys: Array<[string, string]>, inner: number, bodyRows: number): string[] {
		const theme = this.theme;
		const titleText = subtitle ? `✿ Profiles · ${subtitle}` : "✿ Profiles";
		const top = this.topBar(titleText, inner);
		// Uniform height: every state fills the body like the editor, so the
		// modal never changes size mid-flow.
		const body: string[] = [];
		for (let row = 0; row < bodyRows; row += 1) {
			body.push(`${theme.fg(ROLE.FRAME, "│")} ${fit(lines[row] ?? "", inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`);
		}
		const formatted = keys.map(([key, label]) => `${theme.fg(ROLE.KEY, key)} ${theme.fg(ROLE.KEY_TEXT, label)}`).join("   ");
		return [top, ...body, `${theme.fg(ROLE.FRAME, "│")} ${fit(formatted, inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`, theme.fg(ROLE.FRAME, `╰${rule(inner)}╯`)];
	}

	private joinTwoPane(leftLines: string[], rightLines: string[], listWidth: number, rightWidth: number, bodyRows: number): string[] {
		const theme = this.theme;
		const body: string[] = [];
		for (let row = 0; row < bodyRows; row += 1) {
			body.push(
				`${theme.fg(ROLE.FRAME, "│")} ${fit(leftLines[row] ?? "", listWidth)} ${theme.fg(ROLE.FRAME, "│")} ${fit(rightLines[row] ?? "", rightWidth)}${theme.fg(ROLE.FRAME, "│")}`,
			);
		}
		return body;
	}

	private scrollList<T>(items: T[], cursor: number, scroll: number, rows: number): { visible: T[]; scroll: number } {
		let next = scroll;
		if (cursor < next) next = cursor;
		else if (cursor >= next + rows) next = cursor - rows + 1;
		return { visible: items.slice(next, next + rows), scroll: next };
	}

	private renderModal(inner: number, bodyRows: number): string[] {
		const theme = this.theme;
		switch (this.view) {
			case "profile-editor": {
				const rows = this.editorRows();
				const name = this.editing?.name ?? "";
				const listWidth = Math.max(20, Math.min(30, Math.floor(inner * 0.35)));
				const rightWidth = Math.max(10, inner - listWidth - 4);
				const win = this.scrollList(rows, this.editorIndex, this.editorScroll, bodyRows);
				this.editorScroll = win.scroll;
				const leftLines = win.visible.map((row, i) => {
					const isSelected = win.scroll + i === this.editorIndex;
					const marker = isSelected ? theme.fg(ROLE.SELECTED, "▶") : " ";
					const detail = row === ORCHESTRATOR_ROW
						? ` (${this.editing?.default_model ?? "default"})`
						: (this.editing?.model_profiles[row] ? ` (${this.editing.model_profiles[row].model})` : "");
					return `${marker} ${theme.fg(isSelected ? ROLE.SELECTED : ROLE.NAME_IDLE, `${row}${detail}`)}`;
				});
				const row = rows[this.editorIndex];
				const isOrchestrator = row === ORCHESTRATOR_ROW;
				const isBulk = row === ASSIGN_ALL_SUBAGENTS_KEY || row === ASSIGN_ALL_EFFORT_KEY || row === ASSIGN_CATEGORY_KEY;
				const entry = isOrchestrator || isBulk ? undefined : this.editing?.model_profiles[row];
				const model = isOrchestrator ? (this.editing?.default_model ?? "default") : (entry?.model ?? "default");
				const effort = isOrchestrator ? (this.editing?.default_effort ?? "default") : (entry?.effort ?? "default");
				const bulkBlurb =
					row === ASSIGN_ALL_SUBAGENTS_KEY
						? "one model for every agent"
						: row === ASSIGN_ALL_EFFORT_KEY
							? "one effort level for every agent"
							: "one model for a single category";
				const rightLines = [
					`${theme.fg(ROLE.TITLE, row)}${this.dirty ? theme.fg(ROLE.SELECTED, " *") : ""}`,
					theme.fg(ROLE.META, isOrchestrator ? "orchestrator default" : isBulk ? bulkBlurb : "per-agent override"),
					rule(Math.min(rightWidth - 2, 40)),
					...(isBulk
						? [theme.fg(ROLE.META, "enter opens the picker; applies on confirm")]
						: [
								`${theme.fg(ROLE.SELECTED, "Model:")} ${theme.fg(ROLE.MODEL, model)}`,
							`${theme.fg(ROLE.SELECTED, "Effort:")} ${theme.fg(ROLE.TEXT, effort)}`,
						]),
					"",
					theme.fg(ROLE.META, "enter picks model/effort"),
				];
				const titleText = `✿ Profiles · editing: ${name}${this.dirty ? " · [modified *]" : ""}`;
				const top = this.topBar(titleText, inner);
				const body = this.joinTwoPane(leftLines, rightLines, listWidth, rightWidth, bodyRows);
				const keys: Array<[string, string]> = [
					["j/k", "navigate"],
					["enter", "pick model"],
					["s", "save"],
					["esc", "back"],
				];
				const formatted = keys.map(([key, label]) => `${theme.fg(ROLE.KEY, key)} ${theme.fg(ROLE.KEY_TEXT, label)}`).join("   ");
				return [top, ...body, `${theme.fg(ROLE.FRAME, "│")} ${fit(formatted, inner - 2)} ${theme.fg(ROLE.FRAME, "│")}`, theme.fg(ROLE.FRAME, `╰${rule(inner)}╯`)];
			}
			case "model-picker": {
				const target =
					this.pickerTarget === "default-model"
						? ORCHESTRATOR_ROW
						: this.pickerTarget === "all-models"
							? "ALL agents"
							: this.pickerTarget === "category-models"
								? `category [${this.targetCategory ?? "?"}]`
								: (this.editorRows()[this.editorIndex] ?? "agent");
				const win = this.scrollList(this.pickerItems, this.pickerIndex, this.pickerScroll, bodyRows - 3);
				this.pickerScroll = win.scroll;
				const current =
					this.pickerTarget === "default-model"
						? (this.editing?.default_model ?? null)
						: this.pickerTarget === "agent-model"
							? (this.editing?.model_profiles?.[this.editorRows()[this.editorIndex] ?? ""]?.model ??
								this.editing?.default_model ?? null)
							: null;
				const lines =
					win.visible.length === 0
						? [theme.fg(ROLE.EMPTY, "no matches")]
						: win.visible.map((m, i) => {
								const isSelected = win.scroll + i === this.pickerIndex;
								const mark = current !== null && m === current ? theme.fg(ROLE.META, " ● current") : "";
								return `${isSelected ? theme.fg(ROLE.SELECTED, "▶") : " "} ${theme.fg(isSelected ? ROLE.SELECTED : ROLE.TEXT, m)}${mark}`;
							});
				lines.push("", `${theme.fg(ROLE.META, "Model for:")} ${theme.fg(ROLE.MODEL, `${target} · filter: ${this.modelFilter}`)}${theme.fg(ROLE.SELECTED, "█")}`);
				return this.chrome(`model picker · ${this.pickerItems.length} models`, lines, [
					["↑/↓", "navigate"],
					["enter", "pick effort"],
					["backspace", "erase"],
					["esc", "back"],
				], inner, bodyRows);
			}
			case "category-picker": {
				const win = this.scrollList(SDD_AGENT_CATEGORIES, this.pickerIndex, this.pickerScroll, bodyRows - 3);
				this.pickerScroll = win.scroll;
				const lines = win.visible.map((cat, i) => {
					const isSelected = win.scroll + i === this.pickerIndex;
					return `${isSelected ? theme.fg(ROLE.SELECTED, "▶") : " "} ${theme.fg(isSelected ? ROLE.SELECTED : ROLE.TEXT, cat.name)}`;
				});
				const cat = SDD_AGENT_CATEGORIES[this.pickerIndex];
				lines.push("", theme.fg(ROLE.META, cat ? `${cat.agents.length} agents · enter picks model.` : "no categories"));
				return this.chrome("category picker", lines, [
					["j/k", "navigate"],
					["enter", "pick model"],
					["esc", "back"],
				], inner, bodyRows);
			}
			case "effort-picker": {
				const win = this.scrollList(EFFORT_OPTIONS, this.pickerIndex, this.pickerScroll, bodyRows - 3);
				this.pickerScroll = win.scroll;
				const lines = win.visible.map((effort, i) => {
					const isSelected = win.scroll + i === this.pickerIndex;
					return `${isSelected ? theme.fg(ROLE.SELECTED, "▶") : " "} ${theme.fg(isSelected ? ROLE.SELECTED : ROLE.TEXT, effort)}`;
				});
				lines.push("", theme.fg(ROLE.META, `Reasoning effort for ${this.stagedModel ?? "model"} · enter applies.`));
				return this.chrome("effort picker", lines, [
					["j/k", "navigate"],
					["enter", "apply"],
					["esc", "back"],
				], inner, bodyRows);
			}
			case "create-profile": {
				const step1 = this.creationStep === "name";
				const lines = step1
					? [
							theme.fg(ROLE.TITLE, "New SDD profile · Step 1: name"),
							theme.fg(ROLE.META, "Unique id, e.g. deep-research."),
							`  ${theme.fg(ROLE.SELECTED, ">")} ${theme.fg(ROLE.NAME, this.textInput)}${theme.fg(ROLE.META, "_")}`,
						]
					: [
							theme.fg(ROLE.TITLE, `New SDD profile · Step 2: description (${this.pendingName})`),
							theme.fg(ROLE.META, "One-line purpose note; empty + enter skips."),
							`  ${theme.fg(ROLE.SELECTED, ">")} ${theme.fg(ROLE.NAME, this.descriptionInput)}${theme.fg(ROLE.META, "_")}`,
						];
				if (this.error) lines.push("", theme.fg(ROLE.ERROR, this.error));
				return this.chrome(step1 ? "new profile · 1/2 (name)" : "new profile · 2/2 (description)", lines, [
					["enter", step1 ? "next" : "create"],
					["esc", step1 ? "cancel" : "back"],
				], inner, bodyRows);
			}
			case "rename-profile": {
				const lines = [
					theme.fg(ROLE.TITLE, `Rename "${this.renamingOldName}"`),
					`  ${theme.fg(ROLE.SELECTED, ">")} ${theme.fg(ROLE.NAME, this.textInput)}${theme.fg(ROLE.META, "_")}`,
				];
				if (this.error) lines.push("", theme.fg(ROLE.ERROR, this.error));
				return this.chrome("rename", lines, [
					["enter", "confirm"],
					["esc", "cancel"],
				], inner, bodyRows);
			}
			case "confirm-delete": {
				return this.chrome("confirm delete", [
					theme.fg(ROLE.ERROR, "Delete profile"),
					theme.fg(ROLE.NAME, `Delete "${this.deletingName}"? No undo.`),
				], [
					["y", "confirm"],
					["n/esc", "cancel"],
				], inner, bodyRows);
			}
			default:
				return [];
		}
	}
}
