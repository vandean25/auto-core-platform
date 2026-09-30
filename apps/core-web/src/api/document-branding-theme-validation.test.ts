import { describe, expect, it } from "vitest";
import {
  countDecorativeTextCodePoints,
  validateDocumentBrandThemeFields,
} from "./document-branding-theme-validation";
import { DEFAULT_DOCUMENT_BRAND_THEME } from "./document-branding";

describe("document branding theme validation", () => {
  it("flags decorative text beyond the code-point limit", () => {
    const errors = validateDocumentBrandThemeFields(
      {
        ...DEFAULT_DOCUMENT_BRAND_THEME,
        footerText: "x".repeat(121),
      },
      120,
    );

    expect(errors.footerText).toContain("120 characters");
    expect(countDecorativeTextCodePoints("x".repeat(121))).toBe(121);
  });

  it("flags invalid primary colors", () => {
    const errors = validateDocumentBrandThemeFields(
      {
        ...DEFAULT_DOCUMENT_BRAND_THEME,
        primaryColor: "#EEEEEE",
      },
      120,
    );

    expect(errors.primaryColor).toContain("contrast");
  });
});
