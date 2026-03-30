import { Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import type { TaskTotals } from '../hooks/useWorkshopCalculations'
import type { WorkshopTask } from '@/api/types'

export interface TaskListProps {
  order: any
  tasks: WorkshopTask[]
  rawTaskTotals: Map<string, TaskTotals>
  isLocked: boolean
  newTaskTitle: string
  onNewTaskTitleChange: (value: string) => void
  onAddTask: () => void
  onToggleTask: (taskId: string, checked: boolean) => void
  onOpenTask: (taskId: string) => void
  onSaveReportedIssue: (value: string) => void
  onSaveNotes: (value: string) => void
}

export function TaskList({
  order,
  tasks,
  rawTaskTotals,
  isLocked,
  newTaskTitle,
  onNewTaskTitleChange,
  onAddTask,
  onToggleTask,
  onOpenTask,
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
            <div
              key={task.id}
              data-workshop-task-row='true'
              onClick={() => onOpenTask(task.id)}
              className='w-full border rounded-lg px-3 py-2.5 hover:bg-accent transition-colors cursor-pointer'
            >
              <div className='flex items-center gap-3 text-left'>
                <Checkbox
                  checked={task.done}
                  onCheckedChange={(checked) => onToggleTask(task.id, checked === true)}
                  disabled={isLocked}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className={`text-sm ${task.done ? 'line-through text-muted-foreground' : ''}`}>
                  {task.title}
                </span>
                <span className='ml-auto flex items-center gap-2'>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2'
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenTask(task.id)
                    }}
                  >
                    Open
                  </Button>
                  <span className='text-sm font-semibold'>{formatCurrency(rawTaskTotals.get(task.id)?.total ?? 0)}</span>
                  <StatusBadge status={task.status} />
                </span>
              </div>
            </div>
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
