import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { downloadWarrantyClaimPdf, useUpdateWarrantyClaim } from "@/api/warranty-claims";
import type {
  UpdateWarrantyClaimPayload,
  WarrantyClaim,
  WarrantyClaimStatus,
  WarrantyClaimType,
  WorkshopTask,
} from "@/api/types";
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator";
import { StatusBadge } from "@/components/status/StatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebouncedAutoSave } from "@/hooks/useDebouncedAutoSave";
import { triggerBlobDownload } from "@/lib/download";
import { getErrorMessage } from "@/lib/error-utils";
import {
  TEXTAREA_CLASS_NAME,
  WARRANTY_CLAIM_TYPE_OPTIONS,
  availableStatusChanges,
  buildClaimLineRows,
  buildClaimPatch,
  canSubmitClaim,
  draftFromClaim,
  formatEur,
  isWarrantyClaimContentEditable,
  isWarrantyClaimMetadataEditable,
  parseClaimedAmount,
  selectedNetCents,
  warrantyClaimPdfFileName,
  warrantyClaimTypeLabel,
  type WarrantyClaimDraft,
} from "./warranty-claim-form";
import {
  WarrantyClaimDecisionDialog,
  type WarrantyClaimDecisionOutcome,
  type WarrantyClaimDecisionValues,
} from "./WarrantyClaimDecisionDialog";

const STATUS_CHANGE_LABELS: Record<Exclude<WarrantyClaimStatus, "DRAFT">, string> = {
  SUBMITTED_EXTERNALLY: "submitted externally",
  APPROVED: "approved",
  REJECTED: "rejected",
  CLOSED: "closed",
};

type WarrantyClaimEditorProps = {
  orderId: string;
  orderNumber: string;
  claim: WarrantyClaim;
  tasks: WorkshopTask[];
  /** Line id to the label of the other open claim that already covers it. Those lines cannot be picked. */
  lineClaimedElsewhere: ReadonlyMap<string, string>;
};

export function WarrantyClaimEditor({
  orderId,
  orderNumber,
  claim,
  tasks,
  lineClaimedElsewhere,
}: WarrantyClaimEditorProps) {
  const updateClaim = useUpdateWarrantyClaim();
  const initialDraft = draftFromClaim(claim);
  // Last draft the API acknowledged. Saves send only what differs from it.
  const savedDraftRef = useRef<WarrantyClaimDraft>(initialDraft);
  const latestDraftRef = useRef<WarrantyClaimDraft>(initialDraft);
  const [draft, setDraft] = useState<WarrantyClaimDraft>(initialDraft);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [decisionOutcome, setDecisionOutcome] = useState<WarrantyClaimDecisionOutcome | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const rows = useMemo(() => buildClaimLineRows(tasks, claim.lines), [tasks, claim.lines]);
  const contentEditable = isWarrantyClaimContentEditable(claim.status);
  const metadataEditable = isWarrantyClaimMetadataEditable(claim.status);
  const amount = parseClaimedAmount(draft.claimedAmount);
  const selectedCents = selectedNetCents(rows, draft.lineItemIds);
  const hasCancelledLine = rows.some(
    (row) => row.cancelledOnOrder && draft.lineItemIds.includes(row.id),
  );
  const statusChanges = availableStatusChanges(claim.status);
  const isBusy = busyAction !== null;
  const isSavingDecision = decisionOutcome !== null && busyAction === decisionOutcome;
  // Locked while a status change or a decision is in flight, so an edit cannot be sent to a claim that is about to lock.
  const contentLocked = !contentEditable || isBusy;
  const metadataLocked = !metadataEditable || isBusy;

  // The diff is taken when a save runs, against the last draft the API acknowledged.
  const sendDraft = async (snapshot: WarrantyClaimDraft) => {
    const acknowledged = savedDraftRef.current;
    const payload = buildClaimPatch(acknowledged, snapshot);
    if (!payload) return;
    await updateClaim.mutateAsync({ orderId, claimId: claim.id, payload });
    // An amount that cannot be read is left out of the payload, so the acknowledged amount stays the old one.
    savedDraftRef.current = parseClaimedAmount(snapshot.claimedAmount).valid
      ? snapshot
      : { ...snapshot, claimedAmount: acknowledged.claimedAmount };
  };

  // Saves run one after another, so a slow earlier save cannot land after a newer one.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistDraft = (snapshot: WarrantyClaimDraft): Promise<void> => {
    const run = saveQueueRef.current.then(() => sendDraft(snapshot));
    saveQueueRef.current = run.catch(() => undefined);
    return run;
  };

  const { saveStatus, triggerAutoSave, clearPendingSave } = useDebouncedAutoSave<WarrantyClaimDraft>({
    save: persistDraft,
    onError: (error) => toast.error(getErrorMessage(error, "Failed to save the claim")),
  });

  const updateDraft = (patch: Partial<WarrantyClaimDraft>) => {
    const next = { ...latestDraftRef.current, ...patch };
    latestDraftRef.current = next;
    setDraft(next);
    void triggerAutoSave(next);
  };

  /**
   * Saves the pending edits now. Returns false when they did not save, and then the caller must not
   * go on: a status change or a PDF would otherwise use a version that lacks the edits.
   */
  const flushPendingChanges = async (): Promise<boolean> => {
    clearPendingSave();
    const snapshot = latestDraftRef.current;
    if (!parseClaimedAmount(snapshot.claimedAmount).valid) {
      toast.error("Fix the claimed amount before continuing.");
      return false;
    }
    try {
      await persistDraft(snapshot);
      return true;
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to save the claim"));
      return false;
    }
  };

  // The autosave timer is cleared when the editor unmounts, for example when the advisor picks another
  // claim within 750 ms. Save what is still waiting here instead. The request outlives the component.
  const saveOnUnmount = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveOnUnmount.current = () => {
      const snapshot = latestDraftRef.current;
      // The save leaves an amount that cannot be read out, so the other edits still go through. The
      // advisor is told, because this editor is gone and cannot show the field error any more.
      if (!parseClaimedAmount(snapshot.claimedAmount).valid) {
        toast.error("The claimed amount could not be read, so it was not saved.");
      }
      persistDraft(snapshot).catch((error: unknown) => {
        toast.error(getErrorMessage(error, "Failed to save the claim"));
      });
    };
  });
  useEffect(() => () => saveOnUnmount.current(), []);

  const toggleLine = (lineId: string, checked: boolean) => {
    const current = latestDraftRef.current.lineItemIds.filter((id) => id !== lineId);
    updateDraft({ lineItemIds: checked ? [...current, lineId] : current });
  };

  const changeStatus = async (
    status: Exclude<WarrantyClaimStatus, "DRAFT">,
    extra: Pick<UpdateWarrantyClaimPayload, "decisionDate" | "decisionNote"> = {},
  ): Promise<boolean> => {
    setBusyAction(status);
    try {
      const saved = await flushPendingChanges();
      if (!saved) return false;
      await updateClaim.mutateAsync({ orderId, claimId: claim.id, payload: { status, ...extra } });
      toast.success(`Claim ${STATUS_CHANGE_LABELS[status]}`);
      return true;
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to update the claim status"));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const handleDecision = async (values: WarrantyClaimDecisionValues) => {
    if (!decisionOutcome) return;
    const saved = await changeStatus(decisionOutcome, values);
    if (saved) setDecisionOutcome(null);
  };

  const handlePrint = async () => {
    setBusyAction("PDF");
    const toastId = toast.loading("Generating claim PDF...");
    try {
      const saved = await flushPendingChanges();
      if (!saved) {
        toast.dismiss(toastId);
        return;
      }
      const blob = await downloadWarrantyClaimPdf(orderId, claim.id);
      triggerBlobDownload(blob, warrantyClaimPdfFileName(claim, orderNumber));
      toast.success("Claim PDF downloaded", { id: toastId });
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to generate the claim PDF"), { id: toastId });
    } finally {
      setBusyAction(null);
    }
  };

  const statusNotice = !contentEditable
    ? claim.status === "CLOSED"
      ? "This claim is closed and read-only."
      : "The claim content is locked after submission. The external reference and the decision can still change."
    : null;

  return (
    <section aria-labelledby="warranty-claim-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="warranty-claim-heading" className="text-lg font-semibold tracking-tight">
              {warrantyClaimTypeLabel(claim.type)} claim
            </h2>
            <StatusBadge status={claim.status} />
          </div>
          <p className="text-sm text-slate-500">
            Order {orderNumber}
            {claim.submittedAt ? ` · Submitted ${new Date(claim.submittedAt).toLocaleDateString("de-AT")}` : ""}
            {claim.closedAt ? ` · Closed ${new Date(claim.closedAt).toLocaleDateString("de-AT")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DocumentSaveIndicator status={contentEditable || metadataEditable ? saveStatus : "idle"} />
          <Button variant="outline" onClick={() => void handlePrint()} disabled={isBusy}>
            Print
          </Button>
          {statusChanges.includes("SUBMITTED_EXTERNALLY") && (
            <Button
              onClick={() => void changeStatus("SUBMITTED_EXTERNALLY")}
              disabled={isBusy || !canSubmitClaim(draft) || hasCancelledLine}
              title={
                hasCancelledLine
                  ? "Remove the cancelled line from the claim first"
                  : canSubmitClaim(draft)
                    ? undefined
                    : "Needs a complaint, a claimed amount above zero and at least one line"
              }
            >
              Mark submitted
            </Button>
          )}
          {statusChanges.includes("APPROVED") && (
            <Button variant="outline" onClick={() => setDecisionOutcome("APPROVED")} disabled={isBusy}>
              Record approval
            </Button>
          )}
          {statusChanges.includes("REJECTED") && (
            <Button variant="outline" onClick={() => setDecisionOutcome("REJECTED")} disabled={isBusy}>
              Record rejection
            </Button>
          )}
          {statusChanges.includes("CLOSED") && (
            <Button variant="outline" onClick={() => setCloseConfirmOpen(true)} disabled={isBusy}>
              Close claim
            </Button>
          )}
        </div>
      </div>

      {statusNotice && <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">{statusNotice}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="warranty-claim-type">Claim type</Label>
            <Select
              value={draft.type}
              onValueChange={(value) => updateDraft({ type: value as WarrantyClaimType })}
              disabled={contentLocked}
            >
              <SelectTrigger id="warranty-claim-type" aria-label="Claim type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WARRANTY_CLAIM_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="warranty-claim-complaint">Complaint</Label>
            <textarea
              id="warranty-claim-complaint"
              className={TEXTAREA_CLASS_NAME}
              value={draft.complaint}
              maxLength={4000}
              disabled={contentLocked}
              onChange={(event) => updateDraft({ complaint: event.target.value })}
              placeholder="Customer complaint in the words of the workshop"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="warranty-claim-cause">Cause and correction</Label>
            <textarea
              id="warranty-claim-cause"
              className={TEXTAREA_CLASS_NAME}
              value={draft.causeCorrection}
              maxLength={4000}
              disabled={contentLocked}
              onChange={(event) => updateDraft({ causeCorrection: event.target.value })}
              placeholder="Diagnosed cause and the repair that was carried out"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="warranty-claim-amount">Claimed amount (EUR, net)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="warranty-claim-amount"
                inputMode="decimal"
                className="tabular-nums"
                value={draft.claimedAmount}
                disabled={contentLocked}
                aria-invalid={!amount.valid}
                aria-describedby={amount.valid ? undefined : "warranty-claim-amount-error"}
                onChange={(event) => updateDraft({ claimedAmount: event.target.value })}
                placeholder="0,00"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateDraft({ claimedAmount: (selectedCents / 100).toFixed(2) })}
                disabled={contentLocked || draft.lineItemIds.length === 0}
              >
                Use lines total
              </Button>
            </div>
            {!amount.valid && (
              <p id="warranty-claim-amount-error" role="alert" className="text-sm text-red-600">
                Enter an amount in EUR with at most two decimals.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-none">Affected labor and parts</legend>
            {rows.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-slate-500">
                No labor or part lines on this order yet. Add lines to a task first.
              </p>
            ) : (
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {rows.map((row) => {
                  const claimedBy = lineClaimedElsewhere.get(row.id);
                  const checked = draft.lineItemIds.includes(row.id);
                  const disabled =
                    contentLocked || (!checked && (Boolean(claimedBy) || row.cancelledOnOrder));
                  return (
                    <li key={row.id} className="flex items-start gap-3 px-3 py-2.5">
                      <Checkbox
                        id={`warranty-line-${row.id}`}
                        className="mt-1"
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(value) => toggleLine(row.id, value === true)}
                      />
                      <label htmlFor={`warranty-line-${row.id}`} className="flex-1 space-y-0.5 text-sm">
                        <span className="block font-medium text-slate-900">
                          {row.itemNo} · {row.description}
                        </span>
                        <span className="block text-slate-500">
                          {row.type === "LABOR" ? "Labor" : "Part"}
                          {row.taskTitle ? ` · ${row.taskTitle}` : ""} · {row.quantity} ×{" "}
                          {formatEur(row.unitPrice)} = {formatEur(row.netCents / 100)}
                        </span>
                        {row.cancelledOnOrder && (
                          <span className="block text-xs text-red-700">
                            Cancelled on the order. Uncheck to remove it from the claim.
                          </span>
                        )}
                        {claimedBy && !checked && (
                          <span className="block text-xs text-amber-700">Already on {claimedBy}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-sm text-slate-600">
              Selected lines (net): <span className="font-medium tabular-nums">{formatEur(selectedCents / 100)}</span>
            </p>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="warranty-claim-reference">Reference at the OEM</Label>
            <Input
              id="warranty-claim-reference"
              value={draft.externalReference}
              maxLength={120}
              disabled={metadataLocked}
              onChange={(event) => updateDraft({ externalReference: event.target.value })}
              placeholder="Claim number from the OEM portal"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="warranty-claim-decision-date">Decision date</Label>
              <Input
                id="warranty-claim-decision-date"
                type="date"
                value={draft.decisionDate}
                disabled={metadataLocked}
                onChange={(event) => updateDraft({ decisionDate: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warranty-claim-decision-note">Decision note</Label>
              <Input
                id="warranty-claim-decision-note"
                value={draft.decisionNote}
                maxLength={2000}
                disabled={metadataLocked}
                onChange={(event) => updateDraft({ decisionNote: event.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      <WarrantyClaimDecisionDialog
        key={decisionOutcome ?? "closed"}
        outcome={decisionOutcome}
        initialDecisionDate={draft.decisionDate}
        initialDecisionNote={draft.decisionNote}
        isSubmitting={isSavingDecision}
        onOpenChange={(open) => {
          if (open) return;
          // Closing mid-save would drop the entries, so the close is refused and the advisor is told why.
          if (isSavingDecision) {
            toast.message("The decision is still being saved.");
            return;
          }
          setDecisionOutcome(null);
        }}
        onConfirm={(values) => void handleDecision(values)}
      />

      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this claim?</AlertDialogTitle>
            <AlertDialogDescription>
              A closed claim is read-only. To file the claim again, create a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "CLOSED"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyAction === "CLOSED"}
              onClick={(event) => {
                event.preventDefault();
                void changeStatus("CLOSED").then((closed) => {
                  if (closed) setCloseConfirmOpen(false);
                });
              }}
            >
              Close claim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
