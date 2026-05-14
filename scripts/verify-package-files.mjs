#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

const requiredPaths = [
  "assets/agents/sdd-init.md",
  "assets/chains/sdd-plan.chain.md",
  "assets/support/strict-tdd.md",
  "extensions/gentle-ai.ts",
  "extensions/sdd-init.ts",
  "extensions/skill-registry.ts",
  "lib/sdd-preflight.ts",
  "prompts/gcl.md",
  "prompts/gis.md",
  "prompts/gpr.md",
  "prompts/gwr.md",
  "skills/gentle-ai/SKILL.md",
  "skills/work-unit-commits/SKILL.md",
];

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

console.log(`gentle-pi package resource check passed (${requiredPaths.length} files).`);
