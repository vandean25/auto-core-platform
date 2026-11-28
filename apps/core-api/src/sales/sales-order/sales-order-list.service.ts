import { Injectable } from '@nestjs/common';
import { ScopeContextSnapshotService } from '../../auth/scope-context/scope-context-snapshot.service.js';
import {
  cappedSalesOrderListCount,
  fetchKeysetListPage,
} from '../../common/list-cursor/index.js';
import {
  SALES_ORDER_LIST_INCLUDE,
  toPublicSalesOrder,
} from '../helpers/sales-order-query.helpers.js';
import {
  SALES_ORDER_CURSOR_ENDPOINT,
  buildSalesOrderListWhere,
  resolveSalesOrderCursorRequest,
  salesOrderListFilterContext,
  type SalesOrderCursorQuery,
} from './sales-order-list-cursor.js';

/**
 * Cursor list and capped count for Sales Orders (ADR-0035), both behind the Scope Context (ADR-0038).
 * The legacy offset list stays in {@link SalesOrderService.findAll}.
 */
@Injectable()
export class SalesOrderListService {
  constructor(private readonly scopeContext: ScopeContextSnapshotService) {}

  findAllWithCursor(
    query: SalesOrderCursorQuery,
    scopeContextHeader: string | undefined,
  ) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'SalesOrderController.findAll' },
      ({ tx, tenantId, siteId, scopeContextDigest }) => {
        const resolved = resolveSalesOrderCursorRequest(query);
        return fetchKeysetListPage(
          {
            endpoint: SALES_ORDER_CURSOR_ENDPOINT,
            tenantId,
            siteId,
            scopeContextDigest,
            filterHashInput: salesOrderListFilterContext(resolved),
            sortField: resolved.sort.field,
            sortDirection: resolved.sort.direction,
            sortConfig: resolved.sort.config,
            cursor: resolved.cursor,
            limit: resolved.limit,
            baseWhere: buildSalesOrderListWhere(tenantId, siteId, resolved),
          },
          {
            findMany: (where, orderBy, take) =>
              tx.salesOrder.findMany({
                where: {
                  AND: [where, { tenant_id: tenantId, site_id: siteId }],
                },
                include: SALES_ORDER_LIST_INCLUDE,
                orderBy,
                take,
              }),
            mapRow: (order) => toPublicSalesOrder(order),
            readSortValue: (order, prismaField) =>
              order[prismaField as keyof typeof order],
          },
        );
      },
    );
  }

  /** Same resolver as the list, no keyset and no sort (ADR-0035 §5 / D8). */
  cappedListCount(
    query: Pick<
      SalesOrderCursorQuery,
      'status' | 'search' | 'params' | 'page' | 'pageSize'
    >,
    scopeContextHeader: string | undefined,
  ) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'SalesOrderController.cappedCount' },
      ({ tx, tenantId, siteId }) => {
        const resolved = resolveSalesOrderCursorRequest(query);
        return cappedSalesOrderListCount(
          tx,
          { tenantId, siteId },
          buildSalesOrderListWhere(tenantId, siteId, resolved),
        );
      },
    );
  }
}
