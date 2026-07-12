import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startCompactReview, discoverCompactReview } from "../lib/review-facade.ts";
import { domainHashV1 } from "../lib/review-canonical.ts";
import {
	REVIEW_RUNTIME_INCOMPATIBLE,
	assertLoadedReviewRuntimeIdentity,
	loadedReviewRuntimeIdentity,
	setLoadedReviewRuntimeIdentityForTesting,
} from "../lib/review-runtime-contract.ts";

test("loaded compact runtime identity is stable and rejects incompatible replacements", () => {
	const identity = loadedReviewRuntimeIdentity();
	assert.match(identity.identity_hash, /^[0-9a-f]{64}$/);
	assert.doesNotThrow(() => assertLoadedReviewRuntimeIdentity(identity));
	setLoadedReviewRuntimeIdentityForTesting({ ...identity, operation_contract: "incompatible" });
	assert.throws(
		() => assertLoadedReviewRuntimeIdentity(identity),
		(error: unknown) => error instanceof Error && error.message === REVIEW_RUNTIME_INCOMPATIBLE,
	);
	setLoadedReviewRuntimeIdentityForTesting(undefined);
});

test("compact authority persists its loaded runtime contract and rejects a valid incompatible restarted runtime", (t) => {
	const parent = mkdtempSync(join(tmpdir(), "compact-runtime-persisted-"));
	const cwd = join(parent, "repo");
	mkdirSync(cwd);
	t.after(() => { setLoadedReviewRuntimeIdentityForTesting(undefined); rmSync(parent, { recursive: true, force: true }); });
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "value.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Runtime", "-c", "user.email=runtime@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "value.ts"), "export const value = 2;\n");
	const started = startCompactReview({ cwd, policyHash: "a".repeat(64) });
	const identity = loadedReviewRuntimeIdentity();
	const changed = { ...identity, operation_contract: "gentle-ai.review-operation/v2" };
	setLoadedReviewRuntimeIdentityForTesting({ ...changed, identity_hash: domainHashV1("review-runtime-contract", {
		schema: changed.schema,
		compact_contract: changed.compact_contract,
		operation_contract: changed.operation_contract,
		state_schema: changed.state_schema,
		record_schema: changed.record_schema,
		receipt_schema: changed.receipt_schema,
		canonicalization: changed.canonicalization,
	}) });
	assert.throws(
		() => discoverCompactReview(cwd, started.lineage_id),
		/persisted compact runtime identity/i,
	);
});

test("compact store rejects a runtime mismatch before authority load", (t) => {
	const parent = mkdtempSync(join(tmpdir(), "compact-runtime-"));
	const cwd = join(parent, "repo");
	mkdirSync(cwd);
	t.after(() => { setLoadedReviewRuntimeIdentityForTesting(undefined); rmSync(parent, { recursive: true, force: true }); });
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "value.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Runtime", "-c", "user.email=runtime@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "value.ts"), "export const value = 2;\n");
	const started = startCompactReview({ cwd, policyHash: "a".repeat(64) });
	const identity = loadedReviewRuntimeIdentity();
	setLoadedReviewRuntimeIdentityForTesting({ ...identity, operation_contract: "incompatible" });
	assert.throws(() => discoverCompactReview(cwd, started.lineage_id), new RegExp(REVIEW_RUNTIME_INCOMPATIBLE));
});
