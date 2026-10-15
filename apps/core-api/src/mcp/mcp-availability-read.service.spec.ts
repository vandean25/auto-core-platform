import { BadRequestException } from '@nestjs/common';
import { LoanerVehicleStatus } from '@prisma/client';
import { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import { MCP_AVAILABILITY_SNAPSHOT_NOTE } from './mcp-availability-read.mapper.js';

const SITE_ID = '00000000-0000-4000-8000-0000000000a9';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';

describe('McpAvailabilityReadService', () => {
  const siteContext = { getSiteId: jest.fn().mockResolvedValue(SITE_ID) };
  const tenantContext = { getTenantId: jest.fn().mockResolvedValue(TENANT_ID) };
  const workshopPlanner = { listAvailableSlots: jest.fn() };
  const workshopSettings = {
    getSettingsForSite: jest.fn().mockResolvedValue({
      timezone: 'Europe/Vienna',
    }),
  };
  const loanerVehicles = { getAvailability: jest.fn() };

  let service: McpAvailabilityReadService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new McpAvailabilityReadService(
      tenantContext as never,
      siteContext as never,
      workshopPlanner as never,
      workshopSettings as never,
      loanerVehicles as never,
    );
  });

  it('pages workshop slots and includes the snapshot note', async () => {
    workshopPlanner.listAvailableSlots.mockResolvedValue({
      timezone: 'Europe/Vienna',
      slotMinutes: 30,
      durationMinutes: 60,
      slots: [
        {
          bayId: 'bay-1',
          startAt: new Date('2026-10-01T08:00:00.000Z'),
          endAt: new Date('2026-10-01T09:00:00.000Z'),
        },
        {
          bayId: 'bay-1',
          startAt: new Date('2026-10-01T09:00:00.000Z'),
          endAt: new Date('2026-10-01T10:00:00.000Z'),
        },
      ],
    });

    const result = await service.listWorkshopSlots({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
      duration_minutes: 60,
      pageSize: 1,
    });

    expect(result.availability_note).toBe(MCP_AVAILABILITY_SNAPSHOT_NOTE);
    expect(result.data).toHaveLength(1);
    expect(result.meta.next_cursor).not.toBeNull();
    expect(result.meta.total).toBe(2);
  });

  it('rejects workshop slot windows wider than eight days', async () => {
    await expect(
      service.listWorkshopSlots({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-10T00:00:00.000Z',
        duration_minutes: 60,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists only available loaners without customer fields', async () => {
    loanerVehicles.getAvailability.mockResolvedValue({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
      asOf: '2026-10-01T12:00:00.000Z',
      data: [
        {
          vehicle: {
            id: 'lv-1',
            vehicleId: 'veh-1',
            displayName: 'Pool 1',
            status: LoanerVehicleStatus.AVAILABLE,
          },
          available: true,
        },
        {
          vehicle: {
            id: 'lv-2',
            vehicleId: 'veh-2',
            displayName: 'Pool 2',
            status: LoanerVehicleStatus.MAINTENANCE,
          },
          available: false,
        },
      ],
    });

    const result = await service.listAvailableLoaners({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
    });

    expect(result.data).toEqual([
      {
        loaner_vehicle_id: 'lv-1',
        vehicle_id: 'veh-1',
        display_name: 'Pool 1',
        status: LoanerVehicleStatus.AVAILABLE,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/customer/i);
  });
});
