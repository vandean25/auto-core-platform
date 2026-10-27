import type { PrismaService } from '../prisma/prisma.service.js';
import { planCustomerDryRun } from './customer-import.dry-run.js';

describe('planCustomerDryRun planBudget', () => {
  const prisma = {
    externalIdMapping: { findMany: async () => [] },
    customer: { findMany: async () => [] },
  } as unknown as PrismaService;

  it('returns a partial slice when planning exceeds the chunk deadline', async () => {
    let now = 0;
    const parsed = {
      headers: [
        'Kunden-Nr',
        'Typ',
        'Firma',
        'Vorname',
        'Nachname',
        'E-Mail',
        'Telefon',
        'Land',
      ],
      rows: [
        ['E1', 'PRIVATE', '', 'A', 'One', 'a@example.com', '', 'AT'],
        ['E2', 'PRIVATE', '', 'B', 'Two', 'b@example.com', '', 'AT'],
        ['E3', 'PRIVATE', '', 'C', 'Three', 'c@example.com', '', 'AT'],
      ],
    };
    const rows = await planCustomerDryRun(
      prisma,
      {
        tenantId: 'tenant-1',
        sourceSystem: 'test',
        mapping: {
          external_id: 'Kunden-Nr',
          first_name: 'Vorname',
          last_name: 'Nachname',
        },
        options: {},
        planBudget: {
          deadlineMs: 75,
          rowNoOffset: 10,
          nowMs: () => now,
          onAfterRowPlanned: () => {
            now += 40;
          },
        },
      },
      parsed,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.row_no)).toEqual([10, 11]);
  });
});
