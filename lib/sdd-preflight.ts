import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveGentlePiAgentHome } from "./agent-home.ts";
import {
	resolveEngramExtensionEntry,
	updateFrontmatterEngramCapability,
} from "./sdd-agent-engram-capability.ts";
import type { SddArtifactStore } from "./sdd-status.ts";

export type { SddArtifactStore };

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const MANAGED_ASSETS_MANIFEST = "managed-assets.json";
const MANAGED_ASSETS_SCHEMA_VERSION = 1;
const LEGACY_MANAGED_ASSET_MANIFESTS = Object.freeze([
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.10.7.json"), version: "0.10.7" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.13.json"), version: "0.13.0" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.14.json"), version: "0.14.0" },
]);

function gentlePiAgentHome(): string {
	return resolveGentlePiAgentHome();
}

export type SddExecutionMode = "interactive" | "auto";
export type SddDeliveryStrategy =
	| "ask-on-risk"
	| "auto-chain"
	| "single-pr"
	| "exception-ok";
/** @deprecated Use SddDeliveryStrategy; legacy values normalize at persistence boundaries. */
export type SddChainedPrStrategy =
	| SddDeliveryStrategy
	| "auto-forecast"
	| "ask-always"
	| "single-pr-default"
	| "force-chained";
export type SddPreflightField = "executionMode" | "artifactStore" | "chainedPrStrategy" | "reviewBudgetLines";
export const SDD_PREFLIGHT_FIELDS = ["executionMode", "artifactStore", "chainedPrStrategy", "reviewBudgetLines"] as const;

export interface SddPreflightPreferences {
	executionMode: SddExecutionMode;
	artifactStore: SddArtifactStore;
	/** Runtime values are canonical; legacy assignments normalize at persistence/render boundaries. */
	chainedPrStrategy: SddChainedPrStrategy;
	reviewBudgetLines: number;
	engramAvailable: boolean;
	prompted: boolean;
	sizeExceptionAccepted?: true;
}

export interface SddPreflightResolutionOptions {
	persisted?: Partial<SddPreflightPreferences>;
	promptFields?: readonly SddPreflightField[];
	acceptSizeException?: true;
}

interface SddPreflightCallbacks {
	pi: ExtensionAPI;
	installAssets?: (cwd: string) =>
		| {
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }
		| Promise<{
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }>;
	applyModelConfig?: (
		cwd: string,
	) =>
		| { updated: number; skipped: number; invalidPath?: string }
		| Promise<{ updated: number; skipped: number; invalidPath?: string }>;
}

interface ManagedAssetsManifest {
	schemaVersion: number;
	assets: Record<string, string>;
}

interface LegacyManagedAssetsManifest extends ManagedAssetsManifest {
	packageVersion: string;
}

export const DEFAULT_SDD_PREFLIGHT: SddPreflightPreferences = Object.freeze({
	executionMode: "auto",
	artifactStore: "openspec",
	chainedPrStrategy: "ask-on-risk",
	reviewBudgetLines: 400,
	engramAvailable: false,
	prompted: false,
});

const sddPreflightBySession = new Map<string, SddPreflightPreferences>();
const sddPreflightInFlight = new Map<string, Promise<SddPreflightPreferences>>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSddExecutionMode(value: unknown): value is SddExecutionMode {
	return value === "interactive" || value === "auto";
}

function isSddArtifactStore(value: unknown): value is SddArtifactStore {
	return value === "openspec" || value === "engram" || value === "hybrid" || value === "none";
}

// normalizeSddArtifactStore accepts the canonical names and the legacy "both"
// spelling of the dual-store mode. Operator preflight files written before the
// rename carry "both" on disk; rejecting it would silently drop the operator's
// choice back to the default, so it maps forward instead.
export function normalizeSddArtifactStore(value: unknown): SddArtifactStore | undefined {
	if (value === "both") return "hybrid";
	return isSddArtifactStore(value) ? value : undefined;
}

function normalizeReviewBudgetValue(value: unknown): number | undefined {
	const parsed = typeof value === "number"
		? value
		: typeof value === "string"
			? Number.parseInt(value.trim(), 10)
			: Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function normalizeSddStrategySelection(
	value: unknown,
	allowExceptionOk: boolean,
): SddDeliveryStrategy | undefined {
	if (value === "exception-ok") return allowExceptionOk ? value : undefined;
	if (value === "auto-forecast" || value === "ask-always") return "ask-on-risk";
	if (value === "single-pr-default") return "single-pr";
	if (value === "force-chained") return "auto-chain";
	return value === "ask-on-risk" || value === "auto-chain" || value === "single-pr"
		? value
		: undefined;
}

export function normalizeSddChainedPrStrategy(
	value: unknown,
	allowExceptionOk = false,
): SddDeliveryStrategy {
	return normalizeSddStrategySelection(value, allowExceptionOk) ?? "ask-on-risk";
}

function normalizedSelections(
	value: Partial<Record<SddPreflightField, unknown>> | undefined,
	engramAvailable: boolean,
	allowExceptionOk: boolean,
): Partial<Record<SddPreflightField, unknown>> {
	if (!value) return {};
	const result: Partial<Record<SddPreflightField, unknown>> = {};
	if (isSddExecutionMode(value.executionMode)) result.executionMode = value.executionMode;
	const artifactStore = normalizeSddArtifactStore(value.artifactStore);
	if (artifactStore !== undefined && (engramAvailable || artifactStore === "openspec" || artifactStore === "none")) result.artifactStore = artifactStore;
	const strategy = normalizeSddStrategySelection(value.chainedPrStrategy, allowExceptionOk);
	if (strategy) result.chainedPrStrategy = strategy;
	const reviewBudgetLines = normalizeReviewBudgetValue(value.reviewBudgetLines);
	if (reviewBudgetLines !== undefined) result.reviewBudgetLines = reviewBudgetLines;
	return result;
}

function emptyManagedAssetsManifest(): ManagedAssetsManifest {
	return {
		schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION,
		assets: {},
	};
}

function readManagedAssetsManifest(path: string): ManagedAssetsManifest {
	if (!existsSync(path)) return emptyManagedAssetsManifest();
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.schemaVersion !== MANAGED_ASSETS_SCHEMA_VERSION ||
			!isRecord(parsed.assets)
		) {
			return emptyManagedAssetsManifest();
		}
		const assets = Object.fromEntries(
			Object.entries(parsed.assets).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
		return { schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION, assets };
	} catch {
		return emptyManagedAssetsManifest();
	}
}

function managedAssetHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function readLegacyManagedAssets(
	path: string,
	version: string,
): LegacyManagedAssetsManifest | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.schemaVersion !== MANAGED_ASSETS_SCHEMA_VERSION ||
			parsed.packageVersion !== version ||
			!isRecord(parsed.assets)
		) {
			return undefined;
		}
		const assets = Object.fromEntries(
			Object.entries(parsed.assets).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
		return {
			schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION,
			packageVersion: version,
			assets,
		};
	} catch {
		return undefined;
	}
}

function readLegacyManagedAssetHashes(): Record<string, readonly string[]> {
	const hashes: Record<string, string[]> = {};
	for (const manifest of LEGACY_MANAGED_ASSET_MANIFESTS) {
		const assets = readLegacyManagedAssets(manifest.path, manifest.version)?.assets;
		if (!assets) continue;
		for (const [ownershipKey, hash] of Object.entries(assets)) {
			const known = hashes[ownershipKey] ?? [];
			if (!known.includes(hash)) known.push(hash);
			hashes[ownershipKey] = known;
		}
	}
	return hashes;
}

function updateAgentFrontmatterRouting(
	content: string,
	routingLines: readonly string[],
): string {
	if (!content.startsWith("---\n")) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter
		.split("\n")
		.filter((line) => !/^(?:model|thinking):/.test(line));
	if (routingLines.length > 0) {
		const descriptionIndex = lines.findIndex((line) =>
			line.startsWith("description:"),
		);
		const insertIndex =
			descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, ...routingLines);
	}
	return `---\n${lines.join("\n")}${body}`;
}

function legacyComparableAssetContent(
	ownershipKey: string,
	content: string,
): string {
	return ownershipKey.startsWith("agents/")
		? updateAgentFrontmatterRouting(content, [])
		: content;
}

function migrateLegacyAssetContent(
	ownershipKey: string,
	installedContent: string,
	packagedContent: string,
): string {
	if (!ownershipKey.startsWith("agents/")) return packagedContent;
	if (!installedContent.startsWith("---\n")) return packagedContent;
	const endIndex = installedContent.indexOf("\n---", 4);
	if (endIndex === -1) return packagedContent;
	const routingLines = installedContent
		.slice(4, endIndex)
		.split("\n")
		.filter((line) => /^(?:model|thinking):/.test(line));
	return updateAgentFrontmatterRouting(packagedContent, routingLines);
}

export function updatePackageManagedSddAgentOwnership(
	installedPath: string,
	previousContent: string,
	nextContent: string,
): boolean {
	const agentHome = gentlePiAgentHome();
	const relativePath = relative(join(agentHome, "agents"), installedPath);
	if (
		relativePath.length === 0 ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return false;
	}
	const ownershipKey = `agents/${relativePath.split(sep).join("/")}`;
	const manifestPath = join(agentHome, "gentle-ai", MANAGED_ASSETS_MANIFEST);
	const manifest = readManagedAssetsManifest(manifestPath);
	if (manifest.assets[ownershipKey] !== managedAssetHash(previousContent)) {
		return false;
	}
	try {
		if (readFileSync(installedPath, "utf8") !== nextContent) return false;
		manifest.assets[ownershipKey] = managedAssetHash(nextContent);
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
		return true;
	} catch {
		return false;
	}
}

export function isPackageManagedSddAsset(
	installedPath: string,
	ownershipKey: string,
): boolean {
	const manifest = readManagedAssetsManifest(
		join(gentlePiAgentHome(), "gentle-ai", MANAGED_ASSETS_MANIFEST),
	);
	const expectedHash = manifest.assets[ownershipKey];
	if (expectedHash === undefined || !existsSync(installedPath)) return false;
	try {
		return (
			managedAssetHash(readFileSync(installedPath, "utf8")) ===
			expectedHash
		);
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Durable store — survives restarts, resumed sessions, and non-SDD agent starts
// ---------------------------------------------------------------------------

export function sddPreflightDiskPath(cwd: string): string {
	return join(cwd, ".pi", "gentle-ai", "sdd-preflight.json");
}

export function readSddPreflightFromDisk(cwd: string): SddPreflightPreferences | undefined {
	const path = sddPreflightDiskPath(cwd);
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return undefined;
		// Validate required fields to guard against stale/corrupt writes.
		const { executionMode, artifactStore, chainedPrStrategy, reviewBudgetLines, engramAvailable, prompted } = parsed;
		// Normalize before validating: a preflight file written before the
		// dual-store rename carries "both", and discarding it would silently
		// drop the operator's choice back to the default.
		const canonicalArtifactStore = normalizeSddArtifactStore(artifactStore);
		if (
			!isSddExecutionMode(executionMode) ||
			canonicalArtifactStore === undefined ||
			typeof reviewBudgetLines !== "number" ||
			!Number.isFinite(reviewBudgetLines) ||
			reviewBudgetLines <= 0 ||
			typeof engramAvailable !== "boolean" ||
			typeof prompted !== "boolean"
		) {
			return undefined;
		}
		return {
			executionMode,
			artifactStore: canonicalArtifactStore,
			chainedPrStrategy: normalizeSddChainedPrStrategy(chainedPrStrategy),
			reviewBudgetLines: normalizeReviewBudgetValue(reviewBudgetLines) ?? DEFAULT_SDD_PREFLIGHT.reviewBudgetLines,
			engramAvailable,
			prompted,
		};
	} catch {
		return undefined;
	}
}

export function writeSddPreflightToDisk(cwd: string, prefs: SddPreflightPreferences): void {
	try {
		const path = sddPreflightDiskPath(cwd);
		const prompted = prefs.prompted === true;
		const canonical: SddPreflightPreferences = {
			executionMode: isSddExecutionMode(prefs.executionMode) ? prefs.executionMode : DEFAULT_SDD_PREFLIGHT.executionMode,
			artifactStore: normalizeSddArtifactStore(prefs.artifactStore) ?? DEFAULT_SDD_PREFLIGHT.artifactStore,
			chainedPrStrategy: normalizeSddChainedPrStrategy(prefs.chainedPrStrategy),
			reviewBudgetLines:
				normalizeReviewBudgetValue(prefs.reviewBudgetLines) ??
				DEFAULT_SDD_PREFLIGHT.reviewBudgetLines,
			engramAvailable: prefs.engramAvailable === true,
			prompted,
		};
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(canonical, null, 2));
	} catch {
		// Disk write failures are non-fatal; in-memory cache is the primary store
	}
}

function copyDirectoryFiles(
	sourceDir: string,
	targetDir: string,
	ownershipPrefix: string,
	force: boolean,
	manifest: ManagedAssetsManifest,
	legacyAssetHashes: (() => Readonly<Record<string, readonly string[]>>) | undefined,
): { copied: number; skipped: number } {
	if (!existsSync(sourceDir)) return { copied: 0, skipped: 0 };
	mkdirSync(targetDir, { recursive: true });
	let copied = 0;
	let skipped = 0;
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		const ownershipKey = `${ownershipPrefix}/${entry.name}`;
		if (entry.isDirectory()) {
			const child = copyDirectoryFiles(
				sourcePath,
				targetPath,
				ownershipKey,
				force,
				manifest,
				legacyAssetHashes,
			);
			copied += child.copied;
			skipped += child.skipped;
			continue;
		}
		if (!entry.isFile()) continue;
		const source = readFileSync(sourcePath, "utf8");
		let nextSource = source;
		if (existsSync(targetPath)) {
			if (!force) {
				skipped += 1;
				continue;
			}
			const managedHash = manifest.assets[ownershipKey];
			let installedContent: string | undefined;
			try {
				installedContent = readFileSync(targetPath, "utf8");
			} catch {
				installedContent = undefined;
			}
			const installedHash = installedContent === undefined
				? undefined
				: managedAssetHash(installedContent);
			if (managedHash === undefined) {
				const legacyHashes = legacyAssetHashes?.()[ownershipKey];
				const comparableLegacyHash = installedContent === undefined
					? undefined
					: managedAssetHash(
							legacyComparableAssetContent(ownershipKey, installedContent),
						);
				if (
					legacyHashes === undefined ||
					comparableLegacyHash === undefined ||
					!legacyHashes.includes(comparableLegacyHash)
				) {
					delete manifest.assets[ownershipKey];
					skipped += 1;
					continue;
				}
				nextSource = migrateLegacyAssetContent(
					ownershipKey,
					installedContent,
					source,
				);
			} else if (installedHash !== managedHash) {
				delete manifest.assets[ownershipKey];
				skipped += 1;
				continue;
			}
		}
		writeFileSync(targetPath, nextSource);
		manifest.assets[ownershipKey] = managedAssetHash(nextSource);
		copied += 1;
	}
	return { copied, skipped };
}

// Assets retired by gentle-pi#311 P5: the Pi-owned adversarial review actors.
// The refuter and validator verdicts now execute through Go-owned pi
// processes via provider-rendered self-contained vectors, so these agent
// definitions have no runtime consumer. The migration manifests under
// assets/migrations are append-only legacy-hash HISTORY (adoption evidence
// for force-installs) with no removal semantics, so history stays untouched
// and retirement happens here: an installed copy is deleted only when its
// content hash proves package ownership (current manifest or legacy
// history); user-modified copies are left in place and only lose managed
// ownership.
const RETIRED_MANAGED_ASSETS = Object.freeze([
	"agents/review-refuter.md",
	"agents/review-validator.md",
]);

function removeRetiredManagedAssets(
	agentHome: string,
	manifest: ManagedAssetsManifest,
): void {
	let legacyHashes: Record<string, readonly string[]> | undefined;
	for (const ownershipKey of RETIRED_MANAGED_ASSETS) {
		const installedPath = join(agentHome, ...ownershipKey.split("/"));
		if (!existsSync(installedPath)) {
			delete manifest.assets[ownershipKey];
			continue;
		}
		let installedContent: string | undefined;
		try {
			installedContent = readFileSync(installedPath, "utf8");
		} catch {
			installedContent = undefined;
		}
		if (installedContent === undefined) continue;
		const installedHash = managedAssetHash(installedContent);
		const managed = manifest.assets[ownershipKey] === installedHash;
		const legacy = (legacyHashes ??= readLegacyManagedAssetHashes())[ownershipKey]?.includes(
			managedAssetHash(legacyComparableAssetContent(ownershipKey, installedContent)),
		) === true;
		if (managed || legacy) {
			try {
				rmSync(installedPath);
			} catch {
				continue;
			}
		}
		// Managed copies are gone; user-modified copies stay but stop being
		// package-managed either way.
		delete manifest.assets[ownershipKey];
	}
}

export function installSddAssets(
	_cwd: string,
	force: boolean,
): { agents: number; chains: number; support: number; skipped: number; engramStamps: number } {
	const agentHome = gentlePiAgentHome();
	const manifestPath = join(agentHome, "gentle-ai", MANAGED_ASSETS_MANIFEST);
	let legacyAssetHashes: (() => Readonly<Record<string, readonly string[]>>) | undefined;
	if (force) {
		let cachedLegacyAssetHashes: Record<string, readonly string[]> | undefined;
		legacyAssetHashes = () =>
			(cachedLegacyAssetHashes ??= readLegacyManagedAssetHashes());
	}
	const manifest = readManagedAssetsManifest(manifestPath);
	removeRetiredManagedAssets(agentHome, manifest);
	const agents = copyDirectoryFiles(
		join(ASSETS_DIR, "agents"),
		join(agentHome, "agents"),
		"agents",
		force,
		manifest,
		legacyAssetHashes,
	);
	const chains = copyDirectoryFiles(
		join(ASSETS_DIR, "chains"),
		join(agentHome, "chains"),
		"chains",
		force,
		manifest,
		legacyAssetHashes,
	);
	const support = copyDirectoryFiles(
		join(ASSETS_DIR, "support"),
		join(agentHome, "gentle-ai", "support"),
		"gentle-ai/support",
		force,
		manifest,
		legacyAssetHashes,
	);
	const engramStamps = stampInstalledAgentsEngramCapability(
		join(agentHome, "agents"),
		resolveEngramExtensionEntry(agentHome),
		manifest,
	);
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	return {
		agents: agents.copied,
		chains: chains.copied,
		support: support.copied,
		skipped: agents.skipped + chains.skipped + support.skipped,
		engramStamps,
	};
}

/**
 * Stamp (or strip) the engram child-session capability line on package-managed
 * installed agent files. Only files whose content still matches the manifest
 * hash are touched, so user-edited agents stay untouched. Runs on every
 * install/refresh pass, so the stamp self-heals when gentle-engram is
 * installed or removed after the agents were copied.
 */
function stampInstalledAgentsEngramCapability(
	installedAgentsDir: string,
	engramExtensionEntry: string | undefined,
	manifest: ManagedAssetsManifest,
): number {
	if (!existsSync(installedAgentsDir)) return 0;
	let stamped = 0;
	for (const entry of readdirSync(installedAgentsDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const ownershipKey = `agents/${entry.name}`;
		const managedHash = manifest.assets[ownershipKey];
		if (managedHash === undefined) continue;
		const installedPath = join(installedAgentsDir, entry.name);
		let installed: string;
		try {
			installed = readFileSync(installedPath, "utf8");
		} catch {
			continue;
		}
		if (managedAssetHash(installed) !== managedHash) continue;
		const next = updateFrontmatterEngramCapability(installed, engramExtensionEntry);
		if (next === installed) continue;
		writeFileSync(installedPath, next);
		manifest.assets[ownershipKey] = managedAssetHash(next);
		stamped += 1;
	}
	return stamped;
}

export function isSddPreflightTrigger(text: string): boolean {
	const trimmed = text.trim();
	if (/^\/(?:gentle-)?sdd(?:[-:][^\s]*)?(?:\s|$)/i.test(trimmed)) return true;
	if (/[?？]\s*$/.test(trimmed)) return false;
	if (
		/\b(?:don't|do\s+not|not\s+use|never\s+use|without\s+using|sin\s+usar|no\s+(?:quiero|queremos|vamos\s+a)?\s*usar)\s+sdd\b/i.test(
			trimmed,
		)
	) {
		return false;
	}
	return [
		/^(?:please\s+)?(?:use|run|start)\s+(?:the\s+|an?\s+)?sdd(?:\s+(?:flow|process|workflow|plan))?\b/i,
		/^(?:please\s+)?(?:do|handle|implement)\b.+\b(?:with|using)\s+(?:the\s+|an?\s+)?sdd\b/i,
		/^(?:por\s+favor[\s,]+)?(?:vamos|vayamos)\s+con\s+(?:el\s+)?sdd\b/i,
		/^(?:por\s+favor[\s,]+)?(?:usa|usá|usemos|corre|corré|arranca|arrancá|inicia|iniciá|empeza|empezá)\s+(?:el\s+)?sdd\b/i,
		/^(?:por\s+favor[\s,]+)?(?:hacelo|hazlo|hacerlo)\s+(?:con|usando)\s+(?:el\s+)?sdd\b/i,
	].some((pattern) => pattern.test(trimmed));
}

export function sddPreflightSessionKey(ctx: ExtensionContext): string {
	// SAFETY: ExtensionContext's public type does not expose sessionManager; it is
	// probed opportunistically and absence falls back to ctx.cwd.
	const manager = (ctx as unknown as { sessionManager?: unknown }).sessionManager;
	if (isRecord(manager)) {
		const getSessionFile = manager.getSessionFile;
		if (typeof getSessionFile === "function") {
			const value = getSessionFile.call(manager);
			if (typeof value === "string" && value.length > 0) return value;
		}
		const getSessionId = manager.getSessionId;
		if (typeof getSessionId === "function") {
			const value = getSessionId.call(manager);
			if (typeof value === "string" && value.length > 0) return value;
		}
	}
	return ctx.cwd;
}

function hasWritableEngramTool(pi: ExtensionAPI): boolean {
	try {
		// SAFETY: ExtensionAPI's public type does not declare getActiveTools; presence
		// is probed at runtime and absence degrades to "engram unavailable".
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

export async function collectSddPreflightPreferences(
	ctx: ExtensionContext,
	engramAvailable: boolean,
	options: SddPreflightResolutionOptions = {},
): Promise<SddPreflightPreferences> {
	const persistedPrompted = options.persisted?.prompted === true;
	const allowExceptionOk = options.acceptSizeException === true;
	const persisted = normalizedSelections(options.persisted, engramAvailable, allowExceptionOk);
	const resolved: Partial<Record<SddPreflightField, unknown>> = { ...persisted };
	let prompted = persistedPrompted;
	let sizeExceptionAccepted = allowExceptionOk && persisted.chainedPrStrategy === "exception-ok";
	const promptFields = new Set(options.promptFields ?? []);

	const usePromptedValue = (
		field: SddPreflightField,
		value: unknown,
	): void => {
		const candidate = normalizedSelections({ [field]: value }, engramAvailable, allowExceptionOk);
		if (candidate[field] !== undefined) {
			resolved[field] = candidate[field];
			if (field === "chainedPrStrategy" && candidate[field] === "exception-ok") sizeExceptionAccepted = true;
			prompted = true;
		}
	};

	const promptField = async (
		field: SddPreflightField,
		read: () => Promise<unknown>,
		enabled = true,
	): Promise<void> => {
		if (ctx.hasUI && enabled && promptFields.has(field)) {
			usePromptedValue(field, await read());
		}
	};
	const artifactOptions = engramAvailable ? ["openspec", "engram", "hybrid"] : ["openspec"];
	await promptField("executionMode", () => ctx.ui.select("SDD execution mode", ["interactive", "auto"]));
	await promptField("artifactStore", () => ctx.ui.select("SDD artifact store", artifactOptions), artifactOptions.length > 1);
	await promptField("chainedPrStrategy", () => ctx.ui.select("SDD delivery strategy", ["ask-on-risk", "auto-chain", "single-pr"]));
	await promptField("reviewBudgetLines", () => ctx.ui.input("SDD review budget lines", String(DEFAULT_SDD_PREFLIGHT.reviewBudgetLines)));

	const resolvedValue = <T>(field: SddPreflightField, fallback: T): T =>
		(resolved[field] as T | undefined) ?? fallback;
	return {
		executionMode: resolvedValue("executionMode", DEFAULT_SDD_PREFLIGHT.executionMode),
		artifactStore: resolvedValue("artifactStore", DEFAULT_SDD_PREFLIGHT.artifactStore),
		chainedPrStrategy: resolvedValue("chainedPrStrategy", DEFAULT_SDD_PREFLIGHT.chainedPrStrategy),
		reviewBudgetLines: resolvedValue("reviewBudgetLines", DEFAULT_SDD_PREFLIGHT.reviewBudgetLines),
		engramAvailable,
		prompted,
		...(sizeExceptionAccepted ? { sizeExceptionAccepted: true as const } : {}),
	};
}

export function renderSddPreflightPrompt(prefs: SddPreflightPreferences): string {
	const deliveryStrategy = normalizeSddChainedPrStrategy(
		prefs.chainedPrStrategy,
		prefs.sizeExceptionAccepted === true,
	);
	const sourceLine = prefs.prompted
		? "These SDD preferences are explicit current-session choices. Reuse them unless the user explicitly changes them."
		: "These SDD preferences are canonical defaults or persisted choices. Treat them as authoritative; do not revisit dependent decisions unless a genuine human-control gate is reached.";
	const interactiveRules =
		prefs.executionMode === "interactive"
			? [
					"- Interactive phase gate: complete only the current SDD phase. Do not start the next SDD phase unless the current user turn explicitly approves that next phase.",
					"- In interactive mode, words like `continue`, `dale`, or `go on` approve only the immediate next phase, not all remaining phases.",
					"- Before writing an SDD proposal in interactive mode, offer the user a proposal question round to improve the PRD/proposal by uncovering business rules, implications, impact, edge cases, product tradeoffs, and decision gaps. Prefer 3–5 concrete product questions per round, then summarize assumptions and ask whether the user wants corrections or a second question round. Do not ask about test commands, PR shape, changed-line budget, or other harness mechanics at proposal time unless the user explicitly asks to discuss delivery.",
				]
			: [
					"- Auto mode: phases may run back-to-back only because the user chose speed and trusts the flow.",
				];
	return [
		"## SDD Session Preflight",
		sourceLine,
		`- Execution mode: ${prefs.executionMode}`,
		`- Artifact store: ${prefs.artifactStore}${prefs.engramAvailable ? "" : " (Engram unavailable in this session)"}`,
		`- Delivery strategy: ${deliveryStrategy}`,
		"- Delivery strategy domain: `ask-on-risk` | `auto-chain` | `single-pr` | `exception-ok`",
		`- Review budget: ${prefs.reviewBudgetLines} changed lines (400 is the canonical threshold unless explicitly changed)`,
		"- Chain strategy: deferred until chaining is selected.",
		"- `exception-ok` is never inferred; it requires explicit acceptance of `size:exception`.",
		...interactiveRules,
		"- Preserve human-controlled consent, authorization, security, destructive/publishing, ambiguous-scope, and `size:exception` gates.",
		"- When review-budget risk requires a delivery decision, use `ask-on-risk` to pause and ask; do not invent a chain strategy or an exception.",
	].join("\n");
}

export async function ensureSddPreflight(
	ctx: ExtensionContext,
	callbacks: SddPreflightCallbacks,
	resolutionOptions: SddPreflightResolutionOptions = {},
): Promise<SddPreflightPreferences> {
	const sessionKey = sddPreflightSessionKey(ctx);
	const existing = sddPreflightBySession.get(sessionKey);
	if (existing && !(resolutionOptions.promptFields?.length ?? 0)) return existing;
	const inFlight = sddPreflightInFlight.get(sessionKey);
	if (inFlight && !(resolutionOptions.promptFields?.length ?? 0)) return inFlight;
	const promise = (async () => {
		const engramAvailable = hasWritableEngramTool(callbacks.pi);
		const persisted = resolutionOptions.persisted ?? readSddPreflightFromDisk(ctx.cwd);
		const prefs = await collectSddPreflightPreferences(ctx, engramAvailable, {
			...resolutionOptions,
			persisted,
		});
		const result =
			(await callbacks.installAssets?.(ctx.cwd)) ??
			installSddAssets(ctx.cwd, false);
		const modelResult = (await callbacks.applyModelConfig?.(ctx.cwd)) ?? {
			updated: 0,
			skipped: 0,
		};
		if (ctx.hasUI) {
			const modelRoutingLine = modelResult.invalidPath
				? `Model routing skipped: ${modelResult.invalidPath} is invalid JSON or not an object.`
				: `Model-routed agents updated: ${modelResult.updated}`;
			ctx.ui.notify(
				[
					"Gentle AI SDD preflight complete.",
					`Mode: ${prefs.executionMode}`,
					`Artifacts: ${prefs.artifactStore}`,
					`Delivery strategy: ${prefs.chainedPrStrategy}`,
					`Review budget: ${prefs.reviewBudgetLines} changed lines`,
					`Preference source: ${prefs.prompted ? "explicit session choice" : "canonical default or persisted preference"}`,
					`Global SDD assets ready: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} already present.`,
					modelRoutingLine,
				].join("\n"),
				modelResult.invalidPath ? "warning" : "info",
			);
		}
		sddPreflightBySession.set(sessionKey, prefs);
		writeSddPreflightToDisk(ctx.cwd, prefs);
		return prefs;
	})();
	sddPreflightInFlight.set(sessionKey, promise);
	try {
		return await promise;
	} finally {
		sddPreflightInFlight.delete(sessionKey);
	}
}

export function getSddPreflightPreferences(
	ctx: ExtensionContext,
): SddPreflightPreferences | undefined {
	const sessionKey = sddPreflightSessionKey(ctx);
	const cached = sddPreflightBySession.get(sessionKey);
	if (cached) return cached;
	// Cache miss: check the durable disk store (survives restarts and non-SDD agent starts)
	const persisted = readSddPreflightFromDisk(ctx.cwd);
	if (persisted) {
		sddPreflightBySession.set(sessionKey, persisted);
		return persisted;
	}
	return undefined;
}
