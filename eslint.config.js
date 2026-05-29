// Config file lint stance:
//   *.config.ts  -> linted + typechecked under the standard TS ruleset.
//   *.config.js  -> ignored (no type info, mostly tool boilerplate, low risk).
//   *.config.mjs -> ignored (same as .js: no type info, ESM build tool plumbing).
// Rationale: TS configs are first-class source we own; JS/MJS configs are
// vendored shapes (vitest, electron-vite, eslint itself) where false positives
// outweigh the marginal lint coverage. If a JS/MJS config grows real logic,
// rename it to .ts and it picks up the full ruleset automatically.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.git/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
      // Workflow-tool scratch scripts kept in the repo for reference. They run
      // inside the Workflow runtime (phase/agent/parallel/log are injected
      // globals, not Node), so they cannot lint as standalone modules.
      '.audit-workflow.mjs',
      '.phase-14-workflow.mjs',
      '.phase-15-workflow.mjs',
      // Stray tsc emit artifacts that occasionally land in src/ (e.g. if
      // someone runs `tsc` without `-p tsconfig.json`). Source is always
      // .ts / .tsx; .js / .d.ts in src/ are never authored.
      'packages/*/src/**/*.js',
      'packages/*/src/**/*.js.map',
      'packages/*/src/**/*.d.ts',
      'packages/*/src/**/*.d.ts.map',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{cjs,mjs,js}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },

  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    // Perf bench drives a real browser via Playwright; the bodies of
    // `window.evaluate(() => ...)` run in the renderer, so they legitimately
    // reference DOM globals (document, HTMLTextAreaElement, requestAnimationFrame).
    files: ['apps/desktop/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
