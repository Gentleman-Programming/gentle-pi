import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import type { NativeReviewCli } from "../lib/native-review-cli.ts";

// gentle-pi#560 / gentle-ai#4056, #4057: since 2026-08-01 Gentle AI stopped
// writing a runtime-specific review execution contract into Pi's generated
// APPEND_SYSTEM composition. This package now injects the mirrored provider
// contract bundle's own `orchestration/pi.md` text at session start instead.
// These tests exercise the real committed mirror (contracts/review-provider-contract-mirror/)
// rather than a fake one: the mirror IS the package under test.

type BeforeAgentStartResult = { systemPrompt: string };
type BeforeAgentStartHandler = (event: unknown, ctx: ExtensionContext) => Promise<BeforeAgentStartResult>;

const REPO_ROOT = join(import.meta.dirname, "..");
const MIRROR_LOCK_PATH = join(REPO_ROOT, "contracts", "review-provider-contract-mirror", "provider-contract.lock.json");

function mirroredPiOrchestrationText(): string {
	const lock = JSON.parse(readFileSync(MIRROR_LOCK_PATH, "utf8")) as { contract_semver: string };
	return readFileSync(
		join(REPO_ROOT, "contracts", "review-provider-contract-mirror", `v${lock.contract_semver}`, "bundle", "orchestration", "pi.md"),
		"utf8",
	).trim();
}

function harness(nativeReviewCli: NativeReviewCli | null): { beforeAgentStart: BeforeAgentStartHandler } {
	const handlers = new Map<string, BeforeAgentStartHandler>();
	const pi = {
		on(name: string, handler: BeforeAgentStartHandler) {
			handlers.set(name, handler);
		},
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli })(pi);
	const beforeAgentStart = handlers.get("before_agent_start");
	assert.equal(typeof beforeAgentStart, "function");
	return { beforeAgentStart: beforeAgentStart as BeforeAgentStartHandler };
}

function ctx(overrides: Record<string, unknown> = {}): ExtensionContext {
	return {
		cwd: process.cwd(),
		hasUI: true,
		ui: { notify() {} },
		sessionManager: { getSessionId: () => "review-contract-prompt-session" },
		...overrides,
	} as unknown as ExtensionContext;
}

const primaryEvent = { systemPrompt: "base" };

test("before_agent_start injects the mirrored review execution contract for the primary session", async () => {
	const { beforeAgentStart } = harness({} as NativeReviewCli);
	const result = await beforeAgentStart(primaryEvent, ctx());
	const expected = mirroredPiOrchestrationText();
	assert.match(result.systemPrompt, /## Gentle AI review execution contract \(mirrored provider bundle 1\.2\.0\)/);
	assert.ok(result.systemPrompt.includes(expected), "the mirrored orchestration/pi.md text must appear verbatim");
});

test("before_agent_start does not inject the review execution contract for a named agent session", async () => {
	const { beforeAgentStart } = harness({} as NativeReviewCli);
	const result = await beforeAgentStart({ agentName: "review-readability", systemPrompt: "base" }, ctx());
	assert.doesNotMatch(result.systemPrompt, /Gentle AI review execution contract/);
});

test("before_agent_start does not inject the review execution contract for an SDD executor session", async () => {
	const { beforeAgentStart } = harness({} as NativeReviewCli);
	const result = await beforeAgentStart({ systemPrompt: "SDD apply executor body" }, ctx());
	assert.doesNotMatch(result.systemPrompt, /Gentle AI review execution contract/);
});

test("before_agent_start injects nothing when nativeReviewCli is null", async () => {
	const { beforeAgentStart } = harness(null);
	const result = await beforeAgentStart(primaryEvent, ctx());
	assert.doesNotMatch(result.systemPrompt, /Gentle AI review execution contract/);
});
