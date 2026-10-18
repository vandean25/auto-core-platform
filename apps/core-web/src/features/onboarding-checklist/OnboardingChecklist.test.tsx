import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthSession, type AuthSession } from '@/api/auth-session'
import { OnboardingChecklist } from './OnboardingChecklist'

vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))

const HEADING = 'Werkstatt einrichten'
const DISMISS_BUTTON = 'Onboarding-Checkliste ausblenden'
const STORAGE_KEY_PREFIX = 'acp:onboarding-checklist:dismissed:'

function sessionFor(activeRole: AuthSession['activeRole'], userId = 'user-1'): AuthSession {
  return {
    userId,
    email: `${userId}@example.com`,
    activeTenant: { id: 'tenant-1', name: 'Test Workshop', slug: 'test-workshop' },
    activeRole,
    activeSiteId: null,
    memberships: [],
    locale: null,
    effectiveLocale: 'de',
    defaultLocale: 'de',
    formatLocale: 'de-AT',
  }
}

function mockSession(session: AuthSession | undefined) {
  vi.mocked(useAuthSession).mockReturnValue({ data: session } as ReturnType<typeof useAuthSession>)
}

function renderChecklist() {
  return render(
    <MemoryRouter>
      <main>
        <OnboardingChecklist />
      </main>
    </MemoryRouter>,
  )
}

function queryHeading() {
  return screen.queryByRole('heading', { name: HEADING })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(cleanup)

describe('OnboardingChecklist role gating', () => {
  it.each(['OWNER', 'ADMIN'] as const)('shows the checklist to %s', (activeRole) => {
    mockSession(sessionFor(activeRole))
    renderChecklist()

    expect(queryHeading()).toBeInTheDocument()
  })

  it.each(['SALES', 'TECH'] as const)('hides the checklist from %s', (activeRole) => {
    mockSession(sessionFor(activeRole))
    renderChecklist()

    expect(queryHeading()).not.toBeInTheDocument()
  })

  it('renders nothing until the session has loaded', () => {
    mockSession(undefined)
    renderChecklist()

    expect(queryHeading()).not.toBeInTheDocument()
  })
})

describe('OnboardingChecklist steps', () => {
  it('links each step to its page', () => {
    mockSession(sessionFor('ADMIN'))
    renderChecklist()

    expect(screen.getByRole('link', { name: 'Kunden öffnen' })).toHaveAttribute('href', '/customers')
    expect(screen.getByRole('link', { name: 'Fahrzeuge öffnen' })).toHaveAttribute('href', '/vehicles')
    expect(screen.getByRole('link', { name: 'Lager öffnen' })).toHaveAttribute('href', '/inventory')
    expect(screen.getByRole('link', { name: 'Werkstattaufträge öffnen' })).toHaveAttribute('href', '/workshop/orders')
  })
})

describe('OnboardingChecklist dismissal', () => {
  it('stays hidden after dismissing and reloading', () => {
    mockSession(sessionFor('ADMIN'))
    const firstVisit = renderChecklist()

    fireEvent.click(screen.getByRole('button', { name: DISMISS_BUTTON }))
    expect(queryHeading()).not.toBeInTheDocument()
    firstVisit.unmount()

    renderChecklist()
    expect(queryHeading()).not.toBeInTheDocument()
  })

  it('persists the dismissal keyed by the user id', () => {
    mockSession(sessionFor('ADMIN', 'user-1'))
    renderChecklist()

    fireEvent.click(screen.getByRole('button', { name: DISMISS_BUTTON }))

    expect(window.localStorage.getItem(`${STORAGE_KEY_PREFIX}user-1`)).toBe('true')
  })

  it('still shows the checklist to another user on the same browser', () => {
    mockSession(sessionFor('ADMIN', 'user-1'))
    const firstUser = renderChecklist()
    fireEvent.click(screen.getByRole('button', { name: DISMISS_BUTTON }))
    firstUser.unmount()

    mockSession(sessionFor('ADMIN', 'user-2'))
    renderChecklist()

    expect(queryHeading()).toBeInTheDocument()
  })

  it('still hides the checklist for the current visit when browser storage is unavailable', () => {
    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    mockSession(sessionFor('ADMIN'))
    renderChecklist()

    fireEvent.click(screen.getByRole('button', { name: DISMISS_BUTTON }))

    expect(queryHeading()).not.toBeInTheDocument()
  })
})

describe('OnboardingChecklist accessibility', () => {
  it('has no accessibility violations', async () => {
    mockSession(sessionFor('ADMIN'))
    const { container } = renderChecklist()

    const { violations } = await axe.run(container)

    expect(violations).toEqual([])
  })
})
