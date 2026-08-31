# Spec — review-git-env: sanitize scoped config, keep fail-closed on routing keys

## Context

`lib/review-repository.ts` `reviewGitEnvironment()` fails closed (`REVIEW_GIT_ENV_UNSAFE`) on ANY inherited `GIT_*` environment key, including modern scoped-config keys (`GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`). Agent harnesses commonly export these (e.g. `GIT_CONFIG_COUNT=2`, `credential.interactive=false`) to disable interactive credential prompts. On such machines — including this maintainer's — every local review-authority probe throws, so the entire review lifecycle is unusable locally. Evidence: 3 of the audit's failing batches traced to exactly this (>24 git-output/lock/latch tests failed until the TEST process env was scrubbed; the production guard is the same trigger). The companion `publicationProbeGitEnvironment()` already deletes these keys instead of throwing — the sanitize behavior exists in-tree.

## Acceptance criteria

- AC1: `reviewGitEnvironment()` no longer throws for inherited scoped-config keys (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_*`, `GIT_CONFIG_VALUE_*`); it silently strips them (matching `publicationProbeGitEnvironment` behavior) and continues.
- AC2: Fail-closed remains for true routing keys: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`, `GIT_QUARANTINE_PATH`, `GIT_CONFIG`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`, `GIT_REPLACE_REF_BASE`, `GIT_NO_REPLACE_OBJECTS`, `GIT_SHALLOW_FILE`, `GIT_GRAFT_FILE` — any of these still throws `REVIEW_GIT_ENV_UNSAFE`.
- AC3: A unit test proves AC1 (ambient env with `GIT_CONFIG_COUNT=2` + scoped credential keys no longer throws and yields the sanitized env) and AC2 (a routing key still throws), runnable on POSIX and Windows.
- AC4: With AC1–AC3, `tests/review-consent-latch.test.ts` and `tests/review-repository.test.ts` pass WITHOUT the test-side `scrubInheritedGitEnvironment()` call being required (the scrub may stay as belt-and-braces, but the production guard must no longer be the reason tests need it).
- AC5: No review evidencable behavior weakens: sanitized envs are still config-neutral (global/system config → NUL//dev/null), `GIT_OPTIONAL_LOCKS=0`, `LC_ALL`/`LANG = C`.

## Non-constraints

- Keep the throw contract for routing keys byte-identical in message; only scoped-config keys move from throw → strip.
- This is a product fix (Change B); test-infra scrubs from Change A remain.