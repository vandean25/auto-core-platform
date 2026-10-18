import { ServiceUnavailableException } from '@nestjs/common';
import { FakeAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms-fake.adapter.js';
import { Autoscout24DmsAdapterError } from './autoscout24-dms-api.types.js';
import { HttpAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms-http.adapter.js';
import { NotConfiguredAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms-not-configured.adapter.js';
import { assertVehicleListingAs24PushEnabled } from './autoscout24-dms-push-guard.js';

const payload = {
  sellerListingRef: 'ACP-DEMO-REF-001',
  title: 'Demo listing',
  priceGrossEur: '19900.00',
  action: 'UPSERT' as const,
};

describe('AutoScout24 DMS fake adapter contract', () => {
  const adapter = new FakeAutoscout24DmsListingPublisherAdapter();

  beforeEach(() => {
    adapter.contract.reset();
  });

  it('creates, updates and deactivates listings', async () => {
    const created = await adapter.upsertListing('key-create-1', payload, null);
    expect(created.httpStatus).toBe(201);
    expect(created.externalListingId).toMatch(/^as24-fake-/);

    const updated = await adapter.upsertListing(
      'key-update-1',
      { ...payload, title: 'Updated title' },
      created.externalListingId,
    );
    expect(updated.httpStatus).toBe(200);
    expect(updated.externalListingId).toBe(created.externalListingId);

    const deactivated = await adapter.deactivateListing(
      'key-deactivate-1',
      { sellerListingRef: payload.sellerListingRef },
      created.externalListingId,
    );
    expect(deactivated.httpStatus).toBe(200);
    expect(deactivated.externalListingId).toBe(created.externalListingId);
  });

  it('replays upsert idempotently for the same key and payload', async () => {
    const first = await adapter.upsertListing('same-key', payload, null);
    const second = await adapter.upsertListing('same-key', payload, null);
    expect(second.idempotentReplay).toBe(true);
    expect(second.externalListingId).toBe(first.externalListingId);
    expect(adapter.contract.calls.filter((c) => c.method === 'UPSERT')).toHaveLength(
      2,
    );
  });

  it('maps 4xx, 5xx and timeout behaviors from the contract server', async () => {
    adapter.contract.configure('reject400');
    await expect(
      adapter.upsertListing('key-400', payload, null),
    ).rejects.toMatchObject({ status: 400 });

    adapter.contract.reset();
    adapter.contract.configure('reject500');
    await expect(
      adapter.upsertListing('key-500', payload, null),
    ).rejects.toMatchObject({ status: 500 });

    adapter.contract.reset();
    adapter.contract.configure('timeout');
    await expect(adapter.upsertListing('key-timeout', payload, null)).rejects.toThrow(
      'FAKE_TIMEOUT',
    );
  });
});

describe('AutoScout24 DMS HTTP adapter error mapping', () => {
  it('maps 4xx responses to client_error', async () => {
    const fetchImpl = async () =>
      ({
        status: 422,
        text: async () => '{"error":"invalid"}',
      }) as Response;

    const adapter = new HttpAutoscout24DmsListingPublisherAdapter(
      async () => ({ clientId: 'id', clientSecret: 'secret' }),
      fetchImpl,
    );

    process.env.AUTOSCOUT24_DMS_API_BASE_URL = 'https://dms.example.test';
    process.env.AUTOSCOUT24_DMS_API_CREDENTIALS_SECRET_REF = 'gsm-ref';

    await expect(
      adapter.upsertListing('http-key', payload, null),
    ).rejects.toThrow(Autoscout24DmsAdapterError);

    delete process.env.AUTOSCOUT24_DMS_API_BASE_URL;
    delete process.env.AUTOSCOUT24_DMS_API_CREDENTIALS_SECRET_REF;
  });
});

describe('AutoScout24 DMS push guards', () => {
  it('returns LISTING_PUSH_DISABLED before adapter selection when env flag is off', async () => {
    delete process.env.VEHICLE_LISTING_AS24_PUSH_ENABLED;
    await expect(
      assertVehicleListingAs24PushEnabled(
        { vehicleListingPushSettings: { findUnique: async () => null } },
        'tenant-1',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns LISTING_PUSH_UNCONFIGURED from the not-configured adapter', async () => {
    const adapter = new NotConfiguredAutoscout24DmsListingPublisherAdapter();
    try {
      await adapter.upsertListing('key', payload, null);
      throw new Error('expected LISTING_PUSH_UNCONFIGURED');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        code: 'LISTING_PUSH_UNCONFIGURED',
      });
    }
  });
});
