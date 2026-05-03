import {
	type AssistantMessage,
	type FauxProviderRegistration,
	fauxAssistantMessage,
	type Model,
	registerFauxProvider,
	type Usage,
} from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	calculateContextTokens,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	findCutPoint,
	generateSummary,
	prepareCompaction,
	serializeConversation,
	shouldCompact,
} from "../../src/harness/compaction/compaction.js";
import { buildSessionContext } from "../../src/harness/session/session-tree.js";
import type {
	CompactionEntry,
	CompactionSettings,
	MessageEntry,
	ModelChangeEntry,
	SessionTreeEntry,
	ThinkingLevelChangeEntry,
} from "../../src/harness/types.js";
import type { AgentMessage } from "../../src/types.js";

let nextId = 0;
function createId(): string {
	return `entry-${nextId++}`;
}

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createUserMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function createAssistantMessage(text: string, usage = createMockUsage(100, 50)): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createMessageEntry(message: AgentMessage, parentId: string | null = null): MessageEntry {
	return {
		type: "message",
		id: createId(),
		parentId,
		timestamp: new Date().toISOString(),
		message,
	};
}

function createCompactionEntry(
	summary: string,
	firstKeptEntryId: string,
	parentId: string | null = null,
): CompactionEntry {
	return {
		type: "compaction",
		id: createId(),
		parentId,
		timestamp: new Date().toISOString(),
		summary,
		firstKeptEntryId,
		tokensBefore: 1234,
	};
}

function createThinkingLevelEntry(level: string, parentId: string | null = null): ThinkingLevelChangeEntry {
	return {
		type: "thinking_level_change",
		id: createId(),
		parentId,
		timestamp: new Date().toISOString(),
		thinkingLevel: level,
	};
}

function createModelChangeEntry(provider: string, modelId: string, parentId: string | null = null): ModelChangeEntry {
	return {
		type: "model_change",
		id: createId(),
		parentId,
		timestamp: new Date().toISOString(),
		provider,
		modelId,
	};
}

function createFauxModel(reasoning: boolean): { faux: FauxProviderRegistration; model: Model<string> } {
	const faux = registerFauxProvider({
		models: [
			{
				id: reasoning ? "reasoning-model" : "non-reasoning-model",
				reasoning,
				contextWindow: 200000,
				maxTokens: 8192,
			},
		],
	});
	fauxRegistrations.push(faux);
	return { faux, model: faux.getModel() };
}

const fauxRegistrations: FauxProviderRegistration[] = [];

afterEach(() => {
	while (fauxRegistrations.length > 0) {
		fauxRegistrations.pop()?.unregister();
	}
});

describe("harness compaction", () => {
	beforeEach(() => {
		nextId = 0;
	});

	it("calculates total context tokens from usage", () => {
		expect(calculateContextTokens(createMockUsage(1000, 500, 200, 100))).toBe(1800);
		expect(calculateContextTokens(createMockUsage(0, 0, 0, 0))).toBe(0);
	});

	it("checks compaction threshold", () => {
		const settings: CompactionSettings = {
			enabled: true,
			reserveTokens: 10000,
			keepRecentTokens: 20000,
		};
		expect(shouldCompact(95000, 100000, settings)).toBe(true);
		expect(shouldCompact(89000, 100000, settings)).toBe(false);
		expect(shouldCompact(95000, 100000, { ...settings, enabled: false })).toBe(false);
	});

	it("finds a cut point based on token differences", () => {
		const entries: SessionTreeEntry[] = [];
		let parentId: string | null = null;
		for (let i = 0; i < 10; i++) {
			const user = createMessageEntry(createUserMessage(`User ${i}`), parentId);
			entries.push(user);
			const assistant = createMessageEntry(
				createAssistantMessage(`Assistant ${i}`, createMockUsage(0, 100, (i + 1) * 1000, 0)),
				user.id,
			);
			entries.push(assistant);
			parentId = assistant.id;
		}

		const result = findCutPoint(entries, 0, entries.length, 2500);
		expect(entries[result.firstKeptEntryIndex]?.type).toBe("message");
	});

	it("builds session context with a compaction entry", () => {
		const u1 = createMessageEntry(createUserMessage("1"));
		const a1 = createMessageEntry(createAssistantMessage("a"), u1.id);
		const u2 = createMessageEntry(createUserMessage("2"), a1.id);
		const a2 = createMessageEntry(createAssistantMessage("b"), u2.id);
		const compaction = createCompactionEntry("Summary of 1,a,2,b", u2.id, a2.id);
		const u3 = createMessageEntry(createUserMessage("3"), compaction.id);
		const a3 = createMessageEntry(createAssistantMessage("c"), u3.id);
		const loaded = buildSessionContext([u1, a1, u2, a2, compaction, u3, a3]);
		expect(loaded.messages).toHaveLength(5);
		expect(loaded.messages[0]?.role).toBe("compactionSummary");
	});

	it("tracks model and thinking level changes in built context", () => {
		const user = createMessageEntry(createUserMessage("1"));
		const modelChange = createModelChangeEntry("openai", "gpt-4", user.id);
		const assistant = createMessageEntry(createAssistantMessage("a"), modelChange.id);
		const thinkingChange = createThinkingLevelEntry("high", assistant.id);
		const loaded = buildSessionContext([user, modelChange, assistant, thinkingChange]);
		expect(loaded.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
		expect(loaded.thinkingLevel).toBe("high");
	});

	it("prepares compaction using the latest compaction summary as previousSummary", () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1"));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1"), u1.id);
		const u2 = createMessageEntry(createUserMessage("user msg 2"), a1.id);
		const a2 = createMessageEntry(createAssistantMessage("assistant msg 2", createMockUsage(5000, 1000)), u2.id);
		const compaction1 = createCompactionEntry("First summary", u2.id, a2.id);
		const u3 = createMessageEntry(createUserMessage("user msg 3"), compaction1.id);
		const a3 = createMessageEntry(createAssistantMessage("assistant msg 3", createMockUsage(8000, 2000)), u3.id);
		const pathEntries = [u1, a1, u2, a2, compaction1, u3, a3];
		const preparation = prepareCompaction(pathEntries, DEFAULT_COMPACTION_SETTINGS);
		expect(preparation).toBeDefined();
		expect(preparation?.previousSummary).toBe("First summary");
		expect(preparation?.firstKeptEntryId).toBeTruthy();
		expect(preparation?.tokensBefore).toBe(estimateContextTokens(buildSessionContext(pathEntries).messages).tokens);
	});

	it("serializes conversation with truncated tool results", () => {
		const longContent = "x".repeat(5000);
		const messages = convertMessages([
			{
				role: "toolResult",
				toolCallId: "tc1",
				toolName: "read",
				content: [{ type: "text", text: longContent }],
				isError: false,
				timestamp: Date.now(),
			},
		]);
		const result = serializeConversation(messages);
		expect(result).toContain("[Tool result]:");
		expect(result).toContain("[... 3000 more characters truncated]");
	});

	it("passes reasoning through generateSummary only for reasoning models with thinking enabled", async () => {
		const messages: AgentMessage[] = [createUserMessage("Summarize this.")];
		const seenOptions: Array<Record<string, unknown> | undefined> = [];
		const { faux: fauxReasoning, model: reasoningModel } = createFauxModel(true);
		fauxReasoning.setResponses([
			(_context, options) => {
				seenOptions.push(options as Record<string, unknown> | undefined);
				return fauxAssistantMessage("## Goal\nTest summary");
			},
		]);
		await generateSummary(
			messages,
			reasoningModel,
			2000,
			"test-key",
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
		);
		expect(seenOptions[0]).toMatchObject({ reasoning: "medium", apiKey: "test-key" });

		const { faux: fauxOff, model: offModel } = createFauxModel(true);
		fauxOff.setResponses([
			(_context, options) => {
				seenOptions.push(options as Record<string, unknown> | undefined);
				return fauxAssistantMessage("## Goal\nTest summary");
			},
		]);
		await generateSummary(messages, offModel, 2000, "test-key", undefined, undefined, undefined, undefined, "off");
		expect(seenOptions[1]).not.toHaveProperty("reasoning");

		const { faux: fauxNonReasoning, model: nonReasoningModel } = createFauxModel(false);
		fauxNonReasoning.setResponses([
			(_context, options) => {
				seenOptions.push(options as Record<string, unknown> | undefined);
				return fauxAssistantMessage("## Goal\nTest summary");
			},
		]);
		await generateSummary(
			messages,
			nonReasoningModel,
			2000,
			"test-key",
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
		);
		expect(seenOptions[2]).not.toHaveProperty("reasoning");
	});

	it("returns a compaction result with file details", async () => {
		const u1 = createMessageEntry(createUserMessage("read a file"));
		const assistantMessage: AssistantMessage = {
			...createAssistantMessage("calling tool", createMockUsage(1000, 200)),
			content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "src/index.ts" } }],
		};
		const a1 = createMessageEntry(assistantMessage, u1.id);
		const u2 = createMessageEntry(createUserMessage("continue"), a1.id);
		const a2 = createMessageEntry(createAssistantMessage("done", createMockUsage(4000, 500)), u2.id);
		const preparation = prepareCompaction([u1, a1, u2, a2], DEFAULT_COMPACTION_SETTINGS);
		expect(preparation).toBeDefined();
		const { faux, model } = createFauxModel(false);
		faux.setResponses([fauxAssistantMessage("## Goal\nTest summary")]);
		const result = await compact(preparation!, model, "test-key");
		expect(result.summary.length).toBeGreaterThan(0);
		expect(result.firstKeptEntryId).toBeTruthy();
		expect(result.details).toBeDefined();
	});
});

function convertMessages(messages: any[]): any[] {
	return messages;
}
