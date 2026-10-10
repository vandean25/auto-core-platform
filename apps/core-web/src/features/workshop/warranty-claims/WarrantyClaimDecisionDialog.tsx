import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEXTAREA_CLASS_NAME } from "./warranty-claim-form";

export type WarrantyClaimDecisionOutcome = "APPROVED" | "REJECTED";

export type WarrantyClaimDecisionValues = {
  decisionDate: string;
  decisionNote: string | null;
};

type WarrantyClaimDecisionDialogProps = {
  outcome: WarrantyClaimDecisionOutcome | null;
  /** The claim's decision date and note as the editor holds them, so the dialog does not overwrite them. */
  initialDecisionDate: string;
  initialDecisionNote: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: WarrantyClaimDecisionValues) => void;
};

function todayIsoDay(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The editor mounts this dialog with a key per opening, so the fields start from the claim's current
 * values each time it opens.
 */
export function WarrantyClaimDecisionDialog({
  outcome,
  initialDecisionDate,
  initialDecisionNote,
  isSubmitting,
  onOpenChange,
  onConfirm,
}: WarrantyClaimDecisionDialogProps) {
  const [decisionDate, setDecisionDate] = useState(() => initialDecisionDate || todayIsoDay());
  const [decisionNote, setDecisionNote] = useState(initialDecisionNote);

  const isApproval = outcome === "APPROVED";
  const title = isApproval ? "Record approval" : "Record rejection";

  return (
    <Dialog open={outcome !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Enter the decision date from the OEM. The date is required for both outcomes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="warranty-decision-date">Decision date</Label>
            <Input
              id="warranty-decision-date"
              type="date"
              value={decisionDate}
              onChange={(event) => setDecisionDate(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="warranty-decision-note">Decision note</Label>
            <textarea
              id="warranty-decision-note"
              className={TEXTAREA_CLASS_NAME}
              value={decisionNote}
              maxLength={2000}
              onChange={(event) => setDecisionNote(event.target.value)}
              placeholder={isApproval ? "For example: 80% goodwill share" : "Reason given by the OEM"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                decisionDate,
                decisionNote: decisionNote.trim() === "" ? null : decisionNote.trim(),
              })
            }
            disabled={isSubmitting || decisionDate === ""}
          >
            {isApproval ? "Mark approved" : "Mark rejected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
