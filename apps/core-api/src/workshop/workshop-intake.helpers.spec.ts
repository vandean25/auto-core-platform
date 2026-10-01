import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  VehicleInventoryRole,
  VehicleStockStatus,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
import {
  assertNoLiveOrderForVehicle,
  assertOrderRetargetingPrerequisites,
  buildCustomerSearchWhere,
  buildVehicleSearchWhere,
  buildWorkshopOrderFindAllWhere,
  buildWorkshopOrderOrderBy,
  buildWorkshopOrderRetargetData,
  buildWorkshopOrderScheduleUpdateData,
  computeCustomerId,
  createNewIntakeVehicle,
  DEFAULT_PAGE_SIZE,
  executeBasicOrderUpdate,
  executeCreateOrder,
  executeFindAllWorkshopOrders,
  executeFindOneWorkshopOrder,
  executeRegisterIntake,
  executeSearchWorkshop,
  insertWorkshopOrder,
  MAX_PAGE_SIZE,
  pickClosestScheduledOrder,
  reserveStockPrepVehicle,
  resolveFindAllPagination,
  resolveIntakeVehicle,
  tryPromoteScheduledOrder,
  updateExistingIntakeVehicle,
  validateCreateOrderInput,
  validateCreatePrerequisites,
  validateStockPrepVehicle,
} from './workshop-intake.helpers.js';

describe('workshop-intake.helpers', () => {
  describe('resolveFindAllPagination', () => {
    it('uses defaults when page and pageSize are undefined', () => {
      const result = resolveFindAllPagination();
      expect(result).toEqual({
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        skip: 0,
      });
    });

    it('clamps pageSize to MAX_PAGE_SIZE', () => {
      const result = resolveFindAllPagination(2, 500);
      expect(result).toEqual({
        page: 2,
        pageSize: MAX_PAGE_SIZE,
        skip: 100,
      });
    });

    it('handles custom page and pageSize within limits', () => {
      const result = resolveFindAllPagination(3, 10);
      expect(result).toEqual({
        page: 3,
        pageSize: 10,
        skip: 20,
      });
    });

    it('defaults invalid page to 1', () => {
      const result = resolveFindAllPagination(-5, 10);
      expect(result.page).toBe(1);
      expect(result.skip).toBe(0);
    });
  });

  describe('buildWorkshopOrderFindAllWhere', () => {
    it('returns tenant and site scope when search is omitted', () => {
      const where = buildWorkshopOrderFindAllWhere('tenant-1', 'site-1');
      expect(where).toEqual({ tenant_id: 'tenant-1', site_id: 'site-1' });
    });

    it('returns tenant and site scope with search filters across order, customer, and vehicle', () => {
      const where = buildWorkshopOrderFindAllWhere('tenant-1', 'site-1', 'BMW');
      expect(where).toEqual(
        expect.objectContaining({
          tenant_id: 'tenant-1',
          site_id: 'site-1',
          OR: expect.arrayContaining([
            expect.objectContaining({
              order_number: { contains: 'BMW', mode: 'insensitive' },
            }),
            expect.objectContaining({
              id: { contains: 'BMW', mode: 'insensitive' },
            }),
            expect.objectContaining({
              customer: expect.any(Object),
            }),
            expect.objectContaining({
              vehicle: expect.any(Object),
            }),
          ]),
        }),
      );
    });
  });

  describe('buildWorkshopOrderOrderBy', () => {
    it('defaults to createdAt desc', () => {
      expect(buildWorkshopOrderOrderBy()).toEqual({ createdAt: 'desc' });
    });

    it('supports status sort', () => {
      expect(buildWorkshopOrderOrderBy('status', 'asc')).toEqual({
        status: 'asc',
      });
    });

    it('supports orderNo and order_number sort', () => {
      expect(buildWorkshopOrderOrderBy('orderNo', 'asc')).toEqual({
        order_number: 'asc',
      });
      expect(buildWorkshopOrderOrderBy('order_number', 'desc')).toEqual({
        order_number: 'desc',
      });
    });

    it('supports id sort', () => {
      expect(buildWorkshopOrderOrderBy('id', 'asc')).toEqual({ id: 'asc' });
    });

    it('supports customer sort', () => {
      expect(buildWorkshopOrderOrderBy('customer', 'desc')).toEqual({
        customer: { last_name: 'desc' },
      });
    });

    it('supports vehicle sort', () => {
      expect(buildWorkshopOrderOrderBy('vehicle', 'asc')).toEqual({
        vehicle: { make: 'asc' },
      });
    });
  });

  describe('buildVehicleSearchWhere', () => {
    it('builds tenant-isolated vehicle search filter', () => {
      const where = buildVehicleSearchWhere('tenant-1', 'ABC');
      expect(where).toEqual({
        tenant_id: 'tenant-1',
        OR: [
          { vin: { contains: 'ABC', mode: 'insensitive' } },
          { plate: { contains: 'ABC', mode: 'insensitive' } },
          { make: { contains: 'ABC', mode: 'insensitive' } },
          { model: { contains: 'ABC', mode: 'insensitive' } },
        ],
      });
    });
  });

  describe('buildCustomerSearchWhere', () => {
    it('builds tenant-isolated customer filter for non-uuid', () => {
      const where = buildCustomerSearchWhere('tenant-1', 'Doe');
      expect(where).toEqual({
        tenant_id: 'tenant-1',
        OR: [
          { first_name: { contains: 'Doe', mode: 'insensitive' } },
          { last_name: { contains: 'Doe', mode: 'insensitive' } },
          { company_name: { contains: 'Doe', mode: 'insensitive' } },
          { phone: { contains: 'Doe', mode: 'insensitive' } },
        ],
      });
    });

    it('includes id match if query is a uuid', () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const where = buildCustomerSearchWhere('tenant-1', uuid);
      expect(where.OR).toEqual(
        expect.arrayContaining([{ id: { equals: uuid } }]),
      );
    });
  });

  describe('pickClosestScheduledOrder', () => {
    it('picks the order scheduled closest to current time', () => {
      const now = Date.now();
      const order1 = {
        id: '1',
        scheduled_start_at: new Date(now + 1000 * 60 * 60),
      };
      const order2 = {
        id: '2',
        scheduled_start_at: new Date(now + 1000 * 60 * 10),
      };
      const order3 = {
        id: '3',
        scheduled_start_at: new Date(now - 1000 * 60 * 5),
      };

      const closest = pickClosestScheduledOrder([order1, order2, order3]);
      expect(closest.id).toBe('3');
    });

    it('handles orders with null scheduled_start_at', () => {
      const now = Date.now();
      const order1 = { id: '1', scheduled_start_at: null };
      const order2 = {
        id: '2',
        scheduled_start_at: new Date(now + 1000 * 60 * 10),
      };

      const closest = pickClosestScheduledOrder([order1, order2]);
      expect(closest.id).toBe('2');
    });
  });

  describe('validateCreateOrderInput', () => {
    it('throws BadRequestException if not scheduled and odometer or fuelLevel is missing', () => {
      expect(() =>
        validateCreateOrderInput(
          {
            vehicleId: 'v-1',
            status: WorkshopOrderStatus.INTAKE,
            fuelLevel: 50,
          },
          false,
        ),
      ).toThrow(BadRequestException);

      expect(() =>
        validateCreateOrderInput(
          {
            vehicleId: 'v-1',
            status: WorkshopOrderStatus.INTAKE,
            odometer: 1000,
          },
          false,
        ),
      ).toThrow(BadRequestException);
    });

    it('passes if scheduled even if odometer/fuelLevel are omitted', () => {
      expect(() =>
        validateCreateOrderInput(
          {
            vehicleId: 'v-1',
            status: WorkshopOrderStatus.SCHEDULED,
          },
          true,
        ),
      ).not.toThrow();
    });

    it('passes if not scheduled but odometer and fuelLevel are provided', () => {
      expect(() =>
        validateCreateOrderInput(
          {
            vehicleId: 'v-1',
            status: WorkshopOrderStatus.INTAKE,
            odometer: 12000,
            fuelLevel: 80,
          },
          false,
        ),
      ).not.toThrow();
    });
  });

  describe('validateStockPrepVehicle', () => {
    it('throws if inventory_role is not USED', () => {
      expect(() =>
        validateStockPrepVehicle({
          inventory_role: VehicleInventoryRole.CUSTOMER,
          stock_status: VehicleStockStatus.IN_STOCK,
        }),
      ).toThrow(BadRequestException);
    });

    it('throws if stock_status is not IN_STOCK or RESERVED', () => {
      expect(() =>
        validateStockPrepVehicle({
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.SOLD,
        }),
      ).toThrow(BadRequestException);
    });

    it('passes if USED and IN_STOCK', () => {
      expect(() =>
        validateStockPrepVehicle({
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.IN_STOCK,
        }),
      ).not.toThrow();
    });

    it('passes if USED and RESERVED', () => {
      expect(() =>
        validateStockPrepVehicle({
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.RESERVED,
        }),
      ).not.toThrow();
    });
  });

  describe('buildWorkshopOrderRetargetData', () => {
    it('retains existing values when dto fields are undefined', () => {
      const existing = {
        reported_issue: 'Clutch slip',
        notes: 'Priority',
        mechanic_id: 'm-1',
        scheduled_start_at: new Date('2026-10-01T08:00:00Z'),
        scheduled_end_at: new Date('2026-10-01T10:00:00Z'),
      };
      const data = buildWorkshopOrderRetargetData(existing, {
        siteId: 'site-2',
        bayId: 'bay-2',
      });
      expect(data).toEqual({
        site_id: 'site-2',
        bay_id: 'bay-2',
        staging_location_id: null,
        reported_issue: 'Clutch slip',
        notes: 'Priority',
        mechanic_id: 'm-1',
        scheduled_start_at: existing.scheduled_start_at,
        scheduled_end_at: existing.scheduled_end_at,
      });
    });

    it('applies updated values from dto when provided', () => {
      const existing = {
        reported_issue: 'Old issue',
        notes: 'Old notes',
        mechanic_id: 'm-old',
        scheduled_start_at: null,
        scheduled_end_at: null,
      };
      const startStr = '2026-10-02T09:00:00.000Z';
      const endStr = '2026-10-02T11:00:00.000Z';
      const data = buildWorkshopOrderRetargetData(existing, {
        siteId: 'site-2',
        bayId: 'bay-2',
        reportedIssue: 'New issue',
        notes: 'New notes',
        mechanicId: 'm-new',
        scheduledStartAt: startStr,
        scheduledEndAt: endStr,
      });
      expect(data).toEqual({
        site_id: 'site-2',
        bay_id: 'bay-2',
        staging_location_id: null,
        reported_issue: 'New issue',
        notes: 'New notes',
        mechanic_id: 'm-new',
        scheduled_start_at: new Date(startStr),
        scheduled_end_at: new Date(endStr),
      });
    });
  });

  describe('buildWorkshopOrderScheduleUpdateData', () => {
    it('builds schedule update payload combining dto and schedule data', () => {
      const scheduleData = {
        bayId: 'bay-1',
        mechanicId: 'mech-1',
        start: new Date('2026-10-01T09:00:00Z'),
        end: new Date('2026-10-01T11:00:00Z'),
      };
      const data = buildWorkshopOrderScheduleUpdateData(
        { reportedIssue: 'Updated issue', notes: 'Updated notes' },
        scheduleData,
      );
      expect(data).toEqual({
        reported_issue: 'Updated issue',
        notes: 'Updated notes',
        bay_id: 'bay-1',
        mechanic_id: 'mech-1',
        scheduled_start_at: scheduleData.start,
        scheduled_end_at: scheduleData.end,
      });
    });
  });

  describe('assertOrderRetargetingPrerequisites', () => {
    const mockTenantContext = {
      getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'fb-user-1' }),
    } as any;

    it('throws UnprocessableEntityException if order status is not SCHEDULED', async () => {
      const prisma = {
        user: { findUnique: jest.fn() },
        tenantMember: { findFirst: jest.fn() },
        siteMembership: { findFirst: jest.fn() },
        bay: { findFirst: jest.fn() },
      } as any;

      await expect(
        assertOrderRetargetingPrerequisites({
          prisma,
          tenantContext: mockTenantContext,
          tenantId: 'tenant-1',
          existing: { status: WorkshopOrderStatus.INTAKE },
          dto: { siteId: 'site-2', bayId: 'bay-1' },
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException if bayId is missing', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1' }) },
        tenantMember: {
          findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
        },
        siteMembership: {
          findFirst: jest.fn().mockResolvedValue({ id: 'sm-1' }),
        },
        bay: { findFirst: jest.fn() },
      } as any;

      await expect(
        assertOrderRetargetingPrerequisites({
          prisma,
          tenantContext: mockTenantContext,
          tenantId: 'tenant-1',
          existing: { status: WorkshopOrderStatus.SCHEDULED },
          dto: { siteId: 'site-2' },
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException if target bay does not exist on site', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1' }) },
        tenantMember: {
          findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
        },
        siteMembership: {
          findFirst: jest.fn().mockResolvedValue({ id: 'sm-1' }),
        },
        bay: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any;

      await expect(
        assertOrderRetargetingPrerequisites({
          prisma,
          tenantContext: mockTenantContext,
          tenantId: 'tenant-1',
          existing: { status: WorkshopOrderStatus.SCHEDULED },
          dto: { siteId: 'site-2', bayId: 'bay-nonexistent' },
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('passes when order is SCHEDULED and target bay exists', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1' }) },
        tenantMember: {
          findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
        },
        siteMembership: {
          findFirst: jest.fn().mockResolvedValue({ id: 'sm-1' }),
        },
        bay: { findFirst: jest.fn().mockResolvedValue({ id: 'bay-1' }) },
      } as any;

      await expect(
        assertOrderRetargetingPrerequisites({
          prisma,
          tenantContext: mockTenantContext,
          tenantId: 'tenant-1',
          existing: { status: WorkshopOrderStatus.SCHEDULED },
          dto: { siteId: 'site-2', bayId: 'bay-1' },
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('executeCreateOrder and insertWorkshopOrder', () => {
    it('creates an order via insertWorkshopOrder', async () => {
      const tx = {
        workshopOrder: {
          create: jest
            .fn()
            .mockResolvedValue({ id: 'wo-1', order_number: 'WO-1' }),
        },
      } as any;

      const result = await insertWorkshopOrder({
        tx,
        tenantId: 'tenant-1',
        siteId: 'site-1',
        dto: {
          vehicleId: 'v-1',
          customerId: 'c-1',
          reportedIssue: 'Engine noise',
          notes: 'Urgent',
        },
        purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
        booked: null,
        orderNumber: 'WO-1',
      });

      expect(tx.workshopOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 'tenant-1',
            site_id: 'site-1',
            order_number: 'WO-1',
            status: WorkshopOrderStatus.INTAKE,
            customer_id: 'c-1',
            vehicle_id: 'v-1',
          }),
        }),
      );
      expect(result.id).toBe('wo-1');
    });

    it('executes create order context and calls scheduleService when scheduled', async () => {
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ id: 'site-1', is_active: true }]),
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ id: 'wo-scheduled' }),
        },
      } as any;
      const scheduleService = {
        assertCanBook: jest.fn().mockResolvedValue({
          bayId: 'bay-1',
          mechanicId: 'mech-1',
          start: new Date(),
          end: new Date(),
        }),
      };
      const generateOrderNumber = jest.fn().mockResolvedValue('WO-2026-0005');

      const result = await executeCreateOrder({
        tx,
        tenantId: 'tenant-1',
        siteId: 'site-1',
        dto: { vehicleId: 'v-1', customerId: 'c-1' },
        purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
        vehicleId: 'v-1',
        isScheduled: true,
        scheduleService,
        generateOrderNumber,
      });

      expect(scheduleService.assertCanBook).toHaveBeenCalled();
      expect(generateOrderNumber).toHaveBeenCalledWith(tx);
      expect(result.id).toBe('wo-scheduled');
    });

    it('promotes scheduled order if not scheduled and scheduled order exists', async () => {
      const scheduledDate = new Date();
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ id: 'site-1', is_active: true }]),
        workshopOrder: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'target-1', scheduled_start_at: scheduledDate },
            ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirst: jest
            .fn()
            .mockResolvedValue({
              id: 'target-1',
              status: WorkshopOrderStatus.INTAKE,
            }),
        },
      } as any;

      const result = await executeCreateOrder({
        tx,
        tenantId: 'tenant-1',
        siteId: 'site-1',
        dto: { vehicleId: 'v-1', customerId: 'c-1' },
        purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
        vehicleId: 'v-1',
        isScheduled: false,
        scheduleService: { assertCanBook: jest.fn() },
        generateOrderNumber: jest.fn(),
      });

      expect(result.id).toBe('target-1');
    });

    it('throws ConflictException if vehicle already has active order', async () => {
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ id: 'site-1', is_active: true }]),
        workshopOrder: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'live-1', order_number: 'WO-ACTIVE' }),
        },
      } as any;

      await expect(
        executeCreateOrder({
          tx,
          tenantId: 'tenant-1',
          siteId: 'site-1',
          dto: { vehicleId: 'v-1' },
          purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
          vehicleId: 'v-1',
          isScheduled: false,
          scheduleService: { assertCanBook: jest.fn() },
          generateOrderNumber: jest.fn(),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reserveStockPrepVehicle', () => {
    it('updates stock status to IN_PREP when in stock', async () => {
      const tx = {
        vehicle: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      await expect(
        reserveStockPrepVehicle(tx, 'tenant-1', 'v-1'),
      ).resolves.not.toThrow();
      expect(tx.vehicle.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'v-1',
          tenant_id: 'tenant-1',
          stock_status: {
            in: [VehicleStockStatus.IN_STOCK, VehicleStockStatus.RESERVED],
          },
        },
        data: { stock_status: VehicleStockStatus.IN_PREP },
      });
    });

    it('throws ConflictException when vehicle cannot be updated', async () => {
      const tx = {
        vehicle: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as any;

      await expect(
        reserveStockPrepVehicle(tx, 'tenant-1', 'v-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('validateCreatePrerequisites', () => {
    it('throws NotFoundException when vehicle does not exist', async () => {
      const prisma = {
        vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any;

      await expect(
        validateCreatePrerequisites(
          prisma,
          'tenant-1',
          { vehicleId: 'v-missing' },
          WorkshopOrderPurpose.CUSTOMER_REPAIR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when CUSTOMER_REPAIR has no customerId', async () => {
      const prisma = {
        vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }) },
      } as any;

      await expect(
        validateCreatePrerequisites(
          prisma,
          'tenant-1',
          { vehicleId: 'v-1' },
          WorkshopOrderPurpose.CUSTOMER_REPAIR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when CUSTOMER_REPAIR customer does not exist', async () => {
      const prisma = {
        vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }) },
        customer: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any;

      await expect(
        validateCreatePrerequisites(
          prisma,
          'tenant-1',
          { vehicleId: 'v-1', customerId: 'c-missing' },
          WorkshopOrderPurpose.CUSTOMER_REPAIR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns vehicle when customer is valid', async () => {
      const prisma = {
        vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }) },
        customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }) },
      } as any;

      const result = await validateCreatePrerequisites(
        prisma,
        'tenant-1',
        { vehicleId: 'v-1', customerId: 'c-1' },
        WorkshopOrderPurpose.CUSTOMER_REPAIR,
      );
      expect(result.id).toBe('v-1');
    });
  });

  describe('computeCustomerId', () => {
    it('returns customerId when customer exists', async () => {
      const prisma = {
        customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }) },
      } as any;

      const id = await computeCustomerId(prisma, 'tenant-1', {
        customerId: 'c-1',
      });
      expect(id).toBe('c-1');
    });

    it('throws NotFoundException when customerId does not exist', async () => {
      const prisma = {
        customer: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any;

      await expect(
        computeCustomerId(prisma, 'tenant-1', { customerId: 'c-missing' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns existing customer id when email matches', async () => {
      const prisma = {
        customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c-email' }) },
      } as any;

      const id = await computeCustomerId(prisma, 'tenant-1', {
        email: 'john@example.com',
      });
      expect(id).toBe('c-email');
    });

    it('creates private customer when not found', async () => {
      const prisma = {
        customer: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'c-new' }),
        },
      } as any;

      const id = await computeCustomerId(prisma, 'tenant-1', {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      expect(id).toBe('c-new');
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          first_name: 'Jane',
          last_name: 'Doe',
          type: 'PRIVATE',
        }),
      });
    });
  });

  describe('executeBasicOrderUpdate', () => {
    it('updates reported_issue and notes', async () => {
      const prisma = {
        workshopOrder: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirstOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'wo-1', reported_issue: 'Fixed' }),
        },
      } as any;

      const result = await executeBasicOrderUpdate({
        prisma,
        tenantId: 'tenant-1',
        siteId: 'site-1',
        id: 'wo-1',
        dto: { reportedIssue: 'Fixed', notes: 'Done' },
      });
      expect(result.id).toBe('wo-1');
    });

    it('throws NotFoundException when order not found', async () => {
      const prisma = {
        workshopOrder: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as any;

      await expect(
        executeBasicOrderUpdate({
          prisma,
          tenantId: 'tenant-1',
          siteId: 'site-1',
          id: 'wo-missing',
          dto: {},
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateExistingIntakeVehicle and createNewIntakeVehicle', () => {
    it('updates vehicle plate and customer_id', async () => {
      const tx = {
        vehicle: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirst: jest.fn().mockResolvedValue({
            id: 'v-1',
            plate: 'NEW-PLATE',
            customer_id: 'c-1',
            customer: { id: 'c-1' },
          }),
        },
      } as any;

      const result = await updateExistingIntakeVehicle({
        tx,
        tenantId: 'tenant-1',
        existingVehicle: {
          id: 'v-1',
          plate: 'OLD-PLATE',
          identity_resolution_generation: null,
          identity_resolution_token: null,
        },
        dto: { plate: 'NEW-PLATE' },
        customerId: 'c-1',
        vin: 'VIN123',
      });

      expect(tx.vehicle.updateMany).toHaveBeenCalled();
      expect(result.id).toBe('v-1');
    });

    it('throws ConflictException if concurrent update happened', async () => {
      const tx = {
        vehicle: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as any;

      await expect(
        updateExistingIntakeVehicle({
          tx,
          tenantId: 'tenant-1',
          existingVehicle: {
            id: 'v-1',
            plate: 'OLD-PLATE',
            identity_resolution_generation: null,
            identity_resolution_token: null,
          },
          dto: { plate: 'NEW-PLATE' },
          customerId: 'c-1',
          vin: 'VIN123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates new vehicle with stripped identity state', async () => {
      const tx = {
        vehicle: {
          create: jest.fn().mockResolvedValue({
            id: 'v-new',
            plate: 'ABC-123',
            customer: { id: 'c-1' },
          }),
        },
      } as any;

      const result = await createNewIntakeVehicle({
        tx,
        tenantId: 'tenant-1',
        dto: { plate: 'ABC-123', make: 'Audi', model: 'A4', year: 2020 },
        customerId: 'c-1',
        vin: 'VIN999',
      });

      expect(result.id).toBe('v-new');
    });

    it('resolves existing vehicle when found', async () => {
      const tx = {
        vehicle: {
          findFirst: jest.fn().mockResolvedValueOnce({
            id: 'v-exist',
            plate: 'OLD',
            identity_resolution_generation: null,
            identity_resolution_token: null,
          }).mockResolvedValueOnce({
            id: 'v-exist',
            plate: 'NEW',
            customer: { id: 'c-1' },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      const result = await resolveIntakeVehicle(
        tx,
        'tenant-1',
        { plate: 'NEW', vin: 'VIN123' },
        'c-1',
      );
      expect(result.id).toBe('v-exist');
    });

    it('executes register intake workflow', async () => {
      const prisma = {
        customer: {
          findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }),
        },
        $transaction: jest.fn().mockImplementation((cb) =>
          cb({
            vehicle: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({ id: 'v-registered' }),
            },
          }),
        ),
      } as any;

      const result = await executeRegisterIntake(prisma, 'tenant-1', {
        customerId: 'c-1',
        plate: 'NEW-123',
      });
      expect(result.id).toBe('v-registered');
    });
  });

  describe('executeFindAllWorkshopOrders and executeFindOneWorkshopOrder', () => {
    it('executes findAll with pagination and normalization', async () => {
      const prisma = {
        workshopOrder: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'wo-1', order_number: 'WO-1', tasks: [] },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
      } as any;

      const result = await executeFindAllWorkshopOrders(
        prisma,
        'tenant-1',
        'site-1',
        { page: 1, pageSize: 10 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('executes findOne returning normalized order', async () => {
      const prisma = {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'wo-1',
            order_number: 'WO-1',
            tasks: [],
          }),
        },
      } as any;

      const result = await executeFindOneWorkshopOrder(
        prisma,
        'tenant-1',
        'site-1',
        'wo-1',
      );

      expect(result.id).toBe('wo-1');
    });

    it('throws NotFoundException when order not found in findOne', async () => {
      const prisma = {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      await expect(
        executeFindOneWorkshopOrder(prisma, 'tenant-1', 'site-1', 'wo-missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('executeSearchWorkshop', () => {
    it('searches vehicles and customers and returns paginated result', async () => {
      const prisma = {
        vehicle: {
          findMany: jest.fn().mockResolvedValue([{ id: 'v-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        customer: {
          findMany: jest.fn().mockResolvedValue([{ id: 'c-1', vehicles: [] }]),
          count: jest.fn().mockResolvedValue(1),
        },
      } as any;

      const result = await executeSearchWorkshop(prisma, 'tenant-1', 'test');
      expect(result.data.vehicles).toHaveLength(1);
      expect(result.data.customers).toHaveLength(1);
      expect(result.meta.total).toBe(2);
    });
  });
});
