import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MechanicTaskDetail } from "@/api/mechanic";
import { PICKERL_TASK_TITLE } from "@/features/workshop/pickerl.constants";
import { DiagnosticsSection } from "./components/DiagnosticsSection";
import { LaborItemsCard } from "./components/LaborItemsCard";
import { MediaSection } from "./components/MediaSection";
import { PartsSection } from "./components/PartsSection";
import { PauseTaskDialog } from "./components/PauseTaskDialog";
import { RequestPartDialog } from "./components/RequestPartDialog";
import { SwitchTaskDialog } from "./components/SwitchTaskDialog";
import { TaskHeader } from "./components/TaskHeader";
import { VehicleInfoCard } from "./components/VehicleInfoCard";
import { useDiagnosticsAutosave } from "./hooks/useDiagnosticsAutosave";
import { useMechanicNotesDraft } from "./hooks/useMechanicNotesDraft";
import { useMediaUpload } from "./hooks/useMediaUpload";
import { useRequestPartForm } from "./hooks/useRequestPartForm";
import { useTaskLifecycle } from "./hooks/useTaskLifecycle";
import { useVoiceNote } from "./hooks/useVoiceNote";
import { useSubmitMechanicFinding } from "./hooks/useSubmitMechanicFinding";
import { buildTaskHeaderActionState, getTaskCapabilities } from "./task-capabilities";
import { MechanicTaskInspectionChecklist } from "./components/MechanicTaskInspectionChecklist";

type MechanicTaskDetailViewProps = {
  task: MechanicTaskDetail;
  refetch: () => Promise<unknown>;
};

export function MechanicTaskDetailView({
  task,
  refetch,
}: MechanicTaskDetailViewProps) {
  const { t } = useTranslation("workshop");
  const navigate = useNavigate();
  const capabilities = getTaskCapabilities({
    taskStatus: task.taskStatus,
    hasOpenLaborEntry: task.hasOpenLaborEntry,
  });
  const notesDraft = useMechanicNotesDraft(task.taskId);
  const diagnostics = useDiagnosticsAutosave({
    taskId: task.taskId,
    initialNotes: task.mechanicNotes,
    draft: notesDraft,
  });
  const voiceNote = useVoiceNote({
    taskId: task.taskId,
    notesValue: diagnostics.notesValue,
    onAcceptDraft: diagnostics.handleNotesChange,
  });
  const mediaUpload = useMediaUpload(task.taskId);
  const lifecycle = useTaskLifecycle({
    taskId: task.taskId,
    refetch,
    cancelPendingSave: diagnostics.cancelPendingSave,
  });
  const partRequest = useRequestPartForm(task.taskId);
  const submitFinding = useSubmitMechanicFinding({
    taskId: task.taskId,
    disabled: capabilities.isDone,
    hasNotes: diagnostics.notesValue.trim().length > 0,
    flushAndSaveNotes: diagnostics.flushAndSaveNotes,
  });

  const laborItems = task.lineItems.filter(
    (lineItem) => lineItem.type === "LABOR",
  );
  const partItems = task.lineItems.filter(
    (lineItem) => lineItem.type === "PART",
  );

  return (
    <div className="w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <TaskHeader
        task={task}
        isDone={capabilities.isDone}
        onBack={() => navigate("/mechanic/queue")}
        actionState={buildTaskHeaderActionState(capabilities, lifecycle)}
        actionHandlers={{
          onStart: () => void lifecycle.handleStart(),
          onOpenSwitch: () => {
            lifecycle.setSwitchRetrying(false);
            lifecycle.setSwitchDialogOpen(true);
          },
          onOpenPause: () => lifecycle.setPauseDialogOpen(true),
          onComplete: () => void lifecycle.handleComplete(),
        }}
      />

      <VehicleInfoCard task={task} />

      {task.taskTitle === PICKERL_TASK_TITLE && (
        <MechanicTaskInspectionChecklist
          taskId={task.taskId}
          readOnly={capabilities.isDone}
        />
      )}

      {task.reportedComplaint && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("mechanic.taskDetail.complaint.title")}</CardTitle>
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
        canSubmitFinding={submitFinding.canSubmitFinding}
        submitFindingPending={submitFinding.submitFindingPending}
        onSubmitFinding={() => void submitFinding.submitFinding()}
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
          photoInputRef={mediaUpload.photoInputRef}
          onPickFile={() => {
            mediaUpload.setUploadState("idle");
            mediaUpload.fileInputRef.current?.click();
          }}
          onPickPhoto={() => {
            mediaUpload.setUploadState("idle");
            mediaUpload.photoInputRef.current?.click();
          }}
          onFileSelected={(file) => void mediaUpload.handleFileSelected(file)}
        />
      )}

      <div className="flex justify-center">
        <Button
          variant="ghost"
          onClick={() => void refetch()}
          className="min-h-11 gap-2 text-slate-500"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("mechanic.taskDetail.refreshTask")}
        </Button>
      </div>

      <SwitchTaskDialog
        open={lifecycle.switchDialogOpen}
        selectedReason={lifecycle.selectedSwitchReason}
        retrying={lifecycle.switchRetrying}
        pending={
          lifecycle.switchTask.isPending || lifecycle.startTask.isPending
        }
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
        onFormChange={(updates) =>
          partRequest.setPartForm((previous) => ({ ...previous, ...updates }))
        }
        onSubmit={() => void partRequest.handleRequestPartSubmit()}
      />
    </div>
  );
}
