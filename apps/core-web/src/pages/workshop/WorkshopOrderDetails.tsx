import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Phone, Plus, Printer, FileText } from 'lucide-react'
import { TaskDetailDrawer } from '@/components/workshop/TaskDetailDrawer'

type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'DONE'

interface RepairTask {
  id: string
  title: string
  done: boolean
  status: TaskStatus
}

const mockTasks: RepairTask[] = [
  { id: 't1', title: 'Diagnose brake noise from front axle', done: true, status: 'DONE' },
  { id: 't2', title: 'Replace front brake pads and inspect rotors', done: false, status: 'IN_PROGRESS' },
  { id: 't3', title: 'Bleed brake lines and top-up fluid', done: false, status: 'NOT_STARTED' },
]

export function WorkshopOrderDetails() {
  const [tasks, setTasks] = useState(mockTasks)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null

  function toggleTask(taskId: string, checked: boolean) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? { ...task, done: checked, status: checked ? 'DONE' : 'IN_PROGRESS' }
          : task,
      ),
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6 bg-slate-50">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">#WO-2026-0042</h1>
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-full px-3 py-1 text-xs font-semibold">
            In Progress
          </Badge>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="border-slate-300 text-slate-700">
            <Printer className="h-4 w-4 mr-2" />
            Print Job Card
          </Button>
          <Button className="bg-slate-900 hover:bg-slate-800 text-white">
            <FileText className="h-4 w-4 mr-2" />
            Create Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card className="bg-white border-slate-200 rounded-xl shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-900">Customer Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div>
                <div className="font-medium text-slate-900">Michael Torres</div>
                <div className="text-slate-500">michael.torres@email.com</div>
              </div>
              <div>
                <div className="text-slate-500">Phone</div>
                <div className="font-medium">(555) 238-9012</div>
              </div>
              <Button variant="outline" size="sm" className="h-8 border-slate-300 text-slate-600">
                <Phone className="h-3.5 w-3.5 mr-1.5" />
                Call Customer
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 rounded-xl shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-900">Vehicle Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <div className="font-medium text-slate-900">2021 BMW 330i</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-slate-500">VIN</div>
                  <div className="font-medium">WBA5R1C08MFX72914</div>
                </div>
                <div>
                  <div className="text-slate-500">Plate</div>
                  <div className="font-medium">7SXR193</div>
                </div>
                <div>
                  <div className="text-slate-500">Mileage</div>
                  <div className="font-medium">64,280 mi</div>
                </div>
                <div>
                  <div className="text-slate-500">Color</div>
                  <div className="font-medium">Alpine White</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card className="bg-white border-slate-200 rounded-xl shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-slate-900">Reported Issue</CardTitle>
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border border-red-200 text-xs">
                  High Priority
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-slate-700 leading-relaxed">
              Customer reports squealing noise during braking and vibration in steering wheel at higher speeds. Issue worsened in the last 3 days.
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 rounded-xl shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-slate-900">Repair Tasks</CardTitle>
                <Button variant="outline" size="sm" className="h-8 border-slate-300 text-slate-600">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Task
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setActiveTaskId(task.id)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 text-left">
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={(checked) => toggleTask(task.id, checked === true)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className={`text-sm ${task.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {task.title}
                    </span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 rounded-xl shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-900">Internal Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                className="w-full min-h-28 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Notes visible to service advisors and mechanics..."
                defaultValue="Customer requested call before replacing any additional parts."
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
        task={activeTask}
      />
    </div>
  )
}

export default WorkshopOrderDetails
