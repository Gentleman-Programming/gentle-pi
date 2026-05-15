import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	analyzeDeltaDestructiveness,
	detectActiveDomainCollisions,
	detectLegacyFlatSpec,
} from "../lib/openspec-guardrails.ts";

test("detectActiveDomainCollisions finds other active changes touching the same domain", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "gentle-pi-guardrails-"));
	mkdirSync(join(cwd, "openspec/changes/current/specs/sdd-openspec"), { recursive: true });
	mkdirSync(join(cwd, "openspec/changes/other/specs/sdd-openspec"), { recursive: true });
	mkdirSync(join(cwd, "openspec/changes/archive/2026-01-01-old/specs/sdd-openspec"), { recursive: true });
	writeFileSync(join(cwd, "openspec/changes/current/specs/sdd-openspec/spec.md"), "# Current\n");
	writeFileSync(join(cwd, "openspec/changes/other/specs/sdd-openspec/spec.md"), "# Other\n");
	writeFileSync(join(cwd, "openspec/changes/archive/2026-01-01-old/specs/sdd-openspec/spec.md"), "# Old\n");

	const collisions = detectActiveDomainCollisions(cwd, "current", "sdd-openspec");

	assert.deepEqual(collisions.map((collision) => collision.change), ["other"]);
	assert.match(collisions[0].path, /openspec\/changes\/other\/specs\/sdd-openspec\/spec\.md$/);
});

test("detectLegacyFlatSpec warns when a flat change spec exists without domain specs", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "gentle-pi-legacy-flat-"));
	mkdirSync(join(cwd, "openspec/changes/legacy-change"), { recursive: true });
	writeFileSync(join(cwd, "openspec/changes/legacy-change/spec.md"), "# Legacy\n");

	assert.deepEqual(detectLegacyFlatSpec(cwd, "legacy-change"), {
		change: "legacy-change",
		path: join(cwd, "openspec/changes/legacy-change/spec.md"),
		hasDomainSpecs: false,
	});
});

test("detectLegacyFlatSpec reports domain specs when both old and new layouts exist", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "gentle-pi-legacy-both-"));
	mkdirSync(join(cwd, "openspec/changes/mixed/specs/domain"), { recursive: true });
	writeFileSync(join(cwd, "openspec/changes/mixed/spec.md"), "# Legacy\n");
	writeFileSync(join(cwd, "openspec/changes/mixed/specs/domain/spec.md"), "# Domain\n");

	assert.equal(detectLegacyFlatSpec(cwd, "mixed")?.hasDomainSpecs, true);
});

test("analyzeDeltaDestructiveness reports removed and large modified requirements", () => {
	const report = analyzeDeltaDestructiveness(
		`# Delta

## MODIFIED Requirements

### Requirement: Big Replacement

${Array.from({ length: 15 }, (_, index) => `Line ${index + 1}`).join("\n")}

## REMOVED Requirements

### Requirement: Removed Behavior

(Reason: no longer supported)
`,
		{ largeModifiedLineThreshold: 10 },
	);

	assert.equal(report.destructive, true);
	assert.deepEqual(report.removedRequirements, ["Removed Behavior"]);
	assert.deepEqual(report.largeModifiedRequirements.map((item) => item.name), ["Big Replacement"]);
});
