import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	NATIVE_REVIEW_ERROR_CODE,
	NativeReviewCliError,
	NativeReviewCliV213,
	createNodeExecFileAdapter,
	type ExecFileAdapter,
	type NativeStartRequest,
} from "../lib/native-review-cli.ts";

interface QueuedResult {
	stdout: string;
	stderr?: string;
	exitCode?: number;
	timedOut?: boolean;
	signal?: NodeJS.Signals | null;
	outputLimitExceeded?: boolean;
}

function queuedAdapter(results: QueuedResult[]): { adapter: ExecFileAdapter; calls: Array<{ file: string; arguments: readonly string[]; cwd: string; timeoutMs: number | undefined; maxBufferBytes: number }> } {
	const calls: Array<{ file: string; arguments: readonly string[]; cwd: string; timeoutMs: number | undefined; maxBufferBytes: number }> = [];
	return {
		calls,
		adapter: async (request) => {
			calls.push(request);
			const result = results.shift();
			if (!result) throw new Error("unexpected native invocation");
			return {
				stdout: result.stdout,
				stderr: result.stderr ?? "",
				exitCode: result.exitCode ?? 0,
				signal: result.signal ?? null,
				timedOut: result.timedOut ?? false,
				outputLimitExceeded: result.outputLimitExceeded ?? false,
			};
		},
	};
}

const VERSION = { stdout: "gentle-ai 2.1.4\n" };
const STATUS_VERSION = { stdout: "gentle-ai 2.1.5\n" };
const START = { stdout: JSON.stringify({ operation: "review/start", lineage_id: "lineage-1", state: "reviewing", risk_level: "medium", selected_lenses: ["review-reliability"], changed_files: 1, changed_lines: 2, correction_budget: 1, action: "created", lenses_required: true, projection: "workspace" }) };
const REVIEW_STATUS = {
	stdout: JSON.stringify({
		schema: "gentle-ai.review-authority-status/v1",
		operation: "review/status",
		repository: "C:\\repo with spaces",
		complete: true,
		authoritative: true,
		status: "clean",
		entries: [],
		locks: [],
		diagnostics: [],
	}),
};

test("native START supports every declared version with the START capability and requires the workspace projection", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	assert.equal((await new NativeReviewCliV213(queuedAdapter([VERSION, { stdout: JSON.stringify({ ...start, projection: "workspace" }) }]).adapter).start({ cwd: "/repo" })).lineageId, "lineage-1");
	assert.equal((await new NativeReviewCliV213(queuedAdapter([STATUS_VERSION, { stdout: JSON.stringify({ ...start, projection: "workspace" }) }]).adapter).start({ cwd: "/repo" })).lineageId, "lineage-1");
	const missing = Object.fromEntries(Object.entries(start).filter(([key]) => key !== "projection"));
	for (const body of [missing, { ...start, projection: "repository" }]) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(body) }]);
		await assert.rejects(() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }), (error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE);
	}
});

test("native client re-verifies the pinned version before every operation and uses argv without a shell", async () => {
	const queue = queuedAdapter([VERSION, START, VERSION, START, VERSION, START, VERSION, START]);
	const client = new NativeReviewCliV213(queue.adapter);
	await client.start({ cwd: "/repo with spaces" });
	await client.start({ cwd: "/repo with spaces", baseRef: "origin/main", committedOnly: true });
	await client.start({ cwd: "/repo with spaces", policyPath: "/repo with spaces/.gentle-ai/policies/team policy.json" });
	await client.start({ cwd: "/repo with spaces", policyHash: "legacy-policy" } as unknown as { cwd: string; policyPath?: string });
	assert.deepEqual(queue.calls.map((call) => call.arguments), [
		["version"],
		["review", "start", "--cwd", "/repo with spaces"],
		["version"],
		["review", "start", "--cwd", "/repo with spaces", "--base-ref", "origin/main", "--committed-only"],
		["version"],
		["review", "start", "--cwd", "/repo with spaces", "--policy", "/repo with spaces/.gentle-ai/policies/team policy.json"],
		["version"],
		["review", "start", "--cwd", "/repo with spaces"],
	]);
	assert.equal(queue.calls.every((call) => call.cwd === "/repo with spaces"), true);
});

test("native START normalizes null selected lenses only for low-risk no-lens responses", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const valid = queuedAdapter([VERSION, {
		stdout: JSON.stringify({
			...start,
			risk_level: "low",
			selected_lenses: null,
			lenses_required: false,
		}),
	}]);
	assert.deepEqual((await new NativeReviewCliV213(valid.adapter).start({ cwd: "/repo" })).selectedLenses, []);

	for (const scenario of [
		{ risk_level: "low", lenses_required: true },
		{ risk_level: "medium", lenses_required: false },
		{ risk_level: "high", lenses_required: false },
	]) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...start, ...scenario, selected_lenses: null }) }]);
		await assert.rejects(() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }), NativeReviewCliError);
	}
});

test("native START action/lenses_required matrix accepts only authoritative dispatch combinations", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const valid = [
		{ action: "created", lenses_required: true, risk_level: "medium", selected_lenses: ["review-reliability"] },
		{ action: "created", lenses_required: false, risk_level: "low", selected_lenses: [] },
		{ action: "resumed", lenses_required: true, risk_level: "medium", selected_lenses: ["review-reliability"], state: "reviewing" },
		{ action: "resumed", lenses_required: false, risk_level: "medium", selected_lenses: ["review-reliability"], state: "correction_required" },
		{ action: "reuse-receipt", lenses_required: false, risk_level: "high", selected_lenses: ["review-risk", "review-resilience", "review-readability", "review-reliability"], state: "approved" },
		{ action: "blocked-scope-action", lenses_required: false, risk_level: "low", selected_lenses: [] },
	] as const;
	for (const scenario of valid) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...start, ...scenario }) }]);
		const result = await new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" });
		assert.equal(result.action, scenario.action);
		assert.equal(result.lensesRequired, scenario.lenses_required);
		assert.deepEqual(result.selectedLenses, scenario.selected_lenses);
	}
	for (const scenario of [
		{ action: "created", lenses_required: false, risk_level: "medium", selected_lenses: [] },
		{ action: "created", lenses_required: false, risk_level: "low", selected_lenses: ["review-reliability"] },
		{ action: "reuse-receipt", lenses_required: true, risk_level: "medium", selected_lenses: ["review-reliability"] },
		{ action: "blocked-scope-action", lenses_required: true, risk_level: "medium", selected_lenses: ["review-reliability"] },
		{ action: "resumed", lenses_required: true, risk_level: "medium", selected_lenses: ["review-reliability"], state: "correction_required" },
	] as const) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...start, ...scenario }) }]);
		await assert.rejects(() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }), NativeReviewCliError);
	}
});

test("native START binds every risk tier to canonical unique lenses before controller use", async () => {
	const start = JSON.parse(START.stdout) as Record<string, unknown>;
	const high = ["review-risk", "review-resilience", "review-readability", "review-reliability"];
	const valid = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...start, risk_level: "high", selected_lenses: high, lenses_required: false, action: "resumed", state: "validating" }) }]);
	assert.deepEqual((await new NativeReviewCliV213(valid.adapter).start({ cwd: "/repo" })).selectedLenses, high);
	for (const scenario of [
		{ risk_level: "low", selected_lenses: [], lenses_required: true }, { risk_level: "medium", selected_lenses: ["review-risk", "review-reliability"], lenses_required: true },
		{ risk_level: "medium", selected_lenses: ["review-reliability", "review-reliability"], lenses_required: true },
		{ risk_level: "high", selected_lenses: high.slice(0, 3), lenses_required: true }, { risk_level: "high", selected_lenses: [...high, "review-risk"], lenses_required: true },
		{ action: "created", risk_level: "high", selected_lenses: high, lenses_required: false },
		{ action: "resumed", state: "approved", risk_level: "medium", selected_lenses: ["review-reliability"], lenses_required: true },
	] as const) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...start, ...scenario }) }]);
		await assert.rejects(() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }), NativeReviewCliError);
	}
});

test("long-lived native client rejects a replaced incompatible executable before another operation", async () => {
	const queue = queuedAdapter([VERSION, START, { stdout: "gentle-ai 2.1.0\n" }]);
	const client = new NativeReviewCliV213(queue.adapter);
	await client.start({ cwd: "/repo" });
	await assert.rejects(
		() => client.start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE
			&& error.operation === "version",
	);
	assert.deepEqual(queue.calls.map((call) => call.arguments), [
		["version"],
		["review", "start", "--cwd", "/repo"],
		["version"],
	]);
});

test("native START rejects invalid committed-range combinations before any adapter invocation", async () => {
	for (const baseRef of ["", "   ", " origin/main", "origin/main ", "origin\0main", "origin\nmain", "origin\rmain", "origin\tmain", "origin\u007fmain", 42, [], {}]) {
		const queue = queuedAdapter([]);
		const request = { cwd: "/repo", baseRef, committedOnly: true } as unknown as NativeStartRequest;
		await assert.rejects(() => new NativeReviewCliV213(queue.adapter).start(request), TypeError);
		assert.equal(queue.calls.length, 0);
	}
	for (const request of [
		{ cwd: "/repo", baseRef: "origin/main" },
		{ cwd: "/repo", baseRef: "origin/main", committedOnly: false },
		{ cwd: "/repo", committedOnly: true },
		{ cwd: "/repo", committedOnly: false },
		{ cwd: "/repo", baseRef: "origin/main", committedOnly: "true" },
	] as const) {
		const queue = queuedAdapter([]);
		await assert.rejects(() => new NativeReviewCliV213(queue.adapter).start(request as NativeStartRequest), TypeError);
		assert.equal(queue.calls.length, 0);
	}
});

test("native client accepts known versions only when they support the requested capability", async () => {
	for (const rejectedVersion of ["2.1.1", "2.1.3"]) {
		const incompatible = queuedAdapter([{ stdout: `gentle-ai ${rejectedVersion}\n` }]);
		await assert.rejects(
			() => new NativeReviewCliV213(incompatible.adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError
				&& error.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE,
		);
	}
	const malformed = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...JSON.parse(await fixture("validate-allow")), allowed: false }) }]);
	await assert.rejects(
		() => new NativeReviewCliV213(malformed.adapter).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
	);
});

test("version process failures retain their typed failure code", async () => {
	for (const result of [
		{ stdout: "", timedOut: true, code: NATIVE_REVIEW_ERROR_CODE.TIMEOUT },
		{ stdout: "", exitCode: 2, code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO },
		{ stdout: "", signal: "SIGTERM" as NodeJS.Signals, code: NATIVE_REVIEW_ERROR_CODE.SIGNAL },
		{ stdout: "", outputLimitExceeded: true, code: NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT },
	]) {
		const queue = queuedAdapter([result]);
		await assert.rejects(
			() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === result.code && error.operation === "version",
		);
	}
});

test("native mutation uncertainty requires target status before any replay decision", async () => {
	const queue = queuedAdapter([VERSION, { stdout: "", timedOut: true }]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.TIMEOUT
			&& error.mutationOutcome === "unknown"
			&& error.nextAction === "review.status",
	);
});

test("native mutating commands omit the automatic timeout while preserving output caps", async () => {
	const queue = queuedAdapter([
		VERSION,
		START,
		VERSION,
		{ stdout: await fixture("finalize") },
		VERSION,
		{ stdout: await fixture("bind-sdd") },
	]);
	const client = new NativeReviewCliV213(queue.adapter, "/package/.gentle-ai/v2.1.4/gentle-ai", 321, 654);
	await client.start({ cwd: "/repo" });
	await client.finalize({ cwd: "/repo", lineageId: "lineage-1" });
	await client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "issue136-contract-runtime", expectedBindingRevision: "" });
	assert.deepEqual(queue.calls.map((call) => call.timeoutMs), [321, undefined, 321, undefined, 321, undefined]);
	assert.deepEqual(queue.calls.map((call) => call.maxBufferBytes), [654, 654, 654, 654, 654, 654]);
});

test("native read-only commands and version checks retain the automatic timeout", async () => {
	const queue = queuedAdapter([VERSION, { stdout: await fixture("validate-allow") }]);
	await new NativeReviewCliV213(queue.adapter, "/package/.gentle-ai/v2.1.4/gentle-ai", 321).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" });
	assert.deepEqual(queue.calls.map((call) => call.timeoutMs), [321, 321]);
});

test("native process failures retain bounded sanitized process diagnostics and parsed denial evidence", async () => {
	const denial = JSON.parse(await fixture("validate-deny")) as Record<string, unknown>;
	const queue = queuedAdapter([VERSION, {
		stdout: JSON.stringify(denial),
		stderr: "token=super-secret\nBearer another-secret\n".repeat(2_000),
		exitCode: 2,
	}]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply" }),
		(error: unknown) => {
			if (!(error instanceof NativeReviewCliError)) return false;
			const diagnostics = (error as unknown as { diagnostics?: Record<string, unknown> }).diagnostics;
			return error.code === NATIVE_REVIEW_ERROR_CODE.NON_ZERO
				&& diagnostics?.operation === "review/validate"
				&& diagnostics.exit_code === 2
				&& diagnostics.stderr !== undefined
				&& !String(diagnostics.stderr).includes("super-secret")
				&& String(diagnostics.stderr).length <= 4_096
				&& (diagnostics.denial as Record<string, unknown> | undefined)?.result === "scope-changed";
		},
	);
});

test("native diagnostics deterministically redact OSC/control sequences and quoted JSON secret values", async () => {
	const denial = JSON.parse(await fixture("validate-deny")) as Record<string, unknown>;
	const secretDiagnostic = [
		"\u001b]8;;https://example.invalid/token\u0007click\u001b]8;;\u0007",
		"\u001bPprivate-control\u001b\\",
		'{"token":"token-value","PASSWORD":"password-value","secret":"secret-value","api_key":"key-value","apiKey":"camel-key","authorization":"authorization-value","cookie":"cookie-value","private_key":"private-value"}',
	].join("\n");
	const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(denial), stderr: secretDiagnostic, exitCode: 2 }]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply" }),
		(error: unknown) => {
			if (!(error instanceof NativeReviewCliError)) return false;
			const diagnostics = error.diagnostics as unknown as Record<string, unknown>;
			const stderr = String(diagnostics.stderr);
			return error.code === NATIVE_REVIEW_ERROR_CODE.NON_ZERO
				&& !/[\u0000-\u001f\u007f]/.test(stderr)
				&& !["token-value", "password-value", "secret-value", "key-value", "camel-key", "authorization-value", "cookie-value", "private-value", ].some((secret) => stderr.includes(secret))
				&& (diagnostics.denial as Record<string, unknown> | undefined)?.action === "create-new-lineage";
		},
	);
});

test("structured denial fields redact token-shaped secrets and obey the 1 KiB field limit", async () => {
	const denial = JSON.parse(await fixture("validate-deny")) as Record<string, unknown>;
	const context = denial.context as Record<string, unknown>;
	const nested = context.denial as Record<string, unknown>;
	const secret = "GITHUB_TOKEN=github-secret ACCESS_TOKEN=access-secret access_token=lower-secret CUSTOM_TOKEN=custom-secret";
	const queue = queuedAdapter([VERSION, {
		stdout: JSON.stringify({ ...denial, reason: `${secret} ${"x".repeat(2_000)}`, context: { ...context, denial: { ...nested, stage: secret, code: secret } } }),
		stderr: "denied",
		exitCode: 2,
	}]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply" }),
		(error: unknown) => {
			if (!(error instanceof NativeReviewCliError)) return false;
			const denial = error.diagnostics.denial;
			return denial !== undefined
				&& [denial.reason, denial.denial?.stage, denial.denial?.code].every((field) => field !== undefined && field.length <= 1_024)
				&& !JSON.stringify(denial).includes("secret");
		},
	);
});

test("native validate redacts and bounds returned structured-denial fields", async () => {
	const denial = JSON.parse(await fixture("validate-deny")) as Record<string, unknown>;
	const context = denial.context as Record<string, unknown>;
	const nested = context.denial as Record<string, unknown>;
	const secret = "GITHUB_TOKEN=github-secret ACCESS_TOKEN=access-secret access_token=lower-secret CUSTOM_TOKEN=custom-secret";
	const queue = queuedAdapter([VERSION, {
		stdout: JSON.stringify({
			...denial,
			reason: `${secret} ${"x".repeat(2_000)}`,
			context: { ...context, denial: { ...nested, stage: secret, code: secret } },
		}),
		stderr: "Error: review gate denied: scope-changed\n",
		exitCode: 1,
	}]);
	const result = await new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply" });
	const returned = result.gateContext.raw.denial as Record<string, string>;
	assert.equal(result.reason.length <= 1_024, true);
	assert.equal(returned.stage.length <= 1_024, true);
	assert.equal(returned.code.length <= 1_024, true);
	assert.equal(JSON.stringify({ reason: result.reason, returned }).includes("secret"), false);
});

test("native diagnostics reject non-canonical or extra structured-denial fields", async () => {
	const published = JSON.parse(await fixture("validate-deny")) as Record<string, unknown>;
	const context = published.context as Record<string, unknown>;
	for (const body of [
		{ ...published, unexpected: true },
		{ ...published, context: { ...context, unexpected: true } },
		{ ...published, context: { ...context, denial: { ...(context.denial as Record<string, unknown>), unexpected: true } } },
		{ ...published, action: " create-new-lineage" },
		{ ...published, reason: "reason " },
	]) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(body), stderr: "denied", exitCode: 2 }]);
		await assert.rejects(
			() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply" }),
			(error: unknown) => error instanceof NativeReviewCliError
				&& error.code === NATIVE_REVIEW_ERROR_CODE.NON_ZERO
				&& error.diagnostics.denial === undefined,
		);
	}
});

test("native validate requires a strict allow body", async () => {
	const queue = queuedAdapter([VERSION, { stdout: await fixture("validate-allow") }]);
	const result = await new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" });
	assert.equal(result.allowed, true);
	assert.equal(result.action, "continue");
	assert.equal(result.gateContext.lineageId, "issue136-contract-runtime");
});

test("native validate requires the returned gate context to equal the requested gate", async () => {
	const published = JSON.parse(await fixture("validate-allow")) as Record<string, unknown>;
	for (const gate of ["", "pre-push"]) {
		const queue = queuedAdapter([VERSION, {
			stdout: JSON.stringify({
				...published,
				context: { ...(published.context as Record<string, unknown>), gate },
			}),
		}]);
		await assert.rejects(
			() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
		);
	}
	const denial = JSON.parse(await fixture("validate-deny")) as Record<string, unknown>;
	const mismatch = queuedAdapter([VERSION, {
		stdout: JSON.stringify({
			...denial,
			context: { ...(denial.context as Record<string, unknown>), gate: "pre-push" },
		}),
		stderr: "Error: review gate denied: scope-changed\n",
		exitCode: 1,
	}]);
	await assert.rejects(
		() => new NativeReviewCliV213(mismatch.adapter).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
	);
});

test("native validate decodes published structured denials from exit code 1", async () => {
	const published = JSON.parse(await fixture("validate-deny-empty-context")) as Record<string, unknown>;
	for (const [result, action] of [
		["scope-changed", "create-new-lineage"],
		["invalidated", "explicit-maintainer-action"],
		["escalated", "stop"],
	] as const) {
		const queue = queuedAdapter([VERSION, {
			stdout: JSON.stringify({ ...published, result, action }),
			stderr: `Error: review gate denied: ${result}\n`,
			exitCode: 1,
		}]);
		const denial = await new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" });
		assert.deepEqual({ result: denial.result, allowed: denial.allowed, action: denial.action }, { result, allowed: false, action });
		assert.equal(denial.gateContext.raw.gate, "");
	}
});

test("native validate keeps malformed and unexpected nonzero exits typed", async () => {
	const denial = await fixture("validate-deny");
	for (const scenario of [
		{ result: { stdout: "", exitCode: 1 }, code: NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT },
		{ result: { stdout: "{", exitCode: 1 }, code: NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON },
		{ result: { stdout: denial, exitCode: 2 }, code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO },
		{ result: { stdout: denial, exitCode: 1, timedOut: true }, code: NATIVE_REVIEW_ERROR_CODE.TIMEOUT },
		{ result: { stdout: denial, exitCode: 1, signal: "SIGTERM" as NodeJS.Signals }, code: NATIVE_REVIEW_ERROR_CODE.SIGNAL },
	]) {
		const queue = queuedAdapter([VERSION, scenario.result]);
		await assert.rejects(
			() => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === scenario.code && error.operation === "review/validate",
		);
	}
	const unavailable: ExecFileAdapter = async (request) => {
		if (request.arguments[0] === "version") return { stdout: VERSION.stdout, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		throw Object.assign(new Error("spawn"), { code: "ENOENT" });
	};
	await assert.rejects(
		() => new NativeReviewCliV213(unavailable).validate({ cwd: "/repo", gate: "post-apply" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE,
	);
});


test("native decoders reject every one-field schema mutation", async () => {
	const operations = [
		{ fixtureName: "start", invoke: (client: NativeReviewCliV213) => client.start({ cwd: "/repo", lineageId: "lineage-1" }) },
		{ fixtureName: "finalize", optionalKeys: ["receipt_path"], invoke: (client: NativeReviewCliV213) => client.finalize({ cwd: "/repo", lineageId: "lineage-1" }) },
		{ fixtureName: "validate-allow", invoke: (client: NativeReviewCliV213) => client.validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" }) },
		{ fixtureName: "bind-sdd", invoke: (client: NativeReviewCliV213) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "issue136-contract-runtime", expectedBindingRevision: "" }) },
		{ fixtureName: "sdd-status", optionalKeys: ["reviewGate", "reviewTransaction", "phaseInstructions"], invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ fixtureName: "sdd-status-engram", optionalKeys: ["reviewGate", "reviewTransaction", "phaseInstructions"], invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
	];
	for (const operation of operations) {
		const fixtureBody = JSON.parse(await fixture(operation.fixtureName)) as Record<string, unknown>;
		for (const [key, value] of Object.entries(fixtureBody)) {
			const missing = { ...fixtureBody };
			delete missing[key];
			for (const mutated of [...(operation.optionalKeys?.includes(key) ? [] : [missing]), { ...fixtureBody, [key]: typeof value === "string" ? 1 : "wrong-type" }]) {
				const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(mutated) }]);
				await assert.rejects(() => operation.invoke(new NativeReviewCliV213(queue.adapter)), NativeReviewCliError, `${operation.fixtureName}.${key}`);
			}
		}
	}
});

test("native decoders reject nested mutations and unknown enums", async () => {
	const validate = JSON.parse(await fixture("validate-allow")) as Record<string, unknown>;
	const bind = JSON.parse(await fixture("bind-sdd")) as Record<string, unknown>;
	const status = JSON.parse(await fixture("sdd-status")) as Record<string, unknown>;
	const start = JSON.parse(await fixture("start")) as Record<string, unknown>;
	const finalization = JSON.parse(await fixture("finalize")) as Record<string, unknown>;
	const cases = [
		{ body: { ...start, risk_level: "unknown" }, invoke: (client: NativeReviewCliV213) => client.start({ cwd: "/repo" }) },
		{ body: { ...start, selected_lenses: ["unknown"] }, invoke: (client: NativeReviewCliV213) => client.start({ cwd: "/repo" }) },
		{ body: { ...finalization, state: "unknown" }, invoke: (client: NativeReviewCliV213) => client.finalize({ cwd: "/repo" }) },
		{ body: { ...validate, context: { ...(validate.context as Record<string, unknown>), extra: true } }, invoke: (client: NativeReviewCliV213) => client.validate({ cwd: "/repo", gate: "post-apply" }) },
		{ body: { ...bind, gate_context: { ...(bind.gate_context as Record<string, unknown>), candidate_tree: 1 } }, invoke: (client: NativeReviewCliV213) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "issue136-contract-runtime", expectedBindingRevision: "" }) },
		{ body: { ...status, nextRecommended: "unknown" }, invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ body: { ...status, actionContext: { ...(status.actionContext as Record<string, unknown>), allowedEditRoots: [1] } }, invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ body: { ...status, reviewGate: { ...(status.reviewGate as Record<string, unknown>), result: "deny" } }, invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ body: { ...status, reviewTransaction: { ...(status.reviewTransaction as Record<string, unknown>), mode: "ordinary" } }, invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ body: { ...status, reviewTransaction: { ...(status.reviewTransaction as Record<string, unknown>), snapshot: { ...((status.reviewTransaction as Record<string, unknown>).snapshot as Record<string, unknown>), extra: true } } }, invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
	];
	for (const item of cases) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(item.body) }]);
		await assert.rejects(() => item.invoke(new NativeReviewCliV213(queue.adapter)), NativeReviewCliError);
	}
});

test("native decoders reject every nested response-field mutation", async () => {
	const cases = [
		{ fixtureName: "validate-allow", nestedKey: "context", optionalNestedKeys: ["store_revision", "genesis_revision", "chain_identity", "bundle_digest"], invoke: (client: NativeReviewCliV213) => client.validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" }) },
		{ fixtureName: "bind-sdd", nestedKey: "gate_context", optionalNestedKeys: ["genesis_revision", "chain_identity", "bundle_digest"], invoke: (client: NativeReviewCliV213) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "issue136-contract-runtime", expectedBindingRevision: "" }) },
		{ fixtureName: "sdd-status", nestedKey: "actionContext", invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ fixtureName: "sdd-status", nestedKey: "reviewGate", invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ fixtureName: "sdd-status", nestedKey: "reviewTransaction", invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ fixtureName: "sdd-status-engram", nestedKey: "artifacts", invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
	];
	for (const item of cases) {
		const body = JSON.parse(await fixture(item.fixtureName)) as Record<string, Record<string, unknown>>;
		for (const [field, value] of Object.entries(body[item.nestedKey]!)) {
			const missingNested = { ...body[item.nestedKey] };
			delete missingNested[field];
			const mutations = [
				...(item.optionalNestedKeys?.includes(field) ? [] : [missingNested]),
				{ ...body[item.nestedKey], [field]: typeof value === "string" ? 1 : "wrong-type" },
				{ ...body[item.nestedKey], extra: true },
			];
			for (const nested of mutations) {
				const queue = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...body, [item.nestedKey]: nested }) }]);
				await assert.rejects(() => item.invoke(new NativeReviewCliV213(queue.adapter)), NativeReviewCliError, `${item.fixtureName}.${item.nestedKey}.${field}`);
			}
		}
	}
});

test("native process failures are typed and never authorize mutation", async () => {
	const cases: Array<{ result?: QueuedResult; throws?: Error; code: string }> = [
		{ throws: Object.assign(new Error("spawn"), { code: "ENOENT" }), code: NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE },
		{ result: { stdout: "", timedOut: true }, code: NATIVE_REVIEW_ERROR_CODE.TIMEOUT },
		{ result: { stdout: "", signal: "SIGTERM" }, code: NATIVE_REVIEW_ERROR_CODE.SIGNAL },
		{ result: { stdout: "", exitCode: 2 }, code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO },
		{ result: { stdout: START.stdout, stderr: "unexpected" }, code: NATIVE_REVIEW_ERROR_CODE.UNEXPECTED_STDERR },
		{ result: { stdout: "", outputLimitExceeded: true }, code: NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT },
		{ result: { stdout: "" }, code: NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT },
		{ result: { stdout: "{" }, code: NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON },
	];
	for (const scenario of cases) {
		const adapter: ExecFileAdapter = async (request) => {
			if (request.arguments[0] === "version") return { ...VERSION, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
			if (scenario.throws) throw scenario.throws;
			return { stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false, ...scenario.result! };
		};
		await assert.rejects(
			() => new NativeReviewCliV213(adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === scenario.code && error.mutationOutcome === "unknown" && error.nextAction === "review.status",
		);
	}
});

test("finalize stages every optional document privately and cleans it after failures", async () => {
	const observed: string[] = [];
	let nativeCall = 0;
	const adapter: ExecFileAdapter = async (request) => {
		nativeCall += 1;
		if (nativeCall === 1) return { ...VERSION, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		for (const argument of request.arguments) if (argument.includes("gentle-ai-finalize-")) observed.push(argument);
		return { stdout: "{", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
	};
	await assert.rejects(
		() => new NativeReviewCliV213(adapter).finalize({
			cwd: "/repo",
			lensResults: [{ lens: "review-risk", document: { id: "risk" } }],
			refuterDocument: { id: "refuter" },
			validationDocument: { id: "validation" },
			evidenceDocument: "evidence",
		}),
		NativeReviewCliError,
	);
	assert.equal(observed.filter((argument) => argument.endsWith(".json")).length, 3);
	await Promise.all(observed.filter((argument) => argument.endsWith(".json")).map(async (path) => assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(path)))));
});
test("native review status uses the anticipated v2.1.5 contract, preserves Windows paths, and never reports mutation", async () => {
	const queue = queuedAdapter([STATUS_VERSION, REVIEW_STATUS]);
	const result = await new NativeReviewCliV213(queue.adapter).reviewStatus({ cwd: "C:\\repo with spaces" });
	assert.equal(result.status, "clean");
	assert.equal(result.complete, true);
	assert.equal(result.authoritative, true);
	assert.deepEqual(queue.calls.map((call) => call.arguments), [
		["version"],
		["review", "status", "--cwd", "C:\\repo with spaces"],
	]);
	assert.equal(queue.calls.length, 2);

	const wrongRepository = queuedAdapter([STATUS_VERSION, { stdout: JSON.stringify({ ...JSON.parse(REVIEW_STATUS.stdout), repository: "C:\\other repository" }) }]);
	await assert.rejects(
		() => new NativeReviewCliV213(wrongRepository.adapter).reviewStatus({ cwd: "C:\\repo with spaces" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.IDENTITY_MISMATCH
			&& error.operation === "review/status"
			&& error.mutationOutcome === "none",
	);

	const incomplete = queuedAdapter([STATUS_VERSION, { stdout: JSON.stringify({ ...JSON.parse(REVIEW_STATUS.stdout), complete: false, authoritative: false, status: "invalid" }) }]);
	assert.equal((await new NativeReviewCliV213(incomplete.adapter).reviewStatus({ cwd: "C:\\repo with spaces" })).complete, false);

	const populated = queuedAdapter([STATUS_VERSION, { stdout: JSON.stringify({ ...JSON.parse(REVIEW_STATUS.stdout), status: "active", entries: [{ version: "compact-v2", lineage_id: "lineage", path: "C:\\repo\\.git\\gentle-ai", status: "active", revision: "r1", recovery: { predecessor_lineage_id: "old", predecessor_revision: "r0", disposition: "scope_changed", reason: "scope", actor: "maintainer", recovered_at: "2026-07-14T00:00:00Z" }, problems: ["stale"] }], locks: [{ version: "compact-v2", path: "C:\\repo\\.git\\gentle-ai\\LOCK", status: "owned", owner: { schema: "gentle-ai.review-store-lock/v1", owner_id: "owner", pid: 1, host: "host", acquired_at: "2026-07-14T00:00:00Z" } }], diagnostics: [{ path: "C:\\repo\\.git\\gentle-ai", problem: "stale" }] }) }]);
	const decoded = await new NativeReviewCliV213(populated.adapter).reviewStatus({ cwd: "C:\\repo with spaces" });
	assert.deepEqual(decoded.entries[0]?.recovery?.predecessorLineageId, "old");
	assert.deepEqual(decoded.locks[0]?.owner?.ownerId, "owner");
	assert.deepEqual(decoded.diagnostics, [{ path: "C:\\repo\\.git\\gentle-ai", problem: "stale" }]);

	const unsupportedLockSchema = queuedAdapter([STATUS_VERSION, {
		stdout: JSON.stringify({
			...JSON.parse(REVIEW_STATUS.stdout),
			locks: [{
				version: "compact-v2",
				path: "C:\\repo\\.git\\gentle-ai\\LOCK",
				status: "owned",
				owner: { schema: "unexpected", owner_id: "owner", pid: 2_147_483_647, host: "host", acquired_at: "2026-07-14T00:00:00Z" },
			}],
		}),
	}]);
	await assert.rejects(
		() => new NativeReviewCliV213(unsupportedLockSchema.adapter).reviewStatus({ cwd: "C:\\repo with spaces" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE
			&& error.operation === "review/status"
			&& error.mutationOutcome === "none",
	);

	for (const body of [
		{ ...JSON.parse(REVIEW_STATUS.stdout), complete: false, authoritative: true },
		{ ...JSON.parse(REVIEW_STATUS.stdout), entries: [{ version: "compact-v2", lineage_id: "lineage", path: "C:\\repo\\.git\\gentle-ai", status: "active", problems: [], unexpected: true }] },
		{ ...JSON.parse(REVIEW_STATUS.stdout), status: "unknown" },
	]) {
		const malformed = queuedAdapter([STATUS_VERSION, { stdout: JSON.stringify(body) }]);
		await assert.rejects(
			() => new NativeReviewCliV213(malformed.adapter).reviewStatus({ cwd: "C:\\repo with spaces" }),
			(error: unknown) => error instanceof NativeReviewCliError
				&& error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE
				&& error.operation === "review/status"
				&& error.mutationOutcome === "none",
		);
	}
});

test("native review status accepts a canonical POSIX symlink repository identity", async (t) => {
	if (process.platform === "win32") return t.skip("directory symlink creation requires elevated Windows privileges");
	const repository = await mkdtemp(join(tmpdir(), "gentle-pi-native-status-"));
	const alias = `${repository}-alias`;
	await symlink(repository, alias);
	t.after(async () => { await rm(alias); await rm(repository, { recursive: true }); });
	const queue = queuedAdapter([STATUS_VERSION, { stdout: JSON.stringify({ ...JSON.parse(REVIEW_STATUS.stdout), repository }) }]);
	assert.equal((await new NativeReviewCliV213(queue.adapter).reviewStatus({ cwd: alias })).repository, repository);
});

test("native review status keeps v2.1.4 truthfully unsupported", async () => {
	const queue = queuedAdapter([VERSION]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).reviewStatus({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE
			&& error.operation === "version"
			&& error.mutationOutcome === "none",
	);
	assert.deepEqual(queue.calls.map((call) => call.arguments), [["version"]]);
});

async function fixture(name: string): Promise<string> {
	return readFile(new URL(`./fixtures/native-review-cli/v2.1.3/${name}.json`, import.meta.url), "utf8");
}

test("finalize ignores injected cleanup failures after native completion", async () => {
	for (const native of [{ stdout: await fixture("finalize") }, { stdout: "{" }]) {
		let cleanupAttempts = 0;
		const queue = queuedAdapter([VERSION, native]);
		const client = new NativeReviewCliV213(
			queue.adapter,
			"/package/.gentle-ai/v2.1.3/gentle-ai",
			30_000,
			1024 * 1024,
			async () => {
				cleanupAttempts += 1;
				throw new Error("cleanup failed");
			},
		);
		const finalize = () => client.finalize({ cwd: "/repo", lensResults: [{ lens: "review-risk", document: { id: "risk" } }] });
		if (native.stdout === "{") {
			await assert.rejects(finalize, (error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON && error.mutationOutcome === "unknown");
		} else {
			assert.match((await finalize()).storeRevision, /^sha256:[0-9a-f]{64}$/);
		}
		assert.equal(cleanupAttempts, 1);
	}
});

test("finalize cleanup survives every native exit path", async () => {
	for (const result of [
		{ stdout: await fixture("finalize") },
		{ stdout: await fixture("finalize"), exitCode: 1 },
		{ stdout: "", timedOut: true },
		{ stdout: "{" },
	]) {
		const staged: string[] = [];
		let call = 0;
		const adapter: ExecFileAdapter = async (request) => {
			call += 1;
			if (call === 1) return { ...VERSION, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
			for (const argument of request.arguments) if (argument.includes("gentle-ai-finalize-")) staged.push(argument);
			return { stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false, ...result };
		};
		const finalize = () => new NativeReviewCliV213(adapter).finalize({ cwd: "/repo", lensResults: [{ lens: "review-risk", document: { id: "risk" } }], refuterDocument: { id: "refuter" }, validationDocument: { id: "validation" }, evidenceDocument: "evidence" });
		if (result.exitCode === 1 || result.timedOut || result.stdout === "{") await assert.rejects(finalize, NativeReviewCliError);
		else await finalize();
		await Promise.all(staged.filter((path) => path.endsWith(".json")).map(async (path) => assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(path)))));
	}
});

test("native client rejects historical v2.1.3 START while decoding compatible fixtures", async () => {
	const queue = queuedAdapter([
		VERSION,
		{ stdout: await fixture("start") },
		VERSION,
		{ stdout: await fixture("finalize") },
		VERSION,
		{ stdout: await fixture("validate-allow") },
		VERSION,
		{ stdout: await fixture("bind-sdd") },
		VERSION,
		{ stdout: await fixture("sdd-status") },
	]);
	const client = new NativeReviewCliV213(queue.adapter);
	await assert.rejects(() => client.start({ cwd: "/repo", lineageId: "lineage-1" }), NativeReviewCliError);
	const finalized = await client.finalize({ cwd: "/repo", lineageId: "lineage-1" });
	assert.match(finalized.storeRevision, /^sha256:[0-9a-f]{64}$/);
	assert.equal(finalized.action, "validate delivery with gentle-ai review validate --gate <gate>");
	assert.equal((await client.validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" })).allowed, true);
	assert.match((await client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "issue136-contract-runtime", expectedBindingRevision: "" })).revision, /^sha256:[0-9a-f]{64}$/);
	assert.equal((await client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" })).ready, true);
});

test("native SDD readiness requires an unblocked post-review action with published allow evidence", async () => {
	const openspec = JSON.parse(await fixture("sdd-status")) as Record<string, unknown>;
	const engram = JSON.parse(await fixture("sdd-status-engram")) as Record<string, unknown>;
	const actions = ["apply", "verify", "remediate", "archive", "review", "resolve-review", "resolve-blockers", "sdd-new", "select-change", "propose", "spec", "design", "tasks"] as const;
	for (const source of [openspec, engram]) {
		for (const nextRecommended of actions) {
			const body = {
				...source,
				nextRecommended,
				blockedReasons: [],
				reviewGate: { result: "allow", reason: "current bound authority allows delivery" },
			};
			const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(body) }]);
			assert.equal(
				(await new NativeReviewCliV213(queue.adapter).sddStatus({ cwd: "/repo", change: "native-review-authority-parity" })).ready,
				nextRecommended === "verify" || nextRecommended === "archive",
				`${source.artifactStore as string}:${nextRecommended}`,
			);
		}
	}

	for (const body of [
		{ ...openspec, nextRecommended: "verify", blockedReasons: [], reviewGate: undefined },
		{ ...openspec, nextRecommended: "archive", blockedReasons: ["stale authority"], reviewGate: { result: "allow", reason: "allow before drift" } },
		{ ...openspec, nextRecommended: "verify", blockedReasons: [], reviewGate: { result: "scope-changed", reason: "candidate changed" } },
		{ ...openspec, nextRecommended: "archive", blockedReasons: [], reviewGate: { result: "invalidated", reason: "authority is stale" } },
	]) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(body) }]);
		assert.equal((await new NativeReviewCliV213(queue.adapter).sddStatus({ cwd: "/repo", change: "native-review-authority-parity" })).ready, false);
	}
});

test("native client decodes the exact v2.1.3 Engram artifact map", async () => {
	const queue = queuedAdapter([VERSION, { stdout: await fixture("sdd-status-engram") }]);
	const status = await new NativeReviewCliV213(queue.adapter).sddStatus({ cwd: "/repo", change: "native-review-authority-parity" });
	assert.equal(status.artifactStore, "engram");
	assert.equal(status.artifacts.reviewPolicy, "done");
	assert.equal(status.ready, false);
});

test("native client decodes the exact published non-allow result and rejects stale aliases", async () => {
	const queue = queuedAdapter([VERSION, { stdout: await fixture("validate-deny"), stderr: "Error: review gate denied: scope-changed\n", exitCode: 1 }]);
	const result = await new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" });
	assert.equal(result.result, "scope-changed");
	assert.equal(result.allowed, false);
	assert.equal(result.action, "create-new-lineage");

	for (const stale of [
		{ schema: "gentle-ai.review-gate-result/v1", result: "deny", allowed: false, action: "blocked", reason: "stale", gate_context: {} },
		{ schema: "gentle-ai.review-sdd-binding/v1", repository: "repo", change: "native-review-authority-parity", path: "openspec/changes/native-review-authority-parity", lineage_id: "issue136-contract-runtime", authority_revision: "revision", receipt_hash: "receipt", binding_revision: "binding", gate_context: {} },
	]) {
		const staleQueue = queuedAdapter([VERSION, { stdout: JSON.stringify(stale) }]);
		const client = new NativeReviewCliV213(staleQueue.adapter);
		await assert.rejects(
			() => "result" in stale
				? client.validate({ cwd: "/repo", gate: "post-apply", lineageId: "issue136-contract-runtime" })
				: client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "issue136-contract-runtime", expectedBindingRevision: "" }),
			NativeReviewCliError,
		);
	}
});

test("native client rejects mutations, trailing JSON, and process uncertainty", async () => {
	const start = JSON.parse(await fixture("start")) as Record<string, unknown>;
	for (const body of [
		{},
		{ ...start, extra: true },
		{ ...start, changed_lines: Number.MAX_SAFE_INTEGER + 1 },
	]) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(body) }]);
		await assert.rejects(() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }), NativeReviewCliError);
	}
	const trailing = queuedAdapter([VERSION, { stdout: `${await fixture("start")} {}` }]);
	await assert.rejects(() => new NativeReviewCliV213(trailing.adapter).start({ cwd: "/repo" }), NativeReviewCliError);
	for (const result of [
		{ stdout: "", stderr: "missing", exitCode: 1 },
		{ stdout: await fixture("start"), stderr: "warning" },
		{ stdout: "", timedOut: true },
	]) {
		const queue = queuedAdapter([VERSION, result]);
		await assert.rejects(
			() => new NativeReviewCliV213(queue.adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.mutationOutcome === "unknown",
		);
	}
});

test("native client rejects extra fields in finalize, bind, and bound SDD status fixtures", async () => {
	const finalize = JSON.parse(await fixture("finalize")) as Record<string, unknown>;
	const bind = JSON.parse(await fixture("bind-sdd")) as Record<string, unknown>;
	const status = JSON.parse(await fixture("sdd-status")) as Record<string, unknown>;
	const cases = [
		{ invoke: (client: NativeReviewCliV213) => client.finalize({ cwd: "/repo", lineageId: "lineage-1" }), body: { ...finalize, extra: true } },
		{ invoke: (client: NativeReviewCliV213) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "lineage-1", expectedBindingRevision: "" }), body: { ...bind, extra: true } },
		{ invoke: (client: NativeReviewCliV213) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }), body: { ...status, extra: true } },
	];
	for (const item of cases) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(item.body) }]);
		await assert.rejects(() => item.invoke(new NativeReviewCliV213(queue.adapter)), NativeReviewCliError);
	}
});

test("native finalize stages ordered private result documents and removes them after decoding", async () => {
	const observed: Array<{ flag: string; file: string; mode: number; content: string }> = [];
	let finalizeArguments: readonly string[] = [];
	let call = 0;
	const adapter: ExecFileAdapter = async (request) => {
		call += 1;
		if (call === 1) return { ...VERSION, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		finalizeArguments = request.arguments;
		for (let index = 0; index < request.arguments.length; index += 1) {
			if (["--result", "--refuter", "--validation", "--evidence"].includes(request.arguments[index]!)) {
				const path = request.arguments[index + 1]!;
				const { readFile, stat } = await import("node:fs/promises");
				observed.push({ flag: request.arguments[index]!, file: path, mode: (await stat(path)).mode & 0o777, content: await readFile(path, "utf8") });
			}
		}
		return { stdout: await fixture("finalize"), stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
	};
	await new NativeReviewCliV213(adapter).finalize({
		cwd: "/repo",
		lineageId: "lineage-1",
		lensResults: [{ lens: "review-risk", document: { lens: "risk", findings: [], evidence: ["complete candidate reviewed"] } }],
		refuterDocument: { results: [{ finding_id: "RISK-001", outcome: "inconclusive", proof_refs: ["differential-test:candidate still fails"] }] },
		validationDocument: { original_criteria: { passed: false, evidence: ["acceptance still fails"] }, correction_regression: { passed: true, evidence: ["regression suite passes"] }, follow_ups: [{ observation: "Track the remaining failure", proof_refs: ["differential-test:candidate still fails"] }] },
		evidenceDocument: "  focused verification failed\n\n",
		failed: true,
	});
	assert.deepEqual(observed.map((entry) => entry.mode), [0o600, 0o600, 0o600, 0o600]);
	assert.deepEqual(observed.map((entry) => entry.flag), ["--result", "--refuter", "--validation", "--evidence"]);
	assert.deepEqual(observed.slice(0, 3).map((entry) => JSON.parse(entry.content)), [
		{ lens: "risk", findings: [], evidence: ["complete candidate reviewed"] },
		{ results: [{ finding_id: "RISK-001", outcome: "inconclusive", proof_refs: ["differential-test:candidate still fails"] }] },
		{ original_criteria: { passed: false, evidence: ["acceptance still fails"] }, correction_regression: { passed: true, evidence: ["regression suite passes"] }, follow_ups: [{ observation: "Track the remaining failure", proof_refs: ["differential-test:candidate still fails"] }] },
	]);
	assert.equal(observed[3]?.content, "  focused verification failed\n\n");
	assert.equal(finalizeArguments.at(-1), "--failed");
	await Promise.all(observed.map(async (entry) => assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(entry.file)))));
});

test("native finalize rejects only zero-length staged evidence before launch", async () => {
	const queue = queuedAdapter([]);
	await assert.rejects(
		() => new NativeReviewCliV213(queue.adapter).finalize({ cwd: "/repo", evidenceDocument: "" }),
		TypeError,
	);
	assert.equal(queue.calls.length, 0);
});

test("native cancellation fails closed and preserves mutating ambiguity", async () => {
	const adapter: ExecFileAdapter = async (request) => {
		if (request.arguments[0] === "version") return { stdout: "gentle-ai 2.1.4\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		const error = new Error("cancelled");
		error.name = "AbortError";
		throw error;
	};
	await assert.rejects(
		() => new NativeReviewCliV213(adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.CANCELLED
			&& error.mutationOutcome === "unknown"
			&& error.nextAction === "review.status",
	);
});

test("node execFile adapter passes AbortSignal to child_process", async () => {
	const controller = new AbortController();
	const pending = createNodeExecFileAdapter()({ file: process.execPath, arguments: ["-e", "setTimeout(() => {}, 10_000)"], cwd: process.cwd(), timeoutMs: 30_000, maxBufferBytes: 1024, signal: controller.signal });
	controller.abort();
	await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
});

test("native adapter receives the controller AbortSignal without an automatic mutation timeout", async () => {
	const controller = new AbortController();
	controller.abort();
	let mutationTimeoutMs: number | undefined;
	const adapter: ExecFileAdapter = async (request) => {
		if (request.arguments[0] === "version") return { stdout: "gentle-ai 2.1.4\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		mutationTimeoutMs = request.timeoutMs;
		if (request.signal?.aborted) {
			const error = new Error("cancelled");
			error.name = "AbortError";
			throw error;
		}
		throw new Error("missing AbortSignal");
	};
	await assert.rejects(
		() => new NativeReviewCliV213(adapter).start({ cwd: "/repo", signal: controller.signal }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.CANCELLED
			&& error.mutationOutcome === "unknown"
			&& error.nextAction === "review.status",
	);
	assert.equal(mutationTimeoutMs, undefined);
});
