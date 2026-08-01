// Generic immutable-evidence ledger harness (design D9, plan §12 ledger
// shape). Every piece of evidence a change collects for a claim is either:
//
//   S-class ("development/bootstrap") -- produced from a local, synthetic,
//     or otherwise unsigned input. Proves mechanism only. Never
//     acceptance/pin evidence.
//   R-class ("release") -- produced from a real, live, verified input
//     (signed release, live install, etc). The sole final-acceptance class.
//
// This harness reuses the EXACT evidence.class discipline
// lib/release-artifact.ts already carries (RELEASE_ARTIFACT_EVIDENCE_CLASS /
// assertReleaseAcceptanceEvidence, also persisted verbatim into the checked-in
// capabilities/gentle-ai-release.lock.json's evidence.class field) instead of
// inventing a parallel S/R vocabulary. It is intentionally generic -- it
// carries no gentle-ai-specific fields (no signature, no repository, no
// tag) -- so any later change's test suite can build its own S-vs-R ledger
// on top of the one invariant every consumer of it depends on: an S-class
// bootstrap record can never be relabeled R.

import { RELEASE_ARTIFACT_EVIDENCE_CLASS } from "../../lib/release-artifact.ts";

export const EVIDENCE_LEDGER_CLASS = {
	S: RELEASE_ARTIFACT_EVIDENCE_CLASS.BOOTSTRAP,
	R: RELEASE_ARTIFACT_EVIDENCE_CLASS.RELEASE,
} as const;

export type EvidenceLedgerClass = (typeof EVIDENCE_LEDGER_CLASS)[keyof typeof EVIDENCE_LEDGER_CLASS];

export interface EvidenceLedgerRecord {
	readonly evidenceClass: EvidenceLedgerClass;
	readonly label: string;
}

export function createEvidenceRecord(evidenceClass: EvidenceLedgerClass, label: string): EvidenceLedgerRecord {
	return Object.freeze({ evidenceClass, label });
}

// The core invariant (plan §12 ledger shape): an S-class record can never be
// relabeled R. An R-class record requires live signed-release (or
// equivalent live-input) evidence; a bootstrap record standing in for one is
// exactly the substitution design D1/D9 forbid elsewhere in this change.
export function assertNeverRelabeledFromBootstrap(previous: EvidenceLedgerRecord, next: EvidenceLedgerRecord): void {
	if (previous.evidenceClass === EVIDENCE_LEDGER_CLASS.S && next.evidenceClass !== EVIDENCE_LEDGER_CLASS.S) {
		throw new Error(
			`evidence ledger record ${JSON.stringify(previous.label)} was recorded as ${JSON.stringify(EVIDENCE_LEDGER_CLASS.S)} and can never be relabeled ${JSON.stringify(next.evidenceClass)}: an S-class bootstrap record can never serve as R-class release evidence`,
		);
	}
}

// A ledger accumulates one record per label. The invariant is enforced on
// the mutation path itself (record), not only as a standalone comparison
// function callers might forget to invoke: once a label is recorded
// S-class, no later call for the same label may record it R-class, and a
// rejected attempt never mutates the ledger.
export class EvidenceLedger {
	#records = new Map<string, EvidenceLedgerRecord>();

	record(evidenceClass: EvidenceLedgerClass, label: string): EvidenceLedgerRecord {
		const next = createEvidenceRecord(evidenceClass, label);
		const previous = this.#records.get(label);
		if (previous !== undefined) assertNeverRelabeledFromBootstrap(previous, next);
		this.#records.set(label, next);
		return next;
	}

	get(label: string): EvidenceLedgerRecord | undefined {
		return this.#records.get(label);
	}
}
