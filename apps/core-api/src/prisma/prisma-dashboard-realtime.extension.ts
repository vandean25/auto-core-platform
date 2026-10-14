import { Prisma } from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type {
  DashboardEntityAction,
  DashboardEntityType,
} from '../dashboard-realtime/dashboard-events.types.js';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import {
  extractEntityId,
  operationToAction,
} from './prisma-dashboard-realtime.mapper.js';
import {
  recordDryRunChange,
  recordDryRunCreates,
} from './prisma-dashboard-realtime.dry-run.js';
import { upsertTargetExists } from './prisma-dashboard-realtime.upsert.js';

const SUPPORTED_ENTITY_TYPES: Record<DashboardEntityType, true> = {
  PURCHASE_ORDER: true,
  PURCHASE_INVOICE: true,
  WORKSHOP_ORDER: true,
  WORKSHOP_TASK: true,
  WORKSHOP_TASK_LINE_ITEM: true,
  WORKSHOP_MEDIA: true,
  LABOR_ENTRY: true,
  SALES_ORDER: true,
  CATALOG_ITEM: true,
  CUSTOMER: true,
  VENDOR: true,
  VEHICLE: true,
  VEHICLE_PURCHASE: true,
  VEHICLE_SALE: true,
  ATTENDANCE_EVENT: true,
  LEAVE_REQUEST: true,
  EMPLOYEE_WORK_SCHEDULE: true,
  PARTS_RESERVATION: true,
  PARTS_REQUISITION: true,
  CREDIT_NOTE: true,
};

function modelNameToEntityType(modelName: string): DashboardEntityType | null {
  const transformed = modelName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase() as DashboardEntityType;

  return transformed in SUPPORTED_ENTITY_TYPES ? transformed : null;
}

function getTenantIdFromContext(): string | undefined {
  return TenantContextStorage.getUser()?.tenantId;
}

type RealtimeEmitter = Pick<DashboardRealtimeService, 'emitEntityUpdated'>;

export function emitRealtimeForOperation(
  dashboardRealtime: RealtimeEmitter,
  model: string,
  operation: string,
  result: unknown,
  actionOverride?: DashboardEntityAction,
) {
  const action = actionOverride ?? operationToAction(operation);
  if (SideEffectGuard.isDryRun()) {
    recordDryRunChange(model, result, action);
    return;
  }

  const type = modelNameToEntityType(model);
  const tenantId = getTenantIdFromContext();
  if (!type || !action || !tenantId) {
    return;
  }

  dashboardRealtime.emitEntityUpdated(tenantId, {
    type,
    action,
    entityId: extractEntityId(result),
  });
}

type QueryParams<R> = {
  model: string;
  args: unknown;
  query: (args: unknown) => Promise<R>;
};

/** Builds a `$allModels` handler that runs the write first and emits its realtime event after it resolves. */
function emitAfterQuery(dashboardRealtime: RealtimeEmitter, operation: string) {
  return async <R>({ model, args, query }: QueryParams<R>): Promise<R> => {
    const result = await query(args);
    emitRealtimeForOperation(dashboardRealtime, model, operation, result);
    return result;
  };
}

export function createDashboardRealtimeExtension(
  dashboardRealtime: DashboardRealtimeService,
) {
  return Prisma.defineExtension({
    name: 'dashboard-realtime',
    query: {
      $allModels: {
        create: emitAfterQuery(dashboardRealtime, 'create'),
        async createMany({ model, args, query }) {
          const result = await query(args);
          if (SideEffectGuard.isDryRun()) {
            recordDryRunCreates(model, args.data);
          }
          return result;
        },
        update: emitAfterQuery(dashboardRealtime, 'update'),
        delete: emitAfterQuery(dashboardRealtime, 'delete'),
        updateMany: emitAfterQuery(dashboardRealtime, 'updateMany'),
        deleteMany: emitAfterQuery(dashboardRealtime, 'deleteMany'),
        async upsert({ model, args, query }) {
          const ctx = Prisma.getExtensionContext(this) as Record<
            string,
            unknown
          >;
          const existed = await upsertTargetExists(ctx, model, args.where);

          const result = await query(args);
          emitRealtimeForOperation(
            dashboardRealtime,
            model,
            'upsert',
            result,
            existed ? 'UPDATED' : 'CREATED',
          );
          return result;
        },
      },
    },
  });
}
