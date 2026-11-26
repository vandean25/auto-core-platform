import { Injectable, Optional } from '@nestjs/common';
import {
  CustomFieldEntity,
  ImportEntityType,
  type Prisma,
} from '@prisma/client';
import { ScopeContextSnapshotService } from '../auth/scope-context/scope-context-snapshot.service.js';
import {
  cappedCustomerListCount,
  fetchKeysetListPage,
} from '../common/list-cursor/index.js';
import { CustomFieldsService } from '../custom-fields/custom-fields.service.js';
import {
  attachLegacyIds,
  findExternalEntityIds,
} from '../import/import-external-id.store.js';
import {
  CUSTOMER_CURSOR_ENDPOINT,
  assertNoCustomerOffsetParams,
  customerListFilterContext,
  resolveCustomerCursorLimit,
  resolveCustomerCursorSort,
  type CustomerCursorQuery,
} from './customer-list-cursor.js';

const CUSTOMER_SEARCH_FIELDS = [
  'first_name',
  'last_name',
  'company_name',
  'email',
] as const;

function buildCustomerListWhere(
  tenantId: string,
  query: Pick<CustomerCursorQuery, 'search' | 'type'>,
  legacyEntityIds: string[],
): Prisma.CustomerWhereInput {
  const base: Prisma.CustomerWhereInput = {
    tenant_id: tenantId,
    ...(query.type ? { type: query.type } : {}),
  };
  if (!query.search) {
    return base;
  }
  return {
    ...base,
    OR: [
      ...CUSTOMER_SEARCH_FIELDS.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' as const },
      })),
      ...(legacyEntityIds.length ? [{ id: { in: legacyEntityIds } }] : []),
    ],
  };
}

function maskCustomerCustomFieldsWithDefs<
  T extends { custom_fields?: unknown },
>(
  customFields: CustomFieldsService | undefined,
  customer: T,
  activeDefs: ReadonlyArray<{ key: string }> | null,
): T {
  if (!customFields || activeDefs === null) {
    const rest = { ...customer };
    delete rest.custom_fields;
    return rest;
  }
  const visible = customFields.projectVisibleCustomFieldsWithDefs(
    customer.custom_fields,
    activeDefs,
  );
  if (visible === undefined) {
    const rest = { ...customer };
    delete rest.custom_fields;
    return rest;
  }
  return { ...customer, custom_fields: visible };
}

/**
 * Cursor list and capped count of the customer list (ADR-0035), both behind the Scope Context
 * (ADR-0038). The offset list stays in {@link CustomerService.findAll}.
 */
@Injectable()
export class CustomerListService {
  constructor(
    private readonly scopeContext: ScopeContextSnapshotService,
    @Optional() private readonly customFields?: CustomFieldsService,
  ) {}

  async findAllWithCursor(
    query: CustomerCursorQuery,
    scopeContextHeader: string | undefined,
  ) {
    const pageResult = await this.scopeContext.read(
      scopeContextHeader,
      { id: 'CustomerController.findAll', scope: 'tenant' },
      async ({ tx, tenantId, siteId, scopeContextDigest }) => {
        assertNoCustomerOffsetParams(query);
        const { field, direction, config } = resolveCustomerCursorSort(
          query.sortField,
          query.sortDirection,
        );
        const legacyEntityIds = query.search
          ? await findExternalEntityIds(tx, {
              tenantId,
              entityType: ImportEntityType.CUSTOMER,
              externalId: query.search,
            })
          : [];
        const result = await fetchKeysetListPage(
          {
            endpoint: CUSTOMER_CURSOR_ENDPOINT,
            tenantId,
            siteId,
            scopeContextDigest,
            filterHashInput: customerListFilterContext(query),
            sortField: field,
            sortDirection: direction,
            sortConfig: config,
            cursor: query.cursor,
            limit: resolveCustomerCursorLimit(query.limit),
            baseWhere: buildCustomerListWhere(tenantId, query, legacyEntityIds),
          },
          {
            findMany: (where, orderBy, take) =>
              tx.customer.findMany({
                where: { AND: [where, { tenant_id: tenantId }] },
                orderBy,
                take,
              }),
            mapRow: (customer) => customer,
            readSortValue: (customer, prismaField) =>
              customer[prismaField as keyof typeof customer],
          },
        );
        return {
          ...result,
          data: await attachLegacyIds(
            tx,
            { tenantId, entityType: ImportEntityType.CUSTOMER },
            result.data,
          ),
        };
      },
    );
    const activeDefs = this.customFields
      ? await this.customFields.loadVisibilityDefs(CustomFieldEntity.CUSTOMER)
      : null;
    return {
      ...pageResult,
      data: pageResult.data.map((row) =>
        maskCustomerCustomFieldsWithDefs(this.customFields, row, activeDefs),
      ),
    };
  }

  /** Same resolver as the list, no keyset and no sort (ADR-0035 §5). */
  async cappedListCount(
    query: Pick<CustomerCursorQuery, 'search' | 'type'>,
    scopeContextHeader: string | undefined,
  ) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'CustomerController.cappedCount', scope: 'tenant' },
      async ({ tx, tenantId }) => {
        const legacyEntityIds = query.search
          ? await findExternalEntityIds(tx, {
              tenantId,
              entityType: ImportEntityType.CUSTOMER,
              externalId: query.search,
            })
          : [];
        return cappedCustomerListCount(
          tx,
          buildCustomerListWhere(tenantId, query, legacyEntityIds),
        );
      },
    );
  }
}
