import type { Prisma } from '@prisma/client';
import { generateCreditNoteNumber } from './credit-note-number.helpers.js';

function createMockTx(options?: {
  siteTimezone?: string | null;
  sequenceCurrent?: number;
}) {
  const siteFindFirst = jest.fn().mockResolvedValue(
    options?.siteTimezone !== undefined
      ? { timezone: options.siteTimezone }
      : { timezone: 'Europe/Vienna' },
  );
  const creditNoteSequenceUpsert = jest
    .fn()
    .mockResolvedValue({ current: options?.sequenceCurrent ?? 1 });

  const tx = {
    site: { findFirst: siteFindFirst },
    creditNoteSequence: { upsert: creditNoteSequenceUpsert },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    siteFindFirst,
    creditNoteSequenceUpsert,
  };
}

describe('generateCreditNoteNumber', () => {
  it.each([
    {
      label: 'winter CET (UTC+1) at 2027-01-01 00:30 Vienna (23:30 UTC)',
      instant: '2026-12-31T23:30:00.000Z',
      siteTimezone: 'Europe/Vienna',
      expectedYear: 2027,
      expectedNumber: 'CN-2027-0001',
    },
    {
      label: 'summer CEST (UTC+2) at 2026-07-16 00:30 Vienna (22:30 UTC)',
      instant: '2026-07-15T22:30:00.000Z',
      siteTimezone: 'Europe/Vienna',
      expectedYear: 2026,
      expectedNumber: 'CN-2026-0001',
    },
    {
      label: 'America/New_York at 2027-01-01 02:00 UTC (2026-12-31 21:00 EST)',
      instant: '2027-01-01T02:00:00.000Z',
      siteTimezone: 'America/New_York',
      expectedYear: 2026,
      expectedNumber: 'CN-2026-0001',
    },
  ])(
    'uses site calendar year for $label',
    async ({ instant, siteTimezone, expectedYear, expectedNumber }) => {
      const { tx, creditNoteSequenceUpsert } = createMockTx({
        siteTimezone,
        sequenceCurrent: 1,
      });

      const result = await generateCreditNoteNumber(
        tx,
        'tenant-1',
        new Date(instant),
        { siteId: 'site-1' },
      );

      expect(result).toBe(expectedNumber);
      expect(creditNoteSequenceUpsert).toHaveBeenCalledWith({
        where: { tenant_id_year: { tenant_id: 'tenant-1', year: expectedYear } },
        update: { current: { increment: 1 } },
        create: { tenant_id: 'tenant-1', year: expectedYear, current: 1 },
      });
    },
  );
});
