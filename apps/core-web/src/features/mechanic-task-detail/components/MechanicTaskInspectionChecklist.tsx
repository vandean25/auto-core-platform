import { toast } from "sonner";
import {
  useMechanicTaskChecklist,
  useUpdateMechanicTaskChecklist,
} from "@/api/mechanic";
import { WorkshopTaskInspectionChecklistView } from "@/components/workshop/WorkshopTaskInspectionChecklistView";

export function MechanicTaskInspectionChecklist({
  taskId,
  readOnly = false,
}: {
  taskId: string;
  readOnly?: boolean;
}) {
  const checklistQuery = useMechanicTaskChecklist(taskId);
  const updateChecklist = useUpdateMechanicTaskChecklist();

  async function saveItem(
    itemId: string,
    values: { passed?: boolean; notes?: string },
  ) {
    try {
      await updateChecklist.mutateAsync({
        taskId,
        items: [{ id: itemId, ...values }],
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Checkliste konnte nicht gespeichert werden",
      );
    }
  }

  if (checklistQuery.isLoading)
    return (
      <p className="text-sm text-muted-foreground">Checkliste wird geladen…</p>
    );
  if (checklistQuery.isError || !checklistQuery.data) return null;
  return (
    <WorkshopTaskInspectionChecklistView
      checklist={checklistQuery.data}
      readOnly={readOnly}
      saving={updateChecklist.isPending}
      onSave={saveItem}
    />
  );
}
