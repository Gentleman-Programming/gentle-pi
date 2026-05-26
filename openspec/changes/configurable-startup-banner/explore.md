# Explore: configurable-startup-banner

## Source

- GitHub issue: https://github.com/Gentleman-Programming/gentle-pi/issues/32
- Branch stack: `issue-32-sdd-plan-a` -> `issue-32-sdd-plan-b` -> `issue-32-banner-controls` -> `issue-32-banner-render`
- SDD session preferences:
  - execution mode: interactive
  - artifact store: OpenSpec
  - chained PR strategy: auto-forecast
  - review budget: 350 changed lines

## Problem framing

`gentle-pi` currently renders the startup banner from hardcoded data in `extensions/startup-banner.ts`:

- `TEXT_LOGO`
- `ROSE_LARGE_RAW`
- inline RGB choices for rose/logo/banner effects

Users who want a different color palette must edit source code. That conflicts with the package goal: el Gentleman should be configurable through Pi commands and global runtime preferences, not local source edits.

Maintainer feedback narrowed issue #32 to color customization only. Rose visibility and text-logo visibility toggles are out of scope for this change.

## Current implementation observations

- `extensions/startup-banner.ts` owns startup banner rendering and contains the rose/logo ASCII art constants.
- `extensions/gentle-ai.ts` owns most existing global Gentle AI commands, including `/gentle:models`, aliases, and `/gentle-ai:status`.
- Global Gentle AI configuration already has precedent through model config under `GENTLE_PI_CONFIG_HOME` or `~/.pi/gentle-ai`.
- `tests/runtime-harness.mjs` validates registered commands and runtime extension wiring.
- `README.md` documents commands and package capabilities.

## Confirmed decisions

- Banner config is global, not project-local.
- Colors are preset-only for now.
- The current pink palette remains the default.
- Initial color presets are:
  - `pink` / current;
  - `cyan`;
  - `yellow`;
  - `green`.
- Commands support both namespaces:
  - `/gentle:*`
  - `/gentle-ai:*`
- Main configuration panel:
- Fast color commands:
  - `/gentle:banner-color`
  - `/gentle-ai:banner-color`
- Existing rose/text-logo rendering behavior remains unchanged and is governed only by the current renderer and terminal layout constraints.

## Candidate approach

Add a small shared banner config module, for example `lib/banner-config.ts`, to keep parsing, defaults, validation, and persistence out of the UI/render files.

Suggested default config:

```json
{
  "colorPreset": "pink"
}
```

Suggested global path follows existing Gentle AI config conventions:

```text
<GENTLE_PI_CONFIG_HOME or ~/.pi/gentle-ai>/banner.json
```

`extensions/gentle-ai.ts` can register command handlers and UI/panel interactions. `extensions/startup-banner.ts` can read the normalized config and adapt colors while preserving existing layout behavior.

## Expected affected files

- `lib/banner-config.ts` — new shared config parsing/defaults/persistence helpers.
- `extensions/startup-banner.ts` — read config and apply palette presets.
- `extensions/gentle-ai.ts` — register `/gentle:banner-color`, and `/gentle-ai:*` aliases.
- `tests/runtime-harness.mjs` — assert commands are registered and command behavior persists config.
- Additional focused test file if helpful — validate config normalization/defaults without TUI.
- `README.md` — document banner color customization commands and defaults.

## Risks and constraints

- `startup-banner.ts` has many inline RGB calculations. Palette extraction should be minimal and focused; avoid rewriting the animation.
- The command UI lives outside the render extension, so config should be centralized in `lib/` rather than duplicated.
- Terminal-width fallback behavior already decides when rose/logo render. This change must not add explicit show/hide flags or alter those layout decisions.
- Keep default behavior unchanged for users with no `banner.json`.

## Recommended next phase

Proceed to SDD proposal for `configurable-startup-banner`. After proposal approval, write spec/design/tasks before implementation.
