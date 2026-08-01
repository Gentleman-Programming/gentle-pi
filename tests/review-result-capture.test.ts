import assert from "node:assert/strict";
import test from "node:test";
import { CandidateViewError } from "../lib/review-candidate-view.ts";
import type { ReviewArtifactSubjectV2, ReviewCollectInputV3, ReviewStatusV3, ReviewTransitionArgumentV3 } from "../lib/review-integration-v2.ts";
import {
	ADMISSION_DIAGNOSTIC_CODE,
	CAPTURE_SLOT_ARGUMENT,
	CAPTURE_SLOT_STATE,
	type CaptureSlot,
	type CaptureSlotRecord,
	assertLensSlotBijection,
	captureSlotKey,
	clearCaptureSlotRecordsForLineage,
	decodeSafeAdmissionDiagnostic,
	deriveCaptureSlots,
	isCaptureSlotCommitted,
	sha256Hex,
} from "../lib/review-result-capture.ts";

const LINEAGE = "capture-lineage";
const REVISION = `sha256:${"1".repeat(64)}`;
const TARGET = `sha256:${"2".repeat(64)}`;
const BASE_TREE = "b".repeat(40);
const CANDIDATE_TREE = "c".repeat(40);
const MANIFEST = Object.freeze([
	{ path: "app.ts", status: "M" as const, oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false, intendedUntracked: false },
]);
const MANIFEST_SHA = `sha256:${"3".repeat(64)}`;

interface SubjectOverrides {
	lineageId?: string;
	authorityRevision?: string;
	targetIdentity?: string;
	baseTree?: string;
	candidateTree?: string;
	changedPathManifestSha256?: string;
	lens?: ReviewArtifactSubjectV2["lens"];
	selectedOrder?: number;
	subjectHash?: string;
}

function subject(overrides: SubjectOverrides = {}): ReviewArtifactSubjectV2 {
	return {
		schema: "gentle-ai.review-artifact-subject/v2",
		subjectHash: overrides.subjectHash ?? `sha256:${"4".repeat(64)}`,
		lineageId: overrides.lineageId ?? LINEAGE,
		authorityRevision: overrides.authorityRevision ?? REVISION,
		targetIdentity: overrides.targetIdentity ?? TARGET,
		baseTree: overrides.baseTree ?? BASE_TREE,
		candidateTree: overrides.candidateTree ?? CANDIDATE_TREE,
		changedPathManifestSha256: overrides.changedPathManifestSha256 ?? MANIFEST_SHA,
		lens: overrides.lens ?? "review-reliability",
		selectedOrder: overrides.selectedOrder ?? 0,
	};
}

function argumentsFor(bound: ReviewArtifactSubjectV2, argumentOverrides: Partial<Record<string, string>> = {}): readonly ReviewTransitionArgumentV3[] {
	const values: Record<string, string> = {
		lineage: bound.lineageId,
		"expected-revision": bound.authorityRevision,
		target: bound.targetIdentity,
		lens: bound.lens,
		order: String(bound.selectedOrder),
		"subject-hash": bound.subjectHash,
		...argumentOverrides,
	};
	return Object.entries(values).map(([name, value]) => ({ name, value, token: `--${name}=${value}` }));
}

function collectInput(overrides: {
	subjectOverrides?: SubjectOverrides;
	argumentOverrides?: Partial<Record<string, string>>;
	omitArtifactSubject?: boolean;
	omitBaseTree?: boolean;
	omitCandidateTree?: boolean;
	omitManifest?: boolean;
	tokenOverrides?: Partial<Record<string, string | undefined>>;
} = {}): ReviewCollectInputV3 {
	const bound = subject(overrides.subjectOverrides);
	const args = argumentsFor(bound, overrides.argumentOverrides).map((argument) =>
		overrides.tokenOverrides && argument.name in overrides.tokenOverrides
			? { ...argument, token: overrides.tokenOverrides[argument.name] }
			: argument,
	);
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: args,
		...(overrides.omitArtifactSubject ? {} : { artifactSubject: bound }),
		...(overrides.omitBaseTree ? {} : { baseTree: bound.baseTree }),
		...(overrides.omitCandidateTree ? {} : { candidateTree: bound.candidateTree }),
		...(overrides.omitManifest ? {} : { changedPathManifest: MANIFEST }),
	};
}

function status(inputs: readonly ReviewCollectInputV3[]): ReviewStatusV3 {
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId: LINEAGE, state: "reviewing", generation: 1, revision: REVISION },
		receipt: { status: "expected_missing" },
		action: "finalize",
		replayability: "not_replayable",
		targetIdentity: TARGET,
		projection: {
			schema: "gentle-ai.review-integration.projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: BASE_TREE,
			initialReviewTree: CANDIDATE_TREE,
			currentCandidateTree: CANDIDATE_TREE,
			pathsDigest: "digest",
			paths: ["app.ts"],
			intendedUntracked: [],
			intendedUntrackedProof: "proof",
			initialSnapshotIdentity: "identity",
			currentSnapshotIdentity: "identity",
		},
		repair: {
			schema: "gentle-ai.review-authority-repair-assessment/v1",
			status: "unsupported",
			counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 },
			supportedOperations: ["review/complete-fix", "review/validate-fix"],
			authorizationSchema: "gentle-ai.review-repair-authorization/v1",
		},
		candidates: [],
		nextTransition: inputs.length === 0 ? undefined : { kind: "collect", reasonCode: "reviewer_results_required", collect: { inputs } },
		raw: {},
	};
}

test("CAPTURE_SLOT_ARGUMENT names the six provider binding fields", () => {
	assert.deepEqual(CAPTURE_SLOT_ARGUMENT, {
		LINEAGE: "lineage",
		EXPECTED_REVISION: "expected-revision",
		TARGET: "target",
		LENS: "lens",
		ORDER: "order",
		SUBJECT_HASH: "subject-hash",
	});
});

test("deriveCaptureSlots derives one slot per collect input with a canonical slotKey", () => {
	const derivation = deriveCaptureSlots(status([collectInput()]));
	assert.equal(derivation.slots.length, 1);
	const slot = derivation.slots[0]!;
	assert.equal(slot.lineageId, LINEAGE);
	assert.equal(slot.authorityRevision, REVISION);
	assert.equal(slot.targetIdentity, TARGET);
	assert.equal(slot.lens, "review-reliability");
	assert.equal(slot.selectedOrder, 0);
	assert.equal(slot.subjectHash, `sha256:${"4".repeat(64)}`);
	assert.equal(slot.slotKey, [LINEAGE, REVISION, TARGET, "review-reliability", "0", `sha256:${"4".repeat(64)}`].join("|"));
	assert.deepEqual(slot.argumentTokens, [
		`--lineage=${LINEAGE}`,
		`--expected-revision=${REVISION}`,
		`--target=${TARGET}`,
		"--lens=review-reliability",
		"--order=0",
		`--subject-hash=sha256:${"4".repeat(64)}`,
	]);
});

test("deriveCaptureSlots derives distinct slots for multiple lenses with distinct selectedOrder", () => {
	const first = collectInput({ subjectOverrides: { lens: "review-risk", selectedOrder: 0, subjectHash: `sha256:${"5".repeat(64)}` } });
	const second = collectInput({ subjectOverrides: { lens: "review-reliability", selectedOrder: 1, subjectHash: `sha256:${"6".repeat(64)}` } });
	const derivation = deriveCaptureSlots(status([first, second]));
	assert.equal(derivation.slots.length, 2);
	assert.deepEqual(derivation.slots.map((slot) => slot.lens), ["review-risk", "review-reliability"]);
	assert.deepEqual(derivation.slots.map((slot) => slot.selectedOrder), [0, 1]);
});

test("deriveCaptureSlots rejects when no review.capture-result collect input is offered", () => {
	assert.throws(
		() => deriveCaptureSlots(status([])),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

test("deriveCaptureSlots rejects a collect input missing its artifact subject or manifest", () => {
	for (const overrides of [{ omitArtifactSubject: true }, { omitBaseTree: true }, { omitCandidateTree: true }, { omitManifest: true }]) {
		assert.throws(
			() => deriveCaptureSlots(status([collectInput(overrides)])),
			(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
			`expected rejection for ${JSON.stringify(overrides)}`,
		);
	}
});

test("deriveCaptureSlots rejects each of lineage/target/revision/repository-context mismatching independently against the frozen authority and projection", () => {
	// Lens, order, and subject-hash have no authoritative comparison target of
	// their own for a single collect input beyond the argument-echo check
	// (covered separately below) and pairwise uniqueness (covered by the
	// duplicate-lens/order/subjectHash tests) — they are two of the six
	// argument fields, not fields with an independent frozen-authority source.
	const mismatches: SubjectOverrides[] = [
		{ lineageId: "other-lineage" },
		{ targetIdentity: `sha256:${"9".repeat(64)}` },
		{ authorityRevision: `sha256:${"8".repeat(64)}` },
		{ baseTree: "d".repeat(40) },
		{ candidateTree: "e".repeat(40) },
	];
	for (const subjectOverrides of mismatches) {
		// The input's own top-level baseTree/candidateTree mirror the status
		// projection, but the artifact subject inside it disagrees — this is
		// exactly the repository-context / identity divergence the six-field
		// validator must reject before any slot is trusted.
		const bound = subject(subjectOverrides);
		const drifted: ReviewCollectInputV3 = {
			name: "reviewer_result",
			schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
			captureOperation: "review.capture-result",
			arguments: argumentsFor(bound),
			artifactSubject: bound,
			baseTree: BASE_TREE,
			candidateTree: CANDIDATE_TREE,
			changedPathManifest: MANIFEST,
		};
		assert.throws(
			() => deriveCaptureSlots(status([drifted])),
			(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
			`expected rejection for ${JSON.stringify(subjectOverrides)}`,
		);
	}
});

test("deriveCaptureSlots rejects a second collect input whose manifest hash disagrees with the first", () => {
	const first = collectInput({ subjectOverrides: { lens: "review-risk", selectedOrder: 0, subjectHash: `sha256:${"f".repeat(64)}` } });
	const driftedSubject = subject({ lens: "review-reliability", selectedOrder: 1, subjectHash: `sha256:${"0".repeat(64)}`, changedPathManifestSha256: `sha256:${"1".repeat(64)}` });
	const second: ReviewCollectInputV3 = {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: argumentsFor(driftedSubject),
		artifactSubject: driftedSubject,
		baseTree: BASE_TREE,
		candidateTree: CANDIDATE_TREE,
		changedPathManifest: MANIFEST,
	};
	assert.throws(
		() => deriveCaptureSlots(status([first, second])),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

test("deriveCaptureSlots rejects an argument value that disagrees with the artifact subject", () => {
	assert.throws(
		() => deriveCaptureSlots(status([collectInput({ argumentOverrides: { lens: "review-risk" } })])),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

test("deriveCaptureSlots rejects an argument token that is missing, empty, or non-string", () => {
	for (const tokenOverrides of [{ lineage: undefined }, { lineage: "" }]) {
		assert.throws(
			() => deriveCaptureSlots(status([collectInput({ tokenOverrides })])),
			(error: unknown) => error instanceof CandidateViewError,
			`expected rejection for ${JSON.stringify(tokenOverrides)}`,
		);
	}
});

test("deriveCaptureSlots rejects a duplicate lens across collect inputs", () => {
	const first = collectInput({ subjectOverrides: { selectedOrder: 0, subjectHash: `sha256:${"a".repeat(64)}` } });
	const second = collectInput({ subjectOverrides: { selectedOrder: 1, subjectHash: `sha256:${"b".repeat(64)}` } });
	assert.throws(
		() => deriveCaptureSlots(status([first, second])),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

test("deriveCaptureSlots rejects a duplicate selectedOrder across collect inputs", () => {
	const first = collectInput({ subjectOverrides: { lens: "review-risk", subjectHash: `sha256:${"c".repeat(64)}` } });
	const second = collectInput({ subjectOverrides: { lens: "review-reliability", subjectHash: `sha256:${"d".repeat(64)}` } });
	assert.throws(
		() => deriveCaptureSlots(status([first, second])),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

test("deriveCaptureSlots rejects a duplicate subjectHash across collect inputs", () => {
	const shared = `sha256:${"e".repeat(64)}`;
	const first = collectInput({ subjectOverrides: { lens: "review-risk", selectedOrder: 0, subjectHash: shared } });
	const second = collectInput({ subjectOverrides: { lens: "review-reliability", selectedOrder: 1, subjectHash: shared } });
	assert.throws(
		() => deriveCaptureSlots(status([first, second])),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

function slotFixture(overrides: Partial<CaptureSlot> = {}): CaptureSlot {
	return {
		slotKey: "slot",
		lineageId: LINEAGE,
		authorityRevision: REVISION,
		targetIdentity: TARGET,
		lens: "review-reliability",
		selectedOrder: 0,
		subjectHash: `sha256:${"4".repeat(64)}`,
		argumentTokens: ["--lens=review-reliability"],
		...overrides,
	};
}

test("assertLensSlotBijection accepts a lens_results set matching outstanding slots exactly once each", () => {
	const slots = [slotFixture({ lens: "review-risk", slotKey: "risk" }), slotFixture({ lens: "review-reliability", slotKey: "reliability" })];
	assert.doesNotThrow(() => assertLensSlotBijection(["review-risk", "review-reliability"], slots));
});

test("assertLensSlotBijection rejects a lens missing from outstanding slots", () => {
	const slots = [slotFixture({ lens: "review-reliability" })];
	assert.throws(
		() => assertLensSlotBijection(["review-risk"], slots),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "capture-lens-bijection-violation",
	);
});

test("assertLensSlotBijection rejects an extra lens_results entry beyond outstanding slots", () => {
	const slots = [slotFixture({ lens: "review-risk" })];
	assert.throws(
		() => assertLensSlotBijection(["review-risk", "review-reliability"], slots),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "capture-lens-bijection-violation",
	);
});

test("assertLensSlotBijection rejects a duplicate lens in lens_results", () => {
	const slots = [slotFixture({ lens: "review-risk", slotKey: "a" }), slotFixture({ lens: "review-reliability", slotKey: "b" })];
	assert.throws(
		() => assertLensSlotBijection(["review-risk", "review-risk"], slots),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "capture-lens-bijection-violation",
	);
});

test("assertLensSlotBijection rejects a slot count larger than lens_results (an outstanding slot with no submitted lens)", () => {
	const slots = [slotFixture({ lens: "review-risk", slotKey: "a" }), slotFixture({ lens: "review-reliability", slotKey: "b" })];
	assert.throws(
		() => assertLensSlotBijection(["review-risk"], slots),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "capture-lens-bijection-violation",
	);
});

// ---------------------------------------------------------------------------
// W2.1/W2.2 — decodeSafeAdmissionDiagnostic (Wave 1, threat: Privacy egress)
// ---------------------------------------------------------------------------

function admissionDiagnostic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		code: ADMISSION_DIAGNOSTIC_CODE.INVALID_FINDING_LOCATION,
		finding_id: "RISK-001",
		reason: "location does not resolve inside the frozen candidate scope",
		...overrides,
	};
}

test("decodeSafeAdmissionDiagnostic accepts the exact known shape for each allowlisted code", () => {
	for (const code of [ADMISSION_DIAGNOSTIC_CODE.INVALID_FINDING_LOCATION, ADMISSION_DIAGNOSTIC_CODE.CANDIDATE_CAUSALITY_UNPROVEN]) {
		const decoded = decodeSafeAdmissionDiagnostic(admissionDiagnostic({ code }));
		assert.deepEqual(decoded, { code, findingId: "RISK-001", reason: "location does not resolve inside the frozen candidate scope" });
	}
});

test("decodeSafeAdmissionDiagnostic accepts an optional repository-relative location", () => {
	const decoded = decodeSafeAdmissionDiagnostic(admissionDiagnostic({ location: "lib/a.ts:10" }));
	assert.equal(decoded?.location, "lib/a.ts:10");
});

test("decodeSafeAdmissionDiagnostic rejects a non-object value, including raw prose", () => {
	for (const value of [undefined, null, "the candidate causality could not be proven for RISK-001", 42, []]) {
		assert.equal(decodeSafeAdmissionDiagnostic(value), undefined, `expected undefined for ${JSON.stringify(value)}`);
	}
});

test("decodeSafeAdmissionDiagnostic rejects an unknown code", () => {
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ code: "unknown_code" })), undefined);
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ code: undefined })), undefined);
});

test("decodeSafeAdmissionDiagnostic rejects an extra key beyond the exact-record shape", () => {
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ raw_prose: "unstructured native explanation" })), undefined);
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ stack_trace: "at native.go:42" })), undefined);
});

test("decodeSafeAdmissionDiagnostic rejects a missing required key", () => {
	for (const key of ["code", "finding_id", "reason"]) {
		const value = admissionDiagnostic();
		delete value[key];
		assert.equal(decodeSafeAdmissionDiagnostic(value), undefined, `expected undefined with ${key} missing`);
	}
});

test("decodeSafeAdmissionDiagnostic rejects a malformed findingId", () => {
	for (const findingId of ["", "RISK 001", "RISK/001", "x".repeat(65), "../../etc/passwd"]) {
		assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ finding_id: findingId })), undefined, `expected undefined for finding_id ${JSON.stringify(findingId)}`);
	}
});

test("decodeSafeAdmissionDiagnostic rejects an absolute or private location", () => {
	for (const location of ["/etc/passwd", "/home/user/.ssh/id_rsa", "~/secrets.env", "~root/.bash_history"]) {
		assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ location })), undefined, `expected undefined for location ${JSON.stringify(location)}`);
	}
});

test("decodeSafeAdmissionDiagnostic rejects a location escaping the repository with .. or a Windows-style backslash", () => {
	for (const location of ["../../../etc/shadow", "lib/../../etc/passwd", "lib\\a.ts", "..\\..\\secrets"]) {
		assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ location })), undefined, `expected undefined for location ${JSON.stringify(location)}`);
	}
});

test("decodeSafeAdmissionDiagnostic rejects a location or reason containing control characters, including newlines", () => {
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ location: "lib/a.ts\n../../etc/passwd" })), undefined);
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ location: "lib/a.ts " })), undefined);
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ reason: "multi-line\nprose with an embedded control byte " })), undefined);
});

test("decodeSafeAdmissionDiagnostic rejects an over-length reason or location", () => {
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ reason: "x".repeat(121) })), undefined);
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ location: `lib/${"a".repeat(256)}.ts` })), undefined);
});

test("decodeSafeAdmissionDiagnostic rejects untrimmed or raw-prose reasons", () => {
	assert.equal(decodeSafeAdmissionDiagnostic(admissionDiagnostic({ reason: "  padded on both sides  " })), undefined);
	assert.equal(
		decodeSafeAdmissionDiagnostic(admissionDiagnostic({
			reason: "The native reviewer engine attempted to resolve the finding location against the candidate tree, but the location pointed outside every path in the frozen changed-path manifest, so admission was declined for causal-safety reasons",
		})),
		undefined,
	);
});

// ---------------------------------------------------------------------------
// W2.9 (partial, pure half) — a stale grant cannot be reused because
// `slotKey` embeds `authorityRevision` and `subjectHash` (Decision 5,
// structural guarantee).
// ---------------------------------------------------------------------------

test("captureSlotKey differs whenever authorityRevision or subjectHash differs, so a stale grant can never collide with a fresh one", () => {
	const base = { lineageId: LINEAGE, authorityRevision: REVISION, targetIdentity: TARGET, lens: "review-reliability", order: 0, subjectHash: `sha256:${"4".repeat(64)}` };
	const baseline = captureSlotKey(base.lineageId, base.authorityRevision, base.targetIdentity, base.lens, base.order, base.subjectHash);
	const newRevision = captureSlotKey(base.lineageId, `sha256:${"5".repeat(64)}`, base.targetIdentity, base.lens, base.order, base.subjectHash);
	const newSubjectHash = captureSlotKey(base.lineageId, base.authorityRevision, base.targetIdentity, base.lens, base.order, `sha256:${"6".repeat(64)}`);
	assert.notEqual(newRevision, baseline, "a new authority revision must never reuse a stale slotKey");
	assert.notEqual(newSubjectHash, baseline, "a new candidate subject hash must never reuse a stale slotKey");
	assert.notEqual(newRevision, newSubjectHash);
});

test("clearCaptureSlotRecordsForLineage removes only the targeted lineage's records", () => {
	const records = new Map<string, CaptureSlotRecord>([
		["a", { slotKey: "a", lineageId: "lineage-a", state: CAPTURE_SLOT_STATE.RELAUNCH_GRANTED, rejectedDocumentHashes: new Set([sha256Hex("doc")]) }],
		["b", { slotKey: "b", lineageId: "lineage-b", state: CAPTURE_SLOT_STATE.ADMITTED, rejectedDocumentHashes: new Set() }],
	]);
	clearCaptureSlotRecordsForLineage(records, "lineage-a");
	assert.equal(records.has("a"), false);
	assert.equal(records.has("b"), true);
});

// ---------------------------------------------------------------------------
// W2.7 (pure half) — isCaptureSlotCommitted (Decision 4)
// ---------------------------------------------------------------------------

test("isCaptureSlotCommitted proves commitment only when authority is unchanged and the slot is no longer offered", () => {
	const slot = slotFixture();
	const committed = status([]);
	assert.equal(isCaptureSlotCommitted(slot, committed), true);
});

test("isCaptureSlotCommitted is not proven when the slot is still offered", () => {
	const slot = slotFixture();
	const stillOffered = status([collectInput({ subjectOverrides: { lens: slot.lens, selectedOrder: slot.selectedOrder } })]);
	assert.equal(isCaptureSlotCommitted(slot, stillOffered), false);
});

test("isCaptureSlotCommitted is not proven when the authority lineage or revision changed", () => {
	const slot = slotFixture();
	const changedRevision = status([]);
	changedRevision.authority = { version: "compact-v2", lineageId: LINEAGE, state: "reviewing", generation: 2, revision: `sha256:${"9".repeat(64)}` };
	assert.equal(isCaptureSlotCommitted(slot, changedRevision), false);
	const changedLineage = status([]);
	changedLineage.authority = { version: "compact-v2", lineageId: "other-lineage", state: "reviewing", generation: 1, revision: REVISION };
	assert.equal(isCaptureSlotCommitted(slot, changedLineage), false);
});

test("isCaptureSlotCommitted is not proven (ambiguous) when authority is absent entirely", () => {
	const slot = slotFixture();
	const noAuthority = status([]);
	delete noAuthority.authority;
	assert.equal(isCaptureSlotCommitted(slot, noAuthority), false);
});
