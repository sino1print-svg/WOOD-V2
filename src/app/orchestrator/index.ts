/**
 * Application Orchestrator — Phase 10.5 Runnable Application Integration.
 *
 * Wires the approved UI Engine controller to the real engines:
 * UI → Controller → Validation → Rule/Palette/Print-Area → Scene Engine →
 * Prompt Engine → typed Result DTO → UI. Pure and deterministic: no wall
 * clock, no randomness, no network. Failures are typed engine failures; no
 * error is swallowed and no stack trace reaches the UI.
 */
import {
  Audience,
  CameraAngle,
  EngineId,
  GroupBy,
  OutputStatus,
  RuleDomain,
  ValidationCheck,
  ValidationSeverity,
  type Artwork,
  type ArtworkId,
  type ColorId,
  type ProductId,
  type Scene,
  type SessionId,
  type ValidationFailure,
} from '../../shared/domain-model';
import {
  planScenes,
  type PrintAreaObserver,
  type SceneEngineInput,
} from '../../engines/scene-engine';
import { composeOutputA, composeOutputB } from '../../engines/prompt-engine';
import { resolvePaletteStage } from '../../engines/palette-engine';
import { UiController } from '../../ui-engine';
import type {
  PromptViewModel,
  ResolvedUiGenerationPlan,
  SessionDraft,
  UiEnginePorts,
} from '../../ui-engine';
import {
  APP_SESSION_ID,
  APP_PALETTE_LIBRARY,
  APP_SCENE_LIBRARY,
  APP_UI_CATALOG,
  CANONICAL_APP_TIME,
  PROMPT_VERSIONS,
  buildResolvedText,
  findDomainProduct,
  findDomainSeason,
} from '../catalog';

export { APP_UI_CATALOG } from '../catalog';

function appFailure(code: string, field: string, message: string): ValidationFailure {
  return {
    check: ValidationCheck.Products,
    field,
    code,
    message,
    severity: ValidationSeverity.Blocking,
    ruleId: null,
    priorityClass: null,
    domain: RuleDomain.Product,
    originEngine: EngineId.Orchestrator,
  };
}

/**
 * Domain-mapping validation: proves the draft resolves onto real catalog
 * entities before any engine runs, and that Output B has a real artwork.
 */
function validateDomainMapping(
  draft: SessionDraft,
  artwork: Artwork | null,
): readonly ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  if (draft.seasonId !== null && findDomainSeason(draft.seasonId) === null) {
    failures.push(
      appFailure('UI_SEASON_UNKNOWN', 'seasonId', 'الموسم المحدد غير موجود في بيانات التطبيق.'),
    );
  }
  for (const [index, product] of draft.products.entries()) {
    if (findDomainProduct(product.productId) === null) {
      failures.push(
        appFailure(
          'UI_PRODUCT_UNKNOWN',
          `products.${index}.productId`,
          'المنتج المحدد غير موجود في بيانات التطبيق.',
        ),
      );
    }
  }
  if (draft.includeOutputB && artwork === null) {
    failures.push(
      appFailure(
        'UI_ARTWORK_REQUIRED',
        'artwork',
        'معاينة B تتطلب رفع ملف الأعمال الفنية PNG أولًا.',
      ),
    );
  }
  return failures;
}

/**
 * Deterministic planned print-area observation. This is a pre-render planning
 * estimate (no pixels exist yet): a pure function of the candidate context
 * that favors unobstructed top-down/close framings, mirroring the Print-Area
 * Engine's planned-measurement semantics.
 */
export const plannedPrintAreaObserver: PrintAreaObserver = (context) => {
  const topDown = context.cameraAngle === CameraAngle.TopDown;
  const close = context.compositionId === 'cmp-detail';
  return {
    overlaps: [],
    sizeRatio: topDown ? 0.9 : close ? 0.7 : 0.5,
    centeringOffset: 0.05,
    shadowCoverage: 0.05,
  };
};

function sceneEngineInputFrom(
  plan: ResolvedUiGenerationPlan,
  artwork: Artwork | null,
): SceneEngineInput {
  const draft = plan.draft;
  const productIds = draft.products.map((product) => product.productId);
  const artworkIdsByProduct =
    draft.includeOutputB && artwork !== null
      ? new Map<ProductId, ArtworkId>(productIds.map((productId) => [productId, artwork.id]))
      : undefined;
  return {
    session: {
      sessionId: APP_SESSION_ID as SessionId,
      season: draft.seasonId!,
      audience: draft.audience ?? Audience.All,
      productIds,
      colorSelection: { colorIds: draft.colorIds, locked: false },
      requestedSceneCount: draft.targetCount,
      groupBy:
        draft.groupBy === 'color'
          ? GroupBy.Color
          : draft.groupBy === 'view'
            ? GroupBy.View
            : GroupBy.Product,
      isDigitalProduct: false,
    },
    constraints: [],
    products: draft.products.flatMap((product) => {
      const domain = findDomainProduct(product.productId);
      return domain === null ? [] : [domain];
    }),
    vocabularies: {
      locations: {},
      lightings: {},
      decors: {},
      props: {},
      compositions: {},
      poses: {},
      cameras: {},
    },
    library: APP_SCENE_LIBRARY,
    dedupLedger: { seen: [], combinationSpaceSize: 0 },
    observePrintArea: plannedPrintAreaObserver,
    ...(artworkIdsByProduct === undefined ? {} : { artworkIdsByProduct }),
  };
}

function composeSceneOutputs(
  scenes: readonly Scene[],
  draft: SessionDraft,
  artwork: Artwork | null,
):
  | { readonly ok: true; readonly value: readonly Scene[] }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] } {
  const composed: Scene[] = [];
  for (const [index, scene] of scenes.entries()) {
    const product = findDomainProduct(scene.productId);
    const season = findDomainSeason(scene.seasonId);
    if (product === null || season === null) {
      return {
        ok: false,
        failures: [
          appFailure('UI_SCENE_MAPPING_INVALID', `scenes.${index}`, 'تعذر ربط المشهد بالبيانات.'),
        ],
      };
    }
    const outputNumber = index + 1;
    const resolved = buildResolvedText(scene, draft.placement);
    const customNotes =
      draft.customSceneDescription.length > 0 ? [draft.customSceneDescription] : undefined;
    const base = {
      scene,
      product,
      season,
      selectedColorIds: draft.colorIds as readonly ColorId[],
      resolved,
      versions: PROMPT_VERSIONS,
      generatedAt: CANONICAL_APP_TIME,
      ...(customNotes === undefined ? {} : { customNotes }),
    };
    const composedA = composeOutputA({ ...base, outputNumber });
    if (!composedA.ok) return composedA;
    const aHash = composedA.value.promptHash;
    const outputA = {
      ...scene.outputA,
      status: OutputStatus.Generated,
      promptText: composedA.value.promptText,
      promptHash: aHash,
      contentHash: aHash,
      generatedAt: CANONICAL_APP_TIME,
      promptMeta: composedA.value.promptMeta,
    };

    if (scene.outputB === null) {
      composed.push({ ...scene, outputA, outputB: null });
      continue;
    }
    if (artwork === null) {
      return {
        ok: false,
        failures: [
          appFailure(
            'UI_ARTWORK_REQUIRED',
            `scenes.${index}.outputB`,
            'معاينة B تتطلب رفع ملف الأعمال الفنية PNG أولًا.',
          ),
        ],
      };
    }
    // Output B is composed from the *planned* scene (pending outputs, null
    // promptMeta) exactly as the Prompt Engine's input contract requires.
    const composedB = composeOutputB({
      ...base,
      outputNumber,
      sourceImageAttached: true,
      artworkAttached: true,
      artwork,
    });
    if (!composedB.ok) return composedB;
    const outputB = {
      ...scene.outputB,
      status: OutputStatus.Generated,
      promptText: composedB.value.promptText,
      promptHash: composedB.value.promptHash,
      contentHash: composedB.value.promptHash,
      sourceContentHash: aHash,
      sourceHash: aHash,
      generatedAt: CANONICAL_APP_TIME,
      promptMeta: composedB.value.promptMeta,
    };
    composed.push({ ...scene, outputA, outputB });
  }
  return { ok: true, value: composed };
}

function promptViewModelsFrom(
  scenes: readonly Scene[],
  draft: SessionDraft,
): readonly PromptViewModel[] {
  const prompts: PromptViewModel[] = [];
  for (const scene of scenes) {
    prompts.push({
      id: scene.outputA.id,
      sceneId: scene.id,
      kind: 'A',
      sourceOutputAId: null,
      sourceHash: null,
      sourceContentHash: null,
      artworkId: null,
      promptText: scene.outputA.promptText,
      promptHash: scene.outputA.promptHash,
      productId: scene.productId,
      colorId: scene.paletteColorId,
      view: scene.view,
      placement: draft.placement,
      printAreaProfileId: scene.printAreaRulesRef,
    });
    if (scene.outputB !== null) {
      prompts.push({
        id: scene.outputB.id,
        sceneId: scene.id,
        kind: 'B',
        sourceOutputAId: scene.outputB.sourceOutputAId,
        sourceHash: scene.outputB.sourceHash,
        sourceContentHash: scene.outputB.sourceContentHash,
        artworkId: scene.outputB.artworkId,
        promptText: scene.outputB.promptText,
        promptHash: scene.outputB.promptHash,
        productId: scene.productId,
        colorId: scene.paletteColorId,
        view: scene.view,
        placement: draft.placement,
        printAreaProfileId: scene.printAreaRulesRef,
      });
    }
  }
  return prompts;
}

/**
 * Real engine ports for the UI Engine controller. `artwork` is the registered
 * PNG artwork record required for Output B (null when none is uploaded).
 */
export function createEnginePorts(artwork: Artwork | null): UiEnginePorts {
  return {
    validation: {
      validate: (draft) => {
        const failures = validateDomainMapping(draft, artwork);
        return failures.length > 0 ? { ok: false, failures } : { ok: true, value: true };
      },
    },
    rule: {
      // No configurable rule sets ship with the production catalog yet, so the
      // resolved session-level constraint set is canonically empty. The Scene
      // and Prompt Engines receive this real (empty) constraint list.
      evaluate: () => ({ ok: true, value: [] }),
    },
    palette: {
      resolve: (draft) => {
        const resolved = resolvePaletteStage({
          selection: { colorIds: draft.colorIds, locked: false },
          library: APP_PALETTE_LIBRARY,
          constraints: [],
        });
        return resolved.ok
          ? { ok: true, value: resolved.value.colorIds }
          : { ok: false, failures: resolved.failures };
      },
    },
    printArea: {
      resolve: (draft) => {
        const primary = draft.products[0] ? findDomainProduct(draft.products[0].productId) : null;
        if (primary === null) {
          return {
            ok: false,
            failures: [
              appFailure('UI_PRODUCT_REQUIRED', 'products', 'اختر منتجًا واحدًا على الأقل.'),
            ],
          };
        }
        return { ok: true, value: { profileId: primary.printAreaProfile.id } };
      },
    },
    scene: {
      generate: (plan) => {
        const planned = planScenes(sceneEngineInputFrom(plan, artwork));
        if (!planned.ok) return { ok: false, failures: planned.failures };
        const composed = composeSceneOutputs(planned.value.scenes, plan.draft, artwork);
        if (!composed.ok) return { ok: false, failures: composed.failures };
        return { ok: true, value: composed.value };
      },
    },
    prompt: {
      generate: (scenes, plan) => ({
        ok: true,
        value: promptViewModelsFrom(scenes, plan.draft),
      }),
    },
  };
}

/** Official application controller over the real engine ports. */
export function createAppController(artwork: Artwork | null): UiController {
  return new UiController(createEnginePorts(artwork), APP_UI_CATALOG);
}
