import i18next from 'eslint-plugin-i18next'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'

/** AUT-583: strict i18n for finance, purchasing, and vendors. */
export const financePurchasingI18nFiles = [
  'src/pages/finance/**/*.{ts,tsx}',
  'src/components/finance/**/*.{ts,tsx}',
  'src/pages/purchase-orders/**/*.{ts,tsx}',
  'src/pages/purchase-bills/**/*.{ts,tsx}',
  'src/features/purchase-bills/**/*.{ts,tsx}',
  'src/components/purchase-bills/**/*.{ts,tsx}',
  'src/pages/purchase-invoices/**/*.{ts,tsx}',
  'src/components/purchase-invoices/**/*.{ts,tsx}',
  'src/pages/vendors/**/*.{ts,tsx}',
]

export const financePurchasingI18nEslintConfig = {
  files: financePurchasingI18nFiles,
  ignores: ['**/*.{test,spec}.{ts,tsx}', '**/*testUtils*'],
  plugins: {
    i18next,
  },
  rules: {
    'i18next/no-literal-string': i18nLiteralStringRule[1],
  },
}
