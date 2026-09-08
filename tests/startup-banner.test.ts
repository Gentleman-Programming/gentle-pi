import assert from "node:assert/strict";
import test from "node:test";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs/promises";
import startup from "../extensions/startup-banner.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../lib/terminal-theme.ts";

// Drive the actual header factory, without executing background git/home reads.
test("startup retains context but emits no artwork, terminal clears or animation", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
	t.mock.method(fs, "readFile", async () => '{"showRose":true,"showTextLogo":true}');
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const argv = process.argv;
	process.argv = ["node"];
	t.after(() => { process.argv = argv; });
	for (const [key, value] of [["rows", 40], ["columns", 160]] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(process.stdout, key);
		Object.defineProperty(process.stdout, key, { configurable: true, value });
		t.after(() => descriptor ? Object.defineProperty(process.stdout, key, descriptor) : Reflect.deleteProperty(process.stdout, key));
	}
	let start: Function;
	let header: { render(width: number): string[]; invalidate(): void };
	let renders = 0;
	const writes: string[] = [];
	startup({ on: (name: string, fn: Function) => { if (name === "session_start") start = fn; }, registerCommand() {}, getCommands: () => [], getAllTools: () => [] } as unknown as ExtensionAPI);
	const write = t.mock.method(process.stdout, "write", (text: string) => { writes.push(String(text)); return true; });
	await start!({}, { hasUI: true, cwd: "/fixture", ui: { setHeader: (factory: Function) => {
		header = factory({ requestRender: () => { renders++; } }, { fg: (_role: string, text: string) => text });
	} } });
	t.mock.timers.tick(50);
	write.mock.restore();
	try {
		for (const width of [40, 80, 160]) {
			const text = stripAnsi(header!.render(width).join("\n"));
			assert.match(text, /GIT:/);
			assert.match(text, /PATH:/);
			assert.doesNotMatch(text, /[\u2800-\u28ff]|[▒▄▀█]|GENTLE PI/);
		}
		t.mock.timers.tick(25);
		assert.equal(renders, 0, "no periodic artwork repaint");
		assert.deepEqual(writes, [], "Pi owns stdout and cursor state");
	} finally { header!.invalidate(); }
});
