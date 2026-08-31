---
name: sdd-verify
description: Apply, verify, and optionally archive an already planned SDD change.
---

## sdd-init

output: init.md
outputMode: file-only
progress: true

Initialize SDD context for {task} before apply/verify. If the artifact store is `openspec` or `both` and `openspec/config.yaml` is missing, inspect the project and create it automatically. If the artifact store is `engram` or `none`, skip OpenSpec file creation. If `openspec/config.yaml` already exists, read it and report the current SDD/testing configuration without blocking the chain.

## sdd-apply

reads: init.md
output: apply-progress.md
outputMode: file-only
progress: true

Implement pending approved tasks for {task}; update OpenSpec tasks and apply-progress with strict TDD evidence.

## sdd-verify

reads: init.md+apply-progress.md
output: verify-report.md
outputMode: file-only
progress: true

Run focused and full verification for {task} using the apply-progress and project artifacts. Include review/judgment blockers. Start `verify-report.md` with the mandatory fenced `gentle-ai.verify-result/v1` YAML envelope as the first non-empty content, and run `gentle-ai sdd-verify-validate` on the exact report bytes before persisting; on denial or unavailable validator, persist nothing.

## sdd-sync

reads: init.md+apply-progress.md+verify-report.md
output: sync-report.md
outputMode: file-only
progress: true

Sync verified file-backed delta specs for {task} into `openspec/specs/` without archiving. In Engram-only mode, report that canonical sync is not applicable.

## sdd-archive

reads: verify-report.md+sync-report.md
output: archive-report.md
outputMode: file-only
progress: true

Archive {task} only when verification succeeds and file-backed sync is complete or not applicable. If verification or sync fails, leave artifacts active and report the blocker.
