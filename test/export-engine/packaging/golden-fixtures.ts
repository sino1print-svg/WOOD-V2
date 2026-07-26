/**
 * Golden ZIP fixture inputs - EX section 9.5. Ten reviewed scenarios whose
 * byte digests are locked in `golden-digests.ts`. Changing a fixture here
 * without deliberately reviewing and updating that file will fail the golden
 * byte tests by design.
 */
import type { ArtworkId, Project, SceneId, SessionId } from '../../../src/shared/domain-model';
import type { ExportEngineInput } from '../../../src/shared/contracts';
import type { ExportPackageInput } from '../../../src/export/packaging';
import {
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
  createCanonicalMultiSceneExportInput,
} from '../fixtures';
import { createFormatterFixture, formatterInputFromEngine } from '../formatter-fixtures';
import {
  CANONICAL_CREATED_AT,
  CANONICAL_EXPORT_ID,
  CANONICAL_VERSIONS,
  packageInputFromFormatter,
} from './fixtures';

export const GOLDEN_ZIP_CASE_NAMES = [
  'single-output-a',
  'a-b-pair',
  'multi-scene-session',
  'arabic-project-name',
  'collision-heavy-names',
  'partial-with-omissions',
  'cover-included',
  'no-cover',
  'markdown-long-backtick-runs',
  'prompt-cr-crlf-nfc-nfd-emoji-trailing',
] as const;

export type GoldenZipCaseName = (typeof GOLDEN_ZIP_CASE_NAMES)[number];

export interface GoldenZipCase {
  readonly name: GoldenZipCaseName;
  readonly input: ExportPackageInput;
}

/**
 * Two scenes whose Output B artwork IDs differ only in case ("artwork-canonical"
 * vs "Artwork-Canonical") - distinct real IDs that collide once naming lowercases
 * and slugifies them, forcing the deterministic `_2` collision suffix.
 */
function collisionHeavyExportInput(): ExportEngineInput {
  const base = createCanonicalMultiSceneExportInput();
  const project: Project = structuredClone(base.source.project);
  const [existingArtworkId] = Object.keys(project.artworks) as ArtworkId[];
  const existingArtwork = project.artworks[existingArtworkId!]!;
  const collidingArtworkId = 'Artwork-Canonical' as ArtworkId;
  project.artworks = {
    ...project.artworks,
    [collidingArtworkId]: { ...existingArtwork, id: collidingArtworkId },
  };
  const session = project.sessions[CANONICAL_SESSION_ID]!;
  const secondSceneId = session.sceneOrder[1] as SceneId;
  const secondScene = session.scenes[secondSceneId]!;
  project.sessions = {
    ...project.sessions,
    [CANONICAL_SESSION_ID as SessionId]: {
      ...session,
      scenes: {
        ...session.scenes,
        [secondSceneId]: {
          ...secondScene,
          outputB: { ...secondScene.outputB!, artworkId: collidingArtworkId },
        },
      },
    },
  };
  return {
    ...base,
    source: { ...base.source, project },
    scope: CANONICAL_SCOPES[9],
  };
}

export function createGoldenZipCases(): readonly GoldenZipCase[] {
  return [
    {
      name: 'single-output-a',
      input: packageInputFromFormatter(
        createFormatterFixture({
          scope: CANONICAL_SCOPES[0],
          omitOutputB: true,
          groupPrompt: null,
          omitCover: true,
        }),
      ),
    },
    {
      name: 'a-b-pair',
      input: packageInputFromFormatter(createFormatterFixture({ scope: CANONICAL_SCOPES[2] })),
    },
    {
      name: 'multi-scene-session',
      input: packageInputFromFormatter(
        formatterInputFromEngine(createCanonicalMultiSceneExportInput()),
      ),
    },
    {
      name: 'arabic-project-name',
      input: packageInputFromFormatter(createFormatterFixture({ scope: CANONICAL_SCOPES[9] })),
    },
    {
      name: 'collision-heavy-names',
      input: packageInputFromFormatter(formatterInputFromEngine(collisionHeavyExportInput())),
    },
    {
      name: 'partial-with-omissions',
      input: packageInputFromFormatter(createFormatterFixture({ omitOutputB: true })),
    },
    {
      name: 'cover-included',
      input: packageInputFromFormatter(createFormatterFixture({ scope: CANONICAL_SCOPES[6] })),
    },
    {
      name: 'no-cover',
      input: packageInputFromFormatter(createFormatterFixture({ omitCover: true })),
    },
    {
      name: 'markdown-long-backtick-runs',
      input: packageInputFromFormatter(
        createFormatterFixture({
          promptA: '```markdown\n# Heading\n````\n~~~html\n<div>literal</div>\n~~~',
        }),
      ),
    },
    {
      name: 'prompt-cr-crlf-nfc-nfd-emoji-trailing',
      input: packageInputFromFormatter(
        createFormatterFixture({
          promptA: 'first\r\nsecond\rthird\n café(NFC:é) café(NFD:é) emoji 🎨 trailing   ',
        }),
      ),
    },
  ];
}

export { CANONICAL_CREATED_AT, CANONICAL_EXPORT_ID, CANONICAL_VERSIONS };
