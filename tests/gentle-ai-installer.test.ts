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

// v2.1.11 digests pinned from the published release: archive sha256 values match
// checksums.txt and freshly computed hashes; binary sha256 values were computed
// from the extracted executables of each verified archive.
const EXPECTED_ASSETS = {
	"darwin/amd64": { name: "gentle-ai_2.1.11_darwin_amd64.tar.gz", sha256: "80c2a6bba981fd0ec1fdc9b21d9b80c03853cacc644b307ca7baf1faa6b376d2", binarySha256: "bffca50cb51b07cc1c428e21616ea1cf7d25970643fed13ab0aa10fd359bbd02" },
	"darwin/arm64": { name: "gentle-ai_2.1.11_darwin_arm64.tar.gz", sha256: "27e49a5104ff1ab156276e191b845f266135afe9339f111689ddf340b562c926", binarySha256: "4e39e520abf116a53ff5e36a0cd65756b6fadfa528489f21e9c722bfa00af620" },
	"linux/amd64": { name: "gentle-ai_2.1.11_linux_amd64.tar.gz", sha256: "d115aaf5724a71503150ebf740769e7aa52e41e673ac39bf5b0ff1be4e3324b0", binarySha256: "45788ac6cf37a6165f50aca3503d4af4e7e375e518fc67010064dccf78f98d2d" },
	"linux/arm64": { name: "gentle-ai_2.1.11_linux_arm64.tar.gz", sha256: "aea3a4b0064b57df5f831fdf6b27b29e9898a8f9393fd648dea4a8ba563e477e", binarySha256: "2bf929993ba03dd02401a3c35d8b0bff7801717e43d17b39e29f3cd389894e63" },
	"windows/amd64": { name: "gentle-ai_2.1.11_windows_amd64.zip", sha256: "43fb4e66cf36a7f01d2d343f59fe8ff37396fc0e98fb24abcd95bc79c2450e9a", binarySha256: "1c92cdcaf826d4bec6a6560770e5a0edefc09997364a664a5033abc6ab932b2b" },
	"windows/arm64": { name: "gentle-ai_2.1.11_windows_arm64.zip", sha256: "9c2884075161715f0efac1ce55cd08f2d9313068f125443ade8de3a83645258a", binarySha256: "a903bface64af274a28cfdd08b5c55c67fc554bac9279d7d466fc3f99020bd89" },
} as const;

test("default installer package root is the package containing scripts, not its parent", () => {
	const installerPath = fileURLToPath(new URL("../scripts/gentle-ai-installer.mjs", import.meta.url));
	const expectedPackageRoot = dirname(dirname(installerPath));

	assert.equal(resolveGentleAiInstallerPackageRoot(), expectedPackageRoot);
	assert.notEqual(resolveGentleAiInstallerPackageRoot(), dirname(expectedPackageRoot));
});

test("release mapping selects only the supported official v2.1.11 archive and pinned digests", () => {
	assert.deepEqual(
		Object.fromEntries(Object.entries(GENTLE_AI_RELEASE_ASSETS).map(([key, asset]) => [key, { name: asset.name, sha256: asset.sha256, binarySha256: asset.binarySha256 }])),
		EXPECTED_ASSETS,
	);
	assert.equal(resolveGentleAiReleaseAsset("linux", "x64").name, "gentle-ai_2.1.11_linux_amd64.tar.gz");
	assert.equal(resolveGentleAiReleaseAsset("windows", "arm64").name, "gentle-ai_2.1.11_windows_arm64.zip");
	for (const asset of Object.values(GENTLE_AI_RELEASE_ASSETS)) {
		assert.match(asset.url, /^https:\/\/github\.com\/Gentleman-Programming\/gentle-ai\/releases\/download\/v2\.1\.11\//);
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
		assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.11", "gentle-ai")), false);
	}
});

test("win32 platform normalizes to windows for asset lookup", () => {
	assert.equal(resolveGentleAiReleaseAsset("win32", "x64").name, "gentle-ai_2.1.11_windows_amd64.zip");
	assert.equal(resolveGentleAiReleaseAsset("win32", "arm64").name, "gentle-ai_2.1.11_windows_arm64.zip");
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.11", "gentle-ai")), false);
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
	const binary = join(packageRoot, ".gentle-ai", "v2.1.11", "gentle-ai");
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.11", "gentle-ai")), false);
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
	const binary = join(packageRoot, ".gentle-ai", "v2.1.11", "gentle-ai");
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.11", "gentle-ai")), false);
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.11", "gentle-ai")), false);
});
