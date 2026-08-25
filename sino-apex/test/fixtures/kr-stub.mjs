// Hermetic Knitwear Radar stub.
// Serves fixtures captured from a live Knitwear Radar v0.21.0 so the governed
// workflow can be proven end-to-end with no network and no API keys. The stub
// reproduces the real contract's auth and error semantics, including the
// operator-key requirement on write and sync paths.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));

export const FIXTURES = {
  opportunities: load('kr-opportunities.json'),
  dna: load('kr-dna.json'),
  concepts: load('kr-concepts.json'),
  brief: load('kr-brief.json'),
};

/**
 * @param {object} opts
 * @param {string} opts.operatorKey key accepted on privileged paths
 * @param {object} [opts.faults] force failures: {opportunities:'500'|'timeout'}
 */
export async function startStub({ operatorKey = 'stub-operator-key', faults = {} } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const send = (status, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(payload);
    };
    const privileged = () => {
      const supplied = req.headers['x-api-key'];
      if (supplied !== operatorKey) {
        send(401, {
          ok: false,
          error: { code: 'UNAUTHORIZED', message: 'Valid operator API key required' },
        });
        return false;
      }
      return true;
    };

    if (p === '/v1/opportunities') {
      if (faults.opportunities === '500')
        return send(500, {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'upstream down' },
        });
      if (faults.opportunities === 'malformed') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{not json');
      }
      if (faults.opportunities === 'empty')
        return send(200, {
          ok: true,
          count: 0,
          fetched_at: new Date().toISOString(),
          clusters: [],
        });
      return send(200, { ...FIXTURES.opportunities, fetched_at: new Date().toISOString() });
    }
    if (p.startsWith('/v1/trends/')) {
      const [id, action] = p.slice('/v1/trends/'.length).split('/');
      if (id !== 'cluster-1' && id !== 'cluster-2') {
        return send(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Trend not found' } });
      }
      if (action === 'dna') return send(200, { ...FIXTURES.dna, trend_id: id });
      if (action === 'concepts') return send(200, { ...FIXTURES.concepts, trend_id: id });
      if (action === 'brief') return send(200, { ...FIXTURES.brief, trend_id: id });
      return send(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    if (p === '/v1/global-import') {
      if (!privileged()) return undefined;
      return send(200, {
        ok: true,
        count: 4,
        cluster_count: 2,
        quarantined_count: 0,
        fetched_at: new Date().toISOString(),
      });
    }
    if (p === '/v1/sync') {
      if (!privileged()) return undefined;
      return send(200, {
        ok: true,
        count: 4,
        cluster_count: 2,
        fetched_at: new Date().toISOString(),
      });
    }
    return send(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
