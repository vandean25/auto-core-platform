import type { DisplayLanguage } from './display-language.js';
import { createPdfTranslator } from './pdf-i18n.js';
import type { WorkshopPdfCopy } from '../../workshop/workshop-pdf-copy.js';

export function buildWorkshopPdfCopyFromI18n(
  documentLocale: DisplayLanguage,
): WorkshopPdfCopy {
  const t = createPdfTranslator(documentLocale);
  return {
    htmlLang: t('workshop.htmlLang'),
    jobCardTitle: t('workshop.jobCardTitle'),
    internalDocumentBadge: t('workshop.internalDocumentBadge'),
    orderLabel: t('workshop.orderLabel'),
    customerSectionTitle: t('workshop.customerSectionTitle'),
    phoneLabel: t('workshop.phoneLabel'),
    emailLabel: t('workshop.emailLabel'),
    vehicleSectionTitle: t('workshop.vehicleSectionTitle'),
    vinLabel: t('workshop.vinLabel'),
    plateLabel: t('workshop.plateLabel'),
    odometerLabel: t('workshop.odometerLabel'),
    fuelLevelLabel: t('workshop.fuelLevelLabel'),
    reportedIssueTitle: t('workshop.reportedIssueTitle'),
    tasksSectionTitle: t('workshop.tasksSectionTitle'),
    noTasksMessage: t('workshop.noTasksMessage'),
    lineItemTypeHeader: t('workshop.lineItemTypeHeader'),
    lineItemNoHeader: t('workshop.lineItemNoHeader'),
    lineItemDescriptionHeader: t('workshop.lineItemDescriptionHeader'),
    lineItemQtyHeader: t('workshop.lineItemQtyHeader'),
    mechanicNotesLabel: t('workshop.mechanicNotesLabel'),
    internalNotesTitle: t('workshop.internalNotesTitle'),
    footerSignatureLine: t('workshop.footerSignatureLine'),
    footerDocumentLabel: (orderNumber) =>
      t('workshop.footerDocumentLabel', { orderNumber }),
  };
}
