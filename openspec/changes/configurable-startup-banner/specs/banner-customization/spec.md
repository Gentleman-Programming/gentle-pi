# Banner Color Customization Specification

## Purpose

Provide global, command-driven startup banner color customization while preserving the current default banner experience for users without saved configuration.

## Requirements

### Requirement: Global Persisted Banner Color Configuration

The system MUST store startup banner color preferences as global Gentle AI configuration that persists across Pi sessions and is independent of any project-local repository state.

#### Scenario: Persisted color preference is reused

- GIVEN a user changes the startup banner color through a supported command
- WHEN a later Pi session starts
- THEN the startup banner MUST use the saved global color preference

#### Scenario: Missing config uses defaults

- GIVEN no saved banner configuration exists
- WHEN the startup banner renders
- THEN the system MUST use the default banner color configuration

#### Scenario: Invalid config is normalized

- GIVEN a saved banner configuration contains missing or unsupported values
- WHEN the startup banner configuration is loaded
- THEN the system MUST fall back to supported default values for invalid fields

### Requirement: Default Banner Remains Unchanged

The system MUST preserve the existing startup banner appearance for users with no saved banner configuration.

#### Scenario: First run keeps current visuals

- GIVEN a user has no saved banner configuration
- WHEN Pi renders the startup banner
- THEN the rose MUST be visible according to the existing renderer behavior
- AND the text logo MUST be visible according to the existing renderer behavior
- AND the color palette MUST be the current pink palette

### Requirement: Preset Banner Colors

The system MUST allow users to select only supported preset banner color palettes: `pink`, `cyan`, `yellow`, and `green`.

#### Scenario: Preset selected

- GIVEN the user selects a supported color preset
- WHEN the startup banner renders
- THEN the banner MUST use the selected preset palette

#### Scenario: Unsupported preset rejected or normalized

- GIVEN a user or saved file specifies an unsupported color preset
- WHEN the banner configuration is applied
- THEN the system MUST NOT use the unsupported preset
- AND the effective color preset MUST be a supported preset

### Requirement: Supported Command Namespaces

The system MUST expose banner color customization commands under both `/gentle:*` and `/gentle-ai:*` namespaces.

#### Scenario: Primary namespace commands are available

- GIVEN Gentle AI commands are registered
- WHEN the user lists or invokes banner color customization commands
- THEN `/gentle:banner-color` MUST be available

#### Scenario: Compatibility namespace commands are available

- GIVEN Gentle AI commands are registered
- WHEN the user lists or invokes banner color customization commands
- THEN `/gentle-ai:banner-color` MUST be available


### Requirement: Fast Banner Color Command

The system MUST provide a fast command for color selection without requiring users to open the main banner panel.

#### Scenario: Change color quickly

- GIVEN the user invokes `/gentle:banner-color` or `/gentle-ai:banner-color`
- WHEN the user selects a supported color preset
- THEN the selected color preset MUST be persisted globally

### Requirement: Tests and Documentation

The system MUST include test coverage and user documentation for startup banner color customization.

#### Scenario: Tests cover configuration behavior

- GIVEN the banner color configuration feature is implemented
- WHEN the test suite runs
- THEN tests MUST cover default loading, persisted preferences, invalid config fallback, supported color presets, and command registration or behavior where practical

#### Scenario: README documents commands and defaults

- GIVEN the banner color customization feature is implemented
- WHEN a user reads `README.md`
- THEN the README MUST document the supported commands, default behavior, available color presets, global persistence, and the lack of custom RGB support in this change
