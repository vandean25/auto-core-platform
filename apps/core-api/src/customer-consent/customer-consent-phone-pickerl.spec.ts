import { CustomerConsentService } from './customer-consent.service.js';

describe('CustomerConsentService.loadPhonePickerlConsentByCustomerIds', () => {
  it('scopes communication state and consent queries to all active controller legal entities', async () => {
    const findStateMany = jest.fn().mockResolvedValue([]);
    const findConsentMany = jest.fn().mockResolvedValue([
      {
        customer_id: 'cust-1',
        controller_legal_entity_id: 'le-1',
        purpose: 'PICKERL_REMINDER',
        channel: 'PHONE',
        status: 'GRANTED',
        sequence: 1,
        basis: 'CONSENT',
        text_version: 'v1',
        text_snapshot: 'Wording',
        evidence: null,
      },
    ]);
    const prisma = {
      legalEntity: {
        findMany: jest.fn().mockResolvedValue([{ id: 'le-1' }]),
      },
      customerCommunicationState: {
        findMany: findStateMany,
      },
      customerConsent: {
        findMany: findConsentMany,
      },
    };

    const service = new CustomerConsentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.loadPhonePickerlConsentByCustomerIds(
      'tenant-1',
      ['cust-1', 'cust-2'],
    );

    expect(findStateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-1',
          controller_legal_entity_id: { in: ['le-1'] },
        }),
      }),
    );
    expect(findConsentMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-1',
          controller_legal_entity_id: { in: ['le-1'] },
        }),
      }),
    );
    expect(result.get('cust-1')).toBe(true);
    expect(result.get('cust-2')).toBe(false);
  });

  it('returns false without throwing when tenant has zero active legal entities', async () => {
    const prisma = {
      legalEntity: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customerCommunicationState: {
        findMany: jest.fn(),
      },
      customerConsent: {
        findMany: jest.fn(),
      },
    };

    const service = new CustomerConsentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.loadPhonePickerlConsentByCustomerIds(
      'tenant-1',
      ['cust-1'],
    );

    expect(result.get('cust-1')).toBe(false);
    expect(prisma.customerConsent.findMany).not.toHaveBeenCalled();
  });

  it('resolves consent across multiple active controllers and respects per-controller restriction', async () => {
    const prisma = {
      legalEntity: {
        findMany: jest.fn().mockResolvedValue([{ id: 'le-1' }, { id: 'le-2' }]),
      },
      customerCommunicationState: {
        findMany: jest.fn().mockResolvedValue([
          {
            customer_id: 'cust-restricted-on-le1',
            controller_legal_entity_id: 'le-1',
            processing_status: 'RESTRICTED',
          },
          {
            customer_id: 'cust-granted-on-le2',
            controller_legal_entity_id: 'le-1',
            processing_status: 'RESTRICTED',
          },
        ]),
      },
      customerConsent: {
        findMany: jest.fn().mockResolvedValue([
          {
            customer_id: 'cust-restricted-on-le1',
            controller_legal_entity_id: 'le-1',
            purpose: 'PICKERL_REMINDER',
            channel: 'PHONE',
            status: 'GRANTED',
            sequence: 1,
            basis: 'CONSENT',
            text_version: 'v1',
            text_snapshot: 'Wording',
            evidence: null,
          },
          {
            customer_id: 'cust-granted-on-le2',
            controller_legal_entity_id: 'le-2',
            purpose: 'SERVICE_REMINDER',
            channel: 'PHONE',
            status: 'GRANTED',
            sequence: 1,
            basis: 'CONSENT',
            text_version: 'v1',
            text_snapshot: 'Wording',
            evidence: null,
          },
        ]),
      },
    };

    const service = new CustomerConsentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.loadPhonePickerlConsentByCustomerIds(
      'tenant-1',
      ['cust-restricted-on-le1', 'cust-granted-on-le2'],
    );

    expect(result.get('cust-restricted-on-le1')).toBe(false);
    expect(result.get('cust-granted-on-le2')).toBe(true);
  });

  it('rejects PHONE SOFT_OPT_IN and incomplete GRANTED proof', async () => {
    const prisma = {
      legalEntity: {
        findMany: jest.fn().mockResolvedValue([{ id: 'le-1' }]),
      },
      customerCommunicationState: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customerConsent: {
        findMany: jest.fn().mockResolvedValue([
          {
            customer_id: 'cust-soft',
            controller_legal_entity_id: 'le-1',
            purpose: 'PICKERL_REMINDER',
            channel: 'PHONE',
            status: 'SOFT_OPT_IN',
            sequence: 1,
            basis: 'LEGITIMATE_INTEREST',
            text_version: null,
            text_snapshot: null,
            evidence: {
              obtained_with_sale: true,
              own_similar_products: true,
              refusal_opportunity_at_collection: true,
              no_prior_refusal: true,
              own_similar_message_assessment: true,
            },
          },
          {
            customer_id: 'cust-incomplete',
            controller_legal_entity_id: 'le-1',
            purpose: 'SERVICE_REMINDER',
            channel: 'PHONE',
            status: 'GRANTED',
            sequence: 1,
            basis: 'CONSENT',
            text_version: '',
            text_snapshot: null,
            evidence: null,
          },
        ]),
      },
    };

    const service = new CustomerConsentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.loadPhonePickerlConsentByCustomerIds(
      'tenant-1',
      ['cust-soft', 'cust-incomplete'],
    );

    expect(result.get('cust-soft')).toBe(false);
    expect(result.get('cust-incomplete')).toBe(false);
  });
});

describe('CustomerConsentService.revokePhonePickerlConsents', () => {
  it('revokes PHONE purposes on each controller with a ledger and records actorUserId', async () => {
    const recordTenantMutation = jest.fn();
    const tx = {
      customerConsent: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { controller_legal_entity_id: 'le-1' },
            { controller_legal_entity_id: 'le-2' },
          ]),
        findFirst: jest.fn().mockResolvedValue({ sequence: 1, status: 'GRANTED' }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          ...data,
          recorded_at: new Date(),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      customerCommunicationState: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue({ country_iso: 'AT' }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'state-1', revision: 1, processing_status: 'ACTIVE' }]),
    };

    const service = new CustomerConsentService(
      {} as never,
      {} as never,
      {} as never,
      { recordTenantMutation } as never,
    );

    await service.revokePhonePickerlConsents({
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      actorMemberId: 'member-1',
      actorUserId: 'firebase-uid-1',
      tx: tx as never,
    });

    expect(tx.customerConsent.create).toHaveBeenCalledTimes(4);
    expect(recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CustomerConsent',
        actorUserId: 'firebase-uid-1',
        source: 'pickerl-contact-dialog.revoke',
      }),
      tx,
    );
  });
});
