import {
  Prisma,
  VehicleInventoryRole,
  VehiclePurchaseSellerType,
  VehicleStockStatus,
  VehicleTaxScheme,
} from '@prisma/client';
import { VEHICLE_IDENTITY_RESET } from '../vehicle/vehicle-identity.util';
import {
  ACTIVE_STOCK_STATUSES,
  buildLotStockPayload,
  prepareDraftUpdateData,
  resolveSellerValidationTarget,
} from './vehicle-purchase.helpers';

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
});
