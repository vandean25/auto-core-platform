import { CustomerConsentService } from './customer-consent.service.js';

describe('CustomerConsentService.loadPhonePickerlConsentByCustomerIds', () => {
  it('scopes communication state and consent queries to the resolved controller legal entity', async () => {
    const findStateMany = jest.fn().mockResolvedValue([]);
    const findConsentMany = jest.fn().mockResolvedValue([
      {
        customer_id: 'cust-1',
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
          controller_legal_entity_id: 'le-1',
        }),
      }),
    );
    expect(findConsentMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-1',
          controller_legal_entity_id: 'le-1',
        }),
      }),
    );
    expect(result.get('cust-1')).toBe(true);
    expect(result.get('cust-2')).toBe(false);
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
