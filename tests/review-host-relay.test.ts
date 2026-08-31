import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNodeExecFileAdapter } from "../lib/native-review-cli.ts";
import {
	REVIEW_HOST_RELAY_FAILURE,
	REVIEW_HOST_RELAY_PI_ARGV,
	REVIEW_HOST_RELAY_PI_TIMEOUT_ENV,
	REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS,
	REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS,
	REVIEW_HOST_RELAY_PI_TIMEOUT_PER_MEBIBYTE_MS,
	REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE,
	REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE,
	ReviewHostRelayError,
	classifyReviewHostRelayRefusal,
	resolveReviewHostRelayPiTimeoutMs,
	resolveReviewHostRelaySubmission,
	reviewHostRelaySlots,
	runReviewHostRelaySlot,
} from "../lib/review-host-relay.ts";
import { GENTLE_PI_REVIEW_RELAY_CONTRACT, GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV } from "../lib/review-relay-contract.ts";
import { decodeReviewNextTransitionV3, type ReviewCaptureSubmissionV1, type ReviewCollectInputV3 } from "../lib/review-integration-v2.ts";

// ---------------------------------------------------------------------------
// Fake binaries. Following the repo's fake-executable idiom (shell/git
// wrappers in related review tests), these are
// shebang scripts written into a scratch directory; node scripts are used so
// binary-unsafe bytes survive verbatim.
// ---------------------------------------------------------------------------

const FAKE_GENTLE_AI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (process.env.RELAY_FAKE_LOG) fs.appendFileSync(process.env.RELAY_FAKE_LOG, JSON.stringify({ argv, cwd: process.cwd(), contract: process.env.${GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV} ?? null }) + "\\n");
if (argv.some((token) => token === "--materialize" || token.startsWith("--materialize="))) {
	const mode = process.env.RELAY_FAKE_MATERIALIZE_MODE || "ok";
	if (mode === "ok") { process.stdout.write(Buffer.from(process.env.RELAY_FAKE_PROMPT_B64 || "", "base64")); process.exit(0); }
	if (mode === "empty") process.exit(0);
	if (mode === "unknown-flag") { process.stderr.write("flag provided but not defined: -materialize\\nUsage of gentle-ai review capture-result:\\n"); process.exit(2); }
	if (mode === "handshake") { process.stderr.write(process.env.RELAY_FAKE_HANDSHAKE_STDERR || "the active runtime is not eligible for immutable receipt review"); process.exit(1); }
	process.stderr.write("materialize exploded\\n"); process.exit(3);
}
const inputToken = argv.find((token) => token === "--input" || token.startsWith("--input="));
if (inputToken !== undefined) {
	const mode = process.env.RELAY_FAKE_SUBMIT_MODE || "ok";
	const inputPath = inputToken.startsWith("--input=") ? inputToken.slice("--input=".length) : argv[argv.indexOf("--input") + 1];
	if (mode === "ok" || mode === "cleanup-fail") {
		const bytes = fs.readFileSync(inputPath);
		if (process.env.RELAY_FAKE_SUBMIT_CAPTURE) fs.writeFileSync(process.env.RELAY_FAKE_SUBMIT_CAPTURE, bytes);
		const accepted = JSON.stringify({ schema: "gentle-ai.review-result-artifact/v2", admission_decision: "completed" });
		if (mode === "cleanup-fail") {
			process.stdout.write(accepted, () => {
				fs.chmodSync(path.dirname(path.dirname(inputPath)), 0o500);
				process.exit(0);
			});
			return;
		}
		process.stdout.write(accepted);
		process.exit(0);
	}
	if (mode === "refuse-cleanup-fail") fs.chmodSync(path.dirname(path.dirname(inputPath)), 0o500);
	if (mode === "admit") {
		// Go's admission refusal shape: a schema-bounded failure/v2 envelope on
		// stdout, the operator line with the typed code suffix on stderr, exit 1.
		const bytes = fs.readFileSync(inputPath);
		let parsed;
		try { parsed = JSON.parse(bytes.toString("utf8")); } catch { parsed = undefined; }
		const refuse = (cause) => {
			process.stdout.write(JSON.stringify({ schema: "gentle-ai.review-integration.failure/v2", contract: "gentle-ai.review-integration/v2", operation: "review.capture-result", phase: "preflight", code: "invalid_request", message: "The negotiated review request is invalid.", mutation_outcome: "not_started", authority_applicability: "not_evaluated", retry_safe: true, replayability: "not_replayable", required_inputs: [], next_action: "correct_request", cause }));
			process.stderr.write("Error: " + cause + " [invalid_request]\\n");
			process.exit(1);
		};
		if (parsed === undefined || typeof parsed !== "object") refuse("lens provider result admission incomplete: reviewer payload contains no complete JSON object: no object start was found in " + bytes.length + " bytes; the rejected reviewer payload was preserved at " + inputPath + ".rejected");
		if (parsed.subject_hash !== process.env.RELAY_FAKE_EXPECTED_SUBJECT) refuse("reviewer artifact admission binding_mismatch: reviewer result echoed a different artifact subject: the rejected admission did not consume the lens slot, so re-run the lens and invoke gentle-ai review capture-result again on the same lineage with a result that echoes the binding's top-level subject_hash, which is " + process.env.RELAY_FAKE_EXPECTED_SUBJECT);
		process.stdout.write(JSON.stringify({ schema: "gentle-ai.review-result-artifact/v2", admission_decision: "completed" }));
		process.exit(0);
	}
	process.stderr.write("capture binding does not match the current reviewing authority\\n");
	process.exit(1);
}
process.stderr.write("unexpected fake gentle-ai invocation\\n");
process.exit(9);
`;

const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (process.env.RELAY_FAKE_PI_LOG) fs.appendFileSync(process.env.RELAY_FAKE_PI_LOG, JSON.stringify({ argv, cwd: process.cwd(), entries: fs.readdirSync(process.cwd()), contract: process.env.${GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV} ?? null }) + "\\n");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
	const stdin = Buffer.concat(chunks);
	if (process.env.RELAY_FAKE_PI_STDIN_CAPTURE) fs.writeFileSync(process.env.RELAY_FAKE_PI_STDIN_CAPTURE, stdin);
	const mode = process.env.RELAY_FAKE_PI_MODE || "ok";
	if (process.env.RELAY_FAKE_PI_BREAK_CLEANUP === "true") fs.chmodSync(path.dirname(process.cwd()), 0o500);
	if (mode === "ok") { process.stdout.write(Buffer.from(process.env.RELAY_FAKE_PI_OUTPUT_B64 || "", "base64")); process.exit(0); }
	if (mode === "empty") process.exit(0);
	if (mode === "hang") { setTimeout(() => process.exit(0), 10_000); return; }
	process.stderr.write("pi exploded\\n");
	process.exit(4);
});
`;

interface RelayHarness {
	directory: string;
	gentleAi: string;
	pi: string;
	logPath: string;
	piLogPath: string;
	stdinCapturePath: string;
	submitCapturePath: string;
	targetCwd: string;
	environment: NodeJS.ProcessEnv;
}

function harness(t: test.TestContext, overrides: Record<string, string> = {}): RelayHarness {
	const directory = mkdtempSync(join(tmpdir(), "gentle-pi-relay-harness-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const gentleAi = join(directory, "gentle-ai");
	const pi = join(directory, "pi");
	writeFileSync(gentleAi, FAKE_GENTLE_AI);
	chmodSync(gentleAi, 0o755);
	writeFileSync(pi, FAKE_PI);
	chmodSync(pi, 0o755);
	const logPath = join(directory, "gentle-ai.log");
	const piLogPath = join(directory, "pi.log");
	const stdinCapturePath = join(directory, "pi-stdin.bin");
	const submitCapturePath = join(directory, "submitted.bin");
	const targetCwd = join(directory, "target-worktree");
	mkdirSync(targetCwd);
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		RELAY_FAKE_LOG: logPath,
		RELAY_FAKE_PI_LOG: piLogPath,
		RELAY_FAKE_PI_STDIN_CAPTURE: stdinCapturePath,
		RELAY_FAKE_SUBMIT_CAPTURE: submitCapturePath,
		...overrides,
	};
	// The relay itself must add the handshake; the base environment never
	// carries it, so the fake-binary log proves the injection.
	delete environment[GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV];
	return { directory, gentleAi, pi, logPath, piLogPath, stdinCapturePath, submitCapturePath, targetCwd, environment };
}

function readLog(path: string): Array<{ argv: string[]; contract: string | null; cwd?: string; entries?: string[] }> {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
}

const BINDING_TOKENS = Object.freeze([
	"--lineage=review-1d5aadacc600e167",
	`--expected-revision=sha256:${"c".repeat(64)}`,
	`--target=sha256:${"d".repeat(64)}`,
	`--repository-context=rctx1_${"e".repeat(64)}`,
	"--lens=review-reliability",
	"--order=0",
	`--subject-hash=sha256:${"a".repeat(64)}`,
]);
const CAPTURE_TOKENS = Object.freeze([...BINDING_TOKENS, "--agent=pi", "--materialize=true"]);

// The provider-owned completing form: exact operation and argument tokens
// with one declared {{value}} substitution slot for the artifact path.
const SUBMISSION: ReviewCaptureSubmissionV1 = Object.freeze({
	operationToken: "capture-result",
	argumentTokens: Object.freeze([...BINDING_TOKENS, "--input={{value}}"]),
	values: Object.freeze([{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: BINDING_TOKENS.length }]),
});

// Prompt and result bytes deliberately include binary-unsafe content: NUL,
// control bytes, quotes, backslashes, CRLF, multi-byte UTF-8, and bytes that
// are not valid UTF-8 at all. The relay must move them verbatim.
const PROMPT_BYTES = Buffer.concat([
	Buffer.from('GENTLE_AI_REVIEW_BINDING {"lineage":"review-1d5aadacc600e167"}\n"quotes" \\backslash\r\n\u00e9\u{1F3A9}\n', "utf8"),
	Buffer.from([0x00, 0x01, 0x07, 0xff, 0xfe, 0x00]),
]);
const PI_OUTPUT_BYTES = Buffer.concat([
	Buffer.from(`{"subject_hash":"sha256:${"a".repeat(64)}","findings":[]}\n`, "utf8"),
	Buffer.from([0x00, 0xf0, 0x9f, 0x8e, 0xa9, 0xff, 0x0d, 0x0a]),
]);

function relayRequest(fixture: RelayHarness, overrides: Record<string, unknown> = {}) {
	return {
		captureArgumentTokens: CAPTURE_TOKENS,
		submission: SUBMISSION,
		gentleAiExecutable: fixture.gentleAi,
		piExecutable: fixture.pi,
		targetCwd: fixture.targetCwd,
		environment: {
			...fixture.environment,
			RELAY_FAKE_PROMPT_B64: PROMPT_BYTES.toString("base64"),
			RELAY_FAKE_PI_OUTPUT_B64: PI_OUTPUT_BYTES.toString("base64"),
		},
		gentleAiTimeoutMs: 30_000,
		piTimeoutMs: 30_000,
		...overrides,
	};
}

async function rejectsWithRelayError(promise: Promise<unknown>, kind: string, stage: string): Promise<ReviewHostRelayError> {
	let caught: ReviewHostRelayError | undefined;
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof ReviewHostRelayError, `expected ReviewHostRelayError, received ${String(error)}`);
		caught = error;
		return error.name === "ReviewHostRelayError" && error.kind === kind && error.stage === stage;
	});
	return caught!;
}

// ---------------------------------------------------------------------------
// Handshake — every gentle-ai CLI spawn carries the compiled declaration.
// ---------------------------------------------------------------------------

test("the central native CLI runner declares the relay contract on every gentle-ai spawn", async (t) => {
	const fixture = harness(t);
	const probe = join(fixture.directory, "env-probe");
	writeFileSync(probe, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ contract: process.env.${GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV} ?? null }));\n`);
	chmodSync(probe, 0o755);
	const hadContract = Object.prototype.hasOwnProperty.call(process.env, GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV);
	const previous = process.env[GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV];
	delete process.env[GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV];
	t.after(() => {
		if (hadContract) process.env[GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV] = previous;
	});
	const adapter = createNodeExecFileAdapter();
	for (const argv of [["version"], ["review", "status", "--cwd", fixture.directory]]) {
		const result = await adapter({ file: probe, arguments: argv, cwd: fixture.directory, timeoutMs: 10_000, maxBufferBytes: 1024 * 1024 });
		assert.equal(result.exitCode, 0);
		assert.deepEqual(JSON.parse(result.stdout), { contract: GENTLE_PI_REVIEW_RELAY_CONTRACT });
	}
});

test("relay contract constants are the compiled gentle-ai handshake values", () => {
	assert.equal(GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV, "GENTLE_PI_REVIEW_RELAY_CONTRACT");
	assert.equal(GENTLE_PI_REVIEW_RELAY_CONTRACT, "gentle-pi.review-relay/v1");
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("relay happy path moves prompt and result bytes verbatim through a fresh empty scratch pi subprocess", async (t) => {
	const fixture = harness(t);
	const result = await runReviewHostRelaySlot(relayRequest(fixture));

	assert.equal(result.promptByteLength, PROMPT_BYTES.length);
	assert.equal(result.resultByteLength, PI_OUTPUT_BYTES.length);
	assert.equal(JSON.parse(result.submission).admission_decision, "completed");

	// Prompt bytes reached pi stdin verbatim.
	assert.deepEqual(readFileSync(fixture.stdinCapturePath), PROMPT_BYTES);
	// Submission --input file bytes are EXACTLY the pi stdout bytes.
	assert.deepEqual(readFileSync(fixture.submitCapturePath), PI_OUTPUT_BYTES);

	const gentleAiCalls = readLog(fixture.logPath);
	assert.equal(gentleAiCalls.length, 2);
	// (a) exact provider tokens, verbatim, in provider order.
	assert.deepEqual(gentleAiCalls[0]!.argv, ["review", "capture-result", ...CAPTURE_TOKENS]);
	// (d) the provider-owned submission form, verbatim: its exact operation
	// and argument tokens with only the artifact path substituted into the
	// declared {{value}} slot. No agent/materialize, nothing synthesized.
	assert.deepEqual(gentleAiCalls[1]!.argv.slice(0, 2 + BINDING_TOKENS.length), ["review", SUBMISSION.operationToken, ...BINDING_TOKENS]);
	const substituted = gentleAiCalls[1]!.argv.at(-1)!;
	assert.match(substituted, /^--input=\S+$/);
	assert.equal(substituted.includes("{{value}}"), false);
	assert.equal(existsSync(substituted.slice("--input=".length)), false, "the coordinator removes its temporary result file after provider submission");
	assert.equal(gentleAiCalls[1]!.argv.length, 2 + SUBMISSION.argumentTokens.length);
	assert.equal(gentleAiCalls[1]!.argv.some((token) => token.includes("--agent") || token.includes("--materialize")), false);
	// Handshake declared on both gentle-ai invocations even though the base
	// environment carried none.
	assert.deepEqual(gentleAiCalls.map((call) => call.contract), [GENTLE_PI_REVIEW_RELAY_CONTRACT, GENTLE_PI_REVIEW_RELAY_CONTRACT]);
	assert.deepEqual(gentleAiCalls.map((call) => call.cwd), [fixture.targetCwd, fixture.targetCwd]);

	const piCalls = readLog(fixture.piLogPath);
	assert.equal(piCalls.length, 1);
	// The pi environment stays untouched: no relay handshake is injected.
	assert.equal(piCalls[0]!.contract, null);
	// Fresh EMPTY scratch cwd, removed after the run.
	assert.deepEqual(piCalls[0]!.entries, []);
	assert.notEqual(piCalls[0]!.cwd, process.cwd());
	assert.equal(existsSync(piCalls[0]!.cwd!), false);
});

test("the pi lockdown argv is pinned exactly with no model or provider selection", async (t) => {
	const fixture = harness(t);
	await runReviewHostRelaySlot(relayRequest(fixture));
	const piCalls = readLog(fixture.piLogPath);
	const expected = [
		"--print",
		"--mode", "text",
		"--no-session",
		"--no-tools",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--no-approve",
	];
	assert.deepEqual([...REVIEW_HOST_RELAY_PI_ARGV], expected);
	assert.deepEqual(piCalls[0]!.argv, expected);
	assert.equal(piCalls[0]!.argv.some((token) => token.startsWith("--model") || token.startsWith("--provider") || token.startsWith("--profile")), false);
});

// ---------------------------------------------------------------------------
// Fail-closed legs — a typed transport error and NO submission.
// ---------------------------------------------------------------------------

test("materialize nonzero exit fails closed with a typed error and never launches pi or submits", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_MATERIALIZE_MODE: "fail" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED, "materialize");
	assert.equal(error.exitCode, 3);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(readLog(fixture.logPath).length, 1);
	assert.equal(readLog(fixture.piLogPath).length, 0);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("an empty materialized prompt fails closed before pi launches", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_MATERIALIZE_MODE: "empty" });
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.EMPTY_PROMPT, "materialize");
	assert.equal(readLog(fixture.piLogPath).length, 0);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("pi nonzero exit fails closed with a typed error and no submission", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "fail" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi");
	assert.equal(error.exitCode, 4);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(readLog(fixture.logPath).length, 1, "no submission invocation after pi failure");
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("empty pi stdout fails closed with a typed error and no submission", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "empty" });
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.PI_EMPTY_OUTPUT, "pi");
	assert.equal(readLog(fixture.logPath).length, 1);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("pi timeout fails closed with a typed error and no submission", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 300 })), REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT, "pi");
	assert.equal(error.timedOut, true);
	assert.equal(readLog(fixture.logPath).length, 1);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

// ---------------------------------------------------------------------------
// gentle-pi#367 — the reviewer bound is reachable from production, and a
// reviewer killed by it says so with both measurements.
// ---------------------------------------------------------------------------

test("the reviewer bound scales with materialized prompt bytes instead of one fixed number", () => {
	const empty: NodeJS.ProcessEnv = {};
	// A tiny prompt still gets the model-latency floor.
	assert.equal(resolveReviewHostRelayPiTimeoutMs(0, empty), REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS);
	assert.equal(resolveReviewHostRelayPiTimeoutMs(1, empty), REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS + 1);
	// One mebibyte of prompt buys exactly one linear allowance.
	assert.equal(
		resolveReviewHostRelayPiTimeoutMs(1024 * 1024, empty),
		REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS + REVIEW_HOST_RELAY_PI_TIMEOUT_PER_MEBIBYTE_MS,
	);
	// The reported field candidate: ~1.58 MB of prompt, whose reviewer needed
	// 478s and was killed by the old fixed 600s bound. The derived bound must
	// clear that measurement with real margin.
	const reported = resolveReviewHostRelayPiTimeoutMs(1_580_000, empty);
	assert.ok(reported > 600_000, `derived bound ${reported} must exceed the old fixed 600000ms bound`);
	assert.ok(reported > 478_000 * 3, `derived bound ${reported} must keep real margin over the measured 478000ms reviewer run`);
	// Never unbounded, however large the prompt gets.
	assert.equal(resolveReviewHostRelayPiTimeoutMs(Number.MAX_SAFE_INTEGER, empty), REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS);
});

test("the reviewer bound honours the environment override and ignores malformed values", () => {
	const bytes = 4 * 1024 * 1024;
	assert.equal(resolveReviewHostRelayPiTimeoutMs(bytes, { [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: "1234" }), 1234);
	// The override is clamped by the same hard ceiling as the derived bound.
	assert.equal(resolveReviewHostRelayPiTimeoutMs(bytes, { [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: "999999999" }), REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS);
	const derived = resolveReviewHostRelayPiTimeoutMs(bytes, {});
	for (const malformed of ["", "0", "-1", "12.5", "abc", " 600000", "1e6"]) {
		assert.equal(resolveReviewHostRelayPiTimeoutMs(bytes, { [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: malformed }), derived, `malformed ${JSON.stringify(malformed)} must fall back to the derived bound`);
	}
});

test("the production relay path resolves the reviewer bound from the environment, with no injected timeout", async (t) => {
	// The regression: piTimeoutMs was reachable only through the test seam, so
	// production always ran against the fixed 600s bound. This request injects
	// no timeout at all — the override must reach the real spawn.
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang", [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: "300" });
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: undefined })),
		REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT,
		"pi",
	);
	assert.equal(error.timeoutMs, 300);
	assert.equal(error.timedOut, true);
	assert.equal(readLog(fixture.logPath).length, 1, "no submission after a reviewer timeout");
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("a relay Pi timeout keeps its typed mapping and timing evidence when opaque scratch cleanup also fails", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang", RELAY_FAKE_PI_BREAK_CLEANUP: "true" });
	const scratchParent = mkdtempSync(join(tmpdir(), "gentle-pi-relay-pi-primary-failure-"));
	const originalTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = scratchParent;
	try {
		const error = await rejectsWithRelayError(
			runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 300 })),
			REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT,
			"pi",
		);
		assert.equal(error.timedOut, true);
		assert.equal(error.timeoutMs, 300);
		assert.ok(error.elapsedMs !== null && error.elapsedMs >= 250);
	} finally {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		chmodSync(scratchParent, 0o700);
		rmSync(scratchParent, { recursive: true, force: true });
	}
});

test("a killed reviewer reports elapsed, limit, and what to change instead of an opaque transport failure", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 300 })), REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT, "pi");
	assert.equal(error.timeoutMs, 300);
	assert.ok(error.elapsedMs !== null && error.elapsedMs >= 250, `elapsed ${error.elapsedMs} must record the real wall time`);
	assert.ok(error.elapsedMs! < 10_000, "the reviewer was killed at the bound, not left to finish");
	assert.match(error.message, /exceeded the relay bound/);
	assert.match(error.message, new RegExp(String(error.elapsedMs)));
	assert.match(error.message, /limit for a \d+-byte materialized prompt/);
	assert.match(error.message, new RegExp(REVIEW_HOST_RELAY_PI_TIMEOUT_ENV));
	assert.equal(error.mutationOutcome, "none");
});

test("a crashed reviewer stays distinguishable from a killed one and still carries its measurements", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "fail" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 30_000 })), REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi");
	assert.equal(error.timedOut, false);
	assert.equal(error.exitCode, 4);
	assert.equal(error.timeoutMs, 30_000);
	assert.ok(error.elapsedMs !== null && error.elapsedMs >= 0);
});

test("submission refusal is a typed error whose outcome is unknown pending STATUS", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "refuse" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit");
	assert.equal(error.mutationOutcome, "unknown");
	assert.match(error.stderr, /capture binding does not match/);
	assert.equal(readLog(fixture.logPath).length, 2);
});

// gentle-pi#522 / #524: Go refuses a reviewer submission at admission with a
// typed [invalid_request] refusal and states that the lens slot was not
// consumed. That is a proven non-mutation, not an unknown outcome, and the
// refusal text is the only thing that tells the host what to change.
function admittingRequest(fixture: RelayHarness, reviewerOutput: Buffer) {
	return relayRequest(fixture, {
		environment: {
			...fixture.environment,
			RELAY_FAKE_PROMPT_B64: PROMPT_BYTES.toString("base64"),
			RELAY_FAKE_PI_OUTPUT_B64: reviewerOutput.toString("base64"),
		},
	});
}

test("a reviewer printing garbage is refused at admission as a proven non-mutation carrying Go's refusal", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "admit", RELAY_FAKE_EXPECTED_SUBJECT: `sha256:${"a".repeat(64)}` });
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(admittingRequest(fixture, Buffer.from("not json at all", "utf8"))),
		REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
		"submit",
	);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(error.exitCode, 1);
	assert.equal(error.timedOut, false);
	assert.match(error.stderr, /reviewer payload contains no complete JSON object/);
	assert.match(error.stderr, /\[invalid_request\]/);
	assert.match(error.message, /reviewer payload contains no complete JSON object/);
	assert.equal(readLog(fixture.logPath).length, 2, "the refusal must not be retried by the relay");
});

test("a reviewer echoing a different subject is refused at admission as a proven non-mutation carrying Go's continuation", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "admit", RELAY_FAKE_EXPECTED_SUBJECT: `sha256:${"a".repeat(64)}` });
	const wrongSubject = Buffer.from(JSON.stringify({ subject_hash: `sha256:${"0".repeat(64)}`, inspection: { status: "completed", paths: [] }, findings: [], evidence: ["x"] }), "utf8");
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(admittingRequest(fixture, wrongSubject)),
		REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
		"submit",
	);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(error.exitCode, 1);
	assert.match(error.stderr, /binding_mismatch/);
	assert.match(error.stderr, /did not consume the lens slot/);
	assert.match(error.stderr, /\[invalid_request\]/);
	assert.match(error.message, /did not consume the lens slot/);
	assert.equal(readLog(fixture.logPath).length, 2, "the refusal must not be retried by the relay");
});

test("a submission the fake admits with the expected subject still completes", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "admit", RELAY_FAKE_EXPECTED_SUBJECT: `sha256:${"a".repeat(64)}` });
	const result = await runReviewHostRelaySlot(admittingRequest(fixture, Buffer.from(JSON.stringify({ subject_hash: `sha256:${"a".repeat(64)}`, inspection: { status: "completed", paths: [] }, findings: [], evidence: ["x"] }), "utf8")));
	assert.equal(JSON.parse(result.submission).admission_decision, "completed");
});

test("submission refusal preserves its primary evidence when result staging cleanup also fails", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "refuse-cleanup-fail" });
	const scratchParent = mkdtempSync(join(tmpdir(), "gentle-pi-relay-primary-failure-"));
	const originalTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = scratchParent;
	try {
		const error = await rejectsWithRelayError(
			runReviewHostRelaySlot(relayRequest(fixture)),
			REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
			"submit",
		);
		assert.equal(error.exitCode, 1);
		assert.equal(error.timedOut, false);
		assert.equal(error.timeoutMs, 30_000);
		assert.ok(error.elapsedMs !== null && error.elapsedMs >= 0);
		assert.match(error.stderr, /capture binding does not match/);
		assert.doesNotMatch(error.message, /staging cleanup/i);
	} finally {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		chmodSync(scratchParent, 0o700);
		rmSync(scratchParent, { recursive: true, force: true });
	}
});

test("relay scratch and staging directories are removed after failures too", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "fail" });
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi");
	const piCalls = readLog(fixture.piLogPath);
	assert.equal(piCalls.length, 1);
	assert.equal(existsSync(piCalls[0]!.cwd!), false);
});

test("a result staging cleanup failure remains a typed submit failure", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "cleanup-fail" });
	const scratchParent = mkdtempSync(join(tmpdir(), "gentle-pi-relay-cleanup-"));
	const originalTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = scratchParent;
	try {
		const error = await rejectsWithRelayError(
			runReviewHostRelaySlot(relayRequest(fixture)),
			REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
			"submit",
		);
		assert.equal(error.mutationOutcome, "unknown");
		assert.match(error.message, /staging cleanup/i);
	} finally {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		chmodSync(scratchParent, 0o700);
		rmSync(scratchParent, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Capability detection — typed refusal classes, no version sniffing.
// ---------------------------------------------------------------------------

test("an old binary's unknown-flag refusal classifies as relay-unavailable with the exact report", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_MATERIALIZE_MODE: "unknown-flag" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE, "materialize");
	assert.equal(error.message, REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE);
	assert.match(error.stderr, /flag provided but not defined: -materialize/);
	assert.equal(readLog(fixture.piLogPath).length, 0);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("a handshake refusal surfaces the provider refusal verbatim", async (t) => {
	const refusal = "review capture-result --agent pi: the active runtime is not eligible for immutable receipt review; supported immutable review runtimes: claude-code, codex, opencode";
	const fixture = harness(t, { RELAY_FAKE_MATERIALIZE_MODE: "handshake", RELAY_FAKE_HANDSHAKE_STDERR: refusal });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.HANDSHAKE_REFUSED, "materialize");
	assert.equal(error.message, refusal);
	assert.equal(error.stderr, refusal);
	assert.equal(readLog(fixture.piLogPath).length, 0);
});

test("refusal classification distinguishes unknown-flag, handshake, and other", () => {
	assert.equal(classifyReviewHostRelayRefusal("flag provided but not defined: -materialize\nUsage:"), "unknown-flag");
	assert.equal(classifyReviewHostRelayRefusal("flag provided but not defined: -agent"), "unknown-flag");
	assert.equal(classifyReviewHostRelayRefusal("the active runtime is not eligible for immutable receipt review"), "handshake");
	assert.equal(classifyReviewHostRelayRefusal("declare GENTLE_PI_REVIEW_RELAY_CONTRACT=gentle-pi.review-relay/v1"), "handshake");
	assert.equal(classifyReviewHostRelayRefusal("some unrelated explosion"), "other");
});

// ---------------------------------------------------------------------------
// Slot detection — the provider decides; nothing is inferred.
// ---------------------------------------------------------------------------

function collectInput(overrides: Partial<{ captureOperation: string; arguments: ReviewCollectInputV3["arguments"]; submission: ReviewCaptureSubmissionV1 | undefined }> = {}): ReviewCollectInputV3 {
	const argumentsList: ReviewCollectInputV3["arguments"] = overrides.arguments ?? [
		{ name: "lineage", value: "review-1d5aadacc600e167", token: "--lineage=review-1d5aadacc600e167" },
		{ name: "expected-revision", value: `sha256:${"c".repeat(64)}`, token: `--expected-revision=sha256:${"c".repeat(64)}` },
		{ name: "target", value: `sha256:${"d".repeat(64)}`, token: `--target=sha256:${"d".repeat(64)}` },
		{ name: "repository-context", value: `rctx1_${"e".repeat(64)}`, token: `--repository-context=rctx1_${"e".repeat(64)}` },
		{ name: "lens", value: "review-reliability", token: "--lens=review-reliability" },
		{ name: "order", value: "0", token: "--order=0" },
		{ name: "subject-hash", value: `sha256:${"a".repeat(64)}`, token: `--subject-hash=sha256:${"a".repeat(64)}` },
		{ name: "agent", value: "pi", token: "--agent=pi" },
		{ name: "materialize", value: "true", token: "--materialize=true" },
	];
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: overrides.captureOperation ?? "review.capture-result",
		arguments: argumentsList,
		...("submission" in overrides ? (overrides.submission === undefined ? {} : { submission: overrides.submission }) : { submission: SUBMISSION }),
	};
}

test("only provider-issued pi --materialize capture-result inputs become relay slots", () => {
	const slots = reviewHostRelaySlots([collectInput()]);
	assert.equal(slots.length, 1);
	assert.deepEqual(slots[0]!.captureArgumentTokens, [...CAPTURE_TOKENS]);
	// The provider-owned completing form passes through verbatim.
	assert.deepEqual(slots[0]!.submission, SUBMISSION);
	assert.equal(slots[0]!.lens, "review-reliability");
	assert.equal(slots[0]!.order, "0");

	// A materialize slot whose provider omitted the submission still becomes
	// a slot (the provider decided the route); the relay then fails closed.
	const missingSubmission = reviewHostRelaySlots([collectInput({ submission: undefined })]);
	assert.equal(missingSubmission.length, 1);
	assert.equal(missingSubmission[0]!.submission, undefined);

	const withoutMaterialize = collectInput({ arguments: collectInput().arguments.filter((argument) => argument.name !== "materialize") });
	assert.deepEqual(reviewHostRelaySlots([withoutMaterialize]), []);

	const withoutAgent = collectInput({ arguments: collectInput().arguments.filter((argument) => argument.name !== "agent") });
	assert.deepEqual(reviewHostRelaySlots([withoutAgent]), []);

	const foreignAgent = collectInput({ arguments: collectInput().arguments.map((argument) => argument.name === "agent" ? { ...argument, value: "codex", token: "--agent=codex" } : argument) });
	assert.deepEqual(reviewHostRelaySlots([foreignAgent]), []);

	const evidence = collectInput({ captureOperation: "review.capture-evidence" });
	assert.deepEqual(reviewHostRelaySlots([evidence]), []);
});

test("relay input validation rejects empty or malformed inputs before any process launches", async () => {
	await assert.rejects(runReviewHostRelaySlot({ captureArgumentTokens: [], submission: SUBMISSION }), TypeError);
	await assert.rejects(runReviewHostRelaySlot({ captureArgumentTokens: [""], submission: SUBMISSION }), TypeError);
	await assert.rejects(runReviewHostRelaySlot({ captureArgumentTokens: CAPTURE_TOKENS, submission: SUBMISSION, gentleAiExecutable: "gentle-ai" }), TypeError);
});

// ---------------------------------------------------------------------------
// Provider-owned submission form — consumed verbatim, never synthesized.
// ---------------------------------------------------------------------------

test("a materialize slot without a provider submission fails closed before any process launches", async (t) => {
	const fixture = harness(t);
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(relayRequest(fixture, { submission: undefined })),
		REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH,
		"binding",
	);
	assert.equal(error.message, REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(readLog(fixture.logPath).length, 0, "no gentle-ai invocation was launched");
	assert.equal(readLog(fixture.piLogPath).length, 0, "no pi subprocess was launched");
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("a submission form the relay cannot bind is a typed contract mismatch, never a repaired invocation", async (t) => {
	const fixture = harness(t);
	const twoValues: ReviewCaptureSubmissionV1 = {
		...SUBMISSION,
		values: [...SUBMISSION.values, { slot: "extra", domain: "artifact_path_or_stdin", substitutionLocation: 0 }],
	};
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { submission: twoValues })), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding");
	const noSlot: ReviewCaptureSubmissionV1 = {
		...SUBMISSION,
		argumentTokens: [...BINDING_TOKENS, "--input=/etc/somewhere"],
	};
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { submission: noSlot })), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding");
	const outOfBounds: ReviewCaptureSubmissionV1 = {
		...SUBMISSION,
		values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: SUBMISSION.argumentTokens.length }],
	};
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { submission: outOfBounds })), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding");
	assert.equal(readLog(fixture.logPath).length, 0);
	assert.equal(readLog(fixture.piLogPath).length, 0);
});

test("resolveReviewHostRelaySubmission returns the provider binding untouched", () => {
	const binding = resolveReviewHostRelaySubmission(SUBMISSION);
	assert.equal(binding.operationToken, "capture-result");
	assert.deepEqual(binding.argumentTokens, SUBMISSION.argumentTokens);
	assert.equal(binding.substitutionLocation, BINDING_TOKENS.length);
	assert.throws(() => resolveReviewHostRelaySubmission(undefined), (error: unknown) =>
		error instanceof ReviewHostRelayError && error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH && error.message === REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE);
});

test("the negotiated decoder carries the provider submission through the capture-result collect input", () => {
	const lineageId = "review-1d5aadacc600e167";
	const sha = `sha256:${"c".repeat(64)}`;
	const tree = "3".repeat(40);
	const rawSubmission = {
		operation_token: "capture-result",
		argument_tokens: [...BINDING_TOKENS, "--input={{value}}"],
		values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitution_location: BINDING_TOKENS.length }],
	};
	const rawInput = {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		capture_operation: "review.capture-result",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "materialize", value: "true", token: "--materialize=true" },
		],
		artifact_subject: {
			schema: "gentle-ai.review-artifact-subject/v2",
			subject_hash: sha,
			lineage_id: lineageId,
			authority_revision: sha,
			target_identity: sha,
			base_tree: tree,
			candidate_tree: tree,
			changed_path_manifest_sha256: sha,
			lens: "review-reliability",
			selected_order: 0,
		},
		base_tree: tree,
		candidate_tree: tree,
		changed_path_manifest: [{ path: "app.ts", status: "M", old_mode: "100644", new_mode: "100644", deleted: false, type_changed: false, mode_only: false, intended_untracked: false }],
		submission: rawSubmission,
	};
	const decoded = decodeReviewNextTransitionV3({ kind: "collect", reason_code: "reviewer_results_required", collect: { inputs: [rawInput] } });
	assert.equal(decoded.collect!.inputs[0]!.submission!.operationToken, "capture-result");
	assert.deepEqual(decoded.collect!.inputs[0]!.submission!.argumentTokens, rawSubmission.argument_tokens);
	assert.deepEqual(decoded.collect!.inputs[0]!.submission!.values, [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: BINDING_TOKENS.length }]);

	// Strict rejections: submission outside capture-result, and a
	// substitution location outside its own argument tokens.
	assert.throws(() => decodeReviewNextTransitionV3({ kind: "collect", reason_code: "verification_evidence_required", collect: { inputs: [{
		name: "verification_evidence",
		schema: "gentle-ai.review-verification-evidence/v2",
		capture_operation: "review.capture-evidence",
		arguments: [{ name: "lineage", value: lineageId }],
		submission: rawSubmission,
	}] } }), /submission is only valid for review\.capture-result/);
	assert.throws(() => decodeReviewNextTransitionV3({ kind: "collect", reason_code: "reviewer_results_required", collect: { inputs: [{
		...rawInput,
		submission: { ...rawSubmission, values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitution_location: rawSubmission.argument_tokens.length }] },
	}] } }), /substitution_location/);
});
