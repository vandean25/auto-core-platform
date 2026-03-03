import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { CircleDollarSign, Clock3, Package, Phone, Plus, Printer, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { TaskDetailDrawer } from '@/components/workshop/TaskDetailDrawer'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { InvoiceDrawer } from '@/components/invoices/InvoiceDrawer'
import { useCreateDraftInvoice } from '@/api/invoices'
import { formatCurrency } from '@/lib/utils'
import {
  useCreateWorkshopTask,
  useReplaceWorkshopTaskLineItems,
  useUpdateWorkshopOrder,
  useUpdateWorkshopTask,
  useWorkshopOrder,
} from '@/api/workshop'
import type { WorkshopLineItemType, WorkshopTask, WorkshopTaskLineItem, WorkshopTaskStatus } from '@/api/types'

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, '')
}

function getCustomerName(order: any) {
  if (order.customer.type === 'COMPANY' && order.customer.company_name) {
    return order.customer.company_name
  }
  return `${order.customer.first_name} ${order.customer.last_name}`.trim()
}

function getVehicleLabel(order: any) {
  return `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`
}

export function WorkshopOrderDetails() {
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const { data: order, isLoading, refetch } = useWorkshopOrder(id)

  const updateOrder = useUpdateWorkshopOrder()
  const createTask = useCreateWorkshopTask()
  const updateTask = useUpdateWorkshopTask()
  const replaceTaskLineItems = useReplaceWorkshopTaskLineItems()
  const createDraftInvoice = useCreateDraftInvoice()

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [invoiceDrawerOpen, setInvoiceDrawerOpen] = useState(false)
  const [taskLineItemOverrides, setTaskLineItemOverrides] = useState<Record<string, WorkshopTask['lineItems']>>({})
  const lineItemSaveSeq = useRef<Record<string, number>>({})
  const [isDockedLayout, setIsDockedLayout] = useState(
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 1536px)').matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(min-width: 1536px)')
    const update = () => setIsDockedLayout(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  const tasks = useMemo<WorkshopTask[]>(() => (order?.tasks ?? []).map((task) => ({
    ...task,
    lineItems: taskLineItemOverrides[task.id] ?? task.lineItems ?? [],
    mechanicNotes: task.mechanicNotes ?? '',
  })), [order, taskLineItemOverrides])

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null
    return tasks.find((task) => task.id === activeTaskId) ?? null
  }, [activeTaskId, tasks])
  const taskTotals = useMemo(() => {
    return new Map(
      tasks.map((task) => {
        const lineItems = task.lineItems ?? []
        const parts = lineItems
          .filter((lineItem) => lineItem.type === 'PART')
          .reduce((sum, lineItem) => sum + lineItem.qty * lineItem.unitPrice, 0)
        const labor = lineItems
          .filter((lineItem) => lineItem.type === 'LABOR')
          .reduce((sum, lineItem) => sum + lineItem.qty * lineItem.unitPrice, 0)
        return [task.id, { parts, labor, total: parts + labor }]
      }),
    )
  }, [tasks])
  const orderPartsTotal = useMemo(
    () => Array.from(taskTotals.values()).reduce((sum, totals) => sum + totals.parts, 0),
    [taskTotals],
  )
  const orderLaborTotal = useMemo(
    () => Array.from(taskTotals.values()).reduce((sum, totals) => sum + totals.labor, 0),
    [taskTotals],
  )
  const orderGrandTotal = orderPartsTotal + orderLaborTotal

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

  const customerName = getCustomerName(order)
  const customerPhone = order.customer.phone ?? ''
  const canCreateInvoice = order.status === 'COMPLETED' && !order.invoice
  const isLocked = order.status === 'INVOICED'
  const activeInvoiceId = order.invoice?.id ?? null
  const invoiceActionLabel = activeInvoiceId ? 'View Invoice' : 'Generate Invoice'
  const isInvoiceActionDisabled =
    (!activeInvoiceId && !canCreateInvoice) || createDraftInvoice.isPending

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

  const handleCreateInvoice = async () => {
    if (activeInvoiceId) {
      setInvoiceDrawerOpen(true)
      return
    }
    if (!canCreateInvoice) {
      toast.error('Invoice can be created only for completed and not-yet-invoiced workshop orders.')
      return
    }

    try {
      const invoice = await createDraftInvoice.mutateAsync(order.id)
      await refetch()
      setInvoiceDrawerOpen(true)
      toast.success(`Invoice created (${invoice.invoice_number || invoice.id})`)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create invoice')
    }
  }

  const handlePrint = () => {
    const previousTitle = document.title
    document.title = `Job Card ${order.id}`
    window.print()
    document.title = previousTitle
  }
  const activeTaskForPanel = activeTask
    ? {
        ...activeTask,
        lineItems: activeTask.lineItems ?? [],
        mechanicNotes: activeTask.mechanicNotes ?? '',
      }
    : null

  return (
    <div
      className={`w-full space-y-6 transition-[max-width,padding,margin] duration-250 ${
        isDockedLayout && activeTaskForPanel
          ? 'max-w-[1800px] px-4 2xl:px-6 py-6 mx-auto'
          : 'max-w-7xl px-6 py-6 mx-auto'
      }`}
    >
      <div className='2xl:flex 2xl:items-start 2xl:justify-start 2xl:gap-4'>
        <motion.div
          className={`w-full min-w-0 space-y-6 2xl:min-w-[960px] 2xl:flex-1 transition-transform duration-250 ${
            isDockedLayout && activeTask ? '2xl:-translate-x-3' : '2xl:translate-x-0'
          }`}
        >
          <Card className='mb-8'>
            <CardContent className='p-4 sm:p-5'>
              <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                <div className='space-y-3'>
                  <div className='flex items-center gap-3'>
                    <h1 className='text-2xl font-semibold tracking-tight'>#{order.id}</h1>
                    <StatusBadge status={order.status} />
                  </div>

                  <div className='flex flex-wrap gap-2'>
                    <Button variant='outline' onClick={handlePrint}>
                      <Printer className='h-4 w-4 mr-2' />
                      Print Job Card
                    </Button>
                    <Button onClick={handleCreateInvoice} disabled={isInvoiceActionDisabled}>
                      <FileText className='h-4 w-4 mr-2' />
                      {createDraftInvoice.isPending ? 'Creating...' : invoiceActionLabel}
                    </Button>
                  </div>
                </div>

                <div className='w-full lg:w-auto lg:pl-4'>
                  <div className='grid grid-cols-1 sm:grid-cols-3 gap-2 lg:min-w-[460px]'>
                    <div className='rounded-xl border bg-muted/40 px-3 py-2'>
                      <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                        <Package className='h-3.5 w-3.5' />
                        <span>Total Parts</span>
                      </div>
                      <div className='mt-1 text-sm font-medium'>{formatCurrency(orderPartsTotal)}</div>
                    </div>
                    <div className='rounded-xl border bg-muted/40 px-3 py-2'>
                      <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                        <Clock3 className='h-3.5 w-3.5' />
                        <span>Total Labor</span>
                      </div>
                      <div className='mt-1 text-sm font-medium'>{formatCurrency(orderLaborTotal)}</div>
                    </div>
                    <div className='rounded-xl border border-primary/20 bg-primary/10 px-3 py-2'>
                      <div className='flex items-center gap-1.5 text-[11px] text-primary/80'>
                        <CircleDollarSign className='h-3.5 w-3.5' />
                        <span>Grand Total</span>
                      </div>
                      <div className='mt-1 text-sm font-semibold text-primary'>{formatCurrency(orderGrandTotal)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
            <motion.div
              className='space-y-6 lg:col-span-1'
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
            >
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base font-semibold'>Customer Info</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              <div>
                <div className='font-medium'>{customerName}</div>
                <div className='text-muted-foreground'>{order.customer.email}</div>
              </div>
              <div>
                <div className='text-muted-foreground'>Phone</div>
                <div className='font-medium'>{customerPhone || 'N/A'}</div>
              </div>
              {customerPhone && (
                <Button variant='outline' size='sm' className='h-8' asChild>
                  <a href={`tel:${normalizePhone(customerPhone)}`}>
                    <Phone className='h-3.5 w-3.5 mr-1.5' />
                    Call Customer
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base font-semibold'>Vehicle Info</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              <div className='font-medium'>{getVehicleLabel(order)}</div>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div>
                  <div className='text-muted-foreground'>VIN</div>
                  <div className='font-medium'>{order.vehicle.vin || 'N/A'}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>Plate</div>
                  <div className='font-medium'>{order.vehicle.plate || 'N/A'}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>Mileage</div>
                  <div className='font-medium'>{order.odometer.toLocaleString()} km</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>Fuel</div>
                  <div className='font-medium'>{order.fuel_level}%</div>
                </div>
              </div>
            </CardContent>
          </Card>
            </motion.div>

            <motion.div
              className='space-y-6 lg:col-span-2'
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut', delay: 0.04 } }}
            >
          <Card>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-base font-semibold'>Reported Issue</CardTitle>
                {order.status !== 'COMPLETED' && <Badge variant='destructive'>High Priority</Badge>}
              </div>
            </CardHeader>
            <CardContent className='text-sm leading-relaxed'>
            <textarea
                className='w-full min-h-24 rounded-lg border p-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/40'
                placeholder='Customer reported issue...'
                defaultValue={order.reportedIssue || order.reported_issue || ''}
                key={`reported-issue-${order.id}-${order.reportedIssue || order.reported_issue || ''}`}
                readOnly={isLocked}
                onBlur={(e) => void handleSaveReportedIssue(e.currentTarget.value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between gap-3'>
                <CardTitle className='text-base font-semibold'>Repair Tasks</CardTitle>
                <div className='flex items-center gap-2 w-full max-w-md'>
                  <Input
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleAddTask()
                      }
                    }}
                    placeholder='New task title...'
                    className='h-8'
                    disabled={isLocked}
                  />
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-8'
                    onClick={() => void handleAddTask()}
                    disabled={isLocked}
                  >
                    <Plus className='h-3.5 w-3.5 mr-1' />
                    Task
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className='space-y-2'>
              {tasks.length === 0 && (
                <div className='text-sm text-muted-foreground'>No tasks yet. Add the first task to begin work.</div>
              )}
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type='button'
                  data-workshop-task-row='true'
                  onClick={() => setActiveTaskId(task.id)}
                  className='w-full border rounded-lg px-3 py-2.5 hover:bg-accent transition-colors'
                >
                  <div className='flex items-center gap-3 text-left'>
                  <Checkbox
                    checked={task.done}
                    onCheckedChange={(checked) => void handleToggleTask(task.id, checked === true)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={isLocked}
                  />
                    <span className={`text-sm ${task.done ? 'line-through text-muted-foreground' : ''}`}>
                      {task.title}
                    </span>
                    <span className='ml-auto flex items-center gap-2'>
                      <span className='text-sm font-semibold'>{formatCurrency(taskTotals.get(task.id)?.total ?? 0)}</span>
                      <StatusBadge status={task.status} />
                    </span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base font-semibold'>Internal Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                className='w-full min-h-28 rounded-lg border p-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/40'
                placeholder='Notes visible to service advisors and mechanics...'
                defaultValue={order.notes || ''}
                key={`notes-${order.id}-${order.notes || ''}`}
                readOnly={isLocked}
                onBlur={(e) => void handleSaveNotes(e.currentTarget.value)}
              />
            </CardContent>
          </Card>
            </motion.div>
          </div>
        </motion.div>

        <AnimatePresence>
          {isDockedLayout && activeTaskForPanel && (
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
                readOnly={isLocked}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isDockedLayout && (
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
          readOnly={isLocked}
        />
      )}

      <InvoiceDrawer
        open={invoiceDrawerOpen}
        onOpenChange={setInvoiceDrawerOpen}
        invoiceId={activeInvoiceId}
        orderId={order.id}
      />
    </div>
  )
}

export default WorkshopOrderDetails
