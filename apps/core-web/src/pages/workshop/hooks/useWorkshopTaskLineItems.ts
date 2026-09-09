import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useReplaceWorkshopTaskLineItems } from '@/api/workshop'
import type {
  WorkshopLineItemType,
  WorkshopTask,
  WorkshopTaskLineItem,
} from '@/api/types'
import { getErrorMessage } from '../utils/error'

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

export function buildApiLineItemsPayload(items: TaskLineItemInput[]) {
  return items.map(
    ({
      type,
      itemNo,
      description,
      qty,
      unitPrice,
      laborOperationId,
      standardAw,
      actualHours,
      internalCostRate,
    }) => ({
      type,
      itemNo,
      description,
      qty,
      unitPrice,
      laborOperationId,
      standardAw: standardAw ?? null,
      actualHours: actualHours ?? null,
      internalCostRate: internalCostRate ?? null,
    }),
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
  const replaceTaskLineItems = useReplaceWorkshopTaskLineItems()
  const [taskLineItemOverrides, setTaskLineItemOverrides] = useState<
    Record<string, WorkshopTask['lineItems']>
  >({})
  const lineItemSaveSeq = useRef<Record<string, number>>({})

  const handleTaskLineItemsChange = async (
    taskId: string,
    items: TaskLineItemInput[],
  ) => {
    if (isLocked || !orderId) return

    const saveSeq = (lineItemSaveSeq.current[taskId] ?? 0) + 1
    lineItemSaveSeq.current[taskId] = saveSeq

    const currentTasks = getTasks?.() ?? []
    const previousItems =
      currentTasks.find((task) => task.id === taskId)?.lineItems ?? []
    const nextItemsForUi = buildUiLineItems(taskId, items)

    setTaskLineItemOverrides((previous) => ({
      ...previous,
      [taskId]: nextItemsForUi,
    }))

    try {
      await replaceTaskLineItems.mutateAsync({
        orderId,
        taskId,
        items: buildApiLineItemsPayload(items),
      })

      if (lineItemSaveSeq.current[taskId] !== saveSeq) return

      setTaskLineItemOverrides((previous) => {
        const next = { ...previous }
        delete next[taskId]
        return next
      })
    } catch (error: unknown) {
      if (lineItemSaveSeq.current[taskId] !== saveSeq) return

      setTaskLineItemOverrides((previous) => ({
        ...previous,
        [taskId]: previousItems,
      }))
      toast.error(getErrorMessage(error, 'Failed to update task line items'))
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
