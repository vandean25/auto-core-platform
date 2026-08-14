import { Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import type { WorkshopOrder, WorkshopTask } from '@/api/types'
import { TaskLineItemEditor } from '@/components/workshop/TaskLineItemEditor'
import type { TaskLineItem } from '@/components/workshop/TaskLineItemEditor'
import type { TaskTotals } from '../hooks/useWorkshopCalculations'

type WorkshopOrderWithLegacyReportedIssue = WorkshopOrder & { reported_issue?: string | null }

export interface TaskListProps {
  order: WorkshopOrderWithLegacyReportedIssue
  tasks: WorkshopTask[]
  rawTaskTotals: Map<string, TaskTotals>
  isLocked: boolean
  newTaskTitle: string
  expandedTaskId: string | null
  onNewTaskTitleChange: (value: string) => void
  onAddTask: () => void
  onToggleTask: (taskId: string, checked: boolean) => void
  onExpandedTaskIdChange: (taskId: string | null) => void
  onTaskLineItemsChange: (taskId: string, items: TaskLineItem[]) => void
  onTaskMechanicNotesChange: (taskId: string, notes: string) => void
  onTaskDelete: (taskId: string) => void
  canDeleteTask: boolean
  isDeletingTask: boolean
  onSaveReportedIssue: (value: string) => void
  onSaveNotes: (value: string) => void
}

export function TaskList({
  order,
  tasks,
  rawTaskTotals,
  isLocked,
  newTaskTitle,
  expandedTaskId,
  onNewTaskTitleChange,
  onAddTask,
  onToggleTask,
  onExpandedTaskIdChange,
  onTaskLineItemsChange,
  onTaskMechanicNotesChange,
  onTaskDelete,
  canDeleteTask,
  isDeletingTask,
  onSaveReportedIssue,
  onSaveNotes,
}: TaskListProps) {
  return (
    <>
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
            onSave={onSaveReportedIssue}
            emptyText='Add reported issue'
            ariaLabel='Workshop order reported issue'
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
                onChange={(e) => onNewTaskTitleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onAddTask()
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
                onClick={onAddTask}
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
            <TaskAccordionRow
              key={task.id}
              task={task}
              workshopOrderId={order.id}
              totals={rawTaskTotals.get(task.id)}
              isExpanded={expandedTaskId === task.id}
              isLocked={isLocked}
              onToggleTask={onToggleTask}
              onToggleExpanded={() =>
                onExpandedTaskIdChange(expandedTaskId === task.id ? null : task.id)
              }
              onTaskLineItemsChange={onTaskLineItemsChange}
              onTaskMechanicNotesChange={onTaskMechanicNotesChange}
              onTaskDelete={onTaskDelete}
              canDeleteTask={canDeleteTask}
              isDeletingTask={isDeletingTask}
            />
          ))}
        </CardContent>
      </Card>

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
            onSave={onSaveNotes}
            emptyText='Add internal notes'
            ariaLabel='Workshop internal notes'
          />
        </CardContent>
      </Card>
    </>
  )
}

interface TaskAccordionRowProps {
  task: WorkshopTask
  workshopOrderId: string
  totals: TaskTotals | undefined
  isExpanded: boolean
  isLocked: boolean
  onToggleTask: (taskId: string, checked: boolean) => void
  onToggleExpanded: () => void
  onTaskLineItemsChange: (taskId: string, items: TaskLineItem[]) => void
  onTaskMechanicNotesChange: (taskId: string, notes: string) => void
  onTaskDelete: (taskId: string) => void
  canDeleteTask: boolean
  isDeletingTask: boolean
}

function TaskAccordionRow({
  task,
  workshopOrderId,
  totals,
  isExpanded,
  isLocked,
  onToggleTask,
  onToggleExpanded,
  onTaskLineItemsChange,
  onTaskMechanicNotesChange,
  onTaskDelete,
  canDeleteTask,
  isDeletingTask,
}: TaskAccordionRowProps) {
  const lineItems: TaskLineItem[] = (task.lineItems ?? []).map((item, index) => ({
    id: item.id ?? `tmp-${task.id}-${index}`,
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
  const partsCount = lineItems.filter((item) => item.type === 'PART').length
  const laborCount = lineItems.filter((item) => item.type === 'LABOR').length
  const taskTotals = totals ?? {
    parts: 0,
    labor: 0,
    total: 0,
    laborStandardHours: 0,
    laborActualHours: 0,
    laborInternalCost: 0,
    hasLaborCostData: false,
  }

  return (
    <div
      data-workshop-task-row='true'
      className='w-full rounded-lg border transition-colors hover:bg-accent'
      onClick={onToggleExpanded}
    >
      <div className='flex items-center gap-3 px-3 py-2.5 text-left'>
        <Checkbox
          checked={task.done}
          onCheckedChange={(checked) => onToggleTask(task.id, checked === true)}
          disabled={isLocked}
          onClick={(event) => event.stopPropagation()}
        />
        <span className={`text-sm ${task.done ? 'line-through text-muted-foreground' : ''}`}>
          {task.title}
        </span>
        <span className='ml-auto flex items-center gap-2'>
          <span className='text-sm font-semibold'>{formatCurrency(taskTotals.total)}</span>
          <StatusBadge status={task.status} />
        </span>
      </div>
      <div className='px-3 pb-2.5 pl-10 text-xs text-muted-foreground'>
        {partsCount} {partsCount === 1 ? 'part' : 'parts'} · {laborCount}{' '}
        {laborCount === 1 ? 'labor line' : 'labor lines'} · Parts{' '}
        {formatCurrency(taskTotals.parts)} · Labor {formatCurrency(taskTotals.labor)} · Std{' '}
        {taskTotals.laborStandardHours.toFixed(2)}h · Actual{' '}
        {taskTotals.laborActualHours.toFixed(2)}h
      </div>

      {isExpanded && (
        <div
          className='space-y-4 border-t px-3 py-4'
          onClick={(event) => event.stopPropagation()}
        >
          <div className='flex items-center justify-between gap-3'>
            <div>
              <div className='text-sm font-semibold'>{task.title}</div>
              <div className='mt-1 text-xs text-muted-foreground'>Task details and estimate lines</div>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-8 text-destructive hover:text-destructive'
              onClick={() => onTaskDelete(task.id)}
              disabled={!canDeleteTask || isDeletingTask}
            >
              <Trash2 className='mr-1.5 h-3.5 w-3.5' />
              Delete task
            </Button>
          </div>

          <TaskLineItemEditor
            workshopOrderId={workshopOrderId}
            taskId={task.id}
            lineItems={lineItems}
            readOnly={isLocked}
            onLineItemsChange={(items) => onTaskLineItemsChange(task.id, items)}
          />

          <div className='space-y-2'>
            <div className='text-sm font-semibold'>Mechanic Notes</div>
            <InlineEdit
              mode='textarea'
              rows={4}
              placeholder='Mechanic observations, measurements, and service notes...'
              value={task.mechanicNotes ?? ''}
              readOnly={isLocked}
              onSave={(notes) => onTaskMechanicNotesChange(task.id, notes)}
              emptyText='Add mechanic notes'
              ariaLabel='Mechanic notes'
            />
          </div>
        </div>
      )}
    </div>
  )
}
