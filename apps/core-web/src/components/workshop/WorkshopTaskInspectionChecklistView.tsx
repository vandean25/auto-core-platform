import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { INSPECTION_NOTES_MAX_LENGTH } from "@/constants/field-limits";
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

export type InspectionChecklistViewLabels = {
  sectionAriaLabel: string;
  description: string;
  passButton: string;
  failButton: string;
  passAriaLabel: (itemLabel: string) => string;
  failAriaLabel: (itemLabel: string) => string;
  noteAriaLabel: (itemLabel: string) => string;
  notePlaceholder?: string;
};

type Props = {
  checklist: InspectionChecklistData;
  readOnly?: boolean;
  saving: boolean;
  /** When true, pass/fail and note controls meet the 44px tablet touch target. */
  touchFriendly?: boolean;
  labels?: InspectionChecklistViewLabels;
  onSave: (
    itemId: string,
    values: { passed?: boolean; notes?: string },
  ) => Promise<void>;
};

export function WorkshopTaskInspectionChecklistView({
  checklist,
  readOnly = false,
  saving,
  touchFriendly = false,
  labels,
  onSave,
}: Props) {
  const { t } = useTranslation("workshop");
  const [notesByItem, setNotesByItem] = useState<Record<string, string>>({});

  const defaultLabels = useMemo<InspectionChecklistViewLabels>(
    () => ({
      sectionAriaLabel: t("inspection.checklist.aria"),
      description: t("inspection.checklist.hint"),
      passButton: t("inspection.checklist.ok"),
      failButton: t("inspection.checklist.defect"),
      passAriaLabel: (itemLabel) =>
        t("inspection.checklist.okAria", { label: itemLabel }),
      failAriaLabel: (itemLabel) =>
        t("inspection.checklist.defectAria", { label: itemLabel }),
      noteAriaLabel: (itemLabel) =>
        t("inspection.checklist.noteAria", { label: itemLabel }),
      notePlaceholder: t("inspection.checklist.notePlaceholder"),
    }),
    [t],
  );

  const resolvedLabels = labels ?? defaultLabels;

  return (
    <section
      aria-label={resolvedLabels.sectionAriaLabel}
      className="space-y-3 rounded-md border p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">{checklist.title}</h3>
        <p className="text-xs text-muted-foreground">{resolvedLabels.description}</p>
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
                  size={touchFriendly ? "default" : "sm"}
                  className={touchFriendly ? "min-h-11" : undefined}
                  variant={item.passed === true ? "default" : "outline"}
                  aria-label={resolvedLabels.passAriaLabel(item.label_snapshot)}
                  disabled={readOnly || saving}
                  onClick={() => void onSave(item.id, { passed: true })}
                >
                  {resolvedLabels.passButton}
                </Button>
                <Button
                  type="button"
                  size={touchFriendly ? "default" : "sm"}
                  className={touchFriendly ? "min-h-11" : undefined}
                  variant={item.passed === false ? "destructive" : "outline"}
                  aria-label={resolvedLabels.failAriaLabel(item.label_snapshot)}
                  disabled={readOnly || saving}
                  onClick={() => void onSave(item.id, { passed: false })}
                >
                  {resolvedLabels.failButton}
                </Button>
              </div>
              <Input
                className={touchFriendly ? "sm:col-span-2 min-h-11" : "sm:col-span-2"}
                aria-label={resolvedLabels.noteAriaLabel(item.label_snapshot)}
                placeholder={resolvedLabels.notePlaceholder}
                maxLength={INSPECTION_NOTES_MAX_LENGTH}
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
