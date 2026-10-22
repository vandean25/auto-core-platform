import { VehicleListingDmsProvider } from '@prisma/client';
import { applyTenantIsolation } from '../../../prisma/tenant-isolation.extension.js';
import { TenantContextStorage } from '../../../common/services/tenant-context.storage.js';
import { assertVehicleListingAs24PushEnabled } from './autoscout24-dms-push-guard.js';

const TENANT_ID = 'tenant-aut572-001';

function runWithTenant<T>(fn: () => T) {
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId: 'user-1',
      email: 'test@example.com',
      tenantId: TENANT_ID,
      role: 'ADMIN',
    });
    return fn();
  });
}

function call(
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  queryFn: jest.Mock,
) {
  return applyTenantIsolation.call({}, {}, model, operation, args, queryFn);
}

describe('AutoScout24 DMS reads under tenant isolation', () => {
  afterEach(() => {
    delete process.env.VEHICLE_LISTING_AS24_PUSH_ENABLED;
  });

  it('rejects findUnique on VehicleListingPushSettings', async () => {
    await expect(
      runWithTenant(() =>
        call(
          'VehicleListingPushSettings',
          'findUnique',
          { where: { tenant_id: TENANT_ID } },
          jest.fn(),
        ),
      ),
    ).rejects.toThrow(/findUnique/);
  });

  it('rejects findUnique on VehicleListingChannelDmsSync', async () => {
    await expect(
      runWithTenant(() =>
        call(
          'VehicleListingChannelDmsSync',
          'findUnique',
          {
            where: {
              tenant_id_channel_id_provider: {
                tenant_id: TENANT_ID,
                channel_id: 'channel-1',
                provider: VehicleListingDmsProvider.AS24_DMS,
              },
            },
          },
          jest.fn(),
        ),
      ),
    ).rejects.toThrow(/findUnique/);
  });

  it('loads push settings via findFirst for assertVehicleListingAs24PushEnabled', async () => {
    process.env.VEHICLE_LISTING_AS24_PUSH_ENABLED = 'true';
    const query = jest.fn().mockResolvedValue({ as24_dms_push_enabled: true });
    const prisma = {
      vehicleListingPushSettings: {
        findFirst: jest.fn().mockImplementation(
          (args: Record<string, unknown>) =>
            runWithTenant(() =>
              call('VehicleListingPushSettings', 'findFirst', args, query),
            ),
        ),
      },
    };

    await assertVehicleListingAs24PushEnabled(prisma, TENANT_ID);

    expect(query).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID },
      select: { as24_dms_push_enabled: true },
    });
  });

  it('loads sale deactivate settings via findFirst under tenant isolation', async () => {
    const query = jest.fn().mockResolvedValue({ as24_dms_push_enabled: true });
    const args = {
      where: { tenant_id: TENANT_ID },
      select: { as24_dms_push_enabled: true },
    };

    await runWithTenant(() =>
      call('VehicleListingPushSettings', 'findFirst', args, query),
    );

    expect(query).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID },
      select: { as24_dms_push_enabled: true },
    });
  });

  it('loads DMS sync rows via findFirst with explicit tenant scope', async () => {
    const query = jest.fn().mockResolvedValue({ id: 'sync-1' });
    const args = {
      where: {
        tenant_id: TENANT_ID,
        channel_id: 'channel-1',
        provider: VehicleListingDmsProvider.AS24_DMS,
      },
    };

    await runWithTenant(() =>
      call('VehicleListingChannelDmsSync', 'findFirst', args, query),
    );

    expect(query).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        channel_id: 'channel-1',
        provider: VehicleListingDmsProvider.AS24_DMS,
      },
    });
  });
});
