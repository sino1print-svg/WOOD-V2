# Phase 5 Corrective

Phase 5 remains limited to the deterministic Prompt Engine. Phase 6 and later phases are not implemented.

## Corrective scope

The corrective release addresses the independent audit findings:

- reserved prompt-section syntax and contradictory lower-precedence text are rejected before composition;
- official sections remain owned exclusively by internal builders and retain canonical order;
- every `ResolvedConstraint` element receives exact-shape runtime validation;
- the approved Phase 4 `PrintAreaProfile` rules are centralized in a shared runtime validator consumed by both engines;
- `Scene.dedupSignature` values receive complete primitive and enum validation;
- Output B validates scene, source Output A, source content hash, and artwork relationships.

## Prototype and runtime policy

Authoritative objects use `Object.prototype`; arrays use `Array.prototype`. Custom prototypes, inherited fields, accessors, symbols, cycles, sparse arrays, non-enumerable custom fields, and dangerous keys are rejected. Expected malformed input returns deterministic structured failures and does not throw.

## Prompt precedence

Official sections are generated only by trusted internal builders. Resolved descriptions and notes are data-only. Reserved section markers, XML-like section tags, markdown official headings, and contradictory requests that attempt to disable mandatory image, artwork, matching-preview, or print-area rules are rejected.

## Verification

Final command results and artifact hashes are recorded in `mockup-photoshoot-director-phase5-corrective-report.md` generated with the release artifacts. `docs/spec/` was not modified.

## Follow-up second corrective

A second independent audit identified structural prompt-control and relationship gaps. Those findings are addressed in `PHASE5_SECOND_CORRECTIVE.md` without changing authoritative specifications or beginning Phase 6.

## Third corrective continuation

The remaining semantic-paraphrase bypass was corrected by replacing free-form resolved-text pass-through with a closed-world canonical resolved-data pipeline.
