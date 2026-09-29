import * as React from "react";
import { toast } from "sonner";
import {
  DEFAULT_DOCUMENT_BRAND_THEME,
  useConfirmDocumentBranding,
  useDiscardDocumentBrandDraft,
  useDocumentBrandProfile,
  useDocumentBrandAsset,
  usePreviewDocumentBranding,
  useSaveDocumentBrandDraft,
  useUploadDocumentBrandAsset,
  type DocumentBrandTheme,
} from "@/api/document-branding";
import { LetterheadImport } from "./LetterheadImport";
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

const READY_SOURCE_STORAGE_PREFIX = "acp.document-brand-source.";

function readReadySourceId(legalEntityId: string): string | null {
  try {
    return sessionStorage.getItem(`${READY_SOURCE_STORAGE_PREFIX}${legalEntityId}`);
  } catch {
    return null;
  }
}

function persistReadySourceId(legalEntityId: string, assetId: string | null) {
  try {
    const key = `${READY_SOURCE_STORAGE_PREFIX}${legalEntityId}`;
    if (assetId) sessionStorage.setItem(key, assetId);
    else sessionStorage.removeItem(key);
  } catch {
    // The validated source remains available for the current mount.
  }
}

export function DocumentBrandingSettings({
  entity,
}: {
  entity: LegalEntityRecord;
}) {
  const {
    data: profile,
    isLoading,
    error,
  } = useDocumentBrandProfile(entity.id);
  const saveDraft = useSaveDocumentBrandDraft();
  const confirm = useConfirmDocumentBranding("confirm");
  const reset = useConfirmDocumentBranding("reset");
  const discard = useDiscardDocumentBrandDraft();
  const preview = usePreviewDocumentBranding();
  const assetUpload = useUploadDocumentBrandAsset();
  const [pendingLogoId, setPendingLogoId] = React.useState<string | null>(null);
  const [pendingSource, setPendingSource] = React.useState(() => ({
    legalEntityId: entity.id,
    assetId: null as string | null,
  }));
  const pendingSourceId = pendingSource.legalEntityId === entity.id
    ? pendingSource.assetId
    : null;
  const [readySource, setReadySource] = React.useState(() => ({
    legalEntityId: entity.id,
    assetId: readReadySourceId(entity.id),
  }));
  const readySourceId = readySource.legalEntityId === entity.id
    ? readySource.assetId
    : readReadySourceId(entity.id);
  const logoAsset = useDocumentBrandAsset(entity.id, pendingLogoId);
  const sourceAsset = useDocumentBrandAsset(entity.id, pendingSourceId);
  const revisionRef = React.useRef(0);
  const activeEntityIdRef = React.useRef("");
  const previousEntityIdRef = React.useRef(entity.id);
  const [theme, setTheme] = React.useState<DocumentBrandTheme | null>(null);
  const [savedTheme, setSavedTheme] = React.useState<DocumentBrandTheme | null>(
    null,
  );
  const [draftError, setDraftError] = React.useState<string | null>(null);

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
    },
    [entity.id, saveDraft],
  );
  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    useDebouncedAutoSave({
      enabled: Boolean(theme) && entity.is_active,
      debounceMs: 750,
      save,
      shouldSave: (snapshot) =>
        JSON.stringify(snapshot) !== JSON.stringify(savedTheme),
      onError: (saveError) => {
        const message =
          saveError instanceof Error
            ? saveError.message
            : "Draft validation or revision conflict.";
        setDraftError(message);
        toast.error("Document branding could not be saved", {
          description: message,
        });
      },
    });

  React.useEffect(() => {
    if (previousEntityIdRef.current === entity.id) return;
    previousEntityIdRef.current = entity.id;
    clearPendingSave();
    abortInFlightSave();
    setTheme(null);
    setSavedTheme(null);
    setPendingLogoId(null);
    setPendingSource({ legalEntityId: entity.id, assetId: null });
    setReadySource({
      legalEntityId: entity.id,
      assetId: readReadySourceId(entity.id),
    });
    activeEntityIdRef.current = "";
    revisionRef.current = 0;
  }, [entity.id, clearPendingSave, abortInFlightSave]);

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
      toast.success("Logo validated and added to the draft");
    } else if (logoAsset.data.state === "REJECTED") {
      toast.error("Logo file was rejected", {
        description: logoAsset.data.failureCode ?? undefined,
      });
    }
    setPendingLogoId(null);
  }, [logoAsset.data, updateTheme]);

  React.useEffect(() => {
    if (
      !sourceAsset.data ||
      sourceAsset.data.id !== pendingSourceId ||
      sourceAsset.data.state === "QUARANTINED"
    ) return;
    if (sourceAsset.data.state === "READY") {
      persistReadySourceId(entity.id, sourceAsset.data.id);
      setReadySource({ legalEntityId: entity.id, assetId: sourceAsset.data.id });
      toast.success("Source file validated and stored");
    } else if (sourceAsset.data.state === "REJECTED") {
      toast.error("Source file was rejected", {
        description: sourceAsset.data.failureCode ?? undefined,
      });
      persistReadySourceId(entity.id, null);
      setReadySource({ legalEntityId: entity.id, assetId: null });
    }
    setPendingSource({ legalEntityId: entity.id, assetId: null });
  }, [entity.id, pendingSourceId, sourceAsset.data]);

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
      toast.success("Document branding confirmed");
    } catch (confirmError) {
      toast.error("Document branding could not be confirmed", {
        description:
          confirmError instanceof Error
            ? confirmError.message
            : "Review the draft and try again.",
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
      toast.success("Suggestions saved to the draft", {
        description: "Review the draft and confirm it to use it on future invoices.",
      });
    } catch (applyError) {
      toast.error("Proposal could not be applied", {
        description:
          applyError instanceof Error
            ? applyError.message
            : "The profile revision changed. Start a new extraction.",
      });
    }
  };

  const resetToDefaults = async () => {
    if (
      !profile ||
      !window.confirm(
        "Confirm ACP default invoice branding for this legal entity? New invoices will use ACP defaults; previously issued invoices and PDFs will not change.",
      )
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
      toast.success("ACP default branding confirmed");
    } catch (resetError) {
      toast.error("Default branding could not be confirmed", {
        description:
          resetError instanceof Error
            ? resetError.message
            : "Review the current revision and try again.",
      });
    }
  };

  const discardDraft = async () => {
    if (
      !profile ||
      !window.confirm("Discard the saved document branding draft?")
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
      toast.success("Document branding draft discarded");
    } catch (discardError) {
      toast.error("Draft could not be discarded", {
        description:
          discardError instanceof Error
            ? discardError.message
            : "Review the current revision and try again.",
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
      toast.error("Preview could not be generated", {
        description:
          previewError instanceof Error
            ? previewError.message
            : "Please try again.",
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
      else {
        persistReadySourceId(entity.id, null);
        setReadySource({ legalEntityId: entity.id, assetId: null });
        setPendingSource({ legalEntityId: entity.id, assetId: asset.id });
      }
      toast.message(
        `${purpose === "LOGO" ? "Logo" : "Source file"} uploaded; validation is in progress`,
      );
    } catch (uploadError) {
      toast.error(
        `${purpose === "LOGO" ? "Logo" : "Source file"} could not be uploaded`,
        {
          description:
            uploadError instanceof Error
              ? uploadError.message
              : "Choose a supported file and try again.",
        },
      );
    }
  };

  if (isLoading)
    return <p className="text-sm text-slate-500">Loading document branding…</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-red-700">
        Document branding could not be loaded: {error.message}
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
    !draftError;

  return (
    <section
      className="space-y-4 rounded-lg border bg-white p-6"
      aria-labelledby="document-branding-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="document-branding-title" className="text-lg font-medium">
            Document branding
          </h3>
          <p className="text-sm text-slate-500">
            These settings apply to future invoices after you confirm them.
          </p>
        </div>
        <DocumentSaveIndicator status={saveStatus} />
      </div>

      {!entity.is_active ? (
        <p role="status" className="text-sm text-amber-800">
          Reactivate this legal entity to edit its document branding.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="brand-logo">Logo (PNG, up to 2 MiB)</Label>
          <Input
            id="brand-logo"
            type="file"
            accept="image/png,.png"
            disabled={
              !entity.is_active ||
              assetUpload.isPending ||
              Boolean(pendingLogoId)
            }
            onChange={(event) =>
              void uploadAsset("LOGO", event.target.files?.[0])
            }
          />
          {theme.logoAssetId ? (
            <p className="text-xs text-slate-500">
              Selected logo asset: {theme.logoAssetId}
            </p>
          ) : null}
          {theme.logoAssetId ? (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start px-0"
              disabled={!entity.is_active}
              onClick={() => updateTheme("logoAssetId", null)}
            >
              Remove logo
            </Button>
          ) : null}
          {assetUpload.isPending || logoAsset.data?.state === "QUARANTINED" ? (
            <p role="status" className="text-sm text-slate-500">
              Uploading and validating logo…
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
              Refresh validation status
            </Button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="brand-source">
            Letterhead source (PDF or PNG, up to 10 MiB)
          </Label>
          <Input
            id="brand-source"
            type="file"
            accept="application/pdf,image/png,.pdf,.png"
            disabled={
              !entity.is_active ||
              assetUpload.isPending ||
              Boolean(pendingSourceId)
            }
            onChange={(event) =>
              void uploadAsset("SOURCE", event.target.files?.[0])
            }
          />
          {pendingSourceId ? (
            <>
              <p className="text-xs text-slate-500">
                Source asset {pendingSourceId} ·{" "}
                {sourceAsset.data?.state ?? "QUARANTINED"}
              </p>
              {sourceAsset.pollTimedOut ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto justify-start px-0"
                  disabled={sourceAsset.isFetching}
                  onClick={() => void sourceAsset.refetch()}
                >
                  Refresh validation status
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <LetterheadImport
            legalEntityId={entity.id}
            sourceAssetId={readySourceId}
            expectedRevision={profile?.revision ?? 0}
            enabled={Boolean(profile?.capabilities.extractionAvailable) && entity.is_active}
            onApply={applyProposal}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-primary-color">Primary color</Label>
          <Input
            id="brand-primary-color"
            type="color"
            value={theme.primaryColor}
            disabled={!entity.is_active}
            onChange={(event) =>
              updateTheme("primaryColor", event.target.value.toUpperCase())
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-secondary-color">Secondary color</Label>
          <Input
            id="brand-secondary-color"
            type="color"
            value={theme.secondaryColor}
            disabled={!entity.is_active}
            onChange={(event) =>
              updateTheme("secondaryColor", event.target.value.toUpperCase())
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-header-band">Header band</Label>
          <Select
            value={theme.headerBand}
            disabled={!entity.is_active}
            onValueChange={(value) => updateTheme("headerBand", value)}
          >
            <SelectTrigger id="brand-header-band">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="primary">Primary</SelectItem>
              <SelectItem value="secondary">Secondary</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand-footer-band">Footer band</Label>
          <Select
            value={theme.footerBand}
            disabled={!entity.is_active}
            onValueChange={(value) => updateTheme("footerBand", value)}
          >
            <SelectTrigger id="brand-footer-band">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="primary">Primary</SelectItem>
              <SelectItem value="secondary">Secondary</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="brand-header-text">
            Decorative header text (up to 120 characters, two lines)
          </Label>
          <textarea
            id="brand-header-text"
            maxLength={120}
            rows={2}
            className="w-full rounded-md border border-input px-3 py-2 text-sm"
            value={theme.headerText}
            disabled={!entity.is_active}
            onChange={(event) => updateTheme("headerText", event.target.value)}
          />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="brand-footer-text">
            Decorative footer text (up to 120 characters)
          </Label>
          <Input
            id="brand-footer-text"
            maxLength={120}
            value={theme.footerText}
            disabled={!entity.is_active}
            onChange={(event) => updateTheme("footerText", event.target.value)}
          />
        </div>
      </div>

      {draftError ? (
        <p role="alert" className="text-sm text-red-700">
          Draft save failed. Your edits remain here; reload or try saving again
          after resolving any revision conflict. {draftError}
        </p>
      ) : null}
      <p role="status" className="text-sm text-slate-600">
        {profile?.activeRevision
          ? `Active appearance · revision ${profile.activeRevision}`
          : "Active appearance · ACP defaults"}
        {profile?.draftTheme ? " · Draft — not yet used on invoices" : " · No saved draft"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!entity.is_active || preview.isPending}
          onClick={() => void createPreview()}
        >
          {preview.isPending ? "Preparing preview…" : "Preview sample"}
        </Button>
        <Button
          type="button"
          disabled={!canConfirm || (!profile?.draftTheme && !hasUnsavedChanges)}
          onClick={() => void confirmDraft()}
        >
          {confirm.isPending ? "Confirming…" : "Confirm branding"}
        </Button>
        {profile?.draftTheme ? (
          <Button
            type="button"
            variant="outline"
            disabled={!entity.is_active || discard.isPending}
            onClick={() => void discardDraft()}
          >
            {discard.isPending ? "Discarding…" : "Discard draft"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={!entity.is_active || reset.isPending}
          onClick={() => void resetToDefaults()}
        >
          {reset.isPending ? "Resetting…" : "Confirm ACP defaults"}
        </Button>
      </div>
      {preview.data ? (
        <div className="overflow-hidden rounded-md border">
          {preview.data.warnings.length > 0 ? (
            <ul
              aria-label="Preview warnings"
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
            title="Synthetic invoice branding preview"
            sandbox=""
            srcDoc={preview.data.html}
            className="h-[560px] w-full"
          />
        </div>
      ) : null}
    </section>
  );
}
