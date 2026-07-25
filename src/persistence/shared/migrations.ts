import type {
  IsoTimestamp,
  MigrationRecord,
  Project,
  Rule,
  RuleSet,
  Sha256,
} from '../../shared/domain-model';
import { APP_CONFIG } from '../../config/app-config';
import { canonicalStringify, deterministicContentHash, safeJsonParse } from './canonical-json';
import { fail, ok, type PersistenceResult } from './result';
import {
  validateProjectDocument,
  validateRuleDocument,
  validateRuleSetDocument,
} from './validation';

export interface MigrationOutcome<T> {
  readonly value: T;
  readonly changed: boolean;
  readonly records: readonly MigrationRecord[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value: unknown): PersistenceResult<Record<string, unknown>> {
  const serialized = canonicalStringify(value);
  if (!serialized.ok) return serialized;
  const parsed = safeJsonParse(serialized.value);
  if (!parsed.ok) return parsed;
  return isObject(parsed.value)
    ? ok(parsed.value)
    : fail('MIGRATION_FAILED', 'migrate', 'Migration input must be a JSON object.');
}

function sortedStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').sort()
    : [];
}

async function backfillProjectV1(project: Record<string, unknown>): Promise<boolean> {
  let changed = false;
  const artworks = isObject(project.artworks) ? project.artworks : {};
  const sessions = isObject(project.sessions) ? project.sessions : {};

  for (const sessionId of Object.keys(sessions).sort()) {
    const session = sessions[sessionId];
    if (!isObject(session)) continue;
    const scenes = isObject(session.scenes) ? session.scenes : {};
    const sceneFingerprints: string[] = [];
    const referencedArtworkIds = new Set<string>();

    for (const sceneId of Object.keys(scenes).sort()) {
      const scene = scenes[sceneId];
      if (!isObject(scene)) continue;
      const outputA = isObject(scene.outputA) ? scene.outputA : null;
      const outputB = isObject(scene.outputB) ? scene.outputB : null;

      if (scene.sceneVersion === undefined) {
        scene.sceneVersion = 1;
        changed = true;
      }
      if (outputA) {
        if (outputA.promptHash === undefined) {
          const hash = await deterministicContentHash(outputA.promptText ?? '');
          outputA.promptHash = hash.ok ? hash.value : '';
          changed = true;
        }
        if (outputA.renderHash === undefined) {
          outputA.renderHash = null;
          changed = true;
        }
        if (outputA.promptMeta === undefined) {
          outputA.promptMeta = null;
          changed = true;
        }
      }
      if (outputB) {
        if (typeof outputB.artworkId === 'string') referencedArtworkIds.add(outputB.artworkId);
        if (outputB.promptHash === undefined) {
          const hash = await deterministicContentHash(outputB.promptText ?? '');
          outputB.promptHash = hash.ok ? hash.value : '';
          changed = true;
        }
        if (outputB.renderHash === undefined) {
          outputB.renderHash = null;
          changed = true;
        }
        if (outputB.promptMeta === undefined) {
          outputB.promptMeta = null;
          changed = true;
        }
        if (outputB.sourceHash === undefined && typeof outputB.sourceContentHash === 'string') {
          outputB.sourceHash = outputB.sourceContentHash;
          changed = true;
        }
        if (outputB.contentHash === undefined) {
          const hash = await deterministicContentHash({
            sourceHash: outputB.sourceHash ?? outputB.sourceContentHash ?? null,
            artworkId: outputB.artworkId ?? null,
            promptText: outputB.promptText ?? '',
          });
          outputB.contentHash = hash.ok ? hash.value : '';
          changed = true;
        }
      }

      if (scene.sceneFingerprint === undefined) {
        const fingerprint = await deterministicContentHash({
          templateId: scene.templateId,
          productId: scene.productId,
          locationId: scene.locationId,
          lightingId: scene.lightingId,
          decorIds: scene.decorIds,
          propIds: scene.propIds,
          cameraId: scene.cameraId,
          compositionId: scene.compositionId,
          poseId: scene.poseId,
          displayMethod: scene.displayMethod,
          paletteColorId: scene.paletteColorId,
          seasonId: scene.seasonId,
          printAreaRulesRef: scene.printAreaRulesRef,
          view: scene.view,
        });
        scene.sceneFingerprint = fingerprint.ok ? fingerprint.value : '';
        changed = true;
      }
      if (typeof scene.sceneFingerprint === 'string')
        sceneFingerprints.push(scene.sceneFingerprint);
      if (scene.sceneHash === undefined) {
        const hashInput = { ...scene };
        delete hashInput.sceneHash;
        const hash = await deterministicContentHash(hashInput);
        scene.sceneHash = hash.ok ? hash.value : '';
        changed = true;
      }
    }

    const cover = isObject(session.cover) ? session.cover : null;
    if (cover) {
      if (cover.promptHash === undefined) {
        const hash = await deterministicContentHash(cover.promptText ?? '');
        cover.promptHash = hash.ok ? hash.value : '';
        changed = true;
      }
      if (cover.renderHash === undefined) {
        cover.renderHash = null;
        changed = true;
      }
      if (cover.promptMeta === undefined) {
        cover.promptMeta = null;
        changed = true;
      }
      if (cover.coverHash === undefined) {
        const hash = await deterministicContentHash({
          sourceSaleImageIds: cover.sourceSaleImageIds,
          layout: cover.layout,
          readMetadata: cover.readMetadata,
        });
        cover.coverHash = hash.ok ? hash.value : '';
        changed = true;
      }
    }

    const validationResults = isObject(session.validationResults) ? session.validationResults : {};
    for (const validationId of Object.keys(validationResults).sort()) {
      const validation = validationResults[validationId];
      if (!isObject(validation) || !Array.isArray(validation.failures)) continue;
      for (const failure of validation.failures) {
        if (!isObject(failure)) continue;
        if (failure.originEngine === undefined) {
          failure.originEngine = 'validation';
          changed = true;
        }
        for (const field of ['ruleId', 'priorityClass', 'domain']) {
          if (failure[field] === undefined) {
            failure[field] = null;
            changed = true;
          }
        }
      }
    }

    if (session.fingerprint === undefined) {
      const colorSelection = isObject(session.colorSelection) ? session.colorSelection : {};
      const artworkHashes = [...referencedArtworkIds]
        .map((id) => artworks[id])
        .filter(isObject)
        .map((artwork) => artwork.contentHash)
        .filter((hash): hash is string => typeof hash === 'string')
        .sort();
      const components = {
        season: session.season,
        audience: session.audience,
        productIds: sortedStrings(session.productIds),
        colorIds: sortedStrings(colorSelection.colorIds),
        colorLocked: colorSelection.locked === true,
        requestedSceneCount: session.requestedSceneCount,
        sceneFingerprints: sceneFingerprints.sort(),
        artworkContentHashes: artworkHashes,
        ruleSetVersions: {},
        isDigitalProduct: project.isDigitalProduct === true,
      };
      const hash = await deterministicContentHash(components);
      session.fingerprint = { hash: hash.ok ? hash.value : '', components };
      changed = true;
    }
  }
  return changed;
}

export async function migrateProjectDocument(
  input: unknown,
): Promise<PersistenceResult<MigrationOutcome<Project>>> {
  if (!isObject(input) || !Number.isInteger(input.schemaVersion)) {
    return fail('VALIDATION_FAILED', 'migrate', 'Project schemaVersion is required.');
  }
  const version = input.schemaVersion as number;
  const current = APP_CONFIG.schemaVersions.project;
  if (version > current) {
    return fail(
      'UNSUPPORTED_SCHEMA_VERSION',
      'migrate',
      'Project was created by a newer application schema.',
      false,
      {
        found: version,
        supported: current,
      },
    );
  }
  if (version < current) {
    return fail(
      'MIGRATION_FAILED',
      'migrate',
      `No specification-defined project migration exists from schema ${version} to ${current}.`,
    );
  }

  const clone = cloneJson(input);
  if (!clone.ok) return clone;
  try {
    const changed = await backfillProjectV1(clone.value);
    const validated = validateProjectDocument(clone.value);
    if (!validated.ok) return validated;
    return ok({ value: validated.value, changed, records: [] });
  } catch (cause) {
    return fail(
      'MIGRATION_FAILED',
      'migrate',
      cause instanceof Error ? cause.message : 'Project migration failed.',
    );
  }
}

const SYMBOLIC_TARGETS = new Set([
  'generation',
  'cover_build',
  'cover.publish',
  'artwork.upload',
  'outputB.publish',
  'outputB_in_cover',
  'readable_background_text',
  'collage_output',
  'seasonal_decor',
  'non_selected_colors',
  'scene.dedupSignature',
  'print_area_too_small',
  'print_area_centered',
  'print_area_min_size',
]);

const DIMENSION_TARGETS = new Set([
  'product',
  'location',
  'lighting',
  'decor',
  'props',
  'camera',
  'composition',
  'pose',
  'display_method',
  'garment_color',
  'view',
  'print_area_rules',
  'season',
]);

const VALID_RULE_DOMAINS = new Set([
  'print_area',
  'background',
  'output',
  'model',
  'decor',
  'garment_color',
  'composition',
  'cover',
  'palette',
  'product',
  'validation',
  'artwork',
  'prompt',
  'session',
  'export',
  'group',
]);

function migrateTarget(target: unknown): unknown {
  if (isObject(target) && typeof target.ref === 'string') {
    return { kind: 'contextRef', ref: { ref: target.ref } };
  }
  if (typeof target !== 'string') return target;
  if (SYMBOLIC_TARGETS.has(target)) return { kind: 'symbolic', symbol: target };
  if (DIMENSION_TARGETS.has(target)) return { kind: 'dimension', dimension: target };
  return { kind: 'literal', value: target };
}

function migrateNumericExpression(limit: unknown): unknown {
  if (typeof limit === 'number') return { kind: 'literal', value: limit };
  if (isObject(limit) && typeof limit.ref === 'string') {
    return { kind: 'contextRef', ref: { ref: limit.ref } };
  }
  return limit;
}

function migrateConditionField(node: unknown): void {
  if (!isObject(node)) return;
  if (typeof node.field === 'string') return; // ContextFieldPath is a brand-only value change.
  if (Array.isArray(node.all)) node.all.forEach(migrateConditionField);
  if (Array.isArray(node.any)) node.any.forEach(migrateConditionField);
  if (node.not !== undefined) migrateConditionField(node.not);
}

export interface RulePayloadMigrationOutcome {
  readonly value: Rule;
  readonly changed: true;
  /**
   * The authoritative MigrationRecord union and Rule shape have no `rule` aggregate
   * schemaVersion. This payload transform is therefore intentionally not represented
   * as a fabricated MigrationRecord.
   */
  readonly records: readonly [];
}

export function migrateRuleV2PayloadToV3(
  input: unknown,
): PersistenceResult<RulePayloadMigrationOutcome> {
  if (!isObject(input))
    return fail('MIGRATION_FAILED', 'migrate', 'Rule v2 payload must be an object.');
  const clone = cloneJson(input);
  if (!clone.ok) return clone;
  if (typeof clone.value.domain !== 'string' || !VALID_RULE_DOMAINS.has(clone.value.domain)) {
    return fail('MIGRATION_SPECIFICATION_BLOCKED', 'migrate', {
      messageEn:
        'RuleDomain reclassification is required but no authoritative mapping exists for this rule.',
      messageAr: 'يلزم إعادة تصنيف RuleDomain، لكن لا توجد خريطة تحويل معتمدة لهذه القاعدة.',
      details: { blocker: 'RULE_DOMAIN_RECLASSIFICATION_MAPPING_UNDEFINED' },
    });
  }
  if (!isObject(clone.value.effect) || !Array.isArray(clone.value.effect.targets)) {
    return fail('MIGRATION_FAILED', 'migrate', 'Rule v2 effect.targets is required.');
  }
  migrateConditionField(clone.value.condition);
  clone.value.effect.targets = clone.value.effect.targets.map(migrateTarget);
  if (clone.value.effect.limit !== undefined) {
    clone.value.effect.limit = migrateNumericExpression(clone.value.effect.limit);
  }
  const validated = validateRuleDocument(clone.value);
  if (!validated.ok)
    return fail('MIGRATION_FAILED', 'migrate', {
      messageEn: 'Migrated Rule does not satisfy the current Rule JSON Schema.',
      messageAr: 'القاعدة المُرحّلة لا تطابق مخطط JSON الحالي للقاعدة.',
      details: validated.error.details,
    });
  return ok({ value: validated.value, changed: true, records: [] });
}

export function migrateRuleSetV2ToV3(
  input: unknown,
  appliedAt: IsoTimestamp,
): PersistenceResult<MigrationOutcome<RuleSet>> {
  if (!isObject(input) || input.schemaVersion !== 2) {
    return fail('MIGRATION_FAILED', 'migrate', 'RuleSet v2 input is required.');
  }
  const clone = cloneJson(input);
  if (!clone.ok) return clone;
  if (
    typeof clone.value.id !== 'string' ||
    typeof clone.value.name !== 'string' ||
    !Array.isArray(clone.value.ruleIds) ||
    !clone.value.ruleIds.every((value) => typeof value === 'string')
  ) {
    return fail('MIGRATION_FAILED', 'migrate', 'Malformed RuleSet v2 aggregate.');
  }
  // RuleSet owns only id/name/ruleIds/schemaVersion. Rule payloads are separate aggregates.
  clone.value.schemaVersion = 3;
  const validated = validateRuleSetDocument(clone.value);
  if (!validated.ok)
    return fail('MIGRATION_FAILED', 'migrate', {
      messageEn: 'Migrated RuleSet does not satisfy the current RuleSet JSON Schema.',
      messageAr: 'مجموعة القواعد المُرحّلة لا تطابق مخطط JSON الحالي.',
      details: validated.error.details,
    });
  const record: MigrationRecord = {
    aggregate: 'rule_set',
    fromVersion: 2,
    toVersion: 3,
    appliedAt,
  };
  return ok({ value: validated.value, changed: true, records: [record] });
}

export function migrateRuleSetDocument(
  input: unknown,
  appliedAt: IsoTimestamp,
): PersistenceResult<MigrationOutcome<RuleSet>> {
  if (!isObject(input) || !Number.isInteger(input.schemaVersion)) {
    return fail('MIGRATION_FAILED', 'migrate', 'RuleSet schemaVersion is required.');
  }
  const version = input.schemaVersion as number;
  if (version > APP_CONFIG.schemaVersions.ruleSet) {
    return fail('UNSUPPORTED_SCHEMA_VERSION', 'migrate', {
      details: { found: version, supported: APP_CONFIG.schemaVersions.ruleSet },
    });
  }
  if (version === 2) return migrateRuleSetV2ToV3(input, appliedAt);
  if (version !== APP_CONFIG.schemaVersions.ruleSet) {
    return fail('MIGRATION_FAILED', 'migrate', {
      messageEn: `No specification-defined RuleSet migration exists from schema ${version}.`,
      messageAr: `لا يوجد ترحيل معتمد لمجموعة القواعد من إصدار المخطط ${version}.`,
    });
  }
  const clone = cloneJson(input);
  if (!clone.ok) return clone;
  const validated = validateRuleSetDocument(clone.value);
  if (!validated.ok) return validated;
  return ok({ value: validated.value, changed: false, records: [] });
}

export async function verifyHash(value: unknown, expected: Sha256): Promise<boolean> {
  const computed = await deterministicContentHash(value);
  return computed.ok && computed.value === expected;
}
