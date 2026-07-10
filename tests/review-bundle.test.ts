import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ReviewBundleExporter, ReviewBundleImporter, ReviewBundleError } from "../lib/review-bundle.ts";
import { canonicalJsonV1, domainHashV1 } from "../lib/review-canonical.ts";
import { REVIEW_MODE, ReviewTransactionStore, createReviewState, setReviewMutationLockPlatformForTesting } from "../lib/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/review-triggers.ts";
import { qualifiedReviewLockPlatform, testSnapshot } from "./review-test-fixtures.ts";

setReviewMutationLockPlatformForTesting(qualifiedReviewLockPlatform());

function repository(t: test.TestContext): { parent: string; source: string; target: string } {
	const parent = mkdtempSync(join(tmpdir(), "gentle-pi-review-bundle-"));
	const source = join(parent, "source");
	mkdirSync(source);
	const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	git(source, "init", "-b", "main");
	writeFileSync(join(source, "file.txt"), "bundle\n");
	git(source, "add", ".");
	git(source, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial");
	const target = join(parent, "target");
	git(parent, "clone", source, target);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	return { parent, source, target };
}

function createLineage(cwd: string, lineageId = "bundle-lineage"): void {
	const store = ReviewTransactionStore.forRepository(cwd);
	store.create(createReviewState({
		lineageId,
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({ baseTree: "1".repeat(40), completeTree: "2".repeat(40), route: REVIEW_ROUTE.STANDARD, lenses: [REVIEW_LENS.RELIABILITY] }),
		evidenceHash: "a".repeat(64),
		budget: { review_batches: 1, review_actors: 1, refuter_batches: 1, fix_batches: 1, validator_runs: 1, final_verifications: 1, judgment_rounds: 0, judge_runs: 0 },
	}), "start");
	store.runReducerOperation({ lineageId, transition: "ordinary-discovery", idempotencyKey: "freeze", input: { rows: [] } });
}

test("bundle export is deterministic and compatible import installs its exact graph closure atomically", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const first = join(parent, "first.review-bundle");
	const second = join(parent, "second.review-bundle");
	const exporter = new ReviewBundleExporter(source);
	const exported = exporter.export({ outputPath: first, operationId: "export-one" });
	exporter.export({ outputPath: second, operationId: "export-two" });
	assert.deepEqual(readFileSync(first), readFileSync(second));
	assert.equal(exported.roots[0]?.lineage_id, "bundle-lineage");

	const importer = new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	const imported = importer.import({ inputPath: first, operationId: "import-one", acknowledgeUntrustedBundleSource: true });
	assert.equal(imported.imported, true);
	assert.equal(ReviewTransactionStore.forRepository(target).read("bundle-lineage").lineage_id, "bundle-lineage");
	assert.equal(importer.import({ inputPath: first, operationId: "import-two" }).imported, false);
});

// RISK2-001 (openspec/changes/bounded-review-graph-parity/reviews/post-apply-4r-round2-ledger.md):
// repository_identity/root_commit_ids match alone cannot prove a bundle's lineage content was
// ever produced by a legitimate export from THIS repository's own history — anyone who knows the
// (often public) root commit can forge a structurally valid bundle claiming the same identity.
// These tests exercise the resulting trust gate.
test("bundle import denies adopting a brand-new lineage without an explicit untrusted-source acknowledgement", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const bundle = join(parent, "transfer.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: bundle, operationId: "export" });
	assert.throws(
		() => new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: bundle, operationId: "no-acknowledgement" }),
		/REVIEW_BUNDLE_UNTRUSTED_SOURCE/,
	);
	assert.throws(() => ReviewTransactionStore.forRepository(target).read("bundle-lineage"), /quorum|missing/i);
});

test("bundle import denies a foreign clone's fabricated lineage even though its repository identity matches", (t) => {
	// Simulates RISK2-001: a party with no relationship to `target` other than sharing the same
	// public repository history (a real clone of `source`, not a forged byte-level identity) can
	// author its own arbitrary local lineage and export a fully self-consistent bundle. Its
	// repository_identity matches `target`'s own — exactly the data available at import time — yet
	// this lineage was never established by `target`'s own authority.
	const { parent, source, target } = repository(t);
	const foreignClone = join(parent, "foreign-clone");
	execFileSync("git", ["clone", source, foreignClone]);
	createLineage(foreignClone, "fabricated-lineage");
	const bundle = join(parent, "foreign.review-bundle");
	new ReviewBundleExporter(foreignClone).export({ outputPath: bundle, operationId: "export-foreign" });
	assert.throws(
		() => new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: bundle, operationId: "no-acknowledgement" }),
		/REVIEW_BUNDLE_UNTRUSTED_SOURCE/,
	);
	assert.throws(() => ReviewTransactionStore.forRepository(target).read("fabricated-lineage"), /quorum|missing/i);
});

test("bundle import allows a brand-new lineage once the caller explicitly acknowledges the untrusted source", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const bundle = join(parent, "transfer.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: bundle, operationId: "export" });
	const imported = new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: bundle, operationId: "acknowledged", acknowledgeUntrustedBundleSource: true });
	assert.equal(imported.imported, true);
	assert.equal(ReviewTransactionStore.forRepository(target).read("bundle-lineage").lineage_id, "bundle-lineage");
});

test("bundle import forward-recovers a genesis quorum-loss crash in the target store instead of silently discarding its existing lineage", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const firstBundle = join(parent, "first.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: firstBundle, operationId: "export-first" });
	new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: firstBundle, operationId: "import-first", acknowledgeUntrustedBundleSource: true });
	assert.equal(ReviewTransactionStore.forRepository(target).read("bundle-lineage").lineage_id, "bundle-lineage");

	// Simulate a crash that left only CURRENT.0 durably published in the target's own store.
	const targetGraphRoot = join(
		execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: target, encoding: "utf8" }).trim(),
		"gentle-ai", "reviews", "graph-v1",
	);
	unlinkSync(join(targetGraphRoot, "CURRENT.1"));
	unlinkSync(join(targetGraphRoot, "CURRENT.2"));
	assert.throws(() => ReviewTransactionStore.forRepository(target).read("bundle-lineage"), /quorum/i);

	createLineage(source, "second-lineage");
	const secondBundle = join(parent, "second.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: secondBundle, operationId: "export-second", lineageIds: ["second-lineage"] });
	const imported = new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: secondBundle, operationId: "import-second", acknowledgeUntrustedBundleSource: true });
	assert.equal(imported.imported, true);
	// The pre-crash lineage must not have been silently discarded by treating
	// the recoverable quorum loss as an empty, fresh store.
	assert.equal(ReviewTransactionStore.forRepository(target).read("bundle-lineage").lineage_id, "bundle-lineage");
	assert.equal(ReviewTransactionStore.forRepository(target).read("second-lineage").lineage_id, "second-lineage");
});

test("malformed, repository-mismatched, and trailing bundles do not publish authority", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const bundle = join(parent, "transfer.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: bundle, operationId: "export" });
	const malformed = join(parent, "malformed.review-bundle");
	writeFileSync(malformed, `${readFileSync(bundle, "utf8")}trailing`);
	const importer = new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	assert.throws(() => importer.import({ inputPath: malformed, operationId: "trailing" }), ReviewBundleError);
	assert.throws(() => ReviewTransactionStore.forRepository(target).read("bundle-lineage"), /quorum|missing/i);

	const unrelated = join(parent, "unrelated");
	mkdirSync(unrelated);
	execFileSync("git", ["init", "-b", "main"], { cwd: unrelated });
	writeFileSync(join(unrelated, "other.txt"), "other\n");
	execFileSync("git", ["add", "."], { cwd: unrelated });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "other"], { cwd: unrelated });
	assert.throws(() => new ReviewBundleImporter(unrelated, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: bundle, operationId: "mismatch" }), /repository|authority/i);
});

test("bundle import rejects a manifest root whose claimed reduced state does not match its staged closure", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const bundle = join(parent, "transfer.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: bundle, operationId: "export" });
	const bytes = readFileSync(bundle);
	const header = Buffer.byteLength("GENTLE-REVIEW-BUNDLE 1\n");
	const lengthEnd = bytes.indexOf(0x0a, header);
	const manifestLength = Number(bytes.subarray(header, lengthEnd).toString("ascii"));
	const manifest = JSON.parse(bytes.subarray(lengthEnd + 1, lengthEnd + 1 + manifestLength).toString("utf8")) as { body: { roots: Array<{ reduced_state_hash: string }> }; bundle_id: string };
	manifest.body.roots[0]!.reduced_state_hash = "f".repeat(64);
	manifest.bundle_id = domainHashV1("bundle", manifest.body);
	const manifestBytes = Buffer.from(JSON.stringify(manifest));
	writeFileSync(bundle, Buffer.concat([bytes.subarray(0, header), Buffer.from(`${manifestBytes.byteLength}\n`), manifestBytes, bytes.subarray(lengthEnd + 1 + manifestLength)]));
	assert.throws(
		() => new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: bundle, operationId: "invalid-reduced-state" }),
		/reduced state|root/i,
	);
});

test("bundle import rejects a claimed incarnation that is not committed by every staged event", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const bundle = join(parent, "transfer.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: bundle, operationId: "export" });
	const bytes = readFileSync(bundle);
	const header = Buffer.byteLength("GENTLE-REVIEW-BUNDLE 1\n");
	const lengthEnd = bytes.indexOf(0x0a, header);
	const manifestLength = Number(bytes.subarray(header, lengthEnd).toString("ascii"));
	const manifest = JSON.parse(bytes.subarray(lengthEnd + 1, lengthEnd + 1 + manifestLength).toString("utf8")) as { body: Record<string, unknown>; bundle_id: string };
	manifest.body.store_epoch = "a".repeat(64);
	manifest.body.authority_incarnation_id = "b".repeat(64);
	manifest.body.initialized_by_reset_id = "c".repeat(64);
	manifest.bundle_id = domainHashV1("bundle", manifest.body);
	const manifestBytes = Buffer.from(canonicalJsonV1(manifest));
	writeFileSync(bundle, Buffer.concat([bytes.subarray(0, header), Buffer.from(`${manifestBytes.byteLength}\n`), manifestBytes, bytes.subarray(lengthEnd + 1 + manifestLength)]));
	assert.throws(
		() => new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: bundle, operationId: "forged-incarnation" }),
		/incarnation/i,
	);
});

test("bundle export and import reject a malformed live STORE before touching authority", (t) => {
	const { parent, source, target } = repository(t);
	createLineage(source);
	const bundle = join(parent, "transfer.review-bundle");
	new ReviewBundleExporter(source).export({ outputPath: bundle, operationId: "export" });
	const sourceStore = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: source, encoding: "utf8" }).trim();
	mkdirSync(join(sourceStore, "gentle-ai", "reviews", "graph-v1"), { recursive: true });
	writeFileSync(join(sourceStore, "gentle-ai", "reviews", "graph-v1", "STORE"), "not canonical json");
	assert.throws(
		() => new ReviewBundleExporter(source).export({ outputPath: join(parent, "blocked.review-bundle"), operationId: "malformed-source-store" }),
		/Store descriptor is missing or invalid/,
	);

	const targetStore = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: target, encoding: "utf8" }).trim();
	mkdirSync(join(targetStore, "gentle-ai", "reviews", "graph-v1"), { recursive: true });
	writeFileSync(join(targetStore, "gentle-ai", "reviews", "graph-v1", "STORE"), "not canonical json");
	assert.throws(
		() => new ReviewBundleImporter(target, { mutationLockPlatform: qualifiedReviewLockPlatform() }).import({ inputPath: bundle, operationId: "malformed-store" }),
		/Store descriptor is missing or invalid/,
	);
});
