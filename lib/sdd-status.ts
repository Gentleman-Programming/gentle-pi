import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
	detectActiveDomainCollisions,
	detectLegacyFlatSpec,
	type DomainCollision,
} from "./openspec-guardrails.ts";

export type SddArtifactStore = "openspec" | "engram" | "both" | "none";
export type ArtifactState = "missing" | "done" | "partial";
export type DependencyState = "blocked" | "ready" | "all_done" | "not_applicable";
export type ApplyState = "blocked" | "ready" | "all_done" | "not_applicable";
export type SddPhase = "apply" | "verify" | "sync" | "archive";

export interface SddArtifactPaths {
	proposal: string[];
	specs: string[];
	design: string[];
	tasks: string[];
	applyProgress: string[];
	verifyReport: string[];
	syncReport: string[];
}

export interface SddTaskProgress {
	total: number;
	complete: number;
	remaining: number;
	unchecked: string[];
}

const SDD_TASK_OWNER = {
	IMPLEMENTATION: "implementation",
	PARENT: "parent",
} as const;

type SddTaskOwner = (typeof SDD_TASK_OWNER)[keyof typeof SDD_TASK_OWNER];

interface SddTaskAccounting {
	implementation: SddTaskProgress;
	parent: SddTaskProgress;
	errors: string[];
}

const EMPTY_TASK_PROGRESS: SddTaskProgress = {
	total: 0,
	complete: 0,
	remaining: 0,
	unchecked: [],
};

export interface SddActionContext {
	mode: "repo-local";
	workspaceRoot: string;
	allowedEditRoots: string[];
	warnings: string[];
}

export interface SddDomainCollisionReport {
	domain: string;
	changes: DomainCollision[];
}

export interface SddPhaseInstructions {
	apply: string[];
	verify: string[];
	sync: string[];
	archive: string[];
}

export interface SddRelationships {
	dependsOn: string[];
	supersedes: string[];
	amends: string[];
	conflictsWith: string[];
	sameDomainActiveChanges: SddDomainCollisionReport[];
}

export interface SddStatus {
	schemaName: "gentle-pi.sdd-status";
	schemaVersion: 1;
	changeName: string | null;
	artifactStore: SddArtifactStore;
	planningHome: { root: string; changesDir: string };
	changeRoot: string | null;
	artifactPaths: SddArtifactPaths;
	contextFiles: SddArtifactPaths;
	artifacts: Record<keyof SddArtifactPaths, ArtifactState>;
	/** Implementation-owned progress; malformed markers remain unresolved here. */
	taskProgress: SddTaskProgress;
	/** Visible parent/orchestrator lifecycle actions, excluded from apply completion. */
	deferredParentActions: SddTaskProgress;
	/** Stable diagnostics for malformed ownership markers. */
	taskArtifactErrors: string[];
	applyState: ApplyState;
	dependencies: Record<SddPhase, DependencyState>;
	actionContext: SddActionContext;
	relationships: SddRelationships;
	collisions: SddDomainCollisionReport[];
	legacyFlatSpec?: { path: string; hasDomainSpecs: boolean };
	nextRecommended: string;
	instructions?: SddPhaseInstructions;
	blockedReasons: string[];
	/**
	 * True when the native status engine is not authoritative for the selected
	 * artifact store (engram, none, or both without an openspec/ directory).
	 * When true, `dependencies`, `applyState`, and `blockedReasons` must not be
	 * treated as real blockers — resolve readiness from Engram instead.
	 * Defaults to false on all authoritative (openspec / both-with-disk) paths.
	 */
	isNonAuthoritative: boolean;
}

export interface ValidatedReviewAuthorityResolution {
	activeAuthorityId: string;
}

/**
 * Optional controller-owned recovery overlay. Status never infers authority from
 * OpenSpec artifacts: callers opt in only when a repository review binding exists.
 */
export interface SddReviewAuthorityOverlay {
	expected: boolean;
	resolve: () => ValidatedReviewAuthorityResolution | undefined;
}

/** Read-only native bound-change evidence supplied by the controller. */
export interface NativeReviewReadinessOverlay {
	expected: boolean;
	ready: boolean;
	lineageId?: string;
	bindingRevision?: string;
	reason?: string;
}

export interface ResolveSddStatusOptions {
	cwd: string;
	changeName?: string;
	includeInstructions?: boolean;
	workspaceRoot?: string;
	artifactStore?: SddArtifactStore;
	reviewAuthority?: SddReviewAuthorityOverlay;
	nativeReviewReadiness?: NativeReviewReadinessOverlay;
}

const EMPTY_PATHS: SddArtifactPaths = {
	proposal: [],
	specs: [],
	design: [],
	tasks: [],
	applyProgress: [],
	verifyReport: [],
	syncReport: [],
};

function safeDirectories(path: string): string[] {
	try {
		return readdirSync(path)
			.filter((entry) => {
				try {
					return statSync(join(path, entry)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort();
	} catch {
		return [];
	}
}

function safeRead(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function hasContent(path: string): boolean {
	return existsSync(path) && safeRead(path).trim().length > 0;
}

function singleFileState(paths: string[]): ArtifactState {
	if (paths.length === 0) return "missing";
	return paths.some((path) => !hasContent(path)) ? "partial" : "done";
}

function multiFileState(paths: string[], partial = false): ArtifactState {
	if (paths.length === 0) return partial ? "partial" : "missing";
	return paths.some((path) => !hasContent(path)) || partial ? "partial" : "done";
}

function findSpecFiles(specsDir: string): string[] {
	const files: string[] = [];
	function walk(dir: string): void {
		for (const entry of safeDirectories(dir)) {
			const path = join(dir, entry);
			const specPath = join(path, "spec.md");
			if (existsSync(specPath)) files.push(specPath);
			walk(path);
		}
	}
	walk(specsDir);
	return files.sort();
}

function domainFromSpecPath(changeRoot: string, specPath: string): string | undefined {
	const rel = relative(join(changeRoot, "specs"), specPath).split(/[\\/]/);
	return rel.length >= 2 && rel.at(-1) === "spec.md" ? rel.slice(0, -1).join("/") : undefined;
}

function taskProgress(lines: string[]): SddTaskProgress {
	const unchecked = lines.filter((line) => !/^\s*- \[[xX]\]/.test(line));
	return {
		total: lines.length,
		complete: lines.length - unchecked.length,
		remaining: unchecked.length,
		unchecked: unchecked.map((line) => line.trim()),
	};
}

function countTasks(tasksPath: string | undefined): SddTaskAccounting {
	if (!tasksPath || !existsSync(tasksPath)) {
		return { implementation: { ...EMPTY_TASK_PROGRESS }, parent: { ...EMPTY_TASK_PROGRESS }, errors: [] };
	}
	const implementation: string[] = [];
	const malformed: string[] = [];
	const parent: string[] = [];
	const errors: string[] = [];
	for (const rawLine of safeRead(tasksPath).split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (!/^\s*- \[(?: |x|X)\]/.test(line)) continue;
		const markers = line.match(/<!--\s*sdd-owner\s*:[\s\S]*?-->/gi) ?? [];
		const hasOwnerToken = /sdd-owner/i.test(line);
		const canonical = /<!-- sdd-owner: (implementation|parent) -->\s*$/.exec(line);
		const owner: SddTaskOwner | undefined = canonical?.[1] as SddTaskOwner | undefined;
		if (!hasOwnerToken) {
			implementation.push(line);
		} else if (markers.length === 1 && canonical && canonical[0] === markers[0]) {
			(owner === SDD_TASK_OWNER.PARENT ? parent : implementation).push(line);
		} else {
			malformed.push(line);
			errors.push(`Malformed task ownership marker: ${line.trim()}`);
		}
	}
	const implementationProgress = taskProgress(implementation);
	return {
		implementation: {
			total: implementationProgress.total + malformed.length,
			complete: implementationProgress.complete,
			remaining: implementationProgress.remaining + malformed.length,
			unchecked: [...implementationProgress.unchecked, ...malformed.map((line) => line.trim())],
		},
		parent: taskProgress(parent),
		errors,
	};
}

function reportIsClearlyPassing(path: string | undefined): boolean {
	if (!path || !hasContent(path)) return false;
	const text = safeRead(path);
	const hasBlocker = /(^|\b)(FAIL|FAILED|BLOCKED|CRITICAL|PENDING|TODO)(\b|:)|verification blockers?|not\s+(?:pass|passed|passing|successful|complete|completed)|(?:pass|passed|success|successful|complete|completed)\s*:\s*no\b/i.test(text);
	const hasPassSignal = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.some((line) =>
			/^(?:(?:status|verdict|result|verification|sync|final(?:\s+verdict)?)\s*:\s*)?(?:PASS|PASSED|SUCCESS|SUCCESSFUL)$/i.test(line) ||
			/^all checks passed\.?$/i.test(line) ||
			/^ready for archive\.?$/i.test(line) ||
			/^sync completed?\.?$/i.test(line),
		);
	return hasPassSignal && !hasBlocker;
}

function withRecoveryBlock(status: SddStatus, reviewAuthority?: SddReviewAuthorityOverlay, nativeReviewReadiness?: NativeReviewReadinessOverlay): SddStatus {
	if (nativeReviewReadiness?.expected && !nativeReviewReadiness.ready) {
		const reason = `resolve-review: ${nativeReviewReadiness.reason ?? "native bound review readiness is unavailable."}`;
		return {
			...status,
			applyState: "blocked",
			dependencies: { apply: "blocked", verify: "blocked", sync: "blocked", archive: "blocked" },
			nextRecommended: "resolve-review",
			blockedReasons: status.blockedReasons.includes(reason) ? status.blockedReasons : [...status.blockedReasons, reason],
		};
	}
	if (!reviewAuthority?.expected) return status;
	try {
		const resolved = reviewAuthority.resolve();
		if (resolved?.activeAuthorityId) return status;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const reason = `resolve-review: ${message}`;
		return {
			...status,
			applyState: "blocked",
			dependencies: { apply: "blocked", verify: "blocked", sync: "blocked", archive: "blocked" },
			nextRecommended: "resolve-review",
			blockedReasons: status.blockedReasons.includes(reason) ? status.blockedReasons : [...status.blockedReasons, reason],
		};
	}
	const reason = "resolve-review: validated active review authority is missing.";
	return {
		...status,
		applyState: "blocked",
		dependencies: { apply: "blocked", verify: "blocked", sync: "blocked", archive: "blocked" },
		nextRecommended: "resolve-review",
		blockedReasons: status.blockedReasons.includes(reason) ? status.blockedReasons : [...status.blockedReasons, reason],
	};
}

function emptyStatus(cwd: string, changeName: string | null, blockedReasons: string[], artifactStore: SddArtifactStore = "openspec", isNonAuthoritative = false, reviewAuthority?: SddReviewAuthorityOverlay): SddStatus {
	const root = resolve(cwd);
	const changesDir = join(root, "openspec", "changes");
	const actionContext: SddActionContext = {
		mode: "repo-local",
		workspaceRoot: root,
		allowedEditRoots: [root],
		warnings: [],
	};
	return withRecoveryBlock({
		schemaName: "gentle-pi.sdd-status",
		schemaVersion: 1,
		changeName,
		artifactStore,
		planningHome: { root, changesDir },
		changeRoot: null,
		artifactPaths: { ...EMPTY_PATHS },
		contextFiles: { ...EMPTY_PATHS },
		artifacts: {
			proposal: "missing",
			specs: "missing",
			design: "missing",
			tasks: "missing",
			applyProgress: "missing",
			verifyReport: "missing",
			syncReport: "missing",
		},
		taskProgress: { ...EMPTY_TASK_PROGRESS },
		deferredParentActions: { ...EMPTY_TASK_PROGRESS },
		taskArtifactErrors: [],
		applyState: "blocked",
		dependencies: { apply: "blocked", verify: "blocked", sync: "blocked", archive: "blocked" },
		actionContext,
		relationships: {
			dependsOn: [],
			supersedes: [],
			amends: [],
			conflictsWith: [],
			sameDomainActiveChanges: [],
		},
		collisions: [],
		nextRecommended: blockedReasons[0] ?? "Start an SDD change.",
		blockedReasons,
		isNonAuthoritative,
	}, reviewAuthority, undefined);
}

export function listActiveOpenSpecChanges(cwd: string): string[] {
	return safeDirectories(join(cwd, "openspec", "changes")).filter(
		(change) => change !== "archive",
	);
}

export function renderPhaseInstructions(status: SddStatus): SddPhaseInstructions {
	const change = status.changeName ?? "<unresolved>";
	if (status.applyState === "not_applicable") {
		return {
			apply: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
			verify: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
			sync: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
			archive: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
		};
	}
	return {
		apply: [
			`Change: ${change}`,
			`State: ${status.dependencies.apply}`,
			status.applyState === "all_done"
				? "All implementation tasks are checked complete; do not edit."
				: "Implement only unchecked implementation-owned tasks from the tasks artifact.",
			`Implementation tasks: ${status.taskProgress.complete}/${status.taskProgress.total} complete`,
			"Update persisted task checkboxes for implementation-owned tasks immediately after completing each task.",
			...status.taskProgress.unchecked.map((line) => `Remaining implementation task: ${line}`),
			`Deferred parent lifecycle actions: ${status.deferredParentActions.complete}/${status.deferredParentActions.total} complete`,
			...status.deferredParentActions.unchecked.map((line) => `Deferred parent action: ${line}`),
			...status.taskArtifactErrors.map((error) => `Task artifact error: ${error}`),
		],
		verify: [
			`Change: ${change}`,
			`State: ${status.dependencies.verify}`,
			"Verify task completion, spec coverage, implementation correctness, design coherence, and tests when available.",
			"Unchecked implementation tasks are CRITICAL archive blockers.",
			...status.taskProgress.unchecked.map((line) => `Unchecked blocker: ${line}`),
		],
		sync: [
			`Change: ${change}`,
			`State: ${status.dependencies.sync}`,
			"Sync delta specs into openspec/specs only after verification is clean.",
			...status.artifactPaths.specs.map((path) => `Delta spec: ${path}`),
			...status.collisions.flatMap((collision) =>
				collision.changes.map((item) =>
					`Same-domain collision: ${collision.domain} also touched by ${item.change} (${item.path})`,
				),
			),
		],
		archive: [
			`Change: ${change}`,
			`State: ${status.dependencies.archive}`,
			"Archive only after clean verify, completed sync, and zero unchecked implementation tasks.",
			"CRITICAL verification issues have no override.",
			status.changeRoot
				? `Archive target: ${join(status.planningHome.changesDir, "archive", `YYYY-MM-DD-${change}`)}`
				: "Archive target unavailable until change is resolved.",
		],
	};
}

/**
 * Build the single canonical non-authoritative SddStatus.
 * All non-authoritative return sites must call this instead of constructing by hand.
 */
function nonAuthoritativeStatus(cwd: string, changeName: string | null, store: SddArtifactStore, includeInstructions?: boolean): SddStatus {
	const root = resolve(cwd);
	const actionContext: SddActionContext = {
		mode: "repo-local",
		workspaceRoot: root,
		allowedEditRoots: [root],
		warnings: [],
	};
	const status: SddStatus = {
		schemaName: "gentle-pi.sdd-status",
		schemaVersion: 1,
		changeName,
		artifactStore: store,
		planningHome: { root, changesDir: "" },
		changeRoot: null,
		artifactPaths: { ...EMPTY_PATHS },
		contextFiles: { ...EMPTY_PATHS },
		artifacts: {
			proposal: "missing",
			specs: "missing",
			design: "missing",
			tasks: "missing",
			applyProgress: "missing",
			verifyReport: "missing",
			syncReport: "missing",
		},
		taskProgress: { ...EMPTY_TASK_PROGRESS },
		deferredParentActions: { ...EMPTY_TASK_PROGRESS },
		taskArtifactErrors: [],
		applyState: "not_applicable",
		dependencies: { apply: "not_applicable", verify: "not_applicable", sync: "not_applicable", archive: "not_applicable" },
		actionContext,
		relationships: {
			dependsOn: [],
			supersedes: [],
			amends: [],
			conflictsWith: [],
			sameDomainActiveChanges: [],
		},
		collisions: [],
		nextRecommended: "resolve-via-engram",
		blockedReasons: [],
		isNonAuthoritative: true,
	};
	if (includeInstructions) status.instructions = renderPhaseInstructions(status);
	return status;
}

export function resolveSddStatus(options: ResolveSddStatusOptions): SddStatus {
	// Safety net: when the store is unknown (undefined) and there is no openspec/ directory
	// on disk, don't emit the openspec "no changes / blocked" status — it would be a false
	// block for an engram or none session that hasn't been identified yet. Treat it as
	// non-authoritative instead. A genuine openspec session will have the directory.
	const hasOpenSpecDir = existsSync(join(resolve(options.cwd), "openspec"));
	const store: SddArtifactStore =
		options.artifactStore ?? (hasOpenSpecDir ? "openspec" : "none");

	// Single decision point: non-authoritative when the disk engine cannot resolve authoritatively.
	// Cases:
	//   - store engram or none: always non-authoritative (no disk backing)
	//   - store both, no openspec/ dir: non-authoritative (no disk to scan)
	// The both-with-openspec cases are handled below after listing active changes.
	if (store === "engram" || store === "none" || (store === "both" && !hasOpenSpecDir)) {
		const changeName = options.changeName?.trim() || null;
		return nonAuthoritativeStatus(options.cwd, changeName, store, options.includeInstructions);
	}

	const root = resolve(options.cwd);
	const changesDir = join(root, "openspec", "changes");
	const activeChanges = listActiveOpenSpecChanges(root);
	let changeName = options.changeName?.trim() || "";
	const blockedReasons: string[] = [];

	if (!changeName) {
		if (activeChanges.length === 1) {
			changeName = activeChanges[0];
		} else if (activeChanges.length === 0) {
			// store both + openspec/ present + zero active changes + no changeName:
			// The change may live only in Engram — non-authoritative, not a false block.
			// Pure openspec with zero changes is a real block (run sdd-new).
			if (store === "both") {
				return nonAuthoritativeStatus(options.cwd, null, store, options.includeInstructions);
			}
			return emptyStatus(root, null, ["No active SDD changes found."], store, false, options.reviewAuthority);
		} else {
			// Multiple active changes and no changeName: legit selection prompt (changes DO exist
			// on disk). Keep the existing authoritative ambiguous-selection behavior for both stores.
			return emptyStatus(root, null, [
				`Change selection is ambiguous: ${activeChanges.join(", ")}.`,
			], store, false, options.reviewAuthority);
		}
	}

	if (!activeChanges.includes(changeName)) {
		// store both + openspec/ present + named change NOT found on disk:
		// The change may live only in Engram — non-authoritative.
		// Pure openspec still blocks (legit "run sdd-new").
		if (store === "both") {
			return nonAuthoritativeStatus(options.cwd, changeName, store, options.includeInstructions);
		}
		return emptyStatus(root, changeName, [`Active change not found: ${changeName}.`], store, false, options.reviewAuthority);
	}

	const changeRoot = join(changesDir, changeName);
	const proposal = join(changeRoot, "proposal.md");
	const design = join(changeRoot, "design.md");
	const tasks = join(changeRoot, "tasks.md");
	const applyProgress = join(changeRoot, "apply-progress.md");
	const verifyReport = join(changeRoot, "verify-report.md");
	const syncReport = join(changeRoot, "sync-report.md");
	const specFiles = findSpecFiles(join(changeRoot, "specs"));
	const legacyFlatSpec = detectLegacyFlatSpec(root, changeName);
	const flatOnly = Boolean(legacyFlatSpec && specFiles.length === 0);

	const artifactPaths: SddArtifactPaths = {
		proposal: existsSync(proposal) ? [proposal] : [],
		specs: specFiles,
		design: existsSync(design) ? [design] : [],
		tasks: existsSync(tasks) ? [tasks] : [],
		applyProgress: existsSync(applyProgress) ? [applyProgress] : [],
		verifyReport: existsSync(verifyReport) ? [verifyReport] : [],
		syncReport: existsSync(syncReport) ? [syncReport] : [],
	};
	const artifacts = {
		proposal: singleFileState(artifactPaths.proposal),
		specs: multiFileState(artifactPaths.specs, flatOnly),
		design: singleFileState(artifactPaths.design),
		tasks: singleFileState(artifactPaths.tasks),
		applyProgress: singleFileState(artifactPaths.applyProgress),
		verifyReport: singleFileState(artifactPaths.verifyReport),
		syncReport: singleFileState(artifactPaths.syncReport),
	} satisfies SddStatus["artifacts"];
	const taskAccounting = countTasks(artifactPaths.tasks[0]);
	const taskProgress = taskAccounting.implementation;
	const actionContext: SddActionContext = {
		mode: "repo-local",
		workspaceRoot: options.workspaceRoot ? resolve(options.workspaceRoot) : root,
		allowedEditRoots: [options.workspaceRoot ? resolve(options.workspaceRoot) : root],
		warnings: [],
	};

	const collisions = specFiles
		.map((path) => domainFromSpecPath(changeRoot, path))
		.filter((domain): domain is string => Boolean(domain))
		.map((domain) => ({
			domain,
			changes: detectActiveDomainCollisions(root, changeName, domain).sort((a, b) =>
				a.change.localeCompare(b.change),
			),
		}))
		.filter((collision) => collision.changes.length > 0);

	if (artifacts.proposal === "missing") blockedReasons.push("proposal.md is missing.");
	if (artifacts.proposal === "partial") blockedReasons.push("proposal.md is empty or partial.");
	if (artifacts.specs !== "done") blockedReasons.push("domain specs are missing or partial.");
	if (artifacts.design === "missing") blockedReasons.push("design.md is missing.");
	if (artifacts.design === "partial") blockedReasons.push("design.md is empty or partial.");
	if (artifacts.tasks === "missing") blockedReasons.push("tasks.md is missing.");
	if (artifacts.tasks === "partial") blockedReasons.push("tasks.md is empty or partial.");
	if (artifacts.tasks === "done" && taskProgress.total === 0) {
		blockedReasons.push("tasks.md has no implementation task checkboxes.");
	}
	blockedReasons.push(...taskAccounting.errors);
	if (flatOnly && legacyFlatSpec) {
		blockedReasons.push(`Legacy flat spec is present without domain specs: ${legacyFlatSpec.path}.`);
	}

	// Planning-only status remains filesystem-read-only: do not invoke a resolver
	// unless the controller has established that review authority is expected.
	if (options.reviewAuthority?.expected) {
		try {
			const resolved = options.reviewAuthority.resolve();
			if (!resolved || typeof resolved.activeAuthorityId !== "string" || resolved.activeAuthorityId.length === 0) {
				blockedReasons.push("resolve-review: validated active review authority is missing.");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			blockedReasons.push(`resolve-review: ${message}`);
		}
	}
	if (options.nativeReviewReadiness?.expected && !options.nativeReviewReadiness.ready) {
		blockedReasons.push(`resolve-review: ${options.nativeReviewReadiness.reason ?? "native bound review readiness is unavailable."}`);
	}

	const coreArtifactsReady = artifacts.proposal === "done" && artifacts.specs === "done" && artifacts.design === "done" && artifacts.tasks === "done" && taskProgress.total > 0 && !flatOnly;
	const reviewBlocked = blockedReasons.some((reason) => reason.startsWith("resolve-review:"));
	const taskArtifactBlocked = taskAccounting.errors.length > 0;
	const reviewApproved = Boolean((options.reviewAuthority?.expected || options.nativeReviewReadiness?.expected) && !reviewBlocked);
	const applyState: ApplyState = !coreArtifactsReady || reviewBlocked || taskArtifactBlocked
		? "blocked"
		: taskProgress.remaining === 0
			? "all_done"
			: "ready";
	const parentLifecycleRequired = applyState === "all_done" && !reviewApproved;
	const verifyClean = reportIsClearlyPassing(artifactPaths.verifyReport[0]);
	const syncClean = reportIsClearlyPassing(artifactPaths.syncReport[0]);
	const syncPrerequisitesReady = coreArtifactsReady && verifyClean && collisions.length === 0 && !flatOnly;
	const syncState: DependencyState = syncPrerequisitesReady
		? syncClean
			? "all_done"
			: "ready"
		: "blocked";
	const verifyState: DependencyState = verifyClean
		? "all_done"
		: reviewApproved && artifacts.tasks === "done" && taskProgress.total > 0 && (artifacts.applyProgress === "done" || applyState === "all_done")
			? "ready"
			: "blocked";
	const dependencies: SddStatus["dependencies"] = {
		apply: applyState === "blocked" ? "blocked" : applyState,
		verify: verifyState,
		sync: syncState,
		archive: coreArtifactsReady && reviewApproved && verifyClean && syncClean && taskProgress.remaining === 0 && taskAccounting.parent.remaining === 0 && !reviewBlocked && !taskArtifactBlocked ? "ready" : "blocked",
	};
	const archiveReady = dependencies.archive === "ready";
	const nextRecommended = reviewBlocked
		? "resolve-review"
		: taskArtifactBlocked
			? "fix-task-ownership-marker"
			: parentLifecycleRequired
				? "parent-lifecycle"
				: dependencies.apply === "ready"
					? "sdd-apply"
					: dependencies.verify === "ready"
						? "sdd-verify"
						: dependencies.sync === "ready"
							? "sdd-sync"
							: archiveReady
								? "sdd-archive"
								: blockedReasons[0] ?? "Resolve blockers.";

	const status: SddStatus = {
		schemaName: "gentle-pi.sdd-status",
		schemaVersion: 1,
		changeName,
		artifactStore: store,
		planningHome: { root, changesDir },
		changeRoot,
		artifactPaths,
		contextFiles: artifactPaths,
		artifacts,
		taskProgress,
		deferredParentActions: taskAccounting.parent,
		taskArtifactErrors: taskAccounting.errors,
		applyState,
		dependencies,
		actionContext,
		relationships: {
			dependsOn: [],
			supersedes: [],
			amends: [],
			conflictsWith: [],
			sameDomainActiveChanges: collisions,
		},
		collisions,
		legacyFlatSpec: legacyFlatSpec
			? { path: legacyFlatSpec.path, hasDomainSpecs: specFiles.length > 0 }
			: undefined,
		nextRecommended,
		blockedReasons,
		isNonAuthoritative: false,
	};
	const resolvedStatus = withRecoveryBlock(status, options.reviewAuthority, options.nativeReviewReadiness);
	if (options.includeInstructions) resolvedStatus.instructions = renderPhaseInstructions(resolvedStatus);
	return resolvedStatus;
}

export function isNonAuthoritativeStatus(status: SddStatus): boolean {
	return status.isNonAuthoritative;
}

export function renderNativeSddPhasePrompt(status: SddStatus, phase?: SddPhase): string {
	const selectedInstructions = phase ? status.instructions?.[phase] : undefined;
	const isNonAuthoritative = isNonAuthoritativeStatus(status);
	const authorityLine = isNonAuthoritative
		? `This status is non-authoritative (artifact store: ${status.artifactStore}). The orchestrator must resolve readiness from Engram instead.`
		: "The parent/orchestrator resolved this status deterministically. Treat it as authoritative over prompt inference.";
	const blockLine = isNonAuthoritative
		? `Do not block phase work based on this status — resolve readiness from Engram using the injected Engram memory read tools on the change topic keys (sdd/{change}/proposal, sdd/{change}/spec, sdd/{change}/design, sdd/{change}/tasks, etc.) instead.`
		: "Do not run phase work when this status marks the phase blocked; return the blockers instead.";
	return [
		"## Native SDD Status Engine",
		authorityLine,
		blockLine,
		...(phase && selectedInstructions
			? ["", `### ${phase} instructions`, ...selectedInstructions.map((line) => `- ${line}`)]
			: []),
		"",
		"```json",
		JSON.stringify(status, null, 2),
		"```",
	].join("\n");
}

export function renderSddDispatcherMarkdown(status: SddStatus): string {
	const isNonAuthoritative = isNonAuthoritativeStatus(status);
	const statusSection = isNonAuthoritative
		? [
				"### Non-authoritative store — resolve via Engram",
				`This status is non-authoritative (artifact store: ${status.artifactStore}).`,
				"Resolve readiness directly from Engram using the injected Engram memory read tools on the change topic keys:",
				`- sdd/${status.changeName ?? "<change>"}/proposal`,
				`- sdd/${status.changeName ?? "<change>"}/spec`,
				`- sdd/${status.changeName ?? "<change>"}/design`,
				`- sdd/${status.changeName ?? "<change>"}/tasks`,
				`- sdd/${status.changeName ?? "<change>"}/apply-progress (if present)`,
				`- sdd/${status.changeName ?? "<change>"}/verify-report (if present)`,
				"Do not treat blockedReasons or dependency states from this status as real blockers.",
			].join("\n")
		: status.blockedReasons.length > 0
			? ["### Blocked", ...status.blockedReasons.map((reason) => `- ${reason}`)].join("\n")
			: "### Ready\nThe next phase may be delegated with the attached status JSON and phase instructions.";
	// For non-authoritative status, skip the unsafe SddPhase cast on nextRecommended
	const instructionsSection = isNonAuthoritative
		? []
		: (status.instructions?.[status.nextRecommended.replace(/^sdd-/, "") as SddPhase] ?? []).map(
				(line) => `- ${line}`,
			);
	return [
		`## Native SDD Dispatcher: ${status.changeName ?? "unresolved"}`,
		"",
		`nextPhase: ${status.nextRecommended}`,
		`apply: ${status.dependencies.apply}`,
		`verify: ${status.dependencies.verify}`,
		`sync: ${status.dependencies.sync}`,
		`archive: ${status.dependencies.archive}`,
		"",
		statusSection,
		"",
		...(instructionsSection.length > 0
			? ["### Instructions for next phase", ...instructionsSection, ""]
			: []),
		"### Status JSON",
		"```json",
		JSON.stringify(status, null, 2),
		"```",
	].join("\n");
}

export function renderSddStatusMarkdown(status: SddStatus): string {
	const title = status.changeName ?? "unresolved";
	const lines = [
		`## SDD Status: ${title}`,
		"",
		`schema: ${status.schemaName}@${status.schemaVersion}`,
		`store: ${status.artifactStore}`,
		`root: ${status.planningHome.root}`,
		`next: ${status.nextRecommended}`,
		"",
		"### Implementation tasks",
		`- complete: ${status.taskProgress.complete}/${status.taskProgress.total}`,
		`- remaining: ${status.taskProgress.remaining}`,
		...status.taskProgress.unchecked.map((line) => `- unchecked: ${line}`),
		"",
		"### Deferred parent lifecycle actions",
		`- complete: ${status.deferredParentActions.complete}/${status.deferredParentActions.total}`,
		`- remaining: ${status.deferredParentActions.remaining}`,
		...status.deferredParentActions.unchecked.map((line) => `- deferred: ${line}`),
		...status.taskArtifactErrors.map((error) => `- task artifact error: ${error}`),
		"",
		"### Dependencies",
		...Object.entries(status.dependencies).map(([phase, state]) => `- ${phase}: ${state}`),
	];
	if (status.collisions.length > 0) {
		lines.push("", "### Same-domain active changes");
		for (const collision of status.collisions) {
			lines.push(
				`- ${collision.domain}: ${collision.changes.map((item) => item.change).join(", ")}`,
			);
		}
	}
	if (status.blockedReasons.length > 0) {
		lines.push("", "### Blockers", ...status.blockedReasons.map((reason) => `- ${reason}`));
	}
	lines.push("", "### JSON", "```json", JSON.stringify(status, null, 2), "```");
	return lines.join("\n");
}

export function parseSddStatusCommandArgs(args: string): { changeName?: string; json: boolean } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const json = parts.includes("--json");
	const changeName = parts.find((part) => part !== "--json");
	return { changeName, json };
}

export function sddStatusSeverity(status: SddStatus): "info" | "warning" {
	// Non-authoritative status has no real blockers — always info
	if (isNonAuthoritativeStatus(status)) return "info";
	return status.blockedReasons.length > 0 || Object.values(status.dependencies).includes("blocked")
		? "warning"
		: "info";
}

export function summarizeSddStatusForTitle(status: SddStatus): string {
	return `${status.changeName ?? "unresolved"}: ${status.nextRecommended} (${status.taskProgress.complete}/${status.taskProgress.total} tasks)`;
}

export function activeChangeLabel(cwd: string): string {
	return basename(resolve(cwd));
}
