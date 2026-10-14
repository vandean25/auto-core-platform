import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HrWorkScheduleWriter } from './hr-work-schedule-writer.service.js';
import { createSchedule, createWeek } from './hr-work-schedule.spec.support.js';

function createTransactionClient() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'site-1', is_active: true }]),
    employeeWorkSchedule: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockResolvedValue(createSchedule('schedule-2', '2026-09-01')),
      update: jest.fn().mockResolvedValue(createSchedule()),
    },
    employeeWorkScheduleDay: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    effectiveFrom: '2026-09-01',
    siteId: 'site-1',
    days: createWeek(),
    ...overrides,
  } as never;
}

describe('HrWorkScheduleWriter', () => {
  let transaction: ReturnType<typeof createTransactionClient>;
  let prisma: {
    employee: { findFirst: jest.Mock };
    employeeWorkSchedule: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let identityService: { assertOwnerAdmin: jest.Mock };
  let tenantContext: { getTenantId: jest.Mock };
  let siteContext: { listAuthorizedSiteIds: jest.Mock };
  let writer: HrWorkScheduleWriter;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction = createTransactionClient();
    prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'employee-1' }),
      },
      employeeWorkSchedule: {
        findFirst: jest.fn().mockResolvedValue(createSchedule()),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    };
    identityService = { assertOwnerAdmin: jest.fn() };
    tenantContext = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
    siteContext = {
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    };
    writer = new HrWorkScheduleWriter(
      prisma as never,
      identityService as never,
      tenantContext as never,
      siteContext as never,
    );
  });

  describe('createForEmployee', () => {
    it('checks owner or admin before validating or reading anything', async () => {
      identityService.assertOwnerAdmin.mockImplementationOnce(() => {
        throw new ForbiddenException('owner or admin required');
      });

      await expect(
        writer.createForEmployee('employee-1', createPayload()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an invalid week before touching the database', async () => {
      await expect(
        writer.createForEmployee(
          'employee-1',
          createPayload({ days: createWeek().slice(1) }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the version inside a transaction that locks the site', async () => {
      const response = await writer.createForEmployee(
        'employee-1',
        createPayload(),
      );

      expect(transaction.$queryRaw).toHaveBeenCalled();
      const data =
        transaction.employeeWorkSchedule.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          tenant_id: 'tenant-1',
          employee_id: 'employee-1',
          site_id: 'site-1',
          effective_from: new Date('2026-09-01T00:00:00.000Z'),
        }),
      );
      expect(data.days.create).toHaveLength(7);
      expect(response.id).toBe('schedule-2');
    });

    it('rejects an effectiveFrom that is not later than the latest version', async () => {
      transaction.employeeWorkSchedule.findFirst.mockResolvedValue({
        effective_from: new Date('2026-09-01T00:00:00.000Z'),
      });

      await expect(
        writer.createForEmployee('employee-1', createPayload()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(transaction.employeeWorkSchedule.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate effectiveFrom (P2002) to Conflict', async () => {
      transaction.employeeWorkSchedule.create.mockRejectedValue({
        code: 'P2002',
      });

      await expect(
        writer.createForEmployee('employee-1', createPayload()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes other write errors through unchanged', async () => {
      const failure = new Error('connection lost');
      transaction.employeeWorkSchedule.create.mockRejectedValue(failure);

      await expect(
        writer.createForEmployee('employee-1', createPayload()),
      ).rejects.toBe(failure);
    });
  });

  describe('updateForEmployee', () => {
    it('replaces the weekday rows of the stored version', async () => {
      transaction.employeeWorkSchedule.findFirst.mockResolvedValue(
        createSchedule(),
      );

      const response = await writer.updateForEmployee(
        'employee-1',
        'schedule-1',
        createPayload(),
      );

      expect(transaction.employeeWorkSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id_id: { tenant_id: 'tenant-1', id: 'schedule-1' } },
          data: expect.objectContaining({ site_id: 'site-1' }),
        }),
      );
      expect(
        transaction.employeeWorkScheduleDay.deleteMany,
      ).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1', schedule_id: 'schedule-1' },
      });
      expect(
        transaction.employeeWorkScheduleDay.createMany,
      ).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            tenant_id: 'tenant-1',
            schedule_id: 'schedule-1',
            weekday: 1,
          }),
        ]),
      });
      expect(response.id).toBe('schedule-1');
    });

    it('keeps the stored site when the correction does not name one', async () => {
      transaction.employeeWorkSchedule.findFirst.mockResolvedValue(
        createSchedule(),
      );

      await writer.updateForEmployee('employee-1', 'schedule-1', {
        days: createWeek(),
      });

      const data =
        transaction.employeeWorkSchedule.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('site_id');
    });

    it('reports a missing schedule as NotFound before opening a transaction', async () => {
      prisma.employeeWorkSchedule.findFirst.mockResolvedValue(null);

      await expect(
        writer.updateForEmployee('employee-1', 'schedule-9', createPayload()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a correction to a site outside the caller authorized sites', async () => {
      await expect(
        writer.updateForEmployee(
          'employee-1',
          'schedule-1',
          createPayload({ siteId: 'site-2' }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps a schedule row that disappears mid-update (P2025) to NotFound', async () => {
      transaction.employeeWorkSchedule.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Record to update not found.',
          {
            code: 'P2025',
            clientVersion: 'test',
          },
        ),
      );

      await expect(
        writer.updateForEmployee('employee-1', 'schedule-1', createPayload()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        transaction.employeeWorkScheduleDay.deleteMany,
      ).not.toHaveBeenCalled();
    });
  });
});
