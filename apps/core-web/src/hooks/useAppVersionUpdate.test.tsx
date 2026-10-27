import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const updateServiceWorker = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/pwa/register-service-worker', () => ({ updateServiceWorker }))

async function loadHook(bundledVersion: string) {
  vi.resetModules()
  vi.stubEnv('VITE_APP_VERSION', bundledVersion)
  return (await import('./useAppVersionUpdate')).useAppVersionUpdate
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'v2' }) }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useAppVersionUpdate', () => {
  it('checks for a new service worker file together with the version, on mount and on focus', async () => {
    const useAppVersionUpdate = await loadHook('v1')
    const { result } = renderHook(() => useAppVersionUpdate())
    await act(async () => undefined)

    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
    expect(result.current.updateAvailable).toBe(true)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(updateServiceWorker).toHaveBeenCalledTimes(2)
  })

  it('does nothing without a release version (dev)', async () => {
    const useAppVersionUpdate = await loadHook('')
    renderHook(() => useAppVersionUpdate())
    await act(async () => undefined)

    expect(updateServiceWorker).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
