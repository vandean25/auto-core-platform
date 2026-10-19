import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { applyTenantIsolation } from '../prisma/tenant-isolation.extension.js';

export const MASTER_DATA_SCHEMA_TENANT_ID = 'tenant-test-master-data-schema';

export function runMasterDataSchemaWithTenant<T>(fn: () => T) {
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId: 'user-1',
      email: 'test@example.com',
      tenantId: MASTER_DATA_SCHEMA_TENANT_ID,
      role: 'ADMIN',
    });
    return fn();
  });
}

export function callTenantIsolatedQuery(
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  queryFn: jest.Mock,
) {
  return applyTenantIsolation.call({}, {}, model, operation, args, queryFn);
}
