import { BadRequestException } from '@nestjs/common';
import { LoanerVehicleStatus } from '@prisma/client';
import { encodeMcpPositionCursor } from './mcp-output.util.js';
import {
  paginateLoanerRows,
  paginateWorkshopSlotRows,
} from './mcp-availability-read.mapper.js';

describe('mcp-availability-read.mapper pagination', () => {
  const slotRows = [
    {
      bay_id: '00000000-0000-4000-8000-0000000000b2',
      start_at: '2026-10-01T08:00:00.000Z',
      end_at: '2026-10-01T09:00:00.000Z',
    },
    {
      bay_id: '00000000-0000-4000-8000-0000000000b1',
      start_at: '2026-10-01T08:00:00.000Z',
      end_at: '2026-10-01T09:00:00.000Z',
    },
    {
      bay_id: '00000000-0000-4000-8000-0000000000b1',
      start_at: '2026-10-01T09:00:00.000Z',
      end_at: '2026-10-01T10:00:00.000Z',
    },
  ];

  it('pages workshop slots by start_at then bay_id without gaps', () => {
    const page1 = paginateWorkshopSlotRows(slotRows, 2);
    expect(page1.data).toHaveLength(2);
    expect(page1.data[0].bay_id).toBe(
      '00000000-0000-4000-8000-0000000000b1',
    );
    expect(page1.meta.next_cursor).not.toBeNull();

    const page2 = paginateWorkshopSlotRows(
      slotRows,
      2,
      page1.meta.next_cursor!,
    );
    expect(page2.data).toHaveLength(1);
    expect(page2.meta.next_cursor).toBeNull();
    expect([...page1.data, ...page2.data]).toEqual(
      [...slotRows].sort(
        (a, b) =>
          a.start_at.localeCompare(b.start_at) ||
          a.bay_id.localeCompare(b.bay_id),
      ),
    );
  });

  it('rejects an invalid workshop slot cursor', () => {
    expect(() =>
      paginateWorkshopSlotRows(slotRows, 1, 'not-a-cursor'),
    ).toThrow(BadRequestException);
  });

  it('pages loaners by loaner_vehicle_id', () => {
    const rows = [
      {
        loaner_vehicle_id: '00000000-0000-4000-8000-0000000000c2',
        vehicle_id: 'v-2',
        display_name: 'B',
        status: LoanerVehicleStatus.AVAILABLE,
      },
      {
        loaner_vehicle_id: '00000000-0000-4000-8000-0000000000c1',
        vehicle_id: 'v-1',
        display_name: 'A',
        status: LoanerVehicleStatus.AVAILABLE,
      },
    ];
    const page1 = paginateLoanerRows(rows, 1);
    expect(page1.data[0].loaner_vehicle_id).toBe(
      '00000000-0000-4000-8000-0000000000c1',
    );
    const page2 = paginateLoanerRows(rows, 1, page1.meta.next_cursor!);
    expect(page2.data[0].loaner_vehicle_id).toBe(
      '00000000-0000-4000-8000-0000000000c2',
    );
  });

  it('rejects a loaner cursor with the wrong position shape', () => {
    const badCursor = encodeMcpPositionCursor({
      start_at: '2026-10-01T08:00:00.000Z',
      bay_id: '00000000-0000-4000-8000-0000000000b1',
    });
    expect(() => paginateLoanerRows([], 1, badCursor)).toThrow(
      BadRequestException,
    );
  });
});
