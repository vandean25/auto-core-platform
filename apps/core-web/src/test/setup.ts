import '@testing-library/jest-dom/vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { afterEach, beforeAll, beforeEach, expect } from 'vitest'
import { resetScopeContextClientForTests, seedValidatedScopeContextForTests } from '@/auth/scope-context-client'
import { changeUiLanguage, ensureNamespaceLoaded, initI18n } from '@/lib/i18n'
import './setup-dom-mocks'

const vitestScopeContext = { scopeContext: 'vitest-sc', scopeContextDigest: 'vitest-digest' }

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

beforeEach(() => {
  resetScopeContextClientForTests()
  seedValidatedScopeContextForTests(vitestScopeContext)
})

afterEach(async () => {
  resetScopeContextClientForTests()
  await changeUiLanguage('de')
})
