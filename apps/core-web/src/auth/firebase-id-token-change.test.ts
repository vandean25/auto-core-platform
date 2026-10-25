import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { authSessionKeys } from '@/api/auth-session'
import {
  applyFirebaseIdTokenChange,
  shouldInvalidateAuthSessionOnUidChange,
} from '@/auth/firebase-id-token-change'

describe('shouldInvalidateAuthSessionOnUidChange', () => {
  it('returns false on the first callback before a previous uid is known', () => {
    expect(shouldInvalidateAuthSessionOnUidChange(undefined, 'user-1')).toBe(false)
  })

  it('returns false when the uid is unchanged', () => {
    expect(shouldInvalidateAuthSessionOnUidChange('user-1', 'user-1')).toBe(false)
  })

  it('returns true when the user signs out', () => {
    expect(shouldInvalidateAuthSessionOnUidChange('user-1', null)).toBe(true)
  })

  it('returns true when the uid changes', () => {
    expect(shouldInvalidateAuthSessionOnUidChange('user-1', 'user-2')).toBe(true)
  })
})

describe('applyFirebaseIdTokenChange', () => {
  it('clears the auth session cache only when the uid changes', async () => {
    const queryClient = new QueryClient()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const previousUidRef = { current: 'user-1' as string | null | undefined }
    const setUser = vi.fn()
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
      setUser,
      setClaims,
      finishAuthInit,
    })

    expect(removeQueries).not.toHaveBeenCalled()
    expect(setClaims).toHaveBeenCalledWith({ tenantId: 't1', role: 'ADMIN', platformRole: undefined })
    expect(finishAuthInit).toHaveBeenCalled()
  })

  it('removes cached session data when the uid changes', async () => {
    const queryClient = new QueryClient()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const previousUidRef = { current: 'user-1' as string | null | undefined }

    await applyFirebaseIdTokenChange({
      nextUser: null,
      previousUidRef,
      queryClient,
      isActive: () => true,
      onAuthInitTimedOutReset: vi.fn(),
      setUser: vi.fn(),
      setClaims: vi.fn(),
      finishAuthInit: vi.fn(),
    })

    expect(removeQueries).toHaveBeenCalledWith({ queryKey: authSessionKeys.all })
    expect(previousUidRef.current).toBeNull()
  })
})
