# Design — harness-audit-product-hygiene (Change B)

## Context

Product fix + repository/OpenSpec hygiene + README. Companion to Change A (test infra).

## 1. skill-registry dedup fix

**Decision: defensive fallback in `extensionSourcePath`.**

```ts
function extensionSourcePath(source: string): string | undefined {
	const cleanSource = normalizeExtensionSource(source);
	if (!cleanSource.startsWith("file:")) return undefined;
	try {
		return comparablePath(fileURLToPath(cleanSource));
	} catch {
		// win32: drive-less POSIX file: URLs throw in fileURLToPath.
		const u = new URL(cleanSource);
		const logical = (u.hostname ? `${u.hostname}/` : "") + u.pathname.replace(/^\/+/, "");
		return comparablePath(logical);
	}
}
```

- `comparablePath` additionally lower-cases on win32 so drive-letter case can't defeat comparison.
- Tradeoff: the fallback yields a logical relative path for drive-less URLs; the dedup comparison stays string-based (no fs stat). `file://host/...` (UNC) handled by preserving `hostname`. Accepted.
- RED evidence: current Windows failure of `project-local skill registry extension wins over installed package copy`; plus new drive-less regression unit.

## 2. Repo hygiene

- `packageManager: pnpm@11.1.1` + delete untracked `package-lock.json` + `.gitignore`: mechanical, no tradeoff.
- `apply.md` → `apply-progress.md`: content unchanged.

## 3. OpenSpec closure/archive

- **Delicate part:** before archiving each orphaned change, verify task completion by reading its `apply-progress.md`/`tasks.md` and, where verification is impossible or code contradicts leftover `- [ ]`, archive as *superseded/abandoned with a documented reason* — never mark done dishonestly (that would poison the audit trail this change restores).
- Archive per repo convention: `openspec/changes/archive/<date>-<name>/` + `ARCHIVE-REPORT.md`. Proposal-only changes: archive-as-abandoned with reason unless genuinely in-flight (then documented note).
- This change itself must close archived-eligible (verify-report + sync-report are tasks).

## 4. README (product-proof-saas applied)

- Fix version examples; add a "How it works" mechanism section (explicit states: clarify → proposal/spec/design/tasks → apply → verify → sync → archive; native `gentle-ai` CLI owns review evidence; delivery follows ordinary repo policy); honesty pass neutralizing unbacked claims; capability-table entries anchored to the mechanism.
- Tradeoff: guard against scope creep into a visual redesign — content changes only where mechanism-first/honesty demand; no new site, no images, no invented pricing/FAQ.

## 5. Delivery

- A→B sequence; forecast ~150–350 lines; single review; `size:exception` never inferred.