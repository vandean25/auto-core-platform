import type { DocumentBrandAsset } from "@/api/document-branding";

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
      return "Validation is taking longer than expected. Refresh the status or try again later.";
    }
    return "Checking file…";
  }
  if (asset.state === "READY") {
    if (!options.extractionAvailable) {
      return "Validated. Waiting for assisted extraction, currently unavailable.";
    }
    return "Validated and ready for assisted extraction.";
  }
  if (asset.state === "REJECTED") {
    return describeRejection(asset.failureCode);
  }
  if (asset.state === "DELETING" || asset.state === "DELETED") {
    return "This file was removed and is no longer available.";
  }
  return "Processing upload…";
}

function describeRejection(failureCode: string | null): string {
  switch (failureCode) {
    case "BRAND_FILE_TYPE_UNSUPPORTED":
      return "This file type is not supported. Upload a PDF or PNG letterhead.";
    case "BRAND_UPLOAD_TOO_LARGE":
      return "This file is too large. Letterhead sources must be 10 MiB or smaller.";
    case "VALIDATION_RETRIES_EXHAUSTED":
      return "We could not validate this file after several attempts. Try another copy or format.";
    case "BRAND_SOURCE_EXPIRED":
      return "This letterhead source expired before it could be used.";
    default:
      return failureCode
        ? `This file was rejected (${failureCode.replaceAll("_", " ").toLowerCase()}).`
        : "This file was rejected. Choose another PDF or PNG letterhead.";
  }
}

export function letterheadSourceDisplayName(asset: DocumentBrandAsset): string {
  if (asset.originalFilename) return asset.originalFilename;
  if (asset.detectedMimeType === "application/pdf") {
    return "letterhead.pdf";
  }
  if (asset.detectedMimeType === "image/png") {
    return "letterhead.png";
  }
  return "letterhead source";
}
