import { WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER } from '../domain-event-consumer/domain-event-consumer.constants.js';
import {
  runEstimateDecidedConsumerAfterCommit,
  wakeEstimateDecidedConsumerAfterCommit,
} from './wake-estimate-decided-consumer.js';

describe('runEstimateDecidedConsumerAfterCommit', () => {
  it('does not throw when the inline batch fails and still schedules a wake-up', async () => {
    const consumer = {
      processTenantBatch: jest
        .fn()
        .mockRejectedValue(new Error('consumer database error')),
    };
    const wakeUps = {
      isEnabled: jest.fn().mockReturnValue(true),
      enqueueWakeUp: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      runEstimateDecidedConsumerAfterCommit(
        consumer as never,
        wakeUps as never,
        'tenant-1',
      ),
    ).resolves.toBeUndefined();

    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      consumerKey: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
    });
  });

  it('allows a later batch run after an inline failure', async () => {
    const consumer = {
      processTenantBatch: jest
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(1),
    };
    const wakeUps = {
      isEnabled: jest.fn().mockReturnValue(false),
      enqueueWakeUp: jest.fn(),
    };

    await runEstimateDecidedConsumerAfterCommit(
      consumer as never,
      wakeUps as never,
      'tenant-1',
    );
    await consumer.processTenantBatch('tenant-1');

    expect(consumer.processTenantBatch).toHaveBeenCalledTimes(2);
  });
});

describe('wakeEstimateDecidedConsumerAfterCommit', () => {
  it('no-ops when cloud tasks are disabled', async () => {
    const wakeUps = {
      isEnabled: jest.fn().mockReturnValue(false),
      enqueueWakeUp: jest.fn(),
    };
    await wakeEstimateDecidedConsumerAfterCommit(wakeUps as never, 'tenant-1');
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });
});
