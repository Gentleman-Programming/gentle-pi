# Security and sanitization review

Before packaging the contribution, the current `src/phase-router.ts` was scanned for project-specific or user-specific data.

## Explicitly checked

- InnerGreen / InnerGreenLab names
- Schneider references
- TM221 / TM3DM identifiers
- local user name `alfred`
- Windows absolute drive paths

## Result

All checks above returned **0 occurrences** in `src/phase-router.ts`.

The file does contain generic controller/runtime terms such as Qwen, Ollama and token/context accounting. Those are part of the router implementation and are not InnerGreen project data.

## Deliberately excluded from this repository

- raw project logs;
- Engram observations from the private project;
- project source code;
- local model configuration files;
- credentials or API keys;
- router backup files;
- cycle-state files;
- user-specific home paths in documentation.

Validation evidence is summarized generically rather than publishing the private workload.
