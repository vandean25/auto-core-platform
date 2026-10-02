import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  Prisma,
  VehicleInventoryRole,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
  VehicleStockStatus,
  VehicleTaxScheme,
} from '@prisma/client';
import { VEHICLE_IDENTITY_RESET } from '../vehicle/vehicle-identity.util.js';
import {
  ACTIVE_STOCK_STATUSES,
  assertCanDeletePurchase,
  assertDraftUpdatePreconditions,
  assertSeller,
  assertValidCreateLocation,
  buildLotStockPayload,
  buildVehiclePurchaseCreateData,
  formatPurchaseNumber,
  linkPurchaseToVehicleHelper,
  prepareDraftUpdateData,
  resolveSellerValidationTarget,
  updateExistingStockVehicleHelper,
  validateRetargetingLot,
} from './vehicle-purchase.helpers.js';

describe('vehicle-purchase.helpers', () => {
  describe('ACTIVE_STOCK_STATUSES', () => {
    it('contains all active stock statuses', () => {
      expect(ACTIVE_STOCK_STATUSES).toEqual([
        VehicleStockStatus.ON_ORDER,
        VehicleStockStatus.IN_STOCK,
        VehicleStockStatus.RESERVED,
        VehicleStockStatus.IN_PREP,
      ]);
    });
  });

  describe('prepareDraftUpdateData', () => {
    it('maps all defined fields correctly and converts purchase_price to Decimal', () => {
      const data = prepareDraftUpdateData({
        seller_type: VehiclePurchaseSellerType.VENDOR,
        vendor_id: 'vend-1',
        vin: '  1g1jc5444r7252367  ',
        make: 'Chevrolet',
        model: 'Cavalier',
        year: 1994,
        purchase_price: 1500,
      });

      expect(data.seller_type).toBe(VehiclePurchaseSellerType.VENDOR);
      expect(data.vendor_id).toBe('vend-1');
      expect(data.vin).toBe('1G1JC5444R7252367');
      expect(data.make).toBe('Chevrolet');
      expect(data.model).toBe('Cavalier');
      expect(data.year).toBe(1994);
      expect(data.purchase_price).toEqual(new Prisma.Decimal(1500));
    });

    it('sets vendor_id to null when seller_type is CUSTOMER and vendor_id not provided', () => {
      const data = prepareDraftUpdateData({
        seller_type: VehiclePurchaseSellerType.CUSTOMER,
        customer_id: 'cust-1',
      });

      expect(data.vendor_id).toBeNull();
      expect(data.customer_id).toBe('cust-1');
    });

    it('sets customer_id to null when seller_type is VENDOR and customer_id not provided', () => {
      const data = prepareDraftUpdateData({
        seller_type: VehiclePurchaseSellerType.VENDOR,
        vendor_id: 'vend-1',
      });

      expect(data.customer_id).toBeNull();
      expect(data.vendor_id).toBe('vend-1');
    });

    it('canonicalizes blank VIN to null', () => {
      const data = prepareDraftUpdateData({
        vin: '   ',
      });

      expect(data.vin).toBeNull();
    });

    it('leaves undefined fields as undefined', () => {
      const data = prepareDraftUpdateData({});

      expect(data.seller_type).toBeUndefined();
      expect(data.vendor_id).toBeUndefined();
      expect(data.customer_id).toBeUndefined();
      expect(data.vin).toBeUndefined();
      expect(data.purchase_price).toBeUndefined();
    });
  });

  describe('resolveSellerValidationTarget', () => {
    it('uses existing seller when dto seller is not specified', () => {
      const result = resolveSellerValidationTarget(
        { vendor_id: 'vend-2' },
        {
          seller_type: VehiclePurchaseSellerType.VENDOR,
          vendor_id: 'vend-1',
          customer_id: null,
        },
      );

      expect(result.seller_type).toBe(VehiclePurchaseSellerType.VENDOR);
      expect(result.vendor_id).toBe('vend-2');
      expect(result.customer_id).toBeUndefined();
    });

    it('preserves existing vendor_id if not in dto', () => {
      const result = resolveSellerValidationTarget(
        {},
        {
          seller_type: VehiclePurchaseSellerType.VENDOR,
          vendor_id: 'vend-1',
          customer_id: null,
        },
      );

      expect(result.seller_type).toBe(VehiclePurchaseSellerType.VENDOR);
      expect(result.vendor_id).toBe('vend-1');
    });

    it('uses new seller_type if provided in dto', () => {
      const result = resolveSellerValidationTarget(
        {
          seller_type: VehiclePurchaseSellerType.CUSTOMER,
          customer_id: 'cust-1',
        },
        {
          seller_type: VehiclePurchaseSellerType.VENDOR,
          vendor_id: 'vend-1',
          customer_id: null,
        },
      );

      expect(result.seller_type).toBe(VehiclePurchaseSellerType.CUSTOMER);
      expect(result.customer_id).toBe('cust-1');
    });
  });

  describe('buildLotStockPayload', () => {
    const basePurchase = {
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
      engine_code: '1ZR',
      plate: 'AA-123-BB',
      color: 'Silver',
      mileage: 50000,
      key_number: 'K-99',
      registration_certificate_no: 'RC-1234',
      location_id: 'loc-1',
    };

    it('constructs stock data for new vehicle', () => {
      const stockData = buildLotStockPayload(basePurchase, null);

      expect(stockData).toMatchObject({
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        plate: 'AA-123-BB',
        customer_id: null,
        inventory_role: VehicleInventoryRole.USED,
        stock_status: VehicleStockStatus.IN_STOCK,
        tax_scheme: VehicleTaxScheme.MARGIN,
      });
      expect(stockData).not.toHaveProperty('identity_resolution_generation');
    });

    it('does not reset identity if plate matches existing normalized plate', () => {
      const stockData = buildLotStockPayload(basePurchase, {
        plate: ' aa-123-bb ',
      });

      expect(stockData).not.toHaveProperty('identity_resolution_generation');
      expect(stockData).not.toHaveProperty('identity_resolution_token');
    });

    it('resets identity fields when plate changes on reused vehicle', () => {
      const stockData = buildLotStockPayload(basePurchase, {
        plate: 'OLD-PLATE',
      });

      expect(stockData).toMatchObject({
        ...VEHICLE_IDENTITY_RESET,
        identity_resolution_token: null,
      });
    });
  });

  describe('assertSeller', () => {
    it('passes for valid vendor seller with vendor_id', () => {
      expect(() =>
        assertSeller({
          seller_type: VehiclePurchaseSellerType.VENDOR,
          vendor_id: 'vend-1',
        }),
      ).not.toThrow();
    });

    it('throws BadRequestException for vendor seller missing vendor_id', () => {
      expect(() =>
        assertSeller({
          seller_type: VehiclePurchaseSellerType.VENDOR,
        }),
      ).toThrow(BadRequestException);
    });

    it('passes for valid customer seller with customer_id', () => {
      expect(() =>
        assertSeller({
          seller_type: VehiclePurchaseSellerType.CUSTOMER,
          customer_id: 'cust-1',
        }),
      ).not.toThrow();
    });

    it('throws BadRequestException for customer seller missing customer_id', () => {
      expect(() =>
        assertSeller({
          seller_type: VehiclePurchaseSellerType.CUSTOMER,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('validateRetargetingLot', () => {
    it('passes when location belongs to target site and is a vehicle lot', () => {
      expect(() =>
        validateRetargetingLot(
          { site_id: 'site-target', type: LocationType.vehicle_lot },
          'site-target',
        ),
      ).not.toThrow();
    });

    it('throws UnprocessableEntityException when location is null', () => {
      expect(() => validateRetargetingLot(null, 'site-target')).toThrow(
        UnprocessableEntityException,
      );
    });

    it('throws UnprocessableEntityException when site_id does not match target', () => {
      expect(() =>
        validateRetargetingLot(
          { site_id: 'site-other', type: LocationType.vehicle_lot },
          'site-target',
        ),
      ).toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException when location is not vehicle_lot', () => {
      expect(() =>
        validateRetargetingLot(
          { site_id: 'site-target', type: LocationType.parts_shelf },
          'site-target',
        ),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('assertDraftUpdatePreconditions', () => {
    it('passes when in DRAFT and site matches', () => {
      expect(() =>
        assertDraftUpdatePreconditions(
          { status: VehiclePurchaseStatus.DRAFT, site_id: 'site-1' },
          { expectedSiteId: 'site-1' },
          false,
        ),
      ).not.toThrow();
    });

    it('throws ConflictException when not in DRAFT and not retargeting', () => {
      expect(() =>
        assertDraftUpdatePreconditions(
          { status: VehiclePurchaseStatus.RECEIVED, site_id: 'site-1' },
          {},
          false,
        ),
      ).toThrow(ConflictException);
    });

    it('throws UnprocessableEntityException when retargeting while not in DRAFT', () => {
      expect(() =>
        assertDraftUpdatePreconditions(
          { status: VehiclePurchaseStatus.RECEIVED, site_id: 'site-1' },
          {},
          true,
        ),
      ).toThrow(UnprocessableEntityException);
    });

    it('throws ConflictException when expectedSiteId differs from purchase site_id', () => {
      expect(() =>
        assertDraftUpdatePreconditions(
          { status: VehiclePurchaseStatus.DRAFT, site_id: 'site-1' },
          { expectedSiteId: 'site-2' },
          false,
        ),
      ).toThrow(ConflictException);
    });
  });

  describe('linkPurchaseToVehicleHelper', () => {
    it('throws ConflictException when updateMany affects 0 rows', async () => {
      const tx = {
        vehiclePurchase: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as any;

      await expect(
        linkPurchaseToVehicleHelper({
          tx,
          tenantId: 't1',
          siteId: 's1',
          purchaseId: 'p1',
          vehicleId: 'v1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns linked purchase on success', async () => {
      const tx = {
        vehiclePurchase: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirst: jest.fn().mockResolvedValue({ id: 'p1', vehicle_id: 'v1' }),
        },
      } as any;

      const result = await linkPurchaseToVehicleHelper({
        tx,
        tenantId: 't1',
        siteId: 's1',
        purchaseId: 'p1',
        vehicleId: 'v1',
      });
      expect(result).toEqual({ id: 'p1', vehicle_id: 'v1' });
    });
  });

  describe('updateExistingStockVehicleHelper', () => {
    it('throws ConflictException when updateMany returns count 0', async () => {
      const tx = {
        vehicle: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as any;

      await expect(
        updateExistingStockVehicleHelper({
          tx,
          tenantId: 't1',
          existing: {
            id: 'veh-1',
            plate: 'AA-123',
            identity_resolution_generation: null,
            identity_resolution_token: null,
          },
          purchase: {
            make: 'Toyota',
            model: 'Corolla',
            year: 2020,
            plate: 'AA-123',
          } as any,
          vin: 'VIN123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('buildVehiclePurchaseCreateData', () => {
    it('constructs prisma create input for vendor seller', () => {
      const data = buildVehiclePurchaseCreateData('t1', 's1', 'VP-2026-0001', {
        seller_type: VehiclePurchaseSellerType.VENDOR,
        vendor_id: 'v1',
        vin: '12345678901234567',
        make: 'VW',
        model: 'Golf',
        year: 2021,
        purchase_price: '15000',
      });
      expect(data.tenant_id).toBe('t1');
      expect(data.site_id).toBe('s1');
      expect(data.purchase_number).toBe('VP-2026-0001');
      expect(data.vendor_id).toBe('v1');
      expect(data.customer_id).toBeNull();
      expect(data.make).toBe('VW');
    });

    it('constructs prisma create input for customer seller', () => {
      const data = buildVehiclePurchaseCreateData('t1', 's1', 'VP-2026-0002', {
        seller_type: VehiclePurchaseSellerType.CUSTOMER,
        customer_id: 'c1',
        vin: '12345678901234567',
        make: 'BMW',
        model: 'X5',
        year: 2022,
        purchase_price: '25000',
      });
      expect(data.vendor_id).toBeNull();
      expect(data.customer_id).toBe('c1');
    });
  });

  describe('assertValidCreateLocation', () => {
    it('passes when location is vehicle_lot on the active site', () => {
      expect(() =>
        assertValidCreateLocation(
          { site_id: 's1', type: LocationType.vehicle_lot },
          's1',
        ),
      ).not.toThrow();
    });

    it('throws UnprocessableEntityException when location is null or mismatch', () => {
      expect(() => assertValidCreateLocation(null, 's1')).toThrow(
        UnprocessableEntityException,
      );
      expect(() =>
        assertValidCreateLocation(
          { site_id: 's2', type: LocationType.vehicle_lot },
          's1',
        ),
      ).toThrow(UnprocessableEntityException);
      expect(() =>
        assertValidCreateLocation(
          { site_id: 's1', type: LocationType.parts_shelf },
          's1',
        ),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('assertCanDeletePurchase', () => {
    it('passes for draft purchase with 0 ledger entries', () => {
      expect(() =>
        assertCanDeletePurchase(
          { status: VehiclePurchaseStatus.DRAFT },
          0,
          'p1',
        ),
      ).not.toThrow();
    });

    it('throws NotFoundException when purchase is null', () => {
      expect(() => assertCanDeletePurchase(null, 0, 'p1')).toThrow(
        'not found',
      );
    });

    it('throws ConflictException when purchase is not DRAFT', () => {
      expect(() =>
        assertCanDeletePurchase(
          { status: VehiclePurchaseStatus.RECEIVED },
          0,
          'p1',
        ),
      ).toThrow('Only DRAFT purchases can be deleted');
    });

    it('throws ConflictException when ledger entries exist', () => {
      expect(() =>
        assertCanDeletePurchase(
          { status: VehiclePurchaseStatus.DRAFT },
          2,
          'p1',
        ),
      ).toThrow('ledger entries exist');
    });
  });

  describe('formatPurchaseNumber', () => {
    it('formats sequential number padded with zeros', () => {
      expect(formatPurchaseNumber('VP-2026-', 1)).toBe('VP-2026-0000');
      expect(formatPurchaseNumber('VP-2026-', 2)).toBe('VP-2026-0001');
    });
  });
});

