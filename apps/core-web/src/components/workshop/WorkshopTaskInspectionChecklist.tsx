import { toast } from "sonner";
import {
  useUpdateWorkshopTaskChecklist,
  useWorkshopTaskChecklist,
} from "@/api/workshop";
import { WorkshopTaskInspectionChecklistView } from "./WorkshopTaskInspectionChecklistView";
import { InspectionCatalogueReferencePicker } from "./InspectionCatalogueReferencePicker";

type Props = { orderId: string; taskId: string; readOnly?: boolean };

export function WorkshopTaskInspectionChecklist({
  orderId,
  taskId,
  readOnly = false,
}: Props) {
  const checklistQuery = useWorkshopTaskChecklist(orderId, taskId);
  const updateChecklist = useUpdateWorkshopTaskChecklist();

  async function saveItem(
    itemId: string,
    values: { passed?: boolean; notes?: string },
  ) {
    try {
      await updateChecklist.mutateAsync({
        orderId,
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
  if (checklistQuery.isError || !checklistQuery.data)
    return (
      <p className="text-sm text-destructive">
        Checkliste konnte nicht geladen werden.
      </p>
    );
  return (
    <div className="space-y-4">
      <WorkshopTaskInspectionChecklistView
        checklist={checklistQuery.data}
        readOnly={readOnly}
        saving={updateChecklist.isPending}
        onSave={saveItem}
      />
      <InspectionCatalogueReferencePicker
        inspectionId={checklistQuery.data.id}
        orderId={orderId}
        taskId={taskId}
        readOnly={readOnly}
      />
    </div>
  );
}
