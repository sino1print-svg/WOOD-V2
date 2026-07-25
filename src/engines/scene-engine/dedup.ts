/**
 * Dedup Ledger — §8.1 hard uniqueness. The Scene Engine reads `DedupLedger.seen` to
 * reject already-used `DedupSignature.hash` values (enforced during candidate
 * generation, `candidates.ts`) and returns the updated ledger after planning. This
 * module only merges; the Dedup Engine owns the ledger's persisted lifecycle.
 */
import type { DedupLedger, Sha256 } from '../../shared/domain-model';

export function extendDedupLedger(
  ledger: DedupLedger,
  newHashes: readonly Sha256[],
  combinationSpaceSize: number,
): DedupLedger {
  const merged = new Set<Sha256>([...ledger.seen, ...newHashes]);
  return Object.freeze({
    seen: Object.freeze([...merged].sort()),
    combinationSpaceSize,
  });
}
