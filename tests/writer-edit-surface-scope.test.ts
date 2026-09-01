import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";

// ---------------------------------------------------------------------------
// Bounded writer edit-surface scope guard (issue #484).
//
// The guard reads the `## Allowed edit surfaces` section out of the delegated
// `subagent_run` prompt. A delegated task is a full prompt: the surfaces list
// is followed by deeper headings (`### Validation`, `#### Return`) and by
// ordinary prose. The section remains fail-closed through ordinary prose until
// the next canonical Markdown heading, so following content is always parsed as
// a surface entry rather than silently discarded. A `context` value carrying
// only the heading and its lines had nothing following it, which is why the same
// surfaces were accepted there and rejected in `task`.
//
// Every case below runs through the real `tool_call` hook with the exact
// `subagent_run` input shape, because that is the boundary that rejected.
// ---------------------------------------------------------------------------

const REJECTION =
	"Writer tasks must include the exact Markdown heading `## Allowed edit surfaces` with narrow repository-relative paths or narrow globs, one per line. Every non-empty line belongs to the section until the next canonical Markdown heading and must be a valid surface entry. Paths containing whitespace require whole-entry backticks; begin explanatory prose under the next Markdown heading. The parent must derive or map that canonical block from the delegated task and relaunch the writer; do not accept aliases, and do not ask the human to author paths or globs.";

type ToolCallHandler = (
	event: { toolName: string; input: unknown },
	ctx: ExtensionContext,
) => Promise<{ block: true; reason: string } | undefined>;

const scratchRoots: string[] = [];

after(() => {
	for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

function dispatchWriter(input: Record<string, unknown>) {
	const handlers = new Map<string, ToolCallHandler>();
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-writer-surfaces-"));
	scratchRoots.push(cwd);
	return toolCall!({ toolName: "subagent_run", input }, {
		cwd,
		hasUI: false,
		ui: { confirm: async () => true },
	} as ExtensionContext);
}

async function assertAccepted(input: Record<string, unknown>, message: string) {
	assert.equal(await dispatchWriter(input), undefined, message);
}

async function assertRejected(input: Record<string, unknown>, message: string) {
	assert.deepEqual(await dispatchWriter(input), { block: true, reason: REJECTION }, message);
}

test("task-scoped surfaces are accepted ahead of a deeper heading", async () => {
	await assertAccepted({
		agent: "gentle-ai-worker",
		mode: "task",
		task: [
			"Fix the decoder.",
			"",
			"## Allowed edit surfaces",
			"- `lib/sdd-status.ts`",
			"- `tests/sdd-status.test.ts`",
			"",
			"### Validation commands",
			"- pnpm test",
			"",
			"#### Return",
			"- one structured envelope",
		].join("\n"),
	}, "a delegated task ends its surfaces list at the next heading of any level");
});

test("task-scoped surfaces reject trailing prose before the next heading", async () => {
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: [
			"## Allowed edit surfaces",
			"- `lib/sdd-status.ts`",
			"",
			"Then run the focused test file and report the outcome.",
		].join("\n"),
	}, "trailing prose must begin under a following Markdown heading");
});

test("canonical headings close the surface section with up to three ASCII spaces", async () => {
	for (const indentation of ["", " ", "  ", "   "]) {
		await assertAccepted({
			agent: "gentle-ai-worker",
			mode: "task",
			task: [
				"## Allowed edit surfaces",
				"- `lib/sdd-status.ts`",
				`${indentation}### Validation`,
				"node --test",
			].join("\n"),
		}, `${JSON.stringify(indentation)} indentation closes the section`);
	}
});

test("pseudo-headings remain inside the surface section and reject dangerous paths", async () => {
	for (const [label, heading] of [
		["four-space indentation", "    ### Validation"],
		["seven hashes", "####### Validation"],
		["bare marker", "###"],
		["missing heading separator", "###Validation"],
		["tab", "###\tValidation"],
		["vertical tab", "###\vValidation"],
		["form feed", "###\fValidation"],
		["bare carriage return", "###\rValidation"],
		["NBSP", "###\u00a0Validation"],
		["em space", "###\u2003Validation"],
		["Ogham space", "###\u1680Validation"],
		["line separator", "###\u2028Validation"],
		["paragraph separator", "###\u2029Validation"],
	] as const) {
		await assertRejected({
			agent: "gentle-ai-worker",
			mode: "task",
			task: [
				"## Allowed edit surfaces",
				"- `lib/sdd-status.ts`",
				heading,
				"/etc/passwd",
			].join("\n"),
		}, `${label} pseudo-heading cannot close the surface section`);
	}
});

test("only ASCII spaces may separate Markdown list markers from entries", async () => {
	for (const [label, separator] of [
		["NBSP", "\u00a0"],
		["em space", "\u2003"],
		["Ogham space", "\u1680"],
		["tab", "\t"],
	] as const) {
		await assertRejected({
			agent: "gentle-ai-worker",
			mode: "task",
			task: ["## Allowed edit surfaces", `-${separator}\`lib/sdd-status.ts\``].join("\n"),
		}, `${label} cannot separate a list marker and entry`);
	}
	await assertAccepted({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "- `lib/sdd-status.ts`", "1. tests/sdd-status.test.ts"].join("\n"),
	}, "ASCII-space bullets and numbered entries remain accepted");
});

test("the documented task shape from issue #484 is accepted", async () => {
	await assertAccepted({
		agent: "gentle-ai-worker",
		mode: "task",
		task: [
			"## Allowed edit surfaces",
			"- `lib/sdd-status.ts`",
			"- `tests/sdd-status.test.ts`",
			"",
			"## Skills to load before work",
			"- `skills/typescript/SKILL.md`",
		].join("\n"),
	}, "the reported repro shape stays accepted");
});

test("bullet, backtick and plain-line surfaces reach the same decision", async () => {
	const bulleted = ["## Allowed edit surfaces", "- `lib/sdd-status.ts`", "- `tests/sdd-status.test.ts`"].join("\n");
	const plain = ["## Allowed edit surfaces", "lib/sdd-status.ts", "tests/sdd-status.test.ts"].join("\n");
	await assertAccepted({ agent: "gentle-ai-worker", mode: "task", task: bulleted }, "bullets in task are accepted");
	await assertAccepted({ agent: "gentle-ai-worker", mode: "task", task: plain }, "plain lines in task are accepted");
	await assertAccepted(
		{ agent: "gentle-ai-worker", mode: "task", task: "Fix the decoder.", context: bulleted },
		"bullets in context are accepted",
	);
	await assertAccepted(
		{ agent: "gentle-ai-worker", mode: "task", task: "Fix the decoder.", context: plain },
		"plain lines in context are accepted",
	);
	await assertAccepted(
		{ agent: "gentle-ai-worker", mode: "task", task: bulleted, context: plain },
		"the same surfaces in both fields are accepted",
	);
	await assertAccepted(
		{
			agent: "gentle-ai-worker",
			mode: "task",
			task: ["## Allowed edit surfaces", "extensions/**/*.ts", "tests/*.test.ts"].join("\n"),
		},
		"narrow no-space globs remain accepted",
	);
});

test("a list broken by a blank line still validates every entry", async () => {
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "- `lib/sdd-status.ts`", "", "- `/etc/passwd`"].join("\n"),
	}, "a loose bulleted list cannot smuggle an absolute path past the guard");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		context: ["## Allowed edit surfaces", "lib/sdd-status.ts", "", "/etc/passwd"].join("\n"),
	}, "a loose plain-line list cannot smuggle an absolute path past the guard");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "lib/sdd-status.ts", "", "../other-repo/lib/a.ts"].join("\n"),
	}, "a loose plain-line list cannot smuggle parent traversal past the guard");
});

test("an entry hidden below a paragraph is validated, not discarded", async () => {
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: [
			"## Allowed edit surfaces",
			"- `lib/sdd-status.ts`",
			"",
			"Also authorize the following path.",
			"- `/etc/passwd`",
		].join("\n"),
	}, "prose cannot close the section while a path still follows it");
});

test("whitespace-bearing surfaces require whole-entry backticks", async () => {
	const backtickedSpaced = [
		"## Allowed edit surfaces",
		"- `Directory With Spaces/note.md`",
		"`Directory\u00a0With\u2003Spaces/unicode.md`",
	];
	const equivalentBacktickedSpaced = [
		"## Allowed edit surfaces",
		"`Directory With Spaces/note.md`",
		"- `Directory\u00a0With\u2003Spaces/unicode.md`",
	];

	await assertAccepted(
		{ agent: "gentle-ai-worker", mode: "task", task: backtickedSpaced.join("\n") },
		"whole-entry backticked ASCII and Unicode space-separator paths are accepted",
	);
	await assertAccepted(
		{ agent: "gentle-ai-worker", mode: "task", task: backtickedSpaced.join("\n"), context: equivalentBacktickedSpaced.join("\n") },
		"task and context compare equivalent backticked whitespace-bearing paths by value",
	);
	await assertAccepted({
		agent: "gentle-ai-worker",
		mode: "task",
		task: [...backtickedSpaced, "### Validation", "node --test"].join("\n"),
	}, "the next Markdown heading closes a backticked whitespace-bearing surface section");

	for (const [label, entry] of [
		["bare spaced path", "Directory With Spaces/note.md"],
		["bare bulleted spaced path", "- Directory With Spaces/note.md"],
		["bare NBSP path", "Directory\u00a0With Spaces/note.md"],
		["bare em-space path", "Directory\u2003With Spaces/note.md"],
		["U+0085 control path", "`Directory\u0085With Spaces/note.md`"],
		["U+0085 list separator", "-\u0085`lib/sdd-status.ts`"],
		["U+2028 line-separator path", "`Directory\u2028With Spaces/note.md`"],
		["U+2029 paragraph-separator path", "`Directory\u2029With Spaces/note.md`"],
		["list-marked prose", "- Then run the focused test file."],
		["marker-only hyphen", "-"],
		["empty backticks", "``"],
		["unclosed backticks", "`lib/sdd-status.ts"],
		["partially backticked path", "`lib/sdd-status.ts` trailing"],
		["absolute spaced path", "/tmp/Outside Directory/file.md"],
		["parent spaced path", "../Other Directory/file.md"],
		["home spaced path", "~/Private Directory/file.md"],
		["Windows spaced path", "C:\\Outside Directory\\file.md"],
		["dangerous backticked bullet", "- `/tmp/Outside Directory/file.md`"],
	] as const) {
		await assertRejected({
			agent: "gentle-ai-worker",
			mode: "task",
			task: ["## Allowed edit surfaces", "lib/sdd-status.ts", entry].join("\n"),
		}, `${label} after a valid entry is rejected`);
		await assertRejected({
			agent: "gentle-ai-worker",
			mode: "task",
			task: ["## Allowed edit surfaces", entry, "lib/sdd-status.ts"].join("\n"),
		}, `${label} before a valid entry is rejected`);
	}
});

test("out-of-scope and empty surfaces stay rejected", async () => {
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: "Fix the decoder.",
	}, "a task with no section is rejected");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Edit ranges", "- `lib/sdd-status.ts`"].join("\n"),
	}, "a semantically equivalent heading is rejected with the actionable canonical-heading reason");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "", "## Skills to load before work", "- `skills/typescript/SKILL.md`"].join("\n"),
	}, "an empty section is rejected");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "- `/home/user/repo/lib/sdd-status.ts`"].join("\n"),
	}, "an absolute path is rejected");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "- `../other-repo/lib/sdd-status.ts`"].join("\n"),
	}, "parent traversal is rejected");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "- `.`"].join("\n"),
	}, "the repository root is rejected");
	await assertRejected({
		agent: "gentle-ai-worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "- `*`"].join("\n"),
	}, "a repository-wide glob is rejected");
	await assertRejected({
		agent: "worker",
		mode: "task",
		task: ["## Allowed edit surfaces", "- `~/lib/sdd-status.ts`"].join("\n"),
	}, "a home-relative path is rejected for the configured worker too");
});

test("agents outside the bounded writer set are not scope-guarded", async () => {
	await assertAccepted({
		agent: "gentle-ai-explore",
		mode: "task",
		task: "Map the decoder call sites.",
	}, "a read-only explorer needs no edit surfaces");
});
