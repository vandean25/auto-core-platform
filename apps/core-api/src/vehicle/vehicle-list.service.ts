import { Injectable, Optional } from '@nestjs/common';
import {
  CustomFieldEntity,
  ImportEntityType,
  type Prisma,
} from '@prisma/client';
import { ScopeContextSnapshotService } from '../auth/scope-context/scope-context-snapshot.service.js';
import {
  cappedVehicleListCount,
  fetchKeysetListPage,
} from '../common/list-cursor/index.js';
import { projectVehicleListOperationalFields } from '../common/projections/vehicle-entity.projection.js';
import { CustomFieldsService } from '../custom-fields/custom-fields.service.js';
import { omitCustomFields } from '../custom-fields/custom-fields.validation.js';
import {
  attachLegacyIds,
  findExternalEntityIds,
} from '../import/import-external-id.store.js';
import { SiteContextService } from '../site/site-context.service.js';
import { stripVehicleIdentityResolutionState } from './vehicle-identity.util.js';
import {
  VEHICLE_CURSOR_ENDPOINT,
  assertNoVehicleOffsetParams,
  resolveVehicleCursorLimit,
  resolveVehicleCursorSort,
  vehicleListFilterContext,
  type VehicleCursorQuery,
} from './vehicle-list-cursor.js';
import { VehicleQueryBuilder } from './vehicle-query.builder.js';

function buildVehicleListWhere(
  tenantId: string,
  search: string | undefined,
  legacyEntityIds: string[],
): Prisma.VehicleWhereInput {
  const baseWhere = VehicleQueryBuilder.buildWhere(tenantId, search);
  return {
    ...baseWhere,
    tenant_id: tenantId,
    ...(legacyEntityIds.length
      ? { OR: [...(baseWhere.OR ?? []), { id: { in: legacyEntityIds } }] }
      : {}),
  };
}

function maskVehicleCustomFieldsWithDefs<T extends { custom_fields?: unknown }>(
  customFields: CustomFieldsService | undefined,
  vehicle: T,
  activeDefs: ReadonlyArray<{ key: string }> | null,
): T {
  if (!customFields || activeDefs === null) {
    const rest = { ...vehicle };
    delete rest.custom_fields;
    return rest;
  }
  const visible = customFields.projectVisibleCustomFieldsWithDefs(
    vehicle.custom_fields,
    activeDefs,
  );
  if (visible === undefined) {
    const rest = { ...vehicle };
    delete rest.custom_fields;
    return rest;
  }
  return { ...vehicle, custom_fields: visible };
}

/**
 * Cursor list and capped count of the customer vehicle list (ADR-0035), both behind the Scope Context
 * (ADR-0038). The offset list stays in {@link VehicleService.findAll}.
 */
@Injectable()
export class VehicleListService {
  constructor(
    private readonly scopeContext: ScopeContextSnapshotService,
    private readonly siteContext: SiteContextService,
    @Optional() private readonly customFields?: CustomFieldsService,
  ) {}

  async findAllWithCursor(
    query: VehicleCursorQuery,
    scopeContextHeader: string | undefined,
  ) {
    const pageResult = await this.scopeContext.read(
      scopeContextHeader,
      { id: 'VehicleController.findAll', scope: 'tenant' },
      async ({ tx, tenantId, siteId, scopeContextDigest }) => {
        assertNoVehicleOffsetParams(query);
        const { field, direction, config } = resolveVehicleCursorSort(
          query.sortField,
          query.sortDirection,
        );
        const [authorizedSiteIds, legacyEntityIds] = await Promise.all([
          this.siteContext.listAuthorizedSiteIds(),
          query.search
            ? findExternalEntityIds(tx, {
                tenantId,
                entityType: ImportEntityType.VEHICLE,
                externalId: query.search,
              })
            : Promise.resolve([]),
        ]);
        const result = await fetchKeysetListPage(
          {
            endpoint: VEHICLE_CURSOR_ENDPOINT,
            tenantId,
            siteId,
            scopeContextDigest,
            filterHashInput: vehicleListFilterContext(query),
            sortField: field,
            sortDirection: direction,
            sortConfig: config,
            cursor: query.cursor,
            limit: resolveVehicleCursorLimit(query.limit),
            baseWhere: buildVehicleListWhere(
              tenantId,
              query.search,
              legacyEntityIds,
            ),
          },
          {
            findMany: (where, orderBy, take) =>
              tx.vehicle.findMany({
                where: { AND: [where, { tenant_id: tenantId }] },
                include: {
                  customer: true,
                  location: true,
                  reserved_for_customer: true,
                },
                orderBy,
                take,
              }),
            mapRow: (row) => row,
            readSortValue: (row, prismaField) =>
              row[prismaField as keyof typeof row],
          },
        );
        const withLegacy = await attachLegacyIds(
          tx,
          { tenantId, entityType: ImportEntityType.VEHICLE },
          result.data,
        );
        const projected = projectVehicleListOperationalFields(
          withLegacy.map((row) => {
            const stripped = stripVehicleIdentityResolutionState(row);
            return {
              ...stripped,
              ...(stripped.customer
                ? { customer: omitCustomFields(stripped.customer) }
                : {}),
            };
          }),
          authorizedSiteIds,
        );
        return { ...result, data: projected };
      },
    );
    const activeDefs = this.customFields
      ? await this.customFields.loadVisibilityDefs(CustomFieldEntity.VEHICLE)
      : null;
    return {
      ...pageResult,
      data: (pageResult.data ?? []).map((row) =>
        maskVehicleCustomFieldsWithDefs(this.customFields, row, activeDefs),
      ),
    };
  }

  /** Same resolver as the list, no keyset and no sort (ADR-0035 §5). */
  async cappedListCount(
    query: Pick<VehicleCursorQuery, 'search'>,
    scopeContextHeader: string | undefined,
  ) {
    return this.scopeContext.read(
      scopeContextHeader,
      { id: 'VehicleController.cappedCount', scope: 'tenant' },
      async ({ tx, tenantId }) => {
        const legacyEntityIds = query.search
          ? await findExternalEntityIds(tx, {
              tenantId,
              entityType: ImportEntityType.VEHICLE,
              externalId: query.search,
            })
          : [];
        return cappedVehicleListCount(
          tx,
          buildVehicleListWhere(tenantId, query.search, legacyEntityIds),
        );
      },
    );
  }
}
