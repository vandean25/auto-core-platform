import { BadRequestException } from '@nestjs/common';
import {
  VehicleInventoryRole,
  VehicleStockStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import {
  buildCustomerSearchWhere,
  buildVehicleSearchWhere,
  buildWorkshopOrderFindAllWhere,
  buildWorkshopOrderOrderBy,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pickClosestScheduledOrder,
  resolveFindAllPagination,
  validateCreateOrderInput,
  validateStockPrepVehicle,
} from './workshop-intake.helpers';

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
    it('returns tenant_id only when search is omitted', () => {
      const where = buildWorkshopOrderFindAllWhere('tenant-1');
      expect(where).toEqual({ tenant_id: 'tenant-1' });
    });

    it('returns tenant_id with search filters across order, customer, and vehicle', () => {
      const where = buildWorkshopOrderFindAllWhere('tenant-1', 'BMW');
      expect(where).toEqual(
        expect.objectContaining({
          tenant_id: 'tenant-1',
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
});
