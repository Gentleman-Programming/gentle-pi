---
name: sdd-verify
description: Apply, verify, and optionally archive an already planned SDD change.
---

## sdd-apply
output: apply-progress.md
outputMode: file-only
progress: true

Implement pending approved tasks for {task}; update OpenSpec tasks and apply-progress with strict TDD evidence.

## sdd-verify
reads: apply-progress.md
output: verify-report.md
outputMode: file-only
progress: true

Run focused and full verification for {task} using the apply-progress and project artifacts. Include review/judgment blockers.

## sdd-archive
reads: verify-report.md
output: archive-report.md
outputMode: file-only
progress: true

Archive {task} only when verification succeeds. If verification fails, leave artifacts active and report the blocker.
