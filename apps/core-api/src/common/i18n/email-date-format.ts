import type { DisplayLanguage } from './display-language.js';

const VIENNA = 'Europe/Vienna';

function intlLocale(documentLocale: DisplayLanguage): string {
  return documentLocale === 'de' ? 'de-AT' : 'en-GB';
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
