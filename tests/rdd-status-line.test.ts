import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";
import {
	projectRddMode,
	resolveRddModeStatus as resolveSharedRddModeStatus,
	invalidateRddModeStatus,
	RDD_MODE_STATUS_CHANGED,
} from "../lib/rdd-mode-status.ts";
import {
	NATIVE_REVIEW_MODE_OPERATION,
	NATIVE_REVIEW_MODE_SOURCE,
	type NativeReviewCli,
	type NativeReviewModeRequest,
	type NativeReviewModeResult,
	type NativeReviewModeStatus,
} from "../lib/native-review-cli.ts";

// ---------------------------------------------------------------------------
// gentle-pi#661: the always-on parent prompt renders a second status line,
// `Receipt-driven development: on|off (decided by <source>)`, next to
// `Background subagent policy`, sourced from the native review mode status
// reader (`gentle-ai review mode status --json`, schema
// `gentle-ai.rdd-mode-status/v1`, decoded to `NativeReviewModeStatus`).
//
// `getOrchestratorPrompt`/`renderOrchestratorPrompt` stay synchronous and
// default `rddStatusLine` to the "unknown (native status unavailable)" line
// -- the longest of the three renderable forms -- so a no-argument call IS
// the worst case the canonical 8 KiB budget in
// tests/orchestrator-budget.test.ts measures, not a smaller placeholder
// production later exceeds. Production (before_agent_start) still resolves
// and passes the real on/off/unknown line through `resolveRddStatusLine`,
// bounded by `RDD_STATUS_TIMEOUT_MS` and memoized per cwd for
// `RDD_STATUS_MEMO_TTL_MS` so a hung or repeatedly-invoked native reader
// cannot stall or repeatedly respawn on every session/agent-start build.
// ---------------------------------------------------------------------------

const {
	renderRddStatusLine,
	resolveRddModeStatus,
	resolveRddStatusLine,
	getOrchestratorPrompt,
	clearRddStatusMemoForTesting,
	RDD_STATUS_TIMEOUT_MS,
	RDD_STATUS_MEMO_TTL_MS,
} = __testing;

function fakeReviewMode(
	result: NativeReviewModeResult | (() => never) | (() => Promise<never>),
): Pick<NativeReviewCli, "reviewMode"> {
	return {
		async reviewMode(_request: NativeReviewModeRequest): Promise<NativeReviewModeResult> {
			if (typeof result === "function") return result();
			return result;
		},
	};
}

function modeResult(
	effective: "on" | "off",
	source: (typeof NATIVE_REVIEW_MODE_SOURCE)[keyof typeof NATIVE_REVIEW_MODE_SOURCE],
	scope: NativeReviewModeResult["scope"] = "global",
): NativeReviewModeResult {
	return {
		operation: NATIVE_REVIEW_MODE_OPERATION.STATUS,
		scope,
		status: {
			global: effective,
			cloneLocal: "",
			effective,
			source,
		},
	};
}

// A counting wrapper for memo tests: counts how many times reviewMode is
// actually invoked, independent of how many times resolveRddModeStatus is
// called.
function countingReviewMode(result: NativeReviewModeResult): { cli: Pick<NativeReviewCli, "reviewMode">; calls: () => number } {
	let calls = 0;
	return {
		cli: {
			async reviewMode(_request: NativeReviewModeRequest): Promise<NativeReviewModeResult> {
				calls += 1;
				return result;
			},
		},
		calls: () => calls,
	};
}

test("shared RDD mode projection is authoritative and fail-closed", () => {
	assert.equal(projectRddMode(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL).status), "on");
	assert.equal(projectRddMode(modeResult("off", NATIVE_REVIEW_MODE_SOURCE.DEFAULT).status), "off");
	assert.equal(projectRddMode({ effective: "invalid", source: "global" } as unknown as NativeReviewModeStatus), "unknown");
	assert.equal(RDD_MODE_STATUS_CHANGED, "gentle-pi:rdd-mode-status-changed");
});

test("shared resolver caches per cwd, invalidates, and only invokes status", async () => {
	invalidateRddModeStatus();
	const operations: string[] = [];
	const cli = { reviewMode: async (request: NativeReviewModeRequest) => {
		operations.push(request.operation);
		return modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL, "both");
	} };
	assert.equal((await resolveSharedRddModeStatus(cli, "/shared-a"))?.effective, "on");
	assert.equal((await resolveSharedRddModeStatus(cli, "/shared-a"))?.effective, "on");
	assert.equal((await resolveSharedRddModeStatus(cli, "/shared-b"))?.effective, "on");
	invalidateRddModeStatus("/shared-a");
	await resolveSharedRddModeStatus(cli, "/shared-a");
	assert.deepEqual(await resolveSharedRddModeStatus(cli, "/shared-a"), {
		global: "on", cloneLocal: "", effective: "on", source: "global", scope: "global",
	});
	assert.deepEqual(operations, ["status", "status", "status"]);
});

test("shared resolver cannot let an invalidated older read overwrite a newer same-cwd observation", async () => {
	invalidateRddModeStatus();
	let calls = 0;
	let resolveFirst!: (result: NativeReviewModeResult) => void;
	let resolveSecond!: (result: NativeReviewModeResult) => void;
	const cli = { reviewMode: () => new Promise<NativeReviewModeResult>((resolve) => {
		calls += 1;
		if (calls === 1) resolveFirst = resolve;
		else resolveSecond = resolve;
	}) };
	const first = resolveSharedRddModeStatus(cli, "/shared-race");
	invalidateRddModeStatus("/shared-race");
	const second = resolveSharedRddModeStatus(cli, "/shared-race");
	resolveSecond(modeResult("off", NATIVE_REVIEW_MODE_SOURCE.DEFAULT));
	assert.equal((await second)?.effective, "off");
	resolveFirst(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL));
	assert.equal((await first)?.effective, "on");
	assert.equal((await resolveSharedRddModeStatus(cli, "/shared-race"))?.effective, "off");
	assert.equal(calls, 2, "the stale completion must not replace the post-invalidation cache entry");
});

test("renderRddStatusLine renders the fail-closed unknown line for an unresolved status", () => {
	assert.equal(
		renderRddStatusLine(undefined),
		"Receipt-driven development: unknown (native status or scope unavailable)",
	);
});

test("renderRddStatusLine renders the effective mode and deciding source", () => {
	assert.equal(
		renderRddStatusLine({ global: "on", cloneLocal: "", effective: "on", source: NATIVE_REVIEW_MODE_SOURCE.GLOBAL, scope: "global" }),
		"Receipt-driven development: on (scope: global; decided by global)",
	);
	assert.equal(
		renderRddStatusLine({ global: "off", cloneLocal: "", effective: "off", source: NATIVE_REVIEW_MODE_SOURCE.DEFAULT, scope: "default" }),
		"Receipt-driven development: off (scope: default; decided by default)",
	);
	assert.equal(
		renderRddStatusLine({ global: "", cloneLocal: "on", effective: "on", source: NATIVE_REVIEW_MODE_SOURCE.CLONE_LOCAL, scope: "clone" }),
		"Receipt-driven development: on (scope: clone; decided by clone_local)",
	);
});

test("renderRddStatusLine fails closed to unknown for a malformed or partial status object", () => {
	// A bad upstream decode, a future field rename, or a hand-built fixture
	// must never render an unrecognized value verbatim -- the render boundary
	// validates independently of the type signature.
	const malformed: readonly NativeReviewModeStatus[] = [
		{} as NativeReviewModeStatus,
		{ effective: "maybe" } as unknown as NativeReviewModeStatus,
		{ effective: "on" } as NativeReviewModeStatus, // missing source
		{ effective: "on", source: "not-a-real-source" } as unknown as NativeReviewModeStatus,
		{ global: "on", cloneLocal: "", effective: "ON", source: NATIVE_REVIEW_MODE_SOURCE.GLOBAL } as unknown as NativeReviewModeStatus,
		null as unknown as NativeReviewModeStatus,
	];
	for (const status of malformed) {
		assert.equal(
			renderRddStatusLine(status),
			"Receipt-driven development: unknown (native status or scope unavailable)",
			`expected unknown line for ${JSON.stringify(status)}`,
		);
	}
});

test("renderRddStatusLine ignores envelope query scope and derives effective scope from source", () => {
	assert.equal(
		renderRddStatusLine({ global: "on", cloneLocal: "", effective: "on", source: NATIVE_REVIEW_MODE_SOURCE.GLOBAL, scope: "both" } as unknown as NativeReviewModeStatus),
		"Receipt-driven development: on (scope: global; decided by global)",
	);
});

test("resolveRddModeStatus reads the on status from a stubbed native reviewMode reader", async () => {
	clearRddStatusMemoForTesting();
	const status = await resolveRddModeStatus(fakeReviewMode(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.CLONE_LOCAL)), "/repo-on");
	assert.deepEqual(status, {
		global: "on",
		cloneLocal: "",
		effective: "on",
		source: "clone_local",
		scope: "clone",
	});
});

test("resolveRddModeStatus reads the off status from a stubbed native reviewMode reader", async () => {
	clearRddStatusMemoForTesting();
	const status = await resolveRddModeStatus(fakeReviewMode(modeResult("off", NATIVE_REVIEW_MODE_SOURCE.GLOBAL)), "/repo-off");
	assert.equal(status?.effective, "off");
	assert.equal(status?.source, "global");
});

test("resolveRddModeStatus resolves to undefined when the native review CLI wrapper is null or absent", async () => {
	for (const wrapper of [undefined, null] as const) {
		clearRddStatusMemoForTesting();
		const status = await resolveRddModeStatus(wrapper, "/repo-no-wrapper");
		assert.equal(status, undefined, `expected undefined for a ${wrapper === null ? "null" : "missing"} wrapper`);
	}
});

test("resolveRddModeStatus resolves to undefined when the native reviewMode call rejects", async () => {
	clearRddStatusMemoForTesting();
	const status = await resolveRddModeStatus(
		fakeReviewMode(() => {
			throw new Error("native process failed");
		}),
		"/repo-rejecting",
	);
	assert.equal(status, undefined);
});

test("resolveRddModeStatus resolves to undefined within the deadline when reviewMode never settles", async () => {
	// gentle-pi#661 native-review escalation: a hung `gentle-ai` child must
	// not stall session start. resolveRddModeStatus races the call against
	// its own abort listener, so this holds even for a stub reviewMode that
	// itself ignores the passed `signal`, as a real hung child process would
	// eventually be killed and reject via its own signal handling.
	clearRddStatusMemoForTesting();
	const neverSettling = fakeReviewMode(() => new Promise<never>(() => {}));
	const deadlineMs = 150;
	const start = Date.now();
	const status = await resolveRddModeStatus(neverSettling, "/repo-hung", AbortSignal.timeout(deadlineMs));
	const elapsed = Date.now() - start;
	assert.equal(status, undefined);
	assert.ok(elapsed < deadlineMs + 1000, `expected the read to resolve near the ${deadlineMs}ms deadline, took ${elapsed}ms`);
});

test("resolveRddModeStatus keeps its internal deadline when the caller signal never aborts", async () => {
	clearRddStatusMemoForTesting();
	const caller = new AbortController();
	const deadline = new AbortController();
	let received!: AbortSignal;
	const cli = { reviewMode: ({ signal }: NativeReviewModeRequest) => {
		received = signal!;
		return new Promise<NativeReviewModeResult>(() => {});
	} };
	const pending = resolveSharedRddModeStatus(cli, "/repo-internal-deadline", caller.signal, Date.now, deadline.signal);
	await Promise.resolve();
	assert.notEqual(received, caller.signal, "the resolver must retain its own deadline alongside the caller signal");
	deadline.abort(new Error("internal deadline"));
	assert.equal(await pending, undefined);
});

test("resolveRddModeStatus promptly preserves a caller abort as the first abort", async () => {
	clearRddStatusMemoForTesting();
	const caller = new AbortController();
	const deadline = new AbortController();
	const callerReason = new Error("caller cancelled");
	let received!: AbortSignal;
	const cli = { reviewMode: ({ signal }: NativeReviewModeRequest) => {
		received = signal!;
		return new Promise<NativeReviewModeResult>((_resolve, reject) => {
			signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
		});
	} };
	const pending = resolveSharedRddModeStatus(cli, "/repo-caller-abort", caller.signal, Date.now, deadline.signal);
	await Promise.resolve();
	caller.abort(callerReason);
	deadline.abort(new Error("later deadline"));
	assert.equal(await pending, undefined);
	assert.notEqual(received, caller.signal, "the resolver must pass the combined signal to reviewMode");
	assert.equal(received.reason, callerReason, "the first abort reason must win");
});

test("resolveRddModeStatus does not memoize a caller-aborted read", async () => {
	clearRddStatusMemoForTesting();
	const caller = new AbortController();
	let calls = 0;
	const cli = {
		reviewMode: (): Promise<NativeReviewModeResult> => {
			calls += 1;
			return calls === 1 ? new Promise<never>(() => {}) : Promise.resolve(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL));
		},
	};
	const pending = resolveSharedRddModeStatus(cli, "/repo-caller-abort-no-memo", caller.signal);
	await Promise.resolve();
	caller.abort(new Error("caller cancelled"));
	assert.equal(await pending, undefined);

	const status = await resolveSharedRddModeStatus(cli, "/repo-caller-abort-no-memo");
	assert.equal(calls, 2, "a caller-aborted read must not cache undefined");
	assert.equal(status?.effective, "on");
});

test("resolveRddModeStatus memoizes an ordinary rejection despite a caller abort before catch", async () => {
	clearRddStatusMemoForTesting();
	const caller = new AbortController();
	let calls = 0;
	const cli = {
		reviewMode: (): Promise<NativeReviewModeResult> => new Promise((_resolve, reject) => {
			calls += 1;
			reject(new Error("native process failed"));
			queueMicrotask(() => caller.abort(new Error("concurrent caller cancellation")));
		}),
	};
	const cwd = "/repo-ordinary-rejection-concurrent-abort";
	assert.equal(await resolveSharedRddModeStatus(cli, cwd, caller.signal), undefined);
	assert.equal(caller.signal.aborted, true, "the caller must abort before the catch observes the rejection");
	assert.equal(await resolveSharedRddModeStatus(cli, cwd), undefined);
	assert.equal(calls, 1, "an ordinary rejection must remain memoized");
});

test("resolveRddModeStatus memoizes malformed results and internal timeouts", async () => {
	clearRddStatusMemoForTesting();
	let malformedCalls = 0;
	const malformed = {
		reviewMode: async (): Promise<NativeReviewModeResult> => {
			malformedCalls += 1;
			return modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL, "invalid" as NativeReviewModeResult["scope"]);
		},
	};
	const malformedCwd = "/repo-malformed-memo";
	assert.equal(await resolveSharedRddModeStatus(malformed, malformedCwd), undefined);
	assert.equal(await resolveSharedRddModeStatus(malformed, malformedCwd), undefined);
	assert.equal(malformedCalls, 1, "malformed results must cache the fail-closed undefined observation");

	clearRddStatusMemoForTesting();
	let timeoutCalls = 0;
	const deadline = new AbortController();
	const timedOut = {
		reviewMode: (): Promise<NativeReviewModeResult> => {
			timeoutCalls += 1;
			return new Promise<NativeReviewModeResult>(() => {});
		},
	};
	const timeoutCwd = "/repo-internal-timeout-memo";
	const pending = resolveSharedRddModeStatus(timedOut, timeoutCwd, undefined, Date.now, deadline.signal);
	await Promise.resolve();
	deadline.abort(new Error("internal deadline"));
	assert.equal(await pending, undefined);
	assert.equal(await resolveSharedRddModeStatus(timedOut, timeoutCwd), undefined);
	assert.equal(timeoutCalls, 1, "internal timeout observations must remain memoized");
});

test("resolveRddModeStatus memoizes a resolved status per cwd for RDD_STATUS_MEMO_TTL_MS", async () => {
	clearRddStatusMemoForTesting();
	const { cli, calls } = countingReviewMode(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL));
	const cwd = "/repo-memo-hit";
	const first = await resolveRddModeStatus(cli, cwd);
	const second = await resolveRddModeStatus(cli, cwd);
	assert.deepEqual(first, second);
	assert.equal(calls(), 1, "a second call within the TTL must reuse the memoized status, not respawn the native reader");
});

test("resolveRddModeStatus re-reads once the memoized status expires", async () => {
	clearRddStatusMemoForTesting();
	const { cli, calls } = countingReviewMode(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL));
	const cwd = "/repo-memo-expiry";
	let clock = 1_000_000;
	const now = () => clock;
	await resolveRddModeStatus(cli, cwd, undefined, now);
	assert.equal(calls(), 1);
	clock += RDD_STATUS_MEMO_TTL_MS + 1;
	await resolveRddModeStatus(cli, cwd, undefined, now);
	assert.equal(calls(), 2, "a call after the TTL elapses must re-read rather than reuse the stale memo");
});

test("resolveRddModeStatus memoizes independently per cwd", async () => {
	clearRddStatusMemoForTesting();
	const { cli, calls } = countingReviewMode(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL));
	await resolveRddModeStatus(cli, "/repo-a");
	await resolveRddModeStatus(cli, "/repo-b");
	assert.equal(calls(), 2, "distinct cwds must not share a memo entry");
});

test("resolveRddStatusLine renders on, off, and unavailable from the stubbed native reader", async () => {
	clearRddStatusMemoForTesting();
	assert.equal(
		await resolveRddStatusLine(fakeReviewMode(modeResult("on", NATIVE_REVIEW_MODE_SOURCE.GLOBAL)), "/repo-line-on"),
		"Receipt-driven development: on (scope: global; decided by global)",
	);
	assert.equal(
		await resolveRddStatusLine(fakeReviewMode(modeResult("off", NATIVE_REVIEW_MODE_SOURCE.DEFAULT)), "/repo-line-off"),
		"Receipt-driven development: off (scope: default; decided by default)",
	);
	assert.equal(
		await resolveRddStatusLine(undefined, "/repo-line-unknown"),
		"Receipt-driven development: unknown (native status or scope unavailable)",
	);
});

test("RDD_STATUS_TIMEOUT_MS is a small, positive bounded-deadline constant", () => {
	assert.equal(typeof RDD_STATUS_TIMEOUT_MS, "number");
	assert.ok(RDD_STATUS_TIMEOUT_MS > 0 && RDD_STATUS_TIMEOUT_MS <= 10_000);
});

test("getOrchestratorPrompt renders the resolved RDD status line next to the background policy line", () => {
	const cwd = process.cwd();
	for (const line of [
		"Receipt-driven development: on (scope: global; decided by global)",
		"Receipt-driven development: off (scope: default; decided by default)",
		"Receipt-driven development: unknown (native status or scope unavailable)",
	]) {
		const rendered = getOrchestratorPrompt(cwd, undefined, line);
		assert.ok(rendered.includes(line), `rendered prompt missing RDD status line: ${line}`);
		assert.match(rendered, /Background subagent policy: (?:on|off) \(capability: (?:ready|absent)\)/);
	}
});

test("getOrchestratorPrompt defaults to the worst-case unknown RDD status line (budget-critical path)", () => {
	// gentle-pi#661 follow-up: the no-argument default must BE the worst case
	// the byte budget in tests/orchestrator-budget.test.ts measures, so a
	// caller that never resolves a status renders the longest line rather
	// than none at all.
	const rendered = getOrchestratorPrompt();
	assert.ok(rendered.includes("Receipt-driven development: unknown (native status or scope unavailable)"));
});

test("the prompt cache key distinguishes on, off, and unknown so each renders a distinct prompt", () => {
	const cwd = process.cwd();
	const on = getOrchestratorPrompt(cwd, undefined, "Receipt-driven development: on (scope: global; decided by global)");
	const off = getOrchestratorPrompt(cwd, undefined, "Receipt-driven development: off (scope: default; decided by default)");
	const unknown = getOrchestratorPrompt(cwd, undefined, "Receipt-driven development: unknown (native status or scope unavailable)");
	const none = getOrchestratorPrompt(cwd);
	assert.notEqual(on, off);
	assert.notEqual(off, unknown);
	assert.notEqual(on, unknown);
	// The no-argument default renders the same worst-case "unknown" line, so
	// it is the same prompt as the explicit unknown-line call.
	assert.equal(none, unknown);
	// Re-rendering the same status line returns the memoized prompt.
	assert.equal(
		getOrchestratorPrompt(cwd, undefined, "Receipt-driven development: on (scope: global; decided by global)"),
		on,
	);
});

test("the on and off renders are never longer than the unknown (worst-case) render", () => {
	// Every renderable NativeReviewModeSource crossed with on/off must stay at
	// or under the "unknown (native status unavailable)" line's length, since
	// the budget is sized against that one worst case. Sourced from the
	// exported NATIVE_REVIEW_MODE_SOURCE constants, not a literal list, so a
	// future source addition is exercised automatically.
	const cwd = process.cwd();
	const unknownLine = "Receipt-driven development: unknown (native status or scope unavailable)";
	const unknownBytes = Buffer.byteLength(getOrchestratorPrompt(cwd, undefined, unknownLine), "utf8");
	for (const source of Object.values(NATIVE_REVIEW_MODE_SOURCE)) {
		for (const effective of ["on", "off"] as const) {
			const scope = source === NATIVE_REVIEW_MODE_SOURCE.CLONE_LOCAL ? "clone" : source;
			const line = renderRddStatusLine({ global: effective, cloneLocal: "", effective, source, scope });
			const bytes = Buffer.byteLength(getOrchestratorPrompt(cwd, undefined, line), "utf8");
			assert.ok(
				bytes <= unknownBytes,
				`"${line}" rendered ${bytes} B, longer than the unknown-line render at ${unknownBytes} B`,
			);
		}
	}
});
