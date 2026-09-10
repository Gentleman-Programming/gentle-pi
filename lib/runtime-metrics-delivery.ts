// Shared across extension instances, including a cancelled process still exiting.
let busy = false;

/** One accepted attempt, never a queue. Defer resolver/process work beyond the
 * provider callback. Busy events are discarded rather than captured for later.
 * The transport must settle only after its process exits; disposal never waits.
 */
export class RuntimeMetricsAttempt {
	#closed = false;
	#scheduled?: ReturnType<typeof setImmediate>;
	#abort?: AbortController;
	offer(work: (signal: AbortSignal) => Promise<unknown>): boolean {
		if (this.#closed || busy) return false;
		busy = true;
		const abort = new AbortController();
		this.#abort = abort;
		this.#scheduled = setImmediate(() => {
			this.#scheduled = undefined;
			void (async () => {
				try { if (!abort.signal.aborted) await work(abort.signal); }
				catch { /* An attempt is always best effort; never retry or report. */ }
				finally { this.#abort = undefined; busy = false; }
			})();
		});
		return true;
	}
	dispose(): void {
		if (this.#closed) return;
		this.#closed = true;
		if (this.#scheduled) {
			clearImmediate(this.#scheduled);
			this.#scheduled = undefined;
			busy = false;
		}
		this.#abort?.abort();
		this.#abort = undefined;
	}
}
