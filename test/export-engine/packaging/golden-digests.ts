/**
 * Manually reviewed golden ZIP byte oracles - EX section 9.5.
 * There is deliberately no update command or write path in the test suite;
 * changing a fixture and updating these digests must be a deliberate,
 * reviewed decision, not an automatic snapshot refresh.
 *
 * Updated for the Batch 10.4 First Corrective:
 * - F2: single-output-a, partial-with-omissions, and cover-included no
 *   longer include a leaked prompt_pair entry (that scope/selection never
 *   selects both Output A and Output B for the scene).
 * - F5: manifest.json sourceFingerprints now carry the real source
 *   session/scene/cover hashes (plan.provenance) instead of a projectId
 *   fallback hash, changing every case's manifest/checksums/ZIP bytes.
 */
import type { GoldenZipCaseName } from './golden-fixtures';

export interface GoldenZipEntryDigest {
  readonly path: string;
  readonly kind: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface GoldenZipDigest {
  readonly entries: readonly GoldenZipEntryDigest[];
  readonly manifestSha256: string;
  readonly manifestByteLength: number;
  readonly checksumsSha256: string;
  readonly checksumsByteLength: number;
  readonly zipSha256: string;
  readonly zipByteLength: number;
}

export const GOLDEN_ZIP_DIGESTS: Readonly<Record<GoldenZipCaseName, GoldenZipDigest>> = {
  'single-output-a': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 415,
        sha256: 'c01a03274e6b3becdc381fb594e763a32002a1e095b838b17d04154ca1a4d569',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 472,
        sha256: '5f8d9f791b63d5b3300649cd3c8a3e3faf091456a8a7254c7c6128a7d23f9da6',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 1888,
        sha256: 'be653e2512e3f5646e60bacb820bfc79292359141fbd9332adf56c417aed1b99',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 220,
        sha256: '06fa0fb9a286a100e24db9f703056ff9169b762ff3f4bed768e28d9d9cac2076',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 138,
        sha256: '7a8398f8838de5277f190204f7fc7a96eb978f7796a4bd02b0ce4740e42661c3',
      },
      {
        path: 'project-001/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 55,
        sha256: '0e4221b4341e07f2f441fe1588c212986b66cfa227ebc51e5dde3940bef668f0',
      },
    ],
    manifestSha256: 'be653e2512e3f5646e60bacb820bfc79292359141fbd9332adf56c417aed1b99',
    manifestByteLength: 1888,
    checksumsSha256: '5f8d9f791b63d5b3300649cd3c8a3e3faf091456a8a7254c7c6128a7d23f9da6',
    checksumsByteLength: 472,
    zipSha256: '5c7a94d781e4cb2a6ee1fa463ecac97ac63b263bc3ee8a9db20c1ac812ab90b5',
    zipByteLength: 4116,
  },
  'a-b-pair': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 615,
        sha256: '4073c030dcf92e2df861629b0fc1050c6f6283fc24378d30238eb4ee3f1ba926',
      },
      {
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '9918c61821b63f1f6ad061e2edd17bc6cdc7bfb116569f09baaec537402fffdc',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 805,
        sha256: '9f06411ca36661dee3a7010f3a15e8fa8189ce55d6d891f83f9f0782ef481845',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 2725,
        sha256: 'dd4f98a36af662640119d293d489736bf082136e41b079f0c50c68f63db9d672',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 315,
        sha256: '32f2f62ea477e3dd6fcb011b204275624af0922e80be9e5da1be496670dd0ebb',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 138,
        sha256: '7a8398f8838de5277f190204f7fc7a96eb978f7796a4bd02b0ce4740e42661c3',
      },
      {
        path: 'project-001/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 55,
        sha256: '0e4221b4341e07f2f441fe1588c212986b66cfa227ebc51e5dde3940bef668f0',
      },
      {
        path: 'project-001/session-01/prompts/B/001_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'project-001/session-01/prompts/pairs/001_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 202,
        sha256: 'ed273017ccde6d1d999235f90e8617a8372a10587e619e082bd91d904abb6c42',
      },
    ],
    manifestSha256: 'dd4f98a36af662640119d293d489736bf082136e41b079f0c50c68f63db9d672',
    manifestByteLength: 2725,
    checksumsSha256: '9f06411ca36661dee3a7010f3a15e8fa8189ce55d6d891f83f9f0782ef481845',
    checksumsByteLength: 805,
    zipSha256: 'b801c0b1e8368018876bfb0009f2c42e6ab85c66cf05bd09dbf9c7307ba6928c',
    zipByteLength: 6738,
  },
  'multi-scene-session': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 3002,
        sha256: '0dd10131f051e69d16a599b6fda55f5974283a47d3e3a0038861bb819333e73a',
      },
      {
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '9918c61821b63f1f6ad061e2edd17bc6cdc7bfb116569f09baaec537402fffdc',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 1721,
        sha256: 'cda7e4d5a5f362e2437d2009b1f565bb558c8dfe7a9a53752803d0926bd755f9',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 5158,
        sha256: 'e0ae8821634fa83c64101b7cbb41218ba37fcaed7c67ff6927d38c2aa36e6d85',
      },
      {
        path: 'project-001/session-01/cover/cover-metadata.json',
        kind: 'cover_metadata',
        byteLength: 881,
        sha256: 'a38ae1526e554451ebfb604c5c47d1506efd39ba51ae4854b9db04daa7e065e2',
      },
      {
        path: 'project-001/session-01/cover/cover-prompt.txt',
        kind: 'cover_prompt',
        byteLength: 67,
        sha256: 'a74e77c7ff85ef9c8e02eaeaac9813507cf49d6c66085f1f73b517390c6fa7d0',
      },
      {
        path: 'project-001/session-01/execution-plan.txt',
        kind: 'execution_plan',
        byteLength: 434,
        sha256: '713b2d6c0028f66ac01f4eae238d5242a41b4f17848baeccc7b4dba7167c6ba3',
      },
      {
        path: 'project-001/session-01/groups/group-01.txt',
        kind: 'group_plan',
        byteLength: 23,
        sha256: '35458460b108d3a36b8af51cc1a2f24b0d54c3db74f85fa28afab7dddf4633b8',
      },
      {
        path: 'project-001/session-01/groups/group-02.txt',
        kind: 'group_plan',
        byteLength: 25,
        sha256: 'e405460bd0eea1ec3a38e44a5a697a7866dd440bb0c30c5a2fb90615cc93e061',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 774,
        sha256: '04cdb5a0f3c71786caf2ed063e4adf6213f18575c5248de698dfadec3c27f7aa',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 362,
        sha256: 'e059abd63032f936ae96316eab5275752f1cf604ecad9e21a7defd3adc31bfd4',
      },
      {
        path: 'project-001/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 47,
        sha256: '7bf7745f91b1a58496e3fe13aa7a5880f0e9ea10b68e87c37f3acd2407124a69',
      },
      {
        path: 'project-001/session-01/prompts/A/002_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 29,
        sha256: '347cf7d50ba2536938dc68a6f9d87a902d80d63fa75d72eb7c6c61ccc869f976',
      },
      {
        path: 'project-001/session-01/prompts/B/001_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'project-001/session-01/prompts/B/002_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'project-001/session-01/prompts/pairs/001_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 224,
        sha256: '535096b32e6724e23ba35439fde02fc3379caab7a9a4e71a1f0a3e6f6044c769',
      },
      {
        path: 'project-001/session-01/prompts/pairs/002_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 218,
        sha256: '6aa2753a673d526bbecaef3a626ba894cdd9bc122774017c94ef4cf821cbe7ab',
      },
      {
        path: 'project-001/session-01/session-summary.md',
        kind: 'session_summary',
        byteLength: 240,
        sha256: '35b595338a28d450d7e54dbbeb5a73ac3f8ccf2faffe155b918cc7602732fa3f',
      },
    ],
    manifestSha256: 'e0ae8821634fa83c64101b7cbb41218ba37fcaed7c67ff6927d38c2aa36e6d85',
    manifestByteLength: 5158,
    checksumsSha256: 'cda7e4d5a5f362e2437d2009b1f565bb558c8dfe7a9a53752803d0926bd755f9',
    checksumsByteLength: 1721,
    zipSha256: 'f1c097674253d00e1c193d01afdcb7238d95db40e2ec9563e99dff721e4631b4',
    zipByteLength: 16678,
  },
  'arabic-project-name': {
    entries: [
      {
        path: 'item-09598bb4fca1/README.md',
        kind: 'readme',
        byteLength: 1955,
        sha256: '65ed456c4c24c2f124788af49e23d70c1dfd1e238679e52084937e8fc89aa835',
      },
      {
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '9918c61821b63f1f6ad061e2edd17bc6cdc7bfb116569f09baaec537402fffdc',
      },
      {
        path: 'item-09598bb4fca1/checksums.sha256',
        kind: 'checksums',
        byteLength: 1384,
        sha256: 'd0f49fdec9f00709292ef584d112a9a71700f0d97f4294bce8e252849520c778',
      },
      {
        path: 'item-09598bb4fca1/manifest.json',
        kind: 'manifest',
        byteLength: 4243,
        sha256: 'a77cd03c0aa166d07270a9149d5900975658ae7564a7347bdac0dba9a7249689',
      },
      {
        path: 'item-09598bb4fca1/project/project.json',
        kind: 'project',
        byteLength: 437,
        sha256: '6632394b49b75e995214c4ae4063c124e149d3c0d82d254b13f6dc8e5b2ff81b',
      },
      {
        path: 'item-09598bb4fca1/session-01/cover/cover-metadata.json',
        kind: 'cover_metadata',
        byteLength: 815,
        sha256: 'ad6b2c815a649dc3b9dcfd5b24646599f82bbec168eb25f0636855b7c1e9652a',
      },
      {
        path: 'item-09598bb4fca1/session-01/cover/cover-prompt.txt',
        kind: 'cover_prompt',
        byteLength: 67,
        sha256: 'a74e77c7ff85ef9c8e02eaeaac9813507cf49d6c66085f1f73b517390c6fa7d0',
      },
      {
        path: 'item-09598bb4fca1/session-01/execution-plan.txt',
        kind: 'execution_plan',
        byteLength: 233,
        sha256: '9f1982b30f52360fa98f688ba198fbb62c3822a696d11c9e61f3c0c17befa10f',
      },
      {
        path: 'item-09598bb4fca1/session-01/groups/group-01.txt',
        kind: 'group_plan',
        byteLength: 66,
        sha256: 'cf0018a41e3bee49e854ea76dfe555610ac85cb231bc9de85a10ca2952b76427',
      },
      {
        path: 'item-09598bb4fca1/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 462,
        sha256: 'bcb727ffbcb1a0a3c74ff6609d71011a3938da53e77b7fb3cd930815e0d1dae9',
      },
      {
        path: 'item-09598bb4fca1/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 362,
        sha256: 'e059abd63032f936ae96316eab5275752f1cf604ecad9e21a7defd3adc31bfd4',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 55,
        sha256: '0e4221b4341e07f2f441fe1588c212986b66cfa227ebc51e5dde3940bef668f0',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/B/001_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/pairs/001_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 202,
        sha256: 'ed273017ccde6d1d999235f90e8617a8372a10587e619e082bd91d904abb6c42',
      },
      {
        path: 'item-09598bb4fca1/session-01/session-summary.md',
        kind: 'session_summary',
        byteLength: 240,
        sha256: '3dad79ff61e2fbf5e1f33d8cbfadd83aa0dd7614f7a712679b757bbb071499a4',
      },
    ],
    manifestSha256: 'a77cd03c0aa166d07270a9149d5900975658ae7564a7347bdac0dba9a7249689',
    manifestByteLength: 4243,
    checksumsSha256: 'd0f49fdec9f00709292ef584d112a9a71700f0d97f4294bce8e252849520c778',
    checksumsByteLength: 1384,
    zipSha256: '67d530ce53795e3655f5ba6179f4fcd64a0eea35f3930e24fae8cb5598a7efb5',
    zipByteLength: 13538,
  },
  'collision-heavy-names': {
    entries: [
      {
        path: 'item-09598bb4fca1/README.md',
        kind: 'readme',
        byteLength: 3112,
        sha256: 'dea6d1f407f3980b09b6e9a17a5066419d7c3841539b45c3006b2f90c897e612',
      },
      {
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '9918c61821b63f1f6ad061e2edd17bc6cdc7bfb116569f09baaec537402fffdc',
      },
      {
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical_2.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '67a876fcbda2a942c5bfd4368d42fc0f4490b7b818ba3f361219264bb9e89eed',
      },
      {
        path: 'item-09598bb4fca1/checksums.sha256',
        kind: 'checksums',
        byteLength: 1923,
        sha256: '0899dbef817a7f802ae8c3f1721ceaae3c0256c1328f21f235a81087e6f94737',
      },
      {
        path: 'item-09598bb4fca1/manifest.json',
        kind: 'manifest',
        byteLength: 5664,
        sha256: '0290c277045a763afa0b850bfd7104decbd65e7a5860979390e3a1f03134486f',
      },
      {
        path: 'item-09598bb4fca1/project/project.json',
        kind: 'project',
        byteLength: 437,
        sha256: '6632394b49b75e995214c4ae4063c124e149d3c0d82d254b13f6dc8e5b2ff81b',
      },
      {
        path: 'item-09598bb4fca1/session-01/cover/cover-metadata.json',
        kind: 'cover_metadata',
        byteLength: 881,
        sha256: 'a38ae1526e554451ebfb604c5c47d1506efd39ba51ae4854b9db04daa7e065e2',
      },
      {
        path: 'item-09598bb4fca1/session-01/cover/cover-prompt.txt',
        kind: 'cover_prompt',
        byteLength: 67,
        sha256: 'a74e77c7ff85ef9c8e02eaeaac9813507cf49d6c66085f1f73b517390c6fa7d0',
      },
      {
        path: 'item-09598bb4fca1/session-01/execution-plan.txt',
        kind: 'execution_plan',
        byteLength: 434,
        sha256: '713b2d6c0028f66ac01f4eae238d5242a41b4f17848baeccc7b4dba7167c6ba3',
      },
      {
        path: 'item-09598bb4fca1/session-01/groups/group-01.txt',
        kind: 'group_plan',
        byteLength: 23,
        sha256: '35458460b108d3a36b8af51cc1a2f24b0d54c3db74f85fa28afab7dddf4633b8',
      },
      {
        path: 'item-09598bb4fca1/session-01/groups/group-02.txt',
        kind: 'group_plan',
        byteLength: 25,
        sha256: 'e405460bd0eea1ec3a38e44a5a697a7866dd440bb0c30c5a2fb90615cc93e061',
      },
      {
        path: 'item-09598bb4fca1/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 774,
        sha256: '04cdb5a0f3c71786caf2ed063e4adf6213f18575c5248de698dfadec3c27f7aa',
      },
      {
        path: 'item-09598bb4fca1/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 362,
        sha256: 'e059abd63032f936ae96316eab5275752f1cf604ecad9e21a7defd3adc31bfd4',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 47,
        sha256: '7bf7745f91b1a58496e3fe13aa7a5880f0e9ea10b68e87c37f3acd2407124a69',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/A/002_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 29,
        sha256: '347cf7d50ba2536938dc68a6f9d87a902d80d63fa75d72eb7c6c61ccc869f976',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/B/001_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/B/002_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/pairs/001_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 224,
        sha256: '535096b32e6724e23ba35439fde02fc3379caab7a9a4e71a1f0a3e6f6044c769',
      },
      {
        path: 'item-09598bb4fca1/session-01/prompts/pairs/002_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 218,
        sha256: '6aa2753a673d526bbecaef3a626ba894cdd9bc122774017c94ef4cf821cbe7ab',
      },
      {
        path: 'item-09598bb4fca1/session-01/session-summary.md',
        kind: 'session_summary',
        byteLength: 240,
        sha256: '35b595338a28d450d7e54dbbeb5a73ac3f8ccf2faffe155b918cc7602732fa3f',
      },
    ],
    manifestSha256: '0290c277045a763afa0b850bfd7104decbd65e7a5860979390e3a1f03134486f',
    manifestByteLength: 5664,
    checksumsSha256: '0899dbef817a7f802ae8c3f1721ceaae3c0256c1328f21f235a81087e6f94737',
    checksumsByteLength: 1923,
    zipSha256: 'eb4c30cb87badde3c29c801b75454b4368bc4cf955641ebe67341898ae3fd9bd',
    zipByteLength: 18836,
  },
  'partial-with-omissions': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 1729,
        sha256: 'd27f589a3fcaa5d81c031e3d655e823ddae4bda19d8924e75b1e68bada514707',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 964,
        sha256: '96624983a193862004cb5acd5b0d8d1995327176f66bc99ed0be02c545888127',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 3193,
        sha256: '6c22c4dd58c4829347f223ac17ae8e1c359f9807d34ca682abe72fe2ce547b65',
      },
      {
        path: 'project-001/session-01/cover/cover-metadata.json',
        kind: 'cover_metadata',
        byteLength: 815,
        sha256: 'ad6b2c815a649dc3b9dcfd5b24646599f82bbec168eb25f0636855b7c1e9652a',
      },
      {
        path: 'project-001/session-01/cover/cover-prompt.txt',
        kind: 'cover_prompt',
        byteLength: 67,
        sha256: 'a74e77c7ff85ef9c8e02eaeaac9813507cf49d6c66085f1f73b517390c6fa7d0',
      },
      {
        path: 'project-001/session-01/execution-plan.txt',
        kind: 'execution_plan',
        byteLength: 151,
        sha256: 'cd7c38a57951a12c02950f586fbbf78fd4f9d01e6dc6a14287a8bc7488e404db',
      },
      {
        path: 'project-001/session-01/groups/group-01.txt',
        kind: 'group_plan',
        byteLength: 66,
        sha256: 'cf0018a41e3bee49e854ea76dfe555610ac85cb231bc9de85a10ca2952b76427',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 367,
        sha256: '955aeaf9f237d582c09a4c59f186e7ed514125c948fcf20c440d34361a8ce4b6',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 686,
        sha256: '95e033357e0f444731a0644dc63210e5567758981d0b89d2c003d4ba87d9e819',
      },
      {
        path: 'project-001/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 55,
        sha256: '0e4221b4341e07f2f441fe1588c212986b66cfa227ebc51e5dde3940bef668f0',
      },
      {
        path: 'project-001/session-01/session-summary.md',
        kind: 'session_summary',
        byteLength: 240,
        sha256: '3dad79ff61e2fbf5e1f33d8cbfadd83aa0dd7614f7a712679b757bbb071499a4',
      },
    ],
    manifestSha256: '6c22c4dd58c4829347f223ac17ae8e1c359f9807d34ca682abe72fe2ce547b65',
    manifestByteLength: 3193,
    checksumsSha256: '96624983a193862004cb5acd5b0d8d1995327176f66bc99ed0be02c545888127',
    checksumsByteLength: 964,
    zipSha256: 'ace913efc83f6c5c2794edddb9e5f224ec4cbc5c4dcd225847dcd93b445a8209',
    zipByteLength: 10075,
  },
  'cover-included': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 477,
        sha256: '8061fb7633763507e17fc65e5931ace85180198557a30b28f89e3b54cf0b80bf',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 568,
        sha256: '3fabb95dab73379eccaca573f50e29e5b0dcda8cc58f1150914ae75693a09ef0',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 2211,
        sha256: '9e8d4fa22c5098365abc22e5ffa9560904ee475f05ba530810ec3c99960909ec',
      },
      {
        path: 'project-001/session-01/cover/cover-metadata.json',
        kind: 'cover_metadata',
        byteLength: 815,
        sha256: 'ad6b2c815a649dc3b9dcfd5b24646599f82bbec168eb25f0636855b7c1e9652a',
      },
      {
        path: 'project-001/session-01/cover/cover-prompt.txt',
        kind: 'cover_prompt',
        byteLength: 67,
        sha256: 'a74e77c7ff85ef9c8e02eaeaac9813507cf49d6c66085f1f73b517390c6fa7d0',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 182,
        sha256: 'd06da8a8caba593b976f7ecff78799ad775bc1da7c06f67269c926b21a4b6997',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 138,
        sha256: '7a8398f8838de5277f190204f7fc7a96eb978f7796a4bd02b0ce4740e42661c3',
      },
    ],
    manifestSha256: '9e8d4fa22c5098365abc22e5ffa9560904ee475f05ba530810ec3c99960909ec',
    manifestByteLength: 2211,
    checksumsSha256: '3fabb95dab73379eccaca573f50e29e5b0dcda8cc58f1150914ae75693a09ef0',
    checksumsByteLength: 568,
    zipSha256: 'faa893730f771ed911c14bc23c70d67158f40c7131856e865cfca456ed961112',
    zipByteLength: 5544,
  },
  'no-cover': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 1817,
        sha256: '02f2cd89f0c88bf96b36288e1b19ea753899aaa5d04b9dab902f57cc1fef2e5f',
      },
      {
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '9918c61821b63f1f6ad061e2edd17bc6cdc7bfb116569f09baaec537402fffdc',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 1094,
        sha256: 'a6f03f895b588b4b171f742821a817e15ee97c80492b000ec7ee6c41af3789ec',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 3443,
        sha256: '1c7d4fe0396fcf55e0e4e96a47e88bcb3a0a10f11311a3c0a202d8bed47f5966',
      },
      {
        path: 'project-001/session-01/execution-plan.txt',
        kind: 'execution_plan',
        byteLength: 233,
        sha256: '9f1982b30f52360fa98f688ba198fbb62c3822a696d11c9e61f3c0c17befa10f',
      },
      {
        path: 'project-001/session-01/groups/group-01.txt',
        kind: 'group_plan',
        byteLength: 66,
        sha256: 'cf0018a41e3bee49e854ea76dfe555610ac85cb231bc9de85a10ca2952b76427',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 409,
        sha256: '446e4d1649c8abfd61b05b72dc2fee7b4279c88fe64dfa606ec661fcd821a3c2',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 664,
        sha256: 'e54ec271250b30565cccb013b4a2d8163e5faa1dee8c71b40a7521b698a190d2',
      },
      {
        path: 'project-001/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 55,
        sha256: '0e4221b4341e07f2f441fe1588c212986b66cfa227ebc51e5dde3940bef668f0',
      },
      {
        path: 'project-001/session-01/prompts/B/001_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'project-001/session-01/prompts/pairs/001_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 202,
        sha256: 'ed273017ccde6d1d999235f90e8617a8372a10587e619e082bd91d904abb6c42',
      },
      {
        path: 'project-001/session-01/session-summary.md',
        kind: 'session_summary',
        byteLength: 240,
        sha256: '3dad79ff61e2fbf5e1f33d8cbfadd83aa0dd7614f7a712679b757bbb071499a4',
      },
    ],
    manifestSha256: '1c7d4fe0396fcf55e0e4e96a47e88bcb3a0a10f11311a3c0a202d8bed47f5966',
    manifestByteLength: 3443,
    checksumsSha256: 'a6f03f895b588b4b171f742821a817e15ee97c80492b000ec7ee6c41af3789ec',
    checksumsByteLength: 1094,
    zipSha256: 'f33b0df8d54093491ec92a9e700034cf33a22a15af61dee90d8939fcbb040f8d',
    zipByteLength: 10582,
  },
  'markdown-long-backtick-runs': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 1851,
        sha256: '8e656e991d08cfbc1754b92e3a2c80a4de0beb78eccf70e22610ceaa2a724bc7',
      },
      {
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '9918c61821b63f1f6ad061e2edd17bc6cdc7bfb116569f09baaec537402fffdc',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 1297,
        sha256: '58ece4590bc2cc226501b056b3ad01cd37be7cb2778eeafc450a3480bbea6e5d',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 4034,
        sha256: 'ccc6836c170c266b898d8ad4a87d05816e8bfc8867d13aff0ac1acd91d9f04e7',
      },
      {
        path: 'project-001/session-01/cover/cover-metadata.json',
        kind: 'cover_metadata',
        byteLength: 815,
        sha256: 'ad6b2c815a649dc3b9dcfd5b24646599f82bbec168eb25f0636855b7c1e9652a',
      },
      {
        path: 'project-001/session-01/cover/cover-prompt.txt',
        kind: 'cover_prompt',
        byteLength: 67,
        sha256: 'a74e77c7ff85ef9c8e02eaeaac9813507cf49d6c66085f1f73b517390c6fa7d0',
      },
      {
        path: 'project-001/session-01/execution-plan.txt',
        kind: 'execution_plan',
        byteLength: 233,
        sha256: '9f1982b30f52360fa98f688ba198fbb62c3822a696d11c9e61f3c0c17befa10f',
      },
      {
        path: 'project-001/session-01/groups/group-01.txt',
        kind: 'group_plan',
        byteLength: 66,
        sha256: 'cf0018a41e3bee49e854ea76dfe555610ac85cb231bc9de85a10ca2952b76427',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 462,
        sha256: 'bcb727ffbcb1a0a3c74ff6609d71011a3938da53e77b7fb3cd930815e0d1dae9',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 362,
        sha256: 'e059abd63032f936ae96316eab5275752f1cf604ecad9e21a7defd3adc31bfd4',
      },
      {
        path: 'project-001/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 57,
        sha256: 'd30e9ae3ef0666b7a26b3d5da810116061131aaa6bae96b330873b1f31f05db4',
      },
      {
        path: 'project-001/session-01/prompts/B/001_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'project-001/session-01/prompts/pairs/001_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 202,
        sha256: 'ed273017ccde6d1d999235f90e8617a8372a10587e619e082bd91d904abb6c42',
      },
      {
        path: 'project-001/session-01/session-summary.md',
        kind: 'session_summary',
        byteLength: 240,
        sha256: '3dad79ff61e2fbf5e1f33d8cbfadd83aa0dd7614f7a712679b757bbb071499a4',
      },
    ],
    manifestSha256: 'ccc6836c170c266b898d8ad4a87d05816e8bfc8867d13aff0ac1acd91d9f04e7',
    manifestByteLength: 4034,
    checksumsSha256: '58ece4590bc2cc226501b056b3ad01cd37be7cb2778eeafc450a3480bbea6e5d',
    checksumsByteLength: 1297,
    zipSha256: '1f6eaa275bc4878e4906eeb945a32e5702cfd6c2248353ff6b840f07069e5a99',
    zipByteLength: 12383,
  },
  'prompt-cr-crlf-nfc-nfd-emoji-trailing': {
    entries: [
      {
        path: 'project-001/README.md',
        kind: 'readme',
        byteLength: 1862,
        sha256: 'c9d6b0f4d656f7f0b150a04c6bd52954e9571a974f00590bfcc4e001f43d1aca',
      },
      {
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
        kind: 'artwork_metadata',
        byteLength: 327,
        sha256: '9918c61821b63f1f6ad061e2edd17bc6cdc7bfb116569f09baaec537402fffdc',
      },
      {
        path: 'project-001/checksums.sha256',
        kind: 'checksums',
        byteLength: 1297,
        sha256: '3406e6491c1b6f3166fb7c958c0c09317c246368a7cc9dd3261a9e90cd7edb01',
      },
      {
        path: 'project-001/manifest.json',
        kind: 'manifest',
        byteLength: 4034,
        sha256: '52417727b5c3e8b2a5f47cc0600264954882d62366b163bb0cb460681a3323ed',
      },
      {
        path: 'project-001/session-01/cover/cover-metadata.json',
        kind: 'cover_metadata',
        byteLength: 815,
        sha256: 'ad6b2c815a649dc3b9dcfd5b24646599f82bbec168eb25f0636855b7c1e9652a',
      },
      {
        path: 'project-001/session-01/cover/cover-prompt.txt',
        kind: 'cover_prompt',
        byteLength: 67,
        sha256: 'a74e77c7ff85ef9c8e02eaeaac9813507cf49d6c66085f1f73b517390c6fa7d0',
      },
      {
        path: 'project-001/session-01/execution-plan.txt',
        kind: 'execution_plan',
        byteLength: 233,
        sha256: '9f1982b30f52360fa98f688ba198fbb62c3822a696d11c9e61f3c0c17befa10f',
      },
      {
        path: 'project-001/session-01/groups/group-01.txt',
        kind: 'group_plan',
        byteLength: 66,
        sha256: 'cf0018a41e3bee49e854ea76dfe555610ac85cb231bc9de85a10ca2952b76427',
      },
      {
        path: 'project-001/session-01/metadata/prompt-metadata.json',
        kind: 'prompt_metadata',
        byteLength: 462,
        sha256: 'bcb727ffbcb1a0a3c74ff6609d71011a3938da53e77b7fb3cd930815e0d1dae9',
      },
      {
        path: 'project-001/session-01/metadata/validation.json',
        kind: 'validation',
        byteLength: 362,
        sha256: 'e059abd63032f936ae96316eab5275752f1cf604ecad9e21a7defd3adc31bfd4',
      },
      {
        path: 'project-001/session-01/prompts/A/001_tee-front_A.txt',
        kind: 'prompt_a',
        byteLength: 72,
        sha256: '50e35178dc4add901efc80763d5336f5cde21140e34d2af0a8f749d66bd6a5b5',
      },
      {
        path: 'project-001/session-01/prompts/B/001_tee-front_B.txt',
        kind: 'prompt_b',
        byteLength: 64,
        sha256: 'fa0317f57d9ab6b5d49623375042aa0afd6b98e6492eb61dce1efef9c62cbfd2',
      },
      {
        path: 'project-001/session-01/prompts/pairs/001_pair_execution.md',
        kind: 'prompt_pair',
        byteLength: 202,
        sha256: 'ed273017ccde6d1d999235f90e8617a8372a10587e619e082bd91d904abb6c42',
      },
      {
        path: 'project-001/session-01/session-summary.md',
        kind: 'session_summary',
        byteLength: 240,
        sha256: '3dad79ff61e2fbf5e1f33d8cbfadd83aa0dd7614f7a712679b757bbb071499a4',
      },
    ],
    manifestSha256: '52417727b5c3e8b2a5f47cc0600264954882d62366b163bb0cb460681a3323ed',
    manifestByteLength: 4034,
    checksumsSha256: '3406e6491c1b6f3166fb7c958c0c09317c246368a7cc9dd3261a9e90cd7edb01',
    checksumsByteLength: 1297,
    zipSha256: '750caeab25e764ae5c93ddaccaddd6d77c317f22a505e37e005bbfad0001fa68',
    zipByteLength: 12409,
  },
};
