import { describe, expect, it, vi } from 'vitest'
import type { AuthSession } from './auth-session'

vi.mock('@/lib/firebase', () => ({ firebaseAuth: null }))
import { selectEffectiveCapabilities } from './auth-session'

const capabilities = { nova: true, pickerl57a: false, kaufvertragAt: true, willhabenExport: false }
const session: AuthSession = {
  userId: 'synthetic-user', email: 'user@example.com',
  activeTenant: { id: 'synthetic-tenant', name: 'Synthetic tenant', slug: 'synthetic' },
  activeRole: 'ADMIN', activeSiteId: 'synthetic-site', memberships: [],
  locale: null, effectiveLocale: 'de', defaultLocale: 'de', formatLocale: 'de-AT',
  effectiveCapabilities: capabilities,
}

describe('selectEffectiveCapabilities', () => {
  it('returns the session flags unchanged rather than reconstructing a country map', () => {
    expect(selectEffectiveCapabilities(session)).toBe(capabilities)
  })

  it('returns null when the session has no authorized active legal entity', () => {
    expect(selectEffectiveCapabilities({ ...session, effectiveCapabilities: null })).toBeNull()
  })

  it.each([null, undefined])('does not invent capabilities while the session is unavailable (%s)', (value) => {
    expect(selectEffectiveCapabilities(value)).toBeNull()
  })
})
