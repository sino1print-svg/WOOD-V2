# Phase 4 — Print Area Engine

Status: Second corrective release ready for independent audit.

The engine is a pure deterministic measurement adapter. It validates the complete runtime boundary before reading authoritative values, then returns canonical overlap ordering and immutable measurement data. It does not evaluate Rule Engine constraints and does not depend on Palette, GarmentColor, Scene Engine implementation, Prompt, Cover, Export or UI engines.

## Authoritative profile validation

One reusable validator is applied independently to `input.profile` and `product.printAreaProfile`. It enforces:

- exact own keys: id, position, minSizeRatio, centeringTolerance, centered, maxShadowCoverage, forbiddenOverlaps;
- ordinary object prototype only;
- own enumerable data properties only;
- no symbols, accessors, unsafe keys or inherited required values;
- primitive booleans for centered;
- primitive finite ratios in inclusive range 0..1;
- dense bounded obstruction arrays containing authoritative enum values only.

After both profiles pass, field-by-field equivalence is required. Object identity and JSON serialization are not used.

## Security and determinism

The public boundary rejects arbitrary prototypes, class instances, boxed primitives, cycles, sparse arrays, excessive depth/collection sizes, non-index array keys and enumerable prototype pollution. Failures use existing deterministic Phase 4 contracts. Inputs are never mutated, repaired, stripped, coerced or defaulted.

Phase 5 remains unimplemented.
