#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  "lib/review-integration-v1.ts",
  "lib/sdd-preflight.ts",
	"runtime/gentle-ai-binary.mjs",
	"runtime/git-commit-transaction.mjs",
	"runtime/native-review-cli.mjs",
	"runtime/review-integration-v1.mjs",
	"scripts/build-git-commit-transaction-runner.mjs",
  "scripts/gentle-ai-installer.mjs",
  "scripts/install-gentle-ai.mjs",
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

const contractHashes = {
  "contracts/review-integration/v1/fixtures/capabilities-v1.1.fixture.json": "1b3dc40dce7bfb5d3ecc7e92af68d66e71b733ba0b0f71ba94d3c633adc48bcf",
  "contracts/review-integration/v1/fixtures/capabilities.fixture.json": "b3ca822189a236f2d891628c665ca23e308bf5185a1701e1f07231bd970461bb",
  "contracts/review-integration/v1/fixtures/failure.fixture.json": "e72b6ab5e3c529abac47bd324444f84ca90f67ef0a67189f5fd8d24d199a2759",
  "contracts/review-integration/v1/fixtures/operation.fixture.json": "f867bead654d467319d85ff518b39f145996df6a9494fdbff798516928dacfcd",
  "contracts/review-integration/v1/fixtures/start.fixture.json": "d61267ee2e0a5e4c64cf48f40b4882d2284bfdaad9942a09ee29d7e693012238",
  "contracts/review-integration/v1/fixtures/status-ambiguous.fixture.json": "0f2737c2ed67bb2edb184faa8ac7006ef4f9172b9929aaa063432871c2aa945c",
  "contracts/review-integration/v1/fixtures/status-corrupted.fixture.json": "a9c25d0d0eab2cc91ef095939c650deafadb112e75d0957a21aa8c60b51fdcda",
  "contracts/review-integration/v1/fixtures/status-unrelated.fixture.json": "e8aa372dfa582e4bf78992757135bc902c28bd9fe946210e40c3edf4c6abfb0b",
  "contracts/review-integration/v1/fixtures/status.fixture.json": "cf981c5fd715357f817fc9206523284dddd1ede8ceee99e7b4935847327e6adc",
  "contracts/review-integration/v1/schemas/capabilities-v1.1.schema.json": "2b14162284f375f8563e49d3a28caaa0aabb572094d8d290eb61844b1353af78",
  "contracts/review-integration/v1/schemas/capabilities.schema.json": "ad333177494a251beac153f74bd751fa77126a9968aad69e64fc2abf15cff0f7",
  "contracts/review-integration/v1/schemas/failure.schema.json": "11284601a00e0192c41b1f3aab0b153635e28ad57ec5f1e2e90a69d129296c44",
  "contracts/review-integration/v1/schemas/operation.schema.json": "7673bb168b6df8cee68f4449a9b79f0a1fc349747e5b26009b41d649979f690d",
  "contracts/review-integration/v1/schemas/projection.schema.json": "7168a3eba929dde2b8f0b7723ee51d5a5421102bdeefe892578c263debd08db2",
  "contracts/review-integration/v1/schemas/result-artifact.schema.json": "91296bd2c261fd2fe03bffd63efe58badd4927e0d0d8480cd4213f651ecacdf6",
  "contracts/review-integration/v1/schemas/start.schema.json": "f3390d09cccb5136392e247db780b9415ceba8c49971a1b1a84240fc66694d97",
  "contracts/review-integration/v1/schemas/status.schema.json": "11ed3aae66e86534b696df3ed11536c4d1f648e2d33ee05a1cd48412903d5db2",
  "contracts/review-integration/v1/fixtures/status-recover.fixture.json": "e50893555694944fc904f3c90442c2f4b2855fda1f36f55482c5a7eed884a75a",
  "docs/review-integration.md": "4bead7c3e3cf7ecfac18941d96ece52a1d6eb263d410ef54f9422aa07eab131c",
};

requiredPaths.push(...Object.keys(contractHashes));

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

const driftedContracts = Object.entries(contractHashes).flatMap(([relativePath, expected]) => {
  const actual = createHash("sha256").update(readFileSync(join(root, relativePath))).digest("hex");
  return actual === expected ? [] : [{ relativePath, expected, actual }];
});

if (driftedContracts.length > 0) {
  console.error("gentle-pi packaged review-integration/v1 bytes drifted from the byte-identical Gentle AI v2.1.11 contract:");
  for (const drift of driftedContracts) console.error(`- ${drift.relativePath}: expected ${drift.expected}, got ${drift.actual}`);
  process.exit(1);
}

// Release guard: refuse to pack/publish while any installer digest is not a real
// pinned SHA-256 (for example the pre-release pending sentinel).
const { GENTLE_AI_RELEASE_ASSETS } = await import(new URL("./gentle-ai-installer.mjs", import.meta.url));
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

const installer = readFileSync(join(root, "scripts/gentle-ai-installer.mjs"), "utf8");
const binaryResolver = readFileSync(join(root, "lib/gentle-ai-binary.ts"), "utf8");
if (!installer.includes('INSTALLER_VERSION = "2.1.11"') || !binaryResolver.includes('GENTLE_AI_VERSION = "2.1.11"')) {
	console.error("gentle-pi package-local Gentle AI version pins are not both v2.1.11.");
  process.exit(1);
}

console.log(`gentle-pi package resource check passed (${requiredPaths.length} files; ${Object.keys(contractHashes).length} exact byte-identical v2.1.11 contract artifacts).`);
