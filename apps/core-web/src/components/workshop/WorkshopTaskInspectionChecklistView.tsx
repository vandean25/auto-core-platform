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

type InspectionItem = InspectionChecklistData['items'][number];

type InspectionItemRowProps = {
  item: InspectionItem;
  draftNotes: string;
  labels: InspectionChecklistViewLabels;
  readOnly: boolean;
  saving: boolean;
  touchFriendly: boolean;
  onNotesChange: (notes: string) => void;
  onSave: (values: { passed?: boolean; notes?: string }) => Promise<void>;
};

function InspectionItemRow({
  item,
  draftNotes,
  labels,
  readOnly,
  saving,
  touchFriendly,
  onNotesChange,
  onSave,
}: InspectionItemRowProps) {
  const disabled = readOnly || saving;
  const buttonProps = touchFriendly
    ? { size: "default" as const, className: "min-h-11" }
    : { size: "sm" as const, className: undefined };
  const savedNotes = item.notes ?? "";

  return (
    <li className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr_auto] sm:items-center">
      <span className="text-sm">{item.label_snapshot}</span>
      <div className="flex gap-2">
        <Button
          type="button"
          {...buttonProps}
          variant={item.passed === true ? "default" : "outline"}
          aria-label={labels.passAriaLabel(item.label_snapshot)}
          disabled={disabled}
          onClick={() => void onSave({ passed: true })}
        >
          {labels.passButton}
        </Button>
        <Button
          type="button"
          {...buttonProps}
          variant={item.passed === false ? "destructive" : "outline"}
          aria-label={labels.failAriaLabel(item.label_snapshot)}
          disabled={disabled}
          onClick={() => void onSave({ passed: false })}
        >
          {labels.failButton}
        </Button>
      </div>
      <Input
        className={touchFriendly ? "sm:col-span-2 min-h-11" : "sm:col-span-2"}
        aria-label={labels.noteAriaLabel(item.label_snapshot)}
        placeholder={labels.notePlaceholder}
        maxLength={INSPECTION_NOTES_MAX_LENGTH}
        value={draftNotes}
        disabled={disabled}
        onChange={(event) => onNotesChange(event.target.value)}
        onBlur={() => {
          if (draftNotes !== savedNotes) void onSave({ notes: draftNotes });
        }}
      />
    </li>
  );
}

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
        {checklist.items.map((item) => (
          <InspectionItemRow
            key={item.id}
            item={item}
            draftNotes={notesByItem[item.id] ?? item.notes ?? ""}
            labels={resolvedLabels}
            readOnly={readOnly}
            saving={saving}
            touchFriendly={touchFriendly}
            onNotesChange={(notes) =>
              setNotesByItem((current) => ({ ...current, [item.id]: notes }))
            }
            onSave={(values) => onSave(item.id, values)}
          />
        ))}
      </ul>
    </section>
  );
}
