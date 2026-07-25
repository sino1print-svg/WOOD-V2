# Phase 4 Second Corrective

Status: Ready for independent audit. Phase 5 remains unimplemented.

## Second audit findings corrected

The second adversarial audit identified four runtime-validation defects: unit-ratio fields accepted values above 1, unknown PrintAreaProfile properties were ignored, arbitrary/inherited prototypes were accepted, and product.printAreaProfile was validated only by identifier.

## Runtime policy

The Print Area public boundary accepts ordinary objects using `Object.prototype` and ordinary arrays using `Array.prototype`. Null-prototype objects, custom prototypes, class instances, boxed primitives, inherited enumerable properties, accessors, symbols, unsafe own keys, cycles, sparse arrays and oversized arrays are rejected before authoritative values are read.

PrintAreaProfile required fields must be own enumerable data properties. Its exact property set is enforced from the authoritative domain model and schema. All three ratio fields use the inclusive range 0..1 without coercion, clamping, percentage conversion, defaulting or repair.

Both `input.profile` and `product.printAreaProfile` invoke the same reusable runtime validator. After independent validation, the two profiles must be canonically equivalent field-by-field; identifier-only matching is insufficient.

## Structured failures

Existing Phase 4 failure codes remain in use. Diagnostics identify specific paths where safe and supported, including ratio fields, unknown profile properties, and nested product profile fields. Expected malformed input is returned as a deterministic failure result and is not thrown.

## Tests

The corrective suite adds ratio-boundary matrices, exact-shape checks, own-property/prototype attacks, duplicate-profile pathway tests and public-API adversarial regressions. Existing centered, forbiddenOverlaps, sparse-array, collection-bound, getter, symbol, cycle, immutability, determinism and isolation tests remain.

## Scope controls

- `docs/spec/` changed files: 0.
- No Phase 5 or later engine was implemented.
- No safe-area rectangles, coordinates, DPI, unit conversion, artwork scaling, placement defaults, registries, Scene/Prompt/Cover/Export/UI logic were added.
