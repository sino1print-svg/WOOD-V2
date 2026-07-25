/**
 * Output Pair Planning — §17. Every Scene always gets a blank Output A (§17.1).
 * Output B is created only when an artwork exists for the scene's product; when it
 * doesn't yet, `outputB` is `null` (DM `Scene.outputB: OutputB | null`) and a
 * non-blocking `RULE_PRV_001` warning is reported — Scene *planning* is not itself
 * blocked by a not-yet-uploaded artwork; only later *generation* is (§17.2 ordering).
 */
import type {
  ArtworkId,
  ColorId,
  GarmentView,
  OutputA,
  OutputAId,
  OutputB,
  OutputBId,
  SceneId,
  Sha256,
  ValidationFailure,
} from '../../shared/domain-model';
import { OutputStatus } from '../../shared/domain-model';
import { sceneFailureFromCode } from './failures';
import { stableHash } from './hashing';

export function planOutputA(
  sceneId: SceneId,
  id: OutputAId,
  garment: string,
  color: ColorId,
  view: GarmentView,
): OutputA {
  const contentHash = stableHash({ kind: 'outputA-pending', sceneId });
  return Object.freeze({
    id,
    sceneId,
    garment,
    color,
    view,
    status: OutputStatus.Pending,
    forbidden: ['artwork', 'logo', 'watermark', 'typography'] as const,
    promptText: '',
    contentHash,
    generatedAt: null,
    promptHash: contentHash,
    renderHash: null,
    promptMeta: null,
  });
}

export interface OutputBPlanResult {
  readonly outputB: OutputB | null;
  readonly warning: ValidationFailure | null;
}

export function planOutputB(
  sceneId: SceneId,
  id: OutputBId,
  sourceOutputAId: OutputAId,
  sourceContentHash: Sha256,
  artworkId: ArtworkId | undefined,
): OutputBPlanResult {
  if (!artworkId) {
    return {
      outputB: null,
      warning: sceneFailureFromCode('RULE_PRV_001', `scene[${sceneId}].outputB`),
    };
  }
  const contentHash = stableHash({ kind: 'outputB-pending', sceneId, artworkId });
  return {
    outputB: Object.freeze({
      id,
      sceneId,
      sourceOutputAId,
      artworkId,
      onlyArtworkChanges: true as const,
      sourceContentHash,
      status: OutputStatus.Pending,
      promptText: '',
      generatedAt: null,
      promptHash: contentHash,
      renderHash: null,
      sourceHash: sourceContentHash,
      contentHash,
      promptMeta: null,
    }),
    warning: null,
  };
}
