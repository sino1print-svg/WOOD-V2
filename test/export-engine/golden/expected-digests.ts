import type { GoldenCaseName } from '../golden-cases';

export const GOLDEN_FORMAT_NAMES = ['txt', 'markdown', 'readableJson', 'canonicalJson'] as const;

export type GoldenFormatName = (typeof GOLDEN_FORMAT_NAMES)[number];

export interface GoldenDigest {
  readonly byteLength: number;
  readonly sha256: string;
}

type GoldenDigestManifest = Readonly<
  Record<GoldenCaseName, Readonly<Record<GoldenFormatName, GoldenDigest>>>
>;

/**
 * Manually reviewed byte oracles. There is deliberately no update command or
 * write path in the test suite. The Batch 10.4 Final Residual Corrective
 * updates only fixtures whose trusted session counters or cover-scope
 * dependency projection changed.
 */
export const GOLDEN_DIGESTS = {
  'simple-session-a-only': {
    txt: {
      byteLength: 1828,
      sha256: '513079f1b50993f99387bd480909a8a54f0127877b1b1365383c4a0d0252b090',
    },
    markdown: {
      byteLength: 1693,
      sha256: '9c86bd383b996de2e8fefd2ce95e5f524aae9b963098532878460426d1aff0dc',
    },
    readableJson: {
      byteLength: 8729,
      sha256: '8ed68a9ad8165dde1252d2df4b5a46a9b0d254b555094ad07c37e75b19f26d19',
    },
    canonicalJson: {
      byteLength: 6043,
      sha256: 'cc835dc2d3bad57b8dcef58160e9b02044b4950a75b12325284a08967f603f61',
    },
  },
  'scene-a-and-b': {
    txt: {
      byteLength: 710,
      sha256: '92b2f0048a3821f9eb59cec91ddcb3808a384e829b1fbfdd1d4c53dea8a78d5e',
    },
    markdown: {
      byteLength: 615,
      sha256: '4073c030dcf92e2df861629b0fc1050c6f6283fc24378d30238eb4ee3f1ba926',
    },
    readableJson: {
      byteLength: 4497,
      sha256: '2f4e3c9bd61998b548c16878a031f3bd6bb552d0a910308e0f22186d9a9f6b1f',
    },
    canonicalJson: {
      byteLength: 3159,
      sha256: '7307c547e6112b90b70263710402cb11381493160380713095fd585216850684',
    },
  },
  'multiple-scenes-numbering': {
    txt: {
      byteLength: 3289,
      sha256: '78974616f9fa6f55e58d8d29dc053522021cee0a6d094ec3c58bdf2bd2968d1c',
    },
    markdown: {
      byteLength: 3002,
      sha256: '0dd10131f051e69d16a599b6fda55f5974283a47d3e3a0038861bb819333e73a',
    },
    readableJson: {
      byteLength: 15256,
      sha256: '9e911923324d02b3f49168cd2e93c7411a814d909ee8f0920bf95b3138eaaafc',
    },
    canonicalJson: {
      byteLength: 10563,
      sha256: '0c137d6c1a206c6111403a0752462fee4ca761a8dbac2a565e5d5fbe7aa71351',
    },
  },
  'multiple-groups': {
    txt: {
      byteLength: 3289,
      sha256: '78974616f9fa6f55e58d8d29dc053522021cee0a6d094ec3c58bdf2bd2968d1c',
    },
    markdown: {
      byteLength: 3002,
      sha256: '0dd10131f051e69d16a599b6fda55f5974283a47d3e3a0038861bb819333e73a',
    },
    readableJson: {
      byteLength: 15256,
      sha256: '9e911923324d02b3f49168cd2e93c7411a814d909ee8f0920bf95b3138eaaafc',
    },
    canonicalJson: {
      byteLength: 10563,
      sha256: '0c137d6c1a206c6111403a0752462fee4ca761a8dbac2a565e5d5fbe7aa71351',
    },
  },
  'cover-present': {
    txt: {
      byteLength: 534,
      sha256: 'c5064a22f39f6ebad16f834dba16937f692d0652baaf7ab8987a0be060e9c8ff',
    },
    markdown: {
      byteLength: 450,
      sha256: '5deab861003fefecdddc35ede422718d313c4d182b214822830d5cbfeecd516d',
    },
    readableJson: {
      byteLength: 3268,
      sha256: 'b4c87e93d05755513991c10ebd52cac817e12f2b6803c54c23836ac69eba4c09',
    },
    canonicalJson: {
      byteLength: 2215,
      sha256: '82cfb779b5ca20ef5589e4d62c3aa61b72678b94fc4732b53299e94690fc2f1f',
    },
  },
  'partial-with-omission': {
    txt: {
      byteLength: 1987,
      sha256: '8e34da87ef664d2228847e0f6505b1f2a95d8dabb96ec0fb067e834909b6bdf6',
    },
    markdown: {
      byteLength: 1729,
      sha256: 'd27f589a3fcaa5d81c031e3d655e823ddae4bda19d8924e75b1e68bada514707',
    },
    readableJson: {
      byteLength: 8734,
      sha256: '954c0c0ae5aeba145931de8c20afadcc4a3edb26481eb93cee0bf46097c614d1',
    },
    canonicalJson: {
      byteLength: 5888,
      sha256: '5efa97d48f76e55077b14ec6401f42149c04eece85368564d376c662e5216a99',
    },
  },
  'arabic-text': {
    txt: {
      byteLength: 2181,
      sha256: '7f41a9ef34b1b48e5653c57b0931086e38c12bf6872790bf96cb1194578dfbaf',
    },
    markdown: {
      byteLength: 1900,
      sha256: '0fea09f6601c54924e08ef7f0d1380811afa5d48d25d0980be7d7d20a0f1f468',
    },
    readableJson: {
      byteLength: 9892,
      sha256: '7f785da9a1f796e19ccbdd01bad58c57d58b22416a81d87bbf91de1ba729582f',
    },
    canonicalJson: {
      byteLength: 6684,
      sha256: '84a66e1d259a41ec859d053d0fe6ac951378891b29e486ee3429894956b4608f',
    },
  },
  'emoji-unicode': {
    txt: {
      byteLength: 2128,
      sha256: '7280062473aaafb7d0ea897c24840c6fbabe016b23aff0278acf86660bd8c2ed',
    },
    markdown: {
      byteLength: 1847,
      sha256: 'bf519188701a1bef97b07df585deb3d2307da15334b99e447fb89a765281e873',
    },
    readableJson: {
      byteLength: 9840,
      sha256: 'fc990f8e7702f4e52011c8d78a7f94219b59873636a2d9a3b08a16965d2c9f41',
    },
    canonicalJson: {
      byteLength: 6632,
      sha256: '3e081f53027188adc47282dd0f1f81f54ace35b649b09e2e6bcbb1a7cde5993e',
    },
  },
  'leading-trailing-whitespace': {
    txt: {
      byteLength: 2128,
      sha256: '060533a9b44783c6148929cd4316a0b5778e9090118f4df4c943a6c556bf81bf',
    },
    markdown: {
      byteLength: 1847,
      sha256: 'c081438c10dec19ecd1119a9bd584bee717531152abcb0d18bbd9e24c2f74b48',
    },
    readableJson: {
      byteLength: 9842,
      sha256: 'a2386a0640f2098f2bb9fe057d062c8cbd54910eb277adb768b7843e8433f2ed',
    },
    canonicalJson: {
      byteLength: 6634,
      sha256: '5d4722d63257562e45e3655d8acc23d76012e0d14257245667004be54d95d916',
    },
  },
  'blank-lines': {
    txt: {
      byteLength: 2096,
      sha256: 'a72ec8a76f9313f92bcb8383ae5816fc489af81999b5c27414365eab73ae0573',
    },
    markdown: {
      byteLength: 1815,
      sha256: '2931afe58f3575e6817a5bf40715f64807dafe59e7fd60b2450296075ea42d93',
    },
    readableJson: {
      byteLength: 9814,
      sha256: '5eda528acfcedfb41718fc46ce6d03c8698238f99419f97b0520df51138c7532',
    },
    canonicalJson: {
      byteLength: 6606,
      sha256: '8ba87c8179f8ee5d073f5ce74be5077e426c62017d18aa287e7297fb4d3b97d0',
    },
  },
  'source-crlf': {
    txt: {
      byteLength: 2089,
      sha256: '7c0cc87662997c451d7d70979ffe85e4e6ab5956a49052a5c532f8b49560ce56',
    },
    markdown: {
      byteLength: 1808,
      sha256: 'ce1c1a13801fcb06639fc677cbe2aa42b4472ba99f2d26a14704d2d7af8c7b42',
    },
    readableJson: {
      byteLength: 9806,
      sha256: 'c1d3ca962ef4ce84715fffbc9df5cd2ba76615d3905ce949382eb2653bfef6c4',
    },
    canonicalJson: {
      byteLength: 6598,
      sha256: '74f6672d1583b3b9210ea6308c4b6b63219b657e1796c23e6e557b81a23199c8',
    },
  },
  'markdown-fences': {
    txt: {
      byteLength: 2128,
      sha256: '12c5539210182aec2a950d9c3863a9d7aa627c0547c7dc101589d8134fae33e8',
    },
    markdown: {
      byteLength: 1851,
      sha256: '8e656e991d08cfbc1754b92e3a2c80a4de0beb78eccf70e22610ceaa2a724bc7',
    },
    readableJson: {
      byteLength: 9845,
      sha256: 'ef7fa98d0a7a2d0a8d41eb49b8030f9072bb1c610d650f5f1d59f3f36e2190c6',
    },
    canonicalJson: {
      byteLength: 6637,
      sha256: 'b9801d9b36657d56e0834ac6621c5cc2676e6a6b086706a3d97e6989f54a1ffb',
    },
  },
  'empty-optional-sections': {
    txt: {
      byteLength: 479,
      sha256: '0220c9450e50a807a0c36c55c79bc655c85e355a833f550abb2f67fca5b7d8be',
    },
    markdown: {
      byteLength: 442,
      sha256: 'ac341a30d1014beb8b7be73d5f5eb9c08c8bc5b149870b01f0d059b2eb6b0e2f',
    },
    readableJson: {
      byteLength: 3042,
      sha256: '06e4a52e40f9beda703f5ccb52de6783db0e8fe8dd2751df2df5a831cdda68ed',
    },
    canonicalJson: {
      byteLength: 2097,
      sha256: '401f3dd9c644205a0e492c084bb23f6412cbf6790a3c58c4b997f155fcc7a9c4',
    },
  },
  'large-valid-prompt': {
    txt: {
      byteLength: 67632,
      sha256: 'ad2cadd82cb845be94cfc49e7e3cc97b6b393ee67b00a796e1e32dfe865693d9',
    },
    markdown: {
      byteLength: 67351,
      sha256: 'ea1958dbc834f6a6c3bfa7facf14056ae815fce63acdac8d4e3f772fabbfde78',
    },
    readableJson: {
      byteLength: 75343,
      sha256: 'e184fa5e68e164417074c0c4a2ea90dc02f3ccc6b8106110299bf2caccc534ed',
    },
    canonicalJson: {
      byteLength: 72135,
      sha256: 'eebb431475ef9c67052853c7ac9fe01e4b59c958eae491c255217af9fd689ec7',
    },
  },
  'hostile-metadata-legitimate-prompt': {
    txt: {
      byteLength: 2163,
      sha256: 'bd521473e2a5a2ea775d4183415b01bccf9e122c27f8b0ece4dc850f7790b057',
    },
    markdown: {
      byteLength: 1882,
      sha256: 'af0b50bb90f4294e8b01ab1d355645b78a8feab0a8828d92fc8029b0b817fa7e',
    },
    readableJson: {
      byteLength: 9875,
      sha256: 'b9777a80fc555a554b64ff4fefeb5d947434b8e3be1dca52fb66d865f5ddac4e',
    },
    canonicalJson: {
      byteLength: 6667,
      sha256: '6e74cce7981f9ded64ddd5e44d1394d9b94cedcfdd394cf0ef50cb544eea24a7',
    },
  },
} as const satisfies GoldenDigestManifest;
