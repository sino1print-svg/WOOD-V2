import { PromptModuleType, type PromptModule, type PromptModuleId } from '../domain-model';

export const COVER_PROMPT_SECTIONS = Object.freeze([
  'Global Rules',
  'Source Image Lock',
  'Canvas',
  'Layout',
  'Metadata',
  'Typography',
  'Image Placement',
  'Color Strip',
  'Badges',
  'Final Rules',
] as const);

export const COVER_PROMPT_VARIABLES = Object.freeze([
  'minimalStudioRule',
  'sourceSaleImageIds',
  'gutterDirective',
  'layoutLabel',
  'layoutColumns',
  'layoutRows',
  'layoutDirective',
  'productName',
  'productCount',
  'seasonLabel',
  'audienceLabel',
  'mockupCount',
  'viewCount',
  'colorCount',
  'header',
  'title',
  'subtitle',
  'views',
  'footer',
  'digitalLine',
  'typographyDirective',
  'heroImageId',
  'supportImageIds',
  'colorStrip',
  'badges',
  'digitalBadgeRule',
] as const);

export type CoverPromptVariable = (typeof COVER_PROMPT_VARIABLES)[number];

export const COVER_PROMPT_TEMPLATE = `[Global Rules]
Create ONE single premium Etsy listing cover image. Output exactly one image.
No collage of NEW artwork; arrange only the provided Sale Images. No readable text on the garments.
Warm neutral background (soft beige / off-white / warm grey). Do NOT use a green background.
Soft, even lighting; avoid dark side shadows and heavy vignette. Clean, uncluttered, generous white space. {{minimalStudioRule}}

[Source Image Lock]
Use ONLY the attached blank Sale Images (Output A): {{sourceSaleImageIds}}.
Never use any Preview (Output B). Preserve every source image EXACTLY: do not regenerate, redraw, recolor, recrop important areas, stretch, or alter garments, faces, poses, lighting, folds, backgrounds, colors, or props.
Arrange the images only.

[Canvas]
Square listing canvas, warm neutral background, premium minimal aesthetic. Reserve proportional outer margins and {{gutterDirective}}; gutter proportion decreases mildly as the source count grows but never below legibility.

[Layout]
{{layoutLabel}} — grid {{layoutColumns}}x{{layoutRows}}; {{layoutDirective}}.
Large mockups dominate the canvas; the hero remains the largest image.

[Metadata]
Product: {{productName}} ({{productCount}} product(s)); Season: {{seasonLabel}}; Audience: {{audienceLabel}}; {{mockupCount}} mockups; {{viewCount}} views; {{colorCount}} colors.

[Typography]
Header: "{{header}}"; Main Title: "{{title}}"; Subtitle: "{{subtitle}}"; Views: "{{views}}"; Footer: "{{footer}}"; {{digitalLine}}Notice: "Designs shown are examples only"; Software: "Compatible with common image editors".
Typography scale = {{typographyDirective}}; title size scales mildly and inversely with source count. Keep typography SMALL relative to the images; use minimal text blocks and never invent brand claims. Fixed hierarchy: Header > Main Title > Subtitle > Views > Footer/Badges.

[Image Placement]
Hero = {{heroImageId}} (deterministic primary product/color/view match). Support images by priority: {{supportImageIds}}.
Priority: hero, support/on-model, detail, flat lay, folded, hanger, back view; then scene order and Output A id. Front/on-model images are larger; back/hanger images are smaller.

[Color Strip]
Bottom band, ordered swatches (primary first, then lexicographic): {{colorStrip}}.
Locked garment colors only. Keep the strip small and subordinate to the mockups.

[Badges]
Small badge group in deterministic canonical order: {{badges}}.{{digitalBadgeRule}}

[Final Rules]
Produce ONE cover image only. Preserve all Sale Images exactly. No green background. No dark side shadows.
No clutter. Large mockups, small text. Do NOT recreate or edit any mockup. Do not invent, duplicate, or omit source images.`;

/** Authoritative Phase 7 data-library module consumed explicitly by Cover Engine. */
export const COVER_PROMPT_MODULE: PromptModule = Object.freeze({
  id: 'cover-canonical-v1' as PromptModuleId,
  schemaVersion: 1,
  moduleType: PromptModuleType.Cover,
  template: COVER_PROMPT_TEMPLATE,
  variables: COVER_PROMPT_VARIABLES,
});
