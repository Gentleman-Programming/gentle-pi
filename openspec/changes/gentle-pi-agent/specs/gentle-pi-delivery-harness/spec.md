# gentle-pi-delivery-harness Specification

## Purpose

Define Pi delivery planning outputs that protect review throughput while allowing explicit exception policy.

## Requirements

### Requirement: Emit review workload forecast

Task planning MUST emit a 400-line review risk forecast and decision fields for delivery strategy.

#### Scenario: Forecast output present
- GIVEN tasks are generated for a change
- WHEN task planning completes
- THEN output includes `Decision needed before apply`, `Chained PRs recommended`, and `400-line budget risk`

### Requirement: Respect exception-ok strategy

When delivery strategy is `exception-ok`, apply MAY proceed with a large slice but MUST include rollback-safe boundaries and explicit risk notes.

#### Scenario: Exception accepted
- GIVEN forecast is high risk and strategy is `exception-ok`
- WHEN apply starts
- THEN execution proceeds
- AND result includes exception acceptance plus rollback checkpoints

#### Scenario: High risk without decision
- GIVEN forecast is high risk and no strategy decision exists
- WHEN apply is requested
- THEN execution SHALL return `blocked`
