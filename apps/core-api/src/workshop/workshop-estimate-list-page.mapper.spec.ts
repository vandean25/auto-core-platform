import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import { toEstimateListRowDto } from './workshop-estimate-list-page.mapper.js';
import type { SiteEstimateVersionListRow } from './workshop-estimate-version-site-list.read.js';

function row(
  overrides: Partial<
    SiteEstimateVersionListRow['estimate']['workshop_order']
  > = {},
): SiteEstimateVersionListRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    version: 2,
    status: WorkshopEstimateStatus.SENT,
    valid_until: new Date('2026-11-10T00:00:00.000Z'),
    sent_at: new Date('2026-10-28T09:00:00.000Z'),
    decided_at: null,
    channel: null,
    total_net: new Prisma.Decimal('1000'),
    total_gross: new Prisma.Decimal('1200'),
    estimate: {
      estimate_number: 'KV-2026-0007',
      workshop_order_id: '00000000-0000-4000-8000-000000000002',
      site_id: '00000000-0000-4000-8000-000000000003',
      workshop_order: {
        customer_id: '00000000-0000-4000-8000-000000000004',
        order_number: 'WO-2026-0042',
        customer: {
          company_name: null,
          first_name: 'Anna',
          last_name: 'Beispiel',
        },
        vehicle: { plate: 'W-12345X' },
        ...overrides,
      },
    },
  };
}

describe('toEstimateListRowDto', () => {
  it('flattens the read model row into the columns of the list page', () => {
    expect(toEstimateListRowDto(row())).toEqual({
      version_id: '00000000-0000-4000-8000-000000000001',
      estimate_number: 'KV-2026-0007',
      version: 2,
      status: 'SENT',
      order_id: '00000000-0000-4000-8000-000000000002',
      order_number: 'WO-2026-0042',
      customer_id: '00000000-0000-4000-8000-000000000004',
      customer_name: 'Anna Beispiel',
      vehicle_plate: 'W-12345X',
      sent_at: '2026-10-28T09:00:00.000Z',
      valid_until: '2026-11-10T00:00:00.000Z',
      decided_at: null,
      total_gross: '1200.00',
    });
  });

  it('names a company customer by its company name and tolerates a missing customer, plate and total', () => {
    expect(
      toEstimateListRowDto(
        row({
          customer: {
            company_name: ' Pilot Customer GmbH ',
            first_name: 'A',
            last_name: 'B',
          },
        }),
      ).customer_name,
    ).toBe('Pilot Customer GmbH');

    const bare = toEstimateListRowDto({
      ...row({ customer_id: null, customer: null, vehicle: { plate: null } }),
      total_gross: null,
      sent_at: null,
      valid_until: null,
    });
    expect(bare).toMatchObject({
      customer_id: null,
      customer_name: null,
      vehicle_plate: null,
      total_gross: null,
      sent_at: null,
      valid_until: null,
    });
  });
});
