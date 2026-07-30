import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	GENTLE_AI_PENDING_DIGEST,
	GENTLE_AI_GO_MODULE,
	GENTLE_AI_GO_MODULE_SUM,
	GENTLE_AI_RELEASE_ASSETS,
	downloadGentleAiAsset,
	installGentleAi,
	resolveGentleAiInstallerPackageRoot,
	resolveGentleAiReleaseAsset,
	trustedSystemExtractor,
} from "../scripts/gentle-ai-installer.mjs";

// v2.2.2 digests pinned from the published release: archive sha256 values match
// checksums.txt and freshly computed hashes; binary sha256 values were computed
// from the extracted executables of each verified archive.
const EXPECTED_ASSETS = {
	"darwin/amd64": { name: "gentle-ai_2.2.2_darwin_amd64.tar.gz", sha256: "5ca67829903bf4c6b14665664f80f9d8216c84b10c8e50870d297f452cefb9dc", binarySha256: "9b239423450562d026384f482bbd2f1e3f2820431a84f0921743ac3df9d632de" },
	"darwin/arm64": { name: "gentle-ai_2.2.2_darwin_arm64.tar.gz", sha256: "0193e1a284444dccee2863d31b8dbb76a982e8f9111955908d6a9131c1a5490e", binarySha256: "149b97248552c5e03ebc4d991f86b1360fb847a40fc315555a8aa256f95baca0" },
	"linux/amd64": { name: "gentle-ai_2.2.2_linux_amd64.tar.gz", sha256: "b85bbb20eb2236de97b261df16cfc8d8394dfd07a137e885c4889b62d0c20fa1", binarySha256: "00d5732e8dd3945956800217a4f60213c2d9ca63351092a2cb7f4e5f9ece54f9" },
	"linux/arm64": { name: "gentle-ai_2.2.2_linux_arm64.tar.gz", sha256: "61e7077342448273f0c43af49ce4d182594bab5e4f86f812975af2fbe69e3b0b", binarySha256: "a92685aa7dbea0cc4297d016569b3defe9bb30a7374a620021e245b74f50eb68" },
} as const;

test("default installer package root is the package containing scripts, not its parent", () => {
	const installerPath = fileURLToPath(new URL("../scripts/gentle-ai-installer.mjs", import.meta.url));
	const expectedPackageRoot = dirname(dirname(installerPath));

	assert.equal(resolveGentleAiInstallerPackageRoot(), expectedPackageRoot);
	assert.notEqual(resolveGentleAiInstallerPackageRoot(), dirname(expectedPackageRoot));
});

test("release mapping selects only the supported official v2.2.2 archive and pinned digests", () => {
	assert.deepEqual(
		Object.fromEntries(Object.entries(GENTLE_AI_RELEASE_ASSETS).map(([key, asset]) => [key, { name: asset.name, sha256: asset.sha256, binarySha256: asset.binarySha256 }])),
		EXPECTED_ASSETS,
	);
	assert.equal(resolveGentleAiReleaseAsset("linux", "x64").name, "gentle-ai_2.2.2_linux_amd64.tar.gz");
	assert.equal(resolveGentleAiReleaseAsset("darwin", "arm64").name, "gentle-ai_2.2.2_darwin_arm64.tar.gz");
	for (const asset of Object.values(GENTLE_AI_RELEASE_ASSETS)) {
		assert.match(asset.url, /^https:\/\/github\.com\/Gentleman-Programming\/gentle-ai\/releases\/download\/v2\.2\.2\//);
	}
});

test("release digests are all-or-none and install fails closed while any digest is pending", async () => {
	const digests = Object.values(GENTLE_AI_RELEASE_ASSETS).flatMap((asset) => [asset.sha256, asset.binarySha256]);
	const pinned = digests.filter((digest) => /^[0-9a-f]{64}$/.test(digest));
	const pending = digests.filter((digest) => digest === GENTLE_AI_PENDING_DIGEST);
	assert.equal(pinned.length + pending.length, digests.length, "every digest must be pinned hex or the explicit pending sentinel");
	assert.equal(pinned.length === digests.length || pending.length === digests.length, true, "digest table must not mix pinned and pending entries");
	if (pending.length === digests.length) {
		const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-pending-"));
		await assert.rejects(
			() => installGentleAi({
				packageRoot,
				platform: "linux",
				arch: "x64",
				download: async (_url, destination) => writeFile(destination, "unverifiable archive"),
			}),
			/checksum mismatch/,
		);
		assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai")), false);
	}
});

test("release asset resolution rejects Windows while the installer selects its separate source route", () => {
	// v2.2.2 publishes no Windows archive, so there is nothing honest to
	// resolve. Failing here, by name, beats resolving an asset that would 404
	// at download time and blame the network for a packaging decision.
	for (const arch of ["x64", "arm64"]) {
		assert.throws(() => resolveGentleAiReleaseAsset("win32", arch), /unsupported Gentle AI release asset platform\/architecture/);
		assert.throws(() => resolveGentleAiReleaseAsset("windows", arch), /unsupported Gentle AI release asset platform\/architecture/);
	}
});

async function windowsGoFixture(t: test.TestContext, overrides: { version?: string; download?: string; failBuild?: boolean } = {}) {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-windows-source-"));
	const source = join(packageRoot, "module-source");
	const go = join(packageRoot, "go.exe");
	await mkdir(source);
	await writeFile(go, "go fixture");
	const calls: Array<{ file: string; arguments: string[]; options: Record<string, unknown> }> = [];
	const execFile = async (file: string, arguments_: string[], options: Record<string, unknown>) => {
		calls.push({ file, arguments: arguments_, options });
		if (arguments_[0] === "version") return { stdout: overrides.version ?? "go version go1.25.10 windows/amd64\n", stderr: "" };
		if (arguments_[0] === "mod") return { stdout: overrides.download ?? JSON.stringify({ Path: GENTLE_AI_GO_MODULE, Version: "v2.2.2", Dir: source, Sum: GENTLE_AI_GO_MODULE_SUM }), stderr: "" };
		if (overrides.failBuild) throw new Error("build failed");
		await writeFile(arguments_[arguments_.indexOf("-o") + 1], "locally built executable");
		return { stdout: "", stderr: "" };
	};
	t.after(async () => rm(packageRoot, { recursive: true, force: true }));
	return { packageRoot, go, calls, execFile };
}

test("Windows x64 builds the pinned module with a local Go toolchain and source manifest", async (t) => {
	const fixture = await windowsGoFixture(t);
	const result = await installGentleAi({ packageRoot: fixture.packageRoot, platform: "win32", arch: "x64", env: { GENTLE_PI_GO: fixture.go }, execFile: fixture.execFile });
	assert.equal(await readFile(result.binaryPath, "utf8"), "locally built executable");
	const manifest = JSON.parse(await readFile(join(dirname(result.binaryPath), "integrity.json"), "utf8"));
	assert.deepEqual(Object.keys(manifest), ["version", "provenance", "module", "moduleVersion", "moduleSum", "goVersion", "binarySha256"]);
	assert.equal(manifest.moduleSum, GENTLE_AI_GO_MODULE_SUM);
	assert.deepEqual(fixture.calls.map((call) => call.arguments), [
		["version"],
		["mod", "download", "-json", `${GENTLE_AI_GO_MODULE}@v2.2.2`],
		["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags", "-s -w -X main.version=2.2.2", "-o", fixture.calls[2].arguments[7], "./cmd/gentle-ai"],
	]);
	for (const call of fixture.calls) {
		assert.equal(call.file, fixture.go);
		assert.equal(call.options.shell, false);
		assert.equal(call.options.windowsHide, true);
		assert.equal((call.options.env as Record<string, string>).GOTOOLCHAIN, "local");
		assert.equal((call.options.env as Record<string, string>).GOWORK, "off");
		assert.equal((call.options.env as Record<string, string>).CGO_ENABLED, "0");
	}
	assert.equal((await installGentleAi({ packageRoot: fixture.packageRoot, platform: "win32", arch: "x64", env: { GENTLE_PI_GO: fixture.go }, execFile: fixture.execFile })).installed, false);
	await writeFile(result.binaryPath, "tampered");
	assert.equal((await installGentleAi({ packageRoot: fixture.packageRoot, platform: "win32", arch: "x64", env: { GENTLE_PI_GO: fixture.go }, execFile: fixture.execFile })).installed, true);
	assert.equal(await readFile(result.binaryPath, "utf8"), "locally built executable");
	assert.deepEqual((await readdir(dirname(result.binaryPath))).filter((entry) => entry.endsWith(".bak") || entry.endsWith(".tmp")), []);
});

test("Windows source installation rejects unsafe or old Go and malformed or mismatched module metadata", async (t) => {
	const unsafe = await windowsGoFixture(t);
	await assert.rejects(() => installGentleAi({ packageRoot: unsafe.packageRoot, platform: "win32", arch: "x64", env: { GENTLE_PI_GO: "go.exe" }, execFile: unsafe.execFile }), /absolute local path/);
	for (const [overrides, expected] of [
		[{ version: "go version go1.25.9 windows/amd64\n" }, /requires Go 1\.25\.10/],
		[{ download: "{" }, /malformed JSON/],
		[{ download: JSON.stringify({ Path: GENTLE_AI_GO_MODULE, Version: "v2.2.2", Dir: unsafe.packageRoot, Sum: "h1:wrong" }) }, /checksum mismatch/],
	] as const) {
		const fixture = await windowsGoFixture(t, overrides);
		await assert.rejects(() => installGentleAi({ packageRoot: fixture.packageRoot, platform: "win32", arch: "x64", env: { GENTLE_PI_GO: fixture.go }, execFile: fixture.execFile }), expected);
		assert.equal(existsSync(join(fixture.packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai.exe")), false);
		assert.deepEqual((await readdir(fixture.packageRoot)).filter((entry) => entry.startsWith(".gentle-ai-install-")), []);
	}
});

test("Windows build failure cleans temporary state and never promotes a partial executable", async (t) => {
	const fixture = await windowsGoFixture(t, { failBuild: true });
	await assert.rejects(() => installGentleAi({ packageRoot: fixture.packageRoot, platform: "win32", arch: "x64", env: { GENTLE_PI_GO: fixture.go }, execFile: fixture.execFile }), /build failed/);
	assert.equal(existsSync(join(fixture.packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai.exe")), false);
	assert.deepEqual((await readdir(fixture.packageRoot)).filter((entry) => entry.startsWith(".gentle-ai-install-")), []);
});

test("unsupported platform pairs fail clearly before download", () => {
	for (const [platform, arch] of [["freebsd", "x64"], ["linux", "ia32"], ["darwin", "ppc64"]]) {
		assert.throws(() => resolveGentleAiReleaseAsset(platform, arch), /unsupported Gentle AI release asset platform\/architecture/);
	}
});

test("extractors use only absolute trusted system paths, never lifecycle PATH or SystemRoot", (t) => {
	if (process.platform === "win32") {
		t.skip("POSIX path simulation is not meaningful with Windows path semantics");
		return;
	}
	const extractor = trustedSystemExtractor("archive.tar.gz", "linux", (path) => path === "/usr/bin/tar");
	assert.equal(extractor.command, "/usr/bin/tar");
	assert.ok(extractor.command.startsWith("/"));
	assert.throws(() => trustedSystemExtractor("archive.zip", "linux", () => false), /trusted system unzip/);
	const originalSystemRoot = process.env.SystemRoot;
	try {
		for (const hostileSystemRoot of ["relative", "\\\\attacker\\share", "C:\\attacker", ""]) {
			process.env.SystemRoot = hostileSystemRoot;
			const windows = trustedSystemExtractor("archive.zip", "win32", (path) => path === "C:\\Windows\\System32\\tar.exe");
			assert.equal(windows.command, "C:\\Windows\\System32\\tar.exe");
		}
	} finally {
		if (originalSystemRoot === undefined) delete process.env.SystemRoot;
		else process.env.SystemRoot = originalSystemRoot;
	}
});

function pendingRequest() {
	const pending = new EventEmitter() as EventEmitter & { destroy(error?: Error): void; setTimeout(): void };
	pending.destroy = (error) => queueMicrotask(() => pending.emit("error", error));
	pending.setTimeout = () => undefined;
	return pending;
}
test("download bounds stalled headers and bodies with transient retry exhaustion", async () => {
	for (const [stage, request] of [
		["headers", () => pendingRequest()],
		["body", (_url: URL, _options: unknown, callback: (response: PassThrough & { statusCode?: number; headers: Record<string, string> }) => void) => {
			const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
			queueMicrotask(() => callback(response));
			return pendingRequest();
		}],
	] as const) {
		let attempts = 0;
		await assert.rejects(() => downloadGentleAiAsset("https://example.invalid/archive", join(tmpdir(), `gentle-pi-stalled-${stage}-${process.pid}`), 1024, 0, { request: (...args: never[]) => { attempts += 1; return request(...args); }, headerTimeoutMs: 1, bodyTimeoutMs: 1, maxAttempts: 2, retryDelayMs: 0 }), new RegExp(`download ${stage} timed out`));
		assert.equal(attempts, 2);
	}
});

test("download retries only transient HTTP statuses and exhausts within the attempt bound", async () => {
	for (const [status, expectedAttempts] of [[429, 2], [500, 2], [502, 2], [503, 2], [504, 2], [400, 1], [404, 1]] as const) {
		let attempts = 0;
		const request = (_url: URL, _options: unknown, callback: (response: PassThrough & { statusCode?: number; headers: Record<string, string> }) => void) => { attempts += 1; const response = Object.assign(new PassThrough(), { statusCode: status, headers: {} }); queueMicrotask(() => { callback(response); response.end(); }); return pendingRequest(); };
		await assert.rejects(() => downloadGentleAiAsset("https://example.invalid/archive", join(tmpdir(), `gentle-pi-http-${status}-${process.pid}`), 1024, 0, { request, maxAttempts: 2, retryDelayMs: 0 }), new RegExp(`HTTP ${status}`));
		assert.equal(attempts, expectedAttempts, `HTTP ${status}`);
	}
});

test("checksum mismatch cleans temporary state without promoting a binary", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-mismatch-"));
	await assert.rejects(
		() => installGentleAi({
			packageRoot,
			platform: "linux",
			arch: "x64",
			download: async (_url, destination) => writeFile(destination, "corrupt archive"),
		}),
		/checksum mismatch/,
	);
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai")), false);
	assert.deepEqual((await readdir(packageRoot)).filter((entry) => entry.startsWith(".gentle-ai-install-")), []);
});

test("installer promotes only the expected regular executable with executable POSIX mode", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-promote-"));
	const payload = Buffer.from("trusted archive fixture");
	const sha256 = createHash("sha256").update(payload).digest("hex");
	const asset = { name: "gentle-ai_2.1.3_linux_amd64.tar.gz", sha256, url: "https://example.invalid/gentle-ai.tar.gz", executable: "gentle-ai" };
	await installGentleAi({
		packageRoot,
		platform: "linux",
		arch: "x64",
		releaseAssets: { "linux/amd64": asset },
		download: async (_url, destination) => writeFile(destination, payload),
		extractArchive: async (_archive, destination) => {
			await mkdir(destination, { recursive: true });
			const extracted = join(destination, "gentle-ai");
			await writeFile(extracted, "native executable");
			await chmod(extracted, 0o700);
		},
	});
	const binary = join(packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai");
	assert.equal(existsSync(binary), true);
	assert.equal(await readFile(binary, "utf8"), "native executable");
	if (process.platform !== "win32") assert.ok(((await stat(binary)).mode & 0o111) !== 0);
	if (process.platform !== "win32") assert.equal((await installGentleAi({ packageRoot, platform: "linux", arch: "x64", releaseAssets: { "linux/amd64": asset } })).installed, false);
});

test("installer rejects an extracted binary that differs from its pinned digest", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-binary-mismatch-"));
	const payload = Buffer.from("trusted archive fixture");
	const asset = {
		name: "gentle-ai_2.1.9_linux_amd64.tar.gz",
		sha256: createHash("sha256").update(payload).digest("hex"),
		binarySha256: "0".repeat(64),
		url: "https://example.invalid/gentle-ai.tar.gz",
		executable: "gentle-ai",
	};
	await assert.rejects(
		() => installGentleAi({
			packageRoot,
			platform: "linux",
			arch: "x64",
			releaseAssets: { "linux/amd64": asset },
			download: async (_url, destination) => writeFile(destination, payload),
			extractArchive: async (_archive, destination) => {
				await mkdir(destination, { recursive: true });
				await writeFile(join(destination, "gentle-ai"), "native executable");
			},
		}),
		/binary checksum mismatch/,
	);
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai")), false);
});

test("installer repairs a valid non-executable POSIX binary instead of reusing it", async (t) => {
	if (process.platform === "win32") {
		t.skip("Windows does not use POSIX executable mode bits");
		return;
	}
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-repair-mode-"));
	const payload = Buffer.from("trusted archive fixture");
	const asset = { name: "gentle-ai_2.1.3_linux_amd64.tar.gz", sha256: createHash("sha256").update(payload).digest("hex"), url: "https://example.invalid/gentle-ai.tar.gz", executable: "gentle-ai" };
	const options = {
		packageRoot,
		platform: "linux",
		arch: "x64",
		releaseAssets: { "linux/amd64": asset },
		download: async (_url: string, destination: string) => writeFile(destination, payload),
		extractArchive: async (_archive: string, destination: string) => {
			await mkdir(destination, { recursive: true });
			await writeFile(join(destination, "gentle-ai"), "native executable");
		},
	};
	await installGentleAi(options);
	const binary = join(packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai");
	await chmod(binary, 0o600);
	const repaired = await installGentleAi(options);
	assert.equal(repaired.installed, true);
	assert.notEqual((await stat(binary)).mode & 0o111, 0);
});

test("installer rejects a symlinked package-local runtime parent directory", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-symlink-"));
	const redirected = await mkdtemp(join(tmpdir(), "gentle-pi-installer-redirected-"));
	await symlink(redirected, join(packageRoot, ".gentle-ai"));
	await assert.rejects(
		() => installGentleAi({ packageRoot, platform: "linux", arch: "x64" }),
		/package-local runtime directory/,
	);
});

test("installer rejects archives with multiple expected executable entries", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-cardinality-"));
	const payload = Buffer.from("trusted archive fixture");
	const asset = { name: "gentle-ai_2.1.3_linux_amd64.tar.gz", sha256: createHash("sha256").update(payload).digest("hex"), url: "https://example.invalid/gentle-ai.tar.gz", executable: "gentle-ai" };
	await assert.rejects(
		() => installGentleAi({
			packageRoot,
			platform: "linux",
			arch: "x64",
			releaseAssets: { "linux/amd64": asset },
			download: async (_url, destination) => writeFile(destination, payload),
			extractArchive: async (_archive, destination) => {
				await mkdir(join(destination, "first"), { recursive: true });
				await mkdir(join(destination, "second"), { recursive: true });
				await writeFile(join(destination, "first", "gentle-ai"), "one");
				await writeFile(join(destination, "second", "gentle-ai"), "two");
			},
		}),
		/exactly one regular gentle-ai/,
	);
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai")), false);
});

test("installer rejects an archive without the expected regular executable", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-nonregular-"));
	const payload = Buffer.from("trusted archive fixture");
	const asset = { name: "gentle-ai_2.1.3_linux_amd64.tar.gz", sha256: createHash("sha256").update(payload).digest("hex"), url: "https://example.invalid/gentle-ai.tar.gz", executable: "gentle-ai" };
	await assert.rejects(
		() => installGentleAi({
			packageRoot,
			platform: "linux",
			arch: "x64",
			releaseAssets: { "linux/amd64": asset },
			download: async (_url, destination) => writeFile(destination, payload),
			extractArchive: async (_archive, destination) => mkdir(join(destination, "gentle-ai"), { recursive: true }),
		}),
		/non-regular gentle-ai/,
	);
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.2", "gentle-ai")), false);
});
