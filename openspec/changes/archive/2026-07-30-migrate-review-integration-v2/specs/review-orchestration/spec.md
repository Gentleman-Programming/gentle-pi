# Delta for Review Orchestration

## ADDED Requirements

### Requirement: Frozen candidate-tree binding for reviewer dispatch

Reviewer dispatch MUST bind to the provider-issued `artifact_subject`, `base_tree`, `candidate_tree`, and ordered `changed_path_manifest` from `next_transition.collect.inputs[]`, comparing the materialized candidate view field-wise (`status`, `old_mode`, `new_mode`, `deleted`, `type_changed`, `mode_only`, `intended_untracked`) rather than by sorted path-set equality. Lens agents MUST receive no shell/Bash tool and MUST reach the candidate only through `Read` against a chmod-read-only worktree. A materialized `candidate_tree` that diverges from the provider's frozen tree between START and dispatch MUST fail closed rather than expose a substituted view.

#### Scenario: Matching manifest dispatches normally

- GIVEN a materialized candidate view whose fields exactly match the provider's frozen `changed_path_manifest`
- WHEN reviewer dispatch runs
- THEN lens agents receive the read-only worktree and inspection proceeds

#### Scenario: Mode-only or type-change divergence rejected

- GIVEN the provider's frozen manifest and Pi's materialized candidate diverge only in `old_mode`/`new_mode`, `type_changed`, or `mode_only`
- WHEN the candidate view is validated before dispatch
- THEN dispatch MUST be rejected even though sorted paths are identical

#### Scenario: No-shell dispatch

- GIVEN a review dispatch to lens sub-agents
- WHEN tools are granted
- THEN no shell or Bash tool is available and the candidate is reachable only via `Read`

#### Scenario: Tree divergence between START and dispatch

- GIVEN a contributor edit lands after START and before dispatch, changing the materialized `candidate_tree`
- WHEN dispatch validates the candidate against the provider's frozen `candidate_tree`
- THEN dispatch fails closed and no substituted view is exposed to lens agents
