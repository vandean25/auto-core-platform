import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import {
  prefetchMainListRoute,
  prefetchPermittedMainListRoutes,
  resetRouteChunkPrefetchForTests,
  scheduleIdleMainListPrefetch,
} from './route-chunk-prefetch'

const loaderMocks = vi.hoisted(() => ({
  workshopOrders: vi.fn(() => Promise.resolve({ default: () => null })),
  vehicles: vi.fn(() => Promise.resolve({ default: () => null })),
  workshopEstimates: vi.fn(() => Promise.resolve({ default: () => null })),
  workshopPlanner: vi.fn(() => Promise.resolve({ default: () => null })),
  ensureNamespaceLoaded: vi.fn(() => Promise.resolve()),
}))

vi.mock('./lazy-app-pages', async (original) => ({
  ...(await original<typeof import('./lazy-app-pages')>()),
  loadWorkshopOrderList: loaderMocks.workshopOrders,
  loadVehicleList: loaderMocks.vehicles,
  loadWorkshopEstimateList: loaderMocks.workshopEstimates,
  loadWorkshopPlannerPage: loaderMocks.workshopPlanner,
}))

vi.mock('@/lib/i18n', async (original) => ({
  ...(await original<typeof import('@/lib/i18n')>()),
  ensureNamespaceLoaded: loaderMocks.ensureNamespaceLoaded,
}))

const adminContext = {
  platformRole: null,
  activeRole: 'ADMIN' as const,
  capabilities: null,
}

const viewerContext = {
  platformRole: null,
  activeRole: 'DEMO' as const,
  capabilities: null,
}

function setSaveData(enabled: boolean) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { saveData: enabled },
  })
}

describe('route-chunk-prefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetRouteChunkPrefetchForTests()
    setSaveData(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: undefined,
    })
  })

  it('requests WO list, vehicles, estimates and planner chunks once on idle after login', () => {
    const cancel = scheduleIdleMainListPrefetch(adminContext)

    expect(loaderMocks.workshopOrders).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)

    expect(loaderMocks.workshopOrders).toHaveBeenCalledTimes(1)
    expect(loaderMocks.vehicles).toHaveBeenCalledTimes(1)
    expect(loaderMocks.workshopEstimates).toHaveBeenCalledTimes(1)
    expect(loaderMocks.workshopPlanner).toHaveBeenCalledTimes(1)
    expect(loaderMocks.ensureNamespaceLoaded).toHaveBeenCalledWith('workshop')
    expect(loaderMocks.ensureNamespaceLoaded).toHaveBeenCalledWith('vehicles')

    // Calling again does not re-request already prefetched chunks.
    prefetchPermittedMainListRoutes(adminContext)
    expect(loaderMocks.workshopOrders).toHaveBeenCalledTimes(1)
    expect(loaderMocks.vehicles).toHaveBeenCalledTimes(1)
    expect(loaderMocks.workshopEstimates).toHaveBeenCalledTimes(1)
    expect(loaderMocks.workshopPlanner).toHaveBeenCalledTimes(1)

    cancel()
  })

  it('prefetches a single main-list route on hover/focus before idle prefetch runs, including query links', () => {
    prefetchMainListRoute(`${APP_ROUTE_PATHS.workshopOrders}?status=OPEN`, adminContext)

    expect(loaderMocks.workshopOrders).toHaveBeenCalledTimes(1)
    expect(loaderMocks.vehicles).not.toHaveBeenCalled()
    expect(loaderMocks.workshopEstimates).not.toHaveBeenCalled()
    expect(loaderMocks.workshopPlanner).not.toHaveBeenCalled()
    expect(loaderMocks.ensureNamespaceLoaded).toHaveBeenCalledWith('workshop')
  })

  it('does not prefetch routes the user role lacks permission for (403 role)', () => {
    prefetchPermittedMainListRoutes(viewerContext)

    expect(loaderMocks.workshopOrders).toHaveBeenCalledTimes(1)
    expect(loaderMocks.vehicles).toHaveBeenCalledTimes(1)
    expect(loaderMocks.workshopPlanner).toHaveBeenCalledTimes(1)
    expect(loaderMocks.workshopEstimates).not.toHaveBeenCalled()

    // Even direct hover/focus on an estimates saved view is blocked for non-permitted roles.
    prefetchMainListRoute(`${APP_ROUTE_PATHS.workshopEstimates}?status=DRAFT`, viewerContext)
    expect(loaderMocks.workshopEstimates).not.toHaveBeenCalled()
  })

  it('does not prefetch when navigator.connection.saveData is enabled', () => {
    setSaveData(true)

    const cancel = scheduleIdleMainListPrefetch(adminContext)
    vi.advanceTimersByTime(500)
    prefetchMainListRoute(APP_ROUTE_PATHS.workshopOrders, adminContext)

    expect(loaderMocks.workshopOrders).not.toHaveBeenCalled()
    expect(loaderMocks.vehicles).not.toHaveBeenCalled()
    expect(loaderMocks.workshopEstimates).not.toHaveBeenCalled()
    expect(loaderMocks.workshopPlanner).not.toHaveBeenCalled()

    cancel()
  })
})
