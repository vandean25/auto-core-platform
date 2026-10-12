import type { AccountingExportSite } from './accounting-export-scope.js';
import type {
  AccountingExportBlocker,
  AccountingExportBlockerCode,
  AccountingExportCandidate,
  AccountingExportDocumentKind,
} from './accounting-export.types.js';
import {
  buildAccountingExportReadiness,
  type AccountingExportReadinessSortDirection,
  type AccountingExportReadinessSortField,
} from './accounting-export-readiness.js';

const SITES: AccountingExportSite[] = [
  { id: 'site-berlin', code: 'DE-BER', name: 'Berlin Branch', isActive: true },
];

const hrefFor = (kind: AccountingExportDocumentKind, id: string) =>
  kind === 'INVOICE' ? `/sales/invoices/${id}` : `/finance/credit-notes/${id}`;

function blocker(
  code: AccountingExportBlockerCode,
  documentId: string,
  message = `${code} message`,
): AccountingExportBlocker {
  return {
    code,
    message,
    documentId,
    documentKind: 'INVOICE',
    documentNumber: `${documentId}-number`,
  };
}

function candidate(
  id: string,
  overrides: Partial<AccountingExportCandidate> = {},
): AccountingExportCandidate {
  return {
    id,
    kind: 'INVOICE',
    number: `RE-2026-${id}`,
    date: '2026-03-05',
    siteId: 'site-berlin',
    snapshotHash: `hash-${id}`,
    rows: [],
    blockers: [],
    ...overrides,
  };
}

function build(
  candidates: AccountingExportCandidate[],
  overrides: Partial<Parameters<typeof buildAccountingExportReadiness>[0]> = {},
) {
  return buildAccountingExportReadiness({
    candidates,
    ownershipBlockers: [],
    sites: SITES,
    filters: {},
    page: 1,
    limit: 25,
    hrefFor,
    ...overrides,
  });
}

// Mirrors the e2e mixed-period fixture: two v2 DE invoices (exportable),
// a v1 legacy invoice, an AT invoice, and a v2 DE credit note (exportable).
// Candidates arrive sorted by date from the loader, so the fixture does too.
function mixedPeriod(): AccountingExportCandidate[] {
  return [
    candidate('inv-de-1', { date: '2026-03-05' }),
    candidate('inv-v1', {
      date: '2026-03-10',
      blockers: [blocker('LEGACY_DOCUMENT_UNSUPPORTED', 'inv-v1')],
    }),
    candidate('inv-at', {
      date: '2026-03-12',
      blockers: [blocker('UNSUPPORTED_EXPORT_COUNTRY', 'inv-at')],
    }),
    candidate('inv-de-2', { date: '2026-03-20' }),
    candidate('cn-de', {
      kind: 'CREDIT_NOTE',
      number: 'CN-2026-0001',
      date: '2026-03-25',
    }),
  ];
}

describe('buildAccountingExportReadiness', () => {
  it('counts exportable and blocked documents overall and per document kind', () => {
    const view = build(mixedPeriod());

    expect(view.summary.documentCount).toBe(5);
    expect(view.summary.exportableCount).toBe(3);
    expect(view.summary.blockedCount).toBe(2);
    expect(view.summary.documentKinds).toEqual([
      { kind: 'INVOICE', documentCount: 4, exportableCount: 2, blockedCount: 2 },
      {
        kind: 'CREDIT_NOTE',
        documentCount: 1,
        exportableCount: 1,
        blockedCount: 0,
      },
    ]);
  });

  it('counts a document once per reason even when several lines raise the same blocker', () => {
    const view = build([
      candidate('inv-a', {
        blockers: [
          blocker('UNSUPPORTED_EXPORT_COUNTRY', 'inv-a', 'DE only (line 1)'),
          blocker('UNSUPPORTED_EXPORT_COUNTRY', 'inv-a', 'DE only (line 2)'),
          blocker('ACCOUNTING_MAPPING_INCOMPLETE', 'inv-a'),
        ],
      }),
      candidate('inv-b', {
        blockers: [blocker('UNSUPPORTED_EXPORT_COUNTRY', 'inv-b')],
      }),
    ]);

    expect(view.summary.reasons).toEqual([
      { code: 'UNSUPPORTED_EXPORT_COUNTRY', documentCount: 2 },
      { code: 'ACCOUNTING_MAPPING_INCOMPLETE', documentCount: 1 },
    ]);
    expect(view.data[0].blockers).toEqual([
      { code: 'UNSUPPORTED_EXPORT_COUNTRY', message: 'DE only (line 1)' },
      {
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message: 'ACCOUNTING_MAPPING_INCOMPLETE message',
      },
    ]);
  });

  it('orders reasons by document count, then by code', () => {
    const view = build([
      candidate('a', {
        blockers: [
          blocker('UNSUPPORTED_EXPORT_COUNTRY', 'a'),
          blocker('LEGACY_DOCUMENT_UNSUPPORTED', 'a'),
        ],
      }),
      candidate('b', {
        blockers: [blocker('LEGACY_DOCUMENT_UNSUPPORTED', 'b')],
      }),
      candidate('c', { blockers: [blocker('CANCELLED_DOCUMENT', 'c')] }),
    ]);

    expect(view.summary.reasons).toEqual([
      { code: 'LEGACY_DOCUMENT_UNSUPPORTED', documentCount: 2 },
      { code: 'CANCELLED_DOCUMENT', documentCount: 1 },
      { code: 'UNSUPPORTED_EXPORT_COUNTRY', documentCount: 1 },
    ]);
  });

  it('filters documents by reason and by document kind', () => {
    const byReason = build(mixedPeriod(), {
      filters: { reason: 'UNSUPPORTED_EXPORT_COUNTRY' },
    });
    expect(byReason.data.map((document) => document.id)).toEqual(['inv-at']);
    expect(byReason.meta.total).toBe(1);

    const byKind = build(mixedPeriod(), {
      filters: { documentKind: 'CREDIT_NOTE' },
    });
    expect(byKind.data.map((document) => document.id)).toEqual(['cn-de']);
    expect(byKind.data[0].status).toBe('EXPORTABLE');
  });

  it('keeps summary counts unfiltered when filters narrow the list', () => {
    const view = build(mixedPeriod(), {
      filters: { reason: 'LEGACY_DOCUMENT_UNSUPPORTED' },
    });

    expect(view.data.map((document) => document.id)).toEqual(['inv-v1']);
    expect(view.summary.documentCount).toBe(5);
    expect(view.summary.blockedCount).toBe(2);
  });

  it('searches number, type, status, date and site case-insensitively, not reason codes', () => {
    const idsFor = (search: string) =>
      build(mixedPeriod(), { filters: { search } }).data.map(
        (document) => document.id,
      );

    expect(idsFor('cn-2026')).toEqual(['cn-de']);
    expect(idsFor('CREDIT NOTE')).toEqual(['cn-de']);
    expect(idsFor('2026-03-12')).toEqual(['inv-at']);
    expect(idsFor('de-ber')).toHaveLength(5);
    expect(idsFor('blocked')).toEqual(['inv-v1', 'inv-at']);
    // Reasons are narrowed with the reason filter, so codes are not searched.
    expect(idsFor('legacy_document')).toEqual([]);
  });

  it('sorts by the requested column and keeps the loader order for equal values', () => {
    const idsSortedBy = (
      sortField: AccountingExportReadinessSortField,
      sortDirection: AccountingExportReadinessSortDirection,
    ) =>
      build(mixedPeriod(), { sortField, sortDirection }).data.map(
        (document) => document.id,
      );

    expect(idsSortedBy('date', 'asc')).toEqual([
      'inv-de-1',
      'inv-v1',
      'inv-at',
      'inv-de-2',
      'cn-de',
    ]);
    expect(idsSortedBy('date', 'desc')).toEqual([
      'cn-de',
      'inv-de-2',
      'inv-at',
      'inv-v1',
      'inv-de-1',
    ]);
    expect(idsSortedBy('number', 'asc')).toEqual([
      'cn-de',
      'inv-at',
      'inv-de-1',
      'inv-de-2',
      'inv-v1',
    ]);
    expect(idsSortedBy('kind', 'asc')).toEqual([
      'cn-de',
      'inv-de-1',
      'inv-v1',
      'inv-at',
      'inv-de-2',
    ]);
    expect(idsSortedBy('status', 'asc')).toEqual([
      'inv-v1',
      'inv-at',
      'inv-de-1',
      'inv-de-2',
      'cn-de',
    ]);
    expect(idsSortedBy('site', 'desc')).toEqual([
      'inv-de-1',
      'inv-v1',
      'inv-at',
      'inv-de-2',
      'cn-de',
    ]);
  });

  it('pages after sorting', () => {
    const view = build(mixedPeriod(), {
      sortField: 'date',
      sortDirection: 'desc',
      page: 1,
      limit: 2,
    });

    expect(view.data.map((document) => document.id)).toEqual([
      'cn-de',
      'inv-de-2',
    ]);
    expect(view.meta.total).toBe(5);
  });

  it('paginates the filtered documents and reports total and page count', () => {
    const view = build(mixedPeriod(), { page: 2, limit: 2 });

    expect(view.meta).toEqual({ total: 5, page: 2, limit: 2, pageCount: 3 });
    expect(view.data.map((document) => document.id)).toEqual([
      'inv-at',
      'inv-de-2',
    ]);
  });

  it('keeps only ownership blockers that do not point at a listed document', () => {
    const view = build(mixedPeriod(), {
      ownershipBlockers: [
        {
          code: 'MISSING_OWNERSHIP_EVIDENCE',
          message: 'Document ownership or numbering evidence is incomplete.',
          documentId: 'inv-no-entity',
          documentKind: 'INVOICE',
          documentNumber: 'RE-2026-9',
        },
        {
          code: 'MISSING_OWNERSHIP_EVIDENCE',
          message:
            'A document in the selected period has incomplete ownership evidence.',
        },
        {
          code: 'MISSING_OWNERSHIP_EVIDENCE',
          message: 'Listed document, already shown above.',
          documentId: 'inv-de-1',
        },
      ],
    });

    expect(
      view.tenantWideBlockers.map((blocker) => blocker.documentId ?? 'redacted'),
    ).toEqual(['inv-no-entity', 'redacted']);
  });

  it('links each listed document to its in-app page and resolves its site', () => {
    const view = build(mixedPeriod());

    expect(view.data.find((document) => document.id === 'cn-de')).toMatchObject({
      href: '/finance/credit-notes/cn-de',
      site: { id: 'site-berlin', code: 'DE-BER', name: 'Berlin Branch' },
    });
    expect(
      view.data.find((document) => document.id === 'inv-at')?.href,
    ).toBe('/sales/invoices/inv-at');
  });

  it('reports no site for a document without one', () => {
    const view = build([candidate('inv-unsited', { siteId: '' })]);

    expect(view.data[0].site).toBeNull();
  });
});
