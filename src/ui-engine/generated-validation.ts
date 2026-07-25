import {
  CameraAngle,
  DisplayMethod,
  GarmentView,
  OutputStatus,
  type Scene,
} from '../shared/domain-model';
import type { PromptViewModel, UiFailure } from './types';
import {
  inspectDenseArray,
  inspectExactRecord,
  inspectOpenRecord,
  ownValidatedClone,
} from './safe-runtime';

const views = new Set<string>(Object.values(GarmentView));
const methods = new Set<string>(Object.values(DisplayMethod));
const cameraAngles = new Set<string>(Object.values(CameraAngle));
const outputStatuses = new Set<string>(Object.values(OutputStatus));
const placements = new Set(['center_chest', 'full_front', 'left_chest', 'center_back']);

function string(value: unknown): value is string {
  return typeof value === 'string';
}
function nullableString(value: unknown): value is string | null {
  return value === null || string(value);
}
function uniqueStrings(values: readonly unknown[]): boolean {
  return values.every(string) && new Set(values).size === values.length;
}
function failure(code: string, field: string, messageAr: string): UiFailure {
  return { code, field, messageAr, severity: 'blocking', source: 'engine' };
}

function validPromptMeta(value: unknown): boolean {
  return value === null || inspectOpenRecord(value).ok;
}

function inspectOutputA(value: unknown, sceneId: string): Readonly<Record<string, unknown>> | null {
  const result = inspectExactRecord(value, [
    'id',
    'sceneId',
    'garment',
    'color',
    'view',
    'status',
    'forbidden',
    'promptText',
    'contentHash',
    'generatedAt',
    'promptHash',
    'renderHash',
    'promptMeta',
  ]);
  if (!result.ok) return null;
  const record = result.value;
  const forbidden = inspectDenseArray(record.forbidden);
  if (!forbidden.ok) return null;
  if (
    !string(record.id) ||
    record.sceneId !== sceneId ||
    !string(record.garment) ||
    !string(record.color) ||
    !views.has(String(record.view)) ||
    !outputStatuses.has(String(record.status)) ||
    JSON.stringify(forbidden.value) !==
      JSON.stringify(['artwork', 'logo', 'watermark', 'typography']) ||
    !string(record.promptText) ||
    !string(record.contentHash) ||
    !(record.generatedAt === null || string(record.generatedAt)) ||
    !string(record.promptHash) ||
    !(record.renderHash === null || string(record.renderHash)) ||
    !validPromptMeta(record.promptMeta)
  )
    return null;
  return record;
}

function inspectOutputB(value: unknown, sceneId: string): Readonly<Record<string, unknown>> | null {
  const result = inspectExactRecord(value, [
    'id',
    'sceneId',
    'sourceOutputAId',
    'artworkId',
    'onlyArtworkChanges',
    'sourceContentHash',
    'status',
    'promptText',
    'generatedAt',
    'promptHash',
    'renderHash',
    'sourceHash',
    'contentHash',
    'promptMeta',
  ]);
  if (!result.ok) return null;
  const record = result.value;
  if (
    !string(record.id) ||
    record.sceneId !== sceneId ||
    !string(record.sourceOutputAId) ||
    !string(record.artworkId) ||
    record.onlyArtworkChanges !== true ||
    !string(record.sourceContentHash) ||
    !outputStatuses.has(String(record.status)) ||
    !string(record.promptText) ||
    !(record.generatedAt === null || string(record.generatedAt)) ||
    !string(record.promptHash) ||
    !(record.renderHash === null || string(record.renderHash)) ||
    !string(record.sourceHash) ||
    !string(record.contentHash) ||
    !validPromptMeta(record.promptMeta)
  )
    return null;
  return record;
}

function inspectScene(value: unknown): Readonly<Record<string, unknown>> | null {
  const result = inspectExactRecord(value, [
    'id',
    'sessionId',
    'templateId',
    'productId',
    'locationId',
    'lightingId',
    'decorIds',
    'propIds',
    'cameraId',
    'compositionId',
    'poseId',
    'displayMethod',
    'paletteColorId',
    'seasonId',
    'printAreaRulesRef',
    'view',
    'dedupSignature',
    'outputA',
    'outputB',
    'sceneVersion',
    'sceneHash',
    'sceneFingerprint',
  ]);
  if (!result.ok) return null;
  const record = result.value;
  const strings = [
    'id',
    'sessionId',
    'templateId',
    'productId',
    'locationId',
    'lightingId',
    'cameraId',
    'compositionId',
    'poseId',
    'paletteColorId',
    'seasonId',
    'printAreaRulesRef',
    'sceneHash',
    'sceneFingerprint',
  ] as const;
  const decor = inspectDenseArray(record.decorIds);
  const props = inspectDenseArray(record.propIds);
  if (
    !strings.every((key) => string(record[key])) ||
    !decor.ok ||
    !uniqueStrings(decor.value) ||
    !props.ok ||
    !uniqueStrings(props.value) ||
    !methods.has(String(record.displayMethod)) ||
    !views.has(String(record.view)) ||
    !Number.isSafeInteger(record.sceneVersion) ||
    Number(record.sceneVersion) < 1
  )
    return null;
  const dedupResult = inspectExactRecord(record.dedupSignature, [
    'sceneTemplateId',
    'poseId',
    'cameraAngle',
    'compositionId',
    'hash',
  ]);
  if (!dedupResult.ok) return null;
  const dedup = dedupResult.value;
  if (
    !string(dedup.sceneTemplateId) ||
    !string(dedup.poseId) ||
    !cameraAngles.has(String(dedup.cameraAngle)) ||
    !string(dedup.compositionId) ||
    !string(dedup.hash)
  )
    return null;
  const outputA = inspectOutputA(record.outputA, String(record.id));
  if (!outputA) return null;
  const outputB =
    record.outputB === null ? null : inspectOutputB(record.outputB, String(record.id));
  if (record.outputB !== null && !outputB) return null;
  if (
    outputB &&
    (outputB.sourceOutputAId !== outputA.id ||
      outputB.sourceContentHash !== outputA.contentHash ||
      outputB.sourceHash !== outputA.promptHash)
  )
    return null;
  if (outputA.color !== record.paletteColorId || outputA.view !== record.view) return null;
  return record;
}

export function isValidScene(value: unknown): value is Scene {
  try {
    return inspectScene(value) !== null;
  } catch {
    return false;
  }
}

export type ValidatedSceneCollection = readonly Scene[] & {
  readonly __validatedScenes: unique symbol;
};
export function validateSceneCollection(
  value: unknown,
  includeOutputB?: boolean,
):
  | { readonly ok: true; readonly value: ValidatedSceneCollection }
  | { readonly ok: false; readonly failure: UiFailure } {
  try {
    const array = inspectDenseArray(value);
    if (!array.ok)
      return {
        ok: false,
        failure: failure(
          'INVALID_SCENE_RESULT',
          'scenes',
          'نتيجة المشاهد ليست مصفوفة كثيفة صالحة.',
        ),
      };
    if (array.value.length === 0)
      return {
        ok: false,
        failure: failure('INVALID_SCENE_RESULT', 'scenes', 'نتيجة المشاهد فارغة.'),
      };
    const ids = new Set<string>();
    for (let index = 0; index < array.value.length; index += 1) {
      const item = array.value[index];
      const inspected = inspectScene(item);
      if (!inspected)
        return {
          ok: false,
          failure: failure('INVALID_SCENE_RESULT', `scenes.${index}`, 'نتيجة مشهد غير صالحة.'),
        };
      const id = inspected.id as string;
      if (ids.has(id))
        return {
          ok: false,
          failure: failure('INVALID_SCENE_RESULT', `scenes.${index}.id`, 'معرّف مشهد مكرر.'),
        };
      ids.add(id);
      if (includeOutputB === true && inspected.outputB === null)
        return {
          ok: false,
          failure: failure(
            'INVALID_SCENE_RELATIONSHIP',
            `scenes.${index}.outputB`,
            'Output B مطلوب لكنه مفقود.',
          ),
        };
      if (includeOutputB === false && inspected.outputB !== null)
        return {
          ok: false,
          failure: failure(
            'INVALID_SCENE_RELATIONSHIP',
            `scenes.${index}.outputB`,
            'Output B غير مطلوب لهذه الجلسة.',
          ),
        };
    }
    const owned = ownValidatedClone(array.value);
    if (!owned.ok)
      return {
        ok: false,
        failure: failure('INVALID_SCENE_RESULT', 'scenes', 'تعذر امتلاك نتيجة المشاهد بأمان.'),
      };
    return { ok: true, value: owned.value as unknown as ValidatedSceneCollection };
  } catch {
    return {
      ok: false,
      failure: failure('INVALID_SCENE_RESULT', 'scenes', 'تعذر فحص نتيجة المشاهد بأمان.'),
    };
  }
}

function inspectPrompt(value: unknown): Readonly<Record<string, unknown>> | null {
  const result = inspectExactRecord(value, [
    'id',
    'sceneId',
    'kind',
    'sourceOutputAId',
    'sourceHash',
    'sourceContentHash',
    'artworkId',
    'promptText',
    'promptHash',
    'productId',
    'colorId',
    'view',
    'placement',
    'printAreaProfileId',
  ]);
  if (!result.ok) return null;
  const record = result.value;
  if (
    !string(record.id) ||
    !string(record.sceneId) ||
    !['A', 'B'].includes(String(record.kind)) ||
    !nullableString(record.sourceOutputAId) ||
    !nullableString(record.sourceHash) ||
    !nullableString(record.sourceContentHash) ||
    !nullableString(record.artworkId) ||
    !string(record.promptText) ||
    !string(record.promptHash) ||
    !string(record.productId) ||
    !string(record.colorId) ||
    !views.has(String(record.view)) ||
    !placements.has(String(record.placement)) ||
    !string(record.printAreaProfileId)
  )
    return null;
  const validRelationshipShape =
    record.kind === 'A'
      ? record.sourceOutputAId === null &&
        record.sourceHash === null &&
        record.sourceContentHash === null &&
        record.artworkId === null
      : record.sourceOutputAId !== null &&
        record.sourceHash !== null &&
        record.sourceContentHash !== null &&
        record.artworkId !== null;
  return validRelationshipShape ? record : null;
}

export function isValidPrompt(value: unknown): value is PromptViewModel {
  try {
    return inspectPrompt(value) !== null;
  } catch {
    return false;
  }
}

export type ValidatedPromptCollection = readonly PromptViewModel[] & {
  readonly __validatedPrompts: unique symbol;
};
export function validatePromptCollection(
  value: unknown,
  scenes: readonly Scene[],
  includeOutputB?: boolean,
):
  | { readonly ok: true; readonly value: ValidatedPromptCollection }
  | { readonly ok: false; readonly failure: UiFailure } {
  try {
    const array = inspectDenseArray(value);
    if (!array.ok)
      return {
        ok: false,
        failure: failure(
          'INVALID_PROMPT_RESULT',
          'prompts',
          'نتيجة البرومبتات ليست مصفوفة كثيفة صالحة.',
        ),
      };
    if (array.value.length === 0)
      return {
        ok: false,
        failure: failure('INVALID_PROMPT_RESULT', 'prompts', 'نتيجة البرومبتات فارغة.'),
      };
    const sceneMap = new Map<string, Scene>(scenes.map((scene) => [String(scene.id), scene]));
    const ids = new Set<string>();
    const kindsByScene = new Map<string, Set<string>>();
    for (let index = 0; index < array.value.length; index += 1) {
      const inspected = inspectPrompt(array.value[index]);
      if (!inspected)
        return {
          ok: false,
          failure: failure('INVALID_PROMPT_RESULT', `prompts.${index}`, 'نتيجة برومبت غير صالحة.'),
        };
      const id = inspected.id as string;
      const sceneId = inspected.sceneId as string;
      const kind = inspected.kind as 'A' | 'B';
      if (ids.has(id))
        return {
          ok: false,
          failure: failure('INVALID_PROMPT_RESULT', `prompts.${index}.id`, 'معرّف برومبت مكرر.'),
        };
      ids.add(id);
      const scene = sceneMap.get(sceneId);
      if (!scene)
        return {
          ok: false,
          failure: failure(
            'INVALID_PROMPT_RELATIONSHIP',
            `prompts.${index}.sceneId`,
            'البرومبت يشير إلى مشهد غير معتمد.',
          ),
        };
      if (
        inspected.productId !== scene.productId ||
        inspected.colorId !== scene.paletteColorId ||
        inspected.view !== scene.view ||
        inspected.printAreaProfileId !== scene.printAreaRulesRef
      )
        return {
          ok: false,
          failure: failure(
            'INVALID_PROMPT_RELATIONSHIP',
            `prompts.${index}`,
            'هوية البرومبت لا تطابق المشهد المعتمد.',
          ),
        };
      const seenKinds = kindsByScene.get(scene.id) ?? new Set<string>();
      if (seenKinds.has(kind))
        return {
          ok: false,
          failure: failure(
            'INVALID_PROMPT_RELATIONSHIP',
            `prompts.${index}.kind`,
            'نوع مخرج مكرر للمشهد.',
          ),
        };
      seenKinds.add(kind);
      kindsByScene.set(scene.id, seenKinds);
      if (kind === 'A') {
        if (
          id !== scene.outputA.id ||
          inspected.promptHash !== scene.outputA.promptHash ||
          inspected.promptText !== scene.outputA.promptText
        )
          return {
            ok: false,
            failure: failure(
              'INVALID_PROMPT_RELATIONSHIP',
              `prompts.${index}`,
              'Output A لا يطابق المشهد.',
            ),
          };
      } else {
        const b = scene.outputB;
        if (
          !b ||
          id !== b.id ||
          inspected.sourceOutputAId !== b.sourceOutputAId ||
          inspected.sourceHash !== b.sourceHash ||
          inspected.sourceContentHash !== b.sourceContentHash ||
          inspected.artworkId !== b.artworkId ||
          inspected.promptHash !== b.promptHash ||
          inspected.promptText !== b.promptText
        )
          return {
            ok: false,
            failure: failure(
              'INVALID_PROMPT_RELATIONSHIP',
              `prompts.${index}`,
              'Output B مزور أو غير متطابق.',
            ),
          };
      }
    }
    for (const scene of scenes) {
      const kinds = kindsByScene.get(scene.id);
      if (!kinds?.has('A'))
        return {
          ok: false,
          failure: failure('INVALID_PROMPT_RELATIONSHIP', 'prompts', 'Output A مفقود لمشهد معتمد.'),
        };
      if ((includeOutputB ?? scene.outputB !== null) && !kinds.has('B'))
        return {
          ok: false,
          failure: failure('INVALID_PROMPT_RELATIONSHIP', 'prompts', 'Output B مفقود لمشهد معتمد.'),
        };
      if (!(includeOutputB ?? scene.outputB !== null) && kinds.has('B'))
        return {
          ok: false,
          failure: failure('INVALID_PROMPT_RELATIONSHIP', 'prompts', 'Output B غير متوقع.'),
        };
    }
    const owned = ownValidatedClone(array.value);
    if (!owned.ok)
      return {
        ok: false,
        failure: failure('INVALID_PROMPT_RESULT', 'prompts', 'تعذر امتلاك نتيجة البرومبتات بأمان.'),
      };
    return { ok: true, value: owned.value as unknown as ValidatedPromptCollection };
  } catch {
    return {
      ok: false,
      failure: failure('INVALID_PROMPT_RESULT', 'prompts', 'تعذر فحص نتيجة البرومبتات بأمان.'),
    };
  }
}
