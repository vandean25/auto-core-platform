import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { useCatalogProviderSettings } from '@/api/useCatalogProviderSettings'
import { useVehicle, useResolveVehicleIdentity } from '@/api/vehicles'
import { FitmentSearchModal } from '@/components/workshop/FitmentSearchModal'
import { VehicleIdentityBanner } from '@/components/workshop/VehicleIdentityBanner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useCreateWorkshopTask,
  useDeleteWorkshopTask,
  useUpdateWorkshopOrder,
  useUpdateWorkshopTask,
  useWorkshopOrder,
  useGenerateWorkshopPdf,
  downloadWorkshopPdf,
  useWorkshopResources,
  useAssignBoard,
  workshopKeys,
} from '@/api/workshop'
import type {
  WorkshopOrder,
  WorkshopTask,
  WorkshopTaskStatus,
} from '@/api/types'
import { OrderTopBar, CustomerVehicleInfo } from './components/OrderHeader'
import { TaskList } from './components/TaskList'
import { CheckoutFooter } from './components/CheckoutFooter'
import { useWorkshopCheckout } from './hooks/useWorkshopCheckout'
import { useWorkshopTaskLineItems } from './hooks/useWorkshopTaskLineItems'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage } from './utils/error'
import {
  createEmptyCatalogSearchSession,
  findOemConcernForMakeBrandId,
  isVehicleIdentityStale,
  type CatalogSearchSession,
  type CatalogSourceMetadata,
} from '@/features/workshop/catalog-source-copy'

export function WorkshopOrderDetails() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { id = '' } = useParams<{ id: string }>()
  const { data: order, isLoading } = useWorkshopOrder(id)
  const workshopResourcesQuery = useWorkshopResources()
  const workshopResources = workshopResourcesQuery?.data

  const updateOrder = useUpdateWorkshopOrder()
  const assignBoard = useAssignBoard()
  const createTask = useCreateWorkshopTask()
  const deleteTask = useDeleteWorkshopTask()
  const updateTask = useUpdateWorkshopTask()
  const generateWorkshopPdf = useGenerateWorkshopPdf()
  const resolveIdentity = useResolveVehicleIdentity()

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [taskPendingDelete, setTaskPendingDelete] =
    useState<WorkshopTask | null>(null)
  const [catalogSearchSession, setCatalogSearchSession] =
    useState<CatalogSearchSession>(createEmptyCatalogSearchSession)
  const [fitmentSearchTaskId, setFitmentSearchTaskId] = useState<string | null>(
    null,
  )

  const isLocked = order?.status === 'INVOICED'

  const {
    taskLineItemOverrides,
    handleTaskLineItemsChange,
    clearTaskLineItemOverrides,
  } = useWorkshopTaskLineItems({
    orderId: order?.id,
    isLocked: !!isLocked,
    getTasks: () => checkout.tasks,
  })

  const checkout = useWorkshopCheckout({
    order,
    taskLineItemOverrides,
    onReopenTask: setExpandedTaskId,
  })

  const { data: vehicleIdentity } = useVehicle(order?.vehicle?.id ?? '')
  const { data: catalogProviderSettings } = useCatalogProviderSettings()
  const oemConcern = findOemConcernForMakeBrandId(
    vehicleIdentity?.make_brand_id,
    catalogProviderSettings?.oemConcerns,
  )
  const isIdentityStale = isVehicleIdentityStale(vehicleIdentity)

  if (isLoading) {
    return (
      <div className='p-8 text-center text-sm text-muted-foreground'>
        Loading workshop order...
      </div>
    )
  }

  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='text-base font-semibold'>
            Workshop order not found
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground mb-4'>
            The selected workshop order does not exist.
          </p>
          <Button onClick={() => navigate('/workshop/orders')}>
            Back to Workshop Orders
          </Button>
        </CardContent>
      </Card>
    )
  }

  const canAssignTech =
    order.status === 'SCHEDULED' ||
    order.status === 'INTAKE' ||
    order.status === 'IN_PROGRESS'
  const canDeleteTasks = !isLocked && !checkout.hasLinkedInvoice

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSaveNotes = async (nextNotes: string) => {
    if (isLocked) return
    if (nextNotes === (order.notes ?? '')) return
    try {
      await updateOrder.mutateAsync({ id: order.id, notes: nextNotes })
      toast.success('Internal notes saved')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to save notes'))
    }
  }

  const handleSaveReportedIssue = async (nextIssue: string) => {
    if (isLocked) return
    if (nextIssue === (order.reportedIssue || order.reported_issue || ''))
      return
    try {
      await updateOrder.mutateAsync({
        id: order.id,
        reportedIssue: nextIssue,
      })
      toast.success('Reported issue saved')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to save reported issue'))
    }
  }

  const handleAddTask = async () => {
    if (isLocked) return
    const title = newTaskTitle.trim()
    if (!title) return

    try {
      const created = await createTask.mutateAsync({
        orderId: order.id,
        title,
      })
      setNewTaskTitle('')
      setExpandedTaskId(created.id)
      toast.success('Task created')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create task'))
    }
  }

  const handleTaskStatusChange = async (
    taskId: string,
    status: WorkshopTaskStatus,
  ) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, status })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to update task status'))
    }
  }

  const handleTaskMechanicNotesChange = async (
    taskId: string,
    notes: string,
  ) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({
        orderId: order.id,
        taskId,
        mechanicNotes: notes,
      })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to update mechanic notes'))
    }
  }

  const handleToggleTask = async (taskId: string, checked: boolean) => {
    await handleTaskStatusChange(taskId, checked ? 'DONE' : 'IN_PROGRESS')
  }

  const handleDeleteTask = async () => {
    if (!taskPendingDelete || !canDeleteTasks) return

    try {
      await deleteTask.mutateAsync({
        orderId: order.id,
        taskId: taskPendingDelete.id,
      })
      if (expandedTaskId === taskPendingDelete.id) {
        setExpandedTaskId(null)
      }
      clearTaskLineItemOverrides(taskPendingDelete.id)
      setTaskPendingDelete(null)
      toast.success('Task deleted')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to delete task'))
    }
  }

  const handlePrint = async () => {
    const toastId = toast.loading('Generating Job Card PDF...')
    try {
      const res = await generateWorkshopPdf.mutateAsync(order.id)
      if (res.enqueued) {
        toast.success(
          'Job Card PDF generation has been queued in the background. It will be available shortly.',
          { id: toastId },
        )
        return
      }

      const blob = await downloadWorkshopPdf(order.id)
      const fileName = `job-card-${order.order_number || order.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()

      triggerBlobDownload(blob, `${fileName}.pdf`)
      toast.success('Job Card PDF downloaded successfully', { id: toastId })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to generate PDF'), {
        id: toastId,
      })
    }
  }

  const assignedTechName =
    workshopResources?.mechanics.find(
      (mechanic) => mechanic.id === (order.mechanicId ?? order.mechanic_id),
    )?.name ?? null
  const assignedTechId = order.mechanicId ?? order.mechanic_id ?? null
  const activeMechanics =
    workshopResources?.mechanics
      .filter((mechanic) => mechanic.isActive)
      .map((mechanic) => ({ id: mechanic.id, name: mechanic.name })) ?? []
  const assignedBayName =
    workshopResources?.bays.find(
      (bay) => bay.id === (order.bayId ?? order.bay_id),
    )?.name ?? null

  const handleAssignedTechChange = async (mechanicId: string | null) => {
    if (!canAssignTech) return

    const currentMechanicId = order.mechanicId ?? order.mechanic_id ?? null
    if (mechanicId === currentMechanicId) return

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
        mechanicId ? 'Technician assigned' : 'Technician unassigned',
      )
    } catch (error: unknown) {
      if (previousOrder) {
        queryClient.setQueryData(workshopKeys.detail(order.id), previousOrder)
      }
      toast.error(getErrorMessage(error, 'Failed to assign technician'))
    }
  }

  const handleCatalogSearchSessionUpdate = (
    metadata: CatalogSourceMetadata,
  ) => {
    setCatalogSearchSession((previous) => ({
      ...previous,
      [metadata.concern === 'PARTS' ? 'parts' : 'labor']: metadata,
    }))
  }

  const handleOpenFitmentSearch = (taskId: string) => {
    setFitmentSearchTaskId(taskId)
  }

  const handleRequestResolveIdentity = () => {
    setFitmentSearchTaskId(null)
    const vehicleId = order.vehicle.id
    if (!vehicleId) return
    void resolveIdentity
      .mutateAsync(vehicleId)
      .then(() => {
        toast.success('Vehicle identity resolved')
      })
      .catch((error: unknown) => {
        toast.error(
          getErrorMessage(error, 'Failed to resolve vehicle identity'),
        )
      })
  }

  return (
    <div className='space-y-6'>
      <motion.div className='w-full min-w-0 space-y-6'>
        <OrderTopBar
          order={order}
          assignedTechName={assignedTechName}
          bayName={assignedBayName}
          catalogSearchSession={catalogSearchSession}
          oemConcernCode={oemConcern?.code ?? null}
          onPrint={handlePrint}
        />

        <VehicleIdentityBanner vehicleId={order.vehicle.id} />

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
          <motion.div
            className='space-y-6 lg:col-span-1'
            initial={{ opacity: 0, x: -8 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: { duration: 0.22, ease: 'easeOut' },
            }}
          >
            <CustomerVehicleInfo
              order={order}
              assignedTechName={assignedTechName}
              assignedTechId={assignedTechId}
              mechanics={activeMechanics}
              bayName={assignedBayName}
              canAssignTech={canAssignTech}
              isAssigningTech={assignBoard.isPending}
              onAssignedTechChange={(mechanicId) =>
                void handleAssignedTechChange(mechanicId)
              }
            />
          </motion.div>

          <motion.div
            className='space-y-6 lg:col-span-2'
            initial={{ opacity: 0, x: 8 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: { duration: 0.22, ease: 'easeOut', delay: 0.04 },
            }}
          >
            <TaskList
              order={order}
              tasks={checkout.tasks}
              rawTaskTotals={checkout.rawTaskTotals}
              isLocked={isLocked}
              newTaskTitle={newTaskTitle}
              expandedTaskId={expandedTaskId}
              onNewTaskTitleChange={setNewTaskTitle}
              onAddTask={() => void handleAddTask()}
              onToggleTask={(taskId, checked) =>
                void handleToggleTask(taskId, checked)
              }
              onExpandedTaskIdChange={setExpandedTaskId}
              onTaskLineItemsChange={(taskId, items) =>
                void handleTaskLineItemsChange(taskId, items)
              }
              onTaskMechanicNotesChange={(taskId, notes) =>
                void handleTaskMechanicNotesChange(taskId, notes)
              }
              onTaskDelete={(taskId) => {
                const task = checkout.tasks.find(
                  (existingTask) => existingTask.id === taskId,
                )
                if (task) {
                  setTaskPendingDelete(task)
                }
              }}
              canDeleteTask={canDeleteTasks}
              isDeletingTask={deleteTask.isPending}
              onSaveReportedIssue={(value) =>
                void handleSaveReportedIssue(value)
              }
              onSaveNotes={(value) => void handleSaveNotes(value)}
              onOpenFitmentSearch={
                isLocked ? undefined : handleOpenFitmentSearch
              }
            />
          </motion.div>
        </div>

        <CheckoutFooter {...checkout.footerProps} isLocked={isLocked} />
      </motion.div>

      {fitmentSearchTaskId && (
        <FitmentSearchModal
          open={fitmentSearchTaskId !== null}
          onOpenChange={(open) => {
            if (!open) setFitmentSearchTaskId(null)
          }}
          workshopOrderId={order.id}
          taskId={fitmentSearchTaskId}
          vehicleId={order.vehicle.id}
          oemConcernCode={oemConcern?.code ?? null}
          isIdentityStale={isIdentityStale}
          onSearchSessionUpdate={handleCatalogSearchSessionUpdate}
          onRequestResolveIdentity={handleRequestResolveIdentity}
        />
      )}

      <AlertDialog
        open={taskPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTaskPendingDelete(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              {taskPendingDelete
                ? `Delete "${taskPendingDelete.title}" from this workshop order? This also removes its parts and labor lines.`
                : 'Delete this task from the workshop order?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTask.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteTask()
              }}
              disabled={!canDeleteTasks || deleteTask.isPending}
            >
              {deleteTask.isPending ? 'Deleting...' : 'Delete Task'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default WorkshopOrderDetails
