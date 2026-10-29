import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  keepPushRegistrationAlive: vi.fn(),
  summarize: vi.fn(),
  hasUnsynced: vi.fn(),
  toastError: vi.fn(),
  purge: vi.fn(),
}))

vi.mock('@/features/push/push-device', () => ({
  keepPushRegistrationAlive: mocks.keepPushRegistrationAlive,
  switchTenantWithPush: async (run: () => Promise<unknown>) => run(),
}))
vi.mock('@/features/workshop/check-in/check-in-offline-store', () => ({
  purgeAllCheckInOfflineData: mocks.purge,
}))
vi.mock('@/features/workshop/check-in/check-in-offline-unsynced', () => ({
  summarizeCheckInOfflineUnsynced: mocks.summarize,
  hasUnsyncedCheckInOfflineData: mocks.hasUnsynced,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))

import { useShellPush, useSignOutRequest, useTenantSwitch } from './use-shell-push'

const session = { activeTenant: { id: 't1' }, activeSiteId: 's1' } as never

describe('useTenantSwitch', () => {
  beforeEach(() => {
    mocks.summarize.mockReset().mockResolvedValue({ unsynced: 0 })
    mocks.hasUnsynced.mockReset().mockReturnValue(false)
    mocks.toastError.mockReset()
    mocks.purge.mockReset().mockResolvedValue(undefined)
  })

  it('switches at once when nothing is unsynced', async () => {
    const complete = vi.fn(async () => undefined)
    const ask = vi.fn()
    const { result } = renderHook(() => useTenantSwitch(complete, ask))

    await expect(result.current.requestTenantSwitch('t2')).resolves.toBe('switched')
    expect(complete).toHaveBeenCalledWith('t2')
    expect(mocks.purge).toHaveBeenCalledTimes(1)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks first when check-in data is unsynced, and does not switch by itself', async () => {
    mocks.hasUnsynced.mockReturnValue(true)
    const complete = vi.fn(async () => undefined)
    const ask = vi.fn()
    const { result } = renderHook(() => useTenantSwitch(complete, ask))

    await expect(result.current.requestTenantSwitch('t2')).resolves.toBe('prompted')
    expect(ask).toHaveBeenCalledWith({ kind: 'switchTenant', tenantId: 't2', summary: { unsynced: 0 } })
    expect(complete).not.toHaveBeenCalled()
  })

  it('reports a failed switch with a message', async () => {
    const complete = vi.fn(async () => {
      throw new Error('refused')
    })
    const { result } = renderHook(() => useTenantSwitch(complete, vi.fn()))

    await expect(result.current.requestTenantSwitch('t2')).resolves.toBe('failed')
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})

describe('useSignOutRequest', () => {
  beforeEach(() => {
    mocks.summarize.mockReset().mockResolvedValue({ unsynced: 0 })
    mocks.hasUnsynced.mockReset().mockReturnValue(false)
    mocks.purge.mockReset().mockResolvedValue(undefined)
  })

  it('clears the offline data and signs out when nothing is unsynced', async () => {
    const signOut = vi.fn(async () => undefined)
    const { result } = renderHook(() => useSignOutRequest(signOut, vi.fn()))
    await result.current()
    expect(mocks.purge).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('asks first when check-in data is unsynced, and does not sign out by itself', async () => {
    mocks.hasUnsynced.mockReturnValue(true)
    const signOut = vi.fn(async () => undefined)
    const ask = vi.fn()
    const { result } = renderHook(() => useSignOutRequest(signOut, ask))
    await result.current()
    expect(ask).toHaveBeenCalledWith({ kind: 'signOut', summary: { unsynced: 0 } })
    expect(signOut).not.toHaveBeenCalled()
    expect(mocks.purge).not.toHaveBeenCalled()
  })
})

describe('useShellPush', () => {
  const wrap = (entry: string) => ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  )

  beforeEach(() => {
    mocks.keepPushRegistrationAlive.mockReset()
    mocks.toastError.mockReset()
  })

  it('renews the registration once a session exists, not before', () => {
    const base = { sites: [], sitesLoading: false, requestTenantSwitch: vi.fn(), switchSite: vi.fn() }
    const { rerender } = renderHook((props: { session: never | undefined }) => useShellPush({ ...base, ...props }), {
      wrapper: wrap('/'),
      initialProps: { session: undefined },
    })
    expect(mocks.keepPushRegistrationAlive).not.toHaveBeenCalled()

    rerender({ session })
    expect(mocks.keepPushRegistrationAlive).toHaveBeenCalledTimes(1)
  })

  it('opens an order link of another site: switches the site, and tells the user when the site is not theirs', async () => {
    const switchSite = vi.fn(async () => undefined)
    renderHook(
      () =>
        useShellPush({
          session,
          sites: [{ id: 's1' }, { id: 's2' }] as never,
          sitesLoading: false,
          requestTenantSwitch: vi.fn(),
          switchSite,
        }),
      { wrapper: wrap('/workshop/orders/o1?pushTenant=t1&pushSite=s2') },
    )
    await waitFor(() => expect(switchSite).toHaveBeenCalledWith('s2'))

    renderHook(
      () =>
        useShellPush({
          session,
          sites: [{ id: 's1' }] as never,
          sitesLoading: false,
          requestTenantSwitch: vi.fn(),
          switchSite,
        }),
      { wrapper: wrap('/workshop/orders/o1?pushTenant=t1&pushSite=s-evil') },
    )
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(switchSite).toHaveBeenCalledTimes(1)
  })
})
