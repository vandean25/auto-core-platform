import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Phone, Plus, Printer, FileText } from 'lucide-react'
import { TaskDetailDrawer } from '@/components/workshop/TaskDetailDrawer'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import {
  useCreateInvoiceFromWorkshopOrder,
  useCreateWorkshopTask,
  useReplaceWorkshopTaskLineItems,
  useUpdateWorkshopOrder,
  useUpdateWorkshopTask,
  useWorkshopOrder,
} from '@/api/workshop'
import type { WorkshopLineItemType, WorkshopTask, WorkshopTaskStatus } from '@/api/types'

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
  const { data: order, isLoading } = useWorkshopOrder(id)

  const updateOrder = useUpdateWorkshopOrder()
  const createTask = useCreateWorkshopTask()
  const updateTask = useUpdateWorkshopTask()
  const replaceTaskLineItems = useReplaceWorkshopTaskLineItems()
  const createInvoice = useCreateInvoiceFromWorkshopOrder()

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [draftReportedIssue, setDraftReportedIssue] = useState('')

  const tasks = useMemo<WorkshopTask[]>(() => (order?.tasks ?? []).map((task) => ({
    ...task,
    lineItems: task.lineItems ?? task.line_items ?? [],
    mechanicNotes: task.mechanicNotes ?? task.mechanic_notes ?? '',
  })), [order])

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null
    return tasks.find((task) => task.id === activeTaskId) ?? null
  }, [activeTaskId, tasks])

  useEffect(() => {
    if (!order) return
    setDraftNotes(order.notes || '')
    setDraftReportedIssue(order.reportedIssue || order.reported_issue || '')
  }, [order?.id, order?.notes, order?.reportedIssue, order?.reported_issue])

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

  const handleSaveNotes = async () => {
    const nextNotes = draftNotes
    if (nextNotes === (order.notes ?? '')) return

    try {
      await updateOrder.mutateAsync({ id: order.id, notes: nextNotes })
      toast.success('Internal notes saved')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save notes')
    }
  }

  const handleSaveReportedIssue = async () => {
    const nextIssue = draftReportedIssue
    if (nextIssue === (order.reportedIssue || order.reported_issue || '')) return

    try {
      await updateOrder.mutateAsync({ id: order.id, reportedIssue: nextIssue })
      toast.success('Reported issue saved')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save reported issue')
    }
  }

  const handleAddTask = async () => {
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
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, status })
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update task status')
    }
  }

  const handleTaskMechanicNotesChange = async (taskId: string, notes: string) => {
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, mechanicNotes: notes })
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update mechanic notes')
    }
  }

  const handleTaskLineItemsChange = async (
    taskId: string,
    items: Array<{ type: WorkshopLineItemType; itemNo: string; description: string; qty: number; unitPrice: number }>,
  ) => {
    try {
      await replaceTaskLineItems.mutateAsync({ orderId: order.id, taskId, items })
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update task line items')
    }
  }

  const handleToggleTask = async (taskId: string, checked: boolean) => {
    await handleTaskStatusChange(taskId, checked ? 'DONE' : 'IN_PROGRESS')
  }

  const handleCreateInvoice = async () => {
    if (!canCreateInvoice) {
      toast.error('Invoice can be created only for completed and not-yet-invoiced workshop orders.')
      return
    }

    try {
      const invoice = await createInvoice.mutateAsync(order.id)
      toast.success(`Invoice created (${invoice.invoice_number || invoice.id})`)
      navigate(`/sales/invoices/${invoice.id}`)
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

  return (
    <div className='w-full max-w-7xl mx-auto p-6 space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div className='flex items-center gap-3'>
          <h1 className='text-2xl font-semibold tracking-tight'>#{order.id}</h1>
          <StatusBadge status={order.status} />
        </div>

        <div className='flex gap-2'>
          <Button variant='outline' onClick={handlePrint}>
            <Printer className='h-4 w-4 mr-2' />
            Print Job Card
          </Button>
          <Button onClick={handleCreateInvoice} disabled={!canCreateInvoice || createInvoice.isPending}>
            <FileText className='h-4 w-4 mr-2' />
            {createInvoice.isPending ? 'Creating...' : 'Create Invoice'}
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <div className='space-y-6 lg:col-span-1'>
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
              <div className='grid grid-cols-2 gap-3'>
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
        </div>

        <div className='space-y-6 lg:col-span-2'>
          <Card>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-base font-semibold'>Reported Issue</CardTitle>
                {order.status !== 'COMPLETED' && <Badge variant='destructive'>High Priority</Badge>}
              </div>
            </CardHeader>
            <CardContent className='text-sm leading-relaxed'>
              <textarea
                className='w-full min-h-24 rounded-lg border p-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                placeholder='Customer reported issue...'
                value={draftReportedIssue}
                onChange={(e) => setDraftReportedIssue(e.target.value)}
                onBlur={() => void handleSaveReportedIssue()}
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
                  />
                  <Button variant='outline' size='sm' className='h-8' onClick={() => void handleAddTask()}>
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
                  onClick={() => setActiveTaskId(task.id)}
                  className='w-full border rounded-lg px-3 py-2.5 hover:bg-accent transition-colors'
                >
                  <div className='flex items-center gap-3 text-left'>
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={(checked) => void handleToggleTask(task.id, checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className={`text-sm ${task.done ? 'line-through text-muted-foreground' : ''}`}>
                      {task.title}
                    </span>
                    <span className='ml-auto'>
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
                className='w-full min-h-28 rounded-lg border p-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                placeholder='Notes visible to service advisors and mechanics...'
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                onBlur={() => void handleSaveNotes()}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <TaskDetailDrawer
        open={!!activeTask}
        onOpenChange={(open) => {
          if (!open) setActiveTaskId(null)
        }}
        task={
          activeTask
            ? {
                ...activeTask,
                lineItems: activeTask.lineItems ?? [],
                mechanicNotes: activeTask.mechanicNotes ?? '',
              }
            : null
        }
        onTaskStatusChange={(taskId, status) => void handleTaskStatusChange(taskId, status)}
        onTaskLineItemsChange={(taskId, items) => void handleTaskLineItemsChange(taskId, items)}
        onTaskMechanicNotesChange={(taskId, notes) => void handleTaskMechanicNotesChange(taskId, notes)}
      />
    </div>
  )
}

export default WorkshopOrderDetails
