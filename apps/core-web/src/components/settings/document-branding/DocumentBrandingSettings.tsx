import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DEFAULT_DOCUMENT_BRAND_THEME,
  documentBrandAssetUploadErrorMessage,
  useConfirmDocumentBranding,
  useDiscardDocumentBrandDraft,
  useDocumentBrandProfile,
  useDocumentBrandAsset,
  usePreviewDocumentBranding,
  useSaveDocumentBrandDraft,
  useUploadDocumentBrandAsset,
  type DocumentBrandTheme,
} from "@/api/document-branding";
import {
  countDecorativeTextCodePoints,
  hasDocumentBrandThemeFieldErrors,
  validateDocumentBrandThemeFields,
} from "@/api/document-branding-theme-validation";
import { getErrorStatus } from "@/lib/error-utils";
import { LetterheadImport } from "./LetterheadImport";
import { LetterheadSourceAsset } from "./LetterheadSourceAsset";
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedAutoSave } from "@/hooks/useDebouncedAutoSave";
import { generateId } from "@/lib/id";
import type { LegalEntityRecord } from "@/api/site-admin";

export function DocumentBrandingSettings({
  entity,
}: {
  entity: LegalEntityRecord;
}) {
  const { t } = useTranslation("settings");
  const {
    data: profile,
    isLoading,
    error,
    refetch: refetchProfile,
  } = useDocumentBrandProfile(entity.id);
  const decorativeTextMaxCodePoints =
    profile?.capabilities.theme.decorativeTextMaxCodePoints ?? 120;
  const uploadCapabilities = profile?.capabilities.uploads;
  const saveDraft = useSaveDocumentBrandDraft();
  const confirm = useConfirmDocumentBranding("confirm");
  const reset = useConfirmDocumentBranding("reset");
  const discard = useDiscardDocumentBrandDraft();
  const preview = usePreviewDocumentBranding();
  const assetUpload = useUploadDocumentBrandAsset();
  const [pendingLogoId, setPendingLogoId] = React.useState<string | null>(null);
  const logoAsset = useDocumentBrandAsset(entity.id, pendingLogoId);
  const draftSourceAssetQuery = useDocumentBrandAsset(
    entity.id,
    profile?.draftSourceAssetId ?? null,
  );
  const extractionSourceId =
    draftSourceAssetQuery.data?.state === "READY"
      ? draftSourceAssetQuery.data.id
      : profile?.draftSourceAsset?.state === "READY"
        ? profile.draftSourceAssetId
        : null;
  const revisionRef = React.useRef(0);
  const entityIdRef = React.useRef(entity.id);
  const recoveryRequestRef = React.useRef(0);

  React.useEffect(() => {
    entityIdRef.current = entity.id;
  }, [entity.id]);
  const activeEntityIdRef = React.useRef("");
  const previousEntityIdRef = React.useRef(entity.id);
  const [theme, setTheme] = React.useState<DocumentBrandTheme | null>(null);
  const [savedTheme, setSavedTheme] = React.useState<DocumentBrandTheme | null>(
    null,
  );
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [revisionConflict, setRevisionConflict] = React.useState(false);
  const [reapplyingConflict, setReapplyingConflict] = React.useState(false);
  const [needsPostConflictAutosave, setNeedsPostConflictAutosave] =
    React.useState(false);
  const themeRef = React.useRef<DocumentBrandTheme | null>(null);

  React.useEffect(() => {
    if (!profile) return;
    if (activeEntityIdRef.current !== entity.id || theme === null) {
      revisionRef.current = profile.revision;
      const initialTheme = profile.draftTheme ?? profile.activeTheme;
      setTheme(initialTheme);
      setSavedTheme(initialTheme);
      activeEntityIdRef.current = entity.id;
    }
  }, [entity.id, profile, theme]);

  React.useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const save = React.useCallback(
    async (snapshot: DocumentBrandTheme, signal: AbortSignal) => {
      const updated = await saveDraft.mutateAsync({
        legalEntityId: entity.id,
        expectedRevision: revisionRef.current,
        theme: snapshot,
        signal,
      });
      revisionRef.current = updated.revision;
      setSavedTheme(updated.draftTheme);
      setDraftError(null);
      setRevisionConflict(false);
    },
    [entity.id, saveDraft],
  );
  const themeFieldErrors = React.useMemo(
    () =>
      theme
        ? validateDocumentBrandThemeFields(theme, decorativeTextMaxCodePoints)
        : {},
    [theme, decorativeTextMaxCodePoints],
  );
  const hasThemeValidationErrors = hasDocumentBrandThemeFieldErrors(
    themeFieldErrors,
  );
  const {
    saveStatus,
    triggerAutoSave,
    clearPendingSave,
    abortInFlightSave,
    markIdle,
    markSaved,
  } = useDebouncedAutoSave({
      enabled: Boolean(theme) && entity.is_active && !revisionConflict,
      debounceMs: 750,
      save,
      shouldSave: (snapshot) => {
        if (
          hasDocumentBrandThemeFieldErrors(
            validateDocumentBrandThemeFields(
              snapshot,
              decorativeTextMaxCodePoints,
            ),
          )
        ) {
          return false;
        }
        return JSON.stringify(snapshot) !== JSON.stringify(savedTheme);
      },
      onError: (saveError) => {
        const status = getErrorStatus(saveError);
        if (status === 409) {
          setRevisionConflict(true);
        }
        const message =
          saveError instanceof Error
            ? saveError.message
            : t("documentBranding.toast.draftValidationFallback");
        setDraftError(message);
        toast.error(t("documentBranding.toast.saveFailed"), {
          description: message,
        });
      },
    });

  React.useEffect(() => {
    if (
      !needsPostConflictAutosave ||
      revisionConflict ||
      reapplyingConflict ||
      !theme
    ) {
      return;
    }
    setNeedsPostConflictAutosave(false);
    void triggerAutoSave(theme);
  }, [
    needsPostConflictAutosave,
    revisionConflict,
    reapplyingConflict,
    theme,
    triggerAutoSave,
  ]);

  const themeEditingDisabled = !entity.is_active || reapplyingConflict;

  const recoveryStillCurrent = React.useCallback(
    (requestId: number, entityId: string) =>
      requestId === recoveryRequestRef.current &&
      entityIdRef.current === entityId,
    [],
  );

  React.useEffect(() => {
    if (previousEntityIdRef.current === entity.id) return;
    previousEntityIdRef.current = entity.id;
    recoveryRequestRef.current += 1;
    setReapplyingConflict(false);
    setNeedsPostConflictAutosave(false);
    clearPendingSave();
    abortInFlightSave();
    setTheme(null);
    setSavedTheme(null);
    setPendingLogoId(null);
    activeEntityIdRef.current = "";
    revisionRef.current = 0;
    setDraftError(null);
    setRevisionConflict(false);
  }, [entity.id, clearPendingSave, abortInFlightSave]);

  const applyProfileTheme = React.useCallback(
    (nextProfile: NonNullable<typeof profile>) => {
      revisionRef.current = nextProfile.revision;
      const nextTheme = nextProfile.draftTheme ?? nextProfile.activeTheme;
      setTheme(nextTheme);
      setSavedTheme(nextTheme);
      setDraftError(null);
      setRevisionConflict(false);
    },
    [],
  );

  const reloadLatestBranding = React.useCallback(async () => {
    const requestId = ++recoveryRequestRef.current;
    const entityId = entity.id;
    setReapplyingConflict(true);
    clearPendingSave();
    abortInFlightSave();
    try {
      const result = await refetchProfile();
      if (!recoveryStillCurrent(requestId, entityId)) return;
      if (!result.isSuccess || !result.data) {
        const message =
          result.error instanceof Error
            ? result.error.message
            : t("documentBranding.toast.loadLatestFallback");
        setDraftError(message);
        toast.error(t("documentBranding.toast.reloadFailed"), {
          description: message,
        });
        return;
      }
      applyProfileTheme(result.data);
      markIdle();
      toast.message(t("documentBranding.toast.reloaded"));
    } finally {
      if (recoveryStillCurrent(requestId, entityId)) {
        setReapplyingConflict(false);
      }
    }
  }, [
    abortInFlightSave,
    applyProfileTheme,
    clearPendingSave,
    entity.id,
    markIdle,
    recoveryStillCurrent,
    refetchProfile,
    t,
  ]);

  const reapplyEditsOnLatestRevision = React.useCallback(async () => {
    const themeToSave = themeRef.current;
    if (!themeToSave) return;
    const requestId = ++recoveryRequestRef.current;
    const entityId = entity.id;
    setReapplyingConflict(true);
    clearPendingSave();
    abortInFlightSave();
    try {
      const result = await refetchProfile();
      if (!recoveryStillCurrent(requestId, entityId)) return;
      if (!result.isSuccess || !result.data) {
        throw new Error(
          result.error instanceof Error
            ? result.error.message
            : t("documentBranding.toast.loadLatestFallback"),
        );
      }
      if (!recoveryStillCurrent(requestId, entityId)) return;
      revisionRef.current = result.data.revision;
      const updated = await saveDraft.mutateAsync({
        legalEntityId: entityId,
        expectedRevision: revisionRef.current,
        theme: themeRef.current ?? themeToSave,
      });
      if (!recoveryStillCurrent(requestId, entityId)) return;
      revisionRef.current = updated.revision;
      const persistedTheme = updated.draftTheme ?? themeRef.current ?? themeToSave;
      setSavedTheme(persistedTheme);
      setDraftError(null);
      setRevisionConflict(false);
      setNeedsPostConflictAutosave(true);
      markSaved();
      toast.success(t("documentBranding.toast.reapplied"));
    } catch (reapplyError) {
      if (!recoveryStillCurrent(requestId, entityId)) return;
      const message =
        reapplyError instanceof Error
          ? reapplyError.message
          : t("documentBranding.toast.reapplyFallback");
      setDraftError(message);
      toast.error(t("documentBranding.toast.saveFailed"), {
        description: message,
      });
    } finally {
      if (recoveryStillCurrent(requestId, entityId)) {
        setReapplyingConflict(false);
      }
    }
  }, [
    abortInFlightSave,
    clearPendingSave,
    entity.id,
    markSaved,
    recoveryStillCurrent,
    refetchProfile,
    saveDraft,
    t,
  ]);

  const updateTheme = React.useCallback(
    (field: keyof DocumentBrandTheme, value: string | null) => {
      setTheme((current) => {
        if (!current) return current;
        const next = { ...current, [field]: value } as DocumentBrandTheme;
        preview.reset();
        void triggerAutoSave(next);
        return next;
      });
    },
    [preview, triggerAutoSave],
  );

  React.useEffect(() => {
    if (!logoAsset.data || logoAsset.data.state === "QUARANTINED") return;
    if (logoAsset.data.state === "READY") {
      updateTheme("logoAssetId", logoAsset.data.id);
      toast.success(t("documentBranding.toast.logoValidated"));
    } else if (logoAsset.data.state === "REJECTED") {
      toast.error(t("documentBranding.toast.logoRejected"), {
        description: logoAsset.data.failureCode ?? undefined,
      });
    }
    setPendingLogoId(null);
  }, [logoAsset.data, t, updateTheme]);

  const confirmDraft = async () => {
    if (!profile || !theme) return;
    clearPendingSave();
    try {
      if (JSON.stringify(theme) !== JSON.stringify(savedTheme)) {
        const draft = await saveDraft.mutateAsync({
          legalEntityId: entity.id,
          expectedRevision: revisionRef.current,
          theme,
        });
        revisionRef.current = draft.revision;
        setSavedTheme(draft.draftTheme);
      }
      const updated = await confirm.mutateAsync({
        legalEntityId: entity.id,
        expectedRevision: revisionRef.current,
        idempotencyKey: generateId(),
      });
      revisionRef.current = updated.revision;
      setSavedTheme(updated.activeTheme);
      setTheme(updated.activeTheme);
      toast.success(t("documentBranding.toast.confirmed"));
    } catch (confirmError) {
      toast.error(t("documentBranding.toast.confirmFailed"), {
        description:
          confirmError instanceof Error
            ? confirmError.message
            : t("documentBranding.toast.reviewDraftFallback"),
      });
    }
  };

  const applyProposal = async (
    proposal: DocumentBrandTheme,
    extractionId: string,
  ) => {
    try {
      const updated = await saveDraft.mutateAsync({
        legalEntityId: entity.id,
        expectedRevision: revisionRef.current,
        theme: proposal,
        extractionId,
      });
      revisionRef.current = updated.revision;
      setTheme(updated.draftTheme ?? proposal);
      setSavedTheme(updated.draftTheme ?? proposal);
      setDraftError(null);
      preview.reset();
      toast.success(t("documentBranding.toast.suggestionsSaved"), {
        description: t("documentBranding.toast.suggestionsSavedDescription"),
      });
    } catch (applyError) {
      toast.error(t("documentBranding.toast.proposalFailed"), {
        description:
          applyError instanceof Error
            ? applyError.message
            : t("documentBranding.toast.proposalFallback"),
      });
    }
  };

  const resetToDefaults = async () => {
    if (
      !profile ||
      !window.confirm(t("documentBranding.confirmReset"))
    )
      return;
    try {
      const updated = await reset.mutateAsync({
        legalEntityId: entity.id,
        expectedRevision: revisionRef.current,
        idempotencyKey: generateId(),
      });
      revisionRef.current = updated.revision;
      setTheme(DEFAULT_DOCUMENT_BRAND_THEME);
      setSavedTheme(DEFAULT_DOCUMENT_BRAND_THEME);
      toast.success(t("documentBranding.toast.defaultsConfirmed"));
    } catch (resetError) {
      toast.error(t("documentBranding.toast.defaultsFailed"), {
        description:
          resetError instanceof Error
            ? resetError.message
            : t("documentBranding.toast.reviewRevisionFallback"),
      });
    }
  };

  const discardDraft = async () => {
    if (
      !profile ||
      !window.confirm(t("documentBranding.confirmDiscard"))
    )
      return;
    clearPendingSave();
    abortInFlightSave();
    try {
      const updated = await discard.mutateAsync({
        legalEntityId: entity.id,
        expectedRevision: revisionRef.current,
      });
      revisionRef.current = updated.revision;
      setTheme(updated.activeTheme);
      setSavedTheme(updated.activeTheme);
      toast.success(t("documentBranding.toast.draftDiscarded"));
    } catch (discardError) {
      toast.error(t("documentBranding.toast.discardFailed"), {
        description:
          discardError instanceof Error
            ? discardError.message
            : t("documentBranding.toast.reviewRevisionFallback"),
      });
    }
  };

  const createPreview = async () => {
    if (!theme) return;
    try {
      await preview.mutateAsync({
        legalEntityId: entity.id,
        theme,
        sample: entity.country_iso === "AT" ? "AT_STANDARD" : "DE_STANDARD",
      });
    } catch (previewError) {
      toast.error(t("documentBranding.toast.previewFailed"), {
        description:
          previewError instanceof Error
            ? previewError.message
            : t("documentBranding.toast.tryAgain"),
      });
    }
  };

  const uploadAsset = async (
    purpose: "SOURCE" | "LOGO",
    file: File | undefined,
  ) => {
    if (!file) return;
    try {
      const asset = await assetUpload.mutateAsync({
        legalEntityId: entity.id,
        purpose,
        file,
      });
      if (purpose === "LOGO") setPendingLogoId(asset.id);
      toast.message(
        purpose === "LOGO"
          ? t("documentBranding.toast.logoUploaded")
          : t("documentBranding.toast.sourceUploaded"),
      );
    } catch (uploadError) {
      const constraints =
        purpose === "LOGO"
          ? uploadCapabilities?.logo
          : uploadCapabilities?.source;
      toast.error(
        purpose === "LOGO"
          ? t("documentBranding.toast.logoUploadFailed")
          : t("documentBranding.toast.sourceUploadFailed"),
        {
          description: documentBrandAssetUploadErrorMessage(
            purpose,
            uploadError,
            constraints,
          ),
        },
      );
    }
  };

  if (isLoading)
    return (
      <p className="text-sm text-slate-500">{t("documentBranding.loading")}</p>
    );
  if (error)
    return (
      <p role="alert" className="text-sm text-red-700">
        {t("documentBranding.loadFailed", { message: error.message })}
      </p>
    );
  if (!theme) return null;

  const hasUnsavedChanges =
    JSON.stringify(theme) !== JSON.stringify(savedTheme);
  const canConfirm =
    entity.is_active &&
    !saveDraft.isPending &&
    !confirm.isPending &&
    saveStatus !== "saving" &&
    !draftError &&
    !revisionConflict &&
    !hasThemeValidationErrors;

  return (
    <section
      className="space-y-4 rounded-lg border bg-white p-6"
      aria-labelledby="document-branding-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="document-branding-title" className="text-lg font-medium">
            {t("documentBranding.title")}
          </h3>
          <p className="text-sm text-slate-500">
            {t("documentBranding.subtitle")}
          </p>
        </div>
        <DocumentSaveIndicator
          status={hasThemeValidationErrors ? "idle" : saveStatus}
        />
      </div>

      {!entity.is_active ? (
        <p role="status" className="text-sm text-amber-800">
          {t("documentBranding.inactiveEntity")}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="brand-logo">{t("documentBranding.logo.label")}</Label>
          {uploadCapabilities?.logo.requirementLabel ? (
            <p className="text-xs text-slate-500">
              {uploadCapabilities.logo.requirementLabel}
            </p>
          ) : null}
          <Input
            id="brand-logo"
            type="file"
            accept={uploadCapabilities?.logo.accept ?? "image/png,.png"}
            disabled={
              themeEditingDisabled ||
              assetUpload.isPending ||
              Boolean(pendingLogoId)
            }
            onChange={(event) =>
              void uploadAsset("LOGO", event.target.files?.[0])
            }
          />
          {theme.logoAssetId ? (
            <p className="text-xs text-slate-500">
              {t("documentBranding.logo.selected", { id: theme.logoAssetId })}
            </p>
          ) : null}
          {theme.logoAssetId ? (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start px-0"
              disabled={themeEditingDisabled}
              onClick={() => updateTheme("logoAssetId", null)}
            >
              {t("documentBranding.logo.remove")}
            </Button>
          ) : null}
          {assetUpload.isPending || logoAsset.data?.state === "QUARANTINED" ? (
            <p role="status" className="text-sm text-slate-500">
              {t("documentBranding.logo.uploading")}
            </p>
          ) : null}
          {logoAsset.pollTimedOut ? (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start px-0"
              disabled={logoAsset.isFetching}
              onClick={() => void logoAsset.refetch()}
            >
              {t("documentBranding.logo.refreshStatus")}
            </Button>
          ) : null}
        </div>
        <LetterheadSourceAsset
          legalEntityId={entity.id}
          entityActive={entity.is_active}
          getExpectedRevision={() => revisionRef.current}
          draftSourceAssetId={profile?.draftSourceAssetId ?? null}
          initialAsset={profile?.draftSourceAsset ?? null}
          extractionAvailable={Boolean(profile?.capabilities.extractionAvailable)}
          onProfileUpdated={(updated) => {
            revisionRef.current = updated.revision;
          }}
        />
        <div className="sm:col-span-2">
          <LetterheadImport
            legalEntityId={entity.id}
            sourceAssetId={extractionSourceId}
            expectedRevision={profile?.revision ?? 0}
            enabled={
              Boolean(profile?.capabilities.extractionAvailable) &&
              !themeEditingDisabled
            }
            onApply={applyProposal}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-primary-color">{t("documentBranding.fields.primaryColor")}</Label>
          <Input
            id="brand-primary-color"
            type="color"
            value={theme.primaryColor}
            disabled={themeEditingDisabled}
            aria-invalid={Boolean(themeFieldErrors.primaryColor)}
            aria-describedby={
              themeFieldErrors.primaryColor
                ? "brand-primary-color-error"
                : undefined
            }
            onChange={(event) =>
              updateTheme("primaryColor", event.target.value.toUpperCase())
            }
          />
          {themeFieldErrors.primaryColor ? (
            <p
              id="brand-primary-color-error"
              role="alert"
              className="text-xs text-red-700"
            >
              {themeFieldErrors.primaryColor}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-secondary-color">{t("documentBranding.fields.secondaryColor")}</Label>
          <Input
            id="brand-secondary-color"
            type="color"
            value={theme.secondaryColor}
            disabled={themeEditingDisabled}
            aria-invalid={Boolean(themeFieldErrors.secondaryColor)}
            aria-describedby={
              themeFieldErrors.secondaryColor
                ? "brand-secondary-color-error"
                : undefined
            }
            onChange={(event) =>
              updateTheme("secondaryColor", event.target.value.toUpperCase())
            }
          />
          {themeFieldErrors.secondaryColor ? (
            <p
              id="brand-secondary-color-error"
              role="alert"
              className="text-xs text-red-700"
            >
              {themeFieldErrors.secondaryColor}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-header-band">{t("documentBranding.fields.headerBand")}</Label>
          <Select
            value={theme.headerBand}
            disabled={themeEditingDisabled}
            onValueChange={(value) => updateTheme("headerBand", value)}
          >
            <SelectTrigger id="brand-header-band">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("documentBranding.fields.bandNone")}</SelectItem>
              <SelectItem value="primary">{t("documentBranding.fields.bandPrimary")}</SelectItem>
              <SelectItem value="secondary">{t("documentBranding.fields.bandSecondary")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-footer-band">{t("documentBranding.fields.footerBand")}</Label>
          <Select
            value={theme.footerBand}
            disabled={themeEditingDisabled}
            onValueChange={(value) => updateTheme("footerBand", value)}
          >
            <SelectTrigger id="brand-footer-band">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("documentBranding.fields.bandNone")}</SelectItem>
              <SelectItem value="primary">{t("documentBranding.fields.bandPrimary")}</SelectItem>
              <SelectItem value="secondary">{t("documentBranding.fields.bandSecondary")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="brand-header-text">
              {t("documentBranding.fields.headerText", {
                max: decorativeTextMaxCodePoints,
              })}
            </Label>
            <span
              className="text-xs text-slate-500"
              aria-live="polite"
              id="brand-header-text-counter"
            >
              {countDecorativeTextCodePoints(theme.headerText)}/
              {decorativeTextMaxCodePoints}
            </span>
          </div>
          <textarea
            id="brand-header-text"
            maxLength={decorativeTextMaxCodePoints}
            rows={2}
            className="w-full rounded-md border border-input px-3 py-2 text-sm"
            value={theme.headerText}
            disabled={themeEditingDisabled}
            aria-invalid={Boolean(themeFieldErrors.headerText)}
            aria-describedby="brand-header-text-counter brand-header-text-error"
            onChange={(event) => updateTheme("headerText", event.target.value)}
          />
          {themeFieldErrors.headerText ? (
            <p
              id="brand-header-text-error"
              role="alert"
              className="text-xs text-red-700"
            >
              {themeFieldErrors.headerText}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="brand-footer-text">
              {t("documentBranding.fields.footerText", {
                max: decorativeTextMaxCodePoints,
              })}
            </Label>
            <span
              className="text-xs text-slate-500"
              aria-live="polite"
              id="brand-footer-text-counter"
            >
              {countDecorativeTextCodePoints(theme.footerText)}/
              {decorativeTextMaxCodePoints}
            </span>
          </div>
          <Input
            id="brand-footer-text"
            maxLength={decorativeTextMaxCodePoints}
            value={theme.footerText}
            disabled={themeEditingDisabled}
            aria-invalid={Boolean(themeFieldErrors.footerText)}
            aria-describedby="brand-footer-text-counter brand-footer-text-error"
            onChange={(event) => updateTheme("footerText", event.target.value)}
          />
          {themeFieldErrors.footerText ? (
            <p
              id="brand-footer-text-error"
              role="alert"
              className="text-xs text-red-700"
            >
              {themeFieldErrors.footerText}
            </p>
          ) : null}
        </div>
      </div>

      {revisionConflict ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p>
            {t("documentBranding.conflict.message")}
            {draftError ? ` ${draftError}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reapplyingConflict}
              onClick={() => void reloadLatestBranding()}
            >
              {t("documentBranding.conflict.reload")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={reapplyingConflict || hasThemeValidationErrors}
              onClick={() => void reapplyEditsOnLatestRevision()}
            >
              {reapplyingConflict
                ? t("documentBranding.conflict.reapplying")
                : t("documentBranding.conflict.keep")}
            </Button>
          </div>
        </div>
      ) : null}
      {draftError && !revisionConflict ? (
        <p role="alert" className="text-sm text-red-700">
          {t("documentBranding.draftFailed", { message: draftError })}
        </p>
      ) : null}
      <p role="status" className="text-sm text-slate-600">
        {[
          profile?.activeRevision
            ? t("documentBranding.status.activeRevision", {
                revision: profile.activeRevision,
              })
            : t("documentBranding.status.activeDefaults"),
          profile?.draftTheme
            ? t("documentBranding.status.draft")
            : t("documentBranding.status.noDraft"),
        ].join(" · ")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!entity.is_active || preview.isPending}
          onClick={() => void createPreview()}
        >
          {preview.isPending
            ? t("documentBranding.actions.preparingPreview")
            : t("documentBranding.actions.previewSample")}
        </Button>
        <Button
          type="button"
          disabled={!canConfirm || (!profile?.draftTheme && !hasUnsavedChanges)}
          onClick={() => void confirmDraft()}
        >
          {confirm.isPending
            ? t("documentBranding.actions.confirming")
            : t("documentBranding.actions.confirm")}
        </Button>
        {profile?.draftTheme ? (
          <Button
            type="button"
            variant="outline"
            disabled={!entity.is_active || discard.isPending}
            onClick={() => void discardDraft()}
          >
            {discard.isPending
              ? t("documentBranding.actions.discarding")
              : t("documentBranding.actions.discardDraft")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={!entity.is_active || reset.isPending}
          onClick={() => void resetToDefaults()}
        >
          {reset.isPending
            ? t("documentBranding.actions.resetting")
            : t("documentBranding.actions.confirmDefaults")}
        </Button>
      </div>
      {preview.data ? (
        <div className="overflow-hidden rounded-md border">
          {preview.data.warnings.length > 0 ? (
            <ul
              aria-label={t("documentBranding.preview.warningsAria")}
              className="list-disc px-8 py-3 text-sm text-amber-800"
            >
              {preview.data.warnings.map((warning) => (
                <li key={warning}>
                  {warning.replaceAll("_", " ").toLowerCase()}
                </li>
              ))}
            </ul>
          ) : null}
          <iframe
            title={t("documentBranding.preview.iframeTitle")}
            sandbox=""
            srcDoc={preview.data.html}
            className="h-[560px] w-full"
          />
        </div>
      ) : null}
    </section>
  );
}
