import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { domainHashV1 } from "../lib/review-canonical.ts";
import {
	COMPACT_REVIEW_STATE,
	completeCompactReview,
	completeCompactVerification,
	createCompactReviewState,
} from "../lib/review-compact.ts";
import {
	COMPACT_STORE_OPERATION,
	CompactReviewStoreV2,
} from "../lib/review-compact-store.ts";
import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	captureReviewSnapshot,
} from "../lib/review-snapshot.ts";

function repository(t: test.TestContext): string {
	const parent = mkdtempSync(join(tmpdir(), "compact-store-"));
	const root = join(parent, "repo");
	mkdirSync(root);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "value.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync("git", ["-c", "user.name=Compact", "-c", "user.email=compact@example.invalid", "commit", "-m", "base"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "value.ts"), "export const value = 2;\n");
	return root;
}

test("compact store provides content-derived CAS, exact retry idempotency, terminal readback, and immutability", (t) => {
	const root = repository(t);
	const snapshot = captureReviewSnapshot({
		cwd: root,
		mode: REVIEW_MODE.ORDINARY,
		projection: { kind: REVIEW_PROJECTION.COMPLETE },
		policyHash: "a".repeat(64),
	});
	const reviewing = createCompactReviewState({ lineageId: "compact-store", snapshot, policyHash: "a".repeat(64) });
	const store = CompactReviewStoreV2.forRepository(root, reviewing.lineage_id);
	const startRevision = store.replace("", COMPACT_STORE_OPERATION.START, reviewing);
	assert.match(startRevision, /^[0-9a-f]{64}$/);
	assert.equal(store.replace("", COMPACT_STORE_OPERATION.START, reviewing), startRevision);
	assert.throws(
		() => store.replace("", COMPACT_STORE_OPERATION.COMPLETE_REVIEW, reviewing),
		/exact retry operation/i,
	);

	const reviewed = completeCompactReview(reviewing, {
		lens_results: reviewing.selected_lenses.map(() => ({ findings: [], evidence: [] })),
	});
	const reviewedRevision = store.replace(startRevision, COMPACT_STORE_OPERATION.COMPLETE_REVIEW, reviewed);
	assert.notEqual(reviewedRevision, startRevision);
	assert.equal(
		store.replace(startRevision, COMPACT_STORE_OPERATION.COMPLETE_REVIEW, reviewed),
		reviewedRevision,
	);

	const terminal = completeCompactVerification(reviewed, "focused and full tests passed", true);
	assert.throws(
		() => store.replace(startRevision, COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION, terminal),
		/compare-and-swap/i,
	);
	const terminalRevision = store.replace(reviewedRevision, COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION, terminal);
	assert.equal(store.load().state.state, COMPACT_REVIEW_STATE.APPROVED);
	const receipt = store.materializeTerminalReceipt();
	assert.equal(receipt.body.authority_revision, terminalRevision);
	assert.deepEqual(store.loadTerminalReceipt().receipt, receipt);
	const receiptPayload = readFileSync(store.receiptPath, "utf8");
	const receiptWithUnknown = JSON.parse(receiptPayload) as Record<string, unknown>;
	const receiptBody = receiptWithUnknown.body as Record<string, unknown>;
	receiptBody.untrusted_extension = true;
	receiptWithUnknown.receipt_hash = domainHashV1("compact-receipt", receiptBody);
	writeFileSync(store.receiptPath, JSON.stringify(receiptWithUnknown));
	assert.throws(() => store.loadTerminalReceipt(), /receipt body contains unknown field/i);
	writeFileSync(store.receiptPath, receiptPayload);
	assert.equal(
		store.replace(terminalRevision, COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION, terminal),
		terminalRevision,
	);
	const conflictingTerminal = completeCompactVerification(reviewed, "failed verification", false);
	assert.throws(
		() => store.replace(terminalRevision, COMPACT_STORE_OPERATION.COMPLETE_VERIFICATION, conflictingTerminal),
		/terminal.*immutable/i,
	);
	const statePayload = JSON.parse(readFileSync(store.statePath, "utf8")) as Record<string, unknown>;
	const state = statePayload.state as Record<string, unknown>;
	(state.initial_snapshot as Record<string, unknown>).untrusted_extension = true;
	statePayload.revision = domainHashV1("compact-state", state);
	writeFileSync(store.statePath, JSON.stringify(statePayload));
	assert.throws(() => store.load(), /initial snapshot contains unknown field/i);
});
