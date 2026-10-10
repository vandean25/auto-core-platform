import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'jsx-a11y/label-has-associated-control': ['error', { controlComponents: ['Input'] }],
      // AUT-471: icon-only buttons and links need an accessible name (aria-label or visible text).
      // `'*'` makes custom components without children (lucide icons such as <ArrowLeft />) count as
      // unlabelled. Without it the rule assumes they render text and misses icon-only controls.
      // Form fields are ignored here because they are named through <label>, which
      // label-has-associated-control already enforces.
      'jsx-a11y/control-has-associated-label': [
        'error',
        {
          controlComponents: ['Button', 'Link', 'NavLink', '*'],
          ignoreElements: ['audio', 'canvas', 'embed', 'input', 'select', 'textarea', 'tr', 'video'],
          // Cards and other wrappers nest the visible text deeper than the default depth of 2.
          depth: 5,
        },
      ],
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/incompatible-library': 'off',
    },
  },
])
