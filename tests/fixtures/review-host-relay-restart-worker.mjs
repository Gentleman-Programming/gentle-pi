// Standalone entry point spawned as a fresh Node process by
// tests/review-host-relay-restart-parity.test.ts.
//
// gentle-pi#311 P6: proves restart parity for the provider-relay capture
// lane using the production read-only INSPECT operation as the truthful
// restart-protocol decision gate. Each invocation is a TRUE controller
// process restart — a fresh module load of extensions/gentle-ai.ts with its
// module-level relay runner state reset to the production default. No
// in-memory binding is carried across invocations.
//
// The provider (native targetStatus) is stubbed from a JSON file the parent
// controls; the provider's own durability is proven elsewhere
// (native-review-parity-runtime.test.ts drives the real binary). What is
// under test is the CONTROLLER's restart safety: that a fresh process can
// re-read the provider-returned pending binding through the read-only
// INSPECT lane and that FINALIZE relaunches from that fresh reoffer only
// when the parent has confirmed the binding matches.
//
// argv: <cwd> <status-file> <mode> <out-file>
//   status-file : JSON array of ReviewStatusV3 objects consumed in order by
//                 the stubbed native targetStatus (one per STATUS call).
//   mode        : "finalize-fail"   -> call FINALIZE; the relay runner throws
//                  a typed PI_FAILED ReviewHostRelayError (transport failure).
//                 "finalize-succeed" -> call FINALIZE; the relay runner returns
//                  a canned admitted submission (successful relaunch).
//                 "inspect"  -> call the read-only INSPECT operation; no
//                  relay launch and no native finalize.
//   out-file    : the worker writes { result, error, relayRequests,
//                  statusCalls, finalizeCalls } as JSON for the parent.

import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const cwd = process.argv[2];
const statusFile = process.argv[3];
const mode = process.argv[4];
const outFile = process.argv[5];
if (!cwd || !statusFile || !mode || !outFile) {
	throw new Error("usage: review-host-relay-restart-worker.mjs <cwd> <status-file> <mode> <out-file>");
}

const { __testing } = await import(join(import.meta.dirname, "..", "..", "extensions", "gentle-ai.ts"));
const { ReviewHostRelayError, REVIEW_HOST_RELAY_FAILURE } = await import(join(import.meta.dirname, "..", "..", "lib", "review-host-relay.ts"));

const statusQueue = JSON.parse(await readFile(statusFile, "utf8"));
if (!Array.isArray(statusQueue)) throw new Error("status-file must be a JSON array of ReviewStatusV3 objects");

const relayRequests = [];
const statusCalls = [];
let finalizeCalls = 0;

// Inject the relay runner for this process only. On a fresh process import
// the runner starts at the production default; we override it here exactly
// as an in-process test would, but the binding it receives is what the
// parent compares across restarts. INSPECT never reaches the runner.
__testing.setReviewHostRelayRunnerForTesting(async (request) => {
	relayRequests.push({
		captureArgumentTokens: request.captureArgumentTokens,
		submission: request.submission,
	});
	if (mode === "finalize-fail") {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi", "pi subprocess failed", { exitCode: 4 });
	}
	return { promptByteLength: 64, resultByteLength: 32, submission: '{"admission_decision":"completed"}' };
});

const nativeReviewCli = {
	start: async () => { throw new Error("unexpected start"); },
	finalize: async () => { finalizeCalls += 1; return { lineageId: "relay-lineage", state: "approved", action: "approved", storeRevision: "r1" }; },
	validate: async () => { throw new Error("unexpected validate"); },
	bindSdd: async () => { throw new Error("unexpected bindSdd"); },
	sddStatus: async () => ({ ready: false, artifactStore: "none", artifacts: {}, nextRecommended: "" }),
	reviewStatus: async () => { throw new Error("unexpected reviewStatus"); },
	targetStatus: async (request) => {
		// In non-inspect modes the production FINALIZE path always carries
		// the relay lineage selector. The read-only INSPECT operation
		// intentionally has no lineage selector. Reject any non-inspect call
		// missing the relay lineage before consuming the status queue, so a
		// regression that drops the selector cannot slip through on a
		// stubbed provider response.
		if (mode !== "inspect" && request.lineageId !== "relay-lineage") {
			throw new Error(`unexpected targetStatus lineageId in non-inspect mode: ${String(request.lineageId)}`);
		}
		statusCalls.push({ cwd: request.cwd, ...(request.lineageId === undefined ? {} : { lineageId: request.lineageId }) });
		const next = statusQueue.shift();
		if (next === undefined) throw new Error("status queue exhausted");
		return next;
	},
};

const parameters = mode === "inspect"
	? { operation: "inspect" }
	: { operation: "finalize", lineageId: "relay-lineage", input: JSON.stringify({ reviewer_run_acknowledged: true }) };

let result;
let error;
try {
	result = await __testing.executeReviewControllerOperation(parameters, cwd, new Map(), nativeReviewCli);
} catch (caught) {
	error = caught instanceof Error ? { name: caught.name, message: caught.message } : String(caught);
}

const envelope = { result, error, relayRequests, statusCalls, finalizeCalls };
await writeFile(outFile, JSON.stringify(envelope, null, 2));
