import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	GENTLE_AI_PENDING_DIGEST,
	GENTLE_AI_RELEASE_ASSETS,
	downloadGentleAiAsset,
	installGentleAi,
	resolveGentleAiInstallerPackageRoot,
	resolveGentleAiReleaseAsset,
	trustedSystemExtractor,
} from "../scripts/gentle-ai-installer.mjs";

// v2.2.1 digests pinned from the published release: archive sha256 values match
// checksums.txt and freshly computed hashes; binary sha256 values were computed
// from the extracted executables of each verified archive.
const EXPECTED_ASSETS = {
	"darwin/amd64": { name: "gentle-ai_2.2.1_darwin_amd64.tar.gz", sha256: "aff2184701ab634b64f5b05f1fe6a887c7d9b7920e59459c807c30df55638945", binarySha256: "d098e6776cef15db916a01ca5c17eb04de61e88bd8975b64c155abe133ed461f" },
	"darwin/arm64": { name: "gentle-ai_2.2.1_darwin_arm64.tar.gz", sha256: "d3963dc15029d713df127c5cb5ff552add862d4e47dee6ab736a8554ffd68bfd", binarySha256: "fd460ff3fef911228e8529275957394ebe27dd61fe3cd2650daff24976a8df01" },
	"linux/amd64": { name: "gentle-ai_2.2.1_linux_amd64.tar.gz", sha256: "02a72f48cf9d108ed9189eddbfe1dffd27b65a2ed9ebc33925756446a85352e2", binarySha256: "fe007488ad544bfe500dbfb2e4daeb357af54f2b7e43bf806a23b97f724cd18a" },
	"linux/arm64": { name: "gentle-ai_2.2.1_linux_arm64.tar.gz", sha256: "4eb7887d0c9b555bb976110567bed9491edcc1d54534c81958ae40e879a4091c", binarySha256: "fc9fbb66603d9ce76ebeb2fa0087e8af78e4fc2850ab257c9746dc17bda0ebcd" },
} as const;

test("default installer package root is the package containing scripts, not its parent", () => {
	const installerPath = fileURLToPath(new URL("../scripts/gentle-ai-installer.mjs", import.meta.url));
	const expectedPackageRoot = dirname(dirname(installerPath));

	assert.equal(resolveGentleAiInstallerPackageRoot(), expectedPackageRoot);
	assert.notEqual(resolveGentleAiInstallerPackageRoot(), dirname(expectedPackageRoot));
});

test("release mapping selects only the supported official v2.2.1 archive and pinned digests", () => {
	assert.deepEqual(
		Object.fromEntries(Object.entries(GENTLE_AI_RELEASE_ASSETS).map(([key, asset]) => [key, { name: asset.name, sha256: asset.sha256, binarySha256: asset.binarySha256 }])),
		EXPECTED_ASSETS,
	);
	assert.equal(resolveGentleAiReleaseAsset("linux", "x64").name, "gentle-ai_2.2.1_linux_amd64.tar.gz");
	assert.equal(resolveGentleAiReleaseAsset("darwin", "arm64").name, "gentle-ai_2.2.1_darwin_arm64.tar.gz");
	for (const asset of Object.values(GENTLE_AI_RELEASE_ASSETS)) {
		assert.match(asset.url, /^https:\/\/github\.com\/Gentleman-Programming\/gentle-ai\/releases\/download\/v2\.2\.1\//);
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
		assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.1", "gentle-ai")), false);
	}
});

test("win32 is rejected with the same clear error as any other unsupported platform", () => {
	// v2.2.1 publishes no Windows archive, so there is nothing honest to
	// resolve. Failing here, by name, beats resolving an asset that would 404
	// at download time and blame the network for a packaging decision.
	for (const arch of ["x64", "arm64"]) {
		assert.throws(() => resolveGentleAiReleaseAsset("win32", arch), /unsupported Gentle AI platform\/architecture/);
		assert.throws(() => resolveGentleAiReleaseAsset("windows", arch), /unsupported Gentle AI platform\/architecture/);
	}
});

test("unsupported platform pairs fail clearly before download", () => {
	for (const [platform, arch] of [["freebsd", "x64"], ["linux", "ia32"], ["darwin", "ppc64"]]) {
		assert.throws(() => resolveGentleAiReleaseAsset(platform, arch), /unsupported Gentle AI platform\/architecture/);
	}
});

test("extractors use only absolute trusted system paths, never lifecycle PATH or SystemRoot", () => {
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.1", "gentle-ai")), false);
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
	const binary = join(packageRoot, ".gentle-ai", "v2.2.1", "gentle-ai");
	assert.equal(existsSync(binary), true);
	assert.equal(await readFile(binary, "utf8"), "native executable");
	assert.ok(((await stat(binary)).mode & 0o111) !== 0);
	assert.equal((await installGentleAi({ packageRoot, platform: "linux", arch: "x64", releaseAssets: { "linux/amd64": asset } })).installed, false);
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.1", "gentle-ai")), false);
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
	const binary = join(packageRoot, ".gentle-ai", "v2.2.1", "gentle-ai");
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.1", "gentle-ai")), false);
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.2.1", "gentle-ai")), false);
});
