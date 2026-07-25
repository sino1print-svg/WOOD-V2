/**
 * Architecture schema wrapper tests (02_ARCHITECTURE §5).
 * Every required wrapper file must exist, parse, resolve its external $ref into the
 * shared bundle, compile independently with AJV, accept a positive fixture, and
 * reject an invalid one. Fails if a required architecture filename is missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMAS = path.join(ROOT, 'schemas');

const printAreaProfile = {
  id: 'pa-1',
  position: 'center_chest',
  minSizeRatio: 0.3,
  centeringTolerance: 0.05,
  centered: true,
  maxShadowCoverage: 0.1,
  forbiddenOverlaps: [],
};
const outA = {
  id: 'sale-image-001',
  sceneId: 'scene-001',
  garment: 't',
  color: 'c-1',
  view: 'front',
  status: 'generated',
  forbidden: ['artwork', 'logo', 'watermark', 'typography'],
  promptText: '.',
  contentHash: 'a',
  generatedAt: null,
  promptHash: 'b',
  renderHash: null,
  promptMeta: null,
};
const scene = {
  id: 'scene-001',
  sessionId: 's-1',
  templateId: 't-1',
  productId: 'p-1',
  locationId: 'l-1',
  lightingId: 'li-1',
  decorIds: [],
  propIds: [],
  cameraId: 'ca-1',
  compositionId: 'co-1',
  poseId: 'po-1',
  displayMethod: 'flat_lay',
  paletteColorId: 'c-1',
  seasonId: 'se-1',
  printAreaRulesRef: 'pa-1',
  view: 'front',
  dedupSignature: {
    sceneTemplateId: 't-1',
    poseId: 'po-1',
    cameraAngle: 'top_down',
    compositionId: 'co-1',
    hash: 'h',
  },
  outputA: outA,
  outputB: null,
  sceneVersion: 1,
  sceneHash: 'sh',
  sceneFingerprint: 'sf',
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
  exportId: 'e-1',
  schemaVersion: 1,
  projectId: 'proj-1',
  sessionIds: ['s-1'],
  exportScope: 'all',
  scopeDetail: 'x',
  exportFormats: ['zip'],
  createdAt: '2026-07-16T00:00:00.000Z',
  applicationVersion: '0',
  generatorVersion: '0',
  ruleSetVersions: {},
  promptModuleVersions: {},
  includedFiles: [{ path: 'a/b.txt', kind: 'A' }],
  fileSizes: {},
  checksums: {},
  warnings: [],
  sourceFingerprints: { sessionFingerprint: 'sf' },
};

const CASES: Array<{ file: string; valid: unknown; invalid: unknown }> = [
  {
    file: 'product.schema.json',
    valid: {
      id: 'p-1',
      schemaVersion: 1,
      kind: 'k',
      name: 'n',
      type: 't',
      allowedViews: ['front'],
      printAreaProfile,
      audienceConstraints: {},
      defaultColors: [],
      expandable: true,
    },
    invalid: {},
  },
  {
    file: 'season.schema.json',
    valid: {
      id: 'se-1',
      schemaVersion: 1,
      kind: 'k',
      name: 'n',
      sceneLibraryRef: 'v-1',
      decorConstraints: [],
      heroSceneConstraints: [],
      forbiddenSeasonDecor: [],
    },
    invalid: {},
  },
  { file: 'scene.schema.json', valid: scene, invalid: {} },
  {
    file: 'rule.schema.json',
    valid: {
      id: 'r-1',
      priority: 1,
      domain: 'print_area',
      condition: { field: 'x', operator: 'eq', value: 'y' },
      effect: { type: 'forbid', targets: [{ kind: 'literal', value: 'z' }] },
    },
    invalid: { id: 'r', priority: 9, domain: 'nope', condition: {}, effect: {} },
  },
  {
    file: 'palette.schema.json',
    valid: { id: 'pal-1', schemaVersion: 1, name: 'n', colorIds: [], lockRules: [] },
    invalid: {},
  },
  {
    file: 'prompt-module.schema.json',
    valid: { id: 'm-1', schemaVersion: 1, moduleType: 'global', template: 't', variables: [] },
    invalid: { id: 'm', schemaVersion: 1, moduleType: 'bad', template: 't', variables: [] },
  },
  { file: 'output.schema.json', valid: outA, invalid: {} },
  {
    file: 'cover.schema.json',
    valid: {
      id: 'cov-1',
      sessionId: 's-1',
      sourceSaleImageIds: ['sale-image-001'],
      layout: 'single',
      readMetadata: {
        productIds: ['p-1'],
        colors: ['c-1'],
        mockupCount: 1,
        views: ['front'],
        seasonId: 'se-1',
        digitalProductStatus: false,
        primaryProduct: 'p-1',
        primaryColor: 'c-1',
        primaryView: 'front',
        primaryAudience: 'adult',
      },
      status: 'generated',
      promptText: '.',
      generatedAt: null,
      promptHash: 'a',
      renderHash: null,
      coverHash: 'c',
      promptMeta: null,
    },
    invalid: { layout: 'weird' },
  },
  {
    file: 'validation.schema.json',
    valid: {
      id: 'vr-1',
      sessionId: 's-1',
      evaluatedAt: '2026-07-16T00:00:00.000Z',
      passed: true,
      checks: [],
      failures: [],
    },
    invalid: {},
  },
  { file: 'project.schema.json', valid: project, invalid: {} },
  { file: 'export-manifest.schema.json', valid: exportManifest, invalid: {} },
];

const REQUIRED_FILES = CASES.map((c) => c.file);

let ajv: Ajv2020;
beforeAll(() => {
  ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(
    JSON.parse(readFileSync(path.join(SCHEMAS, 'domain.schema.json'), 'utf8')) as object,
  );
  for (const f of REQUIRED_FILES) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(SCHEMAS, f), 'utf8')) as object);
  }
});

describe('required architecture schema files exist', () => {
  it('every required wrapper filename is present (02_ARCHITECTURE §5)', () => {
    const missing = REQUIRED_FILES.filter((f) => !existsSync(path.join(SCHEMAS, f)));
    expect(missing).toEqual([]);
  });
});

describe('each wrapper resolves + validates through the bundle', () => {
  for (const c of CASES) {
    it(`${c.file} compiles, resolves $ref, accepts valid, rejects invalid`, () => {
      const raw = JSON.parse(readFileSync(path.join(SCHEMAS, c.file), 'utf8')) as { $id: string };
      const validate = ajv.getSchema(raw.$id);
      expect(validate, `wrapper ${c.file} did not compile / resolve $ref`).toBeTruthy();
      if (!validate) return;
      expect(validate(c.valid), `${c.file} rejected a valid fixture`).toBe(true);
      expect(validate(c.invalid), `${c.file} accepted an invalid fixture`).toBe(false);
    });
  }
});
