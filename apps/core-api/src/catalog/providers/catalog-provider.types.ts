import type { CatalogOemConcernCode, Prisma } from '@prisma/client';

export type CatalogSearchConcern = 'PARTS' | 'LABOR';

export type CatalogSearchSource = 'AUTO' | 'OEM' | 'AFTERMARKET';

export type CatalogOemStatus = 'HIT' | 'EMPTY' | 'ERROR' | 'NOT_CONFIGURED';

export type CatalogFallbackReason = 'EMPTY' | 'ERROR' | null;

export interface CatalogSearchContext {
  tenantId: string;
  workshopOrderId: string;
  vehicleId: string;
  makeBrandId: number;
  identityKeys: Prisma.JsonValue;
  oemConcernCode: CatalogOemConcernCode | null;
  query: string;
}

export type CatalogAssemblyGroupContext = Omit<CatalogSearchContext, 'query'>;

export interface CatalogAssemblyGroupNode {
  id: string;
  name: string;
  children?: CatalogAssemblyGroupNode[];
}

export interface CatalogPartsHit {
  externalId: string;
  sourceSystem: string;
  name: string;
  articleNumber: string;
  brandLabel: string;
  unitPrice: number;
  costPriceEst?: number | null;
  ean?: string | null;
  unit?: string | null;
  fitmentNotes?: string | null;
  oemNumbers?: string[];
}

export interface CatalogLaborHit {
  externalId: string;
  sourceSystem: string;
  name: string;
  externalOperationCode: string;
  standardAw?: number | null;
  plannedHours?: number | null;
}
