import { Injectable } from '@nestjs/common';
import { ScopeContextSnapshotService } from '../auth/scope-context/scope-context-snapshot.service.js';
import {
  cappedInvoiceListCount,
  fetchKeysetListPage,
} from '../common/list-cursor/index.js';
import { omitInvoiceSnapshot } from '../invoices/invoice-response.mapper.js';
import {
  INVOICE_CURSOR_ENDPOINT,
  buildInvoiceListWhere,
  invoiceListFilterContext,
  resolveInvoiceCursorLimit,
  resolveInvoiceCursorSort,
  type InvoiceListQuery,
} from './invoice-list-cursor.js';

/** Cursor list and capped count of the invoice list (ADR-0035). The unpaged list stays in {@link SalesService}. */
@Injectable()
export class InvoiceListService {
  constructor(private readonly scopeContext: ScopeContextSnapshotService) {}

  findAllWithCursor(query: InvoiceListQuery, scopeContextHeader?: string) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'SalesController.findAll', scope: 'tenant' },
      ({ tx, tenantId, siteId, scopeContextDigest }) => {
        const { field, direction, config } = resolveInvoiceCursorSort(
          query.sortField,
          query.sortDirection,
        );
        return fetchKeysetListPage(
          {
            endpoint: INVOICE_CURSOR_ENDPOINT,
            tenantId,
            siteId,
            scopeContextDigest,
            filterHashInput: invoiceListFilterContext(query),
            sortField: field,
            sortDirection: direction,
            sortConfig: config,
            cursor: query.cursor,
            limit: resolveInvoiceCursorLimit(query.limit),
            baseWhere: buildInvoiceListWhere(tenantId, query),
          },
          {
            findMany: (where, orderBy, take) =>
              tx.invoice.findMany({
                where,
                include: { customer: true, items: true },
                orderBy,
                take,
              }),
            mapRow: omitInvoiceSnapshot,
            readSortValue: (invoice, prismaField) =>
              invoice[prismaField as keyof typeof invoice],
          },
        );
      },
    );
  }

  cappedListCount(query: InvoiceListQuery, scopeContextHeader?: string) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'SalesController.cappedCount', scope: 'tenant' },
      ({ tx, tenantId }) =>
        cappedInvoiceListCount(tx, buildInvoiceListWhere(tenantId, query)),
    );
  }
}
