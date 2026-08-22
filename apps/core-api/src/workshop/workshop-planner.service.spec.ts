import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WorkshopOrderStatus } from '@prisma/client';
import { WorkshopPlannerService } from './workshop-planner.service';
import { WorkshopSettingsService } from './workshop-settings.service';
import {
  mockPrisma,
  mockTenantContext,
  resetWorkshopMocks,
  workshopPrismaProvider,
  workshopTenantProvider,
} from './workshop.spec.support';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const settings = {
  id: 'ws-1',
  tenant_id: TENANT_ID,
  timezone: 'Europe/Vienna',
  slot_minutes: 30,
  holiday_country_iso: 'AT',
  holiday_subdivision_code: null,
  openingHours: [
    { weekday: 1, is_closed: false, open_time: '07:30', close_time: '17:00' },
    { weekday: 2, is_closed: false, open_time: '07:30', close_time: '17:00' },
    { weekday: 3, is_closed: false, open_time: '07:30', close_time: '17:00' },
    { weekday: 4, is_closed: false, open_time: '07:30', close_time: '17:00' },
    { weekday: 5, is_closed: false, open_time: '07:30', close_time: '17:00' },
    { weekday: 6, is_closed: false, open_time: '08:00', close_time: '12:00' },
    { weekday: 7, is_closed: true, open_time: '07:30', close_time: '17:00' },
  ],
};

describe('WorkshopPlannerService', () => {
  let service: WorkshopPlannerService;
  const settingsService = {
    getOrCreateSettings: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopPlannerService,
        workshopPrismaProvider,
        workshopTenantProvider,
        { provide: WorkshopSettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get(WorkshopPlannerService);
    resetWorkshopMocks();
    mockTenantContext.getTenantId.mockResolvedValue(TENANT_ID);
    settingsService.getOrCreateSettings.mockResolvedValue(settings);
    mockPrisma.bay.findMany.mockResolvedValue([
      { id: 'bay-1', name: 'Bay 1', sort_order: 0, is_active: true },
    ]);
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.findMany.mockResolvedValue([]);
  });

  it('rejects a planner window wider than 8 days', async () => {
    await expect(
      service.getPlanner({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-10T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a closed holiday overlay and scheduled bookings', async () => {
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([
      {
        name: 'Nationalfeiertag',
        observed_on: new Date('2026-10-26T00:00:00.000Z'),
        repeats_annually: false,
        is_closed: true,
        open_time: null,
        close_time: null,
      },
    ]);
    mockPrisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-1',
        order_number: 'WO-2026-0001',
        status: WorkshopOrderStatus.SCHEDULED,
        bay_id: 'bay-1',
        mechanic_id: null,
        mechanic: null,
        scheduled_start_at: new Date('2026-10-26T08:00:00.000Z'),
        scheduled_end_at: new Date('2026-10-26T09:00:00.000Z'),
        customer: { id: 'c-1', first_name: 'Ada', last_name: 'Lovelace', company_name: null, type: 'PRIVATE' },
        vehicle: { id: 'v-1', make: 'Toyota', model: 'Corolla', year: 2020, plate: 'W-1' },
      },
    ]);

    const result = await service.getPlanner({
      from: '2026-10-26T00:00:00.000Z',
      to: '2026-10-27T00:00:00.000Z',
    });

    expect(result.holidays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-10-26',
          name: 'Nationalfeiertag',
          isClosed: true,
        }),
      ]),
    );
    expect(result.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: 'wo-1',
          occupancyKind: 'BOOKING',
          bayId: 'bay-1',
        }),
      ]),
    );
    expect(result.bays[0]).toEqual(
      expect.objectContaining({ id: 'bay-1', name: 'Bay 1' }),
    );
  });

  it('synthesizes unscheduled on-floor occupancy for today', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));

    mockPrisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-floor',
        order_number: 'WO-2026-0002',
        status: WorkshopOrderStatus.INTAKE,
        bay_id: 'bay-1',
        mechanic_id: null,
        mechanic: null,
        scheduled_start_at: null,
        scheduled_end_at: null,
        customer: null,
        vehicle: { id: 'v-2', make: 'VW', model: 'Golf', year: 2019, plate: 'W-2' },
      },
    ]);

    const result = await service.getPlanner({
      from: '2026-08-21T00:00:00.000Z',
      to: '2026-08-22T00:00:00.000Z',
    });

    expect(result.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: 'wo-floor',
          occupancyKind: 'UNSCHEDULED_ON_FLOOR',
          bayId: 'bay-1',
        }),
      ]),
    );
    expect(result.bookings[0]?.scheduledStartAt).toBeTruthy();
    expect(result.bookings[0]?.scheduledEndAt).toBeTruthy();
    jest.useRealTimers();
  });
});
