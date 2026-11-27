import { InvoiceTaxMode, Prisma } from '@prisma/client';
import type { CreditNoteSnapshotV2 } from '../../credit-notes/credit-note-snapshot.js';
import type { InvoiceSnapshotV2TaxBucket } from '../../invoices/invoice-snapshot-v2.js';
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

function reconcileRowsWithTaxBreakdown(
  rows: AccountingExportBookingRow[],
  taxBreakdown: readonly InvoiceSnapshotV2TaxBucket[] | undefined,
): AccountingExportBookingRow[] {
  if (!taxBreakdown?.length || rows.length === 0) {
    return rows;
  }

  const adjusted = rows.map((row) => ({ ...row }));
  const bucketTaxByRate = new Map<string, Prisma.Decimal>(
    taxBreakdown.map((bucket) => [
      new Prisma.Decimal(bucket.rate).toFixed(2),
      new Prisma.Decimal(bucket.tax),
    ]),
  );

  const indicesByRate = new Map<string, number[]>();
  adjusted.forEach((row, index) => {
    const rateKey = new Prisma.Decimal(row.taxRate).toFixed(2);
    indicesByRate.set(rateKey, [...(indicesByRate.get(rateKey) ?? []), index]);
  });

  for (const [rateKey, indices] of indicesByRate.entries()) {
    const targetTax = bucketTaxByRate.get(rateKey);
    if (!targetTax) continue;

    const currentTax = indices.reduce(
      (sum, idx) => sum.add(new Prisma.Decimal(adjusted[idx].tax)),
      new Prisma.Decimal(0),
    );
    const diff = targetTax.sub(currentTax);
    if (diff.isZero()) continue;

    const step = diff.gt(0)
      ? new Prisma.Decimal('0.01')
      : new Prisma.Decimal('-0.01');
    let remaining = diff.abs();
    const rate = new Prisma.Decimal(rateKey);

    const ranked = [...indices].sort((leftIdx, rightIdx) => {
      const left = adjusted[leftIdx];
      const right = adjusted[rightIdx];
      const leftResidual = new Prisma.Decimal(left.net)
        .mul(rate)
        .div(100)
        .sub(new Prisma.Decimal(left.tax));
      const rightResidual = new Prisma.Decimal(right.net)
        .mul(rate)
        .div(100)
        .sub(new Prisma.Decimal(right.tax));
      const cmp = diff.gt(0)
        ? rightResidual.comparedTo(leftResidual)
        : leftResidual.comparedTo(rightResidual);
      return cmp !== 0 ? cmp : left.lineId.localeCompare(right.lineId);
    });

    for (const idx of ranked) {
      if (remaining.lte(0)) break;
      const row = adjusted[idx];
      const nextTax = new Prisma.Decimal(row.tax).add(step);
      const nextGross = new Prisma.Decimal(row.net).add(nextTax);
      row.tax = nextTax.toFixed(2);
      row.gross = nextGross.toFixed(2);
      remaining = remaining.sub(step.abs());
    }
  }

  return adjusted;
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

  return snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME
    ? rows
    : reconcileRowsWithTaxBreakdown(rows, snapshot.tax_breakdown);
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

  return snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME
    ? rows
    : reconcileRowsWithTaxBreakdown(rows, snapshot.tax_breakdown);
}
