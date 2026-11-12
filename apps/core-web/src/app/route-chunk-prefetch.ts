import { useEffect } from 'react'
import {
  getClientSessionGeneration,
  isClientSessionResetting,
} from '@/auth/client-session-reset'
import { getVisibleNavGroups, type NavAccessContext } from '@/components/navigation/nav-config'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { LazyNamespace } from '@/lib/i18n/constants'
import { isSaveDataEnabled } from '@/lib/intent-prefetch'
import {
  loadVehicleList,
  loadWorkshopEstimateList,
  loadWorkshopOrderList,
  loadWorkshopPlannerPage,
} from './lazy-app-pages'

type MainListRouteEntry = {
  path: string
  loadChunk: () => Promise<unknown>
  namespaces: readonly LazyNamespace[]
}

const MAIN_LIST_ROUTES: readonly MainListRouteEntry[] = [
  {
    path: APP_ROUTE_PATHS.workshopOrders,
    loadChunk: loadWorkshopOrderList,
    namespaces: ['workshop'],
  },
  {
    path: APP_ROUTE_PATHS.vehicles,
    loadChunk: loadVehicleList,
    namespaces: ['vehicles'],
  },
  {
    path: APP_ROUTE_PATHS.workshopEstimates,
    loadChunk: loadWorkshopEstimateList,
    namespaces: ['workshop'],
  },
  {
    path: APP_ROUTE_PATHS.workshopPlanner,
    loadChunk: loadWorkshopPlannerPage,
    namespaces: ['workshop'],
  },
]

const MAIN_LIST_ROUTE_MAP = new Map<string, MainListRouteEntry>(
  MAIN_LIST_ROUTES.map((entry) => [entry.path, entry]),
)

const IDLE_FALLBACK_DELAY_MS = 200
const IDLE_TIMEOUT_MS = 1500
const requestedRoutes = new Set<string>()

function normalizeRoutePath(href: string): string {
  const withoutHash = href.split('#', 1)[0] ?? ''
  return withoutHash.split('?', 1)[0] ?? ''
}

function isRoutePermitted(path: string, context: NavAccessContext): boolean {
  if (!context.activeRole || context.activeRole === 'TECH') {
    return false
  }
  const visiblePaths = new Set(
    getVisibleNavGroups(context).flatMap((group) => group.items.map((item) => item.to)),
  )
  return visiblePaths.has(path)
}

function triggerRoutePrefetch(entry: MainListRouteEntry): void {
  if (requestedRoutes.has(entry.path)) {
    return
  }
  requestedRoutes.add(entry.path)
  void entry.loadChunk().catch(() => {})
  for (const namespace of entry.namespaces) {
    void ensureNamespaceLoaded(namespace).catch(() => {})
  }
}

export function isMainListRoutePath(pathname: string): boolean {
  return MAIN_LIST_ROUTE_MAP.has(normalizeRoutePath(pathname))
}

/** Prefetches a main-list route's JS chunk and lazy locale bundle once, respecting saveData and permissions. */
export function prefetchMainListRoute(href: string, context: NavAccessContext): void {
  if (isSaveDataEnabled() || isClientSessionResetting()) {
    return
  }
  const entry = MAIN_LIST_ROUTE_MAP.get(normalizeRoutePath(href))
  if (!entry || !isRoutePermitted(entry.path, context)) {
    return
  }
  triggerRoutePrefetch(entry)
}

/** Prefetches all permitted main-list route chunks once, respecting saveData and permissions. */
export function prefetchPermittedMainListRoutes(context: NavAccessContext): void {
  if (isSaveDataEnabled() || isClientSessionResetting()) {
    return
  }
  for (const entry of MAIN_LIST_ROUTES) {
    if (isRoutePermitted(entry.path, context)) {
      triggerRoutePrefetch(entry)
    }
  }
}

/** Schedules idle prefetching of permitted main-list route chunks after login. */
export function scheduleIdleMainListPrefetch(context: NavAccessContext): () => void {
  if (isSaveDataEnabled() || isClientSessionResetting()) {
    return () => {}
  }

  const generation = getClientSessionGeneration()
  const run = () => {
    if (
      isSaveDataEnabled() ||
      isClientSessionResetting() ||
      getClientSessionGeneration() !== generation
    ) {
      return
    }
    prefetchPermittedMainListRoutes(context)
  }

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const idleId = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS })
    return () => window.cancelIdleCallback(idleId)
  }

  const timerId = setTimeout(run, IDLE_FALLBACK_DELAY_MS)
  return () => clearTimeout(timerId)
}

export function useIdleMainListPrefetch(context: NavAccessContext): void {
  const { platformRole, activeRole, capabilities } = context
  useEffect(
    () => scheduleIdleMainListPrefetch({ platformRole, activeRole, capabilities }),
    [platformRole, activeRole, capabilities],
  )
}

export function resetRouteChunkPrefetchForTests(): void {
  requestedRoutes.clear()
}
