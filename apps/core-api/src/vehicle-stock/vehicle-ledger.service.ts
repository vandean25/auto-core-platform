import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleLedgerEntryType,
  VehicleStockStatus,
  WorkshopLineItemType,
  WorkshopOrderPurpose,
  WorkshopPartLineExecutionStatus,
  TransactionType,
  VehicleInventoryRole,
  type VehicleLedgerEntry,
} from '@prisma/client';
import { FinanceService } from '../finance/finance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';

const DEALER_INVENTORY_ROLES = new Set<VehicleInventoryRole>([
  VehicleInventoryRole.USED,
  VehicleInventoryRole.NEW,
  VehicleInventoryRole.DEMO,
]);

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
  ): Promise<VehicleLedgerEntry> {
    if (!tx) {
      return this.prisma.$transaction((transaction) =>
        this.append(input, transaction),
      );
    }
    const tenantId = await this.tenantContext.getTenantId();
    const postingDate = input.postingDate ?? new Date();
    await this.financeService.validateTransactionDate(postingDate, tx);

    const db = tx;
    const vehicle = await db.vehicle.findFirst({
      where: { id: input.vehicleId, tenant_id: tenantId },
      select: {
        id: true,
        site_id: true,
        inventory_role: true,
        stock_received_at: true,
      },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${input.vehicleId} not found`);
    }

    const entry = await db.vehicleLedgerEntry.create({
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
    if (
      (input.entryType === VehicleLedgerEntryType.WORKSHOP_COST ||
        input.entryType === VehicleLedgerEntryType.ADJUSTMENT) &&
      DEALER_INVENTORY_ROLES.has(vehicle.inventory_role) &&
      vehicle.stock_received_at &&
      vehicle.site_id
    ) {
      await db.vehicle.updateMany({
        where: {
          id: input.vehicleId,
          tenant_id: tenantId,
          site_id: vehicle.site_id,
          inventory_role: {
            in: [
              VehicleInventoryRole.USED,
              VehicleInventoryRole.NEW,
              VehicleInventoryRole.DEMO,
            ],
          },
          stock_received_at: { not: null },
        },
        data: { stock_cost_basis: { increment: input.amount } },
      });
    }
    return entry;
  }

  async listForVehicle(vehicleId: string, tx?: Prisma.TransactionClient) {
    const tenantId = await this.tenantContext.getTenantId();
    const db = tx ?? this.prisma;
    return db.vehicleLedgerEntry.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async completeStockPrep(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    siteId: string,
  ) {
    const order = await tx.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      include: {
        vehicle: true,
        tasks: { include: { line_items: true } },
      },
    });
    if (!order || order.purpose !== WorkshopOrderPurpose.STOCK_PREP) {
      return;
    }

    const alreadyPosted = await tx.vehicleLedgerEntry.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
        entry_type: VehicleLedgerEntryType.WORKSHOP_COST,
      },
    });
    if (alreadyPosted) {
      return;
    }

    const lines = (order.tasks ?? []).flatMap((task) => task.line_items ?? []);
    const consumption = await tx.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        type: TransactionType.WORKSHOP_CONSUMPTION,
        parts_reservation: {
          workshop_task_line_item: {
            workshop_task: { workshop_order_id: orderId },
          },
        },
      },
      select: { quantity: true, cost_basis: true },
    });
    if (consumption.some((entry) => entry.cost_basis === null)) {
      throw new ConflictException(
        'Cannot complete STOCK_PREP while a consumed part has no cost basis.',
      );
    }

    const laborLines = lines.filter(
      (line) =>
        line.type === WorkshopLineItemType.LABOR &&
        line.part_execution_status !==
          WorkshopPartLineExecutionStatus.CANCELLED,
    );
    if (laborLines.some((line) => line.internal_cost_rate === null)) {
      throw new ConflictException(
        'Cannot complete STOCK_PREP while labor has no internal cost rate.',
      );
    }

    const amount = consumption
      .reduce(
        (sum, entry) =>
          sum.add(
            new Prisma.Decimal(entry.quantity).abs().mul(entry.cost_basis!),
          ),
        new Prisma.Decimal(0),
      )
      .add(
        laborLines.reduce((sum, line) => {
          const hours = line.actual_hours ?? line.quantity;
          return sum.add(hours.mul(line.internal_cost_rate!));
        }, new Prisma.Decimal(0)),
      );

    if (amount.gt(0)) {
      await this.append(
        {
          vehicleId: order.vehicle_id,
          entryType: VehicleLedgerEntryType.WORKSHOP_COST,
          amount,
          workshopOrderId: order.id,
        },
        tx,
      );
    }

    const restoreStatus = order.vehicle?.reserved_for_customer_id
      ? VehicleStockStatus.RESERVED
      : VehicleStockStatus.IN_STOCK;
    await tx.vehicle.updateMany({
      where: {
        id: order.vehicle_id,
        tenant_id: tenantId,
        stock_status: VehicleStockStatus.IN_PREP,
      },
      data: { stock_status: restoreStatus },
    });
  }
}
