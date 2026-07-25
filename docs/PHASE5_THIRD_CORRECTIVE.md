# Phase 5 Third Corrective

## Status

Phase 5 corrective implementation only. Phase 6 and later remain unimplemented.

## Independent finding addressed

The second corrective still allowed semantically contradictory resolved prose when it avoided a finite directive/target blacklist. Such prose could survive inside the trusted Scene section and conflict with one-image and artwork-lock clauses.

## Root cause

Resolved strings were validated as free-form natural-language command text. Structural delimiter checks were strong, but semantic precedence still depended on recognized verbs and control nouns.

## Corrective architecture

A centralized `resolved-text.ts` pipeline now runs before composition:

1. runtime string validation;
2. deterministic NFKC and line-ending handling;
3. structural/control-marker rejection;
4. closed-world field-specific descriptive grammar;
5. clause-level retention of permitted descriptive clauses;
6. deterministic serialization;
7. opaque UTF-8 hex encoding for optional custom-note data.

Unknown semantic clauses are not passed through. Mixed values retain only clauses representable by the field's permitted descriptive grammar. The composer receives only the canonical result and never interpolates a raw resolved field directly.

## Preserved behavior

- Phase 4 PrintAreaProfile runtime validator reuse;
- ResolvedConstraint validation;
- dedupSignature validation;
- Output A garment relationship validation;
- Output B sourceHash/sourceContentHash relationships;
- deterministic canonical section ordering;
- immutable frozen and cloned input processing;
- engine isolation.

## Testing

Two official test files were added. They cover the four reproduced bypasses, more than fifty semantic paraphrases, passive and nominal forms, Arabic/French/Spanish variants, fragments, mixed valid/conflicting clauses, raw-text isolation, relationship regressions, and Phase 4 obstruction validation.

A separate temporary independent audit executed 56 additional paraphrases and was deleted before packaging.

`docs/spec/` was not modified.
