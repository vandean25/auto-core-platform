import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EmployeeRole, WorkshopOrderStatus } from '@prisma/client';
import { WorkshopScheduleService } from './workshop-schedule.service';
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
  timezone: 'Europe/Vienna',
  slot_minutes: 30,
  holiday_country_iso: 'AT',
  holiday_subdivision_code: null,
  openingHours: [
    { weekday: 5, is_closed: false, open_time: '07:30', close_time: '17:00' },
  ],
};

describe('WorkshopScheduleService', () => {
  let service: WorkshopScheduleService;
  const settingsService = {
    getOrCreateSettings: jest.fn(),
  };
  const plannerService = {
    effectiveHours: jest.fn().mockReturnValue({
      isClosed: false,
      openTime: '07:30',
      closeTime: '17:00',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopScheduleService,
        workshopPrismaProvider,
        workshopTenantProvider,
        { provide: WorkshopSettingsService, useValue: settingsService },
        { provide: WorkshopPlannerService, useValue: plannerService },
      ],
    }).compile();

    service = module.get(WorkshopScheduleService);
    resetWorkshopMocks();
    mockTenantContext.getTenantId.mockResolvedValue(TENANT_ID);
    settingsService.getOrCreateSettings.mockResolvedValue(settings);
    mockPrisma.bay.findFirst.mockResolvedValue({
      id: 'bay-1',
      is_active: true,
    });
    mockPrisma.bay.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.findMany.mockResolvedValue([]);
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([]);
  });

  it('rejects SCHEDULED create without bay and window', async () => {
    await expect(
      service.assertCanBook({
        status: WorkshopOrderStatus.SCHEDULED,
        vehicleId: 'v-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a free bay window', async () => {
    await expect(
      service.assertCanBook({
        status: WorkshopOrderStatus.SCHEDULED,
        vehicleId: 'v-1',
        bayId: 'bay-1',
        scheduledStartAt: '2026-08-21T08:00:00.000Z',
        scheduledEndAt: '2026-08-21T09:00:00.000Z',
      }),
    ).resolves.toEqual({
      bayId: 'bay-1',
      mechanicId: null,
      start: new Date('2026-08-21T08:00:00.000Z'),
      end: new Date('2026-08-21T09:00:00.000Z'),
    });
  });

  it('locks the bay row before reading occupancy', async () => {
    await service.assertCanBook({
      status: WorkshopOrderStatus.SCHEDULED,
      vehicleId: 'v-1',
      bayId: 'bay-1',
      scheduledStartAt: '2026-08-21T08:00:00.000Z',
      scheduledEndAt: '2026-08-21T09:00:00.000Z',
    });

    expect(mockPrisma.bay.updateMany).toHaveBeenCalledWith({
      where: { id: 'bay-1', tenant_id: TENANT_ID, is_active: true },
      data: { updatedAt: expect.any(Date) },
    });
    expect(
      mockPrisma.bay.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(mockPrisma.workshopOrder.findMany.mock.invocationCallOrder[0]);
  });

  it('throws 409 when the same bay already has an overlapping booking', async () => {
    mockPrisma.workshopOrder.findMany.mockResolvedValue([
      {
        id: 'wo-existing',
        order_number: 'WO-2026-0007',
        status: WorkshopOrderStatus.SCHEDULED,
        scheduled_start_at: new Date('2026-08-21T08:30:00.000Z'),
        scheduled_end_at: new Date('2026-08-21T09:30:00.000Z'),
      },
    ]);

    await expect(
      service.assertCanBook({
        status: WorkshopOrderStatus.SCHEDULED,
        vehicleId: 'v-1',
        bayId: 'bay-1',
        scheduledStartAt: '2026-08-21T08:00:00.000Z',
        scheduledEndAt: '2026-08-21T09:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an inactive mechanic', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(null);

    await expect(
      service.assertCanBook({
        status: WorkshopOrderStatus.SCHEDULED,
        vehicleId: 'v-1',
        bayId: 'bay-1',
        mechanicId: 'mech-1',
        scheduledStartAt: '2026-08-21T08:00:00.000Z',
        scheduledEndAt: '2026-08-21T09:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an active mechanic', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 'mech-1',
      role: EmployeeRole.MECHANIC,
      is_active: true,
    });

    const booked = await service.assertCanBook({
      status: WorkshopOrderStatus.SCHEDULED,
      vehicleId: 'v-1',
      bayId: 'bay-1',
      mechanicId: 'mech-1',
      scheduledStartAt: '2026-08-21T08:00:00.000Z',
      scheduledEndAt: '2026-08-21T09:00:00.000Z',
    });

    expect(booked.mechanicId).toBe('mech-1');
  });
});
