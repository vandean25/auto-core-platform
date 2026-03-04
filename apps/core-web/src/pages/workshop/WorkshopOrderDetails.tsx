import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Package,
  Phone,
  Plus,
  Printer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Input } from '@/components/ui/input'
import { TaskDetailDrawer } from '@/components/workshop/TaskDetailDrawer'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCreateDraftInvoice, useIssueInvoice } from '@/api/invoices'
import { useInvoice } from '@/api/sales'
import { formatCurrency } from '@/lib/utils'
import {
  useCreateWorkshopTask,
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

const DEFAULT_TAX_RATE = 20
const EMPTY_DISCOUNT_STATE: DiscountState = { type: null, value: '' }

interface DiscountState {
  type: DiscountType | null
  value: string
}

interface CheckoutLineSummary {
  rowKey: string
  taskId: string
  lineItem: WorkshopTaskLineItem
  discount: DiscountState
  baseAmount: number
  discountAmount: number
  lineNet: number
  taxAmount: number
}

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

function buildTaskLineRowKey(taskId: string, lineItemId: string | undefined, index: number) {
  return `${taskId}:${lineItemId ?? `idx-${index}`}`
}

function parseDiscountValue(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function calculateDiscountAmount(baseAmount: number, discount: DiscountState) {
  const parsedValue = parseDiscountValue(discount.value)
  if (!discount.type || parsedValue === null || parsedValue <= 0) return 0
  if (discount.type === 'PERCENTAGE') {
    return Math.min(baseAmount, (baseAmount * parsedValue) / 100)
  }
  return Math.min(baseAmount, parsedValue)
}

export function WorkshopOrderDetails() {
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const { data: order, isLoading } = useWorkshopOrder(id)

  const updateOrder = useUpdateWorkshopOrder()
  const createTask = useCreateWorkshopTask()
  const updateTask = useUpdateWorkshopTask()
  const replaceTaskLineItems = useReplaceWorkshopTaskLineItems()
  const createDraftInvoice = useCreateDraftInvoice()
  const issueInvoice = useIssueInvoice()

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [isCheckoutView, setIsCheckoutView] = useState(false)
  const [expandedTaskGroups, setExpandedTaskGroups] = useState<Record<string, boolean>>({})
  const [taskDiscountOverrides, setTaskDiscountOverrides] = useState<Record<string, string>>({})
  const [lineDiscountOverrides, setLineDiscountOverrides] = useState<Record<string, DiscountState>>({})
  const [checkoutInvoiceIdOverride, setCheckoutInvoiceIdOverride] = useState<string | null>(null)
  const [taskLineItemOverrides, setTaskLineItemOverrides] = useState<Record<string, WorkshopTask['lineItems']>>({})
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

  useEffect(() => {
    if (order?.invoice?.id && checkoutInvoiceIdOverride) {
      setCheckoutInvoiceIdOverride(null)
    }
  }, [checkoutInvoiceIdOverride, order?.invoice?.id])

  const tasks = useMemo<WorkshopTask[]>(() => (order?.tasks ?? []).map((task) => ({
    ...task,
    lineItems: taskLineItemOverrides[task.id] ?? task.lineItems ?? [],
    mechanicNotes: task.mechanicNotes ?? '',
  })), [order, taskLineItemOverrides])

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null
    return tasks.find((task) => task.id === activeTaskId) ?? null
  }, [activeTaskId, tasks])

  const rawTaskTotals = useMemo(() => {
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

  const baseOrderPartsTotal = useMemo(
    () => Array.from(rawTaskTotals.values()).reduce((sum, totals) => sum + totals.parts, 0),
    [rawTaskTotals],
  )
  const baseOrderLaborTotal = useMemo(
    () => Array.from(rawTaskTotals.values()).reduce((sum, totals) => sum + totals.labor, 0),
    [rawTaskTotals],
  )

  const checkoutLineRows = useMemo(() => {
    return tasks.flatMap((task) =>
      (task.lineItems ?? []).map((lineItem, index) => ({
        rowKey: buildTaskLineRowKey(task.id, lineItem.id, index),
        taskId: task.id,
        lineItem,
      })),
    )
  }, [tasks])

  const discountSeedFromInvoice = useMemo(() => {
    const seed: Record<string, DiscountState> = {}
    const invoice = fetchedInvoice
    if (!invoice) return seed

    checkoutLineRows.forEach((lineRow, index) => {
      const invoiceItem = invoice.items[index]
      if (!invoiceItem) return
      seed[lineRow.rowKey] = {
        type: invoiceItem.line_discount_type ?? null,
        value:
          invoiceItem.line_discount_value !== null && invoiceItem.line_discount_value !== undefined
            ? String(invoiceItem.line_discount_value)
            : '',
      }
    })

    return seed
  }, [checkoutLineRows, fetchedInvoice])

  const checkoutLineSummaries = useMemo<CheckoutLineSummary[]>(() => {
    return checkoutLineRows.map(({ rowKey, taskId, lineItem }) => {
      const baseAmount = lineItem.qty * lineItem.unitPrice
      const discount = lineDiscountOverrides[rowKey] ?? discountSeedFromInvoice[rowKey] ?? EMPTY_DISCOUNT_STATE
      const discountAmount = calculateDiscountAmount(baseAmount, discount)
      const lineNet = Math.max(0, baseAmount - discountAmount)
      const taxAmount = lineNet * (DEFAULT_TAX_RATE / 100)
      return {
        rowKey,
        taskId,
        lineItem,
        discount,
        baseAmount,
        discountAmount,
        lineNet,
        taxAmount,
      }
    })
  }, [checkoutLineRows, discountSeedFromInvoice, lineDiscountOverrides])

  const checkoutLineSummaryByRowKey = useMemo(
    () => new Map(checkoutLineSummaries.map((summary) => [summary.rowKey, summary])),
    [checkoutLineSummaries],
  )

  const groupedCheckoutTasks = useMemo(() => {
    return tasks.map((task) => {
      const lines = (task.lineItems ?? [])
        .map((lineItem, index) => {
          const rowKey = buildTaskLineRowKey(task.id, lineItem.id, index)
          return checkoutLineSummaryByRowKey.get(rowKey) ?? null
        })
        .filter((line): line is CheckoutLineSummary => line !== null)

      const subtotal = lines.reduce((sum, line) => sum + line.baseAmount, 0)
      const discountTotal = lines.reduce((sum, line) => sum + line.discountAmount, 0)
      const netTotal = lines.reduce((sum, line) => sum + line.lineNet, 0)

      return {
        task,
        lines,
        subtotal,
        discountTotal,
        netTotal,
      }
    })
  }, [checkoutLineSummaryByRowKey, tasks])

  const checkoutPartsTotal = useMemo(
    () =>
      checkoutLineSummaries
        .filter((line) => line.lineItem.type === 'PART')
        .reduce((sum, line) => sum + line.lineNet, 0),
    [checkoutLineSummaries],
  )
  const checkoutLaborTotal = useMemo(
    () =>
      checkoutLineSummaries
        .filter((line) => line.lineItem.type === 'LABOR')
        .reduce((sum, line) => sum + line.lineNet, 0),
    [checkoutLineSummaries],
  )

  const orderPartsTotal = isCheckoutView ? checkoutPartsTotal : baseOrderPartsTotal
  const orderLaborTotal = isCheckoutView ? checkoutLaborTotal : baseOrderLaborTotal
  const orderGrandTotal = orderPartsTotal + orderLaborTotal

  const checkoutSubtotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, line) => sum + line.baseAmount, 0),
    [checkoutLineSummaries],
  )
  const checkoutDiscountTotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, line) => sum + line.discountAmount, 0),
    [checkoutLineSummaries],
  )
  const checkoutNetTotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, line) => sum + line.lineNet, 0),
    [checkoutLineSummaries],
  )
  const checkoutTaxTotal = useMemo(
    () => checkoutLineSummaries.reduce((sum, line) => sum + line.taxAmount, 0),
    [checkoutLineSummaries],
  )
  const checkoutGrossTotal = checkoutNetTotal + checkoutTaxTotal

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
  const canEnterCheckout = order.status === 'COMPLETED' || !!activeInvoiceId
  const isLocked = order.status === 'INVOICED'
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
    !issueInvoice.isPending
  const invoiceActionLabel = isCheckoutView
    ? 'Close Checkout'
    : activeInvoiceId
      ? 'Open Checkout'
      : 'Generate Invoice'
  const isInvoiceActionDisabled = !isCheckoutView && !canEnterCheckout

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
      const invoice = await issueInvoice.mutateAsync(activeInvoiceId)
      toast.success(`Invoice issued (${invoice.invoice_number || invoice.id})`)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to issue invoice')
    }
  }

  const handlePrint = () => {
    const previousTitle = document.title
    document.title = `Job Card ${order.id}`
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

  const reportedIssueCard = (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-base font-semibold'>Reported Issue</CardTitle>
          {order.status !== 'COMPLETED' && <Badge variant='destructive'>High Priority</Badge>}
        </div>
      </CardHeader>
      <CardContent className='text-sm leading-relaxed'>
        <InlineEdit
          mode='textarea'
          rows={4}
          placeholder='Customer reported issue...'
          value={order.reportedIssue || order.reported_issue || ''}
          readOnly={isLocked}
          onSave={handleSaveReportedIssue}
          emptyText='Add reported issue'
          ariaLabel='Workshop order reported issue'
        />
      </CardContent>
    </Card>
  )

  const customerInfoCard = (
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
  )

  const vehicleInfoCard = (
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
  )

  const internalNotesCard = (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='text-base font-semibold'>Internal Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <InlineEdit
          mode='textarea'
          rows={5}
          placeholder='Notes visible to service advisors and mechanics...'
          value={order.notes || ''}
          readOnly={isLocked}
          onSave={handleSaveNotes}
          emptyText='Add internal notes'
          ariaLabel='Workshop internal notes'
        />
      </CardContent>
    </Card>
  )

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
                    <Button onClick={handleCheckoutAction} disabled={isInvoiceActionDisabled}>
                      <FileText className='h-4 w-4 mr-2' />
                      {invoiceActionLabel}
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

          {!isCheckoutView && (
            <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
              <motion.div
                className='space-y-6 lg:col-span-1'
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
              >
                {customerInfoCard}
                {vehicleInfoCard}
              </motion.div>

              <motion.div
                className='space-y-6 lg:col-span-2'
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut', delay: 0.04 } }}
              >
                {reportedIssueCard}

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
                            <span className='text-sm font-semibold'>{formatCurrency(rawTaskTotals.get(task.id)?.total ?? 0)}</span>
                            <StatusBadge status={task.status} />
                          </span>
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>

                {internalNotesCard}
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
                {customerInfoCard}
                {vehicleInfoCard}
              </motion.div>

              <motion.div
                className='space-y-6'
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut', delay: 0.04 } }}
              >
                <Card className='border-primary/20'>
                  <CardHeader className='pb-3'>
                    <div className='flex items-center justify-between gap-3'>
                      <div>
                        <CardTitle className='text-base font-semibold'>Draft Invoice</CardTitle>
                        <p className='text-xs text-muted-foreground mt-1'>
                          Grouped by task. Use task-level discount (%) to cascade to every nested line.
                        </p>
                      </div>
                      <div className='flex items-center gap-2'>
                        {activeInvoiceId && (
                          <span className='text-xs text-muted-foreground'>
                            Invoice: {fetchedInvoice?.invoice_number || activeInvoiceId}
                          </span>
                        )}
                        {canCreateDraftInCheckout && (
                          <Button size='sm' onClick={() => void handleCreateDraftInCheckout()}>
                            {createDraftInvoice.isPending ? 'Creating Draft...' : 'Create Draft Invoice'}
                          </Button>
                        )}
                        {canIssueInvoiceInCheckout && (
                          <Button size='sm' onClick={() => void handleIssueInvoiceInCheckout()}>
                            {issueInvoice.isPending ? 'Issuing...' : 'Issue Invoice'}
                          </Button>
                        )}
                        {activeInvoiceId && isInvoiceLoading && (
                          <span className='text-xs text-muted-foreground'>Loading invoice...</span>
                        )}
                        <Button variant='outline' size='sm' onClick={() => setIsCheckoutView(false)}>
                          Return to Tasks
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='rounded-xl border overflow-hidden'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className='text-right w-[90px]'>Qty</TableHead>
                            <TableHead className='text-right w-[140px]'>Unit Price</TableHead>
                            <TableHead className='text-right w-[260px]'>Discount</TableHead>
                            <TableHead className='text-right w-[160px]'>Net</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {groupedCheckoutTasks.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className='text-center text-sm text-muted-foreground py-6'>
                                No billable lines found in tasks.
                              </TableCell>
                            </TableRow>
                          )}
                          {groupedCheckoutTasks.map(({ task, lines, discountTotal, netTotal }) => {
                            const taskDiscountPercent = taskDiscountOverrides[task.id] ?? ''
                            const isExpanded = expandedTaskGroups[task.id] === true
                            return (
                              <Fragment key={task.id}>
                                <TableRow className='bg-muted/40'>
                                  <TableCell colSpan={2}>
                                    <div className='flex items-center justify-between gap-2'>
                                      <button
                                        type='button'
                                        className='flex items-center gap-2 text-left'
                                        onClick={() => handleToggleGroup(task.id)}
                                      >
                                        {isExpanded ? (
                                          <ChevronDown className='h-4 w-4 text-muted-foreground' />
                                        ) : (
                                          <ChevronRight className='h-4 w-4 text-muted-foreground' />
                                        )}
                                        <span className='font-semibold'>{task.title}</span>
                                      </button>
                                      {!isLocked && (
                                        <Button
                                          variant='ghost'
                                          size='sm'
                                          className='h-7 px-2'
                                          onClick={() => {
                                            setIsCheckoutView(false)
                                            setActiveTaskId(task.id)
                                          }}
                                        >
                                          Reopen Task
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className='text-right font-semibold'>
                                    {formatCurrency(netTotal)}
                                  </TableCell>
                                  <TableCell>
                                    <div className='flex justify-end'>
                                      <div className='flex items-center gap-2'>
                                        <span className='text-[11px] text-muted-foreground whitespace-nowrap'>Discount Whole Task (%)</span>
                                        <Input
                                          value={taskDiscountPercent}
                                          onChange={(e) => handleTaskDiscountValueChange(task.id, e.target.value)}
                                          className='h-8 w-[110px] text-right'
                                          inputMode='decimal'
                                          placeholder='0'
                                          disabled={isLocked || lines.length === 0}
                                        />
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className='text-right text-sm font-medium text-muted-foreground'>
                                    -{formatCurrency(discountTotal)}
                                  </TableCell>
                                </TableRow>

                                {isExpanded && lines.map((line) => (
                                  <TableRow key={line.rowKey}>
                                    <TableCell>
                                      <div className='text-sm font-medium'>{line.lineItem.description}</div>
                                      <div className='text-xs text-muted-foreground'>
                                        {line.lineItem.type} • {line.lineItem.itemNo || 'N/A'}
                                      </div>
                                    </TableCell>
                                    <TableCell className='text-right'>{line.lineItem.qty}</TableCell>
                                    <TableCell className='text-right'>
                                      {formatCurrency(line.lineItem.unitPrice)}
                                    </TableCell>
                                    <TableCell>
                                      <div className='flex justify-end gap-2'>
                                        <Select
                                          value={line.discount.type ?? 'NONE'}
                                          onValueChange={(value) => handleLineDiscountTypeChange(line.rowKey, value)}
                                          disabled={isLocked}
                                        >
                                          <SelectTrigger className='h-8 w-[110px] text-xs'>
                                            <SelectValue placeholder='No discount' />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value='NONE'>None</SelectItem>
                                            <SelectItem value='PERCENTAGE'>%</SelectItem>
                                            <SelectItem value='FLAT_AMOUNT'>EUR</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      <Input
                                        value={line.discount.value}
                                        onChange={(e) => handleLineDiscountValueChange(line.rowKey, e.target.value)}
                                        className='h-8 w-[110px] text-right'
                                        inputMode='decimal'
                                        placeholder='0'
                                        disabled={isLocked}
                                      />
                                    </div>
                                  </TableCell>
                                  <TableCell className='text-right font-medium'>
                                    {formatCurrency(line.lineNet)}
                                  </TableCell>
                                </TableRow>
                                ))}
                              </Fragment>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    <div className='flex justify-end'>
                      <div className='w-full max-w-md rounded-xl border bg-muted/20 p-4 space-y-2'>
                        <div className='flex items-center justify-between text-sm'>
                          <span className='text-muted-foreground'>Subtotal</span>
                          <span>{formatCurrency(checkoutSubtotal)}</span>
                        </div>
                        <div className='flex items-center justify-between text-sm'>
                          <span className='text-muted-foreground'>Total Discounts</span>
                          <span>-{formatCurrency(checkoutDiscountTotal)}</span>
                        </div>
                        <div className='flex items-center justify-between text-sm'>
                          <span className='text-muted-foreground'>Net</span>
                          <span>{formatCurrency(checkoutNetTotal)}</span>
                        </div>
                        <div className='flex items-center justify-between text-sm'>
                          <span className='text-muted-foreground'>VAT ({DEFAULT_TAX_RATE}%)</span>
                          <span>{formatCurrency(checkoutTaxTotal)}</span>
                        </div>
                        <div className='border-t pt-2 mt-2 flex items-center justify-between text-sm font-semibold'>
                          <span>Total</span>
                          <span>{formatCurrency(checkoutGrossTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
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
          readOnly={isLocked}
        />
      )}
    </div>
  )
}

export default WorkshopOrderDetails
