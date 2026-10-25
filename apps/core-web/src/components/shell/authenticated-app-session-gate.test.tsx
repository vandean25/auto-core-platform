import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { registerGermanUiForTests } from '@/test/german-ui'

vi.mock('@/components/shell/AuthSessionRevokedRedirect', () => ({
  AuthSessionRevokedRedirect: () => <div data-testid="session-revoked-redirect" />,
}))

import type { AuthSession } from '@/api/auth-session'
import { resolveAuthenticatedSessionGate } from '@/components/shell/authenticated-app-session-gate'
import { createHttpError } from '@/lib/error-utils'

registerGermanUiForTests()

const sessionFixture: AuthSession = {
  userId: 'user-1',
  email: 'testauto@auto.core.at',
  activeTenant: {
    id: 'tenant-a',
    name: 'Auto Core Vienna',
    slug: 'vienna',
  },
  activeRole: 'ADMIN',
  memberships: [],
  activeSiteId: null,
  locale: null,
  effectiveLocale: 'de',
  defaultLocale: 'de',
  formatLocale: 'de-AT',
}

describe('resolveAuthenticatedSessionGate', () => {
  it('shows the demo rejection screen for a 401 with an invalid demo grant message', () => {
    const signOutUser = vi.fn()
    const gate = resolveAuthenticatedSessionGate(
      {
        isError: true,
        error: createHttpError(
          'Demo sign-in link is missing, expired, or already used.',
          401,
        ),
        data: sessionFixture,
      },
      signOutUser,
    )

    render(<>{gate}</>)

    expect(
      screen.getByRole('heading', { name: 'Demo-Zugang nicht verfügbar' }),
    ).toBeInTheDocument()
    expect(signOutUser).not.toHaveBeenCalled()
  })

  it('routes a plain 401 to session revocation instead of the demo rejection screen', () => {
    const gate = resolveAuthenticatedSessionGate(
      {
        isError: true,
        error: createHttpError('Unauthorized', 401),
        data: sessionFixture,
      },
      vi.fn(),
    )

    render(<>{gate}</>)

    expect(screen.getByTestId('session-revoked-redirect')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Demo-Zugang nicht verfügbar' }),
    ).not.toBeInTheDocument()
  })
})
