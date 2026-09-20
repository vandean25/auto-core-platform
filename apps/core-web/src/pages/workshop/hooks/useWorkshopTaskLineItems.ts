import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  useReplaceWorkshopTaskLineItems,
  workshopKeys,
  type ReplaceWorkshopTaskLineItemPayload,
} from '@/api/workshop'
import type {
  WorkshopLineItemType,
  WorkshopTask,
  WorkshopTaskLineItem,
} from '@/api/types'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'

export interface TaskLineItemInput {
  id?: string
  type: WorkshopLineItemType
  itemNo: string
  description: string
  qty: number
  unitPrice: number
  laborOperationId?: string | null
  standardAw?: number | null
  actualHours?: number | null
  internalCostRate?: number | null
}

export function buildUiLineItems(
  taskId: string,
  items: TaskLineItemInput[],
): WorkshopTaskLineItem[] {
  return items.map((item, index) => ({
    id: item.id ?? `tmp-${taskId}-${index}`,
    type: item.type,
    itemNo: item.itemNo,
    description: item.description,
    qty: item.qty,
    unitPrice: item.unitPrice,
    laborOperationId: item.laborOperationId,
    standardAw: item.standardAw ?? null,
    actualHours: item.actualHours ?? null,
    internalCostRate: item.internalCostRate ?? null,
  }))
}

function isClientTempLineItemId(id: string): boolean {
  return id.startsWith('tmp-') || id.startsWith('li-')
}

export function buildApiLineItemsPayload(
  items: TaskLineItemInput[],
): ReplaceWorkshopTaskLineItemPayload[] {
  return items.map(
    ({
      id,
      type,
      itemNo,
      description,
      qty,
      unitPrice,
      laborOperationId,
      standardAw,
      actualHours,
      internalCostRate,
    }) => {
      const payload: ReplaceWorkshopTaskLineItemPayload = {
        type,
        itemNo,
        description,
        qty,
        unitPrice,
        laborOperationId,
        standardAw: standardAw ?? null,
        actualHours: actualHours ?? null,
        internalCostRate: internalCostRate ?? null,
      }

      if (id && !isClientTempLineItemId(id)) {
        payload.id = id
      }

      return payload
    },
  )
}

export interface UseWorkshopTaskLineItemsOptions {
  orderId: string | undefined
  isLocked: boolean
  getTasks?: () => WorkshopTask[]
}

export function useWorkshopTaskLineItems({
  orderId,
  isLocked,
  getTasks,
}: UseWorkshopTaskLineItemsOptions) {
  const queryClient = useQueryClient()
  const replaceTaskLineItems = useReplaceWorkshopTaskLineItems()
  const [taskLineItemOverrides, setTaskLineItemOverrides] = useState<
    Record<string, WorkshopTask['lineItems']>
  >({})
  const lineItemSaveSeq = useRef<Record<string, number>>({})

  const clearTaskOverride = (taskId: string) => {
    setTaskLineItemOverrides((previous) => {
      const next = { ...previous }
      delete next[taskId]
      return next
    })
  }

  const handleTaskLineItemsChange = async (
    taskId: string,
    items: TaskLineItemInput[],
  ) => {
    if (isLocked || !orderId) return

    const saveSeq = (lineItemSaveSeq.current[taskId] ?? 0) + 1
    lineItemSaveSeq.current[taskId] = saveSeq

    const currentTasks = getTasks?.() ?? []
    const currentTask = currentTasks.find((task) => task.id === taskId)
    const previousItems = currentTask?.lineItems ?? []
    const expectedLineItemsVersion = currentTask?.lineItemsVersion ?? 0
    const nextItemsForUi = buildUiLineItems(taskId, items)

    setTaskLineItemOverrides((previous) => ({
      ...previous,
      [taskId]: nextItemsForUi,
    }))

    try {
      await replaceTaskLineItems.mutateAsync({
        orderId,
        taskId,
        expectedLineItemsVersion,
        items: buildApiLineItemsPayload(items),
      })

      if (lineItemSaveSeq.current[taskId] !== saveSeq) return

      clearTaskOverride(taskId)
    } catch (error: unknown) {
      if (lineItemSaveSeq.current[taskId] !== saveSeq) return

      const status = getErrorStatus(error)

      if (status === 409) {
        clearTaskOverride(taskId)
        await queryClient.invalidateQueries({ queryKey: workshopKeys.order(orderId) })
        toast.error(
          getErrorMessage(
            error,
            'This order was updated by another user. Data was refreshed — please review and try again.',
          ),
        )
        return
      }

      setTaskLineItemOverrides((previous) => ({
        ...previous,
        [taskId]: previousItems,
      }))

      const fallbackMessage =
        status === 400
          ? 'Invalid line items. Check quantities and try again.'
          : 'Failed to update task line items'

      toast.error(getErrorMessage(error, fallbackMessage))
    }
  }

  const clearTaskLineItemOverrides = (taskId: string) => {
    setTaskLineItemOverrides((previous) => {
      const next = { ...previous }
      delete next[taskId]
      return next
    })
    delete lineItemSaveSeq.current[taskId]
  }

  return {
    taskLineItemOverrides,
    handleTaskLineItemsChange,
    clearTaskLineItemOverrides,
    isReplacingLineItems: replaceTaskLineItems.isPending,
  }
}
