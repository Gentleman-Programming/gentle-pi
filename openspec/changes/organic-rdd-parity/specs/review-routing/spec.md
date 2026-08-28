# Delta for Review Routing

## ADDED Requirements

### Requirement: Native lifecycle transition routing

The consuming runtime MUST route ordinary review only from the provider's current typed status and returned transition. It MUST NOT recreate removed local authorization state or infer a replacement lifecycle route.

#### Scenario: Provider transition

- GIVEN native status returns an executable or collection transition
- WHEN the controller continues review
- THEN it follows the exact provider-selected operation and arguments

#### Scenario: Recovery or hydration

- GIVEN native status discovers a recovered lineage with pending review work
- WHEN the controller receives that status
- THEN it hydrates only the required candidate view and preserves provider-selected routing

### Requirement: Informational validation and ordinary delivery

Controller VALIDATE MUST report review information without authorizing, blocking, consuming, or rewriting a later delivery command. Commit, push, pull-request, and release delivery MUST remain ordinary repository-policy operations.

#### Scenario: Informational VALIDATE

- GIVEN an explicit controller VALIDATE request
- WHEN the controller responds
- THEN it returns an informational result and invokes no delivery authorization path

#### Scenario: Later delivery

- GIVEN a prior review outcome or receipt
- WHEN a later delivery command is evaluated
- THEN the command is not decided by review mode, receipt state, or a one-shot publication authorization
