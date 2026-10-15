import { fetchWithAuth } from '@/api/client'

export async function warmLandingDemoAuthSession(): Promise<void> {
  const response = await fetchWithAuth('/api/auth/me')

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined
    throw new Error(payload?.message ?? 'Failed to fetch auth session')
  }
}
