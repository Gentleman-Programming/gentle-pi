import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyModelConfig } from "../extensions/gentle-ai.ts";
import { installSddAssets } from "../lib/sdd-preflight.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANAGED_EXEMPLAR_FILE = "gentle-ai-explore.md";
const RETIRED_REFUTER_FILE = "review-refuter.md";
const REVIEW_RISK_FILE = "review-risk.md";
const V013_REVIEW_RISK_FIXTURE = join(
	PACKAGE_ROOT,
	"tests",
	"fixtures",
	"v0.13",
	"assets",
	"agents",
	REVIEW_RISK_FILE,
);
const V013_MANAGED_ASSETS = join(
	PACKAGE_ROOT,
	"assets",
	"migrations",
	"managed-assets-v0.13.json",
);
const V014_REVIEW_RISK_FIXTURE = join(
	PACKAGE_ROOT,
	"tests",
	"fixtures",
	"v0.14",
	"assets",
	"agents",
	REVIEW_RISK_FILE,
);
const V014_MANAGED_ASSETS = join(
	PACKAGE_ROOT,
	"assets",
	"migrations",
	"managed-assets-v0.14.json",
);
// gentle-pi#311 P5: the managed-asset installer mechanism tests use
// gentle-ai-explore.md as their exemplar (packaged, absent from the v0.13
// manifest) after review-refuter.md was retired together with every
// Pi-authored adversarial review verdict.
const MANAGED_EXEMPLAR_TOOLS = ["read", "grep", "find", "codegraph"];
const RETIRED_ADVERSARIAL_AGENTS = ["review-refuter.md", "review-validator.md"];

interface ManagedAssetsManifest {
	schemaVersion: number;
	assets: Record<string, string>;
}

interface LegacyManagedAssetsManifest extends ManagedAssetsManifest {
	packageVersion: string;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

interface PackageJsonPiManifest {
	extensions?: string[];
}

interface PackageJson {
	version?: string;
	files?: string[];
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	bundledDependencies?: string[];
	bundleDependencies?: string[];
	repository?: {
		type?: string;
		url?: string;
	};
	pi?: PackageJsonPiManifest;
}

function readPackageJson(): PackageJson {
	const rawPackageJson = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");

	try {
		return JSON.parse(rawPackageJson) as PackageJson;
	} catch (error) {
		throw new Error("package.json must contain valid JSON", { cause: error });
	}
}

test("package manifest has no obsolete native activation build surface", () => {
	const packageJson = readPackageJson();
	const manifest = JSON.stringify(packageJson);

	assert.ok(!packageJson.files?.includes("native/"), "package must not ship the obsolete native addon directory");
	assert.ok(!packageJson.scripts?.["native:build"], "package must not expose an obsolete native build script");
	assert.doesNotMatch(manifest, /build-native-addon|gentle_review_native|review-native-fence/i);
	assert.doesNotMatch(packageJson.scripts?.prepack ?? "", /native:build/);
	assert.doesNotMatch(packageJson.scripts?.prepublishOnly ?? "", /native:build/);
});

test("package verification names the native review runtime boundary and packaged fixtures", () => {
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");
	const manifest = readPackageJson();

	assert.ok(manifest.files?.includes("lib/"), "the published package must include the native review runtime module directory");
	assert.ok(manifest.files?.includes("runtime/"), "the published package must include generated JavaScript runtime modules");
	assert.match(verifier, /"lib\/native-review-cli\.ts"/, "package verification must require the native review adapter from the packaged runtime");
	assert.match(verifier, /"runtime\/native-review-cli\.mjs"/, "package verification must require the generated native review adapter");
	assert.match(verifier, /build-runtime-modules\.mjs.*--check/s, "package verification must reject generated-runtime drift");
	assert.match(verifier, /"tests\/fixtures\/native-review-cli\/v2\.1\.3\/start\.json"/, "package verification must retain the pinned native decoder fixture");
	assert.match(
		readFileSync(join(PACKAGE_ROOT, "extensions", "gentle-ai.ts"), "utf8"),
		/createNativeReviewCli\(\)/,
		"the production extension must construct its native client from the packaged runtime module",
	);
});

test("npm publication is bound to the exact package tag and triggering commit", () => {
	const workflow = readFileSync(join(PACKAGE_ROOT, ".github", "workflows", "publish.yml"), "utf8");
	const releaseSkill = readFileSync(join(PACKAGE_ROOT, "skills", "release", "SKILL.md"), "utf8");
	const packageJson = readPackageJson();
	const dispatchBlock = workflow.match(
		/^ {2}workflow_dispatch:\n([\s\S]*?)^\npermissions:/m,
	)?.[1];
	assert.ok(dispatchBlock);
	const inputNames = [
		...dispatchBlock.matchAll(/^ {6}([A-Za-z0-9_-]+):$/gm),
	].map((match) => match[1]);

	assert.match(workflow, /on:\n\s+workflow_dispatch:\s*\n/);
	assert.deepEqual(inputNames, ["tag"], "the trusted workflow must expose exactly one caller input");
	assert.match(workflow, /inputs:\n\s+tag:/, "the trusted main workflow must accept only the release tag");
	assert.match(workflow, /RELEASE_TAG: \$\{\{ inputs\.tag \}\}/);
	assert.doesNotMatch(workflow, /checkout-ref|dist-tag.*inputs|inputs\.(?!tag)/, "the release workflow must not accept checkout or dist-tag inputs");
	assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/, "checkout must use the immutable event SHA");
	assert.match(workflow, /persist-credentials: false/, "the release checkout must not retain GitHub credentials");
	assert.match(workflow, /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
	assert.match(workflow, /\$\{DEFAULT_BRANCH\}" != "main"/);
	assert.match(workflow, /\$\{GITHUB_REF\}" != "refs\/heads\/main"/);
	assert.match(workflow, /\$\{GITHUB_REF_TYPE\}" != "branch"/);
	assert.match(workflow, /Release tag is not exact vSemVer/);
	assert.match(workflow, /git ls-remote origin[\s\S]*"refs\/heads\/main"[\s\S]*"refs\/tags\/\$\{tag\}"/);
	assert.match(workflow, /git fetch --atomic --no-tags origin/);
	assert.match(workflow, /refs\/heads\/main:refs\/remotes\/origin\/release-main/);
	assert.match(workflow, /refs\/tags\/\$\{tag\}:refs\/release-verification\/tag/);
	assert.match(workflow, /git cat-file -t refs\/release-verification\/tag/);
	assert.match(workflow, /git checkout --detach "\$\{tag_commit\}"/);
	assert.match(workflow, /git rev-parse "\$\{GITHUB_SHA\}\^\{commit\}"/);
	assert.match(workflow, /git rev-parse ['"]HEAD\^\{commit\}['"]/);
	assert.match(workflow, /Reverify protected release authority and publish/);
	assert.match(workflow, /Release authority changed after verification/);
	assert.match(workflow, /id-token: write/, "trusted publishing requires OIDC");
	assert.match(workflow, /node-version: "24"/, "trusted publishing must use a supported Node.js version");
	assert.match(workflow, /const minimum = \[11, 5, 1\]/, "trusted publishing must reject npm versions below 11.5.1");
	assert.match(workflow, /packageJson\.repository\?\.type !== expectedRepository\.type/);
	assert.match(workflow, /packageJson\.repository\?\.url !== expectedRepository\.url/);
	assert.deepEqual(
		packageJson.repository,
		{
			type: "git",
			url: "git+https://github.com/Gentleman-Programming/gentle-pi.git",
		},
		"trusted publishing requires the exact case-sensitive npm repository identity",
	);
	assert.match(workflow, /npm publish --provenance --access public/);
	assert.doesNotMatch(workflow, /pnpm publish|--no-git-checks|NODE_AUTH_TOKEN/);

	assert.match(releaseSkill, /tag="v\$\{version\}"/);
	assert.match(releaseSkill, /release_sha="\$\(git rev-parse 'origin\/main\^\{commit\}'\)"/);
	assert.match(releaseSkill, /git rev-parse "\$\{tag\}\^\{commit\}"/);
	assert.match(releaseSkill, /git fetch --no-tags origin "refs\/tags\/\$\{tag\}"/);
	assert.match(releaseSkill, /gh release create "\$\{tag\}"[\s\S]*--verify-tag/);
	assert.match(releaseSkill, /--ref main/);
	assert.match(releaseSkill, /-f tag="\$\{tag\}"/);
	assert.match(releaseSkill, /trusted OIDC with provenance/);
	assert.doesNotMatch(releaseSkill, /--ref "\$\{tag\}"|-f dist-tag=/);
});

test("Pi delivery relay is absent from the packaged extension", () => {
	const extension = readFileSync(join(PACKAGE_ROOT, "extensions", "gentle-ai.ts"), "utf8");

	assert.doesNotMatch(extension, /review-publication-gate/);
});

test("generated runtime modules and packed-package checks are deterministic", () => {
	const packageJson = readPackageJson();
	const generator = readFileSync(join(PACKAGE_ROOT, "scripts", "build-runtime-modules.mjs"), "utf8");
	const packedRunner = readFileSync(join(PACKAGE_ROOT, "scripts", "test-packed-runner.mjs"), "utf8");
	const ci = readFileSync(join(PACKAGE_ROOT, ".github", "workflows", "ci.yml"), "utf8");
	assert.equal(packageJson.scripts?.["build:runtime-modules"], "node scripts/build-runtime-modules.mjs --write");
	assert.equal(packageJson.scripts?.["check:runtime-modules"], "node scripts/build-runtime-modules.mjs --check");
	assert.equal(packageJson.scripts?.["test:packed-package"], "node scripts/test-packed-runner.mjs");
	assert.match(packageJson.scripts?.prepublishOnly ?? "", /pnpm run test:packed-package/);
	assert.match(ci, /pnpm run check:runtime-modules/);
	assert.match(ci, /pnpm run test:packed-package/);
	assert.match(generator, /Generated by scripts\/build-runtime-modules\.mjs/);
	assert.match(packedRunner, /\["install"[^\]]*"--ignore-scripts=false"/s, "packed install must explicitly enable postinstall");
	assert.doesNotMatch(packedRunner, /\["install"[^\]]*"--ignore-scripts"(?!\=false)/s);
	assert.match(packedRunner, /execFileSync\("where\.exe", \["npm"\]/);
	assert.match(packedRunner, /could not resolve npm-cli\.js without a command shell/);
	assert.doesNotMatch(packedRunner, /ComSpec|cmd\.exe/);
	assert.match(packedRunner, /review", "capabilities", "--contract", "gentle-ai\.review-integration\/v2"/);
	assert.doesNotMatch(packedRunner, /git-commit-transaction|transaction runner/i);
});

test("package manifest ships and runs the checked-in package-local Gentle AI installer", () => {
	const packageJson = readPackageJson();
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");

	assert.equal(packageJson.scripts?.postinstall, "node scripts/install-gentle-ai.mjs");
	assert.ok(packageJson.files?.includes("scripts/"));
	assert.match(verifier, /"scripts\/install-gentle-ai\.mjs"/);
	assert.match(verifier, /"scripts\/gentle-ai-installer\.mjs"/);
	assert.match(verifier, /"lib\/gentle-ai-binary\.ts"/);
});

test("package manifest installs pi-pretty through a wrapper without bundling native optional dependencies", () => {
	const packageJson = readPackageJson();

	assert.equal(
		packageJson.dependencies?.["@heyhuynhgiabuu/pi-pretty"],
		"0.6.14",
		"gentle-pi must install the tested pi-pretty version as a normal dependency",
	);
	assert.ok(
		packageJson.pi?.extensions?.includes("./extensions"),
		"gentle-pi must load packaged extension wrappers",
	);
	assert.ok(
		!packageJson.pi?.extensions?.includes(
			"./node_modules/@heyhuynhgiabuu/pi-pretty/dist/index.js",
		),
		"gentle-pi must not reference pnpm-unportable nested node_modules paths",
	);
	assert.ok(
		existsSync(join(PACKAGE_ROOT, "extensions", "pi-pretty.ts")),
		"gentle-pi must expose pi-pretty through a packaged wrapper extension",
	);
	assert.ok(
		existsSync(join(PACKAGE_ROOT, "extensions", "quiet-tools.ts")),
		"gentle-pi must expose quiet built-in tool rendering through a packaged extension",
	);
	assert.ok(
		!packageJson.bundledDependencies?.includes("@heyhuynhgiabuu/pi-pretty"),
		"pi-pretty must not be bundled because its native optional dependencies are platform-specific",
	);
	assert.ok(
		!packageJson.bundleDependencies?.includes("@heyhuynhgiabuu/pi-pretty"),
		"pi-pretty must not be bundled because its native optional dependencies are platform-specific",
	);
});

test("package verification binds the published Gentle AI v2.4.0 runtime pin", () => {
	const installer = readFileSync(join(PACKAGE_ROOT, "scripts", "gentle-ai-installer.mjs"), "utf8");
	const binary = readFileSync(join(PACKAGE_ROOT, "lib", "gentle-ai-binary.ts"), "utf8");
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");

	assert.match(installer, /INSTALLER_VERSION = "2\.4\.0"/);
	assert.match(installer, /GENTLE_AI_WINDOWS_SOURCE_PACKAGE.*GENTLE_AI_WINDOWS_SOURCE_MODULE/);
	assert.match(installer, /GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM = "h1:XKkcy\+t76cyUKQnRwL1UnqHbhh8o416I8HQ1UsdvWSI="/);
	assert.match(installer, /GOTOOLCHAIN: "local"/);
	assert.match(installer, /GOSUMDB: "sum\.golang\.org"/);
	assert.match(binary, /GENTLE_AI_VERSION = INSTALLER_VERSION/);
	assert.match(binary, /GO_SUMDB_SOURCE_BUILD/);
	assert.match(binary, /GENTLE_AI_WINDOWS_SOURCE_MODULE_CHECKSUM/);
	assert.match(verifier, /v2\.4\.0/);
});


function readAgentFrontmatter(file: string): string {
	const source = readFileSync(file, "utf8");
	const match = source.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(match, `${file} must have frontmatter`);
	return match[1];
}

function readAgentDefinition(file: string): {
	name: string;
	source: string;
	tools: string[];
} {
	const source = readFileSync(file, "utf8");
	const frontmatter = readAgentFrontmatter(file);
	const name = frontmatter.match(/^name:\s*(\S+)$/m)?.[1];
	assert.ok(name, `${file} must declare a frontmatter name`);
	const toolsBlock = frontmatter.match(
		/^tools:\n(?: {2}- "\*": false\n)?((?: {2}- [\w-]+\n?)+)/m,
	)?.[1];
	assert.ok(toolsBlock, `${file} must declare a YAML tool list`);
	const tools = [...toolsBlock.matchAll(/^ {2}- ([\w-]+)$/gm)].map(
		(match) => match[1],
	);

	return { name, source, tools };
}

function readTextContract(source: string, heading: string): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = source.match(
		new RegExp(`^## ${escapedHeading}\\n[\\s\\S]*?\\n\\x60\\x60\\x60text\\n([\\s\\S]*?)\\n\\x60\\x60\\x60`, "m"),
	);
	assert.ok(match, `${heading} must include a text contract block`);
	return match[1];
}

function contractFields(contract: string, indentation = 0): string[] {
	const prefix = " ".repeat(indentation);
	return contract
		.split("\n")
		.flatMap((line) => {
			const match = line.match(new RegExp(`^${prefix}([a-z_]+):`));
			return match ? [match[1]] : [];
		});
}

function nestedContractFields(contract: string, parent: string): string[] {
	const lines = contract.split("\n");
	const parentIndexes = lines.flatMap((line, index) =>
		line.startsWith(`${parent}:`) ? [index] : [],
	);
	assert.equal(parentIndexes.length, 1, `${parent} must appear exactly once at top level`);

	const tail = lines.slice(parentIndexes[0] + 1);
	const relativeEnd = tail.findIndex((line) => /^\S/.test(line));
	const nestedBlock = relativeEnd === -1 ? tail : tail.slice(0, relativeEnd);

	return contractFields(nestedBlock.join("\n"), 2);
}

function readMarkdownSection(source: string, heading: string): string {
	const lines = source.split(/\r?\n/);
	const matches = lines.flatMap((line, index) => {
		const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
		return match?.[2] === heading
			? [{ index, level: match[1].length }]
			: [];
	});
	assert.equal(matches.length, 1, `Markdown must contain exactly one ${heading} section`);

	const [{ index: start, level }] = matches;
	const relativeEnd = lines.slice(start + 1).findIndex((line) => {
		const match = line.match(/^(#{1,6})\s+/);
		return match !== null && match[1].length <= level;
	});
	const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;

	return lines.slice(start + 1, end).join("\n").trim();
}

function assertSelectedRuntimeContainment(section: string, sectionName: string): void {
	const boundedWriterPolicy = section.match(
		/For bounded multi-file writes,[\s\S]*?(?=\n\n|\n\s*\d+\.|$)/,
	)?.[0];
	assert.ok(boundedWriterPolicy, `${sectionName} must define bounded writer routing`);
	assert.match(boundedWriterPolicy, /selected installed package-owned `gentle-ai-worker` or user-configured `worker`/);
	assert.match(
		boundedWriterPolicy,
		/If neither selected runtime is available, return an actionable stop that identifies how to restore the selected runtime; do not switch runtimes\./,
		`${sectionName} must stop inside the selected runtime`,
	);
	assert.doesNotMatch(section, /(?:Pi's native|native) `Agent`/i);
}

test("Markdown section extraction isolates policy text from sibling sections", () => {
	const markdown = [
		"# Agent",
		"## Context contract",
		"context-only policy",
		"### Context detail",
		"nested context policy",
		"## Tool safety",
		"tool-only policy",
	].join("\n");

	const context = readMarkdownSection(markdown, "Context contract");

	assert.match(context, /context-only policy/);
	assert.match(context, /nested context policy/);
	assert.doesNotMatch(context, /tool-only policy/);
});

test("packaged agents use YAML list syntax for tool allowlists", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentFiles = readdirSync(agentsDir).flatMap((entry) =>
		entry.endsWith(".md") ? [join(agentsDir, entry)] : [],
	);

	assert.ok(agentFiles.length > 0, "gentle-pi must ship packaged agents");

	for (const file of agentFiles) {
		const frontmatter = readAgentFrontmatter(file);
		assert.doesNotMatch(
			frontmatter,
			/^tools:\s*[^\n,]+(?:,\s*[^\n,]+)+$/m,
			`${file} must not use comma-separated inline tools; pi-subagents expects a YAML list`,
		);
		assert.match(
			frontmatter,
			/^tools:\n(?: {2}- "\*": false\n)?(?: {2}- [\w-]+\n?)+/m,
			`${file} must declare tools as a YAML list`,
		);
	}
});

// The Pi child-session tool registry exposes `find` for filesystem discovery
// and has no `glob` or `webfetch` builtin (see tests/runtime-harness.mjs and
// the working builtin `reviewer` canary in issue #62). A packaged agent that
// declares a name the runtime cannot resolve does not fail loudly: the SDK
// silently drops it and the child starts with a reduced allowlist, so the
// agent reports itself blocked instead of naming the missing tool.
const UNSUPPORTED_CHILD_SESSION_TOOLS = ["glob", "webfetch"];

test("packaged agents declare only tool names a Pi child session can resolve", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentFiles = readdirSync(agentsDir).flatMap((entry) =>
		entry.endsWith(".md") ? [join(agentsDir, entry)] : [],
	);

	assert.ok(agentFiles.length > 0, "gentle-pi must ship packaged agents");

	for (const file of agentFiles) {
		const { tools } = readAgentDefinition(file);
		for (const unsupported of UNSUPPORTED_CHILD_SESSION_TOOLS) {
			assert.ok(
				!tools.includes(unsupported),
				`${file} declares ${unsupported}, which no Pi child session exposes; use find for discovery`,
			);
		}
	}
});

test("the retired Pi adversarial role agents are not packaged", () => {
	// gentle-pi#311 P5: the refuter and targeted validator verdicts execute
	// through Go-owned pi processes via provider-rendered self-contained
	// vectors; the Pi-authored agent definitions must stay deleted.
	for (const retired of RETIRED_ADVERSARIAL_AGENTS) {
		assert.ok(!existsSync(join(PACKAGE_ROOT, "assets", "agents", retired)), `${retired} must stay deleted`);
	}
});

test("forced package installation preserves same-path user-authored agents and separate shadows, including on retired asset paths", () => {
	// The user-authored file below sits on the RETIRED review-refuter.md path:
	// this also pins that gentle-pi#311 P5 asset retirement deletes only
	// hash-proven package-managed copies, never user content.
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-refuter-home-"));
	const temporaryProject = mkdtempSync(join(tmpdir(), "gentle-pi-refuter-project-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const samePathUserAgent = join(temporaryAgentHome, "agents", RETIRED_REFUTER_FILE);
	const userShadow = join(temporaryAgentHome, "subagents", RETIRED_REFUTER_FILE);
	const projectOverride = join(temporaryProject, ".pi", "agents", RETIRED_REFUTER_FILE);
	const userAgentSource = [
		"---",
		"name: review-refuter",
		"tools:",
		"  - read",
		"  - bash",
		"---",
		"user-authored permission policy",
		"",
	].join("\n");

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(projectOverride), { recursive: true });
		writeFileSync(projectOverride, "project override must stay\n");
		mkdirSync(dirname(userShadow), { recursive: true });
		writeFileSync(userShadow, "user shadow must stay\n");
		mkdirSync(dirname(samePathUserAgent), { recursive: true });
		writeFileSync(samePathUserAgent, userAgentSource);

		installSddAssets(temporaryProject, true);

		assert.deepEqual(
			readFileSync(samePathUserAgent),
			Buffer.from(userAgentSource),
			"force refresh must not claim a same-path user agent by filename",
		);
		assert.equal(
			readFileSync(projectOverride, "utf8"),
			"project override must stay\n",
			"package refresh must preserve explicit project overrides",
		);
		assert.equal(
			readFileSync(userShadow, "utf8"),
			"user shadow must stay\n",
			"package refresh must preserve separate user shadows",
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
		rmSync(temporaryProject, { recursive: true, force: true });
	}
});

test("v0.13 ownership evidence is bundled and matches the self-contained upgrade fixture", () => {
	const legacyManifest = JSON.parse(
		readFileSync(V013_MANAGED_ASSETS, "utf8"),
	) as LegacyManagedAssetsManifest;
	const legacyReviewRisk = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8");

	assert.equal(legacyManifest.packageVersion, "0.13.0");
	assert.equal(
		legacyManifest.assets[`agents/${REVIEW_RISK_FILE}`],
		sha256(legacyReviewRisk),
		"published migration evidence must fingerprint the exact v0.13 package asset",
	);
});

test("v0.14 ownership evidence is bundled and matches the self-contained bounded-review fixture", () => {
	const legacyManifest = JSON.parse(
		readFileSync(V014_MANAGED_ASSETS, "utf8"),
	) as LegacyManagedAssetsManifest;
	const legacyReviewRisk = readFileSync(V014_REVIEW_RISK_FIXTURE, "utf8");

	assert.equal(legacyManifest.packageVersion, "0.14.0");
	assert.equal(
		legacyManifest.assets[`agents/${REVIEW_RISK_FILE}`],
		sha256(legacyReviewRisk),
		"migration evidence must fingerprint the exact pre-transaction v0.14 asset",
	);
});

test("first forced sync migrates untouched v0.13 assets, preserves routing, and owns new assets", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v013-upgrade-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);
	const legacySource = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8");
	const routedLegacySource = legacySource.replace(
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\n",
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\nmodel: private/legacy-model\nthinking: xhigh\n",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, routedLegacySource);
		assert.equal(existsSync(managedAssetsManifest), false, "v0.13 had no ownership manifest");

		installSddAssets(PACKAGE_ROOT, true);

		const migrated = readFileSync(installedReviewRisk, "utf8");
		const currentPackageSource = readFileSync(
			join(PACKAGE_ROOT, "assets", "agents", REVIEW_RISK_FILE),
			"utf8",
		);
		assert.notEqual(migrated, routedLegacySource, "the stale v0.13 review contract must refresh");
		assert.match(migrated, /^model: private\/legacy-model$/m);
		assert.match(migrated, /^thinking: xhigh$/m);
		assert.equal(
			migrated.replace(/^model: .*\n|^thinking: .*\n/gm, ""),
			currentPackageSource,
			"migration must update the package body without losing user routing",
		);
		assert.equal(
			readFileSync(installedExemplar, "utf8"),
			readFileSync(join(PACKAGE_ROOT, "assets", "agents", MANAGED_EXEMPLAR_FILE), "utf8"),
			"an asset missing from v0.13 must install normally",
		);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(manifest.assets[`agents/${REVIEW_RISK_FILE}`], sha256(migrated));
		assert.equal(
			manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`],
			sha256(readFileSync(installedExemplar, "utf8")),
		);

		const userEditedMigration = migrated.replace(
			"Run this selected lens exactly once against the supplied `initial_review_tree`.",
			"Run this selected lens exactly once against the supplied `initial_review_tree` with a user-authored note.",
		);
		assert.notEqual(userEditedMigration, migrated, "the fixture must exercise post-migration drift");
		writeFileSync(installedReviewRisk, userEditedMigration);
		installSddAssets(PACKAGE_ROOT, true);
		assert.deepEqual(
			readFileSync(installedReviewRisk),
			Buffer.from(userEditedMigration),
			"exact full-content ownership must protect edits made after migration",
		);
		const postEditManifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(postEditManifest.assets[`agents/${REVIEW_RISK_FILE}`], undefined);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("first forced sync migrates untouched v0.14 review contracts and preserves routing", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v014-upgrade-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const legacySource = readFileSync(V014_REVIEW_RISK_FIXTURE, "utf8");
	const routedLegacySource = legacySource.replace(
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\n",
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\nmodel: private/v014-model\nthinking: high\n",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, routedLegacySource);

		installSddAssets(PACKAGE_ROOT, true);

		const migrated = readFileSync(installedReviewRisk, "utf8");
		assert.notEqual(migrated, routedLegacySource);
		assert.match(migrated, /^model: private\/v014-model$/m);
		assert.match(migrated, /^thinking: high$/m);
		assert.match(migrated, /initial_review_tree/);
		assert.doesNotMatch(migrated, /Full 4R runs at most two complete sweeps per lens/);
		const currentPackageSource = readFileSync(
			join(PACKAGE_ROOT, "assets", "agents", REVIEW_RISK_FILE),
			"utf8",
		);
		assert.equal(
			migrated.replace(/^model: .*\n|^thinking: .*\n/gm, ""),
			currentPackageSource,
		);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("first forced sync preserves a body-edited v0.13 asset byte-for-byte", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v013-edited-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const editedLegacySource = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8").replace(
		"Find security risks; do not fix them.",
		"Find security risks; preserve this user-authored body edit.",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, editedLegacySource);

		installSddAssets(PACKAGE_ROOT, true);

		assert.deepEqual(readFileSync(installedReviewRisk), Buffer.from(editedLegacySource));
		const manifest = JSON.parse(
			readFileSync(join(temporaryAgentHome, "gentle-ai", "managed-assets.json"), "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(manifest.assets[`agents/${REVIEW_RISK_FILE}`], undefined);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("forced package installation refreshes an asset recorded as package-managed", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-malformed-refuter-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);
	const previousPackageSource =
		"---\nname: gentle-ai-explore\ntools:\n  - read\n  - bash\n---\nprevious package version\n";
	const routedPreviousPackageSource = previousPackageSource.replace(
		"name: gentle-ai-explore\n",
		"name: gentle-ai-explore\nmodel: openai/previous-package\nthinking: high\n",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);
		assert.ok(existsSync(installedExemplar), "a missing package asset must install");
		assert.ok(
			existsSync(managedAssetsManifest),
			"the installer must record ownership independently from the filename",
		);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		writeFileSync(installedExemplar, routedPreviousPackageSource);
		manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`] = sha256(
			routedPreviousPackageSource,
		);
		writeFileSync(managedAssetsManifest, JSON.stringify(manifest, null, 2));

		installSddAssets(PACKAGE_ROOT, true);

		const refreshed = readAgentDefinition(installedExemplar);
		assert.deepEqual(refreshed.tools, MANAGED_EXEMPLAR_TOOLS);
		assert.doesNotMatch(refreshed.source, /^  - bash$/m);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

function assertManagedAgentUserEditIsPreserved(
	editLabel: string,
	editSource: (source: string) => string,
): void {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-managed-edit-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);
		const installedSource = readFileSync(installedExemplar, "utf8");
		const userEditedSource = editSource(installedSource);
		assert.notEqual(userEditedSource, installedSource, `${editLabel} must alter the asset`);
		writeFileSync(installedExemplar, userEditedSource);

		installSddAssets(PACKAGE_ROOT, true);

		assert.deepEqual(
			readFileSync(installedExemplar),
			Buffer.from(userEditedSource),
			`${editLabel} must invalidate ownership and survive force refresh byte-for-byte`,
		);
		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(
			manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`],
			undefined,
			`${editLabel} must remove package ownership`,
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
}

test("forced package installation preserves a model-only edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("a model-only user edit", (source) =>
		source.replace(
			"name: gentle-ai-explore\n",
			"name: gentle-ai-explore\nmodel: private/user-model\n",
		),
	);
});

test("forced package installation preserves a thinking-only edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("a thinking-only user edit", (source) =>
		source.replace(
			"name: gentle-ai-explore\n",
			"name: gentle-ai-explore\nthinking: xhigh\n",
		),
	);
});

test("forced package installation preserves an ordinary body edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("an ordinary body edit", (source) =>
		source.replace(
			"You are the read-only explorer for generic non-SDD work.",
			"Preserve this user-authored body change. You are the read-only explorer for generic non-SDD work.",
		),
	);
});

test("package model assignment keeps only package-managed agents owned", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-model-ownership-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const userAgent = join(temporaryAgentHome, "agents", "user-router.md");
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"gentle-ai",
		"managed-assets.json",
	);
	const userAgentSource = "---\nname: user-router\n---\nuser-owned body\n";

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);
		writeFileSync(userAgent, userAgentSource);

		applyModelConfig(PACKAGE_ROOT, {
			"gentle-ai-explore": { model: "package/selected-model", thinking: "high" },
			"user-router": { model: "user/selected-model", thinking: "low" },
		});

		const routedExemplar = readFileSync(installedExemplar, "utf8");
		const routedUserAgent = readFileSync(userAgent, "utf8");
		assert.match(routedExemplar, /^model: package\/selected-model$/m);
		assert.match(routedExemplar, /^thinking: high$/m);
		assert.match(routedUserAgent, /^model: user\/selected-model$/m);
		assert.match(routedUserAgent, /^thinking: low$/m);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(
			manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`],
			sha256(routedExemplar),
			"package-controlled routing must update the managed asset hash coherently",
		);
		assert.equal(
			manifest.assets["agents/user-router.md"],
			undefined,
			"routing an arbitrary user agent must not relabel it as package-owned",
		);

		installSddAssets(PACKAGE_ROOT, true);
		assert.equal(
			readFileSync(installedExemplar, "utf8"),
			readFileSync(join(PACKAGE_ROOT, "assets", "agents", MANAGED_EXEMPLAR_FILE), "utf8"),
			"a routed package-managed agent must remain eligible for package refresh",
		);
		assert.equal(
			readFileSync(userAgent, "utf8"),
			routedUserAgent,
			"package refresh must preserve the routed arbitrary user agent",
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("jd-fix-agent packaged allowlist includes write tools", () => {
	const frontmatter = readAgentFrontmatter(
		join(PACKAGE_ROOT, "assets", "agents", "jd-fix-agent.md"),
	);

	for (const tool of ["read", "edit", "write", "bash"]) {
		assert.match(frontmatter, new RegExp(`^  - ${tool}$`, "m"));
	}
});

test("gentle-ai-worker packages the exact scoped writer contract", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentPath = join(agentsDir, "gentle-ai-worker.md");
	assert.ok(existsSync(agentPath), "gentle-pi must package gentle-ai-worker.md");
	for (const genericName of ["worker.md", "generic-writer.md"]) {
		assert.ok(
			!existsSync(join(agentsDir, genericName)),
			`the package-owned writer must not use collision-prone ${genericName}`,
		);
	}

	const { name, source, tools } = readAgentDefinition(agentPath);
	assert.equal(name, "gentle-ai-worker");
	assert.deepEqual(tools, [
		"read",
		"grep",
		"find",
		"edit",
		"write",
		"bash",
		"mem_save",
	]);
	assert.ok(
		tools.every((tool) => !tool.startsWith("subagent_")),
		"a subagent must not be able to delegate",
	);
	assert.ok(!tools.includes("glob"), "the unsupported glob tool must not return");

	const interactionContract = readMarkdownSection(source, "Interaction contract");
	assert.doesNotMatch(
		interactionContract,
		/```text/,
		"the interaction section must not define a second normative envelope",
	);
	assert.match(interactionContract, /stop editing/i);
	assert.match(interactionContract, /full schema in the Return contract/);
	assert.match(interactionContract, /`status: interaction_required`/);
	assert.match(interactionContract, /nested `interaction_required` payload/);

	const returnContract = readTextContract(source, "Return contract");
	assert.deepEqual(contractFields(returnContract), [
		"status",
		"summary",
		"files_changed",
		"tdd_evidence",
		"validation",
		"risks",
		"review_focus",
		"skill_resolution",
		"interaction_required",
	]);
	assert.deepEqual(nestedContractFields(returnContract, "interaction_required"), [
		"question",
		"reason",
		"options",
		"unblock_response",
	]);
	assert.match(
		returnContract,
		/skill_resolution: paths-injected \| paths-invalid \| none/,
	);
	assert.equal(
		(source.match(/```text/g) ?? []).length,
		1,
		"the Return contract must be the single authoritative full handoff schema",
	);
	assert.doesNotMatch(source, /fallback-(?:registry|path)/);

	const returnContractSection = readMarkdownSection(source, "Return contract");
	assert.match(
		returnContractSection,
		/Use `skill_resolution: paths-invalid` only when the parent injected one or more exact skill paths and any supplied path cannot be read/,
	);
	assert.match(
		returnContractSection,
		/With `skill_resolution: paths-invalid`, keep `status: blocked`/,
	);

	const contextContract = readMarkdownSection(source, "Context contract");
	assert.match(contextContract, /pre-existing untracked targets explicitly listed by the parent/);
	assert.match(contextContract, /new files required by the delegated task/);
	assert.match(contextContract, /derived candidate set the human can approve or narrow/);
	assert.match(contextContract, /never an open request for the human to author paths or globs/);
	assert.match(interactionContract, /closed set the human can approve, decline, or select from/);
	assert.match(interactionContract, /never ask the human to author paths, globs, identifiers, or commands as free text/);

	const implementationRules = readMarkdownSection(source, "Implementation rules");
	assert.match(implementationRules, /`blocked` only for a non-human technical blocker/);

	const toolSafety = readMarkdownSection(source, "Tool safety");
	assert.match(toolSafety, /sensitive files/);
	assert.match(toolSafety, /stage, commit, push, publish/);

	const memorySafety = readMarkdownSection(source, "Memory safety");
	assert.match(memorySafety, /secrets, credentials, personal data/);
	assert.match(memorySafety, /raw untrusted repository/);

	const testDiscipline = readMarkdownSection(source, "Test discipline");
	assert.match(testDiscipline, /Strict TDD is active/);
	assert.match(testDiscipline, /not active/);
	assert.match(
		testDiscipline,
		/Broad suites, builds, formatters, or linters may run only when explicitly authorized by the parent\./,
	);
	assert.match(testDiscipline, /Keep every command exact and verify its scope before execution\./);
	assert.doesNotMatch(testDiscipline, /clearly required by the repository contract/);
});

test("installSddAssets installs gentle-ai-worker with a loader-compatible scoped identity", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-agent-home-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;

	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);

		const installedAgentsDir = join(temporaryAgentHome, "agents");
		const installedAgentPath = join(installedAgentsDir, "gentle-ai-worker.md");
		assert.ok(existsSync(installedAgentPath), "the production installer must install gentle-ai-worker.md");
		for (const genericName of ["worker.md", "generic-writer.md"]) {
			assert.ok(
				!existsSync(join(installedAgentsDir, genericName)),
				`the installer must not create collision-prone ${genericName}`,
			);
		}

		const { name, source, tools } = readAgentDefinition(installedAgentPath);
		const normalizedRuntimeIdentity = name.trim().toLowerCase();
		assert.equal(normalizedRuntimeIdentity, "gentle-ai-worker");
		assert.deepEqual(tools, [
			"read",
			"grep",
			"find",
			"edit",
			"write",
			"bash",
			"mem_save",
		]);
		assert.doesNotMatch(
			readAgentFrontmatter(installedAgentPath),
			/^package\s*:/m,
			"package frontmatter must not alter external loader identity",
		);
		assert.doesNotMatch(source, /^name:\s*(?:worker|generic-writer)$/m);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.GENTLE_PI_AGENT_HOME;
		} else {
			process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}

	assert.equal(process.env.GENTLE_PI_AGENT_HOME, previousAgentHome);
	assert.ok(
		!existsSync(temporaryAgentHome),
		"the integration test must delete only its temporary agent home",
	);
});

test("normal and forced installation copy generic agents with complete role contracts", () => {
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const expectedTools = {
		"gentle-ai-explore": ["read", "grep", "find", "codegraph"],
		"gentle-ai-verify": ["read", "grep", "find", "bash"],
	} as const;

	try {
		for (const force of [false, true]) {
			const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-generic-agents-"));
			process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
			try {
				installSddAssets(PACKAGE_ROOT, force);

				for (const [name, tools] of Object.entries(expectedTools)) {
					const packagedPath = join(PACKAGE_ROOT, "assets", "agents", `${name}.md`);
					const installedPath = join(temporaryAgentHome, "agents", `${name}.md`);
					const { name: installedName, source, tools: installedTools } = readAgentDefinition(installedPath);
					assert.equal(source, readFileSync(packagedPath, "utf8"));
					assert.equal(installedName, name);
					assert.deepEqual(installedTools, tools);
					assert.match(source, /generic non-SDD work/);
					assert.match(source, /Do not (?:fix findings, delegate to child agents|delegate to child agents, commit)/);
					if (name === "gentle-ai-explore") {
						assert.match(source, /cwd-scoped `codegraph` tool/);
						assert.match(source, /never ask it to target another path/);
						assert.match(source, /sole permitted mutation/);
						assert.match(source, /all tracked files, source files, and other project content remain read-only/);
						assert.match(source, /CodeGraph reports that it is unavailable or fails/);
						assert.match(source, /Do not use that fallback before CodeGraph is unavailable or fails/);
					}
					assert.match(source, /Do not (?:edit, write|edit, write, or fix findings)/);
					assert.match(source, /compressed (?:handoff|evidence handoff)/);
					assert.match(source, /Do not use SDD phase protocols or review lenses\./);
					if (name === "gentle-ai-verify") {
						assert.match(source, /exact test, build, or lint commands explicitly authorized by the parent/);
						assert.match(source, /only outputs the parent explicitly identified as expected/);
						assert.match(source, /unexpected mutation as a blocker/);
						assert.match(source, /do not clean it up or fix it/);
					}
				}
			} finally {
				rmSync(temporaryAgentHome, { recursive: true, force: true });
			}
		}
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
	}
});

test("bounded implementation routing contains selected runtimes in both policy sections", () => {
	const routing = readFileSync(
		join(PACKAGE_ROOT, "assets", "orchestrator-delegation.md"),
		"utf8",
	);
	const simpleDelegation = readMarkdownSection(routing, "2. Simple Delegation");
	const mandatoryDelegation = readMarkdownSection(routing, "Mandatory Delegation Triggers");

	assertSelectedRuntimeContainment(simpleDelegation, "Simple Delegation");
	assertSelectedRuntimeContainment(mandatoryDelegation, "Mandatory Delegation Triggers");
	assert.doesNotMatch(
		routing,
		/non-normative compatibility quotation|former wording is retained|no-runtime inline exception|superseded by the stop requirement/,
		"model-facing routing must not retain contradictory dead prose",
	);
	assert.doesNotMatch(
		routing,
		/`generic-writer`/,
		"routing must not revive the collision-prone generic package name",
	);
});

test("orchestrator routes generic roles without static RDD lens routing", () => {
	for (const file of ["orchestrator.md", "orchestrator-delegation.md"]) {
		const routing = readFileSync(join(PACKAGE_ROOT, "assets", file), "utf8");
		assert.match(routing, /generic non-SDD exploration[\s\S]*`gentle-ai-explore`/);
		assert.match(
			routing,
			/bounded (?:non-SDD )?(?:implementation|multi-file writes)[\s\S]*`gentle-ai-worker`/,
		);
		assert.match(routing, /generic non-SDD (?:technical )?verification[\s\S]*`gentle-ai-verify`/);
		assert.match(routing, /SDD roles stay inside SDD|Use `sdd-explore` and `sdd-verify` only inside SDD/);
		assert.match(routing, /(?:truly local )?read-only check(?:ing)? of (?:known )?1[-–]3 known files|1[-–]3-file read-only check/);
		assert.match(routing, /(?:verification that |verification commands →).*executes? or delegates?|executing\/delegating verification commands/);
		assert.match(routing, /selected runtime[\s\S]{0,160}actionable stop/i);
		assert.doesNotMatch(routing, /(?:Pi's native|native) `Agent`/i);
		assert.doesNotMatch(routing, /review lenses? (?:inside|only inside)|review lens routing/i);
	}

	const core = readFileSync(join(PACKAGE_ROOT, "assets", "orchestrator.md"), "utf8");
	assert.match(core, /Gentle AI dynamically supplies runtime-specific RDD instructions/);
	assert.match(core, /this package does not invent or fall back/);
});

test("pi-pretty wrapper uses real package path resolution for pnpm symlink installs", () => {
	const wrapper = readFileSync(
		join(PACKAGE_ROOT, "extensions", "pi-pretty.ts"),
		"utf8",
	);

	assert.match(wrapper, /realpathSync/);
	assert.match(wrapper, /createRequire/);
	assert.match(wrapper, /@heyhuynhgiabuu\/pi-pretty/);
	assert.match(wrapper, /PI_PRETTY_SUPPRESSED_TOOL_NAMES/);
	assert.match(wrapper, /quietToolsEnabled/);
});

test("v2.2.0 release package and runtime stop before publication", () => {
	const packageJson = readPackageJson();
	assert.equal(packageJson.version, "2.2.0", "the release manifest must remain explicitly pinned to v2.2.0");
	assert.equal(
		packageJson.scripts?.test,
		"node --experimental-strip-types --test tests/*.test.ts && pnpm run check:provider-contract && pnpm run test:harness",
	);
	assert.ok(packageJson.files?.includes("assets/"));
	assert.ok(packageJson.files?.includes("contracts/"));

	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");
	// gentle-pi#311 P5: the retired adversarial role agents must not be pinned
	// as required package files, while the append-only migration history stays.
	assert.doesNotMatch(verifier, /assets\/agents\/review-refuter\.md/);
	assert.doesNotMatch(verifier, /assets\/agents\/review-validator\.md/);
	assert.match(verifier, /assets\/migrations\/managed-assets-v0\.13\.json/);
	assert.match(verifier, /assets\/migrations\/managed-assets-v0\.14\.json/);

	const runtime = readFileSync(join(PACKAGE_ROOT, "extensions", "gentle-ai.ts"), "utf8");
	assert.doesNotMatch(runtime, /execFileSync\("git", \["(?:commit|push|tag)"/);
	assert.doesNotMatch(runtime, /execFileSync\("(?:npm|pnpm)", \["publish"/);
});

test("bounded review keeps the Judgment Day skill contract at canon metadata version 1.7", () => {
	const frontmatter = readAgentFrontmatter(
		join(PACKAGE_ROOT, "skills", "judgment-day", "SKILL.md"),
	);

	assert.match(frontmatter, /^  version: "1\.7"$/m);
	assert.doesNotMatch(frontmatter, /^  version: "1\.4"$/m);
});

test("README documents dynamic Gentle AI RDD ownership and the installed permission boundary", () => {
	const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
	for (const clause of [
		"Gentle AI dynamically supplies runtime-specific RDD instructions",
		"does not define an RDD lifecycle",
		"Dangerous-command safety remains independent and authoritative.",
		"package-managed isolated installation",
		"Project and user overrides may shadow a package asset",
	]) {
		assert.ok(readme.includes(clause), `README missing dynamic RDD clause: ${clause}`);
	}
	assert.doesNotMatch(readme, /New ordinary review uses compact `gentle_review` `start -> finalize -> validate`\./);
});
