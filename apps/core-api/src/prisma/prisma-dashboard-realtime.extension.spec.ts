import { TenantContextStorage } from '../common/services/tenant-context.storage';
import { emitRealtimeForOperation } from './prisma-dashboard-realtime.extension';

function runWithTenant<T>(tenantId: string, fn: () => Promise<T> | T) {
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

describe('emitRealtimeForOperation', () => {
  it('emits using tenant id from ALS context, not args/result tenant_id', async () => {
    const emitEntityUpdated = jest.fn();

    await runWithTenant('tenant-from-context', async () => {
      emitRealtimeForOperation(
        {
          emitEntityUpdated,
        },
        'Customer',
        'create',
        {
          id: 'cust-1',
          tenant_id: 'tenant-from-result',
        },
      );
    });

    expect(emitEntityUpdated).toHaveBeenCalledWith('tenant-from-context', {
      type: 'CUSTOMER',
      action: 'CREATED',
      entityId: 'cust-1',
    });
  });

  it('does not emit when there is no tenant in ALS context', async () => {
    const emitEntityUpdated = jest.fn();
    emitRealtimeForOperation(
      {
        emitEntityUpdated,
      },
      'Customer',
      'create',
      { id: 'cust-2' },
    );

    expect(emitEntityUpdated).not.toHaveBeenCalled();
  });

  it('does not emit for unsupported models', async () => {
    const emitEntityUpdated = jest.fn();

    await runWithTenant('tenant-from-context', async () => {
      emitRealtimeForOperation(
        {
          emitEntityUpdated,
        },
        'Tenant',
        'create',
        { id: 'tenant-1' },
      );
    });

    expect(emitEntityUpdated).not.toHaveBeenCalled();
  });
});
