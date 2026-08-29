# Routing and tool profiles

Marker:

- `PROJECT_PROFILE_BASELINE_V1`

## Problem

A route classified as `project` could receive only the explicitly requested tools and therefore omit basic capabilities required to inspect or modify the project.

## Change

The effective tool set combines the profile defaults with requested tools.

Conceptually:

```text
effective tools =
    PROFILE_DEFAULTS[profile]
    union
    requested tools
```

## Result

Project phases regained the baseline capabilities required for bounded autonomous work.

## Known limitation

This is intentionally documented as an area for further upstream review.

A broad project baseline may grant more capabilities than the strict minimum required for a particular phase. A future refinement could preserve the baseline reliability while applying a stronger least-privilege policy.
