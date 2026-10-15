import { fetchWithAuth } from '@/api/client'
import { LandingDemoAuthSessionError } from '@/auth/landing-demo-auth-session-error'

export async function warmLandingDemoAuthSession(): Promise<void> {
  const response = await fetchWithAuth('/api/auth/me')

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      | { message?: string; code?: string }
      | undefined
    throw new LandingDemoAuthSessionError(
      payload?.message ?? 'Failed to fetch auth session',
      payload?.code,
    )
  }
}
