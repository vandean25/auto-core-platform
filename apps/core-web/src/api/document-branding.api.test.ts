import { describe, expect, it } from "vitest";
import { documentBrandAssetUploadErrorMessage } from "./document-branding";
import { createHttpError } from "@/lib/error-utils";

describe("document branding API helpers", () => {
  it("maps unsupported logo uploads to the backend requirement label", () => {
    const message = documentBrandAssetUploadErrorMessage(
      "LOGO",
      createHttpError("Failed to upload document branding asset", 415),
      {
        maxBytes: 2 * 1024 * 1024,
        mimeTypes: ["image/png"],
        accept: "image/png,.png",
        requirementLabel: "Logo must be PNG (max 2 MiB).",
      },
    );

    expect(message).toBe("Logo must be PNG (max 2 MiB).");
  });
});
