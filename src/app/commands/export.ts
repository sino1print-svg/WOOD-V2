/**
 * Export command — Phase 10.5 Runnable Application Integration.
 *
 * Assembles the official `ExportEngineInput` from a completed generation
 * result and produces every user-facing document through the approved Export
 * Engine plan and formatters (TXT / Markdown / readable JSON / canonical
 * JSON). The UI never re-implements a formatter and never serializes domain
 * objects itself; every byte comes from the official formatter output.
 */
import {
  Audience,
  EngineId,
  ExportFormat,
  ExportScope,
  OutputStatus,
  PromptModuleType,
  SessionStatus,
  ValidationCheck,
  ValidationSeverity,
  type Artwork,
  type PhotoshootSession,
  type Project,
  type ProjectId,
  type Scene,
  type SemVer,
  type SessionId,
  type ValidationFailure,
} from '../../shared/domain-model';
import type { ExportEngineInput } from '../../shared/contracts/export-contracts';
import { createExportPlan } from '../../engines/export-engine';
import { stableHash } from '../../engines/scene-engine';
import {
  formatCanonicalJson,
  formatMarkdown,
  formatReadableJson,
  formatTxt,
  type ExportFormatResult,
  type ExportFormattedDocument,
  type ExportFormatterInput,
} from '../../export';
import { APP_CONFIG } from '../../config/app-config';
import type { UiState } from '../../ui-engine';
import {
  APP_PROJECT_ID,
  APP_SESSION_ID,
  CANONICAL_APP_TIME,
  DOMAIN_COLORS,
  DOMAIN_PRODUCTS,
  DOMAIN_SEASONS,
  PROMPT_VERSIONS,
} from '../catalog';

const version = (value: string): SemVer => value as SemVer;

/** Deterministic download file names (§5.6) — no wall-clock components. */
export const EXPORT_FILE_NAMES = {
  txt: 'prompt-pack.txt',
  markdown: 'prompt-pack.md',
  readable_json: 'prompt-pack.json',
  canonical_json: 'prompt-pack.canonical.json',
} as const;

export type ExportDocumentKind = keyof typeof EXPORT_FILE_NAMES;

function sessionFrom(state: UiState, artwork: Artwork | null): PhotoshootSession {
  const scenes: Record<string, Scene> = {};
  for (const scene of state.scenes) scenes[scene.id] = scene;
  const sceneOrder = state.scenes.map((scene) => scene.id);
  const totalScenes = sceneOrder.length;
  const outputAGenerated = state.scenes.filter(
    (scene) => scene.outputA.status === OutputStatus.Generated,
  ).length;
  const outputBGenerated = state.scenes.filter(
    (scene) => scene.outputB?.status === OutputStatus.Generated,
  ).length;
  const fingerprintComponents: PhotoshootSession['fingerprint']['components'] = {
    season: state.draft.seasonId!,
    audience: state.draft.audience ?? Audience.All,
    productIds: state.draft.products.map((product) => product.productId),
    colorIds: [...state.draft.colorIds],
    colorLocked: false,
    requestedSceneCount: totalScenes,
    sceneFingerprints: state.scenes.map((scene) => scene.sceneFingerprint),
    artworkContentHashes: artwork === null ? [] : [artwork.contentHash],
    ruleSetVersions: {},
    isDigitalProduct: false,
  };
  return {
    id: APP_SESSION_ID as SessionId,
    projectId: APP_PROJECT_ID as ProjectId,
    name: state.draft.title,
    createdAt: CANONICAL_APP_TIME,
    updatedAt: CANONICAL_APP_TIME,
    season: state.draft.seasonId!,
    audience: state.draft.audience ?? Audience.All,
    productIds: state.draft.products.map((product) => product.productId),
    colorSelection: { colorIds: [...state.draft.colorIds], locked: false },
    requestedSceneCount: totalScenes,
    scenes,
    sceneOrder,
    groups: {},
    cover: null,
    status: SessionStatus.Ready,
    validationResultId: null,
    validationResults: {},
    dedupLedger: {
      seen: state.scenes.map((scene) => scene.dedupSignature.hash),
      combinationSpaceSize: totalScenes,
    },
    generationProgress: {
      totalScenes,
      outputAGenerated,
      outputBGenerated,
      coverGenerated: false,
      allOutputAReady: totalScenes > 0 && outputAGenerated === totalScenes,
    },
    fingerprint: {
      hash: stableHash(fingerprintComponents),
      components: fingerprintComponents,
    },
  };
}

function projectFrom(state: UiState, artwork: Artwork | null): Project {
  const session = sessionFrom(state, artwork);
  return {
    id: APP_PROJECT_ID as ProjectId,
    schemaVersion: APP_CONFIG.schemaVersions.project as Project['schemaVersion'],
    name: state.draft.title,
    createdAt: CANONICAL_APP_TIME,
    updatedAt: CANONICAL_APP_TIME,
    sessions: { [session.id]: session },
    sessionOrder: [session.id],
    currentVersionId: null,
    versionHistory: {},
    versionOrder: [],
    isDigitalProduct: false,
    persistenceMode: APP_CONFIG.persistenceMode,
    retention: { ...APP_CONFIG.retentionDefault },
    artworks: artwork === null ? {} : { [artwork.id]: artwork },
  };
}

/**
 * Official export input for the current generation result (session scope).
 * Every value is deterministic; `createdAt` is the canonical application time.
 */
export function buildExportEngineInput(state: UiState, artwork: Artwork | null): ExportEngineInput {
  return {
    source: {
      project: projectFrom(state, artwork),
      products: DOMAIN_PRODUCTS,
      seasons: DOMAIN_SEASONS,
      colors: DOMAIN_COLORS,
    },
    scope: {
      baseScope: ExportScope.Session,
      scopeDetail: 'session',
      sessionId: APP_SESSION_ID as SessionId,
    },
    formats: [ExportFormat.Txt, ExportFormat.Json, 'markdown'],
    createdAt: CANONICAL_APP_TIME,
    versions: {
      applicationVersion: version(APP_CONFIG.applicationVersion),
      generatorVersion: version(APP_CONFIG.generatorVersion),
      ruleSetVersions: {},
      promptModuleVersions: {
        [PromptModuleType.Global]: version(PROMPT_VERSIONS.moduleVersion),
        [PromptModuleType.Product]: version(PROMPT_VERSIONS.moduleVersion),
        [PromptModuleType.Season]: version(PROMPT_VERSIONS.moduleVersion),
        [PromptModuleType.Scene]: version(PROMPT_VERSIONS.moduleVersion),
        [PromptModuleType.OutputA]: version(PROMPT_VERSIONS.moduleVersion),
        [PromptModuleType.OutputB]: version(PROMPT_VERSIONS.moduleVersion),
        [PromptModuleType.Cover]: version(PROMPT_VERSIONS.moduleVersion),
        [PromptModuleType.Group]: version(PROMPT_VERSIONS.moduleVersion),
      },
    },
    limits: APP_CONFIG.limits.export,
  };
}

export interface ExportDocumentSuccess {
  readonly kind: ExportDocumentKind;
  readonly fileName: string;
  readonly document: ExportFormattedDocument;
}

export type ExportDocumentsResult =
  | { readonly ok: true; readonly documents: readonly ExportDocumentSuccess[] }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

const FORMATTERS: readonly (readonly [
  ExportDocumentKind,
  (input: ExportFormatterInput) => ExportFormatResult,
])[] = [
  ['txt', formatTxt],
  ['markdown', formatMarkdown],
  ['readable_json', formatReadableJson],
  ['canonical_json', formatCanonicalJson],
];

function notReadyFailure(): ValidationFailure {
  return {
    check: ValidationCheck.Products,
    field: 'state.phase',
    code: 'UI_EXPORT_NOT_READY',
    message: 'التصدير متاح فقط بعد توليد ناجح.',
    severity: ValidationSeverity.Blocking,
    ruleId: null,
    priorityClass: null,
    domain: null,
    originEngine: EngineId.Orchestrator,
  };
}

/**
 * Runs the official Export Engine plan once and formats every document kind.
 * Fails closed with the plan/formatter failures; never returns partial bytes.
 */
export function buildExportDocuments(
  state: UiState,
  artwork: Artwork | null,
): ExportDocumentsResult {
  if (state.phase !== 'prompts-ready' || state.scenes.length === 0) {
    return { ok: false, failures: [notReadyFailure()] };
  }
  const input = buildExportEngineInput(state, artwork);
  const planResult = createExportPlan(input);
  if (!planResult.ok) return { ok: false, failures: planResult.failures };
  const documents: ExportDocumentSuccess[] = [];
  for (const [kind, format] of FORMATTERS) {
    const formatted = format({ planResult, limits: input.limits });
    if (!formatted.ok) return { ok: false, failures: formatted.failures };
    documents.push({ kind, fileName: EXPORT_FILE_NAMES[kind], document: formatted.value });
  }
  return { ok: true, documents };
}
