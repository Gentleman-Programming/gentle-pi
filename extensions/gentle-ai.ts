import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	access,
	mkdir,
	readFile,
	readdir,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	ensureSddPreflight,
	getSddPreflightPreferences,
	installSddAssets,
	isPackageManagedSddAsset,
	isSddPreflightTrigger,
	renderSddPreflightPrompt,
	type SddPreflightPreferences,
	updatePackageManagedSddAgentOwnership,
} from "../lib/sdd-preflight.ts";
import {
	parseSddStatusCommandArgs,
	renderNativeSddPhasePrompt,
	renderSddDispatcherMarkdown,
	renderSddStatusMarkdown,
	resolveSddStatus,
	sddStatusSeverity,
	type SddPhase,
} from "../lib/sdd-status.ts";
import type { TriggerEvent } from "../lib/review-triggers.ts";
import { ReviewBundleExporter, ReviewBundleImporter } from "../lib/review-bundle.ts";
import { inspectLegacyReviewAuthorityV1 } from "../lib/review-legacy-detector.ts";
import { destructiveResetReviewAuthorityV1 } from "../lib/review-reset.ts";
import { ReviewMutationLockV1 } from "../lib/review-lock.ts";
import { resolveRepositoryAuthorityV1 } from "../lib/review-repository.ts";
import {
	EXTERNAL_RELEASE_EVIDENCE,
	GATE_RESULT,
	GATE_TARGET_KIND,
	PUSH_UPDATE_KIND,
	REVIEW_TRANSITION,
	ReviewTransactionStore,
	canonicalHash,
	createReviewState,
	evaluateReleaseFastPathV1,
	recheckReleaseFastPathRemoteHeadV1,
	validateAuthoritativeReviewGate,
	type GateTargetV1,
	type ReleaseFastPathEvidenceV1,
	type ReviewBudgetV1,
	type ReviewReducerInput,
	type ReviewTransition,
} from "../lib/review-transaction.ts";
import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	captureReviewSnapshot,
	type ReviewMode,
	type ReviewProjectionV1,
} from "../lib/review-snapshot.ts";
import { sanitizeTerminalText, stripAnsi } from "../lib/terminal-theme.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");

function gentlePiAgentHome(): string {
	return process.env.GENTLE_PI_AGENT_HOME ?? join(homedir(), ".pi", "agent");
}

function sddGlobalAssetDriftCount(): number {
	let stale = 0;
	for (const [assetSubdir, installedSubdir, ownershipPrefix] of [
		["agents", "agents", "agents"],
		["chains", "chains", "chains"],
		["support", join("gentle-ai", "support"), "gentle-ai/support"],
	] as const) {
		const assetDir = join(ASSETS_DIR, assetSubdir);
		if (!existsSync(assetDir)) continue;
		for (const entry of readdirSync(assetDir, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			const installedPath = join(gentlePiAgentHome(), installedSubdir, entry.name);
			try {
				if (!existsSync(installedPath)) {
					stale += 1;
					continue;
				}
				if (
					!isPackageManagedSddAsset(
						installedPath,
						`${ownershipPrefix}/${entry.name}`,
					)
				) {
					continue;
				}
				const packaged = readFileSync(join(assetDir, entry.name), "utf8");
				const installed = readFileSync(installedPath, "utf8");
				const comparablePackaged =
					assetSubdir === "agents"
						? updateFrontmatterRouting(packaged, undefined)
						: packaged;
				const comparableInstalled =
					assetSubdir === "agents"
						? updateFrontmatterRouting(installed, undefined)
						: installed;
				if (comparablePackaged !== comparableInstalled) {
					stale += 1;
				}
			} catch {
				stale += 1;
			}
		}
	}
	return stale;
}

function sddLocalAgentOverrideCount(cwd: string): number {
	const packageSddAgentsDir = join(ASSETS_DIR, "agents");
	const packageSddAgentNames = existsSync(packageSddAgentsDir)
		? new Set(
				readdirSync(packageSddAgentsDir, { withFileTypes: true })
					.filter((entry) => entry.isFile() && /^sdd-.*\.md$/i.test(entry.name))
					.map((entry) => entry.name),
			)
		: new Set<string>();
	let count = 0;
	for (const installedDir of [
		join(cwd, ".pi", "agents"),
		join(cwd, ".pi", "subagents"),
	]) {
		if (!existsSync(installedDir)) continue;
		for (const entry of readdirSync(installedDir, { withFileTypes: true })) {
			if (entry.isFile() && packageSddAgentNames.has(entry.name)) count += 1;
		}
	}
	return count;
}

let orchestratorPromptCache: string | null = null;
function getOrchestratorPrompt(): string {
	if (orchestratorPromptCache === null) {
		orchestratorPromptCache = renderOrchestratorPrompt(ASSETS_DIR);
	}
	return orchestratorPromptCache;
}

function renderOrchestratorPrompt(assetsDir: string): string {
	return readFileSync(join(assetsDir, "orchestrator.md"), "utf8")
		.replaceAll(
			"{{GENTLE_PI_SDD_WORKFLOW_PATH}}",
			join(assetsDir, "sdd-orchestrator-workflow.md"),
		)
		.replaceAll(
			"{{GENTLE_PI_DELEGATION_PATH}}",
			join(assetsDir, "orchestrator-delegation.md"),
		)
		.replaceAll(
			"{{GENTLE_PI_MEMORY_PATH}}",
			join(assetsDir, "orchestrator-memory.md"),
		)
		.replaceAll(
			"{{GENTLE_PI_SKILLS_PATH}}",
			join(assetsDir, "orchestrator-skills.md"),
		)
		.trim();
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

type PersonaMode = "gentleman" | "neutral";

const PERSONA_OPTIONS = ["gentleman", "neutral"] as const;

const GENTLEMAN_PERSONA_PROMPT = `Persona:
- Be direct, technical, and concise.
- Always respond in the same language the user writes in.
- When the user writes Spanish, answer in natural Rioplatense Spanish with voseo.
- Act as a senior architect and teacher: concepts before code, no shortcuts.
- Treat AI as a tool directed by the human; never present yourself as a default chatbot.
- Push back when the user asks for code without enough context or understanding.
- Correct errors directly, explain why, and show the better path.`;

const NEUTRAL_PERSONA_PROMPT = `Persona:
- Be direct, technical, concise, warm, and professional.
- Always respond in the same language the user writes in.
- Do not use slang or regional expressions.
- When the user writes Spanish, use neutral/professional Spanish. Do NOT use voseo (vos tenés, vos querés, hacé, andá, etc.) or any regional conjugations.
- Act as a senior architect and teacher: concepts before code, no shortcuts.
- Treat AI as a tool directed by the human; never present yourself as a default chatbot.
- Push back when the user asks for code without enough context or understanding.
- Correct errors directly, explain why, and show the better path.`;

function buildGentlePrompt(persona: PersonaMode): string {
	const personaPrompt =
		persona === "neutral" ? NEUTRAL_PERSONA_PROMPT : GENTLEMAN_PERSONA_PROMPT;
	const languageBoundary =
		persona === "neutral"
			? "Language: neutral/professional Spanish when the user writes Spanish. Do NOT use voseo or Rioplatense regional expressions."
			: "Language: natural Rioplatense Spanish with voseo when the user writes Spanish.";
	return `## el Gentleman Identity and Harness

Current persona mode: ${persona}

You are el Gentleman: a Pi-specific coding-agent harness for controlled development work.

Identity contract:
- When the user asks who or what you are, answer as el Gentleman, not as a generic assistant, and never introduce yourself as only "your assistant" or "the default assistant". Convey this meaning, translated into the user's language: "I am el Gentleman: a Pi-specific coding-agent harness for controlled development, with a senior architect persona. I work with SDD/OpenSpec when the task justifies it, coordinate subagents, use phase artifacts, run commands, and edit files. I am not a generic chatbot."
- Follow the currently selected persona mode.
- Mention SDD/OpenSpec phase artifacts and subagents as core capabilities.
- Mention memory only when memory packages or callable memory tools are actually active; never invent persistent memory.
- Do not claim portability outside the Pi runtime.

${personaPrompt}

${languageBoundary}

Harness principles:
- el Gentleman is not prompt engineering. It is runtime discipline around powerful agents.
- Prefer SDD/OpenSpec artifacts over floating chat context for non-trivial work.
- Clarify scope, constraints, acceptance criteria, and non-goals before implementation.
- Use subagents when available for exploration, planning, implementation, and review, while keeping one parent session responsible for orchestration.
- Keep writes single-threaded unless the user explicitly approves parallel write isolation.
- If tests exist, use strict TDD evidence: RED, GREEN, TRIANGULATE, REFACTOR.
- Protect the human reviewer: avoid oversized changes, surface review workload risk, and ask before turning one task into a large multi-area change.
- Never claim persistent memory is available because of this package. Memory is provided by separate packages or MCP tools when installed and callable.

${getOrchestratorPrompt()}`;
}

// Matches `git [global-flags] push` — tolerates flags like -C /repo or --work-tree=/tmp
// between `git` and the subcommand. Short flags may be followed by a separate value token.
const GIT_GLOBAL_FLAGS_SRC = String.raw`(?:\s+--?\S+(?:\s+[^-\s]\S*)?)* `;
const GIT_PUSH_RE = new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}push\b`);

const DENIED_BASH_PATTERNS: RegExp[] = [
	// Block rm -rf targeting /, ~ or ~/subdir, $HOME or $HOME/subdir, .. or .
	/\brm\s+-rf\s+(?:\/(?:\s|$)|~(?:\/|\s|$)|[$]HOME(?:\/|\s|$)|\.\.?(?:\s|$))/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	// Force-push deny: tolerates git global flags (e.g. -C /repo) before the subcommand
	new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}push\b(?=[^\n]*\s--force(?:-with-lease)?\b)`),
	new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}push\b(?=[^\n]*\s-[^\s-]*f)`),
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

// ---------------------------------------------------------------------------
// Autonomous guard — runtime guardrails config
// ---------------------------------------------------------------------------

const GUARD_ACTION = {
	ALLOW: "allow",
	CONFIRM: "confirm",
	BLOCK: "block",
} as const;

type GuardAction = (typeof GUARD_ACTION)[keyof typeof GUARD_ACTION];
type GuardClassification = GuardAction | "not-guarded";

const GUARDED_COMMAND_KEY = {
	GIT_PUSH: "gitPush",
	GIT_REBASE: "gitRebase",
	GIT_BRANCH_DELETE_FORCE: "gitBranchDeleteForce",
	NPM_PUBLISH: "npmPublish",
	PI_REMOVE: "piRemove",
} as const;

type GuardedCommandKey = (typeof GUARDED_COMMAND_KEY)[keyof typeof GUARDED_COMMAND_KEY];

type GuardedCommandsConfig = Partial<Record<GuardedCommandKey, GuardAction>>;

interface RuntimeGuardrailsConfig {
	autonomousMode: boolean;
	guardedCommands: GuardedCommandsConfig;
}

interface LoadGuardrailsOptions {
	/** Override the config home directory (used in tests to avoid touching ~/.pi). */
	gentlePiConfigHome?: string;
}

const GUARDED_KEY_PATTERNS: Record<GuardedCommandKey, RegExp> = {
	gitPush: GIT_PUSH_RE,
	gitRebase: /\bgit\s+rebase\b/,
	gitBranchDeleteForce: /\bgit\s+branch\s+(?:-[a-zA-Z]*D[a-zA-Z]*|-[a-zA-Z]*d[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*d[a-zA-Z]*|--delete\b[^\n]*--force\b|--force\b[^\n]*--delete\b)/,
	npmPublish: /\bnpm\s+publish\b/,
	piRemove: /\bpi\s+remove\b/,
};

const AUTONOMOUS_DEFAULT_ACTIONS: Record<GuardedCommandKey, GuardAction> = {
	gitPush: "allow",
	gitRebase: "confirm",
	gitBranchDeleteForce: "confirm",
	npmPublish: "block",
	piRemove: "confirm",
};

const SAFE_GUARDRAILS_CONFIG: RuntimeGuardrailsConfig = {
	autonomousMode: false,
	guardedCommands: {},
};

/**
 * Classify a shell command under the runtime guard policy.
 *
 * Ordering (non-negotiable):
 *   1. Hard-deny patterns → "block" (always, cannot be overridden by config)
 *   2. If autonomousMode is false → mirror the legacy CONFIRM_BASH_PATTERNS result
 *   3. If autonomousMode is true → use configured GuardAction for the matched key
 *      (applying AUTONOMOUS_DEFAULT_ACTIONS for any key not set in guardedCommands)
 *   4. No match → "not-guarded"
 */
function classifyGuardedCommand(
	command: string,
	config: RuntimeGuardrailsConfig,
): GuardClassification {
	// Step 1: hard-deny always wins, regardless of any config
	for (const pattern of DENIED_BASH_PATTERNS) {
		if (pattern.test(command)) return "block";
	}

	// Step 2 & 3: find which guarded key (if any) this command matches
	for (const [key, pattern] of Object.entries(GUARDED_KEY_PATTERNS) as [GuardedCommandKey, RegExp][]) {
		if (!pattern.test(command)) continue;

		// Matched a guarded key
		if (!config.autonomousMode) {
			// Legacy behavior: any match → confirm
			return "confirm";
		}

		// Autonomous mode: use configured action, fall back to sensible defaults
		const configuredAction = config.guardedCommands[key];
		return configuredAction ?? AUTONOMOUS_DEFAULT_ACTIONS[key];
	}

	return "not-guarded";
}

function parseGuardrailsConfigFile(
	raw: string,
): RuntimeGuardrailsConfig | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;

	const autonomousMode = parsed.autonomousMode === true;

	const rawCommands = isRecord(parsed.guardedCommands) ? parsed.guardedCommands : {};
	const guardedCommands: GuardedCommandsConfig = {};
	const validActions = new Set<string>(["allow", "confirm", "block"]);
	for (const [key, value] of Object.entries(rawCommands)) {
		if (
			typeof value === "string" &&
			validActions.has(value) &&
			Object.values(GUARDED_COMMAND_KEY).includes(key as GuardedCommandKey)
		) {
			guardedCommands[key as GuardedCommandKey] = value as GuardAction;
		}
	}

	return { autonomousMode, guardedCommands };
}

/**
 * Load the runtime guardrails config.
 *
 * Resolution order (project overrides global):
 *   1. Check GENTLE_PI_AUTONOMOUS_MODE env var — if "1", forces autonomousMode=true
 *      and uses default guarded command actions.
 *   2. Read global config from ${gentlePiConfigHome}/runtime-guardrails.json
 *   3. Read project config from ${cwd}/.pi/gentle-ai/runtime-guardrails.json
 *      (project values are merged on top of global)
 *   4. Any parse/read error anywhere → fail safe (return SAFE_GUARDRAILS_CONFIG)
 */
function loadRuntimeGuardrailsConfig(
	cwd: string,
	options: LoadGuardrailsOptions = {},
): RuntimeGuardrailsConfig {
	try {
		// Env var override: forces autonomous mode with default actions
		if (process.env.GENTLE_PI_AUTONOMOUS_MODE === "1") {
			return { autonomousMode: true, guardedCommands: {} };
		}

		const configHome = options.gentlePiConfigHome ?? gentleAiConfigHome();
		const globalConfigPath = join(configHome, "runtime-guardrails.json");
		const projectConfigPath = join(cwd, ".pi", "gentle-ai", "runtime-guardrails.json");

		let merged: RuntimeGuardrailsConfig = { autonomousMode: false, guardedCommands: {} };

		if (existsSync(globalConfigPath)) {
			const globalParsed = parseGuardrailsConfigFile(
				readFileSync(globalConfigPath, "utf8"),
			);
			if (!globalParsed) return SAFE_GUARDRAILS_CONFIG;
			merged = globalParsed;
		}

		if (existsSync(projectConfigPath)) {
			const projectParsed = parseGuardrailsConfigFile(
				readFileSync(projectConfigPath, "utf8"),
			);
			if (!projectParsed) return SAFE_GUARDRAILS_CONFIG;
			// Project values fully override global values
			merged = {
				autonomousMode: projectParsed.autonomousMode,
				guardedCommands: {
					...merged.guardedCommands,
					...projectParsed.guardedCommands,
				},
			};
		}

		return merged;
	} catch {
		return SAFE_GUARDRAILS_CONFIG;
	}
}

const PATH_GUARDED_TOOL_NAMES = new Set(["read", "write", "edit"]);
const PATH_INPUT_KEYS = new Set([
	"path",
	"paths",
	"file",
	"files",
	"filePath",
	"filePaths",
]);
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
	/(^|\/)\.ssh(?:\/|$)/,
	/(^|\/)\.credentials(?:\/|$)/,
	/(^|\/)library\/keychains(?:\/|$)/,
	/(^|\/)\.aws\/credentials$/,
	/(^|\/)\.config\/gh\/hosts\.ya?ml$/,
	/(^|\/)secrets(?:\/|$)/,
	/(^|\/)\.env(?:$|[./_-])/,
	/\.(?:pem|key|p12|pfx)$/,
];

const SDD_AGENT_NAMES = [
	"sdd-init",
	"sdd-onboard",
	"sdd-explore",
	"sdd-proposal",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-status",
	"sdd-apply",
	"sdd-verify",
	"sdd-sync",
	"sdd-archive",
] as const;
const SDD_AGENT_NAME_SET = new Set<string>(SDD_AGENT_NAMES);

const JUDGMENT_DAY_AGENT_NAMES = [
	"jd-judge-a",
	"jd-judge-b",
	"jd-fix-agent",
] as const;

const CORE_MODEL_AGENT_NAMES = [
	...SDD_AGENT_NAMES,
	...JUDGMENT_DAY_AGENT_NAMES,
] as const;
const CORE_MODEL_AGENT_NAME_SET = new Set<string>(CORE_MODEL_AGENT_NAMES);

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
interface AgentRoutingEntry {
	model?: string;
	thinking?: ThinkingLevel;
}
type AgentModelConfig = Record<string, AgentRoutingEntry>;
type ModelConfigFileResult =
	| { status: "missing" }
	| { status: "invalid"; path: string }
	| { status: "valid"; config: AgentModelConfig };
type AgentSource = "project" | "user" | "builtin";

interface AgentEntry {
	name: string;
	source: AgentSource;
	filePath?: string;
}

const KEEP_CURRENT = "Keep current";
const INHERIT_MODEL = "Inherit active/default model";
const CUSTOM_MODEL = "Custom model id";
const INHERIT_THINKING = "Inherit effort";
const THINKING_OPTIONS: (ThinkingLevel | typeof INHERIT_THINKING)[] = [
	INHERIT_THINKING,
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

const MODEL_CONTROL_OPTIONS = [
	KEEP_CURRENT,
	INHERIT_MODEL,
	CUSTOM_MODEL,
] as const;
const MODEL_PANEL_MAX_RENDER_ROWS = 20;
const AGENT_LIST_MAX_VISIBLE_ROWS = MODEL_PANEL_MAX_RENDER_ROWS - 13;
const MODEL_LIST_MAX_VISIBLE_ROWS = 12;

function readStringPath(value: unknown, path: string[]): string | undefined {
	let current = value;
	for (const key of path) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return typeof current === "string" ? current : undefined;
}

function isSddAgentStartEvent(event: unknown): boolean {
	const candidates = readAgentStartNames(event);
	if (candidates.some((value) => SDD_AGENT_NAME_SET.has(value))) return true;

	const systemPrompt = readStringPath(event, ["systemPrompt"]) ?? "";
	return SDD_AGENT_NAMES.some((name) => {
		const phase = name.replace(/^sdd-/, "");
		return new RegExp(`\\bSDD ${phase} executor\\b`, "i").test(systemPrompt);
	});
}

function readAgentStartNames(event: unknown): string[] {
	return [
		readStringPath(event, ["agentName"]),
		readStringPath(event, ["agent"]),
		readStringPath(event, ["name"]),
		readStringPath(event, ["agent", "name"]),
		readStringPath(event, ["subagent", "name"]),
	]
		.filter((value): value is string => value !== undefined)
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function isNamedAgentStartEvent(event: unknown): boolean {
	return readAgentStartNames(event).length > 0;
}

function sddPhaseFromAgentStartEvent(event: unknown): SddPhase | undefined {
	for (const name of readAgentStartNames(event)) {
		if (name === "sdd-apply") return "apply";
		if (name === "sdd-verify") return "verify";
		if (name === "sdd-sync") return "sync";
		if (name === "sdd-archive") return "archive";
	}
	const systemPrompt = readStringPath(event, ["systemPrompt"]) ?? "";
	if (/\bSDD apply executor\b/i.test(systemPrompt)) return "apply";
	if (/\bSDD verify executor\b/i.test(systemPrompt)) return "verify";
	if (/\bSDD sync executor\b/i.test(systemPrompt)) return "sync";
	if (/\bSDD archive executor\b/i.test(systemPrompt)) return "archive";
	return undefined;
}

function normalizePolicyPath(value: string): string {
	return value.trim().replace(/^~(?=\/|$)/, homedir()).replace(/\\/g, "/").toLowerCase();
}

function isSensitivePath(value: string): boolean {
	const normalized = normalizePolicyPath(value);
	return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function collectPathInputs(value: unknown, key?: string): string[] {
	if (typeof value === "string") return key && PATH_INPUT_KEYS.has(key) ? [value] : [];
	if (Array.isArray(value)) return value.flatMap((item) => collectPathInputs(item, key));
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([entryKey, entryValue]) =>
		collectPathInputs(entryValue, entryKey),
	);
}

function hasWritableEngramTool(pi: ExtensionAPI): boolean {
	try {
		const getActiveTools = (pi as unknown as { getActiveTools?: () => unknown[] })
			.getActiveTools;
		if (typeof getActiveTools !== "function") return false;
		const tools = getActiveTools.call(pi);
		return tools.some((tool) => {
			const name =
				typeof tool === "string"
					? tool
					: isRecord(tool) && typeof tool.name === "string"
						? tool.name
						: "";
			return name === "mem_save" || name.endsWith(".mem_save");
		});
	} catch {
		return false;
	}
}

function evaluateSensitivePathTool(
	toolName: string,
	input: unknown,
): ToolCallEventResult | undefined {
	if (!PATH_GUARDED_TOOL_NAMES.has(toolName)) return undefined;
	const sensitivePath = collectPathInputs(input).find(isSensitivePath);
	if (!sensitivePath) return undefined;
	return {
		block: true,
		reason: `Gentle AI safety policy blocked access to sensitive path: ${sanitizeTerminalText(sensitivePath)}. Ask the user for an explicit safer plan.`,
	};
}

async function confirmCommand(
	command: string,
	ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
	const guardrailsConfig = loadRuntimeGuardrailsConfig(ctx.cwd);
	const classification = classifyGuardedCommand(command, guardrailsConfig);

	if (classification === "block") {
		return {
			block: true,
			reason:
				"Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
		};
	}

	if (classification === "not-guarded") return undefined;

	// classification is "allow" or "confirm" from this point on
	if (classification === "allow") return undefined;

	// classification === "confirm"
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gentleAiConfigHome(): string {
	return process.env.GENTLE_PI_CONFIG_HOME ?? join(homedir(), ".pi", "gentle-ai");
}

function modelConfigPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "models.json");
}

function modelExportPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "models.export.json");
}

const MODEL_EXPORT_KIND = "gentle-pi.agent_model_routing";
const MODEL_EXPORT_VERSION = 1;

function legacyProjectModelConfigPath(cwd: string): string {
	return join(cwd, ".pi", "gentle-ai", "models.json");
}

function projectPersonaConfigPath(cwd: string): string {
	return join(cwd, ".pi", "gentle-ai", "persona.json");
}

function personaConfigPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "persona.json");
}

function readPersonaFile(path: string): PersonaMode | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return undefined;
		return parsed.mode === "neutral" ? "neutral" : "gentleman";
	} catch {
		return undefined;
	}
}

function readPersonaMode(cwd: string): PersonaMode {
	return (
		readPersonaFile(projectPersonaConfigPath(cwd)) ??
		readPersonaFile(personaConfigPath(cwd)) ??
		"gentleman"
	);
}

function writePersonaMode(cwd: string, mode: PersonaMode): string[] {
	const paths = [personaConfigPath(cwd)];
	const projectPath = projectPersonaConfigPath(cwd);
	if (existsSync(projectPath)) paths.push(projectPath);
	for (const path of paths) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify({ mode }, null, 2)}\n`);
	}
	return paths;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}

const SAFE_MODEL_ID_PATTERN = /^[A-Za-z0-9._~:@/+%-]+$/;

function normalizeModelId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const model = value.trim();
	if (model.length === 0) return undefined;
	if (!SAFE_MODEL_ID_PATTERN.test(model)) return undefined;
	return model;
}

function normalizeRoutingEntry(value: unknown): AgentRoutingEntry | undefined {
	if (typeof value === "string") {
		const model = normalizeModelId(value);
		return model ? { model } : undefined;
	}
	if (!isRecord(value)) return undefined;
	const model = normalizeModelId(value.model);
	const thinking = isThinkingLevel(value.thinking) ? value.thinking : undefined;
	if (!model && !thinking) {
		return Object.keys(value).length === 0 ? {} : undefined;
	}
	return { model, thinking };
}

function readModelConfigFile(path: string): ModelConfigFileResult {
	if (!existsSync(path)) return { status: "missing" };
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return { status: "invalid", path };
		const config: AgentModelConfig = {};
		for (const [name, value] of Object.entries(parsed)) {
			const entry = normalizeRoutingEntry(value);
			if (entry) config[name] = entry;
		}
		return { status: "valid", config };
	} catch {
		return { status: "invalid", path };
	}
}

async function readModelConfigFileAsync(
	path: string,
): Promise<ModelConfigFileResult> {
	if (!(await pathExists(path))) return { status: "missing" };
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isRecord(parsed)) return { status: "invalid", path };
		const config: AgentModelConfig = {};
		for (const [name, value] of Object.entries(parsed)) {
			const entry = normalizeRoutingEntry(value);
			if (entry) config[name] = entry;
		}
		return { status: "valid", config };
	} catch {
		return { status: "invalid", path };
	}
}

function readSavedModelConfig(cwd: string): ModelConfigFileResult {
	const globalResult = readModelConfigFile(modelConfigPath(cwd));
	if (globalResult.status !== "missing") return globalResult;
	const legacyResult = readModelConfigFile(legacyProjectModelConfigPath(cwd));
	if (legacyResult.status === "invalid") return { status: "valid", config: {} };
	return legacyResult;
}

async function readSavedModelConfigAsync(
	cwd: string,
): Promise<ModelConfigFileResult> {
	const globalResult = await readModelConfigFileAsync(modelConfigPath(cwd));
	if (globalResult.status !== "missing") return globalResult;
	const legacyResult = await readModelConfigFileAsync(
		legacyProjectModelConfigPath(cwd),
	);
	if (legacyResult.status === "invalid") return { status: "valid", config: {} };
	return legacyResult;
}

export function readModelConfig(cwd: string): AgentModelConfig {
	const result = readSavedModelConfig(cwd);
	return result.status === "valid" ? result.config : {};
}

export async function readModelConfigAsync(
	cwd: string,
): Promise<AgentModelConfig> {
	const result = await readSavedModelConfigAsync(cwd);
	return result.status === "valid" ? result.config : {};
}

function normalizeModelConfig(value: unknown): AgentModelConfig | undefined {
	if (!isRecord(value)) return undefined;
	const cleaned: AgentModelConfig = {};
	for (const [name, entryValue] of Object.entries(value)) {
		if (!/^[A-Za-z0-9._:@/+%-]+$/.test(name)) continue;
		const entry = normalizeRoutingEntry(entryValue);
		if (entry) cleaned[name] = entry;
	}
	return cleaned;
}

function writeModelConfig(cwd: string, config: AgentModelConfig): void {
	const path = modelConfigPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const cleaned = normalizeModelConfig(config) ?? {};
	writeFileSync(path, `${JSON.stringify(cleaned, null, 2)}\n`);
}

async function writeModelConfigAsync(cwd: string, config: AgentModelConfig): Promise<void> {
	const path = modelConfigPath(cwd);
	await mkdir(dirname(path), { recursive: true });
	const cleaned = normalizeModelConfig(config) ?? {};
	await writeFile(path, `${JSON.stringify(cleaned, null, 2)}\n`);
}

function parseModelExport(value: unknown): AgentModelConfig | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind !== MODEL_EXPORT_KIND || value.version !== MODEL_EXPORT_VERSION) return undefined;
	return normalizeModelConfig(value.agents);
}

async function exportSavedModelConfig(ctx: ExtensionContext): Promise<number> {
	const saved = await readSavedModelConfigAsync(ctx.cwd);
	if (saved.status === "invalid") throw new Error(`Invalid model config: ${saved.path}`);
	const agents = saved.status === "valid" ? saved.config : {};
	const path = modelExportPath(ctx.cwd);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({ kind: MODEL_EXPORT_KIND, version: MODEL_EXPORT_VERSION, agents }, null, 2)}\n`,
	);
	return Object.keys(agents).length;
}

async function readModelExport(ctx: ExtensionContext): Promise<AgentModelConfig | undefined> {
	try {
		return parseModelExport(JSON.parse(await readFile(modelExportPath(ctx.cwd), "utf8")));
	} catch {
		return undefined;
	}
}

function cloneModelConfig(config: AgentModelConfig): AgentModelConfig {
	return Object.fromEntries(
		Object.entries(config).map(([name, entry]) => [name, { ...entry }]),
	);
}

function updateFrontmatterRouting(
	content: string,
	entry: AgentRoutingEntry | undefined,
): string {
	if (!content.startsWith("---\n")) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter
		.split("\n")
		.filter(
			(line) => !line.startsWith("model:") && !line.startsWith("thinking:"),
		);
	const toInsert: string[] = [];
	if (entry?.model) toInsert.push(`model: ${entry.model}`);
	if (entry?.thinking) toInsert.push(`thinking: ${entry.thinking}`);
	if (toInsert.length > 0) {
		const descriptionIndex = lines.findIndex((line) =>
			line.startsWith("description:"),
		);
		const insertIndex =
			descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, ...toInsert);
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

async function parseAgentNameAsync(
	filePath: string,
): Promise<string | undefined> {
	let content: string;
	try {
		content = await readFile(filePath, "utf8");
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
		if (entry.isDirectory()) {
			if (entry.name === "skills") continue;
			files.push(...listAgentFilesRecursive(path));
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			!entry.name.endsWith(".chain.md")
		)
			files.push(path);
	}
	return files;
}

async function listAgentFilesRecursiveAsync(dir: string): Promise<string[]> {
	if (!(await pathExists(dir))) return [];
	const files: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "skills") continue;
			files.push(...(await listAgentFilesRecursiveAsync(path)));
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			!entry.name.endsWith(".chain.md")
		) {
			files.push(path);
		}
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

async function listAgentsFromDirAsync(
	dir: string,
	source: AgentSource,
): Promise<AgentEntry[]> {
	const filePaths = await listAgentFilesRecursiveAsync(dir);
	const entries: AgentEntry[] = [];
	for (const filePath of filePaths) {
		const name = await parseAgentNameAsync(filePath);
		if (name) entries.push({ name, source, filePath });
	}
	return entries;
}

function builtinAgentDirs(cwd: string): string[] {
	return [
		join(PACKAGE_ROOT, "..", "pi-subagents-j0k3r", "agents"),
		join(cwd, ".pi", "npm", "node_modules", "pi-subagents-j0k3r", "agents"),
		join(homedir(), ".local", "lib", "node_modules", "pi-subagents-j0k3r", "agents"),
		join(PACKAGE_ROOT, "..", "pi-subagents", "agents"),
		join(cwd, ".pi", "npm", "node_modules", "pi-subagents", "agents"),
		join(homedir(), ".local", "lib", "node_modules", "pi-subagents", "agents"),
	];
}

function listBuiltinAgentNames(cwd: string): Set<string> {
	return new Set(
		builtinAgentDirs(cwd).flatMap((dir) =>
			listAgentsFromDir(dir, "builtin").map((agent) => agent.name),
		),
	);
}

async function listBuiltinAgentNamesAsync(cwd: string): Promise<Set<string>> {
	const names = new Set<string>();
	for (const dir of builtinAgentDirs(cwd)) {
		for (const agent of await listAgentsFromDirAsync(dir, "builtin")) {
			names.add(agent.name);
		}
	}
	return names;
}

function listDiscoverableAgents(cwd: string): AgentEntry[] {
	const globalAgentHome = gentlePiAgentHome();
	const builtinDirs = builtinAgentDirs(cwd);
	const agents = [
		...builtinDirs.flatMap((dir) => listAgentsFromDir(dir, "builtin")),
		...listAgentsFromDir(join(globalAgentHome, "agents"), "user"),
		...listAgentsFromDir(join(globalAgentHome, "subagents"), "user"),
		...listAgentsFromDir(join(homedir(), ".agents"), "user"),
		...listAgentsFromDir(join(cwd, ".agents"), "project"),
		...listAgentsFromDir(join(cwd, ".pi", "agents"), "project"),
		...listAgentsFromDir(join(cwd, ".pi", "subagents"), "project"),
	];
	const byName = new Map<string, AgentEntry>();
	for (const agent of agents) byName.set(agent.name, agent);
	return orderDiscoverableAgents(Array.from(byName.values()));
}

async function listDiscoverableAgentsAsync(cwd: string): Promise<AgentEntry[]> {
	const globalAgentHome = gentlePiAgentHome();
	const builtinDirs = builtinAgentDirs(cwd);
	const agents: AgentEntry[] = [];
	for (const dir of builtinDirs) {
		agents.push(...(await listAgentsFromDirAsync(dir, "builtin")));
	}
	const otherDirs: Array<[string, AgentSource]> = [
		[join(globalAgentHome, "agents"), "user"],
		[join(globalAgentHome, "subagents"), "user"],
		[join(homedir(), ".agents"), "user"],
		[join(cwd, ".agents"), "project"],
		[join(cwd, ".pi", "agents"), "project"],
		[join(cwd, ".pi", "subagents"), "project"],
	];
	for (const [dir, source] of otherDirs) {
		agents.push(...(await listAgentsFromDirAsync(dir, source)));
	}
	const byName = new Map<string, AgentEntry>();
	for (const agent of agents) byName.set(agent.name, agent);
	return orderDiscoverableAgents(Array.from(byName.values()));
}

function orderDiscoverableAgents(agents: AgentEntry[]): AgentEntry[] {
	const coreFirst = CORE_MODEL_AGENT_NAMES.map((name) =>
		agents.find((agent) => agent.name === name),
	).filter((agent): agent is AgentEntry => agent !== undefined);
	const rest = agents
		.filter((agent) => !CORE_MODEL_AGENT_NAME_SET.has(agent.name))
		.sort((left, right) => left.name.localeCompare(right.name));
	return [...coreFirst, ...rest];
}

function isClearRoutingEntry(entry: AgentRoutingEntry): boolean {
	return entry.model === undefined && entry.thinking === undefined;
}

function agentModelProfileConfigPath(cwd: string, source: AgentSource): string {
	return source === "project"
		? join(cwd, ".pi", "subagents.json")
		: join(gentlePiAgentHome(), "subagents.json");
}

function modelProfileForRoutingEntry(
	entry: AgentRoutingEntry | undefined,
): Record<string, string> | undefined {
	if (!entry || isClearRoutingEntry(entry)) return undefined;
	const profile: Record<string, string> = {};
	if (entry.model) profile.model = entry.model;
	if (entry.thinking) profile.effort = entry.thinking;
	return Object.keys(profile).length > 0 ? profile : undefined;
}

function updateSubagentModelProfileAtPath(
	path: string,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): boolean {
	let config: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (isRecord(parsed)) config = { ...parsed };
		} catch {
			config = {};
		}
	}
	const modelProfiles = isRecord(config.model_profiles)
		? { ...config.model_profiles }
		: {};
	const profile = modelProfileForRoutingEntry(entry);
	if (profile) {
		if (options.preserveExisting && isRecord(modelProfiles[name])) return false;
		modelProfiles[name] = profile;
	} else delete modelProfiles[name];
	if (Object.keys(modelProfiles).length > 0) config.model_profiles = modelProfiles;
	else delete config.model_profiles;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
	return true;
}

async function updateSubagentModelProfileAtPathAsync(
	path: string,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): Promise<boolean> {
	let config: Record<string, unknown> = {};
	if (await pathExists(path)) {
		try {
			const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
			if (isRecord(parsed)) config = { ...parsed };
		} catch {
			config = {};
		}
	}
	const modelProfiles = isRecord(config.model_profiles)
		? { ...config.model_profiles }
		: {};
	const profile = modelProfileForRoutingEntry(entry);
	if (profile) {
		if (options.preserveExisting && isRecord(modelProfiles[name])) return false;
		modelProfiles[name] = profile;
	} else delete modelProfiles[name];
	if (Object.keys(modelProfiles).length > 0) config.model_profiles = modelProfiles;
	else delete config.model_profiles;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
	return true;
}

function updateSubagentModelProfile(
	cwd: string,
	source: AgentSource,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): boolean {
	return updateSubagentModelProfileAtPath(
		agentModelProfileConfigPath(cwd, source),
		name,
		entry,
		options,
	);
}

function projectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

function removeLegacyAgentOverridesFromSettings(
	settingsPath: string,
	settings: Record<string, unknown>,
): void {
	const subagents = isRecord(settings.subagents)
		? { ...settings.subagents }
		: undefined;
	if (!subagents) return;
	delete subagents.agentOverrides;
	if (Object.keys(subagents).length > 0) settings.subagents = subagents;
	else delete settings.subagents;
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function isValidJsonObjectFileOrMissing(path: string): boolean {
	if (!existsSync(path)) return true;
	try {
		return isRecord(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return false;
	}
}

function migrateLegacyProjectModelOverrides(cwd: string): number {
	const settingsPath = projectSettingsPath(cwd);
	if (!existsSync(settingsPath)) return 0;
	let settings: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
		if (!isRecord(parsed)) return 0;
		settings = { ...parsed };
	} catch {
		return 0;
	}
	const subagents = isRecord(settings.subagents) ? settings.subagents : undefined;
	const agentOverrides = isRecord(subagents?.agentOverrides)
		? subagents.agentOverrides
		: undefined;
	if (!agentOverrides) return 0;
	const agentsByName = new Map(listDiscoverableAgents(cwd).map((agent) => [agent.name, agent]));
	const migratableEntries = Object.entries(agentOverrides)
		.map(([name, value]) => ({ name, entry: normalizeRoutingEntry(value) }))
		.filter((item): item is { name: string; entry: AgentRoutingEntry } =>
			item.entry !== undefined && !isClearRoutingEntry(item.entry),
		);
	const targetPaths = new Set(
		migratableEntries.map(({ name }) =>
			agentModelProfileConfigPath(cwd, agentsByName.get(name)?.source ?? "project"),
		),
	);
	if (![...targetPaths].every(isValidJsonObjectFileOrMissing)) return 0;
	let migrated = 0;
	for (const { name, entry } of migratableEntries) {
		const source = agentsByName.get(name)?.source ?? "project";
		if (updateSubagentModelProfile(cwd, source, name, entry, { preserveExisting: true })) migrated += 1;
	}
	removeLegacyAgentOverridesFromSettings(settingsPath, settings);
	return migrated;
}

async function updateSubagentModelProfileAsync(
	cwd: string,
	source: AgentSource,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): Promise<boolean> {
	return updateSubagentModelProfileAtPathAsync(
		agentModelProfileConfigPath(cwd, source),
		name,
		entry,
		options,
	);
}

export function applyModelConfig(
	cwd: string,
	config: AgentModelConfig,
): { updated: number; skipped: number } {
	let updated = 0;
	let skipped = 0;
	const seenAgents = new Set<string>();
	for (const agent of listDiscoverableAgents(cwd)) {
		seenAgents.add(agent.name);
		const entry = config[agent.name];
		if (entry === undefined) {
			skipped += 1;
			continue;
		}
		if (updateSubagentModelProfile(cwd, agent.source, agent.name, entry)) updated += 1;
		else skipped += 1;
		if (agent.source === "builtin") continue;
		if (!agent.filePath || !existsSync(agent.filePath)) {
			skipped += 1;
			continue;
		}
		const original = readFileSync(agent.filePath, "utf8");
		const next = updateFrontmatterRouting(original, entry);
		if (next === original) {
			skipped += 1;
			continue;
		}
		writeFileSync(agent.filePath, next);
		updatePackageManagedSddAgentOwnership(agent.filePath, original, next);
		updated += 1;
	}
	for (const [name, entry] of Object.entries(config)) {
		if (!seenAgents.has(name) && isClearRoutingEntry(entry)) {
			if (updateSubagentModelProfile(cwd, "user", name, entry)) updated += 1;
			else skipped += 1;
		}
	}
	return { updated, skipped };
}

export async function applyModelConfigAsync(
	cwd: string,
	config: AgentModelConfig,
): Promise<{ updated: number; skipped: number }> {
	let updated = 0;
	let skipped = 0;
	const seenAgents = new Set<string>();
	for (const agent of await listDiscoverableAgentsAsync(cwd)) {
		seenAgents.add(agent.name);
		const entry = config[agent.name];
		if (entry === undefined) {
			skipped += 1;
			continue;
		}
		if (await updateSubagentModelProfileAsync(cwd, agent.source, agent.name, entry))
			updated += 1;
		else skipped += 1;
		if (agent.source === "builtin") continue;
		if (!agent.filePath || !(await pathExists(agent.filePath))) {
			skipped += 1;
			continue;
		}
		const original = await readFile(agent.filePath, "utf8");
		const next = updateFrontmatterRouting(original, entry);
		if (next === original) {
			skipped += 1;
			continue;
		}
		await writeFile(agent.filePath, next);
		updatePackageManagedSddAgentOwnership(agent.filePath, original, next);
		updated += 1;
	}
	for (const [name, entry] of Object.entries(config)) {
		if (!seenAgents.has(name) && isClearRoutingEntry(entry)) {
			if (await updateSubagentModelProfileAsync(cwd, "user", name, entry))
				updated += 1;
			else skipped += 1;
		}
	}
	return { updated, skipped };
}

export async function applySavedModelConfig(
	ctx: ExtensionContext,
): Promise<{ updated: number; skipped: number; invalidPath?: string }> {
	const result = await readSavedModelConfigAsync(ctx.cwd);
	if (result.status === "invalid") {
		return { updated: 0, skipped: 0, invalidPath: result.path };
	}
	return applyModelConfigAsync(
		ctx.cwd,
		result.status === "valid" ? result.config : {},
	);
}

function describeModelConfig(cwd: string, config: AgentModelConfig): string[] {
	return listDiscoverableAgents(cwd).map((agent) => {
		const entry = config[agent.name];
		const model = entry?.model ?? "inherit";
		const thinking = entry?.thinking ?? "inherit";
		return `${sanitizeTerminalText(agent.name)}: model=${sanitizeTerminalText(model)}, effort=${sanitizeTerminalText(thinking)}`;
	});
}

async function getPiModelOptions(ctx: ExtensionContext): Promise<string[]> {
	const models = await ctx.modelRegistry.getAvailable();
	const modelIds = models
		.map((model) => normalizeModelId(`${model.provider}/${model.id}`))
		.filter((model): model is string => model !== undefined)
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
	| { type: "custom"; agent: string | "all"; config: AgentModelConfig }
	| { type: "export"; config: AgentModelConfig }
	| { type: "restore"; config: AgentModelConfig }
	| { type: "cancel" };

const SET_ALL_AGENTS = "Set all agents";

const PANEL_TONE = {
	BORDER: "border",
	MUTED: "muted",
	TEXT: "text",
	TITLE: "title",
	ACCENT: "accent",
	STATUS: "status",
} as const;

type PanelTone = (typeof PANEL_TONE)[keyof typeof PANEL_TONE];

const PANEL_TONE_COLOR: Record<PanelTone, ThemeColor> = {
	border: "border",
	muted: "muted",
	text: "text",
	title: "accent",
	accent: "accent",
	status: "thinkingHigh",
};

class SddModelPanel implements OverlayComponent {
	private cursor = 0;
	private mode: "agents" | "models" | "effort" = "agents";
	private selectedRow = SET_ALL_AGENTS;
	private modelCursor = 0;
	private effortCursor = 0;
	private query = "";
	private readonly draft: AgentModelConfig;
	private readonly rows: string[];
	private readonly modelOptions: string[];
	private readonly done: (result: ModelPanelResult) => void;
	private readonly theme: Theme | undefined;

	constructor(
		initialConfig: AgentModelConfig,
		modelOptions: string[],
		agents: string[],
		done: (result: ModelPanelResult) => void,
		theme?: Theme,
	) {
		this.draft = cloneModelConfig(initialConfig);
		this.rows = [SET_ALL_AGENTS, ...agents];
		this.modelOptions = modelOptions;
		this.done = done;
		this.theme = theme;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.mode === "models") {
			this.handleModelInput(data);
			return;
		}
		if (this.mode === "effort") {
			this.handleEffortInput(data);
			return;
		}
		this.handleAgentInput(data);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const lines =
			this.mode === "models"
				? this.renderModelPicker(innerWidth)
				: this.mode === "effort"
					? this.renderEffortPicker(innerWidth)
					: this.renderAgentList(innerWidth);
		return this.renderCard(lines, width);
	}

	private renderCard(lines: string[], width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const horizontal = "─".repeat(innerWidth + 2);
		const border = (text: string) => this.renderText(text, "border");
		return [
			border(`╭${horizontal}╮`),
			...lines.map(
				(line) =>
					`${border("│")} ${this.fitStyledLine(line, innerWidth)} ${border("│")}`,
			),
			border(`╰${horizontal}╯`),
		];
	}

	private fitStyledLine(line: string, width: number): string {
		const visible = stripAnsi(line);
		if (visible.length > width) {
			return truncateToWidth(visible, Math.max(1, width), "…", true);
		}
		return `${line}${" ".repeat(Math.max(0, width - visible.length))}`;
	}

	private renderLine(text = "", width: number, tone?: PanelTone): string {
		const safe = truncateToWidth(
			sanitizeTerminalText(text),
			Math.max(1, width),
			"…",
			true,
		);
		return tone ? this.renderText(safe, tone) : safe;
	}

	private renderText(text: string, tone: PanelTone): string {
		const safe = sanitizeTerminalText(text);
		if (!this.theme) return safe;
		return this.theme.fg(PANEL_TONE_COLOR[tone], safe);
	}

	private renderCursor(focused: boolean): string {
		return focused ? this.renderText("▸", "accent") : " ";
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
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.cursor = Math.min(maxCursor, this.cursor + 1);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.cursor = Math.max(0, this.cursor - 1);
			return;
		}
		if (matchesKey(data, "g")) {
			this.cursor = 0;
			return;
		}
		if (data === "G") {
			this.cursor = maxCursor;
			return;
		}
		if (matchesKey(data, "i")) {
			this.applyInherit();
			return;
		}
		if (matchesKey(data, "e")) {
			this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
			this.mode = "effort";
			this.effortCursor = 0;
			return;
		}
		if (matchesKey(data, "x")) {
			this.done({ type: "export", config: this.draft });
			return;
		}
		if (matchesKey(data, "r")) {
			this.done({ type: "restore", config: this.draft });
			return;
		}
		if (matchesKey(data, "c")) {
			const row = this.rows[this.cursor];
			if (row === SET_ALL_AGENTS)
				this.done({ type: "custom", agent: "all", config: this.draft });
			else if (row)
				this.done({ type: "custom", agent: row, config: this.draft });
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
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.modelCursor = Math.min(
				Math.max(0, options.length - 1),
				this.modelCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
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
					config: this.draft,
				});
				return;
			}
			if (selected === KEEP_CURRENT) {
				this.mode = "agents";
				return;
			}
			this.applyModelSelection(
				selected === INHERIT_MODEL ? undefined : selected,
			);
			this.mode = "agents";
			return;
		}
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.modelCursor = 0;
		}
	}

	private applyModelSelection(model: string | undefined): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setModel(name, model);
			return;
		}
		if (!row) return;
		this.setModel(row, model);
	}

	private applyThinkingSelection(thinking: ThinkingLevel | undefined): void {
		const row = this.selectedRow;
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setThinking(name, thinking);
			return;
		}
		this.setThinking(row, thinking);
	}

	private applyInherit(): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.clearEntry(name);
			return;
		}
		if (row) this.clearEntry(row);
	}

	private setModel(name: string, model: string | undefined): void {
		const current = this.draft[name] ?? {};
		if (model === undefined) delete current.model;
		else current.model = model;
		if (!current.model && !current.thinking) this.draft[name] = {};
		else this.draft[name] = current;
	}

	private setThinking(name: string, thinking: ThinkingLevel | undefined): void {
		const current = this.draft[name] ?? {};
		if (thinking === undefined) delete current.thinking;
		else current.thinking = thinking;
		if (!current.model && !current.thinking) this.draft[name] = {};
		else this.draft[name] = current;
	}

	private clearEntry(name: string): void {
		this.draft[name] = {};
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
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(line("Assign Models and Effort to Agents", "title"));
		lines.push("");
		lines.push(line("Current assignments:", "muted"));
		lines.push("");
		const visibleRows = Math.min(AGENT_LIST_MAX_VISIBLE_ROWS, this.rows.length);
		const listCursor = Math.min(this.cursor, this.rows.length - 1);
		const start = Math.max(
			0,
			Math.min(
				listCursor - Math.floor(visibleRows / 2),
				Math.max(0, this.rows.length - visibleRows),
			),
		);
		const end = Math.min(this.rows.length, start + visibleRows);
		if (start > 0) lines.push(line(`  ↑ ${start} more agent(s)`, "muted"));
		for (let i = start; i < end; i++) {
			const row = this.rows[i] ?? SET_ALL_AGENTS;
			const focused = i === this.cursor;
			const label =
				row === SET_ALL_AGENTS
					? this.renderSetAllLabel(row)
					: this.renderAgentLabel(row);
			lines.push(`${this.renderCursor(focused)} ${label}`);
		}
		if (end < this.rows.length)
			lines.push(line(`  ↓ ${this.rows.length - end} more agent(s)`, "muted"));
		lines.push("");
		lines.push(
			`${this.renderCursor(this.cursor === this.rows.length)} ${this.renderText(
				"Continue",
				this.cursor === this.rows.length ? "accent" : "text",
			)}`,
		);
		lines.push(
			`${this.renderCursor(this.cursor === this.rows.length + 1)} ${this.renderText(
				"← Back",
				this.cursor === this.rows.length + 1 ? "accent" : "text",
			)}`,
		);
		lines.push("");
		lines.push(
			line(
				"j/k scroll • enter model/save • e effort • i inherit • c custom • x export • r restore • ctrl+s save • esc back",
				"muted",
			),
		);
		return lines;
	}

	private renderModelPicker(width: number): string[] {
		const lines: string[] = [];
		const options = this.filteredModelOptions();
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(
			line(`Select model for ${sanitizeTerminalText(this.selectedRow)}`, "title"),
		);
		lines.push("");
		lines.push(
			`${this.renderText("◎", "accent")} ${this.renderText(this.query || "search...", "muted")}`,
		);
		lines.push("");
		const start = Math.max(
			0,
			Math.min(
				this.modelCursor - Math.floor(MODEL_LIST_MAX_VISIBLE_ROWS / 2),
				Math.max(0, options.length - MODEL_LIST_MAX_VISIBLE_ROWS),
			),
		);
		const end = Math.min(options.length, start + MODEL_LIST_MAX_VISIBLE_ROWS);
		for (let i = start; i < end; i++) {
			const focused = i === this.modelCursor;
			lines.push(
				`${this.renderCursor(focused)} ${this.renderText(
					options[i] ?? "",
					focused ? "status" : "text",
				)}`,
			);
		}
		if (options.length === 0) lines.push(line("  No matching models", "muted"));
		lines.push("");
		lines.push(
			line("j/k: navigate • type: search • enter: select • esc: back", "muted"),
		);
		return lines;
	}

	private handleEffortInput(data: string): void {
		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.effortCursor = Math.min(
				Math.max(0, THINKING_OPTIONS.length - 1),
				this.effortCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.effortCursor = Math.max(0, this.effortCursor - 1);
			return;
		}
		if (!matchesKey(data, "return")) return;
		const selected = THINKING_OPTIONS[this.effortCursor];
		if (selected === INHERIT_THINKING) this.applyThinkingSelection(undefined);
		else this.applyThinkingSelection(selected);
		this.mode = "agents";
	}

	private renderEffortPicker(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(
			line(`Select effort for ${sanitizeTerminalText(this.selectedRow)}`, "title"),
		);
		lines.push("");
		for (let i = 0; i < THINKING_OPTIONS.length; i++) {
			const focused = i === this.effortCursor;
			lines.push(
				`${this.renderCursor(focused)} ${this.renderText(
					THINKING_OPTIONS[i] ?? "",
					focused ? "status" : "text",
				)}`,
			);
		}
		lines.push("");
		lines.push(line("j/k: navigate • enter: select • esc: back", "muted"));
		return lines;
	}

	private renderSetAllLabel(row: string): string {
		const models = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.model ?? "inherit");
		const efforts = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.thinking ?? "inherit");
		const firstModel = models[0] ?? "inherit";
		const firstEffort = efforts[0] ?? "inherit";
		const modelLabel = models.every((value) => value === firstModel)
			? firstModel
			: "mixed";
		const effortLabel = efforts.every((value) => value === firstEffort)
			? firstEffort
			: "mixed";
		return `${this.renderText(sanitizeTerminalText(row).padEnd(20), "text")} ${this.renderText("model=", "muted")}${this.renderText(modelLabel, "status")}${this.renderText(
			", effort=",
			"muted",
		)}${this.renderText(effortLabel, "status")}`;
	}

	private renderAgentLabel(row: string): string {
		const model = this.draft[row]?.model ?? "inherit";
		const effort = this.draft[row]?.thinking ?? "inherit";
		return `${this.renderText(sanitizeTerminalText(row).padEnd(20), "text")} ${this.renderText("model=", "muted")}${this.renderText(model, "status")}${this.renderText(
			", effort=",
			"muted",
		)}${this.renderText(effort, "status")}`;
	}
}

function renderSddModelPanelForTesting(
	initialConfig: AgentModelConfig,
	modelOptions: string[],
	agents: string[],
	width: number,
	theme?: Theme,
): string[] {
	return new SddModelPanel(initialConfig, modelOptions, agents, () => {}, theme).render(
		width,
	);
}

async function showSddModelPanel(
	ctx: ExtensionContext,
	config: AgentModelConfig,
): Promise<ModelPanelResult> {
	const modelOptions = await getPiModelOptions(ctx);
	const agents = listDiscoverableAgents(ctx.cwd).map((agent) => agent.name);
	return ctx.ui.custom<ModelPanelResult>(
		(_tui, theme, _keybindings, done) =>
			new SddModelPanel(config, modelOptions, agents, done, theme),
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
	migrateLegacyProjectModelOverrides(ctx.cwd);
	const savedConfig = await readSavedModelConfigAsync(ctx.cwd);
	if (savedConfig.status === "invalid") {
		ctx.ui.notify(
			`el Gentleman cannot open model config because ${savedConfig.path} is invalid JSON or not an object. Fix or remove the file, then run /gentle:models again.`,
			"warning",
		);
		return;
	}
	let config = savedConfig.status === "valid" ? savedConfig.config : {};
	let result = await showSddModelPanel(ctx, config);
	while (result.type === "custom" || result.type === "export" || result.type === "restore") {
		config = cloneModelConfig(result.config);
		if (result.type === "export") {
			try {
				const count = await exportSavedModelConfig(ctx);
				ctx.ui.notify(`el Gentleman exported ${count} saved model routing entr${count === 1 ? "y" : "ies"} to ${modelExportPath(ctx.cwd)}.`, "info");
			} catch (error) {
				ctx.ui.notify(`Model routing export failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
			result = await showSddModelPanel(ctx, config);
			continue;
		}
		if (result.type === "restore") {
			const restored = await readModelExport(ctx);
			if (!restored) {
				ctx.ui.notify(`Model routing restore failed: ${modelExportPath(ctx.cwd)} is missing or invalid.`, "warning");
				result = await showSddModelPanel(ctx, config);
				continue;
			}
			const approved = await ctx.ui.confirm("Restore saved model routing?", `Replace ${modelConfigPath(ctx.cwd)} with ${modelExportPath(ctx.cwd)}`);
			if (approved) {
				try {
					await writeModelConfigAsync(ctx.cwd, restored);
				} catch (error) {
					ctx.ui.notify(`Model routing restore failed before writing config: ${error instanceof Error ? error.message : String(error)}`, "warning");
					result = await showSddModelPanel(ctx, config);
					continue;
				}
				config = restored;
				try {
					const applyResult = await applyModelConfigAsync(ctx.cwd, restored);
					ctx.ui.notify([
						"el Gentleman restored global model config.",
						`Import: ${modelExportPath(ctx.cwd)}`,
						`Global config: ${modelConfigPath(ctx.cwd)}`,
						`Agents updated: ${applyResult.updated}`,
					].join("\n"), "info");
				} catch (error) {
					ctx.ui.notify([
						"el Gentleman restored global model config, but applying it to agents failed.",
						`Global config: ${modelConfigPath(ctx.cwd)}`,
						`Apply error: ${error instanceof Error ? error.message : String(error)}`,
					].join("\n"), "warning");
				}
			}
			result = await showSddModelPanel(ctx, config);
			continue;
		}
		const current =
			result.agent === "all"
				? "inherit"
				: (config[result.agent]?.model ?? "inherit");
		const custom = await ctx.ui.input(
			`${result.agent === "all" ? "all agents" : sanitizeTerminalText(result.agent)} custom model id`,
			current === "inherit" ? "provider/model" : sanitizeTerminalText(current),
		);
		if (custom === undefined) return;
		const trimmed = custom.trim();
		if (trimmed.length > 0) {
			const model = normalizeModelId(trimmed);
			if (!model) {
				ctx.ui.notify(
					"Custom model id must be a single-line provider/model identifier using letters, numbers, '.', '-', '_', '~', ':', '@', '/', '+', '%' only.",
					"warning",
				);
				result = await showSddModelPanel(ctx, config);
				continue;
			}
			if (result.agent === "all") {
				const next: AgentModelConfig = { ...config };
				for (const agent of listDiscoverableAgents(ctx.cwd)) {
					next[agent.name] = {
						...(next[agent.name] ?? {}),
						model,
					};
				}
				config = next;
			} else {
				config = {
					...config,
					[result.agent]: {
						...(config[result.agent] ?? {}),
						model,
					},
				};
			}
		}
		result = await showSddModelPanel(ctx, config);
	}
	if (result.type !== "save") return;
	writeModelConfig(ctx.cwd, result.config);
	const applyResult = await applyModelConfigAsync(ctx.cwd, result.config);
	ctx.ui.notify(
		[
			"el Gentleman global model config saved.",
			`Global config: ${modelConfigPath(ctx.cwd)}`,
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
	const writtenPaths = writePersonaMode(ctx.cwd, selected);
	ctx.ui.notify(
		[
			`el Gentleman persona set to: ${selected}`,
			`Global config: ${personaConfigPath(ctx.cwd)}`,
			...(writtenPaths.length > 1
				? [`Project override updated: ${projectPersonaConfigPath(ctx.cwd)}`]
				: []),
			"Run /reload or start a new Pi session for already-injected prompts to refresh.",
		].join("\n"),
		"info",
	);
}

// ---------------------------------------------------------------------------
// Review gate helpers — pure, exported via __testing for unit tests
// ---------------------------------------------------------------------------

const REVIEW_CONTROLLER_OPERATION = {
	START: "start",
	ADVANCE: "advance",
	STATUS: "status",
	VALIDATE: "validate",
	EXPORT: "export",
	IMPORT: "import",
	INSPECT: "inspect",
	RESET: "reset",
	RECOVER: "recover",
	RECOVER_LOCK: "recover-lock",
	REPAIR: "repair",
} as const;

type ReviewControllerOperation =
	(typeof REVIEW_CONTROLLER_OPERATION)[keyof typeof REVIEW_CONTROLLER_OPERATION];

const REVIEW_CONTROLLER_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["operation"],
	properties: {
		operation: {
			type: "string",
			enum: Object.values(REVIEW_CONTROLLER_OPERATION),
			description: "Controller operation: start, advance, status, or validate.",
		},
		lineageId: {
			type: "string",
			description: "Bounded review lineage identifier.",
		},
		idempotencyKey: {
			type: "string",
			description: "Required for start, advance, and validate operations.",
		},
		transition: {
			type: "string",
			description: "A supported REVIEW_TRANSITION value for advance.",
		},
		command: {
			type: "string",
			description: "One exact direct lifecycle command for validate.",
		},
		input: {
			type: "string",
			description: "JSON object containing operation-specific controller input.",
		},
		outputPath: { type: "string", description: "Destination path for deterministic bundle export." },
		inputPath: { type: "string", description: "Source path for staged bundle import." },
		operationId: { type: "string", description: "Identity-bound import or export operation ID." },
		lineageIds: { type: "string", description: "Optional JSON array of graph lineage IDs to export." },
	},
} as const;

interface ReviewControllerParameters {
	operation: ReviewControllerOperation;
	lineageId?: string;
	idempotencyKey?: string;
	transition?: string;
	command?: string;
	input?: string;
	outputPath?: string;
	inputPath?: string;
	operationId?: string;
	lineageIds?: string;
	acknowledgeUntrustedBundleSource?: string;
}

interface ReviewControllerStartInput {
	mode: ReviewMode;
	projection: ReviewProjectionV1;
	policyHash: string;
	evidenceHash: string;
	budget: ReviewBudgetV1;
	parentLineageId?: string;
}

interface ReviewControllerValidateInput {
	scopeBudget: ReviewBudgetV1;
	release?: ReleaseFastPathEvidenceV1;
}

interface DerivedReviewGateTarget {
	command: ReviewLifecycleCommand;
	target: GateTargetV1;
	actualIntendedCommitTree?: string;
}

interface ReleaseFastPathAuthorizationV1 {
	remote: string;
	protected_ref: string;
	expected_remote_head: string;
}

interface PendingReviewAuthorization {
	command_hash: string;
	target_hash: string;
	receipt_hash: string | null;
	release_fast_path?: ReleaseFastPathAuthorizationV1;
}

function isReviewControllerOperation(value: string): value is ReviewControllerOperation {
	return Object.values(REVIEW_CONTROLLER_OPERATION).some((operation) => operation === value);
}

function parseReviewControllerParameters(value: unknown): ReviewControllerParameters {
	if (!isRecord(value)) throw new Error("Review controller parameters must be an object");
	if (typeof value.operation !== "string" || !isReviewControllerOperation(value.operation)) {
		throw new Error("Review controller operation is unsupported");
	}
	// VALIDATE defers its lineage requirement to execution time: the proven
	// release-from-protected-main fast path needs no receipt lineage, while
	// every other validation still requires one before receipt validation.
	const needsLineage = ![REVIEW_CONTROLLER_OPERATION.EXPORT, REVIEW_CONTROLLER_OPERATION.IMPORT, REVIEW_CONTROLLER_OPERATION.INSPECT, REVIEW_CONTROLLER_OPERATION.RESET, REVIEW_CONTROLLER_OPERATION.RECOVER, REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK, REVIEW_CONTROLLER_OPERATION.REPAIR, REVIEW_CONTROLLER_OPERATION.VALIDATE].includes(value.operation as ReviewControllerOperation);
	if (needsLineage && (typeof value.lineageId !== "string" || value.lineageId.trim().length === 0)) {
		throw new Error("Review controller requires a lineageId");
	}
	const parameters: ReviewControllerParameters = {
		operation: value.operation,
		...(typeof value.lineageId === "string" ? { lineageId: value.lineageId } : {}),
	};
	for (const key of ["idempotencyKey", "transition", "command", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource"] as const) {
		const optional = value[key];
		if (optional !== undefined && typeof optional !== "string") {
			throw new Error(`Review controller ${key} must be a string`);
		}
		if (typeof optional === "string") parameters[key] = optional;
	}
	return parameters;
}

function requiredControllerString(
	parameters: ReviewControllerParameters,
	key: "idempotencyKey" | "transition" | "command" | "input" | "outputPath" | "inputPath" | "operationId",
): string {
	const value = parameters[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Review controller ${parameters.operation} requires ${key}`);
	}
	return value;
}

function readRepositoryControllerInput(inputPath: string, repositoryRoot: string): string {
	const canonicalRoot = realpathSync(repositoryRoot);
	const requestedPath = resolve(canonicalRoot, inputPath);
	const relativePath = relative(canonicalRoot, requestedPath);
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error("Review controller inputPath must be confined to the repository");
	}
	const stat = lstatSync(requestedPath);
	if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(requestedPath) !== requestedPath) {
		throw new Error("Review controller inputPath must be a regular non-symlink file");
	}
	return readFileSync(requestedPath, "utf8");
}

function parseControllerJson(input: string, operation: ReviewControllerOperation): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(input);
	} catch (error) {
		throw new Error(
			`Review controller ${operation} input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(value)) throw new Error(`Review controller ${operation} input must be a JSON object`);
	return value;
}

function parseReviewBudget(value: unknown, label: string): ReviewBudgetV1 {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	return value as unknown as ReviewBudgetV1;
}

function parseStartInput(value: Record<string, unknown>): ReviewControllerStartInput {
	if (value.mode !== REVIEW_MODE.ORDINARY && value.mode !== REVIEW_MODE.JUDGMENT_DAY) {
		throw new Error("Review controller start mode is unsupported");
	}
	if (!isRecord(value.projection) || typeof value.projection.kind !== "string") {
		throw new Error("Review controller start requires a projection");
	}
	let projection: ReviewProjectionV1;
	if (value.projection.kind === REVIEW_PROJECTION.COMPLETE) {
		projection = { kind: REVIEW_PROJECTION.COMPLETE };
	} else if (
		value.projection.kind === REVIEW_PROJECTION.INTENDED_COMMIT &&
		typeof value.projection.tree === "string"
	) {
		projection = {
			kind: REVIEW_PROJECTION.INTENDED_COMMIT,
			tree: value.projection.tree,
		};
	} else {
		throw new Error("Review controller start projection is unsupported or unresolved");
	}
	if (typeof value.policyHash !== "string" || typeof value.evidenceHash !== "string") {
		throw new Error("Review controller start requires policyHash and evidenceHash");
	}
	if (value.parentLineageId !== undefined && typeof value.parentLineageId !== "string") {
		throw new Error("Review controller parentLineageId must be a string");
	}
	const result: ReviewControllerStartInput = {
		mode: value.mode,
		projection,
		policyHash: value.policyHash,
		evidenceHash: value.evidenceHash,
		budget: parseReviewBudget(value.budget, "Review controller start budget"),
	};
	if (typeof value.parentLineageId === "string") result.parentLineageId = value.parentLineageId;
	return result;
}

const RELEASE_EVIDENCE_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function parseReleaseFastPathEvidence(value: unknown): ReleaseFastPathEvidenceV1 {
	if (!isRecord(value)) throw new Error("Review controller validate release evidence must be an object");
	if (typeof value.protected_ref !== "string" || value.protected_ref.trim().length === 0) {
		throw new Error("Release fast-path evidence requires an exact protected_ref");
	}
	if (typeof value.remote !== "string" || value.remote.trim().length === 0) {
		throw new Error("Release fast-path evidence requires an exact remote identity");
	}
	if (
		!isRecord(value.ci) ||
		typeof value.ci.revision !== "string" ||
		!RELEASE_EVIDENCE_OBJECT_ID.test(value.ci.revision) ||
		typeof value.ci.status !== "string"
	) {
		throw new Error("Release fast-path evidence requires ci.revision bound to one exact SHA and ci.status");
	}
	if (
		value.external_evidence !== EXTERNAL_RELEASE_EVIDENCE.NONE &&
		value.external_evidence !== EXTERNAL_RELEASE_EVIDENCE.INVALIDATING &&
		value.external_evidence !== EXTERNAL_RELEASE_EVIDENCE.ESCALATING
	) {
		throw new Error("Release fast-path evidence requires an explicit external_evidence disposition");
	}
	if (typeof value.post_incident !== "boolean") {
		throw new Error("Release fast-path evidence requires an explicit post_incident declaration");
	}
	return {
		protected_ref: value.protected_ref,
		remote: value.remote,
		ci: { revision: value.ci.revision, status: value.ci.status },
		external_evidence: value.external_evidence,
		post_incident: value.post_incident,
	};
}

function parseValidateInput(value: Record<string, unknown>): ReviewControllerValidateInput {
	const input: ReviewControllerValidateInput = {
		scopeBudget: parseReviewBudget(
			value.scopeBudget,
			"Review controller validate scopeBudget",
		),
	};
	if (value.release !== undefined) input.release = parseReleaseFastPathEvidence(value.release);
	return input;
}

/**
 * Classifies a bash command string as a TriggerEvent for the review gate,
 * or returns null if the command is not a recognized git/gh workflow trigger.
 *
 * Token parsing preserves supported Git global repository selectors.
 */
export function classifyReviewEvent(command: string): TriggerEvent | null {
	return inspectReviewLifecycleCommand(command, ".").event;
}

export interface ReviewLifecycleCommand {
	event: TriggerEvent;
	cwd: string;
	gitGlobalArgs: readonly string[];
	arguments: readonly string[];
}

interface ReviewLifecycleInspection {
	event: TriggerEvent | null;
	command: ReviewLifecycleCommand | null;
	failClosedReason?: string;
}

function hasUnquotedShellControl(command: string): boolean {
	let quote: "'" | '"' | undefined;
	let escaping = false;
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]!;
		if (escaping) {
			escaping = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (character === ";" || character === "|" || character === "&" || character === "\n") {
			return true;
		}
		if (character === "`" || (character === "$" && command[index + 1] === "(")) {
			return true;
		}
	}
	return false;
}

function detectWrappedLifecycleEvent(command: string): TriggerEvent | null {
	const longestKeywordLength = "release".length;
	let word = "";
	let wordIsLongerThanKeyword = false;
	let quote: "'" | '"' | undefined;
	let gitSeen = false;
	let ghStage = 0;
	let event: TriggerEvent | null = null;

	const consumeWord = (): void => {
		if (!word && !wordIsLongerThanKeyword) return;
		const token = wordIsLongerThanKeyword ? "" : word.toLowerCase();
		word = "";
		wordIsLongerThanKeyword = false;
		if (token === "git") gitSeen = true;
		else if (gitSeen && token === "commit") event = "pre-commit";
		else if (gitSeen && token === "push") event = "pre-push";

		if (token === "gh") ghStage = 1;
		else if (ghStage === 1 && token === "pr") ghStage = 2;
		else if (ghStage === 1 && token === "release") ghStage = 3;
		else if (ghStage === 2 && token === "create") event = "pre-pr";
		else if (ghStage === 3 && token === "create") event = "pre-release";
	};

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]!;
		if (character === "\\" && quote !== "'" && command[index + 1] === "\n") {
			index += 1;
			continue;
		}
		if (character === "'" || character === '"') {
			if (!quote) quote = character;
			else if (quote === character) quote = undefined;
			continue;
		}
		if (!quote && (character === ";" || character === "|" || character === "&" || character === "\n")) {
			consumeWord();
			if (event) return event;
			gitSeen = false;
			ghStage = 0;
			continue;
		}
		if (/[A-Za-z0-9_]/.test(character)) {
			if (word.length < longestKeywordLength) word += character;
			else wordIsLongerThanKeyword = true;
			continue;
		}
		consumeWord();
		if (event) return event;
	}
	consumeWord();
	return event;
}

function inspectReviewLifecycleCommand(
	command: string,
	defaultCwd: string,
): ReviewLifecycleInspection {
	const direct = resolveReviewLifecycleCommand(command, defaultCwd);
	if (direct) return { event: direct.event, command: direct };
	const event = detectWrappedLifecycleEvent(command);
	if (!event) return { event: null, command: null };
	return {
		event,
		command: null,
		failClosedReason:
			"Compound or wrapped lifecycle command detection is ambiguous and must fail closed. Run one direct lifecycle command with its approved receipt and exact typed target.",
	};
}

function tokenizeReviewCommand(command: string): string[] | null {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;
	let started = false;
	for (const character of command.trim()) {
		if (escaping) {
			current += character;
			escaping = false;
			started = true;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaping = true;
			started = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			started = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			started = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (started) {
				words.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += character;
		started = true;
	}
	if (quote || escaping) return null;
	if (started) words.push(current);
	return words;
}

export function resolveReviewLifecycleCommand(
	command: string,
	defaultCwd: string,
): ReviewLifecycleCommand | null {
	if (hasUnquotedShellControl(command)) return null;
	const words = tokenizeReviewCommand(command);
	if (!words) return null;
	if (words[0] === "gh" && words[1] === "pr" && words[2] === "create") {
		return {
			event: "pre-pr",
			cwd: defaultCwd,
			gitGlobalArgs: [],
			arguments: words.slice(3),
		};
	}
	if (words[0] === "gh" && words[1] === "release" && words[2] === "create") {
		return {
			event: "pre-release",
			cwd: defaultCwd,
			gitGlobalArgs: [],
			arguments: words.slice(3),
		};
	}
	if (words[0] !== "git") return null;
	const gitGlobalArgs: string[] = [];
	let resolvedCwd = resolve(defaultCwd);
	let index = 1;
	while (index < words.length) {
		const option = words[index];
		if (option === "-C" || option === "--git-dir" || option === "--work-tree") {
			const value = words[index + 1];
			if (value === undefined) return null;
			gitGlobalArgs.push(option, value);
			if (option === "-C") resolvedCwd = resolve(resolvedCwd, value);
			else return null;
			index += 2;
			continue;
		}
		if (/^--(?:git-dir|work-tree)=.+/.test(option)) {
			return null;
		}
		break;
	}
	const subcommand = words[index];
	const event: TriggerEvent | undefined =
		subcommand === "commit"
			? "pre-commit"
			: subcommand === "push"
				? "pre-push"
				: undefined;
	if (!event) return null;
	return {
		event,
		cwd: resolvedCwd,
		gitGlobalArgs,
		arguments: words.slice(index + 1),
	};
}

function runReviewGit(
	cwd: string,
	args: readonly string[],
	environment: NodeJS.ProcessEnv = process.env,
): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: environment,
	}).trim();
}

function commitIncludesAllTracked(arguments_: readonly string[]): boolean {
	let includesAllTracked = false;
	const booleanOptions = new Set([
		"--all",
		"--allow-empty",
		"--allow-empty-message",
		"--amend",
		"--dry-run",
		"--edit",
		"--no-edit",
		"--no-gpg-sign",
		"--no-post-rewrite",
		"--no-signoff",
		"--no-status",
		"--no-verify",
		"--quiet",
		"--short",
		"--signoff",
		"--status",
		"--verbose",
	]);
	const valueOptions = new Set([
		"--author",
		"--cleanup",
		"--date",
		"--file",
		"--fixup",
		"--gpg-sign",
		"--message",
		"--reedit-message",
		"--reuse-message",
		"--squash",
		"-C",
		"-F",
		"-c",
		"-m",
	]);
	const unsupportedTreeOptions = /^(?:--include|--interactive|--only|--patch|--pathspec-from-file|--pathspec-file-nul|-i|-o|-p)$/;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]!;
		if (argument === "--") {
			if (index !== arguments_.length - 1) {
				throw new Error("Commit pathspecs cannot be exactly derived for review authorization");
			}
			continue;
		}
		if (unsupportedTreeOptions.test(argument) || unsupportedTreeOptions.test(argument.split("=")[0]!)) {
			throw new Error(`Unsupported commit tree semantics: ${argument}`);
		}
		if (argument === "-a" || argument === "--all") {
			includesAllTracked = true;
			continue;
		}
		if (/^-[^-]+$/.test(argument) && argument.length > 2) {
			const flags = argument.slice(1);
			if (/[^aemnsqv]/.test(flags)) {
				throw new Error(`Unsupported combined commit option: ${argument}`);
			}
			if (flags.includes("a")) includesAllTracked = true;
			if (flags.includes("m")) {
				index += 1;
				if (arguments_[index] === undefined) throw new Error("Commit message option is missing its value");
			}
			continue;
		}
		if (booleanOptions.has(argument)) continue;
		if ([...valueOptions].some((option) => argument.startsWith(`${option}=`))) continue;
		if (valueOptions.has(argument)) {
			index += 1;
			if (arguments_[index] === undefined) throw new Error(`Commit option ${argument} is missing its value`);
			continue;
		}
		if (!argument.startsWith("-")) {
			throw new Error("Commit pathspecs cannot be exactly derived for review authorization");
		}
		throw new Error(`Unsupported commit option: ${argument}`);
	}
	return includesAllTracked;
}

function deriveCommitTree(command: ReviewLifecycleCommand): string {
	const includesAllTracked = commitIncludesAllTracked(command.arguments);
	if (!includesAllTracked) return runReviewGit(command.cwd, ["write-tree"]);
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "gentle-pi-commit-tree-"));
	const temporaryIndex = join(temporaryDirectory, "index");
	try {
		const environment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
		const stagedTree = runReviewGit(command.cwd, ["write-tree"]);
		runReviewGit(command.cwd, ["read-tree", stagedTree], environment);
		runReviewGit(command.cwd, ["add", "-u", "--", "."], environment);
		return runReviewGit(command.cwd, ["write-tree"], environment);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function resolveLocalFullRef(cwd: string, value: string, label: string): string {
	if (value === "HEAD") {
		const head = runReviewGit(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
		if (!head.startsWith("refs/")) throw new Error(`${label} HEAD is detached`);
		return head;
	}
	const candidates = value.startsWith("refs/")
		? [value]
		: [`refs/heads/${value}`, `refs/tags/${value}`];
	const resolved = candidates.filter((candidate) => {
		try {
			runReviewGit(cwd, ["show-ref", "--verify", "--quiet", candidate]);
			return true;
		} catch {
			return false;
		}
	});
	if (resolved.length !== 1) throw new Error(`${label} must resolve to exactly one local full ref`);
	return resolved[0]!;
}

function destinationFullRef(value: string, sourceRef: string): string {
	if (value.startsWith("refs/")) return value;
	if (sourceRef.startsWith("refs/tags/")) return `refs/tags/${value}`;
	return `refs/heads/${value}`;
}

function remoteRefObject(cwd: string, remote: string, destinationRef: string): string | null {
	const output = runReviewGit(cwd, ["ls-remote", "--refs", remote, destinationRef]);
	if (!output) return null;
	const rows = output
		.split(/\r?\n/)
		.map((line) => line.split(/\s+/))
		.filter((parts) => parts[1] === destinationRef);
	if (rows.length !== 1 || !/^[0-9a-f]{40,64}$/.test(rows[0]?.[0] ?? "")) {
		throw new Error("Push remote destination did not resolve to one exact object");
	}
	return rows[0]![0]!;
}

function pushRemoteAndRefspec(arguments_: readonly string[]): { remote: string; refspec: string } {
	const unsupported = arguments_.find((argument) =>
		/^(?:--all|--delete|--follow-tags|--mirror|--prune|--tags|-d)$/.test(argument),
	);
	if (unsupported) throw new Error(`Unsupported broad push semantics: ${unsupported}`);
	const optionsWithValues = new Set([
		"--exec",
		"--push-option",
		"--receive-pack",
		"--repo",
		"-o",
	]);
	const booleanOptions = new Set([
		"--atomic",
		"--dry-run",
		"--force",
		"--force-if-includes",
		"--force-with-lease",
		"--no-verify",
		"--porcelain",
		"--progress",
		"--quiet",
		"--set-upstream",
		"--signed",
		"--thin",
		"--verbose",
		"-f",
		"-n",
		"-q",
		"-u",
		"-v",
	]);
	let index = 0;
	while (index < arguments_.length && arguments_[index]!.startsWith("-")) {
		const option = arguments_[index]!;
		if ([...optionsWithValues].some((name) => option.startsWith(`${name}=`))) {
			index += 1;
			continue;
		}
		if (optionsWithValues.has(option)) {
			index += 2;
			if (index > arguments_.length) throw new Error(`Push option ${option} is missing its value`);
			continue;
		}
		if (booleanOptions.has(option) || option.startsWith("--force-with-lease=")) {
			index += 1;
			continue;
		}
		throw new Error(`Unsupported push option: ${option}`);
	}
	const remote = arguments_[index];
	const refspecs = arguments_.slice(index + 1);
	if (!remote || remote.startsWith("-")) {
		throw new Error("Push authorization requires an explicit remote and one complete ref update");
	}
	if (refspecs.length !== 1) {
		throw new Error("Push authorization must exactly derive one complete ref update");
	}
	return { remote, refspec: refspecs[0]! };
}

function derivePushTarget(command: ReviewLifecycleCommand): GateTargetV1 {
	const { remote, refspec } = pushRemoteAndRefspec(command.arguments);
	if (refspec.startsWith(":")) throw new Error("Push deletion is unsupported");
	const normalized = refspec.startsWith("+") ? refspec.slice(1) : refspec;
	const separator = normalized.indexOf(":");
	const sourceValue = separator < 0 ? normalized : normalized.slice(0, separator);
	const destinationValue = separator < 0 ? normalized : normalized.slice(separator + 1);
	if (!sourceValue || !destinationValue) throw new Error("Push refspec is incomplete");
	const sourceRef = resolveLocalFullRef(command.cwd, sourceValue, "Push source");
	const destinationRef = destinationFullRef(destinationValue, sourceRef);
	const newObject = runReviewGit(command.cwd, ["rev-parse", "--verify", sourceRef]);
	const newPeeledCommit = runReviewGit(command.cwd, ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
	const newTree = runReviewGit(command.cwd, ["rev-parse", "--verify", `${newPeeledCommit}^{tree}`]);
	const oldObject = remoteRefObject(command.cwd, remote, destinationRef);
	const update = oldObject === null
		? {
				kind: PUSH_UPDATE_KIND.CREATE,
				source_ref: sourceRef,
				destination_ref: destinationRef,
				old_object: null,
				old_peeled_commit: null,
				old_tree: null,
				new_object: newObject,
				new_peeled_commit: newPeeledCommit,
				new_tree: newTree,
			}
		: {
				kind: PUSH_UPDATE_KIND.UPDATE,
				source_ref: sourceRef,
				destination_ref: destinationRef,
				old_object: oldObject,
				old_peeled_commit: runReviewGit(command.cwd, ["rev-parse", "--verify", `${oldObject}^{commit}`]),
				old_tree: runReviewGit(command.cwd, ["rev-parse", "--verify", `${oldObject}^{tree}`]),
				new_object: newObject,
				new_peeled_commit: newPeeledCommit,
				new_tree: newTree,
			};
	return {
		kind: GATE_TARGET_KIND.PUSH,
		remote,
		updates: [update],
	};
}

function commandOptionValue(arguments_: readonly string[], name: string): string {
	const matches: string[] = [];
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]!;
		if (argument === name) {
			const value = arguments_[index + 1];
			if (!value) throw new Error(`${name} is missing its value`);
			matches.push(value);
			index += 1;
		} else if (argument.startsWith(`${name}=`)) {
			matches.push(argument.slice(name.length + 1));
		}
	}
	if (matches.length !== 1) throw new Error(`Command requires exactly one ${name} value`);
	return matches[0]!;
}

function derivePullRequestTarget(command: ReviewLifecycleCommand): GateTargetV1 {
	const baseRef = resolveLocalFullRef(
		command.cwd,
		commandOptionValue(command.arguments, "--base"),
		"Pull request base",
	);
	const headRef = resolveLocalFullRef(
		command.cwd,
		commandOptionValue(command.arguments, "--head"),
		"Pull request head",
	);
	const baseCommit = runReviewGit(command.cwd, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
	const headCommit = runReviewGit(command.cwd, ["rev-parse", "--verify", `${headRef}^{commit}`]);
	return {
		kind: GATE_TARGET_KIND.PULL_REQUEST,
		base_ref: baseRef,
		base_commit: baseCommit,
		base_tree: runReviewGit(command.cwd, ["rev-parse", "--verify", `${baseCommit}^{tree}`]),
		head_ref: headRef,
		head_commit: headCommit,
		head_tree: runReviewGit(command.cwd, ["rev-parse", "--verify", `${headCommit}^{tree}`]),
	};
}

function deriveReleaseTarget(command: ReviewLifecycleCommand): GateTargetV1 {
	const tag = command.arguments[0];
	if (!tag || tag.startsWith("-")) {
		throw new Error("Release authorization requires gh release create <tag>");
	}
	if (
		command.arguments.some(
			(argument) =>
				argument === "--repo" ||
				argument.startsWith("--repo=") ||
				argument.startsWith("-R"),
		)
	) {
		throw new Error("Release --repo cannot be bound to the exact local review repository");
	}
	if (command.arguments.some((argument) => argument === "--target" || argument.startsWith("--target="))) {
		throw new Error("Release --target semantics are unsupported; use an existing exact tag");
	}
	const tagRef = tag.startsWith("refs/tags/") ? tag : `refs/tags/${tag}`;
	const tagObject = runReviewGit(command.cwd, ["rev-parse", "--verify", tagRef]);
	const peeledCommit = runReviewGit(command.cwd, ["rev-parse", "--verify", `${tagRef}^{commit}`]);
	return {
		kind: GATE_TARGET_KIND.RELEASE,
		tag_ref: tagRef,
		tag_object: tagObject,
		peeled_commit: peeledCommit,
		tree: runReviewGit(command.cwd, ["rev-parse", "--verify", `${peeledCommit}^{tree}`]),
	};
}

function deriveReviewGateTarget(
	command: string,
	defaultCwd: string,
): DerivedReviewGateTarget {
	const inspection = inspectReviewLifecycleCommand(command, defaultCwd);
	if (!inspection.event || !inspection.command) {
		throw new Error(
			inspection.failClosedReason ?? "Command is not one supported direct review lifecycle operation",
		);
	}
	if (inspection.command.event === "pre-commit") {
		const tree = deriveCommitTree(inspection.command);
		return {
			command: inspection.command,
			target: {
				kind: GATE_TARGET_KIND.INTENDED_COMMIT,
				intended_commit_tree: tree,
			},
			actualIntendedCommitTree: tree,
		};
	}
	if (inspection.command.event === "pre-push") {
		return { command: inspection.command, target: derivePushTarget(inspection.command) };
	}
	if (inspection.command.event === "pre-pr") {
		return {
			command: inspection.command,
			target: derivePullRequestTarget(inspection.command),
		};
	}
	if (inspection.command.event === "pre-release") {
		return { command: inspection.command, target: deriveReleaseTarget(inspection.command) };
	}
	throw new Error("Review lifecycle target kind is unsupported");
}

function reviewAuthorizationKey(command: string, cwd: string): string {
	return canonicalHash({ command, cwd: resolve(cwd) });
}

type ReviewGateEvaluator = (command: string) => ToolCallEventResult | undefined;
type CommandSafetyEvaluator = (
	command: string,
) => Promise<ToolCallEventResult | undefined>;

function isReviewTransition(value: string): value is ReviewTransition {
	return Object.values(REVIEW_TRANSITION).some((transition) => transition === value);
}

function executeReviewControllerOperation(
	parametersValue: unknown,
	defaultCwd: string,
	pendingAuthorizations: Map<string, PendingReviewAuthorization>,
): Record<string, unknown> {
	const parameters = parseReviewControllerParameters(parametersValue);
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.EXPORT) {
		const outputPath = requiredControllerString(parameters, "outputPath");
		const operationId = requiredControllerString(parameters, "operationId");
		const lineageIds = parameters.lineageIds === undefined ? undefined : JSON.parse(parameters.lineageIds) as unknown;
		if (lineageIds !== undefined && (!Array.isArray(lineageIds) || lineageIds.some((id) => typeof id !== "string"))) throw new Error("Export lineageIds must be a JSON string array");
		return { operation: parameters.operation, result: new ReviewBundleExporter(defaultCwd).export({ outputPath, operationId, lineageIds }) };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.IMPORT) {
		// RISK2-001: adopting a brand-new lineage from a bundle is an experimental,
		// operator-attested trust decision (see lib/review-bundle.ts import gate).
		return { operation: parameters.operation, result: new ReviewBundleImporter(defaultCwd).import({ inputPath: requiredControllerString(parameters, "inputPath"), operationId: requiredControllerString(parameters, "operationId"), acknowledgeUntrustedBundleSource: parameters.acknowledgeUntrustedBundleSource === "true" }) };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT) {
		const authority = resolveRepositoryAuthorityV1(defaultCwd);
		const lock = new ReviewMutationLockV1(join(authority.store_root, "control"), authority.repository_id, authority.authority_id);
		return { operation: parameters.operation, inspection: inspectLegacyReviewAuthorityV1(defaultCwd), lock: lock.inspect() };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (typeof input.ownerHash !== "string") throw new Error("Lock recovery requires an exact ownerHash");
		const authority = resolveRepositoryAuthorityV1(defaultCwd);
		const lock = new ReviewMutationLockV1(join(authority.store_root, "control"), authority.repository_id, authority.authority_id);
		lock.recover(input.ownerHash);
		return { operation: parameters.operation, recovered_lock: true };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return { operation: parameters.operation, result: destructiveResetReviewAuthorityV1({ cwd: defaultCwd, repositoryId: String(input.repositoryId), commonDirHash: String(input.commonDirHash), inventoryHash: String(input.inventoryHash), confirmation: String(input.confirmation), resume: true }) };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return { operation: parameters.operation, result: destructiveResetReviewAuthorityV1({ cwd: defaultCwd, repositoryId: String(input.repositoryId), commonDirHash: String(input.commonDirHash), inventoryHash: String(input.inventoryHash), confirmation: String(input.confirmation), resume: false }) };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.REPAIR) {
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		store.repairCurrentAuthority();
		return { operation: parameters.operation, repaired: true };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.START) {
		const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
		const input = parseStartInput(
			parseControllerJson(
				requiredControllerString(parameters, "input"),
				REVIEW_CONTROLLER_OPERATION.START,
			),
		);
		const snapshot = captureReviewSnapshot({
			cwd: defaultCwd,
			mode: input.mode,
			projection: input.projection,
			policyHash: input.policyHash,
		});
		const stateInput = {
			lineageId: parameters.lineageId,
			mode: input.mode,
			snapshot,
			evidenceHash: input.evidenceHash,
			budget: input.budget,
		};
		const state = createReviewState(
			input.parentLineageId === undefined
				? stateInput
				: { ...stateInput, parentLineageId: input.parentLineageId },
		);
		const result = ReviewTransactionStore.forRepository(defaultCwd).create(
			state,
			idempotencyKey,
		);
		return { operation: parameters.operation, result, state };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ADVANCE) {
		const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
		const transitionValue = requiredControllerString(parameters, "transition");
		if (!isReviewTransition(transitionValue)) {
			throw new Error(`Review controller transition is unsupported: ${transitionValue}`);
		}
		const hasInput = parameters.input !== undefined;
		const hasInputPath = parameters.inputPath !== undefined;
		if (hasInput === hasInputPath) {
			throw new Error("Review controller advance requires exactly one of input or inputPath");
		}
		const input = parseControllerJson(
			hasInput
				? requiredControllerString(parameters, "input")
				: readRepositoryControllerInput(requiredControllerString(parameters, "inputPath"), defaultCwd),
			REVIEW_CONTROLLER_OPERATION.ADVANCE,
		) as unknown as ReviewReducerInput;
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		const result = store.runReducerOperation({
			lineageId: parameters.lineageId,
			transition: transitionValue,
			idempotencyKey,
			input,
		});
		return {
			operation: parameters.operation,
			result,
			state: store.read(parameters.lineageId),
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.STATUS) {
		const state = ReviewTransactionStore.forRepository(defaultCwd).read(parameters.lineageId);
		const response: Record<string, unknown> = {
			operation: parameters.operation,
			state,
		};
		if (state.terminal_state !== undefined) {
			response.receipt = ReviewTransactionStore.forRepository(defaultCwd).createAuthoritativeReceipt(parameters.lineageId);
		}
		return response;
	}
	const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
	const commandValue = requiredControllerString(parameters, "command");
	const input = parseValidateInput(
		parseControllerJson(
			requiredControllerString(parameters, "input"),
			REVIEW_CONTROLLER_OPERATION.VALIDATE,
		),
	);
	const derived = deriveReviewGateTarget(commandValue, defaultCwd);
	let releaseFastPath: Record<string, unknown> | undefined;
	if (input.release !== undefined) {
		if (derived.command.event !== "pre-release") {
			throw new Error("Release fast-path evidence is only valid for a pre-release lifecycle command");
		}
		// Release from protected `main` may bypass receipt validation only when
		// every fast-path condition is proven against the remote; any failed or
		// unprovable condition falls back to native receipt validation below.
		const evaluation = evaluateReleaseFastPathV1({
			target: derived.target,
			evidence: input.release,
			repositoryCwd: derived.command.cwd,
		});
		releaseFastPath = {
			eligible: evaluation.eligible,
			remote_head: evaluation.remote_head,
			reason: evaluation.reason,
		};
		if (evaluation.eligible && evaluation.remote_head !== null) {
			const commandHash = reviewAuthorizationKey(commandValue, derived.command.cwd);
			const targetHash = canonicalHash(derived.target);
			const authorization: PendingReviewAuthorization = {
				command_hash: commandHash,
				target_hash: targetHash,
				receipt_hash: null,
				release_fast_path: {
					remote: input.release.remote,
					protected_ref: input.release.protected_ref,
					expected_remote_head: evaluation.remote_head,
				},
			};
			pendingAuthorizations.set(commandHash, authorization);
			return {
				operation: parameters.operation,
				result: {
					status: GATE_RESULT.ALLOW,
					actor_count: 0,
					target_hash: targetHash,
					receipt_hash: null,
					reason: evaluation.reason,
				},
				derived_target: derived.target,
				release_fast_path: releaseFastPath,
				authorization,
			};
		}
	}
	if (typeof parameters.lineageId !== "string" || parameters.lineageId.trim().length === 0) {
		throw new Error("Review controller validate requires a lineageId for native receipt validation");
	}
	const store = ReviewTransactionStore.forRepository(derived.command.cwd);
	const receipt = store.createAuthoritativeReceipt(parameters.lineageId);
	const result = validateAuthoritativeReviewGate({
		store,
		receipt,
		target: derived.target,
		repositoryCwd: derived.command.cwd,
		idempotencyKey,
		scopeBudget: input.scopeBudget,
		actualIntendedCommitTree: derived.actualIntendedCommitTree,
	});
	const response: Record<string, unknown> = {
		operation: parameters.operation,
		result,
		derived_target: derived.target,
	};
	if (releaseFastPath !== undefined) response.release_fast_path = releaseFastPath;
	if (result.status === GATE_RESULT.ALLOW) {
		const commandHash = reviewAuthorizationKey(commandValue, derived.command.cwd);
		const authorization: PendingReviewAuthorization = {
			command_hash: commandHash,
			target_hash: canonicalHash(derived.target),
			receipt_hash: receipt.envelope.receipt_hash,
		};
		pendingAuthorizations.set(commandHash, authorization);
		response.authorization = authorization;
	}
	return response;
}

function gateLifecycleCommand(
	command: string,
	defaultCwd: string,
	pendingAuthorizations: Map<string, PendingReviewAuthorization>,
): ToolCallEventResult | undefined {
	const inspection = inspectReviewLifecycleCommand(command, defaultCwd);
	if (!inspection.event) return undefined;
	if (!inspection.command) {
		return { block: true, reason: inspection.failClosedReason ?? "Lifecycle command failed closed." };
	}
	let derived: DerivedReviewGateTarget;
	try {
		derived = deriveReviewGateTarget(command, defaultCwd);
	} catch (error) {
		return {
			block: true,
			reason: `Gentle AI ${inspection.event} gate could not exactly derive the command target and failed closed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const commandHash = reviewAuthorizationKey(command, derived.command.cwd);
	const authorization = pendingAuthorizations.get(commandHash);
	if (!authorization) {
		return {
			block: true,
			reason: `Gentle AI ${inspection.event} gate requires one registered review controller authorization produced from an approved receipt and the exact typed command target. Fabricated tool metadata cannot authorize lifecycle commands.`,
		};
	}
	pendingAuthorizations.delete(commandHash);
	if (
		authorization.command_hash !== commandHash ||
		authorization.target_hash !== canonicalHash(derived.target)
	) {
		const mismatch = authorization.command_hash !== commandHash ? "command identity" : "typed target";
		return {
			block: true,
			reason: `Gentle AI ${inspection.event} gate ${mismatch} changed after authorization and failed closed.`,
		};
	}
	if (authorization.release_fast_path) {
		// The remote protected main head is rechecked immediately before the tag
		// push; an advanced or unprovable head fails closed.
		const recheck = recheckReleaseFastPathRemoteHeadV1({
			repositoryCwd: derived.command.cwd,
			remote: authorization.release_fast_path.remote,
			expectedRemoteHead: authorization.release_fast_path.expected_remote_head,
		});
		if (recheck.advanced) {
			return {
				block: true,
				reason: `Gentle AI ${inspection.event} release fast path failed closed: the remote protected main head advanced or could not be re-proven immediately before tag push. Re-validate against the current immutable origin/main SHA or fall back to native receipt validation.`,
			};
		}
	}
	return undefined;
}

export async function enforceReviewGateAndCommandSafety(
	command: string,
	evaluateGate: ReviewGateEvaluator,
	evaluateSafety: CommandSafetyEvaluator,
): Promise<ToolCallEventResult | undefined> {
	const safetyResult = await evaluateSafety(command);
	if (safetyResult) return safetyResult;
	return evaluateGate(command);
}

/** @internal */
export const __testing = {
	listAgentsFromDir,
	listAgentsFromDirAsync,
	listDiscoverableAgents,
	orderDiscoverableAgents,
	classifyGuardedCommand,
	loadRuntimeGuardrailsConfig,
	buildGentlePrompt,
	classifyReviewEvent,
	resolveReviewLifecycleCommand,
	inspectReviewLifecycleCommand,
	deriveReviewGateTarget,
	gateLifecycleCommand,
	executeReviewControllerOperation,
	enforceReviewGateAndCommandSafety,
	renderSddModelPanel: renderSddModelPanelForTesting,
	getOrchestratorPrompt,
	renderOrchestratorPrompt,
};

export default function gentleAi(pi: ExtensionAPI): void {
	const pendingReviewAuthorizations = new Map<string, PendingReviewAuthorization>();

	pi.registerTool({
		name: "gentle_review",
		label: "Gentle Review Controller",
		description:
			"Create, advance, inspect, and validate a bounded Gentle AI review transaction. Validate accepts one exact direct lifecycle command, derives its typed target from the command itself, and produces a one-shot authorization consumed by that exact subsequent bash command.",
		promptSnippet: "Create, advance, inspect, or validate a bounded review transaction",
		promptGuidelines: [
			"Use gentle_review for bounded review transaction start, advance, status, and exact lifecycle validation; never fabricate bash tool metadata or a separate gate target.",
		],
		parameters: REVIEW_CONTROLLER_PARAMETERS,
		executionMode: "sequential",
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review controller operation was cancelled");
			const details = executeReviewControllerOperation(
				parameters,
				ctx.cwd,
				pendingReviewAuthorizations,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});

	function runSddPreflight(ctx: ExtensionContext): Promise<SddPreflightPreferences> {
		return ensureSddPreflight(ctx, {
			pi,
			installAssets: (cwd) => installSddAssets(cwd, false),
			applyModelConfig: async () => applySavedModelConfig(ctx),
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			const installResult = installSddAssets(ctx.cwd, true);
			migrateLegacyProjectModelOverrides(ctx.cwd);
			const modelResult = await applySavedModelConfig(ctx);
			if (ctx.hasUI && modelResult.invalidPath) {
				ctx.ui.notify(
					`el Gentleman skipped model config because ${modelResult.invalidPath} is invalid JSON or not an object. Fix or remove the file, then run /gentle:models again.`,
					"warning",
				);
				return;
			}
			if (ctx.hasUI && modelResult.updated > 0) {
				ctx.ui.notify(
					`el Gentleman applied SDD model config to ${modelResult.updated} agent(s). Global SDD assets ready: ${installResult.agents} new agent(s), ${installResult.chains} new chain(s), ${installResult.support} new support file(s).`,
					"info",
				);
			}
		} catch (error) {
			if (ctx.hasUI) {
				const message =
					error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`el Gentleman model config sweep failed: ${message}`,
					"warning",
				);
			}
		}
	});

	pi.on("input", async (event, ctx) => {
		if (typeof event.text !== "string" || !isSddPreflightTrigger(event.text)) {
			return { action: "continue" };
		}
		await runSddPreflight(ctx);
		return { action: "continue" };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const isSddAgent = isSddAgentStartEvent(event);
		const isNamedAgent = isNamedAgentStartEvent(event);
		if (isSddAgent && !getSddPreflightPreferences(ctx)) {
			await runSddPreflight(ctx);
		}
		const prefs = getSddPreflightPreferences(ctx);
		const sddPrompt =
			prefs && (!isNamedAgent || isSddAgent)
				? `\n\n${renderSddPreflightPrompt(prefs)}`
				: "";
		const phase = isSddAgent ? sddPhaseFromAgentStartEvent(event) : undefined;
		const nativeStatusPrompt = phase
			? `\n\n${renderNativeSddPhasePrompt(resolveSddStatus({
				cwd: ctx.cwd,
				includeInstructions: true,
				artifactStore: prefs?.artifactStore,
			}), phase)}`
			: "";
		const gentlePrompt = isNamedAgent || isSddAgent
			? ""
			: `\n\n${buildGentlePrompt(readPersonaMode(ctx.cwd))}`;
		return {
			systemPrompt: `${event.systemPrompt}${gentlePrompt}${sddPrompt}${nativeStatusPrompt}`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		const sensitivePathDenied = evaluateSensitivePathTool(
			event.toolName,
			event.input,
		);
		if (sensitivePathDenied) return sensitivePathDenied;
		if (event.toolName !== "bash") return undefined;
		if (!isRecord(event.input) || typeof event.input.command !== "string")
			return undefined;
		return enforceReviewGateAndCommandSafety(
			event.input.command,
			(command) => gateLifecycleCommand(command, ctx.cwd, pendingReviewAuthorizations),
			(command) => confirmCommand(command, ctx),
		);
	});

	pi.registerCommand("gentle:install-sdd", {
		description:
			"Repair or refresh global Gentle AI SDD subagent and chain assets.",
		handler: async (args, ctx) => {
			const force = args.includes("--force");
			const result = installSddAssets(ctx.cwd, force);
			ctx.ui.notify(
				`Global Gentle AI SDD assets installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} already present.`,
				"info",
			);
		},
	});

	pi.registerCommand("gentle:sdd-preflight", {
		description:
			"Run or reuse the lazy SDD preflight for this Pi session.",
		handler: async (_args, ctx) => {
			await runSddPreflight(ctx);
		},
	});

	const handleSddStatusCommand = (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const status = resolveSddStatus({
			cwd: ctx.cwd,
			changeName: parsed.changeName,
			includeInstructions: true,
			artifactStore: getSddPreflightPreferences(ctx)?.artifactStore,
		});
		ctx.ui.notify(
			parsed.json ? JSON.stringify(status, null, 2) : renderSddStatusMarkdown(status),
			sddStatusSeverity(status),
		);
	};

	pi.registerCommand("sdd-status", {
		description: "Show deterministic SDD change status and instructions.",
		handler: async (args, ctx) => {
			handleSddStatusCommand(args, ctx);
		},
	});

	const handleSddContinueCommand = (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const status = resolveSddStatus({
			cwd: ctx.cwd,
			changeName: parsed.changeName,
			includeInstructions: true,
			artifactStore: getSddPreflightPreferences(ctx)?.artifactStore,
		});
		ctx.ui.notify(
			parsed.json ? JSON.stringify(status, null, 2) : renderSddDispatcherMarkdown(status),
			sddStatusSeverity(status),
		);
	};

	pi.registerCommand("sdd-continue", {
		description: "Resolve SDD status and route the next phase deterministically.",
		handler: async (args, ctx) => {
			handleSddContinueCommand(args, ctx);
		},
	});

	pi.registerCommand("gentle:models", {
		description: "Configure global per-agent models for el Gentleman.",
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

	pi.registerCommand("gentle:doctor", {
		description: "Run read-only Gentle AI diagnostics for this Pi workspace.",
		handler: async (_args, ctx) => {
			const agentsInstalled = existsSync(
				join(gentlePiAgentHome(), "agents", "sdd-apply.md"),
			);
			const chainsInstalled = existsSync(
				join(gentlePiAgentHome(), "chains", "sdd-full.chain.md"),
			);
			const openspecConfigured = existsSync(
				join(ctx.cwd, "openspec", "config.yaml"),
			);
			const skillRegistryPresent = existsSync(
				join(ctx.cwd, ".atl", "skill-registry.md"),
			);
			const staleSddAssets = sddGlobalAssetDriftCount();
			const localSddAgentOverrides = sddLocalAgentOverrideCount(ctx.cwd);
			const modelConfig = await readSavedModelConfigAsync(ctx.cwd);
			const engramActive = hasWritableEngramTool(pi);
			const lines = [
				"el Gentleman doctor",
				`${agentsInstalled ? "pass" : "fail"}: Global SDD agents ${agentsInstalled ? "installed" : "missing"}`,
				`${chainsInstalled ? "pass" : "fail"}: Global SDD chains ${chainsInstalled ? "installed" : "missing"}`,
				`${staleSddAssets === 0 ? "pass" : "warn"}: Global SDD asset drift ${staleSddAssets} file(s)`,
				`${localSddAgentOverrides === 0 ? "pass" : "warn"}: Project-local SDD agent overrides ${localSddAgentOverrides} file(s)`,
				`${openspecConfigured ? "pass" : "warn"}: OpenSpec config ${openspecConfigured ? "present" : "missing"}`,
				`${skillRegistryPresent ? "pass" : "warn"}: Skill registry ${skillRegistryPresent ? "present" : "missing"}`,
				`${modelConfig.status === "invalid" ? "fail" : "pass"}: Global model config ${modelConfig.status}`,
				"pass: Sensitive-path guard active for read/write/edit tools",
				`${engramActive ? "pass" : "warn"}: Engram memory tools ${engramActive ? "active" : "not active in this session"}`,
			];
			if (!agentsInstalled || !chainsInstalled) {
				lines.push("remedy: run /gentle:install-sdd --force to refresh global SDD assets intentionally");
			}
			if (modelConfig.status === "invalid") {
				lines.push(`remedy: fix or remove ${modelConfig.path}`);
			}
			if (localSddAgentOverrides > 0) {
				lines.push("remedy: remove project-local SDD agent overrides unless intentionally debugging package assets");
			}
			ctx.ui.notify(
				lines.join("\n"),
				lines.some((line) => line.startsWith("fail:")) ? "warning" : "info",
			);
		},
	});

	pi.registerCommand("gentle:status", {
		description: "Show Gentle AI package status for this project.",
		handler: async (_args, ctx) => {
			const agentsInstalled = existsSync(
				join(gentlePiAgentHome(), "agents", "sdd-apply.md"),
			);
			const chainsInstalled = existsSync(
				join(gentlePiAgentHome(), "chains", "sdd-full.chain.md"),
			);
			const openspecConfigured = existsSync(
				join(ctx.cwd, "openspec", "config.yaml"),
			);
			const staleSddAssets = sddGlobalAssetDriftCount();
			const localSddAgentOverrides = sddLocalAgentOverrideCount(ctx.cwd);
			const modelConfig = await readModelConfigAsync(ctx.cwd);
			ctx.ui.notify(
				[
					"el Gentleman package is active.",
					`Persona: ${readPersonaMode(ctx.cwd)}`,
					`Global SDD agents: ${agentsInstalled ? "installed" : "not installed"}`,
					`Global SDD chains: ${chainsInstalled ? "installed" : "not installed"}`,
					`Global SDD assets stale: ${staleSddAssets} file(s)${
						staleSddAssets > 0
							? " — run /gentle:install-sdd --force to refresh intentionally"
							: ""
					}`,
					`Project-local SDD agent overrides: ${localSddAgentOverrides} file(s)${
						localSddAgentOverrides > 0
							? " — local SDD agents shadow package assets; remove them unless intentionally debugging"
							: ""
					}`,
					`OpenSpec config: ${openspecConfigured ? "present" : "missing"}`,
					`Global model config: ${existsSync(modelConfigPath(ctx.cwd)) ? "present" : "missing"}`,
					...describeModelConfig(ctx.cwd, modelConfig),
				].join("\n"),
				staleSddAssets > 0 || localSddAgentOverrides > 0 ? "warning" : "info",
			);
		},
	});
}
