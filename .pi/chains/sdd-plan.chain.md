---
name: sdd-plan
description: Plan an SDD change through proposal, spec, design, and tasks.
---

## sdd-proposal
output: proposal.md
outputMode: file-only
progress: true

Create or update the OpenSpec proposal for {task}. Use prior exploration if it is available in the project artifacts.

## sdd-spec
reads: proposal.md
output: spec.md
outputMode: file-only
progress: true

Write delta specs for {task} using the proposal and previous output. Keep requirements and scenarios acceptance-focused.

## sdd-design
reads: proposal.md+spec.md
output: design.md
outputMode: file-only
progress: true

Design the technical approach for {task}. Preserve native SDD orchestration intent and identify review/judgment risks.

## sdd-tasks
reads: proposal.md+spec.md+design.md
output: tasks.md
outputMode: file-only
progress: true

Create reviewable strict-TDD implementation tasks for {task}. Include workload forecast and any required delivery decision.
