import { containsReservedPromptControlIntent } from '../../shared/prompt-canonical';

/**
 * Deterministic, canonical token/lemma-based semantic-conflict grammar for the Cover
 * Engine (Phase 7 Third Corrective; closes P7-CORR-AUD-001 gaps found by two
 * independent adversarial audits).
 *
 * Design note (why token/lemma-based instead of more phrase regexes): the Second
 * Corrective's approach enumerated fixed *qualified* phrases ("final rules",
 * "mandatory instructions", ...) and fixed directional adjacency patterns. Both
 * independent audits found the same class of gap from two angles: (1) the bare,
 * unqualified concept ("rules", "requirements", "instructions", "lock") was never a
 * standalone alternative, so stripping the qualifying word bypassed detection
 * entirely; (2) sentence structures the fixed directional patterns didn't anticipate
 * (state-then-target with an intervening copula) bypassed detection too. Appending
 * more phrases only chases the next gap. Instead, this module:
 *
 * 1. Normalizes and tokenizes the value into a lemma stream (plurals, gerunds, and
 *    common inflections collapse to one canonical form per concept).
 * 2. Classifies each lemma as TARGET (a protected Cover-doctrine noun: lock, rule,
 *    requirement, instruction, constraint, canvas, background), QUALIFIER (a word
 *    that narrows a target without being one itself: source, final, mandatory,
 *    canonical, prompt, cover, output, required, image, sale), WEAKENING (a state or
 *    action that negates/voids/relaxes a constraint), or NEUTRAL.
 * 3. Flags a *within-field* conflict when a TARGET lemma and a WEAKENING lemma (token
 *    or fixed multi-word idiom, e.g. "carries no force") occur within a small token
 *    window of each other — order-agnostic by construction, which is what makes it
 *    robust to every required sentence structure (target-first, state-first, passive,
 *    modal, negated-observance) without one regex per structure.
 * 4. Flags a *cross-field* conflict by building the canonical ordered set of resolved
 *    Cover text fields and checking whether "pure-signal" fields (fields whose entire
 *    normalized content reduces to TARGET/QUALIFIER/WEAKENING vocabulary, with no
 *    unrelated content) collectively contain both a TARGET and a WEAKENING concept.
 *    Restricting cross-field combination to pure-signal fields is what keeps this safe
 *    against false positives: an ordinary product name that merely *contains* "rules"
 *    or "off" alongside unrelated words never participates in cross-field
 *    combination, only fields that are *entirely* built from the protected vocabulary
 *    (which no legitimate commercial metadata in the required safe-list is).
 *
 * Green-background/visual-doctrine and Arabic-language conflicts remain separate,
 * targeted checks (§ GREEN_BACKGROUND_*, § ARABIC_*) because "green" is not itself a
 * doctrine-protected concept — only "green" co-occurring with "background" is — and
 * Arabic morphology is not lemmatized by the same suffix rules as English.
 */

type Role = 'target' | 'qualifier' | 'weakening' | 'glue' | 'neutral';

const LEMMA_MAP: Readonly<Record<string, string>> = Object.freeze({
  lock: 'lock',
  locks: 'lock',
  locking: 'lock',
  rule: 'rule',
  rules: 'rule',
  requirement: 'requirement',
  requirements: 'requirement',
  constraint: 'constraint',
  constraints: 'constraint',
  instruction: 'instruction',
  instructions: 'instruction',
  canvas: 'canvas',
  background: 'background',
  backgrounds: 'background',
  source: 'source',
  final: 'final',
  mandatory: 'mandatory',
  canonical: 'canonical',
  prompt: 'prompt',
  cover: 'cover',
  covers: 'cover',
  output: 'output',
  outputs: 'output',
  required: 'required',
  image: 'image',
  images: 'image',
  sale: 'sale',
  sales: 'sale',
  warm: 'warm',
  neutral: 'neutral',
  disable: 'disable',
  disabled: 'disable',
  disables: 'disable',
  disabling: 'disable',
  deactivate: 'deactivate',
  deactivated: 'deactivate',
  deactivates: 'deactivate',
  inactive: 'inactive',
  off: 'off',
  optional: 'optional',
  void: 'void',
  voided: 'void',
  waive: 'waive',
  waived: 'waive',
  ignore: 'ignore',
  ignored: 'ignore',
  ignores: 'ignore',
  disregard: 'disregard',
  disregarded: 'disregard',
  disregards: 'disregard',
  bypass: 'bypass',
  bypassed: 'bypass',
  bypasses: 'bypass',
  override: 'override',
  overridden: 'override',
  overrides: 'override',
  overriding: 'override',
  cancel: 'cancel',
  cancelled: 'cancel',
  canceled: 'cancel',
  cancels: 'cancel',
  remove: 'remove',
  removed: 'remove',
  removes: 'remove',
  replace: 'replace',
  replaced: 'replace',
  replaces: 'replace',
  relax: 'relax',
  relaxed: 'relax',
  weaken: 'weaken',
  weakened: 'weaken',
  invalid: 'invalid',
  irrelevant: 'irrelevant',
  unenforced: 'unenforced',
  suspend: 'suspend',
  suspended: 'suspend',
  advisory: 'advisory',
  flexible: 'flexible',
  skip: 'skip',
  skipped: 'skip',
  omit: 'omit',
  omitted: 'omit',
  unnecessary: 'unnecessary',
  nonessential: 'nonessential',
  contradict: 'contradict',
  contradicted: 'contradict',
  suggestion: 'suggestion',
  suggestions: 'suggestion',
  suggested: 'suggestion',
  change: 'change',
  changes: 'change',
  changed: 'change',
  changing: 'change',
  carry: 'carry',
  carries: 'carry',
  turned: 'turn',
  turn: 'turn',
  switched: 'turn',
  the: 'the',
  a: 'the',
  an: 'the',
  of: 'the',
  is: 'be',
  are: 'be',
  was: 'be',
  were: 'be',
  be: 'be',
  been: 'be',
  no: 'no',
  not: 'not',
  never: 'not',
  dont: 'not',
  cannot: 'not',
  cant: 'not',
  shall: 'modal',
  should: 'modal',
  must: 'modal',
  can: 'modal',
  may: 'modal',
  does: 'modal',
  do: 'modal',
  need: 'modal',
  longer: 'longer',
  force: 'force',
  apply: 'apply',
  matter: 'apply',
  followed: 'observe',
  follow: 'observe',
  enforce: 'observe',
  enforced: 'observe',
  obey: 'observe',
  respect: 'observe',
  keep: 'observe',
  preserve: 'observe',
  merely: 'merely',
  just: 'merely',
});

const TARGET_LEMMAS = new Set([
  'lock',
  'rule',
  'requirement',
  'constraint',
  'instruction',
  'canvas',
  'background',
]);
const QUALIFIER_LEMMAS = new Set([
  'source',
  'final',
  'mandatory',
  'canonical',
  'prompt',
  'cover',
  'output',
  'required',
  'image',
  'sale',
  'warm',
  'neutral',
]);
const WEAKENING_LEMMAS = new Set([
  'disable',
  'deactivate',
  'inactive',
  'off',
  'optional',
  'void',
  'waive',
  'ignore',
  'disregard',
  'bypass',
  'override',
  'cancel',
  'remove',
  'replace',
  'relax',
  'weaken',
  'invalid',
  'irrelevant',
  'unenforced',
  'suspend',
  'advisory',
  'flexible',
  'skip',
  'omit',
  'unnecessary',
  'nonessential',
  'contradict',
  'suggestion',
  'change',
]);
const GLUE_LEMMAS = new Set([
  'the',
  'be',
  'no',
  'not',
  'modal',
  'longer',
  'turn',
  'force',
  'merely',
]);

function role(lemma: string | undefined): Role {
  if (!lemma) return 'neutral';
  if (TARGET_LEMMAS.has(lemma)) return 'target';
  if (QUALIFIER_LEMMAS.has(lemma)) return 'qualifier';
  if (WEAKENING_LEMMAS.has(lemma)) return 'weakening';
  if (GLUE_LEMMAS.has(lemma)) return 'glue';
  return 'neutral';
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenize(value: string): readonly string[] {
  const normalized = normalize(value);
  return normalized.length > 0 ? normalized.split(' ') : [];
}

function lemmatize(word: string): string {
  return LEMMA_MAP[word] ?? word;
}

function lemmaStream(value: string): readonly string[] {
  return tokenize(value).map(lemmatize);
}

const WEAKENING_PHRASES: readonly RegExp[] = [
  /\bnot required\b/u,
  /\bnot applicable\b/u,
  /\bmodal not apply\b/u,
  /\bnot apply\b/u,
  /\bcarry no force\b/u,
  /\bhave no force\b/u,
  /\bhas no force\b/u,
  /\bwithout force\b/u,
  /\bno longer required\b/u,
  /\bno effect\b/u,
  /\bnon binding\b/u,
  /\bnot observe\b/u,
  /\bnot modal observe\b/u,
];

const WINDOW = 6;

const MATERIAL_CONTAINER_NOUNS = new Set(['tote', 'totes', 'bag', 'bags', 'backpack', 'backpacks']);

function windowedConflict(lemmas: readonly string[], allowMaterialCompound: boolean): boolean {
  const targetIdx: number[] = [];
  const weakenIdx: number[] = [];
  lemmas.forEach((lemma, index) => {
    if (TARGET_LEMMAS.has(lemma)) {
      const isExemptCanvasMaterial =
        allowMaterialCompound &&
        lemma === 'canvas' &&
        MATERIAL_CONTAINER_NOUNS.has(lemmas[index + 1] ?? '');
      if (!isExemptCanvasMaterial) targetIdx.push(index);
    }
    if (WEAKENING_LEMMAS.has(lemma)) weakenIdx.push(index);
  });
  const joined = ` ${lemmas.join(' ')} `;
  for (const pattern of WEAKENING_PHRASES) {
    const match = pattern.exec(joined);
    if (match) {
      const startIndex = joined.slice(0, match.index).trim().split(/\s+/u).filter(Boolean).length;
      weakenIdx.push(Math.max(0, startIndex - 1));
    }
  }
  if (targetIdx.length === 0 || weakenIdx.length === 0) return false;
  for (const t of targetIdx) {
    for (const w of weakenIdx) {
      if (Math.abs(t - w) <= WINDOW) return true;
    }
  }
  return false;
}

const GREEN_BACKGROUND_PAIR = /(?:\bgreen\b.*\bbackground\b|\bbackground\b.*\bgreen\b)/u;
const BACKGROUND_FORCE =
  /\b(?:must|should|shall|required|mandatory|only|use|set|make|force|change|switch|render|paint|prefer|keep|stay|needs?|has to|please)\b/u;
const GREEN_BACKGROUND_EXPLICIT: readonly RegExp[] = [
  /\b(?:use|set|make|force|change|switch|require|render|paint)\s+(?:the\s+)?(?:canvas\s+)?background(?:\s+color)?(?:\s+(?:to|as|is))?\s+green\b/u,
  /\b(?:use|require|force|make|render)\s+(?:a\s+)?green\s+(?:canvas\s+)?background\b/u,
  /\b(?:canvas\s+)?background(?:\s+color)?\s+(?:is|must be|should be|shall be|has to be|needs to be|set to|changed to)\s+green\b/u,
  /\b(?:canvas\s+)?background\s+green\s+(?:is\s+)?(?:required|mandatory|enforced|the only option)\b/u,
  /\bgreen\s+(?:canvas\s+)?background\s+(?:is\s+)?(?:required|mandatory|enforced|the only option)\b/u,
  /\bonly\s+green\s+(?:canvas\s+)?background\b/u,
  /\bgreen\s+(?:canvas\s+)?background\s+only\b/u,
];

const SHADOW_CONFLICTS: readonly RegExp[] = [
  /\b(?:use|add|require|force|make|render)\s+dark\s+side\s+shadows?\b/u,
  /\bdark\s+side\s+shadows?\s+(?:(?:is|are)\s+)?(?:required|mandatory|enforced)\b/u,
  /\bside\s+shadows?\s+(?:must|should|shall|need to)\s+be\s+dark\b/u,
];

const ARABIC_TARGETS =
  '(?:قفل صور المصدر|قفل صورة المصدر|قفل المصدر|قفل الصور|قفل الصورة|القفل|القواعد النهائية|القواعد|التعليمات الإلزامية|التعليمات|تعليمات الغلاف|متطلبات اللوحة|المتطلبات|القيود)';
const ARABIC_STATES =
  '(?:معطل(?:ة)?|اختياري(?:ة)?|ملغى|ملغاة|باطل(?:ة)?|غير مطلوب(?:ة)?|غير ملزم(?:ة)?|يمكن تجاهله(?:ا)?|متوقف(?:ة)?|غير نشط(?:ة)?)';

const ARABIC_RULE_CONFLICTS: readonly RegExp[] = [
  new RegExp(`${ARABIC_TARGETS}\\s+(?:هو|هي|تكون|أصبحت|اصبحت)?\\s*${ARABIC_STATES}`, 'u'),
  new RegExp(
    `(?:عطل|عطّل|تجاهل|تخط|تخطى|ألغ|الغ|استبدل|ناقض|أوقف|اوقف)\\s+(?:ال)?${ARABIC_TARGETS}`,
    'u',
  ),
  /(?:استخدم|اجعل|غيّر|غير|افرض)\s+(?:ال)?خلفية\s+خضراء/u,
  /(?:ال)?خلفية\s+الخضراء\s+(?:مطلوبة|إلزامية|الزامية)/u,
];

/**
 * Cover-specific semantic control boundary for a single resolved/user-owned value.
 *
 * `allowMaterialCompound` narrowly permits "Canvas Tote" / "Canvas Bag" / "Canvas
 * Backpack" as an ordinary material-noun compound (bag material, not the protected
 * Cover-doctrine "canvas") — and only that adjacency. It must be passed only for
 * Product Name values (see validation.ts / prompt-module.ts call sites); every other
 * field (season, locked color, garment label) keeps the strict default. The
 * exception suppresses the TARGET role of that one, adjacently-matched 'canvas'
 * occurrence only — it never suppresses any other target or weakening word in the
 * same value, so a second 'canvas' not immediately followed by a container noun, or
 * any other protected concept (rule/constraint/instruction/lock/background/
 * requirement) combined with a weakening word anywhere else in the value, is still
 * detected normally.
 */
export function containsCoverPromptControlConflict(
  value: string,
  options?: { readonly allowMaterialCompound?: boolean },
): boolean {
  if (containsReservedPromptControlIntent(value)) return true;
  const normalized = normalize(value);
  if (
    GREEN_BACKGROUND_EXPLICIT.some((pattern) => pattern.test(normalized)) ||
    (GREEN_BACKGROUND_PAIR.test(normalized) && BACKGROUND_FORCE.test(normalized)) ||
    SHADOW_CONFLICTS.some((pattern) => pattern.test(normalized)) ||
    ARABIC_RULE_CONFLICTS.some((pattern) => pattern.test(value.normalize('NFKC')))
  ) {
    return true;
  }
  return windowedConflict(lemmaStream(value), options?.allowMaterialCompound ?? false);
}

const MAX_PURE_FIELD_TOKENS = 4;

function pureSignal(
  value: string,
): { readonly hasTarget: boolean; readonly hasWeakening: boolean } | null {
  const tokens = tokenize(value);
  if (tokens.length === 0 || tokens.length > MAX_PURE_FIELD_TOKENS) return null;
  let hasTarget = false;
  let hasWeakening = false;
  for (const token of tokens) {
    const lemma = lemmatize(token);
    const r = role(lemma);
    if (r === 'neutral') return null;
    if (r === 'target') hasTarget = true;
    if (r === 'weakening') hasWeakening = true;
  }
  return { hasTarget, hasWeakening };
}

export interface CanonicalCoverField {
  readonly path: string;
  readonly value: string;
}

// Structural (duck-typed) shape deliberately kept minimal and independent of
// `CoverEngineInput` so this module has no dependency on `./types` — both
// `validation.ts` and `prompt-module.ts` already depend on this module, and either
// of them depending on `./types` in turn would risk a circular import.
interface CanonicalFieldSource {
  readonly products?: unknown;
  readonly season?: unknown;
  readonly lockedColors?: unknown;
  readonly saleImages?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the canonical, fixed-order list of resolved Cover text fields that can
 * enter the PromptModule: products (array order), season, locked colors (array
 * order), then each source image's garment label (array order). Order is explicit
 * and never derived from `Object.keys`/enumeration, so field attribution is stable
 * regardless of how the input object was constructed. Used identically by the
 * runtime input validation boundary and the PromptModule revalidation boundary, so
 * both boundaries evaluate the exact same canonical scope on every invocation —
 * neither boundary trusts a previously validated object.
 */
export function canonicalCoverFields(input: CanonicalFieldSource): readonly CanonicalCoverField[] {
  const fields: CanonicalCoverField[] = [];
  if (Array.isArray(input.products)) {
    input.products.forEach((product: unknown, index: number) => {
      if (isRecord(product) && typeof product.name === 'string') {
        fields.push({ path: `products[${index}].name`, value: product.name });
      }
    });
  }
  if (isRecord(input.season) && typeof input.season.name === 'string') {
    fields.push({ path: 'season.name', value: input.season.name });
  }
  if (Array.isArray(input.lockedColors)) {
    input.lockedColors.forEach((color: unknown, index: number) => {
      if (isRecord(color) && typeof color.name === 'string') {
        fields.push({ path: `lockedColors[${index}].name`, value: color.name });
      }
    });
  }
  if (Array.isArray(input.saleImages)) {
    input.saleImages.forEach((source: unknown, index: number) => {
      const output = isRecord(source) ? source.output : undefined;
      if (isRecord(output) && typeof output.garment === 'string') {
        fields.push({ path: `saleImages[${index}].output.garment`, value: output.garment });
      }
    });
  }
  return fields;
}

/**
 * Evaluates the canonical ordered set of resolved Cover text fields for a
 * cross-field semantic conflict. Field order is fixed and explicit (never derived
 * from object key enumeration). Attribution: the first canonical field, in that
 * fixed order, among the two participating pure-signal fields.
 */
export function findCrossFieldSemanticConflict(
  fields: readonly CanonicalCoverField[],
): string | null {
  let firstTargetField: string | null = null;
  let firstWeakeningField: string | null = null;
  for (const field of fields) {
    const signal = pureSignal(field.value);
    if (!signal) continue;
    if (signal.hasTarget && firstTargetField === null) firstTargetField = field.path;
    if (signal.hasWeakening && firstWeakeningField === null) firstWeakeningField = field.path;
  }
  if (firstTargetField !== null && firstWeakeningField !== null) {
    const targetRank = fields.findIndex((f) => f.path === firstTargetField);
    const weakenRank = fields.findIndex((f) => f.path === firstWeakeningField);
    return targetRank <= weakenRank ? firstTargetField : firstWeakeningField;
  }
  return null;
}
