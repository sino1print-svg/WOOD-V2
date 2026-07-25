# Phase 6 — Second Corrective

## Scope

This corrective closes the two independently reproduced Phase 6 runtime-integrity defects only. Phase 7 remains unimplemented.

## Root causes corrected

1. Successful ScenePort and PromptPort payloads were trusted as typed values and copied into UI state without closed-world runtime validation.
2. Generation-success transition events carried caller-supplied complete UiState objects, allowing state replacement through completion events.

## Runtime-result validation

`src/ui-engine/generated-validation.ts` is the UI boundary's single public generated-result validation surface. It validates complete dense Scene and Prompt collections, exact nested shapes, enum values, duplicate IDs, Output A/B relationships, source hashes, content hashes, product/color/view/print-area identity, prompt text/hash identity, required pair membership, and unknown properties.

The controller validates Scene results before PromptPort invocation and validates Prompt results against the authoritative validated Scene collection before any completion transition.

Malformed successful port payloads produce typed failures (`INVALID_SCENE_RESULT`, `INVALID_SCENE_RELATIONSHIP`, `INVALID_PROMPT_RESULT`, or `INVALID_PROMPT_RELATIONSHIP`) and cannot reach generated-success phases.

## Narrow completion events

`SCENE_GENERATION_SUCCEEDED` and `PROMPT_GENERATION_SUCCEEDED` now carry only validated collections, request sequence, and generation fingerprint. `transitionUiState()` constructs all authoritative state fields internally and verifies request ownership and fingerprints.

No generation-success event carries `UiState`.

## Safe restore

Persistence validation returns a runtime-marked `ValidatedRestoredUiState`. A private WeakSet registry prevents caller-created UiState objects from entering through `SESSION_RESTORED`. Restore still passes the complete invariant validator.

## Unified invariants

`validateUiStateInvariant()` invokes the same generated collection validators used by the controller and persistence parser. Persistence parsing also performs exact top-level/draft validation before invoking the shared generated validators and state invariants.

## Tests

Permanent corrective tests cover malformed Scene results, malformed Prompt results, relationship forgery, duplicate identifiers, unknown fields, exact prompt preservation, deep-frozen values, narrow completion events, request/fingerprint mismatch, complete-state injection rejection, and validated restore.

A temporary independent adversarial suite executed 350 cases and passed. The temporary file was deleted before final verification and packaging.

## Integrity

No file under `docs/spec/` was modified. No Phase 7 Cover Engine, Export Engine, image export, ZIP export, publishing, upload, or image-generation integration was implemented.
