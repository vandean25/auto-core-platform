import i18next from 'eslint-plugin-i18next'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'

/** AUT-582: strict i18n for sales, vehicles, customers, and vehicle-stock pages. */
export const salesDomainI18nFiles = [
  'src/pages/sales/**/*.{ts,tsx}',
  'src/pages/sales-orders/**/*.{ts,tsx}',
  'src/pages/vehicles/**/*.{ts,tsx}',
  'src/pages/vehicle-stock/**/*.{ts,tsx}',
  'src/pages/customers/**/*.{ts,tsx}',
  'src/components/customers/**/*.{ts,tsx}',
]

export const salesDomainI18nEslintConfig = {
  files: salesDomainI18nFiles,
  ignores: ['**/*.{test,spec}.{ts,tsx}', '**/*testUtils*'],
  plugins: {
    i18next,
  },
  rules: {
    'i18next/no-literal-string': i18nLiteralStringRule[1],
  },
}
