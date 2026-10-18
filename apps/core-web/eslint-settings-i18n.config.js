import i18next from 'eslint-plugin-i18next'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'

/** AUT-584 (2/2): strict i18n for settings domain and settings-only root components. */
export const settingsI18nFiles = [
  'src/pages/SettingsPage.tsx',
  'src/components/settings/**/*.{ts,tsx}',
  'src/components/labor/**/*.{ts,tsx}',
  'src/components/AddBrandDialog.tsx',
  'src/components/AddRevenueGroupDialog.tsx',
  'src/components/BrandTable.tsx',
  'src/components/BrandCombobox.tsx',
  'src/components/BrandMultiSelect.tsx',
  'src/components/RevenueGroupTable.tsx',
]

export const settingsI18nEslintConfig = {
  files: settingsI18nFiles,
  ignores: ['**/*.{test,spec}.{ts,tsx}', '**/*testUtils*', '**/import-field-labels.ts', '**/import-mapping-suggest.ts', '**/import-wizard-logic.ts', '**/parse-import-csv-client.ts'],
  plugins: {
    i18next,
  },
  rules: {
    'i18next/no-literal-string': i18nLiteralStringRule[1],
  },
}
