import * as React from "react";
import { useTranslation } from "react-i18next";
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
  pollingSuspended: boolean;
};

function restoreExtractionState(legalEntityId: string): ExtractionViewState {
  let extractionId: string | null = null;
  try {
    extractionId = sessionStorage.getItem(`${EXTRACTION_STORAGE_PREFIX}${legalEntityId}`);
  } catch {
    // The in-memory state still works when browser storage is unavailable.
  }
  return {
    legalEntityId,
    extractionId,
    polling: false,
    timedOut: false,
    startedAt: null,
    pollingSuspended: false,
  };
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
  const { t } = useTranslation("settings");
  const create = useCreateDocumentBrandExtraction();
  const discard = useDiscardDocumentBrandExtraction();
  const [viewState, setViewState] = React.useState(() =>
    restoreExtractionState(legalEntityId),
  );
  const scopedState = viewState.legalEntityId === legalEntityId
    ? viewState
    : restoreExtractionState(legalEntityId);
  const { extractionId, polling, timedOut, startedAt, pollingSuspended } =
    scopedState;
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
    if (polling || timedOut || pollingSuspended) return;
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
  }, [
    extraction.data,
    extractionId,
    legalEntityId,
    polling,
    pollingSuspended,
    timedOut,
    updateCurrentEntityState,
  ]);

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
        pollingSuspended: false,
        polling: job.state === "QUEUED" || job.state === "RUNNING",
      });
    } catch (error) {
      toast.error(t("documentBranding.letterheadImport.toast.startFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("documentBranding.letterheadImport.toast.tryLater"),
      });
    }
  };

  const refresh = async () => {
    updateCurrentEntityState({
      timedOut: false,
      startedAt: Date.now(),
      pollingSuspended: false,
      polling: true,
    });
    await extraction.refetch();
  };

  const discardProposal = async () => {
    if (!extractionId) return;
    try {
      await discard.mutateAsync({ legalEntityId, extractionId });
      updateCurrentEntityState({
        polling: false,
        timedOut: false,
        pollingSuspended: true,
      });
    } catch (error) {
      toast.error(t("documentBranding.letterheadImport.toast.discardFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("documentBranding.letterheadImport.toast.tryAgain"),
      });
    }
  };

  const job = extraction.data?.id === extractionId ? extraction.data : null;
  const pending = job?.state === "QUEUED" || job?.state === "RUNNING";
  const proposal = job?.state === "SUCCEEDED" ? job.proposal : null;

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">{t("documentBranding.letterheadImport.title")}</p>
      {!enabled ? (
        <p className="text-sm text-slate-500">
          {t("documentBranding.letterheadImport.unavailable")}
        </p>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={!sourceAssetId || create.isPending || !enabled}
            onClick={() => void start()}
          >
            {create.isPending
              ? t("documentBranding.letterheadImport.starting")
              : t("documentBranding.letterheadImport.extract")}
          </Button>
          {!sourceAssetId ? (
            <p className="text-xs text-slate-500">
              {t("documentBranding.letterheadImport.uploadFirst")}
            </p>
          ) : null}
        </>
      )}
      {job ? (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm text-slate-600">
            {t("documentBranding.letterheadImport.stateLine", {
              state: t(`documentBranding.letterheadImport.states.${job.state}`),
            })}
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
                {t("documentBranding.letterheadImport.useProposal")}
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
              {pending
                ? t("documentBranding.letterheadImport.discardExtraction")
                : t("documentBranding.letterheadImport.discardProposal")}
            </Button>
          ) : null}
          {pending && timedOut ? (
            <Button
              type="button"
              variant="link"
              disabled={extraction.isFetching}
              onClick={() => void refresh()}
            >
              {t("documentBranding.letterheadImport.refreshStatus")}
            </Button>
          ) : null}
          {job.state === "FAILED" || job.state === "DISCARDED" ? (
            <Button
              type="button"
              variant="link"
              disabled={!enabled || !sourceAssetId || create.isPending}
              onClick={() => void start()}
            >
              {t("documentBranding.letterheadImport.tryNew")}
            </Button>
          ) : null}
          {job.state === "SUCCEEDED" && job.baseRevision !== expectedRevision ? (
            <p role="status" className="text-sm text-amber-800">
              {t("documentBranding.letterheadImport.revisionChanged")}
            </p>
          ) : null}
        </div>
      ) : null}
      {extraction.error ? (
        <p role="alert" className="text-sm text-red-700">
          {t("documentBranding.letterheadImport.statusLoadFailed")}
        </p>
      ) : null}
    </div>
  );
}
