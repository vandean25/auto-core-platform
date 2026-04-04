import { Plus, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import type { TaskTotals } from '../hooks/useWorkshopCalculations'
import type { WorkshopTask } from '@/api/types'

export interface TaskListProps {
  order: any
  tasks: WorkshopTask[]
  rawTaskTotals: Map<string, TaskTotals>
  isLocked: boolean
  newTaskTitle: string
  activeTaskId: string | null
  onNewTaskTitleChange: (value: string) => void
  onAddTask: () => void
  onToggleTask: (taskId: string, checked: boolean) => void
  onOpenTask: (taskId: string) => void
}

export function TaskList({
  order: _order,
  tasks,
  rawTaskTotals,
  isLocked,
  newTaskTitle,
  activeTaskId,
  onNewTaskTitleChange,
  onAddTask,
  onToggleTask,
  onOpenTask,
}: TaskListProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-base font-semibold">Repair Tasks</CardTitle>
          <div className="flex items-center gap-2 flex-1 max-w-md min-w-[200px]">
            <Input
              value={newTaskTitle}
              onChange={(e) => onNewTaskTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onAddTask()
                }
              }}
              placeholder="Add new task..."
              className="h-9"
              disabled={isLocked}
            />
            <Button
              variant="default"
              size="sm"
              className="h-9 shrink-0"
              onClick={onAddTask}
              disabled={isLocked || !newTaskTitle.trim()}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {tasks.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <div className="text-sm">No tasks yet</div>
            <div className="text-xs mt-1">Add your first task to begin work on this order</div>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const isActive = activeTaskId === task.id
              const taskTotal = rawTaskTotals.get(task.id)?.total ?? 0
              const hasLineItems = (rawTaskTotals.get(task.id)?.labor ?? 0) + (rawTaskTotals.get(task.id)?.parts ?? 0) > 0

              return (
                <div
                  key={task.id}
                  data-workshop-task-row="true"
                  onClick={() => onOpenTask(task.id)}
                  className={`
                    w-full border rounded-xl px-4 py-3 cursor-pointer
                    transition-all duration-200
                    ${isActive 
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20' 
                      : 'hover:bg-accent hover:border-accent-foreground/20'
                    }
                  `}
                >
                  <div className="flex items-center gap-4">
                    {/* Checkbox */}
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={(checked) => onToggleTask(task.id, checked === true)}
                      disabled={isLocked}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />

                    {/* Task info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium truncate ${task.done ? 'line-through text-muted-foreground' : ''}`}>
                          {task.title}
                        </span>
                      </div>
                      {hasLineItems && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {task.lineItems?.length ?? 0} line items
                        </div>
                      )}
                    </div>

                    {/* Right side: price, status, arrow */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCurrency(taskTotal)}
                      </span>
                      <StatusBadge status={task.status} />
                      <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isActive ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
