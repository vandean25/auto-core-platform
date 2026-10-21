import { DEFAULT_FORMAT_LOCALE } from '../i18n/display-language.js';

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
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
