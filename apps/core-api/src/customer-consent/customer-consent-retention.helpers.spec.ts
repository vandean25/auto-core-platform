import {
  addCalendarYearsPreservingDate,
  consentProofRetainUntil,
} from './customer-consent-retention.helpers.js';

describe('consent proof retention', () => {
  it('adds three calendar years on a normal date', () => {
    const cessation = new Date('2024-03-15T12:00:00.000Z');
    expect(consentProofRetainUntil(cessation).toISOString()).toBe(
      '2027-03-15T12:00:00.000Z',
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
