# Delta for Review Transaction

## MODIFIED Requirements

### Requirement: Negotiated native ordinary authority

The consumer MUST resolve the integrity-verified package-local Gentle AI v2.2.1 executable, independently hash it, negotiate `gentle-ai.review-integration/v2` outside repository context, and cache capabilities only by that digest. Capabilities, START (`start/v3`), target status (`status/v3`), FINALIZE, validation, bind-sdd, and repair (`repair/v2`) MUST pass the same v2 contract identifier; consent (`consent/v2`) and failure (`failure/v2`) envelopes MUST decode under the same identity. Native compact-v2 MUST be the sole mutable ordinary authority; legacy-v1 and Pi authority remain compatibility-read-only. No `gentle-ai.review-integration/v1` identity MAY remain in `lib/`, `runtime/`, or `tests/`; v1 contract schemas stay on disk only as `$ref` targets for v2 schemas. Unknown mandatory behavior, incompatible protocol/schema identity, or executable drift MUST fail closed, naming the expected pinned version in the failure. Advertised optional additions MAY be ignored without disabling mandatory operations. A test asserting binary-dependent negotiation MUST fail, not silently skip, when the pinned binary is unexpectedly absent.
(Previously: pinned v2.1.11, `gentle-ai.review-integration/v1`, five call sites with no `consent`/`repair` decoders.)

#### Scenario: Explicit v2.2.1 maintenance

- GIVEN a caller supplies one published maintenance operation and its exact binding inputs
- WHEN Pi invokes abandon, quarantine-legacy, reconciliation, or repair-legacy-alias
- THEN Pi requires fresh interactive approval, forwards shell-free exact argv, preserves a native audit record only from a valid response envelope, derives repair repository/revision/diagnostic/disposition from fresh native inventory, and keeps dispose-result unsupported pending design

#### Scenario: Target-scoped restart

- GIVEN a fresh Pi process and existing native authority
- WHEN target status returns a Git/content projection
- THEN Pi reconstructs only its derived candidate view without reading provider-private authority files or selecting a lineage

#### Scenario: Native failure truth

- GIVEN a negotiated mutating operation fails or loses output
- WHEN Pi reconciles an unknown result
- THEN Pi calls target-scoped native status first, preserves the exact failure and status evidence, follows only the provider-declared action, and replays only when native declares the exact request safe

#### Scenario: v2 identity at every call site

- GIVEN Pi negotiates against the pinned v2.2.1 provider
- WHEN capabilities, start, status, finalize, validate, bind-sdd, and repair execute
- THEN every call site pins `gentle-ai.review-integration/v2`, decodes `start/v3`, `status/v3`, `consent/v2`, `failure/v2`, `operation/v2`, `repair/v2`, and no v1 identity remains in `lib/`, `runtime/`, or `tests/`

#### Scenario: Half-upgraded install fails hard

- GIVEN `.gentle-ai/` holds only pre-v2.2.1 runtimes
- WHEN Pi resolves the pinned executable
- THEN negotiation fails hard, naming the expected v2.2.1 version, rather than degrading to an older runtime

#### Scenario: Loud skip on missing binary

- GIVEN the pinned binary is not installed locally
- WHEN a binary-dependent negotiation test suite runs
- THEN the suite fails instead of self-skipping green
