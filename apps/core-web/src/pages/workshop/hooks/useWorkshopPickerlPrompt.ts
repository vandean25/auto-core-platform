import { useEffect, useRef, useState } from 'react'
import { useAuthSession } from '@/api/auth-session'
import { useVehicleInspectionRecords } from '@/api/vehicle-inspection-records'
import type { WorkshopOrder, WorkshopTask } from '@/api/types'
import { formatLocalDateInput } from '@/components/vehicles/RecordPickerlDialog'
import { canRecordVehicleInspection } from '@/components/vehicles/vehicle-pickerl-permissions'
import { PICKERL_TASK_TITLE } from '@/features/workshop/pickerl.constants'

/**
 * Offers the Pickerl recording dialog: when the §57a task is completed here, or once per completed task when
 * an authorized user opens an order whose vehicle has no inspection record from after the completion.
 */
export function useWorkshopPickerlPrompt(order: WorkshopOrder, tasks: WorkshopTask[]) {
  const sessionQuery = useAuthSession()
  const inspectionRecordsQuery = useVehicleInspectionRecords(order.vehicle.id)
  const [open, setOpen] = useState(false)
  const [inspectedOn, setInspectedOn] = useState<string>()
  const promptedTaskIds = useRef(new Set<string>())

  const canManagePickerl = canRecordVehicleInspection(sessionQuery.data?.activeRole)
  const completedPickerlTask = tasks.find(
    (task) => task.title === PICKERL_TASK_TITLE && task.status === 'DONE',
  )

  const offerRecording = () => {
    setInspectedOn(formatLocalDateInput(new Date()))
    setOpen(true)
  }

  useEffect(() => {
    if (
      !completedPickerlTask ||
      !canManagePickerl ||
      inspectionRecordsQuery.isLoading ||
      promptedTaskIds.current.has(completedPickerlTask.id)
    )
      return

    const completedAt = Date.parse(completedPickerlTask.updatedAt ?? '')
    const hasRecordForCompletedTask = inspectionRecordsQuery.data?.some(
      (record) =>
        Number.isFinite(completedAt) &&
        Date.parse(record.createdAt) >= completedAt,
    )
    if (hasRecordForCompletedTask) return

    promptedTaskIds.current.add(completedPickerlTask.id)
    setInspectedOn(formatLocalDateInput(new Date()))
    setOpen(true)
  }, [
    canManagePickerl,
    completedPickerlTask,
    inspectionRecordsQuery.data,
    inspectionRecordsQuery.isLoading,
  ])

  return {
    canManagePickerl,
    offerRecording,
    dialogProps: { open, initialInspectedOn: inspectedOn, onOpenChange: setOpen },
  }
}
