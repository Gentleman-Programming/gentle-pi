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
  "contracts/review-integration/v1/fixtures/capabilities.fixture.json": "3a7db8fd3356f3a6cc1a9da4349d3f26fcbc28ac9377df0538d7a555621a9f5d",
  "contracts/review-integration/v1/fixtures/failure.fixture.json": "301ee62695f3b8db7507586c298f8d32e7183f4a628bcadc9d717bfbe1a72edc",
  "contracts/review-integration/v1/fixtures/operation.fixture.json": "4ddec04f3d1504b771a87f6a71e04e2b5440019d12a6df4663815fdf7489c9e4",
  "contracts/review-integration/v1/fixtures/start.fixture.json": "d61267ee2e0a5e4c64cf48f40b4882d2284bfdaad9942a09ee29d7e693012238",
  "contracts/review-integration/v1/fixtures/status-ambiguous.fixture.json": "4b024e06b791bb9b300403b09e3111220e8bf55cd5fd7617580631b57de86208",
  "contracts/review-integration/v1/fixtures/status-corrupted.fixture.json": "5fc9191df078ce1e01732b82a88683fef1502f501188c03900367b666da6df62",
  "contracts/review-integration/v1/fixtures/status-unrelated.fixture.json": "0d68e1e121a73b962f8bda8e48631eee24f4420f5d83402b91d2a12fff632248",
  "contracts/review-integration/v1/fixtures/status.fixture.json": "39b31b1c2b07ead9e0f21e47169f82f388be91dd3054bcd648e89258fac36c04",
  "contracts/review-integration/v1/schemas/capabilities.schema.json": "e7acf16c33a390d41c88b5a066fbddcc2cc93b8b6316edcd5f3e3d679111fcea",
  "contracts/review-integration/v1/schemas/failure.schema.json": "253bf11a58d19dae4617b67f8c53f59d65e0cc53b9a062109a39e596392a729e",
  "contracts/review-integration/v1/schemas/operation.schema.json": "e71c7d9f55d3b563e9037f2be9f0aaff26b96e03b51c402943e5f6eefe33588d",
  "contracts/review-integration/v1/schemas/projection.schema.json": "63d610c5757e16dfc74923afd849c82c5004cd705a0e85ff431861a98688d7da",
  "contracts/review-integration/v1/schemas/start.schema.json": "f74f22b3aacb655824a95a75c5f8652c6a6c0826089df3fc21579ef94e66b3a3",
  "contracts/review-integration/v1/schemas/status.schema.json": "e17ce8a2725682136b99f1536a5bc6dda8ec813ea564ce1b437e58feadf55971",
  "docs/review-integration.md": "b729fac30c03a95b57cf0ad6b6fc9a1959629a30bcbe31d5a0470af6854501c5",
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
  console.error("gentle-pi packaged review-integration/v1 bytes drifted from Gentle AI v2.1.6:");
  for (const drift of driftedContracts) console.error(`- ${drift.relativePath}: expected ${drift.expected}, got ${drift.actual}`);
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
if (!installer.includes('INSTALLER_VERSION = "2.1.6"') || !binaryResolver.includes('GENTLE_AI_VERSION = "2.1.6"')) {
  console.error("gentle-pi package-local Gentle AI version pins are not both v2.1.6.");
  process.exit(1);
}

console.log(`gentle-pi package resource check passed (${requiredPaths.length} files; ${Object.keys(contractHashes).length} exact v2.1.6 contract artifacts).`);
