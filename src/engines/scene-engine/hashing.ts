/**
 * Deterministic hashing for Scene identity (§5 Step S5). Reuses the Rule Engine's
 * canonical stable-JSON + SHA-256 primitives rather than re-implementing hashing.
 */
import { sha256Hex, stableJson } from '../rule-engine';
import type { Sha256 } from '../../shared/domain-model';

export function stableHash(value: unknown): Sha256 {
  return sha256Hex(stableJson(value)) as Sha256;
}
