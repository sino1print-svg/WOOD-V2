/**
 * Shared primitives — 03_DATA_MODELS_FINAL §1.2.
 * Declarative types only. No logic.
 */

/** ISO-8601 UTC, e.g. "2026-07-16T09:30:00.000Z". */
export type IsoTimestamp = string & { readonly __brand: 'IsoTimestamp' };

/** Monotonic integer schema version for a persisted aggregate. */
export type SchemaVersion = number;

/** SHA-256 hex digest used for dedup signatures and content hashing. */
export type Sha256 = string & { readonly __brand: 'Sha256' };

/** Normalized entity collection keyed by branded id. */
export type ById<Id extends string, T> = Readonly<Record<Id, T>>;

/** A hex color token, e.g. "#000000". */
export type HexColor = string & { readonly __brand: 'HexColor' };

/** Semantic version string, e.g. "1.4.0". */
export type SemVer = string & { readonly __brand: 'SemVer' };

/**
 * A dot-delimited path into the read-only EvaluationContext (§3.15).
 * Strongly distinguished from ordinary strings (§1.3).
 */
export type ContextFieldPath = string & { readonly __brand: 'ContextFieldPath' };
