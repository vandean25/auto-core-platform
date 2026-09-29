import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import type {
  InvoiceSnapshotV2,
  InvoiceSnapshotV2Branding,
} from './invoice-snapshot-v2.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const COLOR = /^#[a-f0-9]{6}$/i;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

const isString = (value: unknown): value is string => typeof value === 'string';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function hasExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isValidThemeText(
  value: unknown,
  allowOneNewline: boolean,
): value is string {
  if (!isString(value)) return false;
  const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC');
  const codePoints = Array.from(normalized);
  const newlines = codePoints.filter((character) => character === '\n').length;
  return (
    codePoints.length <= 120 &&
    newlines <= (allowOneNewline ? 1 : 0) &&
    codePoints.every((character) =>
      character === '\n'
        ? allowOneNewline
        : !CONTROL_OR_FORMAT_CHARACTER.test(character),
    ) &&
    !/[<>]|\$\{|\{\{|\}\}/u.test(normalized)
  );
}

function isValidBrandingTokens(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'primary_color',
      'secondary_color',
      'header_band',
      'footer_band',
      'header_text',
      'footer_text',
    ])
  ) {
    return false;
  }

  const isBand = (candidate: unknown) =>
    candidate === 'none' ||
    candidate === 'primary' ||
    candidate === 'secondary';

  return (
    isString(value.primary_color) &&
    COLOR.test(value.primary_color) &&
    contrastWithWhite(value.primary_color) >= 4.5 &&
    isString(value.secondary_color) &&
    COLOR.test(value.secondary_color) &&
    isBand(value.header_band) &&
    isBand(value.footer_band) &&
    isValidThemeText(value.header_text, true) &&
    isValidThemeText(value.footer_text, false)
  );
}

function contrastWithWhite(hexColor: string): number {
  const linearize = (index: number) => {
    const encoded = Number.parseInt(hexColor.slice(index, index + 2), 16) / 255;
    return encoded <= 0.04045
      ? encoded / 12.92
      : ((encoded + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearize(1) + 0.7152 * linearize(3) + 0.0722 * linearize(5);
  return 1.05 / (luminance + 0.05);
}

function isValidLogoMetadata(value: unknown): boolean {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'asset_id',
      'bucket',
      'key',
      'generation',
      'sha256',
      'mime_type',
      'width',
      'height',
    ])
  ) {
    return false;
  }

  return (
    isString(value.asset_id) &&
    UUID.test(value.asset_id) &&
    isString(value.bucket) &&
    value.bucket.trim().length > 0 &&
    isString(value.key) &&
    value.key.trim().length > 0 &&
    isString(value.generation) &&
    value.generation.trim().length > 0 &&
    isString(value.sha256) &&
    SHA256.test(value.sha256) &&
    value.mime_type === 'image/png' &&
    Number.isSafeInteger(value.width) &&
    Number(value.width) > 0 &&
    Number(value.width) <= 8192 &&
    Number.isSafeInteger(value.height) &&
    Number(value.height) > 0 &&
    Number(value.height) <= 8192 &&
    Number(value.width) * Number(value.height) <= 16_000_000
  );
}

function isValidBranding(value: unknown): value is InvoiceSnapshotV2Branding {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema_version',
      'profile_id',
      'profile_revision',
      'preset_id',
      'renderer_version',
      'font_id',
      'tokens',
      'logo',
      'resolved_at',
    ])
  ) {
    return false;
  }

  const validProfileId =
    value.profile_id === null ||
    (isString(value.profile_id) && UUID.test(value.profile_id));
  const validRevision =
    Number.isSafeInteger(value.profile_revision) &&
    Number(value.profile_revision) >= 0 &&
    (value.profile_id !== null || value.profile_revision === 0);
  const resolvedAt = isString(value.resolved_at)
    ? Date.parse(value.resolved_at)
    : Number.NaN;

  return (
    value.schema_version === 1 &&
    validProfileId &&
    validRevision &&
    value.preset_id === 'standard-v1' &&
    value.renderer_version === INVOICE_BRANDED_TEMPLATE_VERSION &&
    value.font_id === 'acp-sans-v1' &&
    isValidBrandingTokens(value.tokens) &&
    isValidLogoMetadata(value.logo) &&
    Number.isFinite(resolvedAt)
  );
}

export const isInvoiceSnapshotV2 = (
  value: unknown,
): value is InvoiceSnapshotV2 => {
  if (!isRecord(value)) {
    return false;
  }

  const validBaseSnapshot =
    value.schema_version === 2 &&
    value.document_kind === 'INVOICE' &&
    isString(value.site_id) &&
    isString(value.legal_entity_id) &&
    value.currency === 'EUR' &&
    isRecord(value.seller) &&
    isString(value.seller.name) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    Array.isArray(value.tax_breakdown) &&
    isString(value.total_net) &&
    isString(value.total_tax) &&
    isString(value.total_gross) &&
    isString(value.snapshot_created_at);

  if (!validBaseSnapshot) return false;
  if (value.template_version === INVOICE_BRANDED_TEMPLATE_VERSION) {
    return isValidBranding(value.branding);
  }
  return value.branding === undefined || isValidBranding(value.branding);
};
