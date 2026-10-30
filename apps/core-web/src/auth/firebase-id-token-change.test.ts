import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyFirebaseIdTokenChange,
  shouldResetClientSessionOnUidChange,
} from '@/auth/firebase-id-token-change'

describe('shouldResetClientSessionOnUidChange', () => {
  it('returns false on the first callback before a previous uid is known', () => {
    expect(shouldResetClientSessionOnUidChange(undefined, 'user-1')).toBe(false)
  })

  it('returns false when the uid is unchanged', () => {
    expect(shouldResetClientSessionOnUidChange('user-1', 'user-1')).toBe(false)
  })

  it('returns true when the user signs out', () => {
    expect(shouldResetClientSessionOnUidChange('user-1', null)).toBe(true)
  })

  it('returns true when the uid changes', () => {
    expect(shouldResetClientSessionOnUidChange('user-1', 'user-2')).toBe(true)
  })
})

describe('applyFirebaseIdTokenChange', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('keeps the client session when the same user refreshes the id token', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['customers', 'list'], [{ id: 'customer-1' }])
    const clear = vi.spyOn(queryClient, 'clear')
    const previousUidRef = { current: 'user-1' as string | null | undefined }
    const setClaims = vi.fn()
    const finishAuthInit = vi.fn()

    const user = {
      uid: 'user-1',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { tenantId: 't1', role: 'ADMIN' } }),
    }

    await applyFirebaseIdTokenChange({
      nextUser: user,
      previousUidRef,
      queryClient,
      isActive: () => true,
      onAuthInitTimedOutReset: vi.fn(),
      setUser: vi.fn(),
      setClaims,
      finishAuthInit,
    })

    expect(clear).not.toHaveBeenCalled()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
    expect(setClaims).toHaveBeenCalledWith({ tenantId: 't1', role: 'ADMIN', platformRole: undefined })
    expect(finishAuthInit).toHaveBeenCalled()
  })

  it('clears every cached query and the session storage when another user signs in', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['auth-session', 'user-1'], { userId: 'user-1', tenant: 'tenant-a' })
    queryClient.setQueryData(['customers', 'list'], [{ id: 'customer-1' }])
    window.localStorage.setItem('acp:saved-views:user-1', '[]')
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    const clear = vi.spyOn(queryClient, 'clear')
    const previousUidRef = { current: 'user-1' as string | null | undefined }
    const setUser = vi.fn()

    const user = {
      uid: 'user-2',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { tenantId: 't2', role: 'SALES' } }),
    }

    await applyFirebaseIdTokenChange({
      nextUser: user,
      previousUidRef,
      queryClient,
      isActive: () => true,
      onAuthInitTimedOutReset: vi.fn(),
      setUser,
      setClaims: vi.fn(),
      finishAuthInit: vi.fn(),
    })

    expect(cancelQueries).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(window.localStorage.getItem('acp:saved-views:user-1')).toBeNull()
    expect(previousUidRef.current).toBe('user-2')
    expect(setUser).toHaveBeenCalledWith(user)
  })

  it('clears the cached session data when the user signs out', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['auth-session', 'user-1'], { userId: 'user-1' })
    const clear = vi.spyOn(queryClient, 'clear')
    const previousUidRef = { current: 'user-1' as string | null | undefined }
    const setUser = vi.fn()
    const setClaims = vi.fn()

    await applyFirebaseIdTokenChange({
      nextUser: null,
      previousUidRef,
      queryClient,
      isActive: () => true,
      onAuthInitTimedOutReset: vi.fn(),
      setUser,
      setClaims,
      finishAuthInit: vi.fn(),
    })

    expect(clear).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(setUser).toHaveBeenCalledWith(null)
    expect(setClaims).toHaveBeenCalledWith(null)
    expect(previousUidRef.current).toBeNull()
  })
})
