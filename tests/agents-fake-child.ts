import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildLike } from "../lib/agents-runner.ts";

// A fake `pi --mode rpc` child: answers every command with a success
// response, records what the host wrote, and lets tests emit events.

export interface FakeChild {
	child: ChildLike;
	written: Array<Record<string, unknown>>;
	emit(event: Record<string, unknown>): void;
	exit(code: number): void;
	fail(message: string): void;
	killed: string[];
}

export function fakeChild(): FakeChild {
	const emitter = new EventEmitter();
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const written: Array<Record<string, unknown>> = [];
	const killed: string[] = [];
	let buffer = "";
	stdin.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const command = JSON.parse(line) as Record<string, unknown>;
			written.push(command);
			if (command.type === "extension_ui_response") continue;
			const data = command.type === "get_state" ? { sessionFile: "/sessions/child.jsonl" } : undefined;
			stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data })}\n`);
		}
	});
	const child: ChildLike = {
		pid: 42,
		stdin,
		stdout,
		stderr: new PassThrough(),
		kill: (signal) => {
			killed.push(String(signal ?? "SIGTERM"));
			return true;
		},
		on: (event, listener) => {
			emitter.on(event, listener);
			return child;
		},
	};
	return { child, written, killed, emit: (event) => stdout.write(`${JSON.stringify(event)}\n`), exit: (code) => emitter.emit("exit", code, null), fail: (message) => emitter.emit("error", new Error(message)) };
}
