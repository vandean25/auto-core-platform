import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import {
  emitRealtimeForOperation,
  runWithDeferredDashboardRealtimeEmits,
} from './prisma-dashboard-realtime.extension.js';

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

  it.each([
    ['create', 'CREATED'],
    ['update', 'UPDATED'],
  ])(
    'emits INVOICE on invoice %s so open invoice lists learn about newly issued invoices',
    async (operation, action) => {
      const emitEntityUpdated = jest.fn();

      await runWithTenant('tenant-1', async () => {
        emitRealtimeForOperation({ emitEntityUpdated }, 'Invoice', operation, {
          id: 'inv-1',
        });
      });

      expect(emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
        type: 'INVOICE',
        action,
        entityId: 'inv-1',
      });
    },
  );

  it('emits employee work schedule changes', async () => {
    const emitEntityUpdated = jest.fn();

    await runWithTenant('tenant-from-context', async () => {
      emitRealtimeForOperation(
        { emitEntityUpdated },
        'EmployeeWorkSchedule',
        'update',
        { id: 'schedule-1' },
      );
    });

    expect(emitEntityUpdated).toHaveBeenCalledWith('tenant-from-context', {
      type: 'EMPLOYEE_WORK_SCHEDULE',
      action: 'UPDATED',
      entityId: 'schedule-1',
    });
  });
});

describe('runWithDeferredDashboardRealtimeEmits', () => {
  it('buffers writes inside the transaction and flushes deduplicated emits after commit', async () => {
    const emitEntityUpdated = jest.fn();

    await runWithTenant('tenant-1', async () => {
      await runWithDeferredDashboardRealtimeEmits(async () => {
        emitRealtimeForOperation({ emitEntityUpdated }, 'Payment', 'update', {
          id: 'pay-1',
          site_id: 'site-1',
          status: 'PENDING',
        });
        emitRealtimeForOperation({ emitEntityUpdated }, 'Payment', 'update', {
          id: 'pay-1',
          site_id: 'site-1',
          status: 'PAID',
        });
        emitRealtimeForOperation({ emitEntityUpdated }, 'Customer', 'create', {
          id: 'cust-1',
        });

        expect(emitEntityUpdated).not.toHaveBeenCalled();
      });
    });

    expect(emitEntityUpdated).toHaveBeenCalledTimes(2);
    expect(emitEntityUpdated).toHaveBeenNthCalledWith(1, 'tenant-1', {
      type: 'PAYMENT',
      action: 'UPDATED',
      entityId: 'pay-1',
      siteId: 'site-1',
      status: 'PAID',
    });
    expect(emitEntityUpdated).toHaveBeenNthCalledWith(2, 'tenant-1', {
      type: 'CUSTOMER',
      action: 'CREATED',
      entityId: 'cust-1',
    });
  });

  it('drops buffered emits on rollback', async () => {
    const emitEntityUpdated = jest.fn();

    await expect(
      runWithTenant('tenant-1', () =>
        runWithDeferredDashboardRealtimeEmits(async () => {
          emitRealtimeForOperation({ emitEntityUpdated }, 'Customer', 'create', {
            id: 'cust-1',
          });
          throw new Error('tx failed');
        }),
      ),
    ).rejects.toThrow('tx failed');

    expect(emitEntityUpdated).not.toHaveBeenCalled();
  });

  it('drops emits during dry-run even when wrapped in deferred emits', async () => {
    const emitEntityUpdated = jest.fn();

    await DryRunStorage.run({ isDryRun: true }, () =>
      runWithTenant('tenant-1', () =>
        runWithDeferredDashboardRealtimeEmits(async () => {
          emitRealtimeForOperation({ emitEntityUpdated }, 'Customer', 'create', {
            id: 'cust-1',
          });
        }),
      ),
    );

    expect(emitEntityUpdated).not.toHaveBeenCalled();
  });
});
