import { LocationType, TransactionType } from '@prisma/client';
import { seedFixedStagingTotes } from '../seed-staging-totes';
import type {
  BrandContext,
  FinanceContext,
  InventoryContext,
  SeedPrismaClient,
  TenantFoundationContext,
} from './types';

export const PART_CATEGORIES = [
  { name: 'Oil Filter', prefix: 'OF' },
  { name: 'Brake Pads', prefix: 'BP' },
  { name: 'Synthetic Oil (5W-30)', prefix: 'OIL' },
  { name: 'Wiper Blades', prefix: 'WB' },
  { name: 'Spark Plug', prefix: 'SP' },
  { name: 'Air Filter', prefix: 'AF' },
];

export async function seedInventory(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
  finance: FinanceContext,
  allBrands: BrandContext['allBrands'],
): Promise<InventoryContext> {
  const tenantId = foundation.defaultTenant.id;
  const siteId = foundation.mainSite.id;
  const defaultRevenueGroup = finance.defaultRevenueGroup;

  console.log('Seeding warehouses...');
  const [showroom, storage, tireHotel] = await Promise.all([
    prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Main Showroom (Vienna)',
        code: 'WH-VIE-01',
        type: LocationType.warehouse,
      },
    }),
    prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Workshop Storage (Graz)',
        code: 'WH-GRZ-01',
        type: LocationType.warehouse,
      },
    }),
    prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Tire Hotel (Basement)',
        code: 'WH-TIRE-01',
        type: LocationType.warehouse,
      },
    }),
  ]);

  const locations = [showroom, storage, tireHotel];

  console.log('Seeding fixed staging totes...');
  const stagingToteSummary = await seedFixedStagingTotes(prisma, {
    parentLocationId: storage.id,
    tenantId,
    siteId,
  });
  console.log(
    `Staging totes summary: created=${stagingToteSummary.created}, updated=${stagingToteSummary.updated}, unchanged=${stagingToteSummary.unchanged}`,
  );

  console.log('Seeding supersession items (Phase 1: Creation)...');
  const vwBrand = allBrands.find((b) => b.name === 'Volkswagen');

  const [partA, partB, partC] = await Promise.all([
    prisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: '06J-115-403-C',
        name: 'Oil Filter (Legacy)',
        cost_price: 8.5,
        retail_price: 15.0,
        revenue_group_id: defaultRevenueGroup.id,
        brand_id: vwBrand?.id,
      },
    }),
    prisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: '06J-115-403-Q',
        name: 'Oil Filter (Improved)',
        cost_price: 9.0,
        retail_price: 16.5,
        revenue_group_id: defaultRevenueGroup.id,
        brand_id: vwBrand?.id,
      },
    }),
    prisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: '06J-115-561-B',
        name: 'Oil Filter (Current)',
        cost_price: 10.2,
        retail_price: 18.0,
        revenue_group_id: defaultRevenueGroup.id,
        brand_id: vwBrand?.id,
      },
    }),
  ]);

  console.log('Seeding supersession items (Phase 2: Linking)...');
  await Promise.all([
    prisma.catalogItem.update({
      where: { id: partA.id },
      data: { superseded_by_id: partB.id },
    }),
    prisma.catalogItem.update({
      where: { id: partB.id },
      data: { superseded_by_id: partC.id },
    }),
  ]);

  console.log('Seeding 47 more auto parts in batch...');
  const brandsForParts = allBrands.filter((b) => b.isPartManufacturer);
  if (brandsForParts.length === 0) {
    throw new Error(
      'No part manufacturer brands available for inventory seeding',
    );
  }

  const partDefinitions: Array<{
    tenant_id: string;
    sku: string;
    name: string;
    cost_price: number;
    retail_price: number;
    revenue_group_id: number;
    brand_id: number;
  }> = [];

  for (let i = 1; i <= 47; i++) {
    const brand = brandsForParts[(i - 1) % brandsForParts.length];
    const category = PART_CATEGORIES[(i - 1) % PART_CATEGORIES.length];
    const sku = `${category.prefix}-${1000 + i}-${brand.name.substring(0, 3).toUpperCase()}`;

    partDefinitions.push({
      tenant_id: tenantId,
      sku,
      name: `${category.name} - ${brand.name} model ${i}`,
      cost_price: 10 + (i % 50),
      retail_price: 60 + (i % 100),
      revenue_group_id: defaultRevenueGroup.id,
      brand_id: brand.id,
    });
  }

  const otherParts = await prisma.catalogItem.createManyAndReturn({
    data: partDefinitions,
  });

  console.log('Seeding stock using batched ledger-based transactions...');
  const initialStockEntries: Array<{
    itemId: string;
    locationId: string;
    quantity: number;
    costBasis: number;
    reserved: number;
  }> = [];

  // Part C initial stock
  initialStockEntries.push({
    itemId: partC.id,
    locationId: showroom.id,
    quantity: 25,
    costBasis: Number(partC.cost_price),
    reserved: 2,
  });

  // Deterministic stock for other parts (70% of parts receive stock)
  otherParts.forEach((part, index) => {
    if (index % 10 < 7) {
      const quantity = (index % 50) + 1;
      const reserved = index % 5;
      const location = locations[index % locations.length];

      initialStockEntries.push({
        itemId: part.id,
        locationId: location.id,
        quantity,
        costBasis: Number(part.cost_price),
        reserved,
      });
    }
  });

  // Batch insert ledger transactions
  const transactionsData = initialStockEntries.map((entry) => ({
    tenant_id: tenantId,
    site_id: siteId,
    item_id: entry.itemId,
    location_id: entry.locationId,
    quantity: entry.quantity,
    type: TransactionType.INITIAL_BALANCE,
    reference_id: 'SEED_SCRIPT',
    cost_basis: entry.costBasis,
  }));

  if (transactionsData.length > 0) {
    await prisma.inventoryTransaction.createMany({
      data: transactionsData,
    });
  }

  // Batch insert cached stocks
  const stocksData = initialStockEntries.map((entry) => ({
    tenant_id: tenantId,
    site_id: siteId,
    catalog_item_id: entry.itemId,
    location_id: entry.locationId,
    quantity_on_hand: entry.quantity,
    quantity_reserved: entry.reserved,
  }));

  if (stocksData.length > 0) {
    await prisma.inventoryStock.createMany({
      data: stocksData,
      skipDuplicates: true,
    });
  }

  return {
    locations,
    showroom,
    storage,
    tireHotel,
    partA,
    partB,
    partC,
    otherParts,
  };
}
