import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { FIXED_WINDOWS_POWERSHELL, WindowsSessionTransportHost, parseWindowsHostFrame } from "../lib/windows-session-transport.ts";

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
	const unsupported = host.request("list", {});
	child.stdout.emit("data", Buffer.from('{"requestId":"list-2","ok":false,"error":"invalid"}\n'));
	await assert.rejects(unsupported, /Windows transport request unavailable/);
	const pending = host.request("list", {});
	child.stdout.emit("data", Buffer.from('{"event":"notification","connectionId":"c1","frame":{"version":1,"kind":"notification","id":"message-1","senderSessionId":"peer","recipientSessionId":"self","message":"hello"}}\n'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(child.lines.at(-1) ?? "", /"operation":"ack"/);
	child.emit("exit", 1, null);
	await assert.rejects(pending, /Windows transport host exited/);
});
