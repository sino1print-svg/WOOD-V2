import type { PromptResolvedText } from './types';
import {
  canonicalizePromptDataLine,
  containsPromptControlIntent,
} from '../../shared/prompt-canonical';

const MAX_TEXT = 8192;

const COMMON = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'behind',
  'beside',
  'by',
  'clean',
  'commercial',
  'dominant',
  'entirely',
  'for',
  'from',
  'in',
  'into',
  'natural',
  'near',
  'no',
  'of',
  'on',
  'only',
  'premium',
  'soft',
  'the',
  'through',
  'to',
  'with',
  'without',
]);

const FIELD_WORDS: Readonly<Record<keyof PromptResolvedText, ReadonlySet<string>>> = {
  productDescription: new Set([
    'blank',
    'classic',
    'crew',
    'neck',
    'crewneck',
    't',
    'shirt',
    'tee',
    'hoodie',
    'sweatshirt',
    'tank',
    'top',
    'polo',
    'raglan',
    'jersey',
    'cotton',
    'fabric',
    'garment',
    'product',
    'silhouette',
    'fit',
    'retail',
    'regular',
    'relaxed',
    'oversized',
    'fitted',
    'short',
    'long',
    'sleeve',
    'sleeves',
    'lightweight',
    'heavyweight',
    'smooth',
    'texture',
    'drape',
    'seamed',
    'side',
    'modern',
    'neckline',
    'apparel',
    'unisex',
    'women',
    'womens',
    'men',
    'mens',
    'kids',
    'child',
    'youth',
    'soft',
    'natural',
  ]),
  garmentColorName: new Set([
    'white',
    'black',
    'gray',
    'grey',
    'heather',
    'sand',
    'navy',
    'blue',
    'red',
    'green',
    'yellow',
    'orange',
    'purple',
    'pink',
    'beige',
    'cream',
    'brown',
    'charcoal',
    'ash',
    'forest',
    'maroon',
    'olive',
    'teal',
    'aqua',
    'coral',
    'gold',
    'silver',
    'natural',
    'ivory',
    'mustard',
    'lavender',
    'mint',
    'peach',
    'rose',
    'royal',
    'light',
    'dark',
    'vintage',
    'washed',
    'leaf',
    'stone',
  ]),
  seasonDescription: new Set([
    'halloween',
    'christmas',
    'valentine',
    'valentines',
    'spring',
    'summer',
    'autumn',
    'fall',
    'winter',
    'seasonal',
    'season',
    'setting',
    'studio',
    'mood',
    'lighting',
    'palette',
    'decor',
    'decoration',
    'decorations',
    'cozy',
    'warm',
    'cool',
    'festive',
    'romantic',
    'school',
    'beach',
    'holiday',
    'rustic',
    'neutral',
    'boutique',
    'minimal',
    'bright',
    'moody',
    'sunlit',
    'candlelit',
    'pastel',
    'earthy',
    'tones',
    'tone',
    'atmosphere',
    'ambience',
    'backdrop',
  ]),
  sceneDescription: new Set([
    'studio',
    'background',
    'backdrop',
    'wall',
    'walls',
    'floor',
    'room',
    'interior',
    'exterior',
    'outdoor',
    'indoor',
    'table',
    'wood',
    'wooden',
    'rustic',
    'neutral',
    'minimal',
    'boutique',
    'pumpkin',
    'pumpkins',
    'candle',
    'candles',
    'shelf',
    'shelves',
    'plant',
    'plants',
    'flowers',
    'props',
    'decor',
    'decoration',
    'decorations',
    'beach',
    'shoreline',
    'boardwalk',
    'shop',
    'picnic',
    'garage',
    'tools',
    'barbecue',
    'classroom',
    'desk',
    'books',
    'window',
    'curtain',
    'curtains',
    'lighting',
    'light',
    'shadows',
    'shadow',
    'sunlight',
    'candlelight',
    'mood',
    'atmosphere',
    'beige',
    'orange',
    'brown',
    'white',
    'black',
    'gray',
    'grey',
    'sand',
    'garment',
    'autumn',
    'halloween',
    'christmas',
    'valentine',
    'summer',
    'winter',
    'spring',
    'fall',
    'clean',
    'warm',
    'soft',
    'natural',
  ]),
  displayMethodDescription: new Set([
    'flat',
    'lay',
    'flatlay',
    'model',
    'wearing',
    'worn',
    'hanger',
    'hanging',
    'folded',
    'fold',
    'mannequin',
    'pedestal',
    'table',
    'display',
    'front',
    'back',
    'top',
    'down',
    'standing',
    'seated',
    'woman',
    'female',
    'man',
    'male',
    'girl',
    'boy',
    'child',
    'couple',
    'family',
    'torso',
    'close',
    'cropped',
    'crop',
  ]),
  cameraCompositionDescription: new Set([
    'camera',
    'composition',
    'angle',
    'front',
    'back',
    'side',
    'top',
    'down',
    'topdown',
    'eye',
    'level',
    'close',
    'closeup',
    'medium',
    'wide',
    'vertical',
    'horizontal',
    'centered',
    'symmetrical',
    'balanced',
    'cropped',
    'crop',
    'frame',
    'framing',
    'product',
    'garment',
    'dominant',
    'commercial',
    'portrait',
    'landscape',
    'three',
    'quarter',
    'straight',
    'overhead',
    'detail',
    'view',
  ]),
  placementDescription: new Set([
    'centered',
    'centre',
    'center',
    'left',
    'right',
    'upper',
    'lower',
    'front',
    'back',
    'chest',
    'sleeve',
    'pocket',
    'garment',
    'product',
    'placement',
    'position',
    'aligned',
    'middle',
    'printable',
    'area',
    'zone',
    'large',
    'visible',
  ]),
  viewDescription: new Set([
    'front',
    'back',
    'side',
    'three',
    'quarter',
    'view',
    'detail',
    'close',
    'closeup',
    'full',
    'rear',
    'profile',
    'angle',
    'top',
    'down',
    'overhead',
  ]),
  printAreaZone: new Set([
    'center',
    'centered',
    'front',
    'back',
    'chest',
    'upper',
    'lower',
    'sleeve',
    'left',
    'right',
    'pocket',
    'print',
    'printable',
    'area',
    'zone',
    'panel',
    'garment',
    'large',
    'visible',
  ]),
};

type SemanticEntity =
  | 'environment'
  | 'decor'
  | 'lighting'
  | 'mood'
  | 'garment'
  | 'artwork'
  | 'blank-state'
  | 'print-area'
  | 'output-structure'
  | 'unknown';

type SemanticPredicate =
  | 'spatial-reference'
  | 'located-on'
  | 'derived-from'
  | 'becomes'
  | 'contains'
  | 'negates'
  | 'modifies'
  | 'unknown';

interface ParsedClauseRelationship {
  readonly subject: SemanticEntity;
  readonly predicate: SemanticPredicate;
  readonly object: SemanticEntity;
  readonly category: 'allowed' | 'conflicting' | 'ambiguous';
}

const SCENE_ENTITIES = new Set([
  'decor',
  'decoration',
  'decorations',
  'pumpkin',
  'pumpkins',
  'candle',
  'candles',
  'props',
  'background',
  'backdrop',
  'scene',
  'environment',
  'wall',
  'walls',
  'room',
  'studio',
  'flowers',
  'plants',
  'tools',
  'books',
  'wood',
  'lighting',
  'light',
  'shadows',
  'shadow',
  'candlelight',
  'sunlight',
]);
const GARMENT_ENTITIES = new Set([
  'garment',
  'shirt',
  'tee',
  'tshirt',
  'hoodie',
  'sweatshirt',
  'top',
  'chest',
  'fabric',
  'product',
]);
const ARTWORK_ENTITIES = new Set([
  'artwork',
  'graphic',
  'motif',
  'visual',
  'design',
  'print',
  'printed',
  'logo',
  'image',
]);
const BLANK_ENTITIES = new Set(['blank', 'clean', 'unprinted', 'plain']);

// These sets are not permissive token lists. They are the complete predicate
// vocabulary of the closed relationship grammar. A relationship containing an
// unclassified predicate is ambiguous and is rejected.
const SAFE_SCENE_REFERENCE_PREDICATES = new Set(['behind', 'beside', 'near']);
const LOCATION_PREDICATES = new Set(['on', 'onto', 'across', 'over', 'upon', 'inside', 'within']);
const DERIVATION_PREDICATES = new Set([
  'from',
  'becomes',
  'become',
  'carries',
  'carry',
  'contributes',
  'contribute',
  'serves',
  'serve',
  'as',
]);
const NEGATION_PREDICATES = new Set([
  'no',
  'without',
  'not',
  'non',
  'never',
  'already',
  'preprinted',
  'printed',
  'decorated',
  'finished',
  'completed',
]);
const RELATION_CONNECTORS = new Set([
  ...SAFE_SCENE_REFERENCE_PREDICATES,
  ...LOCATION_PREDICATES,
  ...DERIVATION_PREDICATES,
  ...NEGATION_PREDICATES,
  'in',
  'into',
  'through',
  'with',
  'to',
  'of',
  'at',
  'by',
]);

function entityOf(token: string): SemanticEntity {
  if (SCENE_ENTITIES.has(token))
    return token.includes('light') || token.includes('shadow') ? 'lighting' : 'decor';
  if (GARMENT_ENTITIES.has(token)) return 'garment';
  if (ARTWORK_ENTITIES.has(token)) return 'artwork';
  if (BLANK_ENTITIES.has(token)) return 'blank-state';
  if (token === 'area' || token === 'zone' || token === 'printable') return 'print-area';
  return 'unknown';
}

function predicateOf(token: string): SemanticPredicate {
  if (SAFE_SCENE_REFERENCE_PREDICATES.has(token)) return 'spatial-reference';
  if (LOCATION_PREDICATES.has(token)) return 'located-on';
  if (DERIVATION_PREDICATES.has(token)) return token === 'from' ? 'derived-from' : 'becomes';
  if (NEGATION_PREDICATES.has(token)) return 'negates';
  return 'unknown';
}

function nearestEntity(
  entities: readonly SemanticEntity[],
  start: number,
  direction: -1 | 1,
): SemanticEntity {
  for (let index = start; index >= 0 && index < entities.length; index += direction) {
    const entity = entities[index]!;
    if (entity !== 'unknown') return entity;
  }
  return 'unknown';
}

function parseRelationship(tokens: readonly string[]): ParsedClauseRelationship {
  const entities = tokens.map(entityOf);
  const entityIndexes = entities
    .map((entity, index) => ({ entity, index }))
    .filter(({ entity }) => entity !== 'unknown');

  if (entityIndexes.length < 2) {
    return { subject: 'unknown', predicate: 'unknown', object: 'unknown', category: 'ambiguous' };
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!RELATION_CONNECTORS.has(token)) continue;
    const subject = nearestEntity(entities, index - 1, -1);
    const object = nearestEntity(entities, index + 1, 1);
    if (subject === 'unknown' || object === 'unknown') continue;

    const predicate = predicateOf(token);
    if (predicate === 'unknown') {
      // Connectors wholly inside one descriptive scene domain do not define a
      // cross-domain relationship. Cross-domain use of an unclassified
      // connector is ambiguous and must fail.
      const sceneSubject =
        subject === 'decor' || subject === 'environment' || subject === 'lighting';
      const sceneObject = object === 'decor' || object === 'environment' || object === 'lighting';
      if (sceneSubject && sceneObject) continue;
      return { subject, predicate, object, category: 'ambiguous' };
    }

    // Relationships wholly inside the scene-description domain are allowed;
    // they cannot affect garment, artwork, print area, or output structure.
    if (
      (subject === 'decor' || subject === 'environment' || subject === 'lighting') &&
      (object === 'decor' || object === 'environment' || object === 'lighting')
    ) {
      continue;
    }

    // The only allowed cross-domain Scene→Garment relationship is a safe
    // spatial reference that keeps scene content behind/beside/near the garment.
    if (
      (subject === 'decor' || subject === 'environment' || subject === 'lighting') &&
      object === 'garment'
    ) {
      return {
        subject,
        predicate,
        object,
        category: predicate === 'spatial-reference' ? 'allowed' : 'conflicting',
      };
    }

    // No scene content may become artwork, garment content, or print-area content.
    if (
      (subject === 'decor' || subject === 'environment' || subject === 'lighting') &&
      (object === 'artwork' || object === 'print-area')
    ) {
      return { subject, predicate, object, category: 'conflicting' };
    }

    // Reverse cross-domain relationships are unsupported and therefore fail.
    if (
      subject === 'garment' &&
      (object === 'decor' ||
        object === 'environment' ||
        object === 'lighting' ||
        object === 'artwork')
    ) {
      return { subject, predicate, object, category: 'conflicting' };
    }

    if (subject === 'artwork' && object !== 'artwork') {
      return { subject, predicate, object, category: 'conflicting' };
    }

    if (subject === 'garment' && object === 'blank-state') {
      return {
        subject,
        predicate,
        object,
        category: predicate === 'negates' ? 'conflicting' : 'ambiguous',
      };
    }

    // Any other fully observed relationship has no matrix entry.
    return { subject, predicate, object, category: 'ambiguous' };
  }

  // Two or more semantic entities without an explicit classified predicate are
  // ambiguous. There is deliberately no descriptive fallback.
  return {
    subject: entityIndexes[0]!.entity,
    predicate: 'unknown',
    object: entityIndexes[1]!.entity,
    category: 'ambiguous',
  };
}

function relationshipAllowed(field: keyof PromptResolvedText, tokens: readonly string[]): boolean {
  const entities = tokens.map(entityOf);
  const hasGarment = entities.includes('garment');
  const hasArtwork = entities.includes('artwork');
  const hasBlank = entities.includes('blank-state');
  const hasScene = entities.some(
    (entity) => entity === 'decor' || entity === 'environment' || entity === 'lighting',
  );

  if (field === 'sceneDescription') {
    // Ordinary scene-only clauses are accepted by the field grammar. Any
    // cross-domain clause must match the single explicit safe relationship.
    if (!hasGarment && !hasArtwork && !entities.includes('print-area')) return hasScene;
    return parseRelationship(tokens).category === 'allowed';
  }

  if (field === 'productDescription') {
    if (!hasGarment && !hasBlank) return false;
    if (hasArtwork) return false;
    if (tokens.some((token) => NEGATION_PREDICATES.has(token)) && hasBlank) return false;

    // Product descriptions may affirm blankness in ordinary descriptive
    // grammar. Every semantic negation is rejected above; no positive blank
    // assertion needs an executable relationship.
    return true;
  }

  // Other resolved fields are already closed by their dedicated field
  // vocabularies and do not expose scene/product relationship grammar.
  return true;
}

export interface CanonicalResolvedData {
  readonly resolved: PromptResolvedText;
  readonly customNotes: readonly string[];
}

function canonicalLine(value: string): string | null {
  return canonicalizePromptDataLine(value, MAX_TEXT);
}

function splitClauses(value: string): readonly string[] {
  return value
    .split(/[.!?;،؛。！？]+/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function words(value: string): readonly string[] {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function allowedClause(field: keyof PromptResolvedText, clause: string): boolean {
  const tokens = words(clause);
  if (tokens.length === 0) return false;
  const allowed = FIELD_WORDS[field];
  let fieldTokenCount = 0;
  for (const token of tokens) {
    if (COMMON.has(token)) continue;
    if (allowed.has(token)) {
      fieldTokenCount += 1;
      continue;
    }
    // Product/color identifiers can contain digits, but arbitrary cardinality prose cannot.
    if (/^\d{3,5}$/u.test(token) && field === 'productDescription') continue;
    return false;
  }
  return fieldTokenCount > 0 && relationshipAllowed(field, tokens);
}

export function canonicalizeResolvedField(
  field: keyof PromptResolvedText,
  raw: string,
): string | null {
  const line = canonicalLine(raw);
  if (line === null || line.length === 0) return null;
  const retained = splitClauses(line).filter((clause) => allowedClause(field, clause));
  if (retained.length === 0) return null;
  return retained.join('. ') + (/[.!?]$/u.test(line) ? '.' : '');
}

function encodeOpaqueNote(raw: string): string | null {
  const line = canonicalLine(raw);
  if (line === null) return null;
  if (line.length === 0) return '';
  // Notes are encoded and never interpreted, but known direct control prose is
  // still rejected to preserve the established public validation contract.
  if (containsPromptControlIntent(line)) return null;
  const bytes = new TextEncoder().encode(line);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `opaque-note:utf8-hex:${hex}`;
}

export function canonicalizeCustomNotes(
  customNotes: readonly string[] | undefined,
): readonly string[] | null {
  const encoded = (customNotes ?? []).map(encodeOpaqueNote);
  if (encoded.some((value) => value === null)) return null;
  return [...new Set(encoded.filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

export function canonicalizeResolvedData(
  resolved: PromptResolvedText,
  customNotes: readonly string[] | undefined,
): CanonicalResolvedData | null {
  const canonical: Record<keyof PromptResolvedText, string> = {
    productDescription: '',
    garmentColorName: '',
    seasonDescription: '',
    sceneDescription: '',
    displayMethodDescription: '',
    cameraCompositionDescription: '',
    placementDescription: '',
    viewDescription: '',
    printAreaZone: '',
  };
  for (const field of Object.keys(canonical) as (keyof PromptResolvedText)[]) {
    const value = canonicalizeResolvedField(field, resolved[field]);
    if (value === null) return null;
    canonical[field] = value;
  }

  const notes = canonicalizeCustomNotes(customNotes);
  if (notes === null) return null;
  return { resolved: canonical, customNotes: notes };
}
