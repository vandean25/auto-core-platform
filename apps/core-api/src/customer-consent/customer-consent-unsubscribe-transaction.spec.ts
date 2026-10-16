import { CustomerConsentService } from './customer-consent.service.js';
import { hashUnsubscribeToken } from './customer-consent-token.helpers.js';

describe('withdrawMarketingByUnsubscribeToken transaction ordering', () => {
  const rawToken = 'test-unsubscribe-token-raw';
  const tokenHash = hashUnsubscribeToken(rawToken);
  const tenantId = 'tenant-1';
  const customerId = 'customer-1';
  const controllerId = 'controller-1';
  const tokenRowId = 'token-row-1';

  function buildService(mocks: {
    findMany: jest.Mock;
    lock: jest.Mock;
  }) {
    const auditService = {
      recordTenantMutation: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      customerCommunicationState: {
        upsert: jest.fn().mockResolvedValue({ id: 'state-1' }),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          customerConsent: {
            findMany: mocks.findMany,
            findFirst: jest
              .fn()
              .mockResolvedValueOnce(null)
              .mockResolvedValue({ sequence: 1 }),
            create: jest.fn().mockResolvedValue({
              id: 'consent-1',
              tenant_id: tenantId,
              customer_id: customerId,
              controller_legal_entity_id: controllerId,
              channel: 'EMAIL',
              purpose: 'NEWSLETTER',
              status: 'REVOKED',
              sequence: 2,
              basis: null,
              recorded_at: new Date('2026-01-01'),
              occurred_at: new Date('2026-01-01'),
              source: 'UNSUBSCRIBE',
              revoked_at: new Date('2026-01-01'),
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          customerConsentUnsubscribeToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          customerCommunicationState: {
            update: jest.fn().mockResolvedValue({}),
          },
          $executeRaw: jest.fn(),
        };
        await callback(tx);
      }),
    };
    const systemPrisma = {
      customerConsentUnsubscribeToken: {
        findFirst: jest.fn().mockResolvedValue({
          id: tokenRowId,
          tenant_id: tenantId,
          controller_legal_entity_id: controllerId,
          customer_id: customerId,
          channel: 'EMAIL',
          contact_fingerprint: 'fp',
          token_sha256: tokenHash,
          retain_until: new Date('2099-01-01'),
          used_at: null,
        }),
      },
    };

    const service = new CustomerConsentService(
      prisma as never,
      systemPrisma as never,
      {} as never,
      auditService as never,
    );

    const serviceInternals = service as unknown as {
      lockCommunicationState: typeof mocks.lock;
      ensureCommunicationStateRow: () => Promise<void>;
    };
    jest
      .spyOn(serviceInternals, 'lockCommunicationState')
      .mockImplementation(mocks.lock);
    jest
      .spyOn(serviceInternals, 'ensureCommunicationStateRow')
      .mockResolvedValue(undefined);

    return { service, prisma, auditService };
  }

  it('locks communication state before loading the ledger', async () => {
    const order: string[] = [];
    const grantedLedger = [
      {
        purpose: 'NEWSLETTER' as const,
        channel: 'EMAIL' as const,
        status: 'GRANTED' as const,
        sequence: 1,
        basis: 'CONSENT',
        text_version: 'v1',
        text_snapshot: 'Wording',
        evidence: null,
      },
    ];

    const { service } = buildService({
      lock: jest.fn(async () => {
        order.push('lock');
        return {
          id: 'state-1',
          revision: 1,
          processing_status: 'ACTIVE' as const,
        };
      }),
      findMany: jest.fn(async () => {
        order.push('ledger');
        return grantedLedger;
      }),
    });

    await service.withdrawMarketingByUnsubscribeToken(rawToken);

    expect(order).toEqual(['lock', 'ledger']);
  });

  it('appends a revoke when the ledger shows a grant after the lock is taken', async () => {
    let releaseLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const grantedAfterConcurrentWrite = [
      {
        purpose: 'NEWSLETTER' as const,
        channel: 'EMAIL' as const,
        status: 'GRANTED' as const,
        sequence: 2,
        basis: 'CONSENT',
        text_version: 'v1',
        text_snapshot: 'Wording',
        evidence: null,
      },
    ];

    const findMany = jest.fn(async () => {
      await lockHeld;
      return grantedAfterConcurrentWrite;
    });

    const { service, auditService } = buildService({
      lock: jest.fn(async () => {
        releaseLock();
        return {
          id: 'state-1',
          revision: 2,
          processing_status: 'ACTIVE' as const,
        };
      }),
      findMany,
    });

    await service.withdrawMarketingByUnsubscribeToken(rawToken);

    expect(findMany).toHaveBeenCalled();
    expect(auditService.recordTenantMutation).toHaveBeenCalled();
  });
});
