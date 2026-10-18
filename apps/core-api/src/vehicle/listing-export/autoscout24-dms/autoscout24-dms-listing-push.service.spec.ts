import {
  BadGatewayException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  VehicleListingDesiredState,
  VehicleListingDmsProvider,
  VehicleListingDmsSyncState,
  VehicleListingPlatform,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../../../common/services/tenant-context.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SiteContextService } from '../../../site/site-context.service.js';
import { Autoscout24DmsAdapterError } from './autoscout24-dms-api.types.js';
import { FakeAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms-fake.adapter.js';
import { digestAutoscout24DmsPushPayload } from './autoscout24-dms-payload-digest.js';
import { Autoscout24DmsListingPushService } from './autoscout24-dms-listing-push.service.js';

type SyncRow = {
  id: string;
  tenant_id: string;
  channel_id: string;
  provider: VehicleListingDmsProvider;
  sync_state: VehicleListingDmsSyncState;
  external_listing_id: string | null;
  last_idempotency_key: string | null;
  last_sync_payload_digest: string | null;
  last_sync_at: Date | null;
  last_sync_error_code: string | null;
};

function buildListingFixture() {
  return {
    id: 'listing-1',
    listing_ref: 'ACP-REF-1',
    title: 'Demo listing',
    price_gross_eur: new Prisma.Decimal('19900.00'),
    revision: 3,
    tenant_id: 'tenant-1',
    vehicle_id: 'vehicle-1',
    stock_purchase_id: 'stock-purchase-1',
    site_id: 'site-1',
    channels: [
      {
        id: 'channel-1',
        platform: VehicleListingPlatform.AS24,
        external_ref: null,
        desired_state: VehicleListingDesiredState.ACTIVE,
      },
    ],
  };
}

function createSyncStore(initial?: Partial<SyncRow>) {
  const row: SyncRow = {
    id: 'sync-1',
    tenant_id: 'tenant-1',
    channel_id: 'channel-1',
    provider: VehicleListingDmsProvider.AS24_DMS,
    sync_state: VehicleListingDmsSyncState.PENDING,
    external_listing_id: null,
    last_idempotency_key: null,
    last_sync_payload_digest: null,
    last_sync_at: null,
    last_sync_error_code: null,
    ...initial,
  };

  const prisma = {
    vehicleListingPushSettings: {
      findUnique: jest.fn().mockResolvedValue({ as24_dms_push_enabled: true }),
    },
    vehiclePurchase: {
      findFirst: jest.fn().mockResolvedValue({ id: 'stock-purchase-1' }),
    },
    vehicleListing: {
      findFirst: jest.fn().mockResolvedValue(buildListingFixture()),
    },
    vehicleListingChannelDmsSync: {
      findUnique: jest.fn().mockImplementation(async () => row),
      upsert: jest.fn().mockImplementation(async () => ({ id: row.id })),
      findFirstOrThrow: jest.fn().mockImplementation(async () => ({ ...row })),
      findFirst: jest.fn().mockImplementation(async () => ({ ...row })),
      update: jest.fn().mockImplementation(async ({ data }: { data: Partial<SyncRow> }) => {
        Object.assign(row, data);
        return { ...row };
      }),
    },
    vehicleListingChannel: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };

  const tx = {
    vehicleListingChannelDmsSync: prisma.vehicleListingChannelDmsSync,
    vehicleListingChannel: prisma.vehicleListingChannel,
    $queryRaw: prisma.$queryRaw,
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );

  return { prisma, row };
}

describe('Autoscout24DmsListingPushService', () => {
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue('site-1'),
  };
  let publisher: FakeAutoscout24DmsListingPublisherAdapter;
  let service: Autoscout24DmsListingPushService;
  let syncStore: ReturnType<typeof createSyncStore>;

  beforeEach(() => {
    process.env.VEHICLE_LISTING_AS24_PUSH_ENABLED = 'true';
    publisher = new FakeAutoscout24DmsListingPublisherAdapter();
    publisher.contract.reset();
    syncStore = createSyncStore();
    service = new Autoscout24DmsListingPushService(
      syncStore.prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
      publisher,
    );
  });

  afterEach(() => {
    delete process.env.VEHICLE_LISTING_AS24_PUSH_ENABLED;
  });

  it('transitions PENDING to SYNCED on successful upsert', async () => {
    const result = await service.pushListing('vehicle-1', {
      idempotency_key: 'key-1',
      expected_revision: 3,
      action: 'UPSERT',
    });

    expect(result.sync_state).toBe(VehicleListingDmsSyncState.SYNCED);
    expect(result.external_listing_id).toMatch(/^as24-fake-/);
    expect(syncStore.row.sync_state).toBe(VehicleListingDmsSyncState.SYNCED);
    expect(syncStore.row.last_sync_error_code).toBeNull();
  });

  it('transitions PENDING to FAILED on client_error from the publisher', async () => {
    publisher.contract.configure('reject400');

    await expect(
      service.pushListing('vehicle-1', {
        idempotency_key: 'key-fail',
        expected_revision: 3,
        action: 'UPSERT',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(syncStore.row.sync_state).toBe(VehicleListingDmsSyncState.FAILED);
    expect(syncStore.row.last_sync_error_code).toBe('LISTING_PUSH_CLIENT_ERROR');
  });

  it('transitions to DEACTIVATED on deactivate', async () => {
    syncStore.row.sync_state = VehicleListingDmsSyncState.SYNCED;
    syncStore.row.external_listing_id = 'as24-fake-existing';

    const result = await service.pushListing('vehicle-1', {
      idempotency_key: 'key-deact',
      expected_revision: 3,
      action: 'DEACTIVATE',
    });

    expect(result.sync_state).toBe(VehicleListingDmsSyncState.DEACTIVATED);
    expect(syncStore.row.sync_state).toBe(VehicleListingDmsSyncState.DEACTIVATED);
  });

  it('replays the same idempotency key and payload without changing SYNCED state', async () => {
    const first = await service.pushListing('vehicle-1', {
      idempotency_key: 'replay-key',
      expected_revision: 3,
      action: 'UPSERT',
    });
    const upsertCallsAfterFirst = publisher.contract.calls.filter(
      (c) => c.method === 'UPSERT',
    ).length;

    const second = await service.pushListing('vehicle-1', {
      idempotency_key: 'replay-key',
      expected_revision: 3,
      action: 'UPSERT',
    });

    expect(second.idempotent_replay).toBe(true);
    expect(second.sync_state).toBe(VehicleListingDmsSyncState.SYNCED);
    expect(second.external_listing_id).toBe(first.external_listing_id);
    expect(
      publisher.contract.calls.filter((c) => c.method === 'UPSERT').length,
    ).toBe(upsertCallsAfterFirst);
  });

  it('rejects the same idempotency key with a different payload', async () => {
    await service.pushListing('vehicle-1', {
      idempotency_key: 'conflict-key',
      expected_revision: 3,
      action: 'UPSERT',
    });

    syncStore.prisma.vehicleListing.findFirst.mockResolvedValue({
      ...buildListingFixture(),
      title: 'Changed title',
    });

    const error = await service
      .pushListing('vehicle-1', {
        idempotency_key: 'conflict-key',
        expected_revision: 3,
        action: 'UPSERT',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({
      response: { code: 'LISTING_PUSH_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('does not persist FAILED when the publisher returns rate_limit', async () => {
    const failingPublisher = {
      upsertListing: jest.fn().mockRejectedValue(
        new Autoscout24DmsAdapterError(
          'rate_limit',
          'rate limited',
          429,
        ),
      ),
      deactivateListing: jest.fn(),
    };
    const rateLimitService = new Autoscout24DmsListingPushService(
      syncStore.prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
      failingPublisher,
    );

    await expect(
      rateLimitService.pushListing('vehicle-1', {
        idempotency_key: 'rate-key',
        expected_revision: 3,
        action: 'UPSERT',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(syncStore.row.sync_state).toBe(VehicleListingDmsSyncState.PENDING);
    expect(syncStore.row.last_sync_error_code).toBeNull();
  });

  it('rejects UPSERT when the channel is not ACTIVE', async () => {
    syncStore.prisma.vehicleListing.findFirst.mockResolvedValue({
      ...buildListingFixture(),
      channels: [
        {
          id: 'channel-1',
          platform: VehicleListingPlatform.AS24,
          external_ref: null,
          desired_state: VehicleListingDesiredState.INACTIVE,
        },
      ],
    });

    await expect(
      service.pushListing('vehicle-1', {
        idempotency_key: 'inactive',
        expected_revision: 3,
        action: 'UPSERT',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('stores payload digest on success for replay detection', async () => {
    const payload = {
      sellerListingRef: 'ACP-REF-1',
      title: 'Demo listing',
      priceGrossEur: new Prisma.Decimal('19900.00').toString(),
      action: 'UPSERT' as const,
    };
    await service.pushListing('vehicle-1', {
      idempotency_key: 'digest-key',
      expected_revision: 3,
      action: 'UPSERT',
    });
    expect(syncStore.row.last_sync_payload_digest).toBe(
      digestAutoscout24DmsPushPayload(payload),
    );
  });
});
