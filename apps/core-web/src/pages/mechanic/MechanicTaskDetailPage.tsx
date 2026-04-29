import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, CheckCircle, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status/StatusBadge'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  useMechanicTaskDetail,
  useStartTask,
  usePauseTask,
  useCompleteTask,
} from '@/api/mechanic'
import type { PauseTaskPayload } from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'

const MECHANIC_ID_KEY = 'acp:mechanic-id'

function readStoredMechanicId(): string {
  try {
    return window.localStorage.getItem(MECHANIC_ID_KEY) ?? ''
  } catch {
    return ''
  }
}

type PauseReason = PauseTaskPayload['pauseReason']

const PAUSE_REASON_LABELS: Record<PauseReason, string> = {
  WAITING_PARTS: 'Waiting for Parts',
  WAITING_CUSTOMER: 'Waiting for Customer',
  OTHER: 'Other',
}

export default function MechanicTaskDetailPage() {
  const navigate = useNavigate()
  const { taskId = '' } = useParams<{ taskId: string }>()
  const [searchParams] = useSearchParams()
  const mechanicId = searchParams.get('mechanicId') ?? readStoredMechanicId()

  const { data: task, isLoading } = useMechanicTaskDetail(mechanicId, taskId)
  const startTask = useStartTask()
  const pauseTask = usePauseTask()
  const completeTask = useCompleteTask()

  const [pauseDialogOpen, setPauseDialogOpen] = useState(false)
  const [selectedPauseReason, setSelectedPauseReason] = useState<PauseReason>('WAITING_PARTS')

  const isActive = task?.taskStatus === 'IN_PROGRESS'
  const isNotStarted = task?.taskStatus === 'NOT_STARTED'
  const isPaused =
    task?.taskStatus === 'PAUSED' ||
    task?.taskStatus === 'WAITING_PARTS' ||
    task?.taskStatus === 'WAITING_CUSTOMER'
  const isDone = task?.taskStatus === 'DONE'

  const canStart = isNotStarted || isPaused
  const canPause = isActive
  const canComplete = isActive

  const handleStart = async () => {
    try {
      await startTask.mutateAsync({ mechanicId, taskId })
      toast.success('Task started — punch-in recorded')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to start task'))
    }
  }

  const handlePauseConfirm = async () => {
    try {
      await pauseTask.mutateAsync({
        mechanicId,
        taskId,
        payload: { pauseReason: selectedPauseReason },
      })
      toast.success('Task paused')
      setPauseDialogOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to pause task'))
    }
  }

  const handleComplete = async () => {
    try {
      await completeTask.mutateAsync({ mechanicId, taskId })
      toast.success('Task marked as complete')
      navigate(`/mechanic/queue?mechanicId=${encodeURIComponent(mechanicId)}`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to complete task'))
    }
  }

  if (!mechanicId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-slate-500">No mechanic selected.</p>
        <Button variant="outline" onClick={() => navigate('/mechanic/queue')}>
          Go to Queue
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500">Loading task…</p>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-slate-500">Task not found or access denied.</p>
        <Button
          variant="outline"
          onClick={() =>
            navigate(`/mechanic/queue?mechanicId=${encodeURIComponent(mechanicId)}`)
          }
        >
          Back to Queue
        </Button>
      </div>
    )
  }

  const { vehicle, bay, lineItems, scheduledDate, reportedComplaint, mechanicNotes } = task
  const laborItems = lineItems.filter((li) => li.type === 'LABOR')
  const partItems = lineItems.filter((li) => li.type === 'PART')

  return (
    <div className="w-full max-w-3xl mx-auto p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5 shrink-0"
            onClick={() =>
              navigate(`/mechanic/queue?mechanicId=${encodeURIComponent(mechanicId)}`)
            }
            aria-label="Back to queue"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight">{task.taskTitle}</h1>
              <StatusBadge status={task.taskStatus} />
            </div>
            <p className="text-slate-500 text-sm mt-0.5">Order {task.orderNumber}</p>
          </div>
        </div>

        {/* ── Primary Actions ── */}
        {!isDone && (
          <div className="flex shrink-0 items-center gap-2">
            {canStart && (
              <Button
                onClick={() => void handleStart()}
                disabled={startTask.isPending}
                className="min-h-[44px] min-w-[96px] gap-2"
              >
                <Play className="h-4 w-4" />
                {isNotStarted ? 'Start' : 'Resume'}
              </Button>
            )}
            {canPause && (
              <Button
                variant="outline"
                onClick={() => setPauseDialogOpen(true)}
                disabled={pauseTask.isPending}
                className="min-h-[44px] gap-2"
              >
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            )}
            {canComplete && (
              <Button
                variant="outline"
                onClick={() => void handleComplete()}
                disabled={completeTask.isPending}
                className="min-h-[44px] gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                <CheckCircle className="h-4 w-4" />
                Complete
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Vehicle Info ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vehicle</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Make / Model</p>
            <p className="font-medium">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          </div>
          {vehicle.plate && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Plate</p>
              <p className="font-medium">{vehicle.plate}</p>
            </div>
          )}
          {vehicle.vin && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">VIN</p>
              <p className="font-mono text-sm">{vehicle.vin}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Odometer</p>
            <p className="font-medium">{task.odometer.toLocaleString()} km</p>
          </div>
          {bay && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Bay</p>
              <p className="font-medium">{bay.name}</p>
            </div>
          )}
          {scheduledDate && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Scheduled</p>
              <p className="font-medium">{format(new Date(scheduledDate), 'PP')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Complaint & Notes ── */}
      {(reportedComplaint || mechanicNotes) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reportedComplaint && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Customer Complaint
                </p>
                <p className="text-sm leading-relaxed">{reportedComplaint}</p>
              </div>
            )}
            {mechanicNotes && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Mechanic Notes
                </p>
                <p className="text-sm leading-relaxed">{mechanicNotes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Labour Items ── */}
      {laborItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Labour</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {laborItems.map((li) => (
                <li key={li.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium">{li.description}</span>
                  <span className="text-sm text-slate-500 ml-4 shrink-0">
                    {li.qty} {li.qty === 1 ? 'hr' : 'hrs'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Parts ── */}
      {partItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Parts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {partItems.map((li) => (
                <li key={li.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium">{li.description}</span>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <span className="text-sm text-slate-500">qty {li.qty}</span>
                    {li.partExecutionStatus && (
                      <StatusBadge status={li.partExecutionStatus} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Pause Dialog ── */}
      <AlertDialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Task</AlertDialogTitle>
            <AlertDialogDescription>
              Select a reason for pausing this task.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2 py-2">
            {(Object.entries(PAUSE_REASON_LABELS) as [PauseReason, string][]).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedPauseReason(value)}
                  className={`flex min-h-[48px] items-center rounded-lg border px-4 py-3 text-sm font-medium text-left transition-colors ${
                    selectedPauseReason === value
                      ? 'border-slate-800 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-xs text-slate-500">
              Selected: {PAUSE_REASON_LABELS[selectedPauseReason]}
            </Badge>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={() => void handlePauseConfirm()}
              disabled={pauseTask.isPending}
            >
              Confirm Pause
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
