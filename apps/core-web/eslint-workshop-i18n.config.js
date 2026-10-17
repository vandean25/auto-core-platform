import i18next from 'eslint-plugin-i18next'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'

/** AUT-581: strict i18n for workshop & mechanic domain (monotonic list; extend in follow-up PRs). */
export const workshopI18nFiles = [
  'src/pages/workshop/**/*.{ts,tsx}',
  'src/pages/mechanic/**/*.{ts,tsx}',
  'src/features/workshop/**/*.{ts,tsx}',
  'src/features/mechanic-task-detail/**/*.{ts,tsx}',
  'src/components/workshop/**/*.{ts,tsx}',
]

export const workshopI18nEslintConfig = {
  files: workshopI18nFiles,
  plugins: {
    i18next,
  },
  rules: {
    'i18next/no-literal-string': i18nLiteralStringRule[1],
  },
}
