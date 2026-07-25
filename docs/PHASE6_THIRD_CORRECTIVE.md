# Phase 6 Third Corrective

## Scope

This corrective is limited to the Phase 6 UI Engine hostile-runtime validation boundary. Phase 7 remains unstarted.

## Root causes corrected

1. Exact-shape checks used `Object.keys()`, which omitted symbol and non-enumerable own keys.
2. Validators read fields directly and therefore accepted and executed accessors.
3. Reflective Proxy traps and ownership cloning failures could escape instead of becoming typed UI failures.

## Hostile-safe inspection design

`src/ui-engine/safe-runtime.ts` centralizes runtime inspection. It retrieves prototypes, complete own-key sets, and property descriptors under fail-closed exception handling. Required fields must be own data descriptors. Symbols, unknown keys, accessors, changing keys, changing descriptors, non-canonical arrays, sparse arrays, subclassed arrays, and hostile reflective operations are rejected.

Validation reads only descriptor values and never evaluates getters or setters. Own keys and descriptors are checked twice to detect unstable Proxy behavior.

## Scene and Prompt validation

`src/ui-engine/generated-validation.ts` now recursively applies the shared inspection primitive to Scene, deduplication signatures, Output A, Output B, Prompt values, prompt metadata, and all authoritative arrays. Validation occurs before ownership conversion. Accepted collections are defensively cloned and deeply frozen. Clone failure produces `INVALID_SCENE_RESULT` or `INVALID_PROMPT_RESULT`.

## Persistence boundary

`src/ui-engine/runtime-validation.ts` now applies the same exact descriptor-aware model to persisted state, draft, products, failures, Scene collections, and Prompt collections.

## Controller boundary

`UiController.generate()` converts hostile runtime processing exceptions at the Scene or Prompt boundary into deterministic typed failures. Invalid Scene data cannot call PromptPort. Invalid Prompt data cannot reach `prompts-ready`.

## Permanent regression coverage

`test/ui-engine/third-corrective-hostile-runtime.test.ts` adds 106 permanent tests covering symbol keys, non-enumerable properties, accessors without execution, inherited fields, class instances, boxed primitives, hostile arrays, Proxy traps, ownership, clone failure, controller typed failures, and immutability.

A separate temporary adversarial suite executed 360 cases and passed. The temporary file was deleted before final verification.

## Source-tree hashing

Run:

```bash
npm run hash:source-tree
```

Algorithm:

1. Root is the repository root and is not included as a path component.
2. Recursively include regular files only.
3. Exclude `node_modules`, `dist`, `coverage`, `.git`, `.cache`, `cache`, and `logs` directories.
4. Exclude ZIP files, log files, OS metadata, temporary audit files, and audit scratch files.
5. Normalize relative paths to `/` separators.
6. Sort normalized UTF-8 path bytes lexicographically.
7. Hash each UTF-8 path, one NUL byte, exact file bytes, and one NUL byte.
8. Preserve file bytes exactly; no line-ending conversion occurs.
9. Generated build output is excluded.

## Phase boundary

`docs/spec/` was not modified. No Cover Engine, Export Engine, ZIP export, publishing, upload, marketplace, or image-generation functionality was implemented. Phase 7 remains unstarted.
