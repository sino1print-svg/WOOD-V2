// Evidence store — the verifier's only input surface.
// Review §14 (Evidence Views): reasoning context and verification evidence are
// deliberately separate. Anything an executor "concluded" is not evidence;
// only tool output admitted through the gateway is.
import { contentHash } from './canonical.mjs';

export const TRUST = Object.freeze({
  // Produced by a SINO-owned tool through the gateway.
  SINO_VERIFIED: 'SINO_VERIFIED',
  // Fetched from, or derived from, the open internet or any third party.
  // May inform reasoning; may never grant authority (review §8).
  EXTERNAL_UNTRUSTED: 'EXTERNAL_UNTRUSTED',
});

export class EvidenceStore {
  #items = new Map();

  /**
   * Admit evidence. The content hash is computed here from the payload, so a
   * caller cannot supply a hash that disagrees with what it is storing.
   */
  admit({ kind, source_tool, payload, trust_label, captured_at }) {
    if (!kind || !source_tool)
      throw new Error('EVIDENCE_INVALID: kind and source_tool are required');
    if (!Object.values(TRUST).includes(trust_label))
      throw new Error(`EVIDENCE_INVALID: bad trust_label ${trust_label}`);
    const hash = contentHash(payload ?? null);
    const item = Object.freeze({
      evidence_id: `ev_${hash.slice(0, 24)}`,
      kind: String(kind),
      source_tool: String(source_tool),
      trust_label,
      captured_at: String(captured_at || new Date().toISOString()),
      content_hash: hash,
      payload,
    });
    this.#items.set(item.evidence_id, item);
    return item;
  }

  get(id) {
    return this.#items.get(id) ?? null;
  }

  all() {
    return [...this.#items.values()];
  }

  byKind(kind) {
    return this.all().filter((x) => x.kind === kind);
  }

  kinds() {
    return [...new Set(this.all().map((x) => x.kind))].sort();
  }

  /**
   * Independent copy, payloads included. The verifier and the recovery path
   * need a store they can re-derive from without holding a reference to the
   * live one a running cycle is still writing to.
   */
  clone() {
    const next = new EvidenceStore();
    for (const item of this.all()) {
      next.admit({
        kind: item.kind,
        source_tool: item.source_tool,
        trust_label: item.trust_label,
        payload: item.payload,
        captured_at: item.captured_at,
      });
    }
    return next;
  }

  /** Evidence that may be used to authorize is only ever SINO_VERIFIED. */
  authoritative() {
    return this.all().filter((x) => x.trust_label === TRUST.SINO_VERIFIED);
  }
}
