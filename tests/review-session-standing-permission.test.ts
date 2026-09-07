import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	REVIEW_SESSION_PERMISSION_REGISTRY_SCHEMA,
	REVIEW_SESSION_PERMISSION_REGISTRY_SYMBOL,
	captureReviewSessionIdentity,
	grantReviewSessionPermission,
	hasReviewSessionPermission,
	reviewSessionPermissionEpoch,
	revokeReviewSessionPermission,
	revokeReviewSessionPermissionsForSession,
	type ReviewSessionContext,
} from "../lib/review-session-standing-permission.ts";

function repository(t: test.TestContext): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-session-permission-")));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "README.md"), "test repository\n");
	execFileSync("git", ["add", "README.md"], { cwd, stdio: "ignore" });
	execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	return cwd;
}

function siblingWorktree(t: test.TestContext, parentRoot: string): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-session-permission-worktree-")));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["worktree", "add", "--detach", cwd, "HEAD"], { cwd: parentRoot, stdio: "ignore" });
	return cwd;
}

function context(cwd: string, manager: object, sessionId: string, overrides: Partial<ReviewSessionContext> = {}): ReviewSessionContext {
	return {
		cwd,
		mode: "tui",
		hasUI: true,
		sessionManager: Object.assign(manager, { getSessionId: () => sessionId }),
		...overrides,
	};
}

test("standing permission is process-memory-only and bound to one live manager, session, and Git common directory", async (t) => {
	const firstRoot = repository(t);
	const siblingRoot = siblingWorktree(t, firstRoot);
	const unrelatedRoot = repository(t);
	const manager = {};
	const identity = await captureReviewSessionIdentity(context(firstRoot, manager, "session-a"), {});
	assert.ok(identity);
	assert.equal(identity.worktreeRoot, firstRoot);
	assert.equal(grantReviewSessionPermission(identity), true);
	assert.equal(hasReviewSessionPermission(identity), true);

	const wrongManager = await captureReviewSessionIdentity(context(firstRoot, {}, "session-a"), {});
	const wrongSession = await captureReviewSessionIdentity(context(firstRoot, manager, "session-b"), {});
	const sibling = await captureReviewSessionIdentity(context(siblingRoot, manager, "session-a"), {});
	const unrelated = await captureReviewSessionIdentity(context(unrelatedRoot, manager, "session-a"), {});
	assert.ok(wrongManager && wrongSession && sibling && unrelated);
	assert.equal(sibling.repositoryIdentity, identity.repositoryIdentity, "sibling worktrees share one common-directory identity");
	assert.notEqual(unrelated.repositoryIdentity, identity.repositoryIdentity, "independent repositories have distinct identities");
	assert.equal(hasReviewSessionPermission(wrongManager), false);
	assert.equal(hasReviewSessionPermission(wrongSession), false);
	assert.equal(hasReviewSessionPermission(sibling), true, "a grant follows sibling worktrees of the same clone");
	assert.equal(hasReviewSessionPermission(unrelated), false, "an unrelated repository requires its own human grant");

	assert.equal(revokeReviewSessionPermission(identity), true);
	assert.equal(hasReviewSessionPermission(sibling), false);
});

test("headless, child, empty-session, and non-Git contexts cannot offer or consume standing permission", async (t) => {
	const root = repository(t);
	const manager = {};
	assert.equal(await captureReviewSessionIdentity(context(root, manager, "session", { mode: "print", hasUI: false }), {}), undefined);
	assert.equal(await captureReviewSessionIdentity(context(root, manager, "session", { mode: "rpc", ui: { getAllThemes: () => [{}] } }), {}), undefined);
	assert.equal(await captureReviewSessionIdentity(context(root, manager, "session", { mode: undefined }), {}), undefined, "an omitted mode with no verified TUI surface fails closed");
	assert.ok(await captureReviewSessionIdentity(context(root, manager, "session", { mode: undefined, ui: { getAllThemes: () => [{}] } }), {}), "Pi 0.85 compatibility contexts prove TUI support through their nonempty theme surface");
	assert.equal(await captureReviewSessionIdentity(context(root, manager, "session"), { GENTLE_PI_AGENTS_CHILD: "1" }), undefined);
	assert.equal(await captureReviewSessionIdentity(context(root, manager, ""), {}), undefined);
	assert.equal(await captureReviewSessionIdentity(context(tmpdir(), manager, "session"), {}), undefined);
});

test("revocation advances an epoch that prevents an older awaited UI from re-granting", async (t) => {
	const root = repository(t);
	const identity = await captureReviewSessionIdentity(context(root, {}, "session"), {});
	assert.ok(identity);
	const epoch = reviewSessionPermissionEpoch(identity);
	assert.equal(epoch, 0);
	revokeReviewSessionPermissionsForSession(identity.sessionManager, identity.sessionId);
	assert.equal(reviewSessionPermissionEpoch(identity), 1);
	assert.equal(grantReviewSessionPermission(identity, epoch), false);
	assert.equal(hasReviewSessionPermission(identity), false);
});

test("session revocation removes only the exact manager and session partition", async (t) => {
	const root = repository(t);
	const manager = {};
	const first = await captureReviewSessionIdentity(context(root, manager, "first"), {});
	const second = await captureReviewSessionIdentity(context(root, manager, "second"), {});
	assert.ok(first && second);
	grantReviewSessionPermission(first);
	grantReviewSessionPermission(second);
	revokeReviewSessionPermissionsForSession(manager, "first");
	assert.equal(hasReviewSessionPermission(first), false);
	assert.equal(hasReviewSessionPermission(second), true);
});

test("an incompatible Symbol.for registry fails closed instead of being replaced", async (t) => {
	const root = repository(t);
	const globalRegistry = globalThis as Record<symbol, unknown>;
	const previous = globalRegistry[REVIEW_SESSION_PERMISSION_REGISTRY_SYMBOL];
	globalRegistry[REVIEW_SESSION_PERMISSION_REGISTRY_SYMBOL] = {
		schema: `${REVIEW_SESSION_PERMISSION_REGISTRY_SCHEMA}-future`,
		permissions: new WeakMap(),
	};
	t.after(() => {
		if (previous === undefined) delete globalRegistry[REVIEW_SESSION_PERMISSION_REGISTRY_SYMBOL];
		else globalRegistry[REVIEW_SESSION_PERMISSION_REGISTRY_SYMBOL] = previous;
	});
	const identity = await captureReviewSessionIdentity(context(root, {}, "session"), {});
	assert.ok(identity);
	assert.equal(grantReviewSessionPermission(identity), false);
	assert.equal(hasReviewSessionPermission(identity), false);
});
