import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useWorkshopTaskLineItems,
  buildUiLineItems,
  buildApiLineItemsPayload,
  type TaskLineItemInput,
} from './useWorkshopTaskLineItems'
import * as workshopApi from '@/api/workshop'
import { toast } from 'sonner'
import type { WorkshopTask } from '@/api/types'

const mockInvalidateQueries = vi.fn()

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return {
    ...actual,
    useReplaceWorkshopTaskLineItems: vi.fn(),
  }
})
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  }
})
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('useWorkshopTaskLineItems', () => {
  const mockMutateAsync = vi.fn().mockResolvedValue({})

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(workshopApi.useReplaceWorkshopTaskLineItems).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<
      typeof workshopApi.useReplaceWorkshopTaskLineItems
    >)
  })

  describe('pure helpers', () => {
    it('buildUiLineItems generates fallback IDs for items without ID', () => {
      const input: TaskLineItemInput[] = [
        {
          type: 'PART',
          itemNo: 'P-1',
          description: 'Filter',
          qty: 1,
          unitPrice: 20,
        },
        {
          id: 'existing-id',
          type: 'LABOR',
          itemNo: 'L-1',
          description: 'Labor',
          qty: 2,
          unitPrice: 50,
          standardAw: 2.5,
        },
      ]

      const uiItems = buildUiLineItems('task-1', input)
      expect(uiItems[0].id).toBe('tmp-task-1-0')
      expect(uiItems[1].id).toBe('existing-id')
      expect(uiItems[1].standardAw).toBe(2.5)
      expect(uiItems[0].actualHours).toBeNull()
    })

    it('buildApiLineItemsPayload serializes items with null coalescing', () => {
      const input: TaskLineItemInput[] = [
        {
          id: 'id-1',
          type: 'PART',
          itemNo: 'P-1',
          description: 'Oil',
          qty: 4,
          unitPrice: 10,
        },
      ]

      const apiPayload = buildApiLineItemsPayload(input)
      expect(apiPayload).toEqual([
        {
          id: 'id-1',
          type: 'PART',
          itemNo: 'P-1',
          description: 'Oil',
          qty: 4,
          unitPrice: 10,
          laborOperationId: undefined,
          standardAw: null,
          actualHours: null,
          internalCostRate: null,
        },
      ])
    })

    it('buildApiLineItemsPayload omits client temp ids', () => {
      const input: TaskLineItemInput[] = [
        {
          id: 'tmp-task-1-0',
          type: 'LABOR',
          itemNo: 'GEN-001',
          description: 'General labor',
          qty: 1,
          unitPrice: 50,
        },
        {
          id: 'li-task-1-1',
          type: 'PART',
          itemNo: 'P-2',
          description: 'New part',
          qty: 1,
          unitPrice: 20,
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'PART',
          itemNo: 'P-1',
          description: 'Existing part',
          qty: 2,
          unitPrice: 15,
        },
      ]

      const apiPayload = buildApiLineItemsPayload(input)
      expect(apiPayload[0].id).toBeUndefined()
      expect(apiPayload[1].id).toBeUndefined()
      expect(apiPayload[2].id).toBe('550e8400-e29b-41d4-a716-446655440000')
    })
  })

  describe('hook behavior', () => {
    const mockTasks: WorkshopTask[] = [
      {
        id: 'task-1',
        title: 'Task 1',
        status: 'IN_PROGRESS',
        done: false,
        lineItemsVersion: 1,
        lineItems: [
          {
            id: 'item-1',
            type: 'PART',
            itemNo: 'P-1',
            description: 'Old Item',
            qty: 1,
            unitPrice: 10,
          },
        ],
      },
    ]

    it('updates overrides optimistically and mutates API', async () => {
      const { result } = renderHook(() =>
        useWorkshopTaskLineItems({
          orderId: 'order-1',
          isLocked: false,
          getTasks: () => mockTasks,
        }),
      )

      const newItems: TaskLineItemInput[] = [
        {
          id: 'item-1',
          type: 'PART',
          itemNo: 'P-1',
          description: 'Updated Item',
          qty: 2,
          unitPrice: 15,
        },
      ]

      await act(async () => {
        await result.current.handleTaskLineItemsChange('task-1', newItems)
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        orderId: 'order-1',
        taskId: 'task-1',
        expectedLineItemsVersion: 1,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 'item-1',
            description: 'Updated Item',
            qty: 2,
          }),
        ]),
      })
      // Overrides are cleared after successful sync
      expect(result.current.taskLineItemOverrides['task-1']).toBeUndefined()
    })

    it('defaults expectedLineItemsVersion to 0 when task has no version', async () => {
      const tasksWithoutVersion = [
        {
          id: 'task-1',
          title: 'Task 1',
          status: 'IN_PROGRESS' as const,
          done: false,
          lineItems: [],
        },
      ] as unknown as WorkshopTask[]

      const { result } = renderHook(() =>
        useWorkshopTaskLineItems({
          orderId: 'order-1',
          isLocked: false,
          getTasks: () => tasksWithoutVersion,
        }),
      )

      await act(async () => {
        await result.current.handleTaskLineItemsChange('task-1', [
          {
            type: 'LABOR',
            itemNo: 'GEN-001',
            description: 'General labor',
            qty: 1,
            unitPrice: 50,
          },
        ])
      })

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ expectedLineItemsVersion: 0 }),
      )
    })

    it('clears overrides, invalidates order, and shows toast on 409 conflict', async () => {
      const conflictError = Object.assign(new Error('Line items version conflict'), {
        status: 409,
      })
      mockMutateAsync.mockRejectedValueOnce(conflictError)

      const { result } = renderHook(() =>
        useWorkshopTaskLineItems({
          orderId: 'order-1',
          isLocked: false,
          getTasks: () => mockTasks,
        }),
      )

      await act(async () => {
        await result.current.handleTaskLineItemsChange('task-1', [
          {
            id: 'item-1',
            type: 'PART',
            itemNo: 'P-1',
            description: 'Stale update',
            qty: 3,
            unitPrice: 12,
          },
        ])
      })

      expect(toast.error).toHaveBeenCalledWith('Line items version conflict')
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workshop', 'order', 'order-1'],
      })
      expect(result.current.taskLineItemOverrides['task-1']).toBeUndefined()
    })

    it('rolls back overrides and shows toast on mutation failure', async () => {
      mockMutateAsync.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() =>
        useWorkshopTaskLineItems({
          orderId: 'order-1',
          isLocked: false,
          getTasks: () => mockTasks,
        }),
      )

      const newItems: TaskLineItemInput[] = [
        {
          type: 'PART',
          itemNo: 'P-2',
          description: 'Failing Item',
          qty: 1,
          unitPrice: 25,
        },
      ]

      await act(async () => {
        await result.current.handleTaskLineItemsChange('task-1', newItems)
      })

      expect(toast.error).toHaveBeenCalledWith('Network error')
      // Rolled back to previous items
      expect(result.current.taskLineItemOverrides['task-1']).toEqual(
        mockTasks[0].lineItems,
      )
    })

    it('does not mutate when order is locked', async () => {
      const { result } = renderHook(() =>
        useWorkshopTaskLineItems({
          orderId: 'order-1',
          isLocked: true,
          getTasks: () => mockTasks,
        }),
      )

      await act(async () => {
        await result.current.handleTaskLineItemsChange('task-1', [])
      })

      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('clearTaskLineItemOverrides removes overrides for a task', () => {
      const { result } = renderHook(() =>
        useWorkshopTaskLineItems({
          orderId: 'order-1',
          isLocked: false,
          getTasks: () => mockTasks,
        }),
      )

      act(() => {
        result.current.clearTaskLineItemOverrides('task-1')
      })

      expect(result.current.taskLineItemOverrides['task-1']).toBeUndefined()
    })
  })
})
