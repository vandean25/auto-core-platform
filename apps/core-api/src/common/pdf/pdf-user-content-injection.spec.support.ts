import { CustomerType, WorkshopLineItemType } from '@prisma/client';
import { createInvoicePdfDateFormatter } from '../../invoices/invoice-pdf-date-format.helpers.js';
import { buildInvoiceHtmlDocument } from '../../invoices/invoice-pdf.layout.js';
import type { InvoiceSnapshot } from '../../invoices/invoice-snapshot.js';
import { buildKaufvertragHtmlDocument } from '../../vehicle-stock/kaufvertrag/kaufvertrag-pdf.layout.js';
import {
  buildKaufvertragSnapshot,
  type KaufvertragSnapshotInput,
} from '../../vehicle-stock/kaufvertrag/kaufvertrag-snapshot.js';
import { buildWorkshopEstimateHtmlDocument } from '../../workshop/workshop-estimate-pdf.layout.js';
import { buildEstimateSnapshot } from '../../workshop/workshop-estimate.spec.support.js';
import {
  buildWarrantyClaimHtml,
  type WarrantyClaimPdfContent,
} from '../../warranty-claim/warranty-claim-pdf.layout.js';
import { escapeHtml } from './pdf-layout.js';
import {
  PDF_SCRIPT_INJECTION_PAYLOAD,
  PDF_XML_INJECTION_PAYLOAD,
} from './pdf-user-content-injection.fixture.js';

const KAUFVERTRAG_INJECTION_BASE: KaufvertragSnapshotInput = {
  sale: {
    id: '00000000-0000-4000-8000-000000000099',
    sale_number: 'VS-2026-0099',
    sale_price_eur: '18500.00',
    contract_concluded_at: new Date('2026-11-11T00:00:00.000Z'),
    handed_over_at: new Date('2026-11-11T00:00:00.000Z'),
  },
  seller: {
    name: 'pilot customer GmbH',
    country_iso: 'AT',
    address_street: 'Musterweg 1',
    address_line2: null,
    address_zip: '1010',
    address_city: 'Wien',
    tax_number: null,
    vat_id: 'ATU12345678',
    iban: null,
    bic: null,
    bank_name: null,
    email: null,
    phone: null,
    registration_number: null,
    registration_court: null,
    representatives: null,
  },
  buyer: {
    type: 'PRIVATE',
    company_name: PDF_XML_INJECTION_PAYLOAD,
    first_name: PDF_SCRIPT_INJECTION_PAYLOAD,
    last_name: 'Mustermann',
    vat_id: null,
    address_street: 'Beispielgasse 2',
    address_zip: '4020',
    address_city: 'Linz',
    address_country: 'AT',
  },
  vehicle: {
    make: PDF_XML_INJECTION_PAYLOAD,
    model: PDF_SCRIPT_INJECTION_PAYLOAD,
    vin: 'DEMOVIN0000000001',
    hsn: '1234',
    tsn: 'ABC',
    color: PDF_SCRIPT_INJECTION_PAYLOAD,
    mileage: 84500,
    first_registration_date: new Date('2020-10-08T00:00:00.000Z'),
  },
  warranty: {
    regime: 'CONSUMER_BASE',
    contractConcludedAt: new Date('2026-11-11T00:00:00.000Z'),
    handedOverAt: new Date('2026-11-11T00:00:00.000Z'),
    buyerIsConsumer: true,
    basePeriodYears: 2,
    presumptionPeriodYears: 1,
    baseEndsOn: new Date('2028-11-11T00:00:00.000Z'),
    presumptionEndsOn: new Date('2027-11-11T00:00:00.000Z'),
    ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
  },
  garantie: { months: 12, terms: PDF_XML_INJECTION_PAYLOAD },
  branding: {
    schema_version: 1,
    profile_id: null,
    profile_revision: 0,
    preset_id: 'standard-v1',
    font_id: 'acp-sans-v1',
    tokens: {
      primary_color: '#1d4ed8',
      secondary_color: '#0f172a',
      header_band: 'none',
      footer_band: 'none',
      header_text: 'pilot customer',
      footer_text: 'pilot customer GmbH',
    },
    logo: null,
    resolved_at: '2026-11-11T12:00:00.000Z',
  },
};

export function buildInvoiceInjectionHtml(): string {
  const snapshot: InvoiceSnapshot = {
    id: 'invoice-injection-1',
    invoice_number: 'RE-2026-0099',
    date: '2026-11-11',
    due_date: '2026-11-25',
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: PDF_SCRIPT_INJECTION_PAYLOAD,
    tax_mode: 'STANDARD',
    customer: {
      type: 'COMPANY',
      company_name: PDF_XML_INJECTION_PAYLOAD,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      phone: null,
      vat_id: null,
      address_street: null,
      address_city: 'Wien',
      address_zip: '1010',
      address_country: null,
    },
    vehicle: null,
    items: [
      {
        description: PDF_SCRIPT_INJECTION_PAYLOAD,
        quantity: '1',
        unit_price: '100.00',
        tax_rate: '20',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '100.00',
        revenue_group_name: null,
      },
    ],
    snapshot_created_at: '2026-11-11T12:00:00.000Z',
  };
  const invoiceNumber = snapshot.invoice_number ?? snapshot.id;
  return buildInvoiceHtmlDocument(
    snapshot,
    invoiceNumber,
    escapeHtml,
    createInvoicePdfDateFormatter(snapshot),
  );
}

export function buildKaufvertragInjectionHtml(): string {
  return buildKaufvertragHtmlDocument(
    buildKaufvertragSnapshot(KAUFVERTRAG_INJECTION_BASE),
    { fontFaceCss: '' },
  );
}

export function buildWorkshopEstimateInjectionHtml(): string {
  const snapshot = buildEstimateSnapshot({
    customer: {
      type: CustomerType.PRIVATE,
      company_name: PDF_XML_INJECTION_PAYLOAD,
      first_name: PDF_SCRIPT_INJECTION_PAYLOAD,
      last_name: 'Mustermann',
      email: null,
      phone: null,
      vat_id: null,
      address_street: 'Hauptstraße 2',
      address_city: 'Graz',
      address_zip: '8010',
      address_country: 'AT',
    },
    lines: [
      {
        source_line_id: 'line-1',
        type: WorkshopLineItemType.PART,
        item_no: 'P-1',
        description: PDF_SCRIPT_INJECTION_PAYLOAD,
        quantity: '1.000',
        unit_price: '100.00',
        tax_rate: '20.00',
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
      },
    ],
  });
  return buildWorkshopEstimateHtmlDocument(snapshot, '', escapeHtml);
}

export function buildWarrantyClaimInjectionHtml(): string {
  const content: WarrantyClaimPdfContent = {
    claim: {
      id: 'claim-1',
      workshopOrderId: 'order-1',
      type: 'GARANTIE',
      status: 'DRAFT',
      complaint: PDF_SCRIPT_INJECTION_PAYLOAD,
      causeCorrection: PDF_XML_INJECTION_PAYLOAD,
      claimedAmountNet: '100.00',
      linesNetAmount: '100.00',
      externalReference: PDF_XML_INJECTION_PAYLOAD,
      decisionDate: null,
      decisionNote: PDF_SCRIPT_INJECTION_PAYLOAD,
      submittedAt: null,
      closedAt: null,
      createdAt: '2026-11-11T12:00:00.000Z',
      updatedAt: '2026-11-11T12:00:00.000Z',
      pdfGenerationError: null,
      lines: [
        {
          id: 'line-1',
          workshopTaskLineItemId: 'item-1',
          lineType: 'PART',
          itemNo: 'P-1',
          description: PDF_SCRIPT_INJECTION_PAYLOAD,
          quantity: '1.000',
          unitPrice: '100.00',
          netAmount: '100.00',
        },
      ],
    },
    order: {
      orderNumber: 'WO-2026-0007',
      odometer: 1000,
      vehicle: {
        make: PDF_XML_INJECTION_PAYLOAD,
        model: 'Model',
        vin: 'VIN',
        plate: 'W-1',
      },
    },
    seller: { name: 'pilot customer', addressLines: ['Line 1'], vatId: null },
    tokens: { primaryColor: '#111827', secondaryColor: '#E5E7EB' },
    logoDataUrl: null,
    generatedAt: new Date('2026-11-11T12:00:00.000Z'),
  };
  return buildWarrantyClaimHtml(content, { fontFaceCss: '' });
}
