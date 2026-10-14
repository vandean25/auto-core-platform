import { InvoiceTaxMode } from '@prisma/client';
import type { CreditNoteSnapshotV2 } from '../../credit-notes/credit-note-snapshot.js';
import { isInvoiceSnapshotV2 } from '../../invoices/invoice-snapshot-v2.validation.js';
import type { ResolvedAccountingAllocation } from '../accounting-profile/accounting-profile.types.js';
import type { AccountingExportAllocationRules } from './accounting-export-allocation-rules.js';
import { buildMarginBookingRows } from './accounting-export-margin.js';
import type { AccountingExportBookingRow } from './accounting-export.types.js';

export function isCreditNoteSnapshotV2(
  value: unknown,
): value is CreditNoteSnapshotV2 {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { schema_version?: unknown }).schema_version === 2 &&
    (value as { document_kind?: unknown }).document_kind === 'CREDIT_NOTE'
  );
}

export function parseAllocation(
  value: unknown,
): ResolvedAccountingAllocation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const allocation = value as ResolvedAccountingAllocation;
  if (
    !allocation.revenueAccount ||
    !allocation.debtorAccount ||
    !allocation.taxMode ||
    !allocation.taxRate ||
    !allocation.countryIso
  ) {
    return null;
  }
  return allocation;
}

function buildBookingText(input: {
  documentKind: 'INVOICE' | 'CREDIT_NOTE';
  documentNumber: string;
  originalInvoiceNumber?: string;
}): string {
  const base =
    input.documentKind === 'CREDIT_NOTE' && input.originalInvoiceNumber
      ? `CN ${input.documentNumber} / RE ${input.originalInvoiceNumber}`
      : `RE ${input.documentNumber}`;
  return base.slice(0, 60);
}

export function buildInvoiceRows(
  invoice: {
    id: string;
    invoice_number: string | null;
    snapshot: unknown;
    items: { id: string; accounting_snapshot: unknown }[];
  },
  documentDate: string,
  rules: AccountingExportAllocationRules,
): AccountingExportBookingRow[] {
  if (!isInvoiceSnapshotV2(invoice.snapshot) || !invoice.invoice_number) {
    return [];
  }

  const snapshot = invoice.snapshot;
  const rows: AccountingExportBookingRow[] = [];

  for (const item of invoice.items) {
    const snapshotItem = snapshot.items.find((line) => line.id === item.id);
    const allocation =
      parseAllocation(item.accounting_snapshot) ??
      parseAllocation(snapshotItem?.accounting_allocation);
    const gross = snapshotItem?.gross;
    if (!allocation || !gross || gross === '0.00') {
      continue;
    }

    if (snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
      rows.push(
        ...buildMarginBookingRows({
          base: {
            documentId: invoice.id,
            documentKind: 'INVOICE',
            documentNumber: invoice.invoice_number,
            documentDate,
            lineId: item.id,
            bookingText: buildBookingText({
              documentKind: 'INVOICE',
              documentNumber: invoice.invoice_number,
            }),
          },
          polarity: 'S',
          gross,
          margin: snapshot.margin,
          revenueAccount: allocation.revenueAccount,
          debtorAccount: allocation.debtorAccount,
          vatAccount: rules.marginScheme.vatAccount,
        }),
      );
      continue;
    }

    rows.push({
      documentId: invoice.id,
      documentKind: 'INVOICE',
      documentNumber: invoice.invoice_number,
      documentDate,
      lineId: item.id,
      polarity: 'S',
      net: snapshotItem.net,
      tax: snapshotItem.tax,
      taxRate: allocation.taxRate,
      gross,
      debtorAccount: allocation.debtorAccount,
      revenueAccount: allocation.revenueAccount,
      buKey: allocation.taxTreatment === 'manual_bu' ? allocation.buKey : null,
      bookingText: buildBookingText({
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      }),
    });
  }

  return rows;
}

export function buildCreditRows(
  creditNote: {
    id: string;
    credit_number: string | null;
    snapshot: unknown;
  },
  rules: AccountingExportAllocationRules,
): AccountingExportBookingRow[] {
  if (
    !isCreditNoteSnapshotV2(creditNote.snapshot) ||
    !creditNote.credit_number
  ) {
    return [];
  }

  const snapshot = creditNote.snapshot;
  const rows: AccountingExportBookingRow[] = [];

  for (const item of snapshot.items) {
    const allocation = parseAllocation(item.accounting_allocation);
    if (!allocation || item.gross === '0.00') {
      continue;
    }

    if (snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
      rows.push(
        ...buildMarginBookingRows({
          base: {
            documentId: creditNote.id,
            documentKind: 'CREDIT_NOTE',
            documentNumber: creditNote.credit_number,
            documentDate: snapshot.date,
            lineId: item.id,
            bookingText: buildBookingText({
              documentKind: 'CREDIT_NOTE',
              documentNumber: creditNote.credit_number,
              originalInvoiceNumber: snapshot.original_document.number,
            }),
            originalInvoiceNumber: snapshot.original_document.number,
          },
          polarity: 'H',
          gross: item.gross,
          margin: snapshot.margin,
          revenueAccount: allocation.revenueAccount,
          debtorAccount: allocation.debtorAccount,
          vatAccount: rules.marginScheme.vatAccount,
        }),
      );
      continue;
    }

    rows.push({
      documentId: creditNote.id,
      documentKind: 'CREDIT_NOTE',
      documentNumber: creditNote.credit_number,
      documentDate: snapshot.date,
      lineId: item.id,
      polarity: 'H',
      net: item.net,
      tax: item.tax,
      taxRate: allocation.taxRate,
      gross: item.gross,
      debtorAccount: allocation.debtorAccount,
      revenueAccount: allocation.revenueAccount,
      buKey: allocation.taxTreatment === 'manual_bu' ? allocation.buKey : null,
      bookingText: buildBookingText({
        documentKind: 'CREDIT_NOTE',
        documentNumber: creditNote.credit_number,
        originalInvoiceNumber: snapshot.original_document.number,
      }),
      originalInvoiceNumber: snapshot.original_document.number,
    });
  }

  return rows;
}
