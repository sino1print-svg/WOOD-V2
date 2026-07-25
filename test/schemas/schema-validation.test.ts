/**
 * Structural JSON-Schema behavior tests (deterministic) — AJV 2020, positive AND
 * negative fixtures against the domain bundle $defs. Branded IDs are GENERIC
 * non-empty strings (no invented prefixes) — IDs like 'sale-image-001' are valid.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { AnyValidateFunction } from 'ajv/dist/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMAS = path.join(ROOT, 'schemas');
const BUNDLE_ID = 'https://mpd.local/schemas/domain.schema.json';
let ajv: Ajv2020;
const V = (def: string): AnyValidateFunction => {
  const v = ajv.getSchema(`${BUNDLE_ID}#/$defs/${def}`);
  if (!v) throw new Error(`no $def: ${def}`);
  return v;
};
const drop = <T extends object>(o: T, k: keyof T): Omit<T, typeof k> => {
  const c: T = { ...o };
  delete c[k];
  return c;
};

beforeAll(() => {
  ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(
    JSON.parse(readFileSync(path.join(SCHEMAS, 'domain.schema.json'), 'utf8')) as object,
  );
});

// ---------- fixtures (generic branded IDs, no prefixes) ----------
const outA = {
  id: 'sale-image-001',
  sceneId: 'scene-001',
  garment: 'tee',
  color: 'color-black',
  view: 'front',
  status: 'generated',
  forbidden: ['artwork', 'logo', 'watermark', 'typography'],
  promptText: '...',
  contentHash: 'aa',
  generatedAt: null,
  promptHash: 'bb',
  renderHash: null,
  promptMeta: null,
};
const outB = {
  id: 'preview-image-001',
  sceneId: 'scene-001',
  sourceOutputAId: 'sale-image-001',
  artworkId: 'art-001',
  onlyArtworkChanges: true,
  sourceContentHash: 'aa',
  status: 'pending',
  promptText: '...',
  generatedAt: null,
  promptHash: 'bb',
  renderHash: null,
  sourceHash: 'aa',
  contentHash: 'cc',
  promptMeta: null,
};
const dedupSignature = {
  sceneTemplateId: 'tmpl-1',
  poseId: 'pose-1',
  cameraAngle: 'top_down',
  compositionId: 'comp-1',
  hash: 'h1',
};
const scene = {
  id: 'scene-001',
  sessionId: 'sess-1',
  templateId: 'tmpl-1',
  productId: 'prod-1',
  locationId: 'loc-1',
  lightingId: 'lig-1',
  decorIds: [],
  propIds: [],
  cameraId: 'cam-1',
  compositionId: 'comp-1',
  poseId: 'pose-1',
  displayMethod: 'flat_lay',
  paletteColorId: 'color-black',
  seasonId: 'seas-1',
  printAreaRulesRef: 'pa-1',
  view: 'front',
  dedupSignature,
  outputA: outA,
  outputB: null,
  sceneVersion: 1,
  sceneHash: 'sh',
  sceneFingerprint: 'sf',
};
const coverMetadata = {
  productIds: ['prod-1'],
  colors: ['color-black'],
  mockupCount: 2,
  views: ['front'],
  seasonId: 'seas-1',
  digitalProductStatus: false,
  primaryProduct: 'prod-1',
  primaryColor: 'color-black',
  primaryView: 'front',
  primaryAudience: 'adult',
};
const cover = {
  id: 'cover-1',
  sessionId: 'sess-1',
  sourceSaleImageIds: ['sale-image-001', 'sale-image-002'],
  layout: 'duo',
  readMetadata: coverMetadata,
  status: 'generated',
  promptText: '...',
  generatedAt: null,
  promptHash: 'a',
  renderHash: null,
  coverHash: 'c',
  promptMeta: null,
};
const project = {
  id: 'proj-1',
  schemaVersion: 1,
  name: 'P',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  sessions: {},
  sessionOrder: [],
  currentVersionId: null,
  versionHistory: {},
  versionOrder: [],
  isDigitalProduct: false,
  persistenceMode: 'local_single_user',
  retention: { kind: 'keep_all' },
  artworks: {},
};
const exportManifest = {
  exportId: 'exp-1',
  schemaVersion: 1,
  projectId: 'proj-1',
  sessionIds: ['sess-1'],
  exportScope: 'all',
  scopeDetail: 'complete_project',
  exportFormats: ['zip', 'json'],
  createdAt: '2026-07-16T00:00:00.000Z',
  applicationVersion: '0.0.0',
  generatorVersion: '0.0.0',
  ruleSetVersions: {},
  promptModuleVersions: {},
  includedFiles: [{ path: 'session-01/prompts/A/001_x_A.txt', kind: 'A' }],
  fileSizes: {},
  checksums: {},
  warnings: [],
  sourceFingerprints: { sessionFingerprint: 'sf' },
};

describe('positive fixtures accepted', () => {
  it('OutputA / OutputB / Scene', () => {
    expect(V('OutputA')(outA)).toBe(true);
    expect(V('OutputB')(outB)).toBe(true);
    expect(V('Scene')(scene)).toBe(true);
  });
  it('CoverMetadata / MainCover (generic sale-image IDs)', () => {
    expect(V('CoverMetadata')(coverMetadata)).toBe(true);
    expect(V('MainCover')(cover)).toBe(true);
  });
  it('RetentionPolicy variants', () => {
    expect(V('RetentionPolicy')({ kind: 'keep_all' })).toBe(true);
    expect(V('RetentionPolicy')({ kind: 'keep_last_n', keepN: 5 })).toBe(true);
    expect(V('RetentionPolicy')({ kind: 'keep_days', keepDays: 30 })).toBe(true);
  });
  it('Project / ExportManifest / Rule', () => {
    expect(V('Project')(project)).toBe(true);
    expect(V('ExportManifest')(exportManifest)).toBe(true);
    expect(
      V('Rule')({
        id: 'rule-1',
        priority: 3,
        domain: 'decor',
        condition: { all: [{ field: 'session.season', operator: 'eq', value: 'x' }] },
        effect: { type: 'forbid', targets: [{ kind: 'literal', value: 'x' }] },
      }),
    ).toBe(true);
  });
});

describe('generic branded IDs (no invented prefixes)', () => {
  it('accepts non-empty generic ID strings', () => {
    for (const id of ['sale-image-001', 'preview-image-001', 'scene-001', 'proj_1', 'a']) {
      expect(V('Color')({ id, name: 'x', hex: '#000000' })).toBe(true);
    }
  });
  it('rejects an empty ID', () => {
    expect(V('Color')({ id: '', name: 'x', hex: '#000000' })).toBe(false);
  });
  it('accepts a non-empty Unicode/domain ID without imposing a filesystem-slug grammar', () => {
    expect(V('Color')({ id: 'معرّف mixed ١', name: 'x', hex: '#000000' })).toBe(true);
  });
  it('NO schema file uses invented outA_ / outB_ prefixes', () => {
    for (const f of readdirSync(SCHEMAS).filter((x) => x.endsWith('.json'))) {
      const text = readFileSync(path.join(SCHEMAS, f), 'utf8');
      expect(text.includes('outA_'), `${f} contains outA_`).toBe(false);
      expect(text.includes('outB_'), `${f} contains outB_`).toBe(false);
    }
  });
});

describe('negative fixtures rejected', () => {
  it('empty CoverMetadata', () => expect(V('CoverMetadata')({})).toBe(false));
  it('empty RetentionPolicy (missing kind)', () => expect(V('RetentionPolicy')({})).toBe(false));
  it('keep_last_n without keepN (conditional)', () =>
    expect(V('RetentionPolicy')({ kind: 'keep_last_n' })).toBe(false));
  it('malformed Scene output pair (outputA missing)', () =>
    expect(V('Scene')(drop(scene, 'outputA'))).toBe(false));
  it('OutputB without sourceOutputAId', () =>
    expect(V('OutputB')(drop(outB, 'sourceOutputAId'))).toBe(false));
  it('OutputB without artworkId', () => expect(V('OutputB')(drop(outB, 'artworkId'))).toBe(false));
  it('unknown enum value (cover layout)', () =>
    expect(V('MainCover')({ ...cover, layout: 'weird' })).toBe(false));
  it('unexpected additional field', () =>
    expect(V('CoverMetadata')({ ...coverMetadata, extra: 1 })).toBe(false));
  it('runtime EvaluationContext inside a persisted Project', () =>
    expect(V('Project')({ ...project, evaluationContext: { session: {} } })).toBe(false));
  it('runtime Resolved object inside exported JSON', () =>
    expect(V('ExportManifest')({ ...exportManifest, resolvedRules: [] })).toBe(false));
  it('secret field inside ExportManifest', () =>
    expect(V('ExportManifest')({ ...exportManifest, secret: 'x' })).toBe(false));
  it('absolute local path inside ExportManifest includedFiles', () =>
    expect(
      V('ExportManifest')({
        ...exportManifest,
        includedFiles: [{ path: '/etc/passwd', kind: 'x' }],
      }),
    ).toBe(false));
  it('parent-traversal path inside ExportManifest includedFiles', () =>
    expect(
      V('ExportManifest')({
        ...exportManifest,
        includedFiles: [{ path: '../../secret', kind: 'x' }],
      }),
    ).toBe(false));
  it('invalid schemaVersion (0)', () =>
    expect(V('Project')({ ...project, schemaVersion: 0 })).toBe(false));
});

describe('exportFormats do not admit operational channels', () => {
  it('rejects clipboard/markdown; accepts zip', () => {
    expect(V('ExportManifest')({ ...exportManifest, exportFormats: ['clipboard'] })).toBe(false);
    expect(V('ExportManifest')({ ...exportManifest, exportFormats: ['markdown'] })).toBe(false);
    expect(V('ExportManifest')({ ...exportManifest, exportFormats: ['zip'] })).toBe(true);
  });
});

/*
 * NOTE: Cover "Output A only" purity is a TYPE-LEVEL guarantee (OutputBId not
 * assignable to MainCover.sourceSaleImageIds — see test/domain-model/assignability.test.ts)
 * plus a Validation/Persistence REFERENTIAL check ("sourceSaleImageIds must reference
 * real Output A records"). It is intentionally NOT enforced by an invented ID prefix
 * in the JSON Schema (03_DATA_MODELS_FINAL defines IDs as opaque branded strings).
 */
