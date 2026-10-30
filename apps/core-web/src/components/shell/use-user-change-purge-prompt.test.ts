import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  summarize: vi.fn(),
  purge: vi.fn(),
}))

vi.mock('@/features/workshop/check-in/check-in-offline-unsynced', () => ({
  summarizeCheckInOfflineUnsynced: mocks.summarize,
  hasUnsyncedCheckInOfflineData: (summary: {
    dirtyDraftCount: number
    queuedPhotoCount: number
    pendingCreateCount: number
    mechanicNoteDraftCount: number
  }) =>
    summary.dirtyDraftCount > 0 ||
    summary.queuedPhotoCount > 0 ||
    summary.pendingCreateCount > 0 ||
    summary.mechanicNoteDraftCount > 0,
}))

vi.mock('@/features/workshop/check-in/check-in-offline-store', () => ({
  purgeAllCheckInOfflineData: mocks.purge,
}))

import { useUserChangeOfflinePurge } from './use-user-change-purge-prompt'

const unsynced = {
  dirtyDraftCount: 1,
  queuedPhotoCount: 0,
  pendingCreateCount: 0,
  mechanicNoteDraftCount: 0,
}

const synced = {
  dirtyDraftCount: 0,
  queuedPhotoCount: 0,
  pendingCreateCount: 0,
  mechanicNoteDraftCount: 0,
}

function renderPromptHook(userId: string) {
  return renderHook(
    ({ currentUserId }: { currentUserId: string }) => useUserChangeOfflinePurge(currentUserId),
    { initialProps: { currentUserId: userId } },
  )
}

describe('useUserChangeOfflinePurge', () => {
  beforeEach(() => {
    mocks.summarize.mockReset().mockResolvedValue(unsynced)
    mocks.purge.mockReset().mockResolvedValue(undefined)
  })

  it('does not ask on the first render or when the same user refreshes the token', async () => {
    const { result, rerender } = renderPromptHook('user-1')
    rerender({ currentUserId: 'user-1' })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.summarize).not.toHaveBeenCalled()
    expect(result.current.summary).toBeNull()
  })

  it('asks about unsynced offline data when another user takes over the browser', async () => {
    const { result, rerender } = renderPromptHook('user-1')

    rerender({ currentUserId: 'user-2' })

    await waitFor(() => {
      expect(result.current.summary).toEqual(unsynced)
    })
    expect(mocks.summarize).toHaveBeenCalledTimes(1)
  })

  it('does not prompt when nothing is unsynced', async () => {
    mocks.summarize.mockResolvedValue(synced)
    const { result, rerender } = renderPromptHook('user-1')

    rerender({ currentUserId: 'user-2' })

    await waitFor(() => {
      expect(mocks.summarize).toHaveBeenCalledTimes(1)
    })
    expect(result.current.summary).toBeNull()
  })

  it('keeps the offline data when the prompt is dismissed', async () => {
    const { result, rerender } = renderPromptHook('user-1')
    rerender({ currentUserId: 'user-2' })
    await waitFor(() => {
      expect(result.current.summary).toEqual(unsynced)
    })

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.summary).toBeNull()
    expect(mocks.purge).not.toHaveBeenCalled()
  })

  it('discards the offline data only after the prompt is confirmed', async () => {
    const { result, rerender } = renderPromptHook('user-1')
    rerender({ currentUserId: 'user-2' })
    await waitFor(() => {
      expect(result.current.summary).toEqual(unsynced)
    })

    await act(async () => {
      await result.current.discard()
    })

    expect(mocks.purge).toHaveBeenCalledTimes(1)
    expect(result.current.summary).toBeNull()
  })
})
