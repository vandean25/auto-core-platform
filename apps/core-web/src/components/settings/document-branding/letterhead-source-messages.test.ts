// @vitest-environment node
import { describe, expect, it } from "vitest";

import { i18n } from "@/lib/i18n";
import type { DocumentBrandProfile, DocumentBrandUploadConstraints } from "@/api/document-branding";
import {
  describeBrandAssetFailure,
  describeLetterheadSourceAsset,
  formatDocumentBrandFileSize,
  letterheadSourceDisplayName,
  logoInterpolationParams,
  uploadInterpolationParams,
} from "./letterhead-source-messages";

type UploadCapabilities = DocumentBrandProfile["capabilities"]["uploads"];

function constraints(maxBytes: number): DocumentBrandUploadConstraints {
  return {
    maxBytes,
    mimeTypes: ["image/png"],
    accept: "image/png,.png",
    requirementLabel: "PNG",
  };
}

function uploadsFixture(logoMaxBytes: number): UploadCapabilities {
  return { logo: constraints(logoMaxBytes), source: constraints(10 * 1024 * 1024) };
}

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

describe("branding upload interpolation params", () => {
  it.each([
    {
      label: "a whole MiB logo limit",
      uploads: uploadsFixture(2 * 1024 * 1024),
      expected: { maxMiB: "2" },
    },
    {
      label: "a fractional MiB logo limit",
      uploads: uploadsFixture(1_572_864),
      expected: { maxMiB: "1.5" },
    },
    { label: "missing upload capabilities", uploads: undefined, expected: {} },
  ])("derives the logo params from $label", ({ uploads, expected }) => {
    expect(logoInterpolationParams(uploads)).toEqual(expected);
  });

  it.each([
    {
      purpose: "LOGO" as const,
      uploads: uploadsFixture(2 * 1024 * 1024),
      expected: { maxMiB: "2" },
    },
    {
      purpose: "SOURCE" as const,
      uploads: uploadsFixture(2 * 1024 * 1024),
      expected: {},
    },
    { purpose: "LOGO" as const, uploads: undefined, expected: {} },
  ])(
    "keeps the logo limit on the logo upload only for the $purpose purpose",
    ({ purpose, uploads, expected }) => {
      expect(uploadInterpolationParams(uploads, purpose)).toEqual(expected);
    },
  );

  it("names the logo size limit in the rejected-logo message", () => {
    const message = describeBrandAssetFailure(
      "BRAND_LOGO_TOO_LARGE",
      "fallback",
      logoInterpolationParams(uploadsFixture(2 * 1024 * 1024)),
    );
    expect(message).toContain("2 MiB");
    expect(message).not.toContain("Briefpapier");
  });

  it("keeps the oversized letterhead message on its own copy, without the logo limit", () => {
    expect(
      describeBrandAssetFailure(
        "BRAND_UPLOAD_TOO_LARGE",
        "fallback",
        uploadInterpolationParams(uploadsFixture(2 * 1024 * 1024), "SOURCE"),
      ),
    ).toBe(i18n.t("errors:codes.BRAND_UPLOAD_TOO_LARGE"));
  });
});
