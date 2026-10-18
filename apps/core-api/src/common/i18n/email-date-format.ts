import type { DisplayLanguage } from './display-language.js';

const VIENNA = 'Europe/Vienna';

function intlLocale(documentLocale: DisplayLanguage): string {
  return documentLocale === 'de' ? 'de-AT' : 'en-GB';
}

/** Date only, aligned with workshop estimate PDF date formatting. */
export function formatEmailDate(
  documentLocale: DisplayLanguage,
  instant: Date,
): string {
  return new Intl.DateTimeFormat(intlLocale(documentLocale), {
    timeZone: VIENNA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}

/** Date and time in business timezone, aligned with estimate validity formatting. */
export function formatEmailDateTime(
  documentLocale: DisplayLanguage,
  instant: Date,
): string {
  return new Intl.DateTimeFormat(intlLocale(documentLocale), {
    timeZone: VIENNA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

export function formatLandingDemoMagicLinkExpiry(
  documentLocale: DisplayLanguage,
  instant: Date,
): string {
  return new Intl.DateTimeFormat(intlLocale(documentLocale), {
    timeZone: VIENNA,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(instant);
}
