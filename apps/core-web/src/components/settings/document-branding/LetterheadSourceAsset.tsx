import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  documentBrandingKeys,
  useAttachDocumentBrandDraftSource,
  useDocumentBrandAsset,
  useRemoveDocumentBrandDraftSource,
  useUploadDocumentBrandAsset,
  type DocumentBrandAsset,
  type DocumentBrandProfile,
} from "@/api/document-branding";
import { fetchWithAuth } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  describeLetterheadSourceAsset,
  formatDocumentBrandFileSize,
  letterheadSourceDisplayName,
} from "./letterhead-source-messages";

function isRevisionConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("revision conflict") ||
    message.includes("brand_revision_conflict")
  );
}

export function LetterheadSourceAsset({
  legalEntityId,
  entityActive,
  getExpectedRevision,
  draftSourceAssetId,
  initialAsset,
  extractionAvailable,
  onProfileUpdated,
}: {
  legalEntityId: string;
  entityActive: boolean;
  getExpectedRevision: () => number;
  draftSourceAssetId: string | null;
  initialAsset: DocumentBrandAsset | null;
  extractionAvailable: boolean;
  onProfileUpdated: (profile: DocumentBrandProfile) => void;
}) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const upload = useUploadDocumentBrandAsset();
  const attach = useAttachDocumentBrandDraftSource();
  const remove = useRemoveDocumentBrandDraftSource();
  const [pendingAssetId, setPendingAssetId] = React.useState<string | null>(
    null,
  );
  const trackedAssetId = pendingAssetId ?? draftSourceAssetId;
  const assetQuery = useDocumentBrandAsset(legalEntityId, trackedAssetId);
  const asset =
    assetQuery.data?.id === trackedAssetId
      ? assetQuery.data
      : trackedAssetId && initialAsset?.id === trackedAssetId
        ? initialAsset
        : null;

  React.useEffect(() => {
    if (!asset || asset.id !== pendingAssetId) return;
    if (asset.state === "QUARANTINED") return;
    setPendingAssetId(null);
  }, [asset, pendingAssetId]);

  const refreshProfile = React.useCallback(async () => {
    const response = await fetchWithAuth(
      `/api/legal-entities/${legalEntityId}/document-branding`,
    );
    if (!response.ok) {
      throw new Error(t("documentBranding.letterheadSource.refreshProfileFailed"));
    }
    const profile = (await response.json()) as DocumentBrandProfile;
    queryClient.setQueryData(
      documentBrandingKeys.profile(legalEntityId),
      profile,
    );
    onProfileUpdated(profile);
    return profile;
  }, [legalEntityId, onProfileUpdated, queryClient, t]);

  const attachSource = async (sourceAssetId: string) => {
    const tryAttach = (expectedRevision: number) =>
      attach.mutateAsync({
        legalEntityId,
        expectedRevision,
        sourceAssetId,
      });
    try {
      return await tryAttach(getExpectedRevision());
    } catch (error) {
      if (!isRevisionConflict(error)) throw error;
      const profile = await refreshProfile();
      return await tryAttach(profile.revision);
    }
  };

  const uploadSource = async (file: File | undefined) => {
    if (!file) return;
    try {
      const uploaded = await upload.mutateAsync({
        legalEntityId,
        purpose: "SOURCE",
        file,
      });
      setPendingAssetId(uploaded.id);
      const profile = await attachSource(uploaded.id);
      onProfileUpdated(profile);
      toast.message(t("documentBranding.letterheadSource.toast.uploaded"));
    } catch (error) {
      setPendingAssetId(null);
      toast.error(t("documentBranding.letterheadSource.toast.uploadFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("documentBranding.letterheadSource.toast.uploadFallback"),
      });
    }
  };

  const removeSource = async () => {
    try {
      const profile = await remove.mutateAsync({
        legalEntityId,
        expectedRevision: getExpectedRevision(),
      });
      setPendingAssetId(null);
      onProfileUpdated(profile);
      toast.success(t("documentBranding.letterheadSource.toast.removed"));
    } catch (error) {
      if (isRevisionConflict(error)) {
        try {
          const refreshed = await refreshProfile();
          const profile = await remove.mutateAsync({
            legalEntityId,
            expectedRevision: refreshed.revision,
          });
          setPendingAssetId(null);
          onProfileUpdated(profile);
          toast.success(t("documentBranding.letterheadSource.toast.removed"));
          return;
        } catch (retryError) {
          toast.error(t("documentBranding.letterheadSource.toast.removeFailed"), {
            description:
              retryError instanceof Error
                ? retryError.message
                : t("documentBranding.letterheadSource.toast.removeFallback"),
          });
          return;
        }
      }
      toast.error(t("documentBranding.letterheadSource.toast.removeFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("documentBranding.letterheadSource.toast.removeFallback"),
      });
    }
  };

  const downloadSource = async () => {
    if (!trackedAssetId || asset?.state !== "READY") return;
    try {
      const response = await fetchWithAuth(
        `/api/legal-entities/${legalEntityId}/document-branding/assets/${trackedAssetId}/content`,
      );
      if (!response.ok) {
        throw new Error(t("documentBranding.letterheadSource.downloadHttpFailed"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = letterheadSourceDisplayName(asset);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("documentBranding.letterheadSource.toast.downloadFailed"));
    }
  };

  const statusMessage = asset
    ? describeLetterheadSourceAsset(asset, {
        extractionAvailable,
        pollTimedOut: assetQuery.pollTimedOut,
      })
    : null;
  const canDownload = asset?.state === "READY";
  const previewPath =
    canDownload && trackedAssetId
      ? asset.detectedMimeType === "application/pdf" ||
        asset.pagePreviewAvailable
        ? `/api/legal-entities/${legalEntityId}/document-branding/assets/${trackedAssetId}/preview`
        : asset.detectedMimeType === "image/png"
          ? `/api/legal-entities/${legalEntityId}/document-branding/assets/${trackedAssetId}/content`
          : null
      : null;
  const previewUrl = useLetterheadPreviewUrl(previewPath);

  const mutationBusy =
    upload.isPending || attach.isPending || remove.isPending;
  const controlsDisabled = !entityActive || mutationBusy;

  return (
    <div className="grid gap-2 sm:col-span-2">
      <Label htmlFor="brand-source">
        {t("documentBranding.letterheadSource.label")}
      </Label>
      <Input
        id="brand-source"
        type="file"
        accept="application/pdf,image/png,.pdf,.png"
        disabled={controlsDisabled}
        onChange={(event) => {
          void uploadSource(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {asset ? (
        <div
          className="space-y-2 rounded-md border bg-slate-50 p-3"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {letterheadSourceDisplayName(asset)}
              </p>
              <p className="text-xs text-slate-600">
                {formatDocumentBrandFileSize(asset.byteLength)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canDownload ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void downloadSource()}
                >
                  {t("documentBranding.letterheadSource.download")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlsDisabled}
                onClick={() =>
                  document.getElementById("brand-source-replace")?.click()
                }
              >
                {t("documentBranding.letterheadSource.replace")}
              </Button>
              <input
                id="brand-source-replace"
                type="file"
                className="hidden"
                accept="application/pdf,image/png,.pdf,.png"
                disabled={controlsDisabled}
                onChange={(event) => {
                  void uploadSource(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlsDisabled}
                onClick={() => void removeSource()}
              >
                {t("documentBranding.letterheadSource.remove")}
              </Button>
            </div>
          </div>
          {statusMessage ? (
            <p role="status" className="text-sm text-slate-600">
              {statusMessage}
            </p>
          ) : null}
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={t("documentBranding.letterheadSource.previewAlt", {
                name: letterheadSourceDisplayName(asset),
              })}
              className="max-h-48 rounded border bg-white object-contain"
            />
          ) : null}
          {asset.state === "QUARANTINED" && assetQuery.pollTimedOut ? (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start px-0"
              disabled={assetQuery.isFetching}
              onClick={() => void assetQuery.refetch()}
            >
              {t("documentBranding.letterheadSource.refreshStatus")}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          {t("documentBranding.letterheadSource.hint")}
        </p>
      )}
    </div>
  );
}

function useLetterheadPreviewUrl(previewPath: string | null): string | null {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    if (!previewPath) return () => undefined;

    void (async () => {
      try {
        const response = await fetchWithAuth(previewPath);
        if (!active || !response.ok) return;
        const blob = await response.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch {
        if (active) setPreviewUrl(null);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewPath]);

  return previewUrl;
}
