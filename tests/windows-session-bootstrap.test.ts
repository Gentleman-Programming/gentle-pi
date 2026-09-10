import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FIXED_WINDOWS_POWERSHELL, parseWindowsHostFrame } from "../lib/windows-session-transport.ts";

const runtime = fileURLToPath(new URL("../runtime/windows-session-transport.ps1", import.meta.url));
const fixture = fileURLToPath(new URL("fixtures/windows-session-bootstrap.ps1", import.meta.url));

type CleanupChild = EventEmitter & { pid?: number; stdin: EventEmitter & { end(): void }; stdout: EventEmitter & { destroy?(): void }; stderr: EventEmitter & { resume?(): void; destroy?(): void }; kill(): boolean };

function waitForChildClose(child: CleanupChild, isClosed: () => boolean, deadlineMs: number): Promise<boolean> {
	if (isClosed()) return Promise.resolve(true);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (closed: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.removeListener("close", onClose);
			child.removeListener("exit", onClose);
			resolve(closed);
		};
		const onClose = () => finish(true);
		const timer = setTimeout(() => finish(false), deadlineMs);
		child.once("close", onClose);
		child.once("exit", onClose);
	});
}

async function settleOwnedChild(child: CleanupChild, isClosed: () => boolean, spawnError: () => Error | undefined, deadlines: Readonly<{ terminateMs: number; killMs: number }>): Promise<void> {
	if (isClosed()) return;
	if (spawnError() && child.pid === undefined) return;
	try { child.stdin.end(); } catch { /* cleanup continues through process settlement */ }
	if (await waitForChildClose(child, isClosed, deadlines.terminateMs)) return;
	try { child.kill(); } catch { /* the second bounded wait determines settlement */ }
	if (await waitForChildClose(child, isClosed, deadlines.killMs)) return;
	child.stdout.destroy?.();
	child.stderr.destroy?.();
	throw new Error("owned Windows helper did not settle after termination");
}

function runPowerShell(script: string, args: string[], input = ""): Promise<{ code: number; stdout: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(FIXED_WINDOWS_POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script, ...args], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
		child.once("error", reject);
		child.once("exit", (code) => resolve({ code: code ?? -1, stdout }));
		child.stdin.end(input);
	});
}

async function openInitializedHelper(agentHome: string, options: Readonly<{ spawnProcess?: (...args: any[]) => CleanupChild; initialDeadlineMs?: number; responseDeadlineMs?: number; terminateMs?: number; killMs?: number }> = {}) {
	const child = (options.spawnProcess ?? spawn)(FIXED_WINDOWS_POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", runtime], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) as CleanupChild;
	const deadlines = { initialDeadlineMs: options.initialDeadlineMs ?? 25_000, responseDeadlineMs: options.responseDeadlineMs ?? 3_000, terminateMs: options.terminateMs ?? 3_000, killMs: options.killMs ?? 3_000 };
	const frames: ReturnType<typeof parseWindowsHostFrame>[] = [];
	let buffered = "";
	let exited = false;
	let spawnError: Error | undefined;
	let exitSettled = false;
	const markExited = () => { if (!exitSettled) { exitSettled = true; exited = true; } };
	child.once("exit", markExited);
	child.once("close", markExited);
	child.once("error", (error) => { spawnError = error; });
	child.stderr.resume();
	const waitFor = (count: number, deadlineMs: number) => new Promise<void>((resolve, reject) => {
		let settled = false;
		let pollTimer: ReturnType<typeof setTimeout> | undefined;
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadlineTimer);
			if (pollTimer) clearTimeout(pollTimer);
			if (error) reject(error); else resolve();
		};
		const deadlineTimer = setTimeout(() => settle(new Error("Windows helper did not reply")), deadlineMs);
		const poll = () => {
			if (spawnError) return settle(spawnError);
			if (exited) return settle(new Error("Windows helper exited before its reply"));
			if (frames.length >= count) return settle();
			pollTimer = setTimeout(poll, 25);
		};
		poll();
	});
	const exitWithin = async () => {
		if (await waitForChildClose(child, () => exited, deadlines.responseDeadlineMs)) return;
		try { await closeOwnedChild(); } catch { throw new Error("Windows helper did not exit after a fatal schema error"); }
		throw new Error("Windows helper did not exit after a fatal schema error");
	};	const closeOwnedChild = () => settleOwnedChild(child, () => exited, () => spawnError, { terminateMs: deadlines.terminateMs, killMs: deadlines.killMs });
	child.stdout.on("data", (chunk: Buffer) => {
		buffered += chunk.toString("utf8");
		for (;;) { const newline = buffered.indexOf("\n"); if (newline < 0) break; frames.push(parseWindowsHostFrame(buffered.slice(0, newline))); buffered = buffered.slice(newline + 1); }
	});
	try {
		child.stdin.write('{"requestId":"start-1","operation":"start"}\n');
		child.stdin.write(`${JSON.stringify({ requestId: "initialize-2", operation: "initialize", agentHome })}\n`);
		await waitFor(2, deadlines.initialDeadlineMs);
	} catch (error) {
		await closeOwnedChild();
		throw error;
	}
	const request = async (operation: "enumerate" | "shutdown") => {
		const count = frames.length + 1;
		const requestId = `${operation}-${count}`;
		child.stdin.write(`${JSON.stringify({ requestId, operation })}\n`);
		await waitFor(count, deadlines.responseDeadlineMs);
		const frame = frames[count - 1];
		assert.equal(frame.requestId, requestId);
		return frame;
	};
	return {
		get frames() { return frames; },
		get exited() { return exited; },
		enumerate: () => request("enumerate"),
		shutdown: () => request("shutdown"),
		invalidStartSchema: async () => { child.stdin.write(`${JSON.stringify({ requestId: `invalid-${frames.length + 1}`, operation: "start", extra: true })}\n`); await exitWithin(); },
		closeInput: closeOwnedChild,
	};
}

type HelperRequest = Readonly<{ requestId: string; operation: "start" | "initialize" | "enumerate" | "shutdown"; agentHome?: string }>;
function plannedHelperRequests(agentHome: string, enumerate: boolean): readonly HelperRequest[] {
	return Object.freeze([
		{ requestId: "start-1", operation: "start" },
		{ requestId: "initialize-2", operation: "initialize", agentHome },
		...(enumerate ? [{ requestId: "enumerate-3", operation: "enumerate" as const }] : []),
		{ requestId: `shutdown-${enumerate ? 4 : 3}`, operation: "shutdown" },
	]);
}

async function helper(agentHome: string, enumerate = false) {
	const requests = plannedHelperRequests(agentHome, enumerate);
	const result = await runPowerShell(runtime, [], requests.map((request) => JSON.stringify(request)).join("\n") + "\n");
	assert.equal(result.code, 0);
	const frames = result.stdout.trim().split("\n").map(parseWindowsHostFrame);
	assert.equal(frames.length, requests.length);
	assert.deepEqual(frames.map((frame) => frame.requestId), requests.map((request) => request.requestId));
	return frames;
}

async function fixtureResult(mode: "capture" | "equals" | "measure" | "add-extra-ace" | "junction" | "rename", path: string, extra: string[] = []) {
	const result = await runPowerShell(fixture, ["-Mode", mode, "-Path", path, ...extra]);
	assert.equal(result.code, 0);
	return JSON.parse(result.stdout) as Record<string, boolean>;
}

class FakeHelperChild extends EventEmitter {
	pid: number | undefined = 42;
	endCalls = 0;
	killCalls = 0;
	destroyCalls = 0;
	killResult = true;
	readonly stdin = Object.assign(new EventEmitter(), { write: (_value: string) => { this.onWrite?.(); return true; }, end: () => { this.endCalls++; this.onEnd?.(); } });
	readonly stdout = Object.assign(new EventEmitter(), { destroy: () => { this.destroyCalls++; } });
	readonly stderr = Object.assign(new EventEmitter(), { resume: () => {}, destroy: () => { this.destroyCalls++; } });
	onWrite?: () => void;
	onEnd?: () => void;
	kill() { this.killCalls++; return this.killResult; }
}

const fakeCleanupDeadlines = Object.freeze({ initialDeadlineMs: 40, responseDeadlineMs: 20, terminateMs: 10, killMs: 10 });

test("owned helper cleanup settles a spawn error without an exit event", async () => {
	const child = new FakeHelperChild();
	child.pid = undefined;
	const spawnError = new Error("spawn failed");
	queueMicrotask(() => child.emit("error", spawnError));
	await assert.rejects(openInitializedHelper("C:\\profile\\agent", { spawnProcess: () => child as unknown as CleanupChild, ...fakeCleanupDeadlines }), /spawn failed/);
	assert.equal(child.endCalls, 0);
	assert.equal(child.killCalls, 0);
});

test("owned helper cleanup reports failure after two bounded termination waits", async () => {
	const child = new FakeHelperChild();
	child.killResult = false;
	await assert.rejects(settleOwnedChild(child as unknown as CleanupChild, () => false, () => undefined, { terminateMs: 10, killMs: 10 }), /did not settle/);
	assert.equal(child.endCalls, 1);
	assert.equal(child.killCalls, 1);
	assert.equal(child.destroyCalls, 2);
});

test("owned helper cleanup settles normally without escalation", async () => {
	const child = new FakeHelperChild();
	let closed = false;
	child.onEnd = () => { closed = true; child.emit("close"); };
	await settleOwnedChild(child as unknown as CleanupChild, () => closed, () => undefined, { terminateMs: 20, killMs: 20 });
	assert.equal(child.endCalls, 1);
	assert.equal(child.killCalls, 0);
});

test("premature helper close rejects initialization and bounded cleanup settles", async () => {
	const child = new FakeHelperChild();
	child.onWrite = () => child.emit("close");
	await assert.rejects(openInitializedHelper("C:\\profile\\agent", { spawnProcess: () => child as unknown as CleanupChild, ...fakeCleanupDeadlines }), /exited before its reply/);
	assert.equal(child.killCalls, 0);
});

test("Windows helper constructs the native Volume GUID path with exactly one native prefix", async () => {
	const source = await readFile(runtime, "utf8");
	assert.ok(source.includes('return @"\\??\\" + volume.Substring(4);'));
});

test("Windows bootstrap bridge admits only explicit partial or initialized public states", () => {
	assert.deepEqual(parseWindowsHostFrame('{"requestId":"start-1","ok":true,"result":{"state":"partial"}}'), {
		requestId: "start-1", ok: true, result: { state: "partial" },
	});
	assert.deepEqual(parseWindowsHostFrame('{"requestId":"initialize-2","ok":true,"result":{"state":"initialized","bootstrap":"complete"}}'), {
		requestId: "initialize-2", ok: true, result: { state: "initialized", bootstrap: "complete" },
	});
	assert.deepEqual(parseWindowsHostFrame('{"requestId":"enumerate-3","ok":true,"result":{"state":"initialized","bootstrap":"complete","entries":2}}'), {
		requestId: "enumerate-3", ok: true, result: { state: "initialized", bootstrap: "complete", entries: 2 },
	});
	assert.throws(() => parseWindowsHostFrame('{"requestId":"start-1","ok":true,"result":{"ready":true}}'), /invalid Windows transport frame/);
});

test("Windows helper request plans correlate standalone and enumeration reply counts", () => {
	assert.deepEqual(plannedHelperRequests("C:\\profile\\agent", false).map((request) => request.requestId), ["start-1", "initialize-2", "shutdown-3"]);
	assert.deepEqual(plannedHelperRequests("C:\\profile\\agent", true).map((request) => request.requestId), ["start-1", "initialize-2", "enumerate-3", "shutdown-4"]);
});

test("Windows-native bootstrap pins ancestors, creates exact private boundaries, and remains partial", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
	const root = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const agentHome = join(root, "profile", "agent");
	const routing = join(agentHome, "gentle-agents");
	const baseline = join(root, "ancestor.sd");
	const ancestorBaselines = [root, join(root, "profile"), agentHome, routing].map((path, index) => ({ path, baseline: join(root, `ancestor-${index}.sd`) }));
	await mkdir(routing, { recursive: true });
	for (const candidate of ancestorBaselines) assert.equal((await fixtureResult("capture", candidate.path, ["-BaselinePath", candidate.baseline])).equal, true);
	assert.equal((await fixtureResult("capture", routing, ["-BaselinePath", baseline])).equal, true);
	const frames = await helper(agentHome);
	assert.deepEqual(frames.map((frame) => frame.ok ? frame.result : frame.error), [{ state: "partial" }, { state: "initialized", bootstrap: "complete" }, { state: "partial" }]);
	assert.equal((await fixtureResult("equals", routing, ["-BaselinePath", baseline])).equal, true);
	for (const candidate of ancestorBaselines) assert.equal((await fixtureResult("equals", candidate.path, ["-BaselinePath", candidate.baseline])).equal, true);
	assert.deepEqual(await fixtureResult("measure", join(routing, "transport")), { ok: true, directory: true, reparse: false, ownerCurrent: true, privateBoundary: true });
	assert.deepEqual(await fixtureResult("measure", join(routing, "transport", "presence")), { ok: true, directory: true, reparse: false, ownerCurrent: true, privateBoundary: true });
	await mkdir(join(routing, "transport", "presence", "seed-a"));
	await mkdir(join(routing, "transport", "presence", "seed-b"));
	assert.deepEqual((await helper(agentHome, true))[2].result, { state: "initialized", bootstrap: "complete", entries: 2 });
});

test("Windows-native bootstrap rejects a corrupted private boundary and preserves a failed bootstrap without recursive cleanup", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
	const root = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const agentHome = join(root, "profile", "agent");
	const routing = join(agentHome, "gentle-agents");
	const badBoundary = join(routing, "transport");
	const badBaseline = join(root, "bad-boundary.sd");
	await mkdir(badBoundary, { recursive: true });
	await fixtureResult("add-extra-ace", badBoundary);
	assert.equal((await fixtureResult("capture", badBoundary, ["-BaselinePath", badBaseline])).equal, true);
	const frames = await helper(agentHome);
	assert.equal(frames[1].ok, false);
	assert.equal(frames[1].error, "unsafe");
	await stat(badBoundary);
	assert.equal((await fixtureResult("equals", badBoundary, ["-BaselinePath", badBaseline])).equal, true);
	await assert.rejects(stat(join(badBoundary, "presence")));
});

test("Windows-native bootstrap releases handles on shutdown before its stdin closes", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
	const root = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const agentHome = join(root, "profile", "agent");
	const routing = join(agentHome, "gentle-agents");
	await mkdir(routing, { recursive: true });
	const held = await openInitializedHelper(agentHome);
	assert.deepEqual(held.frames[1].result, { state: "initialized", bootstrap: "complete" });
	await held.shutdown();
	assert.equal(held.exited, false);
	assert.deepEqual(await fixtureResult("rename", routing, ["-Target", join(root, "routing-after-shutdown")]), { ok: true, renamed: true });
	await held.closeInput();
});

test("Windows-native bootstrap exits on an invalid recognized schema while stdin remains open", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
	const root = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const agentHome = join(root, "profile", "agent");
	const routing = join(agentHome, "gentle-agents");
	await mkdir(routing, { recursive: true });
	const held = await openInitializedHelper(agentHome);
	await held.invalidStartSchema();
	assert.equal(held.exited, true);
	assert.equal(held.frames[2].error, "invalid");
	assert.deepEqual(await fixtureResult("rename", routing, ["-Target", join(root, "routing-after-invalid")]), { ok: true, renamed: true });
});

test("Windows-native failed bootstrap releases its handles before stdin closes", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
	const root = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const agentHome = join(root, "profile", "agent");
	const routing = join(agentHome, "gentle-agents");
	await mkdir(join(routing, "transport"), { recursive: true });
	await fixtureResult("add-extra-ace", join(routing, "transport"));
	const held = await openInitializedHelper(agentHome);
	assert.equal(held.frames[1].error, "unsafe");
	assert.equal(held.exited, false);
	assert.deepEqual(await fixtureResult("rename", routing, ["-Target", join(root, "routing-after-failure")]), { ok: true, renamed: true });
	await held.closeInput();
});

test("Windows-native bootstrap closes pinned handles after malformed input", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
	const root = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const agentHome = join(root, "profile", "agent");
	const routing = join(agentHome, "gentle-agents");
	await mkdir(routing, { recursive: true });
	const input = ['{"requestId":"start-1","operation":"start"}', JSON.stringify({ requestId: "initialize-2", operation: "initialize", agentHome }), "{"].join("\n") + "\n";
	const result = await runPowerShell(runtime, [], input);
	assert.equal(result.code, 0);
	assert.equal(result.stdout.trim().split("\n").map(parseWindowsHostFrame)[1].result?.state, "initialized");
	assert.deepEqual(await fixtureResult("rename", routing, ["-Target", join(root, "routing-released")]), { ok: true, renamed: true });
});

test("Windows-native bootstrap rejects a reparse routing parent and concurrent initialize does not hang", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
	const root = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const agentHome = join(root, "profile", "agent");
	const routing = join(agentHome, "gentle-agents");
	const target = join(root, "routing-target");
	await mkdir(join(agentHome), { recursive: true });
	await mkdir(target);
	await fixtureResult("junction", routing, ["-Target", target]);
	assert.equal((await helper(agentHome))[1].error, "unsafe");
	const concurrentRoot = await mkdtemp(join(os.tmpdir(), "gentle-pi-bootstrap-"));
	const concurrentHome = join(concurrentRoot, "profile", "agent");
	await mkdir(join(concurrentHome, "gentle-agents"), { recursive: true });
	const helpers = await Promise.all([openInitializedHelper(concurrentHome), openInitializedHelper(concurrentHome)]);
	const results = await Promise.all(helpers.map((candidate) => candidate.enumerate()));
	for (const frame of results) assert.deepEqual(frame.result, { state: "initialized", bootstrap: "complete", entries: 0 });
	await Promise.all(helpers.map((candidate) => candidate.shutdown()));
	await Promise.all(helpers.map((candidate) => candidate.closeInput()));
});
