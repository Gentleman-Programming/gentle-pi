// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

const {
	AUTONOMOUS_GUARD_DEFAULTS,
	commandRequiresConfirmation,
	evaluateDeniedCommand,
	evaluateRuntimeGuardCommand,
	guardedCommandFor,
} = await import("../lib/runtime-guardrails.ts");

function autonomousProfile(overrides = {}) {
	return {
		autonomousMode: true,
		guardedCommands: { ...AUTONOMOUS_GUARD_DEFAULTS, ...overrides },
	};
}

test("autonomous runtime profile allows normal git push but denied force push wins first", () => {
	const profile = autonomousProfile();

	assert.equal(
		evaluateRuntimeGuardCommand("git push origin feature/test", profile),
		undefined,
	);
	const forcePush = evaluateDeniedCommand(
		"git push --force origin feature/test",
	);
	assert.equal(forcePush && forcePush.block, true);
	const forceWithLeasePush = evaluateDeniedCommand(
		"git push --force-with-lease origin feature/test",
	);
	assert.equal(forceWithLeasePush && forceWithLeasePush.block, true);
	const shortForcePush = evaluateDeniedCommand(
		"git push -f origin feature/test",
	);
	assert.equal(shortForcePush && shortForcePush.block, true);
});

test("autonomous runtime defaults block publish and keep rebase/delete/remove on confirmation path", () => {
	const profile = autonomousProfile();
	const publish = evaluateRuntimeGuardCommand("npm publish", profile);
	assert.equal(publish && publish.block, true);
	assert.match(
		publish ? publish.reason : "",
		/autonomous runtime permission profile/,
	);

	assert.equal(
		evaluateRuntimeGuardCommand("git rebase main", profile),
		undefined,
	);
	assert.equal(commandRequiresConfirmation("git rebase main"), true);
	assert.equal(
		evaluateRuntimeGuardCommand(
			"git branch --delete --force old-branch",
			profile,
		),
		undefined,
	);
	assert.equal(
		commandRequiresConfirmation("git branch --delete --force old-branch"),
		true,
	);
	assert.equal(commandRequiresConfirmation("git branch -df old-branch"), true);
	assert.equal(commandRequiresConfirmation("git branch -fd old-branch"), true);
	assert.equal(
		evaluateRuntimeGuardCommand("pi remove package", profile),
		undefined,
	);
	assert.equal(commandRequiresConfirmation("pi remove package"), true);
});

test("allow action is distinguishable from unguarded commands", () => {
	const profile = autonomousProfile();
	assert.equal(guardedCommandFor("git push origin feature/test"), "gitPush");
	assert.equal(
		evaluateRuntimeGuardCommand("git push origin feature/test", profile),
		undefined,
	);
	assert.equal(guardedCommandFor("echo ok"), undefined);
	assert.equal(evaluateRuntimeGuardCommand("echo ok", profile), undefined);
});

test("runtime guard profile overrides can block or allow guarded commands", () => {
	const globalProfile = autonomousProfile({
		gitPush: "block",
		npmPublish: "allow",
	});
	const blockedPush = evaluateRuntimeGuardCommand(
		"git push origin feature/test",
		globalProfile,
	);
	assert.equal(blockedPush && blockedPush.block, true);
	assert.equal(
		evaluateRuntimeGuardCommand("npm publish", globalProfile),
		undefined,
	);

	const projectProfile = autonomousProfile({
		gitPush: "allow",
		npmPublish: "block",
	});
	assert.equal(
		evaluateRuntimeGuardCommand("git push origin feature/test", projectProfile),
		undefined,
	);
	const blockedPublish = evaluateRuntimeGuardCommand(
		"npm publish",
		projectProfile,
	);
	assert.equal(blockedPublish && blockedPublish.block, true);
});
