# Spec — skill-registry duplicate-load dedup fix (Windows)

## Context

`extensions/skill-registry.ts` `extensionSourcePath()` calls `fileURLToPath()`, which throws `ERR_INVALID_FILE_URL_PATH` on Windows for drive-less POSIX-style URLs (`file:///home/...`). The `catch` returns `undefined`, so `shouldSkipDuplicateExtensionLoad` skips the dedup branch and the installed package copy registers as if new — the "project-local wins over installed package copy" expectation is violated.

## Acceptance criteria

- AC1: `extensionSourcePath` falls back to a logical path derived from the URL string when `fileURLToPath` throws (returns a defined comparable path, never a silent `undefined` for `file:` URLs).
- AC2: `shouldSkipDuplicateExtensionLoad` then returns `true` for the installed-copy URL when a project-local `extensions/skill-registry.ts` exists, on all platforms — the existing unit test `project-local skill registry extension wins over installed package copy` passes on Windows.
- AC3: POSIX behavior is unchanged: `fileURLToPath` success path still yields file-system paths; dedup across `?fragment` variants still treats them as the same source.
- AC4: A regression unit test exercises the drive-less URL form directly on Windows and Linux (on Linux it must keep the current correct result; on Windows it must not throw and not return `undefined`).
- AC5: No other behavior of the registry (watcher, `.atl/skill-registry.md` rendering) changes.

## Non-constraints

- The change takes effect on the next Pi start (it is a live extension); no runtime reload is required.
- The installed-vs-local comparison remains string-based; no filesystem stat of the unresolved drive-less path is required.