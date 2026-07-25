# Phase 6 Eleventh Corrective

## Scope

This corrective is limited to finding `P6-N10-AUD-001`. It uses the delivered Phase 6 Tenth
Corrective tree as its baseline, does not implement Phase 7, and does not change `docs/spec/`.

## Root cause

The Tenth Corrective protected synchronous ownership callback access and invocation, but it did not
settle or validate the runtime value returned by `publishPending`. A rejected Promise could
therefore be ignored while generation continued. If a callback first changed authoritative state
and then threw or rejected, the caller-owned state could remain pending with an active sequence
even though the controller returned a local typed failure.

## Ownership publication boundary

`GenerationOwnership.publishPending` and the mandatory reconciliation callback
`GenerationOwnership.publishFailure` accept synchronous `undefined` or asynchronous `Promise<void>`
completion. The controller uses one protected runtime publication boundary for both callbacks. That
boundary protects property access and invocation, normalizes native Promises and thenables, fully
consumes settlement, requires an `undefined` fulfillment value, and classifies any other runtime
return or failure without allowing a raw rejection to escape.

Every successful pending publication is immediately followed by a protected `getCurrentState`
read. The returned value must pass the existing descriptor-aware, closed-world runtime validator and
must match the intended state exactly before ScenePort or PromptPort can continue.

## Primary failure and reconciliation

The first ownership boundary that terminates generation remains the Primary Failure and determines
the returned typed field. A secondary failure in `publishFailure` or the verification read is
recorded only in the internal reconciliation outcome and never replaces that Primary Failure.

The controller constructs a safe failure state with `phase: invalid`, `step: validation`, an empty
prompt collection, `persisted: false`, and `activeRequestSequence: null`. It then makes exactly one
`publishFailure` attempt. Authoritative reconciliation is successful only when the callback settles
successfully and a protected, runtime-validated `getCurrentState` returns an exact match for that
failure state. No recursive reconciliation or fallback to `publishPending` occurs.

When reconciliation succeeds, direct retry from the actual external authoritative failure state is
supported and advances sequence ownership normally. When reconciliation or its verification fails,
only controller recovery is guaranteed: the typed Primary Failure is returned, `inFlight` is
released, no generation continuation occurs, and the same controller can process a later valid
request supplied with functioning ownership boundaries. External authoritative-state repair is not
claimed in that degraded case.

## Safety guarantees

- Initial publication failure occurs before ScenePort; second publication failure occurs before
  PromptPort.
- A post-PromptPort authoritative-read failure cannot return `prompts-ready` or publish prompts.
- Failure publication is bounded to one attempt and does not recurse.
- Rejections and hostile thenable settlements are consumed inside the callback boundary.
- Pending and failure states are controller-owned, runtime-validated immutable values.
- Ownership failure states expose no successful prompt output, remain unpersisted, and clear active
  sequence ownership.
- Existing sequence, fingerprint, delayed-reset, stale-request, and valid-state identity behavior is
  preserved.
- The existing persistence implementation and ports are unchanged.

## Files changed

- `src/ui-engine/controller.ts`
- `test/ui-engine/first-corrective-controller.test.ts` (mandatory callback adapter only; existing
  cases and assertions unchanged)
- `test/ui-engine/tenth-corrective-generation-ownership.test.ts` (mandatory callback adapter only;
  existing cases and assertions unchanged)
- `test/ui-engine/eleventh-corrective-ownership-reconciliation.test.ts`
- `vitest.config.ts` (includes the existing `.test.tsx` security suite so no test file is disabled)
- `docs/PHASE6_ELEVENTH_CORRECTIVE.md`

## Permanent regression coverage

The Eleventh Corrective test file exercises initial and second synchronous throws, asynchronous
rejections, mutate-then-throw, mutate-then-reject, delayed settlement, hostile then accessors and
functions, deterministic first settlement, malformed returns, protected callback properties,
reconciliation callback failures, post-reconciliation state verification, initial and later
authoritative-state mismatch, post-PromptPort read failure, immutable publication states, no
unhandled rejection, direct authoritative retry, and later same-controller recovery after failed
reconciliation.

## Verification

All mandatory commands completed with exit code `0` on the final implementation tree:

| Command                                                              | Result                                      |
| -------------------------------------------------------------------- | ------------------------------------------- |
| `NPM_CONFIG_CACHE=/workspace/scratch/cfed1a17818b/.npm-cache npm ci` | 251 packages installed from the lockfile    |
| `npm audit`                                                          | 0 vulnerabilities                           |
| `npm audit --omit=dev`                                               | 0 vulnerabilities                           |
| `npm run typecheck`                                                  | Passed                                      |
| `npm run lint`                                                       | Passed with zero warnings                   |
| `npm run format:check`                                               | Passed                                      |
| `npm run test`                                                       | 87 files; 1,253 passed; 0 failed; 0 skipped |
| `npm run verify:determinism`                                         | Identical four-file build list and hashes   |
| `npm run build`                                                      | Passed; 52 modules transformed              |
| `npm run verify`                                                     | Passed                                      |
| `npm run verify:full`                                                | Passed, including both audit modes          |

Source-tree and delivery ZIP integrity values are recorded in the external
`mockup-photoshoot-director-phase6-eleventh-corrective-implementation-report.md`.

This implementation evidence does not approve Phase 6. Independent audit is still required, and
Phase 7 has not started.
