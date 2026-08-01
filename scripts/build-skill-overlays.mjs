#!/usr/bin/env node
// Generates skills/<name>/SKILL.md from a vendored provider body plus a
// hand-authored overlay of ordered, anchored Pi deltas. See design.md D8
// ("Skill vendor and overlay").
//
//   skills/_vendor/<name>/SKILL.md   written only by the sync script, read-only
//                                     to humans -- a byte mirror of the
//                                     provider's skill.
//   skills/_vendor/<name>/overlay.md hand-authored, ordered [anchor]/[replace]
//                                     blocks: each finds its anchor text
//                                     verbatim exactly once in the vendored
//                                     body and replaces it with Pi's delta.
//   skills/<name>/SKILL.md           this script's output: vendored body with
//                                     every overlay block applied, in order.
//
// Two failures are caught, both loudly, never silently:
//
//   1. A hand-edit of a vendored `skills/_vendor/**/SKILL.md` file. The
//      drift gate recomputes its digest and compares it against the one
//      recorded in `skills/_vendor/manifest.json` at vendor time.
//   2. An overlay anchor that no longer exists (or now occurs more than
//      once) in the vendored body -- typically because an upstream reword
//      silently dropped the exact sentence/line a Pi delta depended on.
//      This is the quieter, more dangerous failure under a fast provider
//      cadence, so it fails the build rather than degrading the anchor into
//      a fuzzy match.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const VENDOR_ROOT_RELATIVE_PATH = "skills/_vendor";
const MANIFEST_RELATIVE_PATH = "skills/_vendor/manifest.json";

// The complete set of provider skill candidates evaluated for this change.
// Each name below was compared, file by file, against gentle-ai's copy
// before admission -- being on the original candidate list never admits a
// skill by itself. Order matches tasks.md 6.4 (first tier) then 6.5 (second
// tier), in the order each was reviewed.
export const VENDORED_SKILLS = Object.freeze([
	// First tier (task 6.4) -- all five passed.
	"comment-writer",
	"work-unit-commits",
	"branch-pr",
	"chained-pr",
	"cognitive-doc-design",
	// Second tier (task 6.5) -- two of four passed; see REJECTED_CANDIDATES.
	"skill-improver",
	"skill-registry",
]);

// Second-tier candidates that were compared and rejected: their content
// diverged from gentle-ai's copy far beyond what an ordered anchored overlay
// can represent as bounded, individually reviewable deltas (near-total
// section rewrites, not a handful of sentences/lines). Admitting either
// would mean one overlay anchor spanning almost the entire body -- exactly
// the "full fork" shape design.md D8 rejected as an overlay representation,
// because it hides what Pi actually changed instead of showing it. They
// stay directly Pi-maintained, outside this pipeline, same as any other
// hand-authored skill.
export const REJECTED_CANDIDATES = Object.freeze(["judgment-day", "skill-creator"]);

// Excluded entirely: never a vendoring candidate, never drift-gated. Each
// repository's copy intentionally describes a different repository (its own
// name, its own label taxonomy, its own privacy-redaction rules) -- that is
// identity, not drift to reconcile.
export const EXCLUDED_SKILLS = Object.freeze(["issue-creation"]);

export function sha256Hex(content) {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

// Parses `overlay.md`'s ordered `<!-- overlay:block -->` sections into
// `{ anchor, replace }` pairs, preserving file order. Anchor/replace text is
// captured verbatim (including its own trailing newline) so it can be
// substituted into the vendored body with a plain string replace.
export function parseOverlayBlocks(overlayMarkdown) {
	const blockPattern = /<!-- overlay:block -->\n<!-- overlay:anchor -->\n([\s\S]*?)<!-- overlay:replace -->\n([\s\S]*?)<!-- overlay:end -->/g;
	const blocks = [];
	let match = blockPattern.exec(overlayMarkdown);
	while (match !== null) {
		blocks.push({ anchor: match[1], replace: match[2] });
		match = blockPattern.exec(overlayMarkdown);
	}
	return blocks;
}

// Applies every overlay block, in order, to the vendored body. An anchor
// that is missing -- or now ambiguous (occurs more than once) -- fails
// loudly rather than silently skipping or guessing a target: the fix is
// always to edit the overlay so it matches the new upstream wording, never
// to hand-edit the vendored file (which the next sync would overwrite
// anyway).
export function applyOverlay(vendoredBody, blocks, name) {
	let body = vendoredBody;
	for (const { anchor, replace } of blocks) {
		const occurrences = body.split(anchor).length - 1;
		if (occurrences !== 1) {
			throw new Error(`edit the overlay, not the vendored file: skills/_vendor/${name}/overlay.md`);
		}
		body = body.replace(anchor, replace);
	}
	return body;
}

async function readJson(relativePath) {
	return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

async function buildOneSkill(name, entry, mode) {
	const vendoredPath = join(root, entry.path);
	const vendoredBody = await readFile(vendoredPath, "utf8");
	const actualDigest = sha256Hex(vendoredBody);
	if (actualDigest !== entry.sha256) {
		throw new Error(
			`vendored skill file has drifted from its recorded digest (hand-edited?): ${entry.path} ` +
			`(expected sha256:${entry.sha256}, got sha256:${actualDigest}) -- ` +
			`edit skills/_vendor/${name}/overlay.md instead, never this file directly; ` +
			`the vendored body is written only by the sync script.`,
		);
	}

	const overlaySource = await readFile(join(root, VENDOR_ROOT_RELATIVE_PATH, name, "overlay.md"), "utf8");
	const blocks = parseOverlayBlocks(overlaySource);
	const generated = applyOverlay(vendoredBody, blocks, name);

	const destinationRelativePath = `skills/${name}/SKILL.md`;
	const destination = join(root, destinationRelativePath);
	if (mode === "--write") {
		await writeFile(destination, generated, "utf8");
		return { name, status: "written" };
	}
	let actual;
	try {
		actual = await readFile(destination, "utf8");
	} catch {
		actual = undefined;
	}
	if (actual !== generated) {
		throw new Error(`generated skill file is stale: ${destinationRelativePath}`);
	}
	return { name, status: "checked" };
}

async function main() {
	const mode = process.argv[2];
	if ((mode !== "--write" && mode !== "--check") || process.argv.length !== 3) {
		throw new Error("usage: build-skill-overlays.mjs --write|--check");
	}

	const manifest = await readJson(MANIFEST_RELATIVE_PATH);
	const names = Object.keys(manifest.skills).sort();
	const results = [];
	for (const name of names) {
		results.push(await buildOneSkill(name, manifest.skills[name], mode));
	}

	for (const name of REJECTED_CANDIDATES) {
		if (names.includes(name)) {
			throw new Error(`${name} is a rejected portability-comparison candidate and must not appear in ${MANIFEST_RELATIVE_PATH}`);
		}
	}
	for (const name of EXCLUDED_SKILLS) {
		if (names.includes(name)) {
			throw new Error(`${name} is excluded entirely from vendoring and must not appear in ${MANIFEST_RELATIVE_PATH}`);
		}
	}

	const verb = mode === "--write" ? "generated" : "match their checked-in sources";
	process.stdout.write(`skill overlays ${verb} (${results.length} skills: ${names.join(", ")})\n`);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
