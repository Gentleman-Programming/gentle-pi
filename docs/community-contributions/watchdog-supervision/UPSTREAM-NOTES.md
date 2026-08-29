# Upstream contribution notes

## Recommended submission order

To make review easier, do not propose the entire router as one monolithic architectural change.

A maintainer-friendly order would be:

### Group 1 — deterministic watchdog safety

- SOFT review advisory barrier
- stale-review pre-abort invalidation
- structural escalation guard

These changes address controller safety without requiring the full persistent-resume architecture.

### Group 2 — phase finalization safety

- Engram ACK → `phase_complete` termination grace
- termination-grace log cleanup

This is a small, independently explainable state-machine fix with clear end-to-end evidence.

### Group 3 — task-scoped recovery evidence

- bind recovery snapshots to the producing task/objective
- retain structured read paths

### Group 4 — persistent resume

- objective fingerprint
- new task ID on resumed execution
- compact cross-session evidence checkpoint

### Group 5 — semantic resume

- expose successful tool result evidence to the watchdog
- semantic checkpoint
- semantic carry-forward
- smallest unresolved continuation objective

### Group 6 — routing/tool-profile policy

- project profile baseline tools

This should probably be discussed separately because it involves a capability/least-privilege trade-off.

## Suggested maintainer framing

The contribution should be presented as:

- failure modes observed under a real local autonomous workflow;
- deterministic safety properties we wanted to preserve;
- implementation used to test those properties;
- evidence from real executions;
- known limitations and design choices open for upstream discussion.

Avoid framing the work as a replacement for Gentle-Pi or as an authoritative redesign.
