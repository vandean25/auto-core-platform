import { QueryClient } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getClientSessionGeneration,
  isClientSessionResetting,
  resetClientSession,
  runWithClientSessionPending,
  useClientSessionGeneration,
  useClientSessionResetting,
} from '@/auth/client-session-reset'

const SESSION_LOCAL_STORAGE_KEYS = [
  'acp:onboarding-checklist:dismissed:user-1',
  'acp:global-search:recent:user-1:tenant-a',
  'acp.push.registration',
  'acp.push.keep-alive',
  'emailForSignIn',
  'acp:mechanic-id',
]

/** Kept across a full reset by the AUT-819 product decision: per user, never shown to another user. */
const KEPT_USER_LOCAL_STORAGE_KEYS = [
  'acp:dashboard-widgets:user-1',
  'acp:saved-views:user-1',
]

const DEVICE_LOCAL_STORAGE_KEYS = [
  'acp:ui-language',
  'acp:sidebar-collapsed',
  'acp:sidebar-groups',
  'acp:ios-install-hint-dismissed',
  'workshop-board-view-mode',
  'workshop-planner-view',
  'deviceId',
  'e2e-active-role',
  'e2e-active-site-id',
]

const TENANT_SESSION_STORAGE_KEY = 'acp.document-brand-extraction.legal-entity-1'
const DEVICE_SESSION_STORAGE_KEY = 'acp:chunk-reload-at'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('resetClientSession', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('cancels every running query strictly before it clears the cache', async () => {
    const queryClient = new QueryClient()
    const cancellation = deferred<void>()
    const order: string[] = []

    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(() => {
      order.push('cancel')
      return cancellation.promise
    })
    vi.spyOn(queryClient, 'clear').mockImplementation(() => {
      order.push('clear')
    })

    const resetting = resetClientSession(queryClient)
    await Promise.resolve()

    expect(order).toEqual(['cancel'])
    expect(isClientSessionResetting()).toBe(true)

    cancellation.resolve()
    await resetting

    expect(order).toEqual(['cancel', 'clear'])
    expect(isClientSessionResetting()).toBe(false)
  })

  it('leaves neither query nor mutation cache entries behind', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['auth-session', 'user-1'], { userId: 'user-1', tenant: 'tenant-a' })
    queryClient.setQueryData(['customers', 'list'], [{ id: 'customer-1' }])
    const mutationCache = queryClient.getMutationCache()
    mutationCache.build(queryClient, { mutationFn: async () => undefined, mutationKey: ['customer', 'update'] })

    await resetClientSession(queryClient)

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('removes session storage and the previous user keys but keeps per-user views and device preferences', async () => {
    for (const key of [...SESSION_LOCAL_STORAGE_KEYS, ...KEPT_USER_LOCAL_STORAGE_KEYS]) {
      window.localStorage.setItem(key, 'value')
    }
    for (const key of DEVICE_LOCAL_STORAGE_KEYS) window.localStorage.setItem(key, 'value')
    window.sessionStorage.setItem(TENANT_SESSION_STORAGE_KEY, 'extraction-1')
    window.sessionStorage.setItem(DEVICE_SESSION_STORAGE_KEY, '1700000000000')

    await resetClientSession(new QueryClient(), 'session')

    for (const key of SESSION_LOCAL_STORAGE_KEYS) {
      expect(window.localStorage.getItem(key), key).toBeNull()
    }
    for (const key of [...KEPT_USER_LOCAL_STORAGE_KEYS, ...DEVICE_LOCAL_STORAGE_KEYS]) {
      expect(window.localStorage.getItem(key), key).toBe('value')
    }
    expect(window.sessionStorage.getItem(TENANT_SESSION_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(DEVICE_SESSION_STORAGE_KEY)).toBe('1700000000000')
  })

  it('keeps the signed-in user keys on a tenant or site switch', async () => {
    for (const key of [...SESSION_LOCAL_STORAGE_KEYS, ...KEPT_USER_LOCAL_STORAGE_KEYS]) {
      window.localStorage.setItem(key, 'value')
    }
    window.sessionStorage.setItem(TENANT_SESSION_STORAGE_KEY, 'extraction-1')
    const queryClient = new QueryClient()
    queryClient.setQueryData(['customers', 'list'], [{ id: 'customer-1' }])

    await resetClientSession(queryClient, 'context')

    for (const key of [...SESSION_LOCAL_STORAGE_KEYS, ...KEPT_USER_LOCAL_STORAGE_KEYS]) {
      expect(window.localStorage.getItem(key), key).toBe('value')
    }
    expect(window.sessionStorage.getItem(TENANT_SESSION_STORAGE_KEY)).toBeNull()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('drops a response that resolves after the reset instead of repopulating the cache', async () => {
    const queryClient = new QueryClient()
    const response = deferred<{ id: string }>()
    const queryKey = ['customers', 'list']

    // A query function that ignores the abort signal still resolves after the switch.
    const request = queryClient.fetchQuery({
      queryKey,
      queryFn: () => response.promise,
      retry: false,
    })

    await resetClientSession(queryClient, 'context')
    response.resolve({ id: 'customer-of-the-site-being-left' })
    await request.catch(() => undefined)
    await Promise.resolve()

    expect(queryClient.getQueryData(queryKey)).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('bumps the session generation so user-scoped providers reload', async () => {
    const before = getClientSessionGeneration()
    const { result } = renderHook(() => useClientSessionGeneration())

    await act(async () => {
      await resetClientSession(new QueryClient())
    })

    expect(getClientSessionGeneration()).toBe(before + 1)
    expect(result.current).toBe(before + 1)
  })

  it('reports itself pending through the shared hook while the work runs', async () => {
    const work = deferred<void>()
    const { result } = renderHook(() => useClientSessionResetting())

    let running!: Promise<void>
    act(() => {
      running = runWithClientSessionPending(() => work.promise)
    })

    expect(result.current).toBe(true)
    expect(isClientSessionResetting()).toBe(true)

    await act(async () => {
      work.resolve()
      await running
    })

    expect(result.current).toBe(false)
    expect(isClientSessionResetting()).toBe(false)
  })
})
