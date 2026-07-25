# Phase 6 First Corrective

## Scope

This corrective release addresses the four independently reproduced Phase 6 blockers without beginning Phase 7 and without changing `docs/spec/`.

## Root causes and corrections

1. **Persisted-state validation** — the shallow `parseUiState()` cast was replaced by closed-world runtime validation in `src/ui-engine/runtime-validation.ts`. The validator checks exact shapes, nested draft data, scenes, prompts, failures, IDs, enums, counts, duplicates, phase/step invariants, fingerprints, request sequences, selected output references, and Output A/B relationships.
2. **Workflow transitions** — unrestricted `setStep()` was removed. `transitionUiState(state, event)` now applies a typed event matrix and runs the shared `validateUiStateInvariant()` before accepting a state.
3. **Authoritative engine pipeline** — `ResolvedUiGenerationPlan` preserves validated draft data and the exact Rule, Palette, and Print-Area results. `ScenePort.generate()` accepts the resolved plan, and `PromptPort.generate()` receives the authoritative scenes and the same plan.
4. **Asynchronous request ownership** — generation accepts a `GenerationOwnership` boundary that publishes pending state and reads the current authoritative state. Scene and prompt completions verify request sequence, active ownership, phase, and generation fingerprint before returning a committable result. Reset, restore, new-session, or generation-affecting edits invalidate obsolete completions.

## Regression coverage

Permanent Phase 6 tests cover corrupt persistence records, forged A/B links and hashes, duplicate IDs, invalid workflow states, transition rejection, authoritative payload forwarding, failure short-circuiting, reset/restore races, and presentation-only state replacement.

A temporary independent audit executed 220 corrupt persisted-state cases plus independent transition attacks. It passed and the temporary test file was deleted.

## Boundaries

- `docs/spec/` was not modified.
- Existing approved tests were retained.
- No Cover Engine, Export Engine, image export, ZIP export, marketplace publishing, upload, or image-generation integration was implemented.
- Phase 7 remains unstarted.
