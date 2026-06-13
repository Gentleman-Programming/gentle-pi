import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

const { classifyGuardedCommand } = __testing;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "gentle-pi-autonomous-"));
}

function writeConfig(dir: string, relPath: string, content: unknown): void {
	const full = join(dir, relPath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, JSON.stringify(content, null, 2));
}

// ---------------------------------------------------------------------------
// classifyGuardedCommand — base contract
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git push plain → confirm by default (no autonomous mode)", () => {
	const result = classifyGuardedCommand("git push origin main", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git rebase → confirm by default (no autonomous mode)", () => {
	const result = classifyGuardedCommand("git rebase main", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: npm publish → confirm by default (no autonomous mode)", () => {
	const result = classifyGuardedCommand("npm publish", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: unknown command → not-guarded", () => {
	const result = classifyGuardedCommand("echo hello", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "not-guarded");
});

// ---------------------------------------------------------------------------
// Hard-deny always blocks regardless of autonomous mode or config
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git push --force always blocked even with gitPush=allow", () => {
	const result = classifyGuardedCommand("git push --force origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git push --force-with-lease always blocked", () => {
	const result = classifyGuardedCommand("git push --force-with-lease origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git push -f always blocked even in autonomous mode", () => {
	const result = classifyGuardedCommand("git push -f origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git reset --hard always blocked", () => {
	const result = classifyGuardedCommand("git reset --hard HEAD~1", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: rm -rf / always blocked", () => {
	const result = classifyGuardedCommand("rm -rf /", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: rm -rf ~ always blocked", () => {
	const result = classifyGuardedCommand("rm -rf ~", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: chmod -R 777 always blocked", () => {
	const result = classifyGuardedCommand("chmod -R 777 /etc", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

// ---------------------------------------------------------------------------
// Autonomous mode + allow action
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git push plain allowed when autonomousMode=true and gitPush=allow", () => {
	const result = classifyGuardedCommand("git push origin feature/test", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "allow");
});

test("classifyGuardedCommand: git push plain still confirm when autonomousMode=false even with gitPush=allow in config", () => {
	const result = classifyGuardedCommand("git push origin feature/test", {
		autonomousMode: false,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "confirm");
});

// ---------------------------------------------------------------------------
// Autonomous mode + confirm action (stays gated)
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git rebase stays confirm when autonomousMode=true and gitRebase=confirm", () => {
	const result = classifyGuardedCommand("git rebase main", {
		autonomousMode: true,
		guardedCommands: { gitRebase: "confirm" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git branch -D stays confirm in autonomous mode (gitBranchDeleteForce=confirm)", () => {
	const result = classifyGuardedCommand("git branch -D old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "confirm" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git branch -df stays confirm in autonomous mode", () => {
	const result = classifyGuardedCommand("git branch -df old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "confirm" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git branch --delete --force stays confirm in autonomous mode", () => {
	const result = classifyGuardedCommand("git branch --delete --force old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "confirm" },
	});
	assert.equal(result, "confirm");
});

// ---------------------------------------------------------------------------
// Autonomous mode + block action
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: npm publish blocked when autonomousMode=true and npmPublish=block", () => {
	const result = classifyGuardedCommand("npm publish", {
		autonomousMode: true,
		guardedCommands: { npmPublish: "block" },
	});
	assert.equal(result, "block");
});

// ---------------------------------------------------------------------------
// loadRuntimeGuardrailsConfig — file loading
// ---------------------------------------------------------------------------

test("loadRuntimeGuardrailsConfig: returns off config when no file exists", () => {
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: env var GENTLE_PI_AUTONOMOUS_MODE=1 activates mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "1";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

test("loadRuntimeGuardrailsConfig: global config file activates autonomous mode", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: true,
			guardedCommands: { gitPush: "allow" },
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, true);
		assert.equal(config.guardedCommands.gitPush, "allow");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: project config overrides global config", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		const projectDir = join(dir, "project");

		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: true,
			guardedCommands: { gitPush: "allow", npmPublish: "confirm" },
		});
		writeConfig(projectDir, join(".pi", "gentle-ai", "runtime-guardrails.json"), {
			autonomousMode: true,
			guardedCommands: { gitPush: "confirm", npmPublish: "block" },
		});

		const config = __testing.loadRuntimeGuardrailsConfig(projectDir, {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, true);
		assert.equal(config.guardedCommands.gitPush, "confirm");
		assert.equal(config.guardedCommands.npmPublish, "block");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: invalid JSON in config fails safe (autonomousMode=false)", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		const configPath = join(globalConfigDir, "runtime-guardrails.json");
		mkdirSync(globalConfigDir, { recursive: true });
		writeFileSync(configPath, "{ not valid json }");

		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: non-object JSON fails safe", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", [1, 2, 3]);

		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: invalid project config fails safe (autonomousMode=false)", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		const projectDir = join(dir, "project");

		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: true,
			guardedCommands: { gitPush: "allow" },
		});
		const projectConfigPath = join(
			projectDir,
			".pi",
			"gentle-ai",
			"runtime-guardrails.json",
		);
		mkdirSync(dirname(projectConfigPath), { recursive: true });
		writeFileSync(projectConfigPath, "{ bad json }");

		const config = __testing.loadRuntimeGuardrailsConfig(projectDir, {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// When autonomous mode is OFF nothing changes vs current behavior
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: pi remove confirm when autonomousMode=false", () => {
	const result = classifyGuardedCommand("pi remove my-package", {
		autonomousMode: false,
		guardedCommands: { piRemove: "allow" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: pi remove allowed when autonomousMode=true and piRemove=allow", () => {
	const result = classifyGuardedCommand("pi remove my-package", {
		autonomousMode: true,
		guardedCommands: { piRemove: "allow" },
	});
	assert.equal(result, "allow");
});

// ---------------------------------------------------------------------------
// Fix 1: git global flags bypass — git -C <dir> push / git --work-tree push
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git -C /repo push --force → block even with gitPush=allow", () => {
	const result = classifyGuardedCommand("git -C /repo push --force origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git --work-tree=/tmp push --force → block", () => {
	const result = classifyGuardedCommand("git --work-tree=/tmp push --force origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git -C /repo push -f → block", () => {
	const result = classifyGuardedCommand("git -C /repo push -f origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git -C /repo push origin feat → classified as gitPush (allow when configured)", () => {
	const result = classifyGuardedCommand("git -C /repo push origin feat", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "allow");
});

test("classifyGuardedCommand: git -C /repo push origin feat → confirm when autonomousMode=false", () => {
	const result = classifyGuardedCommand("git -C /repo push origin feat", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

// ---------------------------------------------------------------------------
// Fix 2: rm -rf $HOME was not blocked (dead regex branch)
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: rm -rf $HOME → block", () => {
	const result = classifyGuardedCommand("rm -rf $HOME", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: rm -rf $HOME/foo → block", () => {
	const result = classifyGuardedCommand("rm -rf $HOME/foo", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

// ---------------------------------------------------------------------------
// Fix 5a: gitBranchDeleteForce allow path is tested
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: gitBranchDeleteForce=allow in autonomous mode → allow", () => {
	const result = classifyGuardedCommand("git branch -D old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "allow" },
	});
	assert.equal(result, "allow");
});

// ---------------------------------------------------------------------------
// Fix 5b: AUTONOMOUS_DEFAULT_ACTIONS fallback — empty guardedCommands in autonomous mode
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: autonomousMode=true, empty guardedCommands, gitPush defaults to allow", () => {
	const result = classifyGuardedCommand("git push origin main", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "allow");
});

// ---------------------------------------------------------------------------
// Fix 5c: env var negatives — only "1" activates autonomous mode
// ---------------------------------------------------------------------------

test("loadRuntimeGuardrailsConfig: GENTLE_PI_AUTONOMOUS_MODE=0 does NOT activate autonomous mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "0";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

test("loadRuntimeGuardrailsConfig: GENTLE_PI_AUTONOMOUS_MODE=true does NOT activate autonomous mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "true";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

test("loadRuntimeGuardrailsConfig: GENTLE_PI_AUTONOMOUS_MODE='' does NOT activate autonomous mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

// ---------------------------------------------------------------------------
// Fix 5d: JSON config autonomousMode strict === true check
// ---------------------------------------------------------------------------

test("loadRuntimeGuardrailsConfig: autonomousMode:1 (number) in JSON does NOT activate autonomous mode", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: 1,
			guardedCommands: {},
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('loadRuntimeGuardrailsConfig: autonomousMode:"true" (string) in JSON does NOT activate autonomous mode', () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: "true",
			guardedCommands: {},
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: autonomousMode:{} (object) in JSON does NOT activate autonomous mode", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: {},
			guardedCommands: {},
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
