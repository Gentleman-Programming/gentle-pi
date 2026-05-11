---
name: sdd-full
description: Run the full SDD lifecycle for a change when explicitly approved.
---

## sdd-init
output: init.md
outputMode: file-only
progress: true

Initialize or refresh SDD context for {task}. Detect project context, testing capabilities, strict TDD setting, and skill registry availability.

## sdd-explore
reads: init.md
output: exploration.md
outputMode: file-only
progress: true

Explore {task}. Identify scope, risks, dependencies, prior art, and whether the change should proceed into proposal.

## sdd-proposal
reads: exploration.md
output: proposal.md
outputMode: file-only
progress: true

Create or update the OpenSpec proposal for {task} using the exploration notes and the previous step output.

## sdd-spec
reads: proposal.md
output: spec.md
outputMode: file-only
progress: true

Write delta specs for {task} from the approved proposal. Preserve RFC 2119 requirements and Given/When/Then scenarios.

## sdd-design
reads: proposal.md+spec.md
output: design.md
outputMode: file-only
progress: true

Design the technical approach for {task} using the proposal, specs, and previous outputs. Call out review and judgment risks.

## sdd-tasks
reads: proposal.md+spec.md+design.md
output: tasks.md
outputMode: file-only
progress: true

Create strict-TDD, reviewable implementation tasks for {task}. Include the required Review Workload Forecast guard lines and PR split recommendation.

## sdd-apply
reads: proposal.md+spec.md+design.md+tasks.md
output: apply-progress.md
outputMode: file-only
progress: true

Implement only approved tasks for {task}; enforce strict TDD when active and stop before writing if workload decisions are unresolved. Update OpenSpec tasks and apply-progress with evidence.

## sdd-verify
reads: proposal.md+spec.md+design.md+tasks.md+apply-progress.md
output: verify-report.md
outputMode: file-only
progress: true

Verify {task} against specs, design, tasks, implementation, apply-progress, strict TDD evidence, assertion quality, and review workload boundaries.

## sdd-archive
reads: verify-report.md
output: archive-report.md
outputMode: file-only
progress: true

Archive {task} only when the verification report passes; otherwise report that archive is blocked and preserve active artifacts.
