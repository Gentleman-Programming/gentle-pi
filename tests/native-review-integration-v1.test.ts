import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	NativeReviewCliV216,
	NativeReviewIntegrationError,
	clearNativeReviewCapabilitiesCacheForTesting,
	type ExecFileAdapter,
} from "../lib/native-review-cli.ts";

const fixtureRoot = join(process.cwd(), "contracts", "review-integration", "v1", "fixtures");
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as Record<string, unknown>;

interface Result {
	stdout: string;
	exitCode?: number;
}

function queued(results: Result[]): { adapter: ExecFileAdapter; calls: readonly { arguments: readonly string[]; timeoutMs: number | undefined }[] } {
	const calls: { arguments: readonly string[]; timeoutMs: number | undefined }[] = [];
	return {
		calls,
		adapter: async (request) => {
			calls.push({ arguments: request.arguments, timeoutMs: request.timeoutMs });
			const result = results.shift();
			if (result === undefined) throw new Error("unexpected native invocation");
			return { stdout: result.stdout, stderr: "", exitCode: result.exitCode ?? 0, signal: null, timedOut: false, outputLimitExceeded: false };
		},
	};
}

test("v2.1.6 negotiates once per verified digest and binds every operation argv", async () => {
	clearNativeReviewCapabilitiesCacheForTesting();
	const digest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";
	const queue = queued([
		{ stdout: JSON.stringify(fixture("capabilities.fixture.json")) },
		{ stdout: JSON.stringify(fixture("start.fixture.json")) },
		{ stdout: JSON.stringify(fixture("status.fixture.json")) },
	]);
	const client = new NativeReviewCliV216(queue.adapter, "/package/gentle-ai", 321, 654, undefined, () => digest);
	await client.start({ cwd: "/repo with spaces" });
	await client.targetStatus({ cwd: "/repo with spaces", lineageId: "review-status-fixture" });
	assert.deepEqual(queue.calls.map((call) => call.arguments), [
		["review", "capabilities", "--contract", "gentle-ai.review-integration/v1"],
		["review", "start", "--contract", "gentle-ai.review-integration/v1", "--cwd", "/repo with spaces"],
		["review", "status", "--contract", "gentle-ai.review-integration/v1", "--cwd", "/repo with spaces", "--projection", "workspace", "--lineage", "review-status-fixture"],
	]);
	assert.equal(queue.calls[0]?.timeoutMs, 321);
	assert.equal(queue.calls[1]?.timeoutMs, undefined);
});

test("v2.1.6 preserves the native uniform failure envelope", async () => {
	clearNativeReviewCapabilitiesCacheForTesting();
	const digest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";
	const queue = queued([
		{ stdout: JSON.stringify(fixture("capabilities.fixture.json")) },
		{ stdout: JSON.stringify(fixture("failure.fixture.json")), exitCode: 1 },
	]);
	const client = new NativeReviewCliV216(queue.adapter, "/package/gentle-ai", 321, 654, undefined, () => digest);
	await assert.rejects(
		() => client.finalize({ cwd: "/repo", lineageId: "review-failure-fixture" }),
		(error: unknown) => error instanceof NativeReviewIntegrationError && error.failureEnvelope.raw === error.failureEnvelope.raw && error.mutationOutcome === "committed" && error.nextAction === "review.finalize",
	);
});

test("capability cache invalidates when the verified executable digest changes", async () => {
	clearNativeReviewCapabilitiesCacheForTesting();
	const firstDigest = "1".repeat(64);
	const secondDigest = "2".repeat(64);
	const first = fixture("capabilities.fixture.json");
	(first.executable as Record<string, unknown>).sha256 = `sha256:${firstDigest}`;
	const second = structuredClone(first);
	(second.executable as Record<string, unknown>).sha256 = `sha256:${secondDigest}`;
	const queue = queued([{ stdout: JSON.stringify(first) }, { stdout: JSON.stringify(second) }]);
	await new NativeReviewCliV216(queue.adapter, "/package/gentle-ai", 321, 654, undefined, () => firstDigest).capabilities();
	await new NativeReviewCliV216(queue.adapter, "/package/gentle-ai", 321, 654, undefined, () => secondDigest).capabilities();
	assert.equal(queue.calls.length, 2);
});
