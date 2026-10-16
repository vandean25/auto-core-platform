import {
  addCalendarYearsPreservingDate,
  consentProofRetainUntil,
} from './customer-consent-retention-core.helpers.js';
import { stampProofChainRetainUntil } from './customer-consent-retention.helpers.js';

describe('consent proof retention', () => {
  it('adds three calendar years on a normal date', () => {
    const cessation = new Date('2024-03-15T12:00:00.000Z');
    expect(consentProofRetainUntil(cessation).toISOString()).toBe(
      '2027-03-15T12:00:00.000Z',
    );
  });

  it('stamps retain_until on held rows in the proof chain', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = { customerConsent: { updateMany } };
    const cessation = new Date('2024-06-01T12:00:00.000Z');
    await stampProofChainRetainUntil(tx as never, {
      tenantId: 't1',
      controllerLegalEntityId: 'c1',
      customerId: 'cust',
      channel: 'EMAIL',
      purposes: ['NEWSLETTER'],
      cessationAt: cessation,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ legal_hold: false }),
        data: { retain_until: consentProofRetainUntil(cessation) },
      }),
    );
  });

  it('clamps Feb 29 across a non-leap year', () => {
    const leapDay = new Date('2024-02-29T10:00:00.000Z');
    const target = addCalendarYearsPreservingDate(leapDay, 3);
    expect(target.getUTCMonth()).toBe(1);
    expect(target.getUTCDate()).toBe(28);
    expect(target.getUTCFullYear()).toBe(2027);
  });
});
