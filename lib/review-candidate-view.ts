import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const REVIEW_LENS = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
export type ReviewLens = (typeof REVIEW_LENS)[number];
const CANDIDATE_GIT_TIMEOUT_MS = 10_000;

export type CandidateGitExecutor = (file: string, arguments_: readonly string[], options: ExecFileSyncOptions) => string | Buffer;
const defaultCandidateGitExecutor: CandidateGitExecutor = (file, arguments_, options) => execFileSync(file, arguments_, options);

const CONTROLLER_CANDIDATE_VIEW_HEADING = "## Controller-owned candidate view";
const MAX_SUBAGENT_TASK_LENGTH = 16_384;
const MAX_SUBAGENT_CONTEXT_LENGTH = 4_096;
const MAX_CANDIDATE_CONTEXT_LENGTH = 4_096;
const SUBAGENT_RUN_KEYS = new Set(["agent", "agents", "task", "context", "mode"]);

interface CandidateTreeEntry {
	path: string;
	mode: string;
	objectId: string;
}

interface CandidateViewEntry extends CandidateTreeEntry {
	contentHash: string;
}

interface CandidateGitlink extends CandidateTreeEntry {
	mode: "160000";
}

interface ParsedCandidateTree {
	entries: CandidateTreeEntry[];
	gitlinks: CandidateGitlink[];
}

interface CandidateViewScope {
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
}

interface CandidateViewRecord {
	token: string;
	root: string;
	parent: string;
	contributorRoot: string;
	commonDir: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly: boolean;
	entries: readonly CandidateViewEntry[];
	gitlinks: readonly CandidateGitlink[];
	scope: CandidateViewScope;
	lineageId?: string;
	selectedLenses?: readonly ReviewLens[];
	gitExecutor: CandidateGitExecutor;
}

export interface CandidateView {
	token: string;
	root: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly: boolean;
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
	verify(): void;
	cleanup(): void;
}

export interface FrozenCandidateProjection {
	contributorRoot: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly: boolean;
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
}

export interface CreateCandidateViewRequest {
	contributorRoot: string;
	baseRef?: string;
	committedOnly?: boolean;
	replayKey?: string;
}

export interface BindCandidateViewRequest {
	token: string;
	lineageId: string;
	selectedLenses: readonly string[];
}

export interface AuthoritativeReviewingCandidateState {
	lineageId: string;
	contributorRoot: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly?: boolean;
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks?: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
	selectedLenses: readonly string[];
}

export class CandidateViewError extends Error {
	readonly reason: string;
	constructor(message: string, reason = "candidate-view-invalid") {
		super(message);
		this.name = "CandidateViewError";
		this.reason = reason;
	}
}

function candidateGit(cwd: string, arguments_: readonly string[], env: NodeJS.ProcessEnv, encoding: "utf8" | "buffer", executor: CandidateGitExecutor): string | Buffer {
	try {
		return executor("git", arguments_, { cwd, encoding, env, stdio: ["ignore", "pipe", "pipe"], timeout: CANDIDATE_GIT_TIMEOUT_MS, windowsHide: true });
	} catch (error) {
		const detail = error as NodeJS.ErrnoException & { stderr?: Buffer; killed?: boolean };
		if (detail.code === "ETIMEDOUT" || detail.killed === true) throw new CandidateViewError(`candidate view Git operation timed out after ${CANDIDATE_GIT_TIMEOUT_MS}ms`);
		throw new CandidateViewError(`candidate view Git operation failed: ${detail.stderr?.toString("utf8").trim() || detail.message || "unknown Git error"}`);
	}
}

function git(cwd: string, arguments_: readonly string[], env: NodeJS.ProcessEnv = process.env, executor: CandidateGitExecutor = defaultCandidateGitExecutor): string {
	return (candidateGit(cwd, arguments_, env, "utf8", executor) as string).trim();
}

function isWithin(parent: string, path: string): boolean {
	const value = relative(parent, path);
	return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function isSafeCandidatePath(path: string): boolean {
	return path.length > 0
		&& !isAbsolute(path)
		&& !path.includes("\\")
		&& !/[\u0000-\u001f\u007f]/.test(path)
		&& path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isMaterializedCandidateMode(mode: string): boolean {
	return mode === "100644" || mode === "100755" || mode === "120000";
}

function isCanonicalObjectId(objectId: string): boolean {
	return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(objectId);
}

function decodeCanonicalPath(value: Buffer): string {
	const path = value.toString("utf8");
	if (!Buffer.from(path, "utf8").equals(value) || !isSafeCandidatePath(path)) {
		throw new CandidateViewError("candidate tree contains an unsafe or noncanonical path");
	}
	return path;
}

function assertSafeSymlinkTarget(root: string, entryPath: string, value: Buffer): void {
	const target = value.toString("utf8");
	if (
		!Buffer.from(target, "utf8").equals(value) ||
		target.length === 0 ||
		isAbsolute(target) ||
		/^[A-Za-z]:\//.test(target) ||
		target.includes("\\") ||
		/[\u0000-\u001f\u007f]/.test(target) ||
		target.split("/").some((segment) => segment.length === 0 || segment === ".")
	) {
		throw new CandidateViewError("candidate view symlink target is unsafe");
	}
	const resolvedTarget = resolve(dirname(join(root, entryPath)), target);
	const metadata = join(root, ".git");
	if (!isWithin(root, resolvedTarget) || resolvedTarget === metadata || isWithin(metadata, resolvedTarget)) {
		throw new CandidateViewError("candidate view symlink target escapes its frozen root or enters metadata");
	}
}

function splitNulTerminated(raw: Buffer, errorMessage: string): Buffer[] {
	if (raw.length === 0) return [];
	if (raw.at(-1) !== 0) throw new CandidateViewError(errorMessage);
	const tokens: Buffer[] = [];
	let start = 0;
	for (let index = 0; index < raw.length; index += 1) {
		if (raw[index] === 0) {
			tokens.push(raw.subarray(start, index));
			start = index + 1;
		}
	}
	return tokens;
}

function parseTree(cwd: string, tree: string, executor: CandidateGitExecutor): ParsedCandidateTree {
	const raw = candidateGit(cwd, ["ls-tree", "-r", "-z", tree], process.env, "buffer", executor) as Buffer;
	const entries: CandidateTreeEntry[] = [];
	const gitlinks: CandidateGitlink[] = [];
	const paths = new Set<string>();
	for (const row of splitNulTerminated(raw, "candidate tree output is not NUL-terminated")) {
		const separator = row.indexOf(0x09);
		if (separator < 0) throw new CandidateViewError("candidate tree contains an unsafe entry");
		const header = row.subarray(0, separator).toString("ascii");
		const match = /^(100644|100755|120000) blob ([0-9a-f]{40}|[0-9a-f]{64})$|^(160000) commit ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(header);
		const path = decodeCanonicalPath(row.subarray(separator + 1));
		if (!match || paths.has(path)) throw new CandidateViewError("candidate tree contains an unsafe entry");
		paths.add(path);
		const mode = match[1] ?? match[3]!;
		const objectId = match[2] ?? match[4]!;
		if (!isCanonicalObjectId(objectId)) throw new CandidateViewError("candidate tree contains an unsafe entry");
		if (mode === "160000") gitlinks.push({ path, mode, objectId });
		else if (isMaterializedCandidateMode(mode)) entries.push({ path, mode, objectId });
		else throw new CandidateViewError("candidate tree contains an unsafe entry");
	}
	const comparePath = (left: CandidateTreeEntry, right: CandidateTreeEntry): number => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
	entries.sort(comparePath);
	gitlinks.sort(comparePath);
	return { entries, gitlinks };
}

function gitPathTokens(cwd: string, arguments_: readonly string[], executor: CandidateGitExecutor): Buffer[] {
	const raw = candidateGit(cwd, arguments_, process.env, "buffer", executor) as Buffer;
	return splitNulTerminated(raw, "candidate scope Git output is not NUL-terminated");
}

function deriveChangedScope(cwd: string, baseCommit: string, candidateTree: string, entries: readonly CandidateTreeEntry[], executor: CandidateGitExecutor): CandidateViewScope {
	const present = new Map(entries.map((entry) => [entry.path, entry]));
	const paths = new Set<string>();
	const deleted = new Set<string>();
	const tokens = gitPathTokens(cwd, ["diff", "--name-status", "-z", "--no-ext-diff", "--find-renames=100%", baseCommit, candidateTree], executor);
	for (let index = 0; index < tokens.length;) {
		const status = tokens[index++]?.toString("ascii");
		if (status === undefined || !/^(?:[AMDT]|R[0-9]{3})$/.test(status)) throw new CandidateViewError("candidate scope Git output contains an unsafe status");
		const oldPath = tokens[index++];
		if (oldPath === undefined) throw new CandidateViewError("candidate scope Git output is incomplete");
		const firstPath = decodeCanonicalPath(oldPath);
		const path = status.startsWith("R")
			? (() => {
				const newPath = tokens[index++];
				if (newPath === undefined) throw new CandidateViewError("candidate scope rename output is incomplete");
				return decodeCanonicalPath(newPath);
			})()
			: firstPath;
		if (paths.has(path) || deleted.has(path)) throw new CandidateViewError("candidate scope Git output contains duplicate paths");
		if (status === "D") {
			if (present.has(path)) throw new CandidateViewError("candidate scope deletion is present in the candidate tree");
			deleted.add(path);
		} else {
			if (!present.has(path)) throw new CandidateViewError("candidate scope path is absent from the candidate tree");
			paths.add(path);
		}
	}
	const presentPaths = [...paths].sort();
	const deletedPaths = [...deleted].sort();
	const allPaths = [...presentPaths, ...deletedPaths].sort();
	return {
		paths: allPaths,
		modes: Object.fromEntries(presentPaths.map((path) => [path, present.get(path)!.mode])),
		gitlinks: Object.fromEntries(presentPaths.flatMap((path) => {
			const entry = present.get(path)!;
			return entry.mode === "160000" ? [[path, entry.objectId]] : [];
		})),
		deletedPaths,
	};
}

function entryContentHash(root: string, entry: CandidateTreeEntry): string {
	const path = join(root, entry.path);
	const item = lstatSync(path);
	if (entry.mode === "120000") {
		if (!item.isSymbolicLink()) throw new CandidateViewError("candidate view symlink does not match its frozen tree");
		const target = readlinkSync(path, "buffer");
		const bytes = Buffer.isBuffer(target) ? target : Buffer.from(target);
		assertSafeSymlinkTarget(root, entry.path, bytes);
		return createHash("sha256").update(bytes).digest("hex");
	}
	if (!item.isFile() || item.isSymbolicLink()) throw new CandidateViewError("candidate view entry does not match its frozen tree");
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function candidateDirectories(root: string, entries: readonly CandidateViewEntry[]): string[] {
	const directories = new Set([root]);
	for (const entry of entries) {
		for (let path = dirname(join(root, entry.path)); isWithin(root, path) || path === root; path = dirname(path)) {
			directories.add(path);
			if (path === root) break;
		}
	}
	return [...directories].sort((left, right) => right.length - left.length);
}

function makeReadonly(root: string, entries: readonly CandidateViewEntry[]): void {
	for (const entry of entries) {
		if (entry.mode !== "120000") chmodSync(join(root, entry.path), entry.mode === "100755" ? 0o555 : 0o444);
	}
	const gitFile = join(root, ".git");
	const metadata = lstatSync(gitFile);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new CandidateViewError("candidate worktree metadata is unsafe");
	chmodSync(gitFile, 0o444);
	for (const directory of candidateDirectories(root, entries)) chmodSync(directory, 0o555);
}

function makeWritableForCleanup(path: string): void {
	const entry = lstatSync(path, { throwIfNoEntry: false });
	if (!entry || entry.isSymbolicLink()) return;
	if (entry.isDirectory()) {
		for (const child of readdirSync(path)) makeWritableForCleanup(join(path, child));
		chmodSync(path, 0o755);
		return;
	}
	chmodSync(path, 0o644);
}

function candidateViewParent(commonDir: string): string {
	const parent = join(commonDir, "gentle-ai", "candidate-views");
	mkdirSync(parent, { recursive: true, mode: 0o700 });
	const stat = lstatSync(parent);
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CandidateViewError("candidate view parent is unsafe");
	return realpathSync(parent);
}

export interface ResolvedCandidateBase {
	commit: string;
	tree: string;
}

function isFullCommitId(selector: string): boolean {
	return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(selector);
}

function explicitBaseRefCandidates(cwd: string, selector: string, env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): string[] {
	if (selector === "HEAD" || isFullCommitId(selector)) return [selector];
	const refs = new Set(git(cwd, ["for-each-ref", "--format=%(refname)"], env, executor).split("\n").filter((ref) => ref.length > 0));
	const candidates = selector.startsWith("refs/")
		? [selector]
		: [
			`refs/${selector}`,
			`refs/tags/${selector}`,
			`refs/heads/${selector}`,
			`refs/remotes/${selector}`,
			`refs/remotes/${selector}/HEAD`,
		];
	return [...new Set(candidates)].filter((candidate) => refs.has(candidate));
}

function resolveCandidateBase(cwd: string, baseRef: string | undefined, env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): ResolvedCandidateBase {
	const selector = baseRef ?? "HEAD";
	try {
		if (baseRef !== undefined) {
			const candidates = explicitBaseRefCandidates(cwd, selector, env, executor);
			if (candidates.length > 1) throw new CandidateViewError("candidate base reference is ambiguous", "base-ref-ambiguous");
			if (candidates.length === 0) throw new CandidateViewError("candidate base reference is unresolvable", "base-ref-unresolvable");
		}
		const firstCommit = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${selector}^{commit}`], env, executor);
		const tree = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${firstCommit}^{tree}`], env, executor);
		const confirmedCommit = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${selector}^{commit}`], env, executor);
		if (firstCommit !== confirmedCommit) throw new CandidateViewError("candidate base reference moved during resolution", "base-ref-moved");
		const confirmedTree = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${confirmedCommit}^{tree}`], env, executor);
		if (tree !== confirmedTree) throw new CandidateViewError("candidate base tree changed during resolution", "base-ref-moved");
		return { commit: confirmedCommit, tree: confirmedTree };
	} catch (error) {
		if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-moved" || error.reason === "base-ref-unresolvable")) throw error;
		throw new CandidateViewError("candidate base reference is unresolvable", "base-ref-unresolvable");
	}
}

export function resolveCanonicalCandidateBase(contributorRoot: string, baseRef: string): ResolvedCandidateBase {
	return resolveCandidateBase(realpathSync(contributorRoot), baseRef, process.env, defaultCandidateGitExecutor);
}

function checkoutMaterializedEntries(root: string, entries: readonly CandidateTreeEntry[], executor: CandidateGitExecutor): void {
	let batch: string[] = [];
	let bytes = 0;
	const flush = (): void => {
		if (batch.length === 0) return;
		git(root, ["checkout-index", "-f", "--", ...batch], process.env, executor);
		batch = [];
		bytes = 0;
	};
	for (const entry of entries) {
		const entryBytes = Buffer.byteLength(entry.path, "utf8") + 1;
		if (batch.length > 0 && bytes + entryBytes > 16_384) flush();
		batch.push(entry.path);
		bytes += entryBytes;
	}
	flush();
}

function materializeCandidateView(request: CreateCandidateViewRequest, executor: CandidateGitExecutor): CandidateViewRecord {
	const contributorRoot = realpathSync(request.contributorRoot);
	if (!lstatSync(contributorRoot).isDirectory()) throw new CandidateViewError("contributor root is not a directory");
	if (request.committedOnly === true && request.baseRef === undefined) throw new CandidateViewError("committed-only candidate views require an explicit base reference", "committed-only-base-required");
	const commonDir = resolve(contributorRoot, git(contributorRoot, ["rev-parse", "--git-common-dir"], process.env, executor));
	const canonicalCommonDir = realpathSync(commonDir);
	const base = resolveCandidateBase(contributorRoot, request.baseRef, process.env, executor);
	const committedOnly = request.committedOnly === true;
	const candidateCommit = committedOnly
		? resolveCandidateBase(contributorRoot, "HEAD", process.env, executor)
		: base;
	const parent = candidateViewParent(canonicalCommonDir);
	const index = mkdtempSync(join(tmpdir(), "gentle-ai-candidate-index-"));
	const indexPath = join(index, "index");
	const environment = { ...process.env, GIT_INDEX_FILE: indexPath };
	try {
		const baseCommit = base.commit;
		git(contributorRoot, ["read-tree", candidateCommit.commit], environment, executor);
		if (!committedOnly) git(contributorRoot, ["add", "-A"], environment, executor);
		const candidateTree = git(contributorRoot, ["write-tree"], environment, executor);
		const root = join(parent, randomUUID());
		git(contributorRoot, ["worktree", "add", "--detach", "--no-checkout", root, candidateCommit.commit], process.env, executor);
		try {
			git(root, ["read-tree", candidateTree], process.env, executor);
			const tree = parseTree(root, candidateTree, executor);
			checkoutMaterializedEntries(root, tree.entries, executor);
			const entries = tree.entries.map((entry) => ({ ...entry, contentHash: entryContentHash(root, entry) }));
			const scope = deriveChangedScope(contributorRoot, baseCommit, candidateTree, [...tree.entries, ...tree.gitlinks], executor);
			for (const gitlink of tree.gitlinks) {
				if (lstatSync(join(root, gitlink.path), { throwIfNoEntry: false })) throw new CandidateViewError("candidate view materialized a metadata-only gitlink");
			}
			makeReadonly(root, entries);
			return { token: basename(root), root: realpathSync(root), parent, contributorRoot, commonDir: canonicalCommonDir, baseCommit, baseTree: base.tree, candidateTree, committedOnly, entries, gitlinks: tree.gitlinks, scope, gitExecutor: executor };
		} catch (error) {
			try { git(contributorRoot, ["worktree", "remove", "--force", root], process.env, executor); } catch { rmSync(root, { recursive: true, force: true }); }
			throw error;
		}
	} finally {
		rmSync(index, { recursive: true, force: true });
	}
}

function assertRecordSafe(record: CandidateViewRecord): void {
	const root = record.root;
	if (!isWithin(record.parent, root) || !existsSync(root)) throw new CandidateViewError("candidate view is missing or moved");
	const rootStat = lstatSync(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(root) !== root) throw new CandidateViewError("candidate view root is unsafe");
	for (const directory of candidateDirectories(root, record.entries)) {
		const metadata = lstatSync(directory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o222) !== 0) throw new CandidateViewError("candidate view directory is unsafe or writable");
	}
	const gitFile = lstatSync(join(root, ".git"));
	if (!gitFile.isFile() || gitFile.isSymbolicLink() || (gitFile.mode & 0o222) !== 0) throw new CandidateViewError("candidate worktree metadata is unsafe or writable");
	if (gitPathTokens(root, ["ls-files", "--others", "--exclude-standard", "-z"], record.gitExecutor).length !== 0) throw new CandidateViewError("candidate view contains injected untracked entries");
	const tree = git(root, ["write-tree"], process.env, record.gitExecutor);
	if (tree !== record.candidateTree) throw new CandidateViewError("candidate view index no longer matches its frozen tree");
	for (const gitlink of record.gitlinks) {
		if (!isSafeCandidatePath(gitlink.path) || gitlink.mode !== "160000" || !isCanonicalObjectId(gitlink.objectId)) throw new CandidateViewError("candidate view gitlink metadata is unsafe");
		if (lstatSync(join(root, gitlink.path), { throwIfNoEntry: false })) throw new CandidateViewError("candidate view contains materialized gitlink contents");
	}
	for (const entry of record.entries) {
		if (!isSafeCandidatePath(entry.path)) throw new CandidateViewError("candidate view entry path is unsafe");
		const path = join(root, entry.path);
		if (!isWithin(root, path)) throw new CandidateViewError("candidate view entry is missing or moved");
		const item = lstatSync(path, { throwIfNoEntry: false });
		if (!item) throw new CandidateViewError("candidate view entry is missing or moved");
		if (entry.mode === "120000") {
			if (!item.isSymbolicLink()) throw new CandidateViewError("candidate view symlink is unsafe or changed");
		} else if (!item.isFile() || item.isSymbolicLink() || (item.mode & 0o222) !== 0 || ((item.mode & 0o111) !== (entry.mode === "100755" ? 0o111 : 0))) {
			throw new CandidateViewError("candidate view entry is unsafe, writable, or has a changed mode");
		}
		const actualHash = entryContentHash(root, entry);
		if (actualHash !== entry.contentHash) throw new CandidateViewError("candidate view content no longer matches its frozen tree");
	}
}

export class CandidateViewRegistry {
	private readonly records = new Map<string, CandidateViewRecord>();
	private readonly gitExecutor: CandidateGitExecutor;
	constructor(gitExecutor: CandidateGitExecutor = defaultCandidateGitExecutor) {
		this.gitExecutor = gitExecutor;
	}
	private readonly lineages = new Map<string, string>();
	private readonly projections = new Map<string, FrozenCandidateProjection>();
	private readonly replays = new Map<string, string>();
	private current: { lineageId: string; token: string } | undefined;

	create(request: CreateCandidateViewRequest): CandidateView {
		return this.createOrReuse(request);
	}

	createOrReuse(request: CreateCandidateViewRequest): CandidateView {
		const token = request.replayKey === undefined ? undefined : this.replays.get(request.replayKey);
		const existing = token === undefined ? undefined : this.records.get(token);
		if (existing) { assertRecordSafe(existing); return this.expose(existing); }
		const record = materializeCandidateView(request, this.gitExecutor);
		this.records.set(record.token, record);
		if (request.replayKey !== undefined) this.replays.set(request.replayKey, record.token);
		return this.expose(record);
	}

	bind(request: BindCandidateViewRequest): void {
		this.bindCurrent(request);
	}

	bindCurrent(request: BindCandidateViewRequest): void {
		const selectedLenses = this.validateSelectedLenses(request.selectedLenses);
		this.bindRecord(request.token, request.lineageId, selectedLenses);
		this.current = { lineageId: request.lineageId, token: request.token };
	}

	retain(token: string, lineageId: string): void {
		this.bindRecord(token, lineageId, []);
		this.current = { lineageId, token };
	}

	restoreCurrentFromNativeStart(request: BindCandidateViewRequest): void {
		if (this.current !== undefined) throw new CandidateViewError("candidate view already has a current lineage binding", "current-binding-already-established");
		const record = this.records.get(request.token);
		if (!record || record.lineageId !== undefined) throw new CandidateViewError("native reviewing candidate view is missing or already bound", "authoritative-current-match-missing");
		assertRecordSafe(record);
		this.assertCurrentBindingMatchesLiveCandidate(record);
		this.bindCurrent(request);
	}

	hasCurrentBinding(): boolean {
		return this.current !== undefined;
	}

	restoreCurrentFromAuthoritativeReviewingStates(
		contributorRoot: string,
		states: readonly AuthoritativeReviewingCandidateState[],
	): void {
		if (this.current !== undefined) throw new CandidateViewError("candidate view already has a current lineage binding", "current-binding-already-established");
		if (states.length === 0) throw new CandidateViewError("no authoritative reviewing lineage exactly matches the live candidate", "authoritative-current-match-missing");
		if (states.length !== 1) throw new CandidateViewError("multiple authoritative reviewing lineages exactly match the live candidate", "authoritative-current-match-ambiguous");
		const live = materializeCandidateView({ contributorRoot, baseRef: states[0]!.baseCommit, committedOnly: states[0]!.committedOnly === true }, this.gitExecutor);
		try {
			const matches = states.filter((state) => this.matchesAuthoritativeState(live, state));
			if (matches.length === 0) throw new CandidateViewError("no authoritative reviewing lineage exactly matches the live candidate", "authoritative-current-match-missing");
			if (matches.length !== 1) throw new CandidateViewError("multiple authoritative reviewing lineages exactly match the live candidate", "authoritative-current-match-ambiguous");
			const state = matches[0]!;
			const selectedLenses = this.validateSelectedLenses(state.selectedLenses);
			this.records.set(live.token, live);
			this.bindRecord(live.token, state.lineageId, selectedLenses);
			this.current = { lineageId: state.lineageId, token: live.token };
		} catch (error) {
			if (!this.records.has(live.token)) this.remove(live);
			throw error;
		}
	}

	createCorrected(lineageId: string, contributorRoot: string, replayKey: string): CandidateView {
		const projection = this.resolveProjection(lineageId, contributorRoot);
		const existingToken = this.replays.get(replayKey);
		const existing = existingToken === undefined ? undefined : this.records.get(existingToken);
		if (existing) {
			if (existing.lineageId !== undefined) throw new CandidateViewError("corrected candidate replay is no longer pending");
			assertRecordSafe(existing);
			return this.expose(existing);
		}
		const record = materializeCandidateView({ contributorRoot, baseRef: projection.baseCommit, committedOnly: projection.committedOnly }, this.gitExecutor);
		try {
			if (record.baseCommit !== projection.baseCommit || record.baseTree !== projection.baseTree) throw new CandidateViewError("corrected candidate base does not match the frozen genesis base");
			if (!record.scope.paths.every((path) => projection.paths.includes(path))) throw new CandidateViewError("corrected candidate scope escapes the frozen genesis paths");
			this.records.set(record.token, record);
			this.replays.set(replayKey, record.token);
			return this.expose(record);
		} catch (error) {
			this.remove(record);
			throw error;
		}
	}

	promoteCorrected(lineageId: string, token: string): void {
		const replacement = this.records.get(token);
		const projection = this.projections.get(lineageId);
		const currentToken = this.lineages.get(lineageId);
		const current = currentToken === undefined ? undefined : this.records.get(currentToken);
		if (!replacement || replacement.lineageId !== undefined || !projection || (currentToken !== undefined && (!current || current.lineageId !== lineageId))) {
			throw new CandidateViewError("corrected candidate replacement is missing or ambiguous");
		}
		if (this.current !== undefined && this.current.lineageId !== lineageId) {
			throw new CandidateViewError("corrected candidate replacement conflicts with the current lineage binding");
		}
		assertRecordSafe(replacement);
		if (current) assertRecordSafe(current);
		if (
			replacement.contributorRoot !== projection.contributorRoot ||
			replacement.baseCommit !== projection.baseCommit ||
			replacement.baseTree !== projection.baseTree ||
			replacement.committedOnly !== projection.committedOnly ||
			!replacement.scope.paths.every((path) => projection.paths.includes(path))
		) {
			throw new CandidateViewError("corrected candidate replacement does not preserve its frozen lineage projection");
		}
		replacement.lineageId = lineageId;
		replacement.selectedLenses = [];
		this.lineages.set(lineageId, token);
		for (const [key, pendingToken] of this.replays) if (pendingToken === token) this.replays.delete(key);
		this.projections.set(lineageId, {
			contributorRoot: replacement.contributorRoot,
			baseCommit: replacement.baseCommit,
			baseTree: replacement.baseTree,
			candidateTree: replacement.candidateTree,
			committedOnly: replacement.committedOnly,
			paths: replacement.scope.paths,
			modes: replacement.scope.modes,
			gitlinks: replacement.scope.gitlinks,
			deletedPaths: replacement.scope.deletedPaths,
		});
		this.current = { lineageId, token };
		if (current) {
			this.remove(current);
			this.forget(current);
		}
	}

	private validateSelectedLenses(lenses: readonly string[]): ReviewLens[] {
		const selectedLenses = lenses.filter((lens): lens is ReviewLens => (REVIEW_LENS as readonly string[]).includes(lens));
		if (selectedLenses.length !== lenses.length || selectedLenses.length === 0) throw new CandidateViewError("candidate view has no valid selected review lenses");
		return selectedLenses;
	}

	private matchesAuthoritativeState(record: CandidateViewRecord, state: AuthoritativeReviewingCandidateState): boolean {
		try {
			return realpathSync(state.contributorRoot) === record.contributorRoot &&
				state.baseCommit === record.baseCommit &&
				state.baseTree === record.baseTree &&
				state.candidateTree === record.candidateTree &&
				(state.committedOnly ?? false) === record.committedOnly &&
				JSON.stringify(state.paths) === JSON.stringify(record.scope.paths) &&
				JSON.stringify(state.modes) === JSON.stringify(record.scope.modes) &&
				JSON.stringify(state.gitlinks ?? {}) === JSON.stringify(record.scope.gitlinks) &&
				JSON.stringify(state.deletedPaths) === JSON.stringify(record.scope.deletedPaths);
		} catch {
			return false;
		}
	}

	private bindRecord(token: string, lineageId: string, selectedLenses: readonly ReviewLens[]): void {
		const record = this.records.get(token);
		if (!record || record.lineageId !== undefined || this.lineages.has(lineageId)) throw new CandidateViewError("candidate view lineage binding is missing or ambiguous");
		assertRecordSafe(record);
		record.lineageId = lineageId;
		record.selectedLenses = selectedLenses;
		this.lineages.set(lineageId, record.token);
		this.projections.set(lineageId, {
			contributorRoot: record.contributorRoot,
			baseCommit: record.baseCommit,
			baseTree: record.baseTree,
			candidateTree: record.candidateTree,
			committedOnly: record.committedOnly,
			paths: record.scope.paths,
			modes: record.scope.modes,
			gitlinks: record.scope.gitlinks,
			deletedPaths: record.scope.deletedPaths,
		});
		for (const [key, pendingToken] of this.replays) if (pendingToken === token) this.replays.delete(key);
	}

	hasProjection(lineageId: string): boolean {
		return this.projections.has(lineageId);
	}

	restoreProjection(lineageId: string, contributorRoot: string, baseCommit: string, baseTree: string, candidateTree: string, paths: readonly string[]): void {
		const root = realpathSync(contributorRoot);
		const base = resolveCandidateBase(root, baseCommit, process.env, this.gitExecutor);
		if (!lineageId || this.projections.has(lineageId) || base.commit !== baseCommit || base.tree !== baseTree || !isFullCommitId(candidateTree) || paths.some((path) => !isSafeCandidatePath(path)) || new Set(paths).size !== paths.length) throw new CandidateViewError("frozen correction projection is invalid or already restored");
		this.projections.set(lineageId, { contributorRoot: root, baseCommit, baseTree, candidateTree, committedOnly: false, paths: [...paths], modes: {}, gitlinks: {}, deletedPaths: [] });
	}

	resolveProjection(lineageId: string, contributorRoot: string): FrozenCandidateProjection {
		const projection = this.projections.get(lineageId);
		if (!projection || realpathSync(contributorRoot) !== projection.contributorRoot) {
			throw new CandidateViewError("candidate projection is missing, ambiguous, or belongs to a different contributor root");
		}
		return projection;
	}

	resolveForLens(lineageId: string, lens: string): CandidateView {
		const token = this.lineages.get(lineageId);
		const record = token === undefined ? undefined : this.records.get(token);
		if (!record || record.lineageId !== lineageId || !record.selectedLenses?.includes(lens as ReviewLens)) throw new CandidateViewError("candidate view context is missing, ambiguous, stale, or lens-unselected");
		assertRecordSafe(record);
		return this.expose(record);
	}

	currentLineageId(): string {
		if (this.current === undefined) throw new CandidateViewError("review subagent dispatch has no current controller-owned candidate view lineage binding", "current-binding-missing");
		return this.current.lineageId;
	}

	resolveCurrentForLens(lens: string): CandidateView {
		return this.resolveCurrentForLenses([lens])[0]!;
	}

	resolveCurrentForLenses(lenses: readonly string[]): CandidateView[] {
		const lineageId = this.currentLineageId();
		const token = this.current?.token;
		const record = token === undefined ? undefined : this.records.get(token);
		if (!record || record.lineageId !== lineageId || this.lineages.get(lineageId) !== token) throw new CandidateViewError("review subagent dispatch current lineage binding is stale or ambiguous", "current-binding-stale");
		assertRecordSafe(record);
		this.assertCurrentBindingMatchesLiveCandidate(record);
		if (!lenses.every((lens) => record.selectedLenses?.includes(lens as ReviewLens))) throw new CandidateViewError("candidate view context is missing, ambiguous, stale, or lens-unselected", "current-binding-lens-unselected");
		return lenses.map(() => this.expose(record));
	}

	private assertCurrentBindingMatchesLiveCandidate(record: CandidateViewRecord): void {
		const live = materializeCandidateView({ contributorRoot: record.contributorRoot, baseRef: record.baseCommit, committedOnly: record.committedOnly }, this.gitExecutor);
		try {
			if (
				live.baseCommit !== record.baseCommit ||
				live.baseTree !== record.baseTree ||
				live.candidateTree !== record.candidateTree ||
				live.committedOnly !== record.committedOnly ||
				JSON.stringify(live.scope.paths) !== JSON.stringify(record.scope.paths) ||
				JSON.stringify(live.scope.modes) !== JSON.stringify(record.scope.modes) ||
				JSON.stringify(live.scope.gitlinks) !== JSON.stringify(record.scope.gitlinks) ||
				JSON.stringify(live.scope.deletedPaths) !== JSON.stringify(record.scope.deletedPaths)
			) throw new CandidateViewError("live candidate no longer matches the current controller-owned lineage binding", "current-binding-live-candidate-drift");
		} finally {
			this.remove(live);
		}
	}

	resolveForFinalize(lineageId: string): CandidateView {
		const token = this.lineages.get(lineageId);
		const record = token === undefined ? undefined : this.records.get(token);
		if (!record || record.lineageId !== lineageId) throw new CandidateViewError("candidate view context is missing or ambiguous for FINALIZE");
		assertRecordSafe(record);
		return this.expose(record);
	}

	cleanup(token: string): void {
		const record = this.records.get(token);
		if (!record) return;
		this.remove(record);
		this.forget(record);
	}

	cleanupTerminal(lineageId: string, state: string): void {
		if (state !== "approved" && state !== "escalated") return;
		const token = this.lineages.get(lineageId); if (token) this.cleanup(token);
		if (state === "escalated") this.projections.delete(lineageId);
	}

	private remove(record: CandidateViewRecord): void {
		if (!isWithin(record.parent, record.root)) throw new CandidateViewError("candidate view cleanup escaped its owned parent");
		try { makeWritableForCleanup(record.root); } catch (error) {
			// Best-effort preparation: worktree removal may still succeed without changing permissions.
			void error;
		}
		try { git(record.contributorRoot, ["worktree", "remove", "--force", record.root], process.env, record.gitExecutor); } catch {
			try { makeWritableForCleanup(record.root); } catch (error) {
				// Best-effort fallback: rmSync below remains the authoritative cleanup attempt.
				void error;
			}
			rmSync(record.root, { recursive: true, force: true });
		}
	}

	private forget(record: CandidateViewRecord): void {
		this.records.delete(record.token);
		if (record.lineageId && this.lineages.get(record.lineageId) === record.token) this.lineages.delete(record.lineageId);
		if (this.current?.token === record.token) this.current = undefined;
		for (const [key, pendingToken] of this.replays) if (pendingToken === record.token) this.replays.delete(key);
	}

	consumeProjection(lineageId: string): void {
		this.projections.delete(lineageId);
	}

	private expose(record: CandidateViewRecord): CandidateView {
		return {
			token: record.token,
			root: record.root,
			baseCommit: record.baseCommit,
			baseTree: record.baseTree,
			candidateTree: record.candidateTree,
			committedOnly: record.committedOnly,
			paths: record.scope.paths,
			modes: record.scope.modes,
			gitlinks: record.scope.gitlinks,
			deletedPaths: record.scope.deletedPaths,
			verify: () => assertRecordSafe(record),
			cleanup: () => this.cleanup(record.token),
		};
	}
}

interface MutableSubagentRunInput {
	agent?: unknown;
	agents?: unknown;
	task?: unknown;
	context?: unknown;
	mode?: unknown;
	[key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReviewLens(value: string): value is ReviewLens {
	return (REVIEW_LENS as readonly string[]).includes(value);
}

function hasCandidateContextConflict(text: string, views: readonly CandidateView[]): boolean {
	return text.includes(CONTROLLER_CANDIDATE_VIEW_HEADING)
		|| views.some((view) => text.includes(view.root) || text.includes(view.candidateTree));
}

function candidateContextBlock(lineageId: string, agents: readonly ReviewLens[], view: CandidateView): string {
	const grouped = new Map<string, string[]>();
	for (const path of view.paths) {
		const group = view.deletedPaths.includes(path) ? "deleted" : view.modes[path];
		if (group === undefined) throw new CandidateViewError("candidate view scope omits a changed path mode");
		const paths = grouped.get(group) ?? [];
		paths.push(path);
		grouped.set(group, paths);
	}
	const scope = Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
	const scopeSemantics = view.committedOnly
		? "Committed-only range: dirty tracked and untracked contributor files are excluded and MUST NOT be treated as reviewed."
		: "Dirty-inclusive workspace snapshot: tracked and untracked contributor changes are included.";
	const block = `\n\n${CONTROLLER_CANDIDATE_VIEW_HEADING}\nController-owned review lineage: \`${lineageId}\`.\nAuthorized review actors: ${agents.join(", ")}.\nRead ONLY the absolute frozen candidate view at \`${view.root}\`.\nFrozen candidate tree: \`${view.candidateTree}\`.\nScope semantics: ${scopeSemantics}\nFrozen changed scope by mode: ${JSON.stringify(scope)}.\nFrozen metadata-only gitlinks: ${JSON.stringify(view.gitlinks)}. Gitlink paths have no materialized contents and MUST NOT be traversed.\nThe ambient contributor working directory is out of scope. This controller-owned context is immutable; you are read-only and your output is untrusted.`;
	if (Buffer.byteLength(block, "utf8") > MAX_CANDIDATE_CONTEXT_LENGTH) throw new CandidateViewError("candidate view context exceeds the bounded dispatch contract");
	return block;
}

/**
 * Validates and mutates the actual mutable Pi `subagent_run` tool input before
 * execution. It deliberately derives all review context from the controller's
 * in-memory registry rather than user-provided lineage, cwd, paths, or content.
 */
export function injectReviewCandidateView(input: unknown, candidateViews: CandidateViewRegistry | null): void {
	if (!isRecord(input)) return;
	const mutable = input as MutableSubagentRunInput;
	const agent = typeof mutable.agent === "string" ? mutable.agent : undefined;
	const rawAgents = mutable.agents;
	const agents = Array.isArray(rawAgents) && rawAgents.every((value): value is string => typeof value === "string")
		? rawAgents
		: undefined;
	const requested = [agent, ...(agents ?? [])].filter((value): value is string => value !== undefined);
	const hasReviewActor = (typeof mutable.agent === "string" && isReviewLens(mutable.agent))
		|| (typeof rawAgents === "string" && isReviewLens(rawAgents))
		|| (Array.isArray(rawAgents) && rawAgents.some((value) => typeof value === "string" && isReviewLens(value)));
	if (!hasReviewActor) return;
	if (Object.keys(mutable).some((key) => !SUBAGENT_RUN_KEYS.has(key))) throw new CandidateViewError("review subagent dispatch contains an unsupported input field");
	if ((agent === undefined) === (agents === undefined) || requested.length === 0 || new Set(requested).size !== requested.length) throw new CandidateViewError("review subagent dispatch must use exactly one non-duplicate agent shape");
	if (!requested.every(isReviewLens)) throw new CandidateViewError("review subagent dispatch cannot mix review and non-review agents");
	if (typeof mutable.task !== "string" || mutable.task.length === 0 || mutable.task.length > MAX_SUBAGENT_TASK_LENGTH) throw new CandidateViewError("review subagent dispatch task is malformed or exceeds the bounded contract");
	if (mutable.context !== undefined && (typeof mutable.context !== "string" || mutable.context.length > MAX_SUBAGENT_CONTEXT_LENGTH)) throw new CandidateViewError("review subagent dispatch context is malformed or exceeds the bounded contract");
	if (mutable.mode !== "task") throw new CandidateViewError("review subagent dispatch requires mode task");
	if (candidateViews === null) throw new CandidateViewError("review subagent dispatch has no controller-owned candidate view registry");
	const reviewAgents = requested as ReviewLens[];
	const lineageId = candidateViews.currentLineageId();
	const views = candidateViews.resolveCurrentForLenses(reviewAgents);
	const view = views[0];
	if (!view || views.some((candidate) => candidate.root !== view.root || candidate.candidateTree !== view.candidateTree || JSON.stringify(candidate.paths) !== JSON.stringify(view.paths) || JSON.stringify(candidate.modes) !== JSON.stringify(view.modes) || JSON.stringify(candidate.deletedPaths) !== JSON.stringify(view.deletedPaths))) {
		throw new CandidateViewError("review subagent dispatch does not resolve one exact frozen candidate view");
	}
	const userText = `${mutable.task}\n${typeof mutable.context === "string" ? mutable.context : ""}`;
	if (hasCandidateContextConflict(userText, views)) throw new CandidateViewError("review subagent dispatch contains conflicting candidate-view text");
	mutable.task = `${mutable.task}${candidateContextBlock(lineageId, reviewAgents, view)}`;
}

const defaultRegistry = new CandidateViewRegistry();

export function createCandidateView(request: CreateCandidateViewRequest): CandidateView {
	return defaultRegistry.create(request);
}
