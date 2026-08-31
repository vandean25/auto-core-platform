import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { useCatalogProviderSettings } from '@/api/catalog-providers'
import { useVehicle } from '@/api/vehicles'
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
import { useCreateDraftInvoice, useIssueInvoice, useUpdateInvoiceDiscount } from '@/api/invoices'
import { useInvoice } from '@/api/sales'
import { parseDiscountValue } from '@/lib/discount'
import {
  useCreateWorkshopTask,
  useDeleteWorkshopTask,
  useReplaceWorkshopTaskLineItems,
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
  DiscountType,
  WorkshopLineItemType,
  WorkshopOrder,
  WorkshopTask,
  WorkshopTaskLineItem,
  WorkshopTaskStatus,
} from '@/api/types'
import {
  useWorkshopCalculations,
  findInvoiceItemByLineItemId,
} from './hooks/useWorkshopCalculations'
import type { DiscountState } from './hooks/useWorkshopCalculations'
import { OrderTopBar, CustomerVehicleInfo } from './components/OrderHeader'
import { TaskList } from './components/TaskList'
import { CheckoutFooter } from './components/CheckoutFooter'
import {
  createEmptyCatalogSearchSession,
  findOemConcernForMakeBrandId,
  isVehicleIdentityStale,
  type CatalogSearchSession,
  type CatalogSourceMetadata,
} from '@/features/workshop/catalog-source-copy'

const EMPTY_DISCOUNT_STATE: DiscountState = { type: null, value: '' }

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
      return maybeMessage
    }
  }

  return fallbackMessage
}

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
  const replaceTaskLineItems = useReplaceWorkshopTaskLineItems()
  const createDraftInvoice = useCreateDraftInvoice()
  const issueInvoice = useIssueInvoice()
  const updateInvoiceDiscount = useUpdateInvoiceDiscount()
  const generateWorkshopPdf = useGenerateWorkshopPdf()

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [expandedTaskGroups, setExpandedTaskGroups] = useState<Record<string, boolean>>({})
  const [taskDiscountOverrides, setTaskDiscountOverrides] = useState<Record<string, string>>({})
  const [lineDiscountOverrides, setLineDiscountOverrides] = useState<Record<string, DiscountState>>({})
  const [checkoutInvoiceIdOverride, setCheckoutInvoiceIdOverride] = useState<string | null>(null)
  const [taskLineItemOverrides, setTaskLineItemOverrides] = useState<Record<string, WorkshopTask['lineItems']>>({})
  const [taskPendingDelete, setTaskPendingDelete] = useState<WorkshopTask | null>(null)
  const [catalogSearchSession, setCatalogSearchSession] = useState<CatalogSearchSession>(
    createEmptyCatalogSearchSession,
  )
  const [fitmentSearchTaskId, setFitmentSearchTaskId] = useState<string | null>(null)
  const lineItemSaveSeq = useRef<Record<string, number>>({})

  const activeInvoiceId = order?.invoice?.id ?? checkoutInvoiceIdOverride
  const { data: fetchedInvoice, isLoading: isInvoiceLoading } = useInvoice(activeInvoiceId ?? '')
  const { data: vehicleIdentity } = useVehicle(order?.vehicle.id ?? '')
  const { data: catalogProviderSettings } = useCatalogProviderSettings()
  const oemConcern = findOemConcernForMakeBrandId(
    vehicleIdentity?.make_brand_id,
    catalogProviderSettings?.oemConcerns,
  )
  const isIdentityStale = isVehicleIdentityStale(vehicleIdentity)

  // ── All calculation logic delegated to the hook ─────────────────────────
  const {
    tasks,
    rawTaskTotals,
    checkoutLineRows,
    checkoutLineRowByRowKey,
    groupedCheckoutTasks,
    discountSeedFromInvoice,
    checkoutSubtotal,
    checkoutDiscountTotal,
    checkoutNetTotal,
    checkoutTaxTotal,
    checkoutGrossTotal,
    orderGrandTotal,
  } = useWorkshopCalculations({
    orderTasks: order?.tasks,
    taskLineItemOverrides,
    lineDiscountOverrides,
    fetchedInvoice: fetchedInvoice ?? null,
    isCheckoutView: isCheckoutOpen,
  })

  if (isLoading) {
    return <div className='p-8 text-center text-sm text-muted-foreground'>Loading workshop order...</div>
  }

  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='text-base font-semibold'>Workshop order not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground mb-4'>The selected workshop order does not exist.</p>
          <Button onClick={() => navigate('/workshop/orders')}>Back to Workshop Orders</Button>
        </CardContent>
      </Card>
    )
  }

  const isLocked = order.status === 'INVOICED'
  const canAssignTech =
    order.status === 'SCHEDULED' ||
    order.status === 'INTAKE' ||
    order.status === 'IN_PROGRESS'
  const hasLinkedInvoice = !!activeInvoiceId
  const canDeleteTasks = !isLocked && !hasLinkedInvoice
  const invoiceStatus = fetchedInvoice?.status ?? null
  const canCreateDraftInCheckout =
    !activeInvoiceId &&
    order.status === 'COMPLETED' &&
    !createDraftInvoice.isPending
  const canIssueInvoiceInCheckout =
    !!activeInvoiceId &&
    invoiceStatus === 'DRAFT' &&
    !isLocked &&
    !issueInvoice.isPending &&
    !updateInvoiceDiscount.isPending
  const isInvoicedWithLinkedInvoice = order.status === 'INVOICED' && !!activeInvoiceId

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
    if (nextIssue === (order.reportedIssue || order.reported_issue || '')) return
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
      const created = await createTask.mutateAsync({ orderId: order.id, title })
      setNewTaskTitle('')
      setExpandedTaskId(created.id)
      toast.success('Task created')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create task'))
    }
  }

  const handleTaskStatusChange = async (taskId: string, status: WorkshopTaskStatus) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, status })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to update task status'))
    }
  }

  const handleTaskMechanicNotesChange = async (taskId: string, notes: string) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, mechanicNotes: notes })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to update mechanic notes'))
    }
  }

  const handleTaskLineItemsChange = async (
    taskId: string,
    items: Array<{
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
    }>,
  ) => {
    if (isLocked) return
    const saveSeq = (lineItemSaveSeq.current[taskId] ?? 0) + 1
    lineItemSaveSeq.current[taskId] = saveSeq
    const previousItems = tasks.find((task) => task.id === taskId)?.lineItems ?? []
    const nextItemsForUi: WorkshopTaskLineItem[] = items.map((item, index) => ({
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
    setTaskLineItemOverrides((previous) => ({
      ...previous,
      [taskId]: nextItemsForUi,
    }))
    try {
      await replaceTaskLineItems.mutateAsync({
        orderId: order.id,
        taskId,
        items: items.map(({
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
        })),
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

  const handleToggleTask = async (taskId: string, checked: boolean) => {
    await handleTaskStatusChange(taskId, checked ? 'DONE' : 'IN_PROGRESS')
  }

  const handleDeleteTask = async () => {
    if (!taskPendingDelete || !canDeleteTasks) return

    try {
      await deleteTask.mutateAsync({ orderId: order.id, taskId: taskPendingDelete.id })
      if (expandedTaskId === taskPendingDelete.id) {
        setExpandedTaskId(null)
      }
      setTaskLineItemOverrides((previous) => {
        const next = { ...previous }
        delete next[taskPendingDelete.id]
        return next
      })
      delete lineItemSaveSeq.current[taskPendingDelete.id]
      setTaskPendingDelete(null)
      toast.success('Task deleted')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to delete task'))
    }
  }

  const handleCheckoutAction = () => {
    if (isInvoicedWithLinkedInvoice) {
      navigate(`/sales/invoices/${activeInvoiceId}`)
      return
    }
    setIsCheckoutOpen((previous) => !previous)
  }

  const handleCreateDraftInCheckout = async () => {
    if (!canCreateDraftInCheckout) return
    try {
      const invoice = await createDraftInvoice.mutateAsync(order.id)
      setCheckoutInvoiceIdOverride(invoice.id)
      toast.success(`Draft invoice created (${invoice.invoice_number || invoice.id})`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create draft invoice'))
    }
  }

  const handleIssueInvoiceInCheckout = async () => {
    if (!activeInvoiceId || !canIssueInvoiceInCheckout) return
    try {
      if (fetchedInvoice && Object.keys(lineDiscountOverrides).length > 0) {
        const lineItemUpdatesById: Record<string, { id: string; discountType: DiscountType | null; discountValue: number | null }> = {}
        Object.entries(lineDiscountOverrides).forEach(([rowKey, discount]) => {
          const lineRow = checkoutLineRowByRowKey.get(rowKey)
          if (!lineRow) return
          const invoiceItem = findInvoiceItemByLineItemId(fetchedInvoice.items, lineRow.lineItem.id)
          if (!invoiceItem) return
          const discountValue = discount.type
            ? parseDiscountValue(discount.value)
            : null
          lineItemUpdatesById[invoiceItem.id] = {
            id: invoiceItem.id,
            discountType: discount.type,
            discountValue,
          }
        })

        const lineItems = Object.values(lineItemUpdatesById)
        if (lineItems.length > 0) {
          await updateInvoiceDiscount.mutateAsync({
            invoiceId: activeInvoiceId,
            payload: { lineItems },
          })
        }
      }

      const invoice = await issueInvoice.mutateAsync(activeInvoiceId)
      toast.success(`Invoice issued (${invoice.invoice_number || invoice.id})`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to issue invoice'))
    }
  }

  const handlePrint = async () => {
    const toastId = toast.loading('Generating Job Card PDF...')
    let url: string | null = null
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
      url = window.URL.createObjectURL(blob)

      const fileName = `job-card-${order.order_number || order.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()

      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast.success('Job Card PDF downloaded successfully', { id: toastId })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to generate PDF'), { id: toastId })
    } finally {
      if (url) {
        const urlToRevoke = url
        window.setTimeout(() => {
          window.URL.revokeObjectURL(urlToRevoke)
        }, 0)
      }
    }
  }

  const handleToggleGroup = (taskId: string) => {
    setExpandedTaskGroups((previous) => ({
      ...previous,
      [taskId]: !previous[taskId],
    }))
  }

  const handleTaskDiscountValueChange = (taskId: string, value: string) => {
    setTaskDiscountOverrides((previous) => ({
      ...previous,
      [taskId]: value,
    }))

    const taskLineKeys = checkoutLineRows.filter((lineRow) => lineRow.taskId === taskId).map((lineRow) => lineRow.rowKey)
    setLineDiscountOverrides((previous) => {
      const next = { ...previous }
      taskLineKeys.forEach((rowKey) => {
        next[rowKey] = value.trim()
          ? { type: 'PERCENTAGE', value }
          : { type: null, value: '' }
      })
      return next
    })
  }

  const handleLineDiscountTypeChange = (rowKey: string, value: string) => {
    const nextType = value === 'NONE' ? null : (value as DiscountType)
    const current = lineDiscountOverrides[rowKey] ?? discountSeedFromInvoice[rowKey] ?? EMPTY_DISCOUNT_STATE
    setLineDiscountOverrides((previous) => ({
      ...previous,
      [rowKey]: {
        ...current,
        type: nextType,
        value: nextType ? current.value : '',
      },
    }))
  }

  const handleLineDiscountValueChange = (rowKey: string, value: string) => {
    const current = lineDiscountOverrides[rowKey] ?? discountSeedFromInvoice[rowKey] ?? EMPTY_DISCOUNT_STATE
    setLineDiscountOverrides((previous) => ({
      ...previous,
      [rowKey]: {
        ...current,
        value,
      },
    }))
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
    workshopResources?.bays.find((bay) => bay.id === (order.bayId ?? order.bay_id))
      ?.name ?? null

  const handleAssignedTechChange = async (mechanicId: string | null) => {
    if (!canAssignTech) return

    const currentMechanicId = order.mechanicId ?? order.mechanic_id ?? null
    if (mechanicId === currentMechanicId) return

    const previousOrder = queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail(order.id))

    queryClient.setQueryData<WorkshopOrder>(workshopKeys.detail(order.id), {
      ...order,
      mechanicId,
      mechanic_id: mechanicId,
    })

    try {
      await assignBoard.mutateAsync({ orderId: order.id, mechanicId })
      toast.success(mechanicId ? 'Technician assigned' : 'Technician unassigned')
    } catch (error: unknown) {
      if (previousOrder) {
        queryClient.setQueryData(workshopKeys.detail(order.id), previousOrder)
      }
      toast.error(getErrorMessage(error, 'Failed to assign technician'))
    }
  }

  const handleReopenTask = (taskId: string) => {
    setIsCheckoutOpen(false)
    setExpandedTaskId(taskId)
  }

  const handleCatalogSearchSessionUpdate = (metadata: CatalogSourceMetadata) => {
    setCatalogSearchSession((previous) => ({
      ...previous,
      [metadata.concern === 'PARTS' ? 'parts' : 'labor']: metadata,
    }))
  }

  const handleOpenFitmentSearch = (taskId: string) => {
    setFitmentSearchTaskId(taskId)
  }

  const handleRequestResolveIdentity = () => {
    const resolveButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="resolve-vehicle-identity-button"]',
    )
    resolveButton?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    resolveButton?.focus()
  }
  const checkoutFooterTotal =
    activeInvoiceId && fetchedInvoice ? checkoutGrossTotal : orderGrandTotal
  const primaryCheckoutActionLabel = isInvoicedWithLinkedInvoice ? 'Open Invoice' : 'Checkout'

  // ── Render ──────────────────────────────────────────────────────────────

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
              animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
            >
              <CustomerVehicleInfo
                order={order}
                assignedTechName={assignedTechName}
                assignedTechId={assignedTechId}
                mechanics={activeMechanics}
                bayName={assignedBayName}
                canAssignTech={canAssignTech}
                isAssigningTech={assignBoard.isPending}
                onAssignedTechChange={(mechanicId) => void handleAssignedTechChange(mechanicId)}
              />
            </motion.div>

            <motion.div
              className='space-y-6 lg:col-span-2'
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut', delay: 0.04 } }}
            >
              <TaskList
                order={order}
                tasks={tasks}
                rawTaskTotals={rawTaskTotals}
                isLocked={isLocked}
                newTaskTitle={newTaskTitle}
                expandedTaskId={expandedTaskId}
                onNewTaskTitleChange={setNewTaskTitle}
                onAddTask={() => void handleAddTask()}
                onToggleTask={(taskId, checked) => void handleToggleTask(taskId, checked)}
                onExpandedTaskIdChange={setExpandedTaskId}
                onTaskLineItemsChange={(taskId, items) =>
                  void handleTaskLineItemsChange(taskId, items)
                }
                onTaskMechanicNotesChange={(taskId, notes) =>
                  void handleTaskMechanicNotesChange(taskId, notes)
                }
                onTaskDelete={(taskId) => {
                  const task = tasks.find((existingTask) => existingTask.id === taskId)
                  if (task) {
                    setTaskPendingDelete(task)
                  }
                }}
                canDeleteTask={canDeleteTasks}
                isDeletingTask={deleteTask.isPending}
                onSaveReportedIssue={(value) => void handleSaveReportedIssue(value)}
                onSaveNotes={(value) => void handleSaveNotes(value)}
                onOpenFitmentSearch={isLocked ? undefined : handleOpenFitmentSearch}
              />
            </motion.div>
          </div>

          <CheckoutFooter
            checkoutFooterTotal={checkoutFooterTotal}
            isCheckoutOpen={isCheckoutOpen}
            primaryActionLabel={primaryCheckoutActionLabel}
            onPrimaryAction={handleCheckoutAction}
            onClose={() => setIsCheckoutOpen(false)}
            activeInvoiceId={activeInvoiceId}
            fetchedInvoice={fetchedInvoice}
            isInvoiceLoading={isInvoiceLoading}
            isLocked={isLocked}
            canCreateDraftInCheckout={canCreateDraftInCheckout}
            canIssueInvoiceInCheckout={canIssueInvoiceInCheckout}
            createDraftPending={createDraftInvoice.isPending}
            issuePending={issueInvoice.isPending}
            groupedCheckoutTasks={groupedCheckoutTasks}
            expandedTaskGroups={expandedTaskGroups}
            taskDiscountOverrides={taskDiscountOverrides}
            checkoutSubtotal={checkoutSubtotal}
            checkoutDiscountTotal={checkoutDiscountTotal}
            checkoutNetTotal={checkoutNetTotal}
            checkoutTaxTotal={checkoutTaxTotal}
            checkoutGrossTotal={checkoutGrossTotal}
            onToggleGroup={handleToggleGroup}
            onTaskDiscountValueChange={handleTaskDiscountValueChange}
            onLineDiscountTypeChange={handleLineDiscountTypeChange}
            onLineDiscountValueChange={handleLineDiscountValueChange}
            onCreateDraftInvoice={() => void handleCreateDraftInCheckout()}
            onIssueInvoice={() => void handleIssueInvoiceInCheckout()}
            onReopenTask={handleReopenTask}
          />
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
            <AlertDialogCancel disabled={deleteTask.isPending}>Cancel</AlertDialogCancel>
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
