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

// v2.1.7 digests pinned from the published release: archive sha256 values match
// checksums.txt and freshly computed hashes; binary sha256 values were computed
// from the extracted executables of each verified archive.
const EXPECTED_ASSETS = {
	"darwin/amd64": { name: "gentle-ai_2.1.7_darwin_amd64.tar.gz", sha256: "7bf2bba264a5bd03df0fba9cdc5f216d14fd511dd5f990fd1b7a78ca93f2b495", binarySha256: "cf88ef7afb851abf5f966f5ebca9e5fb0f02732aa8f80a1534bf87deaf18706a" },
	"darwin/arm64": { name: "gentle-ai_2.1.7_darwin_arm64.tar.gz", sha256: "e1e5300545837f98a803ce3a52dabeab55d485d855dfdcbd88e17e18e38b5d8f", binarySha256: "e6087d1ce0eeabc0bef070838ea05f5517120871a7a8c0e4d489a37df1ccd2bd" },
	"linux/amd64": { name: "gentle-ai_2.1.7_linux_amd64.tar.gz", sha256: "3e14b119f0102a415f2e91b32d42f332ec070924aad8c6d0af8ad889e3d73dc4", binarySha256: "a19f90964ccfe3a7dee8f3cc2d1d93dcd2d870716e2727e52002f2fe0281ddfc" },
	"linux/arm64": { name: "gentle-ai_2.1.7_linux_arm64.tar.gz", sha256: "bd6a5791db95b65ce713d02f86404c25c95a25e0fce9b5fd5c70af74acb9d5e4", binarySha256: "8f5506e708ace125b6ad0c9f048d150e37542093ba6f1aeb02773e4fe2ae61f8" },
	"windows/amd64": { name: "gentle-ai_2.1.7_windows_amd64.zip", sha256: "0f716403138aaa139e21894a591332f150f2b401fbed5668cc14192762e1f8b8", binarySha256: "604118dafac48d121c461797bfc7faec8dd47d286f8cd8ce01c51040071ae0d9" },
	"windows/arm64": { name: "gentle-ai_2.1.7_windows_arm64.zip", sha256: "7752ec2ee1f69440ac6f8bf6d81dfe977bf5eafb14ff97ef63d22047053163b1", binarySha256: "f9ab34a7993faef6e1890aa99641c09c632ef3bc20e313fdd18623ca25d53ba0" },
} as const;

test("default installer package root is the package containing scripts, not its parent", () => {
	const installerPath = fileURLToPath(new URL("../scripts/gentle-ai-installer.mjs", import.meta.url));
	const expectedPackageRoot = dirname(dirname(installerPath));

	assert.equal(resolveGentleAiInstallerPackageRoot(), expectedPackageRoot);
	assert.notEqual(resolveGentleAiInstallerPackageRoot(), dirname(expectedPackageRoot));
});

test("release mapping selects only the supported official v2.1.7 archive and pinned digests", () => {
	assert.deepEqual(
		Object.fromEntries(Object.entries(GENTLE_AI_RELEASE_ASSETS).map(([key, asset]) => [key, { name: asset.name, sha256: asset.sha256, binarySha256: asset.binarySha256 }])),
		EXPECTED_ASSETS,
	);
	assert.equal(resolveGentleAiReleaseAsset("linux", "x64").name, "gentle-ai_2.1.7_linux_amd64.tar.gz");
	assert.equal(resolveGentleAiReleaseAsset("windows", "arm64").name, "gentle-ai_2.1.7_windows_arm64.zip");
	for (const asset of Object.values(GENTLE_AI_RELEASE_ASSETS)) {
		assert.match(asset.url, /^https:\/\/github\.com\/Gentleman-Programming\/gentle-ai\/releases\/download\/v2\.1\.7\//);
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
		assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.7", "gentle-ai")), false);
	}
});

test("win32 platform normalizes to windows for asset lookup", () => {
	assert.equal(resolveGentleAiReleaseAsset("win32", "x64").name, "gentle-ai_2.1.7_windows_amd64.zip");
	assert.equal(resolveGentleAiReleaseAsset("win32", "arm64").name, "gentle-ai_2.1.7_windows_arm64.zip");
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.7", "gentle-ai")), false);
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
	const binary = join(packageRoot, ".gentle-ai", "v2.1.7", "gentle-ai");
	assert.equal(existsSync(binary), true);
	assert.equal(await readFile(binary, "utf8"), "native executable");
	assert.ok(((await stat(binary)).mode & 0o111) !== 0);
	assert.equal((await installGentleAi({ packageRoot, platform: "linux", arch: "x64", releaseAssets: { "linux/amd64": asset } })).installed, false);
});

test("installer rejects an extracted binary that differs from its pinned digest", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "gentle-pi-installer-binary-mismatch-"));
	const payload = Buffer.from("trusted archive fixture");
	const asset = {
		name: "gentle-ai_2.1.7_linux_amd64.tar.gz",
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.7", "gentle-ai")), false);
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
	const binary = join(packageRoot, ".gentle-ai", "v2.1.7", "gentle-ai");
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.7", "gentle-ai")), false);
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
	assert.equal(existsSync(join(packageRoot, ".gentle-ai", "v2.1.7", "gentle-ai")), false);
});
