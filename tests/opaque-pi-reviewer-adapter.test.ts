import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	OPAQUE_PI_REVIEWER_ARGV,
	OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE,
	OpaquePiReviewerTransportError,
	resolvePiLaunch,
	runOpaquePiReviewer,
} from "../lib/opaque-pi-reviewer-adapter.ts";

const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
	const stdin = Buffer.concat(chunks);
	if (process.env.OPAQUE_PI_STDIN_CAPTURE) fs.writeFileSync(process.env.OPAQUE_PI_STDIN_CAPTURE, stdin);
	const mode = process.env.OPAQUE_PI_MODE || "ok";
	const log = {
		argv,
		cwd: process.cwd(),
		entries_before: fs.readdirSync(process.cwd()),
		entries_after: fs.readdirSync(process.cwd()),
	};
	if (process.env.OPAQUE_PI_LOG) fs.appendFileSync(process.env.OPAQUE_PI_LOG, JSON.stringify(log) + "\\n");
	if (mode === "break-cleanup" || process.env.OPAQUE_PI_BREAK_CLEANUP === "true") {
		fs.chmodSync(path.dirname(process.cwd()), 0o500);
	}
	if (mode === "empty") process.exit(0);
	if (mode === "hang") { setTimeout(() => process.exit(0), 10_000); return; }
	if (mode === "nonzero") { process.stderr.write("opaque pi failed\\n"); process.exit(7); }
	process.stdout.write(Buffer.from(process.env.OPAQUE_PI_OUTPUT_B64 || "", "base64"));
});
`;

const PROMPT_BYTES = Buffer.concat([
	Buffer.from("opaque prompt\r\n\u0000", "utf8"),
	Buffer.from([0x01, 0xff, 0xfe, 0x00]),
]);
const OUTPUT_BYTES = Buffer.concat([
	Buffer.from("opaque output\r\n\u0000", "utf8"),
	Buffer.from([0x07, 0xff, 0xfe, 0x00]),
]);

interface OpaqueHarness {
	directory: string;
	pi: string;
	logPath: string;
	stdinCapturePath: string;
	environment: NodeJS.ProcessEnv;
}

interface OpaquePiLog {
	argv: string[];
	cwd: string;
	entries_before: string[];
	entries_after: string[];
}

function harness(t: test.TestContext, overrides: Record<string, string> = {}): OpaqueHarness {
	// The fake pi is a shebang node script; Windows cannot spawn script files
	// without a native executable, so these subprocess transport tests run on
	// POSIX only. (The production adapter spawns real binaries on Windows.)
	if (process.platform === "win32") return t.skip("windows: script-file subprocess fixtures need a native executable") as unknown as OpaqueHarness;
	const directory = mkdtempSync(join(tmpdir(), "gentle-pi-opaque-reviewer-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const pi = join(directory, "pi");
	writeFileSync(pi, FAKE_PI);
	chmodSync(pi, 0o755);
	const logPath = join(directory, "pi.log");
	const stdinCapturePath = join(directory, "stdin.bin");
	return {
		directory,
		pi,
		logPath,
		stdinCapturePath,
		environment: {
			...process.env,
			OPAQUE_PI_LOG: logPath,
			OPAQUE_PI_STDIN_CAPTURE: stdinCapturePath,
			OPAQUE_PI_OUTPUT_B64: OUTPUT_BYTES.toString("base64"),
			...overrides,
		},
	};
}

function readLog(path: string): OpaquePiLog[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as OpaquePiLog);
}

async function rejectsWithTransportError(
	promise: Promise<unknown>,
	kind: (typeof OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE)[keyof typeof OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE],
): Promise<OpaquePiReviewerTransportError> {
	let caught: OpaquePiReviewerTransportError | undefined;
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof OpaquePiReviewerTransportError, `expected OpaquePiReviewerTransportError, received ${String(error)}`);
		caught = error;
		return error.kind === kind;
	});
	return caught!;
}

test("the opaque adapter streams arbitrary prompt and stdout bytes verbatim through the fixed Pi subprocess", async (t) => {
	const fixture = harness(t);
	const result = await runOpaquePiReviewer(PROMPT_BYTES, {
		piExecutable: fixture.pi,
		environment: fixture.environment,
		timeoutMs: 10_000,
	});

	assert.equal(result.promptByteLength, PROMPT_BYTES.length);
	assert.equal(result.stdoutByteLength, OUTPUT_BYTES.length);
	assert.deepEqual(result.stdout, OUTPUT_BYTES);
	assert.deepEqual(readFileSync(fixture.stdinCapturePath), PROMPT_BYTES);

	const calls = readLog(fixture.logPath);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0]!.argv, [...OPAQUE_PI_REVIEWER_ARGV]);
	assert.deepEqual(calls[0]!.entries_before, []);
	assert.deepEqual(calls[0]!.entries_after, []);
	assert.notEqual(calls[0]!.cwd, process.cwd());
	assert.equal(existsSync(calls[0]!.cwd), false, "the empty scratch directory is removed after success");
});

test("the opaque adapter returns typed transport errors for launch, nonzero, empty, timeout, and cancellation", async (t) => {
	const fixture = harness(t);
	await rejectsWithTransportError(
		runOpaquePiReviewer(PROMPT_BYTES, { piExecutable: join(fixture.directory, "missing-pi"), environment: fixture.environment, timeoutMs: 10_000 }),
		OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.LAUNCH_FAILED,
	);

	const nonzero = await rejectsWithTransportError(
		runOpaquePiReviewer(PROMPT_BYTES, { piExecutable: fixture.pi, environment: { ...fixture.environment, OPAQUE_PI_MODE: "nonzero" }, timeoutMs: 10_000 }),
		OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.NONZERO_EXIT,
	);
	assert.equal(nonzero.exitCode, 7);
	assert.deepEqual(nonzero.stderr, Buffer.from("opaque pi failed\n"));

	await rejectsWithTransportError(
		runOpaquePiReviewer(PROMPT_BYTES, { piExecutable: fixture.pi, environment: { ...fixture.environment, OPAQUE_PI_MODE: "empty" }, timeoutMs: 10_000 }),
		OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.EMPTY_OUTPUT,
	);

	const timedOut = await rejectsWithTransportError(
		runOpaquePiReviewer(PROMPT_BYTES, { piExecutable: fixture.pi, environment: { ...fixture.environment, OPAQUE_PI_MODE: "hang" }, timeoutMs: 300 }),
		OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.TIMED_OUT,
	);
	assert.equal(timedOut.timedOut, true);

	const controller = new AbortController();
	const cancellation = runOpaquePiReviewer(PROMPT_BYTES, {
		piExecutable: fixture.pi,
		environment: { ...fixture.environment, OPAQUE_PI_MODE: "hang" },
		timeoutMs: 10_000,
		signal: controller.signal,
	});
	setTimeout(() => controller.abort(), 100).unref();
	const cancelled = await rejectsWithTransportError(cancellation, OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.CANCELLED);
	assert.equal(cancelled.cancelled, true);
});

test("the opaque adapter leaves no prompt or result file in scratch and reports cleanup failure as transport-only", async (t) => {
	const fixture = harness(t);
	const scratchParent = mkdtempSync(join(tmpdir(), "gentle-pi-opaque-reviewer-cleanup-"));
	const originalTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = scratchParent;
	try {
		const error = await rejectsWithTransportError(
			runOpaquePiReviewer(PROMPT_BYTES, {
				piExecutable: fixture.pi,
				environment: { ...fixture.environment, OPAQUE_PI_MODE: "break-cleanup" },
				timeoutMs: 10_000,
			}),
			OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.CLEANUP_FAILED,
		);
		assert.match(error.message, /scratch directory/i);
	} finally {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		chmodSync(scratchParent, 0o700);
		rmSync(scratchParent, { recursive: true, force: true });
	}
});

test("the opaque adapter preserves primary nonzero and timeout errors when scratch cleanup also fails", async (t) => {
	const fixture = harness(t);
	const scratchParent = mkdtempSync(join(tmpdir(), "gentle-pi-opaque-reviewer-primary-failure-"));
	const originalTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = scratchParent;
	try {
		const nonzero = await rejectsWithTransportError(
			runOpaquePiReviewer(PROMPT_BYTES, {
				piExecutable: fixture.pi,
				environment: { ...fixture.environment, OPAQUE_PI_MODE: "nonzero", OPAQUE_PI_BREAK_CLEANUP: "true" },
				timeoutMs: 10_000,
			}),
			OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.NONZERO_EXIT,
		);
		assert.equal(nonzero.exitCode, 7);
		assert.deepEqual(nonzero.stderr, Buffer.from("opaque pi failed\n"));
		chmodSync(scratchParent, 0o700);

		const timedOut = await rejectsWithTransportError(
			runOpaquePiReviewer(PROMPT_BYTES, {
				piExecutable: fixture.pi,
				environment: { ...fixture.environment, OPAQUE_PI_MODE: "hang", OPAQUE_PI_BREAK_CLEANUP: "true" },
				timeoutMs: 300,
			}),
			OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.TIMED_OUT,
		);
		assert.equal(timedOut.timedOut, true);
	} finally {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		chmodSync(scratchParent, 0o700);
		rmSync(scratchParent, { recursive: true, force: true });
	}
});

test("the opaque adapter has no review lifecycle imports or identifiers", () => {
	const adapterPath = fileURLToPath(new URL("../lib/opaque-pi-reviewer-adapter.ts", import.meta.url));
	const source = readFileSync(adapterPath, "utf8");
	assert.doesNotMatch(source, /review-integration|gentle-ai|materialize|submit/i);
	for (const identifier of ["lineage", "target", "revision", "receipt", "lens", "order", "subject", "schema", "capture", "submission", "status", "model", "provider", "profile"]) {
		assert.doesNotMatch(source, new RegExp(`\\b${identifier}\\b`, "i"), `adapter must not contain lifecycle identifier ${identifier}`);
	}
});

// #468 / #519: on Windows a bare `pi` resolves to pi.cmd, pi.ps1, or a POSIX
// shim, none of which Node can spawn with shell:false (EINVAL or ENOENT). The
// relay already runs inside Pi, so the host's own JavaScript entry is spawned
// through process.execPath instead. Other platforms keep today's exact shape.
test("the Pi launch shape spawns the host entry through process.execPath on win32 and stays byte-identical elsewhere", () => {
	const host = {
		execPath: "C:\\Program Files\\nodejs\\node.exe",
		entry: "C:\\Users\\dev\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js",
	};
	const windows = resolvePiLaunch(undefined, "win32", host);
	assert.deepEqual(windows, { file: host.execPath, arguments: [host.entry, ...OPAQUE_PI_REVIEWER_ARGV] });
	assert.notEqual(windows.file, "pi");
	assert.equal(windows.arguments.includes("pi"), false);
	for (const platform of ["linux", "darwin", "freebsd"] as const) {
		assert.deepEqual(resolvePiLaunch(undefined, platform, host), { file: "pi", arguments: [...OPAQUE_PI_REVIEWER_ARGV] }, platform);
		assert.deepEqual(resolvePiLaunch("/opt/pi/bin/pi", platform, host), { file: "/opt/pi/bin/pi", arguments: [...OPAQUE_PI_REVIEWER_ARGV] }, platform);
	}
	assert.deepEqual(resolvePiLaunch("C:\\tools\\pi.exe", "win32", host), { file: "C:\\tools\\pi.exe", arguments: [...OPAQUE_PI_REVIEWER_ARGV] });
	for (const entry of [undefined, "", "cli.js", "dist/bundle/cli.js"]) {
		assert.throws(() => resolvePiLaunch(undefined, "win32", { execPath: host.execPath, entry }), /host entry/, `entry ${JSON.stringify(entry)} must fail closed instead of spawning a bare pi`);
	}
});

test("the default Pi launch resolves from the running host process", () => {
	const launch = resolvePiLaunch(undefined);
	if (process.platform === "win32") {
		assert.deepEqual(launch, { file: process.execPath, arguments: [process.argv[1]!, ...OPAQUE_PI_REVIEWER_ARGV] });
	} else {
		assert.deepEqual(launch, { file: "pi", arguments: [...OPAQUE_PI_REVIEWER_ARGV] });
	}
});
