# Phase 4 Corrective Audit

## Audit history

The first corrective release fixed primitive-boolean validation for `centered`, enum-member validation for `forbiddenOverlaps`, dense-array enforcement, collection bounds and several hostile-value defenses. A second independent audit then found authoritative bypasses involving ratio upper bounds, unknown profile keys, object prototypes/inherited fields and the duplicate product profile pathway.

## Second corrective implementation

- Inclusive 0..1 runtime checks for `minSizeRatio`, `centeringTolerance` and `maxShadowCoverage`.
- Exact own-property enforcement for PrintAreaProfile.
- Ordinary-object/ordinary-array prototype policy.
- Required own-property and data-descriptor enforcement.
- Shared profile validator used by both profile paths.
- Independent full validation followed by deterministic field equivalence.
- Exact-shape validation for Product, Scene surface, Observation and ResolvedConstraint objects consumed by the engine.
- No silent normalization of malformed authoritative input.

## Verification snapshot

Final release verification is recorded in `docs/PHASE4_SECOND_CORRECTIVE.md` and the external second-corrective report. The final suite contains 59 test files and 620 tests, including 12 Print Area test files and 150 Print Area tests.

`docs/spec/` remained unchanged and Phase 5 remains unimplemented.
