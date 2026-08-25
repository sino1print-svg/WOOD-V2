// Knitwear Radar Tool Adapter.
// Knitwear Radar enters SINO as an intelligence SERVICE behind its own HTTP
// contract (review §9). No Knitwear Radar logic is copied here — this file
// only translates SINO Tool Contracts onto its published API.
//
// Secret isolation: the operator key is held here, inside the adapter. It is
// never placed in a cycle contract, an evidence payload, or a ledger entry, so
// no executor can read or forward it.
import { TRUST } from '../kernel/evidence.mjs';

const READ = {
  capability: 'read',
  risk_class: 'LOW',
  trust_label: TRUST.SINO_VERIFIED,
  cost_units: 1,
};

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl  Knitwear Radar origin, e.g. http://127.0.0.1:8787
 * @param {string} [opts.operatorKey] Required only for write/sync tools.
 * @param {Function} [opts.fetchImpl] Injected for hermetic testing.
 */
export function createKnitwearRadarTools({
  baseUrl,
  operatorKey = '',
  fetchImpl = fetch,
  timeoutMs = 8000,
}) {
  if (!isNonEmptyString(baseUrl)) throw new Error('ADAPTER_INVALID: baseUrl is required');
  const origin = baseUrl.replace(/\/+$/, '');

  async function request(path, { method = 'GET', body = null, privileged = false } = {}) {
    const headers = { accept: 'application/json' };
    if (privileged) {
      if (!isNonEmptyString(operatorKey))
        throw new Error('ADAPTER_NOT_CONFIGURED: operator key required for this tool');
      headers['x-api-key'] = operatorKey;
    }
    if (body) headers['content-type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${origin}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`UPSTREAM_NON_JSON: HTTP ${res.status}`);
      }
      if (!res.ok || parsed.ok === false) {
        throw new Error(
          `UPSTREAM_ERROR ${res.status}: ${parsed?.error?.code || parsed?.error?.message || 'unknown'}`,
        );
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  return [
    {
      tool_id: 'knitwear_radar.opportunities',
      version: '0.21.0',
      description: 'Ranked knitwear trend opportunities from the last verified sync snapshot.',
      required_scopes: ['knitwear.read'],
      evidence_kind: 'trend_opportunities',
      ...READ,
      validate_input(input = {}) {
        const errors = [];
        if (
          input.decision !== undefined &&
          !['CREATE NOW', 'WATCH', 'SATURATED', 'AVOID'].includes(input.decision)
        ) {
          errors.push('decision must be one of CREATE NOW | WATCH | SATURATED | AVOID');
        }
        if (
          input.limit !== undefined &&
          (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
        ) {
          errors.push('limit must be an integer in 1..100');
        }
        return errors.length ? { ok: false, errors } : { ok: true };
      },
      async invoke(input = {}) {
        const qs = new URLSearchParams();
        if (input.decision) qs.set('decision', input.decision);
        qs.set('limit', String(input.limit ?? 25));
        const out = await request(`/v1/opportunities?${qs.toString()}`);
        return {
          fetched_at: out.fetched_at ?? null,
          count: out.count ?? 0,
          clusters: (out.clusters || []).map((c) => ({
            id: c.id,
            semantic_trend_id: c.semantic_trend_id ?? null,
            name: c.name,
            score: c.score,
            growth: c.growth,
            example_count: c.example_count,
            source_count: c.source_count,
            momentum_state: c.momentum?.state ?? null,
            opportunity: c.opportunity ?? null,
            trend_truth: c.trend_truth ?? null,
          })),
        };
      },
    },
    {
      tool_id: 'knitwear_radar.trend_dna',
      version: '0.21.0',
      description: 'Trend DNA 2.0 for one trend cluster.',
      required_scopes: ['knitwear.read'],
      evidence_kind: 'trend_dna',
      ...READ,
      validate_input(input = {}) {
        return isNonEmptyString(input.trend_id)
          ? { ok: true }
          : { ok: false, errors: ['trend_id is required'] };
      },
      async invoke(input) {
        const out = await request(`/v1/trends/${encodeURIComponent(input.trend_id)}/dna`);
        return { trend_id: out.trend_id, trend_dna: out.trend_dna ?? null };
      },
    },
    {
      tool_id: 'knitwear_radar.concepts',
      version: '0.21.0',
      description: 'Five deterministic source-independent design directions for one trend.',
      required_scopes: ['knitwear.read'],
      evidence_kind: 'design_concepts',
      ...READ,
      validate_input(input = {}) {
        return isNonEmptyString(input.trend_id)
          ? { ok: true }
          : { ok: false, errors: ['trend_id is required'] };
      },
      async invoke(input) {
        const out = await request(`/v1/trends/${encodeURIComponent(input.trend_id)}/concepts`);
        return { trend_id: out.trend_id, concept_engine: out.concept_engine ?? null };
      },
    },
    {
      tool_id: 'knitwear_radar.brief',
      version: '0.21.0',
      description: 'Structured Design Brief 1.0 for one concept index (0..4).',
      required_scopes: ['knitwear.read'],
      evidence_kind: 'design_brief',
      ...READ,
      validate_input(input = {}) {
        const errors = [];
        if (!isNonEmptyString(input.trend_id)) errors.push('trend_id is required');
        if (!Number.isSafeInteger(input.concept) || input.concept < 0 || input.concept > 4) {
          errors.push('concept must be an integer in 0..4');
        }
        return errors.length ? { ok: false, errors } : { ok: true };
      },
      async invoke(input) {
        const out = await request(
          `/v1/trends/${encodeURIComponent(input.trend_id)}/brief?concept=${encodeURIComponent(String(input.concept))}`,
        );
        return { trend_id: out.trend_id, concept_index: input.concept, brief: out.brief ?? null };
      },
    },
    {
      // Write-class tool: mutates the Radar's persisted snapshot and history.
      tool_id: 'knitwear_radar.global_import',
      version: '0.21.0',
      description:
        'Import normalized knitwear observations into the Radar (mutates snapshot + history).',
      required_scopes: ['knitwear.read', 'knitwear.write'],
      evidence_kind: 'import_receipt',
      capability: 'write',
      risk_class: 'MEDIUM',
      trust_label: TRUST.SINO_VERIFIED,
      cost_units: 3,
      validate_input(input = {}) {
        if (!Array.isArray(input.items) || input.items.length === 0)
          return { ok: false, errors: ['items must be a non-empty array'] };
        if (input.items.length > 500) return { ok: false, errors: ['items exceeds 500'] };
        return { ok: true };
      },
      async invoke(input) {
        const out = await request('/v1/global-import', {
          method: 'POST',
          body: { items: input.items },
          privileged: true,
        });
        return {
          count: out.count ?? 0,
          cluster_count: out.cluster_count ?? 0,
          quarantined_count: out.quarantined_count ?? 0,
          fetched_at: out.fetched_at ?? null,
        };
      },
    },
    {
      // Reaches third-party APIs and spends external quota. Classified HIGH so
      // the default contract escalates it to a human rather than self-granting.
      tool_id: 'knitwear_radar.sync',
      version: '0.21.0',
      description:
        'Live multi-source sync against Etsy / Pinterest / Google (external quota, HIGH risk).',
      required_scopes: ['knitwear.read', 'knitwear.write', 'external.fetch'],
      evidence_kind: 'sync_receipt',
      capability: 'external_fetch',
      risk_class: 'HIGH',
      trust_label: TRUST.SINO_VERIFIED,
      cost_units: 10,
      validate_input(input = {}) {
        if (
          input.top !== undefined &&
          (!Number.isSafeInteger(input.top) || input.top < 10 || input.top > 100)
        ) {
          return { ok: false, errors: ['top must be an integer in 10..100'] };
        }
        return { ok: true };
      },
      async invoke(input = {}) {
        const out = await request(`/v1/sync?top=${encodeURIComponent(String(input.top ?? 50))}`, {
          method: 'POST',
          privileged: true,
        });
        return {
          count: out.count ?? 0,
          cluster_count: out.cluster_count ?? 0,
          fetched_at: out.fetched_at ?? null,
        };
      },
    },
  ];
}
