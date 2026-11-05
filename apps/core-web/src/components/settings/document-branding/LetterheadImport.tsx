import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCreateDocumentBrandExtraction,
  useDiscardDocumentBrandExtraction,
  useDocumentBrandExtraction,
  type DocumentBrandExtraction,
  type DocumentBrandTheme,
} from "@/api/document-branding";
import { Button } from "@/components/ui/button";
import { describeBrandAssetFailure } from "./letterhead-source-messages";
import { getErrorMessage } from "@/lib/error-utils";
import { translateEnumWithGenericFallback } from "@/lib/i18n/enum-labels";
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

function isUnfinished(state: DocumentBrandExtraction["state"]): boolean {
  return state === "QUEUED" || state === "RUNNING";
}

function isRetryableState(state: DocumentBrandExtraction["state"]): boolean {
  return state === "FAILED" || state === "DISCARDED";
}

function extractionWarningLabel(warning: string): string {
  return translateEnumWithGenericFallback("documentBrandExtractionWarning", warning);
}

type ExtractionFlow = {
  job: DocumentBrandExtraction | null;
  timedOut: boolean;
  statusLoadFailed: boolean;
  statusFetching: boolean;
  starting: boolean;
  discarding: boolean;
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  discard: () => Promise<void>;
};

/**
 * Start, poll and discard the letterhead extraction. The extraction id survives a remount through
 * `sessionStorage`; polling only resumes for a job the backend still reports as unfinished.
 */
function useExtractionFlow({
  legalEntityId,
  sourceAssetId,
  expectedRevision,
}: {
  legalEntityId: string;
  sourceAssetId: string | null;
  expectedRevision: number;
}): ExtractionFlow {
  const { t } = useTranslation("settings");
  const create = useCreateDocumentBrandExtraction();
  const discard = useDiscardDocumentBrandExtraction();
  const [viewState, setViewState] = React.useState(() =>
    restoreExtractionState(legalEntityId),
  );
  const scopedState = viewState.legalEntityId === legalEntityId
    ? viewState
    : restoreExtractionState(legalEntityId);
  const { extractionId, polling, timedOut, startedAt, pollingSuspended } = scopedState;
  const stateForCurrentEntity = React.useCallback(
    (current: ExtractionViewState): ExtractionViewState =>
      current.legalEntityId === legalEntityId
        ? current
        : restoreExtractionState(legalEntityId),
    [legalEntityId],
  );
  const updateCurrentEntityState = React.useCallback(
    (update: Partial<ExtractionViewState>) => {
      setViewState((current) => ({
        ...stateForCurrentEntity(current),
        ...update,
        legalEntityId,
      }));
    },
    [legalEntityId, stateForCurrentEntity],
  );
  const extraction = useDocumentBrandExtraction(legalEntityId, extractionId, polling);

  React.useEffect(() => {
    setViewState(restoreExtractionState(legalEntityId));
  }, [legalEntityId]);

  React.useEffect(() => {
    const job = extraction.data;
    if (!extractionId || job?.id !== extractionId) return;
    if (!isUnfinished(job.state)) {
      if (polling) updateCurrentEntityState({ polling: false });
      return;
    }
    if (polling || timedOut || pollingSuspended) return;
    setViewState((current) => {
      const ownerState = stateForCurrentEntity(current);
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
    stateForCurrentEntity,
    timedOut,
    updateCurrentEntityState,
  ]);

  React.useEffect(() => {
    if (!polling || !extractionId || startedAt === null) return;
    const remaining = Math.max(0, POLL_LIMIT_MS - (Date.now() - startedAt));
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
        polling: isUnfinished(job.state),
      });
    } catch (error) {
      toast.error(t("documentBranding.letterheadImport.toast.startFailed"), {
        description: getErrorMessage(
          error,
          t("documentBranding.letterheadImport.toast.tryLater"),
        ),
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
        description: getErrorMessage(
          error,
          t("documentBranding.letterheadImport.toast.tryAgain"),
        ),
      });
    }
  };

  return {
    job: extraction.data?.id === extractionId ? extraction.data : null,
    timedOut,
    statusLoadFailed: Boolean(extraction.error),
    statusFetching: extraction.isFetching,
    starting: create.isPending,
    discarding: discard.isPending,
    start,
    refresh,
    discard: discardProposal,
  };
}

function ExtractionStatusLine({
  state,
  failureLabel,
}: {
  state: DocumentBrandExtraction["state"];
  failureLabel: string;
}) {
  const { t } = useTranslation("settings");
  return (
    <p className="text-sm text-muted-foreground">
      {t("documentBranding.letterheadImport.stateLine", {
        state: t(`documentBranding.letterheadImport.states.${state}`),
      })}
      {failureLabel ? ` · ${failureLabel}` : ""}
    </p>
  );
}

function ExtractionWarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="list-disc pl-5 text-xs text-warning">
      {warnings.map((warning) => (
        <li key={warning}>{extractionWarningLabel(warning)}</li>
      ))}
    </ul>
  );
}

type JobActionButton = {
  id: string;
  label: string;
  variant?: "default" | "outline" | "link";
  disabled: boolean;
  onClick: () => void;
};

/** Everything the action list needs to decide which buttons exist and whether they are usable. */
type JobActionInput = {
  pending: boolean;
  proposal: DocumentBrandTheme | null;
  retryable: boolean;
  revisionChanged: boolean;
  editable: boolean;
  canRetry: boolean;
  timedOut: boolean;
  discarding: boolean;
  statusFetching: boolean;
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  discard: () => Promise<void>;
  apply: (theme: DocumentBrandTheme) => Promise<void>;
};

/**
 * Buttons offered for the current job: a proposal can be applied or discarded, a polling run that
 * hit its cap can be refreshed, and a finished-without-proposal job can be started again.
 */
function extractionJobActions(
  job: JobActionInput,
  labels: { apply: string; discard: string; refresh: string; retry: string },
): JobActionButton[] {
  const actions: JobActionButton[] = [];
  const proposal = job.proposal;
  if (proposal) {
    actions.push({
      id: "apply",
      label: labels.apply,
      disabled: !job.editable || job.revisionChanged,
      onClick: () => void job.apply(proposal),
    });
  }
  if (job.pending || proposal) {
    actions.push({
      id: "discard",
      label: labels.discard,
      variant: "outline",
      disabled: job.discarding,
      onClick: () => void job.discard(),
    });
  }
  if (job.pending && job.timedOut) {
    actions.push({
      id: "refresh",
      label: labels.refresh,
      variant: "link",
      disabled: job.statusFetching,
      onClick: () => void job.refresh(),
    });
  }
  if (job.retryable) {
    actions.push({
      id: "retry",
      label: labels.retry,
      variant: "link",
      disabled: !job.canRetry,
      onClick: () => void job.start(),
    });
  }
  return actions;
}

function ExtractionRevisionNotice({ visible }: { visible: boolean }) {
  const { t } = useTranslation("settings");
  if (!visible) return null;
  return (
    <p role="status" className="text-sm text-warning">
      {t("documentBranding.letterheadImport.revisionChanged")}
    </p>
  );
}

function ExtractionJobPanel({
  job,
  enabled,
  expectedRevision,
  sourceAssetId,
  flow,
  onApply,
}: {
  job: DocumentBrandExtraction;
  enabled: boolean;
  expectedRevision: number;
  sourceAssetId: string | null;
  flow: ExtractionFlow;
  onApply: (theme: DocumentBrandTheme, extractionId: string) => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const succeeded = job.state === "SUCCEEDED";
  const revisionChanged = job.baseRevision !== expectedRevision;
  const jobInput: JobActionInput = {
    pending: isUnfinished(job.state),
    proposal: succeeded ? job.proposal : null,
    retryable: isRetryableState(job.state),
    revisionChanged,
    editable: enabled,
    canRetry: enabled && sourceAssetId !== null && !flow.starting,
    timedOut: flow.timedOut,
    discarding: flow.discarding,
    statusFetching: flow.statusFetching,
    start: flow.start,
    refresh: flow.refresh,
    discard: flow.discard,
    apply: (theme) => onApply(theme, job.id),
  };
  const actions = extractionJobActions(jobInput, {
    apply: t("documentBranding.letterheadImport.useProposal"),
    discard: t(
      jobInput.pending
        ? "documentBranding.letterheadImport.discardExtraction"
        : "documentBranding.letterheadImport.discardProposal",
    ),
    refresh: t("documentBranding.letterheadImport.refreshStatus"),
    retry: t("documentBranding.letterheadImport.tryNew"),
  });

  return (
    <div className="space-y-2" aria-live="polite">
      <ExtractionStatusLine
        state={job.state}
        failureLabel={describeBrandAssetFailure(job.failureCode, "")}
      />
      <ExtractionWarningList warnings={job.warnings} />
      {actions.map(({ id, label, ...buttonProps }) => (
        <Button key={id} type="button" {...buttonProps}>
          {label}
        </Button>
      ))}
      <ExtractionRevisionNotice visible={succeeded && revisionChanged} />
    </div>
  );
}

function ExtractionStartControl({
  sourceAssetId,
  starting,
  onStart,
}: {
  sourceAssetId: string | null;
  starting: boolean;
  onStart: () => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={!sourceAssetId || starting}
        onClick={() => void onStart()}
      >
        {starting
          ? t("documentBranding.letterheadImport.starting")
          : t("documentBranding.letterheadImport.extract")}
      </Button>
      {!sourceAssetId ? (
        <p className="text-xs text-muted-foreground">
          {t("documentBranding.letterheadImport.uploadFirst")}
        </p>
      ) : null}
    </>
  );
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
  const flow = useExtractionFlow({ legalEntityId, sourceAssetId, expectedRevision });

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">{t("documentBranding.letterheadImport.title")}</p>
      {enabled ? (
        <ExtractionStartControl
          sourceAssetId={sourceAssetId}
          starting={flow.starting}
          onStart={flow.start}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("documentBranding.letterheadImport.unavailable")}
        </p>
      )}
      {flow.job ? (
        <ExtractionJobPanel
          job={flow.job}
          enabled={enabled}
          expectedRevision={expectedRevision}
          sourceAssetId={sourceAssetId}
          flow={flow}
          onApply={onApply}
        />
      ) : null}
      {flow.statusLoadFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("documentBranding.letterheadImport.statusLoadFailed")}
        </p>
      ) : null}
    </div>
  );
}
