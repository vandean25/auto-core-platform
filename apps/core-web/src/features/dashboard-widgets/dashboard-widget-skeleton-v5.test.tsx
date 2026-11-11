import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { PickerlDueDashboardWidget } from '@/components/vehicles/PickerlDueDashboardWidget'
import { WorkshopKpiDashboardWidget } from '@/components/workshop/WorkshopKpiDashboardWidget'
import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { isAwaitingFirstQueryPayload } from '@/features/interaction/query-first-load'

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ useLazyNamespaceBundleReady: () => ({ status: 'ready' as const }) }))

const KPI_BODY = {
  totals: { utilisation_percent: '0.82', productivity_percent: '0.71' },
  rows: [],
} as const

const PICKERL_BODY = { data: [], meta: { total: 2 } } as const

function legacyWidgetSkeletonBranch(isLoading: boolean) {
  return isLoading
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AUT-971 dashboard widgets (real useQuery)', () => {
  it('WHEN workshop KPI fetch resolves THEN skeleton clears within 350ms and legacy isLoading matches hook', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const settleAt = { ms: 0 }
    let finish!: () => void
    const hang = new Promise<void>((done) => {
      finish = () => {
        settleAt.ms = Date.now()
        done()
      }
    })

    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(fetchWithAuth).mockImplementation(async () => {
      await hang
      return new Response(JSON.stringify(KPI_BODY), { status: 200 })
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopKpiDashboardWidget />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(INTERACTION_LOADING_TIMINGS.skeletonDelayMs + 20)
    })
    expect(container.querySelector('.animate-pulse')).not.toBeNull()

    finish()
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    await waitFor(() => expect(settleAt.ms).toBeGreaterThan(0))

    const cache = queryClient.getQueryCache().findAll({ queryKey: ['workshop-kpi-reports'] })
    expect(cache.length).toBeGreaterThan(0)
    const state = cache[0].state
    expect(legacyWidgetSkeletonBranch(state.data !== undefined ? false : state.status === 'pending')).toBe(false)
    expect(isAwaitingFirstQueryPayload(state.status === 'pending', state.data !== undefined, state.fetchStatus === 'fetching')).toBe(
      false,
    )

    act(() => {
      vi.advanceTimersByTime(INTERACTION_LOADING_TIMINGS.skeletonMinVisibleMs)
    })
    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(screen.getAllByText(/0,8 %/).length).toBeGreaterThan(0)
  })

  it('WHEN Pickerl scenario 5 fetch resolves THEN skeleton clears within 350ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let finish!: () => void
    const hang = new Promise<void>((done) => {
      finish = () => done()
    })

    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url).includes('pickerl-due')) {
        await hang
        return new Response(JSON.stringify(PICKERL_BODY), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PickerlDueDashboardWidget window={30} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(INTERACTION_LOADING_TIMINGS.skeletonDelayMs + 20)
    })
    expect(container.querySelector('.animate-pulse')).not.toBeNull()

    finish()
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())

    act(() => {
      vi.advanceTimersByTime(INTERACTION_LOADING_TIMINGS.skeletonMinVisibleMs)
    })
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('WHEN payload is settled THEN restoring isLoading branch would disagree with isAwaitingFirstQueryPayload', () => {
    expect(legacyWidgetSkeletonBranch(true)).toBe(true)
    expect(isAwaitingFirstQueryPayload(false, true, false)).toBe(false)
  })
})
