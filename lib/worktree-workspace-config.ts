// gentle-pi#370. Detects the one configuration boundary that made a setup gap
// look like a runtime-support verdict.
//
// Git never copies ignored files into a linked worktree, and `.pi/` is ignored
// in every project that keeps it out of version control. So a worktree created
// from a fully configured workspace starts with no project-local `.pi`
// configuration at all. Nothing announces that. What the user eventually sees
// is a gentle-ai refusal listing claude-code, opencode and codex as the
// supported immutable-review runtimes, with `pi` absent -- because without the
// project-local configuration the extension is not the caller, gentle-ai gets
// driven from a plain shell, and nothing exports the relay handshake that makes
// `pi` eligible. Four independent reporters on published 2.4.0 read that
// refusal as a statement about runtime support.
//
// This module reports the gap where it is created. It never writes into a
// worktree: provisioning means copying whatever a parent workspace happens to
// contain, which can silently duplicate stale configuration, and that decision
// belongs to the user rather than to a startup hook.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * The handshake gentle-ai requires before `pi` is an eligible immutable-review
 * runtime. Named here only so the diagnostic can say which variable and value
 * are involved; nothing in this module sets, forges, or bypasses it.
 */
export const REVIEW_RELAY_HANDSHAKE = "GENTLE_PI_REVIEW_RELAY_CONTRACT=gentle-pi.review-relay/v1";

export interface ProjectPiConfigEntry {
	/** Repository-relative path, rendered with the host separator. */
	readonly relativePath: string;
	/** What stops working when this path is absent. */
	readonly capability: string;
}

/**
 * The project-local `.pi` paths the extension actually reads. Directories are
 * probed as a whole rather than file by file: a worktree either received the
 * directory or it did not, and enumerating every file inside it would report
 * differences that are ordinary workspace drift rather than the worktree gap.
 */
export const PROJECT_PI_CONFIG_ENTRIES: readonly ProjectPiConfigEntry[] = [
	{
		relativePath: join(".pi", "npm", "node_modules"),
		capability:
			"project-local Pi package installs. When gentle-pi is installed here rather than globally, the extension does not load in this worktree at all",
	},
	{
		relativePath: join(".pi", "settings.json"),
		capability: "project Pi settings",
	},
	{
		relativePath: join(".pi", "gentle-ai"),
		capability:
			"project Gentle AI config: runtime guardrails, background-subagents policy, persona, SDD preflight",
	},
	{
		relativePath: join(".pi", "agents"),
		capability: "project subagent definitions",
	},
	{
		relativePath: join(".pi", "subagents"),
		capability: "project subagent definitions",
	},
	{
		relativePath: join(".pi", "subagents.json"),
		capability: "project subagent model routing profiles",
	},
	{
		relativePath: join(".pi", "skills"),
		capability: "project skills",
	},
];

export interface MissingProjectPiConfig extends ProjectPiConfigEntry {
	/** Where it would live in this worktree. */
	readonly worktreePath: string;
	/** Where it exists in the parent workspace. */
	readonly parentPath: string;
}

export type WorktreeWorkspaceConfigReport =
	/** The session cwd is the repository's own main worktree; nothing to carry across. */
	| { readonly status: "not-a-linked-worktree" }
	/** Git identity, the main worktree, or both could not be resolved. Never guessed. */
	| { readonly status: "undetermined"; readonly reason: string }
	/** A linked worktree that lacks nothing the parent workspace has. */
	| {
			readonly status: "provisioned";
			readonly worktreeRoot: string;
			readonly parentWorkspaceRoot: string;
	  }
	/** A linked worktree missing project-local configuration the parent workspace has. */
	| {
			readonly status: "missing";
			readonly worktreeRoot: string;
			readonly parentWorkspaceRoot: string;
			readonly missing: readonly MissingProjectPiConfig[];
	  };

function git(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/**
 * The repository's main worktree, which is the workspace a linked worktree was
 * branched from and therefore the only honest comparison point.
 *
 * `git worktree list --porcelain` always emits the main worktree first. A bare
 * repository has no main worktree, so there is nothing to compare against and
 * the caller must stay quiet rather than invent a parent.
 */
function resolveParentWorkspaceRoot(cwd: string): { readonly root: string } | { readonly reason: string } {
	let porcelain: string;
	try {
		porcelain = git(cwd, ["worktree", "list", "--porcelain"]);
	} catch {
		return { reason: "git worktree list did not answer" };
	}
	const record = porcelain.split(/\r?\n\r?\n/)[0] ?? "";
	const lines = record.split(/\r?\n/).map((line) => line.trimEnd());
	if (lines.includes("bare")) return { reason: "the repository has no main worktree (it is bare)" };
	const declaration = lines.find((line) => line.startsWith("worktree "));
	if (declaration === undefined) return { reason: "git worktree list reported no main worktree" };
	const root = declaration.slice("worktree ".length).trim();
	if (root.length === 0 || !isAbsolute(root)) return { reason: "git worktree list reported no absolute main worktree path" };
	if (!existsSync(root)) return { reason: `the main worktree ${root} no longer exists` };
	return { root: canonical(root) };
}

/**
 * Classifies the session cwd and, when it is a linked worktree, reports which
 * project-local `.pi` paths the parent workspace has and this worktree lacks.
 *
 * Every failure to resolve is `undetermined`. A detector that guesses is worse
 * than no detector: it would put a second wrong explanation in front of the
 * same user this exists to unblock.
 */
export function inspectWorktreeWorkspaceConfig(cwd: string): WorktreeWorkspaceConfigReport {
	let toplevel: string;
	let commonDir: string;
	try {
		toplevel = canonical(git(cwd, ["rev-parse", "--show-toplevel"]));
		commonDir = canonical(resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"])));
	} catch {
		return { status: "undetermined", reason: `${cwd} does not resolve a Git worktree identity` };
	}
	// A main worktree keeps its repository directory at `<toplevel>/.git`. A
	// linked worktree keeps a `.git` *file* there and shares the common dir
	// with the main worktree, so the two paths differ.
	if (canonical(join(toplevel, ".git")) === commonDir) return { status: "not-a-linked-worktree" };

	const parent = resolveParentWorkspaceRoot(cwd);
	if (!("root" in parent)) return { status: "undetermined", reason: parent.reason };
	// `--separate-git-dir` also moves the common dir off `<toplevel>/.git`
	// without creating a linked worktree. It is still the main worktree.
	if (parent.root === toplevel) return { status: "not-a-linked-worktree" };

	const missing = PROJECT_PI_CONFIG_ENTRIES.flatMap((entry) => {
		const parentPath = join(parent.root, entry.relativePath);
		const worktreePath = join(toplevel, entry.relativePath);
		if (!existsSync(parentPath) || existsSync(worktreePath)) return [];
		return [{ ...entry, worktreePath, parentPath }];
	});
	if (missing.length === 0) {
		return { status: "provisioned", worktreeRoot: toplevel, parentWorkspaceRoot: parent.root };
	}
	return { status: "missing", worktreeRoot: toplevel, parentWorkspaceRoot: parent.root, missing };
}

/**
 * The full diagnostic, or undefined when there is nothing to report.
 *
 * It names three things deliberately: the exact paths that are missing, the
 * parent workspace that has them, and the failure the user would otherwise
 * meet later without any way to connect it back here.
 */
export function renderWorktreeWorkspaceConfigWarning(
	report: WorktreeWorkspaceConfigReport,
): string | undefined {
	if (report.status !== "missing") return undefined;
	const lines = [
		"Gentle AI: this linked Git worktree does not carry the project-local .pi configuration your parent workspace has.",
		"Git never copies ignored files into a worktree, so nothing here is broken or corrupted. It was simply never brought across.",
		"",
		`Worktree:         ${report.worktreeRoot}`,
		`Parent workspace: ${report.parentWorkspaceRoot}`,
		"",
		"Missing here, present in the parent workspace:",
	];
	for (const entry of report.missing) {
		lines.push(`  ${entry.worktreePath}`);
		lines.push(`    present at ${entry.parentPath}`);
		lines.push(`    ${entry.capability}`);
	}
	lines.push(
		"",
		"Until this is resolved, this worktree runs without that configuration.",
		"In particular, if gentle-pi is installed project-locally, its extension does not load here, so gentle-ai ends up being driven from a plain shell.",
		`A plain shell exports no ${REVIEW_RELAY_HANDSHAKE}, and without that handshake gentle-ai refuses the \`pi\` runtime and lists claude-code, opencode and codex instead.`,
		"That refusal is correct: it names the runtime, but the cause is the missing configuration named above, not a missing runtime.",
		"",
		"Resolve it by copying the listed paths from the parent workspace into this worktree, or by running Pi from the parent workspace.",
		"gentle-pi will not write into your worktree on its own.",
	);
	return lines.join("\n");
}

/** One compact line for `/gentle:status`, or undefined when there is nothing to report. */
export function renderWorktreeWorkspaceConfigStatusLine(
	report: WorktreeWorkspaceConfigReport,
): string | undefined {
	if (report.status !== "missing") return undefined;
	const paths = report.missing.map((entry) => entry.relativePath).join(", ");
	return `Linked worktree config: ${report.missing.length} project-local path(s) missing that ${report.parentWorkspaceRoot} has (${paths}) - copy them across or run Pi from the parent workspace; until then the \`pi\` review runtime is refused for want of ${REVIEW_RELAY_HANDSHAKE}`;
}
