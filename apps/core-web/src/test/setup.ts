import '@testing-library/jest-dom/vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { afterEach, beforeAll, expect } from 'vitest'
import { changeUiLanguage, ensureNamespaceLoaded, initI18n } from '@/lib/i18n'
import './setup-dom-mocks'

expect.extend(matchers)

beforeAll(async () => {
  await initI18n({ language: 'de' })
  await ensureNamespaceLoaded('workshop')
  await ensureNamespaceLoaded('sales')
  await ensureNamespaceLoaded('vehicles')
  await ensureNamespaceLoaded('customers')
  await ensureNamespaceLoaded('vehicleStock')
  await ensureNamespaceLoaded('finance')
  await ensureNamespaceLoaded('inventory')
  await ensureNamespaceLoaded('hr')
  await ensureNamespaceLoaded('reports')
  await ensureNamespaceLoaded('platform')
  await ensureNamespaceLoaded('settings')
  await ensureNamespaceLoaded('agent')
})

afterEach(async () => {
  await changeUiLanguage('de')
})
