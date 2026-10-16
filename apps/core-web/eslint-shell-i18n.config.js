import i18next from 'eslint-plugin-i18next'
import { i18nLiteralStringRule } from './eslint-i18n-shared.config.js'

/** AUT-579: strict i18n for migrated app shell folders (monotonic list; extend in follow-up PRs). */
export const shellI18nFiles = [
  'src/components/navigation/**/*.{ts,tsx}',
  'src/components/global-search/**/*.{ts,tsx}',
  'src/components/GlobalSearch.tsx',
  'src/components/GlobalErrorBoundary.tsx',
  'src/components/glossary/**/*.{ts,tsx}',
  'src/pages/LoginPage.tsx',
  'src/pages/login/**/*.{ts,tsx}',
  'src/pages/NotFoundPage.tsx',
  'src/pages/LandingDemo*.tsx',
  'src/pages/login/**/*.{ts,tsx}',
  'src/pages/not-found/**/*.{ts,tsx}',
  'src/pages/landing-demo/**/*.{ts,tsx}',
  'src/components/shell/**/*.{ts,tsx}',
  'src/App.tsx',
]

export const shellI18nEslintConfig = {
  files: shellI18nFiles,
  plugins: {
    i18next,
  },
  rules: {
    'i18next/no-literal-string': i18nLiteralStringRule[1],
  },
}
