# Phase 5 Fourth Corrective

## Scope

This corrective remains limited to Phase 5. Phase 6 and later are not implemented. `docs/spec/` is unchanged.

## Root cause

The third corrective used a closed vocabulary but accepted clauses by token membership. That allowed individually permitted words to form forbidden relationships such as `decor on garment` and `garment without blank`.

## Grammar architecture

The resolved-text pipeline now parses each permitted clause into semantic entities and a predicate. A deterministic relationship matrix rejects Scene→Garment, Scene→Artwork, Scene→PrintArea, Garment→Artwork, and negated Garment→BlankState relationships. Builders receive only canonical clauses retained by this pipeline; raw resolved text is not composed.

## Determinism and safety

Parsing uses fixed Unicode normalization, fixed tokenization, fixed semantic categories, and fixed relationship rules. It does not use AI, network services, locale-sensitive APIs, randomness, time, or filesystem ordering.

## Regression coverage

Tests cover the reproduced phrases, mixed valid/conflicting prose, frozen and structured-cloned inputs, and more than 100 deterministically generated Scene→Garment relationship attacks. Prior Output A/Output B relationships and Phase 4 PrintAreaProfile validation remain covered by the existing suite.
