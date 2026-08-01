#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH } from "./sync-gentle-ai-release.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

const requiredPaths = [
  "assets/orchestrator.md",
  "assets/orchestrator-delegation.md",
  "assets/orchestrator-memory.md",
  "assets/orchestrator-skills.md",
  "assets/agents/sdd-apply.md",
  "assets/agents/sdd-archive.md",
  "assets/agents/sdd-design.md",
  "assets/agents/sdd-explore.md",
  "assets/agents/sdd-init.md",
  "assets/agents/sdd-onboard.md",
  "assets/agents/sdd-proposal.md",
  "assets/agents/sdd-spec.md",
  "assets/agents/sdd-status.md",
  "assets/agents/sdd-sync.md",
  "assets/agents/sdd-tasks.md",
  "assets/agents/sdd-verify.md",
  "assets/agents/review-refuter.md",
  "assets/agents/review-validator.md",
  "assets/chains/sdd-full.chain.md",
  "assets/chains/sdd-plan.chain.md",
  "assets/chains/sdd-verify.chain.md",
  "assets/migrations/managed-assets-v0.10.7.json",
  "assets/migrations/managed-assets-v0.13.json",
  "assets/migrations/managed-assets-v0.14.json",
  "assets/support/sdd-status-contract.md",
  "assets/support/strict-tdd.md",
  "assets/support/strict-tdd-verify.md",
  "docs/skill-style-guide.md",
  "docs/review-integration.md",
  "extensions/gentle-ai.ts",
  "extensions/sdd-init.ts",
  "extensions/skill-registry.ts",
  "lib/gentle-ai-binary.ts",
  "lib/git-commit-transaction.ts",
  "lib/native-review-cli.ts",
  "lib/release-artifact.ts",
  "lib/review-integration-v2.ts",
  "lib/sdd-preflight.ts",
	"runtime/gentle-ai-binary.mjs",
	"runtime/git-commit-transaction.mjs",
	"runtime/native-review-cli.mjs",
	"runtime/release-artifact.mjs",
	"runtime/review-integration-v2.mjs",
	"scripts/build-git-commit-transaction-runner.mjs",
  "scripts/gentle-ai-installer.mjs",
  "scripts/install-gentle-ai.mjs",
  "scripts/sync-gentle-ai-release.mjs",
  "scripts/run-git-commit-transaction.mjs",
	"scripts/test-packed-runner.mjs",
  "tests/fixtures/native-review-cli/v2.1.3/start.json",
  "prompts/gcl.md",
  "prompts/gis.md",
  "prompts/gpr.md",
  "prompts/gwr.md",
  "prompts/skill-creation.md",
  "skills/_shared/review-ledger-contract.md",
  "skills/branch-pr/SKILL.md",
  "skills/chained-pr/SKILL.md",
  "skills/cognitive-doc-design/SKILL.md",
  "skills/comment-writer/SKILL.md",
  "skills/gentle-ai/SKILL.md",
  "skills/issue-creation/SKILL.md",
  "skills/judgment-day/SKILL.md",
  "skills/release/SKILL.md",
  "skills/skill-creator/SKILL.md",
  "skills/skill-improver/SKILL.md",
  "skills/skill-registry/SKILL.md",
  "skills/work-unit-commits/SKILL.md",
];

// The lock's canonical relative path (capabilities/gentle-ai-release.lock.json).
// The lock, written only by scripts/sync-gentle-ai-release.mjs, replaces the
// hand-maintained ~60-entry contractHashes map this script used to carry:
// every mirror digest below is now read from the lock instead. The lock's
// checked-in release.version is asserted equal to the authoritative
// INSTALLER_VERSION pin below (currently v2.2.3, #262) rather than repeating
// the literal a second time.
requiredPaths.push(GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH);

// Full-mirror directories: every file under these roots is written only by
// scripts/sync-gentle-ai-release.mjs and MUST appear in the lock's entries.
// Any other on-disk file here is unlisted drift.
const MIRROR_WALK_ROOTS = ["contracts", "docs/gentle-ai", "capabilities"];

// Files that legitimately live inside a MIRROR_WALK_ROOTS directory but are
// NOT provider mirror content, so the walk must not flag them as unlisted:
// the lock itself, and capabilities/native-cli-history.json (design D6:
// "hand-authored, append-only" — the 4 non-derivable envelope flags).
const MIRROR_WALK_EXCLUSIONS = new Set([GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH, "capabilities/native-cli-history.json"]);

function listFilesRecursively(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return listFilesRecursively(absolutePath);
    return entry.isFile() ? [absolutePath] : [];
  });
}

// Walks every full-mirror directory (MIRROR_WALK_ROOTS) on disk and
// reconciles it against the lock's digest map, extended with entries
// declared under those roots but not walked (e.g. capabilities/*.semantic.json
// alongside hand-authored capabilities/native-cli-history.json). Reports the
// two drift directions separately so a new unlisted file and a lock entry
// with no file on disk are both visible, each naming the exact file.
export function reconcileContractsOnDisk(packageRoot, hashes) {
  const underAnyMirrorRoot = (relativePath) => MIRROR_WALK_ROOTS.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));

  const walked = [];
  for (const mirrorRoot of MIRROR_WALK_ROOTS) {
    const absoluteRoot = join(packageRoot, mirrorRoot);
    if (!existsSync(absoluteRoot)) continue;
    for (const absolutePath of listFilesRecursively(absoluteRoot)) {
      const relativePath = relative(packageRoot, absolutePath).split(sep).join("/");
      if (!MIRROR_WALK_EXCLUSIONS.has(relativePath)) walked.push(relativePath);
    }
  }
  const listed = Object.keys(hashes).filter(underAnyMirrorRoot);
  const walkedSet = new Set(walked);
  const listedSet = new Set(listed);

  return {
    unlistedOnDisk: walked.filter((relativePath) => !listedSet.has(relativePath)).sort(),
    listedButMissing: listed.filter((relativePath) => !walkedSet.has(relativePath)).sort(),
  };
}

// Recomputes each listed mirror file's digest from disk and compares it
// against the lock's recorded digest, returning one entry per drifted file
// so the offline gate can name it exactly (never a silent pass on a single
// aggregate boolean).
export function mirrorDigestDrift(packageRoot, digests) {
  return Object.entries(digests).flatMap(([relativePath, expected]) => {
    const actual = `sha256:${createHash("sha256").update(readFileSync(join(packageRoot, relativePath))).digest("hex")}`;
    return actual === expected ? [] : [{ relativePath, expected, actual }];
  });
}

// Builds the `{ relativePath: "sha256:<hex>" }` digest map the reconciliation
// and drift functions above consume, straight from the lock's canonical
// entries — the lock IS the source of truth; nothing here is hand-maintained.
export function mirrorDigestsFromLock(lock) {
  return Object.fromEntries(lock.entries.map((entry) => [entry.path, entry.digest]));
}

// A gate asserts the checked-in lock's release version equals the one
// authoritative INSTALLER_VERSION pin (#262), so the lock can never silently
// drift from the version the rest of the installer trusts.
export function assertLockReleaseVersionPin(lock, installerVersion) {
  if (lock.release.version !== installerVersion) {
    throw new Error(
      `capabilities/gentle-ai-release.lock.json release.version ("${lock.release.version}") does not match the authoritative scripts/gentle-ai-installer.mjs INSTALLER_VERSION ("${installerVersion}")`,
    );
  }
}

// Compares every location that pins the Gentle AI version against the one
// authoritative constant (scripts/gentle-ai-installer.mjs INSTALLER_VERSION),
// returning a mismatch message per drifted location instead of a boolean.
// This replaces a textual `.includes(...)` grep that could not have caught
// the documented incident (scripts/install-gentle-ai.mjs header comment):
// two hardcoded version copies drifted apart, and the installer reported
// installing one version while writing another to disk. A textual grep only
// verifies a string appears in a file; it cannot verify that two values
// agree, which is exactly what this function checks instead.
export function gentleAiVersionPinMismatches({ installerVersion, releaseBaseUrl, windowsSourceTag, libGentleAiVersion }) {
  const mismatches = [];
  if (libGentleAiVersion !== installerVersion) {
    mismatches.push(
      `lib/gentle-ai-binary.ts GENTLE_AI_VERSION ("${libGentleAiVersion}") does not match the authoritative scripts/gentle-ai-installer.mjs INSTALLER_VERSION ("${installerVersion}")`,
    );
  }
  if (!releaseBaseUrl.includes(`/v${installerVersion}/`)) {
    mismatches.push(`RELEASE_BASE_URL ("${releaseBaseUrl}") does not pin the authoritative v${installerVersion}`);
  }
  if (windowsSourceTag !== `v${installerVersion}`) {
    mismatches.push(`GENTLE_AI_WINDOWS_SOURCE_TAG ("${windowsSourceTag}") does not match the authoritative v${installerVersion}`);
  }
  return mismatches;
}

// Reads the generator's `sources` array by regex rather than importing it,
// so this script never needs the generator to export anything it doesn't
// already export for its own `--write`/`--check` CLI use.
export function extractGeneratedRuntimeSources(packageRoot) {
  const generatorPath = join(packageRoot, "scripts/build-git-commit-transaction-runner.mjs");
  const generatorSource = readFileSync(generatorPath, "utf8");
  const sourcesMatch = generatorSource.match(/const sources = \[([\s\S]*?)\];/);
  if (!sourcesMatch) {
    throw new Error(`${generatorPath} does not declare a "sources" array`);
  }
  return [...sourcesMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

// Three-way reconciliation: the generator's `sources` names must equal the
// `.mjs` basenames on disk in `runtime/`, which must equal the `runtime/`
// entries in `requiredPaths`. Deliberately not a `lib/`-driven walk: most
// `lib/` modules are intentionally unpaired with a generated runtime file.
export function reconcileGeneratedRuntimeSources(packageRoot, sources, paths) {
  const runtimeRoot = join(packageRoot, "runtime");
  const runtimeBasenames = existsSync(runtimeRoot)
    ? readdirSync(runtimeRoot)
        .filter((name) => name.endsWith(".mjs"))
        .map((name) => name.slice(0, -".mjs".length))
    : [];
  const requiredRuntimeBasenames = paths
    .filter((relativePath) => relativePath.startsWith("runtime/") && relativePath.endsWith(".mjs"))
    .map((relativePath) => relativePath.slice("runtime/".length, -".mjs".length));

  const sourceSet = new Set(sources);
  const runtimeSet = new Set(runtimeBasenames);
  const requiredSet = new Set(requiredRuntimeBasenames);
  const names = new Set([...sourceSet, ...runtimeSet, ...requiredSet]);

  const drifted = [...names]
    .filter((name) => !(sourceSet.has(name) && runtimeSet.has(name) && requiredSet.has(name)))
    .sort()
    .map((name) => ({
      name,
      inSources: sourceSet.has(name),
      inRuntimeDir: runtimeSet.has(name),
      inRequiredPaths: requiredSet.has(name),
    }));

  return { drifted };
}

async function main() {
  const missing = requiredPaths.filter((relativePath) => {
    const absolutePath = join(root, relativePath);
    return !existsSync(absolutePath) || !statSync(absolutePath).isFile();
  });

  if (missing.length > 0) {
    console.error("gentle-pi package is missing required Pi resources:");
    for (const relativePath of missing) {
      console.error(`- ${relativePath}`);
    }
    console.error("\nRefusing to pack/publish an incomplete npm package.");
    process.exit(1);
  }

  const lockPath = join(root, GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const mirrorDigests = mirrorDigestsFromLock(lock);

  const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(root, mirrorDigests);
  if (unlistedOnDisk.length > 0 || listedButMissing.length > 0) {
    console.error(`gentle-pi packaged mirror tree has drifted from ${GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH}:`);
    for (const relativePath of unlistedOnDisk) console.error(`- unlisted-on-disk: ${relativePath}`);
    for (const relativePath of listedButMissing) console.error(`- listed-but-missing: ${relativePath}`);
    console.error("\nRefusing to pack/publish an unreconciled mirror tree.");
    process.exit(1);
  }

  const generatedRuntimeSources = extractGeneratedRuntimeSources(root);
  const { drifted } = reconcileGeneratedRuntimeSources(root, generatedRuntimeSources, requiredPaths);
  if (drifted.length > 0) {
    console.error("gentle-pi generated commit transaction runtime sources, runtime/*.mjs, and requiredPaths have drifted apart:");
    for (const entry of drifted) {
      const where = [];
      if (!entry.inSources) where.push("missing from generator sources");
      if (!entry.inRuntimeDir) where.push("missing from runtime/*.mjs");
      if (!entry.inRequiredPaths) where.push("missing from requiredPaths");
      console.error(`- ${entry.name}: ${where.join(", ")}`);
    }
    console.error("\nRefusing to pack/publish an unreconciled generated runtime.");
    process.exit(1);
  }

  const driftedMirrors = mirrorDigestDrift(root, mirrorDigests);

  if (driftedMirrors.length > 0) {
    console.error(`gentle-pi packaged mirror bytes drifted from ${GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH}:`);
    for (const drift of driftedMirrors) console.error(`- ${drift.relativePath}: expected ${drift.expected}, got ${drift.actual}`);
    process.exit(1);
  }

  // Release guard: refuse to pack/publish while any installer digest is not a real
  // pinned SHA-256 (for example the pre-release pending sentinel).
  const { GENTLE_AI_RELEASE_ASSETS, INSTALLER_VERSION, RELEASE_BASE_URL, GENTLE_AI_WINDOWS_SOURCE_TAG } = await import(
    new URL("./gentle-ai-installer.mjs", import.meta.url)
  );
  const unpinnedDigests = Object.entries(GENTLE_AI_RELEASE_ASSETS).flatMap(([target, asset]) =>
    [["sha256", asset.sha256], ["binarySha256", asset.binarySha256]]
      .filter(([, digest]) => !/^[0-9a-f]{64}$/.test(digest))
      .map(([field]) => `${target}.${field}`));
  if (unpinnedDigests.length > 0) {
    console.error("gentle-pi Gentle AI release digests are not pinned SHA-256 values:");
    for (const entry of unpinnedDigests) console.error(`- ${entry}`);
    console.error("Refusing to pack/publish until scripts/gentle-ai-installer.mjs pins the published checksums.txt archive digests and extracted binary digests.");
    process.exit(1);
  }

  try {
    assertLockReleaseVersionPin(lock, INSTALLER_VERSION);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const generatedRuntimeCheck = spawnSync(process.execPath, [join(root, "scripts/build-git-commit-transaction-runner.mjs"), "--check"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  if (generatedRuntimeCheck.status !== 0) {
    console.error("gentle-pi generated commit transaction runtime does not match its TypeScript sources:");
    console.error((generatedRuntimeCheck.stderr || generatedRuntimeCheck.stdout || "unknown generator failure").trim());
    process.exit(1);
  }

  const { GENTLE_AI_VERSION } = await import(new URL("../lib/gentle-ai-binary.ts", import.meta.url));
  const versionMismatches = gentleAiVersionPinMismatches({
    installerVersion: INSTALLER_VERSION,
    releaseBaseUrl: RELEASE_BASE_URL,
    windowsSourceTag: GENTLE_AI_WINDOWS_SOURCE_TAG,
    libGentleAiVersion: GENTLE_AI_VERSION,
  });
  if (versionMismatches.length > 0) {
    console.error("gentle-pi Gentle AI version pins have drifted from the authoritative INSTALLER_VERSION:");
    for (const mismatch of versionMismatches) console.error(`- ${mismatch}`);
    process.exit(1);
  }

  console.log(`gentle-pi package resource check passed (${requiredPaths.length} files; ${lock.entries.length} lock-pinned mirror artifacts at release v${lock.release.version}).`);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  await main();
}
