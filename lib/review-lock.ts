import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { canonicalJsonV1, domainHashV1 } from "./review-canonical.ts";

export class ReviewLockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewLockError";
	}
}

export interface ReviewLockOwnerV1 {
	token: string;
	owner_hash: string;
	pid: number;
	repository_id: string;
	authority_id: string;
}

/**
 * The runtime must provide a primitive whose no-replace result is authoritative.
 * Node's ordinary rename API is deliberately not adapted: it may replace a target.
 */
export interface ReviewLockPlatformAdapterV1 {
	name: string;
	assertQualified(): void;
	proveOwnerDead(owner: ReviewLockOwnerV1): boolean;
	moveNoReplace(source: string, destination: string): void;
}

export function conservativeOwnerDeathProofV1(owner: ReviewLockOwnerV1): boolean {
	if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid === process.pid) return false;
	try {
		process.kill(owner.pid, 0);
		return false;
	} catch (error) {
		return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ESRCH";
	}
}

const UNQUALIFIED_PLATFORM: ReviewLockPlatformAdapterV1 = {
	name: "portable-atomic-mkdir",
	assertQualified() {},
	proveOwnerDead(owner) { return conservativeOwnerDeathProofV1(owner); },
	moveNoReplace() { throw new ReviewLockError("Review lock recovery is unsupported without a qualified no-replace move primitive"); },
};

/**
 * The qualified default production platform: a pure-Node, no-dependency
 * atomic no-replace move.
 *
 * The lock's moved paths (`this.path`, quarantine/released destinations) are
 * directories, and directories cannot be hard-linked on POSIX. `fs.mkdirSync`
 * is itself already an atomic no-replace primitive for any path — it throws
 * EEXIST whether the destination is occupied by a file or a directory, empty
 * or not — so it exclusively reserves the destination name; the subsequent
 * rename then safely folds the source directory's content into that
 * exclusively-owned, still-empty destination (renaming a directory onto
 * one's own just-created empty directory is an ordinary, safe POSIX
 * replace). For a plain file source, the classic `linkSync`
 * (EEXIST-on-no-replace) + `unlinkSync` sequence is used instead.
 *
 * If the underlying primitive is unsupported on this platform or
 * filesystem, this fails closed with a descriptive `ReviewLockError` rather
 * than silently replacing the destination.
 */
export function qualifiedNodeFsLockPlatformV1(): ReviewLockPlatformAdapterV1 {
	return {
		name: "node-fs-atomic-no-replace",
		assertQualified() {},
		proveOwnerDead(owner) { return conservativeOwnerDeathProofV1(owner); },
		moveNoReplace(source, destination) {
			let isDirectory: boolean;
			try {
				isDirectory = lstatSync(source).isDirectory();
			} catch (error) {
				throw new ReviewLockError(`Review lock atomic no-replace move source is unavailable: ${error instanceof Error ? error.message : String(error)}`);
			}
			if (process.platform === "win32") {
				try {
					renameSync(source, destination);
				} catch (error) {
					throw new ReviewLockError(`Review lock atomic no-replace move is unsupported on this platform or filesystem: ${error instanceof Error ? error.message : String(error)}`);
				}
				return;
			}
			if (!isDirectory) {
				try {
					linkSync(source, destination);
					unlinkSync(source);
				} catch (error) {
					throw new ReviewLockError(`Review lock atomic no-replace move is unsupported on this platform or filesystem: ${error instanceof Error ? error.message : String(error)}`);
				}
				return;
			}
			try {
				mkdirSync(destination, { mode: 0o700 });
			} catch (error) {
				throw new ReviewLockError(`Review lock atomic no-replace move is unsupported on this platform or filesystem: ${error instanceof Error ? error.message : String(error)}`);
			}
			try {
				renameSync(source, destination);
			} catch (error) {
				try { rmSync(destination, { recursive: true, force: true }); } catch {}
				throw new ReviewLockError(`Review lock atomic no-replace move failed after reserving the destination: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
	};
}

const DEFAULT_PLATFORM: ReviewLockPlatformAdapterV1 = qualifiedNodeFsLockPlatformV1();

export interface ReviewLockInspectionV1 {
	status: "absent" | "owned" | "ambiguous";
	owner?: ReviewLockOwnerV1;
}

export class ReviewMutationLockV1 {
	readonly path: string;
	readonly #repositoryId: string;
	readonly #authorityId: string;
	readonly #platform: ReviewLockPlatformAdapterV1;

	constructor(controlRoot: string, repositoryId: string, authorityId: string, platform: ReviewLockPlatformAdapterV1 = DEFAULT_PLATFORM) {
		const control = basename(controlRoot) === "control" ? controlRoot : join(controlRoot, "locks");
		this.path = join(control, "authority.lock");
		this.#repositoryId = repositoryId;
		this.#authorityId = authorityId;
		this.#platform = platform;
	}

	acquire(): ReviewLockOwnerV1 {
		const unsigned = { token: randomBytes(32).toString("hex"), pid: process.pid, repository_id: this.#repositoryId, authority_id: this.#authorityId };
		const owner: ReviewLockOwnerV1 = { ...unsigned, owner_hash: domainHashV1("lock-owner", unsigned) };
		const intentRoot = join(this.path, "..", "authority.lock-intents");
		mkdirSync(intentRoot, { recursive: true, mode: 0o700 });
		const intentPath = join(intentRoot, `${owner.token}.json`);
		writeFileSync(intentPath, canonicalJsonV1(owner), { mode: 0o600, flag: "wx" }); this.fsyncFile(intentPath); this.fsyncDirectory(intentRoot);
		mkdirSync(join(this.path, ".."), { recursive: true, mode: 0o700 });
		try { mkdirSync(this.path, { mode: 0o700 }); } catch (error) { throw new ReviewLockError(`Review authority lock is active or ambiguous: ${error instanceof Error ? error.message : String(error)}`); }
		try {
			writeFileSync(join(this.path, "owner.json"), canonicalJsonV1(owner), { mode: 0o600, flag: "wx" });
			this.fsyncFile(join(this.path, "owner.json"));
			this.fsyncDirectory(this.path);
			this.fsyncDirectory(join(this.path, ".."));
			unlinkSync(intentPath);
			this.fsyncDirectory(intentRoot);
		} catch (error) {
			// The incomplete directory is deliberately retained: stealing it is ambiguous.
			throw new ReviewLockError(`Review authority lock owner is ambiguous: ${error instanceof Error ? error.message : String(error)}`);
		}
		return Object.freeze(owner);
	}

	release(owner: ReviewLockOwnerV1): void {
		const observed = this.readOwner();
		if (observed.token !== owner.token || observed.owner_hash !== owner.owner_hash || observed.pid !== process.pid || observed.repository_id !== this.#repositoryId || observed.authority_id !== this.#authorityId) {
			throw new ReviewLockError("Review authority lock owner token does not match");
		}
		try {
			if (this.#platform === UNQUALIFIED_PLATFORM) {
				rmSync(this.path, { recursive: true, force: false });
			} else {
				const released = join(this.path, "..", `released-${owner.owner_hash}-${owner.token}`);
				this.#platform.moveNoReplace(this.path, released);
				this.fsyncDirectory(join(this.path, ".."));
				rmSync(released, { recursive: true, force: false });
			}
			this.fsyncDirectory(join(this.path, ".."));
		} catch (error) {
			throw new ReviewLockError(`Review authority lock release failed closed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	inspect(): ReviewLockInspectionV1 {
		if (!existsSync(this.path)) return { status: "absent" };
		try { return { status: "owned", owner: this.readOwner() }; } catch { return { status: "ambiguous" }; }
	}

	recover(expectedOwnerHash: string): void {
		this.#platform.assertQualified();
		const observed = this.readOwner();
		if (observed.owner_hash !== expectedOwnerHash) throw new ReviewLockError("Review authority lock owner hash does not match");
		if (!this.#platform.proveOwnerDead(observed)) throw new ReviewLockError("Review authority lock ownership is active or ambiguous");
		const quarantineRoot = join(this.path, "..", "quarantine");
		const destination = join(quarantineRoot, `stale-${observed.owner_hash}-${observed.token}`);
		mkdirSync(quarantineRoot, { recursive: true, mode: 0o700 });
		try {
			this.#platform.moveNoReplace(this.path, destination);
			this.fsyncDirectory(join(this.path, ".."));
		} catch (error) {
			throw new ReviewLockError(`Review authority lock recovery race; re-observe: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	recoverIncomplete(expectedToken: string): void {
		this.#platform.assertQualified();
		if (!/^[0-9a-f]{64}$/.test(expectedToken)) throw new ReviewLockError("Review authority lock intent token is invalid");
		if (existsSync(join(this.path, "owner.json"))) throw new ReviewLockError("Review authority lock is not incomplete");
		const intentPath = join(this.path, "..", "authority.lock-intents", `${expectedToken}.json`);
		let owner: ReviewLockOwnerV1;
		try { owner = JSON.parse(readFileSync(intentPath, "utf8")) as ReviewLockOwnerV1; } catch { throw new ReviewLockError("Review authority lock acquisition intent is ambiguous"); }
		if (owner.token !== expectedToken || owner.repository_id !== this.#repositoryId || owner.authority_id !== this.#authorityId || owner.owner_hash !== domainHashV1("lock-owner", { token: owner.token, pid: owner.pid, repository_id: owner.repository_id, authority_id: owner.authority_id }) || !this.#platform.proveOwnerDead(owner)) throw new ReviewLockError("Review authority lock acquisition intent is active or ambiguous");
		const destination = join(this.path, "..", "quarantine", `incomplete-${owner.owner_hash}-${owner.token}`);
		mkdirSync(join(this.path, "..", "quarantine"), { recursive: true, mode: 0o700 });
		try { this.#platform.moveNoReplace(this.path, destination); this.fsyncDirectory(join(this.path, "..")); } catch (error) { throw new ReviewLockError(`Review authority lock recovery race; re-observe: ${error instanceof Error ? error.message : String(error)}`); }
	}

	private readOwner(): ReviewLockOwnerV1 {
		if (!existsSync(this.path)) throw new ReviewLockError("Review authority lock is absent");
		try {
			const owner = JSON.parse(readFileSync(join(this.path, "owner.json"), "utf8")) as ReviewLockOwnerV1;
			const { owner_hash, ...unsigned } = owner;
			if (typeof owner.token !== "string" || !/^[0-9a-f]{64}$/.test(owner.token) || typeof owner_hash !== "string" || !Number.isSafeInteger(owner.pid) || owner.repository_id !== this.#repositoryId || owner.authority_id !== this.#authorityId || owner_hash !== domainHashV1("lock-owner", unsigned)) throw new Error("invalid owner metadata");
			return owner;
		} catch (error) {
			throw new ReviewLockError(`Review authority lock ownership is ambiguous: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private fsyncFile(path: string): void {
		const descriptor = openSync(path, "r+");
		try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
	}

	private fsyncDirectory(path: string): void {
		if (!statSync(path).isDirectory()) throw new ReviewLockError("Review lock path is not a directory");
		if (process.platform === "win32") return;
		const descriptor = openSync(path, "r");
		try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
	}
}
