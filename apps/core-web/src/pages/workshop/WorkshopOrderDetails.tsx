import { useEffect, useMemo, useRef, useState } from 'react'
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
import { TaskDetailDrawer } from '@/components/workshop/TaskDetailDrawer'
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
import { OrderTopBar, CustomerVehicleInfo } from './components/OrderHeader'
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
  const generateWorkshopPdf = useGenerateWorkshopPdf()

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
  const [isDockedLayout, setIsDockedLayout] = useState(
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 1536px)').matches
      : false,
  )

  const activeInvoiceId = order?.invoice?.id ?? checkoutInvoiceIdOverride
  const { data: fetchedInvoice, isLoading: isInvoiceLoading } = useInvoice(activeInvoiceId ?? '')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(min-width: 1536px)')
    const update = () => setIsDockedLayout(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

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
    orderLaborInternalCostTotal,
    orderLaborMarginPercent,
    hasOrderLaborCostData,
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
    return <div className='p-8 text-center text-sm text-muted-foreground'>Loading workshop order...</div>
  }

  if (!order) {
    return (
      <div className='w-full max-w-7xl mx-auto p-6'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base font-semibold'>Workshop order not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground mb-4'>The selected workshop order does not exist.</p>
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
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate PDF', { id: toastId })
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

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className={`w-full space-y-6 transition-[max-width,padding,margin] duration-250 ${
        isDockedLayout && activeTaskForPanel && !isCheckoutView
          ? 'max-w-[1800px] px-4 2xl:px-6 py-6 mx-auto'
          : 'max-w-7xl px-6 py-6 mx-auto'
      }`}
    >
      <div className='2xl:flex 2xl:items-start 2xl:justify-start 2xl:gap-4'>
        <motion.div
          className={`w-full min-w-0 space-y-6 2xl:min-w-[960px] 2xl:flex-1 transition-transform duration-250 ${
            isDockedLayout && activeTask && !isCheckoutView ? '2xl:-translate-x-3' : '2xl:translate-x-0'
          }`}
        >
          <OrderTopBar
            order={order}
            orderPartsTotal={orderPartsTotal}
            orderLaborTotal={orderLaborTotal}
            orderGrandTotal={orderGrandTotal}
            orderLaborInternalCostTotal={orderLaborInternalCostTotal}
            orderLaborMarginPercent={orderLaborMarginPercent}
            hasOrderLaborCostData={hasOrderLaborCostData}
            invoiceActionLabel={invoiceActionLabel}
            isInvoiceActionDisabled={isInvoiceActionDisabled}
            onCheckoutAction={() => void handleCheckoutAction()}
            onPrint={handlePrint}
          />

          {!isCheckoutView && (
            <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
              <motion.div
                className='space-y-6 lg:col-span-1'
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
              >
                <CustomerVehicleInfo order={order} />
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
                  onNewTaskTitleChange={setNewTaskTitle}
                  onAddTask={() => void handleAddTask()}
                  onToggleTask={(taskId, checked) => void handleToggleTask(taskId, checked)}
                  onOpenTask={setActiveTaskId}
                  onSaveReportedIssue={(value) => void handleSaveReportedIssue(value)}
                  onSaveNotes={(value) => void handleSaveNotes(value)}
                />
              </motion.div>
            </div>
          )}

          {isCheckoutView && (
            <div className='grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start'>
              <motion.div
                className='space-y-6 xl:sticky xl:top-24'
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
              >
                <CustomerVehicleInfo order={order} />
              </motion.div>

              <motion.div
                className='space-y-6'
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut', delay: 0.04 } }}
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
            </div>
          )}
        </motion.div>

        <AnimatePresence>
          {!isCheckoutView && isDockedLayout && activeTaskForPanel && (
            <motion.div
              className='w-[1000px] min-w-[1000px] max-w-[1000px] shrink-0 sticky top-20'
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
              exit={{ opacity: 0, x: 16, transition: { duration: 0.16, ease: 'easeIn' } }}
            >
              <TaskDetailDrawer
                variant='docked'
                workshopOrderId={order.id}
                open={!!activeTaskForPanel}
                onOpenChange={(open) => {
                  if (!open) setActiveTaskId(null)
                }}
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
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isCheckoutView && !isDockedLayout && (
        <TaskDetailDrawer
          variant='drawer'
          workshopOrderId={order.id}
          open={!!activeTaskForPanel}
          onOpenChange={(open) => {
            if (!open) setActiveTaskId(null)
          }}
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
