import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	NATIVE_REVIEW_ERROR_CODE,
	NativeReviewCliV216,
	NativeReviewCliError,
	NativeReviewIntegrationError,
	clearNativeReviewCapabilitiesCacheForTesting,
	type ExecFileAdapter,
} from "../lib/native-review-cli.ts";

const fixtureRoot = join(process.cwd(), "contracts", "review-integration", "v1", "fixtures");
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as Record<string, unknown>;

interface Result {
	stdout: string;
	stderr?: string;
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
			return { stdout: result.stdout, stderr: result.stderr ?? "", exitCode: result.exitCode ?? 0, signal: null, timedOut: false, outputLimitExceeded: false };
		},
	};
}

test("v2.1.7 negotiates once per verified digest and binds every operation argv", async () => {
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

test("v2.1.7 attaches diagnostics to a non-zero native failure envelope before controller sanitization", async () => {
	clearNativeReviewCapabilitiesCacheForTesting();
	const digest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";
	const queue = queued([
		{ stdout: JSON.stringify(fixture("capabilities.fixture.json")) },
		{ stdout: JSON.stringify(fixture("failure.fixture.json")), stderr: "native transport token=super-secret", exitCode: 1 },
	]);
	const client = new NativeReviewCliV216(queue.adapter, "/package/gentle-ai", 321, 654, undefined, () => digest);
	await assert.rejects(
		() => client.finalize({ cwd: "/repo", lineageId: "review-failure-fixture" }),
		(error: unknown) => {
			if (!(error instanceof NativeReviewIntegrationError)) return false;
			assert.equal(error.failureEnvelope.code, "gate_scope_changed");
			assert.equal(error.mutationOutcome, "not_started");
			assert.equal(error.nextAction, "explicit-maintainer-action");
			assert.deepEqual(error.diagnostics, { operation: "review/finalize", error_code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO, exit_code: 1, timed_out: false, output_limit_exceeded: false, stderr: "native transport token=[REDACTED]", denial: undefined });
			return true;
		},
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

test("v2.1.7 bind-sdd rejects a response from the wrong lifecycle gate", async () => {
	clearNativeReviewCapabilitiesCacheForTesting();
	const digest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";
	const binding = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "native-review-cli", "v2.1.3", "bind-sdd.json"), "utf8")) as Record<string, unknown>;
	const gateContext = binding.gate_context as Record<string, unknown>;
	const queue = queued([
		{ stdout: JSON.stringify(fixture("capabilities.fixture.json")) },
		{ stdout: JSON.stringify({
			schema: "gentle-ai.review-integration.operation/v1",
			contract: "gentle-ai.review-integration/v1",
			operation: "review.bind_sdd",
			result: { ...binding, gate_context: { ...gateContext, gate: "pre-commit" } },
		}) },
	]);
	const client = new NativeReviewCliV216(queue.adapter, "/package/gentle-ai", 321, 654, undefined, () => digest);
	await assert.rejects(
		() => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "issue136-contract-runtime", expectedBindingRevision: "" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH,
	);
});
