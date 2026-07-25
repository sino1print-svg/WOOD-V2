/**
 * ESLint configuration — Phase 0.
 * Enforces strict TypeScript hygiene and the architecture-boundary rule that
 * engines / shared / app / persistence / export must NOT import the UI layer
 * (10_APP_WORKFLOW §2.4, 12_IMPLEMENTATION_GUIDE §8/§33). Cross-module cycle and
 * leaf-engine boundary checks are additionally enforced by the deterministic
 * architecture test (test/architecture/boundaries.test.ts).
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.config.ts', '*.config.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'react-hooks/rules-of-hooks': 'error',
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
        message: 'Non-determinism is forbidden (no Math.random). See 10_APP_WORKFLOW §27.',
      },
    ],
  },
  overrides: [
    {
      // Architecture boundary: no UI imports outside the ui/ layer.
      files: [
        'src/shared/**/*.{ts,tsx}',
        'src/engines/**/*.{ts,tsx}',
        'src/app/**/*.{ts,tsx}',
        'src/persistence/**/*.{ts,tsx}',
        'src/export/**/*.{ts,tsx}',
        'src/config/**/*.{ts,tsx}',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@ui/*', '**/ui/*', '../ui/*', '../../ui/*'],
                message: 'Engines/shared/app must not import the UI layer (WF §2.4).',
              },
            ],
          },
        ],
      },
    },
  ],
};
