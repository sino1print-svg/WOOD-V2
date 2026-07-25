# Phase 4 Print Area Engine Specification Audit

Authority reviewed: `docs/spec/`, `schemas/domain.schema.json`, shared domain contracts, public engine contracts and existing failure catalog. Authoritative schemas were not modified.

## Conformance decisions

- Ratio range follows schema minimum 0 and maximum 1 exactly.
- PrintAreaProfile follows `additionalProperties: false` with an explicit allowed-key set.
- Required profile fields must be own data properties; inherited fields cannot satisfy the model.
- Accepted object policy is `Object.prototype` for objects and `Array.prototype` for arrays. Null/custom prototypes are not supported by the existing architecture and are rejected.
- Both public profile pathways remain because the existing contract contains both. Each is independently validated with the same validator and then compared for semantic equality.
- Property order is irrelevant. Equivalence does not use `JSON.stringify` or object identity.
- Invalid values are not clamped, converted, removed, defaulted or silently replaced.

## Scope and isolation

No authoritative spec file changed. The correction remains inside Phase 4 runtime validation and tests. Phase 5 and later phases are absent.
