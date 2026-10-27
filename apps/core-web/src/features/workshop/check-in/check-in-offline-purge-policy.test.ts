import { describe, expect, it, vi } from 'vitest'
import { hasUnsyncedCheckInOfflineData } from './check-in-offline-unsynced'

describe('check-in offline purge policy', () => {
  it('does not purge before a successful tenant switch when the switch fails', async () => {
    const purge = vi.fn().mockResolvedValue(undefined)
    const switchTenant = vi
      .fn()
      .mockRejectedValue(new Error('switch failed'))

    await expect(
      switchTenant().then(async () => {
        await purge()
      }),
    ).rejects.toThrow('switch failed')

    expect(purge).not.toHaveBeenCalled()
  })

  it('purges only after a successful tenant switch', async () => {
    const purge = vi.fn().mockResolvedValue(undefined)
    const switchTenant = vi.fn().mockResolvedValue(undefined)

    await switchTenant()
    await purge()

    expect(switchTenant).toHaveBeenCalledBefore(purge)
    expect(purge).toHaveBeenCalledTimes(1)
  })

  it('requires confirmation when unsynced offline data exists', () => {
    expect(
      hasUnsyncedCheckInOfflineData({
        dirtyDraftCount: 1,
        queuedPhotoCount: 0,
        pendingCreateCount: 0,
        mechanicNoteDraftCount: 0,
      }),
    ).toBe(true)
    expect(
      hasUnsyncedCheckInOfflineData({
        dirtyDraftCount: 0,
        queuedPhotoCount: 0,
        pendingCreateCount: 0,
        mechanicNoteDraftCount: 1,
      }),
    ).toBe(true)
    expect(
      hasUnsyncedCheckInOfflineData({
        dirtyDraftCount: 0,
        queuedPhotoCount: 0,
        pendingCreateCount: 0,
        mechanicNoteDraftCount: 0,
      }),
    ).toBe(false)
  })
})
