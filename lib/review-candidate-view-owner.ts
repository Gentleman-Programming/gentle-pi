import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { conservativeOwnerDeathProofV1 } from "./review-lock.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BOOT_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface CandidateViewOwner {
	version: 1;
	uuid: string;
	token: string;
	pid: number;
	host: string | null;
	root: string;
	commonDir: string;
}
type Git = (args: readonly string[]) => string;

// A hostname or a repository-local nonce cannot prove that a PID is local.
// Bind to the kernel boot and, on Linux, its PID namespace. Unsupported or
// unavailable provenance disables reclamation (including across reboots).
function localHost(): string | null {
	try {
		if (process.platform === "darwin") {
			const boot = execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 1000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).trim();
			if (BOOT_UUID.test(boot)) return `darwin:${boot.toLowerCase()}`;
		}
		if (process.platform === "linux") {
			const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
			const namespace = readlinkSync("/proc/self/ns/pid");
			if (BOOT_UUID.test(boot) && /^pid:\[\d+\]$/.test(namespace)) return `linux:${boot}:${namespace}`;
		}
	} catch { /* No remote/PID-only fallback. */ }
	return null;
}

function directory(path: string, privateMode = false): string {
	const stat = lstatSync(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path ||
		(privateMode && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))) throw new Error("Unsafe candidate owner directory");
	return `${stat.dev}:${stat.ino}`;
}

export function assertCandidateOwnerParent(commonDir: string): string {
	directory(commonDir);
	directory(join(commonDir, "gentle-ai"));
	const parent = join(commonDir, "gentle-ai", "candidate-views");
	directory(parent, true);
	return parent;
}

function regular(path: string, privateMode = false): string {
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size > 16384 ||
		(privateMode && (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600))) throw new Error("Unsafe candidate owner file");
	return `${stat.dev}:${stat.ino}`;
}

function syncDirectory(path: string): void {
	const fd = openSync(path, "r");
	try { fsyncSync(fd); } finally { closeSync(fd); }
}

function exclusiveFile(path: string, content: string): void {
	const fd = openSync(path, "wx", 0o600);
	try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
	syncDirectory(dirname(path));
}

function markerPath(root: string): string { return `${root}.owner.json`; }

export function createCandidateOwner(commonDir: string, root: string): CandidateViewOwner {
	const parent = assertCandidateOwnerParent(commonDir);
	const uuid = basename(root);
	if (!UUID.test(uuid) || root !== join(parent, uuid) || lstatSync(root, { throwIfNoEntry: false })) throw new Error("Unsafe candidate owner root");
	const owner: CandidateViewOwner = { version: 1, uuid, token: randomUUID(), pid: process.pid, host: localHost(), root, commonDir };
	// Any write/fsync failure aborts creation BEFORE Git can register the view.
	// An incomplete marker is retained, never guessed into ownership.
	exclusiveFile(markerPath(root), JSON.stringify(owner));
	syncDirectory(dirname(parent));
	syncDirectory(commonDir);
	return Object.freeze(owner);
}

function readOwner(commonDir: string, root: string): CandidateViewOwner {
	const parent = assertCandidateOwnerParent(commonDir);
	if (!UUID.test(basename(root)) || root !== join(parent, basename(root))) throw new Error("Candidate owner escaped parent");
	regular(markerPath(root), true);
	const owner = JSON.parse(readFileSync(markerPath(root), "utf8")) as CandidateViewOwner;
	if (!owner || Object.keys(owner).sort().join(",") !== "commonDir,host,pid,root,token,uuid,version" || owner.version !== 1 ||
		owner.uuid !== basename(root) || !UUID.test(owner.token) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
		owner.root !== root || owner.commonDir !== commonDir || !(owner.host === null || typeof owner.host === "string")) throw new Error("Malformed candidate owner");
	return owner;
}

function dead(owner: CandidateViewOwner): boolean {
	return owner.host !== null && owner.host === localHost() && conservativeOwnerDeathProofV1({
		pid: owner.pid, token: owner.token, owner_hash: "", repository_id: owner.commonDir, authority_id: owner.uuid,
	});
}

function registration(root: string, commonDir: string, git: Git): string {
	const rows = git(["worktree", "list", "--porcelain", "-z"]).split("\0\0");
	const matching = rows.filter((row) => row.split("\0")[0] === `worktree ${root}`);
	if (matching.length !== 1 || matching[0]!.split("\0").some((field) => /^(locked|prunable)( |$)/.test(field))) throw new Error("Candidate registration is ambiguous");
	const gitFile = join(root, ".git");
	regular(gitFile);
	const pointer = readFileSync(gitFile, "utf8");
	if (!pointer.startsWith("gitdir: ") || !pointer.endsWith("\n")) throw new Error("Unsafe candidate Git pointer");
	const admin = pointer.slice(8, -1);
	if (dirname(admin) !== join(commonDir, "worktrees")) throw new Error("Candidate admin escaped common directory");
	directory(join(commonDir, "worktrees"));
	directory(admin);
	regular(join(admin, "gitdir"));
	regular(join(admin, "commondir"));
	if (readFileSync(join(admin, "gitdir"), "utf8") !== `${gitFile}\n` ||
		resolve(admin, readFileSync(join(admin, "commondir"), "utf8").trim()) !== commonDir) throw new Error("Candidate Git backlinks changed");
	return matching[0]! + pointer;
}

export function removeCandidateOwner(owner: CandidateViewOwner, git: Git, makeWritable: (root: string) => void, orphan = false): void {
	const { root, commonDir } = owner;
	const parent = assertCandidateOwnerParent(commonDir);
	const expected = JSON.stringify(owner);
	const parentIdentity = directory(parent, true);
	const markerIdentity = regular(markerPath(root), true);
	const checkOwner = (): void => {
		if (directory(parent, true) !== parentIdentity || regular(markerPath(root), true) !== markerIdentity ||
			JSON.stringify(readOwner(commonDir, root)) !== expected || (orphan ? !dead(owner) : owner.pid !== process.pid)) throw new Error("Candidate ownership changed");
	};
	checkOwner();
	const lock = `${root}.reaper-lock`;
	const token = randomUUID();
	exclusiveFile(lock, token); // EEXIST is final; unknown/stale locks are never stolen.
	const lockIdentity = regular(lock, true);
	const checkLock = (): void => {
		if (regular(lock, true) !== lockIdentity || readFileSync(lock, "utf8") !== token) throw new Error("Candidate reaper lock changed");
	};
	try {
		checkOwner();
		const identity = [directory(parent, true), directory(root), regular(markerPath(root), true)];
		const registered = registration(root, commonDir, git);
		checkOwner();
		checkLock();
		makeWritable(root);
		// Git and chmod are race boundaries: repeat path, owner, lock, and exact
		// registration proofs immediately before asking Git to remove this root.
		if (registration(root, commonDir, git) !== registered ||
			JSON.stringify([directory(parent, true), directory(root), regular(markerPath(root), true)]) !== JSON.stringify(identity)) throw new Error("Candidate cleanup identity changed");
		checkOwner();
		checkLock();
		git(["worktree", "remove", "--force", root]);
		// Git failure or incomplete removal must never trigger recursive rm.
		if (lstatSync(root, { throwIfNoEntry: false }) || git(["worktree", "list", "--porcelain", "-z"]).split("\0").includes(`worktree ${root}`)) throw new Error("Candidate removal is incomplete");
		checkOwner();
		checkLock();
		unlinkSync(markerPath(root));
		syncDirectory(parent);
	} finally {
		// Only release this exact lock, even when the deletion itself failed.
		try { assertCandidateOwnerParent(commonDir); checkLock(); unlinkSync(lock); syncDirectory(parent); } catch {}
	}
}

export function sweepCandidateOwners(commonDir: string, git: Git, makeWritable: (root: string) => void): void {
	try {
		const parent = assertCandidateOwnerParent(commonDir);
		for (const name of readdirSync(parent)) {
			if (!name.endsWith(".owner.json")) continue;
			try {
				const owner = readOwner(commonDir, join(parent, name.slice(0, -11)));
				if (dead(owner)) removeCandidateOwner(owner, git, makeWritable, true);
			} catch { /* Unknown, legacy, unsafe, unregistered, and contended entries survive. */ }
		}
	} catch { /* Startup/materialization sweeps are best-effort; never create a store. */ }
}
