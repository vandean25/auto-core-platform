import { LocationType, Prisma, StockTransferStatus } from '@prisma/client';

export const tenantId = 'tenant-1';
export const userId = 'user-1';
export const fromSiteId = 'site-from';
export const toSiteId = 'site-to';
export const thirdSiteId = 'site-third';
export const transferId = 'transfer-1';
export const itemId = 'item-1';
export const sourceBinId = 'bin-1';
export const destBinId = 'bin-2';
export const transitLocationId = 'transit-1';
export const validationLineId = '550e8400-e29b-41d4-a716-446655440000';
export const validationLocationId = '550e8400-e29b-41d4-a716-446655440001';

export function decimal(value: string) {
  return new Prisma.Decimal(value);
}

export function buildLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    tenant_id: tenantId,
    transfer_id: transferId,
    from_site_id: fromSiteId,
    to_site_id: toSiteId,
    catalog_item_id: itemId,
    source_location_id: null,
    dest_location_id: null,
    requested_qty: decimal('5'),
    approved_qty: decimal('0'),
    shipped_qty: decimal('0'),
    received_qty: decimal('0'),
    returned_qty: decimal('0'),
    ...overrides,
  };
}

export function buildTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: transferId,
    tenant_id: tenantId,
    transfer_number: 'TR-2026-0001',
    from_site_id: fromSiteId,
    to_site_id: toSiteId,
    status: StockTransferStatus.REQUESTED,
    version: 1,
    requested_by_user_id: userId,
    approved_by_user_id: null,
    shipped_by_user_id: null,
    received_by_user_id: null,
    reject_reason: null,
    cancel_reason: null,
    createdAt: new Date('2026-09-14T10:00:00.000Z'),
    updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    from_site: { name: 'Wien' },
    to_site: { name: 'Graz' },
    lines: [buildLine()],
    ...overrides,
  };
}

export function buildTransactionClient() {
  return {
    $queryRaw: jest.fn(),
    user: {
      findFirst: jest.fn(),
    },
    siteMembership: {
      findMany: jest.fn(),
    },
    site: {
      findMany: jest.fn(),
    },
    stockTransfer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    stockTransferLine: {
      findMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    stockTransferCommand: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    inventoryTransaction: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    catalogItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    storageLocation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    inventoryStock: {
      findMany: jest.fn(),
    },
    financeSettings: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
}
