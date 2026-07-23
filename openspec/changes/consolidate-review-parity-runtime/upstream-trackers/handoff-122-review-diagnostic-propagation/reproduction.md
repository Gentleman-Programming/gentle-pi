# Test-only reproduction

Use a source checkout on `fix/review-diagnostic-propagation`. These steps exercise a synthetic error only.

> **Do not replay or create a real failed START.** Do not call a review lifecycle command, inspect authority state, or use a real lineage. The regression supplies its own fake native error and temporary test directory.

## Steps

1. Confirm the source base is `v1.2.0` and the repair is present on `fix/review-diagnostic-propagation`.
2. Run only the regression:

   ```shell
   node --experimental-strip-types --test --test-name-pattern="negotiated unknown START reconciled to start without lineage exposes only sanitized diagnostics" tests/review-controller-native-routing.test.ts
   ```

3. Confirm the single selected test passes.
4. Confirm the assertions establish all of the following:
   - reconciled outcome is `native-mutation-status-reconciled`;
   - mutation outcome remains `unknown` and the next action is `start`;
   - diagnostics are scoped to `review/start` and redact the synthetic value;
   - `native_failure` is absent; and
   - raw synthetic payload text is absent.

## Expected result

The synthetic negotiated failure retains the safe diagnostic summary but cannot disclose its raw failure envelope. No real native authority, receipt, snapshot, or START result participates.
