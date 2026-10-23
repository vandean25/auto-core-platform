/**
 * Vitest setup that mirrors production i18n: only preloaded namespaces, no lazy bundles.
 * Use via a dedicated vitest project or call `stripLazyNamespacesForTest()` in specs that assert lazy-load behavior.
 */
import '@testing-library/jest-dom/vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { afterEach, beforeAll, expect } from 'vitest'
import { changeUiLanguage, initI18n } from '@/lib/i18n'
import './setup-dom-mocks'

expect.extend(matchers)

beforeAll(async () => {
  await initI18n({ language: 'de' })
})

afterEach(async () => {
  await changeUiLanguage('de')
})
