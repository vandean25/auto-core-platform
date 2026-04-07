import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
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
import { TaskDetailPanel } from '@/components/workshop/TaskDetailPanel'
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
} from '@/api/workshop'
import type {
  DiscountType,
  WorkshopLineItemType,
  WorkshopTask,
  WorkshopTaskLineItem,
  WorkshopTaskStatus,
} from '@/api/types'
import {
  useWorkshopCalculations,
  findInvoiceItemByLineItemId,
} from './hooks/useWorkshopCalculations'
import type { DiscountState } from './hooks/useWorkshopCalculations'
import { OrderHeader } from './components/OrderHeader'
import { TaskList } from './components/TaskList'
import { CheckoutSummary } from './components/CheckoutSummary'

const EMPTY_DISCOUNT_STATE: DiscountState = { type: null, value: '' }

export function WorkshopOrderDetails() {
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const { data: order, isLoading } = useWorkshopOrder(id)

  const updateOrder = useUpdateWorkshopOrder()
  const createTask = useCreateWorkshopTask()
  const deleteTask = useDeleteWorkshopTask()
  const updateTask = useUpdateWorkshopTask()
  const replaceTaskLineItems = useReplaceWorkshopTaskLineItems()
  const createDraftInvoice = useCreateDraftInvoice()
  const issueInvoice = useIssueInvoice()
  const updateInvoiceDiscount = useUpdateInvoiceDiscount()

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [isCheckoutView, setIsCheckoutView] = useState(false)
  const [expandedTaskGroups, setExpandedTaskGroups] = useState<Record<string, boolean>>({})
  const [taskDiscountOverrides, setTaskDiscountOverrides] = useState<Record<string, string>>({})
  const [lineDiscountOverrides, setLineDiscountOverrides] = useState<Record<string, DiscountState>>({})
  const [checkoutInvoiceIdOverride, setCheckoutInvoiceIdOverride] = useState<string | null>(null)
  const [taskLineItemOverrides, setTaskLineItemOverrides] = useState<Record<string, WorkshopTask['lineItems']>>({})
  const [taskPendingDelete, setTaskPendingDelete] = useState<WorkshopTask | null>(null)
  const lineItemSaveSeq = useRef<Record<string, number>>({})

  const activeInvoiceId = order?.invoice?.id ?? checkoutInvoiceIdOverride
  const { data: fetchedInvoice, isLoading: isInvoiceLoading } = useInvoice(activeInvoiceId ?? '')

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
    orderPartsTotal,
    orderLaborTotal,
    orderGrandTotal,
  } = useWorkshopCalculations({
    orderTasks: order?.tasks,
    taskLineItemOverrides,
    lineDiscountOverrides,
    fetchedInvoice: fetchedInvoice ?? null,
    isCheckoutView,
  })

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null
    return tasks.find((task) => task.id === activeTaskId) ?? null
  }, [activeTaskId, tasks])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Loading workshop order...</p>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Workshop order not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">The selected workshop order does not exist.</p>
            <Button onClick={() => navigate('/workshop/orders')}>Back to Workshop Orders</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const canEnterCheckout = order.status === 'COMPLETED' || !!activeInvoiceId
  const isLocked = order.status === 'INVOICED'
  const hasLinkedInvoice = !!activeInvoiceId
  const canDeleteTasks = !isLocked && !hasLinkedInvoice
  const invoiceStatus = fetchedInvoice?.status ?? null
  const canCreateDraftInCheckout =
    isCheckoutView &&
    !activeInvoiceId &&
    order.status === 'COMPLETED' &&
    !createDraftInvoice.isPending
  const canIssueInvoiceInCheckout =
    isCheckoutView &&
    !!activeInvoiceId &&
    invoiceStatus === 'DRAFT' &&
    !isLocked &&
    !issueInvoice.isPending &&
    !updateInvoiceDiscount.isPending
  const isInvoicedWithLinkedInvoice = order.status === 'INVOICED' && !!activeInvoiceId
  const invoiceActionLabel = isCheckoutView
    ? 'Close Checkout'
    : isInvoicedWithLinkedInvoice
      ? 'Open Invoice'
      : activeInvoiceId
      ? 'Open Checkout'
      : 'Generate Invoice'
  const isInvoiceActionDisabled = !isCheckoutView && !canEnterCheckout

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSaveNotes = async (nextNotes: string) => {
    if (isLocked) return
    if (nextNotes === (order.notes ?? '')) return
    try {
      await updateOrder.mutateAsync({ id: order.id, notes: nextNotes })
      toast.success('Internal notes saved')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save notes')
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
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save reported issue')
    }
  }

  const handleAddTask = async () => {
    if (isLocked) return
    const title = newTaskTitle.trim()
    if (!title) return

    try {
      const created = await createTask.mutateAsync({ orderId: order.id, title })
      setNewTaskTitle('')
      setActiveTaskId(created.id)
      toast.success('Task created')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create task')
    }
  }

  const handleTaskStatusChange = async (taskId: string, status: WorkshopTaskStatus) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, status })
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update task status')
    }
  }

  const handleTaskMechanicNotesChange = async (taskId: string, notes: string) => {
    if (isLocked) return
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, mechanicNotes: notes })
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update mechanic notes')
    }
  }

  const handleTaskLineItemsChange = async (
    taskId: string,
    items: Array<{ id?: string; type: WorkshopLineItemType; itemNo: string; description: string; qty: number; unitPrice: number }>,
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
    }))
    setTaskLineItemOverrides((previous) => ({
      ...previous,
      [taskId]: nextItemsForUi,
    }))
    try {
      await replaceTaskLineItems.mutateAsync({
        orderId: order.id,
        taskId,
        items: items.map(({ type, itemNo, description, qty, unitPrice }) => ({
          type,
          itemNo,
          description,
          qty,
          unitPrice,
        })),
      })
      if (lineItemSaveSeq.current[taskId] !== saveSeq) return
      setTaskLineItemOverrides((previous) => {
        const next = { ...previous }
        delete next[taskId]
        return next
      })
    } catch (error: any) {
      if (lineItemSaveSeq.current[taskId] !== saveSeq) return
      setTaskLineItemOverrides((previous) => ({
        ...previous,
        [taskId]: previousItems,
      }))
      toast.error(error?.message || 'Failed to update task line items')
    }
  }

  const handleToggleTask = async (taskId: string, checked: boolean) => {
    await handleTaskStatusChange(taskId, checked ? 'DONE' : 'IN_PROGRESS')
  }

  const handleDeleteTask = async () => {
    if (!taskPendingDelete || !canDeleteTasks) return

    try {
      await deleteTask.mutateAsync({ orderId: order.id, taskId: taskPendingDelete.id })
      if (activeTaskId === taskPendingDelete.id) {
        setActiveTaskId(null)
      }
      setTaskLineItemOverrides((previous) => {
        const next = { ...previous }
        delete next[taskPendingDelete.id]
        return next
      })
      delete lineItemSaveSeq.current[taskPendingDelete.id]
      setTaskPendingDelete(null)
      toast.success('Task deleted')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete task')
    }
  }

  const openCheckoutView = () => {
    setIsCheckoutView(true)
    setExpandedTaskGroups({})
    setActiveTaskId(null)
  }

  const handleCheckoutAction = async () => {
    if (isCheckoutView) {
      setIsCheckoutView(false)
      return
    }

    if (isInvoicedWithLinkedInvoice) {
      navigate(`/sales/invoices/${activeInvoiceId}`)
      return
    }

    if (canEnterCheckout) {
      openCheckoutView()
      return
    }

    toast.error('Checkout view is available only for completed or invoiced workshop orders.')
  }

  const handleCreateDraftInCheckout = async () => {
    if (!canCreateDraftInCheckout) return
    try {
      const invoice = await createDraftInvoice.mutateAsync(order.id)
      setCheckoutInvoiceIdOverride(invoice.id)
      toast.success(`Draft invoice created (${invoice.invoice_number || invoice.id})`)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create draft invoice')
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
    } catch (error: any) {
      toast.error(error?.message || 'Failed to issue invoice')
    }
  }

  const handlePrint = () => {
    const previousTitle = document.title
    document.title = `Job Card ${order.order_number ?? order.id}`
    window.print()
    document.title = previousTitle
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

  const activeTaskForPanel = activeTask
    ? {
      ...activeTask,
      lineItems: activeTask.lineItems ?? [],
      mechanicNotes: activeTask.mechanicNotes ?? '',
    }
    : null

  const handleReopenTask = (taskId: string) => {
    setIsCheckoutView(false)
    setActiveTaskId(taskId)
  }

  const handleCloseTaskPanel = () => {
    setActiveTaskId(null)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      {/* Header Section */}
      <OrderHeader
        order={order}
        orderPartsTotal={orderPartsTotal}
        orderLaborTotal={orderLaborTotal}
        orderGrandTotal={orderGrandTotal}
        invoiceActionLabel={invoiceActionLabel}
        isInvoiceActionDisabled={isInvoiceActionDisabled}
        onCheckoutAction={() => void handleCheckoutAction()}
        onPrint={handlePrint}
      />

      {/* Main Content */}
      {!isCheckoutView ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {/* Widescreen 3-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Order Info + Customer + Vehicle (stacked on mobile, sidebar on desktop) */}
            <div className="lg:col-span-3 space-y-4 order-2 lg:order-1">
              <div className="lg:sticky lg:top-6 space-y-4">
                <OrderInfoCard order={order} />
                <CustomerInfoCard order={order} />
                <VehicleInfoCard order={order} />
              </div>
            </div>

            {/* Center Column: Tasks + Task Detail Panel */}
            <div className="lg:col-span-6 space-y-4 order-1 lg:order-2">
              <TaskList
                order={order}
                tasks={tasks}
                rawTaskTotals={rawTaskTotals}
                isLocked={isLocked}
                newTaskTitle={newTaskTitle}
                activeTaskId={activeTaskId}
                onNewTaskTitleChange={setNewTaskTitle}
                onAddTask={() => void handleAddTask()}
                onToggleTask={(taskId, checked) => void handleToggleTask(taskId, checked)}
                onOpenTask={setActiveTaskId}
              />

              {/* Horizontal Task Detail Panel */}
              <AnimatePresence mode="wait">
                {activeTaskForPanel && (
                  <motion.div
                    key={activeTaskForPanel.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <TaskDetailPanel
                      workshopOrderId={order.id}
                      task={activeTaskForPanel}
                      onTaskStatusChange={(taskId, status) => void handleTaskStatusChange(taskId, status)}
                      onTaskLineItemsChange={(taskId, items) => void handleTaskLineItemsChange(taskId, items)}
                      onTaskMechanicNotesChange={(taskId, notes) => void handleTaskMechanicNotesChange(taskId, notes)}
                      onTaskDelete={(taskId) => {
                        const task = tasks.find((existingTask) => existingTask.id === taskId)
                        if (task) {
                          setTaskPendingDelete(task)
                        }
                      }}
                      canDeleteTask={canDeleteTasks}
                      isDeletingTask={deleteTask.isPending}
                      readOnly={isLocked}
                      onClose={handleCloseTaskPanel}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right Column: Notes + Reported Issue */}
            <div className="lg:col-span-3 space-y-4 order-3">
              <div className="lg:sticky lg:top-6 space-y-4">
                <ReportedIssueCard
                  order={order}
                  isLocked={isLocked}
                  onSave={handleSaveReportedIssue}
                />
                <InternalNotesCard
                  order={order}
                  isLocked={isLocked}
                  onSave={handleSaveNotes}
                />
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <CheckoutSummary
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
            onReturnToTasks={() => setIsCheckoutView(false)}
            onReopenTask={handleReopenTask}
          />
        </motion.div>
      )}

      {/* Delete Task Dialog */}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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

// ── Info Card Components ──────────────────────────────────────────────────

import { Phone, Clock, Key, MapPin, User, FileText, AlertTriangle } from 'lucide-react'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

function getCustomerName(order: any) {
  if (order.customer.type === 'COMPANY' && order.customer.company_name) {
    return order.customer.company_name
  }
  return `${order.customer.first_name} ${order.customer.last_name}`.trim()
}

function getVehicleLabel(order: any) {
  return `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, '')
}

function OrderInfoCard({ order }: { order: any }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Order Details</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3 text-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Assigned Tech</span>
            <span className="font-medium flex items-center text-xs">
              <User className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              {order.assignedTechnician?.name || 'Unassigned'}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Bay / Location</span>
            <span className="font-medium flex items-center text-xs">
              <MapPin className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              {order.bayLocation || 'Not assigned'}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Promised Time</span>
            <span className="font-medium flex items-center text-xs">
              <Clock className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              {order.promisedTime
                ? new Date(order.promisedTime).toLocaleString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Not set'}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Key Tag</span>
            <span className="font-medium flex items-center text-xs">
              <Key className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              {order.keyTag || 'N/A'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CustomerInfoCard({ order }: { order: any }) {
  const customerName = getCustomerName(order)
  const customerPhone = order.customer.phone ?? ''

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Customer</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3 text-sm">
        <div>
          <div className="font-medium">{customerName}</div>
          <div className="text-muted-foreground text-xs">{order.customer.email}</div>
        </div>
        {customerPhone && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-muted-foreground text-xs">Phone</div>
                <div className="font-medium text-xs">{customerPhone}</div>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                <a href={`tel:${normalizePhone(customerPhone)}`}>
                  <Phone className="h-3 w-3 mr-1" />
                  Call
                </a>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function VehicleInfoCard({ order }: { order: any }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 bg-muted/30">
        <CardTitle className="text-sm font-semibold">{getVehicleLabel(order)}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <div className="text-muted-foreground text-xs">VIN</div>
            <div className="font-medium font-mono text-xs truncate" title={order.vehicle.vin}>
              {order.vehicle.vin || 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Plate</div>
            <div className="font-medium text-xs">{order.vehicle.plate || 'N/A'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Mileage</div>
            <div className="font-medium text-xs">
              {typeof order.odometer === 'number' ? `${order.odometer.toLocaleString()} km` : '-'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Fuel</div>
            <div className="font-medium text-xs">
              {typeof order.fuel_level === 'number' ? `${order.fuel_level}%` : '-'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ReportedIssueCard({ order, isLocked, onSave }: { order: any; isLocked: boolean; onSave: (value: string) => void }) {
  const hasIssue = !!(order.reportedIssue || order.reported_issue)
  
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Reported Issue</CardTitle>
          </div>
          {hasIssue && order.status !== 'COMPLETED' && (
            <Badge variant="destructive" className="text-xs h-5">Priority</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <InlineEdit
          mode="textarea"
          rows={4}
          placeholder="Customer reported issue..."
          value={order.reportedIssue || order.reported_issue || ''}
          readOnly={isLocked}
          onSave={onSave}
          emptyText="Add reported issue"
          ariaLabel="Workshop order reported issue"
        />
      </CardContent>
    </Card>
  )
}

function InternalNotesCard({ order, isLocked, onSave }: { order: any; isLocked: boolean; onSave: (value: string) => void }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Internal Notes</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <InlineEdit
          mode="textarea"
          rows={4}
          placeholder="Notes visible to service advisors and mechanics..."
          value={order.notes || ''}
          readOnly={isLocked}
          onSave={onSave}
          emptyText="Add internal notes"
          ariaLabel="Workshop internal notes"
        />
      </CardContent>
    </Card>
  )
}

export default WorkshopOrderDetails
