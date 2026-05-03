import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlSessionTreeStorage } from "../../src/harness/session/jsonl-session-storage.js";
import { InMemorySessionTreeStorage } from "../../src/harness/session/memory-session-storage.js";
import { DefaultSessionTree } from "../../src/harness/session/session-tree.js";
import type { SessionTreeStorage } from "../../src/harness/types.js";

function createUserMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function createAssistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

async function runSessionTreeSuite(name: string, createStorage: () => SessionTreeStorage, inspect?: () => void) {
	describe(name, () => {
		it("appends messages and builds context in order", async () => {
			const tree = new DefaultSessionTree(createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendMessage(createAssistantMessage("two"));
			const context = await tree.buildContext();
			expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		});

		it("tracks model and thinking level changes", async () => {
			const tree = new DefaultSessionTree(createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendModelChange("openai", "gpt-4.1");
			await tree.appendThinkingLevelChange("high");
			const context = await tree.buildContext();
			expect(context.thinkingLevel).toBe("high");
			expect(context.model).toEqual({ provider: "openai", modelId: "gpt-4.1" });
		});

		it("supports branching by moving the leaf and appending a new branch", async () => {
			const tree = new DefaultSessionTree(createStorage());
			const user1 = await tree.appendMessage(createUserMessage("one"));
			const assistant1 = await tree.appendMessage(createAssistantMessage("two"));
			await tree.appendMessage(createUserMessage("three"));
			await tree.moveTo(user1);
			await tree.appendMessage(createAssistantMessage("branched"));
			const branch = await tree.getBranch();
			expect(branch.map((entry) => entry.id)).toContain(user1);
			expect(branch.map((entry) => entry.id)).not.toContain(assistant1);
			const context = await tree.buildContext();
			expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		});

		it("supports moving the leaf to root", async () => {
			const tree = new DefaultSessionTree(createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.moveTo(null);
			expect(await tree.getLeafId()).toBeNull();
			expect((await tree.buildContext()).messages).toEqual([]);
		});

		it("reconstructs compaction summaries in context", async () => {
			const tree = new DefaultSessionTree(createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendMessage(createAssistantMessage("two"));
			const user2 = await tree.appendMessage(createUserMessage("three"));
			await tree.appendMessage(createAssistantMessage("four"));
			await tree.appendCompaction("summary", user2, 1234);
			await tree.appendMessage(createUserMessage("five"));
			const context = await tree.buildContext();
			expect(context.messages[0]?.role).toBe("compactionSummary");
			expect(context.messages).toHaveLength(4);
		});

		it("supports branch summary entries in context", async () => {
			const tree = new DefaultSessionTree(createStorage());
			const user1 = await tree.appendMessage(createUserMessage("one"));
			await tree.appendBranchSummary(user1, "summary text");
			const context = await tree.buildContext();
			expect(context.messages[1]?.role).toBe("branchSummary");
		});

		it("supports custom message entries in context", async () => {
			const tree = new DefaultSessionTree(createStorage());
			await tree.appendMessage(createUserMessage("one"));
			await tree.appendCustomMessageEntry("custom", "hello", true, { ok: true });
			const context = await tree.buildContext();
			expect(context.messages[1]?.role).toBe("custom");
		});

		it("supports labels and session info entries without affecting context", async () => {
			const tree = new DefaultSessionTree(createStorage());
			const user1 = await tree.appendMessage(createUserMessage("one"));
			await tree.appendLabelChange(user1, "checkpoint");
			await tree.appendSessionInfo("name");
			const entries = await tree.getEntries();
			expect(entries.some((entry) => entry.type === "label")).toBe(true);
			expect(entries.some((entry) => entry.type === "session_info")).toBe(true);
			expect(await tree.getLabel(user1)).toBe("checkpoint");
			expect(await tree.getSessionName()).toBe("name");
			expect((await tree.buildContext()).messages).toHaveLength(1);
		});

		it("persists leaf changes and appended entries via storage", async () => {
			const storage = createStorage();
			const tree = new DefaultSessionTree(storage);
			const user1 = await tree.appendMessage(createUserMessage("one"));
			await tree.appendMessage(createAssistantMessage("two"));
			await tree.appendLabelChange(user1, "checkpoint");
			await tree.appendSessionInfo("name");
			await tree.moveTo(user1);
			await tree.appendMessage(createAssistantMessage("branched"));
			const tree2 = new DefaultSessionTree(storage);
			const context = await tree2.buildContext();
			expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
			expect(await tree2.getLabel(user1)).toBe("checkpoint");
			expect(await tree2.getSessionName()).toBe("name");
			inspect?.();
		});
	});
}

runSessionTreeSuite("SessionTree with in-memory storage", () => new InMemorySessionTreeStorage());

runSessionTreeSuite(
	"SessionTree with JSONL storage",
	() => {
		const dir = join(tmpdir(), `pi-agent-session-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		tempDirs.push(dir);
		return new JsonlSessionTreeStorage(join(dir, "session.jsonl"), { cwd: dir });
	},
	() => {
		const dir = tempDirs[tempDirs.length - 1]!;
		const filePath = join(dir, "session.jsonl");
		const lines = readFileSync(filePath, "utf8").trim().split("\n");
		expect(lines.length).toBeGreaterThan(1);
		const header = JSON.parse(lines[0]!);
		expect(header.type).toBe("session");
		expect(header.version).toBe(3);
		for (const line of lines.slice(1)) {
			const entry = JSON.parse(line);
			expect(entry.type).not.toBe("entry");
			expect(entry.type).not.toBe("leaf");
			expect(typeof entry.id).toBe("string");
		}
	},
);
