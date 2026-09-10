import assert from "node:assert/strict";
import test from "node:test";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs/promises";
import startup, { readGitBranch } from "../extensions/startup-banner.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../lib/terminal-theme.ts";

test("startup branch lookup uses direct git argv and hides its Windows child", async () => {
	const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
	const run = ((command: string, args: readonly string[], options: Record<string, unknown>, callback: (error: Error | null, stdout: string) => void) => {
		calls.push({ command, args, options });
		callback(null, "main\n");
	}) as typeof import("node:child_process").execFile;
	assert.equal(await readGitBranch("/repo with spaces & metacharacters", run), "On branch main");
	assert.deepEqual(calls, [{
		command: "git",
		args: ["-C", "/repo with spaces & metacharacters", "branch", "--show-current"],
		options: { encoding: "utf8", shell: false, windowsHide: true },
	}]);
});

// Drive the real header factory; background git/home reads never run.
for (const showRose of [false, true]) for (const showTextLogo of [false, true]) {
	test(`startup art respects rose=${showRose}, logo=${showTextLogo} and cyan palette`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
		t.mock.method(fs, "readFile", async () => JSON.stringify({ showRose, showTextLogo, color: "cyan" }));
		syncBuiltinESMExports();
		t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
		const argv = process.argv;
		process.argv = ["node"];
		t.after(() => { process.argv = argv; });
		for (const [key, value] of [["rows", 40], ["columns", 160]] as const) {
			const descriptor = Object.getOwnPropertyDescriptor(process.stdout, key);
			Object.defineProperty(process.stdout, key, { configurable: true, writable: true, value });
			t.after(() => descriptor ? Object.defineProperty(process.stdout, key, descriptor) : Reflect.deleteProperty(process.stdout, key));
		}
		let start: Function;
		let shutdown: Function;
		let header: { render(width: number): string[]; invalidate(): void };
		const writes: string[] = [];
		startup({ on: (name: string, fn: Function) => {
			if (name === "session_start") start = fn;
			if (name === "session_shutdown") shutdown = fn;
		}, registerCommand() {}, getCommands: () => [], getAllTools: () => [] } as unknown as ExtensionAPI);
		const write = t.mock.method(process.stdout, "write", (text: string) => { writes.push(String(text)); return true; });
		await start!({}, { hasUI: true, cwd: "/fixture", ui: { setHeader: (factory: Function) => {
			header = factory({ requestRender() {} }, { fg: (_role: string, text: string) => text });
		} } });
		t.mock.timers.tick(50);
		try {
			for (const width of [40, 80, 160]) {
				const lines = header!.render(width);
				assert.ok(lines.every((line) => visibleWidth(line) <= width));
				const text = stripAnsi(lines.join("\n"));
				assert.match(text, /GIT:/);
				assert.match(text, /PATH:/);
				if (width === 160) {
					assert.equal(/[\u2800-\u28ff]/.test(text), showRose);
					assert.equal(/[▒▄▀█]/.test(text), showTextLogo);
				}
				assert.match(lines.join("\n"), /\x1b\[38;2;85;170;205m/, "startup labels use the saved cyan palette");
			}
			// Cancel pending context reads before advancing the resize clock.
			t.mock.timers.reset();
			t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() + 1000 });
			process.stdout.rows = 10;
			process.stdout.emit("resize");
			t.mock.timers.tick(150);
			assert.deepEqual(header!.render(80), []);
			process.stdout.rows = 25;
			process.stdout.columns = 80;
			process.stdout.emit("resize");
			t.mock.timers.tick(150);
			const minimal = stripAnsi(header!.render(80).join("\n"));
			assert.doesNotMatch(minimal, /[\u2800-\u28ff]/);
			assert.equal(/[▒▄▀█]/.test(minimal), showTextLogo);
			assert.deepEqual(writes, [], "Pi owns stdout during startup and resize");
		} finally {
			shutdown!();
			write.mock.restore();
		}
	});
}
