---
name: 4r-review
description: One-shot lens-only 4R discovery against a supplied initial review tree; the controller owns all authority.
---

## review-risk

output: review-risk-report.md
outputMode: file-only
progress: true

Run R1 Risk exactly once against the supplied `initial_review_tree`. Return candidate rows for security, privilege boundaries, data exposure, dependencies, and merge-blocking vulnerabilities. If clean, return an empty candidate list.

## review-resilience

output: review-resilience-report.md
outputMode: file-only
progress: true

Run R4 Resilience exactly once against the supplied `initial_review_tree`. Return candidate rows for fallbacks, retry/backoff, graceful degradation, observability, load, rollback, and SLO risks. If clean, return an empty candidate list.

## review-readability

output: review-readability-report.md
outputMode: file-only
progress: true

Run R2 Readability exactly once against the supplied `initial_review_tree`. Return candidate rows for naming, complexity, intention, maintainability, review size, and context clarity. If clean, return an empty candidate list.

## review-reliability

output: review-reliability-report.md
outputMode: file-only
progress: true

Run R3 Reliability exactly once against the supplied `initial_review_tree`. Return candidate rows for behavior-first test coverage, edge cases, determinism, contracts, and regressions. If clean, return an empty candidate list.
