import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowLeft,
  CheckCircle,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Upload,
  Zap,
} from 'lucide-react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useMechanicTaskDetail,
  useStartTask,
  useSwitchTask,
  usePauseTask,
  useCompleteTask,
  useSaveDiagnostics,
  useRequestPart,
  useCreateMediaUploadPolicy,
  useSaveMediaMetadata,
} from '@/api/mechanic'
import type {
  PauseTaskPayload,
  SwitchTaskPayload,
  RequestMediaUploadPayload,
} from '@/api/mechanic'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'

const MECHANIC_ID_KEY = 'acp:mechanic-id'
const DEBOUNCE_MS = 750

function readStoredMechanicId(): string {
  try {
    return window.localStorage.getItem(MECHANIC_ID_KEY) ?? ''
  } catch {
    return ''
  }
}

type PauseReason = PauseTaskPayload['pauseReason']
type SwitchReason = SwitchTaskPayload['previousPauseReason']
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type UploadState = 'idle' | 'uploading' | 'done' | 'error'

const PAUSE_REASON_LABELS: Record<PauseReason, string> = {
  WAITING_PARTS: 'Waiting for Parts',
  WAITING_CUSTOMER: 'Waiting for Customer',
  OTHER: 'Other',
}

const SWITCH_REASON_LABELS: Record<SwitchReason, string> = {
  WAITING_PARTS: 'Previous task — Waiting for Parts',
  WAITING_CUSTOMER: 'Previous task — Waiting for Customer',
  SWITCHED_TO_HIGHER_PRIORITY: 'Switched to Higher Priority',
}

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
])

// ─── Save State Indicator ─────────────────────────────────────────────────────

function SaveStateIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={`text-xs font-medium ${
        state === 'saving'
          ? 'text-slate-400'
          : state === 'saved'
            ? 'text-emerald-600'
            : 'text-red-500'
      }`}
    >
      {state === 'saving' && (
        <span className="inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </span>
      )}
      {state === 'saved' && 'Saved ✓'}
      {state === 'error' && 'Error — not saved'}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MechanicTaskDetailPage() {
  const navigate = useNavigate()
  const { taskId = '' } = useParams<{ taskId: string }>()
  const [searchParams] = useSearchParams()
  const mechanicId = searchParams.get('mechanicId') ?? readStoredMechanicId()

  const { data: task, isLoading, refetch } = useMechanicTaskDetail(mechanicId, taskId)
  const startTask = useStartTask()
  const switchTask = useSwitchTask()
  const pauseTask = usePauseTask()
  const completeTask = useCompleteTask()
  const saveDiagnostics = useSaveDiagnostics()
  const requestPart = useRequestPart()
  const createUploadPolicy = useCreateMediaUploadPolicy()
  const saveMediaMeta = useSaveMediaMetadata()

  // ── Pause dialog ──
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false)
  const [selectedPauseReason, setSelectedPauseReason] = useState<PauseReason>('WAITING_PARTS')

  // ── Switch dialog ──
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false)
  const [selectedSwitchReason, setSelectedSwitchReason] =
    useState<SwitchReason>('SWITCHED_TO_HIGHER_PRIORITY')
  const [switchRetrying, setSwitchRetrying] = useState(false)

  // ── Request part dialog ──
  const [requestPartOpen, setRequestPartOpen] = useState(false)
  const [partForm, setPartForm] = useState({ itemNo: '', description: '', qty: '1' })
  const [partFormError, setPartFormError] = useState('')

  // ── Diagnostics / mechanic notes ──
  const [notesValue, setNotesValue] = useState('')
  const [notesInitialized, setNotesInitialized] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Media upload ──
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize mechanic notes once task data loads
  useEffect(() => {
    if (task && !notesInitialized) {
      setNotesValue(task.mechanicNotes ?? '')
      setNotesInitialized(true)
    }
  }, [task, notesInitialized])

  const cancelPendingSave = () => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
  }

  // Cancel pending auto-save on unmount
  useEffect(() => {
    return cancelPendingSave
  }, [])


  const isActive = task?.taskStatus === 'IN_PROGRESS'
  const isNotStarted = task?.taskStatus === 'NOT_STARTED'
  const isPaused =
    task?.taskStatus === 'PAUSED' ||
    task?.taskStatus === 'WAITING_PARTS' ||
    task?.taskStatus === 'WAITING_CUSTOMER'
  const isDone = task?.taskStatus === 'DONE'

  const canStart = isNotStarted || isPaused
  const canSwitch = canStart
  const canPause = isActive
  const canComplete = isActive

  // ── Notes auto-save (750 ms debounce) ──
  const handleNotesChange = (value: string) => {
    setNotesValue(value)
    setSaveState('saving')
    cancelPendingSave()
    autoSaveTimerRef.current = setTimeout(() => {
      void saveDiagnostics
        .mutateAsync({ mechanicId, taskId, payload: { mechanicNotes: value } })
        .then(() => setSaveState('saved'))
        .catch((err: unknown) => {
          console.error('[MechanicTaskDetail] Auto-save diagnostics failed:', err)
          setSaveState('error')
        })
    }, DEBOUNCE_MS)
  }

  // ── Start ──
  const handleStart = async () => {
    try {
      await startTask.mutateAsync({ mechanicId, taskId })
      toast.success('Task started — punch-in recorded')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to start task'))
    }
  }

  // ── Switch (409 → refetch → start fallback) ──
  const handleSwitchConfirm = async () => {
    cancelPendingSave()
    setSwitchRetrying(false)
    try {
      await switchTask.mutateAsync({
        mechanicId,
        taskId,
        payload: { previousPauseReason: selectedSwitchReason },
      })
      toast.success('Switched to task — punch-in recorded')
      setSwitchDialogOpen(false)
    } catch (error: unknown) {
      if (getErrorStatus(error) === 409) {
        // No open labor entry to switch from; refetch and retry as start
        setSwitchRetrying(true)
        await refetch()
        try {
          await startTask.mutateAsync({ mechanicId, taskId })
          toast.success('Task started — punch-in recorded')
          setSwitchDialogOpen(false)
        } catch (startError: unknown) {
          if (getErrorStatus(startError) === 409) {
            toast.error('This task is already being worked on. Please refresh.')
          } else {
            toast.error(getErrorMessage(startError, 'Failed to start task'))
          }
        } finally {
          setSwitchRetrying(false)
        }
      } else {
        toast.error(getErrorMessage(error, 'Failed to switch task'))
      }
    }
  }

  // ── Pause ──
  const handlePauseConfirm = async () => {
    cancelPendingSave()
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

  // ── Complete ──
  const handleComplete = async () => {
    cancelPendingSave()
    try {
      await completeTask.mutateAsync({ mechanicId, taskId })
      toast.success('Task marked as complete')
      navigate(`/mechanic/queue?mechanicId=${encodeURIComponent(mechanicId)}`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to complete task'))
    }
  }

  // ── Request Part ──
  const handleRequestPartSubmit = async () => {
    const qty = parseFloat(partForm.qty)
    if (!partForm.itemNo.trim()) {
      setPartFormError('Part number is required.')
      return
    }
    if (!partForm.description.trim()) {
      setPartFormError('Description is required.')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setPartFormError('Quantity must be a positive number.')
      return
    }
    setPartFormError('')
    try {
      await requestPart.mutateAsync({
        mechanicId,
        taskId,
        payload: { itemNo: partForm.itemNo.trim(), description: partForm.description.trim(), qty },
      })
      toast.success('Part request submitted')
      setPartForm({ itemNo: '', description: '', qty: '1' })
      setRequestPartOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to request part'))
    }
  }

  // ── Media Upload ──
  // NOTE: ALLOWED_MEDIA_TYPES must stay in sync with backend RequestMediaUploadDto.mimeType enum
  // (apps/core-api/src/mechanic/dto/media.dto.ts). Update both locations when MIME types change.
  const handleFileSelected = async (file: File) => {
    if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
      toast.error('Unsupported file type. Use JPEG, PNG, WebP, MP4, or MOV.')
      return
    }
    setUploadState('uploading')
    try {
      const mimeType = file.type as RequestMediaUploadPayload['mimeType']
      // 1. Get presigned POST policy from backend
      const policy = await createUploadPolicy.mutateAsync({
        mechanicId,
        taskId,
        payload: { mimeType, sizeBytes: file.size, filename: file.name },
      })

      // 2. Upload file directly to cloud storage using the policy form fields
      const formData = new FormData()
      for (const [key, value] of Object.entries(policy.formFields)) {
        formData.append(key, value)
      }
      formData.append('file', file)
      const uploadRes = await fetch(policy.uploadUrl, { method: 'POST', body: formData })
      if (!uploadRes.ok) {
        throw new Error(
          `Upload to storage failed: ${uploadRes.status.toString()} ${uploadRes.statusText}`,
        )
      }

      // 3. Persist metadata in backend
      await saveMediaMeta.mutateAsync({
        mechanicId,
        taskId,
        payload: {
          storageKey: policy.storageKey,
          storageBucket: policy.storageBucket,
          mimeType,
          sizeBytes: file.size,
        },
      })

      setUploadState('done')
      toast.success('Media uploaded successfully')
      // Auto-reset the success indicator after 4 s so subsequent uploads render correctly
      setTimeout(() => setUploadState('idle'), 4000)
    } catch (error: unknown) {
      setUploadState('error')
      toast.error(getErrorMessage(error, 'Upload failed'))
    }
  }

  // ── Early returns ──
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

  const { vehicle, bay, lineItems, scheduledDate, reportedComplaint } = task
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

        {/* ── Primary Actions (top-right) ── */}
        {!isDone && (
          <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
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
            {canSwitch && (
              <Button
                variant="outline"
                onClick={() => {
                  setSwitchRetrying(false)
                  setSwitchDialogOpen(true)
                }}
                disabled={switchTask.isPending || startTask.isPending}
                className="min-h-[44px] gap-2"
                title="Switch from another task to this one"
              >
                <Zap className="h-4 w-4" />
                Switch Here
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

      {/* ── Customer Complaint ── */}
      {reportedComplaint && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Customer Complaint</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{reportedComplaint}</p>
          </CardContent>
        </Card>
      )}

      {/* ── Diagnostics / Mechanic Notes ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Diagnostics &amp; Notes</CardTitle>
            <SaveStateIndicator state={saveState} />
          </div>
        </CardHeader>
        <CardContent>
          <textarea
            value={notesValue}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Record diagnostic findings, measurements, or notes here…"
            rows={5}
            className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
            disabled={isDone}
          />
        </CardContent>
      </Card>

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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Parts</CardTitle>
            {!isDone && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[36px] gap-1"
                onClick={() => {
                  setPartForm({ itemNo: '', description: '', qty: '1' })
                  setPartFormError('')
                  setRequestPartOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Request Part
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {partItems.length === 0 ? (
            <p className="text-sm text-slate-400">No parts requested yet.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>

      {/* ── Media Upload ── */}
      {!isDone && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Media</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                className="min-h-[44px] gap-2"
                disabled={uploadState === 'uploading'}
                onClick={() => {
                  setUploadState('idle')
                  fileInputRef.current?.click()
                }}
              >
                {uploadState === 'uploading' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload Photo / Video
                  </>
                )}
              </Button>
              {uploadState === 'done' && (
                <span className="text-sm text-emerald-600 font-medium">Uploaded ✓</span>
              )}
              {uploadState === 'error' && (
                <span className="text-sm text-red-500">Upload failed — please retry</span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Accepted: JPEG, PNG, WebP, MP4, MOV
            </p>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFileSelected(file)
                // Reset so same file can be re-selected
                e.target.value = ''
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Refresh Button (for tablet convenience) ── */}
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-2 text-slate-500">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh task
        </Button>
      </div>

      {/* ── Switch Dialog ── */}
      <AlertDialog open={switchDialogOpen} onOpenChange={setSwitchDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to This Task</AlertDialogTitle>
            <AlertDialogDescription>
              What is the status of the task you are leaving?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2 py-2">
            {(Object.entries(SWITCH_REASON_LABELS) as [SwitchReason, string][]).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedSwitchReason(value)}
                  className={`flex min-h-[48px] items-center rounded-lg border px-4 py-3 text-sm font-medium text-left transition-colors ${
                    selectedSwitchReason === value
                      ? 'border-slate-800 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>

          {switchRetrying && (
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              No active task to switch from — trying start instead…
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={switchTask.isPending || startTask.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={() => void handleSwitchConfirm()}
              disabled={switchTask.isPending || startTask.isPending}
            >
              {switchTask.isPending || startTask.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Confirm Switch
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* ── Request Part Dialog ── */}
      <Dialog open={requestPartOpen} onOpenChange={setRequestPartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a Part</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div>
              <Label htmlFor="part-item-no">Part Number / SKU</Label>
              <Input
                id="part-item-no"
                value={partForm.itemNo}
                onChange={(e) => setPartForm((prev) => ({ ...prev, itemNo: e.target.value }))}
                placeholder="e.g. OIL-FILTER-01"
                className="mt-1 min-h-[44px]"
              />
            </div>
            <div>
              <Label htmlFor="part-description">Description</Label>
              <Input
                id="part-description"
                value={partForm.description}
                onChange={(e) =>
                  setPartForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="e.g. Oil filter — 2.0 TDI"
                className="mt-1 min-h-[44px]"
              />
            </div>
            <div>
              <Label htmlFor="part-qty">Quantity</Label>
              <Input
                id="part-qty"
                type="number"
                min="1"
                step="1"
                value={partForm.qty}
                onChange={(e) => setPartForm((prev) => ({ ...prev, qty: e.target.value }))}
                className="mt-1 min-h-[44px]"
              />
            </div>
            {partFormError && (
              <p className="text-sm text-red-500">{partFormError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRequestPartOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleRequestPartSubmit()}
                disabled={requestPart.isPending}
              >
                {requestPart.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : null}
                Submit Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
