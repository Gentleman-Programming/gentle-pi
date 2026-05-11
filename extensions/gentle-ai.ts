import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const ORCHESTRATOR_PROMPT = readFileSync(
	join(ASSETS_DIR, "orchestrator.md"),
	"utf8",
).trim();

type PersonaMode = "gentleman" | "neutral";

const PERSONA_OPTIONS = ["gentleman", "neutral"] as const;

const GENTLEMAN_PERSONA_PROMPT = `Persona:
- Be direct, technical, and concise.
- When the user writes Spanish, answer in natural Rioplatense Spanish with voseo.
- Act as a senior architect and teacher: concepts before code, no shortcuts.
- Treat AI as a tool directed by the human; never present yourself as a default chatbot.
- Push back when the user asks for code without enough context or understanding.
- Correct errors directly, explain why, and show the better path.`;

const NEUTRAL_PERSONA_PROMPT = `Persona:
- Be direct, technical, concise, warm, and professional.
- Always respond in the same language the user writes in.
- Do not use slang or regional expressions.
- Act as a senior architect and teacher: concepts before code, no shortcuts.
- Treat AI as a tool directed by the human; never present yourself as a default chatbot.
- Push back when the user asks for code without enough context or understanding.
- Correct errors directly, explain why, and show the better path.`;

function buildGentlePrompt(persona: PersonaMode): string {
	const personaPrompt =
		persona === "neutral" ? NEUTRAL_PERSONA_PROMPT : GENTLEMAN_PERSONA_PROMPT;
	return `## el Gentleman Identity and Harness
You are el Gentleman: a Pi-specific coding-agent harness for controlled development work.

Identity contract:
- If the user asks who or what you are, answer as el Gentleman, not as a generic assistant.
- Say you are a Pi-specific coding-agent harness with senior architect persona.
- Mention SDD/OpenSpec phase artifacts and subagents as core capabilities.
- Mention memory only when memory packages or callable memory tools are actually active; never invent persistent memory.
- Do not claim portability outside the Pi runtime.

${personaPrompt}

Harness principles:
- el Gentleman is not prompt engineering. It is runtime discipline around powerful agents.
- Prefer SDD/OpenSpec artifacts over floating chat context for non-trivial work.
- Clarify scope, constraints, acceptance criteria, and non-goals before implementation.
- Use subagents when available for exploration, planning, implementation, and review, while keeping one parent session responsible for orchestration.
- Keep writes single-threaded unless the user explicitly approves parallel write isolation.
- If tests exist, use strict TDD evidence: RED, GREEN, TRIANGULATE, REFACTOR.
- Protect the human reviewer: avoid oversized changes, surface review workload risk, and ask before turning one task into a large multi-area change.
- Never claim persistent memory is available because of this package. Memory is provided by separate packages or MCP tools when installed and callable.

${ORCHESTRATOR_PROMPT}`;
}

const DENIED_BASH_PATTERNS: RegExp[] = [
	/\brm\s+-rf\s+(?:\/|~|\$HOME|\.\.?)(?:\s|$)/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	/\bgit\s+push\b(?=[^\n]*\s--force(?:-with-lease)?\b)/,
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

const CONFIRM_BASH_PATTERNS: RegExp[] = [
	/\bgit\s+push\b/,
	/\bgit\s+rebase\b/,
	/\bgit\s+branch\s+-D\b/,
	/\bnpm\s+publish\b/,
	/\bpi\s+remove\b/,
];

const SDD_AGENT_NAMES = [
	"sdd-init",
	"sdd-explore",
	"sdd-proposal",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-archive",
] as const;

type SddAgentName = (typeof SDD_AGENT_NAMES)[number];
type AgentModelConfig = Record<string, string>;
type AgentSource = "project" | "user" | "builtin";

interface AgentEntry {
	name: string;
	source: AgentSource;
	filePath?: string;
}

const KEEP_CURRENT = "Keep current";
const INHERIT_MODEL = "Inherit active/default model";
const CUSTOM_MODEL = "Custom model id";

const MODEL_CONTROL_OPTIONS = [
	KEEP_CURRENT,
	INHERIT_MODEL,
	CUSTOM_MODEL,
] as const;

function evaluateDeniedCommand(
	command: string,
): ToolCallEventResult | undefined {
	for (const pattern of DENIED_BASH_PATTERNS) {
		if (pattern.test(command)) {
			return {
				block: true,
				reason:
					"Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
			};
		}
	}
	return undefined;
}

function commandRequiresConfirmation(command: string): boolean {
	return CONFIRM_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

async function confirmCommand(
	command: string,
	ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
	const denied = evaluateDeniedCommand(command);
	if (denied) return denied;
	if (!commandRequiresConfirmation(command)) return undefined;
	if (!ctx.hasUI) {
		return {
			block: true,
			reason:
				"Gentle AI safety policy requires interactive confirmation before this command.",
		};
	}
	const preview = truncateToWidth(
		command.replace(/\s+/g, " ").trim(),
		180,
		"…",
	);
	const approved = await ctx.ui.confirm("Allow guarded command?", preview);
	if (approved) return undefined;
	return {
		block: true,
		reason:
			"Gentle AI safety policy blocked the command because it was not confirmed.",
	};
}

function copyDirectoryFiles(
	sourceDir: string,
	targetDir: string,
	force: boolean,
): { copied: number; skipped: number } {
	if (!existsSync(sourceDir)) return { copied: 0, skipped: 0 };
	mkdirSync(targetDir, { recursive: true });
	let copied = 0;
	let skipped = 0;
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			const child = copyDirectoryFiles(sourcePath, targetPath, force);
			copied += child.copied;
			skipped += child.skipped;
			continue;
		}
		if (!entry.isFile()) continue;
		if (!force && existsSync(targetPath)) {
			skipped += 1;
			continue;
		}
		writeFileSync(targetPath, readFileSync(sourcePath));
		copied += 1;
	}
	return { copied, skipped };
}

function installSddAssets(
	cwd: string,
	force: boolean,
): { agents: number; chains: number; support: number; skipped: number } {
	const agents = copyDirectoryFiles(
		join(ASSETS_DIR, "agents"),
		join(cwd, ".pi", "agents"),
		force,
	);
	const chains = copyDirectoryFiles(
		join(ASSETS_DIR, "chains"),
		join(cwd, ".pi", "chains"),
		force,
	);
	const support = copyDirectoryFiles(
		join(ASSETS_DIR, "support"),
		join(cwd, ".pi", "gentle-ai", "support"),
		force,
	);
	return {
		agents: agents.copied,
		chains: chains.copied,
		support: support.copied,
		skipped: agents.skipped + chains.skipped + support.skipped,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelConfigPath(cwd: string): string {
	return join(cwd, ".pi", "gentle-ai", "models.json");
}

function personaConfigPath(cwd: string): string {
	return join(cwd, ".pi", "gentle-ai", "persona.json");
}

function readPersonaMode(cwd: string): PersonaMode {
	const path = personaConfigPath(cwd);
	if (!existsSync(path)) return "gentleman";
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return "gentleman";
		return parsed.mode === "neutral" ? "neutral" : "gentleman";
	} catch {
		return "gentleman";
	}
}

function writePersonaMode(cwd: string, mode: PersonaMode): void {
	const path = personaConfigPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ mode }, null, 2)}\n`);
}

function readModelConfig(cwd: string): AgentModelConfig {
	const path = modelConfigPath(cwd);
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return {};
		const config: AgentModelConfig = {};
		for (const [name, value] of Object.entries(parsed)) {
			if (typeof value === "string" && value.trim().length > 0) {
				config[name] = value.trim();
			}
		}
		return config;
	} catch {
		return {};
	}
}

function writeModelConfig(cwd: string, config: AgentModelConfig): void {
	const path = modelConfigPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function updateFrontmatterModel(
	content: string,
	model: string | undefined,
): string {
	if (!content.startsWith("---\n")) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter
		.split("\n")
		.filter((line) => !line.startsWith("model:"));
	if (model !== undefined) {
		const descriptionIndex = lines.findIndex((line) =>
			line.startsWith("description:"),
		);
		const insertIndex =
			descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, `model: ${model}`);
	}
	return `---\n${lines.join("\n")}${body}`;
}

function parseAgentName(filePath: string): string | undefined {
	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}
	const name = content.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
	if (!name) return undefined;
	const packageName = content
		.match(/^package:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]
		?.trim();
	return packageName ? `${packageName}.${name}` : name;
}

function listAgentFilesRecursive(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...listAgentFilesRecursive(path));
		else if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			!entry.name.endsWith(".chain.md")
		)
			files.push(path);
	}
	return files;
}

function listAgentsFromDir(dir: string, source: AgentSource): AgentEntry[] {
	return listAgentFilesRecursive(dir)
		.map((filePath): AgentEntry | undefined => {
			const name = parseAgentName(filePath);
			return name ? { name, source, filePath } : undefined;
		})
		.filter((entry): entry is AgentEntry => entry !== undefined);
}

function listDiscoverableAgents(cwd: string): AgentEntry[] {
	const builtinDirs = [
		join(PACKAGE_ROOT, "..", "pi-subagents", "agents"),
		join(cwd, ".pi", "npm", "node_modules", "pi-subagents", "agents"),
		join(homedir(), ".local", "lib", "node_modules", "pi-subagents", "agents"),
	];
	const agents = [
		...builtinDirs.flatMap((dir) => listAgentsFromDir(dir, "builtin")),
		...listAgentsFromDir(join(homedir(), ".pi", "agent", "agents"), "user"),
		...listAgentsFromDir(join(homedir(), ".agents"), "user"),
		...listAgentsFromDir(join(cwd, ".agents"), "project"),
		...listAgentsFromDir(join(cwd, ".pi", "agents"), "project"),
	];
	const byName = new Map<string, AgentEntry>();
	for (const agent of agents) byName.set(agent.name, agent);
	const discovered = Array.from(byName.values());
	const sddFirst = SDD_AGENT_NAMES.map((name) =>
		discovered.find((agent) => agent.name === name),
	).filter((agent): agent is AgentEntry => agent !== undefined);
	const rest = discovered
		.filter((agent) => !SDD_AGENT_NAMES.includes(agent.name as SddAgentName))
		.sort((left, right) => left.name.localeCompare(right.name));
	return [...sddFirst, ...rest];
}

function projectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

function updateBuiltinModelOverride(
	cwd: string,
	name: string,
	model: string | undefined,
): boolean {
	const path = projectSettingsPath(cwd);
	let settings: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (isRecord(parsed)) settings = parsed;
		} catch {
			settings = {};
		}
	}
	const subagents = isRecord(settings.subagents)
		? { ...settings.subagents }
		: {};
	const agentOverrides = isRecord(subagents.agentOverrides)
		? { ...subagents.agentOverrides }
		: {};
	const current = isRecord(agentOverrides[name])
		? { ...agentOverrides[name] }
		: {};
	if (model === undefined) delete current.model;
	else current.model = model;
	if (Object.keys(current).length > 0) agentOverrides[name] = current;
	else delete agentOverrides[name];
	if (Object.keys(agentOverrides).length > 0)
		subagents.agentOverrides = agentOverrides;
	else delete subagents.agentOverrides;
	if (Object.keys(subagents).length > 0) settings.subagents = subagents;
	else delete settings.subagents;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, "\t")}\n`);
	return true;
}

function applyModelConfig(
	cwd: string,
	config: AgentModelConfig,
): { updated: number; skipped: number } {
	let updated = 0;
	let skipped = 0;
	for (const agent of listDiscoverableAgents(cwd)) {
		const model = config[agent.name];
		if (agent.source === "builtin") {
			if (updateBuiltinModelOverride(cwd, agent.name, model)) updated += 1;
			else skipped += 1;
			continue;
		}
		if (!agent.filePath || !existsSync(agent.filePath)) {
			skipped += 1;
			continue;
		}
		const original = readFileSync(agent.filePath, "utf8");
		const next = updateFrontmatterModel(original, model);
		if (next === original) {
			skipped += 1;
			continue;
		}
		writeFileSync(agent.filePath, next);
		updated += 1;
	}
	return { updated, skipped };
}

function describeModelConfig(cwd: string, config: AgentModelConfig): string[] {
	return listDiscoverableAgents(cwd).map(
		(agent) => `${agent.name}: ${config[agent.name] ?? "inherit"}`,
	);
}

async function getPiModelOptions(ctx: ExtensionContext): Promise<string[]> {
	const models = await ctx.modelRegistry.getAvailable();
	const modelIds = models
		.map((model) => `${model.provider}/${model.id}`)
		.sort((left, right) => left.localeCompare(right));
	return [...MODEL_CONTROL_OPTIONS, ...modelIds];
}

interface OverlayComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	invalidate(): void;
}

type ModelPanelResult =
	| { type: "save"; config: AgentModelConfig }
	| { type: "custom"; agent: string | "all" }
	| { type: "cancel" };

const SET_ALL_AGENTS = "Set all agents";

class SddModelPanel implements OverlayComponent {
	private cursor = 0;
	private mode: "agents" | "models" = "agents";
	private selectedRow = SET_ALL_AGENTS;
	private modelCursor = 0;
	private query = "";
	private readonly draft: AgentModelConfig;
	private readonly rows: string[];

	constructor(
		initialConfig: AgentModelConfig,
		private readonly modelOptions: string[],
		agents: string[],
		private readonly done: (result: ModelPanelResult) => void,
	) {
		this.draft = { ...initialConfig };
		this.rows = [SET_ALL_AGENTS, ...agents];
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.mode === "models") {
			this.handleModelInput(data);
			return;
		}
		this.handleAgentInput(data);
	}

	render(width: number): string[] {
		return this.mode === "models"
			? this.renderModelPicker(width)
			: this.renderAgentList(width);
	}

	private handleAgentInput(data: string): void {
		const maxCursor = this.rows.length + 1;
		if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "ctrl+s")) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.cursor = Math.min(maxCursor, this.cursor + 1);
			return;
		}
		if (matchesKey(data, "up") || data === "k") {
			this.cursor = Math.max(0, this.cursor - 1);
			return;
		}
		if (data === "i") {
			this.applySelection(undefined);
			return;
		}
		if (data === "c") {
			const row = this.rows[this.cursor];
			if (row === SET_ALL_AGENTS) this.done({ type: "custom", agent: "all" });
			else if (row) this.done({ type: "custom", agent: row });
			return;
		}
		if (!matchesKey(data, "return")) return;
		if (this.cursor === this.rows.length) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (this.cursor === this.rows.length + 1) {
			this.done({ type: "cancel" });
			return;
		}
		this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
		this.mode = "models";
		this.modelCursor = 0;
		this.query = "";
	}

	private handleModelInput(data: string): void {
		const options = this.filteredModelOptions();
		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			this.query = "";
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			this.modelCursor = Math.min(
				this.modelCursor,
				Math.max(0, this.filteredModelOptions().length - 1),
			);
			return;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.modelCursor = Math.min(
				Math.max(0, options.length - 1),
				this.modelCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || data === "k") {
			this.modelCursor = Math.max(0, this.modelCursor - 1);
			return;
		}
		if (matchesKey(data, "return")) {
			const selected = options[this.modelCursor];
			if (!selected) return;
			if (selected === CUSTOM_MODEL) {
				this.done({
					type: "custom",
					agent: this.selectedRow === SET_ALL_AGENTS ? "all" : this.selectedRow,
				});
				return;
			}
			if (selected === KEEP_CURRENT) {
				this.mode = "agents";
				return;
			}
			this.applySelection(selected === INHERIT_MODEL ? undefined : selected);
			this.mode = "agents";
			return;
		}
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.modelCursor = 0;
		}
	}

	private applySelection(model: string | undefined): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) {
				if (model === undefined) delete this.draft[name];
				else this.draft[name] = model;
			}
			return;
		}
		if (!row) return;
		if (model === undefined) delete this.draft[row];
		else this.draft[row] = model;
	}

	private filteredModelOptions(): string[] {
		const query = this.query.trim().toLowerCase();
		if (!query) return this.modelOptions;
		return this.modelOptions.filter((option) =>
			option.toLowerCase().includes(query),
		);
	}

	private renderAgentList(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "") =>
			truncateToWidth(text, Math.max(1, width), "…", true);
		lines.push(line("Assign Models to Agents"));
		lines.push("");
		lines.push(line("Current assignments:"));
		lines.push("");
		for (let i = 0; i < this.rows.length; i++) {
			const row = this.rows[i] ?? SET_ALL_AGENTS;
			const focused = i === this.cursor;
			const label =
				row === SET_ALL_AGENTS
					? this.renderSetAllLabel(row)
					: this.renderAgentLabel(row);
			lines.push(line(`${focused ? "▸" : " "} ${label}`));
		}
		lines.push("");
		lines.push(
			line(`${this.cursor === this.rows.length ? "▸" : " "} Continue`),
		);
		lines.push(
			line(`${this.cursor === this.rows.length + 1 ? "▸" : " "} ← Back`),
		);
		lines.push("");
		lines.push(
			line(
				"j/k: navigate • enter: change model / confirm • i: inherit • c: custom • ctrl+s: save • esc: back",
			),
		);
		return lines;
	}

	private renderModelPicker(width: number): string[] {
		const lines: string[] = [];
		const options = this.filteredModelOptions();
		const line = (text = "") =>
			truncateToWidth(text, Math.max(1, width), "…", true);
		lines.push(line(`Select model for ${this.selectedRow}`));
		lines.push("");
		lines.push(line(`◎ ${this.query || "search..."}`));
		lines.push("");
		const maxVisible = 12;
		const start = Math.max(
			0,
			Math.min(
				this.modelCursor - Math.floor(maxVisible / 2),
				Math.max(0, options.length - maxVisible),
			),
		);
		const end = Math.min(options.length, start + maxVisible);
		for (let i = start; i < end; i++) {
			const focused = i === this.modelCursor;
			lines.push(line(`${focused ? "▸" : " "} ${options[i]}`));
		}
		if (options.length === 0) lines.push(line("  No matching models"));
		lines.push("");
		lines.push(
			line("j/k: navigate • type: search • enter: select • esc: back"),
		);
		return lines;
	}

	private renderSetAllLabel(row: string): string {
		const values = this.rows
			.slice(1)
			.map((name) => this.draft[name] ?? "inherit");
		const first = values[0] ?? "inherit";
		const allSame = values.every((value) => value === first);
		return `${row.padEnd(20)} ${allSame ? first : "mixed"}`;
	}

	private renderAgentLabel(row: string): string {
		return `${row.padEnd(20)} ${this.draft[row] ?? "inherit"}`;
	}
}

async function showSddModelPanel(
	ctx: ExtensionContext,
	config: AgentModelConfig,
): Promise<ModelPanelResult> {
	const modelOptions = await getPiModelOptions(ctx);
	const agents = listDiscoverableAgents(ctx.cwd).map((agent) => agent.name);
	return ctx.ui.custom<ModelPanelResult>(
		(_tui, _theme, _keybindings, done) =>
			new SddModelPanel(config, modelOptions, agents, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "70%",
				minWidth: 72,
				maxHeight: "85%",
			},
		},
	);
}

async function handleModelsCommand(ctx: ExtensionContext): Promise<void> {
	let config = readModelConfig(ctx.cwd);
	let result = await showSddModelPanel(ctx, config);
	while (result.type === "custom") {
		const current =
			result.agent === "all" ? "inherit" : (config[result.agent] ?? "inherit");
		const custom = await ctx.ui.input(
			`${result.agent === "all" ? "all agents" : result.agent} custom model id`,
			current === "inherit" ? "provider/model" : current,
		);
		if (custom === undefined) return;
		const trimmed = custom.trim();
		if (trimmed.length > 0) {
			if (result.agent === "all") {
				config = Object.fromEntries(
					listDiscoverableAgents(ctx.cwd).map((agent) => [agent.name, trimmed]),
				);
			} else {
				config = { ...config, [result.agent]: trimmed };
			}
		}
		result = await showSddModelPanel(ctx, config);
	}
	if (result.type !== "save") return;
	writeModelConfig(ctx.cwd, result.config);
	const applyResult = applyModelConfig(ctx.cwd, result.config);
	ctx.ui.notify(
		[
			"el Gentleman model config saved.",
			`Config: ${modelConfigPath(ctx.cwd)}`,
			`Agents updated: ${applyResult.updated}`,
			...describeModelConfig(ctx.cwd, result.config),
		].join("\n"),
		"info",
	);
}

async function handlePersonaCommand(ctx: ExtensionContext): Promise<void> {
	const current = readPersonaMode(ctx.cwd);
	const selected = await ctx.ui.select(
		`el Gentleman persona (current: ${current})`,
		[...PERSONA_OPTIONS],
	);
	if (selected !== "gentleman" && selected !== "neutral") return;
	writePersonaMode(ctx.cwd, selected);
	ctx.ui.notify(
		[
			`el Gentleman persona set to: ${selected}`,
			`Config: ${personaConfigPath(ctx.cwd)}`,
			"Run /reload or start a new Pi session for already-injected prompts to refresh.",
		].join("\n"),
		"info",
	);
}

export default function gentleAi(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const result = installSddAssets(ctx.cwd, false);
		const modelResult = applyModelConfig(ctx.cwd, readModelConfig(ctx.cwd));
		if (
			ctx.hasUI &&
			(result.agents > 0 || result.chains > 0 || result.support > 0)
		) {
			ctx.ui.notify(
				`Gentle AI SDD assets auto-installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s).`,
				"info",
			);
		}
		if (ctx.hasUI && modelResult.updated > 0) {
			ctx.ui.notify(
				`el Gentleman applied SDD model config to ${modelResult.updated} agent(s).`,
				"info",
			);
		}
	});

	pi.on("before_agent_start", (event, ctx) => ({
		systemPrompt: `${event.systemPrompt}\n\n${buildGentlePrompt(readPersonaMode(ctx.cwd))}`,
	}));

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		if (!isRecord(event.input) || typeof event.input.command !== "string")
			return undefined;
		return confirmCommand(event.input.command, ctx);
	});

	pi.registerCommand("gentle-ai:install-sdd", {
		description:
			"Install Gentle AI SDD subagent and chain assets into this project.",
		handler: async (args, ctx) => {
			const force = args.includes("--force");
			const result = installSddAssets(ctx.cwd, force);
			ctx.ui.notify(
				`Gentle AI SDD assets installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} skipped.`,
				"info",
			);
		},
	});

	pi.registerCommand("gentle:models", {
		description: "Configure per-agent models for el Gentleman.",
		handler: async (_args, ctx) => {
			await handleModelsCommand(ctx);
		},
	});

	pi.registerCommand("gentle-ai:models", {
		description: "Compatibility alias for /gentle:models.",
		handler: async (_args, ctx) => {
			await handleModelsCommand(ctx);
		},
	});

	pi.registerCommand("gentleman:models", {
		description: "Compatibility alias for /gentle:models.",
		handler: async (_args, ctx) => {
			await handleModelsCommand(ctx);
		},
	});

	pi.registerCommand("gentle:persona", {
		description: "Switch el Gentleman persona between gentleman and neutral.",
		handler: async (_args, ctx) => {
			await handlePersonaCommand(ctx);
		},
	});

	pi.registerCommand("gentle-ai:persona", {
		description: "Compatibility alias for /gentle:persona.",
		handler: async (_args, ctx) => {
			await handlePersonaCommand(ctx);
		},
	});

	pi.registerCommand("gentleman:persona", {
		description: "Compatibility alias for /gentle:persona.",
		handler: async (_args, ctx) => {
			await handlePersonaCommand(ctx);
		},
	});

	pi.registerCommand("gentle-ai:status", {
		description: "Show Gentle AI package status for this project.",
		handler: async (_args, ctx) => {
			const agentsInstalled = existsSync(
				join(ctx.cwd, ".pi", "agents", "sdd-apply.md"),
			);
			const chainsInstalled = existsSync(
				join(ctx.cwd, ".pi", "chains", "sdd-full.chain.md"),
			);
			const openspecConfigured = existsSync(
				join(ctx.cwd, "openspec", "config.yaml"),
			);
			const modelConfig = readModelConfig(ctx.cwd);
			ctx.ui.notify(
				[
					"el Gentleman package is active.",
					`Persona: ${readPersonaMode(ctx.cwd)}`,
					`SDD agents: ${agentsInstalled ? "installed" : "not installed"}`,
					`SDD chains: ${chainsInstalled ? "installed" : "not installed"}`,
					`OpenSpec config: ${openspecConfigured ? "present" : "missing"}`,
					`Model config: ${existsSync(modelConfigPath(ctx.cwd)) ? "present" : "missing"}`,
					...describeModelConfig(ctx.cwd, modelConfig),
				].join("\n"),
				"info",
			);
		},
	});
}
