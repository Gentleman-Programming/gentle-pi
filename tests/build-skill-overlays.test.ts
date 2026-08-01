import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	applyOverlay,
	parseOverlayBlocks,
	sha256Hex,
	VENDORED_SKILLS,
	EXCLUDED_SKILLS,
	REJECTED_CANDIDATES,
} from "../scripts/build-skill-overlays.mjs";

const root = new URL("..", import.meta.url).pathname;
const fixtureRoot = join(root, "tests/fixtures/skill-overlays/stale-anchor");

// ---------------------------------------------------------------------------
// parseOverlayBlocks / applyOverlay -- happy path.
// ---------------------------------------------------------------------------

test("parseOverlayBlocks extracts anchor/replace pairs in file order", () => {
	const overlay = [
		"# Overlay: example",
		"",
		"<!-- overlay:block -->",
		"<!-- overlay:anchor -->",
		"name: example",
		"<!-- overlay:replace -->",
		"name: gentle-ai-example",
		"<!-- overlay:end -->",
		"<!-- overlay:block -->",
		"<!-- overlay:anchor -->",
		"old line\n",
		"<!-- overlay:replace -->",
		"new line\n",
		"<!-- overlay:end -->",
		"",
	].join("\n");

	const blocks = parseOverlayBlocks(overlay);
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].anchor, "name: example\n");
	assert.equal(blocks[0].replace, "name: gentle-ai-example\n");
	assert.equal(blocks[1].anchor, "old line\n\n");
	assert.equal(blocks[1].replace, "new line\n\n");
});

test("applyOverlay replaces every anchor exactly once, in order", () => {
	const body = "name: example\ndescription: x\n\nold line\n\nmore text\n";
	const blocks = [
		{ anchor: "name: example\n", replace: "name: gentle-ai-example\n" },
		{ anchor: "old line\n", replace: "new line\n" },
	];
	const result = applyOverlay(body, blocks, "example");
	assert.equal(result, "name: gentle-ai-example\ndescription: x\n\nnew line\n\nmore text\n");
});

test("applyOverlay is a no-op over an empty block list (byte-identical admission)", () => {
	const body = "name: example\n";
	assert.equal(applyOverlay(body, [], "example"), body);
});

// ---------------------------------------------------------------------------
// 6.1 -- RED: overlay anchor missing upstream fails the exact message.
// ---------------------------------------------------------------------------

test("applyOverlay fails with the exact overlay-not-vendored message when an anchor no longer exists upstream", () => {
	const vendoredBody = readFileSync(join(fixtureRoot, "vendored.SKILL.md"), "utf8");
	const overlaySource = readFileSync(join(fixtureRoot, "overlay.md"), "utf8");
	const blocks = parseOverlayBlocks(overlaySource);
	assert.throws(
		() => applyOverlay(vendoredBody, blocks, "comment-writer"),
		/^Error: edit the overlay, not the vendored file: skills\/_vendor\/comment-writer\/overlay\.md$/,
	);
});

test("applyOverlay fails the same way when an anchor now occurs more than once (ambiguous replace target)", () => {
	const body = "old line\nold line\n";
	assert.throws(
		() => applyOverlay(body, [{ anchor: "old line\n", replace: "new line\n" }], "duplicate-anchor"),
		/edit the overlay, not the vendored file: skills\/_vendor\/duplicate-anchor\/overlay\.md/,
	);
});

// ---------------------------------------------------------------------------
// 6.2 -- RED: hand-edit of a vendored file is detected by the drift gate.
// ---------------------------------------------------------------------------

test("build-skill-overlays.mjs --check fails when a vendored file has been hand-edited (digest drift)", () => {
	const fixture = mkdtempSync(join(tmpdir(), "gentle-pi-skill-overlays-drift-"));
	try {
		copyRealScriptInto(fixture);
		const recordedBody = "---\nname: example\ndescription: fixture\n---\n\n## Body\n\nOriginal text.\n";
		writeFixtureSkill(fixture, "example", { vendoredBody: recordedBody, overlay: "# Overlay: example\n\nNo Pi-specific delta.\n" });

		// Hand-edit the vendored file directly -- exactly the forbidden action.
		const vendoredPath = join(fixture, "skills/_vendor/example/SKILL.md");
		writeFileSync(vendoredPath, `${recordedBody}\n<!-- hand-edited -->\n`);

		assert.throws(
			() => execFileSync(process.execPath, [join(fixture, "scripts/build-skill-overlays.mjs"), "--check"], { cwd: fixture, encoding: "utf8" }),
			/vendored skill file has drifted from its recorded digest.*skills\/_vendor\/example\/SKILL\.md/s,
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("build-skill-overlays.mjs --check fails with the exact message when a vendored file drops an overlay anchor", () => {
	const fixture = mkdtempSync(join(tmpdir(), "gentle-pi-skill-overlays-anchor-"));
	try {
		copyRealScriptInto(fixture);
		// Reuse the same fixture pair as the pure-function RED test above: the
		// vendored body no longer contains the row the overlay's anchor expects
		// (an upstream reword dropped it), so its digest is recorded honestly
		// against the *current* (rewritten) vendored bytes -- only the anchor
		// itself is stale.
		const vendoredBody = readFileSync(join(fixtureRoot, "vendored.SKILL.md"), "utf8");
		const overlay = readFileSync(join(fixtureRoot, "overlay.md"), "utf8");
		writeFixtureSkill(fixture, "comment-writer", { vendoredBody, overlay });

		assert.throws(
			() => execFileSync(process.execPath, [join(fixture, "scripts/build-skill-overlays.mjs"), "--check"], { cwd: fixture, encoding: "utf8" }),
			/edit the overlay, not the vendored file: skills\/_vendor\/comment-writer\/overlay\.md/,
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// End-to-end CLI over the real, checked-in repository.
// ---------------------------------------------------------------------------

test("build-skill-overlays.mjs --check passes against the real checked-in repository", () => {
	const output = execFileSync(process.execPath, [join(root, "scripts/build-skill-overlays.mjs"), "--check"], { cwd: root, encoding: "utf8" });
	assert.match(output, /skill overlays match their checked-in sources/);
});

test("build-skill-overlays.mjs --write regenerates byte-identical output against the real repository (idempotent)", () => {
	for (const name of VENDORED_SKILLS) {
		const generatedPath = join(root, "skills", name, "SKILL.md");
		const before = readFileSync(generatedPath, "utf8");
		execFileSync(process.execPath, [join(root, "scripts/build-skill-overlays.mjs"), "--write"], { cwd: root, encoding: "utf8" });
		const after = readFileSync(generatedPath, "utf8");
		assert.equal(after, before, `skills/${name}/SKILL.md should be idempotent under --write`);
	}
});

// ---------------------------------------------------------------------------
// 6.4 / 6.5 -- admission list: exactly the candidates that genuinely passed
// their per-file portability comparison, no more.
// ---------------------------------------------------------------------------

test("VENDORED_SKILLS is exactly the first- and second-tier candidates that passed portability comparison", () => {
	assert.deepEqual(
		[...VENDORED_SKILLS].sort(),
		["branch-pr", "chained-pr", "cognitive-doc-design", "comment-writer", "skill-improver", "skill-registry", "work-unit-commits"].sort(),
	);
});

test("REJECTED_CANDIDATES documents judgment-day and skill-creator as failing the portability comparison", () => {
	assert.deepEqual([...REJECTED_CANDIDATES].sort(), ["judgment-day", "skill-creator"]);
	for (const name of REJECTED_CANDIDATES) {
		assert.ok(!VENDORED_SKILLS.includes(name), `${name} must not also be admitted`);
	}
});

for (const name of ["judgment-day", "skill-creator"]) {
	test(`${name} is not vendored: no skills/_vendor/${name} directory exists`, () => {
		assert.throws(() => readFileSync(join(root, "skills/_vendor", name, "SKILL.md"), "utf8"), /ENOENT/);
	});
}

// ---------------------------------------------------------------------------
// 6.6 -- issue-creation is excluded entirely: not vendored, no gate.
// ---------------------------------------------------------------------------

test("issue-creation is excluded entirely: absent from VENDORED_SKILLS and EXCLUDED_SKILLS documents why", () => {
	assert.ok(!VENDORED_SKILLS.includes("issue-creation"));
	assert.ok(EXCLUDED_SKILLS.includes("issue-creation"));
});

test("issue-creation carries no skills/_vendor directory and no overlay", () => {
	assert.throws(() => readFileSync(join(root, "skills/_vendor/issue-creation/SKILL.md"), "utf8"), /ENOENT/);
	assert.throws(() => readFileSync(join(root, "skills/_vendor/issue-creation/overlay.md"), "utf8"), /ENOENT/);
});

// Copies only the generator script itself, with a genuinely empty manifest --
// deliberately never the real repository's manifest.json, whose admitted-skill
// set grows independently of this generator and would otherwise make these
// fixtures try (and fail) to resolve vendor directories that were never copied.
function copyRealScriptInto(fixtureRoot: string) {
	mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
	mkdirSync(join(fixtureRoot, "skills/_vendor"), { recursive: true });
	writeFileSync(join(fixtureRoot, "scripts/build-skill-overlays.mjs"), readFileSync(join(root, "scripts/build-skill-overlays.mjs")));
	writeFileSync(join(fixtureRoot, "skills/_vendor/manifest.json"), JSON.stringify({ skills: {} }, null, 2));
}

// Writes one self-contained fixture skill (vendored body + overlay + a
// correctly recorded manifest digest) into a temp fixture root, independent
// of whatever this repository has actually admitted. Keeps these RED
// scenarios reproducible even before any real admission exists.
function writeFixtureSkill(fixtureRoot: string, name: string, { vendoredBody, overlay }: { vendoredBody: string; overlay: string }) {
	mkdirSync(join(fixtureRoot, "skills/_vendor", name), { recursive: true });
	writeFileSync(join(fixtureRoot, "skills/_vendor", name, "SKILL.md"), vendoredBody);
	writeFileSync(join(fixtureRoot, "skills/_vendor", name, "overlay.md"), overlay);
	const manifestPath = join(fixtureRoot, "skills/_vendor/manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.skills[name] = { path: `skills/_vendor/${name}/SKILL.md`, sha256: sha256Hex(vendoredBody) };
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
