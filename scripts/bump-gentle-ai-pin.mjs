#!/usr/bin/env node
// Pin-bump automation (design.md "P4" / proposal.md P4). Runs exclusively in
// the pin-bump job of .github/workflows/gentle-ai-release-received.yml -- the
// ONLY place besides scripts/sync-gentle-ai-release.mjs that gentle-pi lets
// download a gentle-ai release. This script orchestrates the three existing
// generators; it does not reimplement any of them:
//
//   1. scripts/sync-gentle-ai-release.mjs --write   (D1 trust order, D6 mirrors/lock)
//   2. scripts/build-gentle-ai-baselines.mjs --write (D7 generated floor/row)
//   3. scripts/build-skill-overlays.mjs --write      (D8 generated skill overlays)
//
// Maintainer decision: the repository_dispatch payload is the TAG ONLY. The
// provider sends nothing else -- everything this script needs beyond the tag
// it fetches and verifies itself through scripts/sync-gentle-ai-release.mjs,
// so there is exactly one source of truth for the release contents. A richer
// payload would be a second source of truth that has to stay in sync.
//
// Maintainer decision: the bump PR ALWAYS waits for human review and is
// NEVER auto-merged, even on green. The bot prepares evidence; the human
// decides. Do not add an auto-merge step, an auto-approve step, or an
// "--auto" flag to gh pr create -- see buildPullRequestArguments below,
// which structurally cannot emit one, and the tests that prove it.
//
// Maintainer decision: digests are written only after signature verification
// succeeds. scripts/sync-gentle-ai-release.mjs already owns minisign
// verification and repo/tag binding (design D1); if it throws for any
// reason (forged signature, wrong repo/tag binding, missing/duplicate
// checksum line, pending trusted key), this script propagates the error
// immediately and NEVER reaches the commit/push/PR steps below -- see
// runGentleAiPinBump. No digest and no PR are ever produced from unverified
// input.
//
// Threat-matrix "PR commands" (design.md, added row): the tag arrives from
// an external event and is validated against ^v\d+\.\d+\.\d+$ BEFORE any
// use (validateDispatchedTag). The PR head branch is derived ONLY from that
// already-validated tag (deriveBumpHeadBranch). The PR base is always the
// explicit, hardcoded literal "main" -- never an implicit default and never
// a caller-supplied override (buildPullRequestArguments). Every subprocess
// call in this file goes through execFile with a fixed argv array
// (`shell: false`); no step ever composes a shell string by interpolating
// the tag, the branch name, or any other external payload into it.

import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DISPATCHED_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
export const GENTLE_AI_BUMP_BASE_BRANCH = "main";
export const GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX = "bump/gentle-ai-";
export const GENTLE_AI_BUMP_COMMIT_MESSAGE_PREFIX = "chore(gentle-ai): bump pin to ";
export const GENTLE_AI_BUMP_PR_TITLE_PREFIX = "chore(gentle-ai): bump pin to ";

// --- tag validation (threat-matrix: PR commands) ----------------------------
//
// This is the load-bearing gate: the dispatch payload is the tag ONLY, and
// nothing downstream may see it before it passes here. The pattern is
// anchored on both ends and allows only digits and dots, so it rejects
// shell metacharacters, embedded whitespace, embedded newlines, and any
// attempt to smuggle an extra CLI flag (e.g. "--head", "--base") inside the
// tag value -- all in one check.

export function validateDispatchedTag(tag) {
	if (typeof tag !== "string" || !DISPATCHED_TAG_PATTERN.test(tag)) {
		throw new Error(
			`gentle-ai release dispatch tag ${JSON.stringify(tag)} does not match ${DISPATCHED_TAG_PATTERN}; refusing to use it for a pin bump`,
		);
	}
	return tag;
}

// --- head branch derivation --------------------------------------------------

export function deriveBumpHeadBranch(validatedTag) {
	// Defensive re-check: this function must be safe even if a future caller
	// invokes it directly without going through validateDispatchedTag first.
	if (!DISPATCHED_TAG_PATTERN.test(validatedTag)) {
		throw new Error(
			`deriveBumpHeadBranch requires an already-validated tag matching ${DISPATCHED_TAG_PATTERN}, got ${JSON.stringify(validatedTag)}`,
		);
	}
	return `${GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX}${validatedTag}`;
}

// --- PR command construction (threat-matrix: PR commands) -------------------
//
// Returns a flat argv array for `gh`, never a composed shell string. The
// base is required to be the exact literal "main" -- an implicit/omitted
// base and any alternate base are both rejected -- and the head branch is
// required to match the exact prefix+validated-tag shape this module
// derives, so a caller cannot pass an arbitrary head branch either.

export function buildPullRequestArguments({ base, head, title, body }) {
	if (base !== GENTLE_AI_BUMP_BASE_BRANCH) {
		throw new Error(
			`gentle-ai pin-bump PR base must be the explicit literal "${GENTLE_AI_BUMP_BASE_BRANCH}"; refusing an implicit or alternate base ${JSON.stringify(base)}`,
		);
	}
	const derivedTag = typeof head === "string" && head.startsWith(GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX) ? head.slice(GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX.length) : undefined;
	if (derivedTag === undefined || !DISPATCHED_TAG_PATTERN.test(derivedTag)) {
		throw new Error(`gentle-ai pin-bump PR head branch must be exactly ${GENTLE_AI_BUMP_HEAD_BRANCH_PREFIX}<validated tag>, got ${JSON.stringify(head)}`);
	}
	return ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body];
}

export function buildPullRequestBody(tag) {
	return [
		`Bumps the gentle-ai pin to \`${tag}\`.`,
		"",
		"Generated by `scripts/bump-gentle-ai-pin.mjs` from a signed gentle-ai release, in order:",
		"1. `scripts/sync-gentle-ai-release.mjs --write` -- signature-verified mirrors + canonical lock",
		"2. `scripts/build-gentle-ai-baselines.mjs --write` -- generated capability floor and next row",
		"3. `scripts/build-skill-overlays.mjs --write` -- generated skill overlays",
		"",
		"**This PR requires human review and is never auto-merged**, even when every check is green.",
	].join("\n");
}

// --- subprocess execution (fixed argv, no shell) -----------------------------

async function defaultRunCommand(file, arguments_, options = {}) {
	const { stdout } = await execFileAsync(file, arguments_, { cwd: options.cwd, shell: false, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
	return stdout;
}

// --- orchestration ------------------------------------------------------------

export async function runGentleAiPinBump(options) {
	const { rawTag, packageRoot, runCommand = defaultRunCommand, nodeExecutable = process.execPath } = options;

	// Validate BEFORE any use -- no command of any kind runs before this line.
	const tag = validateDispatchedTag(rawTag);
	const headBranch = deriveBumpHeadBranch(tag);

	await runCommand("git", ["checkout", "-b", headBranch], { cwd: packageRoot });

	// Digests are written only after signature verification succeeds:
	// sync-gentle-ai-release.mjs owns minisign verification and repo/tag
	// binding (design D1). If it throws, this call propagates and the
	// function returns here -- the baselines/overlays generators, the git
	// commit, the push, and the PR below never run.
	await runCommand(nodeExecutable, [join("scripts", "sync-gentle-ai-release.mjs"), "--write"], { cwd: packageRoot });
	await runCommand(nodeExecutable, [join("scripts", "build-gentle-ai-baselines.mjs"), "--write"], { cwd: packageRoot });
	await runCommand(nodeExecutable, [join("scripts", "build-skill-overlays.mjs"), "--write"], { cwd: packageRoot });

	await runCommand("git", ["add", "-A"], { cwd: packageRoot });
	const status = await runCommand("git", ["status", "--porcelain"], { cwd: packageRoot });
	if (status.trim().length === 0) {
		return { tag, headBranch, prOpened: false, reason: "gentle-ai pin is already up to date; no changes to commit" };
	}

	await runCommand("git", ["commit", "-m", `${GENTLE_AI_BUMP_COMMIT_MESSAGE_PREFIX}${tag}`], { cwd: packageRoot });
	await runCommand("git", ["push", "--set-upstream", "origin", headBranch], { cwd: packageRoot });

	const prArguments = buildPullRequestArguments({
		base: GENTLE_AI_BUMP_BASE_BRANCH,
		head: headBranch,
		title: `${GENTLE_AI_BUMP_PR_TITLE_PREFIX}${tag}`,
		body: buildPullRequestBody(tag),
	});
	await runCommand("gh", prArguments, { cwd: packageRoot });

	return { tag, headBranch, prOpened: true };
}

// --- CLI ---------------------------------------------------------------------

export function parseArguments(argv) {
	const flagIndex = argv.indexOf("--tag");
	if (flagIndex === -1 || argv[flagIndex + 1] === undefined) {
		throw new Error("usage: bump-gentle-ai-pin.mjs --tag <vX.Y.Z>");
	}
	return { rawTag: argv[flagIndex + 1] };
}

async function main() {
	const { rawTag } = parseArguments(process.argv.slice(2));
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
	const result = await runGentleAiPinBump({ rawTag, packageRoot });
	if (result.prOpened) {
		process.stdout.write(`gentle-ai pin bump PR opened: ${result.headBranch} -> ${GENTLE_AI_BUMP_BASE_BRANCH} (tag ${result.tag})\n`);
	} else {
		process.stdout.write(`gentle-ai pin bump for ${result.tag}: ${result.reason}\n`);
	}
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
