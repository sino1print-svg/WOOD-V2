# Phase 5 Second Corrective

## Scope

This corrective release addresses only the second independent Phase 5 audit findings. Phase 6 and later phases remain unimplemented.

## Corrections

- Replaced heading-specific resolved-text checks with a deterministic structural data-clause policy. Resolved descriptive fields and custom notes reject multiline/control-block syntax, reserved delimiters, markdown/XML/JSON/YAML-like control structures, zero-width characters, bidirectional controls, Unicode-normalized reserved markers, quoted control blocks, and command/control-target combinations.
- Official sections remain owned exclusively by internal Prompt Engine composition code.
- Added a centralized relationship validator executed before prompt composition.
- Enforced `scene.outputB.sourceHash === scene.outputA.contentHash` independently from `sourceContentHash`.
- Enforced `scene.outputA.garment === product.type`, following the authoritative current domain model and existing fixtures.
- Preserved Phase 4 PrintAreaProfile validator reuse, ResolvedConstraint validation, dedupSignature validation, exact-shape checks, prototype policy, immutability, deterministic composition, and public API non-throw behavior.

## Tests

Added focused adversarial coverage for structural prompt-control attempts, Unicode/control characters, multilingual instructions, source hash relationships, product identity relationships, frozen inputs, structured clones, deterministic output, and no mutation.

## Authority and boundaries

`docs/spec/` was not modified. No Phase 6 or later implementation was added.

## Superseded resolved-text mechanism

The second corrective's structural checks remain, but its finite semantic keyword guard was insufficient. The third corrective replaces raw semantic pass-through with field-specific closed-world clause processing.
