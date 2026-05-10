import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({
	Container: class {
		clear(): void {}
		addChild(): void {}
		invalidate(): void {}
	},
	Text: class {
		constructor(
			readonly text: string,
			readonly x: number,
			readonly y: number,
		) {}
		setText(): void {}
	},
	truncateToWidth: (value: string) => value,
}));

import { createRollbackCheckpoint } from "../../../src/core/gentle-pi/backup.js";
import { evaluateGentlePiCommandPolicy } from "../../../src/core/gentle-pi/security-policy.js";
import { createBashToolDefinition } from "../../../src/core/tools/bash.js";

describe("gentle pi safety harness", () => {
	let tempRoot: string;

	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-gentle-safety-"));
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	it("allows safe commands and marks mutating apply commands for checkpoints", () => {
		expect(
			evaluateGentlePiCommandPolicy({ command: "npm --prefix packages/coding-agent run test", phase: "apply" }),
		).toEqual({
			action: "allow",
			reason: "command-within-gentle-pi-policy",
			checkpoint: false,
		});

		expect(evaluateGentlePiCommandPolicy({ command: "npx biome check --write .", phase: "apply" })).toEqual({
			action: "allow",
			reason: "state mutation requires rollback checkpoint",
			checkpoint: true,
		});
	});

	it("denies destructive and forbidden commands before execution", () => {
		expect(evaluateGentlePiCommandPolicy({ command: "git reset --hard", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "git reset --hard=HEAD", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "git clean --force -d", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "git clean -d --force", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "git clean -fd", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "npm run build", phase: "apply" })).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "npm run build -- --watch", phase: "apply" })).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "npm --prefix . run build", phase: "apply" })).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
		expect(
			evaluateGentlePiCommandPolicy({
				command: "npm --workspace @earendil-works/pi-coding-agent run build",
				phase: "apply",
			}),
		).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
		expect(
			evaluateGentlePiCommandPolicy({ command: "npm --prefix packages/coding-agent run build", phase: "apply" }),
		).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "sleep 1 & npm run build", phase: "apply" })).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "git checkout -- .", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "git checkout -- ./", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "git checkout .", phase: "apply" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(
			evaluateGentlePiCommandPolicy({ command: "cd packages/coding-agent && npm test -- foo", phase: "apply" }),
		).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "FOO=bar npm run test -- --runInBand", phase: "apply" })).toEqual(
			{
				action: "deny",
				reason: "forbidden project command is blocked by Gentle Pi policy",
				checkpoint: false,
			},
		);
		expect(evaluateGentlePiCommandPolicy({ command: "sh -c 'npm run build -- --watch'", phase: "apply" })).toEqual({
			action: "deny",
			reason: "forbidden project command is blocked by Gentle Pi policy",
			checkpoint: false,
		});
	});

	it("does not deny commands that only mention forbidden commands as data", () => {
		expect(evaluateGentlePiCommandPolicy({ command: "echo npm run build -- --watch", phase: "apply" })).toEqual({
			action: "allow",
			reason: "command-within-gentle-pi-policy",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "npm run build-docs", phase: "apply" })).toEqual({
			action: "allow",
			reason: "command-within-gentle-pi-policy",
			checkpoint: false,
		});
	});

	it("keeps global deny safety but does not checkpoint without an explicit active phase", () => {
		expect(evaluateGentlePiCommandPolicy({ command: "git reset --hard" })).toEqual({
			action: "deny",
			reason: "destructive git command is forbidden",
			checkpoint: false,
		});
		expect(evaluateGentlePiCommandPolicy({ command: "npx biome check --write ." })).toEqual({
			action: "allow",
			reason: "command-within-gentle-pi-policy",
			checkpoint: false,
		});
	});

	it("creates checkpoint metadata before tracked state mutation", () => {
		mkdirSync(join(tempRoot, "openspec"), { recursive: true });
		writeFileSync(join(tempRoot, "openspec", "config.yaml"), "schema: spec-driven\n");

		const checkpoint = createRollbackCheckpoint({
			projectRoot: tempRoot,
			changeName: "gentle-pi-agent",
			phase: "apply",
			files: ["openspec/config.yaml"],
			reason: "state mutation requires rollback checkpoint",
		});

		expect(checkpoint.metadata.changeName).toBe("gentle-pi-agent");
		expect(checkpoint.metadata.files).toEqual(["openspec/config.yaml"]);
		expect(checkpoint.copies[0].source).toBe(join(tempRoot, "openspec", "config.yaml"));
		expect(checkpoint.copies[0].checkpointPath).toContain("openspec/config.yaml");
	});

	it("bash tool honors pre-exec policy denial without calling operations", async () => {
		let executed = false;
		const definition = createBashToolDefinition(tempRoot, {
			operations: {
				exec: async () => {
					executed = true;
					return { exitCode: 0 };
				},
			},
			preExecPolicy: (context) => evaluateGentlePiCommandPolicy({ command: context.command, phase: "apply" }),
		});

		const ctx = {} as Parameters<typeof definition.execute>[4];

		await expect(
			definition.execute("call", { command: "git reset --hard" }, undefined, undefined, ctx),
		).rejects.toThrow("destructive git command is forbidden");
		expect(executed).toBe(false);
	});

	it("bash tool creates rollback checkpoint before executing a mutating command", async () => {
		const calls: string[] = [];
		const definition = createBashToolDefinition(tempRoot, {
			operations: {
				exec: async (_command, _cwd, { onData }) => {
					calls.push("exec");
					onData(Buffer.from("formatted"));
					return { exitCode: 0 };
				},
			},
			preExecPolicy: (context) => evaluateGentlePiCommandPolicy({ command: context.command, phase: "apply" }),
			checkpointHook: (context) => {
				calls.push(`checkpoint:${context.decision.reason}`);
			},
		});

		const ctx = {} as Parameters<typeof definition.execute>[4];

		const result = await definition.execute(
			"call",
			{ command: "npx biome check --write ." },
			undefined,
			undefined,
			ctx,
		);

		expect(result.content).toEqual([{ type: "text", text: "formatted" }]);
		expect(calls).toEqual(["checkpoint:state mutation requires rollback checkpoint", "exec"]);
	});
});
