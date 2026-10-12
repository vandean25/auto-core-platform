import type { AccountingExportSite } from './accounting-export-scope.js';
import {
  ACCOUNTING_EXPORT_BLOCKER_CODES,
  ACCOUNTING_EXPORT_DOCUMENT_KINDS,
} from './accounting-export-codes.js';
import type {
  AccountingExportBlocker,
  AccountingExportBlockerCode,
  AccountingExportCandidate,
  AccountingExportDocumentKind,
} from './accounting-export.types.js';

export const ACCOUNTING_EXPORT_READINESS_SORT_FIELDS = [
  'number',
  'kind',
  'date',
  'site',
  'status',
] as const;

export type AccountingExportReadinessSortField =
  (typeof ACCOUNTING_EXPORT_READINESS_SORT_FIELDS)[number];

export type AccountingExportReadinessSortDirection = 'asc' | 'desc';

export type AccountingExportReadinessStatus = 'EXPORTABLE' | 'BLOCKED';

export type AccountingExportReadinessBlocker = {
  code: AccountingExportBlockerCode;
  message: string;
};

export type AccountingExportReadinessDocument = {
  id: string;
  kind: AccountingExportDocumentKind;
  number: string | null;
  date: string;
  site: { id: string; code: string; name: string } | null;
  status: AccountingExportReadinessStatus;
  blockers: AccountingExportReadinessBlocker[];
  href: string;
};

export type AccountingExportReadinessFilters = {
  reason?: AccountingExportBlockerCode;
  documentKind?: AccountingExportDocumentKind;
  search?: string;
};

export type AccountingExportReadinessSummary = {
  documentCount: number;
  exportableCount: number;
  blockedCount: number;
  documentKinds: {
    kind: AccountingExportDocumentKind;
    documentCount: number;
    exportableCount: number;
    blockedCount: number;
  }[];
  reasons: { code: AccountingExportBlockerCode; documentCount: number }[];
};

export type AccountingExportReadinessInput = {
  // The loader returns candidates already sorted by date, kind, number and id.
  // That order is the default, and documents with equal sort values keep it.
  candidates: AccountingExportCandidate[];
  ownershipBlockers: AccountingExportBlocker[];
  sites: AccountingExportSite[];
  filters: AccountingExportReadinessFilters;
  sortField?: AccountingExportReadinessSortField;
  sortDirection?: AccountingExportReadinessSortDirection;
  page: number;
  limit: number;
  hrefFor: (kind: AccountingExportDocumentKind, id: string) => string;
};

export type AccountingExportReadinessView = {
  summary: AccountingExportReadinessSummary;
  tenantWideBlockers: AccountingExportBlocker[];
  data: AccountingExportReadinessDocument[];
  meta: { total: number; page: number; limit: number; pageCount: number };
};

const KIND_SEARCH_LABEL: Record<AccountingExportDocumentKind, string> = {
  INVOICE: 'invoice',
  CREDIT_NOTE: 'credit note',
};

// The Date column shows the day as "05 Mar 2026", so search matches that text too.
// Same options as the page; UTC keeps the day the same in every time zone.
const DATE_SEARCH_LABEL = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const SORT_VALUE: Record<
  AccountingExportReadinessSortField,
  (document: AccountingExportReadinessDocument) => string
> = {
  number: (document) => document.number ?? '',
  kind: (document) => document.kind,
  date: (document) => document.date,
  site: (document) => document.site?.code ?? '',
  status: (document) => document.status,
};

export function buildAccountingExportReadiness(
  input: AccountingExportReadinessInput,
): AccountingExportReadinessView {
  const sitesById = new Map(input.sites.map((site) => [site.id, site]));
  const documents = input.candidates.map((candidate) =>
    toReadinessDocument(candidate, sitesById, input.hrefFor),
  );
  const codesByDocumentId = new Map(
    documents.map((document) => [
      document.id,
      new Set(document.blockers.map((blocker) => blocker.code)),
    ]),
  );
  const filtered = sortDocuments(
    documents.filter((document) => matchesFilters(document, input.filters)),
    input.sortField,
    input.sortDirection,
  );
  const start = (input.page - 1) * input.limit;

  return {
    summary: summarize(documents),
    // An ownership blocker is not repeated when the document's own row already
    // carries that code. A cancelled document returns before the ownership check,
    // so its row does not carry the code and the notice stays, as preview shows it.
    // Redacted blockers carry no document id and always stay tenant-wide.
    tenantWideBlockers: input.ownershipBlockers.filter(
      (blocker) =>
        !blocker.documentId ||
        !codesByDocumentId.get(blocker.documentId)?.has(blocker.code),
    ),
    data: filtered.slice(start, start + input.limit),
    meta: {
      total: filtered.length,
      page: input.page,
      limit: input.limit,
      pageCount: Math.max(1, Math.ceil(filtered.length / input.limit)),
    },
  };
}

function toReadinessDocument(
  candidate: AccountingExportCandidate,
  sitesById: Map<string, AccountingExportSite>,
  hrefFor: AccountingExportReadinessInput['hrefFor'],
): AccountingExportReadinessDocument {
  const blockers = uniqueBlockersByCode(candidate.blockers);
  const site = candidate.siteId ? sitesById.get(candidate.siteId) : undefined;

  return {
    id: candidate.id,
    kind: candidate.kind,
    number: candidate.number,
    date: candidate.date,
    site: site ? { id: site.id, code: site.code, name: site.name } : null,
    status: blockers.length > 0 ? 'BLOCKED' : 'EXPORTABLE',
    blockers,
    href: hrefFor(candidate.kind, candidate.id),
  };
}

function uniqueBlockersByCode(
  blockers: AccountingExportBlocker[],
): AccountingExportReadinessBlocker[] {
  const firstByCode = new Map<AccountingExportBlockerCode, string>();
  for (const blocker of blockers) {
    if (!firstByCode.has(blocker.code)) {
      firstByCode.set(blocker.code, blocker.message);
    }
  }
  return [...firstByCode].map(([code, message]) => ({ code, message }));
}

function matchesFilters(
  document: AccountingExportReadinessDocument,
  filters: AccountingExportReadinessFilters,
): boolean {
  if (filters.documentKind && document.kind !== filters.documentKind) {
    return false;
  }
  if (
    filters.reason &&
    !document.blockers.some((blocker) => blocker.code === filters.reason)
  ) {
    return false;
  }

  // Reasons are narrowed with the reason filter, not with the search term.
  const term = filters.search?.trim().toLowerCase();
  if (!term) {
    return true;
  }

  return [
    document.number ?? '',
    document.kind,
    KIND_SEARCH_LABEL[document.kind],
    document.status,
    document.date,
    DATE_SEARCH_LABEL.format(new Date(document.date)),
    document.site?.code ?? '',
    document.site?.name ?? '',
  ].some((value) => value.toLowerCase().includes(term));
}

function sortDocuments(
  documents: AccountingExportReadinessDocument[],
  sortField: AccountingExportReadinessSortField = 'date',
  sortDirection: AccountingExportReadinessSortDirection = 'asc',
): AccountingExportReadinessDocument[] {
  const value = SORT_VALUE[sortField];
  const direction = sortDirection === 'desc' ? -1 : 1;
  // Array.prototype.sort is stable, so documents with equal values keep the
  // loader order.
  return [...documents].sort(
    (left, right) => compareStrings(value(left), value(right)) * direction,
  );
}

function summarize(
  documents: AccountingExportReadinessDocument[],
): AccountingExportReadinessSummary {
  const blockedCount = documents.filter(
    (document) => document.status === 'BLOCKED',
  ).length;

  return {
    documentCount: documents.length,
    exportableCount: documents.length - blockedCount,
    blockedCount,
    documentKinds: ACCOUNTING_EXPORT_DOCUMENT_KINDS.map((kind) => {
      const ofKind = documents.filter((document) => document.kind === kind);
      const blocked = ofKind.filter(
        (document) => document.status === 'BLOCKED',
      ).length;
      return {
        kind,
        documentCount: ofKind.length,
        exportableCount: ofKind.length - blocked,
        blockedCount: blocked,
      };
    }),
    reasons: ACCOUNTING_EXPORT_BLOCKER_CODES.map((code) => ({
      code,
      documentCount: documents.filter((document) =>
        document.blockers.some((blocker) => blocker.code === code),
      ).length,
    }))
      .filter((reason) => reason.documentCount > 0)
      .sort(
        (left, right) =>
          right.documentCount - left.documentCount ||
          compareStrings(left.code, right.code),
      ),
  };
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
