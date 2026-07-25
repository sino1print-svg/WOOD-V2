/**
 * Scene Engine — main orchestration. Implements the full pipeline (§2):
 * [1] rule filtering (candidates.ts, via ConstraintIndex)
 * [2] candidate generation (candidates.ts)
 * [3] scoring (scoring.ts)
 * [4] duplicate elimination (candidates.ts dedup-aware generation + run-local hash guard)
 * [5] scene ordering (greedy score order = sceneOrder)
 * [6]/[7] Output A/B assignment (outputs.ts)
 * [8] group generation (groups.ts)
 * [9] cover preparation (cover-metadata.ts)
 *
 * Pure leaf module: no persistence, UI, network, filesystem, time, or randomness.
 */
import type {
  ColorId,
  GarmentView,
  OutputAId,
  OutputBId,
  Product,
  Scene,
  SceneId,
  ValidationFailure,
} from '../../shared/domain-model';
import { GroupBy } from '../../shared/domain-model';
import { buildConstraintIndex } from './constraints';
import { buildItemIndex, generateCandidates, uniqueDedupSpaceSize } from './candidates';
import { assignColors } from './colors';
import {
  buildMoodAnchor,
  createDiversityLedger,
  computeDiversitySignature,
  recordDiversityUsage,
} from './diversity';
import { extendDedupLedger } from './dedup';
import { sceneFailureFromCode } from './failures';
import { planGroups } from './groups';
import { prepareCoverMetadata } from './cover-metadata';
import { stableHash } from './hashing';
import { planOutputA, planOutputB } from './outputs';
import { compareScored, scoreCandidate } from './scoring';
import { computeSessionSizeProfile } from './sizing';
import { validateSceneEngineInput } from './validation';
import { assignViews } from './views';
import type {
  SceneCandidate,
  SceneEngineInput,
  SceneEngineResult,
  SceneEnginePlan,
  SceneEngineEvent,
} from './types';

export function planScenes(input: SceneEngineInput): SceneEngineResult {
  const inputFailures = validateSceneEngineInput(input);
  if (inputFailures.length > 0) return { ok: false, failures: inputFailures };

  const products = new Map(input.products.map((p) => [p.id, p] as const));
  const constraintIndex = buildConstraintIndex(input.constraints);
  const itemIndex = buildItemIndex(input.library);
  const seenDedupHashes = new Set(input.dedupLedger.seen);

  // [1] rule filtering + [2] candidate generation
  const generation = generateCandidates({
    season: input.session.season,
    audience: input.session.audience,
    productIds: input.session.productIds,
    products: products as ReadonlyMap<string, Product>,
    vocabularies: input.vocabularies,
    library: input.library,
    constraintIndex,
    seenDedupHashes,
  });
  if (!generation.ok) return { ok: false, failures: generation.failures };

  // §6.4 feasibility pre-check — halt before assignment if infeasible.
  const uniqueSpace = uniqueDedupSpaceSize(generation.candidates);
  if (uniqueSpace < input.session.requestedSceneCount) {
    return {
      ok: false,
      failures: [
        sceneFailureFromCode('RULE_CNT_001', 'session.requestedSceneCount', {
          detail: `unique space ${uniqueSpace} < requested ${input.session.requestedSceneCount}`,
        }),
      ],
    };
  }

  const moodAnchor = buildMoodAnchor(
    input.session.colorSelection,
    input.session.productIds,
    input.library,
    deriveSeasonMoodTags(input.library),
  );
  const diversityLedger = createDiversityLedger(generation.candidates, itemIndex);

  // [3]-[5] greedy deterministic selection: score → pick best → update diversity → repeat.
  const remaining = [...generation.candidates];
  const selected: SceneCandidate[] = [];
  const runSeenHashes = new Set<string>();
  const target = input.session.requestedSceneCount;

  while (selected.length < target && remaining.length > 0) {
    const scored = remaining.map((candidate) =>
      scoreCandidate(candidate, {
        itemIndex,
        products: products as ReadonlyMap<string, Product>,
        moodAnchor,
        observePrintArea: input.observePrintArea,
        diversityLedger,
        requestedSceneCount: target,
      }),
    );
    scored.sort(compareScored);
    const best = scored[0]!;
    selected.push(best.candidate);
    runSeenHashes.add(best.candidate.dedupHash);

    const signature = computeDiversitySignature(best.candidate, itemIndex);
    recordDiversityUsage(diversityLedger, signature);

    // Remove the picked candidate and any other candidate sharing its hard dedup hash
    // (§8.1 — no two scenes may repeat the same (template, pose, camera, composition)).
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (remaining[i]!.dedupHash === best.candidate.dedupHash) remaining.splice(i, 1);
    }
  }

  if (selected.length < target) {
    return {
      ok: false,
      failures: [
        sceneFailureFromCode('RULE_CNT_001', 'session.requestedSceneCount', {
          detail: 'selection exhausted candidate space before reaching requested count',
        }),
      ],
    };
  }

  // §10.1 hero/support split — greedy score-first order already yields hero-quality scenes first.
  const sizeProfile = computeSessionSizeProfile(target);

  // §15 view assignment
  const viewSlots = selected.map((candidate, index) => ({
    isHero: index < sizeProfile.heroCount,
    allowedViews: products.get(candidate.productId)!.allowedViews,
  }));
  const viewResult = assignViews(viewSlots);
  if (!viewResult.ok) return { ok: false, failures: viewResult.failures };

  // §14 color assignment
  const colors = assignColors(selected.length, input.session.colorSelection.colorIds);

  // §6/§17 build final Scene + Output A/B objects
  const warnings: ValidationFailure[] = [];
  const scenes: Scene[] = [];
  const events: SceneEngineEvent[] = [];

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index]!;
    const product = products.get(candidate.productId)!;
    const view = viewResult.views[index]! as GarmentView;
    const colorId = colors[index]! as ColorId;
    const sceneId = deriveSceneId(input.session.sessionId, candidate.dedupHash, index);

    const sceneFingerprint = stableHash({
      templateId: candidate.templateId,
      productId: candidate.productId,
      locationId: candidate.locationId,
      lightingId: candidate.lightingId,
      decorIds: candidate.decorIds,
      propIds: candidate.propIds,
      cameraId: candidate.cameraId,
      compositionId: candidate.compositionId,
      poseId: candidate.poseId,
      displayMethod: candidate.displayMethod,
      colorId,
      view,
      seasonId: input.session.season,
    });

    const outputAId = `${sceneId}-A` as OutputAId;
    const outputBId = `${sceneId}-B` as OutputBId;
    const outputA = planOutputA(sceneId, outputAId, product.name, colorId, view);
    const artworkId = input.artworkIdsByProduct?.get(candidate.productId);
    const outputBPlan = planOutputB(sceneId, outputBId, outputAId, outputA.contentHash, artworkId);
    if (outputBPlan.warning) warnings.push(outputBPlan.warning);

    const sceneCore = {
      id: sceneId,
      sessionId: input.session.sessionId,
      templateId: candidate.templateId,
      productId: candidate.productId,
      locationId: candidate.locationId,
      lightingId: candidate.lightingId,
      decorIds: candidate.decorIds,
      propIds: candidate.propIds,
      cameraId: candidate.cameraId,
      compositionId: candidate.compositionId,
      poseId: candidate.poseId,
      displayMethod: candidate.displayMethod,
      paletteColorId: colorId,
      seasonId: input.session.season,
      printAreaRulesRef: product.printAreaProfile.id,
      view,
      dedupSignature: {
        sceneTemplateId: candidate.templateId,
        poseId: candidate.poseId,
        cameraAngle: candidate.cameraAngle,
        compositionId: candidate.compositionId,
        hash: candidate.dedupHash,
      },
      outputA,
      outputB: outputBPlan.outputB,
      sceneVersion: 1,
    };

    const sceneHash = stableHash(sceneCore);
    scenes.push(Object.freeze({ ...sceneCore, sceneHash, sceneFingerprint }) as Scene);
    events.push({ type: 'SceneCreated', sceneId, sceneFingerprint });
  }

  const sceneOrder = scenes.map((s) => s.id);
  const scenesById = new Map(scenes.map((s) => [s.id, s] as const));

  // [8] group generation
  const groups = planGroups(
    input.session.sessionId,
    sceneOrder,
    scenesById,
    input.session.groupBy ?? GroupBy.Product,
  );

  // [9] cover preparation (metadata only — never build the cover here, §19.1)
  const coverMetadata = prepareCoverMetadata(
    scenes,
    input.session.season,
    input.session.isDigitalProduct,
    input.session.audience,
  );

  const dedupLedger = extendDedupLedger(
    input.dedupLedger,
    scenes.map((s) => s.dedupSignature.hash),
    uniqueSpace,
  );

  const plan: SceneEnginePlan = {
    scenes,
    sceneOrder,
    groups,
    coverMetadata,
    generationProgress: {
      totalScenes: scenes.length,
      outputAGenerated: 0,
      outputBGenerated: 0,
      coverGenerated: false,
      allOutputAReady: false,
    },
    dedupLedger,
    events,
  };

  return { ok: true, value: plan, warnings };
}

function deriveSceneId(sessionId: string, dedupHash: string, index: number): SceneId {
  return `${sessionId}-scene-${index}-${dedupHash.slice(0, 12)}` as SceneId;
}

/**
 * Season mood tags (§9.2, §13) are not yet a discrete typed field on `Season` in the
 * domain model (only `sceneLibraryRef`/`decorConstraints` etc.). Deriving them from the
 * most-frequent tags across the season's own hero-priority templates keeps this data-
 * driven (no season-name switch statement, §20) and deterministic.
 */
function deriveSeasonMoodTags(library: {
  readonly templates: readonly { readonly tags: readonly string[]; readonly priority: number }[];
}): readonly string[] {
  const heroTemplates = [...library.templates].sort((a, b) => b.priority - a.priority);
  const tagCounts = new Map<string, number>();
  for (const template of heroTemplates) {
    for (const tag of template.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  return [...tagCounts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tag]) => tag);
}
