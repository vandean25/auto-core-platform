import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EffectiveCapabilities } from '@/api/auth-session'
import { registerGermanUiForTests } from '@/test/german-ui'
import { DashboardKpiRow } from './DashboardKpiRow'

registerGermanUiForTests()

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  capabilities: null as EffectiveCapabilities | null,
}))

vi.mock('@/api/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth-session')>()),
  useAuthSession: () => ({ data: { effectiveCapabilities: mocks.capabilities } }),
}))
vi.mock('@/api/client', () => ({ fetchWithAuth: mocks.fetchWithAuth }))

const AT_CAPABILITIES: EffectiveCapabilities = { nova: true, pickerl57a: true, kaufvertragAt: true, willhabenExport: true }
const PICKERL_TITLE = /Pickerl fällig in \d+ Tagen/

function renderRow() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardKpiRow />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function pickerlRequests() {
  return mocks.fetchWithAuth.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.includes('/vehicles/pickerl-due'))
}

beforeEach(() => {
  mocks.fetchWithAuth.mockImplementation(async () => new Response(JSON.stringify({ data: [], meta: { total: 4 } })))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('dashboard KPI row Pickerl cards (AUT-686)', () => {
  it('renders the three Pickerl due cards and requests them when pickerl57a is on', async () => {
    mocks.capabilities = AT_CAPABILITIES

    renderRow()

    await waitFor(() => expect(screen.getAllByText(PICKERL_TITLE)).toHaveLength(3))
    expect(pickerlRequests()).not.toHaveLength(0)
  })

  it.each([false, null])('hides the Pickerl due cards and sends no Pickerl request when pickerl57a is %s', async (enabled) => {
    mocks.capabilities = enabled === null ? null : { ...AT_CAPABILITIES, pickerl57a: enabled }

    renderRow()

    await waitFor(() => expect(mocks.fetchWithAuth).toHaveBeenCalled())
    expect(screen.queryByText(PICKERL_TITLE)).not.toBeInTheDocument()
    expect(pickerlRequests()).toEqual([])
  })
})
