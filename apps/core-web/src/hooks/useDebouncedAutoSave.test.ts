import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOCUMENT_AUTOSAVE_DEBOUNCE_MS,
  useDebouncedAutoSave,
} from './useDebouncedAutoSave'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

type Snapshot = {
  notes: string
}

describe('useDebouncedAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with idle status by default', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDebouncedAutoSave<Snapshot>({ enabled: true, save }),
    )

    expect(result.current.saveStatus).toBe('idle')
  })

  it('does not save when disabled', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDebouncedAutoSave<Snapshot>({ enabled: false, save }),
    )

    act(() => {
      result.current.triggerAutoSave({ notes: 'hello' })
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(save).not.toHaveBeenCalled()
  })

  it('debounces save by 750ms', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDebouncedAutoSave<Snapshot>({ enabled: true, save }),
    )

    act(() => {
      result.current.triggerAutoSave({ notes: 'draft notes' })
    })

    expect(save).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(DOCUMENT_AUTOSAVE_DEBOUNCE_MS - 1)
    })
    expect(save).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      { notes: 'draft notes' },
      expect.any(AbortSignal),
    )
    expect(result.current.saveStatus).toBe('saved')
  })

  it('collapses rapid edits into a single save of the latest snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDebouncedAutoSave<Snapshot>({ enabled: true, save }),
    )

    act(() => {
      result.current.triggerAutoSave({ notes: 'first' })
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    act(() => {
      result.current.triggerAutoSave({ notes: 'second' })
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ notes: 'second' }, expect.any(AbortSignal))
  })

  it('saves immediately when requested', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDebouncedAutoSave<Snapshot>({ enabled: true, save }),
    )

    act(() => {
      result.current.triggerAutoSave({ notes: 'now' }, { immediate: true })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.saveStatus).toBe('saved')
  })

  it('skips save when shouldSave returns false', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDebouncedAutoSave<Snapshot>({
        enabled: true,
        save,
        shouldSave: (snapshot) => snapshot.notes.trim().length > 0,
      }),
    )

    act(() => {
      result.current.triggerAutoSave({ notes: '   ' }, { immediate: true })
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(save).not.toHaveBeenCalled()
  })

  it('sets saveStatus to error when save rejects a non-abort error', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() =>
      useDebouncedAutoSave<Snapshot>({ enabled: true, save }),
    )

    act(() => {
      result.current.triggerAutoSave({ notes: 'notes' }, { immediate: true })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.saveStatus).toBe('error')
  })
})
