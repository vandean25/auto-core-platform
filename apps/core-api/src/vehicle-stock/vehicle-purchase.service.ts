import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleAcquisitionKind,
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { normalizeVehicleIdentityValueOrNull } from '../vehicle/vehicle-identity.util';
import { VehicleLedgerService } from './vehicle-ledger.service';
import {
  ACTIVE_STOCK_STATUSES,
  buildLotStockPayload,
  prepareDraftUpdateData,
  resolveSellerValidationTarget,
} from './vehicle-purchase.helpers';
import {
  assertTenantCustomerExists,
  assertTenantStorageLocationExists,
  assertTenantVendorExists,
} from './vehicle-stock-ref.validator';
import type { CreateVehiclePurchaseDto } from './dto/create-vehicle-purchase.dto';
import type { PatchVehiclePurchaseDto } from './dto/patch-vehicle-purchase.dto';

@Injectable()
export class VehiclePurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly ledger: VehicleLedgerService,
  ) {}

  async create(dto: CreateVehiclePurchaseDto) {
    const tenantId = await this.tenantContext.getTenantId();
    this.assertSeller(dto);
    await this.assertTenantRefs(tenantId, dto);

    const purchaseNumber = await this.nextPurchaseNumber(tenantId);

    return this.prisma.vehiclePurchase.create({
      data: {
        tenant_id: tenantId,
        purchase_number: purchaseNumber,
        seller_type: dto.seller_type,
        vendor_id:
          dto.seller_type === VehiclePurchaseSellerType.VENDOR
            ? dto.vendor_id
            : null,
        customer_id:
          dto.seller_type === VehiclePurchaseSellerType.CUSTOMER
            ? dto.customer_id
            : null,
        acquisition_kind: VehicleAcquisitionKind.DIRECT,
        vin: normalizeVehicleIdentityValueOrNull(dto.vin),
        make: dto.make,
        model: dto.model,
        year: dto.year,
        engine_code: dto.engine_code,
        plate: dto.plate,
        color: dto.color,
        mileage: dto.mileage,
        key_number: dto.key_number,
        registration_certificate_no: dto.registration_certificate_no,
        purchase_price: new Prisma.Decimal(dto.purchase_price),
        location_id: dto.location_id,
      },
    });
  }

  async findAll(page = 1, limit = 25, search?: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const where: Prisma.VehiclePurchaseWhereInput = {
      tenant_id: tenantId,
      ...(search
        ? {
            OR: [
              { vin: { contains: search, mode: 'insensitive' } },
              { make: { contains: search, mode: 'insensitive' } },
              { model: { contains: search, mode: 'insensitive' } },
              { purchase_number: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.vehiclePurchase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehiclePurchase.count({ where }),
    ]);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        pageSize: limit,
        pageCount: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const purchase = await this.prisma.vehiclePurchase.findFirst({
      where: { id, tenant_id: tenantId },
      include: { customer: true },
    });
    if (!purchase) {
      throw new NotFoundException(`Vehicle purchase ${id} not found`);
    }
    return purchase;
  }

  async updateDraft(id: string, dto: PatchVehiclePurchaseDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const purchase = await this.findOne(id);
    if (purchase.status !== VehiclePurchaseStatus.DRAFT) {
      throw new ConflictException('Only DRAFT purchases can be updated');
    }

    this.assertSeller(resolveSellerValidationTarget(dto, purchase));
    await this.assertTenantRefs(tenantId, {
      vendor_id: dto.vendor_id,
      customer_id: dto.customer_id,
      location_id: dto.location_id,
    });

    const data = prepareDraftUpdateData(dto);
    const updated = await this.prisma.vehiclePurchase.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        status: VehiclePurchaseStatus.DRAFT,
        updatedAt: purchase.updatedAt,
      },
      data,
    });
    if (updated.count === 0) {
      throw new ConflictException('Only DRAFT purchases can be updated');
    }
    return this.findOne(id);
  }

  async receive(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.$transaction(async (tx) => {
      const purchase = await this.validatePurchaseForReceipt(tx, tenantId, id);
      const vehicleId = await this.upsertLotVehicle(tx, tenantId, purchase);
      await this.recordPurchaseLedgerEntry(tx, vehicleId, purchase);
      return this.linkPurchaseToVehicle(tx, tenantId, purchase.id, vehicleId);
    });
  }

  async cancel(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const result = await this.prisma.vehiclePurchase.updateMany({
      where: { id, tenant_id: tenantId, status: VehiclePurchaseStatus.DRAFT },
      data: { status: VehiclePurchaseStatus.CANCELLED },
    });
    if (result.count === 0) {
      throw new ConflictException('Only DRAFT purchases can be cancelled');
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const purchase = await this.prisma.vehiclePurchase.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true, status: true },
    });
    if (!purchase) {
      throw new NotFoundException(`Vehicle purchase ${id} not found`);
    }
    if (purchase.status !== VehiclePurchaseStatus.DRAFT) {
      throw new ConflictException('Only DRAFT purchases can be deleted');
    }

    const ledgerCount = await this.prisma.vehicleLedgerEntry.count({
      where: { tenant_id: tenantId, vehicle_purchase_id: id },
    });
    if (ledgerCount > 0) {
      throw new ConflictException(
        'Vehicle purchase cannot be deleted because ledger entries exist',
      );
    }

    const result = await this.prisma.vehiclePurchase.deleteMany({
      where: { id, tenant_id: tenantId, status: VehiclePurchaseStatus.DRAFT },
    });
    if (result.count === 0) {
      throw new ConflictException('Only DRAFT purchases can be deleted');
    }
    return { id };
  }

  private async validatePurchaseForReceipt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ) {
    const guarded = await tx.vehiclePurchase.updateMany({
      where: { id, tenant_id: tenantId, status: VehiclePurchaseStatus.DRAFT },
      data: {
        status: VehiclePurchaseStatus.RECEIVED,
        received_at: new Date(),
      },
    });
    if (guarded.count === 0) {
      throw new ConflictException('Purchase is not in DRAFT status');
    }

    const purchase = await tx.vehiclePurchase.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!purchase) {
      throw new NotFoundException(`Vehicle purchase ${id} not found`);
    }
    return purchase;
  }

  private async upsertLotVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchase: Prisma.VehiclePurchaseGetPayload<object>,
  ): Promise<string> {
    const vin = normalizeVehicleIdentityValueOrNull(purchase.vin);
    if (!vin) {
      return this.createNewStockVehicle(tx, tenantId, purchase, null);
    }

    const existing = await tx.vehicle.findFirst({
      where: { tenant_id: tenantId, vin },
    });
    if (!existing) {
      return this.createNewStockVehicle(tx, tenantId, purchase, vin);
    }

    await this.updateExistingStockVehicle(
      tx,
      tenantId,
      existing,
      purchase,
      vin,
    );
    return existing.id;
  }

  private async updateExistingStockVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    existing: {
      id: string;
      plate: string | null;
      identity_resolution_generation: string | null;
      identity_resolution_token: string | null;
    },
    purchase: Prisma.VehiclePurchaseGetPayload<object>,
    vin: string,
  ): Promise<void> {
    const stockData = buildLotStockPayload(purchase, existing);
    const flipped = await tx.vehicle.updateMany({
      where: {
        id: existing.id,
        tenant_id: tenantId,
        vin,
        plate: existing.plate,
        identity_resolution_generation:
          existing.identity_resolution_generation ?? null,
        identity_resolution_token: existing.identity_resolution_token ?? null,
        OR: [
          { inventory_role: { not: VehicleInventoryRole.USED } },
          { stock_status: null },
          { stock_status: { notIn: ACTIVE_STOCK_STATUSES } },
        ],
      },
      data: stockData,
    });
    if (flipped.count === 0) {
      throw new ConflictException('VIN is already in dealer stock');
    }
  }

  private async createNewStockVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchase: Prisma.VehiclePurchaseGetPayload<object>,
    vin: string | null,
  ): Promise<string> {
    const stockData = buildLotStockPayload(purchase, null);
    try {
      const created = await tx.vehicle.create({
        data: {
          tenant_id: tenantId,
          vin,
          ...stockData,
        },
      });
      return created.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('VIN is already in dealer stock');
      }
      throw error;
    }
  }

  private async recordPurchaseLedgerEntry(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    purchase: { id: string; purchase_price: Prisma.Decimal },
  ): Promise<void> {
    await this.ledger.append(
      {
        vehicleId,
        entryType: VehicleLedgerEntryType.PURCHASE,
        amount: purchase.purchase_price,
        vehiclePurchaseId: purchase.id,
      },
      tx,
    );
  }

  private async linkPurchaseToVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchaseId: string,
    vehicleId: string,
  ) {
    const linkedPurchase = await tx.vehiclePurchase.updateMany({
      where: { id: purchaseId, tenant_id: tenantId },
      data: { vehicle_id: vehicleId },
    });
    if (linkedPurchase.count === 0) {
      throw new ConflictException(
        'Vehicle purchase changed while receiving; please retry',
      );
    }

    const receivedPurchase = await tx.vehiclePurchase.findFirst({
      where: { id: purchaseId, tenant_id: tenantId },
    });
    if (!receivedPurchase) {
      throw new NotFoundException(`Vehicle purchase ${purchaseId} not found`);
    }
    return receivedPurchase;
  }

  private assertSeller(dto: CreateVehiclePurchaseDto) {
    if (
      dto.seller_type === VehiclePurchaseSellerType.VENDOR &&
      !dto.vendor_id
    ) {
      throw new BadRequestException(
        'vendor_id is required for vendor purchases',
      );
    }
    if (
      dto.seller_type === VehiclePurchaseSellerType.CUSTOMER &&
      !dto.customer_id
    ) {
      throw new BadRequestException(
        'customer_id is required for private purchases',
      );
    }
  }

  private async assertTenantRefs(
    tenantId: string,
    refs: {
      vendor_id?: string | null;
      customer_id?: string | null;
      location_id?: string | null;
    },
  ) {
    if (refs.vendor_id) {
      await assertTenantVendorExists(this.prisma, tenantId, refs.vendor_id);
    }
    if (refs.customer_id) {
      await assertTenantCustomerExists(this.prisma, tenantId, refs.customer_id);
    }
    if (refs.location_id) {
      await assertTenantStorageLocationExists(
        this.prisma,
        tenantId,
        refs.location_id,
      );
    }
  }

  private async nextPurchaseNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const prefix = `VP-${year}-`;
    const settings = await this.prisma.$transaction(async (tx) => {
      await tx.financeSettings.upsert({
        where: { tenant_id: tenantId },
        update: {},
        create: {
          tenant_id: tenantId,
          workshop_order_prefix: `WO-${year}-`,
          vehicle_purchase_prefix: prefix,
        },
      });
      return tx.financeSettings.update({
        where: { tenant_id: tenantId },
        data: { next_vehicle_purchase_number: { increment: 1 } },
        select: { next_vehicle_purchase_number: true },
      });
    });
    return `${prefix}${String(settings.next_vehicle_purchase_number - 1).padStart(4, '0')}`;
  }
}
