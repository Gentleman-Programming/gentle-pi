import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";
import type { ReviewStatusV3 } from "../lib/review-integration-v2.ts";

// gentle-pi#556 / gentle-ai#4051: with RDD enabled, the agent finished an
// implementation and reported completion without ever entering the review
// preflight. These tests cover the read-only, idempotent `agent_end` nudge
// that reminds the agent to call gentle_review before reporting completion,
// without ever starting a review or answering consent itself.

type AnyHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type SentMessage = { message: Record<string, unknown>; options: Record<string, unknown> };

function harness(nativeReviewCli: NativeReviewCli | null): {
	handlers: Map<string, AnyHandler>;
	sent: SentMessage[];
} {
	const handlers = new Map<string, AnyHandler>();
	const sent: SentMessage[] = [];
	const pi = {
		on(name: string, handler: AnyHandler) {
			handlers.set(name, handler);
		},
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
		sendMessage(message: Record<string, unknown>, options: Record<string, unknown> = {}) {
			sent.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli })(pi);
	return { handlers, sent };
}

function ctx(sessionId: string, hasUI = true, cwd = process.cwd()): ExtensionContext {
	return {
		cwd,
		hasUI,
		ui: { notify() {} },
		sessionManager: { getSessionId: () => sessionId },
	} as unknown as ExtensionContext;
}

function onMode(effective: "on" | "off"): NativeReviewCli["reviewMode"] {
	return async () => ({
		operation: "status",
		scope: "clone",
		status: { global: "", cloneLocal: effective === "on" ? "on" : "", effective, source: "clone_local" },
	});
}

function executeStartStatus(targetIdentity: string): ReviewStatusV3 {
	return {
		applicability: "unrelated",
		action: "start",
		targetIdentity,
		nextTransition: { kind: "execute", execute: { operation: "review.start", arguments: [] } },
	} as unknown as ReviewStatusV3;
}

function collectStatus(targetIdentity: string): ReviewStatusV3 {
	return {
		applicability: "unrelated",
		action: "start",
		targetIdentity,
		nextTransition: { kind: "collect", collect: { inputs: [] } },
	} as unknown as ReviewStatusV3;
}

function stopStatus(targetIdentity: string): ReviewStatusV3 {
	return {
		applicability: "unrelated",
		action: "start",
		targetIdentity,
		nextTransition: { kind: "stop" },
	} as unknown as ReviewStatusV3;
}

const agentEndEvent = { type: "agent_end", messages: [] };

test("agent_end performs no STATUS call and sends nothing when RDD is off", async () => {
	const statusRequests: unknown[] = [];
	const native = {
		reviewMode: onMode("off"),
		targetStatus: async (request: unknown) => {
			statusRequests.push(request);
			throw new Error("targetStatus must not be called when RDD is off");
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	assert.equal(typeof agentEnd, "function");
	await agentEnd!(agentEndEvent, ctx("agent-end-rdd-off"));
	assert.deepEqual(statusRequests, []);
	assert.deepEqual(sent, []);
});

test("agent_end nudges exactly once when RDD is on and STATUS offers review.start", async () => {
	const targetIdentity = `sha256:${"a".repeat(64)}`;
	const statusRequests: Array<{ agent?: string }> = [];
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async (request: { agent?: string }) => {
			statusRequests.push(request);
			return executeStartStatus(targetIdentity);
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	await agentEnd!(agentEndEvent, ctx("agent-end-execute"));

	assert.equal(sent.length, 1);
	const [entry] = sent;
	assert.equal(entry?.message.customType, "gentle-pi.review-preflight");
	const content = String(entry?.message.content);
	assert.match(content, /gentle_review/);
	assert.ok(content.includes(targetIdentity), "message must name the target identity");
	assert.equal(entry?.options.triggerTurn, true);
	assert.equal(statusRequests[0]?.agent, "pi");
});

test("agent_end nudges once per target identity and again for a fresh identity", async () => {
	let targetIdentity = `sha256:${"b".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	const session = ctx("agent-end-repeat");

	await agentEnd!(agentEndEvent, session);
	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 1, "the same target identity nudges only once");

	targetIdentity = `sha256:${"e".repeat(64)}`;
	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 2, "a different target identity nudges again");
});

test("agent_end sends nothing when STATUS offers collect or stop", async () => {
	for (const [label, status] of [
		["collect", collectStatus(`sha256:${"c".repeat(64)}`)],
		["stop", stopStatus(`sha256:${"d".repeat(64)}`)],
	] as const) {
		const native = {
			reviewMode: onMode("on"),
			targetStatus: async () => status,
		} as unknown as NativeReviewCli;
		const { handlers, sent } = harness(native);
		const agentEnd = handlers.get("agent_end");
		await agentEnd!(agentEndEvent, ctx(`agent-end-${label}`));
		assert.deepEqual(sent, [], label);
	}
});

test("agent_end skips headless sessions before any native call", async () => {
	const native = {
		reviewMode: async () => {
			throw new Error("reviewMode must not be called when hasUI is false");
		},
		targetStatus: async () => {
			throw new Error("targetStatus must not be called when hasUI is false");
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	await agentEnd!(agentEndEvent, ctx("agent-end-no-ui", false));
	assert.deepEqual(sent, []);
});

test("agent_end sends nothing for a session whose before_agent_start named an agent", async () => {
	const targetIdentity = `sha256:${"f".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const beforeAgentStart = handlers.get("before_agent_start");
	const agentEnd = handlers.get("agent_end");
	assert.equal(typeof beforeAgentStart, "function");
	const session = ctx("agent-end-subagent");

	await beforeAgentStart!({ agentName: "review-readability", systemPrompt: "" }, session);
	await agentEnd!(agentEndEvent, session);

	assert.deepEqual(sent, []);
});

test("agent_end handler exists but sends nothing when nativeReviewCli is null", async () => {
	const { handlers, sent } = harness(null);
	const agentEnd = handlers.get("agent_end");
	assert.equal(typeof agentEnd, "function");
	await agentEnd!(agentEndEvent, ctx("agent-end-null-cli"));
	assert.deepEqual(sent, []);
});

test("agent_end sends nothing and does not throw when target STATUS rejects", async () => {
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => {
			throw new Error("native status unavailable");
		},
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	await assert.doesNotReject(async () => agentEnd!(agentEndEvent, ctx("agent-end-status-throws")));
	assert.deepEqual(sent, []);
});

test("session_shutdown clears the nudged-target set for its session key", async () => {
	const targetIdentity = `sha256:${"9".repeat(64)}`;
	const native = {
		reviewMode: onMode("on"),
		targetStatus: async () => executeStartStatus(targetIdentity),
	} as unknown as NativeReviewCli;
	const { handlers, sent } = harness(native);
	const agentEnd = handlers.get("agent_end");
	const shutdown = handlers.get("session_shutdown");
	assert.equal(typeof shutdown, "function");
	const session = ctx("agent-end-shutdown");

	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 1);

	await shutdown!({}, session);
	await agentEnd!(agentEndEvent, session);
	assert.equal(sent.length, 2, "shutdown clears the nudged set so the same identity nudges again");
});
