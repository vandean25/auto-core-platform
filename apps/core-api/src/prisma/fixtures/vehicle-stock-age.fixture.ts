import {
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
  VehicleStockStatus,
  VehicleTaxScheme,
} from '@prisma/client';
import type {
  InventoryContext,
  SeedPrismaClient,
  TenantFoundationContext,
} from './types.js';

const DEMO_STOCK_AGES = [
  { days: 15, role: VehicleInventoryRole.USED },
  { days: 45, role: VehicleInventoryRole.NEW },
  { days: 75, role: VehicleInventoryRole.DEMO },
  { days: 120, role: VehicleInventoryRole.USED },
  { days: 220, role: VehicleInventoryRole.USED },
] as const;
const DEMO_COST_EUR = 18_500;

function dateDaysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

export async function seedVehicleStockAgeDemo(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
  showroom: InventoryContext['showroom'],
): Promise<void> {
  const tenantId = foundation.defaultTenant.id;
  const siteId = foundation.mainSite.id;

  await Promise.all(
    DEMO_STOCK_AGES.map(({ days, role }, index) => {
      const stockInDate = dateDaysAgo(days);
      const purchaseNumber = `DEMO-E12-${String(index + 1).padStart(2, '0')}`;
      const make = ['Audi', 'Volkswagen', 'Škoda', 'BMW', 'Volvo'][index];
      const model = ['A4', 'Golf', 'Octavia', '3er', 'V60'][index];
      const year = 2021 + (index % 4);
      const purchasePrice = DEMO_COST_EUR + index * 1_250;

      return prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          location_id: showroom.id,
          inventory_role: role,
          stock_status: VehicleStockStatus.IN_STOCK,
          stock_received_at: stockInDate,
          stock_cost_basis: purchasePrice,
          tax_scheme:
            role === VehicleInventoryRole.USED
              ? VehicleTaxScheme.MARGIN
              : VehicleTaxScheme.STANDARD,
          make,
          model,
          year,
          vin: `E12DEMO0000000000${index + 1}`,
          plate: `E12-${index + 1}`,
          purchases: {
            create: {
              tenant_id: tenantId,
              site_id: siteId,
              purchase_number: purchaseNumber,
              status: VehiclePurchaseStatus.RECEIVED,
              seller_type: VehiclePurchaseSellerType.VENDOR,
              make,
              model,
              year,
              purchase_price: purchasePrice,
              location_id: showroom.id,
              received_at: stockInDate,
            },
          },
          ledger_entries: {
            create: {
              tenant_id: tenantId,
              entry_type: VehicleLedgerEntryType.PURCHASE,
              amount: purchasePrice,
              posting_date: stockInDate,
            },
          },
        },
      });
    }),
  );
}
