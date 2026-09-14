import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { emptyThread, type TaskRecord, type TaskThread } from "./agents-protocol.ts";

// Gentle Agents history: one JSON file per finished task, written by the
// host after the child is gone and read back lazily when the overlay opens
// or a tool asks for a task from an earlier session. Everything is async so
// the terminal never waits on disk.

export interface StoredTask {
	task: TaskRecord;
	thread: TaskThread;
}

export function remediationUnresolved(task: TaskRecord): boolean {
	const state = task.sddRemediation;
	if (!state) return false;
	if (state.acquireUncertain || state.settlementUncertain) return true;
	// A received settlement is a definite native outcome, whatever its state
	// (including "blocked"): it is terminal task history, never local
	// ambiguity. Native admission is the sole authority over any later
	// attempt for the same cwd/change; only genuinely uncertain outcomes, or
	// no settlement at all with a still-retained token/claimed actor, are
	// unresolved.
	if (state.settlement) return false;
	return !!state.token || !!state.actorClaimed || !["blocked", "complete"].includes(state.acquireResult?.state ?? "");
}

const FILE_SUFFIX = ".json";
const SAFE_ID = /^[a-z0-9-]+$/i;

export function historyDir(home: string, agentHome = join(home, ".pi", "agent")): string {
	return join(agentHome, "gentle-agents", "tasks");
}

function fileFor(dir: string, id: string): string {
	if (!SAFE_ID.test(id)) throw new Error(`invalid task id: ${id}`);
	return join(dir, `${id}${FILE_SUFFIX}`);
}

const TASK_LOCK_SCHEMA = "gentle-pi.task-reconciliation-lock/v1" as const;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type TaskLockOwner = { schema: typeof TASK_LOCK_SCHEMA; taskId: string; token: string; pid: number; host: string | null };
export interface TaskLock { readonly path: string; readonly taskId: string; readonly token: string; release(): void; }
function taskLockHost(): string | null {
	try {
		const hostname = os.hostname().trim();
		if (process.platform === "linux") { const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), namespace = readlinkSync("/proc/self/ns/pid"); return UUID.test(boot) && /^pid:\[\d+\]$/.test(namespace) ? `linux:${hostname}:${boot}:${namespace}` : null; }
		if (process.platform === "darwin") { const boot = execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 1000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).trim(); return UUID.test(boot) ? `darwin:${hostname}:${boot.toLowerCase()}` : null; }
		return hostname ? `${process.platform}:${hostname}` : null;
	} catch { return null; }
}
function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
}
function lockBusy(path: string, reason: string): Error { return new Error(`Task reconciliation lock is busy or ambiguous at ${path}: ${reason}`); }
function validTaskLockOwner(value: unknown, taskId: string): value is TaskLockOwner {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const owner = value as Partial<TaskLockOwner>;
	return Object.keys(value).sort().join(",") === "host,pid,schema,taskId,token" && owner.schema === TASK_LOCK_SCHEMA && owner.taskId === taskId && typeof owner.token === "string" && UUID.test(owner.token) && Number.isSafeInteger(owner.pid) && owner.pid > 0 && (owner.host === null || typeof owner.host === "string" && owner.host.length > 0 && !owner.host.includes("\0"));
}
function ownerAt(path: string, taskId: string, token: string): TaskLockOwner {
	if (!path.endsWith(`${taskId}.reconcile.${token}`)) throw lockBusy(path, "candidate filename is malformed");
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink()) throw lockBusy(path, "candidate is not an expected regular file");
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!validTaskLockOwner(parsed, taskId) || parsed.token !== token) throw new Error("filename and owner metadata disagree");
		return parsed;
	} catch (error) { throw lockBusy(path, `candidate owner metadata is malformed${error instanceof Error ? `: ${error.message}` : ""}`); }
}
function ownerDead(owner: TaskLockOwner): boolean {
	const host = taskLockHost();
	if (!owner.host || !host || owner.host !== host || owner.pid === process.pid) return false;
	try { process.kill(owner.pid, 0); return false; } catch (error) { return errorCode(error) === "ESRCH"; }
}
function syncTaskLock(path: string, directory = false): void {
	if (directory && process.platform === "win32") return;
	const descriptor = openSync(path, directory ? "r" : "r+");
	try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function publishExclusive(path: string, owner: TaskLockOwner): void {
	const temporary = `${path}.tmp`;
	try { writeFileSync(temporary, JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 }); syncTaskLock(temporary); linkSync(temporary, path); syncTaskLock(dirname(path), true); }
	finally { try { unlinkSync(temporary); } catch {} }
}
function scanTaskCandidates(dir: string, id: string, ownPath: string): void {
	const prefix = `${id}.reconcile.`;
	for (const name of readdirSync(dir)) {
		if (!name.startsWith(prefix) || name.endsWith(".tmp")) continue;
		const path = join(dir, name), token = name.slice(prefix.length);
		if (!UUID.test(token)) throw lockBusy(path, "candidate filename is malformed");
		let owner: TaskLockOwner;
		try { owner = ownerAt(path, id, token); } catch (error) { if (errorCode(error) === "ENOENT") throw lockBusy(path, "candidate disappeared during election"); throw error; }
		if (path === ownPath) continue;
		if (ownerDead(owner)) { try { unlinkSync(path); } catch (error) { if (errorCode(error) !== "ENOENT") throw error; } continue; }
		throw lockBusy(path, "owner is live, foreign, or its death is inconclusive");
	}
}
function releaseTaskLock(path: string, owner: TaskLockOwner): void {
	let current: TaskLockOwner;
	try { current = ownerAt(path, owner.taskId, owner.token); } catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
	if (current.pid !== owner.pid || current.host !== owner.host) throw new Error("Task reconciliation lock owner token does not match");
	unlinkSync(path); syncTaskLock(dirname(path), true);
}
export function acquireTaskLock(dir: string, id: string): TaskLock {
	if (!SAFE_ID.test(id)) throw new Error(`invalid task id: ${id}`);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const owner: TaskLockOwner = { schema: TASK_LOCK_SCHEMA, taskId: id, token: randomUUID(), pid: process.pid, host: taskLockHost() };
	const path = join(dir, `${id}.reconcile.${owner.token}`);
	publishExclusive(path, owner);
	try { scanTaskCandidates(dir, id, path); }
	catch (error) { try { releaseTaskLock(path, owner); } catch {} throw error; }
	let released = false;
	return { path, taskId: id, token: owner.token, release() { if (!released) { releaseTaskLock(path, owner); released = true; } } };
}

function isRecord(value: unknown): value is TaskRecord {
	const task = value as Partial<TaskRecord> | undefined;
	return typeof task?.id === "string" && typeof task.agent === "string" && typeof task.status === "string" && typeof task.createdAt === "number";
}

function parseStored(text: string): StoredTask | undefined {
	try {
		const parsed = JSON.parse(text) as Partial<StoredTask>;
		if (!isRecord(parsed.task)) return undefined;
		const thread = parsed.thread && Array.isArray(parsed.thread.items) ? parsed.thread : emptyThread();
		return { task: parsed.task, thread: { ...emptyThread(), ...thread } };
	} catch {
		return undefined;
	}
}

export async function saveTask(dir: string, task: TaskRecord, thread: TaskThread): Promise<void> {
	await mkdir(dir, { recursive: true });
	const target = fileFor(dir, task.id);
	const temp = `${target}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
	await writeFile(temp, JSON.stringify({ task, thread }), "utf8");
	await rename(temp, target);
}

export async function loadStoredTask(dir: string, id: string): Promise<StoredTask | undefined> {
	if (!SAFE_ID.test(id)) return undefined;
	try {
		return parseStored(await readFile(fileFor(dir, id), "utf8"));
	} catch {
		return undefined;
	}
}

async function listFiles(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).filter((name) => name.endsWith(FILE_SUFFIX));
	} catch {
		return [];
	}
}

export async function loadHistory(dir: string): Promise<StoredTask[]> {
	const files = await listFiles(dir);
	const stored = await Promise.all(files.map(async (name) => parseStored(await readFile(join(dir, name), "utf8").catch(() => ""))));
	return stored.filter((entry): entry is StoredTask => entry !== undefined).sort((a, b) => b.task.createdAt - a.task.createdAt);
}

// Keep the newest `maxTasks` files; the rest go. Returns how many were removed.
export async function pruneHistory(dir: string, maxTasks: number): Promise<number> {
	const stored = await loadHistory(dir);
	const extra = stored.filter(({ task }) => !remediationUnresolved(task)).slice(Math.max(0, maxTasks));
	await Promise.all(extra.map((entry) => rm(fileFor(dir, entry.task.id), { force: true })));
	return extra.length;
}
