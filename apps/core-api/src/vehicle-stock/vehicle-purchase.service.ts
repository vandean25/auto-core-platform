import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  Prisma,
  VehicleAcquisitionKind,
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import {
  assertActiveTargetSiteMembership,
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { normalizeVehicleIdentityValueOrNull } from '../vehicle/vehicle-identity.util.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import {
  ACTIVE_STOCK_STATUSES,
  buildLotStockPayload,
  prepareDraftUpdateData,
  resolveSellerValidationTarget,
} from './vehicle-purchase.helpers.js';
import {
  assertTenantCustomerExists,
  assertTenantStorageLocationExists,
  assertTenantVendorExists,
} from './vehicle-stock-ref.validator.js';
import type { CreateVehiclePurchaseDto } from './dto/create-vehicle-purchase.dto.js';
import type { PatchVehiclePurchaseDto } from './dto/patch-vehicle-purchase.dto.js';

@Injectable()
export class VehiclePurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly ledger: VehicleLedgerService,
  ) {}

  async create(dto: CreateVehiclePurchaseDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    this.assertSeller(dto);
    await this.assertTenantRefs(tenantId, dto, siteId);

    if (dto.location_id) {
      const loc = await this.prisma.storageLocation.findFirst({
        where: { id: dto.location_id, tenant_id: tenantId, site_id: siteId },
        select: { site_id: true, type: true },
      });
      if (
        !loc ||
        loc.site_id !== siteId ||
        loc.type !== LocationType.vehicle_lot
      ) {
        throw new UnprocessableEntityException(
          'Location does not belong to the active site',
        );
      }
    }

    const purchaseNumber = await this.nextPurchaseNumber(tenantId);

    return this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, tenantId, [siteId]);

      return tx.vehiclePurchase.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
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
    });
  }

  async findAll(page = 1, limit = 25, search?: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const where: Prisma.VehiclePurchaseWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
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
    const siteId = await this.siteContext.getSiteId();
    const purchase = await this.prisma.vehiclePurchase.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
      include: { customer: true },
    });
    if (!purchase) {
      throw new NotFoundException(`Vehicle purchase ${id} not found`);
    }
    return purchase;
  }

  async updateDraft(id: string, dto: PatchVehiclePurchaseDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const purchase = await this.findOne(id);
    const targetSiteId = dto.siteId ?? dto.site_id;
    const isRetargeting =
      targetSiteId !== undefined && targetSiteId !== purchase.site_id;

    if (purchase.status !== VehiclePurchaseStatus.DRAFT) {
      if (isRetargeting) {
        throw new UnprocessableEntityException(
          'Vehicle purchase site can only be changed while in DRAFT status',
        );
      }
      throw new ConflictException('Only DRAFT purchases can be updated');
    }

    if (
      dto.expectedSiteId !== undefined &&
      purchase.site_id &&
      dto.expectedSiteId !== purchase.site_id
    ) {
      throw new ConflictException(
        'Vehicle purchase site changed concurrently. Please refresh.',
      );
    }

    if (isRetargeting) {
      await assertActiveTargetSiteMembership(
        this.prisma,
        this.tenantContext,
        tenantId,
        targetSiteId,
      );

      if (!dto.location_id) {
        throw new UnprocessableEntityException(
          'Destination lot must belong to target site',
        );
      }

      const loc = await this.prisma.storageLocation.findFirst({
        where: {
          id: dto.location_id,
          tenant_id: tenantId,
          site_id: targetSiteId,
        },
        select: { site_id: true, type: true },
      });
      if (
        !loc ||
        loc.site_id !== targetSiteId ||
        loc.type !== LocationType.vehicle_lot
      ) {
        throw new UnprocessableEntityException(
          'Destination lot must belong to target site',
        );
      }
    }

    this.assertSeller(resolveSellerValidationTarget(dto, purchase));
    await this.assertTenantRefs(
      tenantId,
      {
        vendor_id: dto.vendor_id,
        customer_id: dto.customer_id,
        location_id: dto.location_id,
      },
      targetSiteId ?? siteId,
    );

    const data: Prisma.VehiclePurchaseUncheckedUpdateManyInput =
      prepareDraftUpdateData(dto);
    if (isRetargeting) {
      data.site_id = targetSiteId;
    }

    return this.prisma.$transaction(async (tx) => {
      if (isRetargeting) {
        await lockSitesAndAssertActive(
          tx,
          tenantId,
          [purchase.site_id, targetSiteId].filter((s): s is string =>
            Boolean(s),
          ),
        );
      }

      const updated = await tx.vehiclePurchase.updateMany({
        where: {
          id,
          tenant_id: tenantId,
          status: VehiclePurchaseStatus.DRAFT,
          updatedAt: purchase.updatedAt,
          site_id: purchase.site_id,
          ...(dto.expectedSiteId ? { site_id: dto.expectedSiteId } : {}),
        },
        data,
      });

      if (updated.count === 0) {
        if (isRetargeting) {
          throw new ConflictException(
            'Vehicle purchase state or site changed concurrently. Please refresh.',
          );
        }
        throw new ConflictException('Only DRAFT purchases can be updated');
      }

      return tx.vehiclePurchase.findFirst({
        where: {
          id,
          tenant_id: tenantId,
          site_id: dto.siteId ?? dto.site_id ?? purchase.site_id,
        },
        include: { customer: true },
      });
    });
  }

  async receive(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.vehiclePurchase.findFirst({
        where: { id, tenant_id: tenantId, site_id: siteId },
        select: { site_id: true },
      });
      if (!draft) {
        throw new NotFoundException(`Vehicle purchase ${id} not found`);
      }
      const persistedSiteId = assertPersistedSiteId(
        draft.site_id,
        'Vehicle purchase site ownership is required',
      );
      await lockSitesAndAssertActive(tx, tenantId, [persistedSiteId]);

      const purchase = await this.validatePurchaseForReceipt(
        tx,
        tenantId,
        id,
        persistedSiteId,
      );
      const vehicleId = await this.upsertLotVehicle(tx, tenantId, purchase);
      await this.recordPurchaseLedgerEntry(tx, vehicleId, purchase);
      return this.linkPurchaseToVehicle(
        tx,
        tenantId,
        persistedSiteId,
        purchase.id,
        vehicleId,
      );
    });
  }

  async cancel(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const result = await this.prisma.vehiclePurchase.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        site_id: siteId,
        status: VehiclePurchaseStatus.DRAFT,
      },
      data: { status: VehiclePurchaseStatus.CANCELLED },
    });
    if (result.count === 0) {
      throw new ConflictException('Only DRAFT purchases can be cancelled');
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const purchase = await this.prisma.vehiclePurchase.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
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
    siteId: string,
  ) {
    const guarded = await tx.vehiclePurchase.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        site_id: siteId,
        status: VehiclePurchaseStatus.DRAFT,
      },
      data: {
        status: VehiclePurchaseStatus.RECEIVED,
        received_at: new Date(),
      },
    });
    if (guarded.count === 0) {
      throw new ConflictException('Purchase is not in DRAFT status');
    }

    const purchase = await tx.vehiclePurchase.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
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
    const purchaseWithLot = {
      ...purchase,
      location_id: await this.resolveReceiveLocationId(tx, tenantId, purchase),
    };
    const vin = normalizeVehicleIdentityValueOrNull(purchase.vin);
    if (!vin) {
      return this.createNewStockVehicle(tx, tenantId, purchaseWithLot, null);
    }

    const existing = await tx.vehicle.findFirst({
      where: { tenant_id: tenantId, vin },
    });
    if (!existing) {
      return this.createNewStockVehicle(tx, tenantId, purchaseWithLot, vin);
    }

    await this.updateExistingStockVehicle(
      tx,
      tenantId,
      existing,
      purchaseWithLot,
      vin,
    );
    return existing.id;
  }

  private async resolveReceiveLocationId(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchase: { site_id: string | null; location_id: string | null },
  ): Promise<string | null> {
    if (!purchase.site_id) {
      throw new UnprocessableEntityException(
        'Vehicle purchase site ownership is required before receipt',
      );
    }

    const requestedLot = purchase.location_id
      ? await tx.storageLocation.findFirst({
          where: {
            id: purchase.location_id,
            tenant_id: tenantId,
            site_id: purchase.site_id,
            type: LocationType.vehicle_lot,
            deletedAt: null,
          },
          select: { id: true },
        })
      : null;
    if (purchase.location_id && !requestedLot) {
      throw new UnprocessableEntityException(
        'Vehicle purchase location must be a vehicle lot on its site',
      );
    }
    if (requestedLot) {
      return requestedLot.id;
    }

    const defaultLot = await tx.storageLocation.findFirst({
      where: {
        tenant_id: tenantId,
        site_id: purchase.site_id,
        type: LocationType.vehicle_lot,
        is_system: false,
        deletedAt: null,
      },
      select: { id: true },
      orderBy: [{ is_system: 'asc' }, { code: 'asc' }],
    });
    if (!defaultLot) {
      throw new UnprocessableEntityException(
        'A vehicle lot is required before receiving the purchase',
      );
    }
    return defaultLot.id;
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
    siteId: string,
    purchaseId: string,
    vehicleId: string,
  ) {
    const linkedPurchase = await tx.vehiclePurchase.updateMany({
      where: { id: purchaseId, tenant_id: tenantId, site_id: siteId },
      data: { vehicle_id: vehicleId },
    });
    if (linkedPurchase.count === 0) {
      throw new ConflictException(
        'Vehicle purchase changed while receiving; please retry',
      );
    }

    const receivedPurchase = await tx.vehiclePurchase.findFirst({
      where: { id: purchaseId, tenant_id: tenantId, site_id: siteId },
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
    siteId: string,
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
        siteId,
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
