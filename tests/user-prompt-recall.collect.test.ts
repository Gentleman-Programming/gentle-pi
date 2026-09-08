import assert from "node:assert/strict";
import test from "node:test";
import userPromptRecall, {
	__testing,
} from "../extensions/user-prompt-recall.ts";
import type { UserPromptSessionEntry } from "../extensions/user-prompt-recall.ts";

const { collectUserPrompts } = __testing;

function userEntry(content: unknown): UserPromptSessionEntry {
	return {
		type: "message",
		message: { role: "user", content },
	};
}

function bashEntry(command: string): UserPromptSessionEntry {
	return {
		type: "message",
		message: { role: "bashExecution", command },
	};
}

function assistantEntry(): UserPromptSessionEntry {
	return {
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
		},
	};
}

test("collects only user-role entries", () => {
	const entries: UserPromptSessionEntry[] = [
		userEntry("hello world"),
		bashEntry("ls"),
		assistantEntry(),
		userEntry("second prompt"),
	];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, ["hello world", "second prompt"]);
});

test("skips bash and assistant entries entirely", () => {
	const entries: UserPromptSessionEntry[] = [
		bashEntry("ls -la"),
		assistantEntry(),
		bashEntry("pwd"),
	];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, []);
});

test("preserves multi-line string content", () => {
	const multi = "line one\nline two\nline three";
	const entries: UserPromptSessionEntry[] = [userEntry(multi)];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, [multi]);
});

test("extracts joined text from content array with mixed text + image blocks", () => {
	const entries: UserPromptSessionEntry[] = [
		userEntry([
			{ type: "text", text: "describe this" },
			{ type: "image", data: "binary-blob", mimeType: "image/png" },
			{ type: "text", text: "thanks" },
		]),
	];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, ["describe this\nthanks"]);
});

test("skips entries with empty string content", () => {
	const entries: UserPromptSessionEntry[] = [userEntry("")];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, []);
});

test("skips entries with empty content array", () => {
	const entries: UserPromptSessionEntry[] = [userEntry([])];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, []);
});

test("skips entries whose content array contains only image blocks", () => {
	const entries: UserPromptSessionEntry[] = [
		userEntry([{ type: "image", data: "binary-blob", mimeType: "image/png" }]),
	];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, []);
});

test("preserves session order across mixed roles", () => {
	const entries: UserPromptSessionEntry[] = [
		bashEntry("ls"),
		userEntry("first user prompt"),
		assistantEntry(),
		userEntry("second user prompt"),
		bashEntry("pwd"),
		userEntry("third user prompt"),
	];
	const prompts = collectUserPrompts(entries);
	assert.deepEqual(prompts, [
		"first user prompt",
		"second user prompt",
		"third user prompt",
	]);
});

test("returns empty array for empty entries", () => {
	assert.deepEqual(collectUserPrompts([]), []);
});

test("skips entries whose type is not 'message'", () => {
	const entries = [
		{ type: "compaction", summary: "..." },
		userEntry("real prompt"),
	] as unknown as UserPromptSessionEntry[];
	assert.deepEqual(collectUserPrompts(entries), ["real prompt"]);
});

test("extension wires collectUserPrompts through the handler without throwing", () => {
	// Smoke test: the extension should never crash when sessionManager
	// returns a mixed list, even before the picker wiring lands.
	const handlers = new Map<string, (args: string, ctx: unknown) => unknown>();
	const pi = {
		registerCommand(
			name: string,
			opts: { handler: (a: string, c: unknown) => unknown },
		) {
			handlers.set(name, opts.handler);
		},
	};
	userPromptRecall(pi as never);
	const handler = handlers.get("input")!;
	const notified: Array<{ msg: string; level: string }> = [];
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: (msg: string, level: string) => {
				notified.push({ msg, level });
			},
			setEditorText: () => {},
			custom: () => Promise.resolve(undefined),
		},
		sessionManager: {
			getEntries: () => [bashEntry("ls"), userEntry("hello"), assistantEntry()],
		},
	};
	assert.doesNotThrow(() => {
		handler("", ctx);
	});
	// Non-empty prompts — picker is wired in Task 5. For Task 4 we just
	// confirm the handler does not throw and does not post the empty notify.
	assert.equal(notified.length, 0);
});
