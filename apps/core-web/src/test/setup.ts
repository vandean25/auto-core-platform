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
})

afterEach(async () => {
  await changeUiLanguage('de')
})
