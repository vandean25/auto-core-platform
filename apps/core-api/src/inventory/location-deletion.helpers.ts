import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type BasicLocationForDeletion = {
  is_system: boolean;
  _count: {
    children: number;
    stocks: number;
  };
};

export type TransferLineForOutstandingCheck = {
  source_location_id: string | null;
  dest_location_id: string | null;
  approved_qty: Prisma.Decimal;
  shipped_qty: Prisma.Decimal;
  received_qty: Prisma.Decimal;
  returned_qty: Prisma.Decimal;
};

export function assertCanDeleteLocationBasic(
  location: BasicLocationForDeletion,
): void {
  if (location.is_system) {
    throw new ConflictException('System locations cannot be deleted');
  }
  if (location._count.children > 0) {
    throw new BadRequestException(
      'Cannot delete location with children. Delete children first.',
    );
  }
  if (location._count.stocks > 0) {
    throw new BadRequestException('Cannot delete location containing stock.');
  }
}

export async function assertNoParkedDealerVehicles(
  tx: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
): Promise<void> {
  const parkedVehicles = await tx.vehicle.count({
    where: {
      tenant_id: tenantId,
      location_id: locationId,
      inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
      stock_status: { in: ['IN_STOCK', 'RESERVED', 'IN_PREP'] },
    },
  });
  if (parkedVehicles > 0) {
    throw new ConflictException(
      'Cannot delete or disable a lot with parked dealer vehicles. Move or sell the vehicles first.',
    );
  }
}

export function hasOutstandingTransferQty(
  lines: TransferLineForOutstandingCheck[],
  locationId: string,
): boolean {
  return lines.some((line) => {
    const outstanding = line.shipped_qty.minus(
      line.received_qty.plus(line.returned_qty),
    );
    if (line.source_location_id === locationId) {
      // Frozen future pick or remaining in-transit qty from this bin.
      if (line.approved_qty.gt(0) || outstanding.gt(0)) {
        return true;
      }
    }
    if (line.dest_location_id === locationId && outstanding.gt(0)) {
      return true;
    }
    return false;
  });
}

export async function assertNoOutstandingStockTransfers(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  locationId: string,
): Promise<void> {
  const openTransferLines = await tx.stockTransferLine.findMany({
    where: {
      tenant_id: tenantId,
      transfer: { status: { in: ['REQUESTED', 'APPROVED', 'SHIPPED'] } },
      OR: [
        { from_site_id: siteId, source_location_id: locationId },
        { to_site_id: siteId, dest_location_id: locationId },
      ],
    },
    select: {
      source_location_id: true,
      dest_location_id: true,
      approved_qty: true,
      shipped_qty: true,
      received_qty: true,
      returned_qty: true,
    },
  });

  if (hasOutstandingTransferQty(openTransferLines, locationId)) {
    throw new ConflictException(
      'Cannot delete or disable a location referenced by a stock transfer with outstanding quantity.',
    );
  }
}
