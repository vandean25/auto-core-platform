import i18next from 'eslint-plugin-i18next'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'

/** AUT-580: strict i18n for migrated enum/label maps (monotonic list; extend in follow-up PRs). */
export const enumsI18nFiles = [
  'src/lib/i18n/enum-labels.ts',
  'src/lib/i18n/enum-registry.ts',
  'src/components/status/StatusBadge.tsx',
  'src/pages/agent/agent-labels.ts',
  'src/components/settings/data-import/import-field-labels.ts',
  'src/components/data-table/data-table-column-label.ts',
  'src/components/settings/document-branding/letterhead-source-messages.ts',
]

export const enumsI18nEslintConfig = {
  files: enumsI18nFiles,
  plugins: {
    i18next,
  },
  rules: {
    'i18next/no-literal-string': i18nLiteralStringRule[1],
  },
}
