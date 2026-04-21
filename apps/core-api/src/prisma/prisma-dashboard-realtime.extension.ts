import { Prisma } from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import type {
  DashboardEntityAction,
  DashboardEntityType,
} from '../dashboard-realtime/dashboard-events.types';

const SUPPORTED_ENTITY_TYPES: Record<DashboardEntityType, true> = {
  PURCHASE_ORDER: true,
  PURCHASE_INVOICE: true,
  WORKSHOP_ORDER: true,
  SALES_ORDER: true,
  CATALOG_ITEM: true,
  CUSTOMER: true,
  VENDOR: true,
  VEHICLE: true,
};

function modelNameToEntityType(modelName: string): DashboardEntityType | null {
  const transformed = modelName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase() as DashboardEntityType;

  return transformed in SUPPORTED_ENTITY_TYPES ? transformed : null;
}

function operationToAction(operation: string): DashboardEntityAction | null {
  if (operation === 'create') return 'CREATED';
  if (operation === 'delete' || operation === 'deleteMany') return 'DELETED';
  if (
    operation === 'update' ||
    operation === 'updateMany' ||
    operation === 'upsert'
  ) {
    return 'UPDATED';
  }

  return null;
}

function extractEntityId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;

  const candidate = result as { id?: unknown };
  return typeof candidate.id === 'string' ? candidate.id : undefined;
}

function extractTenantId(result: any, args: any): string | undefined {
  // 1. Try to get from result
  if (result && typeof result === 'object' && result.tenant_id) {
    return result.tenant_id;
  }
  // 2. Try to get from data (create/update)
  if (args?.data?.tenant_id) {
    return args.data.tenant_id;
  }
  // 3. Try to get from where (updateMeta/delete/many)
  if (args?.where?.tenant_id) {
    return args.where.tenant_id;
  }
  return undefined;
}

export function createDashboardRealtimeExtension(
  dashboardRealtime: DashboardRealtimeService,
) {
  return Prisma.defineExtension({
    name: 'dashboard-realtime',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          const type = modelNameToEntityType(model);
          const action = operationToAction('create');
          const tenantId = extractTenantId(result, args);
          if (type && action && tenantId) {
            dashboardRealtime.emitEntityUpdated(tenantId, {
              type,
              action,
              entityId: extractEntityId(result),
            });
          }
          return result;
        },
        async update({ model, args, query }) {
          const result = await query(args);
          const type = modelNameToEntityType(model);
          const action = operationToAction('update');
          const tenantId = extractTenantId(result, args);
          if (type && action && tenantId) {
            dashboardRealtime.emitEntityUpdated(tenantId, {
              type,
              action,
              entityId: extractEntityId(result),
            });
          }
          return result;
        },
        async delete({ model, args, query }) {
          const result = await query(args);
          const type = modelNameToEntityType(model);
          const action = operationToAction('delete');
          const tenantId = extractTenantId(result, args);
          if (type && action && tenantId) {
            dashboardRealtime.emitEntityUpdated(tenantId, {
              type,
              action,
              entityId: extractEntityId(result),
            });
          }
          return result;
        },
        async updateMany({ model, args, query }) {
          const result = await query(args);
          const type = modelNameToEntityType(model);
          const action = operationToAction('updateMany');
          const tenantId = extractTenantId(result, args);
          if (type && action && tenantId) {
            dashboardRealtime.emitEntityUpdated(tenantId, {
              type,
              action,
            });
          }
          return result;
        },
        async deleteMany({ model, args, query }) {
          const result = await query(args);
          const type = modelNameToEntityType(model);
          const action = operationToAction('deleteMany');
          const tenantId = extractTenantId(result, args);
          if (type && action && tenantId) {
            dashboardRealtime.emitEntityUpdated(tenantId, {
              type,
              action,
            });
          }
          return result;
        },
        async upsert({ model, args, query }) {
          // Distinguish between create and update by performing an existence pre-check
          const ctx = Prisma.getExtensionContext(this);
          // Cast to any to bypass TS6 compatibility issues with findFirst in dynamic context
          const existing = await (ctx as any).findFirst({
            where: args.where,
            select: { id: true },
          });

          const result = await query(args);
          const type = modelNameToEntityType(model);
          const action: DashboardEntityAction = existing
            ? 'UPDATED'
            : 'CREATED';

          const tenantId = extractTenantId(result, args);
          if (type && tenantId) {
            dashboardRealtime.emitEntityUpdated(tenantId, {
              type,
              action,
              entityId: extractEntityId(result),
            });
          }
          return result;
        },
      },
    },
  });
}
