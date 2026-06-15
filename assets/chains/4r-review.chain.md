---
name: 4r-review
description: Pre-PR 4R review fan-out — runs all four review lenses (risk, readability, reliability, resilience) in sequence and writes individual reports.
---

## review-risk

output: review-risk-report.md
outputMode: file-only
progress: true

Run R1 Risk review on the current diff. Report security, privilege boundary, data exposure, dependency, and merge-blocking vulnerability findings. If clean, say exactly: `No findings.`

## review-readability

reads: review-risk-report.md
output: review-readability-report.md
outputMode: file-only
progress: true

Run R2 Readability review on the current diff. Report naming, complexity, intention, maintainability, review size, and context clarity findings. If clean, say exactly: `No findings.`

## review-reliability

reads: review-risk-report.md+review-readability-report.md
output: review-reliability-report.md
outputMode: file-only
progress: true

Run R3 Reliability review on the current diff. Report behavior-first test coverage, edge case, determinism, contract, and regression findings. If clean, say exactly: `No findings.`

## review-resilience

reads: review-risk-report.md+review-readability-report.md+review-reliability-report.md
output: review-resilience-report.md
outputMode: file-only
progress: true

Run R4 Resilience review on the current diff. Report fallback, retry/backoff, graceful degradation, observability, load, rollback, and SLO risk findings. If clean, say exactly: `No findings.`
