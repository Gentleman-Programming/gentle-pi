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
  "contracts/review-integration/v1/fixtures/binding-revision-conflict.fixture.json": "c2e294843cee5185324cb7a41702574ef94852517239d99e7493a1414a60b363",
  "contracts/review-integration/v1/fixtures/capabilities-v1.1.fixture.json": "1b3dc40dce7bfb5d3ecc7e92af68d66e71b733ba0b0f71ba94d3c633adc48bcf",
  "contracts/review-integration/v1/fixtures/capabilities-v1.2.fixture.json": "2970d21cd95a7fcaea6547c47a591a5151046e7ede658b3e8c5b9a9c5d106b65",
  "contracts/review-integration/v1/fixtures/capabilities-v1.3.fixture.json": "0ec783ea13b4c82c0b002c5caa758f33e2b488537297cc2d0694ec92176ac0cb",
  "contracts/review-integration/v1/fixtures/capabilities-v1.4.fixture.json": "84e0db457b76b97b35c2be772dfc647f9eab66810ea98f64fed85645c3c266ba",
  "contracts/review-integration/v1/fixtures/capabilities.fixture.json": "b3ca822189a236f2d891628c665ca23e308bf5185a1701e1f07231bd970461bb",
  "contracts/review-integration/v1/fixtures/consent.fixture.json": "e9987a5f90fbee4831cb0dd8851adf4a0a8f40e9a427594cb8916c22aef7044f",
  "contracts/review-integration/v1/fixtures/failure.fixture.json": "e72b6ab5e3c529abac47bd324444f84ca90f67ef0a67189f5fd8d24d199a2759",
  "contracts/review-integration/v1/fixtures/final-verification-incident.fixture.json": "f8bc06549e62b0bee5cf2ecde625e18da178dd18c9d3023b7d7e8fd0ebbba646",
  "contracts/review-integration/v1/fixtures/operation.fixture.json": "3547748a4df57382178064abbdb1cf12f1d58a75c0e9d6452fdd9beb3aaeac3a",
  "contracts/review-integration/v1/fixtures/repair-preflight.fixture.json": "7168cb53ad470066d0b3edc3b7911d1aebff91abd41ecc3d822f8ffa5cea6cb1",
  "contracts/review-integration/v1/fixtures/start-v2.fixture.json": "388c7c21374b89afe2d42d64bd1987d17ec0e2c7151cab1c56a08969ffb2ea0e",
  "contracts/review-integration/v1/fixtures/start.fixture.json": "f369160ac26eb3427b57de2dd01c9d8c81e51c8a2bd546446780129d31b1945b",
  "contracts/review-integration/v1/fixtures/status-ambiguous.fixture.json": "ee695fd58ba72adfb3b51dfd16432a177498173a45bfcb594d6bdc53bfa32e6e",
  "contracts/review-integration/v1/fixtures/status-corrupted.fixture.json": "4cfc0048c28a39cec8a32fecfaad66e56e5c1248263ceb4ce66b6717981880b2",
  "contracts/review-integration/v1/fixtures/status-recover.fixture.json": "714f762f72380ce93d567626cafbaa536ab3aae02af73d3d40ca123f1f30d8b0",
  "contracts/review-integration/v1/fixtures/status-unrelated.fixture.json": "deab36c877ced3c9b480ca33724c10d88f75c761d6426fa14be850345122891d",
  "contracts/review-integration/v1/fixtures/status-v2-ambiguous.fixture.json": "80a459a7a18d8d933dd42acb6a94a75ac19278e9a6c3b125e3017946768eaa47",
  "contracts/review-integration/v1/fixtures/status-v2-corrupted.fixture.json": "466f1e28b101e95178630f26a90fff96ad3516e2aa6a17f5f357bab9bda2ab52",
  "contracts/review-integration/v1/fixtures/status-v2-final-verification-retry.fixture.json": "21145377f88349b5e22148cbd15745087acfed6e8c534ba715ad2f24653cdaa3",
  "contracts/review-integration/v1/fixtures/status-v2-recover.fixture.json": "178331fc7177d2316fd4f56610ac295f7da2780be96b233b72935d5f476610f2",
  "contracts/review-integration/v1/fixtures/status-v2-repair.fixture.json": "89083cad752fca38da09e919825d0b80641a8a029364ba1869e5b58ef2e59a1d",
  "contracts/review-integration/v1/fixtures/status-v2-unrelated.fixture.json": "c178b338dcd5d30888acef37a9d752bd0932d6dedfffb61b0596a9cceabeb692",
  "contracts/review-integration/v1/fixtures/status-v2.fixture.json": "5410d8bbae1b7152a43b3a5c4c880e9e98a5e47b76d910456f5ef13f19836f3a",
  "contracts/review-integration/v1/fixtures/status.fixture.json": "555054d8046a896162995dcb117752f9cd1ef903fb9ebaad29af1b7e7f319bb3",
  "contracts/review-integration/v1/schemas/admitted-result.schema.json": "7796e8dbba331434594108c902dfab7ec46f691fa447a9259a78f2448111b0de",
  "contracts/review-integration/v1/schemas/artifact-subject.schema.json": "f7dcd934e27e8f3735a37f3d0ec8048dd8ccc1811b9df61124a1dcbf8a03f40e",
  "contracts/review-integration/v1/schemas/authority-repair-assessment.schema.json": "232591670009f99c53a68e91d1e7e60465c294f1721f493ab1e7ae182842cfb5",
  "contracts/review-integration/v1/schemas/capabilities-v1.1.schema.json": "2b14162284f375f8563e49d3a28caaa0aabb572094d8d290eb61844b1353af78",
  "contracts/review-integration/v1/schemas/capabilities-v1.2.schema.json": "df1722adcd9c999edbef090bfd5d9a9713f6852a9bc9cb79684ef7c9c91c0d62",
  "contracts/review-integration/v1/schemas/capabilities-v1.3.schema.json": "3401a062fa8a034ef7743f84adbfdd2ceadaf81bee8a7e62115fd4e18afacfcd",
  "contracts/review-integration/v1/schemas/capabilities-v1.4.schema.json": "926b61c8ac0f870f09214f6bd8af1b035c5b72f14f0b83c0d4a7bdbb277f5447",
  "contracts/review-integration/v1/schemas/capabilities.schema.json": "ad333177494a251beac153f74bd751fa77126a9968aad69e64fc2abf15cff0f7",
  "contracts/review-integration/v1/schemas/consent.schema.json": "f8f2edec17568124488482c2aee399909111fe0cce2cba426fb29efd2c7c1cd0",
  "contracts/review-integration/v1/schemas/failure.schema.json": "0ce29f61408fc21d72640fffdb215a608a820c29f3e5ff62d9cc295ed0451937",
  "contracts/review-integration/v1/schemas/final-verification-incident.schema.json": "39b1ec178b1d3bc8da9a3d92dadd8092385000f2a6930b5bfcb4a84dbc6493ca",
  "contracts/review-integration/v1/schemas/operation.schema.json": "6cf15b54977fea7301b9a5c766e709f8a912fda33560365de6dfcab4d2ecbce0",
  "contracts/review-integration/v1/schemas/projection.schema.json": "7168a3eba929dde2b8f0b7723ee51d5a5421102bdeefe892578c263debd08db2",
  "contracts/review-integration/v1/schemas/repair.schema.json": "febb747dc68f8ded5974b6dd94051ec3cfdb5a886ccb853b1ce53aaf2e41efc0",
  "contracts/review-integration/v1/schemas/result-artifact-v2.schema.json": "38895aae2f6ca4980b1a8e157fee8503920820d5f6be3c757c0fa04e8430cd6b",
  "contracts/review-integration/v1/schemas/result-artifact.schema.json": "91296bd2c261fd2fe03bffd63efe58badd4927e0d0d8480cd4213f651ecacdf6",
  "contracts/review-integration/v1/schemas/start-v2.schema.json": "ec8550cd93bbe84af1ce87dfd7abfa9e24692f42b20f8f0bf9cac1d4b88ea46c",
  "contracts/review-integration/v1/schemas/start.schema.json": "4296aebbd4128ce51945a2f6d3228aa77ac7215c802978d559bff5279ec56229",
  "contracts/review-integration/v1/schemas/status-v2.schema.json": "6af952691c3434f8f292e6590f5d883b98a1c19987eab5032041f48f90032051",
  "contracts/review-integration/v1/schemas/status.schema.json": "67f3bddf5f5feeb3213bce489de8548546163b2e1d49a0e3965c0091dabc8c39",
  "contracts/review-integration/v1/schemas/targeted-validation-request.schema.json": "52b91154693b4dd66983fc91ecf7197503555f2c9e85cac626cffd3035c53d65",
  "docs/review-integration.md": "8125a97708ac65d5a878ad5523b17ba49c10ae7d32669091dc3b7789b28de8b9",
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
  console.error("gentle-pi packaged review-integration/v1 bytes drifted from the byte-identical Gentle AI v2.2.0 contract:");
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
if (!installer.includes('INSTALLER_VERSION = "2.2.0"') || !binaryResolver.includes('GENTLE_AI_VERSION = "2.2.0"')) {
	console.error("gentle-pi package-local Gentle AI version pins are not both v2.2.0.");
  process.exit(1);
}

console.log(`gentle-pi package resource check passed (${requiredPaths.length} files; ${Object.keys(contractHashes).length} exact byte-identical v2.2.0 contract artifacts).`);
