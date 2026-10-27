import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as mechanicApi from '@/api/mechanic'
import { deWorkshop } from '@/test/de-workshop'
import { useTaskLifecycle } from './useTaskLifecycle'

const lifecycleToast = deWorkshop.mechanic.taskDetail.lifecycle.toast
const http409 = 'Die Anfrage steht im Konflikt mit dem aktuellen Stand.'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/api/mechanic')
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const TASK_ID = 'test-task-123'

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

describe('useTaskLifecycle', () => {
  const mockStartMutateAsync = vi.fn()
  const mockSwitchMutateAsync = vi.fn()
  const mockPauseMutateAsync = vi.fn()
  const mockCompleteMutateAsync = vi.fn()
  const mockRefetch = vi.fn()
  const mockCancelPendingSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    asMock(mechanicApi.useStartTask).mockReturnValue({
      mutateAsync: mockStartMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof mechanicApi.useStartTask>)

    asMock(mechanicApi.useSwitchTask).mockReturnValue({
      mutateAsync: mockSwitchMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof mechanicApi.useSwitchTask>)

    asMock(mechanicApi.usePauseTask).mockReturnValue({
      mutateAsync: mockPauseMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof mechanicApi.usePauseTask>)

    asMock(mechanicApi.useCompleteTask).mockReturnValue({
      mutateAsync: mockCompleteMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof mechanicApi.useCompleteTask>)

    mockRefetch.mockResolvedValue({})
  })

  const setupHook = () =>
    renderHook(() =>
      useTaskLifecycle({
        taskId: TASK_ID,
        refetch: mockRefetch,
        cancelPendingSave: mockCancelPendingSave,
      }),
    )

  it('initializes with default dialog states and reasons', () => {
    const { result } = setupHook()

    expect(result.current.pauseDialogOpen).toBe(false)
    expect(result.current.selectedPauseReason).toBe('WAITING_PARTS')
    expect(result.current.switchDialogOpen).toBe(false)
    expect(result.current.selectedSwitchReason).toBe('SWITCHED_TO_HIGHER_PRIORITY')
    expect(result.current.switchRetrying).toBe(false)
  })

  describe('handleStart', () => {
    it('successfully starts the task and displays success toast', async () => {
      mockStartMutateAsync.mockResolvedValueOnce({})
      const { result } = setupHook()

      await act(async () => {
        await result.current.handleStart()
      })

      expect(mockStartMutateAsync).toHaveBeenCalledWith({ taskId: TASK_ID })
      expect(toast.success).toHaveBeenCalledWith(lifecycleToast.taskStarted)
    })

    it('displays error toast when start fails', async () => {
      mockStartMutateAsync.mockRejectedValueOnce(new Error('Network error'))
      const { result } = setupHook()

      await act(async () => {
        await result.current.handleStart()
      })

      expect(toast.error).toHaveBeenCalledWith(lifecycleToast.taskStartFailed)
    })
  })

  describe('handlePauseConfirm', () => {
    it('cancels pending saves, pauses task, closes dialog, and displays toast', async () => {
      mockPauseMutateAsync.mockResolvedValueOnce({})
      const { result } = setupHook()

      act(() => {
        result.current.setPauseDialogOpen(true)
        result.current.setSelectedPauseReason('OTHER')
      })

      await act(async () => {
        await result.current.handlePauseConfirm()
      })

      expect(mockCancelPendingSave).toHaveBeenCalled()
      expect(mockPauseMutateAsync).toHaveBeenCalledWith({
        taskId: TASK_ID,
        payload: { pauseReason: 'OTHER' },
      })
      expect(toast.success).toHaveBeenCalledWith(lifecycleToast.taskPaused)
      expect(result.current.pauseDialogOpen).toBe(false)
    })

    it('displays error toast and closes dialog when pause fails', async () => {
      mockPauseMutateAsync.mockRejectedValueOnce(new Error('Pause failed'))
      const { result } = setupHook()

      act(() => {
        result.current.setPauseDialogOpen(true)
      })

      await act(async () => {
        await result.current.handlePauseConfirm()
      })

      expect(mockCancelPendingSave).toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(lifecycleToast.taskPauseFailed)
      expect(result.current.pauseDialogOpen).toBe(false)
    })

    it('closes dialog when pause returns 409 conflict', async () => {
      const conflictError = Object.assign(new Error('No open labor entry found'), {
        status: 409,
      })
      mockPauseMutateAsync.mockRejectedValueOnce(conflictError)
      const { result } = setupHook()

      act(() => {
        result.current.setPauseDialogOpen(true)
      })

      await act(async () => {
        await result.current.handlePauseConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith(http409)
      expect(result.current.pauseDialogOpen).toBe(false)
    })
  })

  describe('handleComplete', () => {
    it('cancels pending saves, completes task, navigates to queue, and shows toast', async () => {
      mockCompleteMutateAsync.mockResolvedValueOnce({})
      const { result } = setupHook()

      await act(async () => {
        await result.current.handleComplete()
      })

      expect(mockCancelPendingSave).toHaveBeenCalled()
      expect(mockCompleteMutateAsync).toHaveBeenCalledWith({ taskId: TASK_ID })
      expect(toast.success).toHaveBeenCalledWith(lifecycleToast.taskCompleted)
      expect(mockNavigate).toHaveBeenCalledWith('/mechanic/queue')
    })

    it('drops the unsynced notes draft only once the server confirmed the completion', async () => {
      const onCompleted = vi.fn()
      mockCompleteMutateAsync.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
      const { result } = renderHook(() =>
        useTaskLifecycle({
          taskId: TASK_ID,
          refetch: mockRefetch,
          cancelPendingSave: mockCancelPendingSave,
          onCompleted,
        }),
      )

      await act(async () => {
        await result.current.handleComplete()
      })
      expect(onCompleted).not.toHaveBeenCalled()

      await act(async () => {
        await result.current.handleComplete()
      })
      expect(onCompleted).toHaveBeenCalledTimes(1)
    })

    it('displays error toast when completion fails', async () => {
      mockCompleteMutateAsync.mockRejectedValueOnce(new Error('Completion failed'))
      const { result } = setupHook()

      await act(async () => {
        await result.current.handleComplete()
      })

      expect(mockCancelPendingSave).toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(lifecycleToast.taskCompleteFailed)
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  describe('handleSwitchConfirm', () => {
    it('cancels pending save, switches task, closes dialog, and shows toast', async () => {
      mockSwitchMutateAsync.mockResolvedValueOnce({})
      const { result } = setupHook()

      act(() => {
        result.current.setSwitchDialogOpen(true)
        result.current.setSelectedSwitchReason('WAITING_PARTS')
      })

      await act(async () => {
        await result.current.handleSwitchConfirm()
      })

      expect(mockCancelPendingSave).toHaveBeenCalled()
      expect(mockSwitchMutateAsync).toHaveBeenCalledWith({
        taskId: TASK_ID,
        payload: { previousPauseReason: 'WAITING_PARTS' },
      })
      expect(toast.success).toHaveBeenCalledWith(lifecycleToast.taskSwitched)
      expect(result.current.switchDialogOpen).toBe(false)
    })

    it('displays error toast when switch fails with non-409 error', async () => {
      mockSwitchMutateAsync.mockRejectedValueOnce(new Error('Server unavailable'))
      const { result } = setupHook()

      await act(async () => {
        await result.current.handleSwitchConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith(lifecycleToast.taskSwitchFailed)
      expect(mockStartMutateAsync).not.toHaveBeenCalled()
    })

    it('retries as start task upon 409 conflict and succeeds', async () => {
      const conflictError = { response: { status: 409 }, message: 'Conflict' }
      mockSwitchMutateAsync.mockRejectedValueOnce(conflictError)
      mockStartMutateAsync.mockResolvedValueOnce({})

      const { result } = setupHook()

      act(() => {
        result.current.setSwitchDialogOpen(true)
      })

      await act(async () => {
        await result.current.handleSwitchConfirm()
      })

      expect(mockRefetch).toHaveBeenCalled()
      expect(mockStartMutateAsync).toHaveBeenCalledWith({ taskId: TASK_ID })
      expect(toast.success).toHaveBeenCalledWith(lifecycleToast.taskStarted)
      expect(result.current.switchDialogOpen).toBe(false)
      expect(result.current.switchRetrying).toBe(false)
    })

    it('shows specific error toast if retry start also encounters 409 conflict', async () => {
      const conflictError = { response: { status: 409 }, message: 'Conflict' }
      mockSwitchMutateAsync.mockRejectedValueOnce(conflictError)
      mockStartMutateAsync.mockRejectedValueOnce(conflictError)

      const { result } = setupHook()

      await act(async () => {
        await result.current.handleSwitchConfirm()
      })

      expect(mockRefetch).toHaveBeenCalled()
      expect(mockStartMutateAsync).toHaveBeenCalledWith({ taskId: TASK_ID })
      expect(toast.error).toHaveBeenCalledWith(lifecycleToast.taskAlreadyInProgress)
      expect(result.current.switchRetrying).toBe(false)
    })

    it('shows generic error toast if retry start encounters non-409 error', async () => {
      const conflictError = { response: { status: 409 }, message: 'Conflict' }
      mockSwitchMutateAsync.mockRejectedValueOnce(conflictError)
      mockStartMutateAsync.mockRejectedValueOnce(new Error('Start failed after retry'))

      const { result } = setupHook()

      await act(async () => {
        await result.current.handleSwitchConfirm()
      })

      expect(mockRefetch).toHaveBeenCalled()
      expect(mockStartMutateAsync).toHaveBeenCalledWith({ taskId: TASK_ID })
      expect(toast.error).toHaveBeenCalledWith(lifecycleToast.taskStartFailed)
      expect(result.current.switchRetrying).toBe(false)
    })
  })
})
