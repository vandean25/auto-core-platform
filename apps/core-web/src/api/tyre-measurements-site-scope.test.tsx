import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useClientSessionGeneration } from '@/auth/client-session-reset'
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { SITE_CONTEXT_UPDATED_EVENT } from '@/features/realtime/types'
import { TyreMeasurementSection } from '@/features/tyre-report/TyreMeasurementSection'
import { measurement } from '@/features/tyre-report/tyre-report.test-fixtures'
import { authSessionKeys, type AuthSession } from './auth-session'
import { fetchWithAuth } from './client'
import { clearLocalSiteSwitch } from './local-site-switch'
import { useSetActiveSite } from './sites'
import type { TyreMeasurementParent } from './tyre-measurements'
import { tyreMeasurementKeys } from './tyre-measurement-keys'

const mocks = vi.hoisted(() => {
  const user = { uid: 'scope-test-user', getIdToken: vi.fn().mockResolvedValue('test-token') }
  return {
    user,
    socket: { on: vi.fn(), off: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), active: false },
    signOutUser: vi.fn(),
  }
})
vi.mock('./client', () => ({ API_BASE_URL: '', fetchWithAuth: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ firebaseAuth: { currentUser: mocks.user }, firebaseConfigMissing: false }))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: mocks.user, signOutUser: mocks.signOutUser }) }))
vi.mock('socket.io-client', () => ({ io: () => mocks.socket }))

const session = {
  userId: 'scope-test-user', email: 'scope@example.invalid',
  activeTenant: { id: 'tenant-1', name: 'Test workshop', slug: 'test-workshop' },
  activeRole: 'TECH' as const, activeSiteId: 'site-1', memberships: [],
  locale: null, effectiveLocale: 'de' as const, defaultLocale: 'de' as const, formatLocale: 'de-AT',
  effectiveCapabilities: null,
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function reportResponse(brand: string) {
  return jsonResponse({
    data: [{ ...measurement, measuredByName: null, wheels: measurement.wheels.map((wheel) => ({ ...wheel, brand })) }],
    meta: { total: 1, page: 1, pageSize: 20, pageCount: 1 },
  })
}

function SwitchSite() {
  const switchSite = useSetActiveSite()
  return <button type="button" onClick={() => switchSite.mutate('site-2')}>Switch site</button>
}

/** A site switch resets the client session; the app remounts the authenticated shell on a new generation. */
function RemountOnClientSessionReset({ children }: { children: React.ReactNode }) {
  const generation = useClientSessionGeneration()
  return <React.Fragment key={generation}>{children}</React.Fragment>
}

let client: QueryClient
let currentSession: AuthSession
let reportRequest: () => Promise<Response>

beforeEach(() => {
  vi.clearAllMocks()
  clearLocalSiteSwitch()
  currentSession = session
  reportRequest = async () => reportResponse('Old evidence')
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
    if (url === '/api/auth/me') return jsonResponse(currentSession)
    if (url === '/api/me/active-site') return jsonResponse({ activeSiteId: currentSession.activeSiteId })
    if (String(url).endsWith('/tyre-measurements')) return reportRequest()
    throw new Error(`Unexpected request: ${String(url)}`)
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  clearLocalSiteSwitch()
})

async function mount(parent: TyreMeasurementParent) {
  client.setQueryData(authSessionKeys.user(mocks.user.uid), currentSession)
  render(<QueryClientProvider client={client}>
    <RemountOnClientSessionReset>
      <MemoryRouter initialEntries={['?action=recordTyreMeasurement']}>
        <RealtimeDashboardSyncProvider>
          <SwitchSite />
          <TyreMeasurementSection parent={parent} orderId="order-1" />
        </RealtimeDashboardSyncProvider>
      </MemoryRouter>
    </RemountOnClientSessionReset>
  </QueryClientProvider>)
  await waitFor(() => expect(screen.getAllByText('Old evidence')).toHaveLength(4))
  expect(screen.getByLabelText('Vorne links Marke')).toHaveValue('Old evidence')
  await waitFor(() => expect(mocks.socket.on).toHaveBeenCalledWith(SITE_CONTEXT_UPDATED_EVENT, expect.any(Function)))
}

async function switchContext(transport: 'HTTP' | 'websocket') {
  if (transport === 'HTTP') {
    fireEvent.click(screen.getByText('Switch site'))
  } else {
    const handler = mocks.socket.on.mock.calls.find(([event]) => event === SITE_CONTEXT_UPDATED_EVENT)![1] as (payload: unknown) => void
    await act(async () => { handler({ siteId: 'site-2', timestamp: '2026-10-29T12:00:00Z' }) })
  }
}

describe.each(['order', 'check-in'] as const)('%s mounted tyre evidence', (kind) => {
  const parent = { kind, id: kind === 'order' ? 'order-1' : 'check-in-1' }

  it('preserves unsaved same-site readings during a temporary background failure', async () => {
    await mount(parent)
    fireEvent.change(screen.getByLabelText('Vorne links Innen'), { target: { value: '5.25' } })
    reportRequest = async () => jsonResponse({ statusCode: 503, message: 'Unavailable' }, 503)
    await act(async () => { await client.invalidateQueries({ queryKey: tyreMeasurementKeys.all }) })
    await screen.findByRole('alert', { hidden: true })
    expect(screen.getByLabelText('Vorne links Innen')).toHaveValue(5.25)
    expect(screen.getByRole('button', { name: 'Messung verwerfen' })).toBeEnabled()
  })

  it.each(['HTTP', 'websocket'] as const)('reinitializes the form when %s switches to an already cached site', async (transport) => {
    client.setQueryData(tyreMeasurementKeys.list(parent, 'site-2'), await reportResponse('Cached evidence').json())
    await mount(parent)
    fireEvent.change(screen.getByLabelText('Vorne links Innen'), { target: { value: '5.25' } })
    reportRequest = async () => reportResponse('Cached evidence')
    currentSession = { ...session, activeSiteId: 'site-2' }
    await switchContext(transport)
    await waitFor(() => expect(screen.getAllByText('Cached evidence')).toHaveLength(4))
    expect(screen.getByLabelText('Vorne links Marke')).toHaveValue('Cached evidence')
    expect(screen.getByLabelText('Vorne links Innen')).toHaveValue(null)
  })

  it.each(['HTTP', 'websocket'] as const)('refreshes the report on %s even when the session already shows the selected site', async (transport) => {
    currentSession = { ...session, activeSiteId: 'site-2' }
    await mount(parent)
    reportRequest = async () => reportResponse('Fresh evidence')

    await switchContext(transport)

    await waitFor(() => expect(screen.getAllByText('Fresh evidence')).toHaveLength(4))
    expect(screen.queryAllByText('Old evidence')).toHaveLength(0)
  })

  it.each(['HTTP', 'websocket'] as const)('hides both the report and seeded form when %s revalidation returns 404', async (transport) => {
    currentSession = { ...session, activeSiteId: 'site-2' }
    await mount(parent)
    reportRequest = async () => jsonResponse({ statusCode: 404, message: 'Not found' }, 404)

    await switchContext(transport)

    await waitFor(() => expect(screen.getByRole('alert', { hidden: true })).toBeInTheDocument())
    expect(screen.queryAllByText('Old evidence')).toHaveLength(0)
    expect(screen.queryByLabelText('Vorne links Marke')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Messung speichern' })).not.toBeInTheDocument()
  })

  it.each(['HTTP', 'websocket'] as const)('hides old evidence while the new %s scope is pending and remains hidden after 404', async (transport) => {
    await mount(parent)
    let rejectScope!: (response: Response) => void
    reportRequest = () => new Promise<Response>((resolve) => { rejectScope = resolve })
    currentSession = { ...session, activeSiteId: 'site-2' }

    await switchContext(transport)

    await waitFor(() => expect(client.getQueryData(authSessionKeys.user(mocks.user.uid))).toMatchObject({ activeSiteId: 'site-2' }))
    await waitFor(() => expect(screen.queryAllByText('Old evidence')).toHaveLength(0))
    expect(screen.queryByLabelText('Vorne links Marke')).not.toBeInTheDocument()
    await act(async () => { rejectScope(jsonResponse({ statusCode: 404, message: 'Not found' }, 404)) })
    await waitFor(() => expect(screen.getByRole('alert', { hidden: true })).toBeInTheDocument())
    expect(screen.queryAllByText('Old evidence')).toHaveLength(0)
    expect(screen.queryByLabelText('Vorne links Marke')).not.toBeInTheDocument()
  })
})
