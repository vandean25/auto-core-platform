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

vi.mock('@/api/workshop')
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
        items: expect.arrayContaining([
          expect.objectContaining({ description: 'Updated Item', qty: 2 }),
        ]),
      })
      // Overrides are cleared after successful sync
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
