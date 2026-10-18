import { DEFAULT_FORMAT_LOCALE } from '../i18n/display-language.js';

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

const MONEY_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const DECIMAL_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  maximumFractionDigits: 3,
};

/** Calendar dates on customer PDFs always use Austrian formatting. */
export function formatDocumentDate(
  value: string | Date,
  formatLocale: string = DEFAULT_FORMAT_LOCALE,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString(formatLocale, DATE_FORMAT);
}

export function formatDocumentCurrency(
  amount: string | number,
  currency = 'EUR',
  formatLocale: string = DEFAULT_FORMAT_LOCALE,
): string {
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(numeric)) {
    return `${amount} ${currency}`;
  }
  return new Intl.NumberFormat(formatLocale, {
    style: 'currency',
    currency,
    ...MONEY_FORMAT_OPTIONS,
  }).format(numeric);
}

export function formatDocumentDecimal(
  value: string | number,
  formatLocale: string = DEFAULT_FORMAT_LOCALE,
): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return new Intl.NumberFormat(formatLocale, DECIMAL_FORMAT_OPTIONS).format(
    numeric,
  );
}
