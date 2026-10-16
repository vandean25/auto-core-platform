import { purgeExpiredConsentProofRows } from './customer-consent-retention-purge.helpers.js';

describe('purgeExpiredConsentProofRows', () => {
  it('skips purging any row in a chain that has legal_hold', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      customerConsent: {
        groupBy: jest.fn().mockResolvedValue([
          {
            controller_legal_entity_id: 'ctrl-1',
            customer_id: 'cust-1',
            channel: 'EMAIL',
            purpose: 'NEWSLETTER',
          },
        ]),
        deleteMany,
      },
    };

    await purgeExpiredConsentProofRows(
      prisma as never,
      'tenant-1',
      new Date('2030-01-01'),
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        retain_until: { lt: new Date('2030-01-01') },
        legal_hold: false,
        NOT: {
          OR: [
            {
              controller_legal_entity_id: 'ctrl-1',
              customer_id: 'cust-1',
              channel: 'EMAIL',
              purpose: 'NEWSLETTER',
            },
          ],
        },
      },
    });
  });
});
