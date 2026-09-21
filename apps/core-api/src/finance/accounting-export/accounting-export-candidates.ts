import { InvoiceStatus, InvoiceTaxMode } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ResolvedAccountingAllocation } from '../accounting-profile/accounting-profile.types.js';
import { isInvoiceSnapshotV2 } from '../../invoices/invoice-snapshot-v2.validation.js';
import type { InvoiceSnapshotV2 } from '../../invoices/invoice-snapshot-v2.js';
import type { CreditNoteSnapshotV2 } from '../../credit-notes/credit-note-snapshot.js';
import { computeSnapshotHash } from './accounting-export-hash.js';
import type {
  AccountingExportBlocker,
  AccountingExportBookingRow,
  AccountingExportCandidate,
  AccountingExportManifestDocument,
  AccountingExportTotalsBucket,
} from './accounting-export.types.js';

const ELIGIBLE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.FINALIZED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
];

function isCreditNoteSnapshotV2(value: unknown): value is CreditNoteSnapshotV2 {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { schema_version?: unknown }).schema_version === 2 &&
    (value as { document_kind?: unknown }).document_kind === 'CREDIT_NOTE'
  );
}

function parseAllocation(value: unknown): ResolvedAccountingAllocation | null {
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

function collectBlockersForInvoice(invoice: {
  id: string;
  status: InvoiceStatus;
  invoice_number: string | null;
  site_id: string | null;
  legal_entity_id: string | null;
  tax_mode: InvoiceTaxMode;
  snapshot: unknown;
  items: { id: string; accounting_snapshot: unknown }[];
}): AccountingExportBlocker[] {
  const blockers: AccountingExportBlocker[] = [];

  if (invoice.status === InvoiceStatus.CANCELLED) {
    blockers.push({
      code: 'CANCELLED_DOCUMENT',
      message: 'Cancelled invoices cannot be exported.',
      documentId: invoice.id,
      documentKind: 'INVOICE',
      documentNumber: invoice.invoice_number,
    });
    return blockers;
  }

  if (!ELIGIBLE_INVOICE_STATUSES.includes(invoice.status)) {
    return blockers;
  }

  if (!invoice.site_id || !invoice.legal_entity_id || !invoice.invoice_number) {
    blockers.push({
      code: 'MISSING_OWNERSHIP_EVIDENCE',
      message: 'Invoice ownership or numbering evidence is incomplete.',
      documentId: invoice.id,
      documentKind: 'INVOICE',
      documentNumber: invoice.invoice_number,
    });
  }

  if (!isInvoiceSnapshotV2(invoice.snapshot)) {
    blockers.push({
      code: 'LEGACY_DOCUMENT_UNSUPPORTED',
      message: 'Invoice requires a version-2 snapshot.',
      documentId: invoice.id,
      documentKind: 'INVOICE',
      documentNumber: invoice.invoice_number,
    });
    return blockers;
  }

  const snapshot = invoice.snapshot as InvoiceSnapshotV2;

  if (snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    blockers.push({
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
      message: 'Margin-scheme invoices are not supported by the active export profile.',
      documentId: invoice.id,
      documentKind: 'INVOICE',
      documentNumber: invoice.invoice_number,
    });
  }

  for (const item of invoice.items) {
    const allocation =
      parseAllocation(item.accounting_snapshot) ??
      parseAllocation(
        snapshot.items.find((line) => line.id === item.id)?.accounting_allocation,
      );
    if (!allocation) {
      blockers.push({
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message: 'Invoice line is missing frozen accounting allocation.',
        documentId: invoice.id,
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      });
      continue;
    }
    if (allocation.countryIso !== 'DE') {
      blockers.push({
        code: 'UNSUPPORTED_EXPORT_COUNTRY',
        message: 'Only DE domestic STANDARD VAT exports are enabled in slice 1.',
        documentId: invoice.id,
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      });
    }
    if (allocation.taxMode === 'MARGIN_SCHEME') {
      blockers.push({
        code: 'UNSUPPORTED_EXPORT_TAX_MODE',
        message: 'Margin-scheme allocations cannot be exported with the active profile.',
        documentId: invoice.id,
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      });
    }
  }

  return blockers;
}

function collectBlockersForCreditNote(creditNote: {
  id: string;
  credit_number: string | null;
  snapshot: unknown;
}): AccountingExportBlocker[] {
  const blockers: AccountingExportBlocker[] = [];

  if (!isCreditNoteSnapshotV2(creditNote.snapshot)) {
    blockers.push({
      code: 'LEGACY_DOCUMENT_UNSUPPORTED',
      message: 'Credit note requires a version-2 snapshot.',
      documentId: creditNote.id,
      documentKind: 'CREDIT_NOTE',
      documentNumber: creditNote.credit_number,
    });
    return blockers;
  }

  const snapshot = creditNote.snapshot;

  if (snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    blockers.push({
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
      message: 'Margin-scheme credits are not supported by the active export profile.',
      documentId: creditNote.id,
      documentKind: 'CREDIT_NOTE',
      documentNumber: creditNote.credit_number,
    });
  }

  for (const item of snapshot.items) {
    const allocation = parseAllocation(item.accounting_allocation);
    if (!allocation) {
      blockers.push({
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message: 'Credit note line is missing frozen accounting allocation.',
        documentId: creditNote.id,
        documentKind: 'CREDIT_NOTE',
        documentNumber: creditNote.credit_number,
      });
      continue;
    }
    if (allocation.countryIso !== 'DE') {
      blockers.push({
        code: 'UNSUPPORTED_EXPORT_COUNTRY',
        message: 'Only DE domestic STANDARD VAT exports are enabled in slice 1.',
        documentId: creditNote.id,
        documentKind: 'CREDIT_NOTE',
        documentNumber: creditNote.credit_number,
      });
    }
    if (allocation.taxMode === 'MARGIN_SCHEME') {
      blockers.push({
        code: 'UNSUPPORTED_EXPORT_TAX_MODE',
        message: 'Margin-scheme allocations cannot be exported with the active profile.',
        documentId: creditNote.id,
        documentKind: 'CREDIT_NOTE',
        documentNumber: creditNote.credit_number,
      });
    }
  }

  return blockers;
}

function buildInvoiceRows(
  invoice: {
    id: string;
    invoice_number: string | null;
    snapshot: unknown;
    items: { id: string; accounting_snapshot: unknown }[];
  },
  documentDate: string,
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

    rows.push({
      documentId: invoice.id,
      documentKind: 'INVOICE',
      documentNumber: invoice.invoice_number,
      documentDate,
      lineId: item.id,
      polarity: 'S',
      gross,
      debtorAccount: allocation.debtorAccount,
      revenueAccount: allocation.revenueAccount,
      buKey:
        allocation.taxTreatment === 'manual_bu'
          ? allocation.buKey
          : null,
      bookingText: buildBookingText({
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      }),
    });
  }

  return rows;
}

function buildCreditRows(creditNote: {
  id: string;
  credit_number: string | null;
  snapshot: unknown;
}): AccountingExportBookingRow[] {
  if (!isCreditNoteSnapshotV2(creditNote.snapshot) || !creditNote.credit_number) {
    return [];
  }

  const snapshot = creditNote.snapshot;
  const rows: AccountingExportBookingRow[] = [];

  for (const item of snapshot.items) {
    const allocation = parseAllocation(item.accounting_allocation);
    if (!allocation || item.gross === '0.00') {
      continue;
    }

    rows.push({
      documentId: creditNote.id,
      documentKind: 'CREDIT_NOTE',
      documentNumber: creditNote.credit_number,
      documentDate: snapshot.date,
      lineId: item.id,
      polarity: 'H',
      gross: item.gross,
      debtorAccount: allocation.debtorAccount,
      revenueAccount: allocation.revenueAccount,
      buKey:
        allocation.taxTreatment === 'manual_bu'
          ? allocation.buKey
          : null,
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

export async function loadAccountingExportCandidates(
  prisma: PrismaService,
  tenantId: string,
  legalEntityId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<AccountingExportCandidate[]> {
  const [invoices, creditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        date: { gte: dateFrom, lte: dateTo },
        status: {
          in: [
            ...ELIGIBLE_INVOICE_STATUSES,
            InvoiceStatus.CANCELLED,
          ],
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ date: 'asc' }, { invoice_number: 'asc' }, { id: 'asc' }],
    }),
    prisma.creditNote.findMany({
      where: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        status: 'FINALIZED',
        date: { gte: dateFrom, lte: dateTo },
      },
      include: { items: true },
      orderBy: [{ date: 'asc' }, { credit_number: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const invoiceCandidates = invoices.map((invoice) => {
    const blockers = collectBlockersForInvoice(invoice);
    const documentDate = invoice.date.toISOString().slice(0, 10);
    const rows = blockers.length > 0
      ? []
      : buildInvoiceRows(invoice, documentDate);

    return {
      id: invoice.id,
      kind: 'INVOICE' as const,
      number: invoice.invoice_number,
      date: documentDate,
      siteId: invoice.site_id ?? '',
      snapshotHash: computeSnapshotHash(invoice.snapshot),
      rows,
      blockers,
    };
  });

  const creditCandidates = creditNotes.map((creditNote) => {
    const blockers = collectBlockersForCreditNote(creditNote);
    const rows = blockers.length > 0 ? [] : buildCreditRows(creditNote);

    return {
      id: creditNote.id,
      kind: 'CREDIT_NOTE' as const,
      number: creditNote.credit_number,
      date: creditNote.date.toISOString().slice(0, 10),
      siteId: creditNote.site_id,
      snapshotHash: computeSnapshotHash(creditNote.snapshot),
      rows,
      blockers,
    };
  });

  return [...invoiceCandidates, ...creditCandidates].sort((left, right) => {
    if (left.date !== right.date) {
      return left.date < right.date ? -1 : 1;
    }
    if (left.kind !== right.kind) {
      return left.kind < right.kind ? -1 : 1;
    }
    if ((left.number ?? '') !== (right.number ?? '')) {
      return (left.number ?? '') < (right.number ?? '') ? -1 : 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function collectUniqueBlockers(
  candidates: AccountingExportCandidate[],
): AccountingExportBlocker[] {
  const seen = new Set<string>();
  const blockers: AccountingExportBlocker[] = [];

  for (const candidate of candidates) {
    for (const blocker of candidate.blockers) {
      const key = `${blocker.code}:${blocker.documentId ?? 'global'}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      blockers.push(blocker);
    }
  }

  return blockers;
}

export function flattenBookingRows(
  candidates: AccountingExportCandidate[],
): AccountingExportBookingRow[] {
  return candidates.flatMap((candidate) => candidate.rows);
}

export function buildManifestDocuments(
  candidates: AccountingExportCandidate[],
): AccountingExportManifestDocument[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    kind: candidate.kind,
    number: candidate.number,
    date: candidate.date,
    siteId: candidate.siteId,
    snapshotHash: candidate.snapshotHash,
    lineIds: candidate.rows.map((row) => row.lineId),
  }));
}

export function computeSignedTotals(
  rows: AccountingExportBookingRow[],
): AccountingExportTotalsBucket[] {
  const buckets = new Map<string, AccountingExportTotalsBucket>();

  for (const row of rows) {
    const taxRate = '0.00';
    const bucketKey = `${row.revenueAccount}:${taxRate}`;
    const existing = buckets.get(bucketKey) ?? {
      account: row.revenueAccount,
      taxRate,
      net: '0.00',
      tax: '0.00',
      gross: '0.00',
    };

    const grossValue = Number.parseFloat(row.gross);
    const signedGross = row.polarity === 'H' ? -grossValue : grossValue;
    const nextGross = Number.parseFloat(existing.gross) + signedGross;

    buckets.set(bucketKey, {
      ...existing,
      gross: nextGross.toFixed(2),
    });
  }

  return [...buckets.values()].sort((left, right) =>
    left.account < right.account ? -1 : left.account > right.account ? 1 : 0,
  );
}
