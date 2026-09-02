import { execFileSync } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
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
	SDD_PREFLIGHT_FIELDS,
	type SddPreflightField,
	type SddPreflightPreferences,
	updatePackageManagedSddAgentOwnership,
} from "../lib/sdd-preflight.ts";
import {
	THINKING_LEVELS,
	normalizeModelConfig,
	normalizeModelId,
	normalizeRoutingEntry,
	readSavedModelConfig as readModelRoutingAuthority,
	readSavedModelConfigAsync as readModelRoutingAuthorityAsync,
	type AgentModelConfig,
	type AgentRoutingEntry,
	type ModelConfigFileResult,
	type ThinkingLevel,
} from "../lib/model-routing-authority.ts";
import {
	parseSddStatusCommandArgs,
	renderNativeSddPhasePrompt,
	renderSddDispatcherMarkdown,
	renderSddStatusMarkdown,
	resolveSddStatus,
	sddStatusSeverity,
	type SddPhase,
} from "../lib/sdd-status.ts";
import {
	REVIEW_HOST_RELAY_FAILURE,
	REVIEW_HOST_RELAY_PI_TIMEOUT_ENV,
	REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS,
	REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE,
	REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE,
	ReviewHostRelayError,
	reviewHostRelaySlots,
	reviewProviderRoleVectorSlots,
	resolveReviewHostRelaySubmission,
	runReviewHostRelayReviewerGroup,
	runReviewHostRelaySlot,
	submitReviewHostRelayPreparedResult,
	type ReviewHostRelayPreparedResult,
	type ReviewHostRelayRequest,
	type ReviewHostRelayRunner,
	type ReviewHostRelaySlot,
	type ReviewProviderRoleVectorSlot,
} from "../lib/review-host-relay.ts";
import {
	JOURNAL_STATUS,
	REVIEW_OPERATION,
	REVIEW_TRANSITION,
	ReviewTransactionStore,
	canonicalHash,
	createReviewState,
	type ReviewBudgetV1,
	type ReviewReducerInput,
	type StartOperationResultV1,
	type ReviewTransition,
} from "../lib/review-transaction.ts";
import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	captureReviewSnapshot,
	type ReviewMode,
	type ReviewProjectionV1,
} from "../lib/review-snapshot.ts";
import { renderGentleAiLifecycleCall, renderGentleAiResult, type GentleAiRenderContext } from "../lib/gentle-ai-renderer.ts";
import { sanitizeTerminalText, stripAnsi } from "../lib/terminal-theme.ts";
import { CandidateViewError, CandidateViewRegistry, injectReviewCandidateView, readCandidateContextManifestPage, resolveCanonicalCandidateBase, type CandidateView } from "../lib/review-candidate-view.ts";
import {
	GentleAiDevBinaryOverrideError,
	registerGentleAiDevBinary,
	resolveGentleAiDevBinaryOverride,
	unregisterGentleAiDevBinary,
	type GentleAiDevBinaryOverride,
} from "../lib/gentle-ai-binary.ts";
import {
	createNativeReviewCli,
	createNodeExecFileAdapter,
	isCanonicalProcessString,
	nativeReviewAbandonAuthorization,
	nativeReviewLegacyAliasRepairAuthorization,
	nativeReviewLegacyQuarantineAuthorization,
	nativeReviewReconcileAuthorization,
	nativeReviewRecoverAuthorization,
	normalizeNativeReviewCwd,
	NativeReviewCliError,
	NativeReviewConsentBindingError,
	NativeReviewConsentRequiredError,
	NativeReviewIntegrationError,
	NATIVE_REVIEW_ERROR_CODE,
	NATIVE_REVIEW_OPERATION,
	NATIVE_REVIEW_LEGACY_QUARANTINE,
	NATIVE_REVIEW_LEGACY_ALIAS_REPAIR,
	NATIVE_REVIEW_MODE_OPERATION,
	NATIVE_REVIEW_MODE_SOURCE,
	NATIVE_REVIEW_RECONCILE_ANOMALIES,
	sanitizeForeignNativeReviewDiagnostics,
	type NativeReviewCli,
	type NativeIntendedUntrackedSelectionSubmission,
	type NativeReviewAcknowledgeApprovedOutcome,
	type NativeReviewAcknowledgeApprovedRequest,
	type NativeTargetStatusRequest,
	type NativeReviewModeOperation,
	type NativeReviewModeSource,
	type NativeReviewProcessDiagnostics,
	type NativeStartResult,
} from "../lib/native-review-cli.ts";
import {
	assertReviewApprovedAcknowledgementExecuteV1,
	decodeReviewLastEventClosureV1,
	type ReviewCollectInputV3,
	type ReviewConsentEnvelope,
	type ReviewLastEventClosureBinding,
	type ReviewLastEventClosureV1,
	type ReviewStatusV3,
} from "../lib/review-integration-v2.ts";
import { reconcileUnknownReviewLastEventCapture } from "../lib/review-last-event-controller.ts";
import { recordReviewConsentLatch } from "../lib/review-consent-latch.ts";

const GRAPH_V1_ORDINARY_READ_ONLY = "Graph-v1 ordinary review authority is read-only; use native compact-v2 review operations";
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

// ---------------------------------------------------------------------------
// Background subagents policy — project > global > env > default off
// ---------------------------------------------------------------------------

type BackgroundSubagentsPolicy = "on" | "off";
type BackgroundSubagentsCapability = "ready" | "absent";

interface BackgroundSubagentsRendering {
	policy: BackgroundSubagentsPolicy;
	capability: BackgroundSubagentsCapability;
}

/** Which of the four sources decided the effective policy. */
type BackgroundSubagentsSource =
	| "project_file"
	| "global_file"
	| "environment"
	| "default";

interface BackgroundSubagentsResolution {
	policy: BackgroundSubagentsPolicy;
	source: BackgroundSubagentsSource;
	/** The deciding file was present but failed the strict decode. */
	malformed: boolean;
	projectFile: string;
	globalFile: string;
	projectFileExists: boolean;
	globalFileExists: boolean;
	/** The raw env value, reported even when it is unrecognized and inert. */
	envValue: string | undefined;
}

interface LoadBackgroundSubagentsOptions {
	/** Override the config home directory (used in tests to avoid touching ~/.pi). */
	gentlePiConfigHome?: string;
	/** Override the environment lookup (used in tests). */
	env?: Record<string, string | undefined>;
}

const BACKGROUND_SUBAGENTS_SCHEMA = "gentle-pi.background-subagents/v1";
const BACKGROUND_SUBAGENTS_FILE = "background-subagents.json";

const DEFAULT_BACKGROUND_SUBAGENTS_RENDERING: BackgroundSubagentsRendering = {
	policy: "off",
	capability: "absent",
};

/**
 * Strict decode of {"schema":"gentle-pi.background-subagents/v1","policy":"on"|"off"}.
 * Any malformed shape (bad JSON, wrong schema, unknown keys, invalid policy)
 * returns undefined so the caller fails closed to "off".
 */
function parseBackgroundSubagentsPolicyFile(
	raw: string,
): BackgroundSubagentsPolicy | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	if (parsed.schema !== BACKGROUND_SUBAGENTS_SCHEMA) return undefined;
	if (parsed.policy !== "on" && parsed.policy !== "off") return undefined;
	if (Object.keys(parsed).length !== 2) return undefined;
	return parsed.policy;
}

/**
 * Resolve the background-subagents policy AND the source that decided it.
 *
 * Resolution order (first hit wins, mirroring loadRuntimeGuardrailsConfig):
 *   1. Project file `${cwd}/.pi/gentle-ai/background-subagents.json`
 *   2. Global file `${configHome}/background-subagents.json`
 *      (configHome honors GENTLE_PI_CONFIG_HOME, default ~/.pi/gentle-ai)
 *   3. Env var GENTLE_PI_BACKGROUND_SUBAGENTS ("on" | "off")
 *   4. Default "off"
 *
 * A present-but-malformed file fails closed to "off" instead of falling
 * through to a lower-priority source, and it stays attributed to that file:
 * "off decided by a broken project file" and "off by default" are different
 * situations, and only the first one is a mistake to fix.
 *
 * Four sources with first-hit-wins is exactly the shape that makes an edit
 * look like it did nothing, so the deciding source is part of the result
 * rather than something a caller has to re-derive.
 */
function resolveBackgroundSubagentsPolicy(
	cwd: string,
	options: LoadBackgroundSubagentsOptions = {},
): BackgroundSubagentsResolution {
	const env = options.env ?? process.env;
	const envValue = env.GENTLE_PI_BACKGROUND_SUBAGENTS;
	let projectFile = "";
	let globalFile = "";
	try {
		const configHome = options.gentlePiConfigHome ?? gentleAiConfigHome();
		projectFile = join(cwd, ".pi", "gentle-ai", BACKGROUND_SUBAGENTS_FILE);
		globalFile = join(configHome, BACKGROUND_SUBAGENTS_FILE);
		const projectFileExists = existsSync(projectFile);
		const globalFileExists = existsSync(globalFile);
		const locations = { projectFile, globalFile, projectFileExists, globalFileExists, envValue };
		for (const [source, path, present] of [
			["project_file", projectFile, projectFileExists],
			["global_file", globalFile, globalFileExists],
		] as const) {
			if (!present) continue;
			let decoded: BackgroundSubagentsPolicy | undefined;
			try {
				decoded = parseBackgroundSubagentsPolicyFile(readFileSync(path, "utf8"));
			} catch {
				// Unreadable is indistinguishable from unusable at this layer, and
				// both must fail closed on the file that claimed the decision.
				decoded = undefined;
			}
			return decoded === undefined
				? { policy: "off", source, malformed: true, ...locations }
				: { policy: decoded, source, malformed: false, ...locations };
		}
		if (envValue === "on" || envValue === "off") {
			return { policy: envValue, source: "environment", malformed: false, ...locations };
		}
		return { policy: "off", source: "default", malformed: false, ...locations };
	} catch {
		return {
			policy: "off",
			source: "default",
			malformed: false,
			projectFile,
			globalFile,
			projectFileExists: false,
			globalFileExists: false,
			envValue,
		};
	}
}

/**
 * The effective policy alone, for callers that do not report a source.
 * It delegates so the loader and the resolver can never disagree.
 */
function loadBackgroundSubagentsPolicy(
	cwd: string,
	options: LoadBackgroundSubagentsOptions = {},
): BackgroundSubagentsPolicy {
	return resolveBackgroundSubagentsPolicy(cwd, options).policy;
}

/** Write the global policy file, creating the config home when needed. */
function writeGlobalBackgroundSubagentsPolicy(
	policy: BackgroundSubagentsPolicy,
	configHome: string = gentleAiConfigHome(),
): string {
	const path = join(configHome, BACKGROUND_SUBAGENTS_FILE);
	mkdirSync(configHome, { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({ schema: BACKGROUND_SUBAGENTS_SCHEMA, policy }, null, 2)}\n`,
	);
	return path;
}

function describeBackgroundSubagentsSource(
	resolution: BackgroundSubagentsResolution,
): string {
	switch (resolution.source) {
		case "project_file":
			return `project file ${resolution.projectFile}`;
		case "global_file":
			return `global file ${resolution.globalFile}`;
		case "environment":
			return "GENTLE_PI_BACKGROUND_SUBAGENTS";
		default:
			return "built-in default";
	}
}

/**
 * Report the effective policy, the source that decided it, and the resolved
 * capability, plus whatever the user needs to know about the sources that did
 * NOT decide. `wrote` names a policy this invocation just wrote to the global
 * file; a write that a higher-priority file outranks must never be reported as
 * if it had taken effect.
 */
function renderBackgroundSubagentsReport(
	resolution: BackgroundSubagentsResolution,
	capability: BackgroundSubagentsCapability,
	wrote?: BackgroundSubagentsPolicy,
): { message: string; type: "info" | "warning" } {
	const lines = [
		`background subagents: ${resolution.policy} (decided by ${describeBackgroundSubagentsSource(resolution)}; capability: ${capability})`,
	];
	if (wrote !== undefined) {
		lines.push(`Wrote ${wrote} to the global file ${resolution.globalFile}.`);
	}
	if (resolution.malformed) {
		const path =
			resolution.source === "project_file" ? resolution.projectFile : resolution.globalFile;
		lines.push(
			`${path} is present but malformed, so the policy fails closed to off and no lower-priority source is consulted.`,
		);
	}
	const outranksTheWrite = wrote !== undefined && resolution.source === "project_file";
	if (outranksTheWrite) {
		lines.push(
			`That global write does not take effect here: the project file ${resolution.projectFile} outranks it. Edit or remove that project file to let the global setting decide.`,
		);
	} else if (
		wrote === undefined &&
		resolution.source === "project_file" &&
		resolution.globalFileExists
	) {
		lines.push(
			`The global file ${resolution.globalFile} exists but is outranked by that project file.`,
		);
	}
	if (resolution.envValue !== undefined && resolution.source !== "environment") {
		lines.push(
			resolution.envValue === "on" || resolution.envValue === "off"
				? `GENTLE_PI_BACKGROUND_SUBAGENTS=${resolution.envValue} is set, but both files outrank it and it outranks the built-in default; it decides only when neither file exists.`
				: `GENTLE_PI_BACKGROUND_SUBAGENTS="${resolution.envValue}" is not a recognized value ("on" or "off"), so it is ignored.`,
		);
	}
	lines.push(
		"Resolution order (first hit wins): project file, global file, GENTLE_PI_BACKGROUND_SUBAGENTS, built-in default off.",
	);
	return {
		message: lines.join("\n"),
		type: resolution.malformed || outranksTheWrite ? "warning" : "info",
	};
}

const SUBAGENTS_PACKAGE_NAMES = ["pi-subagents-j0k3r", "pi-subagents"] as const;
const SUBAGENT_RUN_TOOL = "subagent_run";
const BOUNDED_WRITER_AGENT_NAMES = ["gentle-ai-worker", "worker"] as const;
const ALLOWED_EDIT_SURFACES_HEADING = /^## Allowed edit surfaces[ \t]*$/gim;
const MARKDOWN_HEADING_LINE = /^ {0,3}#{1,6} /;
const MARKDOWN_LIST_MARKER = /^(?:[-*+]|\d+[.)]) +/;
const WRITER_EDIT_SURFACE_REJECTION =
	"Writer tasks must include the exact Markdown heading `## Allowed edit surfaces` with narrow repository-relative paths or narrow globs, one per line. Every non-empty line belongs to the section until the next canonical Markdown heading and must be a valid surface entry. Paths containing whitespace require whole-entry backticks; begin explanatory prose under the next Markdown heading. The parent must derive or map that canonical block from the delegated task and relaunch the writer; do not accept aliases, and do not ask the human to author paths or globs.";

function isTaskScopedRepositoryRelativePath(value: string, isWholeEntryBackticked: boolean): boolean {
	const normalized = value.replace(/\\/g, "/");
	if (
		normalized.length === 0 ||
		isAbsolute(value) ||
		/^(?:[A-Za-z]:|\/|~)/.test(normalized) ||
		/\p{Cc}|\p{Zl}|\p{Zp}/u.test(normalized) ||
		(/\p{White_Space}/u.test(normalized) && !isWholeEntryBackticked)
	) {
		return false;
	}

	const withoutCurrentDirectory = normalized.replace(/^(?:\.\/)+/, "");
	if (
		withoutCurrentDirectory.length === 0 ||
		withoutCurrentDirectory === "." ||
		withoutCurrentDirectory.startsWith("/") ||
		withoutCurrentDirectory.split("/").some((segment) => segment === "..")
	) {
		return false;
	}

	return !/[?*\[\]{}]/.test(withoutCurrentDirectory.split("/")[0]);
}

type AllowedEditSurfaceEntry = {
	source: string;
	value: string;
	isWholeEntryBackticked: boolean;
	isValidMarkdownSyntax: boolean;
};

/** Reads one entry and records whether backticks delimit the whole path. */
function readSurfaceEntry(line: string): AllowedEditSurfaceEntry {
	const withoutListMarker = line.replace(MARKDOWN_LIST_MARKER, "");
	const backticked = withoutListMarker.match(/^`([^`]+)`$/);
	return {
		source: line,
		value: backticked?.[1] ?? withoutListMarker,
		isWholeEntryBackticked: backticked !== null,
		isValidMarkdownSyntax:
			!/^(?:[-*+]|\d+[.)])$/.test(line) && (!withoutListMarker.includes("`") || backticked !== null),
	};
}

/**
 * Reads every non-empty line until the next Markdown heading as an edit surface.
 * A prose line cannot terminate this section: it must fail validation instead.
 */
function readAllowedEditSurfaceEntries(following: string): AllowedEditSurfaceEntry[] {
	const lines = following.split(/\r?\n/);
	const headingIndex = lines.findIndex((line) => MARKDOWN_HEADING_LINE.test(line));
	return (headingIndex === -1 ? lines : lines.slice(0, headingIndex))
		.map((line) => line.replace(/ +$/g, ""))
		.filter((line) => line.length > 0)
		.map((line) => readSurfaceEntry(line.replace(/^ {0,3}/, "")));
}

function hasTaskScopedAllowedEditSurfaces(...values: unknown[]): boolean {
	let expectedEntries: string[] | undefined;
	let hasSection = false;

	for (const value of values) {
		if (typeof value !== "string") continue;

		const headings = value.matchAll(ALLOWED_EDIT_SURFACES_HEADING);
		for (const heading of headings) {
			const bodyStart = (heading.index ?? 0) + heading[0].length;
			const entries = readAllowedEditSurfaceEntries(value.slice(bodyStart));
			if (
				entries.length === 0 ||
				!entries.every(
					(entry) =>
						entry.isValidMarkdownSyntax &&
						!/\p{Cc}|\p{Zl}|\p{Zp}/u.test(entry.source) &&
						isTaskScopedRepositoryRelativePath(entry.value, entry.isWholeEntryBackticked),
				)
			) {
				return false;
			}

			const uniqueEntries = [...new Set(entries.map((entry) => entry.value))].sort();
			if (
				expectedEntries &&
				(expectedEntries.length !== uniqueEntries.length ||
					expectedEntries.some((entry, index) => entry !== uniqueEntries[index]))
			) {
				return false;
			}
			expectedEntries = uniqueEntries;
			hasSection = true;
		}
	}

	return hasSection;
}

function rejectUnscopedBoundedWriterDispatch(input: unknown): { block: true; reason: string } | undefined {
	if (
		!isRecord(input) ||
		typeof input.agent !== "string" ||
		!(BOUNDED_WRITER_AGENT_NAMES as readonly string[]).includes(input.agent)
	) {
		return undefined;
	}
	if (hasTaskScopedAllowedEditSurfaces(input.task, input.context)) {
		return undefined;
	}
	return { block: true, reason: WRITER_EDIT_SURFACE_REJECTION };
}

/**
 * Roots where an installed subagents package may live. These are the same
 * roots builtinAgentDirs() walks, minus its `/agents` suffix.
 *
 * builtinAgentDirs() looks for markdown agent definitions, which the package
 * legitimately may not ship. Capability is a different question, so it must
 * not reuse that path: pi-subagents-j0k3r v1.5.2 ships index.ts, src/, skills/
 * and scripts/ and no agents/ directory at all, so an agents-dir probe reports
 * "absent" on every real install and leaves the background policy inert.
 */
function subagentsPackageRoots(cwd: string): string[] {
	return SUBAGENTS_PACKAGE_NAMES.flatMap((packageName) => [
		join(PACKAGE_ROOT, "..", packageName),
		join(cwd, ".pi", "npm", "node_modules", packageName),
		join(homedir(), ".local", "lib", "node_modules", packageName),
	]);
}

/** A package root counts as installed only when it carries its own manifest. */
function hasInstalledSubagentsPackage(cwd: string): boolean {
	return subagentsPackageRoots(cwd).some((root) =>
		existsSync(join(root, "package.json")),
	);
}

function hasSubagentRunTool(activeTools: readonly string[]): boolean {
	return activeTools.some(
		(name) => name === SUBAGENT_RUN_TOOL || name.endsWith(`.${SUBAGENT_RUN_TOOL}`),
	);
}

/**
 * Read the live pi tool registry, or undefined when it carries no signal.
 *
 * An absent handle, a non-array result, a throwing registry, and an empty list
 * are all "no signal" rather than "no subagents": reporting absent from an
 * uninformative registry would reproduce the very defect this probe fixes.
 */
function readActiveToolNames(pi: unknown): readonly string[] | undefined {
	try {
		const getActiveTools = (pi as { getActiveTools?: () => unknown })
			?.getActiveTools;
		if (typeof getActiveTools !== "function") return undefined;
		const tools = getActiveTools.call(pi);
		if (!Array.isArray(tools)) return undefined;
		const names = tools
			.map((tool) =>
				typeof tool === "string"
					? tool
					: isRecord(tool) && typeof tool.name === "string"
						? tool.name
						: "",
			)
			.filter((name) => name.length > 0);
		return names.length > 0 ? names : undefined;
	} catch {
		return undefined;
	}
}

/**
 * `subagent_run` availability probe.
 *
 * The live tool registry answers the question directly and wins whenever it
 * carries any signal. Without it -- prompt rendering outside a session, or a
 * runtime with no getActiveTools -- capability falls back to the presence of
 * an installed subagents package.
 */
function resolveBackgroundSubagentsCapability(
	cwd: string,
	activeTools?: readonly string[],
): BackgroundSubagentsCapability {
	try {
		if (activeTools !== undefined && activeTools.length > 0) {
			return hasSubagentRunTool(activeTools) ? "ready" : "absent";
		}
		return hasInstalledSubagentsPackage(cwd) ? "ready" : "absent";
	} catch {
		return "absent";
	}
}

function renderBackgroundSubagentsStatusLine(
	background: BackgroundSubagentsRendering,
): string {
	return `Background subagent policy: ${background.policy} (capability: ${background.capability})`;
}

// Rendered prompts are memoized per background policy/capability key for the
// process lifetime; the assets bytes themselves are read once per key.
const orchestratorPromptCache = new Map<string, string>();
function getOrchestratorPrompt(
	cwd: string = process.cwd(),
	activeTools?: readonly string[],
): string {
	const background: BackgroundSubagentsRendering = {
		policy: loadBackgroundSubagentsPolicy(cwd),
		capability: resolveBackgroundSubagentsCapability(cwd, activeTools),
	};
	const cacheKey = `${background.policy}:${background.capability}`;
	let prompt = orchestratorPromptCache.get(cacheKey);
	if (prompt === undefined) {
		prompt = renderOrchestratorPrompt(ASSETS_DIR, background);
		orchestratorPromptCache.set(cacheKey, prompt);
	}
	return prompt;
}

function renderOrchestratorPrompt(
	assetsDir: string,
	background: BackgroundSubagentsRendering = DEFAULT_BACKGROUND_SUBAGENTS_RENDERING,
): string {
	return readFileSync(join(assetsDir, "orchestrator.md"), "utf8")
		.replaceAll("{{GENTLE_PI_ASSETS_ROOT}}", assetsDir)
		.replaceAll(
			"{{GENTLE_PI_BACKGROUND_POLICY}}",
			renderBackgroundSubagentsStatusLine(background),
		)
		.trim();
}

// gentle-pi#560 / gentle-ai#4056, #4057: Gentle AI stopped writing a
// runtime-specific review execution contract into Pi's generated
// APPEND_SYSTEM composition on 2026-08-01. This package now injects the
// mirrored provider contract bundle's own `orchestration/pi.md` text
// instead, read once from the package-local mirror
// (contracts/review-provider-contract-mirror/) and cached as the fully
// rendered fragment for the process lifetime. It is deliberately NOT folded
// into getOrchestratorPrompt/orchestratorPromptCache: that core prompt is
// pinned at an 8192-byte budget (tests/orchestrator-budget.test.ts).
const PROVIDER_CONTRACT_MIRROR_ROOT = join(PACKAGE_ROOT, "contracts", "review-provider-contract-mirror");
const PROVIDER_CONTRACT_LOCK_FILE = "provider-contract.lock.json";
const PI_ORCHESTRATION_RUNTIME = "pi";

let reviewContractPromptFragmentCache: string | null | undefined;
let reviewContractPromptMissingWarned = false;

// Verifies the mirrored orchestration/pi.md bytes against the lock's digest before injection (gentle-ai R1/R3).
function readMirroredReviewContractFragment(mirrorRoot: string = PROVIDER_CONTRACT_MIRROR_ROOT): string | null {
	try {
		const lockPath = join(mirrorRoot, PROVIDER_CONTRACT_LOCK_FILE);
		const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
			contract_semver?: unknown;
			entries?: Record<string, unknown>;
		};
		if (typeof lock.contract_semver !== "string" || lock.contract_semver === "") return null;
		const expectedSha256 = lock.entries?.[`orchestration/${PI_ORCHESTRATION_RUNTIME}.md`];
		if (typeof expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedSha256)) return null;
		const contractPath = join(mirrorRoot, `v${lock.contract_semver}`, "bundle", "orchestration", `${PI_ORCHESTRATION_RUNTIME}.md`);
		const rawBytes = readFileSync(contractPath);
		const actualSha256 = createHash("sha256").update(rawBytes).digest("hex");
		if (!timingSafeEqual(Buffer.from(expectedSha256, "hex"), Buffer.from(actualSha256, "hex"))) return null;
		const text = rawBytes.toString("utf8").trim();
		if (text.length === 0) return null;
		return `## Gentle AI review execution contract (mirrored provider bundle ${lock.contract_semver})\n\n${text}`;
	} catch {
		return null;
	}
}

function loadReviewContractPromptFragment(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	mirrorRoot: string = PROVIDER_CONTRACT_MIRROR_ROOT,
): string | null {
	if (reviewContractPromptFragmentCache === undefined) {
		reviewContractPromptFragmentCache = readMirroredReviewContractFragment(mirrorRoot);
	}
	if (reviewContractPromptFragmentCache === null && !reviewContractPromptMissingWarned) {
		reviewContractPromptMissingWarned = true;
		if (ctx.hasUI) {
			ctx.ui.notify(
				"Gentle AI review execution contract is unavailable: the mirrored provider bundle is missing, unreadable, or fails digest verification. Review preflight instructions will not be injected this session.",
				"warning",
			);
		}
	}
	return reviewContractPromptFragmentCache;
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

function buildGentlePrompt(
	persona: PersonaMode,
	cwd: string = process.cwd(),
	activeTools?: readonly string[],
): string {
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

${getOrchestratorPrompt(cwd, activeTools)}`;
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
	"sdd-research",
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
	...THINKING_LEVELS,
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

const ASK_USER_CHOICE_BLOCKED_EVENT = "gentle-pi:ask-user-choice:blocked";

const HERDR_BLOCKER_LABEL = {
	CHOICE: "Choice awaiting input",
	GUARDED_CONFIRMATION: "Guarded command confirmation",
	QUESTIONNAIRE: "Questionnaire awaiting input",
} as const;

type HerdrBlockerLabel = (typeof HERDR_BLOCKER_LABEL)[keyof typeof HERDR_BLOCKER_LABEL];

type HerdrConfirmationLifecycle = {
	begin(): void;
	settle(): void;
};

function createHerdrConfirmationLifecycle(events: ExtensionAPI["events"]): HerdrConfirmationLifecycle {
	let pending = 0;
	let choiceActive = false;
	let questionnaireActive = false;
	let emittedLabel: HerdrBlockerLabel | undefined;
	const emitEffectiveBlocker = (): void => {
		const nextLabel = choiceActive
			? HERDR_BLOCKER_LABEL.CHOICE
			: questionnaireActive
				? HERDR_BLOCKER_LABEL.QUESTIONNAIRE
				: pending > 0
					? HERDR_BLOCKER_LABEL.GUARDED_CONFIRMATION
					: undefined;
		if (nextLabel === emittedLabel) return;
		emittedLabel = nextLabel;
		if (nextLabel === undefined) events.emit("herdr:blocked", { active: false });
		else events.emit("herdr:blocked", { active: true, label: nextLabel });
	};

	events?.on?.(ASK_USER_CHOICE_BLOCKED_EVENT, (event) => {
		if (!isRecord(event) || typeof event.active !== "boolean" || event.active === choiceActive) return;
		choiceActive = event.active;
		emitEffectiveBlocker();
	});

	events?.on?.("rpiv:ask-user:blocked", (event) => {
		if (!isRecord(event) || typeof event.active !== "boolean" || event.active === questionnaireActive) return;
		questionnaireActive = event.active;
		emitEffectiveBlocker();
	});

	return {
		begin() {
			pending += 1;
			emitEffectiveBlocker();
		},
		settle() {
			if (pending === 0) return;
			pending -= 1;
			emitEffectiveBlocker();
		},
	};
}

async function confirmCommand(
	command: string,
	ctx: ExtensionContext,
	events: ExtensionAPI["events"],
	herdrLifecycle: HerdrConfirmationLifecycle,
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
	const requestId = randomUUID();
	const emitPermissionRequest = (
		state: "waiting" | "approved" | "denied",
	): void => {
		events.emit("pi-permission-system:permission-request", {
			requestId,
			state,
			source: "tool_call",
			message: "Gentle AI safety policy requires confirmation for this tool call.",
			toolName: "bash",
		});
	};
	let approved = false;
	let confirmationFailed = false;
	let confirmationError: unknown;
	emitPermissionRequest("waiting");
	herdrLifecycle.begin();
	try {
		approved = await ctx.ui.confirm("Allow guarded command?", preview);
	} catch (error) {
		confirmationFailed = true;
		confirmationError = error;
	} finally {
		try {
			emitPermissionRequest(confirmationFailed || !approved ? "denied" : "approved");
		} finally {
			herdrLifecycle.settle();
		}
	}
	if (confirmationFailed) throw confirmationError;
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

function readSavedModelConfig(cwd: string): ModelConfigFileResult {
	const projectPath = legacyProjectModelConfigPath(cwd);
	const result = readModelRoutingAuthority(modelConfigPath(cwd), projectPath);
	return result.status === "invalid" && result.path === projectPath
		? { status: "valid", config: {} }
		: result;
}

async function readSavedModelConfigAsync(
	cwd: string,
): Promise<ModelConfigFileResult> {
	const projectPath = legacyProjectModelConfigPath(cwd);
	const result = await readModelRoutingAuthorityAsync(modelConfigPath(cwd), projectPath);
	return result.status === "invalid" && result.path === projectPath
		? { status: "valid", config: {} }
		: result;
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
	applyConfig: typeof applyModelConfigAsync = applyModelConfigAsync,
): Promise<{ updated: number; skipped: number; invalidPath?: string }> {
	const result = await readModelRoutingAuthorityAsync(
		modelConfigPath(ctx.cwd),
		legacyProjectModelConfigPath(ctx.cwd),
	);
	if (result.status === "invalid") {
		return { updated: 0, skipped: 0, invalidPath: result.path };
	}
	return applyConfig(
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
	ANSWER_CONSENT: "answer-consent",
	ADVANCE: "advance",
	ACKNOWLEDGE_APPROVED: "acknowledge-approved",
	STATUS: "status",
	SELECT_INTENDED_UNTRACKED: "select-intended-untracked",
	EXPORT: "export",
	IMPORT: "import",
	INSPECT: "inspect",
	RESET: "reset",
	RECOVER: "recover",
	RECOVER_LOCK: "recover-lock",
	ABANDON: "abandon",
	QUARANTINE_LEGACY: "quarantine-legacy",
	RECONCILE_AUTHORITY: "reconcile-authority",
	REPAIR_LEGACY_ALIAS: "repair-legacy-alias",
	REPAIR: "repair",
} as const;

type ReviewControllerOperation =
	(typeof REVIEW_CONTROLLER_OPERATION)[keyof typeof REVIEW_CONTROLLER_OPERATION];

function reviewToolOperationPath(args: unknown): string {
	const operation = isRecord(args) ? args.operation : undefined;
	if (
		typeof operation !== "string" ||
		!Object.values(REVIEW_CONTROLLER_OPERATION).includes(operation as ReviewControllerOperation)
	) {
		return "review";
	}
	return `review ${operation.replaceAll("-", " ")}`;
}

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
		selectionBinding: { type: "string", description: "Opaque provider-issued pre-lineage intended-untracked selection binding." },
		intendedUntracked: { type: "array", items: { type: "string" }, description: "Repository-relative paths selected from the provider binding." },
		changeName: {
			type: "string",
			description: "Canonical OpenSpec change name required to resolve a recovered authority during lifecycle validate.",
		},
		idempotencyKey: {
			type: "string",
			description: "Required for graph-v1 start and advance operations.",
		},
		transition: {
			type: "string",
			description: "A supported REVIEW_TRANSITION value for advance.",
		},
		input: {
			type: "string",
			description: "A JSON-serialized object string, not a nested object. New native ordinary START uses {\"mode\":\"ordinary\"}; answer-consent uses exactly {\"consentBinding\":\"<opaque id>\",\"answer\":\"granted|declined\"}. Ordinary provider capture belongs only to gentle_review_capture. An explicit baseRef requires committedOnly: true and requests a committed range, while repository-local policyPath remains optional. Legacy controller input remains separate.",
		},
		outputPath: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		inputPath: { type: "string", description: "Repository-local JSON input file for the separate legacy controller flow (alternative to input). Legacy bundle import is retired." },
		operationId: { type: "string", description: "Retired with legacy bundle transport; ignored. Export/import return legacy-operation-retired." },
		lineageIds: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		workspaceRoot: {
			type: "string",
			description: "Optional explicit user-authorized absolute path inside the Git worktree that owns this review. It must resolve to an existing Git worktree; nested paths are canonicalized to that worktree root. Pi never invents this selector. Absent, the session cwd is used unless one unambiguous lineage binding already identifies its target root.",
		},
	},
} as const;

const REVIEW_CAPTURE_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["lineageId", "collectBinding"],
	properties: {
		lineageId: {
			type: "string",
			minLength: 1,
			description: "Exact lineage from the current provider-issued collect transition.",
		},
		collectBinding: {
			type: "string",
			minLength: 1,
			description: "JSON-serialized exact copy of one decoded provider-owned next_transition.collect input from current STATUS.",
		},
		reviewerRunAcknowledged: {
			type: "boolean",
			description: "Required only after the one-slot materialize reviewer forecast; authorizes exactly one Pi host-relay run.",
		},
		correctionLines: {
			type: "integer",
			minimum: 1,
			description: "Positive correction-line plan in diff lines: one replaced source line counts as two (one deletion plus one addition). A different unit from the provider's frozen logical correction budget. Accepted only for the selected provider correction-plan slot and within its exact bounds.",
		},
		workspaceRoot: {
			type: "string",
			description: "Optional explicit existing Git worktree root, resolved with the controller's worktree confinement semantics.",
		},
	},
} as const;

interface ReviewCaptureParameters {
	lineageId: string;
	collectBinding: string;
	reviewerRunAcknowledged?: boolean;
	correctionLines?: number;
	workspaceRoot?: string;
}

const REVIEW_CAPTURE_GROUP_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["lineageId", "collectBindings"],
	properties: {
		lineageId: { type: "string", minLength: 1, description: "Exact lineage from the current provider-issued collect transition." },
		collectBindings: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "Ordered JSON-serialized exact copies of the complete current materialize reviewer collect set." },
		reviewerRunAcknowledged: { type: "boolean", description: "Required after the one group forecast; authorizes exactly the forecast reviewer runs." },
		workspaceRoot: { type: "string", description: "Optional explicit existing Git worktree root, resolved with the controller's worktree confinement semantics." },
	},
} as const;

interface ReviewCaptureGroupParameters {
	lineageId: string;
	collectBindings: readonly string[];
	reviewerRunAcknowledged?: boolean;
	workspaceRoot?: string;
}

const REVIEW_SCOPE_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["manifest", "sha256"],
	properties: {
		manifest: { type: "string", maxLength: 4_096, description: "Exact controller-supplied gzip/base64url frozen changed-scope manifest." },
		sha256: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Exact controller-supplied SHA-256 of the decompressed canonical manifest bytes." },
		cursor: { type: "integer", minimum: 0, description: "Pagination cursor. Start at 0 and continue with nextCursor until absent." },
	},
} as const;

interface ReviewScopeParameters {
	manifest: string;
	sha256: string;
	cursor?: number;
}

interface ReviewControllerParameters {
	operation: ReviewControllerOperation;
	lineageId?: string;
	selectionBinding?: string;
	intendedUntracked?: readonly string[];
	changeName?: string;
	idempotencyKey?: string;
	transition?: string;
	input?: string;
	outputPath?: string;
	inputPath?: string;
	operationId?: string;
	lineageIds?: string;
	acknowledgeUntrustedBundleSource?: string;
	workspaceRoot?: string;
}

type NativeReviewAcknowledgementCli = NativeReviewCli & {
	acknowledgeApproved?: (request: NativeReviewAcknowledgeApprovedRequest) => Promise<NativeReviewAcknowledgeApprovedOutcome | void>;
};

interface ReviewControllerStartInput {
	mode: ReviewMode;
	projection: ReviewProjectionV1;
	policyHash: string;
	evidenceHash: string;
	budget: ReviewBudgetV1;
	parentLineageId?: string;
}

function isReviewControllerOperation(value: string): value is ReviewControllerOperation {
	return Object.values(REVIEW_CONTROLLER_OPERATION).some((operation) => operation === value);
}

function parseReviewControllerParameters(value: unknown): ReviewControllerParameters {
	if (!isRecord(value)) throw new Error("Review controller parameters must be an object");
	if (typeof value.operation !== "string" || !isReviewControllerOperation(value.operation)) {
		throw new Error("Review controller operation is unsupported");
	}
	if (value.operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED) {
		const unexpected = Object.keys(value).find((key) => !["operation", "selectionBinding", "intendedUntracked", "workspaceRoot"].includes(key));
		if (unexpected !== undefined || typeof value.selectionBinding !== "string" || !Array.isArray(value.intendedUntracked) || (value.workspaceRoot !== undefined && typeof value.workspaceRoot !== "string")) throw new Error("Review intended-untracked selection accepts exactly selectionBinding and intendedUntracked, with optional workspaceRoot");
		return { operation: value.operation, selectionBinding: value.selectionBinding, intendedUntracked: value.intendedUntracked, ...(typeof value.workspaceRoot === "string" ? { workspaceRoot: value.workspaceRoot } : {}) };
	}
	const needsLineage = ![REVIEW_CONTROLLER_OPERATION.START, REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT, REVIEW_CONTROLLER_OPERATION.STATUS, REVIEW_CONTROLLER_OPERATION.EXPORT, REVIEW_CONTROLLER_OPERATION.IMPORT, REVIEW_CONTROLLER_OPERATION.INSPECT, REVIEW_CONTROLLER_OPERATION.RESET, REVIEW_CONTROLLER_OPERATION.RECOVER, REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK, REVIEW_CONTROLLER_OPERATION.ABANDON, REVIEW_CONTROLLER_OPERATION.QUARANTINE_LEGACY, REVIEW_CONTROLLER_OPERATION.RECONCILE_AUTHORITY, REVIEW_CONTROLLER_OPERATION.REPAIR_LEGACY_ALIAS, REVIEW_CONTROLLER_OPERATION.REPAIR].includes(value.operation as ReviewControllerOperation);
	if (needsLineage && (typeof value.lineageId !== "string" || value.lineageId.trim().length === 0)) {
		throw new Error("Review controller requires a lineageId");
	}
	const parameters: ReviewControllerParameters = {
		operation: value.operation,
		...(typeof value.lineageId === "string" ? { lineageId: value.lineageId } : {}),
	};
	for (const key of ["changeName", "idempotencyKey", "transition", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource", "workspaceRoot"] as const) {
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

function parseReviewCaptureParameters(value: unknown): ReviewCaptureParameters {
	if (!isRecord(value)) throw new Error("Review capture parameters must be an object");
	const allowed = new Set(["lineageId", "collectBinding", "reviewerRunAcknowledged", "correctionLines", "workspaceRoot"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review capture does not accept ${unexpected}`);
	if (!isCanonicalProcessString(value.lineageId)) throw new Error("Review capture requires an exact non-empty lineageId");
	if (typeof value.collectBinding !== "string" || value.collectBinding.length === 0) throw new Error("Review capture requires a JSON-serialized collectBinding");
	if (value.reviewerRunAcknowledged !== undefined && typeof value.reviewerRunAcknowledged !== "boolean") throw new Error("Review capture reviewerRunAcknowledged must be boolean");
	if (value.correctionLines !== undefined && (!Number.isSafeInteger(value.correctionLines) || value.correctionLines < 1)) throw new Error("Review capture correctionLines must be a positive integer");
	if (value.workspaceRoot !== undefined && typeof value.workspaceRoot !== "string") throw new Error("Review capture workspaceRoot must be a string");
	return {
		lineageId: value.lineageId,
		collectBinding: value.collectBinding,
		...(value.reviewerRunAcknowledged === undefined ? {} : { reviewerRunAcknowledged: value.reviewerRunAcknowledged }),
		...(value.correctionLines === undefined ? {} : { correctionLines: value.correctionLines }),
		...(value.workspaceRoot === undefined ? {} : { workspaceRoot: value.workspaceRoot }),
	};
}

function parseReviewCaptureGroupParameters(value: unknown): ReviewCaptureGroupParameters {
	if (!isRecord(value)) throw new Error("Review capture group parameters must be an object");
	const allowed = new Set(["lineageId", "collectBindings", "reviewerRunAcknowledged", "workspaceRoot"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review capture group does not accept ${unexpected}`);
	if (!isCanonicalProcessString(value.lineageId)) throw new Error("Review capture group requires an exact non-empty lineageId");
	if (!Array.isArray(value.collectBindings) || value.collectBindings.length === 0 || value.collectBindings.some((binding) => typeof binding !== "string" || binding.length === 0)) throw new Error("Review capture group requires one or more JSON-serialized collectBindings");
	if (value.reviewerRunAcknowledged !== undefined && typeof value.reviewerRunAcknowledged !== "boolean") throw new Error("Review capture group reviewerRunAcknowledged must be boolean");
	if (value.workspaceRoot !== undefined && typeof value.workspaceRoot !== "string") throw new Error("Review capture group workspaceRoot must be a string");
	return {
		lineageId: value.lineageId,
		collectBindings: [...value.collectBindings],
		...(value.reviewerRunAcknowledged === undefined ? {} : { reviewerRunAcknowledged: value.reviewerRunAcknowledged }),
		...(value.workspaceRoot === undefined ? {} : { workspaceRoot: value.workspaceRoot }),
	};
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

async function authorizeDestructiveReviewOperation(
	parametersValue: unknown,
	ctx: ExtensionContext,
): Promise<void> {
	const parameters = parseReviewControllerParameters(parametersValue);
	// RESET alone carries the legacy repository-wide challenge. Native compact-v2
	// RECOVER has its own six-field contract and its own derived
	// `gentle-ai.review-recovery-authorization/v1` binding, neither of which the
	// legacy `repositoryId`/`commonDirHash`/`inventoryHash`/`confirmation` quartet
	// can express. Native INSPECT never publishes that quartet either, so
	// demanding it here made the only supported recovery flow unreachable
	// (issue #212).
	// RECOVER authorizes itself in `executeReviewControllerOperation`, the way
	// REPAIR_LEGACY_ALIAS does, because its binding can only be derived from a
	// fresh native target-status read.
	const isReset = parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET;
	const maintenance = nativeMaintenanceOperation(parameters.operation);
	if (!isReset && maintenance === undefined) return;
	const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
	if (maintenance !== undefined && (missingNativeMaintenanceInputs(maintenance, input).length > 0 || invalidNativeMaintenanceInput(maintenance, input))) return;
	if (isReset) {
		for (const key of ["repositoryId", "commonDirHash", "inventoryHash"] as const) {
			if (typeof input[key] !== "string" || input[key].length === 0) throw new Error(`Review controller ${parameters.operation} requires an exact string ${key}`);
		}
		if (typeof input.confirmation !== "string" || input.confirmation.length === 0) throw new Error(`Review controller ${parameters.operation} requires an exact string confirmation`);
	}
	if (!ctx.hasUI) {
		throw new Error(`Review controller ${parameters.operation.toUpperCase()} requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed`);
	}
	const maintenanceAuthorization = maintenance === undefined ? undefined : nativeMaintenanceAuthorization(maintenance, input);
	const approved = await ctx.ui.confirm(
		maintenance !== undefined ? `Authorize review authority ${parameters.operation.toUpperCase()}?` : `Authorize destructive review authority ${parameters.operation.toUpperCase()}?`,
		maintenance !== undefined
			? [`Operation: ${parameters.operation.toUpperCase()}`, "Exact published authorization binding:", maintenanceAuthorization!, maintenance === "abandon" ? "The native command may quarantine only an eligible pristine compact-v2 lineage." : maintenance === "quarantineLegacy" ? "The native command may quarantine only the published malformed freeze-findings legacy diagnostic." : "The native command may quarantine only the bound invalid recovery successor; the predecessor stays untouched."].join("\n")
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

function isReviewTransition(value: string): value is ReviewTransition {
	return Object.values(REVIEW_TRANSITION).some((transition) => transition === value);
}

function isGraphV1JudgmentDayLineage(cwd: string, lineageId: string): boolean {
	try {
		return ReviewTransactionStore.forRepository(cwd).read(lineageId).mode === REVIEW_MODE.JUDGMENT_DAY;
	} catch {
		return false;
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

// Organic-rdd-parity Phase 3 (Design Decision #7): consulted once at the top
// of the ORDINARY START branch, before targetStatus. Dark until the
// negotiated version reports the `mode` capability true — `reviewMode`
// throws VERSION_INCOMPATIBLE in that case, which this treats identically to
// "capability absent" (today's path unchanged), never as a failure. Any
// other error (a real native process failure) still surfaces through the
// caller's existing nativeOperationFailure handling.
const REVIEW_MODE_DISABLED_OUTCOME = "review-mode-disabled";

// Parity with gentle-ai's reviewModeScopeForSource
// (internal/reviewtransaction/rdd_mode.go): the continuation is scoped to the
// source that actually decided, so the operator is not left to work out which
// of the two independent sources they have to change.
//
// A clone-local override can only disable. Pi's explicit clone-scope enable
// clears that override, but cannot enable global RDD: when global is still
// unset or off, clearing it leaves the effective mode off. Tell the operator
// to make the global opt-in first when needed, then clear this clone override.
// Pi never mutates the operator's global gentle-ai state automatically.
//
// The default branch changed with the pinned v2.4.0 runtime, which made
// receipt-driven development opt-in. It used to be unreachable as a reason for
// reviews being off — an all-sources-unset install resolved to ON with source
// `default` — so naming a continuation for it would have been a guess, and
// gentle-ai returned an empty scope to say exactly that. v2.4.0 resolves the
// same install to OFF with source `default`, which makes it the most common
// refusal there is: every install that never opted in. gentle-ai answers
// `global` for it now, not because default is a global opinion but because
// global is the only scope that can turn reviews on at all, and Pi answers the
// same. Leaving this undefined would hand the single most common state a dead
// end.
function reviewModeContinuation(source: NativeReviewModeSource): string | undefined {
	if (source === NATIVE_REVIEW_MODE_SOURCE.CLONE_LOCAL) return "Run `gentle-ai review mode enable --scope=global` if global RDD is still off, then run /gentle:review-mode enable to clear this clone-local override.";
	if (source === NATIVE_REVIEW_MODE_SOURCE.GLOBAL) return "Run `gentle-ai review mode enable --scope=global` to turn reviews back on; /gentle:review-mode enable only clears the clone-local setting, which cannot override a global off.";
	return "Run `gentle-ai review mode enable --scope=global` to opt in; RDD is off by default until explicitly enabled. /gentle:review-mode enable only clears a clone-local override and cannot enable global RDD.";
}

// Names the situation before the mechanism, then the mechanism, mirroring
// gentle-ai's RDDDisabledError.Error(). Pi skips rather than rejects — a
// disabled switch never blocks here — but it must not discard which source
// decided, because that is precisely the information the operator needs and
// the only thing that selects a working way back on.
function nativeReviewModeSkipped(operation: ReviewControllerOperation, source: NativeReviewModeSource): Record<string, unknown> {
	const continuation = reviewModeContinuation(source);
	return {
		operation,
		status: "skipped",
		outcome: REVIEW_MODE_DISABLED_OUTCOME,
		delivery: "disabled/unmanaged",
		mode_source: source,
		reason: `receipt-driven development is disabled: ${operation} is skipped because the ${source} mode source keeps it off`,
		...(continuation === undefined ? {} : { next_action: continuation }),
		...nativeStartPreAuthorityRejection(),
	};
}

async function resolveReviewModeGate(
	nativeReviewCli: NativeReviewCli | null,
	operation: ReviewControllerOperation,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown> | undefined> {
	if (nativeReviewCli?.reviewMode === undefined) return undefined;
	try {
		const mode = await nativeReviewCli.reviewMode({ cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS, ...(signal === undefined ? {} : { signal }) });
		return mode.status.effective === "off" ? nativeReviewModeSkipped(operation, mode.status.source) : undefined;
	} catch (error) {
		if (asNativeReviewCliError(error)?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) return undefined;
		throw error;
	}
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

// Same coexisting-module-instance caveat as asNativeReviewCliError above.
function asNativeReviewConsentBindingError(error: unknown): { reason: string; message: string } | undefined {
	if (error instanceof NativeReviewConsentBindingError) return { reason: error.reason, message: error.message };
	if (!(error instanceof Error) || error.name !== "NativeReviewConsentBindingError") return undefined;
	const reason = (error as unknown as { reason?: unknown }).reason;
	return typeof reason !== "string" || reason.length === 0 ? undefined : { reason, message: error.message };
}

function nativeStatusPackageBinaryMissing(operation: ReviewControllerOperation, diagnostics: NativeReviewProcessDiagnostics): Record<string, unknown> {
	return {
		operation,
		status: "blocked",
		outcome: "native-status-package-binary-missing",
		...(operation === REVIEW_CONTROLLER_OPERATION.START ? nativeStartPreAuthorityRejection() : { lineage_created: false, mutation_performed: false, mutation_outcome: "none" }),
		inventory_complete: false,
		diagnostics,
		next_action: "reinstall-package-local-gentle-ai",
	};
}

function nativeStatusFailed(operation: ReviewControllerOperation, error: unknown): Record<string, unknown> {
	const cliError = asNativeReviewCliError(error);
	if (cliError?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) return nativeStatusUnsupported(operation);
	if (cliError?.code === NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING) return nativeStatusPackageBinaryMissing(operation, cliError.diagnostics);
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

const NATIVE_MAINTENANCE_INPUT = {
	abandon: ["lineage", "expectedRevision", "snapshotIdentity", "actor", "reason"],
	quarantineLegacy: ["repository", "lineage", "expectedRevision", "diagnostic", "disposition", "actor", "reason"],
	reconcileAuthority: ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "expectedSuccessorRevision", "actor", "reason"],
} as const;
type NativeMaintenanceOperation = keyof typeof NATIVE_MAINTENANCE_INPUT;

function nativeMaintenanceOperation(operation: ReviewControllerOperation): NativeMaintenanceOperation | undefined {
	if (operation === REVIEW_CONTROLLER_OPERATION.ABANDON) return "abandon";
	if (operation === REVIEW_CONTROLLER_OPERATION.QUARANTINE_LEGACY) return "quarantineLegacy";
	if (operation === REVIEW_CONTROLLER_OPERATION.RECONCILE_AUTHORITY) return "reconcileAuthority";
	return undefined;
}

function missingNativeMaintenanceInputs(operation: NativeMaintenanceOperation, input: Record<string, unknown>): readonly string[] {
	const missing = NATIVE_MAINTENANCE_INPUT[operation].filter((key) => !isCanonicalProcessString(input[key]));
	if (operation !== "abandon") return missing;
	return [
		...missing,
		...(Array.isArray(input.capturedLensResults) && input.capturedLensResults.every((entry) => isCanonicalProcessString(entry)) ? [] : ["capturedLensResults"]),
		...(typeof input.findingsPresent === "boolean" ? [] : ["findingsPresent"]),
		...(typeof input.evidenceRecordsPresent === "boolean" ? [] : ["evidenceRecordsPresent"]),
	];
}

function invalidNativeMaintenanceInput(operation: NativeMaintenanceOperation, input: Record<string, unknown>): boolean {
	if (operation === "quarantineLegacy") return input.diagnostic !== NATIVE_REVIEW_LEGACY_QUARANTINE.DIAGNOSTIC || input.disposition !== NATIVE_REVIEW_LEGACY_QUARANTINE.DISPOSITION;
	return operation === "reconcileAuthority" && input.anomalies !== undefined && input.anomalies !== NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED;
}

function nativeMaintenanceAuthorization(operation: NativeMaintenanceOperation, input: Record<string, unknown>): string {
	if (operation === "abandon") return nativeReviewAbandonAuthorization({ lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), snapshotIdentity: String(input.snapshotIdentity), capturedLensResults: (input.capturedLensResults as readonly unknown[]).map(String), findingsPresent: input.findingsPresent === true, evidenceRecordsPresent: input.evidenceRecordsPresent === true, actor: String(input.actor), reason: String(input.reason) });
	if (operation === "quarantineLegacy") return nativeReviewLegacyQuarantineAuthorization({ repository: String(input.repository), lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), diagnostic: NATIVE_REVIEW_LEGACY_QUARANTINE.DIAGNOSTIC, disposition: NATIVE_REVIEW_LEGACY_QUARANTINE.DISPOSITION, actor: String(input.actor), reason: String(input.reason) });
	return nativeReviewReconcileAuthorization({ predecessorLineage: String(input.predecessorLineage), expectedPredecessorRevision: String(input.expectedPredecessorRevision), successorLineage: String(input.successorLineage), expectedSuccessorRevision: String(input.expectedSuccessorRevision), actor: String(input.actor), reason: String(input.reason), ...(input.anomalies === undefined ? {} : { anomalies: NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED }) });
}

async function executeNativeAuthorityMaintenance(
	operation: ReviewControllerOperation,
	nativeOperation: NativeMaintenanceOperation,
	input: Record<string, unknown>,
	cwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const method = nativeOperation === "abandon" ? nativeReviewCli?.abandon : nativeOperation === "quarantineLegacy" ? nativeReviewCli?.quarantineLegacy : nativeReviewCli?.reconcileAuthority;
	const nativeCommand = nativeOperation === "quarantineLegacy" ? "review quarantine-legacy" : nativeOperation === "reconcileAuthority" ? "review reconcile-authority" : "review abandon";
	if (method === undefined) {
		return { operation, status: "blocked", outcome: "native-maintenance-unavailable", native_operation: nativeCommand, mutation_performed: false, mutation_outcome: "none", next_action: "install-package-local-gentle-ai-or-run-native-review-cli-directly" };
	}
	const missing = missingNativeMaintenanceInputs(nativeOperation, input);
	if (missing.length > 0) {
		return { operation, status: "blocked", outcome: "native-input-required", native_operation: nativeCommand, missing_input: missing, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-exact-native-maintenance-input" };
	}
	if (invalidNativeMaintenanceInput(nativeOperation, input)) {
		return { operation, status: "blocked", outcome: "native-input-invalid", native_operation: nativeCommand, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-the-exact-published-native-maintenance-binding" };
	}
	try {
		const result = nativeOperation === "abandon"
			? await nativeReviewCli.abandon!({ cwd, lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), snapshotIdentity: String(input.snapshotIdentity), capturedLensResults: (input.capturedLensResults as readonly unknown[]).map(String), findingsPresent: input.findingsPresent === true, evidenceRecordsPresent: input.evidenceRecordsPresent === true, actor: String(input.actor), reason: String(input.reason), maintainerAuthorization: nativeMaintenanceAuthorization(nativeOperation, input), ...(signal === undefined ? {} : { signal }) })
			: nativeOperation === "quarantineLegacy"
				? await nativeReviewCli.quarantineLegacy!({ cwd, repository: String(input.repository), lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), diagnostic: NATIVE_REVIEW_LEGACY_QUARANTINE.DIAGNOSTIC, disposition: NATIVE_REVIEW_LEGACY_QUARANTINE.DISPOSITION, actor: String(input.actor), reason: String(input.reason), maintainerAuthorization: nativeMaintenanceAuthorization(nativeOperation, input), ...(signal === undefined ? {} : { signal }) })
				: await nativeReviewCli.reconcileAuthority!({ cwd, predecessorLineage: String(input.predecessorLineage), expectedPredecessorRevision: String(input.expectedPredecessorRevision), successorLineage: String(input.successorLineage), expectedSuccessorRevision: String(input.expectedSuccessorRevision), actor: String(input.actor), reason: String(input.reason), ...(input.anomalies === undefined ? {} : { anomalies: NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED }), maintainerAuthorization: nativeMaintenanceAuthorization(nativeOperation, input), ...(signal === undefined ? {} : { signal }) });
		return { operation, native_operation: nativeCommand, result: result.record, mutation_performed: true, mutation_outcome: "committed", next_action: "inspect" };
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
}

const NATIVE_LEGACY_ALIAS_REPAIR_INPUT = ["lineage", "actor", "reason"] as const;

async function executeNativeLegacyAliasRepair(
	input: Record<string, unknown>,
	cwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal: AbortSignal | undefined,
	context: ExtensionContext | undefined,
): Promise<Record<string, unknown>> {
	const operation = REVIEW_CONTROLLER_OPERATION.REPAIR_LEGACY_ALIAS;
	const nativeOperation = "review repair-legacy-alias";
	if (Object.keys(input).some((key) => !NATIVE_LEGACY_ALIAS_REPAIR_INPUT.includes(key as (typeof NATIVE_LEGACY_ALIAS_REPAIR_INPUT)[number]))) {
		return { operation, status: "blocked", outcome: "native-input-invalid", native_operation: nativeOperation, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-lineage-actor-and-reason-only" };
	}
	const missing = NATIVE_LEGACY_ALIAS_REPAIR_INPUT.filter((key) => !isCanonicalProcessString(input[key]));
	if (missing.length > 0) {
		return { operation, status: "blocked", outcome: "native-input-required", native_operation: nativeOperation, missing_input: missing, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-lineage-actor-and-reason" };
	}
	if (nativeReviewCli?.reviewStatus === undefined || nativeReviewCli.repairLegacyAlias === undefined) {
		return { operation, status: "blocked", outcome: "native-maintenance-unavailable", native_operation: nativeOperation, mutation_performed: false, mutation_outcome: "none", next_action: "install-package-local-gentle-ai-v2.1.11-or-run-native-review-cli-directly" };
	}
	let inventory;
	try {
		inventory = await nativeReviewCli.reviewStatus({ cwd, ...(signal === undefined ? {} : { signal }) });
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
	const candidate = inventory.complete
		? inventory.entries.filter((entry) =>
			entry.version === "legacy-v1"
			&& entry.status === "invalid"
			&& entry.lineageId === input.lineage
			&& isCanonicalProcessString(entry.revision)
			&& entry.problems.length === 1
			&& entry.problems[0] === NATIVE_REVIEW_LEGACY_ALIAS_REPAIR.DIAGNOSTIC,
		)
		: [];
	if (candidate.length !== 1 || !isCanonicalProcessString(inventory.repository)) {
		return { operation, status: "blocked", outcome: "native-alias-repair-ineligible", native_operation: nativeOperation, mutation_performed: false, mutation_outcome: "none", next_action: "inspect-complete-native-authority-inventory" };
	}
	const entry = candidate[0]!;
	const request = {
		cwd,
		repository: inventory.repository,
		lineage: entry.lineageId!,
		expectedRevision: entry.revision!,
		diagnostic: NATIVE_REVIEW_LEGACY_ALIAS_REPAIR.DIAGNOSTIC,
		disposition: NATIVE_REVIEW_LEGACY_ALIAS_REPAIR.DISPOSITION,
		actor: input.actor as string,
		reason: input.reason as string,
	};
	const authorization = nativeReviewLegacyAliasRepairAuthorization(request);
	if (context?.hasUI !== true) throw new Error("Review controller REPAIR_LEGACY_ALIAS requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed");
	const approved = await context.ui.confirm(
		"Authorize review authority REPAIR_LEGACY_ALIAS?",
		["Operation: REPAIR_LEGACY_ALIAS", "Exact published authorization binding:", authorization, "The native command may quarantine only this fresh, invalid legacy-v1 alias lineage; it never rewrites or validates historical authority."].join("\n"),
	);
	if (!approved) throw new Error("Review controller REPAIR_LEGACY_ALIAS was not explicitly authorized");
	try {
		const result = await nativeReviewCli.repairLegacyAlias({ ...request, maintainerAuthorization: authorization, ...(signal === undefined ? {} : { signal }) });
		return { operation, native_operation: nativeOperation, result: result.record, mutation_performed: true, mutation_outcome: "committed", next_action: "inspect" };
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
}

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
		// Organic-parity passthrough (Design Decision #8, organic-rdd-parity):
		// risk_evidence/hint are rendered verbatim from the native start result,
		// with zero local derivation; both stay absent whenever the negotiated
		// version's capability is dark (every shipped row today).
		...(result.riskEvidence === undefined ? {} : { risk_evidence: result.riskEvidence }),
		...(result.hint === undefined ? {} : { hint: result.hint }),
		...(result.nextTransition === undefined ? {} : { next_transition: result.nextTransition }),
	};
}

function requiredStatusActionText(lineageId?: string): string {
	return `Run target-scoped review.status${lineageId === undefined ? "" : ` for lineage ${lineageId}`} and follow only its declared action.`;
}

// The public collect projection is collectBindings: each provider collect
// input serialized once as the opaque binding gentle_review_capture consumes.
// The raw next_transition.collect.inputs carry the same bytes, so a four-lens
// collect state used to cost about 28k characters per STATUS, INSPECT, or
// START answer and again on every blocked retry (#465). The raw transition
// keeps its kind and reason so the orchestrator still sees the collect state.
function withoutRawCollectInputs(raw: Record<string, unknown>): Record<string, unknown> {
	if (!isRecord(raw.next_transition)) return raw;
	const { collect: _collect, ...transition } = raw.next_transition;
	return { ...raw, next_transition: transition };
}

function mapNativeTargetStatus(operation: ReviewControllerOperation, status: ReviewStatusV3, requestedLineageId?: string): Record<string, unknown> {
	if (
		status.nextTransition?.kind === "collect" &&
		(operation === REVIEW_CONTROLLER_OPERATION.START || operation === REVIEW_CONTROLLER_OPERATION.INSPECT || operation === REVIEW_CONTROLLER_OPERATION.STATUS)
	) {
		const selection = reviewIntendedUntrackedInput(status);
		return {
			operation,
			status: "blocked",
			result: withoutRawCollectInputs(status.raw),
			...(selection === undefined
				? { collectBindings: publicReviewCaptureBindings(status) }
				: { selectionBinding: canonicalReviewCaptureBinding(selection) }),
		};
	}
	if (status.action === "recover") {
		return {
			operation,
			status: "blocked",
			result: status.raw,
			provider_action: "recover",
			recovery_disposition: status.actionDisposition,
			next_action: "recover-with-provider-disposition",
			required_status_action: "Use only the provider-selected recovery disposition; do not substitute scope_changed, invalidated, or escalated.",
		};
	}
	return {
		operation,
		status: status.action === "start" ? "ready" : "blocked",
		result: status.raw,
		...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
	};
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

const NATIVE_START_FOCUS = {
	RISK: "risk",
	RESILIENCE: "resilience",
	READABILITY: "readability",
	RELIABILITY: "reliability",
} as const;
type NativeStartFocus = (typeof NATIVE_START_FOCUS)[keyof typeof NATIVE_START_FOCUS];

function isNativeStartFocus(value: unknown): value is NativeStartFocus {
	return typeof value === "string" && (Object.values(NATIVE_START_FOCUS) as readonly string[]).includes(value);
}

const NATIVE_START_UNTRACKED_SCOPE = {
	EXCLUDE: "exclude",
	SELECT: "select",
} as const;
type NativeStartUntrackedScope = (typeof NATIVE_START_UNTRACKED_SCOPE)[keyof typeof NATIVE_START_UNTRACKED_SCOPE];

interface NativeStartUntrackedSelection {
	untrackedScope?: NativeStartUntrackedScope;
	expectedUntrackedInventory?: string;
	intendedUntracked?: readonly string[];
	reason?: string;
}

interface RetainedNativeUntrackedSelection {
	readonly untrackedScope: NativeStartUntrackedScope;
	readonly expectedUntrackedInventory: string;
	readonly intendedUntracked: readonly string[];
}

interface RetainedNativeCaptureRoute { readonly workspaceRoot: string; readonly lineageId: string; readonly baseRef?: string; readonly committedOnly?: true; }

type RetainedNativeStatusSelection = RetainedNativeUntrackedSelection | RetainedNativeCaptureRoute;

const MAX_RETAINED_NATIVE_STATUS_SELECTIONS = 64;
class NativeCaptureRouteRegistrationError extends Error {}

function isNativeStartUntrackedPath(value: unknown): value is string {
	return isCanonicalProcessString(value)
		&& !isAbsolute(value)
		&& !/^[A-Za-z]:\//.test(value)
		&& !value.includes("\\")
		&& value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validateNativeStartUntrackedSelection(value: Record<string, unknown>): NativeStartUntrackedSelection {
	const declared = "untrackedScope" in value || "expectedUntrackedInventory" in value || "intendedUntracked" in value;
	if (!declared) return {};
	const scope = value.untrackedScope;
	const expectedUntrackedInventory = value.expectedUntrackedInventory;
	const intendedUntracked = value.intendedUntracked;
	if (
		(scope !== NATIVE_START_UNTRACKED_SCOPE.EXCLUDE && scope !== NATIVE_START_UNTRACKED_SCOPE.SELECT) ||
		!isCanonicalProcessString(expectedUntrackedInventory) ||
		(intendedUntracked !== undefined && (!Array.isArray(intendedUntracked) || intendedUntracked.some((path) => !isNativeStartUntrackedPath(path) || intendedUntracked.indexOf(path) !== intendedUntracked.lastIndexOf(path))))
	) return { reason: "untracked-selection-invalid" };
	if (scope === NATIVE_START_UNTRACKED_SCOPE.EXCLUDE && (intendedUntracked?.length ?? 0) > 0) return { reason: "untracked-selection-invalid" };
	if (scope === NATIVE_START_UNTRACKED_SCOPE.SELECT && (intendedUntracked?.length ?? 0) === 0) return { reason: "untracked-selection-invalid" };
	return {
		untrackedScope: scope,
		expectedUntrackedInventory,
		intendedUntracked: intendedUntracked === undefined ? [] : [...intendedUntracked],
	};
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
								: reason === "unknown-field" || reason === "focus-invalid" || reason === "untracked-selection-invalid"
									? "native-start-input-invalid"
									: "native-start-policy-path-invalid",
		reason,
		...(field === undefined ? {} : { field }),
		...nativeStartPreAuthorityRejection(),
	};
}

function nativeStatusInputRejection(reason: string, field?: string): Record<string, unknown> {
	return {
		operation: REVIEW_CONTROLLER_OPERATION.STATUS,
		status: "blocked",
		outcome: "native-status-input-invalid",
		reason,
		...(field === undefined ? {} : { field }),
		mutation_performed: false,
		mutation_outcome: "none",
	};
}

const PENDING_REVIEW_CONSENT_TTL_MS = 10 * 60 * 1000;

type PendingReviewConsentSessionKey = string | symbol;

interface PendingReviewConsent {
	id: string;
	repositoryCwd: string;
	authorityCwd: string;
	candidateView: CandidateView;
	candidateViews: CandidateViewRegistry | null;
	verifyCandidate: () => void;
	cleanupCandidate: () => void;
	untrackedSelection?: RetainedNativeUntrackedSelection;
	consent: ReviewConsentEnvelope;
	consentDigest: string;
	expiresAt: number;
	expiry?: ReturnType<typeof setTimeout>;
}

const PENDING_REVIEW_CONSENT_DISPOSITION = {
	EXPIRED: "expired",
	CONSUMED: "consumed",
} as const;

type PendingReviewConsentDisposition = (typeof PENDING_REVIEW_CONSENT_DISPOSITION)[keyof typeof PENDING_REVIEW_CONSENT_DISPOSITION];

const PENDING_REVIEW_CONSENT_STALE_DISPOSITION_LIMIT = 32;

/**
 * Process-memory-only pending consent partitions. A loaded extension module
 * shares this registry across registrations, while exact Pi session IDs remain
 * the only continuity boundary. It intentionally has no persistence surface.
 */
export class PendingReviewConsentRegistry {
	private readonly sessions = new Map<PendingReviewConsentSessionKey, Map<string, PendingReviewConsent>>();
	private readonly staleDispositions = new Map<PendingReviewConsentSessionKey, Map<string, PendingReviewConsentDisposition>>();

	get(sessionKey: PendingReviewConsentSessionKey): Map<string, PendingReviewConsent> | undefined {
		return this.sessions.get(sessionKey);
	}

	ensure(sessionKey: PendingReviewConsentSessionKey): Map<string, PendingReviewConsent> {
		let pending = this.sessions.get(sessionKey);
		if (pending === undefined) {
			pending = new Map<string, PendingReviewConsent>();
			this.sessions.set(sessionKey, pending);
		}
		return pending;
	}

	private remove(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		const session = this.sessions.get(sessionKey);
		if (session?.get(pending.id) !== pending) return false;
		session.delete(pending.id);
		if (session.size === 0) this.sessions.delete(sessionKey);
		return true;
	}

	private rememberDisposition(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent, disposition: PendingReviewConsentDisposition): void {
		let stale = this.staleDispositions.get(sessionKey);
		if (stale === undefined) {
			stale = new Map<string, PendingReviewConsentDisposition>();
			this.staleDispositions.set(sessionKey, stale);
		}
		stale.delete(pending.id);
		stale.set(pending.id, disposition);
		while (stale.size > PENDING_REVIEW_CONSENT_STALE_DISPOSITION_LIMIT) stale.delete(stale.keys().next().value!);
	}

	consume(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		if (!this.remove(sessionKey, pending)) return false;
		this.rememberDisposition(sessionKey, pending, PENDING_REVIEW_CONSENT_DISPOSITION.CONSUMED);
		return true;
	}

	expire(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		if (!this.remove(sessionKey, pending)) return false;
		this.rememberDisposition(sessionKey, pending, PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED);
		return true;
	}

	discard(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): void {
		this.remove(sessionKey, pending);
	}

	staleDisposition(sessionKey: PendingReviewConsentSessionKey, binding: string): PendingReviewConsentDisposition | undefined {
		return this.staleDispositions.get(sessionKey)?.get(binding);
	}

	take(sessionKey: PendingReviewConsentSessionKey): PendingReviewConsent[] {
		const session = this.sessions.get(sessionKey);
		this.sessions.delete(sessionKey);
		this.staleDispositions.delete(sessionKey);
		return session === undefined ? [] : [...session.values()];
	}
}

const processPendingReviewConsentRegistry = new PendingReviewConsentRegistry();
const processRetainedNativeStatusSelections = new Map<PendingReviewConsentSessionKey, Map<string, RetainedNativeStatusSelection>>();

// gentle-pi#556 / gentle-ai#4051: nesting depth of named-agent (SDD phase
// executor or other subagent) starts vs. ends for a session. Starts and
// ends are paired so a subagent's own loop end never leaves the primary
// loop's `agent_end` preflight suppressed for the rest of the session: a
// named-agent start increments the depth, a matching end decrements it,
// and a fresh primary-loop start resets it to 0.
const processAgentEndSubagentDepth = new Map<PendingReviewConsentSessionKey, number>();

// Target identities already nudged once per session, so the read-only
// `agent_end` preflight reminder fires at most once per unreviewed candidate.
const processAgentEndPreflightNudgedTargets = new Map<PendingReviewConsentSessionKey, Set<string>>();

// gentle-pi#568: the target identity negotiated STATUS reported at
// `session_start`, before this session touched the worktree. A candidate
// already present at that point is the user's own pre-session work, not
// something this session produced, so `agent_end` must not treat it as an
// unreviewed candidate this session should be reminded about.
const processAgentEndSessionBaseline = new Map<PendingReviewConsentSessionKey, string>();

function pendingReviewConsentSessionKey(context: ExtensionContext | undefined, fallbackKey: symbol): PendingReviewConsentSessionKey {
	try {
		const sessionManager = (context as unknown as { sessionManager?: { getSessionId?: () => unknown } } | undefined)?.sessionManager;
		const sessionId = sessionManager?.getSessionId?.();
		if (typeof sessionId === "string") return sessionId;
	} catch { /* Minimal or test contexts use the registration-local fallback. */ }
	return fallbackKey;
}

function consumePendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): boolean {
	if (!registry.consume(sessionKey, pending)) return false;
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	return true;
}

function discardPendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	registry.discard(sessionKey, pending);
}

function expirePendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	if (registry.expire(sessionKey, pending)) pending.cleanupCandidate();
}

function cleanupPendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	discardPendingReviewConsent(pending, registry, sessionKey);
	pending.cleanupCandidate();
}

function cleanupAllPendingReviewConsents(registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	for (const pending of registry.take(sessionKey)) cleanupPendingReviewConsent(pending, registry, sessionKey);
}

// An unused consent binding and the candidate view retained exclusively for
// that binding expire as one lifecycle unit. TTL expiry is observable the
// moment synchronous time says `expiresAt <= now`, so cleanup must be
// synchronous with respect to that observation — the queued cleanup
// macrotask is a safety net, not the authority. Pruning here (before any
// later START may reuse the retained view) keeps timer order from deciding
// correctness: a fresh candidate retry never reuses a view whose binding
// already expired, so it cannot trip `candidate-target-projection-drift`.
function pruneExpiredReviewConsents(registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey, now: () => number): void {
	const pendingReviewConsents = registry.get(sessionKey);
	if (pendingReviewConsents === undefined) return;
	for (const pending of [...pendingReviewConsents.values()]) {
		if (pending.expiresAt <= now()) expirePendingReviewConsent(pending, registry, sessionKey);
	}
}

function reviewConsentDigest(consent: ReviewConsentEnvelope): string {
	return createHash("sha256").update(JSON.stringify(consent)).digest("hex");
}

// gentle-pi#516: a binding this session does not hold (already answered,
// expired, or issued by another Pi session or process) used to fall through
// to the plain negotiated STATUS, which reads exactly like a healthy pre-start
// "ready" and sent the model back into START for a second consent prompt. The
// fact is local and proven before any provider call, so the outcome names the
// binding and the exit; the current STATUS rides along as context only.
const STALE_CONSENT_BINDING_DIAGNOSTIC_CODE = {
	EXPIRED: "consent-binding-expired",
	ALREADY_CONSUMED: "consent-binding-already-consumed",
	UNKNOWN: "consent-binding-unknown",
} as const;

type StaleConsentBindingDiagnosticCode = (typeof STALE_CONSENT_BINDING_DIAGNOSTIC_CODE)[keyof typeof STALE_CONSENT_BINDING_DIAGNOSTIC_CODE];

interface StaleConsentBindingDiagnostics {
	code: StaleConsentBindingDiagnosticCode;
	message: string;
}

function staleConsentBindingDiagnostics(binding: string, disposition: PendingReviewConsentDisposition | undefined): StaleConsentBindingDiagnostics {
	const exit = "Run START again for this candidate to obtain a fresh consent envelope and answer that envelope's binding once; do not resend this binding.";
	if (disposition === PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED) {
		return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.EXPIRED, message: `consent binding ${binding} expired after ${PENDING_REVIEW_CONSENT_TTL_MS / 60_000} minutes without an answer. ${exit}` };
	}
	if (disposition === PENDING_REVIEW_CONSENT_DISPOSITION.CONSUMED) {
		return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.ALREADY_CONSUMED, message: `consent binding ${binding} was already consumed by an earlier answer. ${exit}` };
	}
	return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.UNKNOWN, message: `consent binding ${binding} is not held by this Pi session. ${exit}` };
}

function staleConsentBindingOutcome(operation: ReviewControllerOperation, binding: string, diagnostics: ReturnType<typeof staleConsentBindingDiagnostics>, status: ReviewStatusV3): Record<string, unknown> {
	const mapped = mapNativeTargetStatus(operation, status);
	return {
		...mapped,
		status: "blocked",
		outcome: "consent-binding-stale",
		consent_binding: binding,
		diagnostics,
		native_invocation_attempted: false,
		...nativeStartPreAuthorityRejection(),
		provider_action: status.action,
		...(status.action === "start" ? { next_action: "restart-for-fresh-consent" } : mapped.next_action === undefined ? { next_action: status.action } : {}),
	};
}

function assertNativeStartCandidateBinding(candidateView: CandidateView, target: ReviewStatusV3): void {
	candidateView.verify();
	if (
		target.projection.projection !== "workspace" ||
		target.projection.baseTree !== candidateView.baseTree ||
		target.projection.initialReviewTree !== candidateView.candidateTree ||
		target.projection.currentCandidateTree !== candidateView.candidateTree ||
		JSON.stringify([...target.projection.paths].sort()) !== JSON.stringify([...candidateView.paths].sort()) ||
		(candidateView.intendedUntracked !== undefined && JSON.stringify([...target.projection.intendedUntracked].sort()) !== JSON.stringify([...candidateView.intendedUntracked].sort()))
	) {
		throw new CandidateViewError("native START workspace target does not match the immutable reviewer candidate view", "candidate-target-projection-drift");
	}
}

function completeNativeStart(
	operation: ReviewControllerOperation,
	result: NativeStartResult,
	workspaceRoot: string,
	candidateView: CandidateView | undefined,
	candidateViews: CandidateViewRegistry | null,
): Record<string, unknown> {
	if (candidateView === undefined) return { operation, result: mapNativeStartResult(result), workspace_root: workspaceRoot };
	if (candidateViews && result.lensesRequired) {
		const binding = { token: candidateView.token, lineageId: result.lineageId, selectedLenses: result.selectedLenses };
		if (result.action === "resumed" && !candidateViews.hasCurrentBinding(candidateView.contributorRoot)) candidateViews.restoreCurrentFromNativeStart(binding);
		else candidateViews.bindCurrent(binding);
	} else if (candidateViews && ((result.action === "created" && result.state === "reviewing") || result.action === "resumed")) candidateViews.retain(candidateView.token, result.lineageId);
	else candidateViews?.cleanup(candidateView.token);
	const actorBinding = result.lensesRequired
		? {
			workspace_root: workspaceRoot,
			candidate_root: candidateView.root,
			candidate_tree: candidateView.candidateTree,
			candidate_paths: candidateView.paths,
		}
		: undefined;
	return {
		operation,
		result: mapNativeStartResult(result),
		workspace_root: workspaceRoot,
		...(actorBinding === undefined ? {} : { actor_binding: actorBinding }),
	};
}

function nativeOperationFailure(operation: ReviewControllerOperation | "gentle_review_capture", error: unknown): Record<string, unknown> {
	const value = error as { mutationOutcome?: unknown; nextAction?: unknown; diagnostics?: unknown; auditRecord?: unknown; launchAttempted?: unknown; candidateViewPreNative?: unknown; failureEnvelope?: { raw?: unknown; mutationOutcome?: unknown; replayability?: unknown; nextAction?: unknown } };
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
	// Every consent binding guard runs before the provider is launched, so this
	// is a local mismatch with nothing to reconcile. Reporting it as a native
	// operation failure hides the one fact that makes it fixable.
	const consentBinding = asNativeReviewConsentBindingError(error);
	if (consentBinding !== undefined) {
		return {
			operation,
			status: "blocked",
			outcome: "consent-binding-invalid",
			native_invocation_attempted: false,
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none" as const,
			diagnostics: { code: consentBinding.reason, message: consentBinding.message },
			next_action: "resolve-consent-binding",
		};
	}
	if (error instanceof NativeCaptureRouteRegistrationError) {
		return {
			operation,
			status: "blocked",
			outcome: "capture-route-registration-rejected",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const mutationOutcome = value.mutationOutcome === "unknown" ? "unknown" : "none";
	const nativeCliError = asNativeReviewCliError(error);
	if (nativeCliError?.code === NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING) return nativeStatusPackageBinaryMissing(operation, nativeCliError.diagnostics);
	const nativeDiagnostics = nativeCliError?.diagnostics;
	// A target-status probe verifies `version` before it invokes `review/status`.
	// Preserve either already-sanitized diagnostic on every controller route rather
	// than relabeling an actionable failure as an opaque controller failure.
	const preservesNativeTargetStatusDiagnostic = nativeDiagnostics?.operation === NATIVE_REVIEW_OPERATION.VERSION || nativeDiagnostics?.operation === NATIVE_REVIEW_OPERATION.STATUS;
	const preservesAnswerConsentStartDiagnostic = operation === REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT && nativeDiagnostics?.operation === NATIVE_REVIEW_OPERATION.START;
	const diagnostics = operation === REVIEW_CONTROLLER_OPERATION.START && error instanceof CandidateViewError && value.candidateViewPreNative === true
		? error.diagnostics ?? { code: error.reason, message: "candidate view rejected before native START" }
		: error instanceof CandidateViewError
			? { code: error.reason, message: error.message }
			: nativeDiagnostics?.operation === `review/${operation}` || preservesNativeTargetStatusDiagnostic || preservesAnswerConsentStartDiagnostic
		? nativeDiagnostics
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
		...(isRecord(value.auditRecord) ? { native_audit_record: value.auditRecord } : {}),
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
	target: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0],
	retainedSelections: Map<string, RetainedNativeStatusSelection>,
	preOperationRevision?: string,
	canonicalRetentionRoot = target.cwd,
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
		syncRetainedNativeStatusSelections(retainedSelections, canonicalRetentionRoot, status, target.baseRef);
		const { required_status_action: staleStatusDirective, ...reconciledBase } = failure;
		void staleStatusDirective;
		// Field defect (fambig, 2026-08-16): an envelope-less mutating failure
		// is stamped mutationOutcome "unknown", but a reconciled authority
		// revision identical to the pre-operation revision PROVES the failed
		// call never mutated. Report that proof as mutation_outcome none and
		// claim no replay prohibition for it. Every genuinely ambiguous result
		// — revision moved, no pre-operation revision held, or STATUS
		// unavailable — stays fail-closed exactly as before.
		if (preOperationRevision !== undefined && status.authority?.revision === preOperationRevision) {
			const { replayability: staleReplayability, ...provenBase } = reconciledBase;
			void staleReplayability;
			return {
				...provenBase,
				outcome: "native-mutation-status-reconciled",
				reconciliation: status.raw,
				authority_applicability: status.applicability,
				provider_action: status.action,
				mutation_performed: false,
				mutation_outcome: "none",
				mutation_outcome_reason: `authority revision unchanged across reconciliation (${preOperationRevision}); the failed operation provably did not mutate`,
				next_action: status.action,
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

function reviewWorkspaceGitIdentity(cwd: string): { toplevel: string; commonDir: string } {
	const git = (...arguments_: string[]): string =>
		execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
	const toplevel = realpathSync(git("rev-parse", "--show-toplevel"));
	const commonDir = realpathSync(resolve(cwd, git("rev-parse", "--git-common-dir")));
	return { toplevel, commonDir };
}

/**
 * Resolves the explicit user-authorized workspace target. An explicit path may
 * be nested and may belong to a repository unrelated to the Pi session cwd;
 * Git resolves it to its canonical worktree top-level. The session cwd remains
 * the legacy default only when no target was selected or remembered.
 */
function resolveReviewControllerWorkspaceRoot(
	requested: string | undefined,
	sessionCwd: string,
	candidateViews: CandidateViewRegistry | null,
	lineageId: string | undefined,
): string {
	const remembered = requested === undefined && lineageId !== undefined
		? candidateViews?.resolveWorkspaceRoot(lineageId)
		: undefined;
	const selected = requested ?? remembered ?? sessionCwd;
	if (selected.trim().length === 0 || !isAbsolute(selected)) {
		throw new Error(`Review controller workspaceRoot must be an absolute path to an existing Git worktree root; received ${JSON.stringify(selected)}`);
	}
	let resolved: string;
	try {
		resolved = realpathSync(selected);
		if (!lstatSync(resolved).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(`Review controller workspaceRoot ${selected} is not an existing directory; create or adopt the worktree before binding review operations to it`);
	}
	let target: { toplevel: string; commonDir: string };
	try {
		target = reviewWorkspaceGitIdentity(resolved);
	} catch {
		if (requested === undefined && remembered === undefined) return sessionCwd;
		throw new Error(`Review controller workspaceRoot ${resolved} is not inside a Git worktree; review operations bind only to real worktrees of the session repository`);
	}
	if (lineageId !== undefined) candidateViews?.assertWorkspaceRoot(lineageId, target.toplevel);
	return target.toplevel;
}

function reviewLifecycleStorageKey(workspaceRoot: string, lineageId: string): string {
	return `${workspaceRoot}\u0000${lineageId}`;
}

function reviewCaptureSelectionStorageKey(collectBinding: string): string {
	return `capture\u0000${collectBinding}`;
}

function cloneRetainedNativeUntrackedSelection(selection: NativeStartUntrackedSelection): RetainedNativeUntrackedSelection | undefined {
	if (selection.untrackedScope === undefined || selection.expectedUntrackedInventory === undefined) return undefined;
	return Object.freeze({
		untrackedScope: selection.untrackedScope,
		expectedUntrackedInventory: selection.expectedUntrackedInventory,
		intendedUntracked: Object.freeze([...(selection.intendedUntracked ?? [])]),
	});
}

function retainNativeStatusSelection(selections: Map<string, RetainedNativeStatusSelection>, key: string, selection: RetainedNativeStatusSelection): void {
	if (!selections.has(key)) {
		while (selections.size >= MAX_RETAINED_NATIVE_STATUS_SELECTIONS) {
			const oldestKey = selections.keys().next().value;
			if (oldestKey === undefined) return;
			selections.delete(oldestKey);
		}
	}
	selections.set(key, selection);
}

function retainNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string, selection: RetainedNativeUntrackedSelection | undefined): void {
	if (selection !== undefined) retainNativeStatusSelection(selections, reviewLifecycleStorageKey(workspaceRoot, lineageId), selection);
}

function readRetainedNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string): NativeStartUntrackedSelection {
	const selection = selections.get(reviewLifecycleStorageKey(workspaceRoot, lineageId));
	return selection === undefined || "baseRef" in selection
		? {}
		: {
			untrackedScope: selection.untrackedScope,
			expectedUntrackedInventory: selection.expectedUntrackedInventory,
			intendedUntracked: [...selection.intendedUntracked],
		};
}

function isRetainedNativeCaptureRoute(selection: RetainedNativeStatusSelection | undefined): selection is RetainedNativeCaptureRoute {
	return selection !== undefined && "workspaceRoot" in selection;
}

function retainNativeCaptureRoutes(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, status: ReviewStatusV3, baseRef: string | undefined): void {
	const lineageId = status.authority?.lineageId;
	if (status.applicability !== "current_target" || !isCanonicalProcessString(lineageId) || isTerminalReviewAuthorityState(status.authority?.state)) return;
	const routes = (status.nextTransition?.kind === "collect" ? status.nextTransition.collect?.inputs ?? [] : []).map((input) => ({ key: reviewCaptureSelectionStorageKey(canonicalReviewCaptureBinding(input)), route: Object.freeze({ workspaceRoot, lineageId, ...(baseRef === undefined ? {} : { baseRef, committedOnly: true as const }) }) }));
	for (const { key, route } of routes) {
		const existing = selections.get(key);
		if (isRetainedNativeCaptureRoute(existing) && (existing.workspaceRoot !== route.workspaceRoot || existing.lineageId !== route.lineageId || existing.baseRef !== route.baseRef || existing.committedOnly !== route.committedOnly)) throw new NativeCaptureRouteRegistrationError("Provider collectBinding collides with a different registered route");
	}
	const current = new Set(routes.map(({ key }) => key));
	for (const [key, selection] of selections) if (isRetainedNativeCaptureRoute(selection) && selection.workspaceRoot === workspaceRoot && selection.lineageId === lineageId && !current.has(key)) selections.delete(key);
	for (const { key, route } of routes) if (!selections.has(key)) retainNativeStatusSelection(selections, key, route);
}

function readRetainedNativeCaptureRoute(selections: Map<string, RetainedNativeStatusSelection>, collectBinding: string): RetainedNativeCaptureRoute | undefined {
	const selection = selections.get(reviewCaptureSelectionStorageKey(collectBinding));
	return isRetainedNativeCaptureRoute(selection) ? selection : undefined;
}

function isTerminalReviewAuthorityState(state: string | undefined): boolean { return state === "invalidated" || state === "approved" || state === "escalated"; }

function clearRetainedNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string): void {
	selections.delete(reviewLifecycleStorageKey(workspaceRoot, lineageId));
}

function clearRetainedNativeStatusSelectionsOnTerminal(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string | undefined, state: string | undefined): void {
	if (lineageId === undefined || !isTerminalReviewAuthorityState(state)) return;
	if (state !== "approved") clearRetainedNativeUntrackedSelection(selections, workspaceRoot, lineageId);
	for (const [key, selection] of selections) if (isRetainedNativeCaptureRoute(selection) && selection.workspaceRoot === workspaceRoot && selection.lineageId === lineageId) selections.delete(key);
}

function syncRetainedNativeStatusSelections(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, status: ReviewStatusV3, baseRef: string | undefined): void {
	clearRetainedNativeStatusSelectionsOnTerminal(selections, workspaceRoot, status.authority?.lineageId, status.authority?.state);
	retainNativeCaptureRoutes(selections, workspaceRoot, status, baseRef);
}

function requiresExplicitTargetLifecycleRoot(requested: string | undefined, sessionCwd: string, workspaceRoot: string): boolean {
	return requested !== undefined || workspaceRoot !== sessionCwd;
}

// gentle-pi#311 P4 — the thin Pi host relay. The provider decides which
// capture slots the host satisfies by issuing the --materialize token on a
// pi-bound `review.capture-result` collect input; nothing is ever inferred.
// The runner is injectable for tests only; production always uses the real
// relay in lib/review-host-relay.ts.
let activeReviewHostRelayRunner: ReviewHostRelayRunner = runReviewHostRelaySlot;
let activeReviewHostRelayReviewerGroupRunner = runReviewHostRelayReviewerGroup;
let activeReviewHostRelaySubmissionRunner = submitReviewHostRelayPreparedResult;
function setReviewHostRelayRunnerForTesting(runner?: ReviewHostRelayRunner): void {
	activeReviewHostRelayRunner = runner ?? runReviewHostRelaySlot;
}
function setReviewHostRelayGroupRunnersForTesting(reviewerGroup?: typeof runReviewHostRelayReviewerGroup, submission?: typeof submitReviewHostRelayPreparedResult): void {
	activeReviewHostRelayReviewerGroupRunner = reviewerGroup ?? runReviewHostRelayReviewerGroup;
	activeReviewHostRelaySubmissionRunner = submission ?? submitReviewHostRelayPreparedResult;
}

const REVIEW_HOST_RELAY_RETRY_ACTION =
	"Call fresh STATUS and submit only an exact reoffered one-slot binding; never replay this capture from transcript inference.";

// gentle-pi#522 / #524: gentle-ai refused the submission at admission and
// stated that the lens slot was not consumed. The refused bytes are the
// problem, so the continuation is a fresh reviewer run on the reoffered slot,
// not a replay and not an unknown-outcome reconciliation.
const REVIEW_HOST_RELAY_REFUSED_ACTION =
	"gentle-ai refused this submission at admission and did not consume the lens slot; the reason is in failure.stderr. "
	+ "Call fresh STATUS and run only the exact slot it reoffers so the reviewer produces a new result that satisfies that refusal; never resubmit the refused bytes.";

function reviewHostRelayTimeoutNextAction(error: ReviewHostRelayError): string {
	const measured = error.elapsedMs === null || error.timeoutMs === null
		? ""
		: ` The reviewer was killed after ${error.elapsedMs}ms against a ${error.timeoutMs}ms bound.`;
	return `Do not relaunch this slot unchanged: the same bound kills the same reviewer run again and re-spends the model tokens for nothing.${measured} `
		+ `Change one of two things first: export ${REVIEW_HOST_RELAY_PI_TIMEOUT_ENV}=<milliseconds> above the reviewer's real wall time (hard ceiling ${REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS}), or reduce the candidate scope so the materialized prompt is smaller. `
		+ "Then call fresh STATUS and submit only its exact reoffered slot.";
}

function reviewHostRelayFailureReport(error: ReviewHostRelayError): Record<string, unknown> {
	return {
		kind: error.kind,
		stage: error.stage,
		exit_code: error.exitCode,
		timed_out: error.timedOut,
		...(error.elapsedMs === null ? {} : { elapsed_ms: error.elapsedMs }),
		...(error.timeoutMs === null ? {} : { timeout_ms: error.timeoutMs }),
		// The captured native stderr is the only place the provider's exact
		// refusal reason lives (gentle-pi#524); dropping it hid every admission
		// refusal behind "submission-refused".
		...(error.stderr.length === 0 ? {} : { stderr: error.stderr }),
	};
}

function mapLastEventClosure(
	closure: ReviewLastEventClosureV1,
	binding: ReviewLastEventClosureBinding,
): Record<string, unknown> {
	if (closure.lineageId !== binding.lineageId) throw new CandidateViewError("last-event closure returned a different lineage", "last-event-closure-binding-drift");
	if (binding.targetIdentity !== undefined && closure.targetIdentity !== undefined && closure.targetIdentity !== binding.targetIdentity) {
		throw new CandidateViewError("last-event closure returned a different target", "last-event-closure-binding-drift");
	}
	return {
		tool: "gentle_review_capture",
		status: "closed",
		outcome: "native-last-event-closure",
		closure: {
			schema: closure.schema,
			operation: closure.operation,
			lineage_id: closure.lineageId,
			state: closure.state,
			store_revision: closure.storeRevision,
			...(closure.action === undefined ? {} : { action: closure.action }),
			...(closure.targetIdentity === undefined ? {} : { target_identity: closure.targetIdentity }),
			...(closure.requestHash === undefined ? {} : { request_hash: closure.requestHash }),
			...(closure.correctionLines === undefined ? {} : { correction_lines: closure.correctionLines }),
			...(closure.advisoryFindings === undefined ? {} : { advisory_findings: closure.advisoryFindings }),
			...(closure.statusContinuation === undefined ? {} : { status_continuation: closure.statusContinuation.raw }),
			// The host has to see the acknowledgement to run it: approval now
			// waits for that exact invocation instead of burning on its own, so
			// dropping it here would strand the lineage as approved forever.
			...(closure.acknowledgement === undefined ? {} : { acknowledgement: closure.acknowledgement.raw }),
			// A present-but-unreadable continuation is not the same as none: the
			// host is approved and cannot end it here, and silence would read as
			// nothing left to do.
			...(closure.acknowledgementUndecodable === undefined ? {} : { acknowledgement_undecodable: true }),
		},
		lineage_id: closure.lineageId,
		state: closure.state,
		store_revision: closure.storeRevision,
	};
}

function mapAndClearLastEventClosure(
	closure: ReviewLastEventClosureV1,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	workspaceRoot: string,
): Record<string, unknown> {
	const mapped = mapLastEventClosure(closure, binding);
	clearRetainedNativeStatusSelectionsOnTerminal(selections, workspaceRoot, closure.lineageId, closure.state);
	return mapped;
}

function decodeRelayLastEventClosure(submission: string): ReviewLastEventClosureV1 | undefined {
	let body: unknown;
	try { body = JSON.parse(submission); } catch { throw new CandidateViewError("host relay submission returned malformed JSON", "last-event-closure-decode-failed"); }
	if (typeof body !== "object" || body === null || Array.isArray(body) || (body as { schema?: unknown }).schema !== "gentle-ai.review-last-event-closure/v1") return undefined;
	return decodeReviewLastEventClosureV1(body);
}

async function reconcileUnknownReviewCaptureFailure(
	error: unknown | undefined,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	expectedReviewCaptureSuffix?: readonly string[],
): Promise<Record<string, unknown>> {
	const failure = error === undefined ? undefined : nativeOperationFailure("gentle_review_capture", error);
	if (error !== undefined && !nativeMutationRequiresStatus(error)) return failure;
	try {
		const status = await reconcileUnknownReviewLastEventCapture(nativeReviewCli, cwd, binding, route);
		syncRetainedNativeStatusSelections(selections, cwd, status, route?.baseRef);
		if (expectedReviewCaptureSuffix !== undefined && !hasExactReviewCaptureSuffix(status, expectedReviewCaptureSuffix)) return captureGroupAuthorityDrift(status);
		return {
			tool: "gentle_review_capture",
			status: "reconciled",
			outcome: "native-capture-outcome-unknown",
			...(failure === undefined ? {} : { native_failure: failure }),
			lineage_id: binding.lineageId,
			target_identity: status.targetIdentity,
			provider_action: status.action,
			...(status.nextTransition === undefined ? {} : { next_transition: status.nextTransition }),
			result: status.raw,
		};
	} catch (statusError) {
		const reconciliationFailure = nativeOperationFailure("gentle_review_capture", statusError);
		return { ...(failure ?? reconciliationFailure), outcome: "native-capture-status-reconciliation-failed", reconciliation_failure: reconciliationFailure };
	}
}

async function executeReviewHostRelayCapture(
	slot: ReviewHostRelaySlot,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	try {
		if (slot.submission === undefined) {
			throw new ReviewHostRelayError(
				REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH,
				"binding",
				REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE,
			);
		}
		const result = await activeReviewHostRelayRunner({
			captureArgumentTokens: slot.captureArgumentTokens,
			targetCwd: cwd,
			submission: slot.submission,
			...(signal === undefined ? {} : { signal }),
		});
		const closure = decodeRelayLastEventClosure(result.submission);
		if (closure !== undefined) return mapAndClearLastEventClosure(closure, binding, selections, cwd);
		return {
			tool: "gentle_review_capture",
			status: "captured",
			outcome: "native-reviewer-result-captured",
			lineage_id: binding.lineageId,
			host_relay: {
				transport: "pi_host_relay",
				...(slot.lens === undefined ? {} : { lens: slot.lens }),
				...(slot.order === undefined ? {} : { order: slot.order }),
				...(slot.subjectHash === undefined ? {} : { subject_hash: slot.subjectHash }),
				prompt_bytes: result.promptByteLength,
				result_bytes: result.resultByteLength,
				submission: result.submission,
			},
		};
	} catch (error) {
		if (!(error instanceof ReviewHostRelayError)) return await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route);
		if (error.mutationOutcome === "unknown") {
			return {
				...(await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route)),
				failure: reviewHostRelayFailureReport(error),
				reason: error.message,
			};
		}
		if (error.kind === REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE) {
			return {
				tool: "gentle_review_capture",
				status: "blocked",
				outcome: "pi-host-relay-unavailable",
				reason: REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		if (error.kind === REVIEW_HOST_RELAY_FAILURE.HANDSHAKE_REFUSED) {
			return {
				tool: "gentle_review_capture",
				status: "blocked",
				outcome: "pi-host-relay-handshake-refused",
				reason: error.message,
				refusal: error.stderr,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		return {
			tool: "gentle_review_capture",
			status: "blocked",
			outcome: error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT ? "pi-host-relay-timeout" : "pi-host-relay-transport-failure",
			failure: reviewHostRelayFailureReport(error),
			reason: error.message,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT
				? reviewHostRelayTimeoutNextAction(error)
				: error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED
					? REVIEW_HOST_RELAY_REFUSED_ACTION
					: REVIEW_HOST_RELAY_RETRY_ACTION,
		};
	}
}

const REVIEW_PROVIDER_ROLE_RETRY_ACTION =
	"Call fresh STATUS and execute only the exact one-slot role vector it reoffers; never relaunch from transcript inference.";

async function executeProviderRoleVectorCapture(
	slot: ReviewProviderRoleVectorSlot,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	if (nativeReviewCli.captureProviderRole === undefined) {
		return {
			tool: "gentle_review_capture",
			status: "blocked",
			outcome: "provider-role-capture-unsupported",
			reason: "The provider issued a self-contained role capture vector, but this runtime has no native provider-role capture surface.",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	try {
		const artifact = await nativeReviewCli.captureProviderRole({
			captureOperation: slot.captureOperation,
			argumentTokens: slot.argumentTokens,
			cwd,
			...(signal === undefined ? {} : { signal }),
		});
		if ("operation" in artifact) return mapAndClearLastEventClosure(artifact, binding, selections, cwd);
		return {
			tool: "gentle_review_capture",
			status: "captured",
			outcome: "native-provider-role-captured",
			lineage_id: artifact.lineageId,
			provider_role: {
				transport: "go_owned_pi_process",
				capture_operation: slot.captureOperation,
				role: artifact.role,
				target_identity: artifact.targetIdentity,
				captured: artifact.captured,
			},
		};
	} catch (error) {
		const outcome = await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route);
		return {
			...outcome,
			...(outcome.status === "reconciled" ? {} : { retry_discipline: REVIEW_PROVIDER_ROLE_RETRY_ACTION }),
		};
	}
}

// The provider-named lenses still awaiting a reviewer result: one lens per
// pending `review.capture-result` collect input, in provider order.
function pendingReviewerLenses(status: ReviewStatusV3): readonly string[] {
	if (status.nextTransition?.kind !== "collect") return [];
	return [...new Set((status.nextTransition.collect?.inputs ?? [])
		.filter((input) => input.captureOperation === "review.capture-result")
		.map((input) => input.artifactSubject?.lens)
		.filter((lens): lens is NonNullable<typeof lens> => lens !== undefined))];
}

// Live defect (2026-08-16, Engram #12461): a successor lineage created by
// native `review recover` exists only in native authority — this controller
// never saw its START, so direct reviewer dispatch refused with
// current-binding-missing even though the controller itself had just decoded
// the successor's authoritative STATUS. Mirror the START-time registration
// from STATUS discovery: when an unknown-but-live lineage still collecting
// reviewer results appears in a status this controller decoded, restore its
// frozen projection from the native descriptor and bind the dispatch-facing
// current candidate view with the provider-named pending lenses.
//
// Field report (2026-08-16, gentle-pi 402f9f77): hydration must run from
// EVERY lane that decodes an authoritative status, not from the STATUS
// operation alone — the reported flow was `finalize` (blocked on
// review.capture-result) followed by a reviewer dispatch, which never passed
// through STATUS. It also never fails its caller: STATUS and the blocked
// FINALIZE envelope stay read-only, and the outcome is returned so the caller
// can report it instead of swallowing it.
// Field defect (2026-08-16, third report): the Pi host relay never ran for a
// real lineage. Measured against the live 2.4.0-main provider on a faithful
// reproduction — an agent-less `review status` returns a bare capture-result
// collect input (lineage, expected-revision, target, repository-context, lens,
// order, subject-hash), while the SAME status with `--agent pi` additionally
// carries agent=pi, materialize=true and the provider submission. The adapter
// never named its agent, so reviewHostRelaySlots() saw zero materialize slots,
// the relay was unreachable, and no lens was ever launched.
//
// The agent is PROBED, never assumed. The pinned provider defines `--agent` as
// of v2.4.0 — v2.2.3 did not define it on `review status` at all and refused it
// outright — but Pi still never version-sniffs: the installed binary remains
// the only authority on whether the flag exists. A typed refusal is remembered
// per provider instance and blocks the lifecycle with its exact provider cause;
// Pi never degrades it into an agent-less STATUS fallback.
const REVIEW_HOST_AGENT = "pi" as const;
const REVIEW_TRANSPORT_REFUSAL_CODES = new Set([
	"immutable_review_transport_unsupported",
	"unsupported_agent",
	"unknown_flag",
]);
interface ReviewTransportRefusal { supported: false; code: string; message: string; }
interface NegotiatedHostTransportStatus {
	status?: ReviewStatusV3;
	transport?: ReviewTransportRefusal;
}
const reviewTransportRefusalByProvider = new WeakMap<object, ReviewTransportRefusal>();

function clearReviewTransportProbeForTesting(nativeReviewCli: NativeReviewCli | null): void {
	if (nativeReviewCli !== null) reviewTransportRefusalByProvider.delete(nativeReviewCli as unknown as object);
}

function hostTransportUnavailable(
	operation: ReviewControllerOperation | "gentle_review_capture" | "gentle_review_capture_group",
	transport: ReviewTransportRefusal,
): Record<string, unknown> {
	// #535: a provider-printed raw `gentle-ai review ...` continuation is a dead
	// end in this runtime — Pi is not in the provider's immutable review runtime
	// list, so every CLI-only exit refuses with this same transport code. The
	// refusal therefore names the continuation that runs in this surface (the
	// gentle_review / gentle_review_capture wrapper tools) while the provider's
	// own diagnostic stays intact in relay_transport as evidence.
	const isCapture = operation === "gentle_review_capture" || operation === "gentle_review_capture_group";
	return {
		...(isCapture ? { tool: operation } : { operation }),
		status: "blocked",
		outcome: "pi-host-relay-transport-unavailable",
		reason: `The native provider refused the required pi reviewer transport (${transport.code}): ${transport.message}`,
		relay_transport: transport,
		mutation_performed: false,
		mutation_outcome: "none",
		wrapper_continuation: {
			tool: "gentle_review",
			operation: REVIEW_CONTROLLER_OPERATION.INSPECT,
			...(isCapture ? { then: operation } : {}),
		},
		next_action: `Install a native gentle-ai provider that supports \`review status --agent pi\`, then re-enter negotiated STATUS with gentle_review {"operation":"inspect"}${!isCapture ? " and follow the transition it returns" : operation === "gentle_review_capture_group" ? " and resubmit gentle_review_capture_group with the complete exact ordered collectBindings that fresh STATUS returns" : " and resubmit gentle_review_capture with the exact one-slot collectBinding that fresh STATUS returns"}. A provider-printed raw CLI continuation does not run in this runtime, and Pi never falls back to an agent-less lifecycle route.`,
	};
}

/**
 * Queries negotiated STATUS for the required pi reviewer transport. A typed
 * refusal is cached per provider and returned as unavailable; neither a fresh
 * nor remembered refusal may issue an agent-less lifecycle STATUS request.
 */
async function negotiatedStatusForHostTransport(
	nativeReviewCli: NativeReviewCli,
	request: NativeTargetStatusRequest,
	retainedSelections: Map<string, RetainedNativeStatusSelection>,
	canonicalRetentionRoot = request.cwd,
): Promise<NegotiatedHostTransportStatus> {
	const provider = nativeReviewCli as unknown as object;
	const remembered = reviewTransportRefusalByProvider.get(provider);
	if (remembered !== undefined) return { transport: remembered };
	try {
		const status = await nativeReviewCli.targetStatus!({ ...request, agent: REVIEW_HOST_AGENT });
		syncRetainedNativeStatusSelections(retainedSelections, canonicalRetentionRoot, status, request.baseRef);
		return { status };
	} catch (error) {
		const code = error instanceof NativeReviewIntegrationError ? error.failureEnvelope.code : undefined;
		// Only the closed transport-refusal set is typed unavailable; every
		// other failure remains an error for the caller's normal error path.
		if (code === undefined || !REVIEW_TRANSPORT_REFUSAL_CODES.has(code)) throw error;
		const transport: ReviewTransportRefusal = { supported: false, code, message: error.message };
		reviewTransportRefusalByProvider.set(provider, transport);
		return { transport };
	}
}

// gentle-pi#568: resolves the current negotiated review STATUS for a session,
// under the exact guards `agent_end` uses to decide whether to nudge: a
// native review CLI with both `reviewMode` and `targetStatus`, a UI-bearing
// context, and RDD effectively on. Returns `undefined` on any missing guard,
// an effective-off mode, or any STATUS error or transport refusal, so both
// `session_start` (recording a baseline) and `agent_end` (deciding whether to
// nudge) resolve the same target identity through the same path.
async function resolveNegotiatedReviewStatusForSession(
	nativeReviewCli: NativeReviewCli | null,
	ctx: ExtensionContext,
	sessionKey: PendingReviewConsentSessionKey,
): Promise<ReviewStatusV3 | undefined> {
	if (nativeReviewCli?.reviewMode === undefined || nativeReviewCli.targetStatus === undefined) return undefined;
	if (ctx.hasUI !== true) return undefined;
	let modeEffective: "on" | "off";
	try {
		const mode = await nativeReviewCli.reviewMode({ cwd: ctx.cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS });
		modeEffective = mode.status.effective;
	} catch {
		return undefined;
	}
	if (modeEffective === "off") return undefined;
	try {
		const retainedSelections = ((key: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(key) ?? processRetainedNativeStatusSelections.set(key, new Map()).get(key)!)(sessionKey);
		const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, { cwd: ctx.cwd }, retainedSelections, ctx.cwd);
		return negotiated.status;
	} catch {
		return undefined;
	}
}

// gentle-pi#556 / gentle-ai#4051: the exact once-per-candidate reminder sent
// through `agent_end`. It never runs START itself, so it names the one
// supported continuation (gentle_review inspect) and defers the resulting
// consent envelope to the human.
function renderAgentEndReviewPreflightMessage(targetIdentity: string): string {
	return `Receipt-driven development is enabled, and this worktree holds an unreviewed candidate (target ${targetIdentity}). By the review contract entry rule, run the review preflight before reporting completion.\n\nCall the gentle_review tool with {"operation":"inspect"} and follow the transition it returns; it currently offers review.start for this target. Relay the resulting gentle-ai.review-integration.consent/v3 envelope to the human losslessly, and never answer it on the human's behalf.\n\nThis extension never runs START itself. This reminder is sent once per candidate.`;
}

function canonicalReviewCaptureBinding(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => canonicalReviewCaptureBinding(entry)).join(",")}]`;
	if (!isRecord(value)) throw new Error("Review capture collectBinding must encode a JSON object");
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalReviewCaptureBinding(value[key])}`).join(",")}}`;
}

function parseCanonicalReviewCaptureBinding(input: string): string {
	let binding: unknown;
	try {
		binding = JSON.parse(input);
	} catch (error) {
		throw new Error(`Review capture collectBinding is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(binding)) throw new Error("Review capture collectBinding must encode exactly one collect input object");
	return canonicalReviewCaptureBinding(binding);
}

function exactCollectArgument(input: ReviewCollectInputV3, name: string): string | undefined {
	const matches = input.arguments.filter((argument) => argument.name === name);
	return matches.length === 1 ? matches[0]!.value : undefined;
}

function reviewIntendedUntrackedInput(status: ReviewStatusV3): ReviewCollectInputV3 | undefined {
	if (status.raw.schema !== "gentle-ai.review-integration.status/v6" || status.nextTransition?.kind !== "collect") return undefined;
	const matches = (status.nextTransition.collect?.inputs ?? []).filter((input) => {
		const value = input.submission?.values[0];
		return input.name === "intended_untracked_selection" && input.schema === "gentle-ai.review-intended-untracked-selection/v1" && input.captureOperation === "external.select_intended_untracked" && input.submission?.operationToken === "status" && input.submission.values.length === 1 && value?.slot === "intended_untracked_selection" && value.domain === "schema_bound_json";
	});
	return matches.length === 1 ? matches[0] : undefined;
}

interface PublicReviewCaptureBinding { collectBinding: string; }
function publicReviewCaptureBindings(status: ReviewStatusV3): readonly PublicReviewCaptureBinding[] {
	if (status.nextTransition?.kind !== "collect") return [];
	return (status.nextTransition.collect?.inputs ?? []).filter((input) => input.captureOperation !== "external.select_intended_untracked").map((input) => ({ collectBinding: canonicalReviewCaptureBinding(input) }));
}

function captureBindingRejected(reason: string, group = false): Record<string, unknown> {
	return {
		tool: group ? "gentle_review_capture_group" : "gentle_review_capture",
		status: "blocked",
		outcome: group ? "capture-group-rejected" : "capture-binding-rejected",
		reason,
		mutation_performed: false,
		mutation_outcome: "none",
	};
}

interface SelectedReviewCapture {
	input: ReviewCollectInputV3;
	binding: ReviewLastEventClosureBinding;
}

function selectExactReviewCapture(
	status: ReviewStatusV3,
	lineageId: string,
	canonicalBinding: string,
): SelectedReviewCapture | Record<string, unknown> {
	const statusLineageId = status.authority?.lineageId;
	const statusTargetIdentity = status.targetIdentity;
	if (
		!isCanonicalProcessString(lineageId) ||
		!isCanonicalProcessString(statusLineageId) ||
		!isCanonicalProcessString(statusTargetIdentity) ||
		status.applicability !== "current_target" ||
		statusLineageId !== lineageId
	) {
		return captureBindingRejected("current STATUS does not offer one non-empty matching lineage and target identity");
	}
	if (status.nextTransition?.kind !== "collect") {
		return captureBindingRejected("current STATUS does not offer a collect transition");
	}
	const matches = (status.nextTransition.collect?.inputs ?? []).filter((input) => canonicalReviewCaptureBinding(input) === canonicalBinding);
	if (matches.length !== 1) {
		return captureBindingRejected(matches.length === 0
			? "collectBinding is missing or stale for current STATUS"
			: "collectBinding matches more than one current STATUS input");
	}
	const input = matches[0]!;
	const inputLineageId = exactCollectArgument(input, "lineage");
	const inputTargetIdentity = exactCollectArgument(input, "target");
	// Go's targeted-validator vector binds its capture target to the correction
	// target from the provider-owned validation request, rather than STATUS's
	// current candidate identity. All other captures remain bound to STATUS.
	const expectedInputTargetIdentity = input.validationRequest?.correctionTargetIdentity ?? statusTargetIdentity;
	if (
		!isCanonicalProcessString(inputLineageId) ||
		!isCanonicalProcessString(inputTargetIdentity) ||
		inputLineageId !== lineageId ||
		inputTargetIdentity !== expectedInputTargetIdentity
	) {
		return captureBindingRejected("collectBinding does not carry one non-empty matching provider lineage and target token");
	}
	return {
		input,
		binding: { lineageId, targetIdentity: statusTargetIdentity },
	};
}

function isSelectedReviewCapture(value: SelectedReviewCapture | Record<string, unknown>): value is SelectedReviewCapture {
	return "input" in value && "binding" in value;
}

function captureGroupRejected(reason: string): Record<string, unknown> { return captureBindingRejected(reason, true); }

function hasExactReviewCaptureSuffix(status: ReviewStatusV3, expected: readonly string[]): boolean {
	const current = status.nextTransition?.kind === "collect"
		? (status.nextTransition.collect?.inputs ?? []).filter((input) => input.captureOperation === "review.capture-result").map(canonicalReviewCaptureBinding)
		: [];
	return current.length === expected.length && current.every((binding, index) => binding === expected[index]);
}

function captureGroupAuthorityDrift(status: ReviewStatusV3): Record<string, unknown> {
	return { ...captureGroupRejected("authoritative STATUS does not offer exactly the unsubmitted reviewer suffix"), outcome: "capture-group-authority-drift", reconciliation: status.raw, authority_applicability: status.applicability, provider_action: status.action, next_transition: status.nextTransition };
}

interface SelectedReviewCaptureGroup {
	slots: readonly ReviewHostRelaySlot[];
	binding: ReviewLastEventClosureBinding;
}

function selectExactReviewCaptureGroup(
	status: ReviewStatusV3,
	lineageId: string,
	canonicalBindings: readonly string[],
): SelectedReviewCaptureGroup | Record<string, unknown> {
	const inputs = status.nextTransition?.kind === "collect" ? status.nextTransition.collect?.inputs ?? [] : [];
	const slots = reviewHostRelaySlots(inputs);
	if (inputs.length === 0 || slots.length !== inputs.length) {
		return captureGroupRejected("current STATUS does not offer an exclusively materialize reviewer capture group");
	}
	const currentBindings = inputs.map((input) => canonicalReviewCaptureBinding(input));
	if (new Set(currentBindings).size !== currentBindings.length || canonicalBindings.length !== currentBindings.length || canonicalBindings.some((binding, index) => binding !== currentBindings[index])) {
		return captureGroupRejected("collectBindings must be the complete distinct current reviewer group in exact provider order");
	}
	const first = selectExactReviewCapture(status, lineageId, currentBindings[0]!);
	if (!isSelectedReviewCapture(first)) return captureGroupRejected(String(first.reason ?? "current STATUS rejected a reviewer binding"));
	const expectedRevision = exactCollectArgument(inputs[0]!, "expected-revision");
	const repositoryContext = exactCollectArgument(inputs[0]!, "repository-context");
	const statusTargetIdentity = status.targetIdentity;
	if (!isCanonicalProcessString(expectedRevision) || !isCanonicalProcessString(repositoryContext) || expectedRevision !== status.authority?.revision) {
		return captureGroupRejected("current STATUS does not bind one matching expected revision and repository context for the reviewer group");
	}
	if (status.repositoryContext !== undefined && (status.repositoryContext.handle !== repositoryContext || status.repositoryContext.revision !== expectedRevision || status.repositoryContext.targetIdentity !== statusTargetIdentity)) {
		return captureGroupRejected("current STATUS repository context does not match the reviewer group binding");
	}
	const lenses = new Set<string>(), orders = new Set<string>(), subjectHashes = new Set<string>();
	for (let index = 0; index < inputs.length; index += 1) {
		const input = inputs[index]!, slot = slots[index]!, subject = input.artifactSubject;
		const slotLineage = exactCollectArgument(input, "lineage"), target = exactCollectArgument(input, "target");
		const revision = exactCollectArgument(input, "expected-revision"), context = exactCollectArgument(input, "repository-context");
		const subjectHash = exactCollectArgument(input, "subject-hash"), order = slot.order, lens = slot.lens;
		if (
			subject === undefined || slot.submission === undefined || slotLineage !== lineageId || target !== statusTargetIdentity
			|| revision !== expectedRevision || context !== repositoryContext || subjectHash !== subject.subjectHash || order === undefined || lens === undefined
			|| subject.lineageId !== lineageId || subject.authorityRevision !== expectedRevision || subject.targetIdentity !== statusTargetIdentity
			|| lens.slice(7) !== subject.lens || String(subject.selectedOrder) !== order
		) return captureGroupRejected("current STATUS carries an incomplete or mismatched materialize reviewer binding");
		try { resolveReviewHostRelaySubmission(slot.submission); } catch { return captureGroupRejected("current STATUS carries an invalid provider reviewer submission descriptor"); }
		const value = slot.submission.values[0];
		if (slot.submission.operationToken !== "capture-result" || value?.slot !== "reviewer_result" || value.domain !== "artifact_path_or_stdin" || lenses.has(lens) || orders.has(order) || subjectHashes.has(subject.subjectHash)) {
			return captureGroupRejected("current STATUS carries duplicate or invalid reviewer slot identities");
		}
		lenses.add(lens); orders.add(order); subjectHashes.add(subject.subjectHash);
	}
	return { slots, binding: first.binding };
}

function reviewHostRelayGroupFailure(
	error: ReviewHostRelayError,
	slots: readonly ReviewHostRelaySlot[],
	prepared: readonly ReviewHostRelayPreparedResult[],
	submitted: number,
): Record<string, unknown> {
	return {
		tool: "gentle_review_capture_group",
		status: "blocked",
		outcome: error.kind === REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE ? "pi-host-relay-unavailable" : error.kind === REVIEW_HOST_RELAY_FAILURE.HANDSHAKE_REFUSED ? "pi-host-relay-handshake-refused" : error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT ? "pi-host-relay-timeout" : "pi-host-relay-transport-failure",
		reason: error.message,
		failure: reviewHostRelayFailureReport(error),
		...reviewHostRelayGroupProgress(slots, prepared, submitted),
		next_action: error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED ? REVIEW_HOST_RELAY_REFUSED_ACTION : REVIEW_HOST_RELAY_RETRY_ACTION,
	};
}

async function executeReviewCaptureOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	requireRegisteredRoute = false,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewCaptureParameters(parametersValue);
	if (nativeReviewCli === null || nativeReviewCli.targetStatus === undefined) {
		return {
			tool: "gentle_review_capture",
			status: "blocked",
			outcome: "native-status-unsupported",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const canonicalBinding = parseCanonicalReviewCaptureBinding(parameters.collectBinding);
	const cwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const route = readRetainedNativeCaptureRoute(retainedUntrackedSelections, canonicalBinding);
	if (requireRegisteredRoute && (route === undefined || route.workspaceRoot !== cwd || route.lineageId !== parameters.lineageId)) {
		return captureBindingRejected("collectBinding is unknown, expired, or belongs to a different session route");
	}
	let status: ReviewStatusV3;
	try {
		const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
			cwd,
			lineageId: parameters.lineageId,
			...(route?.baseRef === undefined ? {} : { baseRef: route.baseRef, committedOnly: true }),
			...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, cwd, parameters.lineageId),
			...(signal === undefined ? {} : { signal }),
		}, retainedUntrackedSelections, cwd);
		if (negotiated.transport !== undefined) return hostTransportUnavailable("gentle_review_capture", negotiated.transport);
		status = negotiated.status!;
	} catch (error) {
		return nativeOperationFailure("gentle_review_capture", error);
	}
	const selected = selectExactReviewCapture(status, parameters.lineageId, canonicalBinding);
	if (!isSelectedReviewCapture(selected)) return selected;

	// During correction the flow carries both the original authority target
	// identity and a distinct provider-issued correction target identity
	// (gentle-pi#535 row 15). Echo the correction one on the capture result so
	// the caller never reconstructs which is which from the opaque binding.
	const correctionTargetIdentity = selected.input.validationRequest?.correctionTargetIdentity ?? selected.input.artifactSubject?.correctionTargetIdentity;
	const withCorrectionTarget = (result: Record<string, unknown>): Record<string, unknown> =>
		correctionTargetIdentity === undefined ? result : { ...result, correction_target_identity: correctionTargetIdentity };

	const hostRelaySlots = reviewHostRelaySlots([selected.input]);
	if (hostRelaySlots.length === 1) {
		if (parameters.correctionLines !== undefined) return captureBindingRejected("correctionLines is valid only for a correction-plan capture");
		if (parameters.reviewerRunAcknowledged !== true) {
			return {
				tool: "gentle_review_capture",
				status: "blocked",
				outcome: "reviewer-model-run-forecast",
				cost_forecast: {
					transport: "pi_host_relay",
					model_runs: 1,
					lenses: hostRelaySlots[0]!.lens === undefined ? [] : [hostRelaySlots[0]!.lens],
				},
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		return withCorrectionTarget(await executeReviewHostRelayCapture(hostRelaySlots[0]!, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route, signal));
	}

	if (selected.input.captureOperation === "review.capture-correction-plan") {
		if (parameters.reviewerRunAcknowledged !== undefined) return captureBindingRejected("reviewerRunAcknowledged is valid only for a materialize reviewer capture");
		const submission = selected.input.submission;
		const value = submission?.values.length === 1 ? submission.values[0] : undefined;
		if (submission === undefined || value?.slot !== "correction_lines") return captureBindingRejected("provider correction-plan capture omitted its exact correction-lines binding");
		if (parameters.correctionLines === undefined) {
			return {
				tool: "gentle_review_capture",
				status: "blocked",
				outcome: "correction-lines-required",
				minimum: value.minimum ?? 1,
				maximum: value.maximum ?? 200,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		if ((value.minimum !== undefined && parameters.correctionLines < value.minimum) || (value.maximum !== undefined && parameters.correctionLines > value.maximum)) {
			return captureBindingRejected("correctionLines is outside the exact provider-issued correction-plan bounds");
		}
		if (nativeReviewCli.captureCorrectionPlan === undefined) return captureBindingRejected("native correction-plan capture is unavailable");
		try {
			const closure = await nativeReviewCli.captureCorrectionPlan({
				argumentTokens: submission.argumentTokens,
				correctionLines: parameters.correctionLines,
				cwd,
				...(signal === undefined ? {} : { signal }),
			});
			return withCorrectionTarget(mapAndClearLastEventClosure(closure, selected.binding, retainedUntrackedSelections, cwd));
		} catch (error) {
			return await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route);
		}
	}

	const providerRoleSlots = reviewProviderRoleVectorSlots([selected.input]);
	if (providerRoleSlots.length === 1) {
		if (parameters.reviewerRunAcknowledged !== undefined || parameters.correctionLines !== undefined) {
			return captureBindingRejected("reviewerRunAcknowledged and correctionLines are not valid for a provider role capture");
		}
		return withCorrectionTarget(await executeProviderRoleVectorCapture(providerRoleSlots[0]!, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route, signal));
	}
	return captureBindingRejected(`unsupported provider capture operation: ${selected.input.captureOperation}`);
}

function reviewHostRelayGroupDiagnostics(slots: readonly ReviewHostRelaySlot[], prepared: readonly ReviewHostRelayPreparedResult[], count: number): readonly Record<string, unknown>[] {
	return slots.slice(0, count).map((slot, index) => ({
		...(slot.lens === undefined ? {} : { lens: slot.lens }),
		...(slot.order === undefined ? {} : { order: slot.order }),
		...(slot.subjectHash === undefined ? {} : { subject_hash: slot.subjectHash }),
		prompt_bytes: prepared[index]?.promptByteLength,
		result_bytes: prepared[index]?.resultByteLength,
	}));
}

function reviewHostRelayGroupProgress(
	slots: readonly ReviewHostRelaySlot[],
	prepared: readonly ReviewHostRelayPreparedResult[],
	submitted: number,
	uncertain = false,
): Record<string, unknown> {
	const outcome = submitted === 0 ? uncertain ? "unknown" : "none" : uncertain ? "partial_unknown" : submitted === slots.length ? "completed" : "partial";
	return {
		prepared_reviewers: prepared.length,
		submitted_reviewers: submitted,
		host_relay: { transport: "pi_host_relay", reviewers: reviewHostRelayGroupDiagnostics(slots, prepared, submitted) },
		...(submitted === 0 && uncertain ? { mutation_outcome: outcome } : { mutation_performed: submitted > 0, mutation_outcome: outcome }),
	};
}

async function executeReviewCaptureGroupOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	requireRegisteredRoute = false,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewCaptureGroupParameters(parametersValue);
	if (nativeReviewCli === null || nativeReviewCli.targetStatus === undefined) return { ...captureGroupRejected("native target STATUS is unavailable"), outcome: "native-status-unsupported" };
	const canonicalBindings = parameters.collectBindings.map((binding) => parseCanonicalReviewCaptureBinding(binding));
	const cwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const routes = canonicalBindings.map((binding) => readRetainedNativeCaptureRoute(retainedUntrackedSelections, binding));
	const route = routes[0];
	if (requireRegisteredRoute && (route === undefined || routes.some((candidate) => candidate === undefined || candidate.workspaceRoot !== cwd || candidate.lineageId !== parameters.lineageId || candidate.baseRef !== route.baseRef))) {
		return captureGroupRejected("collectBindings are unknown, expired, or belong to different session routes");
	}
	const freshStatus = () => negotiatedStatusForHostTransport(nativeReviewCli, {
		cwd, lineageId: parameters.lineageId,
		...(route?.baseRef === undefined ? {} : { baseRef: route.baseRef, committedOnly: true }),
		...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, cwd, parameters.lineageId),
		...(signal === undefined ? {} : { signal }),
	}, retainedUntrackedSelections, cwd);
	let status: ReviewStatusV3;
	try {
		const negotiated = await freshStatus();
		if (negotiated.transport !== undefined) return hostTransportUnavailable("gentle_review_capture_group", negotiated.transport);
		status = negotiated.status!;
	} catch (error) {
		return { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "native-status-failed" };
	}
	const group = selectExactReviewCaptureGroup(status, parameters.lineageId, canonicalBindings);
	if (!("slots" in group && "binding" in group)) return group;
	if (parameters.reviewerRunAcknowledged !== true) {
		return {
			tool: "gentle_review_capture_group",
			status: "blocked",
			outcome: "reviewer-model-run-forecast",
			cost_forecast: { transport: "pi_host_relay", model_runs: group.slots.length, lenses: group.slots.map((slot) => slot.lens).filter((lens): lens is string => lens !== undefined) },
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const requests: readonly ReviewHostRelayRequest[] = group.slots.map((slot) => ({
		captureArgumentTokens: slot.captureArgumentTokens,
		targetCwd: cwd,
		submission: slot.submission!,
		...(signal === undefined ? {} : { signal }),
	}));
	let prepared: readonly ReviewHostRelayPreparedResult[];
	try {
		prepared = await activeReviewHostRelayReviewerGroupRunner(requests);
		if (prepared.length !== requests.length) throw new Error("Pi host relay reviewer group returned a different number of prepared results");
	} catch (error) {
		return error instanceof ReviewHostRelayError
			? reviewHostRelayGroupFailure(error, group.slots, [], 0)
			: { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "pi-host-relay-reviewer-group-failed" };
	}
	for (let index = 0; index < prepared.length; index += 1) {
		let current: SelectedReviewCapture | Record<string, unknown>;
		try {
			const negotiated = await freshStatus();
			if (negotiated.transport !== undefined) return { ...hostTransportUnavailable("gentle_review_capture_group", negotiated.transport), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
			if (!hasExactReviewCaptureSuffix(negotiated.status!, canonicalBindings.slice(index))) return { ...captureGroupAuthorityDrift(negotiated.status!), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
			current = selectExactReviewCapture(negotiated.status!, parameters.lineageId, canonicalBindings[index]!);
		} catch (error) {
			return { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "native-status-failed", ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
		}
		if (!isSelectedReviewCapture(current)) return { ...captureGroupRejected(String(current.reason ?? "current STATUS rejected a reviewer binding")), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
		try {
			const result = await activeReviewHostRelaySubmissionRunner(prepared[index]!);
			const closure = decodeRelayLastEventClosure(result.submission);
			if (closure !== undefined) {
				const closed = mapAndClearLastEventClosure(closure, current.binding, retainedUntrackedSelections, cwd);
				return { ...closed, tool: "gentle_review_capture_group", ...reviewHostRelayGroupProgress(group.slots, prepared, index + 1) };
			}
		} catch (error) {
			if (error instanceof ReviewHostRelayError && error.mutationOutcome !== "unknown") return reviewHostRelayGroupFailure(error, group.slots, prepared, index);
			const reconciled = await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, current.binding, retainedUntrackedSelections, route);
			return { ...reconciled, tool: "gentle_review_capture_group", ...reviewHostRelayGroupProgress(group.slots, prepared, index, true), ...(error instanceof ReviewHostRelayError ? { failure: reviewHostRelayFailureReport(error), reason: error.message } : {}) };
		}
	}
	const reconciled = await reconcileUnknownReviewCaptureFailure(undefined, nativeReviewCli, cwd, group.binding, retainedUntrackedSelections, route, canonicalBindings.slice(prepared.length));
	return { ...reconciled, tool: "gentle_review_capture_group", outcome: reconciled.outcome === "capture-group-authority-drift" ? reconciled.outcome : reconciled.status === "reconciled" ? "native-reviewer-group-status-reconciled" : "native-reviewer-group-status-reconciliation-failed", ...reviewHostRelayGroupProgress(group.slots, prepared, prepared.length) };
}

type DispatchHydrationOutcome =
	| { hydrated: true; lineage_id: string; lenses: readonly string[] }
	| { hydrated: false; lineage_id: string; reason: string; message: string }
	| undefined;

function hydrateDispatchBindingFromStatus(candidateViews: CandidateViewRegistry | null, contributorRoot: string, status: ReviewStatusV3): DispatchHydrationOutcome {
	if (candidateViews === null || candidateViews.hasCurrentBinding(contributorRoot)) return undefined;
	const lineageId = status.authority?.lineageId;
	if (lineageId === undefined || status.applicability !== "current_target" || candidateViews.hasProjection(lineageId, contributorRoot)) return undefined;
	const lenses = pendingReviewerLenses(status);
	if (lenses.length === 0) return undefined;
	try {
		candidateViews.restoreCurrentForDispatchFromNative(lineageId, contributorRoot, status.projection, lenses);
		return { hydrated: true, lineage_id: lineageId, lenses };
	} catch (error) {
		// Never fail the caller on hydration; the registry records the typed
		// cause so the later dispatch refusal names the attempt instead of
		// claiming no binding was ever available.
		return {
			hydrated: false,
			lineage_id: lineageId,
			reason: error instanceof CandidateViewError ? error.reason : "candidate-view-invalid",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function executeReviewControllerOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	context?: ExtensionContext,
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	pendingReviewConsentRegistry: PendingReviewConsentRegistry = processPendingReviewConsentRegistry,
	pendingReviewConsentFallbackKey: symbol = Symbol("pending-review-consent-fallback"),
	writeReviewConsentLatch: typeof recordReviewConsentLatch = recordReviewConsentLatch,
	reviewConsentNow: () => number = Date.now,
	reviewConsentScheduleTimer: (callback: () => void, delayMs: number) => { unref: () => void } = setTimeout,
	intendedUntrackedSelection?: NativeIntendedUntrackedSelectionSubmission,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewControllerParameters(parametersValue);
	const defaultCwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const pendingReviewConsentSession = pendingReviewConsentSessionKey(context, pendingReviewConsentFallbackKey);
	const useTargetLifecycleRoot = requiresExplicitTargetLifecycleRoot(parameters.workspaceRoot, sessionCwd, defaultCwd);
	const includeWorkspaceRoot = parameters.workspaceRoot !== undefined || defaultCwd !== sessionCwd;
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.EXPORT || parameters.operation === REVIEW_CONTROLLER_OPERATION.IMPORT) {
		// Legacy bundle transport rode on the retired pre-integration graph/compact
		// stores. The native v2.1.11 CLI exposes no bundle equivalent, so both
		// operations return a structured retirement envelope; the enum members are
		// kept so the tool schema stays stable for existing callers.
		return {
			operation: parameters.operation,
			status: "blocked",
			outcome: "legacy-operation-retired",
			reason: "Legacy review bundle transport (export/import) was retired together with the pre-integration graph/compact stores; gentle-ai v2.1.11 exposes no native bundle equivalent.",
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "Use the native `gentle-ai review` CLI (start/finalize/validate/status/recover) against the repository review authority; receipts and canonical artifacts live in the Git common-directory store at .git/gentle-ai/reviews and travel with the repository through normal Git replication.",
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.REPAIR_LEGACY_ALIAS) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeLegacyAliasRepair(input, defaultCwd, nativeReviewCli, signal, context);
	}
	const maintenance = nativeMaintenanceOperation(parameters.operation);
	if (maintenance !== undefined) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeAuthorityMaintenance(parameters.operation, maintenance, input, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT && nativeReviewCli !== null) {
		try {
			if (nativeReviewCli.targetStatus !== undefined) {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, negotiated.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				return { ...mapNativeTargetStatus(parameters.operation, negotiated.status!, undefined, defaultCwd), ...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}) };
			}
			return nativeStatusUnsupported(parameters.operation);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT) {
		return nativeStatusUnsupported(parameters.operation);
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
		// The authorization binding is Pi-derived, never caller-carried. It is
		// recorded verbatim as a maintainer attestation, so accepting one the
		// caller composed would let an unapproved actor sign the recovery edge.
		if (input.maintainerAuthorization !== undefined) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-recovery-caller-authorization-rejected",
				native_operation: "review recover",
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "resubmit-without-maintainer-authorization",
			};
		}
		const missing = NATIVE_RECOVERY_INPUT.recover.filter((key) =>
			key === "disposition"
				? !["scope_changed", "invalidated", "escalated"].includes(input[key] as string)
				: !isCanonicalProcessString(input[key]),
		);
		if (missing.length > 0) return await executeNativeRecoveryRoute(parameters.operation, "recover", input, defaultCwd, nativeReviewCli, signal);
		if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		const frozenTarget = candidateViews?.hasProjection(String(input.predecessorLineage), defaultCwd)
			? candidateViews.resolveProjection(String(input.predecessorLineage), defaultCwd)
			: undefined;
		const statusRequest = {
			cwd: defaultCwd,
			lineageId: String(input.predecessorLineage),
			...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}),
			...(signal === undefined ? {} : { signal }),
		};
		let status: ReviewStatusV3;
		try {
			status = await nativeReviewCli.targetStatus(statusRequest);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		const pinnedRecoveryStatus = (candidate: ReviewStatusV3): boolean =>
			candidate.action === "recover"
			&& candidate.actionDisposition === status.actionDisposition
			&& candidate.authority?.lineageId === input.predecessorLineage
			&& candidate.authority?.revision === input.expectedPredecessorRevision
			&& candidate.targetIdentity === status.targetIdentity;
		if (status.action !== "recover" || status.actionDisposition === undefined || status.authority?.lineageId !== input.predecessorLineage || status.authority.revision !== input.expectedPredecessorRevision || !isCanonicalProcessString(status.targetIdentity)) {
			return { operation: parameters.operation, status: "blocked", outcome: "native-recovery-status-mismatch", mutation_performed: false, mutation_outcome: "none", result: status.raw, next_action: "follow-provider-target-status" };
		}
		if (input.disposition !== status.actionDisposition) {
			return { operation: parameters.operation, status: "blocked", outcome: "native-recovery-disposition-mismatch", mutation_performed: false, mutation_outcome: "none", provider_disposition: status.actionDisposition, next_action: "resubmit-with-provider-disposition" };
		}
		const recoverAuthorization = nativeReviewRecoverAuthorization({
			predecessorLineage: String(input.predecessorLineage),
			expectedPredecessorRevision: String(input.expectedPredecessorRevision),
			targetIdentity: status.targetIdentity,
			actor: String(input.actor),
			reason: String(input.reason),
		});
		if (context?.hasUI !== true) throw new Error("Review controller RECOVER requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed");
		const approved = await context.ui.confirm(
			"Authorize destructive review authority RECOVER?",
			[
				"Operation: RECOVER",
				`Provider-selected disposition: ${status.actionDisposition}`,
				"Exact published authorization binding:",
				recoverAuthorization,
				`The native command creates one auditable successor authority (${String(input.successorLineage)}) for this exact predecessor and target identity; the predecessor stays untouched.`,
			].join("\n"),
		);
		if (!approved) throw new Error("Review controller RECOVER was not explicitly authorized");
		// Time-of-check to time-of-use: the human deliberates for an unbounded
		// interval, and the authority can advance, be recovered by someone else, or
		// stop being recovery-eligible while they do. The approval and the derived
		// binding are pinned to the pre-approval read, so the authority is read once
		// more and must still match it exactly before anything mutates.
		let confirmedStatus: ReviewStatusV3;
		try {
			confirmedStatus = await nativeReviewCli.targetStatus(statusRequest);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		if (!pinnedRecoveryStatus(confirmedStatus)) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-recovery-authority-changed",
				native_operation: "review recover",
				mutation_performed: false,
				mutation_outcome: "none",
				result: confirmedStatus.raw,
				next_action: "reinspect-and-reauthorize-recovery",
			};
		}
		return await executeNativeRecoveryRoute(parameters.operation, "recover", { ...input, disposition: status.actionDisposition, maintainerAuthorization: recoverAuthorization }, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeRecoveryRoute(parameters.operation, "reclaim", input, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.REPAIR) {
		if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		const frozenTarget = parameters.lineageId === undefined || !candidateViews?.hasProjection(parameters.lineageId, defaultCwd) ? undefined : candidateViews.resolveProjection(parameters.lineageId, defaultCwd);
		let status: ReviewStatusV3;
		try {
			status = await nativeReviewCli.targetStatus({ cwd: defaultCwd, ...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }), ...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}), ...(signal === undefined ? {} : { signal }) });
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		clearRetainedNativeStatusSelectionsOnTerminal(retainedUntrackedSelections, defaultCwd, status.authority?.lineageId, status.authority?.state); retainNativeCaptureRoutes(retainedUntrackedSelections, defaultCwd, status, frozenTarget?.committedOnly === true ? frozenTarget.baseCommit : undefined);
		if (status.authority?.version === "compact-v2") return { operation: parameters.operation, repaired: false, compact_authority: "immutable-untouched", status: mapNativeTargetStatus(parameters.operation, status, parameters.lineageId) };
		if (status.authority?.version !== "legacy-v1") return mapNativeTargetStatus(parameters.operation, status, parameters.lineageId);
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		store.repairCurrentAuthority();
		return { operation: parameters.operation, repaired: true };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ACKNOWLEDGE_APPROVED) {
		const controllerOnlyInput = ["changeName", "idempotencyKey", "transition", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource"]
			.find((key) => parameters[key as keyof ReviewControllerParameters] !== undefined);
		if (controllerOnlyInput !== undefined || !isCanonicalProcessString(parameters.lineageId)) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-input-invalid",
				reason: controllerOnlyInput === undefined ? "lineage-invalid" : "controller-only-input",
				...(controllerOnlyInput === undefined ? {} : { field: controllerOnlyInput }),
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "resubmit-the-exact-lineage-without-controller-only-input",
			};
		}
		const acknowledgementCli = nativeReviewCli as NativeReviewAcknowledgementCli | null;
		if (acknowledgementCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		if (acknowledgementCli.acknowledgeApproved === undefined) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-unsupported",
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "install-native-acknowledge-approved-support",
			};
		}
		const frozenTarget = candidateViews?.hasProjection(parameters.lineageId, defaultCwd)
			? candidateViews.resolveProjection(parameters.lineageId, defaultCwd)
			: undefined;
		const target = {
			cwd: defaultCwd,
			lineageId: parameters.lineageId,
			...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}),
			...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId),
			...(signal === undefined ? {} : { signal }),
		};
		let status: ReviewStatusV3;
		try {
			status = await acknowledgementCli.targetStatus(target);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		const execute = status.nextTransition?.kind === "execute" ? status.nextTransition.execute : undefined;
		if (
			status.applicability !== "current_target" ||
			status.authority?.lineageId !== parameters.lineageId ||
			status.authority.state !== "approved" ||
			execute?.operation !== "review.acknowledge-approved"
		) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-not-current",
				result: status.raw,
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "follow-provider-target-status",
			};
		}
		let argumentTokens: readonly string[];
		try {
			argumentTokens = assertReviewApprovedAcknowledgementExecuteV1(execute, {
				cwd: defaultCwd,
				lineageId: parameters.lineageId,
				targetIdentity: status.targetIdentity,
				revision: status.authority.revision,
			});
		} catch (error) {
			return nativeOperationFailure(parameters.operation, error);
		}
		try {
			// gentle-ai #3947: the burn answers with one review-acknowledged/v1
			// envelope bound to exactly this lineage, target, and revision, and
			// the burn is reported from that envelope, never from a later
			// STATUS. Every published release up to v2.5.0-rc.3 still burns in
			// silence, and that result stays byte-identical.
			const acknowledged = await acknowledgementCli.acknowledgeApproved({
				argumentTokens,
				cwd: defaultCwd,
				binding: { lineageId: parameters.lineageId, targetIdentity: status.targetIdentity, revision: status.authority.revision },
				...(signal === undefined ? {} : { signal }),
			});
			clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId);
			// The registry owns restoring writability of its 0555 views before
			// removal; a terminal approved cleanup keeps the lineage projection.
			candidateViews?.cleanupTerminal(parameters.lineageId, "approved", defaultCwd);
			return {
				operation: parameters.operation,
				status: "closed",
				outcome: "native-approved-acknowledgement-completed",
				lineage_id: parameters.lineageId,
				target_identity: status.targetIdentity,
				...(acknowledged === undefined ? {} : { consumed_revision: acknowledged.consumedRevision }),
				authority: "burned",
				...(acknowledged === undefined ? {} : { burn_evidence: acknowledged.schema }),
				delivery: "ordinary-repository-policy",
				mutation_performed: true,
				mutation_outcome: "committed",
			};
		} catch (error) {
			if (!nativeMutationRequiresStatus(error)) return nativeOperationFailure(parameters.operation, error);
			return await reconcileNativeMutationFailure(parameters.operation, error, acknowledgementCli, target, retainedUntrackedSelections);
		}
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (Object.keys(input).some((key) => key !== "consentBinding" && key !== "answer") || Object.keys(input).length !== 2) throw new Error("Review controller answer-consent input must contain exactly consentBinding and answer");
		if (typeof input.consentBinding !== "string" || input.consentBinding.length === 0) throw new Error("Review controller answer-consent requires an opaque consentBinding");
		if (input.answer !== "granted" && input.answer !== "declined") throw new Error("Review controller answer-consent answer must be granted or declined");
		const pending = pendingReviewConsentRegistry.get(pendingReviewConsentSession)?.get(input.consentBinding);
		if (pending === undefined || pending.expiresAt <= reviewConsentNow()) {
			const disposition = pending === undefined
				? pendingReviewConsentRegistry.staleDisposition(pendingReviewConsentSession, input.consentBinding)
				: PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED;
			const stale = staleConsentBindingDiagnostics(input.consentBinding, disposition);
			if (pending !== undefined) expirePendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession);
			if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				return staleConsentBindingOutcome(parameters.operation, input.consentBinding, stale, negotiated.status!);
			} catch (error) {
				return nativeStatusFailed(parameters.operation, error);
			}
		}
		if (realpathSync(defaultCwd) !== pending.repositoryCwd) throw new Error("Review controller consent repository binding changed");
		if (reviewConsentDigest(pending.consent) !== pending.consentDigest) throw new Error("Review controller consent envelope binding changed");
		pending.verifyCandidate();
		if (nativeReviewCli?.answerConsent === undefined) throw new Error("Native review consent follow-up is unavailable");
		if (!consumePendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession)) {
			const stale = staleConsentBindingDiagnostics(
				input.consentBinding,
				pendingReviewConsentRegistry.staleDisposition(pendingReviewConsentSession, input.consentBinding),
			);
			if (nativeReviewCli.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				return staleConsentBindingOutcome(parameters.operation, input.consentBinding, stale, negotiated.status!);
			} catch (error) {
				return nativeStatusFailed(parameters.operation, error);
			}
		}
		try {
			const gated = await resolveReviewModeGate(nativeReviewCli, parameters.operation, defaultCwd, signal);
			if (gated !== undefined) {
				cleanupPendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession);
				return gated;
			}
		} catch (error) {
			cleanupPendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession);
			return nativeOperationFailure(parameters.operation, error);
		}
		// The one-shot binding is consumed before the first answer-path await. Any
		// ambiguous provider result reconciles through STATUS and can never be replayed.
		let completed: Record<string, unknown>;
		try {
			const answered = await nativeReviewCli.answerConsent({
				cwd: pending.authorityCwd,
				consent: pending.consent,
				answer: input.answer,
				...(signal === undefined ? {} : { signal }),
			});
			if (answered.kind === "declined") {
				pending.cleanupCandidate();
				return {
					operation: parameters.operation,
					status: "skipped",
					outcome: "consent-declined-this-candidate",
					consent: answered.raw,
					...nativeStartPreAuthorityRejection(),
				};
			}
			retainNativeUntrackedSelection(retainedUntrackedSelections, pending.authorityCwd, answered.start.lineageId, pending.untrackedSelection);
			completed = completeNativeStart(parameters.operation, answered.start, pending.repositoryCwd, pending.candidateView, pending.candidateViews);
		} catch (error) {
			const value = error as { mutationOutcome?: unknown };
			if (value.mutationOutcome === "none") pending.cleanupCandidate();
			return await reconcileNativeMutationFailure(parameters.operation, error, nativeReviewCli, {
				cwd: pending.authorityCwd,
				...(pending.candidateView.committedOnly ? { baseRef: pending.candidateView.baseCommit, committedOnly: true } : {}),
				projection: "workspace",
			}, retainedUntrackedSelections);
		}
		if (input.answer === "granted") {
			try {
				writeReviewConsentLatch(pending.repositoryCwd);
			} catch (error) {
				try {
					context?.ui.notify(`Native review start completed, but Pi could not record the local consent latch: ${error instanceof Error ? error.message : String(error)}`, "warning");
				} catch { /* Reporting is best effort; native completion remains authoritative. */ }
			}
		}
		return completed;
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED) {
		if (nativeReviewCli?.targetStatus === undefined || nativeReviewCli.start === undefined) return nativeStatusUnsupported(parameters.operation);
		const canonicalBinding = parseCanonicalReviewCaptureBinding(parameters.selectionBinding!);
		let status: ReviewStatusV3;
		try {
			const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, { cwd: defaultCwd, ...(signal === undefined ? {} : { signal }) }, retainedUntrackedSelections, defaultCwd);
			if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
			status = negotiated.status!;
		} catch (error) { return nativeStatusFailed(parameters.operation, error); }
		const input = reviewIntendedUntrackedInput(status), eligibleJson = input === undefined ? undefined : exactCollectArgument(input, "eligible_paths_json"), inventory = input === undefined ? undefined : exactCollectArgument(input, "expected_untracked_inventory");
		let eligible: unknown;
		try { eligible = JSON.parse(eligibleJson ?? ""); } catch { eligible = undefined; }
		const scope = parameters.intendedUntracked!.length === 0 ? NATIVE_START_UNTRACKED_SCOPE.EXCLUDE : NATIVE_START_UNTRACKED_SCOPE.SELECT;
		const selected = validateNativeStartUntrackedSelection({ untrackedScope: scope, expectedUntrackedInventory: inventory, intendedUntracked: parameters.intendedUntracked });
		const rejected = input === undefined || canonicalReviewCaptureBinding(input) !== canonicalBinding || exactCollectArgument(input, "target_identity") !== status.targetIdentity || exactCollectArgument(input, "projection") !== status.projection.projection || exactCollectArgument(input, "base_tree") !== status.projection.baseTree || exactCollectArgument(input, "candidate_tree") !== status.projection.currentCandidateTree || !Array.isArray(eligible) || selected.reason !== undefined || selected.intendedUntracked!.some((path) => !eligible.includes(path));
		if (rejected) return { operation: parameters.operation, status: "blocked", outcome: "intended-untracked-selection-binding-rejected", mutation_performed: false, mutation_outcome: "none" };
		const submission = { argumentTokens: input.submission!.argumentTokens, value: JSON.stringify({ schema: "gentle-ai.review-intended-untracked-selection/v1", untracked_scope: scope, expected_untracked_inventory: inventory, intended_untracked: selected.intendedUntracked }) };
		const result = await executeReviewControllerOperation({ operation: REVIEW_CONTROLLER_OPERATION.START, ...(parameters.workspaceRoot === undefined ? {} : { workspaceRoot: parameters.workspaceRoot }), input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, untrackedScope: scope, expectedUntrackedInventory: inventory, intendedUntracked: selected.intendedUntracked }) }, sessionCwd, nativeReviewCli, signal, candidateViews, context, retainedUntrackedSelections, pendingReviewConsentRegistry, pendingReviewConsentFallbackKey, writeReviewConsentLatch, reviewConsentNow, reviewConsentScheduleTimer, submission);
		return { ...result, operation: parameters.operation };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.START) {
		const rawStart = parseControllerJson(
			requiredControllerString(parameters, "input"),
			REVIEW_CONTROLLER_OPERATION.START,
		);
		if (rawStart.mode === REVIEW_MODE.ORDINARY) {
			if ("policyHash" in rawStart) return nativeStartRejection("legacy-policy-hash-unsupported");
			const unknownField = Object.keys(rawStart).find((field) => !["mode", "baseRef", "committedOnly", "policyPath", "focus", "untrackedScope", "expectedUntrackedInventory", "intendedUntracked"].includes(field));
			if (unknownField !== undefined) return nativeStartRejection("unknown-field", unknownField);
			const focus = rawStart.focus;
			if (focus !== undefined && !isNativeStartFocus(focus)) return nativeStartRejection("focus-invalid");
			const policy: NativeStartPolicyValidation = rawStart.policyPath === undefined
				? {}
				: validateNativeStartPolicyPath(defaultCwd, rawStart.policyPath);
			if (policy.reason !== undefined) return nativeStartRejection(policy.reason);
			const baseRef = rawStart.baseRef;
			if (baseRef !== undefined && !isCanonicalProcessString(baseRef)) return nativeStartRejection("base-ref-invalid");
			if (baseRef !== undefined && rawStart.committedOnly !== true) return nativeStartRejection("committed-only-required");
			if (baseRef === undefined && "committedOnly" in rawStart) return nativeStartRejection("committed-only-invalid");
			const untrackedSelection = validateNativeStartUntrackedSelection(rawStart);
			if (untrackedSelection.reason !== undefined) return nativeStartRejection(untrackedSelection.reason);
			const retainedUntrackedSelection = cloneRetainedNativeUntrackedSelection(untrackedSelection);
			let canonicalBaseRef: string | undefined;
			if (baseRef !== undefined) {
				try {
					canonicalBaseRef = resolveCanonicalCandidateBase(defaultCwd, baseRef).commit;
				} catch (error) {
					if (error instanceof CandidateViewError && error.diagnostics !== undefined) return nativeOperationFailure(parameters.operation, Object.assign(error, { candidateViewPreNative: true }));
					if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-unresolvable" || error.reason === "base-ref-moved")) return nativeStartRejection(error.reason);
					return nativeStartRejection("base-ref-unresolvable");
				}
			}
			try {
				const gated = await resolveReviewModeGate(nativeReviewCli, parameters.operation, defaultCwd, signal);
				if (gated !== undefined) return gated;
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
			if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			let target: ReviewStatusV3;
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef, committedOnly: true }),
					...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
					...(intendedUntrackedSelection === undefined ? {} : { intendedUntrackedSelection }),
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				target = negotiated.status!;
				if (target.nextTransition?.kind === "collect" || target.applicability !== "unrelated" || target.action !== "start") return mapNativeTargetStatus(parameters.operation, target, parameters.lineageId);
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
			const replayKey = JSON.stringify({ cwd: defaultCwd, lineageId: parameters.lineageId ?? null, input: parameters.input ?? null, inputPath: parameters.inputPath ?? null });
			// Synchronously drop any binding whose TTL has already elapsed
			// before reusing its retained candidate view, so a fresh-candidate
			// retry cannot reuse a view tied to an expired binding and trip
			// candidate-target-projection-drift. Timer order must not decide
			// correctness: the queued cleanup macrotask may not have fired yet.
			pruneExpiredReviewConsents(pendingReviewConsentRegistry, pendingReviewConsentSession, reviewConsentNow);
			const candidateIntendedUntracked = target.projection.intendedUntracked;
			let candidateView: ReturnType<CandidateViewRegistry["create"]> | undefined;
			let nativeStartAttempted = false;
			try {
				const candidateRequest = { contributorRoot: defaultCwd, replayKey, ...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef, committedOnly: true }) };
				candidateView = candidateViews?.createOrReuse({ ...candidateRequest, ...(candidateIntendedUntracked.length === 0 ? {} : { intendedUntracked: candidateIntendedUntracked }) });
				if (candidateView !== undefined && candidateIntendedUntracked.length === 0 && candidateView.candidateTree !== target.projection.currentCandidateTree) {
					candidateView.cleanup();
					candidateView = candidateViews?.createOrReuse({ ...candidateRequest, intendedUntracked: [] });
				}
				if (candidateView !== undefined) assertNativeStartCandidateBinding(candidateView, target);
				let result: NativeStartResult;
				try {
					nativeStartAttempted = true;
					result = await nativeReviewCli.start({
						cwd: defaultCwd,
						...(canonicalBaseRef === undefined
							? {}
							: { baseRef: candidateView?.baseCommit ?? canonicalBaseRef, committedOnly: true }),
						targetIdentity: target.targetIdentity,
						projection: target.projection.projection,
						...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
						...(intendedUntrackedSelection === undefined ? {} : { intendedUntrackedSelection }),
						...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
						...(policy.policyPath === undefined ? {} : { policyPath: policy.policyPath }),
						...(focus === undefined ? {} : { focus }),
						...(signal === undefined ? {} : { signal }),
					});
				} catch (error) {
					if (!(error instanceof NativeReviewConsentRequiredError)) throw error;
					if (candidateView === undefined) throw new CandidateViewError("native consent requires a frozen candidate view");
					const consentCandidateView = candidateView;
					const repositoryCwd = realpathSync(defaultCwd);
					const consentDigest = reviewConsentDigest(error.consent);
					const pendingReviewConsents = pendingReviewConsentRegistry.get(pendingReviewConsentSession);
					const existing = [...(pendingReviewConsents?.values() ?? [])].find((pending) => pending.repositoryCwd === repositoryCwd && pending.candidateView.token === consentCandidateView.token && pending.consentDigest === consentDigest && pending.expiresAt > reviewConsentNow());
					if (existing === undefined) {
						for (const pending of [...(pendingReviewConsents?.values() ?? [])]) {
							if (pending.candidateView.token === consentCandidateView.token) {
								discardPendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession);
							}
						}
					}
					const id = existing?.id ?? randomUUID();
					if (existing === undefined) {
						let candidateCleaned = false;
						const pending: PendingReviewConsent = {
							id,
							repositoryCwd,
							authorityCwd: defaultCwd,
							candidateView: consentCandidateView,
							candidateViews,
							verifyCandidate: () => consentCandidateView.verify(),
							cleanupCandidate: () => {
								if (candidateCleaned) return;
								candidateCleaned = true;
								consentCandidateView.cleanup();
							},
							...(retainedUntrackedSelection === undefined ? {} : { untrackedSelection: retainedUntrackedSelection }),
							consent: error.consent,
							consentDigest,
							expiresAt: reviewConsentNow() + PENDING_REVIEW_CONSENT_TTL_MS,
						};
						pendingReviewConsentRegistry.ensure(pendingReviewConsentSession).set(id, pending);
						pending.expiry = reviewConsentScheduleTimer(
							() => expirePendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession),
							PENDING_REVIEW_CONSENT_TTL_MS,
						);
						pending.expiry.unref();
					}
					return {
						operation: parameters.operation,
						status: "blocked",
						outcome: "native-review-consent-required",
						consent: error.consent.raw,
						consent_binding: id,
						...nativeStartPreAuthorityRejection(),
					};
				}
				retainNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, result.lineageId, retainedUntrackedSelection);
				return completeNativeStart(parameters.operation, result, defaultCwd, candidateView, candidateViews);
			} catch (error) {
				if (error instanceof CandidateViewError && error.diagnostics !== undefined) return nativeOperationFailure(parameters.operation, Object.assign(error, { candidateViewPreNative: true }));
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
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(canonicalBaseRef === undefined ? {} : { baseRef: candidateView?.baseCommit ?? canonicalBaseRef, committedOnly: true }),
					...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
					projection: "workspace",
				}, retainedUntrackedSelections);
			}
		}
		if (rawStart.mode === REVIEW_MODE.ORDINARY) {
			return nativeStatusUnsupported(parameters.operation);
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
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		if (store.read(parameters.lineageId!).mode === REVIEW_MODE.ORDINARY) {
			throw new Error(GRAPH_V1_ORDINARY_READ_ONLY);
		}
		const result = store.runReducerOperation({
			lineageId: parameters.lineageId,
			transition: transitionValue,
			idempotencyKey,
			input: rawInput as unknown as ReviewReducerInput,
		});
		return {
			operation: parameters.operation,
			result,
			state: store.read(parameters.lineageId),
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.STATUS) {
		const rawStatus = parameters.input === undefined
			? undefined
			: parseControllerJson(parameters.input, REVIEW_CONTROLLER_OPERATION.STATUS);
		const unknownField = rawStatus === undefined
			? undefined
			: Object.keys(rawStatus).find((field) => !["baseRef", "committedOnly", "untrackedScope", "expectedUntrackedInventory", "intendedUntracked"].includes(field));
		if (unknownField !== undefined) return nativeStatusInputRejection("unknown-field", unknownField);
		const baseRef = rawStatus?.baseRef;
		if (baseRef !== undefined && !isCanonicalProcessString(baseRef)) return nativeStatusInputRejection("base-ref-invalid");
		if (baseRef !== undefined && rawStatus?.committedOnly !== true) return nativeStatusInputRejection("committed-only-required");
		if (baseRef === undefined && rawStatus !== undefined && "committedOnly" in rawStatus) return nativeStatusInputRejection("committed-only-invalid");
		const untrackedSelection = rawStatus === undefined ? {} : validateNativeStartUntrackedSelection(rawStatus);
		if (
			rawStatus !== undefined &&
			(untrackedSelection.reason !== undefined || (baseRef === undefined && untrackedSelection.untrackedScope === undefined))
		) return nativeStatusInputRejection(untrackedSelection.reason ?? "untracked-selection-invalid");
		const retainedUntrackedSelection = cloneRetainedNativeUntrackedSelection(untrackedSelection);
		const effectiveUntrackedSelection = rawStatus === undefined && parameters.lineageId !== undefined
			? readRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId)
			: untrackedSelection;
		if (nativeReviewCli?.targetStatus !== undefined) {
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(baseRef === undefined ? {} : { baseRef, committedOnly: true }),
					...(effectiveUntrackedSelection.untrackedScope === undefined ? {} : effectiveUntrackedSelection),
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, negotiated.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const status = negotiated.status!;
				if (
					retainedUntrackedSelection !== undefined &&
					parameters.lineageId !== undefined &&
					status.applicability === "current_target" &&
					status.authority?.lineageId === parameters.lineageId
				) retainNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId, retainedUntrackedSelection);
				clearRetainedNativeStatusSelectionsOnTerminal(retainedUntrackedSelections, defaultCwd, status.authority?.lineageId, status.authority?.state);
				hydrateDispatchBindingFromStatus(candidateViews, defaultCwd, status);
				return { ...mapNativeTargetStatus(parameters.operation, status, parameters.lineageId, defaultCwd), ...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}) };
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
		}
		return nativeStatusUnsupported(parameters.operation);
	}
	throw new Error(`Review controller operation is unsupported: ${parameters.operation}`);
}

/** @internal */
export const __testing = {
	resolveReviewModeGate,
	listAgentsFromDir,
	listAgentsFromDirAsync,
	listDiscoverableAgents,
	orderDiscoverableAgents,
	classifyGuardedCommand,
	loadRuntimeGuardrailsConfig,
	buildGentlePrompt,
	nativeStatusUnsupported,
	executeReviewControllerOperation,
	executeReviewCaptureOperation,
	executeReviewCaptureGroupOperation,
	setReviewHostRelayRunnerForTesting,
	setReviewHostRelayGroupRunnersForTesting,
	clearReviewTransportProbeForTesting,
	renderSddModelPanel: renderSddModelPanelForTesting,
	getOrchestratorPrompt,
	renderOrchestratorPrompt,
	loadReviewContractPromptFragment,
	readMirroredReviewContractFragment,
	loadBackgroundSubagentsPolicy,
	resolveBackgroundSubagentsPolicy,
	renderBackgroundSubagentsReport,
	writeGlobalBackgroundSubagentsPolicy,
	parseBackgroundSubagentsPolicyFile,
	resolveBackgroundSubagentsCapability,
	readActiveToolNames,
	renderBackgroundSubagentsStatusLine,
	resolveControllerSddStatus,
	resolveStartupControllerSddStatus,
	createGentleAiExtension: createGentleAiExtensionForTesting,
};

function resolveControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
) {
	return resolveSddStatus({ cwd, changeName, includeInstructions, artifactStore });
}

function resolveStartupControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
) {
	return resolveControllerSddStatus(cwd, changeName, includeInstructions, artifactStore);
}

export interface GentleAiRuntimeDependencies {
	nativeReviewCli?: NativeReviewCli | null;
	candidateViews?: CandidateViewRegistry | null;
	// An injected registry gives tests and host integrations explicit ownership;
	// normal package registrations share the module-local process-memory registry.
	pendingReviewConsentRegistry?: PendingReviewConsentRegistry;
	// Deterministic test seam for the consent-binding TTL clock. Production
	// leaves both undefined so the consent path observes real wall-clock time;
	// tests inject a fake clock so expiry is observable without a 10-minute
	// sleep and without relying on the queued cleanup macrotask firing.
	now?: () => number;
	scheduleTimer?: (callback: () => void, delayMs: number) => { unref: () => void };
}

export function createGentleAiExtension(dependencies: GentleAiRuntimeDependencies = {}): (pi: ExtensionAPI) => void {
	return createGentleAiExtensionForTesting(dependencies);
}

function createGentleAiExtensionForTesting(
	dependencies: GentleAiRuntimeDependencies = {},
	writeReviewConsentLatch: typeof recordReviewConsentLatch = recordReviewConsentLatch,
): (pi: ExtensionAPI) => void {
	const nativeReviewCli = dependencies.nativeReviewCli === undefined ? createNativeReviewCli() : dependencies.nativeReviewCli;
	const reviewConsentNow = dependencies.now ?? (() => Date.now());
	const reviewConsentScheduleTimer = dependencies.scheduleTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const pendingReviewConsentRegistry = dependencies.pendingReviewConsentRegistry ?? processPendingReviewConsentRegistry;
	return function gentleAi(pi: ExtensionAPI): void {
	const pendingReviewConsentFallbackKey = Symbol("pending-review-consent-fallback");
	const candidateViews = dependencies.candidateViews === undefined ? new CandidateViewRegistry() : dependencies.candidateViews;
	const herdrLifecycle = createHerdrConfirmationLifecycle(pi.events);

	pi.on("session_shutdown", (_event, context) => {
		const sessionKey = pendingReviewConsentSessionKey(context, pendingReviewConsentFallbackKey);
		cleanupAllPendingReviewConsents(pendingReviewConsentRegistry, sessionKey);
		processRetainedNativeStatusSelections.delete(sessionKey);
		processAgentEndSubagentDepth.delete(sessionKey);
		processAgentEndPreflightNudgedTargets.delete(sessionKey);
		processAgentEndSessionBaseline.delete(sessionKey);
	});

	pi.registerTool({
		name: "gentle_review_scope",
		label: "Gentle Review Scope",
		description: "Read one bounded, integrity-checked page of the controller-owned frozen changed scope. This read-only tool never inspects the ambient or candidate tree.",
		parameters: REVIEW_SCOPE_PARAMETERS,
		executionMode: "parallel",
		renderCall(_args, theme, context) {
			return renderGentleAiLifecycleCall(
				"review scope",
				theme,
				context as GentleAiRenderContext | undefined,
			);
		},
		renderResult(result, options) {
			return renderGentleAiResult(result, options);
		},
		async execute(_toolCallId, parameters) {
			const input = parameters as ReviewScopeParameters;
			const details = readCandidateContextManifestPage(input.manifest, input.sha256, input.cursor ?? 0);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	pi.registerTool({
		name: "gentle_review_capture_group",
		label: "Gentle Review Capture Group",
		description: "Capture one complete provider-issued materialize reviewer group. It validates the exact ordered current collect set, forecasts its bounded model cost, runs reviewers concurrently, and admits outputs one at a time in provider order.",
		promptSnippet: "Use one complete exact current STATUS materialize reviewer group; acknowledge its forecast before the grouped run.",
		promptGuidelines: [
			"Pass only lineageId, the complete ordered collectBindings array from one current STATUS result, and reviewerRunAcknowledged after its forecast. Never mix, reorder, duplicate, or partially select bindings.",
			"The group materializes and runs independent reviewers concurrently, but rechecks STATUS before every provider-ordered submission. It stops on a closure, correction, drift, or uncertain capture outcome; it never follows another transition or replays a prepared output.",
		],
		parameters: REVIEW_CAPTURE_GROUP_PARAMETERS,
		executionMode: "sequential",
		renderCall(_args, theme, context) {
			return renderGentleAiLifecycleCall("review capture group", theme, context as GentleAiRenderContext | undefined);
		},
		renderResult(result, options) {
			return renderGentleAiResult(result, options);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review capture group was cancelled");
			const details = await executeReviewCaptureGroupOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				((sessionKey: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(sessionKey) ?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!)(pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey)),
				true,
			);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	pi.registerTool({
		name: "gentle_review_capture",
		label: "Gentle Review Capture",
		description: "Capture exactly one provider-issued ordinary native review collect slot. This is not a controller operation: it validates one opaque collect binding against current target-scoped STATUS, executes at most one capture, and never follows a transition.",
		promptSnippet: "Use one exact current STATUS collectBinding for one ordinary native capture; call fresh STATUS before every additional capture.",
		promptGuidelines: [
			"Pass only lineageId, the JSON-serialized exact collectBinding from current STATUS, and the route-specific optional acknowledgement or correctionLines value. Never compose provider argument tokens, prompts, results, verdicts, or lens arrays.",
			"A materialize reviewer slot first forecasts one model run; re-submit that same exact binding with reviewerRunAcknowledged: true to authorize one host relay. Correction-plan slots require correctionLines inside the provider-issued bounds, counted in diff lines (one replaced source line is one deletion plus one addition) — a different unit from the frozen logical correction budget. Refuter and validation vectors execute exactly once as provider-rendered.",
			"A native terminal closure or nonterminal capture returns directly. Do not expect automatic STATUS, FINALIZE, receipt, delivery, or another capture; call fresh STATUS before any next capture.",
		],
		parameters: REVIEW_CAPTURE_PARAMETERS,
		executionMode: "sequential",
		renderCall(_args, theme, context) {
			return renderGentleAiLifecycleCall(
				"review capture",
				theme,
				context as GentleAiRenderContext | undefined,
			);
		},
		renderResult(result, options) {
			return renderGentleAiResult(result, options);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review capture was cancelled");
			const details = await executeReviewCaptureOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				((sessionKey: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(sessionKey) ?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!)(pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey)),
				true,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "gentle_review",
		label: "Gentle Review Controller",
		description:
			"Inspect and recover review authority and start native ordinary review. Ordinary capture is available only through the separate gentle_review_capture tool. Review outcomes never authorize delivery: commit, push, pull-request, and release commands follow ordinary repository policy. RESET/RECOVER remain destructive and are executed by the audited native CLI.",
		promptSnippet: "Inspect authority, then start native ordinary review; use gentle_review_capture for one current collect slot",
		promptGuidelines: [
			'Call {"operation":"inspect"} before START. New native ordinary START uses a JSON string such as "{\\"mode\\":\\"ordinary\\"}"; an explicit baseRef must be paired with committedOnly: true to request a committed range, while policyPath remains repository-local. policyHash is legacy compact-only. The controller derives lineage, Git/untracked scope, tier, lenses, authored lines, and budget; the frozen correction budget counts logical corrections, while correction-plan correctionLines count diff lines (one replaced source line is one deletion plus one addition).',
			"Use RECONCILE_AUTHORITY only to quarantine one invalid native recovery successor. Supply exact predecessorLineage, expectedPredecessorRevision, successorLineage, expectedSuccessorRevision, actor, and reason values; Pi derives and displays the seven-line native authorization binding for fresh UI approval. The predecessor stays untouched, native returns the durable audit record, and Pi never falls back to RESET or RECOVER.",
			"Use ABANDON or QUARANTINE_LEGACY only after an explicit user decision and with exact native inputs. ABANDON needs lineage, expectedRevision, snapshotIdentity, capturedLensResults, findingsPresent, evidenceRecordsPresent, actor, and reason; QUARANTINE_LEGACY accepts only the published malformed freeze-findings diagnostic/disposition. A dual reconciliation may supply only anomalies `unchanged_target,malformed_recovery_authorization` in that exact order. Use REPAIR_LEGACY_ALIAS only with lineage, actor, and reason: Pi freshly reads native inventory and derives repository, revision, diagnostic, disposition, and the exact eight-line binding before interactive approval. `review dispose-result` is unsupported pending design.",
			"Lens, refuter, and validator verdicts are admitted natively, never Pi-authored. Use gentle_review_capture with exactly one current provider-owned collectBinding for ordinary native capture; it never follows another transition.",
			"For blocked-legacy or blocked-mixed, do not call START repeatedly. Explain invalidation, request explicit user authorization, then call RESET or RECOVER only after authorization. RESET and RECOVER_LOCK route to audited native `gentle-ai review reclaim`; only RESET carries the legacy repositoryId, commonDirHash, inventoryHash, and confirmation challenge. RECOVER routes to native `gentle-ai review recover` with exactly six inputs: predecessorLineage, expectedPredecessorRevision, successorLineage, disposition, actor, and reason. Never send RECOVER the reset challenge and never send it a maintainerAuthorization: Pi reads fresh native target status, pins the predecessor lineage, revision, provider-selected disposition, and target identity, derives the exact six-line native authorization binding, displays it for fresh UI approval, and re-reads status before mutating. Negotiated target status supplies the sole accepted recovery disposition, and a caller-supplied substitute is rejected. Treat a native-input-required envelope as a request for exact values, never as permission to invent them. After a committed native recovery record, INSPECT before any fresh ordinary START.",
			"A consent-required START returns the complete provider envelope and an opaque consent_binding, then stops. The parent presents and localizes that envelope without changing machine tokens, commands, target IDs, or invocations. After one explicit human answer, call answer-consent exactly once with a JSON string containing only consentBinding and answer (`granted` or `declined`). A reported lineage_created false or pre-authority validation error proves no lineage was created. After ambiguous START output, the controller calls target-scoped native status once and returns only its declared action. An ambiguous gentle_review_capture outcome independently reconciles once and never replays the capture.",
			"Use gentle_review only for native review authority operations; delivery commands follow ordinary repository policy.",
		],
		parameters: REVIEW_CONTROLLER_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme, context) {
			return renderGentleAiLifecycleCall(
				reviewToolOperationPath(args),
				theme,
				context as GentleAiRenderContext | undefined,
			);
		},
		renderResult(result, options) {
			return renderGentleAiResult(result, options);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review controller operation was cancelled");
			await authorizeDestructiveReviewOperation(parameters, ctx);
			const details = await executeReviewControllerOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				ctx,
				((sessionKey: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(sessionKey) ?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!)(pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey)),
				pendingReviewConsentRegistry,
				pendingReviewConsentFallbackKey,
				writeReviewConsentLatch,
				reviewConsentNow,
				reviewConsentScheduleTimer,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});

	function runSddPreflight(ctx: ExtensionContext, promptFields: readonly SddPreflightField[] = []): Promise<SddPreflightPreferences> {
		return ensureSddPreflight(ctx, { pi, installAssets: (cwd) => installSddAssets(cwd, false), applyModelConfig: async () => applySavedModelConfig(ctx) }, { promptFields });
	}

	pi.on("session_start", async (_event, ctx) => {
		// Loud, every session: an active dev-binary override means this session
		// runs an unpinned gentle-ai. Announce which one before anything else.
		try {
			const devBinary = await describeDevBinaryOverride();
			if (ctx.hasUI && devBinary.state === "active") ctx.ui.notify(devBinary.line, "warning");
			if (ctx.hasUI && devBinary.state === "invalid") ctx.ui.notify(devBinary.line, "error");
		} catch (error) {
			if (ctx.hasUI) ctx.ui.notify(`Gentle AI dev binary override check failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
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
		// gentle-pi#568: record the target identity STATUS reports right now,
		// before this session does anything, as the baseline `agent_end` skips
		// later. Best-effort and silent: it never notifies and never lets a
		// STATUS failure fail session start.
		try {
			const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
			const status = await resolveNegotiatedReviewStatusForSession(nativeReviewCli, ctx, sessionKey);
			if (status?.targetIdentity !== undefined) {
				processAgentEndSessionBaseline.set(sessionKey, status.targetIdentity);
			}
		} catch {
			// Baseline recording is best-effort only; never surface or throw.
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
		const subagentDepthKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
		if (isSddAgent || isNamedAgent) {
			processAgentEndSubagentDepth.set(subagentDepthKey, (processAgentEndSubagentDepth.get(subagentDepthKey) ?? 0) + 1);
		} else {
			processAgentEndSubagentDepth.set(subagentDepthKey, 0);
		}
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
			? `\n\n${renderNativeSddPhasePrompt(resolveStartupControllerSddStatus(
				ctx.cwd,
				undefined,
				true,
				prefs?.artifactStore,
			), phase)}`
			: "";
		const gentlePrompt = isNamedAgent || isSddAgent
			? ""
			: `\n\n${buildGentlePrompt(readPersonaMode(ctx.cwd), ctx.cwd, readActiveToolNames(pi))}`;
		// gentle-pi#560 / gentle-ai#4056, #4057: inject the mirrored provider
		// contract bundle's review execution contract for the primary session
		// only, and only when a native review CLI is actually present.
		const reviewContractPrompt =
			!isNamedAgent && !isSddAgent && nativeReviewCli !== null
				? (() => {
					const fragment = loadReviewContractPromptFragment(ctx);
					return fragment === null ? "" : `\n\n${fragment}`;
				})()
				: "";
		return {
			systemPrompt: `${event.systemPrompt}${gentlePrompt}${sddPrompt}${nativeStatusPrompt}${reviewContractPrompt}`,
		};
	});

	// gentle-pi#556 / gentle-ai#4051: with RDD enabled, the agent could finish
	// an authorized implementation and report completion without ever running
	// the review STATUS preflight or offering the consent question. This
	// handler is read-only and idempotent: it never runs START, never answers
	// consent, and never writes a file. It only sends one turn-triggering
	// reminder, at most once per unreviewed target identity per session.
	// gentle-pi#568: a candidate matching the baseline `session_start`
	// recorded predates this session's own work and is skipped rather than
	// nudged, so a worktree already dirty from the user's own edits does not
	// draw a reminder about work this session never produced.
	pi.on("agent_end", async (_event, ctx) => {
		if (nativeReviewCli?.reviewMode === undefined || nativeReviewCli.targetStatus === undefined) return;
		if (ctx.hasUI !== true) return;
		const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
		const subagentDepth = processAgentEndSubagentDepth.get(sessionKey) ?? 0;
		if (subagentDepth > 0) {
			processAgentEndSubagentDepth.set(sessionKey, subagentDepth - 1);
			return;
		}
		const status = await resolveNegotiatedReviewStatusForSession(nativeReviewCli, ctx, sessionKey);
		if (status === undefined) return;
		if (status.nextTransition?.kind !== "execute" || status.nextTransition.execute.operation !== "review.start") return;
		const targetIdentity = status.targetIdentity;
		if (processAgentEndSessionBaseline.get(sessionKey) === targetIdentity) return;
		let nudged = processAgentEndPreflightNudgedTargets.get(sessionKey);
		if (nudged === undefined) {
			nudged = new Set<string>();
			processAgentEndPreflightNudgedTargets.set(sessionKey, nudged);
		}
		if (nudged.has(targetIdentity)) return;
		nudged.add(targetIdentity);
		pi.sendMessage(
			{
				customType: "gentle-pi.review-preflight",
				content: renderAgentEndReviewPreflightMessage(targetIdentity),
				display: true,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	});

	pi.on("tool_call", async (event, ctx) => {
		const sensitivePathDenied = evaluateSensitivePathTool(
			event.toolName,
			event.input,
		);
		if (sensitivePathDenied) return sensitivePathDenied;
		if (event.toolName === "subagent_run") {
			const writerScopeDenied = rejectUnscopedBoundedWriterDispatch(event.input);
			if (writerScopeDenied) return writerScopeDenied;
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
		if (!isRecord(event.input) || typeof event.input.command !== "string") {
			return undefined;
		}
		return await confirmCommand(event.input.command, ctx, pi.events, herdrLifecycle);
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
			await runSddPreflight(ctx, SDD_PREFLIGHT_FIELDS);
		},
	});

	const handleSddStatusCommand = async (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const status = resolveControllerSddStatus(
			ctx.cwd,
			parsed.changeName,
			true,
			getSddPreflightPreferences(ctx)?.artifactStore,
		);
		ctx.ui.notify(
			parsed.json ? JSON.stringify(status, null, 2) : renderSddStatusMarkdown(status),
			sddStatusSeverity(status),
		);
	};

	pi.registerCommand("gentle-sdd-status", {
		description: "Show deterministic SDD change status and instructions.",
		handler: async (args, ctx) => {
			await handleSddStatusCommand(args, ctx);
		},
	});

	const handleSddContinueCommand = async (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const status = resolveControllerSddStatus(
			ctx.cwd,
			parsed.changeName,
			true,
			getSddPreflightPreferences(ctx)?.artifactStore,
		);
		ctx.ui.notify(
			parsed.json ? JSON.stringify(status, null, 2) : renderSddDispatcherMarkdown(status),
			sddStatusSeverity(status),
		);
	};

	pi.registerCommand("gentle-sdd-continue", {
		description: "Resolve SDD status and route the next phase deterministically.",
		handler: async (args, ctx) => {
			await handleSddContinueCommand(args, ctx);
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

	// Dev-binary override surfacing (unpinned field-test mode). While the
	// override is active every diagnostic surface names the exact binary, its
	// live version, and its fresh content digest, so the maintainer always
	// knows which gentle-ai actually answered. An invalid override surfaces as
	// a failure — it is never silently ignored, because the native resolver
	// refuses to fall back to the pin while an override is declared.
	const describeDevBinaryOverride = async (): Promise<
		| { state: "inactive" }
		| { state: "active"; line: string; override: GentleAiDevBinaryOverride }
		| { state: "invalid"; line: string }
	> => {
		let override: GentleAiDevBinaryOverride | undefined;
		try {
			override = resolveGentleAiDevBinaryOverride();
		} catch (error) {
			if (error instanceof GentleAiDevBinaryOverrideError) return { state: "invalid", line: `Gentle AI dev binary override invalid — ${error.message}` };
			throw error;
		}
		if (override === undefined) return { state: "inactive" };
		let version = "version unavailable";
		try {
			const adapter = createNodeExecFileAdapter();
			const result = await adapter({ file: override.path, arguments: ["version"], cwd: dirname(override.path), timeoutMs: 10_000, maxBufferBytes: 1024 * 1024 });
			const banner = result.stdout.trim();
			if (result.exitCode === 0 && banner.startsWith("gentle-ai ")) version = banner.slice("gentle-ai ".length);
		} catch {
			// The doctor line still names the binary; the version stays unavailable.
		}
		return {
			state: "active",
			override,
			line: `Gentle AI dev binary override active (unpinned, field-test only): ${override.path} ${version} sha256:${override.sha256.slice(0, 16)}`,
		};
	};

	pi.registerCommand("gentle:dev-binary", {
		description: "Register, inspect, or clear the persistent Gentle AI dev-binary override (status | <absolute path> | off). Unpinned, field-test only.",
		handler: async (args, ctx) => {
			const argument = args.trim();
			try {
				if (argument === "off") {
					const removed = unregisterGentleAiDevBinary();
					ctx.ui.notify(removed ? "Gentle AI dev binary registration removed; the pinned binary is active again." : "No dev binary registration to remove.", "info");
					return;
				}
				if (argument === "" || argument === "status") {
					const described = await describeDevBinaryOverride();
					if (described.state === "inactive") ctx.ui.notify("No dev binary override; the pinned Gentle AI binary is active.", "info");
					else ctx.ui.notify(described.line, described.state === "active" ? "warning" : "error");
					return;
				}
				registerGentleAiDevBinary(argument);
				const described = await describeDevBinaryOverride();
				ctx.ui.notify(described.state === "inactive" ? "Dev binary registration written." : described.line, "warning");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
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
			const devBinary = await describeDevBinaryOverride();
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
				...(devBinary.state === "active" ? [`warn: ${devBinary.line}`] : []),
				...(devBinary.state === "invalid" ? [`fail: ${devBinary.line}`, "remedy: fix the dev binary override or clear it with /gentle:dev-binary off (or unset GENTLE_PI_GENTLE_AI_DEV_BINARY)"] : []),
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

	pi.registerCommand("gentle:review-mode", {
		description: "Show or set the Gentle AI review-driven-development kill switch (status|disable|enable). Every sub-action is user-initiated only; Pi automation never toggles it.",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? NATIVE_REVIEW_MODE_OPERATION.STATUS : args.trim();
			if (subAction !== NATIVE_REVIEW_MODE_OPERATION.STATUS && subAction !== NATIVE_REVIEW_MODE_OPERATION.ENABLE && subAction !== NATIVE_REVIEW_MODE_OPERATION.DISABLE) {
				ctx.ui.notify(`Unknown /gentle:review-mode sub-action "${subAction}". Use status, disable, or enable.`, "warning");
				return;
			}
			if (nativeReviewCli?.reviewMode === undefined) {
				ctx.ui.notify("Gentle AI review mode is not available with the currently negotiated native version.", "info");
				return;
			}
			try {
				const result = await nativeReviewCli.reviewMode({ cwd: ctx.cwd, operation: subAction as NativeReviewModeOperation });
				if (subAction === NATIVE_REVIEW_MODE_OPERATION.DISABLE && result.status.effective === "off") {
					cleanupAllPendingReviewConsents(
						pendingReviewConsentRegistry,
						pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey),
					);
				}
				const report = `receipt-driven development: ${result.status.effective} (decided by ${result.status.source})`;
				// A mutating sub-action that left the effective mode unchanged did
				// not do what the user asked, and reporting only the resulting
				// status reads as if it had. This is reachable for exactly one
				// shape: `enable` against a global off. Pi always passes
				// `--scope clone` (Design Decision #7), which only clears a
				// clone-local override and cannot enable global RDD. The native call
				// exits 0, reports operation "enable", and changes nothing. Say
				// that, and name the global-scope command that resolves it.
				const requested = subAction === NATIVE_REVIEW_MODE_OPERATION.ENABLE ? "on" : subAction === NATIVE_REVIEW_MODE_OPERATION.DISABLE ? "off" : result.status.effective;
				if (result.status.effective !== requested) {
					ctx.ui.notify(`${report}\nThat did not turn reviews back on: /gentle:review-mode enable only clears a clone-local override, which cannot override a global off. Run \`gentle-ai review mode enable --scope=global\` to turn them back on.`, "warning");
					return;
				}
				ctx.ui.notify(report, "info");
			} catch (error) {
				if (asNativeReviewCliError(error)?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) {
					ctx.ui.notify("Gentle AI review mode is not available with the currently negotiated native version.", "info");
					return;
				}
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	// Mirrors gentle:review-mode: a user-owned switch, never an automated one.
	// It matters more here than there, because this policy governs whether
	// background subagents may be launched at all, so nothing in Pi may write
	// it. The only writer is this handler, reached only by explicit invocation.
	pi.registerCommand("gentle:background-subagents", {
		description: "Show or set the managed background-subagents policy (status|enable|disable). Every sub-action is user-initiated only; Pi automation never toggles it.",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? "status" : args.trim();
			if (subAction !== "status" && subAction !== "enable" && subAction !== "disable") {
				ctx.ui.notify(`Unknown /gentle:background-subagents sub-action "${subAction}". Use status, enable, or disable.`, "warning");
				return;
			}
			try {
				const wrote: BackgroundSubagentsPolicy | undefined = subAction === "enable" ? "on" : subAction === "disable" ? "off" : undefined;
				if (wrote !== undefined) writeGlobalBackgroundSubagentsPolicy(wrote);
				const resolution = resolveBackgroundSubagentsPolicy(ctx.cwd);
				const capability = resolveBackgroundSubagentsCapability(ctx.cwd, readActiveToolNames(pi));
				const report = renderBackgroundSubagentsReport(resolution, capability, wrote);
				ctx.ui.notify(report.message, report.type);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
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
			const devBinary = await describeDevBinaryOverride();
			ctx.ui.notify(
				[
					"el Gentleman package is active.",
					...(devBinary.state === "inactive" ? [] : [devBinary.line]),
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
				staleSddAssets > 0 || localSddAgentOverrides > 0 || devBinary.state !== "inactive" ? "warning" : "info",
			);
		},
	});
	};
}

export default function gentleAi(pi: ExtensionAPI): void {
	return createGentleAiExtension()(pi);
}
