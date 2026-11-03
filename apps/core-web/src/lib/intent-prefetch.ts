import {
  hashKey,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import {
  getClientSessionGeneration,
  isClientSessionResetting,
  subscribeClientSessionState,
} from '@/auth/client-session-reset'

/**
 * Shared 100 ms intent-prefetch scheduler (ADR-0036 R4, AUT-875).
 *
 * One module used by navigable lists to prefetch detail queries on user intent:
 * - Sustained hover (`pointerenter` with non-touch pointer) or keyboard `focus` waits 100 ms.
 * - `pointerdown` (non-touch) starts immediately and cancels any pending timer for that target.
 * - `pointerleave`, `blur`, and unmount cancel pending timers before any request is sent.
 * - Deduplicates in-flight requests and skips cached entries that are still fresh (`staleTime`).
 * - Bounds concurrent speculative requests (`MAX_CONCURRENT_PREFETCHES = 2`) and retained
 *   speculative detail cache entries (`MAX_RETAINED_DETAIL_ENTRIES = 20`) with finite `gcTime`.
 * - Skips all speculative work when `navigator.connection.saveData` is enabled.
 * - Silently ignores prefetch errors and cancels/clears all state on session or context reset.
 *
 * Per-list prefetch eligibility & reasoned exceptions (ADR-0036 R4):
 *
 * | List / Surface | Owning Component / Hook | Eligibility | Detail Query Key / Reasoned Exception |
 * |---|---|---|---|
 * | Work orders | `WorkshopOrderList` / `useWorkshopOrderListRowBehaviour` | Eligible (wired) | `workshopKeys.detail(id)` via `workshopOrderDetailQueryOptions` (`canOpenWorkshopOrder`) |
 * | Mechanic queue | `MechanicQueuePage` / `MechanicQueueCard` | Eligible (wired) | `mechanicQueueKeys.taskDetail(taskId)` via `mechanicTaskDetailQueryOptions` |
 * | Vehicles | `VehicleList` / `useVehicleListRowBehaviour` | Eligible (wired) | `vehicleKeys.detail(id)` via `vehicleDetailQueryOptions` (`canOpenVehicle`) |
 * | Customers | `CustomerList` / `useCustomerListRowBehaviour` | Eligible (wired) | `customerKeys.detail(id)` via `customerDetailQueryOptions` (`canOpenCustomer`) |
 * | Invoices | `InvoiceListPage` | Eligible (wired) | `invoiceKeys.detail(id)` via `invoiceDetailQueryOptions` (`canOpenBackOfficeDetail`) |
 * | Stock vehicles | `VehicleStockList` | Eligible (wired) | `vehicleStockKeys.detail(id)` or `vehicleStockKeys.purchase(draft_purchase_id)` (`canOpenBackOfficeDetail`) |
 * | Parts (Inventory) | `InventoryList` | Eligible (wired) | `inventoryKeys.detail(id)` via `inventoryItemDetailQueryOptions` (`canOpenBackOfficeDetail`) |
 * | Sales orders | `SalesOrderList` / `useSalesOrderListRowBehaviour` | Deferred (out of scope for AUT-875) | Navigable to `/sales-orders/:id`; deferred to module migration slice |
 * | Workshop estimates | `WorkshopEstimateListPage` | Deferred (out of scope for AUT-875) | Navigable to `/workshop/estimates/:id`; deferred to module migration slice |
 * | Purchase orders | `PurchaseOrderList` | Deferred (out of scope for AUT-875) | Navigable to `/purchase-orders/:id`; deferred to module migration slice |
 * | Purchase invoices | `PurchaseInvoiceListPage` | Deferred (out of scope for AUT-875) | Navigable to `/purchase-invoices/:id`; deferred to module migration slice |
 * | Stock transfers | `TransferListPage` | Deferred (out of scope for AUT-875) | Navigable to `/inventory/transfers/:id`; deferred to module migration slice |
 * | Pickerl due list | `PickerlDueList` | Deferred (out of scope for AUT-875) | Navigable to `/vehicles/:id`; deferred to module migration slice |
 * | Gewaehrleistung due list | `GewaehrleistungDueListPage` | Deferred (out of scope for AUT-875) | Navigable to `/vehicle-stock/:vehicleId`; deferred to module migration slice |
 * | Pick list | `PickListPage` | Exception (no detail route) | Action-only queue that opens a pick modal; no separate detail query |
 * | Vendors | `VendorList` | Exception (no detail route) | Row click edits the already-loaded row in a modal dialog |
 * | Employees (HR) | `HrEmployeeListPage` | Exception (no detail route) | Row actions open inline dialogs using row data; no detail endpoint |
 * | Time tracking (HR) | `HrTimeTrackingPage` | Exception (no detail route) | Read-only attendance log rows without a detail page |
 * | Absences (HR) | `HrAbsencesPage` | Exception (no detail route) | Inline approval/status rows without a detail page |
 * | Audit log | `AuditLogSection` | Exception (no detail route) | Immutable log table with no record detail view |
 * | Import history | `ImportHistorySection` | Exception (no detail route) | Status/action rows in settings with no detail route |
 * | Settings master-data tables | `SettingsPage` / `LocationsPage` / `CatalogLaborSection` | Exception (no detail route) | Inline configuration dialogs backed by the list query |
 */

export const INTENT_PREFETCH_DELAY_MS = 100
export const DETAIL_PREFETCH_STALE_MS = 30_000
export const DETAIL_PREFETCH_GC_MS = 5 * 60_000
export const MAX_CONCURRENT_PREFETCHES = 2
export const MAX_RETAINED_DETAIL_ENTRIES = 20

type NavigatorWithConnection = Navigator & {
  connection?: {
    saveData?: boolean
  }
}

type QueuedPrefetch = {
  generation: number
  run: () => void
}

type RetainedEntry = {
  queryClient: QueryClient
  queryKey: QueryKey
}

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const inFlightKeys = new Set<string>()
const queuedPrefetches = new Map<string, QueuedPrefetch>()
const retainedDetailEntries = new Map<string, RetainedEntry>()

subscribeClientSessionState(() => {
  if (isClientSessionResetting()) {
    resetIntentPrefetchScheduler()
  }
})

export function isSaveDataEnabled(): boolean {
  if (typeof navigator === 'undefined') return false
  return Boolean((navigator as NavigatorWithConnection).connection?.saveData)
}

/**
 * Schedules `callback` to run after `delayMs` (default 100 ms) of sustained hover or focus.
 * Re-scheduling the same `intentKey` resets its timer.
 */
export function scheduleIntentPrefetch(
  intentKey: string,
  callback: () => void,
  delayMs: number = INTENT_PREFETCH_DELAY_MS,
): void {
  if (!intentKey || isSaveDataEnabled() || isClientSessionResetting()) {
    return
  }

  const existingTimer = pendingTimers.get(intentKey)
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer)
  }

  const generation = getClientSessionGeneration()
  const timer = setTimeout(() => {
    pendingTimers.delete(intentKey)
    if (
      isSaveDataEnabled() ||
      isClientSessionResetting() ||
      getClientSessionGeneration() !== generation
    ) {
      return
    }
    callback()
  }, delayMs)

  pendingTimers.set(intentKey, timer)
}

/**
 * Starts `callback` immediately (e.g. on non-touch `pointerdown`) and cancels any pending timer
 * for `intentKey`.
 */
export function startImmediateIntentPrefetch(
  intentKey: string,
  callback: () => void,
): void {
  if (intentKey) {
    cancelIntentPrefetch(intentKey)
  }
  if (isSaveDataEnabled() || isClientSessionResetting()) {
    return
  }
  callback()
}

/**
 * Cancels a pending intent timer (and any queued prefetch) for `intentKey`, or all pending timers
 * when `intentKey` is omitted.
 */
export function cancelIntentPrefetch(intentKey?: string): void {
  if (intentKey !== undefined) {
    const timer = pendingTimers.get(intentKey)
    if (timer !== undefined) {
      clearTimeout(timer)
      pendingTimers.delete(intentKey)
    }
    queuedPrefetches.delete(intentKey)
    return
  }

  for (const timer of pendingTimers.values()) {
    clearTimeout(timer)
  }
  pendingTimers.clear()
  queuedPrefetches.clear()
}

function isQueryFreshOrInFlight(
  queryClient: QueryClient,
  queryKey: QueryKey,
  keyHash: string,
  staleTime: number,
): boolean {
  if (inFlightKeys.has(keyHash)) {
    return true
  }

  const state = queryClient.getQueryState(queryKey)
  if (!state) {
    return false
  }

  if (state.fetchStatus === 'fetching') {
    return true
  }

  if (
    state.status === 'success' &&
    !state.isInvalidated &&
    state.dataUpdatedAt > 0 &&
    Date.now() - state.dataUpdatedAt < staleTime
  ) {
    return true
  }

  return false
}

function touchRetainedDetailEntry(
  keyHash: string,
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  retainedDetailEntries.delete(keyHash)
  retainedDetailEntries.set(keyHash, { queryClient, queryKey })

  if (retainedDetailEntries.size <= MAX_RETAINED_DETAIL_ENTRIES) {
    return
  }

  for (const [candidateHash, entry] of retainedDetailEntries.entries()) {
    if (retainedDetailEntries.size <= MAX_RETAINED_DETAIL_ENTRIES) {
      break
    }
    if (candidateHash === keyHash || inFlightKeys.has(candidateHash)) {
      continue
    }
    const query = entry.queryClient.getQueryCache().find({
      queryKey: entry.queryKey,
      exact: true,
    })
    if (query && query.getObserversCount() > 0) {
      continue
    }
    retainedDetailEntries.delete(candidateHash)
    entry.queryClient.removeQueries({ queryKey: entry.queryKey, exact: true })
  }
}

function drainQueuedPrefetches(): void {
  while (
    inFlightKeys.size < MAX_CONCURRENT_PREFETCHES &&
    queuedPrefetches.size > 0
  ) {
    const nextEntry = queuedPrefetches.entries().next().value
    if (!nextEntry) break
    const [keyHash, queued] = nextEntry
    queuedPrefetches.delete(keyHash)

    if (
      isSaveDataEnabled() ||
      isClientSessionResetting() ||
      getClientSessionGeneration() !== queued.generation
    ) {
      continue
    }

    queued.run()
  }
}

function resolveStaleTimeMs(staleTime: unknown): number {
  return typeof staleTime === 'number' && Number.isFinite(staleTime)
    ? staleTime
    : DETAIL_PREFETCH_STALE_MS
}

function executeDetailPrefetch<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  keyHash: string,
): void {
  if (isSaveDataEnabled() || isClientSessionResetting()) {
    return
  }

  const staleTime = resolveStaleTimeMs(options.staleTime)
  const gcTime = options.gcTime ?? DETAIL_PREFETCH_GC_MS

  if (isQueryFreshOrInFlight(queryClient, options.queryKey, keyHash, staleTime)) {
    return
  }

  const generation = getClientSessionGeneration()

  const startRequest = () => {
    if (
      isSaveDataEnabled() ||
      isClientSessionResetting() ||
      getClientSessionGeneration() !== generation ||
      isQueryFreshOrInFlight(queryClient, options.queryKey, keyHash, staleTime)
    ) {
      return
    }

    inFlightKeys.add(keyHash)
    touchRetainedDetailEntry(keyHash, queryClient, options.queryKey)

    void Promise.resolve(
      queryClient.prefetchQuery({
        ...options,
        staleTime,
        gcTime,
      }),
    )
      .catch(() => undefined)
      .finally(() => {
        inFlightKeys.delete(keyHash)
        if (
          !isClientSessionResetting() &&
          getClientSessionGeneration() === generation
        ) {
          drainQueuedPrefetches()
        }
      })
  }

  if (inFlightKeys.size >= MAX_CONCURRENT_PREFETCHES) {
    queuedPrefetches.delete(keyHash)
    if (queuedPrefetches.size >= MAX_CONCURRENT_PREFETCHES) {
      const oldestKey = queuedPrefetches.keys().next().value
      if (oldestKey !== undefined) {
        queuedPrefetches.delete(oldestKey)
      }
    }
    queuedPrefetches.set(keyHash, { generation, run: startRequest })
    return
  }

  startRequest()
}

/**
 * Prefetches a detail query through the shared scheduler.
 * - When `scheduleOptions.immediate` is `true` (e.g. from a fired row/card intent timer or `pointerdown`), executes immediately.
 * - When `scheduleOptions.immediate` is omitted or `false`, schedules the 100 ms intent timer.
 */
export function scheduleDetailPrefetch<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  scheduleOptions?: { immediate?: boolean },
): void {
  if (isSaveDataEnabled() || isClientSessionResetting()) {
    return
  }

  const staleTime = resolveStaleTimeMs(options.staleTime)
  const keyHash = hashKey(options.queryKey)

  if (isQueryFreshOrInFlight(queryClient, options.queryKey, keyHash, staleTime)) {
    return
  }

  if (scheduleOptions?.immediate) {
    executeDetailPrefetch(queryClient, options, keyHash)
    return
  }

  scheduleIntentPrefetch(keyHash, () => {
    executeDetailPrefetch(queryClient, options, keyHash)
  })
}

/**
 * Cancels all pending intent timers, queued prefetches, in-flight tracking, and retained entry
 * tracking. Called by `resetClientSession` on user sign-out or tenant/site context switch.
 */
export function resetIntentPrefetchScheduler(): void {
  cancelIntentPrefetch()
  inFlightKeys.clear()
  retainedDetailEntries.clear()
}
