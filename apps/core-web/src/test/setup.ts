import '@testing-library/jest-dom/vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { afterEach, beforeAll, beforeEach, expect } from 'vitest'
import { changeUiLanguage, initI18n } from '@/lib/i18n'
import './setup-dom-mocks'

expect.extend(matchers)

const ENGLISH_LOCALE_TEST_FILES = [
  'LoginPage.test.tsx',
  'TenantSwitcher.test.tsx',
  'SiteSwitcher.test.tsx',
  'GlobalSearch.test.tsx',
  'GlobalSearch.navigation.test.tsx',
  'App.login-chunk-error.test.tsx',
  'App.mechanic-shell.test.tsx',
  'AppSidebar.help-docs.test.tsx',
  'AppSidebar.invoices.test.tsx',
  'AppSidebar.vehicle-gewaehrleistung.test.tsx',
]

beforeAll(async () => {
  await initI18n({ language: 'de' })
})

beforeEach(async (context) => {
  const filepath = context.task.file?.filepath ?? ''
  const useEnglish = ENGLISH_LOCALE_TEST_FILES.some((name) => filepath.endsWith(name))
  await changeUiLanguage(useEnglish ? 'en' : 'de')
})

afterEach(async () => {
  await changeUiLanguage('de')
})
