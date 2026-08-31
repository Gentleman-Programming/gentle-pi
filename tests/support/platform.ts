// tests/support/platform.ts
//
// Platform-aware test selection helpers for node:test.
// Usage mirrors the repo's existing idiom:
//   test("...", { skip: process.platform === "win32" }, () => { ... });
// These helpers add a machine-readable reason so skipped tests are
// distinguishable from real failures in CI output.

export const IS_WINDOWS = process.platform === "win32";

export interface SkipOption {
	skip: boolean | string;
}

/** Skip on Windows with a reason; runs normally on POSIX. */
export function skipOnWindows(reason: string): SkipOption {
	return IS_WINDOWS ? { skip: `windows: ${reason}` } : { skip: false };
}

/** Run only on POSIX-like platforms (linux/darwin et al.) with a reason. */
export function posixOnly(reason: string): SkipOption {
	return IS_WINDOWS ? { skip: `non-posix (windows): ${reason}` } : { skip: false };
}

/**
 * Capability probe: does git in this environment report an executable-bit
 * change? On Windows git generally cannot (core.filemode=false / NTFS has no
 * exec bit), so tests that assert mode-only changes must be gated on this.
 */
export function gitExecutableModeSupported(): boolean {
	if (process.platform !== "win32") return true;
	return false;
}

/** Skip when git cannot report executable-mode changes (mode-only tests). */
export function skipWhenNoGitExecutableMode(reason: string): SkipOption {
	return gitExecutableModeSupported() ? { skip: false } : { skip: `no-git-exec-mode: ${reason}` };
}