import { useMemo, useRef, useState } from "react";
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
  buildClaimPatch,
  canSubmitClaim,
  draftFromClaim,
  formatEur,
  isWarrantyClaimContentEditable,
  isWarrantyClaimMetadataEditable,
  parseClaimedAmount,
  selectedLinesTotal,
  toClaimableLines,
  warrantyClaimPdfFileName,
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
  // Last draft the API acknowledged. Autosave sends only what differs from it.
  const savedDraftRef = useRef<WarrantyClaimDraft>(initialDraft);
  const latestDraftRef = useRef<WarrantyClaimDraft>(initialDraft);
  const [draft, setDraft] = useState<WarrantyClaimDraft>(initialDraft);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [decisionOutcome, setDecisionOutcome] = useState<WarrantyClaimDecisionOutcome | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const lines = useMemo(() => toClaimableLines(tasks), [tasks]);
  const contentEditable = isWarrantyClaimContentEditable(claim.status);
  const metadataEditable = isWarrantyClaimMetadataEditable(claim.status);
  const amount = parseClaimedAmount(draft.claimedAmount);
  const linesTotal = selectedLinesTotal(lines, draft.lineItemIds);
  const statusChanges = availableStatusChanges(claim.status);
  const isBusy = busyAction !== null;

  const { saveStatus, triggerAutoSave } = useDebouncedAutoSave<WarrantyClaimDraft>({
    save: async (snapshot) => {
      const payload = buildClaimPatch(savedDraftRef.current, snapshot);
      if (!payload) return;
      await updateClaim.mutateAsync({ orderId, claimId: claim.id, payload });
      savedDraftRef.current = snapshot;
    },
    shouldSave: (snapshot) => parseClaimedAmount(snapshot.claimedAmount).valid,
    onError: (error) => toast.error(getErrorMessage(error, "Failed to save the claim")),
  });

  const updateDraft = (patch: Partial<WarrantyClaimDraft>) => {
    const next = { ...latestDraftRef.current, ...patch };
    latestDraftRef.current = next;
    setDraft(next);
    void triggerAutoSave(next);
  };

  const flushPendingChanges = () => triggerAutoSave(latestDraftRef.current, { immediate: true });

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
      await flushPendingChanges();
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
      await flushPendingChanges();
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
              {WARRANTY_CLAIM_TYPE_OPTIONS.find((option) => option.value === claim.type)?.label} claim
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
              disabled={isBusy || !canSubmitClaim(draft)}
              title={canSubmitClaim(draft) ? undefined : "Needs a complaint, a claimed amount above zero and at least one line"}
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
              disabled={!contentEditable}
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
              disabled={!contentEditable}
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
              disabled={!contentEditable}
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
                disabled={!contentEditable}
                aria-invalid={!amount.valid}
                onChange={(event) => updateDraft({ claimedAmount: event.target.value })}
                placeholder="0,00"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateDraft({ claimedAmount: linesTotal.toFixed(2) })}
                disabled={!contentEditable || draft.lineItemIds.length === 0}
              >
                Use lines total
              </Button>
            </div>
            {!amount.valid && (
              <p className="text-sm text-red-600">Enter an amount in EUR with at most two decimals.</p>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Affected labor and parts</Label>
            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-slate-500">
                No labor or part lines on this order yet. Add lines to a task first.
              </p>
            ) : (
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {lines.map((line) => {
                  const claimedBy = lineClaimedElsewhere.get(line.id);
                  const checked = draft.lineItemIds.includes(line.id);
                  const disabled = !contentEditable || (Boolean(claimedBy) && !checked);
                  return (
                    <li key={line.id} className="flex items-start gap-3 px-3 py-2.5">
                      <Checkbox
                        id={`warranty-line-${line.id}`}
                        className="mt-1"
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(value) => toggleLine(line.id, value === true)}
                        aria-label={`Include ${line.itemNo} ${line.description}`}
                      />
                      <label htmlFor={`warranty-line-${line.id}`} className="flex-1 space-y-0.5 text-sm">
                        <span className="block font-medium text-slate-900">
                          {line.itemNo} · {line.description}
                        </span>
                        <span className="block text-slate-500">
                          {line.type === "LABOR" ? "Labor" : "Part"} · {line.taskTitle} · {line.quantity} ×{" "}
                          {formatEur(line.unitPrice)} = {formatEur(line.netAmount)}
                        </span>
                        {claimedBy && (
                          <span className="block text-xs text-amber-700">Already on {claimedBy}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-sm text-slate-600">
              Selected lines (net): <span className="font-medium tabular-nums">{formatEur(linesTotal)}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="warranty-claim-reference">Reference at the OEM</Label>
            <Input
              id="warranty-claim-reference"
              value={draft.externalReference}
              maxLength={120}
              disabled={!metadataEditable}
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
                disabled={!metadataEditable}
                onChange={(event) => updateDraft({ decisionDate: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warranty-claim-decision-note">Decision note</Label>
              <Input
                id="warranty-claim-decision-note"
                value={draft.decisionNote}
                maxLength={2000}
                disabled={!metadataEditable}
                onChange={(event) => updateDraft({ decisionNote: event.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      <WarrantyClaimDecisionDialog
        outcome={decisionOutcome}
        isSubmitting={busyAction === decisionOutcome}
        onOpenChange={(open) => {
          if (!open) setDecisionOutcome(null);
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
