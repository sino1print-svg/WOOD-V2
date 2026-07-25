import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import domainSchema from '../../../schemas/domain.schema.json';
import { APP_CONFIG } from '../../config/app-config';
import type {
  Artwork,
  Project,
  ProjectId,
  Rule,
  RuleSet,
  VersionSnapshot,
} from '../../shared/domain-model';
import { canonicalStringify, safeJsonParse } from './canonical-json';
import {
  compareCodeUnits,
  isAbsolutePath,
  validateDomainIdentifier,
  validateOpaqueAssetRef,
} from './identifiers';
import { fail, ok, type PersistenceFailure, type PersistenceResult } from './result';

export interface PersistenceValidationIssue {
  readonly jsonPointer: string;
  readonly keyword: string;
  readonly message: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface AssetAssociationValidator {
  validateArtworkAssociation(
    projectId: ProjectId,
    artwork: Artwork,
  ): Promise<PersistenceResult<void>>;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
  messages: true,
});
ajv.addSchema(domainSchema);

function compileDef<T>(name: string): ValidateFunction<T> {
  return ajv.compile<T>({
    $ref: `https://mpd.local/schemas/domain.schema.json#/$defs/${name}`,
  });
}

const validateProjectSchema = compileDef<Project>('Project');
const validateRuleSchema = compileDef<Rule>('Rule');
const validateRuleSetSchema = compileDef<RuleSet>('RuleSet');

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pointerForError(error: ErrorObject): string {
  let path = error.instancePath || '/';
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    path = `${path === '/' ? '' : path}/${error.params.missingProperty}`;
  } else if (
    error.keyword === 'additionalProperties' &&
    typeof error.params.additionalProperty === 'string'
  ) {
    path = `${path === '/' ? '' : path}/${error.params.additionalProperty}`;
  }
  return path || '/';
}

function issuesFromAjv(
  errors: readonly ErrorObject[] | null | undefined,
): PersistenceValidationIssue[] {
  return (errors ?? []).map((error) => ({
    jsonPointer: pointerForError(error),
    keyword: error.keyword,
    message: error.message ?? 'Schema validation failed.',
    params: error.params as Readonly<Record<string, unknown>>,
  }));
}

function addIssue(
  issues: PersistenceValidationIssue[],
  path: string,
  keyword: string,
  message: string,
  params?: Readonly<Record<string, unknown>>,
): void {
  issues.push({ jsonPointer: path, keyword, message, ...(params ? { params } : {}) });
}

function inspectUnsafeValues(
  value: unknown,
  path: string,
  issues: PersistenceValidationIssue[],
): void {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    addIssue(issues, path, 'security', 'Raw binary data is forbidden in Project JSON.');
    return;
  }
  if (typeof value === 'string' && isAbsolutePath(value)) {
    addIssue(issues, path, 'security', 'Absolute paths are forbidden in Project JSON.');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectUnsafeValues(item, `${path}/${index}`, issues));
  } else if (isObject(value)) {
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      if (key === 'evaluationContext' || /^resolved[A-Z]/u.test(key)) {
        addIssue(
          issues,
          `${path}/${key}`,
          'runtimeObject',
          'Runtime-only EvaluationContext/Resolved* objects must never be persisted.',
        );
      }
      inspectUnsafeValues(value[key], `${path}/${key}`, issues);
    }
  }
}

function inspectIdentifierNormalization(
  value: unknown,
  path: string,
  propertyName: string | null,
  issues: PersistenceValidationIssue[],
): void {
  const isIdProperty =
    propertyName === 'id' ||
    propertyName === 'season' ||
    propertyName === 'color' ||
    propertyName === 'key' ||
    propertyName?.endsWith('Id') === true ||
    propertyName?.endsWith('Ids') === true ||
    propertyName === 'currentVersionId' ||
    propertyName === 'parentVersionId';
  if (typeof value === 'string' && isIdProperty) {
    const result = validateDomainIdentifier(value, propertyName ?? 'identifier');
    if (!result.ok) addIssue(issues, path, 'identifier', result.error.messageEn);
    return;
  }
  if (propertyName === 'pngAssetRef' && typeof value === 'string') {
    const result = validateOpaqueAssetRef(value);
    if (!result.ok) addIssue(issues, path, 'assetRef', result.error.messageEn);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectIdentifierNormalization(item, `${path}/${index}`, propertyName, issues),
    );
  } else if (isObject(value)) {
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      inspectIdentifierNormalization(value[key], `${path}/${key}`, key, issues);
    }
  }
}

function checkOrder(
  map: Readonly<Record<string, unknown>>,
  order: readonly string[],
  path: string,
  issues: PersistenceValidationIssue[],
): void {
  if (new Set(order).size !== order.length) {
    addIssue(issues, path, 'uniqueItems', 'Order entries must be unique.');
  }
  const mapKeys = Object.keys(map).sort(compareCodeUnits);
  const orderKeys = [...order].sort(compareCodeUnits);
  if (
    mapKeys.length !== orderKeys.length ||
    mapKeys.some((key, index) => key !== orderKeys[index])
  ) {
    addIssue(
      issues,
      path,
      'referentialIntegrity',
      'Order must contain every map key exactly once.',
    );
  }
}

function validateSnapshotReferences(project: Project, issues: PersistenceValidationIssue[]): void {
  checkOrder(project.versionHistory, project.versionOrder, '/versionOrder', issues);
  const orderIndex = new Map(project.versionOrder.map((id, index) => [id, index]));
  for (const versionId of Object.keys(project.versionHistory).sort(compareCodeUnits)) {
    const snapshot: VersionSnapshot =
      project.versionHistory[versionId as keyof typeof project.versionHistory];
    const base = `/versionHistory/${versionId}`;
    if (snapshot.versionId !== versionId) {
      addIssue(issues, `${base}/versionId`, 'referentialIntegrity', 'Snapshot key/id mismatch.');
    }
    if (snapshot.projectId !== project.id) {
      addIssue(
        issues,
        `${base}/projectId`,
        'referentialIntegrity',
        'Snapshot belongs to another project.',
      );
    }
    if (snapshot.parentVersionId !== null) {
      if (!project.versionHistory[snapshot.parentVersionId]) {
        addIssue(
          issues,
          `${base}/parentVersionId`,
          'referentialIntegrity',
          'Snapshot parent does not exist.',
        );
      } else if (
        (orderIndex.get(snapshot.parentVersionId) ?? Number.MAX_SAFE_INTEGER) >=
        (orderIndex.get(snapshot.versionId) ?? -1)
      ) {
        addIssue(
          issues,
          `${base}/parentVersionId`,
          'referentialIntegrity',
          'Snapshot parent must precede the child in versionOrder.',
        );
      }
    }
    const state = safeJsonParse(snapshot.projectState);
    if (!state.ok || !isObject(state.value)) {
      addIssue(
        issues,
        `${base}/projectState`,
        'snapshotState',
        'Snapshot state must be valid JSON.',
      );
    } else {
      inspectUnsafeValues(state.value, `${base}/projectState`, issues);
    }
  }
  if (project.currentVersionId !== null && !project.versionHistory[project.currentVersionId]) {
    addIssue(
      issues,
      '/currentVersionId',
      'referentialIntegrity',
      'currentVersionId does not exist in versionHistory.',
    );
  }
}

function validateProjectReferences(project: Project): PersistenceValidationIssue[] {
  const issues: PersistenceValidationIssue[] = [];
  checkOrder(project.sessions, project.sessionOrder, '/sessionOrder', issues);
  const allOutputA = new Map<string, { readonly sessionId: string; readonly sceneId: string }>();

  for (const sessionId of Object.keys(project.sessions).sort(compareCodeUnits)) {
    const session = project.sessions[sessionId as keyof typeof project.sessions];
    const sessionBase = `/sessions/${sessionId}`;
    if (session.id !== sessionId) {
      addIssue(issues, `${sessionBase}/id`, 'referentialIntegrity', 'Session key/id mismatch.');
    }
    if (session.projectId !== project.id) {
      addIssue(
        issues,
        `${sessionBase}/projectId`,
        'referentialIntegrity',
        'session.projectId must equal parent Project.id.',
      );
    }
    checkOrder(session.scenes, session.sceneOrder, `${sessionBase}/sceneOrder`, issues);

    for (const sceneId of Object.keys(session.scenes).sort(compareCodeUnits)) {
      const scene = session.scenes[sceneId as keyof typeof session.scenes];
      const sceneBase = `${sessionBase}/scenes/${sceneId}`;
      if (scene.id !== sceneId) {
        addIssue(issues, `${sceneBase}/id`, 'referentialIntegrity', 'Scene key/id mismatch.');
      }
      if (scene.sessionId !== session.id) {
        addIssue(
          issues,
          `${sceneBase}/sessionId`,
          'referentialIntegrity',
          'scene.sessionId must equal the parent session id.',
        );
      }
      if (scene.outputA.sceneId !== scene.id) {
        addIssue(
          issues,
          `${sceneBase}/outputA/sceneId`,
          'referentialIntegrity',
          'OutputA.sceneId must equal the parent scene id.',
        );
      }
      if (allOutputA.has(scene.outputA.id)) {
        addIssue(
          issues,
          `${sceneBase}/outputA/id`,
          'referentialIntegrity',
          'OutputA ids must be unique within the project.',
        );
      } else {
        allOutputA.set(scene.outputA.id, { sessionId: session.id, sceneId: scene.id });
      }
      if (scene.outputB !== null) {
        if (scene.outputB.sceneId !== scene.id) {
          addIssue(
            issues,
            `${sceneBase}/outputB/sceneId`,
            'referentialIntegrity',
            'OutputB.sceneId must equal the parent scene id.',
          );
        }
        if (scene.outputB.sourceOutputAId !== scene.outputA.id) {
          addIssue(
            issues,
            `${sceneBase}/outputB/sourceOutputAId`,
            'referentialIntegrity',
            'OutputB.sourceOutputAId must equal the parent scene OutputA id.',
          );
        }
        if (!project.artworks[scene.outputB.artworkId]) {
          addIssue(
            issues,
            `${sceneBase}/outputB/artworkId`,
            'referentialIntegrity',
            'OutputB.artworkId must refer to a Project artwork.',
          );
        }
      }
    }

    for (const groupId of Object.keys(session.groups).sort(compareCodeUnits)) {
      const group = session.groups[groupId as keyof typeof session.groups];
      const groupBase = `${sessionBase}/groups/${groupId}`;
      if (group.id !== groupId) {
        addIssue(issues, `${groupBase}/id`, 'referentialIntegrity', 'Group key/id mismatch.');
      }
      if (group.sessionId !== session.id) {
        addIssue(
          issues,
          `${groupBase}/sessionId`,
          'referentialIntegrity',
          'Group.sessionId must equal the parent session id.',
        );
      }
      if (new Set(group.sceneIds).size !== group.sceneIds.length) {
        addIssue(issues, `${groupBase}/sceneIds`, 'uniqueItems', 'Group sceneIds must be unique.');
      }
      group.sceneIds.forEach((sceneId, index) => {
        if (!session.scenes[sceneId]) {
          addIssue(
            issues,
            `${groupBase}/sceneIds/${index}`,
            'referentialIntegrity',
            'Group sceneIds must exist in the same session.',
          );
        }
      });
    }

    for (const validationId of Object.keys(session.validationResults).sort(compareCodeUnits)) {
      const validation =
        session.validationResults[validationId as keyof typeof session.validationResults];
      const validationBase = `${sessionBase}/validationResults/${validationId}`;
      if (validation.id !== validationId) {
        addIssue(
          issues,
          `${validationBase}/id`,
          'referentialIntegrity',
          'ValidationResult key/id mismatch.',
        );
      }
      if (validation.sessionId !== session.id) {
        addIssue(
          issues,
          `${validationBase}/sessionId`,
          'referentialIntegrity',
          'ValidationResult.sessionId must equal the parent session id.',
        );
      }
    }
    if (
      session.validationResultId !== null &&
      !session.validationResults[session.validationResultId]
    ) {
      addIssue(
        issues,
        `${sessionBase}/validationResultId`,
        'referentialIntegrity',
        'validationResultId does not exist in validationResults.',
      );
    }
    if (session.cover !== null) {
      const coverBase = `${sessionBase}/cover`;
      if (session.cover.sessionId !== session.id) {
        addIssue(
          issues,
          `${coverBase}/sessionId`,
          'referentialIntegrity',
          'Cover.sessionId must equal the parent session id.',
        );
      }
      session.cover.sourceSaleImageIds.forEach((outputId, index) => {
        const source = allOutputA.get(outputId);
        if (!source || source.sessionId !== session.id) {
          addIssue(
            issues,
            `${coverBase}/sourceSaleImageIds/${index}`,
            'referentialIntegrity',
            'MainCover source IDs must refer to real OutputA records in the same session.',
          );
        }
      });
    }
  }

  for (const artworkId of Object.keys(project.artworks).sort(compareCodeUnits)) {
    const artwork = project.artworks[artworkId as keyof typeof project.artworks];
    const base = `/artworks/${artworkId}`;
    if (artwork.id !== artworkId) {
      addIssue(issues, `${base}/id`, 'referentialIntegrity', 'Artwork key/id mismatch.');
    }
    if (artwork.projectId !== project.id) {
      addIssue(
        issues,
        `${base}/projectId`,
        'referentialIntegrity',
        'Artwork.projectId must equal the parent Project.id.',
      );
    }
  }

  validateSnapshotReferences(project, issues);
  return issues;
}

function validationFailure(
  issues: readonly PersistenceValidationIssue[],
): PersistenceResult<never> {
  return fail('VALIDATION_FAILED', 'validate', {
    details: { issues },
  });
}

export function validateProjectDocument(value: unknown): PersistenceResult<Project> {
  const issues: PersistenceValidationIssue[] = [];
  if (!validateProjectSchema(value)) issues.push(...issuesFromAjv(validateProjectSchema.errors));
  inspectUnsafeValues(value, '', issues);
  inspectIdentifierNormalization(value, '', null, issues);
  if (isObject(value) && value.schemaVersion !== APP_CONFIG.schemaVersions.project) {
    addIssue(
      issues,
      '/schemaVersion',
      'const',
      `Project schemaVersion must equal ${APP_CONFIG.schemaVersions.project} after migration.`,
    );
  }
  if (issues.length > 0) return validationFailure(issues);

  const project = value as Project;
  issues.push(...validateProjectReferences(project));
  const serializable = canonicalStringify(project);
  if (!serializable.ok) {
    addIssue(issues, '/', 'canonicalSerialization', serializable.error.messageEn);
  }
  return issues.length > 0 ? validationFailure(issues) : ok(project);
}

function attachAssetPath(failure: PersistenceFailure, artworkId: string): PersistenceResult<never> {
  return fail(failure.code, 'validate', {
    messageEn: failure.messageEn,
    messageAr: failure.messageAr,
    retryable: failure.retryable,
    severity: failure.severity,
    recoveryAction: failure.recoveryAction,
    causeCategory: failure.causeCategory,
    details: {
      jsonPointer: `/artworks/${artworkId}/pngAssetRef`,
      assetFailure: failure.code,
      ...(failure.details ?? {}),
    },
  });
}

export async function validateProjectDocumentWithAssets(
  value: unknown,
  assetValidator: AssetAssociationValidator,
): Promise<PersistenceResult<Project>> {
  const validated = validateProjectDocument(value);
  if (!validated.ok) return validated;
  for (const artworkId of Object.keys(validated.value.artworks).sort(compareCodeUnits)) {
    const association = await assetValidator.validateArtworkAssociation(
      validated.value.id,
      validated.value.artworks[artworkId as keyof typeof validated.value.artworks],
    );
    if (!association.ok) return attachAssetPath(association.error, artworkId);
  }
  return validated;
}

export function validateRuleDocument(value: unknown): PersistenceResult<Rule> {
  if (!validateRuleSchema(value))
    return validationFailure(issuesFromAjv(validateRuleSchema.errors));
  return ok(value as Rule);
}

export function validateRuleSetDocument(value: unknown): PersistenceResult<RuleSet> {
  if (!validateRuleSetSchema(value))
    return validationFailure(issuesFromAjv(validateRuleSetSchema.errors));
  return ok(value as RuleSet);
}

export function assertProjectId(value: string): ProjectId {
  return value as ProjectId;
}
