import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAssignBoard, useWorkshopResources } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { isWorkshopTechAssignableStatus } from '@/features/actions/action-role-predicates'
import { getErrorMessage } from '../utils/error'

/** Assigned technician and bay of an order, and the optimistic technician assignment (rolled back when it fails). */
export function useWorkshopTechAssignment(order: WorkshopOrder) {
  const { t } = useTranslation('workshop')
  const assignBoard = useAssignBoard()
  const workshopResourcesQuery = useWorkshopResources()
  const workshopResources = workshopResourcesQuery?.data

  const canAssignTech = isWorkshopTechAssignableStatus(order.status)
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

    try {
      await assignBoard.mutateAsync({ orderId: order.id, mechanicId })
      toast.success(
        mechanicId
          ? t('orderDetail.toast.technicianAssigned')
          : t('orderDetail.toast.technicianUnassigned'),
      )
    } catch (error: unknown) {
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
