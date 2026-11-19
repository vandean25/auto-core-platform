import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type {
  DashboardEntityAction,
  DashboardEntityType,
} from '../dashboard-realtime/dashboard-events.types.js';
import { DashboardRealtimeDeferStorage } from '../dashboard-realtime/dashboard-realtime-defer.storage.js';
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

const pendingDashboardRealtimeEmits = new AsyncLocalStorage<
  Array<() => void>
>();

export async function runWithDeferredDashboardRealtimeEmits<T>(
  work: () => Promise<T>,
): Promise<T> {
  const parentPending = pendingDashboardRealtimeEmits.getStore();
  if (parentPending) {
    return work();
  }
  const pending: Array<() => void> = [];
  return pendingDashboardRealtimeEmits.run(pending, async () => {
    try {
      const result = await work();
      const callbacks = [...pending];
      pending.length = 0;
      for (const emit of callbacks) {
        emit();
      }
      return result;
    } catch (error) {
      pending.length = 0;
      throw error;
    }
  });
}

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
  INVOICE: true,
  CREDIT_NOTE: true,
  PAYMENT: true,
  FISCAL_RECEIPT: true,
  SAVED_VIEW: true,
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
  if (DashboardRealtimeDeferStorage.isDeferred()) {
    return;
  }
  if (SideEffectGuard.isDryRun()) {
    recordDryRunChange(model, result, action);
    return;
  }

  const type = modelNameToEntityType(model);
  const tenantId = getTenantIdFromContext();
  if (!type || !action || !tenantId) {
    return;
  }

  const entityId = extractEntityId(result);
  if (type === 'SAVED_VIEW' && !entityId) {
    // updateMany/deleteMany return { count }; SavedViewsService emits the slim event with id + listPath.
    return;
  }
  const enriched = enrichRealtimePayload(type, result, {
    type,
    action,
    entityId,
  });
  const pending = pendingDashboardRealtimeEmits.getStore();
  if (pending) {
    pending.push(() => dashboardRealtime.emitEntityUpdated(tenantId, enriched));
    return;
  }
  dashboardRealtime.emitEntityUpdated(tenantId, enriched);
}

function readStringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function enrichRealtimePayload(
  type: DashboardEntityType,
  result: unknown,
  base: {
    type: DashboardEntityType;
    action: DashboardEntityAction;
    entityId?: string;
  },
) {
  if (!result || typeof result !== 'object') {
    return base;
  }
  if (type === 'SAVED_VIEW') {
    return { ...base, listPath: readStringField(result, 'list_path') };
  }
  if (type === 'PAYMENT') {
    return {
      ...base,
      siteId: readStringField(result, 'site_id'),
      status: readStringField(result, 'status'),
    };
  }
  if (type === 'FISCAL_RECEIPT') {
    const payment = (result as Record<string, unknown>).payment;
    return {
      ...base,
      siteId: readStringField(payment, 'site_id'),
      status: readStringField(result, 'state'),
    };
  }
  return base;
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
