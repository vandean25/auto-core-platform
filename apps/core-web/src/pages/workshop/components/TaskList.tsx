import { Plus, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { PICKERL_TASK_TITLE } from '@/features/workshop/pickerl.constants'
import type { WorkshopOrder, WorkshopTask } from '@/api/types'
import { TaskLineItemEditor } from '@/components/workshop/TaskLineItemEditor'
import type { TaskLineItem } from '@/components/workshop/TaskLineItemEditor'
import type { TaskTotals } from '../hooks/useWorkshopCalculations'
import { WorkshopTaskInspectionChecklist } from '@/components/workshop/WorkshopTaskInspectionChecklist'

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
  onOpenFitmentSearch?: (taskId: string) => void
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
  onOpenFitmentSearch,
}: TaskListProps) {
  const { t } = useTranslation('workshop')

  return (
    <>
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <CardTitle className='text-base font-semibold'>{t('taskList.reportedIssue')}</CardTitle>
            {order.status !== 'COMPLETED' && (
              <Badge className='border-rose-200 bg-rose-100 text-rose-800 hover:bg-rose-100'>
                {t('taskList.highPriority')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className='text-sm leading-relaxed'>
          <InlineEdit
            mode='textarea'
            rows={4}
            placeholder={t('taskList.reportedIssuePlaceholder')}
            value={order.reportedIssue || order.reported_issue || ''}
            readOnly={isLocked}
            onSave={onSaveReportedIssue}
            emptyText={t('taskList.reportedIssueEmpty')}
            ariaLabel={t('taskList.reportedIssueAria')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <CardTitle className='text-base font-semibold'>{t('taskList.repairTasks')}</CardTitle>
            <div className='flex w-full items-center gap-2 sm:max-w-md'>
              <Input
                value={newTaskTitle}
                onChange={(e) => onNewTaskTitleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onAddTask()
                  }
                }}
                placeholder={t('taskList.newTaskPlaceholder')}
                className='h-8 min-w-0 flex-1'
                disabled={isLocked}
              />
              <Button
                variant='outline'
                size='sm'
                className='h-8 shrink-0'
                onClick={onAddTask}
                disabled={isLocked}
              >
                <Plus className='h-3.5 w-3.5 mr-1' />
                {t('taskList.addTask')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-2'>
          {tasks.length === 0 && (
            <div className='text-sm text-muted-foreground'>{t('taskList.noTasks')}</div>
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
              onOpenFitmentSearch={onOpenFitmentSearch}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base font-semibold'>{t('taskList.internalNotes')}</CardTitle>
        </CardHeader>
        <CardContent>
          <InlineEdit
            mode='textarea'
            rows={5}
            placeholder={t('taskList.internalNotesPlaceholder')}
            value={order.notes || ''}
            readOnly={isLocked}
            onSave={onSaveNotes}
            emptyText={t('taskList.internalNotesEmpty')}
            ariaLabel={t('taskList.internalNotesAria')}
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
  onOpenFitmentSearch?: (taskId: string) => void
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
  onOpenFitmentSearch,
}: TaskAccordionRowProps) {
  const { t } = useTranslation('workshop')
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
  const feesCount = lineItems.filter((item) => item.type === 'FEE').length
  const laborCount = lineItems.filter((item) => item.type === 'LABOR').length
  const taskTotals = totals ?? {
    parts: 0,
    fees: 0,
    labor: 0,
    total: 0,
    laborStandardHours: 0,
    laborActualHours: 0,
    laborInternalCost: 0,
    hasLaborCostData: false,
  }

  const partsLabel = t('taskList.parts', { count: partsCount })
  const feesLabel = t('taskList.fees', { count: feesCount })
  const laborLabel = t('taskList.labor', { count: laborCount })
  const feesSegment =
    taskTotals.fees > 0
      ? t('taskList.feesSegment', { amount: formatCurrency(taskTotals.fees) })
      : ''

  return (
    <div
      data-workshop-task-row='true'
      className='w-full rounded-lg border transition-colors hover:bg-accent'
    >
      <div className='flex items-start gap-3 px-3 py-2.5'>
        <Checkbox
          checked={task.done}
          onCheckedChange={(checked) => onToggleTask(task.id, checked === true)}
          disabled={isLocked}
          onClick={(event) => event.stopPropagation()}
          aria-label={
            task.done
              ? t('taskList.markIncomplete', { title: task.title })
              : t('taskList.markComplete', { title: task.title })
          }
        />
        <button
          type='button'
          className='flex min-w-0 flex-1 flex-col gap-1 border-0 bg-transparent p-0 text-left'
          aria-expanded={isExpanded}
          onClick={onToggleExpanded}
        >
          <span className='flex w-full items-center gap-3'>
            <span className={`text-sm ${task.done ? 'line-through text-muted-foreground' : ''}`}>
              {task.title}
            </span>
            <span className='ml-auto flex items-center gap-2'>
              <span className='text-sm font-semibold'>{formatCurrency(taskTotals.total)}</span>
              <StatusBadge status={task.status} />
            </span>
          </span>
          <span className='w-full text-xs text-muted-foreground'>
            {t('taskList.taskSummary', {
              parts: partsLabel,
              fees: feesLabel,
              labor: laborLabel,
              partsTotal: formatCurrency(taskTotals.parts),
              feesSegment,
              laborTotal: formatCurrency(taskTotals.labor),
              stdHours: formatNumber(taskTotals.laborStandardHours, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
              actualHours: formatNumber(taskTotals.laborActualHours, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
            })}
          </span>
        </button>
      </div>

      {isExpanded && (
        <div className='space-y-4 border-t px-3 py-4'>
          <div className='flex items-center justify-between gap-3'>
            <div>
              <div className='text-sm font-semibold'>{task.title}</div>
              <div className='mt-1 text-xs text-muted-foreground'>{t('taskList.taskDetails')}</div>
            </div>
            <div className='flex items-center gap-2'>
              {!isLocked && onOpenFitmentSearch && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8'
                  onClick={() => onOpenFitmentSearch(task.id)}
                  data-testid='open-fitment-search-button'
                >
                  <Search className='mr-1.5 h-3.5 w-3.5' />
                  {t('taskList.fitmentSearch')}
                </Button>
              )}
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-8 text-destructive hover:text-destructive'
                onClick={() => onTaskDelete(task.id)}
                disabled={!canDeleteTask || isDeletingTask}
              >
                <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                {t('taskList.deleteTask')}
              </Button>
            </div>
          </div>

          {task.title === PICKERL_TASK_TITLE ? (
            <WorkshopTaskInspectionChecklist
              orderId={workshopOrderId}
              taskId={task.id}
              readOnly={isLocked}
            />
          ) : null}

          <TaskLineItemEditor
            workshopOrderId={workshopOrderId}
            taskId={task.id}
            lineItems={lineItems}
            readOnly={isLocked}
            onLineItemsChange={(items) => onTaskLineItemsChange(task.id, items)}
          />

          <div className='space-y-2'>
            <div className='text-sm font-semibold'>{t('taskList.mechanicNotes')}</div>
            <InlineEdit
              mode='textarea'
              rows={4}
              placeholder={t('taskList.mechanicNotesPlaceholder')}
              value={task.mechanicNotes ?? ''}
              readOnly={isLocked}
              onSave={(notes) => onTaskMechanicNotesChange(task.id, notes)}
              emptyText={t('taskList.mechanicNotesEmpty')}
              ariaLabel={t('taskList.mechanicNotesAria')}
            />
          </div>
        </div>
      )}
    </div>
  )
}
