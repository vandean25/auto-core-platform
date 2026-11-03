import type { DocumentBrandAsset, DocumentBrandProfile } from "@/api/document-branding";
import { getErrorMessage } from "@/lib/error-utils";
import { translateEnum } from "@/lib/i18n/enum-labels";

type BrandUploadCapabilities = DocumentBrandProfile["capabilities"]["uploads"];

/** Byte limit rendered as a whole or one-decimal MiB figure for error and hint copy. */
export function uploadMaxMiB(maxBytes: number): string {
  const mib = maxBytes / (1024 * 1024);
  return Number.isInteger(mib) ? String(mib) : mib.toFixed(1);
}

/**
 * Interpolation values that let the oversized-logo error name the logo's own size limit.
 * Empty when the profile has not reported upload capabilities yet.
 */
export function logoInterpolationParams(
  uploads: BrandUploadCapabilities | undefined,
): Record<string, string | undefined> {
  return uploads ? { maxMiB: uploadMaxMiB(uploads.logo.maxBytes) } : {};
}

/**
 * Interpolation values for a failed branding upload. Only the logo carries its size
 * limit so the letterhead source keeps its own copy.
 */
export function uploadInterpolationParams(
  uploads: BrandUploadCapabilities | undefined,
  purpose: "SOURCE" | "LOGO",
): Record<string, string | undefined> {
  return purpose === "LOGO" ? logoInterpolationParams(uploads) : {};
}

export function formatDocumentBrandFileSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(byteLength < 10 * 1024 ? 1 : 0)} KiB`;
  }
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
}

export function describeLetterheadSourceAsset(
  asset: Pick<DocumentBrandAsset, "state" | "failureCode">,
  options: { extractionAvailable: boolean; pollTimedOut: boolean },
): string {
  if (asset.state === "QUARANTINED") {
    if (options.pollTimedOut) {
      return translateEnum("letterheadSource", "message", "pollTimedOut");
    }
    return translateEnum("letterheadSource", "message", "quarantined");
  }
  if (asset.state === "READY") {
    if (!options.extractionAvailable) {
      return translateEnum("letterheadSource", "message", "readyWaitingExtraction");
    }
    return translateEnum("letterheadSource", "message", "readyForExtraction");
  }
  if (asset.state === "REJECTED") {
    return describeRejection(asset.failureCode);
  }
  if (asset.state === "DELETING" || asset.state === "DELETED") {
    return translateEnum("letterheadSource", "message", "removed");
  }
  return translateEnum("letterheadSource", "message", "processing");
}

function describeRejection(failureCode: string | null): string {
  switch (failureCode) {
    case "BRAND_FILE_TYPE_UNSUPPORTED":
      return translateEnum("letterheadSource", "message", "rejectedUnsupportedType");
    case "BRAND_UPLOAD_TOO_LARGE":
      return translateEnum("letterheadSource", "message", "rejectedTooLarge");
    case "VALIDATION_RETRIES_EXHAUSTED":
      return translateEnum("letterheadSource", "message", "rejectedRetries");
    case "BRAND_SOURCE_EXPIRED":
      return translateEnum("letterheadSource", "message", "rejectedExpired");
    default:
      return describeBrandAssetFailure(
        failureCode,
        translateEnum("letterheadSource", "message", "rejectedGeneric"),
      );
  }
}

/**
 * Translated reason for an asset failure code. Codes registered in `errors:codes` win;
 * anything else shows the caller's own translated text, never the raw code.
 */
export function describeBrandAssetFailure(
  failureCode: string | null,
  fallback: string,
  interpolate?: Record<string, string | undefined>,
): string {
  return getErrorMessage(
    { response: { data: failureCode ? { code: failureCode } : undefined } },
    fallback,
    interpolate,
  );
}

export function letterheadSourceDisplayName(asset: DocumentBrandAsset): string {
  if (asset.originalFilename) return asset.originalFilename;
  if (asset.detectedMimeType === "application/pdf") {
    return translateEnum("letterheadSource", "displayName", "pdf");
  }
  if (asset.detectedMimeType === "image/png") {
    return translateEnum("letterheadSource", "displayName", "png");
  }
  return translateEnum("letterheadSource", "displayName", "fallback");
}
