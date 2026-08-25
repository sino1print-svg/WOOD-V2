// Flight Recorder — append-only, hash-chained execution ledger.
// Every policy decision, tool call, evidence admission and verdict lands here.
// The chain is what makes after-the-fact tampering detectable, which is what
// lets the verifier trust the trace instead of trusting the executor.
import { canonicalJson, contentHash, sha256 } from './canonical.mjs';

const GENESIS = '0'.repeat(64);

export class Ledger {
  #entries = [];
  #sealed = false;

  constructor(cycleId) {
    this.cycle_id = cycleId;
  }

  get length() {
    return this.#entries.length;
  }

  get head() {
    return this.#entries.length ? this.#entries[this.#entries.length - 1].entry_hash : GENESIS;
  }

  /**
   * Append an entry. `seq` and `prev_hash` are assigned here, never by callers,
   * so a caller cannot forge position in the chain.
   */
  append(type, payload) {
    if (this.#sealed) throw new Error('LEDGER_SEALED: cannot append after seal');
    const entry = {
      seq: this.#entries.length,
      cycle_id: this.cycle_id,
      type: String(type),
      // Monotonic logical clock; wall time is recorded separately as data, so
      // replay determinism does not depend on it.
      payload_hash: contentHash(payload ?? null),
      payload: payload ?? null,
      prev_hash: this.head,
    };
    entry.entry_hash = sha256(
      `${entry.prev_hash}${canonicalJson({ seq: entry.seq, cycle_id: entry.cycle_id, type: entry.type, payload_hash: entry.payload_hash })}`,
    );
    this.#entries.push(entry);
    return entry;
  }

  seal() {
    this.#sealed = true;
    return this.head;
  }

  entries() {
    return this.#entries.map((e) => ({ ...e }));
  }

  find(type) {
    return this.#entries.filter((e) => e.type === type).map((e) => ({ ...e }));
  }

  /**
   * Independently recompute the chain. Returns the first inconsistency found.
   * Used by the verifier; a broken chain is an automatic FAIL.
   */
  static verifyChain(entries) {
    let prev = GENESIS;
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      if (e.seq !== i) return { ok: false, reason: `SEQ_MISMATCH at index ${i}` };
      if (e.prev_hash !== prev) return { ok: false, reason: `PREV_HASH_MISMATCH at seq ${e.seq}` };
      if (e.payload_hash !== contentHash(e.payload ?? null))
        return { ok: false, reason: `PAYLOAD_TAMPERED at seq ${e.seq}` };
      const expected = sha256(
        `${e.prev_hash}${canonicalJson({ seq: e.seq, cycle_id: e.cycle_id, type: e.type, payload_hash: e.payload_hash })}`,
      );
      if (e.entry_hash !== expected)
        return { ok: false, reason: `ENTRY_HASH_MISMATCH at seq ${e.seq}` };
      prev = e.entry_hash;
    }
    return { ok: true, head: prev, count: entries.length };
  }
}
