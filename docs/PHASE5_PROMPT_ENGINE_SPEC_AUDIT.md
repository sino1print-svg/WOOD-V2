# Phase 5 Prompt Engine Specification Audit

Implementation was reviewed against the authoritative files under `docs/spec/`, particularly the data model, architecture, Prompt Engine specification, workflow, test plan, and implementation guide. The authoritative files were read but not changed.

The implementation maps the one-prompt/one-image invariant, fixed module order, Output A blank requirements, Output B source-image and PNG locks, print-area priority, deterministic formatting, immutable processing, and structured blocking failures. The corrective validation closes the resolved-text, constraint-element, profile, dedup-signature, and Output B relationship defects found by independent audit.

## Second corrective mapping

- Prompt precedence: resolved text is restricted to single-clause descriptive data and cannot contain structural prompt control syntax.
- Trusted section ownership: only internal builders emit canonical section headers.
- Output B staleness/source relationship: `sourceHash` and `sourceContentHash` are independently checked against `OutputA.contentHash`.
- Product relationship: `OutputA.garment` is checked against `Product.type` under the current authoritative domain model.

## Third corrective mapping

- Spec §2.3 drop-not-override precedence: implemented through clause-level closed-world canonicalization.
- Spec §2.4 pure deterministic substitution: composer consumes only canonical resolved values.
- Spec §3 one-prompt/one-image: semantic cardinality clauses cannot enter trusted sections.
- Spec §5 artwork authority: artwork-substitution and scene-to-artwork clauses cannot enter trusted sections.
- Authority files in `docs/spec/`: unchanged.
