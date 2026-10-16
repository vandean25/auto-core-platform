// @vitest-environment node
import { describe, expect, it } from "vitest";

import { i18n } from "@/lib/i18n";
import {
  describeLetterheadSourceAsset,
  formatDocumentBrandFileSize,
  letterheadSourceDisplayName,
} from "./letterhead-source-messages";

describe("letterhead source messages", () => {
  it("formats byte sizes for humans", () => {
    expect(formatDocumentBrandFileSize(512)).toBe("512 B");
    expect(formatDocumentBrandFileSize(2048)).toBe("2.0 KiB");
    expect(formatDocumentBrandFileSize(5 * 1024 * 1024)).toBe("5.0 MiB");
  });

  it("describes validation and extraction availability in German by default", () => {
    expect(
      describeLetterheadSourceAsset(
        { state: "QUARANTINED", failureCode: null },
        { extractionAvailable: false, pollTimedOut: false },
      ),
    ).toBe(i18n.t("enums:letterheadSource.message.quarantined"));
    expect(
      describeLetterheadSourceAsset(
        { state: "READY", failureCode: null },
        { extractionAvailable: false, pollTimedOut: false },
      ),
    ).toBe(i18n.t("enums:letterheadSource.message.readyWaitingExtraction"));
    expect(
      describeLetterheadSourceAsset(
        { state: "REJECTED", failureCode: "BRAND_FILE_TYPE_UNSUPPORTED" },
        { extractionAvailable: true, pollTimedOut: false },
      ),
    ).toBe(i18n.t("enums:letterheadSource.message.rejectedUnsupportedType"));
  });

  it("prefers the original filename when present", () => {
    expect(
      letterheadSourceDisplayName({
        id: "asset-1",
        purpose: "SOURCE",
        state: "READY",
        detectedMimeType: "application/pdf",
        byteLength: 10,
        pixelWidth: null,
        pixelHeight: null,
        failureCode: null,
        originalFilename: "Company letterhead.pdf",
        pagePreviewAvailable: false,
        createdAt: "2026-09-30T00:00:00.000Z",
        expiresAt: null,
      }),
    ).toBe("Company letterhead.pdf");
  });
});
