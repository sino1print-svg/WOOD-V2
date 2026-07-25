import {
  Audience,
  GarmentView,
  PromptModuleType,
  SeasonKind,
  type ColorId,
  type CoverMetadata,
  type PromptModule,
} from '../../shared/domain-model';
import { canonicalizePromptDataLine } from '../../shared/prompt-canonical';
import {
  COVER_PROMPT_MODULE,
  COVER_PROMPT_SECTIONS,
  COVER_PROMPT_TEMPLATE,
  COVER_PROMPT_VARIABLES,
  type CoverPromptVariable,
} from '../../shared/prompt-modules';
import type { CoverEngineInput, CoverLayoutPlan, CoverSourceImage } from './types';
import { exactKeys, hasOwn, isDenseArray, isPlainRecord } from './runtime';
import {
  canonicalCoverFields,
  containsCoverPromptControlConflict,
  findCrossFieldSemanticConflict,
} from './semantic-conflict';

const MODULE_KEYS = ['id', 'schemaVersion', 'moduleType', 'template', 'variables'] as const;
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu;
const SECTION = /^\[([^\]\r\n]+)\]$/gmu;

export type CoverPromptModuleIssue = 'metadata' | 'template' | null;

function sameOrderedValues(left: readonly unknown[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function moduleTokens(template: string): readonly string[] | null {
  const found = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]!);
  const stripped = template.replace(PLACEHOLDER, '');
  if (stripped.includes('{{') || stripped.includes('}}')) return null;
  return found;
}

function sections(template: string): readonly string[] {
  return [...template.matchAll(SECTION)].map((match) => match[1]!);
}

/** Closed-world validation for the authoritative Cover PromptModule boundary. */
export function validateCoverPromptModule(value: unknown): CoverPromptModuleIssue {
  if (!isPlainRecord(value) || exactKeys(value, MODULE_KEYS)) return 'metadata';
  if (
    value.id !== COVER_PROMPT_MODULE.id ||
    value.schemaVersion !== COVER_PROMPT_MODULE.schemaVersion ||
    value.moduleType !== PromptModuleType.Cover ||
    typeof value.template !== 'string' ||
    !isDenseArray(value.variables, COVER_PROMPT_VARIABLES.length) ||
    hasOwn(value, 'constraintsRef')
  ) {
    return 'metadata';
  }
  if (
    !sameOrderedValues(value.variables, COVER_PROMPT_VARIABLES) ||
    !sameOrderedValues(sections(value.template), COVER_PROMPT_SECTIONS)
  ) {
    return 'template';
  }
  const found = moduleTokens(value.template);
  if (
    found === null ||
    !sameOrderedValues(found, COVER_PROMPT_VARIABLES) ||
    new Set(found).size !== found.length ||
    value.template !== COVER_PROMPT_TEMPLATE
  ) {
    return 'template';
  }
  return null;
}

export type CoverPromptValues = Readonly<Record<CoverPromptVariable, string>>;

export interface CoverPromptContext {
  readonly input: CoverEngineInput;
  readonly metadata: CoverMetadata;
  readonly plan: CoverLayoutPlan;
  readonly orderedSources: readonly CoverSourceImage[];
  readonly colorOrder: readonly ColorId[];
}

function audienceLabel(audience: Audience): string {
  const labels: Readonly<Record<Audience, string>> = {
    [Audience.Kids]: 'Kids',
    [Audience.Adult]: 'Adult',
    [Audience.Unisex]: 'Unisex',
    [Audience.Teen]: 'Teen',
    [Audience.All]: 'All Audiences',
  };
  return labels[audience];
}

function viewLabel(view: GarmentView): string {
  const labels: Readonly<Record<GarmentView, string>> = {
    [GarmentView.Front]: 'Front',
    [GarmentView.Back]: 'Back',
    [GarmentView.Side]: 'Side',
    [GarmentView.FlatDetail]: 'Detail',
  };
  return labels[view];
}

function layoutLabel(plan: CoverLayoutPlan): string {
  const labels = {
    single: 'Single',
    duo: 'Duo',
    triptych: 'Triptych',
    grid_2x2: 'Grid 2x2',
    grid_2x3: 'Grid 2x3',
    grid_3x3: 'Grid 3x3',
    mosaic: 'Mosaic',
  } as const;
  return labels[plan.layout];
}

function layoutDirective(plan: CoverLayoutPlan, count: number): string {
  const empty = plan.capacity - count;
  if (count === 1) return 'full-bleed hero; reserve no chrome over the garment';
  if (count === 2) return 'two equal large images';
  if (count === 3) return 'the center/first priority image is slightly larger';
  const hero =
    plan.heroSpan === '2x2'
      ? 'hero image occupies a 2x2 span at the RTL lead position (top-right)'
      : 'lead cell contains the hero image';
  const balance =
    empty > 0
      ? `; ${empty} trailing empty cell(s) are balanced by symmetric neighboring-cell enlargement; never invent or duplicate images`
      : '';
  return `${hero}; remaining Sale Images fill in RTL reading order by deterministic priority${balance}`;
}

function typographyDirective(count: number): string {
  if (count <= 4) return 'small tier';
  if (count <= 12) return 'smaller tier';
  if (count <= 30) return 'compact tier';
  return 'smallest large-bundle tier';
}

function gutterDirective(count: number): string {
  if (count <= 4) return 'standard generous gutters';
  if (count <= 12) return 'moderately reduced but generous gutters';
  if (count <= 30) return 'compact, clearly legible gutters';
  return 'minimum legible gutters for a large bundle';
}

/** Canonical badge ordering shared by prompt publication and composition metadata. */
export function coverBadges(digital: boolean): readonly string[] {
  const values = ['High Resolution', 'Premium Mockups'];
  if (digital) {
    values.push(
      'PNG Included',
      'Digital Download',
      'No Physical Item',
      'Editable',
      'Instant Download',
    );
  }
  values.push('Commercial Use');
  return Object.freeze(values);
}

function safeData(value: string, maximum = 512, allowMaterialCompound = false): string | null {
  const canonical = canonicalizePromptDataLine(value, maximum);
  return canonical === value &&
    !containsCoverPromptControlConflict(value, { allowMaterialCompound })
    ? value
    : null;
}

// Structural-only safety for composite display strings that concatenate two or more
// independently source-owned fields (e.g. header combines season.name and the
// primary product name). Those source fields already passed the authoritative
// per-field and pure-signal cross-field semantic-conflict checks above, against the
// correctly scoped canonical field set. Re-running the raw within-field
// windowedConflict grammar on the concatenation would false-positive on incidental
// cross-field token adjacency that the pure-signal design deliberately treats as
// safe (see semantic-conflict.ts, design note §4).
function safeCompositeLabel(value: string, maximum = 512): string | null {
  const canonical = canonicalizePromptDataLine(value, maximum);
  return canonical === value ? value : null;
}

function resolvePromptValues(context: CoverPromptContext): CoverPromptValues | null {
  const { input, metadata, plan, orderedSources, colorOrder } = context;
  if (
    input.project.isDigitalProduct !== metadata.digitalProductStatus ||
    orderedSources.length !== metadata.mockupCount ||
    colorOrder.length !== metadata.colors.length
  ) {
    return null;
  }
  // PromptModule-boundary revalidation: re-derive the canonical field set and
  // re-run both the per-field and cross-field semantic-conflict checks against the
  // *current* runtime input, rather than trusting that validateCoverInput already
  // ran (a caller invoking renderCoverPromptModule directly, or a forged/mutated
  // context, must be caught here too).
  const canonicalFields = canonicalCoverFields(input);
  if (
    canonicalFields.some((field) =>
      containsCoverPromptControlConflict(field.value, {
        allowMaterialCompound: /^products\[\d+\]\.name$/u.test(field.path),
      }),
    )
  ) {
    return null;
  }
  if (findCrossFieldSemanticConflict(canonicalFields) !== null) return null;

  const products = new Map(input.products.map((product) => [product.id, product.name]));
  const colors = new Map(input.lockedColors.map((color) => [color.id, color]));
  const primaryName = products.get(metadata.primaryProduct);
  if (!primaryName || safeData(primaryName, 256, true) === null) return null;

  const productName = metadata.productIds.length === 1 ? primaryName : `${primaryName} & More`;
  const seasonLabel = input.season.kind === SeasonKind.MinimalStudio ? 'Studio' : input.season.name;
  const countLabel = `${metadata.mockupCount} ${metadata.mockupCount === 1 ? 'Mockup' : 'Mockups'}`;
  const audience = audienceLabel(metadata.primaryAudience);
  const header = `${seasonLabel} — ${primaryName}`;
  const title = `${productName} Mockup Bundle — ${countLabel}`;
  const subtitle = `${seasonLabel} • ${audience}`;
  const views = metadata.views.map(viewLabel).join(' • ');
  const sourceIds = orderedSources.map((source) => source.output.id);
  const stripParts: string[] = [];
  for (const id of colorOrder) {
    const color = colors.get(id);
    if (!color || safeData(color.name, 256) === null) return null;
    stripParts.push(`${color.name} (${color.hex.toUpperCase()})`);
  }
  if (safeData(productName, 512, true) === null) return null;
  if (safeData(seasonLabel) === null) return null;
  if (safeCompositeLabel(header) === null) return null;
  if (safeData(title, 512, true) === null) return null;
  if (safeData(subtitle) === null) return null;
  if (safeData(views) === null) return null;
  for (const value of [...sourceIds, ...stripParts]) {
    if (safeData(value) === null) return null;
  }

  const digital = input.project.isDigitalProduct;
  const values: CoverPromptValues = {
    minimalStudioRule:
      input.season.kind === SeasonKind.MinimalStudio
        ? 'Minimal Studio uses the cleanest neutral styling with no seasonal decor.'
        : 'Use restrained season-appropriate cover chrome only; never add decor to a source image.',
    sourceSaleImageIds: sourceIds.join(', '),
    gutterDirective: gutterDirective(metadata.mockupCount),
    layoutLabel: layoutLabel(plan),
    layoutColumns: String(plan.columns),
    layoutRows: String(plan.rows),
    layoutDirective: layoutDirective(plan, metadata.mockupCount),
    productName,
    productCount: String(metadata.productIds.length),
    seasonLabel,
    audienceLabel: audience,
    mockupCount: String(metadata.mockupCount),
    viewCount: String(metadata.views.length),
    colorCount: String(metadata.colors.length),
    header,
    title,
    subtitle,
    views,
    footer: digital ? 'Digital Mockup Set' : 'Mockup Set',
    digitalLine: digital ? 'Digital line: "Digital Download — No Physical Item"; ' : '',
    typographyDirective: typographyDirective(metadata.mockupCount),
    heroImageId: sourceIds[0]!,
    supportImageIds: sourceIds.length > 1 ? sourceIds.slice(1).join(', ') : 'none',
    colorStrip: stripParts.join(', '),
    badges: coverBadges(digital).join(', '),
    digitalBadgeRule: digital
      ? ' Digital badges appear only because the authoritative project is digital.'
      : '',
  };
  return Object.freeze(values);
}

/**
 * Authoritative Cover PromptModule boundary. It owns variable resolution,
 * canonical section construction, and final publication of the prompt text.
 */
export function renderCoverPromptModule(
  module: PromptModule,
  context: CoverPromptContext,
): string | null {
  if (validateCoverPromptModule(module)) return null;
  const values = resolvePromptValues(context);
  if (!values) return null;
  let rendered = module.template;
  for (const variable of COVER_PROMPT_VARIABLES) {
    const value = values[variable];
    if (typeof value !== 'string' || value.includes('{{') || value.includes('}}')) return null;
    rendered = rendered.split(`{{${variable}}}`).join(value);
  }
  if (rendered.includes('{{') || rendered.includes('}}')) return null;
  if (!sameOrderedValues(sections(rendered), COVER_PROMPT_SECTIONS)) return null;
  return rendered;
}
