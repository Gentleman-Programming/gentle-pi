# Proposal: configurable-startup-banner

## Problem

The startup banner is currently hardcoded in `extensions/startup-banner.ts`. Users cannot choose the banner color palette without editing source code.

This makes a visual preference behave like a code customization. For a Pi package that aims to be a configurable harness, startup presentation should be controlled through stable commands and global preferences.

## Goals

- Add a global startup banner color preference.
- Preserve the existing default startup banner for users with no saved config.
- Allow users to choose a preset banner color palette.
- Provide a direct color command through `/gentle:banner-color`.
- Provide a compatibility alias under `/gentle-ai:*`:
  - `/gentle-ai:banner-color`
- Document the commands and defaults in `README.md`.

## Non-goals

- Do not add rose visibility toggles in this change.
- Do not add text-logo visibility toggles in this change.
- Do not support custom RGB input in this change.
- Do not support project-local banner config in this change.
- Do not replace `TEXT_LOGO` or `ROSE_LARGE_RAW` with user-provided art in this change.
- Do not redesign the full startup animation.
- Do not change Pi's theme system.

## Decisions

- Banner color config is global, not project-local.
- Color selection is preset-only.
- The current pink palette remains the default.
- Initial presets are:
  - `pink` / current;
  - `cyan`;
  - `yellow`;
  - `green`.
- Both command namespaces are supported:
  - `/gentle:*`
  - `/gentle-ai:*`
- Decorative banner elements remain governed by the existing renderer and layout constraints; this change only configures colors.

## Affected areas

- `extensions/startup-banner.ts`
  - Load normalized banner config.
  - Apply selected palette preset while preserving existing default visuals and layout behavior.
- `extensions/gentle-ai.ts`
  - Register direct color commands and compatibility aliases.
  - Provide the banner color selection UI.
- `lib/banner-config.ts` or equivalent
  - Store defaults, allowed presets, validation, read/write helpers, and global config path.
- `tests/runtime-harness.mjs`
  - Assert new commands are registered.
  - Exercise command behavior where practical in the harness.
- New focused tests if needed
  - Validate config parsing, defaults, invalid config fallback, and persistence path behavior.
- `README.md`
  - Document banner color customization commands, defaults, presets, and global persistence.

## Acceptance criteria

- Users can select one of the supported banner color presets.
- The choice persists globally across Pi sessions.
- Existing default behavior remains unchanged when no config exists.
- Both `/gentle:*` and `/gentle-ai:*` command namespaces are supported for banner color customization.
- `/gentle:banner-color` provides the supported path to color selection.
- Tests cover config loading and command behavior.
- README documents the new banner color customization commands.

## Review workload

Expected medium change. The likely implementation touches one new config helper, two extensions, tests, README, and SDD artifacts. The change should be planned carefully to stay under the 350-line review budget where possible; if palette extraction grows too large, split implementation from docs or defer broader animation refactors.

## Rollback

- Remove the banner config helper and command registrations.
- Revert `startup-banner.ts` to hardcoded color behavior.
- Remove README command documentation.
- Existing user config files can be ignored safely if the feature is reverted.
