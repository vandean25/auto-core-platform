import {
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
  TransactionType,
} from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { isInvoiceSnapshotV2 } from '../../invoices/invoice-snapshot-v2.validation.js';
import {
  DATEV_ALLOCATION_RULES,
  type AccountingExportAllocationRules,
  type AccountingExportRuleIssue,
} from './accounting-export-allocation-rules.js';
import {
  buildCreditRows,
  buildInvoiceRows,
  buildStockAdjustmentRows,
  isCreditNoteSnapshotV2,
  parseAllocation,
} from './accounting-export-booking-rows.js';
import { computeSnapshotHash } from './accounting-export-hash.js';
import {
  marginDocumentIssue,
  marginLineIssue,
  marginSchemeAvailability,
} from './accounting-export-margin.js';
import { buildExportDocumentDateFilter } from './accounting-export-period.js';
import type {
  AccountingExportBlocker,
  AccountingExportBookingRow,
  AccountingExportCandidate,
  AccountingExportDocumentKind,
  AccountingExportManifestDocument,
  AccountingExportTotalsBucket,
} from './accounting-export.types.js';

const ELIGIBLE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.FINALIZED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
];

export function collectBlockersForInvoice(
  invoice: {
    id: string;
    status: InvoiceStatus;
    invoice_number: string | null;
    site_id: string | null;
    legal_entity_id: string | null;
    tax_mode: InvoiceTaxMode;
    snapshot: unknown;
    items: { id: string; accounting_snapshot: unknown }[];
  },
  rules: AccountingExportAllocationRules,
): AccountingExportBlocker[] {
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

  const snapshot = invoice.snapshot;
  const isMarginDocument = snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME;
  const marginAvailability = marginSchemeAvailability(rules);
  const marginIssue = marginDocumentIssue({
    isMarginDocument,
    availability: marginAvailability,
    notSupportedMessage:
      'Margin-scheme invoices are not supported by the active export profile.',
    margin: snapshot.margin,
    lineGrosses: snapshot.items.map((line) => line.gross),
  });
  if (marginIssue) {
    blockers.push({
      ...marginIssue,
      documentId: invoice.id,
      documentKind: 'INVOICE',
      documentNumber: invoice.invoice_number,
    });
  }

  for (const item of invoice.items) {
    const allocation =
      parseAllocation(item.accounting_snapshot) ??
      parseAllocation(
        snapshot.items.find((line) => line.id === item.id)
          ?.accounting_allocation,
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
    if (allocation.countryIso !== rules.countryIso) {
      blockers.push({
        code: 'UNSUPPORTED_EXPORT_COUNTRY',
        message: rules.unsupportedCountryMessage,
        documentId: invoice.id,
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      });
    }
    const marginLine = marginLineIssue({
      isMarginDocument,
      availability: marginAvailability,
      allocationTaxMode: allocation.taxMode,
      allocationTaxTreatment: allocation.taxTreatment,
    });
    if (marginLine) {
      blockers.push({
        ...marginLine,
        documentId: invoice.id,
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      });
    }
    if (allocation.taxTreatment === 'manual_bu' && !rules.allowManualBu) {
      blockers.push({
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message:
          'Manual BU keys are not used by the RZL profile. Use automatic tax treatment.',
        documentId: invoice.id,
        documentKind: 'INVOICE',
        documentNumber: invoice.invoice_number,
      });
    }
    const lineGross = snapshot.items.find((line) => line.id === item.id)?.gross;
    if (lineGross !== '0.00') {
      const taxRateIssue = rules.taxRateIssue(allocation.taxRate);
      if (taxRateIssue) {
        blockers.push({
          ...taxRateIssue,
          documentId: invoice.id,
          documentKind: 'INVOICE',
          documentNumber: invoice.invoice_number,
        });
      }
      const allocationIssue = rules.allocationIssue?.(allocation);
      if (allocationIssue) {
        blockers.push({
          ...allocationIssue,
          documentId: invoice.id,
          documentKind: 'INVOICE',
          documentNumber: invoice.invoice_number,
        });
      }
    }
  }

  return blockers;
}

export function collectBlockersForCreditNote(
  creditNote: {
    id: string;
    credit_number: string | null;
    snapshot: unknown;
  },
  rules: AccountingExportAllocationRules,
): AccountingExportBlocker[] {
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
  const isMarginDocument = snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME;
  const marginAvailability = marginSchemeAvailability(rules);
  const marginIssue = marginDocumentIssue({
    isMarginDocument,
    availability: marginAvailability,
    notSupportedMessage:
      'Margin-scheme credits are not supported by the active export profile.',
    margin: snapshot.margin,
    lineGrosses: snapshot.items.map((line) => line.gross),
  });
  if (marginIssue) {
    blockers.push({
      ...marginIssue,
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
    if (allocation.countryIso !== rules.countryIso) {
      blockers.push({
        code: 'UNSUPPORTED_EXPORT_COUNTRY',
        message: rules.unsupportedCountryMessage,
        documentId: creditNote.id,
        documentKind: 'CREDIT_NOTE',
        documentNumber: creditNote.credit_number,
      });
    }
    const marginLine = marginLineIssue({
      isMarginDocument,
      availability: marginAvailability,
      allocationTaxMode: allocation.taxMode,
      allocationTaxTreatment: allocation.taxTreatment,
    });
    if (marginLine) {
      blockers.push({
        ...marginLine,
        documentId: creditNote.id,
        documentKind: 'CREDIT_NOTE',
        documentNumber: creditNote.credit_number,
      });
    }
    if (allocation.taxTreatment === 'manual_bu' && !rules.allowManualBu) {
      blockers.push({
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message:
          'Manual BU keys are not used by the RZL profile. Use automatic tax treatment.',
        documentId: creditNote.id,
        documentKind: 'CREDIT_NOTE',
        documentNumber: creditNote.credit_number,
      });
    }
    if (item.gross !== '0.00') {
      const taxRateIssue = rules.taxRateIssue(allocation.taxRate);
      if (taxRateIssue) {
        blockers.push({
          ...taxRateIssue,
          documentId: creditNote.id,
          documentKind: 'CREDIT_NOTE',
          documentNumber: creditNote.credit_number,
        });
      }
      const allocationIssue = rules.allocationIssue?.(allocation);
      if (allocationIssue) {
        blockers.push({
          ...allocationIssue,
          documentId: creditNote.id,
          documentKind: 'CREDIT_NOTE',
          documentNumber: creditNote.credit_number,
        });
      }
    }
  }

  return blockers;
}

function addSignedMoney(
  existing: string,
  amount: string,
  negate: boolean,
): string {
  const value = new Prisma.Decimal(amount);
  const signed = negate ? value.neg() : value;
  return new Prisma.Decimal(existing).plus(signed).toFixed(2);
}

function ownershipBlockerForDocument(
  document: {
    id: string;
    number: string | null;
    siteId: string | null;
    kind: AccountingExportDocumentKind;
  },
  authorizedSiteIds: Set<string>,
): AccountingExportBlocker {
  const canDisclose =
    document.siteId !== null && authorizedSiteIds.has(document.siteId);

  if (canDisclose) {
    return {
      code: 'MISSING_OWNERSHIP_EVIDENCE',
      message: 'Document ownership or numbering evidence is incomplete.',
      documentId: document.id,
      documentKind: document.kind,
      documentNumber: document.number,
    };
  }

  return {
    code: 'MISSING_OWNERSHIP_EVIDENCE',
    message:
      'A document in the selected period has incomplete ownership evidence.',
  };
}

export async function loadTenantOwnershipBlockers(
  prisma: PrismaService,
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  authorizedSiteIds: Set<string>,
): Promise<AccountingExportBlocker[]> {
  const dateFilter = buildExportDocumentDateFilter(dateFrom, dateTo);
  const ownershipStatuses = [
    ...ELIGIBLE_INVOICE_STATUSES,
    InvoiceStatus.CANCELLED,
  ];

  const invoices = await prisma.invoice.findMany({
    where: {
      tenant_id: tenantId,
      date: dateFilter,
      status: { in: ownershipStatuses },
      OR: [{ legal_entity_id: null }, { site_id: null }],
    },
    select: {
      id: true,
      invoice_number: true,
      site_id: true,
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  return invoices.map((invoice) =>
    ownershipBlockerForDocument(
      {
        id: invoice.id,
        number: invoice.invoice_number,
        siteId: invoice.site_id,
        kind: 'INVOICE',
      },
      authorizedSiteIds,
    ),
  );
}

function blockRoundedCandidate(
  candidate: AccountingExportCandidate,
  code: AccountingExportBlocker['code'],
  message: string,
): AccountingExportCandidate {
  return {
    ...candidate,
    rows: [],
    blockers: [
      {
        code,
        message,
        documentId: candidate.id,
        documentKind: candidate.kind,
        documentNumber: candidate.number,
      },
    ],
  };
}

const REVERSE_BOOKING_POLARITY = { S: 'H', H: 'S' } as const;

function readRoundingFacts(snapshot: unknown) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !('rounding_amount' in snapshot)
  ) {
    return null;
  }
  const amount = snapshot.rounding_amount;
  if (amount == null || amount === '0.00') return null;
  return {
    amount,
    payable: 'total_gross' in snapshot ? snapshot.total_gross : undefined,
  };
}

function roundingPostingSetup(
  rules: AccountingExportAllocationRules,
  isNegative: boolean,
): { account: string; steuercode?: string } | AccountingExportRuleIssue {
  const { roundingAccount, roundingSteuercode, countryIso } = rules;
  if (!roundingAccount || (countryIso === 'AT' && !roundingSteuercode)) {
    return {
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message: 'The export profile is missing a non-VAT rounding mapping.',
    };
  }
  if (countryIso === 'AT' && isNegative) {
    return {
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
      message: 'This export format cannot post a negative rounding adjustment.',
    };
  }
  return { account: roundingAccount, steuercode: roundingSteuercode };
}

function findRoundingDebtorRow(
  rows: AccountingExportBookingRow[],
  roundingAccount: string,
  rounding: Prisma.Decimal,
  payable: unknown,
): AccountingExportBookingRow | undefined {
  const [base] = rows;
  const gross = rows.reduce((sum, row) => sum.add(row.gross), rounding);
  if (
    !base ||
    gross.toFixed(2) !== payable ||
    base.debtorAccount === roundingAccount ||
    rows.some((row) => row.debtorAccount !== base.debtorAccount)
  ) {
    return undefined;
  }
  return base;
}

function buildRoundingPosting(
  base: AccountingExportBookingRow,
  rounding: Prisma.Decimal,
  account: string,
  steuercode: string | undefined,
): AccountingExportBookingRow {
  return {
    ...base,
    polarity: rounding.isNegative()
      ? REVERSE_BOOKING_POLARITY[base.polarity]
      : base.polarity,
    net: '0.00',
    tax: '0.00',
    taxRate: '0.00',
    gross: rounding.abs().toFixed(2),
    revenueAccount: account,
    buKey: null,
    ...(steuercode ? { roundingSteuercode: steuercode } : {}),
  };
}

function withDocumentRounding(
  candidate: AccountingExportCandidate,
  snapshot: unknown,
  rules: AccountingExportAllocationRules,
): AccountingExportCandidate {
  const facts = readRoundingFacts(snapshot);
  if (candidate.blockers.length || !facts) {
    return candidate;
  }
  const { amount, payable } = facts;
  if (typeof amount !== 'string' || !/^-?\d+\.\d{2}$/.test(amount)) {
    return blockRoundedCandidate(
      candidate,
      'ACCOUNTING_MAPPING_INCOMPLETE',
      'The document has an invalid rounding amount.',
    );
  }
  const rounding = new Prisma.Decimal(amount);
  const setup = roundingPostingSetup(rules, rounding.isNegative());
  if ('code' in setup) {
    return blockRoundedCandidate(candidate, setup.code, setup.message);
  }
  const base = findRoundingDebtorRow(
    candidate.rows,
    setup.account,
    rounding,
    payable,
  );
  if (!base) {
    return blockRoundedCandidate(
      candidate,
      'ACCOUNTING_MAPPING_INCOMPLETE',
      'The rounding posting requires a separate account and booking rows that reconcile to the document total and debtor.',
    );
  }
  return {
    ...candidate,
    rows: [
      ...candidate.rows,
      buildRoundingPosting(base, rounding, setup.account, setup.steuercode),
    ],
  };
}

function collectExportedAdjustmentIds(
  exports: { document_manifest: unknown }[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of exports) {
    if (!Array.isArray(row.document_manifest)) continue;
    for (const entry of row.document_manifest) {
      if (
        entry &&
        typeof entry === 'object' &&
        (entry as { kind?: unknown }).kind === 'STOCK_ADJUSTMENT' &&
        typeof (entry as { id?: unknown }).id === 'string'
      ) {
        ids.add((entry as { id: string }).id);
      }
    }
  }
  return ids;
}

export async function loadAccountingExportCandidates(
  prisma: PrismaService,
  tenantId: string,
  legalEntityId: string,
  dateFrom: Date,
  dateTo: Date,
  rules: AccountingExportAllocationRules = DATEV_ALLOCATION_RULES,
  authorizedSiteIds?: Set<string>,
): Promise<AccountingExportCandidate[]> {
  const dateFilter = buildExportDocumentDateFilter(dateFrom, dateTo);
  const [invoices, creditNotes, stockAdjustments, completedExports] =
    await Promise.all([
      prisma.invoice.findMany({
        where: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          date: dateFilter,
          status: {
            in: [...ELIGIBLE_INVOICE_STATUSES, InvoiceStatus.CANCELLED],
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
          date: dateFilter,
        },
        include: { items: true },
        orderBy: [{ date: 'asc' }, { credit_number: 'asc' }, { id: 'asc' }],
      }),
      prisma.inventoryTransaction.findMany({
        where: {
          tenant_id: tenantId,
          site_id: authorizedSiteIds
            ? { in: [...authorizedSiteIds] }
            : { not: '' },
          type: TransactionType.ADJUSTMENT,
          cost_basis: { not: null },
          createdAt: dateFilter,
          location: {
            site: {
              legal_entity_id: legalEntityId,
            },
          },
        },
        include: {
          item: { select: { sku: true, name: true } },
          reversed_by: { select: { id: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }, { id: 'asc' }],
      }),
      prisma.accountingExport.findMany({
        where: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
        },
        select: { document_manifest: true },
      }),
    ]);

  const exportedAdjustmentIds = collectExportedAdjustmentIds(completedExports);

  const invoiceCandidates = invoices.map((invoice) => {
    const blockers = collectBlockersForInvoice(invoice, rules);
    const documentDate = invoice.date.toISOString().slice(0, 10);
    const rows =
      blockers.length > 0 ? [] : buildInvoiceRows(invoice, documentDate, rules);

    return withDocumentRounding(
      {
        id: invoice.id,
        kind: 'INVOICE' as const,
        number: invoice.invoice_number,
        date: documentDate,
        siteId: invoice.site_id ?? '',
        snapshotHash: computeSnapshotHash(invoice.snapshot),
        rows,
        blockers,
      },
      invoice.snapshot,
      rules,
    );
  });

  const creditCandidates = creditNotes.map((creditNote) => {
    const blockers = collectBlockersForCreditNote(creditNote, rules);
    const rows = blockers.length > 0 ? [] : buildCreditRows(creditNote, rules);

    return withDocumentRounding(
      {
        id: creditNote.id,
        kind: 'CREDIT_NOTE' as const,
        number: creditNote.credit_number,
        date: creditNote.date.toISOString().slice(0, 10),
        siteId: creditNote.site_id,
        snapshotHash: computeSnapshotHash(creditNote.snapshot),
        rows,
        blockers,
      },
      creditNote.snapshot,
      rules,
    );
  });

  const stockAdjustmentCandidates = stockAdjustments
    .filter((tx) => tx.cost_basis !== null && !exportedAdjustmentIds.has(tx.id))
    .map((tx) => {
      const documentDate = tx.createdAt.toISOString().slice(0, 10);
      const costBasis = tx.cost_basis!;
      const rows = buildStockAdjustmentRows(
        {
          id: tx.id,
          seq: tx.seq,
          site_id: tx.site_id,
          quantity: tx.quantity,
          cost_basis: costBasis,
          reason: tx.reason,
          note: tx.note,
          reversal_of_transaction_id: tx.reversal_of_transaction_id,
          reversed_by: tx.reversed_by,
          item: tx.item,
          createdAt: tx.createdAt,
        },
        documentDate,
        rules.stockAdjustmentAccount,
      );

      return {
        id: tx.id,
        kind: 'STOCK_ADJUSTMENT' as const,
        number: `BV-${tx.seq}`,
        date: documentDate,
        siteId: tx.site_id,
        snapshotHash: computeSnapshotHash({
          id: tx.id,
          seq: tx.seq.toString(),
          quantity: tx.quantity.toString(),
          cost_basis: costBasis.toString(),
          reason: tx.reason,
          reversal_of_transaction_id: tx.reversal_of_transaction_id,
        }),
        rows,
        blockers: [],
      };
    });

  return [
    ...invoiceCandidates,
    ...creditCandidates,
    ...stockAdjustmentCandidates,
  ].sort((left, right) => {
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
    // A margin line books two rows, so its line id appears once in the manifest.
    lineIds: [...new Set(candidate.rows.map((row) => row.lineId))],
  }));
}

export function computeSignedTotals(
  rows: AccountingExportBookingRow[],
): AccountingExportTotalsBucket[] {
  const buckets = new Map<string, AccountingExportTotalsBucket>();

  for (const row of rows) {
    const bucketKey = `${row.revenueAccount}:${row.taxRate}`;
    const existing = buckets.get(bucketKey) ?? {
      account: row.revenueAccount,
      taxRate: row.taxRate,
      net: '0.00',
      tax: '0.00',
      gross: '0.00',
    };

    const negate = row.polarity === 'H';
    buckets.set(bucketKey, {
      ...existing,
      net: addSignedMoney(existing.net, row.net, negate),
      tax: addSignedMoney(existing.tax, row.tax, negate),
      gross: addSignedMoney(existing.gross, row.gross, negate),
    });
  }

  return [...buckets.values()].sort((left, right) => {
    if (left.account !== right.account) {
      return left.account < right.account ? -1 : 1;
    }
    return left.taxRate < right.taxRate
      ? -1
      : left.taxRate > right.taxRate
        ? 1
        : 0;
  });
}
