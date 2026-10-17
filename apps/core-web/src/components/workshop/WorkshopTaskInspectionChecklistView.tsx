import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type InspectionChecklistData = {
  title: string;
  items: Array<{
    id: string;
    label_snapshot: string;
    passed: boolean | null;
    notes: string | null;
  }>;
};

type Props = {
  checklist: InspectionChecklistData;
  readOnly?: boolean;
  saving: boolean;
  onSave: (
    itemId: string,
    values: { passed?: boolean; notes?: string },
  ) => Promise<void>;
};

export function WorkshopTaskInspectionChecklistView({
  checklist,
  readOnly = false,
  saving,
  onSave,
}: Props) {
  const { t } = useTranslation("workshop");
  const [notesByItem, setNotesByItem] = useState<Record<string, string>>({});

  return (
    <section
      aria-label={t("inspection.checklist.aria")}
      className="space-y-3 rounded-md border p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">{checklist.title}</h3>
        <p className="text-xs text-muted-foreground">
          {t("inspection.checklist.hint")}
        </p>
      </div>
      <ul className="space-y-2">
        {checklist.items.map((item) => {
          const itemNotes = notesByItem[item.id] ?? item.notes ?? "";
          return (
            <li
              key={item.id}
              className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <span className="text-sm">{item.label_snapshot}</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={item.passed === true ? "default" : "outline"}
                  aria-label={t("inspection.checklist.okAria", { label: item.label_snapshot })}
                  disabled={readOnly || saving}
                  onClick={() => void onSave(item.id, { passed: true })}
                >
                  {t("inspection.checklist.ok")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={item.passed === false ? "destructive" : "outline"}
                  aria-label={t("inspection.checklist.defectAria", { label: item.label_snapshot })}
                  disabled={readOnly || saving}
                  onClick={() => void onSave(item.id, { passed: false })}
                >
                  {t("inspection.checklist.defect")}
                </Button>
              </div>
              <Input
                className="sm:col-span-2"
                aria-label={t("inspection.checklist.noteAria", { label: item.label_snapshot })}
                placeholder={t("inspection.checklist.notePlaceholder")}
                value={itemNotes}
                disabled={readOnly || saving}
                onChange={(event) =>
                  setNotesByItem((current) => ({
                    ...current,
                    [item.id]: event.target.value,
                  }))
                }
                onBlur={() => {
                  if (itemNotes !== (item.notes ?? ""))
                    void onSave(item.id, { notes: itemNotes });
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
