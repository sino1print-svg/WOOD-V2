const DEFAULT_MAX_TEXT = 8192;
const STRUCTURAL_CONTROL = /[{}<>`]/u;
const INVISIBLE_CONTROL = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const HEADING_PREFIX = /^\s*(?:#{1,6}|>|-{3,}|={3,}|\*{3,})/u;
const CONTROL_HEADING = /^\s*[\p{L}_][\p{L}\p{N}_ -]{0,80}\s*:\s*\S/iu;
const QUOTED_BLOCK = /^\s*["'“”‘’].*["'“”‘’]\s*$/u;

const CONTROL_DIRECTIVE =
  /\b(?:ignore|generate|create|produce|replace|discard|remove|override|disable|enable|draw|redraw|use)\b|(?:تجاهل|أنشئ|انشئ|ولّد|ولد|استبدل|احذف|ارسم|استخدم)/iu;
const CONTROL_TARGET =
  /\b(?:images?|outputs?|artwork|design|collage|grid|prompt|instructions?|shirt)\b|(?:صور|صورة|مخرجات|تصميم|كولاج|برومبت|تعليمات|قميص)/iu;
const RESERVED_DIRECTIVE =
  /\b(?:disregard|make|output|emit|return|render|omit|duplicate|reopen|close|add|append|insert|include|write|follow|obey|allow|permit|place|bypass)\b|(?:تخط|كرّر|كرر|أضف|اضف|اكتب|اتبع|اسمح|ضع)/iu;
const RESERVED_TARGET =
  /\b(?:covers?|mandatory[-_\s]+instructions?|requirements?|output[-_\s]+requirements?|rules?|final[-_\s]+rules?|sections?|headings?|constraints?|source[-_\s]+lock|backgrounds?|garments?|badges?|typography|sale[-_\s]+images?|previews?|mockups?|colors?|faces?|poses?|lighting|props?)\b|(?:غلاف|أغلفة|اغلفة|متطلبات|قواعد|أقسام|اقسام|عناوين|قيود|خلفية|ملابس|شارات)/iu;
const RESERVED_CARDINALITY =
  /\b(?:(?:exactly\s+)?(?:2|3|4|5|two|three|four|five|multiple|several|pair|double|additional|another|extra))\s+(?:images?|outputs?|covers?)\b|(?:صورتين|صورتان|صور\s+متعددة|مخرجات\s+متعددة|غلافين|أغلفة\s+متعددة|اغلفة\s+متعددة|صورة\s+إضافية|صورة\s+اضافية)/iu;
const RESERVED_SECTION_NAME =
  /^(?:global rules|source image lock|canvas|layout|metadata|typography|image placement|color strip|badges|final rules)$/iu;

/**
 * Canonical single-line data boundary shared by prompt-producing engines.
 * It is deliberately structural only: field-specific semantic grammars remain
 * with their owning engines.
 */
export function canonicalizePromptDataLine(
  value: string,
  maximum = DEFAULT_MAX_TEXT,
): string | null {
  if (value.length > maximum) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return null;
    }
  }
  const normalized = value.normalize('NFKC').replace(/\r\n?/gu, '\n');
  if (normalized.includes('\n') || normalized.includes('\t')) return null;
  if (
    INVISIBLE_CONTROL.test(normalized) ||
    STRUCTURAL_CONTROL.test(normalized) ||
    normalized.includes('[') ||
    normalized.includes(']')
  ) {
    return null;
  }
  if (
    HEADING_PREFIX.test(normalized) ||
    CONTROL_HEADING.test(normalized) ||
    QUOTED_BLOCK.test(normalized)
  ) {
    return null;
  }
  return normalized.replace(/\s+/gu, ' ').trim();
}

/** True when a data value attempts to behave like prompt control text. */
export function containsPromptControlIntent(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return CONTROL_DIRECTIVE.test(normalized) && CONTROL_TARGET.test(normalized);
}

/** Stricter closed-world intent boundary for canonical cover-prompt data. */
export function containsReservedPromptControlIntent(value: string): boolean {
  const normalized = value.normalize('NFKC');
  const normalizedSection = normalized.trim().replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ');
  const directive = CONTROL_DIRECTIVE.test(normalized) || RESERVED_DIRECTIVE.test(normalized);
  const target = CONTROL_TARGET.test(normalized) || RESERVED_TARGET.test(normalized);
  return (
    RESERVED_SECTION_NAME.test(normalizedSection) ||
    containsPromptControlIntent(normalized) ||
    (directive && target) ||
    RESERVED_CARDINALITY.test(normalized)
  );
}
