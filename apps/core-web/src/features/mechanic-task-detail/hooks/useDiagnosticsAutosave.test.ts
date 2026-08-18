import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as mechanicApi from '@/api/mechanic'
import { DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS, useDiagnosticsAutosave } from './useDiagnosticsAutosave'

vi.mock('@/api/mechanic')

const TASK_ID = '22222222-2222-2222-2222-222222222222'

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

describe('useDiagnosticsAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: null }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('seeds notes from the initial value once the task is available', () => {
    const { result } = renderHook(() =>
      useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes: 'Pads worn' }),
    )

    expect(result.current.notesValue).toBe('Pads worn')
    expect(result.current.saveState).toBe('idle')
  })

  it('treats a missing initial note as an empty string', () => {
    const { result } = renderHook(() =>
      useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes: null }),
    )

    expect(result.current.notesValue).toBe('')
  })

  it('sets saveState to saving immediately and does not save before 750ms', () => {
    const mutateAsync = vi.fn().mockResolvedValue({ taskId: TASK_ID })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })

    const { result } = renderHook(() =>
      useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes: '' }),
    )

    act(() => {
      result.current.handleNotesChange('Front pads worn.')
    })

    expect(result.current.saveState).toBe('saving')
    expect(result.current.notesValue).toBe('Front pads worn.')
    expect(mutateAsync).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS - 1)
    })

    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('saves mechanic notes after the 750ms debounce', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: 'Oil dark.' })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })

    const { result } = renderHook(() =>
      useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes: '' }),
    )

    act(() => {
      result.current.handleNotesChange('Oil dark.')
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: TASK_ID,
      payload: { mechanicNotes: 'Oil dark.' },
    })
    expect(result.current.saveState).toBe('saved')
  })

  it('debounces rapid keystrokes and only saves the last value', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ taskId: TASK_ID })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })

    const { result } = renderHook(() =>
      useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes: '' }),
    )

    act(() => {
      result.current.handleNotesChange('F')
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    act(() => {
      result.current.handleNotesChange('Fi')
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    act(() => {
      result.current.handleNotesChange('Final.')
    })

    expect(mutateAsync).not.toHaveBeenCalled()

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: TASK_ID,
      payload: { mechanicNotes: 'Final.' },
    })
  })

  it('sets saveState to error when the mutation fails', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('network'))
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })

    const { result } = renderHook(() =>
      useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes: '' }),
    )

    act(() => {
      result.current.handleNotesChange('Will fail')
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.saveState).toBe('error')
  })

  it('resets notes when the task id changes', () => {
    const { result, rerender } = renderHook(
      ({ taskId, initialNotes }: { taskId: string; initialNotes: string }) =>
        useDiagnosticsAutosave({ taskId, initialNotes }),
      { initialProps: { taskId: TASK_ID, initialNotes: 'Task A notes' } },
    )

    expect(result.current.notesValue).toBe('Task A notes')

    rerender({ taskId: 'task-b', initialNotes: 'Task B notes' })

    expect(result.current.notesValue).toBe('Task B notes')
  })

  it('cancelPendingSave prevents a queued autosave from firing', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ taskId: TASK_ID })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })

    const { result } = renderHook(() =>
      useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes: '' }),
    )

    act(() => {
      result.current.handleNotesChange('Should not save')
    })
    act(() => {
      result.current.cancelPendingSave()
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
