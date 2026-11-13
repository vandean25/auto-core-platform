import {
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ScopeContextSnapshotService } from '../auth/scope-context/scope-context-snapshot.service.js';
import type { TenantAuthenticatedUser } from '../auth/types/authenticated-user.js';
import {
  cappedWorkshopOrderListCount,
  fetchKeysetListPage,
} from '../common/list-cursor/index.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
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
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly scopeContext: ScopeContextSnapshotService,
  ) {}

  async findAllWithCursor(
    query: WorkshopOrderCursorQuery,
    scopeContextHeader: string | undefined,
  ) {
    const user = await this.requireScopedUser();
    return this.scopeContext.read(
      user,
      scopeContextHeader,
      ({ tx, siteId }) => {
        assertNoOffsetParams(query);
        const { field, direction, config } = resolveWorkshopOrderCursorSort(
          query.sortField,
          query.sortDirection,
        );
        return fetchKeysetListPage(
          {
            endpoint: WORKSHOP_ORDER_CURSOR_ENDPOINT,
            tenantId: user.tenantId,
            siteId,
            filterHashInput: workshopOrderListFilterContext(query),
            sortField: field,
            sortDirection: direction,
            sortConfig: config,
            cursor: query.cursor,
            limit: resolveWorkshopOrderCursorLimit(query.limit),
            baseWhere: buildWorkshopOrderListWhere(
              user.tenantId,
              siteId,
              query,
            ),
          },
          {
            findMany: (where, orderBy, take) =>
              tx.workshopOrder.findMany({
                where: {
                  AND: [where, { tenant_id: user.tenantId, site_id: siteId }],
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
    const user = await this.requireScopedUser();
    return this.scopeContext.read(user, scopeContextHeader, ({ tx, siteId }) =>
      cappedWorkshopOrderListCount(
        tx,
        { tenantId: user.tenantId, siteId },
        buildWorkshopOrderListWhere(user.tenantId, siteId, query),
      ),
    );
  }

  /** 422 `ACTIVE_SITE_REQUIRED` outranks the context codes (ADR-0038 §4 precedence). */
  private async requireScopedUser(): Promise<TenantAuthenticatedUser> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.tenantId) {
      throw new UnauthorizedException('Tenant session required.');
    }
    if (!(await this.siteContext.findSiteId())) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: 'ACTIVE_SITE_REQUIRED',
        message: 'An active site is required.',
      });
    }
    return user as TenantAuthenticatedUser;
  }
}
