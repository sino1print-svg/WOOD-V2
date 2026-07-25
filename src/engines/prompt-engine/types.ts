import type {
  Artwork,
  ColorId,
  Product,
  PromptMetadata,
  ResolvedConstraint,
  Scene,
  Season,
  Sha256,
  ValidationFailure,
} from '../../shared/domain-model';

export interface PromptResolvedText {
  readonly productDescription: string;
  readonly garmentColorName: string;
  readonly seasonDescription: string;
  readonly sceneDescription: string;
  readonly displayMethodDescription: string;
  readonly cameraCompositionDescription: string;
  readonly placementDescription: string;
  readonly viewDescription: string;
  readonly printAreaZone: string;
}

export interface PromptVersions {
  readonly templateVersion: string;
  readonly generatorVersion: string;
  readonly moduleVersion: string;
}

export interface PromptEngineBaseInput {
  readonly scene: Scene;
  readonly product: Product;
  readonly season: Season;
  readonly selectedColorIds: readonly ColorId[];
  readonly resolved: PromptResolvedText;
  readonly versions: PromptVersions;
  readonly generatedAt: string;
  readonly constraints?: readonly ResolvedConstraint[];
  readonly customNotes?: readonly string[];
}

export interface ComposeOutputAInput extends PromptEngineBaseInput {
  readonly outputNumber: number;
}

export interface ComposeOutputBInput extends PromptEngineBaseInput {
  readonly outputNumber: number;
  readonly sourceImageAttached: boolean;
  readonly artworkAttached: boolean;
  readonly artwork: Artwork;
}

export interface PromptComposition {
  readonly outputLabel: string;
  readonly promptText: string;
  readonly promptHash: Sha256;
  readonly promptMeta: PromptMetadata;
  readonly sections: readonly ['global', 'product', 'season', 'scene', 'output'];
}

export type PromptEngineResult =
  | { readonly ok: true; readonly value: PromptComposition }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };
