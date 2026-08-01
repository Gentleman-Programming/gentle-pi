import assert from "node:assert/strict";
import test from "node:test";
import { RELEASE_ARTIFACT_EVIDENCE_CLASS } from "../lib/release-artifact.ts";
import { EVIDENCE_LEDGER_CLASS, EvidenceLedger, assertNeverRelabeledFromBootstrap, createEvidenceRecord } from "./evidence/ledger.ts";

// --- generic immutable-evidence harness (design D9/plan §12, task 7.5/7.6) --
//
// Builds on the exact evidence.class discipline lib/release-artifact.ts
// already carries (RELEASE_ARTIFACT_EVIDENCE_CLASS / evidenceClass on the
// checked-in lock) instead of inventing a parallel S/R vocabulary.

test("evidence ledger classes reuse the exact release-artifact evidence.class discipline", () => {
	assert.equal(EVIDENCE_LEDGER_CLASS.S, RELEASE_ARTIFACT_EVIDENCE_CLASS.BOOTSTRAP);
	assert.equal(EVIDENCE_LEDGER_CLASS.R, RELEASE_ARTIFACT_EVIDENCE_CLASS.RELEASE);
});

test("createEvidenceRecord builds an immutable record carrying its class and label", () => {
	const record = createEvidenceRecord(EVIDENCE_LEDGER_CLASS.S, "install-on-linux");
	assert.equal(record.evidenceClass, "development/bootstrap");
	assert.equal(record.label, "install-on-linux");
	assert.throws(() => {
		// @ts-expect-error -- records are frozen; a runtime write must throw.
		record.evidenceClass = EVIDENCE_LEDGER_CLASS.R;
	}, TypeError);
});

test("an S-class record can never be relabeled R", () => {
	const bootstrap = createEvidenceRecord(EVIDENCE_LEDGER_CLASS.S, "install-on-linux");
	const release = createEvidenceRecord(EVIDENCE_LEDGER_CLASS.R, "install-on-linux");
	assert.throws(
		() => assertNeverRelabeledFromBootstrap(bootstrap, release),
		/can never be relabeled/,
	);
});

test("an R-class record requires live signed-release inputs -- re-recording R over R is fine", () => {
	const releaseA = createEvidenceRecord(EVIDENCE_LEDGER_CLASS.R, "install-on-linux");
	const releaseB = createEvidenceRecord(EVIDENCE_LEDGER_CLASS.R, "install-on-linux");
	assert.doesNotThrow(() => assertNeverRelabeledFromBootstrap(releaseA, releaseB));
});

test("EvidenceLedger.record enforces the invariant on the mutation path itself, not only as a standalone comparison", () => {
	const ledger = new EvidenceLedger();
	ledger.record(EVIDENCE_LEDGER_CLASS.S, "install-on-linux");
	assert.throws(
		() => ledger.record(EVIDENCE_LEDGER_CLASS.R, "install-on-linux"),
		/install-on-linux.*can never be relabeled/s,
	);
	// The failed attempt must not mutate the ledger.
	assert.equal(ledger.get("install-on-linux")?.evidenceClass, EVIDENCE_LEDGER_CLASS.S);
});

test("EvidenceLedger.record allows R -> R re-recording and independent labels with different classes", () => {
	const ledger = new EvidenceLedger();
	ledger.record(EVIDENCE_LEDGER_CLASS.R, "install-on-linux");
	assert.doesNotThrow(() => ledger.record(EVIDENCE_LEDGER_CLASS.R, "install-on-linux"));
	assert.doesNotThrow(() => ledger.record(EVIDENCE_LEDGER_CLASS.S, "install-on-macos"));
	assert.equal(ledger.get("install-on-linux")?.evidenceClass, EVIDENCE_LEDGER_CLASS.R);
	assert.equal(ledger.get("install-on-macos")?.evidenceClass, EVIDENCE_LEDGER_CLASS.S);
});

test("EvidenceLedger.get returns undefined for a label never recorded", () => {
	const ledger = new EvidenceLedger();
	assert.equal(ledger.get("never-recorded"), undefined);
});
