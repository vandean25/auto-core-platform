import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { DOMAIN_EVENT_TYPES } from './domain-event.constants.js';
import { DomainEventStoreService } from './domain-event-store.service.js';

describe('DomainEventStoreService.appendInTx', () => {
  const service = new DomainEventStoreService();

  afterEach(() => {
    DryRunStorage.run({ isDryRun: false }, () => undefined);
  });

  it('creates a row in the caller transaction when not in dry-run', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'ev-1', sequence: BigInt(7) });
    const tx = { domainEvent: { create } };

    const result = await service.appendInTx(tx as never, {
      tenantId: 'tenant-1',
      siteId: 'site-1',
      entityId: 'order-1',
      eventType: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
      occurrenceKey: 'workshop_order.scheduled.v1:order-1',
      occurredAt: new Date('2026-10-15T08:00:00.000Z'),
      traceId: '00000000-0000-4000-8000-000000000001',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ eventId: 'ev-1', sequence: BigInt(7) });
  });

  it('skips the insert during dry-run preview', async () => {
    const create = jest.fn();
    const tx = { domainEvent: { create } };

    const result = await DryRunStorage.run({ isDryRun: true }, () =>
      service.appendInTx(tx as never, {
        tenantId: 'tenant-1',
        siteId: 'site-1',
        entityId: 'order-1',
        eventType: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
        occurrenceKey: 'workshop_order.scheduled.v1:order-1',
        occurredAt: new Date('2026-10-15T08:00:00.000Z'),
        traceId: '00000000-0000-4000-8000-000000000001',
      }),
    );

    expect(create).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
