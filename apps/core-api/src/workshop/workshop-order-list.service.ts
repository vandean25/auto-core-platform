import { Injectable } from '@nestjs/common';
import { ScopeContextSnapshotService } from '../auth/scope-context/scope-context-snapshot.service.js';
import {
  cappedWorkshopOrderListCount,
  fetchKeysetListPage,
} from '../common/list-cursor/index.js';
import {
  ORDER_WITH_RELATIONS,
  buildWorkshopOrderListWhere,
} from './workshop-intake-query.helpers.js';
import {
  WORKSHOP_ORDER_CURSOR_ENDPOINT,
  assertNoOffsetParams,
  resolveWorkshopOrderCursorLimit,
  resolveWorkshopOrderCursorSort,
  workshopOrderListFilterContext,
  type WorkshopOrderCursorQuery,
} from './workshop-order-list-cursor.js';
import {
  normalizeWorkshopOrder,
  type WorkshopOrderWithRelations,
} from './workshop-order.helpers.js';

/**
 * Cursor list and capped count of the workshop order list (ADR-0035), both behind the Scope Context
 * (ADR-0038). The offset list stays in {@link WorkshopIntakeService.findAll}.
 */
@Injectable()
export class WorkshopOrderListService {
  constructor(private readonly scopeContext: ScopeContextSnapshotService) {}

  async findAllWithCursor(
    query: WorkshopOrderCursorQuery,
    scopeContextHeader: string | undefined,
  ) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'WorkshopOrdersController.findAll' },
      ({ tx, siteId, tenantId, scopeContextDigest }) => {
        assertNoOffsetParams(query);
        const { field, direction, config } = resolveWorkshopOrderCursorSort(
          query.sortField,
          query.sortDirection,
        );
        return fetchKeysetListPage(
          {
            endpoint: WORKSHOP_ORDER_CURSOR_ENDPOINT,
            tenantId,
            siteId,
            scopeContextDigest,
            filterHashInput: workshopOrderListFilterContext(query),
            sortField: field,
            sortDirection: direction,
            sortConfig: config,
            cursor: query.cursor,
            limit: resolveWorkshopOrderCursorLimit(query.limit),
            baseWhere: buildWorkshopOrderListWhere(tenantId, siteId, query),
          },
          {
            findMany: (where, orderBy, take) =>
              tx.workshopOrder.findMany({
                where: {
                  AND: [where, { tenant_id: tenantId, site_id: siteId }],
                },
                include: ORDER_WITH_RELATIONS,
                orderBy,
                take,
              }),
            mapRow: (order) =>
              normalizeWorkshopOrder(order as WorkshopOrderWithRelations),
            readSortValue: (order, prismaField) =>
              order[prismaField as keyof typeof order],
          },
        );
      },
    );
  }

  /** Same resolver as the list, no keyset and no sort (ADR-0035 §5). */
  async cappedListCount(
    query: Pick<WorkshopOrderCursorQuery, 'search' | 'customerId'>,
    scopeContextHeader: string | undefined,
  ) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'WorkshopOrdersController.cappedCount' },
      ({ tx, siteId, tenantId }) =>
        cappedWorkshopOrderListCount(
          tx,
          { tenantId, siteId },
          buildWorkshopOrderListWhere(tenantId, siteId, query),
        ),
    );
  }
}
