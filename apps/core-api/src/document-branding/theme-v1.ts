import { UnprocessableEntityException } from '@nestjs/common';

export const DEFAULT_DOCUMENT_BRAND_THEME = {
  schemaVersion: 1,
  presetId: 'standard-v1',
  logoAssetId: null,
  primaryColor: '#111827',
  secondaryColor: '#E5E7EB',
  fontId: 'acp-sans-v1',
  headerBand: 'none',
  footerBand: 'none',
  headerText: '',
  footerText: '',
} as const;

export type DocumentBrandBand = 'none' | 'primary' | 'secondary';

export type DocumentBrandThemeV1 = {
  schemaVersion: 1;
  presetId: 'standard-v1';
  logoAssetId: string | null;
  primaryColor: string;
  secondaryColor: string;
  fontId: 'acp-sans-v1';
  headerBand: DocumentBrandBand;
  footerBand: DocumentBrandBand;
  headerText: string;
  footerText: string;
};

const THEME_FIELDS = Object.keys(DEFAULT_DOCUMENT_BRAND_THEME).sort();
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDocumentBrandTheme(
  value: unknown,
): DocumentBrandThemeV1 {
  if (!isPlainRecord(value)) return invalidTheme();

  const fields = Object.keys(value).sort();
  if (
    fields.length !== THEME_FIELDS.length ||
    fields.some((field, index) => field !== THEME_FIELDS[index])
  ) {
    return invalidTheme();
  }

  if (
    value.schemaVersion !== 1 ||
    value.presetId !== 'standard-v1' ||
    value.fontId !== 'acp-sans-v1' ||
    !isLogoId(value.logoAssetId) ||
    !isBand(value.headerBand) ||
    !isBand(value.footerBand) ||
    typeof value.primaryColor !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(value.primaryColor) ||
    typeof value.secondaryColor !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(value.secondaryColor) ||
    typeof value.headerText !== 'string' ||
    typeof value.footerText !== 'string'
  ) {
    return invalidTheme();
  }

  const primaryColor = value.primaryColor.toUpperCase();
  const secondaryColor = value.secondaryColor.toUpperCase();
  if (contrastWithWhite(primaryColor) < 4.5) return invalidColorContrast();

  const headerText = normalizeThemeText(value.headerText, true);
  const footerText = normalizeThemeText(value.footerText, false);
  if (headerText === null || footerText === null) return invalidTheme();

  return {
    schemaVersion: 1,
    presetId: 'standard-v1',
    logoAssetId: value.logoAssetId,
    primaryColor,
    secondaryColor,
    fontId: 'acp-sans-v1',
    headerBand: value.headerBand,
    footerBand: value.footerBand,
    headerText,
    footerText,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isLogoId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && UUID.test(value));
}

function isBand(value: unknown): value is DocumentBrandBand {
  return value === 'none' || value === 'primary' || value === 'secondary';
}

function normalizeThemeText(
  value: string,
  allowOneNewline: boolean,
): string | null {
  const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC');
  const codePoints = Array.from(normalized);
  const newlines = codePoints.filter((character) => character === '\n').length;

  if (
    codePoints.length > 120 ||
    newlines > (allowOneNewline ? 1 : 0) ||
    codePoints.some((character) =>
      character === '\n'
        ? !allowOneNewline
        : CONTROL_OR_FORMAT_CHARACTER.test(character),
    ) ||
    /[<>]|\$\{|\{\{|\}\}/u.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

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

function invalidTheme(): never {
  throw new UnprocessableEntityException({
    code: 'BRAND_THEME_INVALID',
    message: 'Invalid document branding theme',
  });
}

function invalidColorContrast(): never {
  throw new UnprocessableEntityException({
    code: 'BRAND_COLOR_CONTRAST',
    message: 'The primary color must meet the minimum contrast requirement.',
  });
}
