import type { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { createDashboardRealtimeExtension } from './prisma-dashboard-realtime.extension.js';

export const TENANT_ID = 'tenant-realtime';

export type QueryHandlerParams = {
  model: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

export type QueryHandler = (
  this: unknown,
  params: QueryHandlerParams,
) => Promise<unknown>;

type ExtensionFactory = (client: {
  $extends: (definition: unknown) => unknown;
}) => {
  name: string;
  query: { $allModels: Record<string, QueryHandler> };
};

export function runWithTenant<T>(fn: () => T, tenantId = TENANT_ID): T {
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId: 'user-1',
      email: 'user@example.com',
      tenantId,
      role: 'ADMIN',
    });
    return fn();
  });
}

/**
 * Builds the real extension definition and returns its `$allModels` handlers. Prisma's
 * `defineExtension` only wraps the definition, so a stub client that returns it unchanged is enough.
 */
export function buildAllModelsHandlers(emitEntityUpdated = jest.fn()) {
  const dashboardRealtime = {
    emitEntityUpdated,
  } as unknown as DashboardRealtimeService;
  const factory = createDashboardRealtimeExtension(
    dashboardRealtime,
  ) as unknown as ExtensionFactory;
  const definition = factory({ $extends: (extension) => extension });

  return {
    name: definition.name,
    handlers: definition.query.$allModels,
    emitEntityUpdated,
  };
}
