import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleLedgerEntryType,
} from '@prisma/client';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';

export type VehicleLedgerAppendInput = {
  vehicleId: string;
  entryType: VehicleLedgerEntryType;
  amount: Prisma.Decimal;
  postingDate?: Date;
  vehiclePurchaseId?: string;
  vehicleSaleId?: string;
  workshopOrderId?: string;
  notes?: string;
};

@Injectable()
export class VehicleLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async append(
    input: VehicleLedgerAppendInput,
    tx?: Prisma.TransactionClient,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const postingDate = input.postingDate ?? new Date();
    await this.financeService.validateTransactionDate(postingDate);

    const db = tx ?? this.prisma;
    const vehicle = await db.vehicle.findFirst({
      where: { id: input.vehicleId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${input.vehicleId} not found`);
    }

    return db.vehicleLedgerEntry.create({
      data: {
        tenant_id: tenantId,
        vehicle_id: input.vehicleId,
        entry_type: input.entryType,
        amount: input.amount,
        posting_date: postingDate,
        vehicle_purchase_id: input.vehiclePurchaseId,
        vehicle_sale_id: input.vehicleSaleId,
        workshop_order_id: input.workshopOrderId,
        notes: input.notes,
      },
    });
  }

  async listForVehicle(vehicleId: string, tx?: Prisma.TransactionClient) {
    const tenantId = await this.tenantContext.getTenantId();
    const db = tx ?? this.prisma;
    return db.vehicleLedgerEntry.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

export function assertUnlocked(
  lockDate: Date | null,
  postingDate: Date,
): void {
  if (lockDate && postingDate <= lockDate) {
    throw new ForbiddenException(
      `Transaction date ${postingDate.toISOString()} is in a locked fiscal period`,
    );
  }
}
