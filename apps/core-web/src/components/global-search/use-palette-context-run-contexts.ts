import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { WorkshopTaskStatus } from '@/api/types'
import {
  useAssignBoard,
  useGenerateWorkshopPdf,
  useUpdateWorkshopTask,
  useWorkshopResources,
} from '@/api/workshop'
import {
  runAssignWorkshopOrderMechanic,
  runUpdateWorkshopOrderTaskStatus,
} from '@/features/actions/work-order-row-actions'
import { useCustomerDeleteHandler } from '@/pages/customers/use-customer-delete-handler'

export function usePaletteContextRunContexts() {
  const { t: tWorkshop } = useTranslation('workshop')
  const { t: tCustomers } = useTranslation('customers')
  const { t: tVehicles } = useTranslation('vehicles')
  const navigate = useNavigate()
  const generatePdf = useGenerateWorkshopPdf()
  const assignBoard = useAssignBoard()
  const updateTask = useUpdateWorkshopTask()
  const workshopResourcesQuery = useWorkshopResources()
  const handleCustomerDelete = useCustomerDeleteHandler()

  const mechanics = useMemo(
    () =>
      workshopResourcesQuery?.data?.mechanics
        .filter((mechanic) => mechanic.isActive)
        .map((mechanic) => ({ id: mechanic.id, name: mechanic.name })) ?? [],
    [workshopResourcesQuery?.data],
  )

  const assignMechanic = useCallback(
    async (
      orderId: string,
      mechanicId: string | null,
      currentMechanicId: string | null,
    ) => {
      await runAssignWorkshopOrderMechanic(
        orderId,
        mechanicId,
        currentMechanicId,
        assignBoard.mutateAsync,
        tWorkshop,
      )
    },
    [assignBoard, tWorkshop],
  )

  const updateTaskStatus = useCallback(
    async (orderId: string, taskId: string, status: WorkshopTaskStatus) => {
      await runUpdateWorkshopOrderTaskStatus(
        orderId,
        taskId,
        status,
        updateTask.mutateAsync,
        tWorkshop,
      )
    },
    [tWorkshop, updateTask],
  )

  const workshop = useMemo(
    () => ({
      navigate,
      generatePdf,
      t: tWorkshop,
      mechanics,
      assignMechanic,
      updateTaskStatus,
    }),
    [assignMechanic, generatePdf, mechanics, navigate, tWorkshop, updateTaskStatus],
  )
  const customer = useMemo(
    () => ({ navigate, onDelete: handleCustomerDelete, t: tCustomers }),
    [handleCustomerDelete, navigate, tCustomers],
  )
  const vehicle = useMemo(() => ({ navigate, t: tVehicles }), [navigate, tVehicles])

  return { workshop, customer, vehicle }
}
