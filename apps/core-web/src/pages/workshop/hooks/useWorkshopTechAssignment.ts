import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAssignBoard, useWorkshopResources, workshopKeys } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { getErrorMessage } from '../utils/error'

/** Assigned technician and bay of an order, and the optimistic technician assignment (rolled back when it fails). */
export function useWorkshopTechAssignment(order: WorkshopOrder) {
  const { t } = useTranslation('workshop')
  const queryClient = useQueryClient()
  const assignBoard = useAssignBoard()
  const workshopResourcesQuery = useWorkshopResources()
  const workshopResources = workshopResourcesQuery?.data

  const canAssignTech =
    order.status === 'SCHEDULED' ||
    order.status === 'INTAKE' ||
    order.status === 'IN_PROGRESS'
  const assignedTechId = order.mechanicId ?? order.mechanic_id ?? null
  const assignedTechName =
    workshopResources?.mechanics.find((mechanic) => mechanic.id === assignedTechId)?.name ?? null
  const activeMechanics =
    workshopResources?.mechanics
      .filter((mechanic) => mechanic.isActive)
      .map((mechanic) => ({ id: mechanic.id, name: mechanic.name })) ?? []
  const assignedBayName =
    workshopResources?.bays.find((bay) => bay.id === (order.bayId ?? order.bay_id))?.name ?? null

  const handleAssignedTechChange = async (mechanicId: string | null) => {
    if (!canAssignTech) return
    if (mechanicId === assignedTechId) return

    const previousOrder = queryClient.getQueryData<WorkshopOrder>(
      workshopKeys.detail(order.id),
    )

    queryClient.setQueryData<WorkshopOrder>(workshopKeys.detail(order.id), {
      ...order,
      mechanicId,
      mechanic_id: mechanicId,
    })

    try {
      await assignBoard.mutateAsync({ orderId: order.id, mechanicId })
      toast.success(
        mechanicId
          ? t('orderDetail.toast.technicianAssigned')
          : t('orderDetail.toast.technicianUnassigned'),
      )
    } catch (error: unknown) {
      if (previousOrder) {
        queryClient.setQueryData(workshopKeys.detail(order.id), previousOrder)
      }
      toast.error(getErrorMessage(error, t('orderDetail.toast.technicianAssignFailed')))
    }
  }

  return {
    assignedTechId,
    assignedTechName,
    activeMechanics,
    assignedBayName,
    canAssignTech,
    isAssigningTech: assignBoard.isPending,
    handleAssignedTechChange,
  }
}
