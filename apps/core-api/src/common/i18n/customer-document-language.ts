import type { DisplayLanguage } from '@prisma/client';
import { DEFAULT_DISPLAY_LANGUAGE } from './display-language.js';
import { resolveCustomerLanguage } from './locale-resolution.js';

type TenantLocaleReader = {
  tenant: {
    findFirst: (args: {
      where: { id: string };
      select: { default_locale: true };
    }) => Promise<{ default_locale: DisplayLanguage } | null>;
  };
};

export async function loadTenantDefaultLocale(
  db: TenantLocaleReader,
  tenantId: string,
): Promise<DisplayLanguage> {
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId },
    select: { default_locale: true },
  });
  return tenant?.default_locale ?? DEFAULT_DISPLAY_LANGUAGE;
}

export function resolveCustomerDocumentLanguage(
  customer: { preferred_language: DisplayLanguage | null } | null | undefined,
  tenantDefaultLocale: DisplayLanguage,
): DisplayLanguage {
  return resolveCustomerLanguage(
    customer?.preferred_language ?? null,
    tenantDefaultLocale,
  );
}
