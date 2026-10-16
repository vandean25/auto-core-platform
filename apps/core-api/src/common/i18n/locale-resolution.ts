import type { DisplayLanguage } from './display-language.js';
import { DEFAULT_DISPLAY_LANGUAGE } from './display-language.js';

export function resolveUserLanguage(
  userLocale: DisplayLanguage | null | undefined,
  tenantDefaultLocale: DisplayLanguage,
): DisplayLanguage {
  return userLocale ?? tenantDefaultLocale ?? DEFAULT_DISPLAY_LANGUAGE;
}

export function resolveCustomerLanguage(
  customerPreferredLanguage: DisplayLanguage | null | undefined,
  tenantDefaultLocale: DisplayLanguage,
): DisplayLanguage {
  return (
    customerPreferredLanguage ?? tenantDefaultLocale ?? DEFAULT_DISPLAY_LANGUAGE
  );
}

export function resolveDocumentLanguage(snapshot: {
  document_locale?: DisplayLanguage | null;
}): DisplayLanguage {
  return snapshot.document_locale ?? DEFAULT_DISPLAY_LANGUAGE;
}
