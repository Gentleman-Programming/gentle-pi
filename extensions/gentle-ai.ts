import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { promisify } from "node:util";
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
import { canonicalJsonV1, domainHashV1 } from "../lib/review-canonical.ts";
import { inspectLegacyReviewAuthorityV1, type LegacyInspectionV1 } from "../lib/review-legacy-detector.ts";
import { ReviewMutationLockV1 } from "../lib/review-lock.ts";
import {
	COMPACT_START_BLOCK_ACTION,
	GRAPH_V1_ORDINARY_READ_ONLY,
	CompactReviewStartBlockedError,
	CompactReviewTerminalAmbiguityError,
	inspectCompactTerminalApplicability,
	discoverCompactReview,
	finalizeCompactReview,
	startCompactReview,
} from "../lib/review-facade.ts";
import { CompactReviewContractError, deriveNativeRefuterRequest, deriveNativeValidationRequest, parseNativeCompactFinalizeInput, toNativeReviewerDocument, toNativeValidatorDocument } from "../lib/review-compact-contract.ts";
import { toNativeRefuterDocument } from "../lib/review-refuter-adapter.ts";
import { validateCompactReviewGate } from "../lib/review-compact-gate.ts";
import {
	assertLiveRecoveredSourceBindingV1,
	assertLiveRecoveredSuccessorBindingV1,
	createSupersessionEnvelopeV1,
	hasEligibleGraphV1RecoveryAuthorityV1,
	inspectApprovedCompactSuccessorV1,
	inspectRecoverableGraphSourceV1,
	prepareSupersessionV1,
	resolveReviewAuthorityForChange,
	SupersessionStoreV1,
	type PrepareSupersessionInputV1,
} from "../lib/review-authority-supersession.ts";
import {
	COMPACT_AUTHORITY_OUTCOME,
	compactV2LineageExists,
	discoverCompactReviewStores,
	graphV1LineageExists,
	hasGraphV1Authority,
	inspectCompactReviewAuthorityV2,
	type CompactAuthorityInspectionV2,
} from "../lib/review-compact-store.ts";
import {
	inheritedUnsafeGitEnvironmentKeys,
	publicationProbeGitEnvironment,
	ReviewRepositoryError,
	resolveRepositoryAuthorityV1,
} from "../lib/review-repository.ts";
import { captureLiveReviewCandidateBinding } from "../lib/review-snapshot.ts";
import {
	EXTERNAL_RELEASE_EVIDENCE,
	GATE_RESULT,
	GATE_TARGET_KIND,
	JOURNAL_STATUS,
	PUSH_UPDATE_KIND,
	REVIEW_OPERATION,
	REVIEW_TRANSITION,
	ReviewTransactionStore,
	canonicalHash,
	createReviewState,
	evaluateReleaseFastPathV1,
	projectExactTagCreatePushAsReleaseV1,
	recheckReleaseFastPathCiStatusV1,
	recheckReleaseFastPathRemoteHeadV1,
	resolveConfiguredPushDestinationV1,
	resolvePushDestinationRefV1,
	resolvePushRemoteRefV1,
	validateAuthoritativeReviewGate,
	type GateTargetV1,
	type PushGateTargetV1,
	type ReleaseFastPathEvidenceV1,
	type ReviewBudgetV1,
	type ReviewReducerInput,
	type StartOperationResultV1,
	type ReviewTransition,
} from "../lib/review-transaction.ts";
import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	captureReviewSnapshot,
	captureOrdinaryCorrectionSnapshot,
	type ReviewMode,
	type ReviewProjectionV1,
} from "../lib/review-snapshot.ts";
import { sanitizeTerminalText, stripAnsi } from "../lib/terminal-theme.ts";
import { CandidateViewError, CandidateViewRegistry, injectReviewCandidateView, resolveCanonicalCandidateBase } from "../lib/review-candidate-view.ts";
import { NATIVE_REVIEW_AUTHORITY_APPLICABILITY, classifyNativeReviewRemediation } from "../lib/native-review-remediation.ts";
import {
	createNativeReviewCli,
	isCanonicalProcessString,
	NativeReviewCliError,
	NATIVE_REVIEW_AUTHORITY_STATUS,
	NATIVE_REVIEW_ERROR_CODE,
	NATIVE_REVIEW_LOCK_STATUS,
	sanitizeForeignNativeReviewDiagnostics,
	type NativeReviewCli,
	type NativeFinalizeResult,
	type NativeReviewProcessDiagnostics,
	type NativeStartResult,
	type NativeReviewStatusResult,
	type NativeValidateResult,
} from "../lib/native-review-cli.ts";
import type { ReviewStatusV1 } from "../lib/review-integration-v1.ts";
import {
	abandonCommitTransaction,
	assertNoUnresolvedCommitTransaction,
	buildCommitTransactionShellCommand,
	inspectCommitTransaction,
	prepareCommitTransactionInvocation,
	reconcileCommitTransaction,
	verifyCommitTransactionResult,
} from "../lib/git-commit-transaction.ts";

const execFileAsync = promisify(execFile);

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
	FINALIZE: "finalize",
	ADVANCE: "advance",
	STATUS: "status",
	VALIDATE: "validate",
	EXPORT: "export",
	IMPORT: "import",
	INSPECT: "inspect",
	RESET: "reset",
	RECOVER: "recover",
	RECOVER_LOCK: "recover-lock",
	PREPARE_SUPERSESSION: "prepare-supersession",
	SUPERSEDE: "supersede",
	REPAIR: "repair",
	BIND_SDD: "bind-sdd",
} as const;

type ReviewControllerOperation =
	(typeof REVIEW_CONTROLLER_OPERATION)[keyof typeof REVIEW_CONTROLLER_OPERATION];

const NATIVE_BIND_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const REVIEW_CONTROLLER_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["operation"],
	properties: {
		operation: {
			type: "string",
			enum: Object.values(REVIEW_CONTROLLER_OPERATION),
			description: "Controller operation. Inspect authority before start. Reset requires the exact challenge returned by inspect.",
		},
		lineageId: {
			type: "string",
			description: "Bounded review lineage identifier. A failed start creates no lineage; do not use it with status or advance.",
		},
		changeName: {
			type: "string",
			description: "Canonical OpenSpec change name required to resolve a recovered authority during lifecycle validate.",
		},
		idempotencyKey: {
			type: "string",
			description: "Required for graph-v1 start/advance and lifecycle validate operations.",
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
			description: "A JSON-serialized object string, not a nested object. New native ordinary START uses {\"mode\":\"ordinary\"}; an explicit baseRef requires committedOnly: true and requests a committed range, while repository-local policyPath remains optional. Legacy compact START retains policyHash. FINALIZE supplies reviewer results, correction forecast, targeted validation, final evidence, and an explicit final_verification_passed boolean. Judgment Day retains graph-v1 input.",
		},
		outputPath: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		inputPath: { type: "string", description: "Repository-local JSON input file for finalize/advance (alternative to input). Legacy bundle import is retired." },
		operationId: { type: "string", description: "Retired with legacy bundle transport; ignored. Export/import return legacy-operation-retired." },
		lineageIds: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		workspaceRoot: {
			type: "string",
			description: "Optional absolute Git worktree root that owns this review (for example the SDD apply worktree). It must be an existing worktree root sharing the session repository's Git common directory; validation fails closed otherwise. Absent, the session cwd is used unchanged.",
		},
	},
} as const;

interface ReviewControllerParameters {
	operation: ReviewControllerOperation;
	lineageId?: string;
	changeName?: string;
	idempotencyKey?: string;
	transition?: string;
	command?: string;
	input?: string;
	outputPath?: string;
	inputPath?: string;
	operationId?: string;
	lineageIds?: string;
	acknowledgeUntrustedBundleSource?: string;
	workspaceRoot?: string;
}

interface SupersessionControllerInput {
	changeName: string;
	sourceLineageId: string;
	successorLineageId: string;
	operationId: string;
	prepared: PrepareSupersessionInputV1;
	challenge?: string;
	request_hash?: string;
}

interface ReviewControllerStartInput {
	mode: ReviewMode;
	projection: ReviewProjectionV1;
	policyHash: string;
	evidenceHash: string;
	budget: ReviewBudgetV1;
	parentLineageId?: string;
}

interface NativeReleaseEvidence {
	release_configuration: string;
	release_generated: string;
	release_provenance: string;
	release_publication_boundary: string;
	release_evidence_freshness: string;
}

interface MaintainerExceptionInput {
	request_hash: string;
	challenge: string;
	reason: string;
	accepted_predicates: readonly string[];
}

interface ReviewControllerValidateInput {
	scopeBudget?: ReviewBudgetV1;
	release?: ReleaseFastPathEvidenceV1;
	nativeRelease?: NativeReleaseEvidence;
	maintainerException?: MaintainerExceptionInput;
}

interface ReviewResetStateBody {
	schema: string;
	reset_id: string;
	repository_id: string;
	common_directory_hash: string;
	authorized_inventory_hash: string;
	authorization_hash: string;
	sequence: number;
	phase: string;
	quarantine_relative_path: string;
	moved_roots: string[];
	deleted_roots: string[];
	identity_recovery?: boolean;
}

interface ReviewResetStateEnvelope {
	body: ReviewResetStateBody;
	reset_state_hash: string;
}

interface DerivedReviewGateTarget {
	command: ReviewLifecycleCommand;
	target: GateTargetV1;
	actualIntendedCommitTree?: string;
	nativeRelease?: NativeReleaseEvidence;
	nativePublication?: NativePublicationBinding;
}

interface NativePrePrBoundaryBinding {
	source: "explicit";
	selector: string;
	commit: string;
	remote: string;
	remoteRef: string;
	remoteIdentity: string;
}

const GH_REPOSITORY_SOURCE = {
	EXPLICIT: "explicit",
	ENVIRONMENT: "environment",
	LOCAL: "local",
} as const;

type GhRepositorySource = (typeof GH_REPOSITORY_SOURCE)[keyof typeof GH_REPOSITORY_SOURCE];

interface GhRepositoryBinding {
	source: GhRepositorySource;
	value: string;
	remote: string;
	remoteIdentity: string;
}

interface NativePrePrHeadBinding {
	selector: string;
	commit: string;
	remote: string;
	remoteRef: string;
	remoteIdentity: string;
}

interface NativePrePushRangeBinding {
	remote: string;
	destinationRef: string;
	oldObject: string;
	newObject: string;
	baseSelector: string;
	advertisedBaseCommit: string;
}

interface NativePublicationBinding {
	flags: readonly string[];
	pushRemote?: string;
	pushIdentity?: string;
	release?: NativeReleaseEvidence;
	prePushRange?: NativePrePushRangeBinding;
	prePrBoundary?: NativePrePrBoundaryBinding;
	prePrHead?: NativePrePrHeadBinding;
	repository?: GhRepositoryBinding;
}

interface AdvertisedBranch {
	selector: string;
	remote: string;
	remoteRef: string;
	commit: string;
	remoteIdentity: string;
	localRef: string;
}

interface AdvertisedRemoteBranch {
	remote: string;
	remoteRef: string;
	commit: string;
	remoteIdentity: string;
}

const ADVERTISED_BRANCH_KIND = {
	BASE: "base",
	HEAD: "head",
} as const;

type AdvertisedBranchKind = (typeof ADVERTISED_BRANCH_KIND)[keyof typeof ADVERTISED_BRANCH_KIND];

const PUBLICATION_PROBE_ERROR_CODE = {
	CANCELLED: "cancelled",
	TIMEOUT: "timeout",
	UNAVAILABLE: "unavailable",
	NON_ZERO: "non-zero",
	SIGNAL: "signal",
	OUTPUT_LIMIT: "output-limit",
} as const;

type PublicationProbeErrorCode = (typeof PUBLICATION_PROBE_ERROR_CODE)[keyof typeof PUBLICATION_PROBE_ERROR_CODE];

interface PublicationProbeRequest {
	file: "git";
	arguments: readonly string[];
	cwd: string;
	timeoutMs: number;
	maxBufferBytes: number;
	shell: false;
	signal?: AbortSignal;
	environment: NodeJS.ProcessEnv;
}

interface PublicationProbeResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	outputLimitExceeded: boolean;
}

type PublicationProbe = (request: PublicationProbeRequest) => Promise<PublicationProbeResult>;

class PublicationProbeError extends Error {
	readonly code: PublicationProbeErrorCode;

	constructor(code: PublicationProbeErrorCode, message: string) {
		super(message);
		this.name = "PublicationProbeError";
		this.code = code;
	}
}

const NATIVE_PUBLICATION_BASE_NEXT_ACTION = {
	UNSUPPORTED_UNTIL_PERSISTED_BASE: "native-first-push-unsupported-until-persisted-advertised-base-exists",
} as const;

const NATIVE_SPLIT_FETCH_PUSH_NEXT_ACTION = "native-split-fetch-push-unsupported-until-upstream-supports-explicit-push-base";

class NativePublicationBaseRequiredError extends Error {
	readonly nextAction = NATIVE_PUBLICATION_BASE_NEXT_ACTION.UNSUPPORTED_UNTIL_PERSISTED_BASE;

	constructor() {
		super("Native first-push authorization is unsupported until Pi has a persisted explicit advertised-base source");
		this.name = "NativePublicationBaseRequiredError";
	}
}

class NativeSplitFetchPushUnsupportedError extends Error {
	readonly nextAction = NATIVE_SPLIT_FETCH_PUSH_NEXT_ACTION;

	constructor() {
		super("Native split fetch/push pre-push is unsupported by the upstream base-ref contract because <remote>/<branch> resolves through fetch-side remote-tracking state");
		this.name = "NativeSplitFetchPushUnsupportedError";
	}
}

const PUBLICATION_PROBE_TIMEOUT_MS = 2_000;
const PUBLICATION_PROBE_MAX_BUFFER_BYTES = 64 * 1024;
const BASH_TIME_REVALIDATION_TIMEOUT_MS = 30_000;

const nodePublicationProbe: PublicationProbe = async (request) => {
	try {
		const output = await execFileAsync(request.file, [...request.arguments], {
			cwd: request.cwd,
			encoding: "utf8",
			env: request.environment,
			maxBuffer: request.maxBufferBytes,
			shell: request.shell,
			signal: request.signal,
			timeout: request.timeoutMs,
			windowsHide: true,
		});
		return { stdout: output.stdout, stderr: output.stderr, exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
	} catch (error) {
		const detail = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number; signal?: NodeJS.Signals; killed?: boolean };
		if (detail.code === "ENOENT" || detail.code === "EACCES" || detail.name === "AbortError") throw error;
		return {
			stdout: detail.stdout ?? "",
			stderr: detail.stderr ?? "",
			exitCode: typeof detail.code === "number" ? detail.code : 1,
			signal: detail.signal ?? null,
			timedOut: detail.killed === true,
			outputLimitExceeded: detail.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
		};
	}
};

interface ReleaseFastPathAuthorizationV1 {
	remote: string;
	protected_ref: string;
	expected_remote_head: string;
	expected_ci_revision: string;
	expected_ci_status: "success";
	push_destination_id?: string;
}

interface NativeReviewAuthorizationContext {
	lineage_id: string;
	store_revision: string;
	fingerprint: string;
	intended_tree?: string;
}

interface MaintainerExceptionAudit {
	durable_audit: false;
	command: string;
	target: GateTargetV1;
	native_denial: MaintainerExceptionRequest["native_denial"];
	request_hash: string;
	accepted_predicates: readonly string[];
}

interface MaintainerExceptionRequest extends MaintainerExceptionInput {
	schema: "gentle-ai.release-maintainer-exception/v1";
	target: GateTargetV1;
	repository_id: string;
	origin_main: { commit: string; remote_identity: string };
	native_denial: { result: "invalidated"; action: "explicit-maintainer-action"; reason: string; context_fingerprint: string };
	release_evidence: NativeReleaseEvidence | null;
	zero_actor_status: "native denial; no actors were launched";
	failed_predicates: readonly string[];
	audit: MaintainerExceptionAudit;
}

interface PendingReviewAuthorization {
	command_hash: string;
	target_hash: string;
	receipt_hash: string | null;
	native_gate?: NativeReviewAuthorizationContext;
	native_release?: NativeReleaseEvidence;
	release_fast_path?: ReleaseFastPathAuthorizationV1;
	maintainer_exception?: MaintainerExceptionRequest;
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
	const needsLineage = ![REVIEW_CONTROLLER_OPERATION.START, REVIEW_CONTROLLER_OPERATION.FINALIZE, REVIEW_CONTROLLER_OPERATION.STATUS, REVIEW_CONTROLLER_OPERATION.EXPORT, REVIEW_CONTROLLER_OPERATION.IMPORT, REVIEW_CONTROLLER_OPERATION.INSPECT, REVIEW_CONTROLLER_OPERATION.RESET, REVIEW_CONTROLLER_OPERATION.RECOVER, REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK, REVIEW_CONTROLLER_OPERATION.PREPARE_SUPERSESSION, REVIEW_CONTROLLER_OPERATION.SUPERSEDE, REVIEW_CONTROLLER_OPERATION.REPAIR, REVIEW_CONTROLLER_OPERATION.VALIDATE, REVIEW_CONTROLLER_OPERATION.BIND_SDD].includes(value.operation as ReviewControllerOperation);
	if (needsLineage && (typeof value.lineageId !== "string" || value.lineageId.trim().length === 0)) {
		throw new Error("Review controller requires a lineageId");
	}
	const parameters: ReviewControllerParameters = {
		operation: value.operation,
		...(typeof value.lineageId === "string" ? { lineageId: value.lineageId } : {}),
	};
	for (const key of ["changeName", "idempotencyKey", "transition", "command", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource", "workspaceRoot"] as const) {
		const optional = value[key];
		if (optional !== undefined && typeof optional !== "string") {
			if (value.operation === REVIEW_CONTROLLER_OPERATION.START && key === "input") {
				throw new Error("Review controller START input must be a JSON string encoding an object, not a nested object. No lineage was created; do not call STATUS or ADVANCE for this attempted lineage.");
			}
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
		if (operation === REVIEW_CONTROLLER_OPERATION.START) {
			throw new Error(
				`Review controller START input must be a JSON string encoding an object: ${error instanceof Error ? error.message : String(error)}. No lineage was created; do not call STATUS or ADVANCE for this attempted lineage.`,
			);
		}
		throw new Error(
			`Review controller ${operation} input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(value)) throw new Error(`Review controller ${operation} input must be a JSON object`);
	return value;
}

function parseSupersessionControllerInput(value: Record<string, unknown>): SupersessionControllerInput {
	for (const key of ["changeName", "sourceLineageId", "successorLineageId", "operationId"] as const) {
		if (typeof value[key] !== "string" || value[key].trim().length === 0) throw new Error(`Review controller supersession requires ${key}`);
	}
	if (!isRecord(value.prepared)) throw new Error("Review controller supersession requires the exact prepared request input");
	return {
		changeName: value.changeName as string,
		sourceLineageId: value.sourceLineageId as string,
		successorLineageId: value.successorLineageId as string,
		operationId: value.operationId as string,
		prepared: value.prepared as unknown as PrepareSupersessionInputV1,
		...(typeof value.challenge === "string" ? { challenge: value.challenge } : {}),
		...(typeof value.request_hash === "string" ? { request_hash: value.request_hash } : {}),
	};
}

function assertSupersessionControllerIdentity(
	input: SupersessionControllerInput,
	prepared: ReturnType<typeof prepareSupersessionV1>,
): void {
	if (
		input.operationId !== prepared.body.operation_id ||
		input.changeName !== prepared.body.change.change_name ||
		input.sourceLineageId !== prepared.body.source.lineage_id ||
		input.successorLineageId !== prepared.body.successor.lineage_id ||
		canonicalJsonV1(input.prepared) !== canonicalJsonV1({
			operation_id: prepared.body.operation_id,
			eligibility: input.prepared.eligibility,
			equivalence: input.prepared.equivalence,
			...(input.prepared.predecessor_recovery_id === undefined ? {} : { predecessor_recovery_id: input.prepared.predecessor_recovery_id }),
			...(input.prepared.sequence === undefined ? {} : { sequence: input.prepared.sequence }),
		})
	) throw new Error("Review controller supersession identity does not exactly match the prepared request");
}

const REVIEW_CONTROLLER_OUTCOME = {
	RESET_STATE_UNAVAILABLE: "reset-state-unavailable",
} as const;

class ReviewResetStateUnavailableError extends Error {
	readonly code = REVIEW_CONTROLLER_OUTCOME.RESET_STATE_UNAVAILABLE;
	readonly statePath: string;

	constructor(statePath: string) {
		super("Review reset recovery state is unavailable");
		this.name = "ReviewResetStateUnavailableError";
		this.statePath = statePath;
	}
}

function durableResetRecoveryRequest(cwd: string): LegacyInspectionV1["reset_request"] {
	const authority = resolveRepositoryAuthorityV1(cwd);
	const statePath = join(authority.store_root, "control", "reset-state.json");
	let serialized: string;
	try {
		serialized = readFileSync(statePath, "utf8");
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") throw new ReviewResetStateUnavailableError(statePath);
		throw error;
	}
	const value = JSON.parse(serialized) as unknown;
	if (!isRecord(value) || !isRecord(value.body)) throw new Error("Review reset recovery state is malformed");
	const envelope = value as unknown as ReviewResetStateEnvelope;
	const body = envelope.body;
	if (
		body.schema !== "gentle-ai.review-reset-state/v1" ||
		typeof body.reset_id !== "string" ||
		typeof body.repository_id !== "string" ||
		typeof body.common_directory_hash !== "string" ||
		typeof body.authorized_inventory_hash !== "string" ||
		typeof body.authorization_hash !== "string" ||
		!Number.isSafeInteger(body.sequence) ||
		typeof body.phase !== "string" ||
		typeof body.quarantine_relative_path !== "string" ||
		!Array.isArray(body.moved_roots) ||
		!Array.isArray(body.deleted_roots) ||
		typeof envelope.reset_state_hash !== "string" ||
		envelope.reset_state_hash !== domainHashV1("reset-state", body)
	) {
		throw new Error("Review reset recovery state failed integrity validation");
	}
	const currentCommonDirectoryHash = domainHashV1("common-directory", authority.common_directory);
	if (
		body.repository_id !== authority.repository_id ||
		body.common_directory_hash !== currentCommonDirectoryHash
	) {
		throw new Error("Review reset recovery state does not match the current repository authority");
	}
	const allowedRoots = new Set([
		"lineages",
		"locks",
		"legacy-evidence",
		"migration",
		"migration-operations",
		"graph-v1",
		"compact-v2",
		...(body.identity_recovery === true ? ["IDENTITY"] : []),
	]);
	const expectedQuarantinePath = join("reset-quarantine", body.reset_id);
	if (
		!/^[0-9a-f]{64}$/.test(body.reset_id) ||
		body.quarantine_relative_path !== expectedQuarantinePath ||
		isAbsolute(body.quarantine_relative_path) ||
		body.moved_roots.some((root) => typeof root !== "string" || !allowedRoots.has(root)) ||
		body.deleted_roots.some((root) => typeof root !== "string" || !body.moved_roots.includes(root)) ||
		new Set(body.moved_roots).size !== body.moved_roots.length ||
		new Set(body.deleted_roots).size !== body.deleted_roots.length
	) {
		throw new Error("Review reset recovery state contains unsafe quarantine path semantics");
	}
	const confirmation = `DESTROY REVIEW AUTHORITY ${body.repository_id} AT ${body.common_directory_hash} INVENTORY ${body.authorized_inventory_hash}`;
	if (body.authorization_hash !== domainHashV1("reset-authorization", confirmation)) {
		throw new Error("Review reset recovery authorization failed integrity validation");
	}
	return {
		repositoryId: body.repository_id,
		commonDirHash: body.common_directory_hash,
		inventoryHash: body.authorized_inventory_hash,
		confirmation,
	};
}

interface ControllerReviewAuthorityInspection extends LegacyInspectionV1 {
	compact_authority?: CompactAuthorityInspectionV2;
}

type PublicControllerReviewAuthorityInspection = Omit<ControllerReviewAuthorityInspection, "reset_request"> & {
	reset_request?: LegacyInspectionV1["reset_request"];
};

function hasPiResetEligibility(inspection: ControllerReviewAuthorityInspection): boolean {
	return (
		inspection.outcome !== "reset-in-progress" &&
		"reset_request" in inspection &&
		(
			inspection.outcome !== "clean" ||
			inspection.compact_authority?.outcome === COMPACT_AUTHORITY_OUTCOME.INVALID
		)
	);
}

function publicReviewAuthorityInspection(
	inspection: ControllerReviewAuthorityInspection,
	resetEligible: boolean,
): PublicControllerReviewAuthorityInspection {
	if (resetEligible || inspection.outcome === "reset-in-progress") return inspection;
	const { reset_request: _resetRequest, ...sanitized } = inspection;
	return sanitized;
}

function inspectReviewAuthorityForController(cwd: string): ControllerReviewAuthorityInspection {
	const legacy = inspectLegacyReviewAuthorityV1(cwd);
	const compact = inspectCompactReviewAuthorityV2(cwd);
	const inspection = legacy.outcome === "reset-in-progress"
		? (() => {
			try {
				return { ...legacy, reset_request: durableResetRecoveryRequest(cwd) };
			} catch (error) {
				if (error instanceof ReviewResetStateUnavailableError) {
					return { ...legacy, reset_state_outcome: REVIEW_CONTROLLER_OUTCOME.RESET_STATE_UNAVAILABLE };
				}
				throw error;
			}
		})()
		: legacy;
	return compact.outcome === COMPACT_AUTHORITY_OUTCOME.NONE
		? inspection
		: { ...inspection, compact_authority: compact };
}

function compactAuthorityAction(inspection: ControllerReviewAuthorityInspection): string | undefined {
	switch (inspection.compact_authority?.outcome) {
		case COMPACT_AUTHORITY_OUTCOME.APPROVED:
			return COMPACT_START_BLOCK_ACTION.APPROVED;
		case COMPACT_AUTHORITY_OUTCOME.ESCALATED:
			return COMPACT_START_BLOCK_ACTION.ESCALATED;
		case COMPACT_AUTHORITY_OUTCOME.ACTIVE:
			return "finalize-existing-ordinary-review";
		case COMPACT_AUTHORITY_OUTCOME.INVALID:
			return inspection.outcome === "clean"
				? "request-explicit-reset-authorization"
				: "stop-and-report-ambiguous-authority";
		default:
			return undefined;
	}
}

async function authorizeDestructiveReviewOperation(
	parametersValue: unknown,
	ctx: ExtensionContext,
): Promise<void> {
	const parameters = parseReviewControllerParameters(parametersValue);
	const isReset = parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET || parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER;
	const isSupersession = parameters.operation === REVIEW_CONTROLLER_OPERATION.SUPERSEDE;
	if (!isReset && !isSupersession) return;
	const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
	const challengeKey = isSupersession ? "challenge" : "confirmation";
	if (isReset) {
		for (const key of ["repositoryId", "commonDirHash", "inventoryHash"] as const) {
			if (typeof input[key] !== "string" || input[key].length === 0) throw new Error(`Review controller ${parameters.operation} requires an exact string ${key}`);
		}
	}
	if (typeof input[challengeKey] !== "string" || input[challengeKey].length === 0) {
		throw new Error(`Review controller ${parameters.operation} requires an exact string ${challengeKey}`);
	}
	if (!ctx.hasUI) {
		throw new Error(`Review controller ${parameters.operation.toUpperCase()} requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed`);
	}
	const approved = await ctx.ui.confirm(
		isSupersession ? "Authorize review authority SUPERSESSION?" : `Authorize destructive review authority ${parameters.operation.toUpperCase()}?`,
		isSupersession
			? ["Operation: SUPERSEDE", `Exact challenge: ${input.challenge}`, "This preserves graph-v1 history and activates only the exact compact-v2 successor."].join("\n")
			: [`Operation: ${parameters.operation.toUpperCase()}`, `Repository: ${input.repositoryId}`, `Exact challenge: ${input.confirmation}`, "This invalidates all prior review authority for this repository."].join("\n"),
	);
	if (!approved) throw new Error(`Review controller ${parameters.operation.toUpperCase()} was not explicitly authorized`);
}

function parseReviewBudget(value: unknown, label: string): ReviewBudgetV1 {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	return value as unknown as ReviewBudgetV1;
}

function parseStartInput(value: Record<string, unknown>): ReviewControllerStartInput {
	if (value.mode !== REVIEW_MODE.ORDINARY && value.mode !== REVIEW_MODE.JUDGMENT_DAY) {
		throw new Error(
			'Review controller START supports only "ordinary" or "judgment-day" mode; use "ordinary" unless Judgment Day was explicitly selected. Pass input as a JSON string encoding the START object. START failed before authority access, so no lineage was created; do not call STATUS or ADVANCE for this attempted lineage.',
		);
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

function parseNativeReleaseEvidence(value: unknown): NativeReleaseEvidence {
	if (!isRecord(value)) throw new Error("Native release evidence must be an object");
	const fields = [
		"release_configuration",
		"release_generated",
		"release_provenance",
		"release_publication_boundary",
		"release_evidence_freshness",
	] as const;
	for (const field of fields) {
		if (!isCanonicalProcessString(value[field])) throw new Error(`Native release evidence requires a non-empty canonical ${field} path`);
	}
	return Object.fromEntries(fields.map((field) => [field, value[field]])) as NativeReleaseEvidence;
}

function nativeReleaseFlags(evidence: NativeReleaseEvidence): readonly string[] {
	return [
		"--release-configuration", evidence.release_configuration,
		"--release-generated", evidence.release_generated,
		"--release-provenance", evidence.release_provenance,
		"--release-publication-boundary", evidence.release_publication_boundary,
		"--release-evidence-freshness", evidence.release_evidence_freshness,
	];
}

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
	const input: ReviewControllerValidateInput = {};
	if (value.scopeBudget !== undefined) {
		input.scopeBudget = parseReviewBudget(value.scopeBudget, "Review controller validate scopeBudget");
	}
	if (value.release !== undefined) input.release = parseReleaseFastPathEvidence(value.release);
	if (value.nativeRelease !== undefined) input.nativeRelease = parseNativeReleaseEvidence(value.nativeRelease);
	if (value.maintainer_exception !== undefined) {
		const exception = value.maintainer_exception;
		if (!isRecord(exception) || typeof exception.request_hash !== "string" || typeof exception.challenge !== "string" || typeof exception.reason !== "string" || exception.reason.trim().length === 0 || !Array.isArray(exception.accepted_predicates) || exception.accepted_predicates.length === 0 || exception.accepted_predicates.some((predicate) => typeof predicate !== "string" || predicate.length === 0)) throw new Error("Maintainer exception requires exact request_hash, challenge, non-empty reason, and accepted_predicates");
		input.maintainerException = { request_hash: exception.request_hash, challenge: exception.challenge, reason: exception.reason, accepted_predicates: exception.accepted_predicates };
	}
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

function runPublicationGit(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: publicationProbeGitEnvironment(),
	}).trim();
}

async function runPublicationProbeGit(
	cwd: string,
	args: readonly string[],
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<string> {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const boundedSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
	let result: PublicationProbeResult;
	try {
		result = await probe({
			file: "git",
			arguments: args,
			cwd,
			timeoutMs,
			maxBufferBytes: PUBLICATION_PROBE_MAX_BUFFER_BYTES,
			shell: false,
			signal: boundedSignal,
			environment: publicationProbeGitEnvironment(),
		});
	} catch (error) {
		if (error instanceof PublicationProbeError) throw error;
		if (error instanceof Error && error.name === "AbortError") {
			throw new PublicationProbeError(
				signal?.aborted ? PUBLICATION_PROBE_ERROR_CODE.CANCELLED : PUBLICATION_PROBE_ERROR_CODE.TIMEOUT,
				signal?.aborted ? "Publication probe was cancelled" : "Publication probe timed out",
			);
		}
		throw new PublicationProbeError(PUBLICATION_PROBE_ERROR_CODE.UNAVAILABLE, "Publication probe could not start");
	}
	if (result.timedOut) throw new PublicationProbeError(PUBLICATION_PROBE_ERROR_CODE.TIMEOUT, "Publication probe timed out");
	if (result.outputLimitExceeded) throw new PublicationProbeError(PUBLICATION_PROBE_ERROR_CODE.OUTPUT_LIMIT, "Publication probe output exceeded its limit");
	if (result.signal) throw new PublicationProbeError(PUBLICATION_PROBE_ERROR_CODE.SIGNAL, "Publication probe was signalled");
	if (result.exitCode !== 0) throw new PublicationProbeError(PUBLICATION_PROBE_ERROR_CODE.NON_ZERO, "Publication probe failed");
	return result.stdout.trim();
}

function configuredGitValues(cwd: string, key: string): string[] {
	try {
		return runPublicationGit(cwd, ["config", "--get-all", key]).split(/\r?\n/).filter(Boolean);
	} catch {
		return [];
	}
}

function configuredRemotes(cwd: string): string[] {
	const remotes = runPublicationGit(cwd, ["remote"]).split(/\r?\n/).filter(Boolean);
	if (new Set(remotes).size !== remotes.length) throw new Error("Configured Git remotes are ambiguous");
	return remotes;
}

function singleConfiguredValue(cwd: string, key: string): string | undefined {
	const values = configuredGitValues(cwd, key);
	if (values.length > 1) throw new Error(`Git configuration ${key} is ambiguous`);
	return values[0];
}

function currentBranch(cwd: string): string {
	try {
		return runPublicationGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	} catch {
		throw new Error("Publication requires an attached current branch");
	}
}

function resolveNativePushRemote(cwd: string): string {
	const branch = currentBranch(cwd);
	const keys = [`branch.${branch}.pushRemote`, "remote.pushDefault", `branch.${branch}.remote`];
	for (const key of keys) {
		const remote = singleConfiguredValue(cwd, key);
		if (remote !== undefined) {
			resolveConfiguredPushDestinationV1(cwd, remote);
			return remote;
		}
	}
	if (configuredRemotes(cwd).includes("origin")) {
		resolveConfiguredPushDestinationV1(cwd, "origin");
		return "origin";
	}
	throw new Error("Native publication push remote is not configured");
}

function repositoryLocationIdentity(cwd: string, location: string): string {
	let normalized = location;
	try {
		const parsed = new URL(location);
		if (parsed.protocol && !parsed.pathname.startsWith("//")) {
			normalized = `${parsed.host.toLowerCase()}/${parsed.pathname.replace(/^\/+|\/+$/g, "")}`;
		} else throw new Error("not an absolute URL");
	} catch {
		const colon = location.indexOf(":");
		const slash = location.indexOf("/");
		if (colon > 0 && (slash < 0 || colon < slash)) {
			const host = location.slice(0, colon).split("@").at(-1)!.toLowerCase();
			normalized = `${host}/${location.slice(colon + 1)}`;
		} else if (!isAbsolute(location)) {
			normalized = resolve(runPublicationGit(cwd, ["rev-parse", "--show-toplevel"]), location);
		}
	}
	normalized = normalized.replace(/\/+$/, "").replace(/\.git$/, "");
	return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function repositoryCoordinates(location: string): { host: string; owner: string; repository: string } | undefined {
	let host: string;
	let path: string;
	try {
		const parsed = new URL(location);
		if (!parsed.host) throw new Error("not an absolute URL");
		host = parsed.host.toLowerCase();
		path = parsed.pathname;
	} catch {
		const colon = location.indexOf(":");
		const slash = location.indexOf("/");
		if (colon <= 0 || (slash >= 0 && colon > slash)) return undefined;
		host = location.slice(0, colon).split("@").at(-1)!.toLowerCase();
		path = location.slice(colon + 1);
	}
	const segments = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
	if (segments.length !== 2 || !segments[0] || !segments[1]) return undefined;
	return { host, owner: segments[0], repository: segments[1] };
}

function remoteFetchUrl(cwd: string, remote: string): string {
	const value = singleConfiguredValue(cwd, `remote.${remote}.url`);
	if (value === undefined) throw new Error(`Publication remote ${remote} has no unambiguous fetch URL`);
	return value;
}

function pushRemoteIdentity(cwd: string, remote: string): string {
	return repositoryLocationIdentity(cwd, resolveConfiguredPushDestinationV1(cwd, remote).url);
}

function localRefAtCommit(cwd: string, remote: string, branch: string, commit: string): string {
	for (const ref of [`refs/heads/${branch}`, `refs/remotes/${remote}/${branch}`]) {
		try {
			if (runPublicationGit(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]) === commit) return ref;
		} catch {
			// Continue to the other exact local evidence source.
		}
	}
	throw new Error(`Advertised base ${remote}/${branch} is not available at the same local commit`);
}

async function advertisedRemoteBranch(
	cwd: string,
	remote: string,
	branch: string,
	label: AdvertisedBranchKind,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
	location = remoteFetchUrl(cwd, remote),
): Promise<AdvertisedRemoteBranch> {
	runPublicationGit(cwd, ["check-ref-format", "--branch", branch]);
	const remoteRef = `refs/heads/${branch}`;
	const output = await runPublicationProbeGit(cwd, ["ls-remote", "--heads", location, remoteRef], probe, timeoutMs, signal);
	const rows = output.split(/\r?\n/).filter(Boolean);
	if (rows.length !== 1) throw new Error(`Advertised ${label} ${remote}/${branch} is missing or ambiguous`);
	const [commit, ref, extra] = rows[0]!.split(/\s+/);
	if (extra !== undefined || ref !== remoteRef || !/^[0-9a-f]{40,64}$/.test(commit ?? "")) throw new Error(`Advertised ${label} ${remote}/${branch} is malformed`);
	return {
		remote,
		remoteRef,
		commit: commit!,
		remoteIdentity: repositoryLocationIdentity(cwd, location),
	};
}

async function advertisedBranch(
	cwd: string,
	remote: string,
	branch: string,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
	location = remoteFetchUrl(cwd, remote),
): Promise<AdvertisedBranch> {
	const advertised = await advertisedRemoteBranch(cwd, remote, branch, ADVERTISED_BRANCH_KIND.BASE, probe, timeoutMs, signal, location);
	return {
		...advertised,
		selector: `${remote}/${branch}`,
		localRef: localRefAtCommit(cwd, remote, branch, advertised.commit),
	};
}

function optionalCommandOptionValue(arguments_: readonly string[], names: readonly string[]): string | undefined {
	const matches: string[] = [];
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]!;
		const exact = names.find((name) => argument === name);
		if (exact) {
			const value = arguments_[index + 1];
			if (!value) throw new Error(`${exact} is missing its value`);
			matches.push(value);
			index += 1;
			continue;
		}
		const equals = names.find((name) => argument.startsWith(`${name}=`));
		if (equals) matches.push(argument.slice(equals.length + 1));
	}
	if (matches.length > 1) throw new Error(`Command option ${names.join("/")} is ambiguous`);
	return matches[0];
}

interface ParsedGhRepository {
	host?: string;
	owner: string;
	repository: string;
	value: string;
}

function parseGhRepository(value: string, label: string): ParsedGhRepository {
	if (value.length === 0 || value.trim() !== value || /[\u0000-\u001f\u007f\\?#@]/.test(value) || value.includes("://")) {
		throw new Error(`${label} is malformed`);
	}
	const segments = value.split("/");
	if (segments.length !== 2 && segments.length !== 3) throw new Error(`${label} must use [HOST/]OWNER/REPO`);
	const [host, owner, repository] = segments.length === 3
		? [segments[0], segments[1], segments[2]]
		: [undefined, segments[0], segments[1]];
	if (!owner || !repository || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
		throw new Error(`${label} is malformed`);
	}
	if (host !== undefined) {
		const match = /^([A-Za-z0-9.-]+)(?::([0-9]+))?$/.exec(host);
		const port = match?.[2] === undefined ? undefined : Number(match[2]);
		if (!match || (port !== undefined && (!Number.isSafeInteger(port) || port < 1 || port > 65_535))) {
			throw new Error(`${label} host is malformed`);
		}
	}
	const normalizedHost = host?.toLowerCase();
	return {
		...(normalizedHost === undefined ? {} : { host: normalizedHost }),
		owner,
		repository,
		value: normalizedHost === undefined ? `${owner}/${repository}` : `${normalizedHost}/${owner}/${repository}`,
	};
}

function repositoryRemoteMatches(cwd: string, remote: string, repository: ParsedGhRepository): boolean {
	const coordinates = repositoryCoordinates(remoteFetchUrl(cwd, remote));
	return coordinates !== undefined &&
		(repository.host === undefined || coordinates.host === repository.host) &&
		coordinates.owner.toLowerCase() === repository.owner.toLowerCase() &&
		coordinates.repository.toLowerCase() === repository.repository.toLowerCase();
}

function effectiveGhRepository(command: ReviewLifecycleCommand): GhRepositoryBinding {
	if (command.arguments.some((argument) => /^-R.+/.test(argument))) {
		throw new Error("Pull request -R must pass its repository as a separate value");
	}
	const explicit = optionalCommandOptionValue(command.arguments, ["--repo", "-R"]);
	const inherited = explicit === undefined && process.env.GH_REPO !== undefined && process.env.GH_REPO.length > 0
		? process.env.GH_REPO
		: undefined;
	const selected = explicit ?? inherited;
	const remotes = configuredRemotes(command.cwd);
	if (remotes.length === 0) throw new Error("Pull request repository has no configured remote");
	let source: GhRepositorySource;
	let value: string;
	let remote: string;
	if (selected !== undefined) {
		const repository = parseGhRepository(selected, explicit === undefined ? "GH_REPO" : "Pull request --repo");
		const matches = remotes.filter((candidate) => repositoryRemoteMatches(command.cwd, candidate, repository));
		if (matches.length !== 1) throw new Error("Pull request repository does not map to one configured remote");
		source = explicit === undefined ? GH_REPOSITORY_SOURCE.ENVIRONMENT : GH_REPOSITORY_SOURCE.EXPLICIT;
		value = repository.value;
		remote = matches[0]!;
	} else {
		const resolved = remotes.filter((candidate) => singleConfiguredValue(command.cwd, `remote.${candidate}.gh-resolved`) !== undefined);
		if (resolved.length > 1) throw new Error("GitHub CLI default repository context is ambiguous");
		if (resolved.length === 0 && remotes.length !== 1) throw new Error("GitHub CLI local repository inference is ambiguous");
		remote = resolved[0] ?? remotes[0]!;
		const location = remoteFetchUrl(command.cwd, remote);
		const coordinates = repositoryCoordinates(location);
		source = GH_REPOSITORY_SOURCE.LOCAL;
		value = coordinates === undefined
			? location
			: `${coordinates.host}/${coordinates.owner}/${coordinates.repository}`;
	}
	return {
		source,
		value,
		remote,
		remoteIdentity: repositoryLocationIdentity(command.cwd, remoteFetchUrl(command.cwd, remote)),
	};
}

async function deriveAdvertisedPrePrBase(
	command: ReviewLifecycleCommand,
	base: string,
	repository: GhRepositoryBinding,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<AdvertisedBranch> {
	if (base.startsWith("refs/") || /^[0-9a-f]{40,64}$/.test(base)) throw new Error("Pull request base must be an advertised branch name");
	runPublicationGit(command.cwd, ["check-ref-format", "--branch", base]);
	return advertisedBranch(command.cwd, repository.remote, base, probe, timeoutMs, signal);
}

function parsePullRequestHead(head: string): { owner?: string; branch: string; remoteRef: string } {
	const separator = head.indexOf(":");
	if (separator !== head.lastIndexOf(":")) throw new Error("Pull request head is malformed");
	const owner = separator < 0 ? undefined : head.slice(0, separator);
	const branch = separator < 0 ? head : head.slice(separator + 1);
	if (
		!branch ||
		branch.startsWith("refs/") ||
		/^[0-9a-f]{40,64}$/.test(branch) ||
		(owner !== undefined && !owner) ||
		!/^[A-Za-z0-9_.-]+$/.test(owner ?? "owner")
	) throw new Error("Pull request head must use branch or owner:branch syntax");
	return { ...(owner === undefined ? {} : { owner }), branch, remoteRef: `refs/heads/${branch}` };
}

async function deriveAdvertisedPrePrHead(
	command: ReviewLifecycleCommand,
	head: string,
	repository: GhRepositoryBinding,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<NativePrePrHeadBinding> {
	const parsed = parsePullRequestHead(head);
	runPublicationGit(command.cwd, ["check-ref-format", "--branch", parsed.branch]);
	let remote = repository.remote;
	if (parsed.owner !== undefined) {
		const baseCoordinates = repositoryCoordinates(remoteFetchUrl(command.cwd, repository.remote));
		if (baseCoordinates === undefined) throw new Error("Pull request base repository coordinates are unavailable for an owner-qualified head");
		const matches = configuredRemotes(command.cwd).filter((candidate) => {
			const coordinates = repositoryCoordinates(remoteFetchUrl(command.cwd, candidate));
			return coordinates !== undefined &&
				coordinates.owner.toLowerCase() === parsed.owner!.toLowerCase() &&
				coordinates.host === baseCoordinates.host &&
				coordinates.repository.toLowerCase() === baseCoordinates.repository.toLowerCase();
		});
		if (matches.length !== 1) throw new Error("Pull request head repository does not map to one configured remote");
		remote = matches[0]!;
	}
	const advertised = await advertisedRemoteBranch(command.cwd, remote, parsed.branch, ADVERTISED_BRANCH_KIND.HEAD, probe, timeoutMs, signal);
	const localHead = runPublicationGit(command.cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
	if (advertised.commit !== localHead) throw new Error("Advertised pull request head does not match reviewed local HEAD");
	return { selector: head, ...advertised };
}

async function deriveNativeTagReleaseBinding(
	command: ReviewLifecycleCommand,
	target: PushGateTargetV1,
	evidence: NativeReleaseEvidence | undefined,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<NativePublicationBinding> {
	if (evidence === undefined) throw new Error("Native release validation requires all five release evidence artifact paths");
	if (target.remote !== "origin" || target.updates.length !== 1) throw new Error("Native tag release publication requires one exact origin tag create");
	const update = target.updates[0]!;
	if (update.kind !== PUSH_UPDATE_KIND.CREATE || !update.source_ref.startsWith("refs/tags/") || update.source_ref !== update.destination_ref) {
		throw new Error("Native tag release publication requires one unchanged tag create refspec");
	}
	if (command.arguments.some((argument) => /^--force(?:$|[-=])/.test(argument))) {
		throw new Error("Native tag release publication rejects force semantics");
	}
	const pushRemote = resolveNativePushRemote(command.cwd);
	if (pushRemote !== target.remote) throw new Error(`Push command remote ${target.remote} does not match native publication remote ${pushRemote}`);
	const destination = resolveConfiguredPushDestinationV1(command.cwd, target.remote);
	if (destination.destination_id !== target.destination_id) throw new Error("Push publication destination changed after exact command target derivation");
	const fetchUrl = remoteFetchUrl(command.cwd, target.remote);
	const pushIdentity = repositoryLocationIdentity(command.cwd, destination.url);
	if (destination.url !== fetchUrl || pushIdentity !== repositoryLocationIdentity(command.cwd, fetchUrl)) throw new NativeSplitFetchPushUnsupportedError();
	const advertisedTag = await runPublicationProbeGit(command.cwd, ["ls-remote", "--tags", fetchUrl, update.destination_ref], probe, timeoutMs, signal);
	if (advertisedTag.length > 0) throw new Error("Native tag release publication destination is no longer an exact tag create");
	const tagObject = runPublicationGit(command.cwd, ["rev-parse", "--verify", update.source_ref]);
	const peeledCommit = runPublicationGit(command.cwd, ["rev-parse", "--verify", `${update.source_ref}^{commit}`]);
	const tree = runPublicationGit(command.cwd, ["rev-parse", "--verify", `${peeledCommit}^{tree}`]);
	const head = runPublicationGit(command.cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
	if (tagObject !== update.new_object || peeledCommit !== update.new_peeled_commit || tree !== update.new_tree || peeledCommit !== head) {
		throw new Error("Native tag release publication local tag identity does not match reviewed HEAD");
	}
	const main = await advertisedRemoteBranch(command.cwd, "origin", "main", ADVERTISED_BRANCH_KIND.BASE, probe, timeoutMs, signal, fetchUrl);
	if (main.commit !== head || main.remoteIdentity !== pushIdentity) throw new Error("Native tag release publication does not match the freshly advertised origin/main identity");
	return { flags: nativeReleaseFlags(evidence), pushRemote, pushIdentity, release: evidence };
}

async function deriveNativePrePushBinding(
	command: ReviewLifecycleCommand,
	target: PushGateTargetV1,
	nativeRelease: NativeReleaseEvidence | undefined,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<NativePublicationBinding> {
	if (target.updates.length !== 1) throw new Error("Native pre-push requires one exact destination update");
	const update = target.updates[0]!;
	if (update.kind === PUSH_UPDATE_KIND.CREATE && update.destination_ref.startsWith("refs/tags/")) {
		return await deriveNativeTagReleaseBinding(command, target, nativeRelease, probe, timeoutMs, signal);
	}
	const pushRemote = resolveNativePushRemote(command.cwd);
	if (pushRemote !== target.remote) throw new Error(`Push command remote ${target.remote} does not match native publication remote ${pushRemote}`);
	if (update.kind === PUSH_UPDATE_KIND.CREATE) throw new NativePublicationBaseRequiredError();
	if (!update.destination_ref.startsWith("refs/heads/")) throw new Error("Native pre-push destination must be an advertised branch");
	const branch = update.destination_ref.slice("refs/heads/".length);
	const destination = resolveConfiguredPushDestinationV1(command.cwd, target.remote);
	if (destination.destination_id !== target.destination_id) throw new Error("Push publication destination changed after exact command target derivation");
	const fetchUrl = remoteFetchUrl(command.cwd, target.remote);
	const pushIdentity = repositoryLocationIdentity(command.cwd, destination.url);
	if (destination.url !== fetchUrl || pushIdentity !== repositoryLocationIdentity(command.cwd, fetchUrl)) {
		throw new NativeSplitFetchPushUnsupportedError();
	}
	const base = await advertisedBranch(command.cwd, target.remote, branch, probe, timeoutMs, signal, destination.url);
	if (base.commit !== update.old_object) throw new Error("Advertised push destination changed after exact command target derivation");
	return {
		flags: ["--base-ref", base.selector],
		pushRemote,
		pushIdentity,
		prePushRange: {
			remote: target.remote,
			destinationRef: update.destination_ref,
			oldObject: update.old_object,
			newObject: update.new_object,
			baseSelector: base.selector,
			advertisedBaseCommit: base.commit,
		},
	};
}

function commitIncludesAllTracked(arguments_: readonly string[]): boolean {
	const includesAllTracked = false;
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
			throw new Error("Commit --all cannot be exactly proven against the frozen reviewed projection");
		}
		if (/^-[^-]+$/.test(argument) && argument.length > 2) {
			const flags = argument.slice(1);
			if (/[^aemnsqv]/.test(flags)) {
				throw new Error(`Unsupported combined commit option: ${argument}`);
			}
			if (flags.includes("a")) throw new Error("Commit --all cannot be exactly proven against the frozen reviewed projection");
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
	commitIncludesAllTracked(command.arguments);
	return runReviewGit(command.cwd, ["write-tree"]);
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

function pushRemoteAndRefspec(arguments_: readonly string[]): { remote: string; refspec: string } {
	const unsupported = arguments_.find((argument) =>
		/^(?:--all|--delete|--follow-tags|--mirror|--prune|--tags|-d)$/.test(argument),
	);
	if (unsupported) throw new Error(`Unsupported broad push semantics: ${unsupported}`);
	const optionsWithValues = new Set([
		"--exec",
		"--push-option",
		"--receive-pack",
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

function derivePushTarget(command: ReviewLifecycleCommand, pinnedTarget?: PushGateTargetV1): GateTargetV1 {
	const { remote, refspec } = pushRemoteAndRefspec(command.arguments);
	if (refspec.startsWith(":")) throw new Error("Push deletion is unsupported");
	if (refspec.startsWith("+")) throw new Error("Force push refspecs are unsupported");
	const normalized = refspec;
	const separator = normalized.indexOf(":");
	const sourceValue = separator < 0 ? normalized : normalized.slice(0, separator);
	const destinationValue = separator < 0 ? normalized : normalized.slice(separator + 1);
	if (!sourceValue || !destinationValue) throw new Error("Push refspec is incomplete");
	const sourceRef = resolveLocalFullRef(command.cwd, sourceValue, "Push source");
	const newObject = runReviewGit(command.cwd, ["rev-parse", "--verify", sourceRef]);
	const newPeeledCommit = runReviewGit(command.cwd, ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
	const newTree = runReviewGit(command.cwd, ["rev-parse", "--verify", `${newPeeledCommit}^{tree}`]);
	const pinnedUpdate = pinnedTarget?.updates.length === 1 ? pinnedTarget.updates[0] : undefined;
	const pinnedDestinationMatches = pinnedUpdate === undefined || (separator < 0
		? pinnedUpdate.destination_ref === sourceRef
		: destinationValue.startsWith("refs/")
			? pinnedUpdate.destination_ref === destinationValue
			: pinnedUpdate.destination_ref.endsWith(`/${destinationValue}`));
	if (!pinnedDestinationMatches) throw new Error("Push destination changed after authorization");
	const remoteResolution = pinnedUpdate === undefined
		? separator < 0
			? { ...resolvePushRemoteRefV1(command.cwd, remote, sourceRef, "push remote destination ref"), ref: sourceRef }
			: resolvePushDestinationRefV1(
				command.cwd,
				remote,
				destinationValue,
				sourceRef,
				"push remote destination ref",
				)
		: {
				destination: resolveConfiguredPushDestinationV1(command.cwd, remote),
				ref: pinnedUpdate.destination_ref,
				object_id: pinnedUpdate.old_object,
			};
	const destinationRef = remoteResolution.ref;
	const oldObject = remoteResolution.object_id;
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
		destination_id: remoteResolution.destination.destination_id,
		updates: [update],
	};
}

function isExactReleaseTagPushCommand(
	command: ReviewLifecycleCommand,
	target: GateTargetV1,
): boolean {
	if (target.kind !== GATE_TARGET_KIND.PUSH || target.updates.length !== 1 || command.arguments.length !== 2) return false;
	const update = target.updates[0]!;
	const [remote, refspec] = command.arguments;
	return remote === target.remote && refspec === update.source_ref && update.source_ref === update.destination_ref;
}

function assertReleaseFastPathPushBinding(
	cwd: string,
	target: GateTargetV1,
	evidenceRemote: string,
	expectedDestinationId?: string,
): string {
	if (target.kind !== GATE_TARGET_KIND.PUSH || target.remote !== evidenceRemote) {
		throw new Error("Release fast-path evidence remote must exactly match the tag push remote");
	}
	const destination = resolveConfiguredPushDestinationV1(cwd, target.remote);
	if (destination.destination_id !== target.destination_id) {
		throw new Error("Release fast-path push destination changed after command target derivation");
	}
	if (expectedDestinationId !== undefined && destination.destination_id !== expectedDestinationId) {
		throw new Error("Release fast-path push destination changed after authorization");
	}
	const fetchUrl = remoteFetchUrl(cwd, target.remote);
	const fetchIdentity = repositoryLocationIdentity(cwd, fetchUrl);
	const pushIdentity = repositoryLocationIdentity(cwd, destination.url);
	if (destination.url !== fetchUrl || pushIdentity !== fetchIdentity) {
		throw new Error("Release fast-path requires the configured fetch URL and repository identity to exactly match the effective push destination");
	}
	return destination.destination_id;
}

function commandOptionValue(arguments_: readonly string[], names: readonly string[]): string {
	const value = optionalCommandOptionValue(arguments_, names);
	if (value === undefined) throw new Error(`Command requires exactly one ${names.join("/")} value`);
	return value;
}


function derivePullRequestTarget(command: ReviewLifecycleCommand): GateTargetV1 {
	const baseRef = resolveLocalFullRef(command.cwd, commandOptionValue(command.arguments, ["--base", "-B"]), "Pull request base");
	const headOption = commandOptionValue(command.arguments, ["--head", "-H"]);
	const headRef = parsePullRequestHead(headOption).remoteRef;
	const baseCommit = runReviewGit(command.cwd, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
	const headCommit = runReviewGit(command.cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
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

async function deriveNativePublicationTarget(
	derived: DerivedReviewGateTarget,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<DerivedReviewGateTarget> {
	if (derived.command.event === "pre-release") {
		if (derived.nativeRelease === undefined) throw new Error("Native release validation requires all five release evidence artifact paths");
		return { ...derived, nativePublication: { flags: nativeReleaseFlags(derived.nativeRelease), release: derived.nativeRelease } };
	}
	if (derived.command.event === "pre-push") {
		if (derived.target.kind !== GATE_TARGET_KIND.PUSH) throw new Error("Push target derivation returned the wrong kind");
		return { ...derived, nativePublication: await deriveNativePrePushBinding(derived.command, derived.target, derived.nativeRelease, probe, timeoutMs, signal) };
	}
	if (derived.command.event !== "pre-pr") return derived;
	if (derived.target.kind !== GATE_TARGET_KIND.PULL_REQUEST) throw new Error("Pull request target derivation returned the wrong kind");
	const repository = effectiveGhRepository(derived.command);
	const advertised = await deriveAdvertisedPrePrBase(
		derived.command,
		commandOptionValue(derived.command.arguments, ["--base", "-B"]),
		repository,
		probe,
		timeoutMs,
		signal,
	);
	const head = await deriveAdvertisedPrePrHead(
		derived.command,
		commandOptionValue(derived.command.arguments, ["--head", "-H"]),
		repository,
		probe,
		timeoutMs,
		signal,
	);
	const pushRemote = resolveNativePushRemote(derived.command.cwd);
	if (
		advertised.commit !== derived.target.base_commit ||
		head.remoteRef !== derived.target.head_ref ||
		head.commit !== derived.target.head_commit
	) throw new Error("Advertised PR topology does not match the exact local command target");
	return {
		...derived,
		nativePublication: {
			flags: ["--base-ref", advertised.selector],
			pushRemote,
			pushIdentity: pushRemoteIdentity(derived.command.cwd, pushRemote),
			repository,
			prePrBoundary: {
				source: "explicit",
				selector: advertised.selector,
				commit: advertised.commit,
				remote: advertised.remote,
				remoteRef: advertised.remoteRef,
				remoteIdentity: advertised.remoteIdentity,
			},
			prePrHead: head,
		},
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
	pinnedPushTarget?: PushGateTargetV1,
): DerivedReviewGateTarget {
	const inspection = inspectReviewLifecycleCommand(command, defaultCwd);
	if (!inspection.event || !inspection.command) {
		throw new Error(
			inspection.failClosedReason ?? "Command is not one supported direct review lifecycle operation",
		);
	}
	if (inspection.command.event === "pre-push") {
		const unsafeKeys = inheritedUnsafeGitEnvironmentKeys();
		if (unsafeKeys.length > 0) {
			throw new Error(
				`Push execution inherits unsafe Git routing or configuration override variables: ${unsafeKeys.join(", ")}`,
			);
		}
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
		const target = derivePushTarget(inspection.command, pinnedPushTarget);
		assertNoUnresolvedCommitTransaction(inspection.command.cwd);
		return { command: inspection.command, target };
	}
	if (inspection.command.event === "pre-pr") {
		const target = derivePullRequestTarget(inspection.command);
		assertNoUnresolvedCommitTransaction(inspection.command.cwd);
		return { command: inspection.command, target };
	}
	if (inspection.command.event === "pre-release") {
		const target = deriveReleaseTarget(inspection.command);
		assertNoUnresolvedCommitTransaction(inspection.command.cwd);
		return { command: inspection.command, target };
	}
	throw new Error("Review lifecycle target kind is unsupported");
}

function reviewAuthorizationKey(command: string, cwd: string): string {
	return canonicalHash({ command, cwd: resolve(cwd) });
}

type ReviewGateEvaluator = (
	command: string,
) => Promise<ToolCallEventResult | undefined>;
type CommandSafetyEvaluator = (
	command: string,
) => Promise<ToolCallEventResult | undefined>;

function isReviewTransition(value: string): value is ReviewTransition {
	return Object.values(REVIEW_TRANSITION).some((transition) => transition === value);
}

function isKnownPiLegacyLineage(cwd: string, lineageId: string): boolean {
	try {
		return compactV2LineageExists(cwd, lineageId) || graphV1LineageExists(cwd, lineageId);
	} catch (error) {
		if (error instanceof ReviewRepositoryError) return false;
		throw error;
	}
}

const COMPACT_NATIVE_START_APPLICABILITY = {
	UNRELATED_HISTORY: "unrelated-history",
	COMPATIBLE_RECEIPT: "compatible-receipt",
	NONTERMINAL: "nonterminal",
	ESCALATED: "escalated",
	AMBIGUOUS: "ambiguous",
	INVALID: "invalid",
} as const;

type CompactNativeStartApplicability =
	(typeof COMPACT_NATIVE_START_APPLICABILITY)[keyof typeof COMPACT_NATIVE_START_APPLICABILITY];

interface CompactNativeStartClassification {
	applicability: CompactNativeStartApplicability;
	lineageIds: string[];
}

function isBrokenRepositoryIdentity(error: unknown): error is ReviewRepositoryError {
	return error instanceof ReviewRepositoryError && /pinned repository identity|root commit authority/i.test(error.message);
}

function classifyCompactAuthorityApplicability(cwd: string): CompactNativeStartClassification {
	try {
		const authority = resolveRepositoryAuthorityV1(cwd);
		const live = captureLiveReviewCandidateBinding({ cwd, repositoryId: authority.repository_id });
		const matching = discoverCompactReviewStores(cwd).flatMap((store) => {
			const record = store.load();
			const state = record.state;
			const stateMatches = state.initial_snapshot.base_tree === live.base_tree &&
				state.initial_snapshot.complete_snapshot_tree === live.complete_snapshot_tree &&
				state.initial_snapshot.initial_review_tree === live.initial_review_tree &&
				canonicalJsonV1(state.genesis_paths) === canonicalJsonV1(live.genesis_paths) &&
				canonicalJsonV1(state.intended_untracked) === canonicalJsonV1(live.intended_untracked);
			if (state.state !== "approved" && state.state !== "escalated") {
				return stateMatches ? [{ lineageId: state.lineage_id, state: state.state }] : [];
			}
			const { body } = store.loadTerminalReceipt().receipt;
			const receiptMatches = body.base_tree === live.base_tree &&
				body.final_candidate_tree === live.complete_snapshot_tree &&
				body.genesis_paths_hash === domainHashV1("compact-paths", live.genesis_paths) &&
				body.intended_untracked_hash === domainHashV1("compact-untracked", live.intended_untracked);
			if (stateMatches && !receiptMatches) throw new CompactReviewStoreError("Compact terminal receipt is incomplete or mismatched for its candidate");
			return receiptMatches ? [{ lineageId: state.lineage_id, state: state.state }] : [];
		}).toSorted((left, right) => left.lineageId.localeCompare(right.lineageId));
		if (matching.length === 0) return { applicability: COMPACT_NATIVE_START_APPLICABILITY.UNRELATED_HISTORY, lineageIds: [] };
		if (matching.length > 1) return { applicability: COMPACT_NATIVE_START_APPLICABILITY.AMBIGUOUS, lineageIds: matching.map(({ lineageId }) => lineageId) };
		const match = matching[0]!;
		return {
			applicability: match.state === "approved"
				? COMPACT_NATIVE_START_APPLICABILITY.COMPATIBLE_RECEIPT
				: match.state === "escalated"
					? COMPACT_NATIVE_START_APPLICABILITY.ESCALATED
					: COMPACT_NATIVE_START_APPLICABILITY.NONTERMINAL,
			lineageIds: [match.lineageId],
		};
	} catch {
		return { applicability: COMPACT_NATIVE_START_APPLICABILITY.INVALID, lineageIds: [] };
	}
}

function compactApplicabilityNextAction(applicability: CompactNativeStartClassification): string {
	switch (applicability.applicability) {
		case COMPACT_NATIVE_START_APPLICABILITY.COMPATIBLE_RECEIPT:
			return "use-compatible-read-or-gate-route";
		case COMPACT_NATIVE_START_APPLICABILITY.NONTERMINAL:
			return "stop-and-resolve-existing-compact-authority";
		case COMPACT_NATIVE_START_APPLICABILITY.ESCALATED:
			return "stop-and-report-escalated-compact-authority";
		case COMPACT_NATIVE_START_APPLICABILITY.AMBIGUOUS:
			return "stop-and-report-ambiguous-compact-authority";
		case COMPACT_NATIVE_START_APPLICABILITY.INVALID:
			return "stop-and-report-invalid-compact-authority";
		case COMPACT_NATIVE_START_APPLICABILITY.UNRELATED_HISTORY:
			return "start-native-authoritative";
	}
}

interface NativeStartPreAuthorityRejection {
	lineage_created: false;
	mutation_performed: false;
	mutation_outcome: "none";
	reset_eligible: false;
}

function nativeStartPreAuthorityRejection(): NativeStartPreAuthorityRejection {
	return {
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		reset_eligible: false,
	};
}

function compactNativeStartBlockedResult(applicability: CompactNativeStartClassification): Record<string, unknown> {
	return {
		operation: REVIEW_CONTROLLER_OPERATION.START,
		status: "blocked",
		outcome: `compact-authority-${applicability.applicability}`,
		...nativeStartPreAuthorityRejection(),
		next_action: compactApplicabilityNextAction(applicability),
		...(applicability.lineageIds.length === 0 ? {} : { lineage_ids: applicability.lineageIds }),
	};
}

function nativeStatusUnsupported(operation: ReviewControllerOperation): Record<string, unknown> {
	return {
		operation,
		status: "blocked",
		outcome: "native-status-unsupported",
		...(operation === REVIEW_CONTROLLER_OPERATION.START ? nativeStartPreAuthorityRejection() : { mutation_performed: false }),
		inventory_complete: false,
		next_action: "require-upstream-read-only-native-status-inventory",
		evidence: {
			native_contract: "gentle-ai/2.1.4",
			general_status: "unsupported",
			claimant_inventory: "unsupported",
		},
	};
}

// Bundled and source module instances can coexist, making instanceof insufficient.
function asNativeReviewCliError(error: unknown): { code: string; diagnostics: NativeReviewProcessDiagnostics } | undefined {
	if (error instanceof NativeReviewCliError) return error;
	if (!(error instanceof Error) || error.name !== "NativeReviewCliError") return undefined;
	const value = error as unknown as { code?: unknown; diagnostics?: unknown };
	if (typeof value.code !== "string") return undefined;
	const diagnostics = sanitizeForeignNativeReviewDiagnostics(value.diagnostics);
	return diagnostics === undefined || value.code !== diagnostics.error_code ? undefined : { code: value.code, diagnostics };
}

function nativeStatusFailed(operation: ReviewControllerOperation, error: unknown): Record<string, unknown> {
	const cliError = asNativeReviewCliError(error);
	if (cliError?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) return nativeStatusUnsupported(operation);
	if (cliError !== undefined) {
		return {
			...nativeOperationFailure(operation, error),
			outcome: "native-status-unavailable",
			inventory_complete: false,
			next_action: "require-complete-native-authority-inventory",
		};
	}
	return {
		operation,
		status: "blocked",
		outcome: "native-status-unavailable",
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		inventory_complete: false,
		next_action: "require-complete-native-authority-inventory",
	};
}

const NATIVE_RECOVERY_INPUT = {
	reclaim: ["lineage", "actor", "reason"],
	recover: ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "disposition", "actor", "reason"],
} as const;

/**
 * Routes the destructive controller operations to their closest audited native
 * equivalent: RESET and RECOVER_LOCK map to `gentle-ai review reclaim`
 * (audited quarantine of one incomplete entry) and RECOVER maps to
 * `gentle-ai review recover` (auditable successor authority). Native inputs
 * the legacy flow never carried are requested through a structured envelope
 * instead of being invented. Pi-owned authorization semantics run before this
 * routing and are unchanged.
 */
async function executeNativeRecoveryRoute(
	operation: ReviewControllerOperation,
	nativeOperation: "reclaim" | "recover",
	input: Record<string, unknown>,
	cwd: string,
	nativeReviewCli: NativeReviewCli | null,
	pendingAuthorizations: Map<string, PendingReviewAuthorization> | undefined,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const nativeCommand = `review ${nativeOperation}`;
	const method = nativeOperation === "reclaim" ? nativeReviewCli?.reclaim : nativeReviewCli?.recover;
	if (nativeReviewCli === null || method === undefined) {
		return {
			operation,
			status: "blocked",
			outcome: "native-recovery-unavailable",
			native_operation: nativeCommand,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "install-package-local-gentle-ai-or-run-native-review-cli-directly",
		};
	}
	const missing = NATIVE_RECOVERY_INPUT[nativeOperation].filter((key) =>
		key === "disposition"
			? input[key] !== "scope_changed" && input[key] !== "invalidated" && input[key] !== "escalated"
			: typeof input[key] !== "string" || (input[key] as string).trim().length === 0,
	);
	if (missing.length > 0) {
		return {
			operation,
			status: "blocked",
			outcome: "native-input-required",
			native_operation: nativeCommand,
			missing_input: missing,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "resubmit-with-exact-native-recovery-input",
		};
	}
	pendingAuthorizations?.clear();
	try {
		const result = nativeOperation === "reclaim"
			? await nativeReviewCli.reclaim!({ cwd, lineage: String(input.lineage), actor: String(input.actor), reason: String(input.reason), ...(signal === undefined ? {} : { signal }) })
			: await nativeReviewCli.recover!({
				cwd,
				predecessorLineage: String(input.predecessorLineage),
				expectedPredecessorRevision: String(input.expectedPredecessorRevision),
				successorLineage: String(input.successorLineage),
				disposition: input.disposition as "scope_changed" | "invalidated" | "escalated",
				actor: String(input.actor),
				reason: String(input.reason),
				...(typeof input.maintainerAuthorization === "string" ? { maintainerAuthorization: input.maintainerAuthorization } : {}),
				...(signal === undefined ? {} : { signal }),
			});
		return {
			operation,
			native_operation: nativeCommand,
			result: result.record,
			mutation_performed: true,
			mutation_outcome: "committed",
			next_action: "inspect",
		};
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
}

// gentle-ai 2.1.8 leaves review-transactions/v2/LOCK behind after ordinary
// successful operations and inventories it as a `released` dead-owner entry
// (#184). Only live claims — owned or ambiguous — block; released residue is
// non-blocking and stays observable through evidence.authority_inventory.
// The decoder keeps lock status a closed enum, so any unknown status already
// fails closed before reaching this classification.
function hasBlockingNativeLock(status: NativeReviewStatusResult): boolean {
	return status.locks.some((lock) => lock.status !== NATIVE_REVIEW_LOCK_STATUS.RELEASED);
}

const NATIVE_START_PRECONDITION = {
	CLEAN_EMPTY: "clean-empty",
	INCOMPLETE: "incomplete",
	LOCKED: "locked",
	NON_EMPTY: "non-empty",
} as const;
type NativeStartPrecondition = (typeof NATIVE_START_PRECONDITION)[keyof typeof NATIVE_START_PRECONDITION];

function classifyNativeStartPrecondition(status: NativeReviewStatusResult): NativeStartPrecondition {
	if (status.status === NATIVE_REVIEW_AUTHORITY_STATUS.RESET_IN_PROGRESS) return NATIVE_START_PRECONDITION.NON_EMPTY;
	if (!status.complete || !status.authoritative || status.status === NATIVE_REVIEW_AUTHORITY_STATUS.INVALID || status.status === NATIVE_REVIEW_AUTHORITY_STATUS.SAME_LINEAGE_MIXED_COLLISION) {
		return NATIVE_START_PRECONDITION.INCOMPLETE;
	}
	if (hasBlockingNativeLock(status)) return NATIVE_START_PRECONDITION.LOCKED;
	// Readable historical inventory is not a mutation precondition. Native START
	// owns current-lineage matching; Pi only blocks corrupt or ambiguous authority.
	return NATIVE_START_PRECONDITION.CLEAN_EMPTY;
}

function mayRouteIncompleteNativeStartToUnrelatedHistory(
	status: NativeReviewStatusResult,
	compact: CompactNativeStartClassification | undefined,
): boolean {
	return compact?.applicability === COMPACT_NATIVE_START_APPLICABILITY.UNRELATED_HISTORY &&
		classifyNativeReviewRemediation(status, compact.lineageIds).applicability === NATIVE_REVIEW_AUTHORITY_APPLICABILITY.UNRELATED_HISTORY;
}

function nativeStartPreconditionFailure(status: NativeReviewStatusResult): Record<string, unknown> | undefined {
	const precondition = classifyNativeStartPrecondition(status);
	if (precondition === NATIVE_START_PRECONDITION.CLEAN_EMPTY) return undefined;
	const evidence = { native_contract: "gentle-ai/2.1.5", native_status: status.status, authority_inventory: status.raw };
	if (precondition === NATIVE_START_PRECONDITION.INCOMPLETE) {
		return { operation: REVIEW_CONTROLLER_OPERATION.START, status: "blocked", outcome: "native-authority-inventory-incomplete", ...nativeStartPreAuthorityRejection(), inventory_complete: false, next_action: "require-complete-native-authority-inventory", evidence };
	}
	if (precondition === NATIVE_START_PRECONDITION.LOCKED) {
		return { operation: REVIEW_CONTROLLER_OPERATION.START, status: "blocked", outcome: "native-authority-lock-present", ...nativeStartPreAuthorityRejection(), inventory_complete: true, next_action: "wait-for-native-lock-release", evidence };
	}
	return { operation: REVIEW_CONTROLLER_OPERATION.START, status: "blocked", outcome: "native-authority-reset-in-progress", ...nativeStartPreAuthorityRejection(), inventory_complete: true, next_action: "recover-native-reset", evidence };
}

function mapNativeReviewStatus(operation: ReviewControllerOperation, result: NativeReviewStatusResult): Record<string, unknown> {
	const evidence = {
		native_contract: "gentle-ai/2.1.5",
		native_status: result.status,
		authority_inventory: result.raw,
	};
	if (!result.complete || !result.authoritative || result.status === "invalid") {
		return { operation, status: "blocked", outcome: "native-authority-inventory-incomplete", mutation_performed: false, inventory_complete: false, next_action: "require-complete-native-authority-inventory", evidence };
	}
	if (hasBlockingNativeLock(result)) {
		return { operation, status: "blocked", outcome: "native-authority-lock-present", mutation_performed: false, inventory_complete: true, next_action: "wait-for-native-lock-release", evidence };
	}
	switch (result.status) {
		case "clean":
			return { operation, status: "ready", mutation_performed: false, inventory_complete: true, next_action: "start-native-authoritative", evidence };
		case "active":
			return { operation, status: "in-progress", mutation_performed: false, inventory_complete: true, next_action: "finalize-existing-native-review", evidence };
		case "approved":
			return { operation, status: "blocked", mutation_performed: false, inventory_complete: true, next_action: "use-compatible-read-or-gate-route", evidence };
		case "escalated":
			return { operation, status: "blocked", mutation_performed: false, inventory_complete: true, next_action: "stop-and-report-escalated-native-authority", evidence };
		case "reset-in-progress":
			return { operation, status: "blocked", mutation_performed: false, inventory_complete: true, next_action: "recover-native-reset", evidence };
		case "superseded":
		case "recovered":
			return { operation, status: "blocked", mutation_performed: false, inventory_complete: true, next_action: "inspect-native-recovery-provenance", evidence };
		case "same-lineage-mixed-collision":
			return { operation, status: "blocked", outcome: "native-authority-inventory-incomplete", mutation_performed: false, inventory_complete: false, next_action: "require-complete-native-authority-inventory", evidence };
		case "invalid":
			return { operation, status: "blocked", outcome: "native-authority-inventory-incomplete", mutation_performed: false, inventory_complete: false, next_action: "require-complete-native-authority-inventory", evidence };
	}
}

function mapNativeStartResult(result: NativeStartResult): Record<string, unknown> {
	return {
		lineage_id: result.lineageId,
		state: result.state,
		risk_tier: result.riskLevel,
		selected_lenses: result.selectedLenses,
		changed_files: result.changedFiles,
		original_changed_lines: result.changedLines,
		correction_budget: result.correctionBudget,
		action: result.action,
		lenses_required: result.lensesRequired,
		...(result.riskReasons === undefined ? {} : { risk_reasons: result.riskReasons }),
	};
}

const RECONCILE_FINALIZE_NEXT_ACTION = "rerun-native-finalize-same-lineage";
// Consumer-side bound only: the wire contract carries no attempt counter, so Pi
// caps how many FINALIZE-driven reruns it will direct per lineage in one
// process. Read-only observations (INSPECT/STATUS/START/VALIDATE/BIND_SDD)
// never consume this budget; only reconciliation of an actually attempted
// FINALIZE counts, and a successful FINALIZE clears the counter.
const RECONCILE_FINALIZE_RERUN_LIMIT = 3;
const reconcileFinalizeRerunAttemptsByLineage = new Map<string, number>();

function requiredStatusActionText(lineageId?: string): string {
	return `Run target-scoped review.status${lineageId === undefined ? "" : ` for lineage ${lineageId}`} and follow only its declared action; never start a new review, create a new budget, launch a lens, or fall back to inventory discovery.`;
}

function reconcileFinalizeRouting(status: ReviewStatusV1, requestedLineageId?: string, countRerunAttempt = false): Record<string, unknown> {
	const lineageId = status.authority?.lineageId;
	const base = { provider_action: "reconcile_finalize", replayability: status.replayability, reconciliation_required: true };
	if (status.applicability !== "current_target" || lineageId === undefined || (requestedLineageId !== undefined && lineageId !== requestedLineageId)) {
		return {
			...base,
			...(lineageId === undefined ? {} : { authority_lineage_id: lineageId }),
			...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
			next_action: "stop-and-report-reconcile-lineage-mismatch",
			required_status_action: `Finalize reconciliation reported authority${lineageId === undefined ? " without a current-target lineage" : ` for lineage ${lineageId}`}${requestedLineageId === undefined ? "" : ` while lineage ${requestedLineageId} was requested`}; stop and obtain explicit maintainer action. Never rerun finalize for a foreign lineage, start a new review, create a new budget, launch a lens, or fall back to inventory discovery.`,
		};
	}
	const attempts = reconcileFinalizeRerunAttemptsByLineage.get(lineageId) ?? 0;
	if (attempts >= RECONCILE_FINALIZE_RERUN_LIMIT) {
		return {
			...base,
			lineage_id: lineageId,
			next_action: "stop-and-escalate-finalize-reconciliation",
			required_status_action: `Finalize reconciliation for lineage ${lineageId} was already directed ${RECONCILE_FINALIZE_RERUN_LIMIT} times without reaching terminal authority; stop and obtain explicit maintainer action instead of another rerun. Never start a new review, create a new budget, launch a lens, or fall back to inventory discovery.`,
		};
	}
	if (countRerunAttempt) reconcileFinalizeRerunAttemptsByLineage.set(lineageId, attempts + 1);
	return {
		...base,
		lineage_id: lineageId,
		next_action: RECONCILE_FINALIZE_NEXT_ACTION,
		required_status_action: `Finalize reconciliation required: rerun review.finalize for lineage ${lineageId} with the original content-bound payload; native discovery resumes committed authority. Never start a new review, create a new budget, launch a lens, or fall back to inventory discovery.`,
	};
}

function mapNativeTargetStatus(operation: ReviewControllerOperation, status: ReviewStatusV1, requestedLineageId?: string): Record<string, unknown> {
	if (status.action === "reconcile_finalize") {
		const routing = reconcileFinalizeRouting(status, requestedLineageId);
		return {
			operation,
			status: routing.next_action === RECONCILE_FINALIZE_NEXT_ACTION ? "in-progress" : "blocked",
			result: status.raw,
			...routing,
		};
	}
	return {
		operation,
		status: status.applicability === "current_target" && status.action === "finalize" ? "in-progress" : status.action === "start" ? "ready" : "blocked",
		result: status.raw,
	};
}

function mapNativeFinalizeResult(result: NativeFinalizeResult): Record<string, unknown> {
	return {
		lineage_id: result.lineageId,
		state: result.state,
		action: result.action,
		store_revision: result.storeRevision,
		...(result.receiptPath === undefined ? {} : { receipt_path: result.receiptPath }),
	};
}

function mapNativeValidateResult(result: NativeValidateResult): Record<string, unknown> {
	return {
		allowed: result.allowed,
		result: result.result,
		action: result.action,
		reason: result.reason,
		context: result.gateContext.raw,
	};
}

function nativeGateFingerprint(result: NativeValidateResult, derived: DerivedReviewGateTarget): string {
	return canonicalHash({
		gate_context: result.gateContext.raw,
		publication_target: {
			target: derived.target,
			native_publication: derived.nativePublication ?? null,
		},
	});
}

function requestedNativeGate(derived: DerivedReviewGateTarget): string {
	return derived.command.event === "pre-release" || derived.nativePublication?.release !== undefined ? "release" : derived.command.event;
}

function nativeGateFlags(derived: DerivedReviewGateTarget): readonly string[] {
	return derived.nativePublication?.flags ?? [];
}

async function deriveMaintainerExceptionRequest(
	derived: DerivedReviewGateTarget,
	command: string,
	commandHash: string,
	nativeDenial: MaintainerExceptionRequest["native_denial"],
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<MaintainerExceptionRequest> {
	const tagRelease = derived.target.kind === GATE_TARGET_KIND.PUSH && derived.target.updates.length === 1 && derived.target.updates[0]?.kind === PUSH_UPDATE_KIND.CREATE && derived.target.updates[0]?.destination_ref.startsWith("refs/tags/");
	if (derived.command.event !== "pre-release" && !tagRelease) throw new Error("Maintainer exception applies only to an exact pre-release publication target");
	const fetchUrl = remoteFetchUrl(derived.command.cwd, "origin");
	const main = await advertisedRemoteBranch(derived.command.cwd, "origin", "main", ADVERTISED_BRANCH_KIND.BASE, probe, timeoutMs, signal, fetchUrl);
	const releaseEvidence = derived.nativePublication?.release ?? null;
	const failedPredicates = [nativeDenial.reason, ...(releaseEvidence === null ? ["release evidence artifact paths were not supplied"] : [])];
	const body = {
		schema: "gentle-ai.release-maintainer-exception/v1" as const, command_hash: commandHash, target: derived.target,
		repository_id: resolveRepositoryAuthorityV1(derived.command.cwd).repository_id,
		origin_main: { commit: main.commit, remote_identity: main.remoteIdentity }, native_denial: nativeDenial,
		release_evidence: releaseEvidence, zero_actor_status: "native denial; no actors were launched" as const, failed_predicates: failedPredicates,
	};
	const requestHash = canonicalHash(body);
	const request = { ...body, request_hash: requestHash, challenge: `AUTHORIZE RELEASE EXCEPTION ${requestHash} FOR ${derived.target.kind === GATE_TARGET_KIND.RELEASE ? derived.target.tag_ref : derived.target.updates[0]!.destination_ref}`, reason: "", accepted_predicates: [] };
	return { ...request, audit: { durable_audit: false, command, target: request.target, native_denial: request.native_denial, request_hash: request.request_hash, accepted_predicates: request.accepted_predicates } };
}

function assertMaintainerExceptionRetry(input: MaintainerExceptionInput, request: MaintainerExceptionRequest): void {
	if (input.request_hash !== request.request_hash) throw new Error("Maintainer exception request_hash no longer matches live release state");
	if (input.challenge !== request.challenge) throw new Error("Maintainer exception challenge no longer matches live release state");
	if (canonicalJsonV1(input.accepted_predicates) !== canonicalJsonV1(request.failed_predicates)) throw new Error("Maintainer exception must explicitly accept every named failed predicate");
}

function assertFrozenPreCommitProjection(
	derived: DerivedReviewGateTarget,
	lineageId: string,
	candidateViews: CandidateViewRegistry | null,
): string | undefined {
	if (derived.command.event !== "pre-commit" || candidateViews === null || !candidateViews.hasProjection(lineageId)) return undefined;
	const projection = candidateViews.resolveProjection(lineageId, derived.command.cwd);
	if (derived.actualIntendedCommitTree !== projection.candidateTree) {
		throw new CandidateViewError("staged commit tree does not exactly match the frozen reviewed candidate projection");
	}
	return projection.candidateTree;
}

function authorizationTargetHash(derived: DerivedReviewGateTarget): string {
	return derived.nativePublication === undefined
		? canonicalHash(derived.target)
		: canonicalHash({ target: derived.target, native_publication: derived.nativePublication });
}

function assertNativePublicationBinding(result: NativeValidateResult, derived: DerivedReviewGateTarget): void {
	const returnedGate = result.gateContext.raw.gate;
	if (returnedGate !== requestedNativeGate(derived) && (result.allowed || returnedGate !== "")) {
		throw new Error("Native validation returned a gate context for a different gate");
	}
	const expected = derived.nativePublication?.prePrBoundary;
	if (expected === undefined || !result.allowed || result.result !== "allow") return;
	const value = result.gateContext.raw.pre_pr_boundary;
	if (!isRecord(value)) throw new Error("Native pre-PR result omitted its publication boundary");
	if (
		value.source !== expected.source ||
		value.selector !== expected.selector ||
		value.commit !== expected.commit ||
		value.remote !== expected.remote ||
		value.remote_ref !== expected.remoteRef ||
		value.remote_identity !== expected.remoteIdentity
	) throw new Error("Native pre-PR publication boundary does not match the exact PR command target");
}

function assertNativePublicationUnchanged(before: DerivedReviewGateTarget, after: DerivedReviewGateTarget): void {
	if (authorizationTargetHash(before) !== authorizationTargetHash(after)) {
		throw new Error("Native publication target changed during native validation");
	}
	if (before.target.kind === GATE_TARGET_KIND.PULL_REQUEST) {
		if (
			after.target.kind !== GATE_TARGET_KIND.PULL_REQUEST ||
			after.target.head_commit !== before.target.head_commit ||
			after.nativePublication?.prePrHead?.commit !== before.target.head_commit
		) throw new Error("Advertised pull request head changed during native validation");
	}
}

async function rederiveNativePublicationTarget(
	expected: DerivedReviewGateTarget,
	command: string,
	defaultCwd: string,
	probe: PublicationProbe,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<DerivedReviewGateTarget> {
	const rederived = deriveReviewGateTarget(
		command,
		defaultCwd,
		expected.target.kind === GATE_TARGET_KIND.PUSH ? expected.target : undefined,
	);
	if (rederived.command.cwd !== expected.command.cwd) throw new Error("Lifecycle command repository changed during native validation");
	const fresh = await deriveNativePublicationTarget({ ...rederived, ...(expected.nativeRelease === undefined ? {} : { nativeRelease: expected.nativeRelease }) }, probe, timeoutMs, signal);
	assertNativePublicationUnchanged(expected, fresh);
	return fresh;
}

interface NativeStartPolicyValidation {
	policyPath?: string;
	reason?: string;
}

function isStrictDescendantPath(parent: string, candidate: string): boolean {
	const pathFromParent = relative(parent, candidate);
	return pathFromParent.length > 0 && pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

function validateNativeStartPolicyPath(cwd: string, value: unknown): NativeStartPolicyValidation {
	if (typeof value !== "string" || value.trim().length === 0) return { reason: "policy-path-not-regular" };
	let repository: string;
	try {
		repository = realpathSync(cwd);
	} catch {
		return { reason: "policy-path-outside-scope" };
	}
	const policyRoot = join(repository, ".gentle-ai", "policies");
	const candidate = resolve(repository, value);
	if (!isStrictDescendantPath(policyRoot, candidate)) return { reason: "policy-path-outside-scope" };
	const gentleDirectory = join(repository, ".gentle-ai");
	for (const directory of [gentleDirectory, policyRoot]) {
		try {
			const metadata = lstatSync(directory);
			if (metadata.isSymbolicLink()) return { reason: "policy-path-symlink" };
			if (!metadata.isDirectory()) return { reason: "policy-path-not-regular" };
		} catch {
			return { reason: "policy-path-not-regular" };
		}
	}
	const segments = relative(policyRoot, candidate).split(sep);
	let current = policyRoot;
	for (const [index, segment] of segments.entries()) {
		current = join(current, segment);
		try {
			const metadata = lstatSync(current);
			if (metadata.isSymbolicLink()) return { reason: "policy-path-symlink" };
			if (index === segments.length - 1) {
				if (!metadata.isFile()) return { reason: "policy-path-not-regular" };
			} else if (!metadata.isDirectory()) {
				return { reason: "policy-path-not-regular" };
			}
		} catch {
			return { reason: "policy-path-not-regular" };
		}
	}
	try {
		const canonicalPath = realpathSync(candidate);
		if (canonicalPath !== candidate || !isStrictDescendantPath(policyRoot, canonicalPath)) return { reason: "policy-path-symlink" };
		return { policyPath: canonicalPath };
	} catch {
		return { reason: "policy-path-not-regular" };
	}
}

function nativeStartRejection(reason: string, field?: string): Record<string, unknown> {
	return {
		operation: REVIEW_CONTROLLER_OPERATION.START,
		status: "blocked",
		outcome: reason === "legacy-policy-hash-unsupported"
			? "native-start-legacy-policy-hash-unsupported"
			: reason === "base-ref-invalid"
				? "native-start-base-ref-invalid"
				: reason === "base-ref-ambiguous"
					? "native-start-base-ref-ambiguous"
					: reason === "base-ref-unresolvable" || reason === "base-ref-moved"
						? "native-start-base-ref-unresolvable"
						: reason === "committed-only-required"
							? "native-start-committed-only-required"
							: reason === "committed-only-invalid"
								? "native-start-committed-only-invalid"
								: reason === "unknown-field"
									? "native-start-input-invalid"
									: "native-start-policy-path-invalid",
		reason,
		...(field === undefined ? {} : { field }),
		...nativeStartPreAuthorityRejection(),
	};
}

function nativeOperationFailure(operation: ReviewControllerOperation, error: unknown): Record<string, unknown> {
	const value = error as { mutationOutcome?: unknown; nextAction?: unknown; diagnostics?: unknown; launchAttempted?: unknown; candidateViewPreNative?: unknown; failureEnvelope?: { raw?: unknown; mutationOutcome?: unknown; replayability?: unknown; nextAction?: unknown } };
	if (isRecord(value.failureEnvelope) && isRecord(value.failureEnvelope.raw)) {
		const mutationOutcome = value.failureEnvelope.mutationOutcome;
		return {
			operation,
			status: "blocked",
			native_failure: value.failureEnvelope.raw,
			...(mutationOutcome === "committed"
				? { mutation_performed: true, mutation_outcome: "committed" }
				: mutationOutcome === "unknown"
					? { mutation_outcome: "unknown" }
					: { mutation_performed: false, mutation_outcome: "none" }),
			...(typeof value.failureEnvelope.replayability === "string" ? { replayability: value.failureEnvelope.replayability } : {}),
			...(typeof value.failureEnvelope.nextAction === "string" ? { next_action: value.failureEnvelope.nextAction } : {}),
		};
	}
	const mutationOutcome = value.mutationOutcome === "unknown" ? "unknown" : "none";
	const nativeDiagnostics = asNativeReviewCliError(error)?.diagnostics;
	const diagnostics = nativeDiagnostics?.operation === `review/${operation}`
		? nativeDiagnostics
		: operation === REVIEW_CONTROLLER_OPERATION.START && error instanceof CandidateViewError && value.candidateViewPreNative === true
			? { code: error.reason, message: "candidate view rejected before native START" }
			: undefined;
	return {
		operation,
		status: "blocked",
		outcome: "native-operation-failed",
		...(operation === REVIEW_CONTROLLER_OPERATION.START && mutationOutcome === "none"
			? nativeStartPreAuthorityRejection()
			: mutationOutcome === "none"
				? { lineage_created: false, mutation_performed: false, mutation_outcome: "none" as const }
				: { mutation_outcome: mutationOutcome }),
		...(diagnostics === undefined ? {} : { diagnostics }),
		...(mutationOutcome === "unknown" || value.nextAction === "review.status"
			? { replayability: "status_required", next_action: "review.status", required_status_action: requiredStatusActionText() }
			: { next_action: "resolve-native-operation-failure" }),
	};
}

function nativeMutationRequiresStatus(error: unknown): boolean {
	const value = error as {
		mutationOutcome?: unknown;
		nextAction?: unknown;
		failureEnvelope?: { mutationOutcome?: unknown; replayability?: unknown; nextAction?: unknown };
	};
	return value.mutationOutcome === "unknown" ||
		value.nextAction === "review.status" ||
		value.failureEnvelope?.mutationOutcome === "unknown" ||
		value.failureEnvelope?.replayability === "status_required" ||
		value.failureEnvelope?.nextAction === "review.status";
}

async function reconcileNativeMutationFailure(
	operation: ReviewControllerOperation,
	error: unknown,
	nativeReviewCli: NativeReviewCli,
	target: { cwd: string; lineageId?: string; baseRef?: string; projection?: "workspace" | "staged" },
): Promise<Record<string, unknown>> {
	const failure = nativeOperationFailure(operation, error);
	if (!nativeMutationRequiresStatus(error)) return failure;
	if (nativeReviewCli.targetStatus === undefined) {
		return {
			...failure,
			outcome: "native-mutation-status-required",
			replayability: "status_required",
			next_action: "review.status",
			required_status_action: requiredStatusActionText(target.lineageId),
		};
	}
	try {
		const status = await nativeReviewCli.targetStatus(target);
		const { required_status_action: staleStatusDirective, ...reconciledBase } = failure;
		void staleStatusDirective;
		if (status.action === "reconcile_finalize") {
			return {
				...reconciledBase,
				outcome: "native-mutation-status-reconciled",
				reconciliation: status.raw,
				authority_applicability: status.applicability,
				...reconcileFinalizeRouting(status, target.lineageId, operation === REVIEW_CONTROLLER_OPERATION.FINALIZE),
			};
		}
		return {
			...reconciledBase,
			outcome: "native-mutation-status-reconciled",
			reconciliation: status.raw,
			authority_applicability: status.applicability,
			provider_action: status.action,
			replayability: status.replayability,
			next_action: status.action,
		};
	} catch (statusError) {
		return {
			...failure,
			outcome: "native-mutation-status-reconciliation-failed",
			reconciliation_failure: nativeOperationFailure(REVIEW_CONTROLLER_OPERATION.STATUS, statusError),
			replayability: "status_required",
			next_action: "review.status",
			required_status_action: requiredStatusActionText(target.lineageId),
		};
	}
}

function nativePublicationFailure(operation: ReviewControllerOperation, error: unknown): Record<string, unknown> {
	if (error instanceof NativeSplitFetchPushUnsupportedError) {
		return {
			operation,
			status: "blocked",
			outcome: "native-split-fetch-push-unsupported",
			reason: error.message,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: error.nextAction,
		};
	}
	if (!(error instanceof NativePublicationBaseRequiredError)) return nativeOperationFailure(operation, error);
	return {
		operation,
		status: "blocked",
		outcome: "native-publication-base-required",
		reason: error.message,
		mutation_performed: false,
		mutation_outcome: "none",
		next_action: error.nextAction,
	};
}

function reviewWorkspaceGitIdentity(cwd: string): { toplevel: string; commonDir: string } {
	const toplevel = realpathSync(runReviewGit(cwd, ["rev-parse", "--show-toplevel"]));
	const commonDir = realpathSync(resolve(cwd, runReviewGit(cwd, ["rev-parse", "--git-common-dir"])));
	return { toplevel, commonDir };
}

/**
 * Resolves the workspace root every controller operation binds to. Absent an
 * explicit workspaceRoot the session cwd is used unchanged (no new Git calls).
 * An explicit workspaceRoot fails closed unless it is an existing Git worktree
 * root sharing the session repository's Git common directory, so the model can
 * never rebind review authority to an arbitrary or foreign filesystem path.
 */
function resolveReviewControllerWorkspaceRoot(requested: string | undefined, sessionCwd: string): string {
	if (requested === undefined) return sessionCwd;
	if (requested.trim().length === 0 || !isAbsolute(requested)) {
		throw new Error(`Review controller workspaceRoot must be an absolute path to an existing Git worktree root; received ${JSON.stringify(requested)}`);
	}
	let resolved: string;
	try {
		resolved = realpathSync(requested);
		if (!lstatSync(resolved).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(`Review controller workspaceRoot ${requested} is not an existing directory; create or adopt the worktree before binding review operations to it`);
	}
	let target: { toplevel: string; commonDir: string };
	try {
		target = reviewWorkspaceGitIdentity(resolved);
	} catch {
		throw new Error(`Review controller workspaceRoot ${resolved} is not inside a Git worktree; review operations bind only to real worktrees of the session repository`);
	}
	if (target.toplevel !== resolved) {
		throw new Error(`Review controller workspaceRoot ${resolved} is not a worktree root (worktree root is ${target.toplevel}); pass the exact root`);
	}
	let session: { toplevel: string; commonDir: string };
	try {
		session = reviewWorkspaceGitIdentity(sessionCwd);
	} catch {
		throw new Error(`Review controller workspaceRoot ${resolved} cannot be validated: the session cwd ${sessionCwd} does not resolve a Git repository identity; run Pi from a worktree of the same repository`);
	}
	if (target.commonDir !== session.commonDir) {
		throw new Error(`Review controller workspaceRoot ${resolved} belongs to a different repository (Git common dir ${target.commonDir}) than the session cwd ${sessionCwd} (Git common dir ${session.commonDir}); use a worktree of the session repository or start Pi from the target repository`);
	}
	return resolved;
}

async function executeReviewControllerOperation(
	parametersValue: unknown,
	sessionCwd: string,
	pendingAuthorizations: Map<string, PendingReviewAuthorization>,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	publicationProbe: PublicationProbe = nodePublicationProbe,
	publicationProbeTimeoutMs = PUBLICATION_PROBE_TIMEOUT_MS,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	context?: ExtensionContext,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewControllerParameters(parametersValue);
	const defaultCwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd);
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.EXPORT || parameters.operation === REVIEW_CONTROLLER_OPERATION.IMPORT) {
		// Legacy bundle transport rode on the retired pre-integration graph/compact
		// stores. The native v2.1.8 CLI exposes no bundle equivalent, so both
		// operations return a structured retirement envelope; the enum members are
		// kept so the tool schema stays stable for existing callers.
		return {
			operation: parameters.operation,
			status: "blocked",
			outcome: "legacy-operation-retired",
			reason: "Legacy review bundle transport (export/import) was retired together with the pre-integration graph/compact stores; gentle-ai v2.1.8 exposes no native bundle equivalent.",
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "Use the native `gentle-ai review` CLI (start/finalize/validate/status/recover) against the repository review authority; receipts and canonical artifacts live in the Git common-directory store at .git/gentle-ai/reviews and travel with the repository through normal Git replication.",
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.PREPARE_SUPERSESSION) {
		const input = parseSupersessionControllerInput(parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation));
		const prepared = prepareSupersessionV1(input.prepared);
		assertSupersessionControllerIdentity(input, prepared);
		return { operation: parameters.operation, change_name: input.changeName, request_hash: prepared.request_hash, challenge: prepared.challenge, body: prepared.body };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.SUPERSEDE) {
		const input = parseSupersessionControllerInput(parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation));
		if (typeof input.challenge !== "string" || typeof input.request_hash !== "string") throw new Error("Review controller SUPERSEDE requires the exact prepared request_hash and challenge");
		const prepared = prepareSupersessionV1(input.prepared);
		assertSupersessionControllerIdentity(input, prepared);
		if (input.request_hash !== prepared.request_hash || input.challenge !== prepared.challenge) throw new Error("Review controller SUPERSEDE prepared request and challenge must exactly match the fresh authorization");
		const body = { ...prepared.body, authorization_hash: domainHashV1("review-authority-supersession-authorization", { challenge: prepared.challenge, request_hash: prepared.request_hash }) };
		const envelope = createSupersessionEnvelopeV1(body);
		const installed = SupersessionStoreV1.forRepository(defaultCwd).install(input.changeName, envelope, {
			casChecks: [
				{
					label: "graph source",
					expected: canonicalJsonV1(prepared.body.source),
					observe: () => {
						assertLiveRecoveredSourceBindingV1(defaultCwd, envelope);
						return canonicalJsonV1(inspectRecoverableGraphSourceV1(defaultCwd, input.changeName, input.sourceLineageId).source);
					},
				},
				{
					label: "compact successor",
					expected: canonicalJsonV1(prepared.body.successor),
					observe: () => {
						const successor = inspectApprovedCompactSuccessorV1(defaultCwd, input.successorLineageId);
						assertLiveRecoveredSuccessorBindingV1(defaultCwd, envelope, discoverCompactReview(defaultCwd, input.successorLineageId, true).record.state);
						return canonicalJsonV1(successor);
					},
				},
			],
		});
		const active = resolveReviewAuthorityForChange(defaultCwd, input.changeName);
		if (!active || active.recovery.recovery_id !== installed.recovery_id) throw new Error("Review controller SUPERSEDE did not produce one validated active authority");
		return { operation: parameters.operation, change_name: input.changeName, recovery_id: installed.recovery_id, active_authority_id: active.record.state.lineage_id, next_action: "validate-recovered-authority" };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT && nativeReviewCli !== null) {
		try {
			if (nativeReviewCli.targetStatus !== undefined) {
				const status = await nativeReviewCli.targetStatus({ cwd: defaultCwd, ...(signal === undefined ? {} : { signal }) });
				return mapNativeTargetStatus(parameters.operation, status);
			}
			const inspection = inspectReviewAuthorityForController(defaultCwd);
			const resetEligible = hasPiResetEligibility(inspection);
			const publicInspection = publicReviewAuthorityInspection(inspection, resetEligible);
			if (inspection.outcome !== "clean") return {
				operation: parameters.operation,
				status: "blocked",
				inspection: publicInspection,
				inventory_complete: false,
				reset_eligible: resetEligible,
				next_action: inspection.outcome === "reset-in-progress"
					? "request-explicit-reset-recovery-authorization"
					: resetEligible
						? "request-explicit-reset-authorization"
						: "resolve-pi-owned-preflight",
			};
			const compact = classifyCompactAuthorityApplicability(defaultCwd);
			const nativeStatus = await nativeReviewCli.reviewStatus({ cwd: defaultCwd, signal });
			const classification = classifyNativeReviewRemediation(nativeStatus, compact.lineageIds);
			const native = mapNativeReviewStatus(parameters.operation, nativeStatus);
			const compactBlocks = compact.applicability !== COMPACT_NATIVE_START_APPLICABILITY.UNRELATED_HISTORY;
			const response = {
				...native,
				...(compactBlocks ? {
					status: compact.applicability === COMPACT_NATIVE_START_APPLICABILITY.NONTERMINAL ? "in-progress" : "blocked",
					next_action: compactApplicabilityNextAction(compact),
				} : {}),
				pi_authority: inspection.outcome,
				native_authority: nativeStatus.complete && nativeStatus.authoritative ? nativeStatus.status : "invalid-incomplete",
				authority_applicability: classification.applicability,
				reset_eligible: resetEligible,
				reset_eligibility_reason: "Pi reset authority is independent of read-only native history",
				lineage_created: false,
				mutation_performed: false,
				inspection: publicInspection,
				compact_authority_applicability: compact.applicability,
			};
			return response;
		} catch (error) {
			if (isBrokenRepositoryIdentity(error)) {
				return {
					operation: parameters.operation,
					status: "blocked",
					outcome: "compact-authority-invalid",
					compact_authority_applicability: COMPACT_NATIVE_START_APPLICABILITY.INVALID,
					inventory_complete: false,
					next_action: "stop-and-report-invalid-compact-authority",
				};
			}
			if (error instanceof ReviewRepositoryError) return nativeStatusUnsupported(parameters.operation);
			return nativeStatusFailed(parameters.operation, error);
		}
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT) {
		const authority = resolveRepositoryAuthorityV1(defaultCwd);
		const lock = new ReviewMutationLockV1(join(authority.store_root, "control"), authority.repository_id, authority.authority_id);
		const inspection = inspectReviewAuthorityForController(defaultCwd);
		const resetEligible = hasPiResetEligibility(inspection);
		const publicInspection = publicReviewAuthorityInspection(inspection, resetEligible);
		const input = parameters.input === undefined ? undefined : parseControllerJson(parameters.input, parameters.operation);
		const policyHash = input?.mode === REVIEW_MODE.ORDINARY && isRecord(input.projection) && input.projection.kind === REVIEW_PROJECTION.COMPLETE && typeof input.policyHash === "string" ? input.policyHash : undefined;
		const applicability = inspection.outcome === "clean" && (
			inspection.compact_authority?.outcome === COMPACT_AUTHORITY_OUTCOME.APPROVED ||
			inspection.compact_authority?.outcome === COMPACT_AUTHORITY_OUTCOME.ESCALATED
		) ? inspectCompactTerminalApplicability(defaultCwd, policyHash) : undefined;
		const candidateInspection = applicability === undefined ? publicInspection : {
			...publicInspection,
			terminal_applicability: applicability.applicability,
			terminal_lineage_ids: applicability.lineageIds,
		};
		const terminal = applicability?.applicability === "applicable";
		const terminalAmbiguous = applicability?.applicability === "ambiguous";
		return {
			operation: parameters.operation,
			inspection: candidateInspection,
			reset_eligible: resetEligible,
			lock: lock.inspect(),
			...(inspection.outcome === "clean" && inspection.compact_authority !== undefined
				? inspection.compact_authority.outcome === COMPACT_AUTHORITY_OUTCOME.INVALID
					? { status: "blocked", next_action: "request-explicit-reset-authorization" }
					: inspection.compact_authority.outcome === COMPACT_AUTHORITY_OUTCOME.ACTIVE
					? { status: "in-progress", next_action: "finalize-existing-ordinary-review" }
					: terminalAmbiguous
						? { status: "blocked", next_action: "stop-and-report-ambiguous-compact-terminal-authority" }
						: terminal
							? { status: "terminal", next_action: compactAuthorityAction(inspection) }
						: { status: "ready", next_action: "start-ordinary-review" }
				: inspection.outcome === "clean"
					? { status: "ready", next_action: "start-ordinary-review" }
					: inspection.outcome === "blocked-ambiguous"
						? { status: "blocked", next_action: "stop-and-report-ambiguous-authority" }
						: { status: "blocked", next_action: inspection.outcome === "reset-in-progress" ? "request-explicit-reset-recovery-authorization" : "request-explicit-reset-authorization" }),
		};
	}

	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (typeof input.ownerHash !== "string") throw new Error("Lock recovery requires an exact ownerHash");
		// A stuck legacy mutation lock is an incomplete in-flight entry; the
		// audited native quarantine owns its removal. Lock recovery is not a
		// destructive authority reset, so pending authorizations survive.
		return await executeNativeRecoveryRoute(parameters.operation, "reclaim", input, defaultCwd, nativeReviewCli, undefined, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeRecoveryRoute(parameters.operation, "recover", input, defaultCwd, nativeReviewCli, pendingAuthorizations, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeRecoveryRoute(parameters.operation, "reclaim", input, defaultCwd, nativeReviewCli, pendingAuthorizations, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.REPAIR) {
		const inspection = inspectReviewAuthorityForController(defaultCwd);
		if (
			inspection.outcome === "clean" &&
			inspection.compact_authority !== undefined &&
			!hasGraphV1Authority(defaultCwd)
		) {
			return {
				operation: parameters.operation,
				repaired: false,
				compact_authority: "immutable-untouched",
				inspection,
				next_action: compactAuthorityAction(inspection),
			};
		}
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		store.repairCurrentAuthority();
		return { operation: parameters.operation, repaired: true };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.BIND_SDD) {
		if (nativeReviewCli === null) return nativeStatusUnsupported(parameters.operation);
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (
			typeof input.change !== "string" ||
			typeof input.lineageId !== "string" ||
			typeof input.expectedBindingRevision !== "string"
		) throw new Error("Native bind-sdd requires change, lineageId, and expected binding revision");
		if (!/^[a-z0-9][a-z0-9-]*$/.test(input.change)) throw new Error("Native bind-sdd change name is invalid");
		if (!NATIVE_BIND_TOKEN_RE.test(input.lineageId)) throw new Error("Native bind-sdd lineageId is invalid");
		if (input.expectedBindingRevision !== "" && !NATIVE_BIND_TOKEN_RE.test(input.expectedBindingRevision)) throw new Error("Native bind-sdd expected binding revision is invalid");
		const expectedPath = join("openspec", "changes", input.change);
		const canonicalCwd = realpathSync(defaultCwd);
		const absolutePath = resolve(canonicalCwd, expectedPath);
		if (!existsSync(absolutePath) || !lstatSync(absolutePath).isDirectory()) throw new Error("Native bind-sdd change path is outside or missing from the repository");
		const canonicalPath = realpathSync(absolutePath);
		const pathFromRepository = relative(canonicalCwd, canonicalPath);
		if (pathFromRepository === ".." || pathFromRepository.startsWith(`..${sep}`) || isAbsolute(pathFromRepository)) throw new Error("Native bind-sdd change path is outside or missing from the repository");
		try {
			const bound = await nativeReviewCli.bindSdd({
				cwd: canonicalCwd,
				change: input.change,
				lineage: input.lineageId,
				expectedBindingRevision: input.expectedBindingRevision,
				...(signal === undefined ? {} : { signal }),
			});
			if (
				bound.change !== input.change ||
				bound.lineage !== input.lineageId ||
				typeof bound.revision !== "string" || bound.revision.length === 0 ||
				typeof bound.authorityRevision !== "string" || bound.authorityRevision.length === 0 ||
				typeof bound.receiptHash !== "string" || bound.receiptHash.length === 0 ||
				bound.gateContext.lineageId !== input.lineageId ||
				bound.gateContext.storeRevision !== bound.authorityRevision ||
				bound.gateContext.raw.gate !== "post-apply"
			) throw Object.assign(
				new Error("Native bind-sdd returned malformed or inconsistent binding evidence"),
				{ mutationOutcome: "unknown", nextAction: "review.status" },
			);
			return { operation: parameters.operation, binding: {
				revision: bound.revision,
				change: bound.change,
				lineage: bound.lineage,
				authority_revision: bound.authorityRevision,
				receipt_hash: bound.receiptHash,
				gate_context: bound.gateContext.raw,
			} };
		} catch (error) {
			return reconcileNativeMutationFailure(parameters.operation, error, nativeReviewCli, {
				cwd: canonicalCwd,
				lineageId: input.lineageId,
			});
		}
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.START) {
		const rawStart = parseControllerJson(
			requiredControllerString(parameters, "input"),
			REVIEW_CONTROLLER_OPERATION.START,
		);
		if (rawStart.mode === REVIEW_MODE.ORDINARY && nativeReviewCli !== null) {
			const selectorFree = !("policyPath" in rawStart) && !("baseRef" in rawStart) && !("committedOnly" in rawStart);
			let compact: CompactNativeStartClassification | undefined;
			if (nativeReviewCli.targetStatus === undefined && selectorFree) {
				try {
					const inspection = inspectReviewAuthorityForController(defaultCwd);
					if (inspection.outcome !== "clean") {
						return { operation: parameters.operation, status: "blocked", outcome: "legacy-read-only", ...nativeStartPreAuthorityRejection(), next_action: "use-compatible-read-or-gate-route" };
					}
					compact = classifyCompactAuthorityApplicability(defaultCwd);
				} catch (error) {
					if (isBrokenRepositoryIdentity(error)) {
						return compactNativeStartBlockedResult({ applicability: COMPACT_NATIVE_START_APPLICABILITY.INVALID, lineageIds: [] });
					}
					if (!(error instanceof ReviewRepositoryError)) throw error;
				}
				if (compact !== undefined && compact.applicability !== COMPACT_NATIVE_START_APPLICABILITY.UNRELATED_HISTORY) {
					return compactNativeStartBlockedResult(compact);
				}
			}
			if (nativeReviewCli.targetStatus === undefined && typeof parameters.lineageId === "string" && isKnownPiLegacyLineage(defaultCwd, parameters.lineageId)) {
				return { operation: parameters.operation, status: "blocked", outcome: "legacy-read-only", ...nativeStartPreAuthorityRejection(), next_action: "use-compatible-read-or-gate-route" };
			}
			if ("policyHash" in rawStart) return nativeStartRejection("legacy-policy-hash-unsupported");
			const unknownField = Object.keys(rawStart).find((field) => !["mode", "baseRef", "committedOnly", "policyPath"].includes(field));
			if (unknownField !== undefined) return nativeStartRejection("unknown-field", unknownField);
			const policy: NativeStartPolicyValidation = rawStart.policyPath === undefined
				? {}
				: validateNativeStartPolicyPath(defaultCwd, rawStart.policyPath);
			if (policy.reason !== undefined) return nativeStartRejection(policy.reason);
			const baseRef = rawStart.baseRef;
			if (baseRef !== undefined && !isCanonicalProcessString(baseRef)) return nativeStartRejection("base-ref-invalid");
			if (baseRef !== undefined && rawStart.committedOnly !== true) return nativeStartRejection("committed-only-required");
			if (baseRef === undefined && "committedOnly" in rawStart) return nativeStartRejection("committed-only-invalid");
			let canonicalBaseRef: string | undefined;
			if (baseRef !== undefined) {
				try {
					canonicalBaseRef = resolveCanonicalCandidateBase(defaultCwd, baseRef).commit;
				} catch (error) {
					if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-unresolvable" || error.reason === "base-ref-moved")) return nativeStartRejection(error.reason);
					return nativeStartRejection("base-ref-unresolvable");
				}
			}
			try {
				if (nativeReviewCli.targetStatus !== undefined) {
					const target = await nativeReviewCli.targetStatus({
						cwd: defaultCwd,
						...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
						...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef }),
						...(signal === undefined ? {} : { signal }),
					});
					if (target.applicability !== "unrelated" || target.action !== "start") return mapNativeTargetStatus(parameters.operation, target, parameters.lineageId);
				} else {
					const nativeStatus = await nativeReviewCli.reviewStatus({ cwd: defaultCwd, ...(signal === undefined ? {} : { signal }) });
					const preconditionFailure = nativeStartPreconditionFailure(nativeStatus);
					const routeUnrelatedIncompleteInventory = classifyNativeStartPrecondition(nativeStatus) === NATIVE_START_PRECONDITION.INCOMPLETE && mayRouteIncompleteNativeStartToUnrelatedHistory(nativeStatus, compact);
					if (preconditionFailure !== undefined && !routeUnrelatedIncompleteInventory) return preconditionFailure;
				}
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
			const replayKey = JSON.stringify({ cwd: defaultCwd, lineageId: parameters.lineageId ?? null, input: parameters.input ?? null, inputPath: parameters.inputPath ?? null });
			let candidateView: ReturnType<CandidateViewRegistry["create"]> | undefined;
			let nativeStartAttempted = false;
			try {
				candidateView = candidateViews?.createOrReuse({ contributorRoot: defaultCwd, replayKey, ...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef, committedOnly: true }) });
				nativeStartAttempted = true;
				const result = await nativeReviewCli.start({
					cwd: candidateView?.root ?? defaultCwd,
					...(canonicalBaseRef === undefined
						? {}
						: { baseRef: candidateView?.baseCommit ?? canonicalBaseRef, committedOnly: true }),
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(policy.policyPath === undefined ? {} : { policyPath: policy.policyPath }),
					...(signal === undefined ? {} : { signal }),
				});
				if (candidateView && candidateViews && result.lensesRequired) {
					const binding = { token: candidateView.token, lineageId: result.lineageId, selectedLenses: result.selectedLenses };
					if (result.action === "resumed" && !candidateViews.hasCurrentBinding()) candidateViews.restoreCurrentFromNativeStart(binding);
					else candidateViews.bindCurrent(binding);
				} else if (candidateView && candidateViews && ((result.action === "created" && result.state === "reviewing") || result.action === "resumed" || result.action === "reuse-receipt")) candidateViews.retain(candidateView.token, result.lineageId);
				else if (candidateView && candidateViews) candidateViews.cleanup(candidateView.token);
				// The envelope always names the workspace root the lineage is bound
				// to, and — when lenses must run — the exact frozen candidate the
				// actors must read, so the caller can never silently launch review
				// actors against a stale previously-active worktree (#166, #169).
				const actorBinding = candidateView !== undefined && result.lensesRequired
					? {
						workspace_root: defaultCwd,
						candidate_root: candidateView.root,
						candidate_tree: candidateView.candidateTree,
						candidate_paths: candidateView.paths,
					}
					: undefined;
				return {
					operation: parameters.operation,
					result: mapNativeStartResult(result),
					workspace_root: defaultCwd,
					...(actorBinding === undefined ? {} : { actor_binding: actorBinding }),
				};
			} catch (error) {
				if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-unresolvable" || error.reason === "base-ref-moved")) return nativeStartRejection(error.reason);
				const value = error as { mutationOutcome?: unknown; nextAction?: unknown };
				const provenNoMutation = value.mutationOutcome === "none";
				const preNativeCandidateFailure = !nativeStartAttempted && error instanceof CandidateViewError;
				if (candidateView && candidateViews && (provenNoMutation || preNativeCandidateFailure)) candidateViews.cleanup(candidateView.token);
				const failure = provenNoMutation
					? error
					: preNativeCandidateFailure
						? Object.assign(error, { candidateViewPreNative: true })
						: Object.assign(error instanceof Error ? error : new Error(String(error)), {
							mutationOutcome: "unknown",
							nextAction: "review.status",
						});
				return reconcileNativeMutationFailure(parameters.operation, failure, nativeReviewCli, {
					cwd: candidateView?.root ?? defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(canonicalBaseRef === undefined ? {} : { baseRef: candidateView?.baseCommit ?? canonicalBaseRef }),
					projection: "workspace",
				});
			}
		}
		const inspection = inspectReviewAuthorityForController(defaultCwd);
		if (inspection.outcome !== "clean") {
			return {
				operation: parameters.operation,
				status: "blocked",
				lineage_created: false,
				inspection,
				next_action: inspection.outcome === "blocked-ambiguous"
					? "stop-and-report-ambiguous-authority"
					: inspection.outcome === "reset-in-progress"
						? "request-explicit-reset-recovery-authorization"
						: "request-explicit-reset-authorization",
			};
		}
		if (rawStart.mode === REVIEW_MODE.ORDINARY) {
			if (typeof rawStart.policyHash !== "string") {
				throw new Error("Compact ordinary START requires policyHash");
			}
			const projection = rawStart.projection === undefined
				? { kind: REVIEW_PROJECTION.COMPLETE } as const
				: isRecord(rawStart.projection) && rawStart.projection.kind === REVIEW_PROJECTION.COMPLETE
					? { kind: REVIEW_PROJECTION.COMPLETE } as const
					: undefined;
			if (!projection) throw new Error("New compact ordinary START requires the complete projection");
			try {
				const result = startCompactReview({
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					policyHash: rawStart.policyHash,
					projection,
				});
				const state = discoverCompactReview(defaultCwd, result.lineage_id).record.state;
				return { operation: parameters.operation, result, state };
			} catch (error) {
				if (error instanceof CompactReviewTerminalAmbiguityError) {
					return {
						operation: parameters.operation,
						status: "blocked",
						lineage_created: false,
						lineage_ids: error.lineageIds,
						next_action: "stop-and-report-ambiguous-compact-terminal-authority",
						inspection: inspectReviewAuthorityForController(defaultCwd),
					};
				}
				if (error instanceof CompactReviewStartBlockedError) {
					return {
						operation: parameters.operation,
						status: "blocked",
						lineage_created: false,
						lifecycle: `compact-${error.state}`,
						lineage_id: error.lineageId,
						next_action: error.action,
						inspection: inspectReviewAuthorityForController(defaultCwd),
					};
				}
				throw error;
			}
		}
		const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
		if (typeof parameters.lineageId !== "string" || parameters.lineageId.trim().length === 0) {
			throw new Error("Judgment Day graph-v1 START requires lineageId");
		}
		const input = parseStartInput(rawStart);
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
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		let result: StartOperationResultV1;
		try {
			result = store.create(state, idempotencyKey);
		} catch (error) {
			if (!(error instanceof Error) || error.message !== "Graph lineage already exists") throw error;
			const current = store.read(parameters.lineageId!);
			const existing = current.request_journal.find((entry) => entry.idempotency_key === idempotencyKey);
			if (
				existing?.operation !== REVIEW_OPERATION.START ||
				existing.request_hash !== canonicalHash(state) ||
				existing.status !== JOURNAL_STATUS.COMPLETED
			) {
				throw new Error("Idempotency key was reused with a different START request; replay requires the same lineageId, idempotencyKey, and exact request");
			}
			result = existing.canonical_result as StartOperationResultV1;
		}
		return { operation: parameters.operation, result, state };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.FINALIZE) {
		const hasInput = parameters.input !== undefined;
		const hasInputPath = parameters.inputPath !== undefined;
		if (hasInput === hasInputPath) throw new Error("Review controller finalize requires exactly one of input or inputPath");
		const raw = parseControllerJson(
			hasInput
				? requiredControllerString(parameters, "input")
				: readRepositoryControllerInput(requiredControllerString(parameters, "inputPath"), defaultCwd),
			REVIEW_CONTROLLER_OPERATION.FINALIZE,
		);
		if (raw.correction_line_forecast !== undefined && (!Number.isSafeInteger(raw.correction_line_forecast) || Number(raw.correction_line_forecast) <= 0)) {
			throw new Error("Review controller finalize correction_line_forecast must be a positive integer");
		}
		if (raw.final_evidence !== undefined && typeof raw.final_evidence !== "string") throw new Error("Review controller finalize final_evidence must be a string");
		if (raw.final_verification_passed !== undefined && typeof raw.final_verification_passed !== "boolean") throw new Error("Review controller finalize final_verification_passed must be boolean");
		if (raw.final_evidence !== undefined && raw.final_verification_passed === undefined) throw new Error("Review controller finalize with final_evidence requires an explicit final_verification_passed boolean");
		if (
			nativeReviewCli !== null &&
			nativeReviewCli.targetStatus === undefined &&
			typeof parameters.lineageId === "string" &&
			isKnownPiLegacyLineage(defaultCwd, parameters.lineageId)
		) {
			return { operation: parameters.operation, status: "blocked", outcome: "legacy-read-only", mutation_performed: false, next_action: "use-compatible-read-or-gate-route" };
		}
		if (nativeReviewCli !== null) {
			const input = parseNativeCompactFinalizeInput({
				cwd: defaultCwd,
				...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
				...raw,
			});
			let correctionCompletion = false;
			let authoritativeState: unknown;
			let negotiatedStatus: ReviewStatusV1 | undefined;
			let candidateView: ReturnType<CandidateViewRegistry["create"]> | undefined;
			let nativeResult: NativeFinalizeResult;
			try {
				if (candidateViews && parameters.lineageId === undefined) throw new CandidateViewError("Native FINALIZE requires an explicit candidate-view lineage");
				correctionCompletion = input.review_result === undefined && (input.validation !== undefined || input.validation_proof !== undefined) && input.final_evidence !== undefined;
				const validationAttempt = input.review_result === undefined && input.correction_line_forecast === undefined && input.final_evidence !== undefined;
				// A correction-forecast-only FINALIZE (the pre-edit forecast step in
				// correction_required) must also participate in fresh-process projection
				// reconstruction; before #176 it skipped restoration and failed against
				// an empty in-memory registry without ever invoking native FINALIZE.
				const correctionForecast = input.review_result === undefined && input.correction_line_forecast !== undefined;
				const replayKey = JSON.stringify({ cwd: defaultCwd, lineageId: parameters.lineageId ?? null, input: parameters.input ?? null, inputPath: parameters.inputPath ?? null });
				if ((validationAttempt || input.review_result !== undefined || (correctionForecast && nativeReviewCli.targetStatus !== undefined)) && candidateViews && parameters.lineageId && !candidateViews.hasProjection(parameters.lineageId)) {
					if (nativeReviewCli.targetStatus !== undefined) {
						negotiatedStatus = await nativeReviewCli.targetStatus({ cwd: defaultCwd, lineageId: parameters.lineageId, ...(signal === undefined ? {} : { signal }) });
						if (negotiatedStatus.applicability !== "current_target" || negotiatedStatus.authority?.lineageId !== parameters.lineageId) return mapNativeTargetStatus(parameters.operation, negotiatedStatus, parameters.lineageId);
						candidateView = validationAttempt
							? (candidateViews.restoreProjectionFromNative(parameters.lineageId, defaultCwd, negotiatedStatus.projection), undefined)
							: candidateViews.restoreForFinalizeFromNative(parameters.lineageId, defaultCwd, negotiatedStatus.projection);
					} else {
						const raw = JSON.parse(readFileSync(join(resolveRepositoryAuthorityV1(defaultCwd).common_directory, "gentle-ai", "review-transactions", "v2", parameters.lineageId, "review-state.json"), "utf8"));
						if (!isRecord(raw) || raw.schema !== "gentle-ai.review-state-record/v2" || !isRecord(raw.state) || raw.state.schema !== "gentle-ai.review-state/v2" || raw.state.lineage_id !== parameters.lineageId || raw.state.state !== "correction_required") throw new CandidateViewError("authoritative correction state is invalid");
						const snapshots = [raw.state.initial_snapshot, raw.state.current_snapshot];
						if (!snapshots.every((snapshot) => isRecord(snapshot) && snapshot.kind === "current-changes" && typeof snapshot.base_tree === "string" && typeof snapshot.candidate_tree === "string" && typeof snapshot.paths_digest === "string" && Array.isArray(snapshot.paths) && snapshot.paths.every((path) => typeof path === "string")) || snapshots.some((snapshot) => JSON.stringify(snapshot) !== JSON.stringify(snapshots[0]))) throw new CandidateViewError("authoritative correction snapshot is invalid");
						const snapshot = snapshots[0] as Record<string, unknown>;
						const head = resolveCanonicalCandidateBase(defaultCwd, "HEAD");
						if (head.tree !== snapshot.base_tree) throw new CandidateViewError("authoritative correction base no longer matches HEAD");
						candidateViews.restoreProjection(parameters.lineageId, defaultCwd, head.commit, snapshot.base_tree as string, snapshot.candidate_tree as string, snapshot.paths as string[]);
						authoritativeState = raw.state;
					}
				}
				// Fail closed before any native mutation when the frozen projection
				// belongs to a different worktree than the requested workspace (#169).
				if (candidateViews && parameters.lineageId && candidateViews.hasProjection(parameters.lineageId)) candidateViews.resolveProjection(parameters.lineageId, defaultCwd);
				candidateView ??= candidateViews && parameters.lineageId ? (correctionCompletion || validationAttempt) ? candidateViews.createCorrected(parameters.lineageId, defaultCwd, replayKey) : candidateViews.resolveForFinalize(parameters.lineageId) : undefined;
				if (validationAttempt && candidateView && parameters.lineageId) {
					if (nativeReviewCli.targetStatus !== undefined) {
						if (input.validation === undefined) {
							candidateViews.cleanup(candidateView.token);
							negotiatedStatus ??= await nativeReviewCli.targetStatus({ cwd: defaultCwd, lineageId: parameters.lineageId, ...(signal === undefined ? {} : { signal }) });
							return mapNativeTargetStatus(parameters.operation, negotiatedStatus, parameters.lineageId);
						}
						if (input.validation_proof !== undefined) throw new Error("Negotiated FINALIZE requires the native targeted validation document");
					} else {
						const request = deriveNativeValidationRequest({ lineageId: parameters.lineageId, candidateTree: candidateView.candidateTree, state: authoritativeState ?? JSON.parse(readFileSync(join(resolveRepositoryAuthorityV1(defaultCwd).common_directory, "gentle-ai", "review-transactions", "v2", parameters.lineageId, "review-state.json"), "utf8")).state });
						if (input.validation === undefined) {
							candidateViews.cleanup(candidateView.token);
							return { operation: parameters.operation, status: "blocked", outcome: "validation-required", lineage_created: false, mutation_performed: false, mutation_outcome: "none", validation_request: request };
						}
						if (input.validation_proof !== undefined || input.validation.request_hash !== request.request_hash || canonicalJsonV1(input.validation.correction_ids) !== canonicalJsonV1(request.fix_finding_ids)) throw new Error("Native FINALIZE validation must exactly match the controller-derived request");
					}
				}
				if (input.review_result !== undefined) {
					if (parameters.lineageId === undefined) throw new CandidateViewError("Native FINALIZE requires an explicit lineage for refuter derivation");
					let request;
					try {
						request = deriveNativeRefuterRequest({ lineageId: parameters.lineageId, ...(candidateView === undefined ? {} : { candidateTree: candidateView.candidateTree }), reviewResult: input.review_result });
					} catch (error) {
						if (!(error instanceof CompactReviewContractError) || error.code !== "candidate-tree") throw error;
						const candidateTree = captureLiveReviewCandidateBinding({
							cwd: defaultCwd,
							repositoryId: resolveRepositoryAuthorityV1(defaultCwd).repository_id,
						}).initial_review_tree;
						request = deriveNativeRefuterRequest({ lineageId: parameters.lineageId, candidateTree, reviewResult: input.review_result });
					}
					if (request !== undefined && input.refuter_batch === undefined) {
						return { operation: parameters.operation, status: "blocked", outcome: "refuter-required", lineage_created: false, mutation_performed: false, mutation_outcome: "none", refuter_request: request };
					}
					if (request !== undefined && input.review_result.refuter_request_hash !== request.request_hash) {
						throw new Error("Native FINALIZE refuter_request_hash must exactly match the controller-derived request");
					}
					if (request === undefined && (input.review_result.refuter_request_hash !== undefined || input.refuter_batch !== undefined)) {
						throw new Error("Native FINALIZE refuter material is invalid without inferential candidate-caused severe findings");
					}
				}
				nativeResult = await nativeReviewCli.finalize({
					cwd: candidateView?.root ?? defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(input.review_result === undefined ? {} : { lensResults: input.review_result.lens_results.map((document, index) => ({ lens: document.lens ?? `lens-${index}`, document: toNativeReviewerDocument(document) })) }),
					...(input.refuter_batch === undefined ? {} : { refuterDocument: toNativeRefuterDocument(input.refuter_batch) }),
					...(input.correction_line_forecast === undefined ? {} : { correctionLines: input.correction_line_forecast }),
					...(input.validation === undefined && input.validation_proof === undefined ? {} : { validationDocument: toNativeValidatorDocument(input.validation ?? input.validation_proof!) }),
					...(input.final_evidence === undefined ? {} : { evidenceDocument: input.final_evidence, failed: input.final_verification_passed === false }),
					...(signal === undefined ? {} : { signal }),
				});
			} catch (error) {
				if (correctionCompletion && candidateView && candidateViews && !nativeMutationRequiresStatus(error)) candidateViews.cleanup(candidateView.token);
				return reconcileNativeMutationFailure(parameters.operation, error, nativeReviewCli, {
					cwd: candidateView?.root ?? defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					projection: "workspace",
				});
			}
			try {
				if (correctionCompletion && candidateViews && parameters.lineageId) candidateViews.promoteCorrected(parameters.lineageId, candidateView!.token);
				candidateViews?.cleanupTerminal(nativeResult.lineageId, nativeResult.state);
				reconcileFinalizeRerunAttemptsByLineage.delete(nativeResult.lineageId);
				return { operation: parameters.operation, result: mapNativeFinalizeResult(nativeResult) };
			} catch (error) {
				const committedFailure = Object.assign(error instanceof Error ? error : new Error(String(error)), {
					mutationOutcome: "unknown",
					nextAction: "review.status",
				});
				return {
					...(await reconcileNativeMutationFailure(parameters.operation, committedFailure, nativeReviewCli, {
						cwd: candidateView?.root ?? defaultCwd,
						lineageId: nativeResult.lineageId,
						projection: "workspace",
					})),
					reconciliation_context: "post-native-finalize",
					mutation_performed: true,
					mutation_outcome: "committed",
					lineage_id: nativeResult.lineageId,
					state: nativeResult.state,
					store_revision: nativeResult.storeRevision,
				};
			}
		}
		return {
			operation: parameters.operation,
			result: finalizeCompactReview({
				cwd: defaultCwd,
				...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
				...(raw.review_result === undefined ? {} : { review_result: raw.review_result as never }),
				...(raw.correction_line_forecast === undefined ? {} : { correction_line_forecast: Number(raw.correction_line_forecast) }),
				...(raw.validation_proof === undefined ? {} : { validation_proof: raw.validation_proof as never }),
				...(raw.validation === undefined ? {} : { validation: raw.validation as never }),
				...(raw.final_evidence === undefined ? {} : { final_evidence: raw.final_evidence }),
				...(raw.final_verification_passed === undefined ? {} : { final_verification_passed: raw.final_verification_passed }),
			}),
		};
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
		const rawInput = parseControllerJson(
			hasInput
				? requiredControllerString(parameters, "input")
				: readRepositoryControllerInput(requiredControllerString(parameters, "inputPath"), defaultCwd),
			REVIEW_CONTROLLER_OPERATION.ADVANCE,
		);
		if (compactV2LineageExists(defaultCwd, parameters.lineageId!)) {
			throw new Error("Compact-v2 ordinary reviews mutate only through review finalize");
		}
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		if (store.read(parameters.lineageId!).mode === REVIEW_MODE.ORDINARY) {
			throw new Error(GRAPH_V1_ORDINARY_READ_ONLY);
		}
		let input = rawInput as unknown as ReviewReducerInput;
		if (transitionValue === REVIEW_TRANSITION.ORDINARY_FIX) {
			if (typeof rawInput.candidateTree !== "string" || !Array.isArray(rawInput.fixedIds) || rawInput.fixedIds.some((id) => typeof id !== "string")) {
				throw new Error("Git-derived correction evidence requires candidateTree and fixedIds");
			}
			try {
				const state = store.read(parameters.lineageId);
				const correction = captureOrdinaryCorrectionSnapshot({
					mode: state.mode,
					genesis_paths: state.genesis_paths,
					repository_root: defaultCwd,
					initial_review_tree: state.initial_review_tree,
					object_store: state.snapshot_object_store!,
				}, rawInput.candidateTree);
				input = {
					candidateTree: correction.candidate_tree,
					fixedIds: rawInput.fixedIds,
					fixDiff: correction.fix_diff,
					changedPaths: correction.changed_paths,
				};
			} catch (error) {
				throw new Error(`Git-derived correction evidence could not be captured: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
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
		if (nativeReviewCli?.targetStatus !== undefined) {
			try {
				const status = await nativeReviewCli.targetStatus({
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(signal === undefined ? {} : { signal }),
				});
				return mapNativeTargetStatus(parameters.operation, status, parameters.lineageId);
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
		}
		if (parameters.lineageId === undefined) return nativeStatusUnsupported(parameters.operation);
		const compactExists = compactV2LineageExists(defaultCwd, parameters.lineageId!);
		const graphExists = graphV1LineageExists(defaultCwd, parameters.lineageId!);
		if (compactExists && graphExists) throw new Error("Review authority is ambiguous across graph-v1 and compact-v2");
		if (compactExists) {
			const discovered = discoverCompactReview(defaultCwd, parameters.lineageId);
			const response: Record<string, unknown> = { operation: parameters.operation, state: discovered.record.state };
			if (
				discovered.record.state.state === "approved" ||
				discovered.record.state.state === "escalated"
			) response.receipt = discovered.store.loadTerminalReceipt().receipt;
			return response;
		}
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
		const releaseTarget = derived.command.event === "pre-release"
			? derived.target
			: derived.command.event === "pre-push" && isExactReleaseTagPushCommand(derived.command, derived.target)
				? projectExactTagCreatePushAsReleaseV1(derived.target)
				: null;
		if (releaseTarget === null && derived.command.event !== "pre-push") {
			throw new Error("Release fast-path evidence is only valid for a pre-release lifecycle command or one exact full semantic-version tag create refspec");
		}
		if (releaseTarget !== null) {
		const pushDestinationId = derived.command.event === "pre-push"
			? assertReleaseFastPathPushBinding(derived.command.cwd, derived.target, input.release.remote)
			: undefined;
		// The evaluator sees only the release identity projection. The pending
		// authorization remains bound to the original PUSH target and command.
		const evaluation = evaluateReleaseFastPathV1({
			target: releaseTarget,
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
					expected_ci_revision: evaluation.remote_head,
					expected_ci_status: "success",
					...(pushDestinationId === undefined ? {} : { push_destination_id: pushDestinationId }),
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
	}
	if (
		nativeReviewCli !== null &&
		typeof parameters.lineageId === "string" &&
		(nativeReviewCli.targetStatus !== undefined
			? !graphV1LineageExists(derived.command.cwd, parameters.lineageId)
			: !compactV2LineageExists(derived.command.cwd, parameters.lineageId) && !graphV1LineageExists(derived.command.cwd, parameters.lineageId))
	) {
		try {
			const nativeDerived = await deriveNativePublicationTarget(
				{ ...derived, ...(input.nativeRelease === undefined ? {} : { nativeRelease: input.nativeRelease }) },
				publicationProbe,
				publicationProbeTimeoutMs,
				signal,
			);
			if (nativeDerived.command.event === "pre-commit" && candidateViews && !candidateViews.hasProjection(parameters.lineageId) && nativeReviewCli.targetStatus !== undefined) {
				const targetStatus = await nativeReviewCli.targetStatus({ cwd: nativeDerived.command.cwd, lineageId: parameters.lineageId, projection: "staged", ...(signal === undefined ? {} : { signal }) });
				if (targetStatus.applicability !== "current_target" || targetStatus.authority?.lineageId !== parameters.lineageId) return mapNativeTargetStatus(parameters.operation, targetStatus, parameters.lineageId);
				candidateViews.restoreProjectionFromNative(parameters.lineageId, nativeDerived.command.cwd, targetStatus.projection);
			}
			const intendedTree = assertFrozenPreCommitProjection(nativeDerived, parameters.lineageId, candidateViews);
			const result = await nativeReviewCli.validate({
				cwd: nativeDerived.command.cwd,
				gate: requestedNativeGate(nativeDerived),
				lineageId: parameters.lineageId,
				flags: nativeGateFlags(nativeDerived),
				...(signal === undefined ? {} : { signal }),
			});
			assertNativePublicationBinding(result, nativeDerived);
			const authorizedDerived = result.allowed && result.result === "allow"
				? await rederiveNativePublicationTarget(
					nativeDerived,
					commandValue,
					defaultCwd,
					publicationProbe,
					publicationProbeTimeoutMs,
					signal,
				)
				: nativeDerived;
			if (result.allowed && result.result === "allow") assertFrozenPreCommitProjection(authorizedDerived, parameters.lineageId, candidateViews);
			const response: Record<string, unknown> = {
				operation: parameters.operation,
				result: mapNativeValidateResult(result),
				derived_target: nativeDerived.target,
			};
			if (!result.allowed && result.result === "invalidated" && result.action === "explicit-maintainer-action" && (nativeDerived.command.event === "pre-release" || (nativeDerived.target.kind === GATE_TARGET_KIND.PUSH && nativeDerived.target.updates.length === 1 && nativeDerived.target.updates[0]?.kind === PUSH_UPDATE_KIND.CREATE && nativeDerived.target.updates[0]?.destination_ref.startsWith("refs/tags/")))) {
				const commandHash = reviewAuthorizationKey(commandValue, nativeDerived.command.cwd);
				const denial = { result: "invalidated" as const, action: "explicit-maintainer-action" as const, reason: result.reason, context_fingerprint: nativeGateFingerprint(result, nativeDerived) };
				const request = await deriveMaintainerExceptionRequest(nativeDerived, commandValue, commandHash, denial, publicationProbe, publicationProbeTimeoutMs, signal);
				response.maintainer_exception_request = request;
				if (input.maintainerException !== undefined) {
					response.exception_authorized = false;
					response.exception_error = "Invalidated releases require a future durable, authority-bound exception.";
				}
				return response;
			}
			if (result.allowed && result.result === "allow") {
				const commandHash = reviewAuthorizationKey(commandValue, authorizedDerived.command.cwd);
				const authorization: PendingReviewAuthorization = {
					command_hash: commandHash,
					target_hash: authorizationTargetHash(authorizedDerived),
					receipt_hash: null,
					native_gate: {
						lineage_id: result.gateContext.lineageId,
						store_revision: result.gateContext.storeRevision,
						fingerprint: nativeGateFingerprint(result, authorizedDerived),
						...(intendedTree === undefined ? {} : { intended_tree: intendedTree }),
					},
					...(nativeDerived.nativeRelease === undefined ? {} : { native_release: nativeDerived.nativeRelease }),
				};
				pendingAuthorizations.set(commandHash, authorization);
				response.authorization = authorization;
			}
			return response;
		} catch (error) {
			return nativePublicationFailure(parameters.operation, error);
		}
	}
	if (
		parameters.changeName === undefined &&
		(parameters.lineageId === undefined || !graphV1LineageExists(derived.command.cwd, parameters.lineageId)) &&
		hasEligibleGraphV1RecoveryAuthorityV1(derived.command.cwd)
	) {
		throw new Error("Review controller validate requires changeName and a valid supersession for eligible graph-v1 recovery authority");
	}
	const recoveredAuthority = parameters.changeName === undefined
		? undefined
		: resolveReviewAuthorityForChange(derived.command.cwd, parameters.changeName);
	if (
		recoveredAuthority !== undefined &&
		parameters.lineageId !== undefined &&
		parameters.lineageId !== recoveredAuthority.record.state.lineage_id
	) {
		throw new Error("Review controller validate lineageId does not match the change-scoped recovered authority");
	}
	let compact = recoveredAuthority !== undefined;
	if (!compact && typeof parameters.lineageId === "string" && parameters.lineageId.trim().length > 0) {
		const compactExists = compactV2LineageExists(derived.command.cwd, parameters.lineageId);
		const graphExists = graphV1LineageExists(derived.command.cwd, parameters.lineageId);
		if (compactExists && graphExists) throw new Error("Review authority is ambiguous across graph-v1 and compact-v2");
		compact = compactExists;
	} else if (!compact) {
		try {
			discoverCompactReview(derived.command.cwd, undefined, true);
			compact = true;
		} catch (error) {
			if (!(error instanceof Error) || !/No discoverable compact review lineage/.test(error.message)) throw error;
		}
	}
	if (compact) {
		const result = validateCompactReviewGate({
			cwd: derived.command.cwd,
			...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
			...(parameters.changeName === undefined ? {} : { changeName: parameters.changeName }),
			deriveTarget: () => {
				const rederived = deriveReviewGateTarget(commandValue, defaultCwd);
				if (rederived.command.cwd !== derived.command.cwd) throw new Error("Lifecycle command repository changed during compact validation");
				return {
					target: rederived.target,
					...(rederived.actualIntendedCommitTree === undefined ? {} : { actualIntendedCommitTree: rederived.actualIntendedCommitTree }),
				};
			},
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
				receipt_hash: result.receipt_hash,
			};
			pendingAuthorizations.set(commandHash, authorization);
			response.authorization = authorization;
		}
		return response;
	}
	if (typeof parameters.lineageId !== "string" || parameters.lineageId.trim().length === 0) {
		throw new Error("Review controller validate requires a lineageId for native receipt validation");
	}
	if (!input.scopeBudget) throw new Error("Graph-v1 receipt validation requires scopeBudget");
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

async function gateLifecycleCommand(
	command: string,
	defaultCwd: string,
	pendingAuthorizations: Map<string, PendingReviewAuthorization>,
	nativeReviewCli: NativeReviewCli | null = null,
	publicationProbe: PublicationProbe = nodePublicationProbe,
	publicationProbeTimeoutMs = PUBLICATION_PROBE_TIMEOUT_MS,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = null,
): Promise<ToolCallEventResult | undefined> {
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
	if (authorization.native_gate) {
		try {
			derived = await deriveNativePublicationTarget(
				{ ...derived, ...(authorization.native_release === undefined ? {} : { nativeRelease: authorization.native_release }) },
				publicationProbe,
				publicationProbeTimeoutMs,
				signal,
			);
		} catch (error) {
			return {
				block: true,
				reason: `Gentle AI ${inspection.event} gate native publication target changed after authorization and failed closed: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
	if (authorization.maintainer_exception) {
		return { block: true, reason: `Gentle AI ${inspection.event} release exception is unsupported without durable authority evidence.` };
	}
	try {
		const intendedTree = authorization.native_gate === undefined
			? undefined
			: assertFrozenPreCommitProjection(derived, authorization.native_gate.lineage_id, candidateViews);
		if (authorization.native_gate?.intended_tree !== undefined && intendedTree !== authorization.native_gate.intended_tree) {
			return {
				block: true,
				reason: `Gentle AI ${inspection.event} gate staged projection changed after authorization and failed closed.`,
			};
		}
	} catch (error) {
		return {
			block: true,
			reason: `Gentle AI ${inspection.event} gate could not re-prove the staged projection and failed closed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (
		authorization.command_hash !== commandHash ||
		authorization.target_hash !== authorizationTargetHash(derived)
	) {
		const mismatch = authorization.command_hash !== commandHash ? "command identity" : "typed target";
		return {
			block: true,
			reason: `Gentle AI ${inspection.event} gate ${mismatch} changed after authorization and failed closed.`,
		};
	}
	if (authorization.native_gate) {
		if (nativeReviewCli === null) {
			return {
				block: true,
				reason: `Gentle AI ${inspection.event} gate native validation dependency is unavailable and failed closed.`,
			};
		}
		try {
			const fresh = await nativeReviewCli.validate({
				cwd: derived.command.cwd,
				gate: requestedNativeGate(derived),
				lineageId: authorization.native_gate.lineage_id,
				flags: nativeGateFlags(derived),
				...(signal === undefined ? {} : { signal }),
			});
			assertNativePublicationBinding(fresh, derived);
			if (
				!fresh.allowed ||
				fresh.result !== "allow"
			) {
				return {
					block: true,
					reason: `Gentle AI ${inspection.event} gate native authority, receipt, revision, or target changed after authorization and failed closed.`,
				};
			}
			const postNativeDerived = await rederiveNativePublicationTarget(
				derived,
				command,
				defaultCwd,
				publicationProbe,
				publicationProbeTimeoutMs,
				signal,
			);
			const postNativeIntendedTree = assertFrozenPreCommitProjection(postNativeDerived, authorization.native_gate.lineage_id, candidateViews);
			if (authorization.native_gate.intended_tree !== undefined && postNativeIntendedTree !== authorization.native_gate.intended_tree) throw new CandidateViewError("staged projection changed during native validation");
			assertNativePublicationBinding(fresh, postNativeDerived);
			if (nativeGateFingerprint(fresh, postNativeDerived) !== authorization.native_gate.fingerprint) {
				return {
					block: true,
					reason: `Gentle AI ${inspection.event} gate native authority, receipt, revision, or target changed after authorization and failed closed.`,
				};
			}
			derived = postNativeDerived;
		} catch {
			return {
				block: true,
				reason: `Gentle AI ${inspection.event} gate native bash-time validation failed closed.`,
			};
		}
	}
	if (authorization.release_fast_path) {
		const ciRecheck = recheckReleaseFastPathCiStatusV1({
			repositoryCwd: derived.command.cwd,
			sha: authorization.release_fast_path.expected_ci_revision,
			expectedStatus: authorization.release_fast_path.expected_ci_status,
		});
		if (!ciRecheck.proven) {
			return {
				block: true,
				reason: `Gentle AI ${inspection.event} release fast path failed closed: required CI for the authorized exact SHA could not be re-proven immediately before publication.`,
			};
		}
		try {
			if (derived.command.event === "pre-push") {
				assertReleaseFastPathPushBinding(
					derived.command.cwd,
					derived.target,
					authorization.release_fast_path.remote,
					authorization.release_fast_path.push_destination_id,
				);
			}
		} catch (error) {
			return {
				block: true,
				reason: `Gentle AI ${inspection.event} release fast path destination binding changed after authorization and failed closed: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
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
	return await evaluateGate(command);
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
	nativeStatusUnsupported,
	executeReviewControllerOperation,
	enforceReviewGateAndCommandSafety,
	renderSddModelPanel: renderSddModelPanelForTesting,
	getOrchestratorPrompt,
	renderOrchestratorPrompt,
	resolveControllerSddStatus,
	resolveStartupControllerSddStatus,
	repositoryLocationIdentity,
	runPublicationProbeGit,
	publicationProbeErrorCode: PUBLICATION_PROBE_ERROR_CODE,
};

const NATIVE_SDD_STATUS_STARTUP_TIMEOUT_MS = 1_000;

async function resolveControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
	nativeReviewCli: NativeReviewCli | null = null,
	signal?: AbortSignal,
) {
	const base = resolveSddStatus({ cwd, changeName, includeInstructions, artifactStore });
	if (!base.changeName || base.isNonAuthoritative) return base;
	if (hasRecoveryObligationForChange(cwd, base.changeName)) {
		return resolveSddStatus({
			cwd,
			changeName: base.changeName,
			includeInstructions,
			artifactStore,
			reviewAuthority: {
				expected: true,
				resolve: () => {
					const active = resolveReviewAuthorityForChange(cwd, base.changeName!);
					if (!active) throw new Error("validated recovered review authority is missing");
					return { activeAuthorityId: active.record.state.lineage_id };
				},
			},
		});
	}
	if (base.applyState !== "all_done" || nativeReviewCli === null) return base;
	try {
		const native = await nativeReviewCli.sddStatus({ cwd, change: base.changeName, ...(signal === undefined ? {} : { signal }) });
		return resolveSddStatus({
			cwd,
			changeName: base.changeName,
			includeInstructions,
			artifactStore,
			nativeReviewReadiness: { expected: true, ready: native.ready },
		});
	} catch (error) {
		return resolveSddStatus({
			cwd,
			changeName: base.changeName,
			includeInstructions,
			artifactStore,
			nativeReviewReadiness: { expected: true, ready: false, reason: error instanceof Error ? error.message : "native bound status failed" },
		});
	}
}

async function resolveStartupControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
	nativeReviewCli: NativeReviewCli | null,
	timeoutMs = NATIVE_SDD_STATUS_STARTUP_TIMEOUT_MS,
) {
	return resolveControllerSddStatus(cwd, changeName, includeInstructions, artifactStore, nativeReviewCli, AbortSignal.timeout(timeoutMs));
}

function hasRecoveryObligationForChange(cwd: string, changeName: string): boolean {
	try {
		return SupersessionStoreV1.forRepository(cwd).hasRecoveryRequiredMarker(changeName) || hasEligibleGraphV1RecoveryAuthorityV1(cwd);
	} catch (error) {
		// A non-repository cannot have repository-anchored recovery authority.
		if (error instanceof Error && error.message === "Unable to resolve Git repository authority") return false;
		// An unreadable marker, store, or Git authority is recovery-required, never absent.
		return true;
	}
}

export interface GentleAiRuntimeDependencies {
	nativeReviewCli?: NativeReviewCli | null;
	candidateViews?: CandidateViewRegistry | null;
	publicationProbe?: PublicationProbe;
	publicationProbeTimeoutMs?: number;
	bashTimeRevalidationTimeoutMs?: number;
}

export function createGentleAiExtension(dependencies: GentleAiRuntimeDependencies = {}): (pi: ExtensionAPI) => void {
	const nativeReviewCli = dependencies.nativeReviewCli === undefined ? createNativeReviewCli() : dependencies.nativeReviewCli;
	const publicationProbe = dependencies.publicationProbe ?? nodePublicationProbe;
	const publicationProbeTimeoutMs = dependencies.publicationProbeTimeoutMs ?? PUBLICATION_PROBE_TIMEOUT_MS;
	const bashTimeRevalidationTimeoutMs = dependencies.bashTimeRevalidationTimeoutMs ?? BASH_TIME_REVALIDATION_TIMEOUT_MS;
	if (!Number.isSafeInteger(publicationProbeTimeoutMs) || publicationProbeTimeoutMs <= 0) throw new TypeError("Publication probe timeout must be a positive safe integer");
	if (!Number.isSafeInteger(bashTimeRevalidationTimeoutMs) || bashTimeRevalidationTimeoutMs <= 0) throw new TypeError("Bash-time revalidation timeout must be a positive safe integer");
	return function gentleAi(pi: ExtensionAPI): void {
	const pendingReviewAuthorizations = new Map<string, PendingReviewAuthorization>();
	const pendingCommitTransactions = new Map<string, { cwd: string; transactionId: string }>();
	const candidateViews = dependencies.candidateViews === undefined ? new CandidateViewRegistry() : dependencies.candidateViews;

	pi.registerTool({
		name: "gentle_review",
		label: "Gentle Review Controller",
		description:
			"Inspect and recover review authority, run new native ordinary review through start/finalize/validate, preserve legacy compact compatibility reads and graph-v1 Judgment Day, and authorize one exact lifecycle command. FINALIZE input is a JSON string: review_result.lens_results[] entries contain lens, findings, and non-empty evidence exactly once for every lens selected by START; final_evidence and final_verification_passed are paired. This is the Pi wrapper contract, distinct from native CLI --result, --refuter, --validation, and --evidence files. RESET/RECOVER remain destructive and are executed by the audited native CLI: RESET and RECOVER_LOCK map to `gentle-ai review reclaim` and RECOVER maps to `gentle-ai review recover`; missing native inputs are requested through a native-input-required envelope, never invented. prepare-supersession/supersede require fresh interactive authorization and fail closed headlessly. Legacy bundle transport is retired: export/import return a legacy-operation-retired envelope pointing at the native gentle-ai review CLI and the Git common-directory store.",
		promptSnippet: "Inspect authority, then use native start/finalize/validate for a new ordinary review; use graph-v1 only for explicit Judgment Day",
		promptGuidelines: [
			'Call {"operation":"inspect"} before START. New native ordinary START uses a JSON string such as "{\\"mode\\":\\"ordinary\\"}"; an explicit baseRef must be paired with committedOnly: true to request a committed range, while policyPath remains repository-local. policyHash is legacy compact-only. The controller derives lineage, Git/untracked scope, tier, lenses, authored lines, and budget.',
			"For non-destructive legacy recovery, call prepare-supersession with one exact change, source, successor, operation, and prepared evidence input. Call supersede only with the returned request hash and exact English challenge after fresh UI approval; it never falls back to RESET or RECOVER. Headless, stale, conflicting, malformed, or unsupported recovery remains resolve-review blocked; exact retries are idempotent, but semantic retries require a new operation.",
			"Run selected lenses once, then call FINALIZE with a JSON string containing review_result.lens_results entries for every START-selected lens. Each entry has lens, findings, and non-empty evidence; clean lenses use findings: []. Pair final_evidence with final_verification_passed. This Pi wrapper shape differs from native CLI --result, --refuter, --validation, and --evidence files. FINALIZE alone records correction forecast, Git-derived correction evidence, targeted validation, and final evidence. Use ADVANCE only for explicit graph-v1 Judgment Day.",
			"For blocked-legacy or blocked-mixed, do not call START repeatedly. Explain invalidation, request explicit user authorization for the exact reset_request challenge, then call RESET or RECOVER only after authorization. RESET and RECOVER_LOCK route to audited native `gentle-ai review reclaim` and RECOVER routes to native `gentle-ai review recover`; supply the exact native inputs (lineage/actor/reason, or the predecessor, revision, successor, disposition, actor, and reason bindings) and treat a native-input-required envelope as a request for those values, never as permission to invent them. After a committed native recovery record, INSPECT before any fresh ordinary START.",
			"A reported lineage_created false or pre-authority validation error proves no lineage was created. After ambiguous START or FINALIZE output, the controller calls target-scoped native status first and returns only its declared action. Never infer or prescribe replay unless native explicitly reports exact_replay_safe for the same canonical request and required lineage.",
			"Use gentle_review for bounded review transaction operations and exact lifecycle validation; never fabricate bash tool metadata or a separate gate target.",
		],
		parameters: REVIEW_CONTROLLER_PARAMETERS,
		executionMode: "sequential",
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review controller operation was cancelled");
			await authorizeDestructiveReviewOperation(parameters, ctx);
			const details = await executeReviewControllerOperation(
				parameters,
				ctx.cwd,
				pendingReviewAuthorizations,
				nativeReviewCli,
				signal,
				publicationProbe,
				publicationProbeTimeoutMs,
				candidateViews,
				ctx,
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
			const transactionRecovery = reconcileCommitTransaction(ctx.cwd);
			if (ctx.hasUI && transactionRecovery.status !== "clean") {
				ctx.ui.notify(
					transactionRecovery.status === "active"
						? `Commit transaction ${transactionRecovery.record!.transaction_id} requires recovery from ${transactionRecovery.record!.state}. Publication remains blocked.`
						: `Commit transaction recovery state is corrupted: ${transactionRecovery.reason}`,
					"warning",
				);
			}
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Gentle AI could not inspect commit transaction recovery state: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
		}
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
			? `\n\n${renderNativeSddPhasePrompt(await resolveStartupControllerSddStatus(
				ctx.cwd,
				undefined,
				true,
				prefs?.artifactStore,
				nativeReviewCli,
			), phase)}`
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
		if (event.toolName === "subagent_run") {
			try {
				injectReviewCandidateView(event.input, candidateViews);
				return undefined;
			} catch (error) {
				return {
					block: true,
					reason: error instanceof Error ? error.message : "review subagent dispatch is invalid",
				};
			}
		}
		if (event.toolName !== "bash") return undefined;
		if (!isRecord(event.input) || typeof event.input.command !== "string")
			return undefined;
		const originalCommand = event.input.command;
		const inspection = inspectReviewLifecycleCommand(originalCommand, ctx.cwd);
		const nativeCommitAuthorization = inspection.command?.event === "pre-commit"
			? pendingReviewAuthorizations.get(reviewAuthorizationKey(originalCommand, inspection.command.cwd))
			: undefined;
		const gateResult = await enforceReviewGateAndCommandSafety(
			originalCommand,
			(command) => {
				const deadline = AbortSignal.timeout(bashTimeRevalidationTimeoutMs);
				const signal = ctx.signal === undefined ? deadline : AbortSignal.any([ctx.signal, deadline]);
				return gateLifecycleCommand(command, ctx.cwd, pendingReviewAuthorizations, nativeReviewCli, publicationProbe, publicationProbeTimeoutMs, signal, candidateViews);
			},
			(command) => confirmCommand(command, ctx),
		);
		if (gateResult) return gateResult;
		if (inspection.command?.event !== "pre-commit" || nativeCommitAuthorization?.native_gate === undefined) return undefined;
		if (nativeReviewCli?.targetStatus === undefined) return undefined;
		if (nativeCommitAuthorization.native_gate.intended_tree === undefined) {
			return { block: true, reason: "Gentle AI pre-commit authorization omitted the exact reviewed tree required by the durable commit transaction." };
		}
		try {
			const invocation = prepareCommitTransactionInvocation({
				command: originalCommand,
				cwd: inspection.command.cwd,
				arguments: inspection.command.arguments,
				authorization: {
					lineageId: nativeCommitAuthorization.native_gate.lineage_id,
					storeRevision: nativeCommitAuthorization.native_gate.store_revision,
					fingerprint: nativeCommitAuthorization.native_gate.fingerprint,
					intendedTree: nativeCommitAuthorization.native_gate.intended_tree,
				},
			});
			event.input.command = buildCommitTransactionShellCommand(invocation);
			pendingCommitTransactions.set(event.toolCallId, { cwd: invocation.cwd, transactionId: invocation.transactionId });
			return undefined;
		} catch (error) {
			return { block: true, reason: `Gentle AI pre-commit transaction preparation failed closed: ${error instanceof Error ? error.message : String(error)}` };
		}
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return undefined;
		const pending = pendingCommitTransactions.get(event.toolCallId);
		if (pending === undefined) return undefined;
		pendingCommitTransactions.delete(event.toolCallId);
		if (event.isError) return undefined;
		try {
			verifyCommitTransactionResult(pending.cwd, pending.transactionId);
			return undefined;
		} catch (error) {
			return {
				isError: true,
				content: [
					...event.content,
					{ type: "text", text: `Gentle AI commit transaction tool_result proof failed closed: ${error instanceof Error ? error.message : String(error)}` },
				],
			};
		}
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

	const handleSddStatusCommand = async (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const status = await resolveControllerSddStatus(
			ctx.cwd,
			parsed.changeName,
			true,
			getSddPreflightPreferences(ctx)?.artifactStore,
			nativeReviewCli,
		);
		ctx.ui.notify(
			parsed.json ? JSON.stringify(status, null, 2) : renderSddStatusMarkdown(status),
			sddStatusSeverity(status),
		);
	};

	pi.registerCommand("sdd-status", {
		description: "Show deterministic SDD change status and instructions.",
		handler: async (args, ctx) => {
			await handleSddStatusCommand(args, ctx);
		},
	});

	const handleSddContinueCommand = async (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const status = await resolveControllerSddStatus(
			ctx.cwd,
			parsed.changeName,
			true,
			getSddPreflightPreferences(ctx)?.artifactStore,
			nativeReviewCli,
		);
		ctx.ui.notify(
			parsed.json ? JSON.stringify(status, null, 2) : renderSddDispatcherMarkdown(status),
			sddStatusSeverity(status),
		);
	};

	pi.registerCommand("sdd-continue", {
		description: "Resolve SDD status and route the next phase deterministically.",
		handler: async (args, ctx) => {
			await handleSddContinueCommand(args, ctx);
		},
	});

	pi.registerCommand("gentle:commit-status", {
		description: "Inspect the durable Git commit transaction for this worktree.",
		handler: async (_args, ctx) => {
			const inspection = inspectCommitTransaction(ctx.cwd);
			ctx.ui.notify(JSON.stringify(inspection, null, 2), inspection.status === "clean" ? "info" : "warning");
		},
	});

	pi.registerCommand("gentle:commit-abort", {
		description: "Explicitly abandon an unresolved commit transaction without changing HEAD or the index.",
		handler: async (_args, ctx) => {
			try {
				const record = abandonCommitTransaction(ctx.cwd);
				ctx.ui.notify(`Commit transaction ${record.transaction_id} was abandoned without modifying Git content.`, "warning");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
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
	};
}

export default function gentleAi(pi: ExtensionAPI): void {
	return createGentleAiExtension()(pi);
}
