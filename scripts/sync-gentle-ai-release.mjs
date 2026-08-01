#!/usr/bin/env node
// Pin-time trust boundary (design D1 steps 1-5) and offline mirror/lock
// writer (design D6). This is the ONLY place in gentle-pi that downloads a
// gentle-ai release or verifies a minisign signature. It runs exclusively in
// the pin-bump job (P4, not yet landed) or manually by a maintainer; every
// other CI job — including this repository's own per-PR gate — stays fully
// offline against the mirrors and capabilities/gentle-ai-release.lock.json
// this script writes.
//
// A local, explicitly-passed `--bootstrap-archive <path>` (never
// auto-discovered — see lib/release-artifact.ts resolveBootstrapArtifactSource)
// skips the network and signature verification entirely and stamps the
// result `development/bootstrap`: it proves decoder, layout, extraction, and
// mirror-writing behavior only. It can never serve as release, pin, or
// final-acceptance evidence — assertReleaseAcceptanceEvidence throws on it,
// and this script never relabels it. Only a live `--write` run against a
// real signed release produces `release` evidence.

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	RELEASE_ARTIFACT_EVIDENCE_CLASS,
	createSystemReleaseArtifactExtractor,
	extractReleaseArtifact,
	resolveBootstrapArtifactSource,
} from "../lib/release-artifact.ts";
import { INSTALLER_VERSION } from "./gentle-ai-installer.mjs";

export const GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH = "capabilities/gentle-ai-release.lock.json";
export const GENTLE_AI_RELEASE_BASE_URL = `https://github.com/Gentleman-Programming/gentle-ai/releases/download/v${INSTALLER_VERSION}/`;
export const GENTLE_AI_RELEASE_REPOSITORY = "Gentleman-Programming/gentle-ai";
export const GENTLE_AI_RELEASE_ASSET_NAME = `gentle-ai_${INSTALLER_VERSION}_assets.tar.gz`;

// Sentinel for the not-yet-pinned minisign trusted public key. gentle-ai has
// not yet published a signed release under the `gentle-ai.release-artifact`
// contract this module consumes (that work is tracked entirely in the
// provider-side `publish-gentle-ai-release-artifacts` change, out of scope
// here). A network `--write` run fails closed while this sentinel is in
// place, mirroring the GENTLE_AI_PENDING_DIGEST pattern in
// scripts/gentle-ai-installer.mjs, rather than trusting a placeholder key
// that could later be mistaken for the real one.
export const GENTLE_AI_RELEASE_TRUSTED_PUBLIC_KEY_PENDING = "PENDING-GENTLE-AI-RELEASE-MINISIGN-PUBLIC-KEY";
export const GENTLE_AI_RELEASE_TRUSTED_PUBLIC_KEY = GENTLE_AI_RELEASE_TRUSTED_PUBLIC_KEY_PENDING;

const MAX_TEXT_ASSET_BYTES = 1 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

// --- minisign wire format ---------------------------------------------------
//
// minisign's on-disk formats (github.com/jedisct1/minisign, SIGNATURE.md):
//   public key file: "untrusted comment: ...\n<base64: 2B algorithm + 8B key id + 32B key>\n"
//   signature file:  "untrusted comment: ...\n<base64: 2B algorithm + 8B key id + 64B sig>\n"
//                     "trusted comment: <comment>\n<base64: 64B global signature>\n"
// The global signature covers (the 74-byte decoded signature line || the raw
// UTF-8 bytes of the trusted comment, without the "trusted comment: " prefix
// or trailing newline).

const MINISIGN_ALGORITHM = "Ed";
// Fixed 12-byte DER prefix for an Ed25519 SubjectPublicKeyInfo (OID
// 1.3.101.112), so a raw 32-byte minisign public key can be handed to
// node:crypto's createPublicKey without a general-purpose ASN.1 encoder.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function nonEmptyLines(text) {
	return text.trim().split(/\r?\n/).filter((line) => line.length > 0);
}

export function parseMinisignPublicKey(publicKeyText) {
	const lines = nonEmptyLines(publicKeyText);
	if (lines.length < 2) throw new Error("minisign public key must have an untrusted comment line and a key line");
	const raw = Buffer.from(lines[1], "base64");
	if (raw.length !== 42) throw new Error("minisign public key must decode to 42 bytes (2 algorithm + 8 key id + 32 key)");
	const algorithm = raw.subarray(0, 2).toString("latin1");
	if (algorithm !== MINISIGN_ALGORITHM) throw new Error(`unsupported minisign public key algorithm: ${JSON.stringify(algorithm)}`);
	return { keyId: raw.subarray(2, 10), publicKeyBytes: raw.subarray(10, 42) };
}

export function parseMinisignSignature(signatureText) {
	const lines = nonEmptyLines(signatureText);
	if (lines.length !== 4) throw new Error("minisign signature file must have exactly 4 non-empty lines");
	const [, signatureLine, trustedCommentLine, globalSignatureLine] = lines;
	if (!trustedCommentLine.startsWith("trusted comment: ")) throw new Error("minisign signature file is missing the trusted comment line");
	const signedBytes = Buffer.from(signatureLine, "base64");
	if (signedBytes.length !== 74) throw new Error("minisign signature line must decode to 74 bytes (2 algorithm + 8 key id + 64 signature)");
	const algorithm = signedBytes.subarray(0, 2).toString("latin1");
	if (algorithm !== MINISIGN_ALGORITHM) throw new Error(`unsupported minisign signature algorithm: ${JSON.stringify(algorithm)}`);
	const globalSignature = Buffer.from(globalSignatureLine, "base64");
	if (globalSignature.length !== 64) throw new Error("minisign global signature must decode to 64 bytes");
	return {
		keyId: signedBytes.subarray(2, 10),
		signature: signedBytes.subarray(10, 74),
		signedBytes,
		trustedComment: trustedCommentLine.slice("trusted comment: ".length),
		globalSignature,
	};
}

function importEd25519PublicKey(rawPublicKeyBytes) {
	return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKeyBytes]), format: "der", type: "spki" });
}

// Verifies BOTH the message signature and the global signature (which binds
// the trusted comment to the same key), and returns the trusted comment on
// success. Any structural defect, key mismatch, or forged/tampered signature
// throws — this is the D1 step-3 gate that runs before any extracted byte is
// trusted.
export function verifyMinisignSignature(messageBytes, signatureText, publicKeyText) {
	const { publicKeyBytes } = parseMinisignPublicKey(publicKeyText);
	const parsed = parseMinisignSignature(signatureText);
	const publicKey = importEd25519PublicKey(publicKeyBytes);
	if (!cryptoVerify(null, messageBytes, publicKey, parsed.signature)) {
		throw new Error("minisign signature verification failed: the message does not match the signature under the trusted public key");
	}
	const globalMessage = Buffer.concat([parsed.signedBytes, Buffer.from(parsed.trustedComment, "utf8")]);
	if (!cryptoVerify(null, globalMessage, publicKey, parsed.globalSignature)) {
		throw new Error("minisign global signature verification failed: the trusted comment does not match its signature under the trusted public key");
	}
	return { trustedComment: parsed.trustedComment };
}

// --- trusted-comment repo/tag binding ---------------------------------------

export function parseTrustedCommentFields(trustedComment) {
	const fields = new Map();
	for (const token of trustedComment.split("\t")) {
		const separatorIndex = token.indexOf(":");
		if (separatorIndex === -1) continue;
		fields.set(token.slice(0, separatorIndex), token.slice(separatorIndex + 1));
	}
	return fields;
}

export function assertTrustedCommentBinding(trustedComment, expected) {
	const fields = parseTrustedCommentFields(trustedComment);
	const repo = fields.get("repo");
	if (repo !== expected.repository) {
		throw new Error(`minisign trusted comment repo ${JSON.stringify(repo)} does not match the expected repository ${JSON.stringify(expected.repository)}`);
	}
	const tag = fields.get("tag");
	if (tag !== expected.tag) {
		throw new Error(`minisign trusted comment tag ${JSON.stringify(tag)} does not match the expected tag ${JSON.stringify(expected.tag)}`);
	}
}

// --- checksums.txt line matching (D1 step 4) --------------------------------

const CHECKSUM_LINE = /^([0-9a-f]{64})\s+(\S+)$/;

export function findChecksumLine(checksumsText, assetName) {
	const matches = [];
	for (const line of nonEmptyLines(checksumsText)) {
		const match = CHECKSUM_LINE.exec(line.trim());
		if (match && match[2] === assetName) matches.push(match[1]);
	}
	if (matches.length === 0) throw new Error(`no checksum line found for ${JSON.stringify(assetName)} in checksums.txt`);
	if (matches.length > 1) throw new Error(`duplicate checksum lines found for ${JSON.stringify(assetName)} in checksums.txt`);
	return matches[0];
}

// --- canonical lock (design D6) ---------------------------------------------

function byRawPath(a, b) {
	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

// The evidence class is persisted into the lock rather than only carried on the
// in-memory sync result. A reader that only has the file on disk must still be
// able to refuse it as pin or final-acceptance evidence: a bootstrap lock whose
// `release.commit` is a placeholder and whose `archive.digestSource` reads
// "signed-checksums.txt" is otherwise indistinguishable from a real one.
export function buildGentleAiReleaseLock(manifest, generatedEntries, { archiveSha256, evidenceClass, signatureStatus }) {
	return {
		evidence: { class: evidenceClass, signatureStatus },
		release: { ...manifest.release },
		contract: {
			id: manifest.contract.id,
			major: manifest.contract.major,
			minor: manifest.contract.minor,
			schemaId: manifest.contract.schemaId,
			schemaPath: manifest.contract.schemaPath,
			layoutVersion: manifest.layout.version,
		},
		archive: { asset: manifest.archive.asset, sha256: archiveSha256, digestSource: manifest.archive.digestSource },
		tree: { algorithm: manifest.tree.algorithm, canonicalization: manifest.tree.canonicalization, digest: manifest.tree.digest },
		entries: [...manifest.entries].sort(byRawPath).map((entry) => ({ path: entry.path, type: entry.type, mode: entry.mode, size: entry.size, digest: entry.digest })),
		generated: [...generatedEntries].sort(byRawPath).map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
	};
}

export function canonicalLockJson(lock) {
	return `${JSON.stringify(lock, null, 2)}\n`;
}

export function assertLockVersionPin(lock, installerVersion) {
	if (lock.release.version !== installerVersion) {
		throw new Error(`capabilities/gentle-ai-release.lock.json release.version ${JSON.stringify(lock.release.version)} does not match the authoritative scripts/gentle-ai-installer.mjs INSTALLER_VERSION ${JSON.stringify(installerVersion)}`);
	}
}

// --- network fetch ports (D1 steps 1-2, injectable for tests) --------------

function fetchOverHttps(url, maxBytes) {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { "user-agent": "gentle-pi-sync-gentle-ai-release" } }, (response) => {
			const status = response.statusCode ?? 0;
			if (status !== 200) {
				response.resume();
				reject(new Error(`gentle-ai release sync download failed with HTTP ${status} for ${url}`));
				return;
			}
			const chunks = [];
			let received = 0;
			response.on("data", (chunk) => {
				received += chunk.length;
				if (received > maxBytes) {
					response.destroy(new Error(`gentle-ai release sync download exceeds the maximum allowed size for ${url}`));
					return;
				}
				chunks.push(chunk);
			});
			response.on("error", reject);
			response.on("end", () => resolve(Buffer.concat(chunks)));
		}).on("error", reject);
	});
}

async function defaultFetchText(url) {
	return (await fetchOverHttps(url, MAX_TEXT_ASSET_BYTES)).toString("utf8");
}

async function defaultDownloadArchive(url, destination) {
	const bytes = await fetchOverHttps(url, MAX_DOWNLOAD_BYTES);
	await new Promise((resolve, reject) => {
		const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
		output.on("error", reject);
		output.on("finish", resolve);
		output.end(bytes);
	});
}

// --- orchestration (D1 steps 1-5 network trust order + D6 mirror/lock write) ---

async function sha256OfFile(path) {
	return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

export async function syncGentleAiRelease(options) {
	const {
		packageRoot,
		bootstrapArchivePath,
		write = false,
		trustedPublicKey = GENTLE_AI_RELEASE_TRUSTED_PUBLIC_KEY,
		expectedRepository = GENTLE_AI_RELEASE_REPOSITORY,
		expectedTag = `v${INSTALLER_VERSION}`,
		assetName = GENTLE_AI_RELEASE_ASSET_NAME,
		releaseBaseUrl = GENTLE_AI_RELEASE_BASE_URL,
		installerVersion = INSTALLER_VERSION,
		fetchText = defaultFetchText,
		downloadArchive = defaultDownloadArchive,
		extractor = createSystemReleaseArtifactExtractor(),
	} = options;

	let archivePath;
	let evidenceClass;
	let signatureStatus;
	let networkTempDir;

	if (bootstrapArchivePath !== undefined) {
		const source = resolveBootstrapArtifactSource(bootstrapArchivePath);
		archivePath = source.archivePath;
		evidenceClass = source.evidenceClass;
		signatureStatus = source.signatureStatus;
	} else {
		if (trustedPublicKey === GENTLE_AI_RELEASE_TRUSTED_PUBLIC_KEY_PENDING) {
			throw new Error("scripts/sync-gentle-ai-release.mjs cannot verify a live release: the trusted minisign public key is still the pending sentinel; pin the real gentle-ai release signing key before running a network sync");
		}
		networkTempDir = await mkdtemp(join(tmpdir(), "gentle-pi-sync-gentle-ai-release-network-"));
		const checksumsText = await fetchText(`${releaseBaseUrl}checksums.txt`);
		const minisigText = await fetchText(`${releaseBaseUrl}checksums.txt.minisig`);
		const verified = verifyMinisignSignature(Buffer.from(checksumsText, "utf8"), minisigText, trustedPublicKey);
		assertTrustedCommentBinding(verified.trustedComment, { repository: expectedRepository, tag: expectedTag });
		const expectedDigest = findChecksumLine(checksumsText, assetName);
		archivePath = join(networkTempDir, assetName);
		await downloadArchive(`${releaseBaseUrl}${assetName}`, archivePath);
		const actualDigest = (await sha256OfFile(archivePath)).slice("sha256:".length);
		if (actualDigest !== expectedDigest) {
			throw new Error(`gentle-ai release assets archive digest mismatch for ${assetName}: signed checksums.txt declares ${expectedDigest}, downloaded archive is ${actualDigest}`);
		}
		evidenceClass = RELEASE_ARTIFACT_EVIDENCE_CLASS.RELEASE;
		signatureStatus = "verified";
	}

	const stagingTempDir = await mkdtemp(join(tmpdir(), "gentle-pi-sync-gentle-ai-release-staging-"));
	try {
		const { manifest } = await extractReleaseArtifact(archivePath, stagingTempDir, { extractor });
		const archiveSha256 = await sha256OfFile(archivePath);

		let lockPath;
		const writtenPaths = [];
		if (write) {
			if (packageRoot === undefined) throw new Error("syncGentleAiRelease requires packageRoot when write is true");
			const generated = [];
			for (const entry of manifest.entries) {
				const bytes = await readFile(join(stagingTempDir, entry.path));
				const destination = join(packageRoot, entry.path);
				await mkdir(dirname(destination), { recursive: true });
				await writeFile(destination, bytes, { mode: 0o644 });
				generated.push({ path: entry.path, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
				writtenPaths.push(entry.path);
			}

			const lock = buildGentleAiReleaseLock(manifest, generated, { archiveSha256, evidenceClass, signatureStatus });
			assertLockVersionPin(lock, installerVersion);
			lockPath = join(packageRoot, GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH);
			await mkdir(dirname(lockPath), { recursive: true });
			await writeFile(lockPath, canonicalLockJson(lock), { mode: 0o644 });
			writtenPaths.push(GENTLE_AI_RELEASE_LOCK_RELATIVE_PATH);
		}

		return { manifest, evidenceClass, signatureStatus, lockPath, writtenPaths };
	} finally {
		await rm(stagingTempDir, { recursive: true, force: true });
		if (networkTempDir) await rm(networkTempDir, { recursive: true, force: true });
	}
}

// --- CLI ---------------------------------------------------------------------

function parseArguments(argv) {
	const write = argv.includes("--write");
	const flagIndex = argv.indexOf("--bootstrap-archive");
	const bootstrapArchivePath = flagIndex === -1 ? undefined : argv[flagIndex + 1];
	if (flagIndex !== -1 && (bootstrapArchivePath === undefined || bootstrapArchivePath.startsWith("--"))) {
		throw new Error("usage: sync-gentle-ai-release.mjs --write [--bootstrap-archive <path>]");
	}
	if (!write) {
		throw new Error("usage: sync-gentle-ai-release.mjs --write [--bootstrap-archive <path>]");
	}
	return { write, bootstrapArchivePath };
}

async function main() {
	const { write, bootstrapArchivePath } = parseArguments(process.argv.slice(2));
	const packageRoot = join(dirname(new URL(import.meta.url).pathname), "..");
	const result = await syncGentleAiRelease({ packageRoot, write, bootstrapArchivePath });
	process.stdout.write(
		`gentle-ai release sync complete: evidence class ${result.evidenceClass}, ${result.writtenPaths.length} paths written\n`,
	);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
