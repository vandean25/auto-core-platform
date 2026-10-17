import { BadRequestException } from '@nestjs/common';
import { VehiclePurchaseStatus, type PrismaClient } from '@prisma/client';

type StockCycleClient = Pick<PrismaClient, 'vehiclePurchase'>;

export async function resolveCurrentReceivedStockPurchaseId(
  prisma: StockCycleClient,
  tenantId: string,
  vehicleId: string,
): Promise<string> {
  const purchase = await prisma.vehiclePurchase.findFirst({
    where: {
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      status: VehiclePurchaseStatus.RECEIVED,
    },
    orderBy: [{ received_at: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });

  if (!purchase) {
    throw new BadRequestException({
      code: 'VEHICLE_STOCK_PURCHASE_REQUIRED',
      message:
        'Equipment can only be stored for a vehicle with a received stock purchase.',
    });
  }

  return purchase.id;
}
