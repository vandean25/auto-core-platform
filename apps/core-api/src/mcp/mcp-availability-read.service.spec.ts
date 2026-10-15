import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LoanerVehicleStatus } from '@prisma/client';
import { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import { MCP_AVAILABILITY_SNAPSHOT_NOTE } from './mcp-availability-read.mapper.js';

const SITE_ID = '00000000-0000-4000-8000-0000000000a9';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const FOREIGN_BAY_ID = '00000000-0000-4000-8000-0000000000f1';
const BAY_ID = '00000000-0000-4000-8000-0000000000b1';

const VALID_WINDOW = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-02T00:00:00.000Z',
};

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
    siteContext.getSiteId.mockResolvedValue(SITE_ID);
    service = new McpAvailabilityReadService(
      tenantContext as never,
      siteContext as never,
      workshopPlanner as never,
      workshopSettings as never,
      loanerVehicles as never,
    );
  });

  describe('listWorkshopSlots', () => {
    it('pages workshop slots and includes the snapshot note', async () => {
      workshopPlanner.listAvailableSlots.mockResolvedValue({
        timezone: 'Europe/Vienna',
        slotMinutes: 30,
        durationMinutes: 60,
        slots: [
          {
            bayId: BAY_ID,
            startAt: new Date('2026-10-01T08:00:00.000Z'),
            endAt: new Date('2026-10-01T09:00:00.000Z'),
          },
          {
            bayId: BAY_ID,
            startAt: new Date('2026-10-01T09:00:00.000Z'),
            endAt: new Date('2026-10-01T10:00:00.000Z'),
          },
        ],
      });

      const result = await service.listWorkshopSlots({
        ...VALID_WINDOW,
        duration_minutes: 60,
        pageSize: 1,
      });

      expect(result.availability_note).toBe(MCP_AVAILABILITY_SNAPSHOT_NOTE);
      expect(result.data).toHaveLength(1);
      expect(result.meta.next_cursor).not.toBeNull();
      expect(result.meta.total).toBe(2);

      const page2 = await service.listWorkshopSlots({
        ...VALID_WINDOW,
        duration_minutes: 60,
        pageSize: 1,
        cursor: result.meta.next_cursor!,
      });
      expect(page2.data).toHaveLength(1);
      expect(page2.data[0].start_at).toBe('2026-10-01T09:00:00.000Z');
    });

    it('rejects windows wider than eight days', async () => {
      await expect(
        service.listWorkshopSlots({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-10T00:00:00.000Z',
          duration_minutes: 60,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(workshopPlanner.listAvailableSlots).not.toHaveBeenCalled();
    });

    it('rejects invalid range instants', async () => {
      await expect(
        service.listWorkshopSlots({
          from: 'not-a-date',
          to: VALID_WINDOW.to,
          duration_minutes: 60,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires an active site', async () => {
      siteContext.getSiteId.mockRejectedValue(
        new UnprocessableEntityException({
          code: 'ACTIVE_SITE_REQUIRED',
          message: 'No active site',
        }),
      );
      await expect(
        service.listWorkshopSlots({
          ...VALID_WINDOW,
          duration_minutes: 60,
        }),
      ).rejects.toMatchObject({
        response: { code: 'ACTIVE_SITE_REQUIRED' },
      });
    });

    it('surfaces a foreign bay as not found', async () => {
      workshopPlanner.listAvailableSlots.mockRejectedValue(
        new NotFoundException(`Bay ${FOREIGN_BAY_ID} not found`),
      );
      await expect(
        service.listWorkshopSlots({
          ...VALID_WINDOW,
          duration_minutes: 60,
          bay_id: FOREIGN_BAY_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listAvailableLoaners', () => {
    it('lists only available loaners without customer fields', async () => {
      loanerVehicles.getAvailability.mockResolvedValue({
        from: VALID_WINDOW.from,
        to: VALID_WINDOW.to,
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

      const result = await service.listAvailableLoaners(VALID_WINDOW);

      expect(loanerVehicles.getAvailability).toHaveBeenCalledWith(VALID_WINDOW);
      expect(result.availability_note).toBe(MCP_AVAILABILITY_SNAPSHOT_NOTE);
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

    it('rejects loaner windows wider than eight days', async () => {
      await expect(
        service.listAvailableLoaners({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-10T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(loanerVehicles.getAvailability).not.toHaveBeenCalled();
    });

    it('rejects invalid range instants for loaners', async () => {
      await expect(
        service.listAvailableLoaners({
          from: VALID_WINDOW.from,
          to: 'still-not-iso',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires an active site for loaners', async () => {
      siteContext.getSiteId.mockRejectedValue(
        new UnprocessableEntityException({
          code: 'ACTIVE_SITE_REQUIRED',
          message: 'No active site',
        }),
      );
      await expect(service.listAvailableLoaners(VALID_WINDOW)).rejects.toMatchObject(
        { response: { code: 'ACTIVE_SITE_REQUIRED' } },
      );
      expect(loanerVehicles.getAvailability).not.toHaveBeenCalled();
    });

    it('pages loaners with a position cursor', async () => {
      loanerVehicles.getAvailability.mockResolvedValue({
        from: VALID_WINDOW.from,
        to: VALID_WINDOW.to,
        asOf: '2026-10-01T12:00:00.000Z',
        data: [
          {
            vehicle: {
              id: '00000000-0000-4000-8000-0000000000d1',
              vehicleId: 'v-a',
              displayName: 'A',
              status: LoanerVehicleStatus.AVAILABLE,
            },
            available: true,
          },
          {
            vehicle: {
              id: '00000000-0000-4000-8000-0000000000d2',
              vehicleId: 'v-b',
              displayName: 'B',
              status: LoanerVehicleStatus.AVAILABLE,
            },
            available: true,
          },
        ],
      });

      const page1 = await service.listAvailableLoaners({
        ...VALID_WINDOW,
        pageSize: 1,
      });
      const page2 = await service.listAvailableLoaners({
        ...VALID_WINDOW,
        pageSize: 1,
        cursor: page1.meta.next_cursor!,
      });
      expect(page1.data[0].loaner_vehicle_id).not.toBe(
        page2.data[0].loaner_vehicle_id,
      );
    });

  });
});
