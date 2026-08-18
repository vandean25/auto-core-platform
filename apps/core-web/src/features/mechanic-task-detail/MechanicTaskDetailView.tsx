import { RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MechanicTaskDetail } from '@/api/mechanic'
import { DiagnosticsSection } from './components/DiagnosticsSection'
import { LaborItemsCard } from './components/LaborItemsCard'
import { MediaSection } from './components/MediaSection'
import { PartsSection } from './components/PartsSection'
import { PauseTaskDialog } from './components/PauseTaskDialog'
import { RequestPartDialog } from './components/RequestPartDialog'
import { SwitchTaskDialog } from './components/SwitchTaskDialog'
import { TaskHeader } from './components/TaskHeader'
import { VehicleInfoCard } from './components/VehicleInfoCard'
import { useDiagnosticsAutosave } from './hooks/useDiagnosticsAutosave'
import { useMediaUpload } from './hooks/useMediaUpload'
import { useRequestPartForm } from './hooks/useRequestPartForm'
import { useTaskLifecycle } from './hooks/useTaskLifecycle'
import { useVoiceNote } from './hooks/useVoiceNote'
import { getTaskCapabilities } from './task-capabilities'

type MechanicTaskDetailViewProps = {
  task: MechanicTaskDetail
  refetch: () => Promise<unknown>
}

export function MechanicTaskDetailView({ task, refetch }: MechanicTaskDetailViewProps) {
  const navigate = useNavigate()
  const capabilities = getTaskCapabilities(task.taskStatus)
  const diagnostics = useDiagnosticsAutosave({
    taskId: task.taskId,
    initialNotes: task.mechanicNotes,
  })
  const voiceNote = useVoiceNote({
    taskId: task.taskId,
    notesValue: diagnostics.notesValue,
    onAcceptDraft: diagnostics.handleNotesChange,
  })
  const mediaUpload = useMediaUpload(task.taskId)
  const lifecycle = useTaskLifecycle({
    taskId: task.taskId,
    refetch,
    cancelPendingSave: diagnostics.cancelPendingSave,
  })
  const partRequest = useRequestPartForm(task.taskId)

  const laborItems = task.lineItems.filter((lineItem) => lineItem.type === 'LABOR')
  const partItems = task.lineItems.filter((lineItem) => lineItem.type === 'PART')

  return (
    <div className="w-full max-w-3xl mx-auto p-6 space-y-6">
      <TaskHeader
        task={task}
        canStart={capabilities.canStart}
        canSwitch={capabilities.canSwitch}
        canPause={capabilities.canPause}
        canComplete={capabilities.canComplete}
        isDone={capabilities.isDone}
        isNotStarted={capabilities.isNotStarted}
        startPending={lifecycle.startTask.isPending}
        switchPending={lifecycle.switchTask.isPending}
        pausePending={lifecycle.pauseTask.isPending}
        completePending={lifecycle.completeTask.isPending}
        onBack={() => navigate('/mechanic/queue')}
        onStart={() => void lifecycle.handleStart()}
        onOpenSwitch={() => {
          lifecycle.setSwitchRetrying(false)
          lifecycle.setSwitchDialogOpen(true)
        }}
        onOpenPause={() => lifecycle.setPauseDialogOpen(true)}
        onComplete={() => void lifecycle.handleComplete()}
      />

      <VehicleInfoCard task={task} />

      {task.reportedComplaint && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Customer Complaint</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{task.reportedComplaint}</p>
          </CardContent>
        </Card>
      )}

      <DiagnosticsSection
        notesValue={diagnostics.notesValue}
        saveState={diagnostics.saveState}
        disabled={capabilities.isDone}
        onNotesChange={diagnostics.handleNotesChange}
        voiceNoteState={voiceNote.voiceNoteState}
        voiceDraftValue={voiceNote.voiceDraftValue}
        voiceNoteError={voiceNote.voiceNoteError}
        onStartVoiceNote={() => void voiceNote.startVoiceNoteRecording()}
        onStopVoiceNote={voiceNote.stopVoiceNoteRecording}
        onVoiceDraftChange={voiceNote.setVoiceDraftValue}
        onAcceptVoiceDraft={voiceNote.handleAcceptVoiceDraft}
        onDiscardVoiceDraft={voiceNote.handleDiscardVoiceDraft}
      />

      <LaborItemsCard laborItems={laborItems} />

      <PartsSection
        partItems={partItems}
        isDone={capabilities.isDone}
        onRequestPart={partRequest.openRequestPart}
      />

      {!capabilities.isDone && (
        <MediaSection
          uploadState={mediaUpload.uploadState}
          fileInputRef={mediaUpload.fileInputRef}
          onPickFile={() => {
            mediaUpload.setUploadState('idle')
            mediaUpload.fileInputRef.current?.click()
          }}
          onFileSelected={(file) => void mediaUpload.handleFileSelected(file)}
        />
      )}

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-2 text-slate-500">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh task
        </Button>
      </div>

      <SwitchTaskDialog
        open={lifecycle.switchDialogOpen}
        selectedReason={lifecycle.selectedSwitchReason}
        retrying={lifecycle.switchRetrying}
        pending={lifecycle.switchTask.isPending || lifecycle.startTask.isPending}
        onOpenChange={lifecycle.setSwitchDialogOpen}
        onSelectReason={lifecycle.setSelectedSwitchReason}
        onConfirm={() => void lifecycle.handleSwitchConfirm()}
      />

      <PauseTaskDialog
        open={lifecycle.pauseDialogOpen}
        selectedReason={lifecycle.selectedPauseReason}
        pending={lifecycle.pauseTask.isPending}
        onOpenChange={lifecycle.setPauseDialogOpen}
        onSelectReason={lifecycle.setSelectedPauseReason}
        onConfirm={() => void lifecycle.handlePauseConfirm()}
      />

      <RequestPartDialog
        open={partRequest.requestPartOpen}
        partForm={partRequest.partForm}
        partFormError={partRequest.partFormError}
        pending={partRequest.requestPart.isPending}
        onOpenChange={partRequest.setRequestPartOpen}
        onFormChange={(updates) => partRequest.setPartForm((previous) => ({ ...previous, ...updates }))}
        onSubmit={() => void partRequest.handleRequestPartSubmit()}
      />
    </div>
  )
}
