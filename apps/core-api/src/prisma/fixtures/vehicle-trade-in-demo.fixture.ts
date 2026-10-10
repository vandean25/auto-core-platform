import {
  CustomerType,
  VehicleAcquisitionKind,
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
  VehicleSaleStatus,
  VehicleStockStatus,
  VehicleTaxScheme,
  Prisma,
} from '@prisma/client';
import type { SeedPrismaClient, TenantFoundationContext } from './types.js';

/** Generic demo data only: no real customer or dealer names. */
const DEMO_TRADE_IN_BUYER_EMAIL = 'demo-trade-in-buyer@example.test';
const DEMO_TRADE_IN_STOCK_VIN = 'WVWDEM5TK00000001';
const DEMO_TRADE_IN_VIN = 'TRDNB000000000001';
const DEMO_TRADE_IN_SALE_NUMBER = 'AUT443-TRADE-IN-DEMO';

/**
 * One draft vehicle sale with a trade-in, so the sale page shows the netting before finalize.
 * The stock car is bought for 8000 and offered for 12000; the buyer's Skoda is credited 5000.
 */
export async function seedDemoVehicleTradeInExample(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
  showroom: { id: string },
  vendor: { id: string },
): Promise<void> {
  const tenantId = foundation.defaultTenant.id;
  const siteId = foundation.mainSite.id;
  const purchaseDate = new Date('2026-08-01T00:00:00.000Z');
  const stockCost = new Prisma.Decimal(8000);

  const buyer = await prisma.customer.create({
    data: {
      tenant_id: tenantId,
      type: CustomerType.PRIVATE,
      first_name: 'Demo',
      last_name: 'Trade-in Buyer',
      email: DEMO_TRADE_IN_BUYER_EMAIL,
      address_street: 'Demo Trade-in 1',
      address_zip: '1010',
      address_city: 'Vienna',
      address_country: 'AT',
    },
  });

  await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        location_id: showroom.id,
        inventory_role: VehicleInventoryRole.USED,
        stock_status: VehicleStockStatus.IN_STOCK,
        stock_received_at: purchaseDate,
        stock_cost_basis: stockCost,
        tax_scheme: VehicleTaxScheme.MARGIN,
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        vin: DEMO_TRADE_IN_STOCK_VIN,
        purchases: {
          create: {
            tenant_id: tenantId,
            site_id: siteId,
            purchase_number: 'AUT443-TRADE-IN-DEMO-STOCK',
            status: VehiclePurchaseStatus.RECEIVED,
            seller_type: VehiclePurchaseSellerType.VENDOR,
            vendor_id: vendor.id,
            make: 'Volkswagen',
            model: 'Golf',
            year: 2018,
            vin: DEMO_TRADE_IN_STOCK_VIN,
            purchase_price: stockCost,
            location_id: showroom.id,
            received_at: purchaseDate,
          },
        },
        ledger_entries: {
          create: {
            tenant_id: tenantId,
            entry_type: VehicleLedgerEntryType.PURCHASE,
            amount: stockCost,
            posting_date: purchaseDate,
          },
        },
      },
    });

    const tradeInPurchase = await tx.vehiclePurchase.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        purchase_number: 'AUT443-TRADE-IN-DEMO-TRADE-IN',
        status: VehiclePurchaseStatus.DRAFT,
        seller_type: VehiclePurchaseSellerType.CUSTOMER,
        customer_id: buyer.id,
        acquisition_kind: VehicleAcquisitionKind.TRADE_IN,
        vin: DEMO_TRADE_IN_VIN,
        make: 'Skoda',
        model: 'Octavia',
        year: 2016,
        mileage: 98000,
        first_registration_date: new Date('2016-03-01T00:00:00.000Z'),
        color: 'Silver',
        purchase_price: new Prisma.Decimal(5000),
      },
    });

    await tx.vehicleSale.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        sale_number: DEMO_TRADE_IN_SALE_NUMBER,
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicle.id,
        customer_id: buyer.id,
        sale_price: new Prisma.Decimal(12000),
        trade_in_purchase_id: tradeInPurchase.id,
      },
    });
  });
}
