import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("workshop");
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
          : t("mechanic.taskDetail.checklist.loadError"),
      );
    }
  }

  if (checklistQuery.isLoading)
    return (
      <p className="text-sm text-muted-foreground">{t("mechanic.taskDetail.checklist.loading")}</p>
    );
  if (checklistQuery.isError || !checklistQuery.data) return null;
  return (
    <WorkshopTaskInspectionChecklistView
      checklist={checklistQuery.data}
      readOnly={readOnly}
      touchFriendly
      saving={updateChecklist.isPending}
      onSave={saveItem}
    />
  );
}
