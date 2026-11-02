import { describe, expect, it } from "vitest";
import { documentBrandAssetUploadErrorMessage } from "./document-branding";
import { createHttpError } from "@/lib/error-utils";
import deErrors from "../../../../locales/de/errors.json";

const deCodes = deErrors.codes as Record<string, string>;

describe("document branding API helpers", () => {
  it.each([
    { status: 415, code: "BRAND_FILE_TYPE_UNSUPPORTED" },
    { status: 413, code: "BRAND_UPLOAD_TOO_LARGE" },
  ])(
    "maps a rejected logo upload ($code) to translated copy instead of backend text",
    ({ status, code }) => {
      const englishBackendText = "Logo must be PNG (max 2 MiB).";
      const message = documentBrandAssetUploadErrorMessage(
        createHttpError(englishBackendText, status, {
          code,
          message: englishBackendText,
        }),
        "fallback",
      );

      expect(message).toBe(deCodes[code]);
    },
  );
});
