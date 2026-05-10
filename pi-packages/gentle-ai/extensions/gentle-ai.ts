import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const ORCHESTRATOR_PROMPT = readFileSync(join(ASSETS_DIR, "orchestrator.md"), "utf8").trim();

const GENTLE_AI_PROMPT = `## el Gentleman Identity and Harness
You are el Gentleman: a Pi-specific coding-agent harness for controlled development work.

Identity contract:
- If the user asks who or what you are, answer as el Gentleman, not as a generic assistant.
- Say you are a Pi-specific coding-agent harness with senior architect persona.
- Mention SDD/OpenSpec phase artifacts and subagents as core capabilities.
- Mention memory only when memory packages or callable memory tools are actually active; never invent persistent memory.
- Do not claim portability outside the Pi runtime.

Persona:
- Be direct, technical, and concise.
- When the user writes Spanish, answer in natural Rioplatense Spanish with voseo.
- Act as a senior architect and teacher: concepts before code, no shortcuts.
- Treat AI as a tool directed by the human; never present yourself as a default chatbot.

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
type SddModelConfig = Partial<Record<SddAgentName, string>>;

const MODEL_OPTIONS = [
	"Keep current",
	"Inherit active/default model",
	"anthropic/claude-sonnet-4",
	"google/gemini-3-pro",
	"openai/gpt-5",
	"openai/gpt-5-mini",
	"Custom model id",
] as const;

const KEEP_CURRENT = MODEL_OPTIONS[0];
const INHERIT_MODEL = MODEL_OPTIONS[1];
const CUSTOM_MODEL = MODEL_OPTIONS[6];

function evaluateCommand(command: string): ToolCallEventResult | undefined {
	for (const pattern of DENIED_BASH_PATTERNS) {
		if (pattern.test(command)) {
			return {
				block: true,
				reason: "Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
			};
		}
	}
	for (const pattern of CONFIRM_BASH_PATTERNS) {
		if (pattern.test(command)) {
			return {
				block: true,
				reason: "Gentle AI safety policy requires explicit user approval before this command.",
			};
		}
	}
	return undefined;
}

function copyDirectoryFiles(sourceDir: string, targetDir: string, force: boolean): { copied: number; skipped: number } {
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
	const agents = copyDirectoryFiles(join(ASSETS_DIR, "agents"), join(cwd, ".pi", "agents"), force);
	const chains = copyDirectoryFiles(join(ASSETS_DIR, "chains"), join(cwd, ".pi", "chains"), force);
	const support = copyDirectoryFiles(join(ASSETS_DIR, "support"), join(cwd, ".pi", "gentle-ai", "support"), force);
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

function readModelConfig(cwd: string): SddModelConfig {
	const path = modelConfigPath(cwd);
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return {};
		const config: SddModelConfig = {};
		for (const name of SDD_AGENT_NAMES) {
			const value = parsed[name];
			if (typeof value === "string" && value.trim().length > 0) {
				config[name] = value.trim();
			}
		}
		return config;
	} catch {
		return {};
	}
}

function writeModelConfig(cwd: string, config: SddModelConfig): void {
	const path = modelConfigPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function updateFrontmatterModel(content: string, model: string | undefined): string {
	if (!content.startsWith("---\n")) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter.split("\n").filter((line) => !line.startsWith("model:"));
	if (model !== undefined) {
		const descriptionIndex = lines.findIndex((line) => line.startsWith("description:"));
		const insertIndex = descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, `model: ${model}`);
	}
	return `---\n${lines.join("\n")}${body}`;
}

function applyModelConfig(cwd: string, config: SddModelConfig): { updated: number; skipped: number } {
	let updated = 0;
	let skipped = 0;
	for (const name of SDD_AGENT_NAMES) {
		const agentPath = join(cwd, ".pi", "agents", `${name}.md`);
		if (!existsSync(agentPath)) {
			skipped += 1;
			continue;
		}
		const original = readFileSync(agentPath, "utf8");
		const next = updateFrontmatterModel(original, config[name]);
		if (next === original) {
			skipped += 1;
			continue;
		}
		writeFileSync(agentPath, next);
		updated += 1;
	}
	return { updated, skipped };
}

function describeModelConfig(config: SddModelConfig): string[] {
	return SDD_AGENT_NAMES.map((name) => `${name}: ${config[name] ?? "inherit"}`);
}

export default function gentleAi(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const result = installSddAssets(ctx.cwd, false);
		const modelResult = applyModelConfig(ctx.cwd, readModelConfig(ctx.cwd));
		if (ctx.hasUI && (result.agents > 0 || result.chains > 0 || result.support > 0)) {
			ctx.ui.notify(
				`Gentle AI SDD assets auto-installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s).`,
				"info",
			);
		}
		if (ctx.hasUI && modelResult.updated > 0) {
			ctx.ui.notify(`el Gentleman applied SDD model config to ${modelResult.updated} agent(s).`, "info");
		}
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${GENTLE_AI_PROMPT}`,
	}));

	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash") return undefined;
		return evaluateCommand(event.input.command);
	});

	pi.registerCommand("gentle-ai:install-sdd", {
		description: "Install Gentle AI SDD subagent and chain assets into this project.",
		handler: async (args, ctx) => {
			const force = args.includes("--force");
			const result = installSddAssets(ctx.cwd, force);
			ctx.ui.notify(
				`Gentle AI SDD assets installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} skipped.`,
				"info",
			);
		},
	});

	pi.registerCommand("gentleman:models", {
		description: "Configure per-phase SDD agent models for el Gentleman.",
		handler: async (_args, ctx) => {
			const config = readModelConfig(ctx.cwd);
			for (const name of SDD_AGENT_NAMES) {
				const current = config[name] ?? "inherit";
				const selected = await ctx.ui.select(`${name} model (current: ${current})`, [...MODEL_OPTIONS]);
				if (selected === undefined) return;
				if (selected === KEEP_CURRENT) continue;
				if (selected === INHERIT_MODEL) {
					delete config[name];
					continue;
				}
				if (selected === CUSTOM_MODEL) {
					const custom = await ctx.ui.input(`${name} custom model id`, current === "inherit" ? "provider/model" : current);
					if (custom === undefined) return;
					const trimmed = custom.trim();
					if (trimmed.length > 0) config[name] = trimmed;
					continue;
				}
				config[name] = selected;
			}
			writeModelConfig(ctx.cwd, config);
			const result = applyModelConfig(ctx.cwd, config);
			ctx.ui.notify(
				[
					"el Gentleman SDD model config saved.",
					`Config: ${modelConfigPath(ctx.cwd)}`,
					`Agents updated: ${result.updated}`,
					...describeModelConfig(config),
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("gentle-ai:models", {
		description: "Alias for /gentleman:models.",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Use /gentleman:models to configure per-phase SDD agent models.", "info");
		},
	});

	pi.registerCommand("gentle-ai:status", {
		description: "Show Gentle AI package status for this project.",
		handler: async (_args, ctx) => {
			const agentsInstalled = existsSync(join(ctx.cwd, ".pi", "agents", "sdd-apply.md"));
			const chainsInstalled = existsSync(join(ctx.cwd, ".pi", "chains", "sdd-full.chain.md"));
			const openspecConfigured = existsSync(join(ctx.cwd, "openspec", "config.yaml"));
			const modelConfig = readModelConfig(ctx.cwd);
			ctx.ui.notify(
				[
					"el Gentleman package is active.",
					`SDD agents: ${agentsInstalled ? "installed" : "not installed"}`,
					`SDD chains: ${chainsInstalled ? "installed" : "not installed"}`,
					`OpenSpec config: ${openspecConfigured ? "present" : "missing"}`,
					`Model config: ${existsSync(modelConfigPath(ctx.cwd)) ? "present" : "missing"}`,
					...describeModelConfig(modelConfig),
				].join("\n"),
				"info",
			);
		},
	});
}
