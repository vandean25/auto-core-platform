import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LandingDemoEmailLinkCompletionPage, {
  resetLandingDemoAutoCompletionGuardForTests,
} from './LandingDemoEmailLinkCompletionPage'
import { LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY } from '@/auth/landing-demo-email-link'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

const completeSignIn = vi.fn()
const warmSession = vi.fn()
const navigate = vi.fn()

vi.mock('@/auth/completeLandingDemoEmailLinkSignIn', () => ({
  completeLandingDemoEmailLinkSignIn: (...args: unknown[]) => completeSignIn(...args),
}))

vi.mock('@/auth/warmLandingDemoAuthSession', () => ({
  warmLandingDemoAuthSession: () => warmSession(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

vi.mock('@/auth/landing-demo-email-link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/auth/landing-demo-email-link')>()
  return {
    ...actual,
    isFirebaseEmailLinkSignInUrl: vi.fn(() => true),
    resolveLandingDemoAccessUrl: vi.fn(() => 'https://landing.example/demo'),
    clearFirebaseEmailLinkQueryParams: vi.fn(() => '/login'),
  }
})

vi.mock('@/lib/firebase', () => ({
  firebaseConfigMissing: false,
  firebaseAuth: {},
}))

function renderCompletionPage() {
  return render(
    <MemoryRouter initialEntries={['/login?oobCode=test&mode=signIn']}>
      <LandingDemoEmailLinkCompletionPage />
    </MemoryRouter>,
  )
}

describe('LandingDemoEmailLinkCompletionPage', () => {
  beforeEach(() => {
    resetLandingDemoAutoCompletionGuardForTests()
    completeSignIn.mockReset()
    warmSession.mockReset()
    navigate.mockReset()
    globalThis.localStorage.clear()
    vi.stubEnv('VITE_LANDING_PAGE_URL', 'https://landing.example/demo')
    warmSession.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    resetLandingDemoAutoCompletionGuardForTests()
    vi.unstubAllEnvs()
    globalThis.localStorage.clear()
  })

  it('loads the demo session and navigates into the app after a successful sign-in', async () => {
    globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, 'demo@example.com')
    completeSignIn.mockResolvedValue(undefined)

    renderCompletionPage()

    await waitFor(() => {
      expect(completeSignIn).toHaveBeenCalledWith(
        'demo@example.com',
        expect.stringContaining('http'),
      )
    })
    expect(warmSession).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(APP_ROUTE_PATHS.inventory, { replace: true })
  })

  it('runs auto sign-in only once under React StrictMode', async () => {
    globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, 'demo@example.com')
    completeSignIn.mockResolvedValue(undefined)

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/login?oobCode=test&mode=signIn']}>
          <LandingDemoEmailLinkCompletionPage />
        </MemoryRouter>
      </StrictMode>,
    )

    await waitFor(() => {
      expect(completeSignIn).toHaveBeenCalledTimes(1)
    })
  })

  it('asks for the email when localStorage is empty', async () => {
    renderCompletionPage()

    expect(await screen.findByLabelText('E-Mail')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Demo starten' })).toBeInTheDocument()
  })

  it('shows expired-link recovery when Firebase reports an invalid action code', async () => {
    globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, 'demo@example.com')
    completeSignIn.mockRejectedValue({ code: 'auth/invalid-action-code' })

    renderCompletionPage()

    expect(
      await screen.findByText(/abgelaufen oder wurde bereits verwendet/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Neuen Demo-Link anfordern' })).toHaveAttribute(
      'href',
      'https://landing.example/demo',
    )
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).not.toBeInTheDocument()
  })

  it('shows a retry message without a new-link button for network failures', async () => {
    globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, 'demo@example.com')
    completeSignIn.mockRejectedValue({ code: 'auth/network-request-failed' })

    renderCompletionPage()

    expect(
      await screen.findByText(/Internetverbindung/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Neuen Demo-Link anfordern' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
  })

  it('submits the entered email when the user confirms', async () => {
    completeSignIn.mockResolvedValue(undefined)

    renderCompletionPage()

    fireEvent.change(await screen.findByLabelText('E-Mail'), {
      target: { value: 'typed@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Demo starten' }))

    await waitFor(() => {
      expect(completeSignIn).toHaveBeenCalledWith('typed@example.com', expect.any(String))
    })
    expect(warmSession).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(APP_ROUTE_PATHS.inventory, { replace: true })
  })
})
