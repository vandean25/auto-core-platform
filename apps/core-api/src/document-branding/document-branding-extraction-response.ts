import { UnprocessableEntityException } from '@nestjs/common';
import {
  validateDocumentBrandTheme,
  type DocumentBrandThemeV1,
} from './theme-v1.js';

const MAX_RESPONSE_BYTES = 8 * 1024;
const RESPONSE_FIELDS = [
  'confidence',
  'cropRect',
  'theme',
  'warningCodes',
].sort();
const THEME_FIELDS = [
  'footerBand',
  'footerText',
  'fontId',
  'headerBand',
  'headerText',
  'primaryColor',
  'presetId',
  'schemaVersion',
  'secondaryColor',
].sort();
const ALLOWED_WARNING_CODES = new Set([
  'PDF_ADDITIONAL_PAGES_IGNORED',
  'UNSUPPORTED_FONT_IGNORED',
  'UNSUPPORTED_LAYOUT_IGNORED',
]);

export type DocumentBrandingCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DocumentBrandingExtractionProposal = {
  theme: DocumentBrandThemeV1;
  warningCodes: string[];
  cropRect: DocumentBrandingCropRect | null;
};

export function parseDocumentBrandingExtractionResponse(
  response: unknown,
): DocumentBrandingExtractionProposal {
  validateResponseSize(response);
  const parsedResponse = parseJsonResponse(response);
  const record = requireRecord(parsedResponse);
  requireExactFields(record, RESPONSE_FIELDS);
  if (record.confidence !== 'SUFFICIENT') {
    throw invalidResponse('BRAND_EXTRACTION_LOW_CONFIDENCE');
  }

  const modelTheme = requireRecord(record.theme);
  requireExactFields(modelTheme, THEME_FIELDS);
  const warnings = parseWarningCodes(record.warningCodes);
  const presetId = supportedString(
    modelTheme.presetId,
    'standard-v1',
    'UNSUPPORTED_LAYOUT_IGNORED',
    warnings,
  );
  const fontId = supportedString(
    modelTheme.fontId,
    'acp-sans-v1',
    'UNSUPPORTED_FONT_IGNORED',
    warnings,
  );
  const theme = validateDocumentBrandTheme({
    ...modelTheme,
    presetId,
    fontId,
    logoAssetId: null,
  });

  return {
    theme,
    warningCodes: warnings,
    cropRect: parseCropRect(record.cropRect),
  };
}

function parseJsonResponse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidResponse();
  }
}

function validateResponseSize(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    throw invalidResponse();
  }
  if (
    typeof serialized !== 'string' ||
    Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES
  ) {
    throw invalidResponse();
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw invalidResponse();
  return value;
}

function requireExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const actualFields = Object.keys(value).sort();
  const expectedFields = [...fields].sort();
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw invalidResponse();
  }
}

function parseWarningCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw invalidResponse();
  const warnings = value.map((warning) => {
    if (typeof warning !== 'string' || !ALLOWED_WARNING_CODES.has(warning)) {
      throw invalidResponse();
    }
    return warning;
  });
  return [...new Set(warnings)];
}

function supportedString(
  value: unknown,
  supportedValue: string,
  warningCode: string,
  warnings: string[],
): string {
  if (typeof value !== 'string' || value.length > 80) throw invalidResponse();
  if (value !== supportedValue && !warnings.includes(warningCode)) {
    if (warnings.length >= 8) throw invalidResponse();
    warnings.push(warningCode);
  }
  return supportedValue;
}

function parseCropRect(value: unknown): DocumentBrandingCropRect | null {
  if (value === null) return null;
  const cropRect = requireRecord(value);
  requireExactFields(cropRect, ['x', 'y', 'width', 'height']);
  const { x, y, width, height } = cropRect;
  if (
    !isUnitInterval(x) ||
    !isUnitInterval(y) ||
    !isPositiveUnitInterval(width) ||
    !isPositiveUnitInterval(height) ||
    x + width > 1 ||
    y + height > 1
  ) {
    throw invalidResponse();
  }
  return { x, y, width, height };
}

function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isPositiveUnitInterval(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidResponse(code = 'BRAND_EXTRACTION_OUTPUT_INVALID') {
  return new UnprocessableEntityException({
    code,
    message: 'The letterhead extraction response could not be validated.',
  });
}
