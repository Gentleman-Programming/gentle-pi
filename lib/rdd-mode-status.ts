import {
	NATIVE_REVIEW_MODE_OPERATION,
	NATIVE_REVIEW_MODE_SCOPE,
	NATIVE_REVIEW_MODE_SOURCE,
	type NativeReviewCli,
	type NativeReviewModeStatus,
} from "./native-review-cli.ts";

export type RddModeValue = "on" | "off" | "unknown";
/** The scope that supplied the effective decision, distinct from result.scope query breadth. */
export type RddModeScope = "clone" | "global" | "default";
export type RddModeStatus = NativeReviewModeStatus & { scope: RddModeScope };
export const RDD_STATUS_TIMEOUT_MS = 3_000;
export const RDD_STATUS_MEMO_TTL_MS = 30_000;
export const RDD_MODE_STATUS_CHANGED = "gentle-pi:rdd-mode-status-changed";

const memo = new Map<string, { status: RddModeStatus | undefined; expiresAt: number }>();
let memoEpoch = 0;
const memoGeneration = new Map<string, number>();

export function isValidRddModeStatus(status: NativeReviewModeStatus | undefined): status is NativeReviewModeStatus {
	return status !== undefined && status !== null && typeof status === "object" &&
		(status.effective === "on" || status.effective === "off") &&
		typeof status.source === "string" && Object.values(NATIVE_REVIEW_MODE_SOURCE).includes(status.source);
}

/** Projects the native effective decision; cache contents are observations, never authority. */
export function projectRddMode(status: NativeReviewModeStatus | undefined): RddModeValue {
	return isValidRddModeStatus(status) ? status.effective : "unknown";
}

function effectiveScope(source: NativeReviewModeStatus["source"]): RddModeScope {
	return source === NATIVE_REVIEW_MODE_SOURCE.CLONE_LOCAL ? "clone" : source;
}

/** Projects the source of the effective decision; wire scope is query breadth only. */
export function projectRddScope(status: NativeReviewModeStatus | undefined): RddModeScope | undefined {
	return isValidRddModeStatus(status) ? effectiveScope(status.source) : undefined;
}

// This private identity records which Promise.race branch rejected. Checking a
// signal's later state is insufficient: an unrelated rejection can win the race
// before its caller aborts.
const callerAbortRejection = {};

function abortRejection(
	signal: AbortSignal,
	wasAbortedByCaller: () => boolean,
): { promise: Promise<never>; dispose: () => void } {
	let listener: (() => void) | undefined;
	const promise = new Promise<never>((_resolve, reject) => {
		const rejectForAbort = () => reject(wasAbortedByCaller() ? callerAbortRejection : signal.reason ?? new Error("aborted"));
		if (signal.aborted) return rejectForAbort();
		listener = rejectForAbort;
		signal.addEventListener("abort", listener, { once: true });
	});
	return { promise, dispose: () => listener && signal.removeEventListener("abort", listener) };
}

function combineAbortSignals(
	timeout: AbortSignal,
	caller?: AbortSignal,
): { signal: AbortSignal; wasAbortedByCaller: () => boolean; dispose: () => void } {
	const controller = new AbortController();
	let abortedByCaller = false;
	const sources = caller === undefined ? [timeout] : [timeout, caller];
	const listeners = sources.map((source) => {
		const abort = () => {
			if (controller.signal.aborted) return;
			abortedByCaller = source === caller;
			controller.abort(source.reason ?? new Error("aborted"));
		};
		if (source.aborted) abort();
		else source.addEventListener("abort", abort, { once: true });
		return { source, abort };
	});
	return {
		signal: controller.signal,
		wasAbortedByCaller: () => abortedByCaller,
		dispose: () => listeners.forEach(({ source, abort }) => source.removeEventListener("abort", abort)),
	};
}

export async function resolveRddModeStatus(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
	now: () => number = Date.now,
	timeoutSignal: AbortSignal = AbortSignal.timeout(RDD_STATUS_TIMEOUT_MS),
): Promise<RddModeStatus | undefined> {
	const nowMs = now();
	const cached = memo.get(cwd);
	if (cached && cached.expiresAt > nowMs) return cached.status;
	const epoch = memoEpoch;
	const generation = memoGeneration.get(cwd) ?? 0;
	let status: RddModeStatus | undefined;
	let memoize = true;
	if (nativeReviewCli?.reviewMode) {
		const combined = combineAbortSignals(timeoutSignal, signal);
		const aborted = abortRejection(combined.signal, combined.wasAbortedByCaller);
		try {
			const result = await Promise.race([
				nativeReviewCli.reviewMode({ cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS, signal: combined.signal }),
				aborted.promise,
			]);
			status = isValidRddModeStatus(result.status) && Object.values(NATIVE_REVIEW_MODE_SCOPE).includes(result.scope)
				? { ...result.status, scope: projectRddScope(result.status)! }
				: undefined;
		} catch (reason) {
			status = undefined;
			memoize = reason !== callerAbortRejection;
		}
		finally {
			aborted.dispose();
			combined.dispose();
		}
	}
	// An invalidation means a newer authoritative observation is required. A
	// completion started before it may still return to its caller, but cannot
	// repopulate the cache over a later same-cwd read.
	if (memoize && memoEpoch === epoch && (memoGeneration.get(cwd) ?? 0) === generation) {
		memo.set(cwd, { status, expiresAt: nowMs + RDD_STATUS_MEMO_TTL_MS });
	}
	return status;
}

export function invalidateRddModeStatus(cwd?: string): void {
	if (cwd === undefined) {
		memoEpoch += 1;
		memo.clear();
		return;
	}
	memo.delete(cwd);
	memoGeneration.set(cwd, (memoGeneration.get(cwd) ?? 0) + 1);
}

/** @internal test seam. */
export const clearRddStatusMemoForTesting = invalidateRddModeStatus;
