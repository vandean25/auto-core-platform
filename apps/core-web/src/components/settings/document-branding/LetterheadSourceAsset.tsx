import * as React from "react";
import { toast } from "sonner";
import {
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

export function LetterheadSourceAsset({
  legalEntityId,
  entityActive,
  expectedRevision,
  draftSourceAssetId,
  initialAsset,
  extractionAvailable,
  onProfileUpdated,
}: {
  legalEntityId: string;
  entityActive: boolean;
  expectedRevision: number;
  draftSourceAssetId: string | null;
  initialAsset: DocumentBrandAsset | null;
  extractionAvailable: boolean;
  onProfileUpdated: (profile: DocumentBrandProfile) => void;
}) {
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

  const uploadSource = async (file: File | undefined) => {
    if (!file) return;
    try {
      const uploaded = await upload.mutateAsync({
        legalEntityId,
        purpose: "SOURCE",
        file,
      });
      setPendingAssetId(uploaded.id);
      const profile = await attach.mutateAsync({
        legalEntityId,
        expectedRevision,
        sourceAssetId: uploaded.id,
      });
      onProfileUpdated(profile);
      toast.message("Letterhead uploaded; validation is in progress");
    } catch (error) {
      setPendingAssetId(null);
      toast.error("Letterhead source could not be uploaded", {
        description:
          error instanceof Error
            ? error.message
            : "Choose a supported PDF or PNG file and try again.",
      });
    }
  };

  const removeSource = async () => {
    try {
      const profile = await remove.mutateAsync({
        legalEntityId,
        expectedRevision,
      });
      setPendingAssetId(null);
      onProfileUpdated(profile);
      toast.success("Letterhead source removed from the draft");
    } catch (error) {
      toast.error("Letterhead source could not be removed", {
        description:
          error instanceof Error ? error.message : "Try again in a moment.",
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
        throw new Error("Download failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = letterheadSourceDisplayName(asset);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Letterhead source could not be downloaded");
    }
  };

  const statusMessage = asset
    ? describeLetterheadSourceAsset(asset, {
        extractionAvailable,
        pollTimedOut: assetQuery.pollTimedOut,
      })
    : null;
  const canDownload = asset?.state === "READY";
  const canPreview =
    canDownload && asset.detectedMimeType === "image/png";
  const previewUrl = useLetterheadPreviewUrl(
    legalEntityId,
    canPreview ? trackedAssetId : null,
  );

  const busy =
    !entityActive ||
    upload.isPending ||
    attach.isPending ||
    remove.isPending ||
    Boolean(pendingAssetId && asset?.state === "QUARANTINED");

  return (
    <div className="grid gap-2 sm:col-span-2">
      <Label htmlFor="brand-source">
        Letterhead source (PDF or PNG, up to 10 MiB)
      </Label>
      <Input
        id="brand-source"
        type="file"
        accept="application/pdf,image/png,.pdf,.png"
        disabled={busy}
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
                  Download
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  document.getElementById("brand-source-replace")?.click()
                }
              >
                Replace
              </Button>
              <input
                id="brand-source-replace"
                type="file"
                className="hidden"
                accept="application/pdf,image/png,.pdf,.png"
                disabled={busy}
                onChange={(event) => {
                  void uploadSource(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void removeSource()}
              >
                Remove
              </Button>
            </div>
          </div>
          {statusMessage ? (
            <p role="status" className="text-sm text-slate-600">
              {statusMessage}
            </p>
          ) : null}
          {canPreview && previewUrl ? (
            <img
              src={previewUrl}
              alt={`Preview of ${letterheadSourceDisplayName(asset)}`}
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
              Refresh validation status
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Upload a PDF or PNG letterhead to keep it with your branding draft.
        </p>
      )}
    </div>
  );
}

function useLetterheadPreviewUrl(
  legalEntityId: string,
  assetId: string | null,
): string | null {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    if (!assetId) return () => undefined;

    void (async () => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${legalEntityId}/document-branding/assets/${assetId}/content`,
      );
      if (!active || !response.ok) return;
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      if (active) setPreviewUrl(objectUrl);
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, legalEntityId]);

  return previewUrl;
}
