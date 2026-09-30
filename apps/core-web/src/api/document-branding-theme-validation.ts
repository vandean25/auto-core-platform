import type { DocumentBrandTheme } from "./document-branding";

const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export type DocumentBrandThemeFieldErrors = Partial<
  Record<
    | "headerText"
    | "footerText"
    | "primaryColor"
    | "secondaryColor",
    string
  >
>;

function contrastWithWhite(hexColor: string): number {
  const red = linearizeColorChannel(hexColor.slice(1, 3));
  const green = linearizeColorChannel(hexColor.slice(3, 5));
  const blue = linearizeColorChannel(hexColor.slice(5, 7));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return 1.05 / (luminance + 0.05);
}

function linearizeColorChannel(channel: string): number {
  const encoded = Number.parseInt(channel, 16) / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

function validateDecorativeText(
  field: "headerText" | "footerText",
  value: string,
  maxCodePoints: number,
  allowOneNewline: boolean,
): string | undefined {
  const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC");
  const codePoints = Array.from(normalized);
  const newlines = codePoints.filter((character) => character === "\n").length;
  const label = field === "headerText" ? "header" : "footer";

  if (codePoints.length > maxCodePoints) {
    return `Decorative ${label} text must be at most ${maxCodePoints} characters (${codePoints.length}/${maxCodePoints}).`;
  }

  if (newlines > (allowOneNewline ? 1 : 0)) {
    return `Decorative ${label} text may use at most ${allowOneNewline ? "two lines" : "one line"}.`;
  }

  if (
    codePoints.some((character) =>
      character === "\n"
        ? !allowOneNewline
        : CONTROL_OR_FORMAT_CHARACTER.test(character),
    ) ||
    /[<>]|\$\{|\{\{|\}\}/u.test(normalized)
  ) {
    return `Decorative ${label} text contains unsupported characters.`;
  }

  return undefined;
}

function validateHexColor(
  field: "primaryColor" | "secondaryColor",
  value: string,
): string | undefined {
  if (!HEX_COLOR.test(value)) {
    return `${field === "primaryColor" ? "Primary" : "Secondary"} color must be a six-digit hex value (for example #111827).`;
  }
  if (field === "primaryColor" && contrastWithWhite(value.toUpperCase()) < 4.5) {
    return "Primary color must meet the minimum contrast requirement on white.";
  }
  return undefined;
}

export function validateDocumentBrandThemeFields(
  theme: DocumentBrandTheme,
  decorativeTextMaxCodePoints: number,
): DocumentBrandThemeFieldErrors {
  return {
    headerText: validateDecorativeText(
      "headerText",
      theme.headerText,
      decorativeTextMaxCodePoints,
      true,
    ),
    footerText: validateDecorativeText(
      "footerText",
      theme.footerText,
      decorativeTextMaxCodePoints,
      false,
    ),
    primaryColor: validateHexColor("primaryColor", theme.primaryColor),
    secondaryColor: validateHexColor("secondaryColor", theme.secondaryColor),
  };
}

export function countDecorativeTextCodePoints(value: string): number {
  return Array.from(value.replace(/\r\n?/g, "\n").normalize("NFC")).length;
}

export function hasDocumentBrandThemeFieldErrors(
  errors: DocumentBrandThemeFieldErrors,
): boolean {
  return Object.values(errors).some(Boolean);
}
