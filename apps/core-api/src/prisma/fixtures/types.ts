import type {
  Brand,
  CatalogItem,
  FinanceSettings,
  LaborCategory,
  LegalEntity,
  PrismaClient,
  RevenueGroup,
  Site,
  StorageLocation,
  Tenant,
} from '@prisma/client';

export type SeedPrismaClient = PrismaClient;

export interface TenantFoundationContext {
  defaultTenant: Tenant;
  defaultLegalEntity: LegalEntity;
  mainSite: Site;
  systemLocations: StorageLocation[];
}

export interface FinanceContext {
  revenueGroups: RevenueGroup[];
  defaultRevenueGroup: RevenueGroup;
  financeSettings: FinanceSettings;
}

export interface BrandContext {
  dualBrandRecords: Brand[];
  pureVehicleMakeRecords: Brand[];
  purePartManufacturerRecords: Brand[];
  allBrands: Brand[];
}

export interface InventoryContext {
  locations: StorageLocation[];
  showroom: StorageLocation;
  storage: StorageLocation;
  tireHotel: StorageLocation;
  partA: CatalogItem;
  partB: CatalogItem;
  partC: CatalogItem;
  otherParts: CatalogItem[];
}

export interface LaborContext {
  categoryRecords: LaborCategory[];
  categorizedCount: number;
}
