import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	NATIVE_REVIEW_ERROR_CODE,
	NativeReviewCliError,
	NativeReviewCliV210,
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

function queuedAdapter(results: QueuedResult[]): { adapter: ExecFileAdapter; calls: Array<{ file: string; arguments: readonly string[]; cwd: string }> } {
	const calls: Array<{ file: string; arguments: readonly string[]; cwd: string }> = [];
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

const VERSION = { stdout: "gentle-ai 2.1.0\n" };
const START = { stdout: JSON.stringify({ operation: "review/start", lineage_id: "lineage-1", state: "reviewing", risk_level: "medium", selected_lenses: ["review-reliability"], changed_files: 1, changed_lines: 2, correction_budget: 1 }) };
const VALIDATE_ALLOW = { stdout: JSON.stringify({ schema: "gentle-ai.review-gate-result/v1", result: "allow", allowed: true, action: "allow", reason: "approved", gate_context: { lineage_id: "lineage-1", store_revision: "rev-1", receipt_hash: "receipt-1", target_hash: "target-1" } }) };

test("native client verifies the pinned version once and uses argv without a shell", async () => {
	const queue = queuedAdapter([VERSION, START, START, START, START]);
	const client = new NativeReviewCliV210(queue.adapter);
	await client.start({ cwd: "/repo with spaces" });
	await client.start({ cwd: "/repo with spaces", baseRef: "origin/main" });
	await client.start({ cwd: "/repo with spaces", policyPath: "/repo with spaces/.gentle-ai/policies/team policy.json" });
	await client.start({ cwd: "/repo with spaces", policyHash: "legacy-policy" } as unknown as { cwd: string; policyPath?: string });
	assert.deepEqual(queue.calls.map((call) => call.arguments), [
		["version"],
		["review", "start", "--cwd", "/repo with spaces"],
		["review", "start", "--cwd", "/repo with spaces", "--base-ref", "origin/main"],
		["review", "start", "--cwd", "/repo with spaces", "--policy", "/repo with spaces/.gentle-ai/policies/team policy.json"],
		["review", "start", "--cwd", "/repo with spaces"],
	]);
	assert.equal(queue.calls.every((call) => call.cwd === "/repo with spaces"), true);
});

test("native START rejects invalid runtime base refs before any adapter invocation", async () => {
	for (const baseRef of ["", "   ", " origin/main", "origin/main ", "origin\0main", "origin\nmain", "origin\rmain", "origin\tmain", "origin\u007fmain", 42, [], {}]) {
		const queue = queuedAdapter([]);
		const request = { cwd: "/repo", baseRef } as unknown as NativeStartRequest;
		await assert.rejects(() => new NativeReviewCliV210(queue.adapter).start(request), TypeError);
		assert.equal(queue.calls.length, 0);
	}
});

test("native client rejects incompatible version and malformed allow output", async () => {
	const incompatible = queuedAdapter([{ stdout: "gentle-ai 2.1.1\n" }]);
	await assert.rejects(
		() => new NativeReviewCliV210(incompatible.adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE,
	);
	const malformed = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...JSON.parse(VALIDATE_ALLOW.stdout), allowed: false }) }]);
	await assert.rejects(
		() => new NativeReviewCliV210(malformed.adapter).validate({ cwd: "/repo", gate: "pre-commit", lineageId: "lineage-1" }),
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
			() => new NativeReviewCliV210(queue.adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === result.code && error.operation === "version",
		);
	}
});

test("native mutation uncertainty requires exact replay", async () => {
	const queue = queuedAdapter([VERSION, { stdout: "", timedOut: true }]);
	await assert.rejects(
		() => new NativeReviewCliV210(queue.adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.TIMEOUT
			&& error.mutationOutcome === "unknown"
			&& error.nextAction === "replay-exact-native-operation",
	);
});

test("native validate requires a strict allow body", async () => {
	const queue = queuedAdapter([VERSION, VALIDATE_ALLOW]);
	const result = await new NativeReviewCliV210(queue.adapter).validate({ cwd: "/repo", gate: "pre-commit", lineageId: "lineage-1" });
	assert.equal(result.allowed, true);
	assert.equal(result.gateContext.lineageId, "lineage-1");
});


test("native decoders reject every one-field schema mutation", async () => {
	const operations = [
		{ fixtureName: "start", invoke: (client: NativeReviewCliV210) => client.start({ cwd: "/repo", lineageId: "lineage-1" }) },
		{ fixtureName: "finalize", optionalKeys: ["receipt_path"], invoke: (client: NativeReviewCliV210) => client.finalize({ cwd: "/repo", lineageId: "lineage-1" }) },
		{ fixtureName: "validate-allow", invoke: (client: NativeReviewCliV210) => client.validate({ cwd: "/repo", gate: "pre-commit", lineageId: "lineage-1" }) },
		{ fixtureName: "bind-sdd", invoke: (client: NativeReviewCliV210) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "lineage-1", expectedBindingRevision: "" }) },
		{ fixtureName: "sdd-status", invoke: (client: NativeReviewCliV210) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
	];
	for (const operation of operations) {
		const fixtureBody = JSON.parse(await fixture(operation.fixtureName)) as Record<string, unknown>;
		for (const [key, value] of Object.entries(fixtureBody)) {
			const missing = { ...fixtureBody };
			delete missing[key];
			for (const mutated of [...(operation.optionalKeys?.includes(key) ? [] : [missing]), { ...fixtureBody, [key]: typeof value === "string" ? 1 : "wrong-type" }]) {
				const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(mutated) }]);
				await assert.rejects(() => operation.invoke(new NativeReviewCliV210(queue.adapter)), NativeReviewCliError, `${operation.fixtureName}.${key}`);
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
		{ body: { ...start, risk_level: "unknown" }, invoke: (client: NativeReviewCliV210) => client.start({ cwd: "/repo" }) },
		{ body: { ...start, selected_lenses: ["unknown"] }, invoke: (client: NativeReviewCliV210) => client.start({ cwd: "/repo" }) },
		{ body: { ...finalization, state: "unknown" }, invoke: (client: NativeReviewCliV210) => client.finalize({ cwd: "/repo" }) },
		{ body: { ...validate, gate_context: { ...(validate.gate_context as Record<string, unknown>), extra: true } }, invoke: (client: NativeReviewCliV210) => client.validate({ cwd: "/repo", gate: "pre-commit" }) },
		{ body: { ...bind, gate_context: { ...(bind.gate_context as Record<string, unknown>), target_hash: 1 } }, invoke: (client: NativeReviewCliV210) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "lineage-1", expectedBindingRevision: "" }) },
		{ body: { ...status, nextRecommended: "unknown" }, invoke: (client: NativeReviewCliV210) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
		{ body: { ...status, actionContext: { ...(status.actionContext as Record<string, unknown>), allowedEditRoots: [1] } }, invoke: (client: NativeReviewCliV210) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
	];
	for (const item of cases) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(item.body) }]);
		await assert.rejects(() => item.invoke(new NativeReviewCliV210(queue.adapter)), NativeReviewCliError);
	}
});

test("native decoders reject every nested response-field mutation", async () => {
	const cases = [
		{ fixtureName: "validate-allow", nestedKey: "gate_context", invoke: (client: NativeReviewCliV210) => client.validate({ cwd: "/repo", gate: "pre-commit", lineageId: "lineage-1" }) },
		{ fixtureName: "bind-sdd", nestedKey: "gate_context", invoke: (client: NativeReviewCliV210) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "lineage-1", expectedBindingRevision: "" }) },
		{ fixtureName: "sdd-status", nestedKey: "actionContext", invoke: (client: NativeReviewCliV210) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }) },
	];
	for (const item of cases) {
		const body = JSON.parse(await fixture(item.fixtureName)) as Record<string, Record<string, unknown>>;
		for (const [field, value] of Object.entries(body[item.nestedKey]!)) {
			const missingNested = { ...body[item.nestedKey] };
			delete missingNested[field];
			for (const nested of [missingNested, { ...body[item.nestedKey], [field]: typeof value === "string" ? 1 : "wrong-type" }, { ...body[item.nestedKey], extra: true }]) {
				const queue = queuedAdapter([VERSION, { stdout: JSON.stringify({ ...body, [item.nestedKey]: nested }) }]);
				await assert.rejects(() => item.invoke(new NativeReviewCliV210(queue.adapter)), NativeReviewCliError, `${item.fixtureName}.${item.nestedKey}.${field}`);
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
			() => new NativeReviewCliV210(adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.code === scenario.code && error.mutationOutcome === "unknown" && error.nextAction === "replay-exact-native-operation",
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
		() => new NativeReviewCliV210(adapter).finalize({
			cwd: "/repo",
			lensResults: [{ lens: "review-risk", document: { id: "risk" } }],
			refuterDocument: { id: "refuter" },
			validationDocument: { id: "validation" },
			evidenceDocument: { id: "evidence" },
		}),
		NativeReviewCliError,
	);
	assert.equal(observed.filter((argument) => argument.endsWith(".json")).length, 4);
	await Promise.all(observed.filter((argument) => argument.endsWith(".json")).map(async (path) => assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(path)))));
});
async function fixture(name: string): Promise<string> {
	return readFile(new URL(`./fixtures/native-review-cli/v2.1.0/${name}.json`, import.meta.url), "utf8");
}

test("finalize ignores injected cleanup failures after native completion", async () => {
	for (const native of [{ stdout: await fixture("finalize") }, { stdout: "{" }]) {
		let cleanupAttempts = 0;
		const queue = queuedAdapter([VERSION, native]);
		const client = new NativeReviewCliV210(
			queue.adapter,
			"gentle-ai",
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
			assert.equal((await finalize()).storeRevision, "rev-2");
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
		const finalize = () => new NativeReviewCliV210(adapter).finalize({ cwd: "/repo", lensResults: [{ lens: "review-risk", document: { id: "risk" } }], refuterDocument: { id: "refuter" }, validationDocument: { id: "validation" }, evidenceDocument: { id: "evidence" } });
		if (result.exitCode === 1 || result.timedOut || result.stdout === "{") await assert.rejects(finalize, NativeReviewCliError);
		else await finalize();
		await Promise.all(staged.filter((path) => path.endsWith(".json")).map(async (path) => assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(path)))));
	}
});

test("native client decodes all checked-in v2.1.0 success fixtures", async () => {
	const queue = queuedAdapter([
		VERSION,
		{ stdout: await fixture("start") },
		{ stdout: await fixture("finalize") },
		{ stdout: await fixture("validate-allow") },
		{ stdout: await fixture("bind-sdd") },
		{ stdout: await fixture("sdd-status") },
	]);
	const client = new NativeReviewCliV210(queue.adapter);
	assert.equal((await client.start({ cwd: "/repo", lineageId: "lineage-1" })).lineageId, "lineage-1");
	assert.equal((await client.finalize({ cwd: "/repo", lineageId: "lineage-1" })).storeRevision, "rev-2");
	assert.equal((await client.validate({ cwd: "/repo", gate: "pre-commit", lineageId: "lineage-1" })).allowed, true);
	assert.equal((await client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "lineage-1", expectedBindingRevision: "" })).bindingRevision, "binding-1");
	assert.equal((await client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" })).ready, true);
});

test("native client rejects mutations, trailing JSON, and process uncertainty", async () => {
	const start = JSON.parse(await fixture("start")) as Record<string, unknown>;
	for (const body of [
		{},
		{ ...start, extra: true },
		{ ...start, changed_lines: Number.MAX_SAFE_INTEGER + 1 },
	]) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(body) }]);
		await assert.rejects(() => new NativeReviewCliV210(queue.adapter).start({ cwd: "/repo" }), NativeReviewCliError);
	}
	const trailing = queuedAdapter([VERSION, { stdout: `${await fixture("start")} {}` }]);
	await assert.rejects(() => new NativeReviewCliV210(trailing.adapter).start({ cwd: "/repo" }), NativeReviewCliError);
	for (const result of [
		{ stdout: "", stderr: "missing", exitCode: 1 },
		{ stdout: await fixture("start"), stderr: "warning" },
		{ stdout: "", timedOut: true },
	]) {
		const queue = queuedAdapter([VERSION, result]);
		await assert.rejects(
			() => new NativeReviewCliV210(queue.adapter).start({ cwd: "/repo" }),
			(error: unknown) => error instanceof NativeReviewCliError && error.mutationOutcome === "unknown",
		);
	}
});

test("native client rejects extra fields in finalize, bind, and bound SDD status fixtures", async () => {
	const finalize = JSON.parse(await fixture("finalize")) as Record<string, unknown>;
	const bind = JSON.parse(await fixture("bind-sdd")) as Record<string, unknown>;
	const status = JSON.parse(await fixture("sdd-status")) as Record<string, unknown>;
	const cases = [
		{ invoke: (client: NativeReviewCliV210) => client.finalize({ cwd: "/repo", lineageId: "lineage-1" }), body: { ...finalize, extra: true } },
		{ invoke: (client: NativeReviewCliV210) => client.bindSdd({ cwd: "/repo", change: "native-review-authority-parity", lineage: "lineage-1", expectedBindingRevision: "" }), body: { ...bind, extra: true } },
		{ invoke: (client: NativeReviewCliV210) => client.sddStatus({ cwd: "/repo", change: "native-review-authority-parity" }), body: { ...status, extra: true } },
	];
	for (const item of cases) {
		const queue = queuedAdapter([VERSION, { stdout: JSON.stringify(item.body) }]);
		await assert.rejects(() => item.invoke(new NativeReviewCliV210(queue.adapter)), NativeReviewCliError);
	}
});

test("native finalize stages ordered private result documents and removes them after decoding", async () => {
	const observed: Array<{ file: string; mode: number; content: string }> = [];
	let call = 0;
	const adapter: ExecFileAdapter = async (request) => {
		call += 1;
		if (call === 1) return { ...VERSION, stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		for (let index = 0; index < request.arguments.length; index += 1) {
			if (request.arguments[index] === "--result") {
				const path = request.arguments[index + 1]!;
				const { readFile, stat } = await import("node:fs/promises");
				observed.push({ file: path, mode: (await stat(path)).mode & 0o777, content: await readFile(path, "utf8") });
			}
		}
		return { stdout: await fixture("finalize"), stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
	};
	await new NativeReviewCliV210(adapter).finalize({
		cwd: "/repo",
		lineageId: "lineage-1",
		lensResults: [
			{ lens: "review-risk", document: { id: "risk" } },
			{ lens: "review-reliability", document: { id: "reliability" } },
		],
	});
	assert.deepEqual(observed.map((entry) => entry.mode), [0o600, 0o600]);
	assert.deepEqual(observed.map((entry) => JSON.parse(entry.content)), [{ id: "risk" }, { id: "reliability" }]);
	await Promise.all(observed.map(async (entry) => assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(entry.file)))));
});

test("native cancellation fails closed and preserves mutating ambiguity", async () => {
	const adapter: ExecFileAdapter = async (request) => {
		if (request.arguments[0] === "version") return { stdout: "gentle-ai 2.1.0\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		const error = new Error("cancelled");
		error.name = "AbortError";
		throw error;
	};
	await assert.rejects(
		() => new NativeReviewCliV210(adapter).start({ cwd: "/repo" }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.CANCELLED
			&& error.mutationOutcome === "unknown"
			&& error.nextAction === "replay-exact-native-operation",
	);
});

test("node execFile adapter passes AbortSignal to child_process", async () => {
	const controller = new AbortController();
	const pending = createNodeExecFileAdapter()({ file: process.execPath, arguments: ["-e", "setTimeout(() => {}, 10_000)"], cwd: process.cwd(), timeoutMs: 30_000, maxBufferBytes: 1024, signal: controller.signal });
	controller.abort();
	await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
});

test("native adapter receives the controller AbortSignal and preserves mutating replay guidance", async () => {
	const controller = new AbortController();
	controller.abort();
	const adapter: ExecFileAdapter = async (request) => {
		if (request.arguments[0] === "version") return { stdout: "gentle-ai 2.1.0\n", stderr: "", exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		if (request.signal?.aborted) {
			const error = new Error("cancelled");
			error.name = "AbortError";
			throw error;
		}
		throw new Error("missing AbortSignal");
	};
	await assert.rejects(
		() => new NativeReviewCliV210(adapter).start({ cwd: "/repo", signal: controller.signal }),
		(error: unknown) => error instanceof NativeReviewCliError
			&& error.code === NATIVE_REVIEW_ERROR_CODE.CANCELLED
			&& error.mutationOutcome === "unknown"
			&& error.nextAction === "replay-exact-native-operation",
	);
});
