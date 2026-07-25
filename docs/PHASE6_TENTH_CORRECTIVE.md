# Phase 6 Tenth Corrective

## Scope

This corrective is limited to independent-audit finding `P6-N9-AUD-001`. Phase 7 remains
unstarted, and `docs/spec/` is unchanged.

## Root cause

`UiController.generate()` invoked caller-controlled `GenerationOwnership.publishPending` before
entering its defensive boundary. Other `publishPending` and `getCurrentState` calls also lacked a
single typed, fail-closed boundary, and the exception handler could call `getCurrentState` again
without protection.

## Corrective implementation

- `UiController.generate()` enters the in-flight and defensive boundary before the first ownership
  callback.
- Every `publishPending` and `getCurrentState` call passes through guarded helpers.
- States returned by `getCurrentState` are runtime-validated and defensively owned before any
  authoritative field access or transition.
- A last trusted state is retained so a hostile callback cannot escape through the error path.
- Ownership failures resolve as typed `UI_GENERATION_OWNERSHIP_INVALID` UI states, clear active
  ownership, and leave the controller reusable.
- Runtime state validation permits only the structurally valid incomplete `idle`/`session` state
  needed by Reset; persisted-state validation remains strict.

## Permanent regression coverage

`test/ui-engine/tenth-corrective-generation-ownership.test.ts` covers:

1. throwing initial `publishPending`;
2. hostile accessor lookup for `publishPending`;
3. throwing `getCurrentState`;
4. accessor-backed state returned by `getCurrentState` without getter execution;
5. hostile Proxy returned by `getCurrentState`;
6. throwing second `publishPending` before PromptPort invocation;
7. successful valid generation recovery on the same controller after every failure case.

## Verification

- 85 test files passed.
- 1,196 tests passed with no failures or skips.
- Typecheck, lint, Prettier check, deterministic build verification, production build, `verify`, and
  `verify:full` passed.
- Direct full and production npm audits reported zero vulnerabilities.
