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

type CleanupChild = EventEmitter & { pid?: number; stdin: EventEmitter & { end(input?: string): void }; stdout: EventEmitter & { destroy?(): void }; stderr: EventEmitter & { resume?(): void; destroy?(): void }; kill(): boolean };
type ChildLifecycle = Readonly<{ child: CleanupChild; changed: EventEmitter; closeObserved: boolean; exitObserved: boolean; processError?: Error; stdinError?: Error; stdoutError?: Error; stderrError?: Error; stdinClosed: boolean; stdoutClosed: boolean; stderrClosed: boolean; exitCode: number }>;

function observeChildLifecycle(child: CleanupChild): ChildLifecycle {
	const lifecycle = { child, changed: new EventEmitter(), closeObserved: false, exitObserved: false, processError: undefined as Error | undefined, stdinError: undefined as Error | undefined, stdoutError: undefined as Error | undefined, stderrError: undefined as Error | undefined, stdinClosed: false, stdoutClosed: false, stderrClosed: false, exitCode: -1 };
	const changed = () => lifecycle.changed.emit("changed");
	child.once("close", (code: number | null) => { lifecycle.closeObserved = true; lifecycle.exitCode = code ?? -1; changed(); });
	child.once("exit", () => { lifecycle.exitObserved = true; changed(); });
	child.on("error", (error: Error) => { lifecycle.processError = error; changed(); });
	child.stdin.on("error", (error: Error) => { lifecycle.stdinError = error; changed(); });
	child.stdout.on("error", (error: Error) => { lifecycle.stdoutError = error; changed(); });
	child.stderr.on("error", (error: Error) => { lifecycle.stderrError = error; changed(); });
	child.stdin.once("close", () => { lifecycle.stdinClosed = true; changed(); });
	child.stdout.once("close", () => { lifecycle.stdoutClosed = true; changed(); });
	child.stderr.once("close", () => { lifecycle.stderrClosed = true; changed(); });
	return lifecycle;
}

function hasLifecycleError(lifecycle: ChildLifecycle): boolean {
	return lifecycle.processError !== undefined || lifecycle.stdinError !== undefined || lifecycle.stdoutError !== undefined || lifecycle.stderrError !== undefined;
}

function noProcessStreamsClosed(lifecycle: ChildLifecycle): boolean {
	return lifecycle.processError !== undefined && lifecycle.child.pid === undefined && lifecycle.stdinClosed && lifecycle.stdoutClosed && lifecycle.stderrClosed;
}

function waitForChildClose(lifecycle: ChildLifecycle, deadlineMs: number): Promise<boolean> {
	if (lifecycle.closeObserved || noProcessStreamsClosed(lifecycle)) return Promise.resolve(true);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (closed: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			lifecycle.changed.removeListener("changed", onChanged);
			resolve(closed);
		};
		const onChanged = () => { if (lifecycle.closeObserved || noProcessStreamsClosed(lifecycle)) finish(true); };
		const timer = setTimeout(() => finish(false), deadlineMs);
		lifecycle.changed.on("changed", onChanged);
		onChanged();
	});
}

function waitForStartupControlClose(lifecycle: ChildLifecycle, deadlineMs: number): Promise<boolean> {
	if (lifecycle.closeObserved) return Promise.resolve(true);
	if (hasLifecycleError(lifecycle)) return Promise.resolve(false);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (closed: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			lifecycle.changed.removeListener("changed", onChanged);
			resolve(closed);
		};
		const onChanged = () => { if (lifecycle.closeObserved) finish(true); else if (hasLifecycleError(lifecycle)) finish(false); };
		const timer = setTimeout(() => finish(false), deadlineMs);
		lifecycle.changed.on("changed", onChanged);
		onChanged();
	});
}

async function settleOwnedChild(child: CleanupChild, lifecycle: ChildLifecycle, deadlines: Readonly<{ terminateMs: number; killMs: number }>): Promise<void> {
	if (lifecycle.closeObserved || noProcessStreamsClosed(lifecycle)) return;
	try { child.stdin.end(); } catch { /* cleanup continues through bounded settlement */ }
	if (await waitForChildClose(lifecycle, deadlines.terminateMs)) return;
	if (child.pid === undefined && lifecycle.processError !== undefined) {
		child.stdout.destroy?.();
		child.stderr.destroy?.();
		if (await waitForChildClose(lifecycle, deadlines.killMs)) return;
		throw new Error("owned Windows helper did not settle after spawn failure");
	}
	try { child.kill(); } catch { /* the second bounded wait determines settlement */ }
	if (await waitForChildClose(lifecycle, deadlines.killMs)) return;
	child.stdout.destroy?.();
	child.stderr.destroy?.();
	throw new Error("owned Windows helper did not settle after termination");
}

const maxBootstrapDiagnosticBytes = 512;
const bootstrapDiagnosticCategories = new Set(["compiler", "argument", "invalid-operation", "not-supported", "security", "assembly-load", "type-load", "other"]);
const bootstrapDiagnosticReasons = new Set(["compiler-errors", "source-code-error", "type-already-exists", "reference-load", "unsupported", "unknown"]);
const bootstrapLanguageModes = new Set(["full", "constrained", "restricted", "no-language", "unknown"]);
type BootstrapDiagnostic = Readonly<{ kind: "windows-session-bootstrap-diagnostic"; category: "compiler" | "argument" | "invalid-operation" | "not-supported" | "security" | "assembly-load" | "type-load" | "other"; compilerCodes: readonly string[]; reason: "compiler-errors" | "source-code-error" | "type-already-exists" | "reference-load" | "unsupported" | "unknown"; languageMode: "full" | "constrained" | "restricted" | "no-language" | "unknown" }>;

function parseBootstrapDiagnostic(stderr: string): BootstrapDiagnostic | undefined {
	if (Buffer.byteLength(stderr, "utf8") > maxBootstrapDiagnosticBytes || !stderr.endsWith("\n")) return undefined;
	const lines = stderr.slice(0, -1).split("\n");
	if (lines.length !== 1 || lines[0].length === 0) return undefined;
	let value: unknown;
	try { value = JSON.parse(lines[0]); } catch { return undefined; }
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.length !== 5 || keys.join(",") !== "category,compilerCodes,kind,languageMode,reason" || record.kind !== "windows-session-bootstrap-diagnostic" || typeof record.category !== "string" || !bootstrapDiagnosticCategories.has(record.category) || typeof record.reason !== "string" || !bootstrapDiagnosticReasons.has(record.reason) || typeof record.languageMode !== "string" || !bootstrapLanguageModes.has(record.languageMode) || !Array.isArray(record.compilerCodes) || record.compilerCodes.length > 8 || record.compilerCodes.some((code) => typeof code !== "string")) return undefined;
	const compilerCodes = record.compilerCodes as string[];
	if (new Set(compilerCodes).size !== compilerCodes.length || compilerCodes.some((code) => !/^CS[0-9]{4}$/.test(code)) || (record.category !== "compiler" && compilerCodes.length !== 0)) return undefined;
	return Object.freeze({ kind: "windows-session-bootstrap-diagnostic", category: record.category as BootstrapDiagnostic["category"], compilerCodes: Object.freeze([...compilerCodes]), reason: record.reason as BootstrapDiagnostic["reason"], languageMode: record.languageMode as BootstrapDiagnostic["languageMode"] });
}

function appendBoundedOutput(output: string, chunk: Buffer, limit: number): Readonly<{ output: string; overflow: boolean }> {
	const remaining = limit - Buffer.byteLength(output, "utf8");
	if (remaining <= 0) return { output, overflow: true };
	if (chunk.length <= remaining) return { output: output + chunk.toString("utf8"), overflow: false };
	let end = remaining;
	while (end > 0 && (chunk[end] & 0xc0) === 0x80) end--;
	return { output: output + chunk.subarray(0, end).toString("utf8"), overflow: true };
}

async function runBootstrapStartupControl(options: Readonly<{ spawnProcess?: (...args: any[]) => CleanupChild; startupDeadlineMs?: number; terminateMs?: number; killMs?: number }> = {}): Promise<Readonly<{ code: number; stdout: string; stderr: string; outputOverflow: boolean }>> {
	const child = (options.spawnProcess ?? spawn)(FIXED_WINDOWS_POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", runtime], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) as CleanupChild;
	const lifecycle = observeChildLifecycle(child);
	const deadlines = { startupDeadlineMs: options.startupDeadlineMs ?? 30_000, terminateMs: options.terminateMs ?? 2_500, killMs: options.killMs ?? 2_500 };
	let stdout = "";
	let stderr = "";
	let outputOverflow = false;
	child.stdout.on("data", (chunk: Buffer) => { const captured = appendBoundedOutput(stdout, chunk, maxBootstrapDiagnosticBytes); stdout = captured.output; outputOverflow ||= captured.overflow; });
	child.stderr.on("data", (chunk: Buffer) => { const captured = appendBoundedOutput(stderr, chunk, maxBootstrapDiagnosticBytes); stderr = captured.output; outputOverflow ||= captured.overflow; });
	let inputWriteFailed = false;
	try { child.stdin.end('{"requestId":"start-1","operation":"start"}\n{"requestId":"shutdown-2","operation":"shutdown"}\n'); } catch { inputWriteFailed = true; }
	const closed = inputWriteFailed ? false : await waitForStartupControlClose(lifecycle, deadlines.startupDeadlineMs);
	if (!closed || hasLifecycleError(lifecycle)) {
		let cleanupFailed = false;
		try { await settleOwnedChild(child, lifecycle, deadlines); } catch { cleanupFailed = true; }
		throw new Error(cleanupFailed ? "Windows bootstrap startup control did not settle" : "Windows bootstrap startup control did not complete");
	}
	if (outputOverflow) throw new Error("Windows bootstrap startup control exceeded bounded output");
	return { code: lifecycle.exitCode, stdout, stderr, outputOverflow };
}

function parseStartupControlFrames(stdout: string): readonly ReturnType<typeof parseWindowsHostFrame>[] {
	if (!stdout.endsWith("\n")) throw new Error("Windows bootstrap startup control returned malformed protocol output");
	const lines = stdout.slice(0, -1).split("\n");
	if (lines.length !== 2 || lines.some((line) => line.length === 0)) throw new Error("Windows bootstrap startup control returned malformed protocol output");
	try { return lines.map(parseWindowsHostFrame); } catch { throw new Error("Windows bootstrap startup control returned malformed protocol output"); }
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
	const lifecycle = observeChildLifecycle(child);
	const deadlines = { initialDeadlineMs: options.initialDeadlineMs ?? 25_000, responseDeadlineMs: options.responseDeadlineMs ?? 3_000, terminateMs: options.terminateMs ?? 3_000, killMs: options.killMs ?? 3_000 };
	const frames: ReturnType<typeof parseWindowsHostFrame>[] = [];
	let buffered = "";
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
			if (lifecycle.processError) return settle(lifecycle.processError);
			if (lifecycle.exitObserved || lifecycle.closeObserved) return settle(new Error("Windows helper exited before its reply"));
			if (frames.length >= count) return settle();
			pollTimer = setTimeout(poll, 25);
		};
		poll();
	});
	const exitWithin = async () => {
		if (await waitForChildClose(lifecycle, deadlines.responseDeadlineMs)) return;
		try { await closeOwnedChild(); } catch { throw new Error("Windows helper did not exit after a fatal schema error"); }
		throw new Error("Windows helper did not exit after a fatal schema error");
	};	const closeOwnedChild = () => settleOwnedChild(child, lifecycle, { terminateMs: deadlines.terminateMs, killMs: deadlines.killMs });
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
		get exited() { return lifecycle.closeObserved; },
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
	queueMicrotask(() => { child.emit("error", spawnError); child.stdin.emit("close"); child.stdout.emit("close"); child.stderr.emit("close"); });
	await assert.rejects(openInitializedHelper("C:\\profile\\agent", { spawnProcess: () => child as unknown as CleanupChild, ...fakeCleanupDeadlines }), /spawn failed/);
	assert.equal(child.endCalls, 0);
	assert.equal(child.killCalls, 0);
});

test("owned helper cleanup reports failure after two bounded termination waits", async () => {
	const child = new FakeHelperChild();
	child.killResult = false;
	await assert.rejects(settleOwnedChild(child as unknown as CleanupChild, observeChildLifecycle(child as unknown as CleanupChild), { terminateMs: 10, killMs: 10 }), /did not settle/);
	assert.equal(child.endCalls, 1);
	assert.equal(child.killCalls, 1);
	assert.equal(child.destroyCalls, 2);
});

test("owned helper cleanup settles normally without escalation", async () => {
	const child = new FakeHelperChild();
	const lifecycle = observeChildLifecycle(child as unknown as CleanupChild);
	child.onEnd = () => child.emit("close");
	await settleOwnedChild(child as unknown as CleanupChild, lifecycle, { terminateMs: 20, killMs: 20 });
	assert.equal(child.endCalls, 1);
	assert.equal(child.killCalls, 0);
});

test("owned helper cleanup waits for close after exit", async () => {
	const child = new FakeHelperChild();
	const lifecycle = observeChildLifecycle(child as unknown as CleanupChild);
	queueMicrotask(() => child.emit("exit", 0));
	setTimeout(() => child.emit("close", 0), 15);
	assert.equal(await waitForChildClose(lifecycle, 40), true);
	assert.equal(lifecycle.closeObserved, true);
});

test("owned helper cleanup fails bounded exit without close", async () => {
	const child = new FakeHelperChild();
	const lifecycle = observeChildLifecycle(child as unknown as CleanupChild);
	queueMicrotask(() => child.emit("exit", 0));
	assert.equal(await waitForChildClose(lifecycle, 15), false);
});

test("owned helper cleanup accepts an already observed close", async () => {
	const child = new FakeHelperChild();
	const lifecycle = observeChildLifecycle(child as unknown as CleanupChild);
	child.emit("close", 0);
	assert.equal(await waitForChildClose(lifecycle, 15), true);
});

test("startup control contains asynchronous stdin errors and waits for close", async () => {
	const child = new FakeHelperChild();
	child.onEnd = () => queueMicrotask(() => { child.stdin.emit("error", new Error("input failed")); child.emit("close", 1); });
	await assert.rejects(runBootstrapStartupControl({ spawnProcess: () => child as unknown as CleanupChild, startupDeadlineMs: 20, terminateMs: 10, killMs: 10 }), /did not complete/);
	assert.equal(child.endCalls, 1);
	assert.equal(child.killCalls, 0);
});

test("startup control reports a bounded failure when stdin error never closes", async () => {
	const child = new FakeHelperChild();
	child.onEnd = () => queueMicrotask(() => child.stdin.emit("error", new Error("input failed")));
	await assert.rejects(runBootstrapStartupControl({ spawnProcess: () => child as unknown as CleanupChild, startupDeadlineMs: 20, terminateMs: 10, killMs: 10 }), /did not settle/);
	assert.equal(child.endCalls, 2);
	assert.equal(child.killCalls, 1);
	assert.equal(child.destroyCalls, 2);
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

test("Windows bootstrap Add-Type failures use an owned bounded diagnostic", async () => {
	const source = await readFile(runtime, "utf8");
	assert.match(source, /Add-Type -ErrorAction Stop -ErrorVariable \+addTypeErrors -TypeDefinition @'/);
	assert.match(source, /catch \{\s*\$nativeReady = \$false\s*Write-BootstrapDiagnostic \(@\(\$addTypeErrors\) \+ @\(\$_\)\)\s*\}/);
});

test("Windows bootstrap captures only local Add-Type records and fixed metadata", async () => {
	const source = await readFile(runtime, "utf8");
	assert.match(source, /\$addTypeErrors = @\(\)/);
	assert.match(source, /-ErrorVariable \+addTypeErrors/);
	assert.match(source, /reason = \$reason; languageMode = \$languageMode/);
	assert.doesNotMatch(source, /\$Error\b/);
});

test("Windows bootstrap diagnostic guards wrapped Add-Type entries under StrictMode", async () => {
	const source = await readFile(runtime, "utf8");
	assert.match(source, /function Get-BootstrapProperty/);
	assert.match(source, /function ConvertTo-BootstrapDiagnosticRecord/);
	assert.match(source, /\.PSObject\.Properties\[\$name\]/);
	assert.match(source, /\$candidate -is \[System\.Management\.Automation\.ErrorRecord\]/);
	assert.match(source, /\$wrapped = Get-BootstrapProperty \$candidate 'ErrorRecord'/);
	assert.match(source, /\$wrapped -is \[System\.Management\.Automation\.ErrorRecord\]/);
	assert.match(source, /function Write-BootstrapDiagnosticFallback/);
	assert.match(source, /catch \{ Write-BootstrapDiagnosticFallback \}/);
	assert.doesNotMatch(source, /\$record\.CategoryInfo|\$record\.ErrorDetails|\$record\.Exception/);
});

test("Windows bootstrap diagnostic parser accepts fixed Add-Type evidence", () => {
	assert.deepEqual(parseBootstrapDiagnostic('{"kind":"windows-session-bootstrap-diagnostic","category":"compiler","compilerCodes":["CS1001","CS1739"],"reason":"source-code-error","languageMode":"full"}\n'), {
		kind: "windows-session-bootstrap-diagnostic", category: "compiler", compilerCodes: ["CS1001", "CS1739"], reason: "source-code-error", languageMode: "full",
	});
	assert.deepEqual(parseBootstrapDiagnostic('{"kind":"windows-session-bootstrap-diagnostic","category":"other","compilerCodes":[],"reason":"unknown","languageMode":"constrained"}\n'), {
		kind: "windows-session-bootstrap-diagnostic", category: "other", compilerCodes: [], reason: "unknown", languageMode: "constrained",
	});
	assert.deepEqual(parseBootstrapDiagnostic('{"kind":"windows-session-bootstrap-diagnostic","category":"other","compilerCodes":[],"reason":"unknown","languageMode":"unknown"}\n'), {
		kind: "windows-session-bootstrap-diagnostic", category: "other", compilerCodes: [], reason: "unknown", languageMode: "unknown",
	});
});

test("Windows bootstrap diagnostic parser fails closed for unsafe input", () => {
	assert.equal(parseBootstrapDiagnostic('{"kind":"windows-session-bootstrap-diagnostic","category":"other","compilerCodes":["CS1001"],"reason":"unknown","languageMode":"full"}\n'), undefined);
	assert.equal(parseBootstrapDiagnostic('{"kind":"windows-session-bootstrap-diagnostic","category":"compiler","compilerCodes":["CS1001","CS1001"],"reason":"source-code-error","languageMode":"full"}\n'), undefined);
	assert.equal(parseBootstrapDiagnostic('{"kind":"windows-session-bootstrap-diagnostic","category":"compiler","compilerCodes":[],"reason":"untrusted-error-id","languageMode":"full"}\n'), undefined);
	assert.equal(parseBootstrapDiagnostic("x".repeat(maxBootstrapDiagnosticBytes + 1)), undefined);
});

test("Windows bootstrap startup control", { skip: process.platform !== "win32", timeout: 40_000 }, async (t) => {
	const result = await runBootstrapStartupControl();
	assert.equal(result.code, 0, "Windows bootstrap startup control exited unsuccessfully");
	const frames = parseStartupControlFrames(result.stdout);
	assert.deepEqual(frames.map((frame) => frame.requestId), ["start-1", "shutdown-2"]);
	const [start, shutdown] = frames;
	assert.deepEqual(shutdown, { requestId: "shutdown-2", ok: true, result: { state: "partial" } });
	if (!start.ok && start.error === "unavailable") {
		const diagnostic = parseBootstrapDiagnostic(result.stderr);
		if (!diagnostic) assert.fail("Windows bootstrap startup diagnostic was missing or malformed");
		t.diagnostic(JSON.stringify(diagnostic));
		assert.fail("Windows bootstrap start unavailable");
	}
	assert.deepEqual(start, { requestId: "start-1", ok: true, result: { state: "partial" } });
	if (result.stderr !== "") assert.fail("Windows bootstrap startup control emitted unexpected diagnostics");
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
