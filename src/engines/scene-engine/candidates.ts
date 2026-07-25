/**
 * Candidate Generator — §5 Scene Builder steps S1-S5, §6 candidate space, enumeration,
 * and impossible-combination rejection.
 *
 * `paletteColorId` (§14) and `view` (§15) are explicitly assigned *after* scene
 * ordering by deterministic round-robin / quota-filling — they are not part of the
 * candidate's identity here, which matches `DedupSignature` (DM §3.5): it is exactly
 * `(sceneTemplateId, poseId, cameraAngle, compositionId)`, with no color or view
 * component. Product legality of a view is enforced at assignment time (§15.2 V-6),
 * once each scene's concrete product is fixed.
 *
 * Engineering interpretation disclosed in PHASE9-IMPLEMENTATION-REPORT.md:
 * `decor*`/`props*` (§6.1, "possibly-empty sets") are modeled as "choose zero or one
 * representative item per candidate" rather than full power-set enumeration, to keep
 * the Cartesian product tractable while still respecting every compatibility,
 * exclusion, and requiredCompanion rule from the library-item contract (§4). A `none`
 * sentinel represents the empty case (e.g. Minimal Studio, RE §16).
 */
import type {
  CameraAngle,
  ControlledVocabularies,
  Product,
  VocabularyId,
} from '../../shared/domain-model';
import type {
  CameraId,
  CompositionId,
  DecorId,
  LightingId,
  LocationId,
  PoseId,
  ProductId,
  PropId,
  SceneTemplateId,
} from '../../shared/domain-model';
import { DisplayMethod } from '../../shared/domain-model';
import type { ConstraintIndex } from './constraints';
import { sceneFailureFromCode } from './failures';
import { stableHash } from './hashing';
import type { SceneCandidate, SceneLibrary, SceneLibraryItem } from './types';
import type { ValidationFailure } from '../../shared/domain-model';

const NONE_SENTINEL = '__none__' as VocabularyId;

/**
 * Single documented brand-narrowing boundary. A scene library's items are the
 * concrete location/pose/camera/… vocabulary terms; the domain model brands the base
 * `VocabularyTerm.id` generically as `VocabularyId` while the persisted `Scene`
 * (DM §3.5) brands each dimension specifically. This helper narrows at exactly one
 * place instead of scattering casts, and never widens or fabricates a value.
 */
function brand<T extends string>(id: string): T {
  return id as T;
}

/** Fail-closed safety cap on the raw enumerated space, before filtering (Runtime Safety). */
const MAX_RAW_CANDIDATE_SPACE = 500_000;

function compareLex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedById<T extends { readonly id: VocabularyId }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => compareLex(a.id, b.id));
}

function includesString(list: readonly string[], value: string): boolean {
  return list.includes(value);
}

function admits(
  item: SceneLibraryItem,
  season: string,
  audience: string,
  productKey: string,
): boolean {
  const seasonOk =
    item.seasonCompatibility === 'all' ||
    includesString(item.seasonCompatibility as readonly string[], season);
  const audienceOk =
    item.audienceCompatibility === 'all' ||
    includesString(item.audienceCompatibility as readonly string[], audience);
  const productOk =
    item.productCompatibility === 'all' ||
    includesString(item.productCompatibility as readonly string[], productKey);
  return seasonOk && audienceOk && productOk;
}

function admitsEither(
  item: SceneLibraryItem,
  season: string,
  audience: string,
  productId: string,
  productKind: string,
): boolean {
  return admits(item, season, audience, productId) || admits(item, season, audience, productKind);
}

/** Merge every dimension pool + templates into one lookup for exclusion/companion checks. */
export function buildItemIndex(library: SceneLibrary): ReadonlyMap<VocabularyId, SceneLibraryItem> {
  const index = new Map<VocabularyId, SceneLibraryItem>();
  for (const pool of [
    library.templates,
    library.locations,
    library.lightings,
    library.decors,
    library.props,
    library.cameras,
    library.compositions,
    library.poses,
  ]) {
    for (const item of pool) index.set(item.id, item);
  }
  return index;
}

export interface CandidateGenerationInput {
  readonly season: string;
  readonly audience: string;
  readonly productIds: readonly string[];
  readonly products: ReadonlyMap<string, Product>;
  readonly vocabularies: ControlledVocabularies;
  readonly library: SceneLibrary;
  readonly constraintIndex: ConstraintIndex;
  readonly seenDedupHashes: ReadonlySet<string>;
}

export type CandidateGenerationResult =
  | { readonly ok: true; readonly candidates: readonly SceneCandidate[] }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

export function generateCandidates(input: CandidateGenerationInput): CandidateGenerationResult {
  const { library, constraintIndex } = input;

  if (input.productIds.length === 0) {
    return {
      ok: false,
      failures: [
        sceneFailureFromCode('SE_INTERNAL_LIBRARY_GAP', 'session.productIds', {
          detail: 'no products selected',
        }),
      ],
    };
  }

  const templates = sortedById(library.templates);
  const locations = sortedById(library.locations);
  const lightings = sortedById(library.lightings);
  const decors = [{ id: NONE_SENTINEL } as SceneLibraryItem, ...sortedById(library.decors)];
  const props = [{ id: NONE_SENTINEL } as SceneLibraryItem, ...sortedById(library.props)];
  const cameras = sortedById(library.cameras) as readonly (SceneLibraryItem & {
    readonly angle: CameraAngle;
  })[];
  const compositions = sortedById(library.compositions);
  const poses = sortedById(library.poses);
  const sortedProductIds = [...input.productIds].sort(compareLex);
  const displayMethods = Object.values(DisplayMethod);

  const rawSpace =
    templates.length *
    sortedProductIds.length *
    locations.length *
    lightings.length *
    decors.length *
    props.length *
    cameras.length *
    compositions.length *
    poses.length *
    displayMethods.length;

  if (rawSpace > MAX_RAW_CANDIDATE_SPACE) {
    return {
      ok: false,
      failures: [
        sceneFailureFromCode('SE_INTERNAL_LIMIT', 'library', {
          detail: `raw candidate space ${rawSpace} exceeds safety limit ${MAX_RAW_CANDIDATE_SPACE}`,
        }),
      ],
    };
  }

  const candidates: SceneCandidate[] = [];

  for (const template of templates) {
    if (constraintIndex.isForbidden(template.id)) continue;

    for (const productId of sortedProductIds) {
      const product = input.products.get(productId);
      if (!product) continue;
      if (constraintIndex.isForbidden(productId)) continue;
      if (!admitsEither(template, input.season, input.audience, productId, product.kind)) continue;

      for (const location of locations) {
        if (constraintIndex.isForbidden(location.id)) continue;
        if (!admitsEither(location, input.season, input.audience, productId, product.kind))
          continue;

        for (const lighting of lightings) {
          if (constraintIndex.isForbidden(lighting.id)) continue;
          if (!admitsEither(lighting, input.season, input.audience, productId, product.kind))
            continue;

          for (const decor of decors) {
            if (decor.id !== NONE_SENTINEL) {
              if (constraintIndex.isForbidden(decor.id)) continue;
              if (!admitsEither(decor, input.season, input.audience, productId, product.kind))
                continue;
              if (decor.printAreaSafe === false) continue;
            }

            for (const prop of props) {
              if (prop.id !== NONE_SENTINEL) {
                if (constraintIndex.isForbidden(prop.id)) continue;
                if (!admitsEither(prop, input.season, input.audience, productId, product.kind))
                  continue;
                if (prop.printAreaSafe === false) continue;
              }

              for (const camera of cameras) {
                if (constraintIndex.isForbidden(camera.id)) continue;
                if (!admitsEither(camera, input.season, input.audience, productId, product.kind))
                  continue;

                for (const composition of compositions) {
                  if (constraintIndex.isForbidden(composition.id)) continue;
                  if (
                    !admitsEither(
                      composition,
                      input.season,
                      input.audience,
                      productId,
                      product.kind,
                    )
                  )
                    continue;

                  for (const pose of poses) {
                    if (constraintIndex.isForbidden(pose.id)) continue;
                    if (!admitsEither(pose, input.season, input.audience, productId, product.kind))
                      continue;

                    const chosen = [
                      template,
                      location,
                      lighting,
                      ...(decor.id === NONE_SENTINEL ? [] : [decor]),
                      ...(prop.id === NONE_SENTINEL ? [] : [prop]),
                      camera,
                      composition,
                      pose,
                    ];
                    const chosenIds = new Set(chosen.map((item) => item.id));

                    let impossible = false;
                    for (const item of chosen) {
                      for (const excludedId of item.exclusions) {
                        if (chosenIds.has(excludedId)) {
                          impossible = true;
                          break;
                        }
                      }
                      if (impossible) break;
                      for (const companionId of item.requiredCompanions) {
                        if (
                          !chosenIds.has(companionId) ||
                          constraintIndex.isForbidden(companionId)
                        ) {
                          impossible = true;
                          break;
                        }
                      }
                      if (impossible) break;
                    }
                    if (impossible) continue;

                    for (const displayMethod of displayMethods) {
                      if (constraintIndex.isForbidden(displayMethod)) continue;

                      const dedupHash = stableHash({
                        templateId: template.id,
                        poseId: pose.id,
                        cameraAngle: camera.angle,
                        compositionId: composition.id,
                      });
                      if (input.seenDedupHashes.has(dedupHash)) continue;

                      candidates.push({
                        templateId: brand<SceneTemplateId>(template.id),
                        productId: brand<ProductId>(productId),
                        locationId: brand<LocationId>(location.id),
                        lightingId: brand<LightingId>(lighting.id),
                        decorIds: decor.id === NONE_SENTINEL ? [] : [brand<DecorId>(decor.id)],
                        propIds: prop.id === NONE_SENTINEL ? [] : [brand<PropId>(prop.id)],
                        cameraId: brand<CameraId>(camera.id),
                        cameraAngle: camera.angle,
                        compositionId: brand<CompositionId>(composition.id),
                        poseId: brand<PoseId>(pose.id),
                        displayMethod,
                        dedupHash,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return { ok: true, candidates };
}

export function uniqueDedupSpaceSize(candidates: readonly SceneCandidate[]): number {
  return new Set(candidates.map((c) => c.dedupHash)).size;
}
