import * as React from "react";
import { toast } from "sonner";
import {
  useCreateDocumentBrandExtraction,
  useDiscardDocumentBrandExtraction,
  useDocumentBrandExtraction,
  type DocumentBrandTheme,
} from "@/api/document-branding";
import { Button } from "@/components/ui/button";
import { generateId } from "@/lib/id";

const POLL_LIMIT_MS = 2 * 60 * 1000;
const EXTRACTION_STORAGE_PREFIX = "acp.document-brand-extraction.";

type ExtractionViewState = {
  legalEntityId: string;
  extractionId: string | null;
  polling: boolean;
  timedOut: boolean;
  startedAt: number | null;
};

function restoreExtractionState(legalEntityId: string): ExtractionViewState {
  let extractionId: string | null = null;
  try {
    extractionId = sessionStorage.getItem(`${EXTRACTION_STORAGE_PREFIX}${legalEntityId}`);
  } catch {
    // The in-memory state still works when browser storage is unavailable.
  }
  return { legalEntityId, extractionId, polling: false, timedOut: false, startedAt: null };
}

function persistExtractionId(legalEntityId: string, extractionId: string) {
  try {
    sessionStorage.setItem(`${EXTRACTION_STORAGE_PREFIX}${legalEntityId}`, extractionId);
  } catch {
    // Keep the current extraction usable for this mount when storage is unavailable.
  }
}

export function LetterheadImport({
  legalEntityId,
  sourceAssetId,
  expectedRevision,
  enabled,
  onApply,
}: {
  legalEntityId: string;
  sourceAssetId: string | null;
  expectedRevision: number;
  enabled: boolean;
  onApply: (theme: DocumentBrandTheme, extractionId: string) => Promise<void>;
}) {
  const create = useCreateDocumentBrandExtraction();
  const discard = useDiscardDocumentBrandExtraction();
  const [viewState, setViewState] = React.useState(() =>
    restoreExtractionState(legalEntityId),
  );
  const scopedState = viewState.legalEntityId === legalEntityId
    ? viewState
    : restoreExtractionState(legalEntityId);
  const { extractionId, polling, timedOut, startedAt } = scopedState;
  const updateCurrentEntityState = React.useCallback(
    (update: Partial<ExtractionViewState>) => {
      setViewState((current) => {
        const ownerState = current.legalEntityId === legalEntityId
          ? current
          : restoreExtractionState(legalEntityId);
        return { ...ownerState, ...update, legalEntityId };
      });
    },
    [legalEntityId],
  );
  const extraction = useDocumentBrandExtraction(
    legalEntityId,
    extractionId,
    polling,
  );

  React.useEffect(() => {
    setViewState(restoreExtractionState(legalEntityId));
  }, [legalEntityId]);

  React.useEffect(() => {
    const job = extraction.data;
    if (
      !extractionId ||
      job?.id !== extractionId
    ) {
      return;
    }
    if (job.state !== "QUEUED" && job.state !== "RUNNING") {
      if (polling) updateCurrentEntityState({ polling: false });
      return;
    }
    if (polling || timedOut) return;
    setViewState((current) => {
      const ownerState = current.legalEntityId === legalEntityId
        ? current
        : restoreExtractionState(legalEntityId);
      return {
        ...ownerState,
        polling: true,
        timedOut: false,
        startedAt: ownerState.startedAt ?? Date.now(),
      };
    });
  }, [extraction.data, extractionId, legalEntityId, polling, timedOut, updateCurrentEntityState]);

  React.useEffect(() => {
    if (!polling || !extractionId) return;
    const began = startedAt;
    if (began === null) return;
    const remaining = Math.max(0, POLL_LIMIT_MS - (Date.now() - began));
    if (remaining === 0) {
      updateCurrentEntityState({ polling: false, timedOut: true });
      return;
    }
    const timer = setTimeout(() => {
      updateCurrentEntityState({ polling: false, timedOut: true });
    }, remaining);
    return () => clearTimeout(timer);
  }, [extractionId, legalEntityId, polling, startedAt, updateCurrentEntityState]);

  const start = async () => {
    if (!sourceAssetId) return;
    try {
      const job = await create.mutateAsync({
        legalEntityId,
        sourceAssetId,
        expectedRevision,
        idempotencyKey: generateId(),
      });
      persistExtractionId(legalEntityId, job.id);
      updateCurrentEntityState({
        extractionId: job.id,
        startedAt: Date.now(),
        timedOut: false,
        polling: job.state === "QUEUED" || job.state === "RUNNING",
      });
    } catch (error) {
      toast.error("Letterhead extraction could not be started", {
        description: error instanceof Error ? error.message : "Try again later.",
      });
    }
  };

  const refresh = async () => {
    updateCurrentEntityState({
      timedOut: false,
      startedAt: Date.now(),
      polling: true,
    });
    await extraction.refetch();
  };

  const discardProposal = async () => {
    if (!extractionId) return;
    try {
      await discard.mutateAsync({ legalEntityId, extractionId });
      updateCurrentEntityState({ polling: false, timedOut: false });
    } catch (error) {
      toast.error("Extraction could not be discarded", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  };

  const job = extraction.data?.id === extractionId ? extraction.data : null;
  const pending = job?.state === "QUEUED" || job?.state === "RUNNING";
  const proposal = job?.state === "SUCCEEDED" ? job.proposal : null;

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Letterhead suggestions</p>
      {!enabled ? (
        <p className="text-sm text-slate-500">
          Assisted extraction is unavailable. You can configure the profile manually.
        </p>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={!sourceAssetId || create.isPending || !enabled}
            onClick={() => void start()}
          >
            {create.isPending ? "Starting…" : "Extract suggestions"}
          </Button>
          {!sourceAssetId ? (
            <p className="text-xs text-slate-500">
              Upload and validate a PDF or PNG letterhead first.
            </p>
          ) : null}
        </>
      )}
      {job ? (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm text-slate-600">
            Extraction: {job.state.toLowerCase()}
            {job.failureCode ? ` · ${job.failureCode}` : ""}
          </p>
          {job.warnings.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-amber-800">
              {job.warnings.map((warning) => (
                <li key={warning}>{warning.replaceAll("_", " ").toLowerCase()}</li>
              ))}
            </ul>
          ) : null}
          {proposal ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!enabled || !proposal || job.baseRevision !== expectedRevision}
                onClick={() => void onApply(proposal, job.id)}
              >
                Use proposal in draft
              </Button>
            </div>
          ) : null}
          {pending || proposal ? (
            <Button
              type="button"
              variant="outline"
              disabled={discard.isPending}
              onClick={() => void discardProposal()}
            >
              {pending ? "Discard extraction" : "Discard proposal"}
            </Button>
          ) : null}
          {pending && timedOut ? (
            <Button
              type="button"
              variant="link"
              disabled={extraction.isFetching}
              onClick={() => void refresh()}
            >
              Refresh extraction status
            </Button>
          ) : null}
          {job.state === "FAILED" || job.state === "DISCARDED" ? (
            <Button
              type="button"
              variant="link"
              disabled={!enabled || !sourceAssetId || create.isPending}
              onClick={() => void start()}
            >
              Try a new extraction
            </Button>
          ) : null}
          {job.state === "SUCCEEDED" && job.baseRevision !== expectedRevision ? (
            <p role="status" className="text-sm text-amber-800">
              The profile changed after this extraction started. Start a new extraction from the current revision.
            </p>
          ) : null}
        </div>
      ) : null}
      {extraction.error ? (
        <p role="alert" className="text-sm text-red-700">
          Extraction status could not be loaded. Refresh to try again.
        </p>
      ) : null}
    </div>
  );
}
