---
name: _shared
description: Shared utilities folder using the anthropics/skills "_" convention. Should be skipped by the loader, not loaded as a skill.
---

# _shared

Convention-private folder used to hold helpers reused across skills. The
underscore prefix signals "do not treat this as a skill" — the loader
must skip it instead of validating its name.
