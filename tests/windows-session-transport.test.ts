import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { FIXED_WINDOWS_POWERSHELL, WindowsActiveSessionListener, WindowsSessionPresenceRegistry, WindowsSessionTransportHost, parseWindowsHostFrame, parseWindowsHostNotification } from "../lib/windows-session-transport.ts";
import type { PresenceRecord } from "../lib/agents-session-transport.ts";

class FakeTransportChild extends EventEmitter {
	stdin = { writable: true, write: (line: string, callback: (error?: Error) => void) => { this.lines.push(line); callback(); return true; } };
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	lines: string[] = [];
	killCalls = 0;
	kill() { this.killCalls++; return true; }
}

const testEndpoint = "\\\\.\\pipe\\gentle-pi-0123456789abcdef0123456789abcdef";
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const notificationWire = (id: string, message = "ok") => Buffer.from(JSON.stringify({ version: 1, kind: "notification", id, senderSessionId: "sender", recipientSessionId: "recipient", message }) + "\n").toString("base64");
const notificationEvent = (wire: string, connectionId = "connection-1") => JSON.stringify({ event: "notification", connectionId, generation: 1, wire });

async function createListeningFakeHost(callback: () => Promise<boolean>) {
	const child = new FakeTransportChild();
	const host = new WindowsSessionTransportHost({ spawnProcess: () => child as never, callback });
	const emit = (line: string) => child.stdout.emit("data", Buffer.from(`${line}\n`));
	const starting = host.start();
	emit('{"requestId":"start-1","ok":true,"result":{"state":"partial"}}');
	await starting;
	const listening = host.listen("recipient", 1);
	emit(`{"requestId":"listen-2","ok":true,"result":{"version":1,"sessionId":"recipient","endpoint":"${testEndpoint.replaceAll("\\", "\\\\")}","createdAt":1}}`);
	await listening;
	return { child, host, emit };
}

test("Windows listener readiness returns only after helper-owned publication without a stale publish RPC", async () => {
	const child = new FakeTransportChild();
	const host = new WindowsSessionTransportHost({ spawnProcess: () => child as never });
	const Registry = WindowsSessionPresenceRegistry as unknown as { new(host: WindowsSessionTransportHost): WindowsSessionPresenceRegistry };
	const registry = new Registry(host);
	const emit = (line: string) => child.stdout.emit("data", Buffer.from(`${line}\n`));
	const ready = host.start();
	emit('{"requestId":"start-1","ok":true,"result":{"state":"partial"}}');
	await ready;
	let settled = false;
	const starting = registry.startListener("recipient").then((record) => { settled = true; return record; }, (error: unknown) => { settled = true; throw error; });
	try {
		emit(`{"requestId":"listen-2","ok":true,"result":{"version":1,"sessionId":"recipient","endpoint":"${testEndpoint.replaceAll("\\", "\\\\")}","createdAt":1}}`);
		await nextTurn();
		assert.equal(settled, true, "a successful listen reply must already own its publication");
		assert.deepEqual(await starting, { version: 1, sessionId: "recipient", endpoint: testEndpoint, createdAt: 1 });
		assert.equal(child.lines.filter((line) => line.includes('"operation":"publish"')).length, 0, "listener startup must not re-publish a record after helper readiness");
	} finally {
		child.emit("exit", 1, null);
		await starting.catch(() => {});
	}
});

test("Windows bridge accepts only bounded protocol frames and uses the fixed PS5.1 executable", () => {
	assert.equal(FIXED_WINDOWS_POWERSHELL, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
	assert.deepEqual(parseWindowsHostFrame('{"requestId":"r1","ok":true,"result":{"state":"partial"}}'), { requestId: "r1", ok: true, result: { state: "partial" } });
	for (const frame of ["", "{", '{"requestId":"r1","ok":true,"error":"unsafe"}', '{"requestId":"r1","ok":true,"result":{"path":"C:\\\\private"}}', "x".repeat(16_385)]) {
		assert.throws(() => parseWindowsHostFrame(frame), /invalid Windows transport frame/);
	}
});

test("Windows bridge admits bounded public presence results while rejecting private metadata", () => {
	const endpoint = "\\\\.\\pipe\\gentle-pi-0123456789abcdef0123456789abcdef";
	assert.deepEqual(parseWindowsHostFrame(`{"requestId":"record-1","ok":true,"result":{"version":1,"sessionId":"session-a","endpoint":"${endpoint.replaceAll("\\", "\\\\")}","createdAt":1}}`), {
		requestId: "record-1", ok: true, result: { version: 1, sessionId: "session-a", endpoint, createdAt: 1 },
	});
	assert.deepEqual(parseWindowsHostFrame(`{"requestId":"list-2","ok":true,"result":{"records":[{"version":1,"sessionId":"session-a","endpoint":"${endpoint.replaceAll("\\", "\\\\")}","createdAt":1}]}}`), {
		requestId: "list-2", ok: true, result: { records: [{ version: 1, sessionId: "session-a", endpoint, createdAt: 1 }] },
	});
	assert.throws(() => parseWindowsHostFrame(`{"requestId":"record-1","ok":true,"result":{"version":1,"sessionId":"session-a","endpoint":"${endpoint.replaceAll("\\", "\\\\")}","createdAt":1,"path":"C:\\\\private"}}`), /invalid Windows transport frame/);
});

test("Windows bridge rejects list elements with extra or malformed public fields", () => {
	const endpoint = "\\\\.\\pipe\\gentle-pi-0123456789abcdef0123456789abcdef".replaceAll("\\", "\\\\");
	for (const record of [
		`{"version":1,"sessionId":"session-a","endpoint":"${endpoint}","createdAt":1,"extra":true}`,
		`{"version":1,"sessionId":"session-a","endpoint":"${endpoint}","createdAt":true}`,
	]) assert.throws(() => parseWindowsHostFrame(`{"requestId":"list-1","ok":true,"result":{"records":[${record}]}}`), /invalid Windows transport frame/);
});

test("Windows bridge decodes a bounded base64 notification event before semantic acknowledgement", () => {
	const wire = Buffer.from('{"version":1,"kind":"notification","id":"message-1","senderSessionId":"peer","recipientSessionId":"self","message":"hello"}\n').toString("base64");
	assert.deepEqual(parseWindowsHostNotification(`{"event":"notification","connectionId":"c1","generation":1,"wire":"${wire}"}`), {
		event: "notification", connectionId: "c1", generation: 1,
		frame: { version: 1, kind: "notification", id: "message-1", senderSessionId: "peer", recipientSessionId: "self", message: "hello" },
	});
	for (const invalid of [
		'{"event":"notification","connectionId":"c1","generation":1,"wire":"not-base64"}',
		'{"event":"notification","connectionId":"c1","generation":0,"wire":"eA=="}',
		'{"event":"notification","connectionId":"c1","generation":1,"wire":"eA==","path":"private"}',
	]) assert.throws(() => parseWindowsHostNotification(invalid), /invalid Windows transport frame/);
});

test("Windows bridge correlates callback acknowledgement and rejects pending RPCs when its host exits", async () => {
	class FakeChild extends EventEmitter {
		stdin = { writable: true, write: (line: string, callback: (error?: Error) => void) => { this.lines.push(line); callback(); return true; } };
		stdout = new EventEmitter();
		stderr = new EventEmitter();
		exitCode: number | null = null;
		signalCode: NodeJS.Signals | null = null;
		lines: string[] = [];
		kill() { return true; }
	}
	const child = new FakeChild();
	const host = new WindowsSessionTransportHost({
		runtimeScript: "C:\\runtime\\windows-session-transport.ps1",
		spawnProcess: () => child as never,
		callback: async (notification) => {
			assert.equal(notification.id, "message-1");
			return true;
		},
	});
	const ready = host.start();
	child.stdout.emit("data", Buffer.from('{"requestId":"start-1","ok":true,"result":{"state":"partial"}}\n'));
	await ready;
	const endpoint = "\\\\.\\pipe\\gentle-pi-0123456789abcdef0123456789abcdef";
	const listening = host.listen("self", 1);
	child.stdout.emit("data", Buffer.from(`{"requestId":"listen-2","ok":true,"result":{"version":1,"sessionId":"self","endpoint":"${endpoint.replaceAll("\\", "\\\\")}","createdAt":1}}\n`));
	await listening;
	const unsupported = host.request("list", {});
	child.stdout.emit("data", Buffer.from('{"requestId":"list-3","ok":false,"error":"invalid"}\n'));
	await assert.rejects(unsupported, /Windows transport request unavailable/);
	const pending = host.request("list", {});
	const wire = Buffer.from('{"version":1,"kind":"notification","id":"message-1","senderSessionId":"peer","recipientSessionId":"self","message":"hello"}\n').toString("base64");
	child.stdout.emit("data", Buffer.from(`{"event":"notification","connectionId":"c1","generation":1,"wire":"${wire}"}\n`));
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(child.lines.at(-1) ?? "", /"operation":"ack"/);
	child.emit("exit", 1, null);
	await assert.rejects(pending, /Windows transport host exited/);
});

test("Windows bridge keeps ACK capacity separate from ordinary RPCs and suppresses stale generations", async () => {
	class FakeChild extends EventEmitter {
		stdin = { writable: true, write: (line: string, callback: (error?: Error) => void) => { this.lines.push(line); callback(); return true; } };
		stdout = new EventEmitter(); stderr = new EventEmitter(); exitCode: number | null = null; signalCode: NodeJS.Signals | null = null; lines: string[] = [];
		kill() { return true; }
	}
	const child = new FakeChild();
	let callbacks = 0;
	const host = new WindowsSessionTransportHost({ spawnProcess: () => child as never, callback: async () => { callbacks++; return true; } });
	const endpoint = "\\\\.\\pipe\\gentle-pi-0123456789abcdef0123456789abcdef";
	const emit = (value: string) => child.stdout.emit("data", Buffer.from(`${value}\n`));
	const starting = host.start();
	emit('{"requestId":"start-1","ok":true,"result":{"state":"partial"}}');
	await starting;
	const listening = host.listen("recipient", 1);
	emit(`{"requestId":"listen-2","ok":true,"result":{"version":1,"sessionId":"recipient","endpoint":"${endpoint.replaceAll("\\", "\\\\")}","createdAt":1}}`);
	await listening;
	const ordinary = Array.from({ length: 8 }, () => host.request("list", {}));
	const wire = Buffer.from('{"version":1,"kind":"notification","id":"ack-capacity-1","senderSessionId":"sender","recipientSessionId":"recipient","message":"ok"}\n').toString("base64");
	emit(`{"event":"notification","connectionId":"known-1","generation":1,"wire":"${wire}"}`);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(callbacks, 1);
	assert.equal(child.lines.filter((line) => line.includes('"operation":"ack"')).length, 1, "ACK must bypass full ordinary RPC capacity");
	emit(`{"event":"notification","connectionId":"stale-1","generation":2,"wire":"${wire}"}`);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(callbacks, 1, "a stale helper generation must not reach the callback");
	assert.equal(child.lines.filter((line) => line.includes('"operation":"ack"')).length, 1, "a stale helper generation must not receive an ACK");
	child.emit("exit", 1, null);
	await Promise.all(ordinary.map((request) => assert.rejects(request, /Windows transport host exited/)));
});

test("Windows listener registers its callback before listen and cancels a start/close race", async () => {
	const record = Object.freeze({ version: 1 as const, sessionId: "recipient", endpoint: "\\\\.\\pipe\\gentle-pi-0123456789abcdef0123456789abcdef", createdAt: 1 });
	let registered: unknown;
	let releaseStart!: () => void;
	const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
	let stopped: PresenceRecord | undefined;
	const registry = {
		setNotification(callback: unknown) { registered = callback; },
		async startListener() { assert.ok(registered, "callback must be registered before listen"); await startGate; return record; },
		async stopListener(value: PresenceRecord) { stopped = value; },
		async close() {},
	} as unknown as WindowsSessionPresenceRegistry;
	const listener = new WindowsActiveSessionListener(registry, "recipient", async () => {});
	const starting = listener.start();
	await listener.close();
	releaseStart();
	await assert.rejects(starting, /listener is closed/);
	assert.deepEqual(stopped, record);
	assert.equal(listener.status, "closed");
});

test("Windows bridge isolates a malformed helper wire event and continues with the next valid notification", async () => {
	class FakeChild extends EventEmitter {
		stdin = { writable: true, write: (line: string, callback: (error?: Error) => void) => { this.lines.push(line); callback(); return true; } };
		stdout = new EventEmitter(); stderr = new EventEmitter(); exitCode: number | null = null; signalCode: NodeJS.Signals | null = null; lines: string[] = []; killCalls = 0;
		kill() { this.killCalls++; return true; }
	}
	const child = new FakeChild();
	let callbacks = 0;
	const host = new WindowsSessionTransportHost({ spawnProcess: () => child as never, callback: async () => { callbacks++; return true; } });
	const endpoint = "\\\\.\\pipe\\gentle-pi-0123456789abcdef0123456789abcdef";
	const emit = (line: string) => child.stdout.emit("data", Buffer.from(`${line}\n`));
	const starting = host.start(); emit('{"requestId":"start-1","ok":true,"result":{"state":"partial"}}'); await starting;
	const listening = host.listen("recipient", 1); emit(`{"requestId":"listen-2","ok":true,"result":{"version":1,"sessionId":"recipient","endpoint":"${endpoint.replaceAll("\\", "\\\\")}","createdAt":1}}`); await listening;
	emit('{"event":"notification","connectionId":"bad-1","generation":1,"wire":"eA=="}');
	const wire = Buffer.from('{"version":1,"kind":"notification","id":"after-bad-1","senderSessionId":"sender","recipientSessionId":"recipient","message":"ok"}\n').toString("base64");
	emit(`{"event":"notification","connectionId":"good-1","generation":1,"wire":"${wire}"}`);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(callbacks, 1);
	assert.equal(child.lines.filter((line) => line.includes('"operation":"ack"')).length, 1);
	emit("{");
	await host.close();
	assert.equal(child.killCalls, 1, "close must settle an already-aborted owned child");
	});

test("Windows bridge buffers private base64 control events per line without stopping its shared helper", async () => {
	for (const fragmented of [false, true]) {
		let callbacks = 0;
		const { child, emit } = await createListeningFakeHost(async () => { callbacks++; return true; });
		const malformed = notificationEvent(Buffer.alloc(65_536, 0x78).toString("base64"), `bad-${fragmented}`);
		if (fragmented) {
			const split = Math.floor(malformed.length / 2);
			child.stdout.emit("data", Buffer.from(malformed.slice(0, split)));
			child.stdout.emit("data", Buffer.from(`${malformed.slice(split)}\n`));
		} else emit(malformed);
		emit(notificationEvent(notificationWire(`after-malformed-${fragmented}`), `good-${fragmented}`));
		await nextTurn();
		assert.equal(callbacks, 1, "a malformed client wire must be isolated to its connection");
		assert.equal(child.killCalls, 0, "a valid helper envelope must keep the shared helper alive");
		child.emit("exit", 1, null);
	}
});

test("Windows bridge accepts batched bounded private events beyond the public control-frame aggregate cap", async () => {
	let callbacks = 0;
	const { child } = await createListeningFakeHost(async () => { callbacks++; return true; });
	const batch = `${notificationEvent(notificationWire("batch-1", "x".repeat(4_000)), "batch-connection-1")}\n${notificationEvent(notificationWire("batch-2", "x".repeat(4_000)), "batch-connection-2")}\n${notificationEvent(notificationWire("batch-3", "x".repeat(4_000)), "batch-connection-3")}\n`;
	assert.ok(Buffer.byteLength(batch) > 16_384);
	child.stdout.emit("data", Buffer.from(batch));
	await nextTurn();
	assert.equal(callbacks, 3);
	assert.equal(child.killCalls, 0);
	child.emit("exit", 1, null);
});

test("Windows bridge fail-closes oversized unterminated and invalid helper control frames", async () => {
	for (const line of ["x".repeat(90_000), '{"event":"notification","connectionId":"c1","generation":1,"wire":"not-base64"}', '{"event":"notification","connectionId":"c1","generation":1,"wire":"eA==","extra":true}']) {
		const { child, emit } = await createListeningFakeHost(async () => true);
		if (line.startsWith("x")) child.stdout.emit("data", Buffer.from(line)); else emit(line);
		assert.equal(child.killCalls, 1, "invalid helper control input must close its owned child");
	}

});
