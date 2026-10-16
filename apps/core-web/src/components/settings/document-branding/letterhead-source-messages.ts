import type { DocumentBrandAsset } from "@/api/document-branding";
import { translateEnum, translateEnumOptions } from "@/lib/i18n/enum-labels";

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
      return failureCode
        ? translateEnumOptions(
            ["letterheadSource", "message", "rejectedWithCode"],
            { code: failureCode.replaceAll("_", " ").toLowerCase() },
          )
        : translateEnum("letterheadSource", "message", "rejectedGeneric");
  }
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
