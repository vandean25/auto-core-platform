import { DEFAULT_FORMAT_LOCALE } from '../i18n/display-language.js';

const MONEY_FRACTION_DIGITS = 2;
const QUANTITY_MAX_FRACTION_DIGITS = 3;
const RATE_MAX_FRACTION_DIGITS = 2;
const DEFAULT_DOCUMENT_CURRENCY = 'EUR';

/** Austrian invoices group thousands with a period, not the space Intl reports for de-AT. */
const AUSTRIAN_GROUP_SEPARATOR = '.';

export type DocumentNumberValue = string | number | null | undefined;

export type DocumentNumberFormatter = {
  formatAmount(value: DocumentNumberValue): string;
  formatQuantity(value: DocumentNumberValue): string;
  formatRate(value: DocumentNumberValue): string;
};

/**
 * Formats the plain decimal strings frozen in document snapshots for one BCP-47 locale,
 * so numbers on customer documents read the way their text reads.
 */
export function createDocumentNumberFormatter(
  formatLocale: string,
  currency: string = DEFAULT_DOCUMENT_CURRENCY,
): DocumentNumberFormatter {
  const groupSeparator =
    formatLocale === DEFAULT_FORMAT_LOCALE ? AUSTRIAN_GROUP_SEPARATOR : null;
  const amount = new Intl.NumberFormat(formatLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits: MONEY_FRACTION_DIGITS,
    maximumFractionDigits: MONEY_FRACTION_DIGITS,
  });
  const quantity = new Intl.NumberFormat(formatLocale, {
    maximumFractionDigits: QUANTITY_MAX_FRACTION_DIGITS,
  });
  const rate = new Intl.NumberFormat(formatLocale, {
    maximumFractionDigits: RATE_MAX_FRACTION_DIGITS,
  });

  return {
    formatAmount: (value) => formatStoredValue(amount, value, groupSeparator),
    formatQuantity: (value) =>
      formatStoredValue(quantity, value, groupSeparator),
    formatRate: (value) => formatStoredValue(rate, value, groupSeparator),
  };
}

function formatStoredValue(
  formatter: Intl.NumberFormat,
  value: DocumentNumberValue,
  groupSeparator: string | null,
): string {
  const parsed = parseStoredDecimal(value);
  if (parsed === null) {
    return value === null || value === undefined ? '' : String(value);
  }
  return formatter
    .formatToParts(parsed)
    .map((part) =>
      part.type === 'group' && groupSeparator ? groupSeparator : part.value,
    )
    .join('');
}

function parseStoredDecimal(value: DocumentNumberValue): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
