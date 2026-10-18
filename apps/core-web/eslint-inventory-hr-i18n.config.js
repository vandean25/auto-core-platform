import i18next from 'eslint-plugin-i18next'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'

/** AUT-584: strict i18n for inventory, stock transfers, tyre storage, and HR. */
export const inventoryHrI18nFiles = [
  'src/pages/inventory/**/*.{ts,tsx}',
  'src/components/inventory/**/*.{ts,tsx}',
  'src/pages/stock-transfers/**/*.{ts,tsx}',
  'src/pages/tyre-storage/**/*.{ts,tsx}',
  'src/features/tyre-storage/**/*.{ts,tsx}',
  'src/pages/hr/**/*.{ts,tsx}',
  'src/components/hr/**/*.{ts,tsx}',
  'src/pages/agent/**/*.{ts,tsx}',
]

export const inventoryHrI18nEslintConfig = {
  files: inventoryHrI18nFiles,
  ignores: ['**/*.{test,spec}.{ts,tsx}', '**/*testUtils*'],
  plugins: {
    i18next,
  },
  rules: {
    'i18next/no-literal-string': i18nLiteralStringRule[1],
  },
}
