import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import i18next from 'eslint-plugin-i18next'
import reactHooks from 'eslint-plugin-react-hooks'
import { enumsI18nEslintConfig } from './eslint-enums-i18n.config.js'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'
import { shellI18nEslintConfig } from './eslint-shell-i18n.config.js'
import { financePurchasingI18nEslintConfig } from './eslint-finance-purchasing-i18n.config.js'
import { inventoryHrI18nEslintConfig } from './eslint-inventory-hr-i18n.config.js'
import { salesDomainI18nEslintConfig } from './eslint-sales-domain-i18n.config.js'
import { settingsI18nEslintConfig } from './eslint-settings-i18n.config.js'
import { workshopI18nEslintConfig } from './eslint-workshop-i18n.config.js'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const intlRestrictionRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "MemberExpression[object.name='Intl']",
      message: 'Use @/lib/format instead of Intl (AUT-577).',
    },
    {
      selector:
        "CallExpression[callee.property.name=/^(toLocaleString|toLocaleDateString|toLocaleTimeString|toLocaleLowerCase)$/]",
      message: 'Use @/lib/format instead of locale-specific string methods (AUT-577).',
    },
  ],
}

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
      // Form fields (input, textarea) are not checked by this rule. Their names come from <label>, and
      // label-has-associated-control only checks that each <label> has a control.
      'jsx-a11y/control-has-associated-label': [
        'error',
        {
          controlComponents: ['Button', 'Link', 'NavLink', '*'],
          ignoreElements: ['input', 'textarea'],
          // Cards and other wrappers nest the visible text deeper than the default depth of 2.
          depth: 5,
        },
      ],
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/incompatible-library': 'off',
      ...intlRestrictionRules,
    },
  },
  {
    files: ['src/lib/format/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // AUT-578 / AUT-584: error on hard-coded UI strings everywhere (strict domain overrides below).
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '**/*.{test,spec}.{ts,tsx}',
      'e2e/**',
      'src/api/generated/**',
      'dist/**',
      'dist-e2e/**',
    ],
    plugins: {
      i18next,
    },
    rules: {
      'i18next/no-literal-string': i18nLiteralStringRule[1],
    },
  },
  shellI18nEslintConfig,
  enumsI18nEslintConfig,
  workshopI18nEslintConfig,
  salesDomainI18nEslintConfig,
  financePurchasingI18nEslintConfig,
  inventoryHrI18nEslintConfig,
  settingsI18nEslintConfig,
])
