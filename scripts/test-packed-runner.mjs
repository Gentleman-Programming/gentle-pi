#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const MAX_NPM_OUTPUT_BYTES = 1024 * 1024;
const MAX_UNHOOKED_REPORT_BYTES = 1024;
const UNHOOKED_STAGES = new Set(["pack", "pack-result", "install", "artifact-check", "import-probe", "post-import-check", "cleanup"]);
const UNHOOKED_ERROR_CODES = new Set(["spawn-failed", "timed-out", "output-limit", "nonzero-exit", "invalid-result", "assertion-failed", "cleanup-failed", "unknown"]);
const UNHOOKED_CHECK_IDS = new Set([
	"not-attempted", "runner-temp", "temporary-root", "project-sdk-version", "pack-command", "pack-metadata", "pack-integrity", "install-command", "import-probe-command", "import-probe-result", "unhooked-imports-complete", "cleanup-owned-root-removal",
	"asset-runtime-windows-session-transport-owned", "asset-runtime-windows-session-transport-hash",
	"asset-lib-windows-session-transport-owned", "asset-lib-windows-session-transport-hash",
	"asset-lib-agents-session-transport-owned", "asset-lib-agents-session-transport-hash",
	"asset-extension-gentle-agents-owned", "asset-extension-gentle-agents-hash",
	"asset-extension-gentle-ai-owned", "asset-extension-gentle-ai-hash",
	"asset-native-review-cli-owned", "asset-native-review-cli-hash",
	"asset-review-integration-v2-owned", "asset-review-integration-v2-hash",
	"asset-installer-gentle-ai-owned", "asset-installer-gentle-ai-hash",
	"asset-installer-tui-mode-setting-owned", "asset-installer-tui-mode-setting-hash",
	"native-package-cache-absent", "native-command-absent", "sdk-manifest-owned", "sdk-version", "jiti-manifest-owned", "jiti-static-export", "jiti-entry-owned", "jiti-version",
	"home-empty", "gentle-pi-agent-empty", "pi-coding-agent-empty", "gentle-pi-config-empty", "xdg-config-empty", "xdg-cache-empty", "xdg-data-empty", "appdata-empty", "local-appdata-empty",
]);

function newUnhookedReceipt() {
	return { checkId: "not-attempted", packVerified: false, installCompleted: false, cleanupCompleted: false };
}

function selectUnhookedCheck(receipt, checkId) {
	if (!UNHOOKED_CHECK_IDS.has(checkId)) throw new Error("invalid unhooked check identifier");
	receipt.checkId = checkId;
}

function isWithin(rootPath, candidatePath) {
	const root = resolve(rootPath);
	const candidate = resolve(candidatePath);
	const remainder = relative(root, candidate);
	return remainder !== "" && !isAbsolute(remainder) && !remainder.split(sep).includes("..");
}

function assertOwnedRegularFile(rootPath, relativePath) {
	const ownedRoot = resolve(rootPath);
	const rootEntry = lstatSync(ownedRoot);
	if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error(`refusing unowned package root: ${rootPath}`);
	const path = resolve(ownedRoot, relativePath);
	if (!isWithin(ownedRoot, path)) throw new Error(`path escapes owned root: ${relativePath}`);
	const normalizedRelativePath = relative(ownedRoot, path);
	let current = ownedRoot;
	for (const segment of normalizedRelativePath.split(sep)) {
		current = join(current, segment);
		const entry = lstatSync(current);
		if (entry.isSymbolicLink()) throw new Error(`refusing symbolic link in owned package: ${relativePath}`);
	}
	if (!lstatSync(path).isFile()) throw new Error(`expected regular file: ${relativePath}`);
	return path;
}

function assertEmptyDirectory(path) {
	const entries = readdirSync(path);
	if (entries.length !== 0) throw new Error(`disposable home changed unexpectedly: ${path}`);
}

function safeJson(buffer, description) {
	const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
	if (Buffer.byteLength(text, "utf8") > MAX_NPM_OUTPUT_BYTES) throw new Error(`${description} exceeded 1 MiB`);
	return JSON.parse(text);
}

function validExitStatus(value) {
	return Number.isInteger(value) && value > 0 && value <= 255 ? value : undefined;
}

class UnhookedFailure extends Error {
	constructor(stage, code, exitStatus) {
		super("unhooked packed proof failed");
		this.stage = UNHOOKED_STAGES.has(stage) ? stage : "cleanup";
		this.code = UNHOOKED_ERROR_CODES.has(code) ? code : "unknown";
		this.exitStatus = validExitStatus(exitStatus);
	}
}

function processFailure(stage, error) {
	const details = error && typeof error === "object" ? error : {};
	const exitStatus = validExitStatus(details.status);
	if (details.code === "ETIMEDOUT") return new UnhookedFailure(stage, "timed-out", exitStatus);
	if (details.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return new UnhookedFailure(stage, "output-limit", exitStatus);
	return new UnhookedFailure(stage, exitStatus === undefined ? "spawn-failed" : "nonzero-exit", exitStatus);
}

function stageFailure(stage, error, invalidResult = false) {
	if (error instanceof UnhookedFailure) return error;
	return new UnhookedFailure(stage, invalidResult ? "invalid-result" : "assertion-failed");
}

function reportUnhookedReceipt(receipt, error) {
	const failure = error instanceof UnhookedFailure ? error : undefined;
	const report = {
		mode: "unhooked-imports",
		status: failure === undefined ? "complete" : "failed",
		checkId: failure === undefined ? "unhooked-imports-complete" : receipt.checkId,
		packVerified: receipt.packVerified,
		installCompleted: receipt.installCompleted,
		cleanupCompleted: receipt.cleanupCompleted,
		...(failure === undefined ? {} : { stage: failure.stage, code: failure.code, ...(failure.exitStatus === undefined ? {} : { exitStatus: failure.exitStatus }) }),
	};
	const line = JSON.stringify(report);
	const boundedLine = Buffer.byteLength(line, "utf8") <= MAX_UNHOOKED_REPORT_BYTES
		? line
		: '{"mode":"unhooked-imports","status":"failed","checkId":"not-attempted","packVerified":false,"installCompleted":false,"cleanupCompleted":false,"stage":"cleanup","code":"unknown"}';
	try { (failure === undefined ? process.stdout : process.stderr).write(`${boundedLine}\n`); } catch { /* Reporting cannot expose a raw secondary error. */ }
	if (failure !== undefined) process.exitCode = failure.exitStatus ?? 1;
}

function windowsNpmInvocation() {
	const candidates = [];
	if (process.env.npm_execpath !== undefined && /[\\/]npm[\\/]bin[\\/]npm-cli\.js$/i.test(process.env.npm_execpath)) candidates.push(process.env.npm_execpath);
	for (const executable of new Set([process.execPath, realpathSync(process.execPath)])) candidates.push(join(dirname(executable), "node_modules", "npm", "bin", "npm-cli.js"));
	const installedCli = candidates.find((path) => existsSync(path));
	if (installedCli !== undefined) return { file: process.execPath, prefix: [installedCli] };
	let commandPaths = [];
	try { commandPaths = execFileSync("where.exe", ["npm"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).split(/\r?\n/).filter(Boolean); }
	catch { /* fall through to the explicit resolution error */ }
	for (const path of commandPaths) {
		if (basename(path).toLowerCase() === "npm.exe") return { file: path, prefix: [] };
		const cli = join(dirname(path), "node_modules", "npm", "bin", "npm-cli.js");
		if (existsSync(cli)) return { file: process.execPath, prefix: [cli] };
	}
	throw new Error("could not resolve npm-cli.js without a command shell");
}

function runNpmWithEnv(arguments_, env, options) {
	const invocation = process.platform === "win32" ? windowsNpmInvocation() : { file: "npm", prefix: [] };
	return execFileSync(invocation.file, [...invocation.prefix, ...arguments_], { ...options, env });
}

function runBoundedNpm(stage, arguments_, env, cwd) {
	try {
		return runNpmWithEnv(arguments_, env, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 120000,
			maxBuffer: MAX_NPM_OUTPUT_BYTES,
		});
	} catch (error) {
		throw processFailure(stage, error);
	}
}

function runBoundedProbe(arguments_, env, cwd) {
	try {
		return execFileSync(process.execPath, arguments_, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env,
			timeout: 120000,
			maxBuffer: MAX_NPM_OUTPUT_BYTES,
		});
	} catch (error) {
		throw processFailure("import-probe", error);
	}
}

async function testHookedPackedRunner() {
	const temporary = mkdtempSync(join(tmpdir(), "gentle-pi-packed-runner-"));
	const packDirectory = join(temporary, "pack");
	const installDirectory = join(temporary, "install");
	// Every child inherits only disposable Pi homes, never the operator's settings.
	const agentHome = join(temporary, "agent");
	const piAgentHome = join(temporary, "pi-agent");
	const isolatedEnv = { ...process.env, GENTLE_PI_AGENT_HOME: agentHome, PI_CODING_AGENT_DIR: piAgentHome };
	const runNpm = (arguments_, options) => runNpmWithEnv(arguments_, isolatedEnv, options);
	try {
		mkdirSync(packDirectory);
		mkdirSync(installDirectory);
		mkdirSync(agentHome);
		mkdirSync(piAgentHome);
	const originalSettings = '{ "tuiMode": "regular", "theme": "packed-fixture" }\n';
	writeFileSync(join(agentHome, "settings.json"), originalSettings);
	const packed = JSON.parse(runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
}));
	if (packed.length !== 1 || typeof packed[0]?.filename !== "string") throw new Error("npm pack did not return one tarball");
	const tarball = join(packDirectory, packed[0].filename);
	writeFileSync(join(installDirectory, "package.json"), JSON.stringify({ name: "gentle-pi-packed-runner-test", private: true }), "utf8");
	runNpm(["install", "--ignore-scripts=false", "--no-audit", "--no-fund", "--package-lock=false", "--omit=dev", "--legacy-peer-deps", tarball], {
		cwd: installDirectory,
		stdio: "inherit",
	});
	// This is an ordinary npm consumer, not Pi's managed global npm directory.
	assert.equal(readFileSync(join(agentHome, "settings.json"), "utf8"), originalSettings);
	assert.deepEqual(readdirSync(agentHome), ["settings.json"]);
	assert.deepEqual(readdirSync(piAgentHome), []);
	assert.equal(existsSync(join(installDirectory, ".pi", "settings.json")), false);
	const packageRoot = join(installDirectory, "node_modules", "gentle-pi");
	assert.ok(existsSync(join(packageRoot, "scripts", "install-tui-mode-setting.mjs")));
	const { nativeReviewAbandonAuthorization } = await import(pathToFileURL(join(packageRoot, "runtime", "native-review-cli.mjs")).href);
	const abandonAuthorization = nativeReviewAbandonAuthorization({
		lineage: "review-abc",
		expectedRevision: "revision-9",
		snapshotIdentity: "snapshot-1",
		capturedLensResults: ["00-risk.json", "01-refuter.json"],
		findingsPresent: true,
		actor: "maintainer",
		reason: "operator_disposition",
	});
	assert.equal(abandonAuthorization, [
		"gentle-ai.review-abandon-authorization/v2",
		"lineage=review-abc",
		"revision=revision-9",
		"snapshot_identity=snapshot-1",
		"reason=operator_disposition",
		"captured_lens_results=00-risk.json,01-refuter.json",
		"findings_present=true",
		"actor=maintainer",
	].join("\n"));
	assert.ok(!abandonAuthorization.includes("evidence_records_present"));
	// Accept prerelease pins too: a stable-only pattern here was a second,
	// silent pin that refused the first prerelease version directory.
	const versions = readdirSync(join(packageRoot, ".gentle-ai"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.]*)?$/.test(entry.name));
	if (versions.length !== 1) throw new Error("packed install did not contain exactly one package-local Gentle AI version");
	const executable = join(packageRoot, ".gentle-ai", versions[0].name, process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
	const capabilities = JSON.parse(execFileSync(executable, ["review", "capabilities", "--contract", "gentle-ai.review-integration/v2"], { cwd: installDirectory, encoding: "utf8", env: isolatedEnv }));
	// Decode with the PACKED consumer's own decoder rather than comparing the
	// schema string against a list hand-copied into this script. The copy was a
	// second, silent pin: it accepted only `capabilities/v2`, so the moment the
	// pinned provider advertised an additive minor this E2E rejected a pairing
	// that gentle-pi reads correctly, and it would have done so again on the
	// next minor. Using the shipped decoder makes the assertion what it always
	// meant to be — the packed consumer can read the packed provider — and it
	// checks the whole envelope (protocol major/minor, required operations,
	// gates, projections, advertised schemas, mandatory features, and the
	// self-reported executable digest) instead of one string.
	const { decodeReviewCapabilitiesV2 } = await import(pathToFileURL(join(packageRoot, "runtime", "review-integration-v2.mjs")).href);
	const executableDigest = `sha256:${createHash("sha256").update(readFileSync(executable)).digest("hex")}`;
	const decoded = decodeReviewCapabilitiesV2(capabilities, executableDigest);
	if (decoded.contract !== "gentle-ai.review-integration/v2" || decoded.packageVersion !== versions[0].name.slice(1)) throw new Error("package-local Gentle AI returned incompatible capabilities");
	const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
		process.stdout.write(`packed package E2E passed (gentle-pi ${packageManifest.version ?? "unknown"}; Gentle AI ${decoded.packageVersion ?? "unknown"})\n`);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

function isolatedUnhookedEnvironment(temporary) {
	const homes = join(temporary, "homes");
	const home = join(homes, "home");
	const agentHome = join(homes, "gentle-pi-agent");
	const piAgentHome = join(homes, "pi-coding-agent");
	const gentleConfigHome = join(homes, "gentle-pi-config");
	const xdgConfigHome = join(homes, "xdg-config");
	const xdgCacheHome = join(homes, "xdg-cache");
	const xdgDataHome = join(homes, "xdg-data");
	const appData = join(homes, "appdata");
	const localAppData = join(homes, "local-appdata");
	const npmCache = join(temporary, "npm-cache");
	const npmUserConfig = join(temporary, "npm-userconfig");
	const passthrough = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "PATHEXT", "OS", "CI", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"];
	const env = {};
	for (const key of passthrough) if (typeof process.env[key] === "string") env[key] = process.env[key];
	for (const directory of [homes, home, agentHome, piAgentHome, gentleConfigHome, xdgConfigHome, xdgCacheHome, xdgDataHome, appData, localAppData, npmCache]) mkdirSync(directory, { recursive: true });
	Object.assign(env, {
		HOME: home, USERPROFILE: home, APPDATA: appData, LOCALAPPDATA: localAppData,
		XDG_CONFIG_HOME: xdgConfigHome, XDG_CACHE_HOME: xdgCacheHome, XDG_DATA_HOME: xdgDataHome,
		TMPDIR: temporary, TMP: temporary, TEMP: temporary,
		GENTLE_PI_AGENT_HOME: agentHome, GENTLE_PI_CONFIG_HOME: gentleConfigHome, PI_CODING_AGENT_DIR: piAgentHome,
		NPM_CONFIG_CACHE: npmCache, npm_config_cache: npmCache, NPM_CONFIG_USERCONFIG: npmUserConfig, npm_config_userconfig: npmUserConfig,
		NPM_CONFIG_TMP: temporary, npm_config_tmp: temporary, NPM_CONFIG_IGNORE_SCRIPTS: "true", npm_config_ignore_scripts: "true",
		NPM_CONFIG_UPDATE_NOTIFIER: "false", npm_config_update_notifier: "false",
	});
	if (process.platform === "win32") {
		env.HOMEDRIVE = home.slice(0, 2);
		env.HOMEPATH = home.slice(2).replaceAll("/", "\\\\");
	}
	return {
		env,
		homes: [
			{ checkId: "home-empty", path: home },
			{ checkId: "gentle-pi-agent-empty", path: agentHome },
			{ checkId: "pi-coding-agent-empty", path: piAgentHome },
			{ checkId: "gentle-pi-config-empty", path: gentleConfigHome },
			{ checkId: "xdg-config-empty", path: xdgConfigHome },
			{ checkId: "xdg-cache-empty", path: xdgCacheHome },
			{ checkId: "xdg-data-empty", path: xdgDataHome },
			{ checkId: "appdata-empty", path: appData },
			{ checkId: "local-appdata-empty", path: localAppData },
		],
	};
}

function assertPackResult(packed, packDirectory, receipt) {
	selectUnhookedCheck(receipt, "pack-metadata");
	if (!Array.isArray(packed) || packed.length !== 1 || !packed[0] || typeof packed[0] !== "object") throw new Error("npm pack did not return exactly one package");
	const entry = packed[0];
	if (entry.name !== "gentle-pi" || typeof entry.filename !== "string" || entry.filename !== basename(entry.filename)) throw new Error("npm pack returned an unsafe package identity");
	if (typeof entry.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)) throw new Error("npm pack did not report a sha512 integrity");
	const tarball = resolve(packDirectory, entry.filename);
	if (!isWithin(packDirectory, tarball)) throw new Error("npm pack tarball escapes the owned pack directory");
	selectUnhookedCheck(receipt, "pack-integrity");
	assertOwnedRegularFile(packDirectory, entry.filename);
	const actualIntegrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
	if (actualIntegrity !== entry.integrity) throw new Error("npm pack tarball integrity does not match its reported identity");
	return { entry, tarball };
}

const HASHED_PACKED_ASSETS = [
	{ ownedCheckId: "asset-runtime-windows-session-transport-owned", hashCheckId: "asset-runtime-windows-session-transport-hash", relativePath: "runtime/windows-session-transport.ps1" },
	{ ownedCheckId: "asset-lib-windows-session-transport-owned", hashCheckId: "asset-lib-windows-session-transport-hash", relativePath: "lib/windows-session-transport.ts" },
	{ ownedCheckId: "asset-lib-agents-session-transport-owned", hashCheckId: "asset-lib-agents-session-transport-hash", relativePath: "lib/agents-session-transport.ts" },
	{ ownedCheckId: "asset-extension-gentle-agents-owned", hashCheckId: "asset-extension-gentle-agents-hash", relativePath: "extensions/gentle-agents.ts" },
	{ ownedCheckId: "asset-extension-gentle-ai-owned", hashCheckId: "asset-extension-gentle-ai-hash", relativePath: "extensions/gentle-ai.ts" },
	{ ownedCheckId: "asset-native-review-cli-owned", hashCheckId: "asset-native-review-cli-hash", relativePath: "runtime/native-review-cli.mjs" },
	{ ownedCheckId: "asset-review-integration-v2-owned", hashCheckId: "asset-review-integration-v2-hash", relativePath: "runtime/review-integration-v2.mjs" },
	{ ownedCheckId: "asset-installer-gentle-ai-owned", hashCheckId: "asset-installer-gentle-ai-hash", relativePath: "scripts/install-gentle-ai.mjs" },
	{ ownedCheckId: "asset-installer-tui-mode-setting-owned", hashCheckId: "asset-installer-tui-mode-setting-hash", relativePath: "scripts/install-tui-mode-setting.mjs" },
];

function assertPackedAssets(packageRoot, receipt) {
	for (const asset of HASHED_PACKED_ASSETS) {
		selectUnhookedCheck(receipt, asset.ownedCheckId);
		const installedPath = assertOwnedRegularFile(packageRoot, asset.relativePath);
		selectUnhookedCheck(receipt, asset.hashCheckId);
		const source = readFileSync(join(root, asset.relativePath));
		const installed = readFileSync(installedPath);
		if (createHash("sha256").update(source).digest("hex") !== createHash("sha256").update(installed).digest("hex")) throw new Error("packed asset bytes differ from this checkout");
	}
}

function assertNoNativeInstallerArtifacts(packageRoot, consumerDirectory, receipt) {
	selectUnhookedCheck(receipt, "native-package-cache-absent");
	if (existsSync(join(packageRoot, ".gentle-ai"))) throw new Error("unhooked install unexpectedly contains a native Gentle AI artifact");
	selectUnhookedCheck(receipt, "native-command-absent");
	const nativeCommand = process.platform === "win32" ? "gentle-ai.cmd" : "gentle-ai";
	if (existsSync(join(consumerDirectory, "node_modules", ".bin", nativeCommand))) throw new Error("unhooked install unexpectedly exposed a native Gentle AI executable");
}

function unhookedProbeSource(packageRoot, consumerPackageJson, jitiStaticEntry) {
	return `
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { createJiti } = await import(pathToFileURL(${JSON.stringify(jitiStaticEntry)}).href);
const jiti = createJiti(pathToFileURL(${JSON.stringify(consumerPackageJson)}).href, { moduleCache: false });
const registrations = { tools: [], commands: [], events: [] };
const events = new Proxy({}, { get(_target, property) { return (..._args) => { registrations.events.push(\`events.\${String(property)}\`); }; } });
const pi = {
  events,
  on(name, _handler) { registrations.events.push(String(name)); },
  registerTool(definition) { registrations.tools.push(String(definition.name)); },
  registerCommand(name, _definition) { registrations.commands.push(String(name)); },
  registerShortcut() {}, registerMessageRenderer() {}, registerEntryRenderer() {}, registerMarkdownTransformer() {},
};
async function register(relativePath) {
  const loaded = await jiti.import(new URL(relativePath, pathToFileURL(${JSON.stringify(`${packageRoot}/`)}).href).href, { default: true });
  const factory = typeof loaded === "function" ? loaded : loaded?.default;
  assert.equal(typeof factory, "function", \`missing default extension factory: \${relativePath}\`);
  await factory(pi);
}
await register("extensions/gentle-agents.ts");
await register("extensions/gentle-ai.ts");
for (const name of ["subagent_list_agents", "subagent_run", "orchestrator_session_id", "orchestrator_list", "orchestrator_send_message", "gentle_review", "gentle_review_capture", "gentle_review_capture_group", "gentle_review_scope"]) assert.ok(registrations.tools.includes(name), \`missing registered tool: \${name}\`);
for (const name of ["gentle:agents", "gentle:status", "gentle:review-mode"]) assert.ok(registrations.commands.includes(name), \`missing registered command: \${name}\`);
assert.ok(registrations.events.includes("session_start"), "expected session_start registration");
assert.ok(registrations.events.includes("session_shutdown"), "expected session_shutdown registration");
process.stdout.write(JSON.stringify({ tools: registrations.tools.sort(), commands: registrations.commands.sort(), loader: "Jiti from @earendil-works/pi-coding-agent dependency" }));
`;
}

async function testUnhookedPackedImports() {
	const receipt = newUnhookedReceipt();
	let temporary;
	let stage = "pack";
	let failure;
	try {
		selectUnhookedCheck(receipt, "runner-temp");
		const runnerTemp = process.env.RUNNER_TEMP;
		if (typeof runnerTemp !== "string" || runnerTemp.length === 0) throw new Error("RUNNER_TEMP is required");
		selectUnhookedCheck(receipt, "temporary-root");
		temporary = mkdtempSync(join(resolve(runnerTemp), "gentle-pi-packed-unhooked-"));
		const packDirectory = join(temporary, "pack");
		const consumerDirectory = join(temporary, "consumer");
		mkdirSync(packDirectory);
		mkdirSync(consumerDirectory);
		const { env, homes } = isolatedUnhookedEnvironment(temporary);
		selectUnhookedCheck(receipt, "project-sdk-version");
		const manifest = safeJson(readFileSync(join(root, "package.json")), "project package manifest");
		const sdkVersion = manifest?.devDependencies?.["@earendil-works/pi-coding-agent"];
		if (sdkVersion !== "0.85.1") throw new Error("unhooked probe requires the project-pinned Pi SDK");
		selectUnhookedCheck(receipt, "pack-command");
		const packOutput = runBoundedNpm("pack", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], env, root);
		stage = "pack-result";
		selectUnhookedCheck(receipt, "pack-metadata");
		const packed = safeJson(packOutput, "npm pack output");
		const { tarball } = assertPackResult(packed, packDirectory, receipt);
		receipt.packVerified = true;
		stage = "install";
		selectUnhookedCheck(receipt, "install-command");
		writeFileSync(join(consumerDirectory, "package.json"), JSON.stringify({ name: "gentle-pi-unhooked-import-proof", private: true, dependencies: { "@earendil-works/pi-coding-agent": sdkVersion } }), "utf8");
		runBoundedNpm("install", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--omit=dev", "--legacy-peer-deps", tarball, `@earendil-works/pi-coding-agent@${sdkVersion}`], env, consumerDirectory);
		receipt.installCompleted = true;
		stage = "artifact-check";
		const packageRoot = join(consumerDirectory, "node_modules", "gentle-pi");
		assertPackedAssets(packageRoot, receipt);
		assertNoNativeInstallerArtifacts(packageRoot, consumerDirectory, receipt);
		const sdkPackageJson = join(consumerDirectory, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
		selectUnhookedCheck(receipt, "sdk-manifest-owned");
		const checkedSdkPackageJson = assertOwnedRegularFile(consumerDirectory, relative(consumerDirectory, sdkPackageJson));
		const sdkRequire = createRequire(checkedSdkPackageJson);
		selectUnhookedCheck(receipt, "sdk-version");
		const installedSdk = safeJson(readFileSync(checkedSdkPackageJson), "installed Pi SDK manifest");
		if (installedSdk.name !== "@earendil-works/pi-coding-agent" || installedSdk.version !== sdkVersion) throw new Error("consumer resolved an unexpected Pi SDK");
		const declaredJiti = installedSdk?.dependencies?.jiti;
		selectUnhookedCheck(receipt, "jiti-manifest-owned");
		const jitiManifest = sdkRequire.resolve("jiti/package.json");
		const checkedJitiPackageJson = assertOwnedRegularFile(consumerDirectory, relative(consumerDirectory, jitiManifest));
		const jitiPackage = safeJson(readFileSync(checkedJitiPackageJson), "jiti package manifest");
		selectUnhookedCheck(receipt, "jiti-static-export");
		const staticExport = jitiPackage?.exports?.["./static"];
		if (staticExport === null || typeof staticExport !== "object" || Array.isArray(staticExport)
			|| Object.keys(staticExport).length !== 2 || typeof staticExport.types !== "string" || typeof staticExport.import !== "string") {
			throw new Error("Jiti manifest does not declare the expected static ESM export");
		}
		const jitiPackageRoot = dirname(checkedJitiPackageJson);
		selectUnhookedCheck(receipt, "jiti-entry-owned");
		const jitiStaticEntry = assertOwnedRegularFile(jitiPackageRoot, relative(jitiPackageRoot, resolve(jitiPackageRoot, staticExport.import)));
		selectUnhookedCheck(receipt, "jiti-version");
		if (jitiPackage.name !== "jiti" || typeof declaredJiti !== "string" || jitiPackage.version !== declaredJiti) throw new Error("consumer Jiti does not match the installed Pi SDK runtime dependency");
		// The child calls only default factories on this inert recorder; it never invokes registered tools or event handlers.
		for (const home of homes) {
			selectUnhookedCheck(receipt, home.checkId);
			assertEmptyDirectory(home.path);
		}
		stage = "import-probe";
		selectUnhookedCheck(receipt, "import-probe-command");
		const probe = runBoundedProbe(["--input-type=module", "--eval", unhookedProbeSource(packageRoot, join(consumerDirectory, "package.json"), jitiStaticEntry)], env, consumerDirectory);
		selectUnhookedCheck(receipt, "import-probe-result");
		safeJson(probe, "unhooked registration probe output");
		stage = "post-import-check";
		assertNoNativeInstallerArtifacts(packageRoot, consumerDirectory, receipt);
		for (const home of homes) {
			selectUnhookedCheck(receipt, home.checkId);
			assertEmptyDirectory(home.path);
		}
	} catch (error) {
		failure = stageFailure(stage, error, stage === "pack-result" || stage === "import-probe");
	}
	if (temporary !== undefined) {
		try {
			if (failure === undefined) selectUnhookedCheck(receipt, "cleanup-owned-root-removal");
			rmSync(temporary, { recursive: true, force: true });
			receipt.cleanupCompleted = !existsSync(temporary);
			if (!receipt.cleanupCompleted) throw new Error("owned temporary root remains after cleanup");
		} catch {
			if (failure === undefined) failure = new UnhookedFailure("cleanup", "cleanup-failed");
		}
	}
	return { receipt, failure };
}

if (process.argv.includes("--unhooked-imports")) {
	const { receipt, failure } = await testUnhookedPackedImports();
	reportUnhookedReceipt(receipt, failure);
} else {
	await testHookedPackedRunner();
}
