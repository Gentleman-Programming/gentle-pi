import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../../extensions/gentle-ai.ts";
import { resolveGentleAiBinary } from "../../lib/gentle-ai-binary.ts";
import { OPAQUE_PI_REVIEWER_ARGV } from "../../lib/opaque-pi-reviewer-adapter.ts";
import { NativeReviewCliV216, type ExecFileAdapter, type NativeReviewCli } from "../../lib/native-review-cli.ts";
import { reviewHostRelaySlots, runReviewHostRelaySlot } from "../../lib/review-host-relay.ts";
import { GENTLE_PI_REVIEW_RELAY_CONTRACT, GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV } from "../../lib/review-relay-contract.ts";
import { decodeReviewStatusV3 } from "../../lib/review-integration-v2.ts";
import { requireDevBinary } from "../support/native-binary-gate.ts";

const DEV_BINARY = process.env.GENTLE_AI_DEV_BINARY;
const RELAY_DEV_BINARY = process.env.GENTLE_PI_GENTLE_AI_DEV_BINARY;
const POSIX = process.platform !== "win32";
const primaryDevBinaryGate = requireDevBinary({
	devBinaryPath: DEV_BINARY,
	exists: typeof DEV_BINARY === "string" && DEV_BINARY.length > 0 && DEV_BINARY.startsWith("/") && existsSync(DEV_BINARY),
	env: process.env,
});
const relayDevBinaryGate = POSIX
	? requireDevBinary({
		devBinaryPath: RELAY_DEV_BINARY,
		exists: typeof RELAY_DEV_BINARY === "string" && RELAY_DEV_BINARY.length > 0 && RELAY_DEV_BINARY.startsWith("/") && existsSync(RELAY_DEV_BINARY),
		env: process.env,
	})
	: { run: false as const, reason: "Windows is explicitly skipped until a native fake-pi.exe exists; this test never enables a shell fallback." };
const RUNNABLE = POSIX && primaryDevBinaryGate.run && relayDevBinaryGate.run;
if (!POSIX) console.log(`tests/devbinary/pi-host-relay.devtest.ts: ${relayDevBinaryGate.reason}`);
if (!primaryDevBinaryGate.run) console.log(`tests/devbinary/pi-host-relay.devtest.ts: ${primaryDevBinaryGate.reason}`);
if (!relayDevBinaryGate.run && POSIX) console.log(`tests/devbinary/pi-host-relay.devtest.ts: ${relayDevBinaryGate.reason}`);

const ZERO_FINDING_PATHS = Object.freeze([".github/workflows/relay.yml"]);

interface RegisteredTool {
	execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, context: ExtensionContext) => Promise<{ details?: unknown }>;
}

function git(cwd: string, ...arguments_: string[]): string {
	return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

function makeTreeWritable(path: string): void {
	chmodSync(path, 0o700);
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const entryPath = join(path, entry.name);
		if (entry.isDirectory()) makeTreeWritable(entryPath);
		else chmodSync(entryPath, 0o600);
	}
}

function repository(t: test.TestContext, prefix: string): string {
	const cwd = mkdtempSync(join(tmpdir(), prefix));
	t.after(() => {
		makeTreeWritable(cwd);
		rmSync(cwd, { recursive: true, force: true });
	});
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.email", "relay-devtest@example.invalid");
	git(cwd, "config", "user.name", "Pi Host Relay Devtest");
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	git(cwd, "add", "app.ts");
	git(cwd, "commit", "-qm", "initial");
	return cwd;
}

function record(value: unknown, name: string): Record<string, unknown> {
	assert.equal(typeof value, "object", `${name} must be an object`);
	assert.notEqual(value, null, `${name} must not be null`);
	assert.equal(Array.isArray(value), false, `${name} must not be an array`);
	return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
	assert.equal(typeof value, "string", `${name} must be a string`);
	return value as string;
}

function reviewEnvironment(home: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		HOME: home,
		XDG_CONFIG_HOME: join(home, "config"),
		[GENTLE_PI_REVIEW_RELAY_CONTRACT_ENV]: GENTLE_PI_REVIEW_RELAY_CONTRACT,
	};
}

function candidateJson(binary: string, cwd: string, arguments_: readonly string[], environment: NodeJS.ProcessEnv): unknown {
	const stdout = execFileSync(binary, arguments_, { cwd, encoding: "utf8", env: environment });
	return JSON.parse(stdout) as unknown;
}

function candidateStatus(binary: string, sessionCwd: string, requestedCwd: string, environment: NodeJS.ProcessEnv, lineage?: string, selectors: readonly string[] = []) {
	return decodeReviewStatusV3(candidateJson(binary, sessionCwd, [
		"review", "status", "--cwd", requestedCwd,
		"--contract", "gentle-ai.review-integration/v2", "--agent", "pi", "--next-transition",
		...selectors,
		...(lineage === undefined ? [] : ["--lineage", lineage]),
	], environment));
}

function enableGlobalReview(binary: string, sessionCwd: string, cwd: string, environment: NodeJS.ProcessEnv): void {
	const enabled = record(candidateJson(binary, sessionCwd, [
		"review", "mode", "enable", "--scope", "global", "--cwd", cwd, "--json",
	], environment), "global mode enable");
	assert.equal(record(enabled.status, "global mode enable status").effective, "on");
	const status = record(candidateJson(binary, sessionCwd, [
		"review", "mode", "status", "--cwd", cwd, "--json",
	], environment), "global mode status");
	assert.equal(record(status.status, "global mode status result").effective, "on");
}

function runRenderedInvocation(binary: string, sessionCwd: string, command: string, environment: NodeJS.ProcessEnv): unknown {
	const words = command.split(" ");
	assert.ok(words.length >= 3, `rendered invocation is incomplete: ${command}`);
	assert.deepEqual(words.slice(0, 2), ["gentle-ai", "review"], `rendered invocation is not a native review command: ${command}`);
	assert.equal(words.some((word) => word.includes("'") || word.includes('"')), false, `devtest fixture command must remain unquoted: ${command}`);
	return candidateJson(binary, sessionCwd, words.slice(1), environment);
}

interface RegisteredReviewTools {
	controller: RegisteredTool;
	capture: RegisteredTool;
}

function reviewToolsForNative(nativeReviewCli: NativeReviewCli): RegisteredReviewTools {
	const tools = new Map<string, RegisteredTool>();
	createGentleAiExtension({ nativeReviewCli } as unknown as Parameters<typeof createGentleAiExtension>[0])({
		on() {},
		registerTool(definition: RegisteredTool & { name: string }) { tools.set(definition.name, definition); },
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const controller = tools.get("gentle_review");
	const capture = tools.get("gentle_review_capture");
	assert.ok(controller, "gentle_review controller must be registered");
	assert.ok(capture, "gentle_review_capture must be registered");
	return { controller: controller!, capture: capture! };
}

function controllerForNative(nativeReviewCli: NativeReviewCli): RegisteredTool {
	return reviewToolsForNative(nativeReviewCli).controller;
}

function parsedCollectBinding(binding: string): Record<string, unknown> {
	return record(JSON.parse(binding) as unknown, "public collectBinding");
}

function collectBindingsFor(details: unknown, captureOperation: string): readonly string[] {
	const bindings = record(details, "public STATUS details").collectBindings;
	assert.ok(Array.isArray(bindings), `public STATUS must publish collectBindings: ${JSON.stringify(details)}`);
	return bindings
		.map((value) => stringValue(record(value, "public collectBinding entry").collectBinding, "public collectBinding"))
		.filter((binding) => parsedCollectBinding(binding).captureOperation === captureOperation);
}

function collectBindingFor(details: unknown, captureOperation: string): string {
	const matches = collectBindingsFor(details, captureOperation);
	assert.equal(matches.length, 1, `public STATUS must publish exactly one ${captureOperation} binding`);
	return matches[0]!;
}

function collectBindingArgument(binding: string, name: string): string {
	const arguments_ = parsedCollectBinding(binding).arguments;
	assert.ok(Array.isArray(arguments_), "public collectBinding must carry arguments");
	const matches = arguments_
		.map((value) => record(value, "public collectBinding argument"))
		.filter((argument) => argument.name === name)
		.map((argument) => stringValue(argument.value, `public collectBinding ${name}`));
	assert.equal(matches.length, 1, `public collectBinding must carry exactly one ${name} argument`);
	return matches[0]!;
}

function collectBindingArgumentTokens(binding: string): readonly string[] {
	const arguments_ = parsedCollectBinding(binding).arguments;
	assert.ok(Array.isArray(arguments_), "public collectBinding must carry arguments");
	return arguments_.map((value) => {
		const argument = record(value, "public collectBinding argument");
		const token = argument.token;
		return typeof token === "string" ? token : `--${stringValue(argument.name, "public collectBinding argument name")}=${stringValue(argument.value, "public collectBinding argument value")}`;
	});
}

function publicStatusProjectionPaths(details: unknown): readonly string[] {
	const result = record(details, "public STATUS details").result;
	const projection = record(record(result, "public STATUS result").projection, "public STATUS projection");
	const paths = projection.paths;
	assert.ok(Array.isArray(paths), "public STATUS projection must carry paths");
	return paths.map((path) => stringValue(path, "public STATUS projection path"));
}

function crossRepositoryController(binary: string, sessionCwd: string, environment: NodeJS.ProcessEnv): RegisteredTool {
	const native = {
		targetStatus: async (request: { cwd: string; lineageId?: string }) => candidateStatus(binary, sessionCwd, request.cwd, environment, request.lineageId),
	} as unknown as NativeReviewCli;
	return controllerForNative(native);
}

interface NativeProcessCall {
	arguments: readonly string[];
	cwd: string;
	stdout?: string;
}

function processText(value: unknown): string {
	if (typeof value === "string") return value;
	return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function devNativeCli(binary: string, environment: NodeJS.ProcessEnv, calls: NativeProcessCall[]): NativeReviewCliV216 {
	const adapter: ExecFileAdapter = async (request) => {
		try {
			const stdout = execFileSync(request.file, request.arguments, {
				cwd: request.cwd,
				encoding: "utf8",
				env: environment,
				timeout: request.timeoutMs,
				maxBuffer: request.maxBufferBytes,
			});
			calls.push({ arguments: [...request.arguments], cwd: request.cwd, stdout });
			return {
				stdout,
				stderr: "",
				exitCode: 0,
				signal: null,
				timedOut: false,
				outputLimitExceeded: false,
			};
		} catch (error) {
			calls.push({ arguments: [...request.arguments], cwd: request.cwd });
			const failure = error as NodeJS.ErrnoException & {
				stdout?: string | Buffer;
				stderr?: string | Buffer;
				status?: number;
				signal?: NodeJS.Signals | null;
				killed?: boolean;
			};
			return {
				stdout: processText(failure.stdout),
				stderr: processText(failure.stderr),
				exitCode: typeof failure.status === "number" ? failure.status : 1,
				signal: failure.signal ?? null,
				timedOut: failure.killed === true,
				outputLimitExceeded: failure.code === "ENOBUFS" || failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
			};
		}
	};
	return new NativeReviewCliV216(adapter, binary);
}

function sessionContext(cwd: string): ExtensionContext {
	return { cwd, hasUI: false, ui: { notify() {} } } as unknown as ExtensionContext;
}

function grantedConsentInvocation(value: unknown): string {
	const consent = record(value, "consent response");
	const choices = consent.choices;
	assert.ok(Array.isArray(choices), "consent response must carry choices");
	const granted = choices.map((choice) => record(choice, "consent choice")).find((choice) => choice.answer === "granted");
	assert.ok(granted, "consent response must carry the granted choice");
	return stringValue(granted!.invocation, "granted consent invocation");
}

const FAKE_POSIX_PI = `#!/usr/bin/env node
import fs from "node:fs";
const expectedArgv = JSON.parse(process.env.OPAQUE_PI_REVIEWER_ARGV);
const expectedPaths = JSON.parse(process.env.OPAQUE_PI_REVIEWER_PATHS);
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const prompt = Buffer.concat(chunks);
  const promptText = prompt.toString("utf8");
  const targetedValidatorResult = process.env.OPAQUE_PI_TARGETED_VALIDATOR_RESULT;
  let subjectHash;
  if (targetedValidatorResult === undefined) {
    const newline = prompt.indexOf(0x0a);
    if (newline < 0) throw new Error("missing binding line");
    const firstLine = prompt.subarray(0, newline).toString("utf8");
    const prefix = "GENTLE_AI_REVIEW_BINDING ";
    if (!firstLine.startsWith(prefix)) throw new Error("missing binding prefix");
    const binding = JSON.parse(firstLine.slice(prefix.length));
    if (typeof binding.subject_hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(binding.subject_hash)) throw new Error("invalid binding subject_hash");
    if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expectedArgv)) throw new Error("unexpected opaque Pi argv");
    subjectHash = binding.subject_hash;
  } else if (promptText.length === 0) {
    throw new Error("missing targeted-validator prompt");
  }
  const prior = fs.existsSync(process.env.OPAQUE_PI_REVIEWER_LOG) ? JSON.parse(fs.readFileSync(process.env.OPAQUE_PI_REVIEWER_LOG, "utf8")) : { calls: [] };
  const calls = Array.isArray(prior.calls) ? prior.calls : [];
  calls.push({
    argv: process.argv.slice(2), cwd: process.cwd(), entries: fs.readdirSync(process.cwd()), ...(subjectHash === undefined ? {} : { subject_hash: subjectHash }), prompt: promptText,
    role: targetedValidatorResult === undefined ? "reviewer" : "targeted-validator",
  });
  fs.writeFileSync(process.env.OPAQUE_PI_REVIEWER_LOG, JSON.stringify({ calls }));
  if (targetedValidatorResult !== undefined) {
    process.stdout.write(targetedValidatorResult);
    return;
  }
  process.stdout.write(JSON.stringify({
    subject_hash: subjectHash,
    inspection: { status: "completed", paths: expectedPaths },
    findings: process.env.OPAQUE_PI_REVIEWER_FINDINGS === undefined ? [] : JSON.parse(process.env.OPAQUE_PI_REVIEWER_FINDINGS),
    evidence: ["inspected every frozen candidate path"],
  }));
});
`;

// This A -> B journey deliberately stops immediately after one Go-admitted
// reviewer capture. It proves real Pi relay transport and root continuity, but
// does not manufacture the remaining reviewer, refuter, validator, or approval
// transitions.
test("dev-binary: POSIX Pi host relay captures one real B-target slot from an A-session without reoffering it", { skip: !RUNNABLE }, async (t) => {
	const sessionA = repository(t, "gentle-pi-relay-session-a-");
	const targetB = repository(t, "gentle-pi-relay-target-b-");
	const nestedTarget = join(targetB, "nested");
	mkdirSync(nestedTarget);
	const workflowDirectory = join(targetB, ".github", "workflows");
	mkdirSync(workflowDirectory, { recursive: true });
	const workflow = join(workflowDirectory, "relay.yml");
	writeFileSync(workflow, "name: relay\non: push\n");
	git(targetB, "add", ".github/workflows/relay.yml");
	git(targetB, "commit", "-qm", "workflow baseline");
	writeFileSync(workflow, "name: relay\non: push\njobs:\n  relay:\n    runs-on: ubuntu-latest\n");
	writeFileSync(join(targetB, "selected.txt"), "selected relay input\n");
	writeFileSync(join(targetB, "excluded.txt"), "excluded relay input\n");

	const canonicalB = realpathSync(targetB);
	assert.equal(realpathSync(git(nestedTarget, "rev-parse", "--show-toplevel")), canonicalB, "B/nested must canonicalize to B before native lifecycle routing");
	const isolatedHome = join(sessionA, "home");
	mkdirSync(isolatedHome);
	const environment = reviewEnvironment(isolatedHome);
	assert.ok(DEV_BINARY, "GENTLE_AI_DEV_BINARY is required for this devtest");
	assert.ok(RELAY_DEV_BINARY, "GENTLE_PI_GENTLE_AI_DEV_BINARY is required for this devtest");
	assert.equal(realpathSync(RELAY_DEV_BINARY!), realpathSync(DEV_BINARY!), "the devtest and production override must name the same candidate");
	assert.equal(realpathSync(resolveGentleAiBinary()), realpathSync(RELAY_DEV_BINARY!), "production binary resolution must select the candidate realpath");
	enableGlobalReview(RELAY_DEV_BINARY!, sessionA, canonicalB, environment);
	const inspected = await crossRepositoryController(RELAY_DEV_BINARY!, sessionA, environment).execute(
		"inspect-target-b-from-session-a",
		{ operation: "inspect", workspaceRoot: nestedTarget },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	assert.equal(record(inspected.details, "cross-repository controller result").workspace_root, canonicalB, "the controller must canonicalize B/nested to B while A remains the session cwd");

	const initial = candidateStatus(RELAY_DEV_BINARY!, sessionA, canonicalB, environment);
	assert.equal(initial.nextTransition?.kind, "collect", "selectorless Pi STATUS must require an intended-untracked declaration for B");
	assert.equal(initial.nextTransition?.reasonCode, "intended_untracked_selection_required");
	const selection = initial.nextTransition?.collect?.inputs.find((input) => input.name === "intended_untracked_selection");
	assert.ok(selection, "selectorless Pi STATUS must publish the untracked selection input");
	const inventory = selection!.arguments.find((argument) => argument.name === "expected_untracked_inventory")?.value;
	const eligible = selection!.arguments.find((argument) => argument.name === "eligible_paths_json")?.value;
	assert.equal(typeof inventory, "string");
	assert.ok(typeof eligible === "string" && JSON.parse(eligible).includes("selected.txt") && JSON.parse(eligible).includes("excluded.txt"), "native inventory must name both B untracked controls");
	const selectedStatus = candidateStatus(RELAY_DEV_BINARY!, sessionA, canonicalB, environment, undefined, ["--untracked-scope=select", `--expected-untracked-inventory=${inventory}`, "--intended-untracked=selected.txt"]);
	assert.equal(selectedStatus.nextTransition?.kind, "execute", "selected Pi STATUS must offer native START for B");
	const execute = selectedStatus.nextTransition?.execute;
	assert.ok(execute, "selected Pi STATUS must render a START execution");
	assert.equal(execute!.operation, "review.start");
	assert.equal(execute!.command.startsWith("gentle-ai review start "), true);
	assert.deepEqual(execute!.command.split(" ").slice(3), execute!.arguments.map((argument) => argument.token));
	assert.ok(execute!.arguments.some((argument) => argument.token === `--cwd=${canonicalB}`), "rendered START must canonically target B, not A or B/nested");
	assert.ok(execute!.arguments.some((argument) => argument.token === "--intended-untracked=selected.txt"), "rendered START must retain B's selected untracked path");
	assert.equal(execute!.arguments.some((argument) => argument.token === "--intended-untracked=excluded.txt"), false, "rendered START must exclude B's unselected control");

	const consent = runRenderedInvocation(RELAY_DEV_BINARY!, sessionA, execute!.command, environment);
	const started = runRenderedInvocation(RELAY_DEV_BINARY!, sessionA, grantedConsentInvocation(consent), environment);
	const startedRecord = record(started, "granted START response");
	assert.equal(startedRecord.action, "created");
	const lineage = stringValue(startedRecord.lineage_id, "granted START lineage_id");

	const collecting = candidateStatus(RELAY_DEV_BINARY!, sessionA, canonicalB, environment, lineage);
	const slots = reviewHostRelaySlots(collecting.nextTransition?.collect?.inputs ?? []);
	assert.ok(slots.length > 0, `real Pi-bound STATUS must offer at least one materialize relay slot: ${JSON.stringify(collecting.raw)}`);
	const slot = slots[0]!;
	const slotInput = collecting.nextTransition?.collect?.inputs.find((input) => input.artifactSubject?.subjectHash === slot.subjectHash);
	const expectedPaths = slotInput?.changedPathManifest?.map((entry) => entry.path) ?? ZERO_FINDING_PATHS;
	assert.ok(expectedPaths.includes("selected.txt"), "the selected untracked file must reach the immutable reviewer manifest");
	assert.equal(expectedPaths.includes("excluded.txt"), false, "the unselected B control must stay out of the reviewer manifest");
	assert.ok(slot.submission, "the real Pi slot must include Go's provider-owned submission form");
	assert.ok(slot.subjectHash, "the real Pi slot must include its artifact subject hash");

	const fakePi = join(sessionA, "fake-pi");
	const fakePiLog = join(sessionA, "fake-pi-log.json");
	writeFileSync(fakePi, FAKE_POSIX_PI);
	chmodSync(fakePi, 0o755);
	const relay = await runReviewHostRelaySlot({
		captureArgumentTokens: slot.captureArgumentTokens,
		submission: slot.submission,
		targetCwd: canonicalB,
		piExecutable: fakePi,
		environment: {
			...environment,
			OPAQUE_PI_REVIEWER_ARGV: JSON.stringify(OPAQUE_PI_REVIEWER_ARGV),
			OPAQUE_PI_REVIEWER_LOG: fakePiLog,
			OPAQUE_PI_REVIEWER_PATHS: JSON.stringify(expectedPaths),
		},
		gentleAiTimeoutMs: 30_000,
		piTimeoutMs: 30_000,
	});
	assert.ok(relay.promptByteLength > 0);
	assert.ok(relay.resultByteLength > 0);
	assert.equal(record(JSON.parse(relay.submission) as unknown, "capture submission").admission_decision, "completed");

	const fakePiLogRecord = record(JSON.parse(readFileSync(fakePiLog, "utf8")) as unknown, "fake Pi log");
	assert.ok(Array.isArray(fakePiLogRecord.calls), "fake Pi log must record its subprocess calls");
	assert.equal(fakePiLogRecord.calls.length, 1);
	const fakePiResult = record(fakePiLogRecord.calls[0], "fake Pi result");
	assert.deepEqual(fakePiResult.argv, OPAQUE_PI_REVIEWER_ARGV);
	assert.deepEqual(fakePiResult.entries, []);
	assert.equal(fakePiResult.subject_hash, slot.subjectHash);
	const scratchCwd = stringValue(fakePiResult.cwd, "fake Pi scratch cwd");
	assert.notEqual(scratchCwd, canonicalB);
	assert.notEqual(scratchCwd, sessionA);
	assert.equal(existsSync(scratchCwd), false, "opaque Pi scratch cwd must be removed after the subprocess exits");

	const advanced = candidateStatus(RELAY_DEV_BINARY!, sessionA, canonicalB, environment, lineage);
	const reoffered = reviewHostRelaySlots(advanced.nextTransition?.collect?.inputs ?? []).some((candidate) =>
		candidate.subjectHash === slot.subjectHash
			&& JSON.stringify(candidate.captureArgumentTokens) === JSON.stringify(slot.captureArgumentTokens),
	);
	assert.equal(reoffered, false, "the captured Pi slot must advance and never be reoffered");
	assert.equal(advanced.authority?.state, "reviewing", "this devtest must not finalize, approve, or burn the review");
	assert.equal("receipt" in advanced, false, "last-event STATUS no longer exposes receipt state");
	t.diagnostic(`captured Pi slot: lineage=${lineage}; subject_hash=${slot.subjectHash}; admission=completed; reoffered=false; authority=${advanced.authority?.state}`);

	const sessionStatus = candidateStatus(RELAY_DEV_BINARY!, sessionA, sessionA, environment);
	assert.equal(sessionStatus.authority, undefined, "A must remain without B's review authority");
	assert.notEqual(sessionStatus.targetIdentity, advanced.targetIdentity, "A must remain unrelated to B's candidate binding");
});

// This completes the same organic A -> B path through correction evidence,
// Go-owned targeted validation, and terminal approval. The only reviewer is the
// fixed fake Pi executable below; no model, provider, or profile is selected.
test("dev-binary: Pi controller keeps an explicit B root and selected-untracked binding through Go-owned validation approval", { skip: !RUNNABLE }, async (t) => {
	const sessionA = repository(t, "gentle-pi-combined-session-a-");
	const targetB = repository(t, "gentle-pi-combined-target-b-");
	const nestedTarget = join(targetB, "nested", "target");
	mkdirSync(nestedTarget, { recursive: true });
	const workflowDirectory = join(targetB, ".github", "workflows");
	mkdirSync(workflowDirectory, { recursive: true });
	const workflow = join(workflowDirectory, "relay.yml");
	writeFileSync(workflow, "name: relay\non: push\n");
	git(targetB, "add", ".github/workflows/relay.yml");
	git(targetB, "commit", "-qm", "workflow baseline");
	writeFileSync(workflow, "name: relay\non: push\njobs:\n  relay:\n    runs-on: ubuntu-latest\n");
	writeFileSync(join(targetB, "selected.txt"), "selected relay input\n");
	writeFileSync(join(targetB, "excluded.txt"), "excluded relay input\n");

	const canonicalB = realpathSync(targetB);
	assert.equal(realpathSync(git(nestedTarget, "rev-parse", "--show-toplevel")), canonicalB, "B/nested must canonicalize to B before controller routing");
	// --git-common-dir answers relative to the repository it was asked about, so
	// resolving it against the process cwd compared the active project with
	// itself: the assertion held in a linked worktree and failed in a primary
	// checkout, and in neither case measured what it names. lib/review-candidate-view.ts
	// resolves it against the repository root, which is the convention here too.
	const activeProjectCommonDir = realpathSync(resolve(process.cwd(), git(process.cwd(), "rev-parse", "--git-common-dir")));
	const sandboxCommonDir = realpathSync(resolve(canonicalB, git(canonicalB, "rev-parse", "--git-common-dir")));
	assert.notEqual(sandboxCommonDir, activeProjectCommonDir, "the B sandbox must not share the active project's Git common directory");
	const isolatedHome = join(sessionA, "home");
	mkdirSync(isolatedHome);
	const environment = reviewEnvironment(isolatedHome);
	assert.ok(RELAY_DEV_BINARY, "GENTLE_PI_GENTLE_AI_DEV_BINARY is required for this devtest");
	const isolatedModeBefore = record(candidateJson(RELAY_DEV_BINARY!, sessionA, ["review", "mode", "status", "--cwd", canonicalB, "--json"], environment), "isolated mode before setup");
	assert.equal(record(isolatedModeBefore.status, "isolated mode before setup status").effective, "off", "the sandbox must start with its own RDD mode disabled");
	enableGlobalReview(RELAY_DEV_BINARY!, sessionA, canonicalB, environment);
	const isolatedModeAfterSetup = candidateJson(RELAY_DEV_BINARY!, sessionA, ["review", "mode", "status", "--cwd", canonicalB, "--json"], environment);

	const initial = candidateStatus(RELAY_DEV_BINARY!, sessionA, canonicalB, environment);
	const selectionInput = initial.nextTransition?.collect?.inputs.find((input) => input.name === "intended_untracked_selection");
	assert.ok(selectionInput, "B STATUS must publish its explicit intended-untracked selection input");
	const inventory = selectionInput!.arguments.find((argument) => argument.name === "expected_untracked_inventory")?.value;
	assert.equal(typeof inventory, "string");
	const selection = {
		untrackedScope: "select" as const,
		expectedUntrackedInventory: inventory!,
		intendedUntracked: ["selected.txt"],
	};
	const selectionTokens = [
		"--untracked-scope=select",
		`--expected-untracked-inventory=${selection.expectedUntrackedInventory}`,
		"--intended-untracked=selected.txt",
	];

	const nativeCalls: NativeProcessCall[] = [];
	const native = devNativeCli(RELAY_DEV_BINARY!, environment, nativeCalls);
	const { controller, capture } = reviewToolsForNative(native);
	const inspected = await controller.execute(
		"combined-inspect-target-b",
		{ operation: "inspect", workspaceRoot: nestedTarget },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	assert.equal(record(inspected.details, "combined inspect").workspace_root, canonicalB, "the A-session controller must expose B's canonical root");

	const selectionBoundCallOffset = nativeCalls.length;
	const startedPrompt = await controller.execute(
		"combined-start-target-b",
		{ operation: "start", workspaceRoot: nestedTarget, input: JSON.stringify({ mode: "ordinary", ...selection }) },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	const prompted = record(startedPrompt.details, "combined start consent");
	assert.equal(prompted.outcome, "native-review-consent-required");
	const consentBinding = stringValue(prompted.consent_binding, "combined consent binding");
	const started = await controller.execute(
		"combined-answer-consent",
		{ operation: "answer-consent", workspaceRoot: nestedTarget, input: JSON.stringify({ consentBinding, answer: "granted" }) },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	const startedDetails = record(started.details, "combined granted start");
	assert.equal(startedDetails.workspace_root, canonicalB);
	const lineage = stringValue(record(startedDetails.result, "combined start result").lineage_id, "combined lineage");

	const fakePiDirectory = join(sessionA, "fake-pi-bin");
	mkdirSync(fakePiDirectory);
	const fakePi = join(fakePiDirectory, "pi");
	const fakePiLog = join(sessionA, "fake-pi-log.json");
	writeFileSync(fakePi, FAKE_POSIX_PI);
	chmodSync(fakePi, 0o755);
	environment.PATH = [fakePiDirectory, process.env.PATH].filter((entry): entry is string => entry !== undefined && entry.length > 0).join(delimiter);
	environment.OPAQUE_PI_REVIEWER_ARGV = JSON.stringify(OPAQUE_PI_REVIEWER_ARGV);
	environment.OPAQUE_PI_REVIEWER_LOG = fakePiLog;
	environment.OPAQUE_PI_REVIEWER_PATHS = JSON.stringify([".github/workflows/relay.yml", "selected.txt"]);
	const reviewerFindings = [{
		location: "selected.txt:1",
		severity: "BLOCKER",
		claim: "the selected relay input must be corrected before delivery",
		proof_refs: ["selected.txt:1"],
		evidence_class: "deterministic",
		causal_disposition: "introduced",
	}];
	const relayTargetRoots: string[] = [];
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	__testing.setReviewHostRelayRunnerForTesting(async (request) => {
		assert.equal(request.targetCwd, canonicalB, "the host relay must materialize and submit against B");
		relayTargetRoots.push(request.targetCwd!);
		return await runReviewHostRelaySlot({
			...request,
			gentleAiExecutable: RELAY_DEV_BINARY!,
			piExecutable: fakePi,
			environment: {
				...environment,
				OPAQUE_PI_REVIEWER_ARGV: JSON.stringify(OPAQUE_PI_REVIEWER_ARGV),
				OPAQUE_PI_REVIEWER_LOG: fakePiLog,
				OPAQUE_PI_REVIEWER_PATHS: JSON.stringify([".github/workflows/relay.yml", "selected.txt"]),
				OPAQUE_PI_REVIEWER_FINDINGS: JSON.stringify(reviewerFindings),
			},
			gentleAiTimeoutMs: 30_000,
			piTimeoutMs: 30_000,
		});
	});

	const reviewerSubjects = new Set<string>();
	let reviewerCaptureCount = 0;
	let correctionOpened = false;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const reviewerStatus = await controller.execute(
			`combined-reviewer-status-${attempt}`,
			{ operation: "status", lineageId: lineage, workspaceRoot: nestedTarget, input: JSON.stringify(selection) },
			undefined,
			undefined,
			sessionContext(sessionA),
		);
		const reviewerStatusDetails = record(reviewerStatus.details, "combined reviewer STATUS");
		const reviewerBindings = collectBindingsFor(reviewerStatusDetails, "review.capture-result");
		assert.ok(reviewerBindings.length > 0, "current public STATUS must publish a reviewer capture binding before correction opens");
		const reviewerBinding = reviewerBindings[0]!;
		assert.equal(reviewerSubjects.has(reviewerBinding), false, "each reviewer capture must use a fresh public STATUS binding");
		reviewerSubjects.add(reviewerBinding);
		const reviewerInput = parsedCollectBinding(reviewerBinding);
		const reviewerPaths = reviewerInput.changedPathManifest;
		assert.ok(Array.isArray(reviewerPaths), "the reviewer binding must carry its frozen changed-path manifest");
		const manifestPaths = reviewerPaths.map((entry) => stringValue(record(entry, "reviewer manifest entry").path, "reviewer manifest path"));
		assert.ok(manifestPaths.includes("selected.txt"), "the selected untracked file must remain in every reviewer binding");
		assert.equal(manifestPaths.includes("excluded.txt"), false, "the excluded untracked file must remain outside every reviewer binding");
		assert.ok(publicStatusProjectionPaths(reviewerStatusDetails).includes("selected.txt"), "public STATUS must retain the selected path in B's projection");
		assert.equal(publicStatusProjectionPaths(reviewerStatusDetails).includes("excluded.txt"), false, "public STATUS must retain the excluded path outside B's projection");

		const fakeCallsBeforeForecast = existsSync(fakePiLog)
			? record(JSON.parse(readFileSync(fakePiLog, "utf8")) as unknown, "reviewer fake Pi forecast log").calls
			: [];
		assert.ok(Array.isArray(fakeCallsBeforeForecast), "reviewer fake Pi forecast log must carry calls when present");
		const reviewerForecast = await capture.execute(
			`combined-reviewer-forecast-${attempt}`,
			{ lineageId: lineage, workspaceRoot: nestedTarget, collectBinding: reviewerBinding },
			undefined,
			undefined,
			sessionContext(sessionA),
		);
		const reviewerForecastDetails = record(reviewerForecast.details, "combined reviewer forecast");
		assert.equal(reviewerForecastDetails.status, "blocked");
		assert.equal(reviewerForecastDetails.outcome, "reviewer-model-run-forecast");
		const fakeCallsAfterForecast = existsSync(fakePiLog)
			? record(JSON.parse(readFileSync(fakePiLog, "utf8")) as unknown, "reviewer fake Pi forecast result").calls
			: [];
		assert.ok(Array.isArray(fakeCallsAfterForecast), "reviewer fake Pi forecast result must carry calls when present");
		assert.equal(fakeCallsAfterForecast.length, fakeCallsBeforeForecast.length, "forecast acknowledgement must not launch a reviewer capture");

		const reviewerCapture = await capture.execute(
			`combined-reviewer-capture-${attempt}`,
			{ lineageId: lineage, workspaceRoot: nestedTarget, collectBinding: reviewerBinding, reviewerRunAcknowledged: true },
			undefined,
			undefined,
			sessionContext(sessionA),
		);
		const reviewerCaptureDetails = record(reviewerCapture.details, "combined reviewer capture");
		assert.ok(["captured", "closed"].includes(stringValue(reviewerCaptureDetails.status, "combined reviewer capture status")), "one acknowledged binding must perform exactly one native reviewer capture");
		const fakeCallsAfterCapture = record(JSON.parse(readFileSync(fakePiLog, "utf8")) as unknown, "reviewer fake Pi capture result").calls;
		assert.ok(Array.isArray(fakeCallsAfterCapture), "reviewer fake Pi capture result must carry calls");
		assert.equal(fakeCallsAfterCapture.length, fakeCallsBeforeForecast.length + 1, "one acknowledged binding must launch exactly one reviewer capture");
		reviewerCaptureCount += 1;
		const closure = reviewerCaptureDetails.closure;
		if (closure !== undefined) {
			const reviewerClosure = record(closure, "reviewer last-event closure");
			assert.equal(reviewerClosure.schema, "gentle-ai.review-last-event-closure/v1");
			assert.equal(reviewerClosure.operation, "review/capture-result");
			assert.equal(reviewerClosure.state, "correction_required", "the deterministic reviewer finding must open correction_required");
			const statusContinuation = record(reviewerClosure.status_continuation, "reviewer status continuation");
			assert.equal(statusContinuation.operation, "review.status", "correction-required closure must carry its provider-owned STATUS re-entry");
			assert.ok(Array.isArray(statusContinuation.arguments), "reviewer status continuation must carry ordered arguments");
			const statusContinuationTokens = statusContinuation.arguments.map((entry) => stringValue(record(entry, "reviewer status continuation argument").token, "reviewer status continuation token"));
			assert.match(statusContinuationTokens[0]!, /^--cwd=/);
			assert.deepEqual(statusContinuationTokens.slice(1), [
				"--contract=gentle-ai.review-integration/v2",
				"--next-transition=true",
				`--lineage=${lineage}`,
				"--agent=pi",
			]);
			correctionOpened = true;
			break;
		}
	}
	assert.equal(correctionOpened, true, "the provider must close the final reviewer capture as correction_required");
	assert.ok(reviewerCaptureCount > 0);
	assert.ok(relayTargetRoots.length === reviewerCaptureCount);
	assert.ok(relayTargetRoots.every((root) => root === canonicalB), "every reviewer relay leg must stay bound to B");
	const combinedFakePiLog = record(JSON.parse(readFileSync(fakePiLog, "utf8")) as unknown, "combined fake Pi log");
	assert.ok(Array.isArray(combinedFakePiLog.calls), "combined fake Pi log must record reviewer subprocess calls");
	const reviewerCalls = combinedFakePiLog.calls.map((call) => record(call, "combined fake Pi reviewer call")).filter((call) => call.role === "reviewer");
	assert.equal(reviewerCalls.length, reviewerCaptureCount);
	for (const call of reviewerCalls) {
		assert.equal(call.subject_hash === undefined, false, "the fake reviewer must receive one provider-bound subject");
		assert.deepEqual(call.argv, OPAQUE_PI_REVIEWER_ARGV);
		assert.deepEqual(call.entries, [], "the reviewer must run from an empty isolated sandbox");
		assert.notEqual(call.cwd, canonicalB, "the reviewer subprocess must not run in B");
		assert.notEqual(call.cwd, sessionA, "the reviewer subprocess must not run in A");
		assert.equal(existsSync(stringValue(call.cwd, "reviewer fake Pi scratch cwd")), false, "the reviewer sandbox must be removed after the subprocess exits");
	}

	const correctionStatus = await controller.execute(
		"combined-correction-plan-status",
		{ operation: "status", lineageId: lineage, workspaceRoot: nestedTarget, input: JSON.stringify(selection) },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	const correctionBinding = collectBindingFor(correctionStatus.details, "review.capture-correction-plan");
	const correctionInput = parsedCollectBinding(correctionBinding);
	assert.equal(correctionInput.captureOperation, "review.capture-correction-plan");
	assert.ok(publicStatusProjectionPaths(correctionStatus.details).includes("selected.txt"), "the correction plan STATUS must remain bound to selected.txt");
	assert.equal(publicStatusProjectionPaths(correctionStatus.details).includes("excluded.txt"), false, "the correction plan STATUS must remain outside excluded.txt");
	const correctionPlan = await capture.execute(
		"combined-correction-plan",
		{ lineageId: lineage, workspaceRoot: nestedTarget, collectBinding: correctionBinding, correctionLines: 1 },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	const correctionPlanClosure = record(record(correctionPlan.details, "combined correction plan").closure, "correction plan closure");
	assert.equal(correctionPlanClosure.schema, "gentle-ai.review-last-event-closure/v1");
	assert.equal(correctionPlanClosure.operation, "review.capture-correction-plan");
	assert.equal(correctionPlanClosure.state, "correction_required");
	assert.equal(correctionPlanClosure.correction_lines, 1);
	writeFileSync(join(targetB, "selected.txt"), "selected relay input corrected\n");

	const validationStatus = await controller.execute(
		"combined-targeted-validator-status",
		{ operation: "status", lineageId: lineage, workspaceRoot: nestedTarget, input: JSON.stringify(selection) },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	if (!("collectBindings" in record(validationStatus.details, "combined targeted-validator STATUS"))) {
		t.diagnostic(`targeted-validator raw STATUS: ${nativeCalls.at(-1)?.stdout ?? "unavailable"}`);
	}
	const validatorBinding = collectBindingFor(validationStatus.details, "review.capture-validation");
	const validatorInput = parsedCollectBinding(validatorBinding);
	assert.equal(validatorInput.captureOperation, "review.capture-validation");
	assert.equal(validatorInput.submission, undefined, "the Go-owned targeted-validator vector must not accept a caller-authored submission");
	const validationRequest = record(validatorInput.validationRequest, "targeted-validator validation request");
	const validatorArgumentTokens = collectBindingArgumentTokens(validatorBinding);
	const validatorRequestHash = collectBindingArgument(validatorBinding, "request-hash");
	const validatorTargetIdentity = collectBindingArgument(validatorBinding, "target");
	assert.equal(validationRequest.schema, "gentle-ai.review-targeted-validation-request/v1");
	assert.equal(validationRequest.requestHash, validatorRequestHash, "the public targeted-validator request must retain Go's exact request hash");
	assert.equal(validationRequest.correctionTargetIdentity, validatorTargetIdentity, "the public targeted-validator request must retain Go's correction target");
	assert.deepEqual(validationRequest.correctionPaths, ["selected.txt"], "the public targeted-validator request must retain Go's correction paths");
	assert.equal(typeof validationRequest.policyContent, "string");
	assert.ok(stringValue(validationRequest.policyContent, "targeted-validator policy content").length > 0, "the public targeted-validator request must retain Go's policy content");
	assert.ok(Array.isArray(validationRequest.fixFindings) && validationRequest.fixFindings.length > 0, "the public targeted-validator request must retain Go's findings");
	assert.ok(Array.isArray(validationRequest.fixClassifications) && validationRequest.fixClassifications.length > 0, "the public targeted-validator request must retain Go's classifications");
	assert.ok(validatorArgumentTokens.includes(`--request-hash=${validatorRequestHash}`), "the public targeted-validator vector must retain its request hash");
	assert.ok(validatorArgumentTokens.includes("--agent=pi"), "the public targeted-validator vector must retain the Pi binding");
	assert.ok(validatorArgumentTokens.includes("--execute=true"), "the public targeted-validator vector must retain Go-owned execution");
	assert.ok(publicStatusProjectionPaths(validationStatus.details).includes("selected.txt"), "the targeted-validator STATUS must remain bound to selected.txt");
	assert.equal(publicStatusProjectionPaths(validationStatus.details).includes("excluded.txt"), false, "the targeted-validator STATUS must remain outside excluded.txt");

	environment.OPAQUE_PI_TARGETED_VALIDATOR_RESULT = JSON.stringify({
		targeted_validation_request_hash: validatorRequestHash,
		correction_target_identity: validatorTargetIdentity,
		original_criteria: { passed: true, evidence: ["focused acceptance proof passed"] },
		correction_regression: { passed: true, evidence: ["focused regression proof passed"] },
		follow_ups: [],
	});
	const providerValidation = await capture.execute(
		"combined-provider-targeted-validation",
		{ lineageId: lineage, workspaceRoot: nestedTarget, collectBinding: validatorBinding },
		undefined,
		undefined,
		sessionContext(sessionA),
	);
	const providerValidationDetails = record(providerValidation.details, "combined provider targeted validation");
	if (providerValidationDetails.status !== "closed") t.diagnostic(`targeted-validator capture result: ${JSON.stringify(providerValidationDetails)}`);
	assert.equal(providerValidationDetails.status, "closed");
	assert.equal(providerValidationDetails.outcome, "native-last-event-closure");
	const validationClosure = record(providerValidationDetails.closure, "targeted-validator last-event closure");
	assert.equal(validationClosure.schema, "gentle-ai.review-last-event-closure/v1");
	assert.equal(validationClosure.operation, "review/capture-validation");
	assert.equal(validationClosure.state, "approved");
	const validationCaptureCalls = nativeCalls.filter((call) => call.arguments[0] === "review" && call.arguments[1] === "capture-validation");
	assert.equal(validationCaptureCalls.length, 1, "the Go-owned targeted validator must capture exactly once");
	assert.equal(validationCaptureCalls[0]!.cwd, canonicalB);
	assert.deepEqual(validationCaptureCalls[0]!.arguments.slice(2), validatorArgumentTokens, "the Go-owned targeted validator must receive the exact public vector");

	const validatorPiLog = record(JSON.parse(readFileSync(fakePiLog, "utf8")) as unknown, "validator fake Pi log");
	assert.ok(Array.isArray(validatorPiLog.calls), "validator fake Pi log must record the Go-owned subprocess");
	const validatorCall = validatorPiLog.calls.map((call) => record(call, "validator fake Pi call")).find((call) => call.role === "targeted-validator");
	assert.ok(validatorCall, "the fake Pi log must contain the Go-owned targeted-validator subprocess");
	assert.deepEqual(validatorCall!.entries, [], "the Go-owned validator must run from an empty isolated sandbox");
	assert.notEqual(validatorCall!.cwd, canonicalB, "the Go-owned validator subprocess must not run in B");
	assert.notEqual(validatorCall!.cwd, sessionA, "the Go-owned validator subprocess must not run in A");
	assert.equal(existsSync(stringValue(validatorCall!.cwd, "validator fake Pi scratch cwd")), false, "the Go-owned validator sandbox must be removed after the subprocess exits");
	const validatorPrompt = stringValue(validatorCall!.prompt, "validator fake Pi prompt");
	assert.ok(validatorPrompt.length > 0, "the Go-owned validator must receive a provider-rendered prompt");
	assert.ok(validatorPrompt.includes(validatorRequestHash), "the Go-owned validator prompt must retain the provider request hash");

	// Approval no longer burns on its own: it commits one pending
	// acknowledgement and waits for the host to run that exact invocation
	// (gentle-ai #3851). The lineage is still live here on purpose, and running
	// the provider's own tokens is what ends it.
	const pendingAcknowledgement = record(validationClosure.acknowledgement, "approved acknowledgement continuation");
	assert.equal(pendingAcknowledgement.operation, "review.acknowledge-approved");
	const acknowledgementTokens = (pendingAcknowledgement.arguments as readonly Record<string, unknown>[])
		.map((argument) => stringValue(argument.token, "acknowledgement argument token"));
	const beforeAcknowledgement = await native.targetStatus!({ cwd: canonicalB, lineageId: lineage, agent: "pi", ...selection });
	assert.equal(beforeAcknowledgement.authority?.state, "approved", "approved authority must survive until its exact acknowledgement runs");
	await native.acknowledgeApproved!({ cwd: canonicalB, argumentTokens: acknowledgementTokens });

	const terminal = await native.targetStatus!({ cwd: canonicalB, lineageId: lineage, agent: "pi", ...selection });
	assert.equal(terminal.authority, undefined, "the exact acknowledgement must burn the sandbox review authority");
	assert.equal("evidence" in terminal.raw, false, "terminal STATUS must not retain validation evidence");
	assert.equal("staging" in terminal.raw, false, "terminal STATUS must not retain staging state");
	assert.equal("receipt" in terminal.raw, false, "terminal STATUS must not retain a receipt after last-event approval");
	assert.equal(git(canonicalB, "diff", "--cached", "--name-only"), "", "terminal approval must leave no sandbox staging entries");
	assert.deepEqual(candidateJson(RELAY_DEV_BINARY!, sessionA, ["review", "mode", "status", "--cwd", canonicalB, "--json"], environment), isolatedModeAfterSetup, "approval must not change the isolated global or clone-local RDD mode");

	const lifecycleCalls = nativeCalls.filter((call) => call.arguments[0] === "review");
	assert.ok(lifecycleCalls.length > 0);
	assert.ok(lifecycleCalls.every((call) => call.cwd === canonicalB), "every controller-native lifecycle operation must run from B's canonical worktree root");
	const selectionBoundLifecycleCalls = nativeCalls.slice(selectionBoundCallOffset).filter((call) => call.arguments[0] === "review");
	for (const call of selectionBoundLifecycleCalls.filter((call) => call.arguments[1] === "status")) {
		assert.ok(selectionTokens.every((token) => call.arguments.includes(token)), `STATUS must preserve B's exact selected-untracked tokens: ${call.arguments.join(" ")}`);
	}
	const startCall = selectionBoundLifecycleCalls.find((call) => call.arguments[1] === "start");
	assert.ok(startCall, "controller START must reach native");
	assert.ok(selectionTokens.every((token) => startCall!.arguments.includes(token)), "START must preserve B's exact selected-untracked tokens");
	assert.equal(lifecycleCalls.some((call) => call.arguments[1] === "mode" && call.arguments[2] === "enable"), false, "Pi must never enable RDD automatically");
});
