# Phase 5 Fifth Corrective

## Scope

This corrective uses the Phase 5 Fourth Corrective repository as its exact baseline. It changes only Phase 5 Prompt Engine implementation, tests, and non-authoritative Phase 5 documentation. `docs/spec/` is unchanged. Phase 6 and later remain unimplemented.

## Independent audit findings

The fifth audit identified two remaining open-world paths in resolved-text processing:

1. unclassified clauses fell back to an `unknown/describes/unknown` descriptive relationship;
2. blank-state negation using `no` was not represented by the closed blank-state grammar.

This allowed unsupported clauses such as `decor through garment` and `garment no blank` to survive.

## Correction

The permissive descriptive fallback was removed. Relationship parsing now returns only:

- an explicitly allowed relationship;
- an explicitly conflicting relationship; or
- an ambiguous relationship.

Ambiguous and unknown cross-domain relationships are rejected. The relationship matrix contains one permitted Scene-to-Garment relationship family: safe spatial references using `behind`, `beside`, or `near`. Unsupported predicates such as `through`, `into`, and `in` have no matrix entry and fail closed.

The blank-state grammar now includes `no` and rejects every recognized negative blank assertion. Product descriptions may affirm a blank garment, but artwork presence and semantic negation of blank state are rejected.

## Regression coverage

`test/prompt-engine/fifth-corrective-closed-world.test.ts` covers:

- historical unsupported Scene-to-Garment clauses;
- reverse Garment-to-Scene clauses;
- Scene-to-Artwork and Artwork-to-Scene clauses;
- `garment no blank` and other blank-sale contradictions;
- explicitly allowed safe spatial scene references;
- frozen inputs, structured clones, determinism, and immutability.

All earlier Phase 5 and Phase 0–4 tests remain present.
