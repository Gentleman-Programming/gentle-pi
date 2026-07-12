import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	isNonAuthoritativeStatus,
	listActiveOpenSpecChanges,
	parseSddStatusCommandArgs,
	renderNativeSddPhasePrompt,
	renderPhaseInstructions,
	renderSddDispatcherMarkdown,
	renderSddStatusMarkdown,
	resolveSddStatus,
} from "../lib/sdd-status.ts";

async function workspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gentle-pi-sdd-status-"));
}

function write(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function seedChange(cwd: string, change = "add-auth"): string {
	const root = join(cwd, "openspec", "changes", change);
	write(join(root, "proposal.md"), "# Proposal\n");
	write(join(root, "specs", "auth", "spec.md"), "# Auth Spec\n");
	write(join(root, "design.md"), "# Design\n");
	write(
		join(root, "tasks.md"),
		`# Tasks

- [x] 1.1 Build foundation
- [ ] 1.2 Wire routes
`,
	);
	return root;
}

test("listActiveOpenSpecChanges excludes archive and sorts active changes", async () => {
	const cwd = await workspace();
	mkdirSync(join(cwd, "openspec", "changes", "b-change"), { recursive: true });
	mkdirSync(join(cwd, "openspec", "changes", "a-change"), { recursive: true });
	mkdirSync(join(cwd, "openspec", "changes", "archive", "2026-01-01-old"), { recursive: true });

	assert.deepEqual(listActiveOpenSpecChanges(cwd), ["a-change", "b-change"]);
});

test("resolveSddStatus blocks when there are no active changes", async () => {
	const cwd = await workspace();
	mkdirSync(join(cwd, "openspec", "changes"), { recursive: true });

	const status = resolveSddStatus({ cwd });

	assert.equal(status.changeName, null);
	assert.match(status.blockedReasons[0], /No active SDD changes/);
	assert.equal(status.dependencies.apply, "blocked");
});

test("resolveSddStatus blocks when change selection is ambiguous", async () => {
	const cwd = await workspace();
	mkdirSync(join(cwd, "openspec", "changes", "first"), { recursive: true });
	mkdirSync(join(cwd, "openspec", "changes", "second"), { recursive: true });

	const status = resolveSddStatus({ cwd });

	assert.equal(status.changeName, null);
	assert.match(status.blockedReasons[0], /ambiguous/);
});

test("resolveSddStatus selects the only active change and counts task progress", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);

	const status = resolveSddStatus({ cwd, includeInstructions: true });

	assert.equal(status.changeName, "add-auth");
	assert.equal(status.changeRoot, root);
	assert.equal(status.artifacts.proposal, "done");
	assert.equal(status.artifacts.specs, "done");
	assert.deepEqual(status.taskProgress, {
		total: 2,
		complete: 1,
		remaining: 1,
		unchecked: ["- [ ] 1.2 Wire routes"],
	});
	assert.equal(status.applyState, "ready");
	assert.equal(status.dependencies.apply, "ready");
	assert.match(status.instructions?.apply.join("\n") ?? "", /persisted task checkboxes/);
});

test("resolveSddStatus keeps planning-only changes read-only and blocks only an expected invalid review authority", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(root, "verify-report.md"), "# Verify\n\nPASS\n");
	write(join(root, "sync-report.md"), "# Sync\n\nPASS\n");
	let resolverCalls = 0;
	const planning = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		reviewAuthority: {
			expected: false,
			resolve: () => {
				resolverCalls += 1;
				return { activeAuthorityId: "must-not-run" };
			},
		},
	});
	assert.equal(resolverCalls, 0);
	assert.equal(planning.blockedReasons.some((reason) => reason.startsWith("resolve-review:")), false);

	const invalid = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		reviewAuthority: {
			expected: true,
			resolve: () => {
				throw new Error("stale compact successor");
			},
		},
	});
	assert.equal(invalid.applyState, "blocked");
	assert.equal(invalid.dependencies.archive, "blocked");
	assert.equal(invalid.nextRecommended, "resolve-review");
	assert.match(invalid.blockedReasons.join("\n"), /^resolve-review: stale compact successor/m);

	const valid = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		reviewAuthority: {
			expected: true,
			resolve: () => ({ activeAuthorityId: "validated-compact-authority" }),
		},
	});
	assert.equal(valid.applyState, "all_done");
	assert.equal(valid.dependencies.archive, "ready");
	assert.equal(valid.blockedReasons.some((reason) => reason.startsWith("resolve-review:")), false);
});

test("resolveSddStatus blocks an expected missing native bound readiness without inferring approval", async () => {
	const cwd = await workspace();
	seedChange(cwd);
	const status = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		nativeReviewReadiness: { expected: true, ready: false, reason: "binding is missing" },
	});
	assert.equal(status.applyState, "blocked");
	assert.equal(status.nextRecommended, "resolve-review");
	assert.match(status.blockedReasons.join("\n"), /binding is missing/);
});

test("resolveSddStatus routes completed implementation to parent lifecycle and separates parent actions", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(
		join(root, "tasks.md"),
		"# Tasks\n\n- [x] 1.1 Build foundation <!-- sdd-owner: implementation -->\n- [ ] Start bounded review. <!-- sdd-owner: parent -->\n",
	);

	const status = resolveSddStatus({ cwd, changeName: "add-auth", includeInstructions: true });

	assert.deepEqual(status.taskProgress, { total: 1, complete: 1, remaining: 0, unchecked: [] });
	assert.deepEqual(status.deferredParentActions, {
		total: 1,
		complete: 0,
		remaining: 1,
		unchecked: ["- [ ] Start bounded review. <!-- sdd-owner: parent -->"],
	});
	assert.deepEqual(status.taskArtifactErrors, []);
	assert.equal(status.applyState, "all_done");
	assert.equal(status.dependencies.apply, "all_done");
	assert.equal(status.nextRecommended, "parent-lifecycle");
	assert.match(status.instructions?.apply.join("\n") ?? "", /Deferred parent lifecycle actions/);
});

test("resolveSddStatus treats malformed ownership as unresolved implementation work", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] Completed but malformed. <!-- sdd-owner: Parent -->\n");

	const status = resolveSddStatus({ cwd, changeName: "add-auth" });

	assert.deepEqual(status.taskProgress, {
		total: 1,
		complete: 0,
		remaining: 1,
		unchecked: ["- [x] Completed but malformed. <!-- sdd-owner: Parent -->"],
	});
	assert.equal(status.applyState, "blocked");
	assert.equal(status.nextRecommended, "fix-task-ownership-marker");
	assert.match(status.taskArtifactErrors.join("\n"), /Completed but malformed/);
	assert.match(status.blockedReasons.join("\n"), /task ownership marker/i);
});

test("resolveSddStatus routes completed legacy implementation to parent lifecycle", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] 1.1 Build foundation\n");

	const status = resolveSddStatus({ cwd, changeName: "add-auth" });

	assert.equal(status.applyState, "all_done");
	assert.equal(status.dependencies.apply, "all_done");
	assert.equal(status.nextRecommended, "parent-lifecycle");
});

test("resolveSddStatus blocks sync when verify report is not clearly passing", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "apply-progress.md"), "# Apply\n\nSome work completed.\n");
	write(join(root, "verify-report.md"), "# Verify\n\nTODO: tests not run yet\n");

	const status = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		reviewAuthority: { expected: true, resolve: () => ({ activeAuthorityId: "approved" }) },
	});

	assert.equal(status.dependencies.verify, "ready");
	assert.equal(status.dependencies.sync, "blocked");
	assert.equal(status.dependencies.archive, "blocked");
});

test("resolveSddStatus rejects negated pass and sync-complete phrases", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(root, "verify-report.md"), "# Verify\n\nStatus: not passed\n");
	write(join(root, "sync-report.md"), "# Sync\n\nSync complete: no\n");

	const status = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		reviewAuthority: { expected: true, resolve: () => ({ activeAuthorityId: "approved" }) },
	});

	assert.equal(status.dependencies.verify, "ready");
	assert.equal(status.dependencies.sync, "blocked");
	assert.equal(status.dependencies.archive, "blocked");
	assert.notEqual(status.nextRecommended, "sdd-archive");
});

test("resolveSddStatus blocks sync when verify report contains critical text", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "verify-report.md"), "# Verify\n\nCRITICAL: missing tests\n");

	const status = resolveSddStatus({ cwd, changeName: "add-auth" });

	assert.equal(status.dependencies.sync, "blocked");
	assert.equal(status.dependencies.archive, "blocked");
});

test("resolveSddStatus reports same-domain collisions", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd, "current");
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(root, "verify-report.md"), "# Verify\n\nPASS\n");
	write(join(cwd, "openspec", "changes", "other", "specs", "auth", "spec.md"), "# Other\n");

	const status = resolveSddStatus({ cwd, changeName: "current" });

	assert.deepEqual(status.collisions.map((collision) => collision.domain), ["auth"]);
	assert.equal(status.collisions[0].changes[0].change, "other");
	assert.equal(status.dependencies.sync, "blocked");
});

test("resolveSddStatus blocks apply when tasks has no checkboxes", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "tasks.md"), "# Tasks\n\nImplementation notes only.\n");

	const status = resolveSddStatus({ cwd, changeName: "add-auth" });

	assert.equal(status.taskProgress.total, 0);
	assert.equal(status.applyState, "blocked");
	assert.equal(status.dependencies.apply, "blocked");
	assert.match(status.blockedReasons.join("\n"), /no implementation task checkboxes/);
});

test("resolveSddStatus marks legacy flat specs partial and blocks sync", async () => {
	const cwd = await workspace();
	write(join(cwd, "openspec", "changes", "legacy", "proposal.md"), "# Proposal\n");
	write(join(cwd, "openspec", "changes", "legacy", "spec.md"), "# Flat\n");
	write(join(cwd, "openspec", "changes", "legacy", "design.md"), "# Design\n");
	write(join(cwd, "openspec", "changes", "legacy", "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(cwd, "openspec", "changes", "legacy", "verify-report.md"), "# Verify\n\nPASS\n");

	const status = resolveSddStatus({ cwd, changeName: "legacy" });

	assert.equal(status.artifacts.specs, "partial");
	assert.match(status.blockedReasons.join("\n"), /Legacy flat spec/);
	assert.equal(status.dependencies.sync, "blocked");
});

test("resolveSddStatus accepts nested domain specs even when a legacy flat spec also exists", async () => {
	const cwd = await workspace();
	write(join(cwd, "openspec", "changes", "mixed", "proposal.md"), "# Proposal\n");
	write(join(cwd, "openspec", "changes", "mixed", "spec.md"), "# Flat\n");
	write(join(cwd, "openspec", "changes", "mixed", "specs", "parent", "child", "spec.md"), "# Nested\n");
	write(join(cwd, "openspec", "changes", "mixed", "design.md"), "# Design\n");
	write(join(cwd, "openspec", "changes", "mixed", "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");

	const status = resolveSddStatus({ cwd, changeName: "mixed" });

	assert.equal(status.artifacts.specs, "done");
	assert.equal(status.legacyFlatSpec?.hasDomainSpecs, true);
	assert.doesNotMatch(status.blockedReasons.join("\n"), /Legacy flat spec/);
});

test("resolveSddStatus blocks sync when core artifacts are missing even with clean verify", async () => {
	const cwd = await workspace();
	write(join(cwd, "openspec", "changes", "thin", "proposal.md"), "# Proposal\n");
	write(join(cwd, "openspec", "changes", "thin", "design.md"), "# Design\n");
	write(join(cwd, "openspec", "changes", "thin", "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(cwd, "openspec", "changes", "thin", "verify-report.md"), "# Verify\n\nPASS\n");

	const status = resolveSddStatus({ cwd, changeName: "thin" });

	assert.match(status.blockedReasons.join("\n"), /domain specs are missing or partial/);
	assert.equal(status.dependencies.sync, "blocked");
	assert.notEqual(status.nextRecommended, "sdd-sync");
});

test("resolveSddStatus blocks stale sync report when current verify is not passing", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(root, "verify-report.md"), "# Verify\n\nStatus: not passed\n");
	write(join(root, "sync-report.md"), "# Sync\n\nPASS\n");

	const status = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		reviewAuthority: { expected: true, resolve: () => ({ activeAuthorityId: "approved" }) },
	});

	assert.equal(status.dependencies.verify, "ready");
	assert.equal(status.dependencies.sync, "blocked");
	assert.equal(status.dependencies.archive, "blocked");
	assert.notEqual(status.nextRecommended, "sdd-archive");
});

test("resolveSddStatus blocks archive when required artifacts are missing", async () => {
	const cwd = await workspace();
	write(join(cwd, "openspec", "changes", "thin", "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(cwd, "openspec", "changes", "thin", "verify-report.md"), "# Verify\n\nPASS\n");
	write(join(cwd, "openspec", "changes", "thin", "sync-report.md"), "# Sync\n\nPASS\n");

	const status = resolveSddStatus({ cwd, changeName: "thin" });

	assert.match(status.blockedReasons.join("\n"), /proposal\.md is missing/);
	assert.equal(status.dependencies.archive, "blocked");
	assert.notEqual(status.nextRecommended, "sdd-archive");
});

test("resolveSddStatus reports partial core artifacts as blockers", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "proposal.md"), "");
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(root, "verify-report.md"), "# Verify\n\nPASS\n");
	write(join(root, "sync-report.md"), "# Sync\n\nPASS\n");

	const status = resolveSddStatus({ cwd, changeName: "add-auth" });

	assert.equal(status.artifacts.proposal, "partial");
	assert.match(status.blockedReasons.join("\n"), /proposal\.md is empty or partial/);
	assert.equal(status.dependencies.archive, "blocked");
});

test("resolveSddStatus marks archive ready only after clean verify, sync, and complete tasks", async () => {
	const cwd = await workspace();
	const root = seedChange(cwd);
	write(join(root, "tasks.md"), "# Tasks\n\n- [x] 1.1 Done\n");
	write(join(root, "verify-report.md"), "# Verify\n\nPASS\n");
	write(join(root, "sync-report.md"), "# Sync\n\nPASS\n");

	const status = resolveSddStatus({
		cwd,
		changeName: "add-auth",
		reviewAuthority: { expected: true, resolve: () => ({ activeAuthorityId: "approved" }) },
	});

	assert.equal(status.dependencies.archive, "ready");
	assert.equal(status.nextRecommended, "sdd-archive");
	assert.match(renderPhaseInstructions(status).archive.join("\n"), /CRITICAL verification issues have no override/);
});

test("renderSddStatusMarkdown includes structured JSON", async () => {
	const cwd = await workspace();
	seedChange(cwd);

	const markdown = renderSddStatusMarkdown(resolveSddStatus({ cwd }));

	assert.match(markdown, /## SDD Status: add-auth/);
	assert.match(markdown, /```json/);
	assert.match(markdown, /"schemaName": "gentle-pi.sdd-status"/);
});

test("resolveSddStatus with artifactStore engram returns non-authoritative status without disk scan", async () => {
	const cwd = await workspace();
	// No openspec directory — simulates an engram-only session

	const status = resolveSddStatus({ cwd, artifactStore: "engram", changeName: "my-change" });

	assert.equal(status.artifactStore, "engram");
	assert.equal(status.changeName, "my-change");
	assert.deepEqual(status.blockedReasons, []);
	assert.equal(status.nextRecommended, "resolve-via-engram");
	assert.equal(status.dependencies.apply, "not_applicable");
	assert.equal(status.applyState, "not_applicable");
});

test("resolveSddStatus with artifactStore none returns non-authoritative status without disk scan", async () => {
	const cwd = await workspace();
	// No openspec directory

	const status = resolveSddStatus({ cwd, artifactStore: "none", changeName: "my-change" });

	assert.equal(status.artifactStore, "none");
	assert.deepEqual(status.blockedReasons, []);
	assert.equal(status.nextRecommended, "resolve-via-engram");
});

test("resolveSddStatus with artifactStore both uses disk scan and reflects store", async () => {
	const cwd = await workspace();
	seedChange(cwd);

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "add-auth" });

	assert.equal(status.artifactStore, "both");
	assert.equal(status.changeName, "add-auth");
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
});

test("resolveSddStatus with undefined store and existing openspec dir defaults to openspec and blocks", async () => {
	const cwd = await workspace();
	// Create openspec/ directory to signal an openspec workspace
	mkdirSync(join(cwd, "openspec", "changes"), { recursive: true });

	const status = resolveSddStatus({ cwd });

	// openspec workspace with no active changes → blocked (back-compat)
	assert.equal(status.artifactStore, "openspec");
	assert.match(status.blockedReasons[0] ?? "", /No active SDD changes/);
});

test("resolveSddStatus with undefined store and NO openspec dir returns non-authoritative status", async () => {
	const cwd = await workspace();
	// No openspec directory at all — unknown store, no disk evidence

	const status = resolveSddStatus({ cwd });

	// Safety net: should not emit the openspec false-block
	assert.equal(status.artifactStore, "none");
	assert.deepEqual(status.blockedReasons, []);
	assert.equal(status.nextRecommended, "resolve-via-engram");
	assert.equal(status.applyState, "not_applicable");
});

test("resolveSddStatus non-authoritative status has neutral planningHome (no misleading openspec path)", async () => {
	const cwd = await workspace();

	const status = resolveSddStatus({ cwd, artifactStore: "engram", changeName: "fix-auth" });

	assert.equal(status.planningHome.changesDir, "");
	assert.equal(status.planningHome.root, status.actionContext.workspaceRoot);
});

test("parseSddStatusCommandArgs extracts change and json flag", () => {
	assert.deepEqual(parseSddStatusCommandArgs("add-auth --json"), {
		changeName: "add-auth",
		json: true,
	});
	assert.deepEqual(parseSddStatusCommandArgs("--json"), {
		changeName: undefined,
		json: true,
	});
});

test("resolveSddStatus with artifactStore both and NO openspec dir returns non-authoritative status", async () => {
	const cwd = await workspace();
	// No openspec directory — both store without disk backing is non-authoritative

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "my-change" });

	assert.equal(status.artifactStore, "both");
	assert.equal(status.changeName, "my-change");
	assert.deepEqual(status.blockedReasons, []);
	assert.equal(status.nextRecommended, "resolve-via-engram");
	assert.equal(status.applyState, "not_applicable");
	assert.equal(status.dependencies.apply, "not_applicable");
	assert.equal(status.dependencies.archive, "not_applicable");
});

test("resolveSddStatus with artifactStore both and existing openspec dir runs authoritative disk scan", async () => {
	const cwd = await workspace();
	seedChange(cwd);

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "add-auth" });

	assert.equal(status.artifactStore, "both");
	assert.equal(status.changeName, "add-auth");
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
	assert.equal(status.artifacts.proposal, "done");
});

// Renamed: previously "returns true only when nextRecommended is resolve-via-engram" — now
// explicitly asserts BOTH the typed isNonAuthoritative field and the sentinel together.
test("isNonAuthoritativeStatus reads typed isNonAuthoritative field and matches resolve-via-engram sentinel", async () => {
	const cwd = await workspace();

	const engram = resolveSddStatus({ cwd, artifactStore: "engram", changeName: "x" });
	assert.equal(engram.isNonAuthoritative, true);
	assert.equal(isNonAuthoritativeStatus(engram), true);
	assert.equal(engram.nextRecommended, "resolve-via-engram");

	const none = resolveSddStatus({ cwd, artifactStore: "none", changeName: "x" });
	assert.equal(none.isNonAuthoritative, true);
	assert.equal(isNonAuthoritativeStatus(none), true);
	assert.equal(none.nextRecommended, "resolve-via-engram");

	const bothWithoutOpenspec = resolveSddStatus({ cwd, artifactStore: "both", changeName: "x" });
	assert.equal(bothWithoutOpenspec.isNonAuthoritative, true);
	assert.equal(isNonAuthoritativeStatus(bothWithoutOpenspec), true);
	assert.equal(bothWithoutOpenspec.nextRecommended, "resolve-via-engram");

	seedChange(cwd);
	const bothWithOpenspec = resolveSddStatus({ cwd, artifactStore: "both", changeName: "add-auth" });
	assert.equal(bothWithOpenspec.isNonAuthoritative, false);
	assert.equal(isNonAuthoritativeStatus(bothWithOpenspec), false);
	assert.notEqual(bothWithOpenspec.nextRecommended, "resolve-via-engram");
});

// Fix 4 item 4 — isNonAuthoritative boolean is set correctly on the typed field
test("isNonAuthoritative boolean field is set correctly across all store/disk combinations", async () => {
	const cwd = await workspace();

	// engram → non-authoritative
	const engram = resolveSddStatus({ cwd, artifactStore: "engram", changeName: "x" });
	assert.equal(engram.isNonAuthoritative, true);

	// none → non-authoritative
	const none = resolveSddStatus({ cwd, artifactStore: "none", changeName: "x" });
	assert.equal(none.isNonAuthoritative, true);

	// both without openspec/ → non-authoritative
	const bothWithout = resolveSddStatus({ cwd, artifactStore: "both", changeName: "x" });
	assert.equal(bothWithout.isNonAuthoritative, true);

	// both WITH openspec/ and seeded change → authoritative
	seedChange(cwd);
	const bothWith = resolveSddStatus({ cwd, artifactStore: "both", changeName: "add-auth" });
	assert.equal(bothWith.isNonAuthoritative, false);

	// openspec (default disk scan, seeded) → authoritative
	const openspec = resolveSddStatus({ cwd, artifactStore: "openspec", changeName: "add-auth" });
	assert.equal(openspec.isNonAuthoritative, false);
});

// Fix 4 item 1 — both + openspec/ dir present + change NOT on disk → non-authoritative
test("resolveSddStatus with artifactStore both, openspec dir present but change not on disk returns non-authoritative", async () => {
	const cwd = await workspace();
	// Create an openspec/changes dir with a different change — not the requested one
	mkdirSync(join(cwd, "openspec", "changes", "other-change"), { recursive: true });

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "missing-change" });

	assert.equal(status.isNonAuthoritative, true);
	assert.equal(status.nextRecommended, "resolve-via-engram");
	assert.deepEqual(status.blockedReasons, []);
	assert.equal(status.applyState, "not_applicable");
	assert.equal(status.artifactStore, "both");
	// Must NOT be treated as blocked
	assert.notEqual(status.applyState, "blocked");
});

// Fix 4 item 2 — strengthen existing both-with-openspec-and-seeded-change test
test("resolveSddStatus with artifactStore both, openspec dir present and change on disk is authoritative", async () => {
	const cwd = await workspace();
	seedChange(cwd);

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "add-auth" });

	assert.equal(status.artifactStore, "both");
	assert.equal(status.changeName, "add-auth");
	// Must be authoritative
	assert.equal(isNonAuthoritativeStatus(status), false);
	assert.equal(status.isNonAuthoritative, false);
	// Must not be not_applicable — real disk scan ran
	assert.notEqual(status.applyState, "not_applicable");
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
	assert.equal(status.artifacts.proposal, "done");
});

// Fix 4 item 3 — pure openspec store + change not found STILL blocks (guard against over-broadening Fix 2)
test("resolveSddStatus with artifactStore openspec and change not found still blocks", async () => {
	const cwd = await workspace();
	// Create openspec dir with a different change — simulate openspec store with no matching change
	mkdirSync(join(cwd, "openspec", "changes", "other-change"), { recursive: true });

	const status = resolveSddStatus({ cwd, artifactStore: "openspec", changeName: "nonexistent" });

	// Must block, not return non-authoritative
	assert.equal(status.isNonAuthoritative, false);
	assert.match(status.blockedReasons.join("\n"), /Active change not found/);
	assert.equal(status.applyState, "blocked");
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
});

test("renderSddDispatcherMarkdown for both-without-openspec does NOT render Ready", async () => {
	const cwd = await workspace();
	// No openspec directory — both store is non-authoritative

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "fix-x" });
	const markdown = renderSddDispatcherMarkdown(status);

	assert.doesNotMatch(markdown, /### Ready/);
	assert.match(markdown, /resolve via Engram/i);
});

test("renderNativeSddPhasePrompt for both-without-openspec emits non-authoritative line", async () => {
	const cwd = await workspace();

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "fix-x" });
	const prompt = renderNativeSddPhasePrompt(status, "apply");

	assert.match(prompt, /non-authoritative/);
	assert.doesNotMatch(prompt, /deterministically/);
});

test("renderPhaseInstructions for not_applicable applyState emits neutral line", async () => {
	const cwd = await workspace();

	const status = resolveSddStatus({ cwd, artifactStore: "engram", changeName: "fix-x" });
	const instructions = renderPhaseInstructions(status);

	assert.match(instructions.apply.join("\n"), /Readiness is resolved from Engram/);
	assert.match(instructions.archive.join("\n"), /Readiness is resolved from Engram/);
});

// Fix 4 item 1 — both + openspec/ + ZERO changes + no changeName → non-authoritative
test("resolveSddStatus both + openspec/ dir + zero active changes + no changeName returns non-authoritative", async () => {
	const cwd = await workspace();
	// openspec/ dir exists but holds no active changes (only the changes/ subdir)
	mkdirSync(join(cwd, "openspec", "changes"), { recursive: true });

	const status = resolveSddStatus({ cwd, artifactStore: "both" });

	assert.equal(status.isNonAuthoritative, true);
	assert.equal(status.nextRecommended, "resolve-via-engram");
	assert.deepEqual(status.blockedReasons, []);
	assert.equal(status.artifactStore, "both");
	assert.equal(status.applyState, "not_applicable");
	assert.equal(status.dependencies.apply, "not_applicable");
	assert.equal(status.dependencies.archive, "not_applicable");
	// Must NOT be treated as blocked
	assert.notEqual(status.applyState, "blocked");
});

// Fix 4 item 2 — both + openspec/ + MULTIPLE changes + no changeName → authoritative select-change
test("resolveSddStatus both + openspec/ dir + multiple active changes + no changeName stays authoritative", async () => {
	const cwd = await workspace();
	mkdirSync(join(cwd, "openspec", "changes", "alpha"), { recursive: true });
	mkdirSync(join(cwd, "openspec", "changes", "beta"), { recursive: true });

	const status = resolveSddStatus({ cwd, artifactStore: "both" });

	// Authoritative ambiguous-selection behavior must be preserved
	assert.equal(status.isNonAuthoritative, false);
	assert.match(status.blockedReasons.join("\n"), /ambiguous/);
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
});

// Fix 4 item 3 — both + openspec/ + ONE resolvable change → authoritative
test("resolveSddStatus both + openspec/ dir + exactly one active change is authoritative", async () => {
	const cwd = await workspace();
	seedChange(cwd);

	// No changeName supplied — should auto-select the single change
	const status = resolveSddStatus({ cwd, artifactStore: "both" });

	assert.equal(status.isNonAuthoritative, false);
	assert.equal(status.changeName, "add-auth");
	assert.equal(status.artifactStore, "both");
	assert.notEqual(status.applyState, "not_applicable");
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
	assert.equal(status.artifacts.proposal, "done");
});

// Fix 4 item 4 — pure openspec + zero/missing change STILL blocks (guard against over-broadening)
test("resolveSddStatus openspec + zero active changes still blocks", async () => {
	const cwd = await workspace();
	mkdirSync(join(cwd, "openspec", "changes"), { recursive: true });

	const status = resolveSddStatus({ cwd, artifactStore: "openspec" });

	assert.equal(status.isNonAuthoritative, false);
	assert.match(status.blockedReasons.join("\n"), /No active SDD changes/);
	assert.equal(status.applyState, "blocked");
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
});

test("resolveSddStatus openspec + named change missing still blocks", async () => {
	const cwd = await workspace();
	mkdirSync(join(cwd, "openspec", "changes", "other-change"), { recursive: true });

	const status = resolveSddStatus({ cwd, artifactStore: "openspec", changeName: "nonexistent" });

	assert.equal(status.isNonAuthoritative, false);
	assert.match(status.blockedReasons.join("\n"), /Active change not found/);
	assert.equal(status.applyState, "blocked");
	assert.notEqual(status.nextRecommended, "resolve-via-engram");
});

// Fix 4 render test — non-authoritative both status → dispatcher shows "both" not "Engram or none"
test("renderSddDispatcherMarkdown for non-authoritative both status shows artifact store 'both'", async () => {
	const cwd = await workspace();

	const status = resolveSddStatus({ cwd, artifactStore: "both", changeName: "fix-x" });
	const markdown = renderSddDispatcherMarkdown(status);

	assert.match(markdown, /artifact store: both/);
	assert.doesNotMatch(markdown, /Engram or none/);
	assert.match(markdown, /resolve via Engram/i);
});
