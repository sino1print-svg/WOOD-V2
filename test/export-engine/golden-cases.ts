import type { ExportFormatterInput } from '../../src/export';
import { createFormatterFixture, createMultiSceneFormatterFixture } from './formatter-fixtures';
import { CANONICAL_SCOPES } from './fixtures';

export const GOLDEN_CASE_NAMES = [
  'simple-session-a-only',
  'scene-a-and-b',
  'multiple-scenes-numbering',
  'multiple-groups',
  'cover-present',
  'partial-with-omission',
  'arabic-text',
  'emoji-unicode',
  'leading-trailing-whitespace',
  'blank-lines',
  'source-crlf',
  'markdown-fences',
  'empty-optional-sections',
  'large-valid-prompt',
  'hostile-metadata-legitimate-prompt',
] as const;

export type GoldenCaseName = (typeof GOLDEN_CASE_NAMES)[number];

export interface GoldenCase {
  readonly name: GoldenCaseName;
  readonly input: ExportFormatterInput;
}

/**
 * Reviewed formatter inputs. Expected bytes live in a separate immutable
 * digest manifest; no test can rewrite that manifest.
 */
export function createGoldenCases(): readonly GoldenCase[] {
  return [
    {
      name: 'simple-session-a-only',
      input: createFormatterFixture({
        omitOutputB: true,
        groupPrompt: null,
        omitCover: true,
      }),
    },
    {
      name: 'scene-a-and-b',
      input: createFormatterFixture({ scope: CANONICAL_SCOPES[2] }),
    },
    {
      name: 'multiple-scenes-numbering',
      input: createMultiSceneFormatterFixture(),
    },
    {
      name: 'multiple-groups',
      input: createMultiSceneFormatterFixture(),
    },
    {
      name: 'cover-present',
      input: createFormatterFixture({ scope: CANONICAL_SCOPES[6] }),
    },
    {
      name: 'partial-with-omission',
      input: createFormatterFixture({ omitOutputB: true }),
    },
    {
      name: 'arabic-text',
      input: createFormatterFixture({
        promptA: 'أنشئ صورة بيع ثابتة للمنتج مع الحفاظ على النص العربي حرفيًا.',
      }),
    },
    {
      name: 'emoji-unicode',
      input: createFormatterFixture({
        promptA: 'Preserve emoji 🎨🧵✨ and distinct Unicode e\u0301 / é.',
      }),
    },
    {
      name: 'leading-trailing-whitespace',
      input: createFormatterFixture({
        promptA: '   leading whitespace\ncontent line\ntrailing whitespace   ',
      }),
    },
    {
      name: 'blank-lines',
      input: createFormatterFixture({
        promptA: 'first line\n\n\nsecond line\n\n',
      }),
    },
    {
      name: 'source-crlf',
      input: createFormatterFixture({
        promptA: 'first\r\nsecond\rlast\n',
      }),
    },
    {
      name: 'markdown-fences',
      input: createFormatterFixture({
        promptA: '```markdown\n# Heading\n````\n~~~html\n<div>literal</div>\n~~~',
      }),
    },
    {
      name: 'empty-optional-sections',
      input: createFormatterFixture({
        scope: CANONICAL_SCOPES[0],
        groupPrompt: null,
        omitCover: true,
      }),
    },
    {
      name: 'large-valid-prompt',
      input: createFormatterFixture({
        promptA: `large-begin\n${'x'.repeat(64 * 1024)}\nlarge-end`,
      }),
    },
    {
      name: 'hostile-metadata-legitimate-prompt',
      input: createFormatterFixture({
        ownerRef: 'apiKey=RUNTIME-METADATA-MUST-NOT-LEAK',
        promptA:
          'Keep these legitimate prompt words exactly: secret apiKey bearer password file:///home/user.',
      }),
    },
  ];
}
