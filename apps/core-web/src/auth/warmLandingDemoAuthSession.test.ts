import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE } from '@/auth/landing-demo-auth-session-error'
import { warmLandingDemoAuthSession } from '@/auth/warmLandingDemoAuthSession'

const fetchWithAuth = vi.fn()

vi.mock('@/api/client', () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
}))

describe('warmLandingDemoAuthSession', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset()
  })

  it('throws a typed error when the demo grant is rejected', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      json: async () => ({
        code: LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE,
        message: 'Demo sign-in link is missing, expired, or already used.',
      }),
    })

    await expect(warmLandingDemoAuthSession()).rejects.toMatchObject({
      code: LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE,
    })
  })
})
