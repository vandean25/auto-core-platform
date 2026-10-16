import type { DisplayLanguage } from '@prisma/client';

export type WorkshopPdfCopy = {
  htmlLang: string;
  jobCardTitle: string;
  internalDocumentBadge: string;
  orderLabel: string;
  customerSectionTitle: string;
  phoneLabel: string;
  emailLabel: string;
  vehicleSectionTitle: string;
  vinLabel: string;
  plateLabel: string;
  odometerLabel: string;
  fuelLevelLabel: string;
  reportedIssueTitle: string;
  tasksSectionTitle: string;
  noTasksMessage: string;
  lineItemTypeHeader: string;
  lineItemNoHeader: string;
  lineItemDescriptionHeader: string;
  lineItemQtyHeader: string;
  mechanicNotesLabel: string;
  internalNotesTitle: string;
  footerSignatureLine: string;
  footerDocumentLabel: (orderNumber: string) => string;
};

const WORKSHOP_PDF_COPY: Record<DisplayLanguage, WorkshopPdfCopy> = {
  de: {
    htmlLang: 'de',
    jobCardTitle: 'Arbeitskarte',
    internalDocumentBadge: 'Internes Dokument',
    orderLabel: 'Auftrag',
    customerSectionTitle: 'Kunde',
    phoneLabel: 'Telefon',
    emailLabel: 'E-Mail',
    vehicleSectionTitle: 'Fahrzeug',
    vinLabel: 'FIN',
    plateLabel: 'Kennzeichen',
    odometerLabel: 'Kilometerstand',
    fuelLevelLabel: 'Tankfüllung',
    reportedIssueTitle: 'Gemeldetes Problem / Kundenbeanstandung',
    tasksSectionTitle: 'Aufgaben & Arbeiten',
    noTasksMessage: 'Noch keine Aufgaben zugewiesen.',
    lineItemTypeHeader: 'Typ',
    lineItemNoHeader: 'Art.-Nr.',
    lineItemDescriptionHeader: 'Beschreibung',
    lineItemQtyHeader: 'Menge',
    mechanicNotesLabel: 'Mechanikernotizen',
    internalNotesTitle: 'Interne Notizen',
    footerSignatureLine:
      'Unterschrift Mechaniker: ___________________________ &nbsp;&nbsp;&nbsp;&nbsp; Datum: ________________',
    footerDocumentLabel: (orderNumber) => `Arbeitskarte ${orderNumber}`,
  },
  en: {
    htmlLang: 'en',
    jobCardTitle: 'Job Card',
    internalDocumentBadge: 'Internal Document',
    orderLabel: 'Order',
    customerSectionTitle: 'Customer',
    phoneLabel: 'Phone',
    emailLabel: 'Email',
    vehicleSectionTitle: 'Vehicle Details',
    vinLabel: 'VIN',
    plateLabel: 'Plate',
    odometerLabel: 'Odometer',
    fuelLevelLabel: 'Fuel Level',
    reportedIssueTitle: 'Reported Issue / Customer Complaint',
    tasksSectionTitle: 'Tasks & Operations',
    noTasksMessage: 'No tasks assigned yet.',
    lineItemTypeHeader: 'Type',
    lineItemNoHeader: 'Item No',
    lineItemDescriptionHeader: 'Description',
    lineItemQtyHeader: 'Qty',
    mechanicNotesLabel: 'Mechanic Notes',
    internalNotesTitle: 'Internal Notes',
    footerSignatureLine:
      'Signature Mechanic: ___________________________ &nbsp;&nbsp;&nbsp;&nbsp; Date: ________________',
    footerDocumentLabel: (orderNumber) => `Job Card ${orderNumber}`,
  },
};

export function getWorkshopPdfCopy(
  documentLocale: DisplayLanguage,
): WorkshopPdfCopy {
  return WORKSHOP_PDF_COPY[documentLocale];
}
