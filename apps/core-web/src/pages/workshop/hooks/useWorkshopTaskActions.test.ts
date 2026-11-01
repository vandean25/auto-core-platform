import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWorkshopTaskActions } from './useWorkshopTaskActions'
import * as workshopApi from '@/api/workshop'
import { toast } from 'sonner'
import type { WorkshopOrder, WorkshopTask } from '@/api/types'

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return {
    ...actual,
    useCreateWorkshopTask: vi.fn(),
    useDeleteWorkshopTask: vi.fn(),
    useUpdateWorkshopTask: vi.fn(),
  }
})

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('useWorkshopTaskActions', () => {
  const mockCreateTask = vi.fn()
  const mockDeleteTask = vi.fn()
  const mockUpdateTask = vi.fn()
  const mockOnExpandedTaskIdChange = vi.fn()
  const mockClearTaskLineItemOverrides = vi.fn()
  const mockOfferRecording = vi.fn()

  const defaultOrder = {
    id: 'wo-1',
    status: 'IN_PROGRESS',
  } as unknown as WorkshopOrder

  const defaultTasks: WorkshopTask[] = [
    {
      id: 'task-1',
      title: 'Brake pad replacement',
      status: 'IN_PROGRESS',
      done: false,
      lineItems: [],
    } as unknown as WorkshopTask,
  ]

  const createHookProps = (overrides?: Partial<Parameters<typeof useWorkshopTaskActions>[0]>) => ({
    order: defaultOrder,
    isLocked: false,
    tasks: defaultTasks,
    hasLinkedInvoice: false,
    expandedTaskId: null,
    onExpandedTaskIdChange: mockOnExpandedTaskIdChange,
    clearTaskLineItemOverrides: mockClearTaskLineItemOverrides,
    pickerl: { canManagePickerl: true, offerRecording: mockOfferRecording },
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(workshopApi.useCreateWorkshopTask).mockReturnValue({
      mutateAsync: mockCreateTask,
      isPending: false,
    } as unknown as ReturnType<typeof workshopApi.useCreateWorkshopTask>)
    vi.mocked(workshopApi.useDeleteWorkshopTask).mockReturnValue({
      mutateAsync: mockDeleteTask,
      isPending: false,
    } as unknown as ReturnType<typeof workshopApi.useDeleteWorkshopTask>)
    vi.mocked(workshopApi.useUpdateWorkshopTask).mockReturnValue({
      mutateAsync: mockUpdateTask,
      isPending: false,
    } as unknown as ReturnType<typeof workshopApi.useUpdateWorkshopTask>)
  })

  it('initializes with default state', () => {
    const { result } = renderHook(() => useWorkshopTaskActions(createHookProps()))
    expect(result.current.newTaskTitle).toBe('')
    expect(result.current.isAddingTask).toBe(false)
    expect(result.current.canDeleteTasks).toBe(true)
  })

  it('creates task and resets newTaskTitle on success', async () => {
    mockCreateTask.mockResolvedValueOnce({ id: 'task-created-1', title: 'Check engine' })
    const { result } = renderHook(() => useWorkshopTaskActions(createHookProps()))

    act(() => {
      result.current.setNewTaskTitle('Check engine')
    })

    await act(async () => {
      await result.current.addTask()
    })

    expect(mockCreateTask).toHaveBeenCalledWith({
      orderId: 'wo-1',
      title: 'Check engine',
    })
    expect(result.current.newTaskTitle).toBe('')
    expect(mockOnExpandedTaskIdChange).toHaveBeenCalledWith('task-created-1')
    expect(toast.success).toHaveBeenCalled()
    expect(result.current.isAddingTask).toBe(false)
  })

  it('guards against double create while request is in flight', async () => {
    let resolvePromise!: (val: { id: string; title: string }) => void
    const pendingPromise = new Promise<{ id: string; title: string }>((resolve) => {
      resolvePromise = resolve
    })
    mockCreateTask.mockImplementation(() => pendingPromise)

    const { result } = renderHook(() => useWorkshopTaskActions(createHookProps()))

    act(() => {
      result.current.setNewTaskTitle('Suspension repair')
    })

    // First call initiates creation
    let firstCallPromise: Promise<void>
    act(() => {
      firstCallPromise = result.current.addTask()
    })

    expect(result.current.isAddingTask).toBe(true)

    // Second call while in flight must return immediately and not call mutateAsync again
    await act(async () => {
      await result.current.addTask()
    })

    expect(mockCreateTask).toHaveBeenCalledTimes(1)

    // Resolve in flight promise
    await act(async () => {
      resolvePromise({ id: 'task-susp', title: 'Suspension repair' })
      await firstCallPromise
    })

    expect(result.current.isAddingTask).toBe(false)
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('resets isAddingTask to false on error (finally guard)', async () => {
    let rejectPromise!: (err: Error) => void
    const pendingPromise = new Promise<{ id: string; title: string }>((_, reject) => {
      rejectPromise = reject
    })
    mockCreateTask.mockImplementation(() => pendingPromise)

    const { result } = renderHook(() => useWorkshopTaskActions(createHookProps()))

    act(() => {
      result.current.setNewTaskTitle('Failing task')
    })

    let taskPromise: Promise<void>
    act(() => {
      taskPromise = result.current.addTask()
    })

    expect(result.current.isAddingTask).toBe(true)

    await act(async () => {
      rejectPromise(new Error('Network error'))
      await taskPromise
    })

    expect(result.current.isAddingTask).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })

  it('does not create task if order is locked', async () => {
    const { result } = renderHook(() => useWorkshopTaskActions(createHookProps({ isLocked: true })))

    act(() => {
      result.current.setNewTaskTitle('Locked task')
    })

    await act(async () => {
      await result.current.addTask()
    })

    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('does not create task if title is empty or only whitespace', async () => {
    const { result } = renderHook(() => useWorkshopTaskActions(createHookProps()))

    act(() => {
      result.current.setNewTaskTitle('    ')
    })

    await act(async () => {
      await result.current.addTask()
    })

    expect(mockCreateTask).not.toHaveBeenCalled()
  })
})
