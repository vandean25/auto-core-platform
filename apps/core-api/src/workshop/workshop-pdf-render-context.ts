import {
  loadTenantDefaultLocale,
  resolveCustomerDocumentLanguage,
} from '../common/i18n/customer-document-language.js';
import type { DocumentSnapshotLocaleReader } from '../common/i18n/document-snapshot-locale.js';
import type { DisplayLanguage } from '../common/i18n/display-language.js';
import {
  resolveLocalizedDocumentLocale,
  snapshotUsesLocalizedPdfResources,
} from '../common/i18n/pdf-resource-bundle.js';
import type { ResolvedPdfRenderMode } from '../common/i18n/pdf-render-mode.js';
import type { WorkshopOrderForPdf } from './workshop-pdf.types.js';

type TenantLocaleReader = {
  tenant: {
    findFirst: (args: {
      where: { id: string };
      select: { default_locale: true };
    }) => Promise<{ default_locale: DisplayLanguage } | null>;
  };
};

export async function resolveWorkshopOrderPdfRenderContext(
  db: TenantLocaleReader,
  tenantId: string,
  order: WorkshopOrderForPdf,
  existingRenderInput: unknown,
): Promise<ResolvedPdfRenderMode> {
  const renderInput =
    existingRenderInput as DocumentSnapshotLocaleReader | null;
  const locale = resolveLocalizedDocumentLocale(renderInput);
  if (locale && snapshotUsesLocalizedPdfResources(renderInput)) {
    return { mode: 'localized', documentLocale: locale };
  }

  if (existingRenderInput && typeof existingRenderInput === 'object') {
    return { mode: 'legacy', documentLocale: 'de' };
  }

  const tenantDefault = await loadTenantDefaultLocale(db, tenantId);
  return {
    mode: 'localized',
    documentLocale: resolveCustomerDocumentLanguage(
      order.customer,
      tenantDefault,
    ),
  };
}
