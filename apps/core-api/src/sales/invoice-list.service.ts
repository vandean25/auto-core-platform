import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async findAllWithCursor(query: InvoiceListQuery) {
    const tenantId = await this.tenantContext.getTenantId();
    // The invoice list is tenant-wide (unchanged); the cursor is still bound to the session's active site so a
    // site switch invalidates it. A session without an active site keeps working, as the unpaged list does.
    const siteId = (await this.siteContext.findSiteId()) ?? '';
    const { field, direction, config } = resolveInvoiceCursorSort(
      query.sortField,
      query.sortDirection,
    );
    return fetchKeysetListPage(
      {
        endpoint: INVOICE_CURSOR_ENDPOINT,
        tenantId,
        siteId,
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
          this.prisma.invoice.findMany({
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
  }

  async cappedListCount(query: InvoiceListQuery) {
    const tenantId = await this.tenantContext.getTenantId();
    return cappedInvoiceListCount(
      this.prisma,
      buildInvoiceListWhere(tenantId, query),
    );
  }
}
