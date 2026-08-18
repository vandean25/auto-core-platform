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
  VehicleStockStatus,
  VehicleTaxScheme,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { VehicleLedgerService } from './vehicle-ledger.service';
import type { CreateVehiclePurchaseDto } from './dto/create-vehicle-purchase.dto';
import type { PatchVehiclePurchaseDto } from './dto/patch-vehicle-purchase.dto';

const ACTIVE_STOCK_STATUSES: VehicleStockStatus[] = [
  VehicleStockStatus.ON_ORDER,
  VehicleStockStatus.IN_STOCK,
  VehicleStockStatus.RESERVED,
  VehicleStockStatus.IN_PREP,
];

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
        vin: this.normalizeVin(dto.vin),
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
    const nextSeller = dto.seller_type ?? purchase.seller_type;
    this.assertSeller({
      seller_type: nextSeller,
      vendor_id:
        dto.vendor_id !== undefined
          ? (dto.vendor_id ?? undefined)
          : (purchase.vendor_id ?? undefined),
      customer_id:
        dto.customer_id !== undefined
          ? (dto.customer_id ?? undefined)
          : (purchase.customer_id ?? undefined),
    } as CreateVehiclePurchaseDto);
    await this.assertTenantRefs(tenantId, {
      vendor_id: dto.vendor_id,
      customer_id: dto.customer_id,
      location_id: dto.location_id,
    });

    const updated = await this.prisma.vehiclePurchase.updateMany({
      where: { id, tenant_id: tenantId, status: VehiclePurchaseStatus.DRAFT },
      data: {
        seller_type: dto.seller_type,
        vendor_id:
          dto.vendor_id !== undefined
            ? dto.vendor_id
            : dto.seller_type === VehiclePurchaseSellerType.CUSTOMER
              ? null
              : undefined,
        customer_id:
          dto.customer_id !== undefined
            ? dto.customer_id
            : dto.seller_type === VehiclePurchaseSellerType.VENDOR
              ? null
              : undefined,
        vin: dto.vin ? this.normalizeVin(dto.vin) : undefined,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        engine_code: dto.engine_code,
        plate: dto.plate,
        color: dto.color,
        mileage: dto.mileage,
        key_number: dto.key_number,
        registration_certificate_no: dto.registration_certificate_no,
        purchase_price:
          dto.purchase_price !== undefined
            ? new Prisma.Decimal(dto.purchase_price)
            : undefined,
        location_id: dto.location_id,
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('Only DRAFT purchases can be updated');
    }
    return this.findOne(id);
  }

  async receive(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.$transaction(async (tx) => {
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

      const vin = this.normalizeVin(purchase.vin);
      const existing = await tx.vehicle.findFirst({
        where: { tenant_id: tenantId, vin },
      });

      const stockData = {
        make: purchase.make,
        model: purchase.model,
        year: purchase.year,
        engine_code: purchase.engine_code,
        plate: purchase.plate,
        color: purchase.color,
        mileage: purchase.mileage,
        key_number: purchase.key_number,
        registration_certificate_no: purchase.registration_certificate_no,
        location_id: purchase.location_id,
        customer_id: null,
        inventory_role: VehicleInventoryRole.USED,
        stock_status: VehicleStockStatus.IN_STOCK,
        tax_scheme: VehicleTaxScheme.MARGIN,
      };

      let vehicleId: string;
      if (existing) {
        const flipped = await tx.vehicle.updateMany({
          where: {
            id: existing.id,
            tenant_id: tenantId,
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
        vehicleId = existing.id;
      } else {
        try {
          const created = await tx.vehicle.create({
            data: {
              tenant_id: tenantId,
              vin,
              ...stockData,
            },
          });
          vehicleId = created.id;
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

      await this.ledger.append(
        {
          vehicleId,
          entryType: VehicleLedgerEntryType.PURCHASE,
          amount: purchase.purchase_price,
          vehiclePurchaseId: purchase.id,
        },
        tx,
      );

      return tx.vehiclePurchase.update({
        where: { id: purchase.id },
        data: { vehicle_id: vehicleId },
      });
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
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: refs.vendor_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!vendor) {
        throw new NotFoundException(`Vendor ${refs.vendor_id} not found`);
      }
    }
    if (refs.customer_id) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: refs.customer_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${refs.customer_id} not found`);
      }
    }
    if (refs.location_id) {
      const location = await this.prisma.storageLocation.findFirst({
        where: { id: refs.location_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!location) {
        throw new NotFoundException(`Location ${refs.location_id} not found`);
      }
    }
  }

  private normalizeVin(vin: string) {
    return vin.trim().toUpperCase();
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
