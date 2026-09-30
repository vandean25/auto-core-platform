import {
  BadRequestException,
  ConflictException,
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
  VehicleStockStatus,
  VehicleTaxScheme,
} from '@prisma/client';
import {
  assertActiveTargetSiteMembership,
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
} from '../vehicle/vehicle-identity.util.js';
import type { CreateVehiclePurchaseDto } from './dto/create-vehicle-purchase.dto.js';
import type { PatchVehiclePurchaseDto } from './dto/patch-vehicle-purchase.dto.js';
import {
  assertTenantCustomerExists,
  assertTenantStorageLocationExists,
  assertTenantVendorExists,
} from './vehicle-stock-ref.validator.js';

export const ACTIVE_STOCK_STATUSES: VehicleStockStatus[] = [
  VehicleStockStatus.ON_ORDER,
  VehicleStockStatus.IN_STOCK,
  VehicleStockStatus.RESERVED,
  VehicleStockStatus.IN_PREP,
];

export function resolveSellerValidationTarget(
  dto: PatchVehiclePurchaseDto,
  current: {
    seller_type: VehiclePurchaseSellerType;
    vendor_id?: string | null;
    customer_id?: string | null;
  },
): CreateVehiclePurchaseDto {
  const nextSeller = dto.seller_type ?? current.seller_type;
  return {
    seller_type: nextSeller,
    vendor_id:
      dto.vendor_id !== undefined
        ? (dto.vendor_id ?? undefined)
        : (current.vendor_id ?? undefined),
    customer_id:
      dto.customer_id !== undefined
        ? (dto.customer_id ?? undefined)
        : (current.customer_id ?? undefined),
  } as CreateVehiclePurchaseDto;
}

export function assertSeller(dto: {
  seller_type: VehiclePurchaseSellerType;
  vendor_id?: string | null;
  customer_id?: string | null;
}): void {
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

export function validateRetargetingLot(
  loc: { site_id: string | null; type: LocationType } | null,
  targetSiteId: string,
): void {
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

export function assertDraftUpdatePreconditions(
  purchase: { status: VehiclePurchaseStatus; site_id: string | null },
  dto: PatchVehiclePurchaseDto,
  isRetargeting: boolean,
): void {
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
}

export function prepareDraftUpdateData(
  dto: PatchVehiclePurchaseDto,
): Prisma.VehiclePurchaseUncheckedUpdateManyInput {
  return {
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
    vin:
      dto.vin !== undefined
        ? normalizeVehicleIdentityValueOrNull(dto.vin)
        : undefined,
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
  };
}

export function buildLotStockPayload(
  purchase: {
    make: string;
    model: string;
    year: number;
    engine_code?: string | null;
    plate?: string | null;
    color?: string | null;
    mileage?: number | null;
    key_number?: string | null;
    registration_certificate_no?: string | null;
    site_id?: string | null;
    location_id?: string | null;
  },
  existingVehicle?: { plate: string | null } | null,
) {
  const resetIdentity =
    existingVehicle &&
    normalizeVehicleIdentityValue(existingVehicle.plate) !==
      normalizeVehicleIdentityValue(purchase.plate);

  return {
    make: purchase.make,
    model: purchase.model,
    year: purchase.year,
    engine_code: purchase.engine_code,
    plate: purchase.plate,
    color: purchase.color,
    mileage: purchase.mileage,
    key_number: purchase.key_number,
    registration_certificate_no: purchase.registration_certificate_no,
    site_id: purchase.site_id,
    location_id: purchase.location_id,
    customer_id: null,
    inventory_role: VehicleInventoryRole.USED,
    stock_status: VehicleStockStatus.IN_STOCK,
    tax_scheme: VehicleTaxScheme.MARGIN,
    ...(resetIdentity
      ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
      : {}),
  };
}

export interface LinkPurchaseParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  purchaseId: string;
  vehicleId: string;
}

export async function linkPurchaseToVehicleHelper(
  params: LinkPurchaseParams,
): Promise<Prisma.VehiclePurchaseGetPayload<object>> {
  const linkedPurchase = await params.tx.vehiclePurchase.updateMany({
    where: {
      id: params.purchaseId,
      tenant_id: params.tenantId,
      site_id: params.siteId,
    },
    data: { vehicle_id: params.vehicleId },
  });
  if (linkedPurchase.count === 0) {
    throw new ConflictException(
      'Vehicle purchase changed while receiving; please retry',
    );
  }

  const receivedPurchase = await params.tx.vehiclePurchase.findFirst({
    where: {
      id: params.purchaseId,
      tenant_id: params.tenantId,
      site_id: params.siteId,
    },
  });
  if (!receivedPurchase) {
    throw new NotFoundException(
      `Vehicle purchase ${params.purchaseId} not found`,
    );
  }
  return receivedPurchase;
}

export interface UpdateStockVehicleParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  existing: {
    id: string;
    plate: string | null;
    identity_resolution_generation: string | null;
    identity_resolution_token: string | null;
  };
  purchase: Prisma.VehiclePurchaseGetPayload<object>;
  vin: string;
}

export async function updateExistingStockVehicleHelper(
  params: UpdateStockVehicleParams,
): Promise<void> {
  const stockData = buildLotStockPayload(params.purchase, params.existing);
  const flipped = await params.tx.vehicle.updateMany({
    where: {
      id: params.existing.id,
      tenant_id: params.tenantId,
      vin: params.vin,
      plate: params.existing.plate,
      identity_resolution_generation:
        params.existing.identity_resolution_generation ?? null,
      identity_resolution_token:
        params.existing.identity_resolution_token ?? null,
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

export interface ExecuteDraftUpdateParams {
  tx: Prisma.TransactionClient;
  id: string;
  tenantId: string;
  purchase: { site_id: string | null; updatedAt: Date };
  targetSiteId?: string;
  isRetargeting: boolean;
  expectedSiteId?: string;
  data: Prisma.VehiclePurchaseUncheckedUpdateManyInput;
}

export async function executeDraftUpdateTx(
  params: ExecuteDraftUpdateParams,
): Promise<Prisma.VehiclePurchaseGetPayload<{ include: { customer: true } }> | null> {
  if (params.isRetargeting) {
    await lockSitesAndAssertActive(
      params.tx,
      params.tenantId,
      [params.purchase.site_id, params.targetSiteId].filter((s): s is string =>
        Boolean(s),
      ),
    );
  }

  const updated = await params.tx.vehiclePurchase.updateMany({
    where: {
      id: params.id,
      tenant_id: params.tenantId,
      status: VehiclePurchaseStatus.DRAFT,
      updatedAt: params.purchase.updatedAt,
      site_id: params.purchase.site_id,
      ...(params.expectedSiteId ? { site_id: params.expectedSiteId } : {}),
    },
    data: params.data,
  });

  if (updated.count === 0) {
    if (params.isRetargeting) {
      throw new ConflictException(
        'Vehicle purchase state or site changed concurrently. Please refresh.',
      );
    }
    throw new ConflictException('Only DRAFT purchases can be updated');
  }

  return params.tx.vehiclePurchase.findFirst({
    where: {
      id: params.id,
      tenant_id: params.tenantId,
      site_id: params.targetSiteId ?? params.purchase.site_id,
    },
    include: { customer: true },
  });
}

export async function validateRetargetingSiteAndLot(
  prisma: any,
  tenantContext: any,
  tenantId: string,
  targetSiteId: string,
  locationId?: string | null,
): Promise<void> {
  await assertActiveTargetSiteMembership(
    prisma,
    tenantContext,
    tenantId,
    targetSiteId,
  );

  if (!locationId) {
    throw new UnprocessableEntityException(
      'Destination lot must belong to target site',
    );
  }

  const loc = await prisma.storageLocation.findFirst({
    where: {
      id: locationId,
      tenant_id: tenantId,
      site_id: targetSiteId,
    },
    select: { site_id: true, type: true },
  });
  validateRetargetingLot(loc, targetSiteId);
}

export async function createNewStockVehicleHelper(
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

export async function resolveReceiveLocationIdHelper(
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

export async function validatePurchaseForReceiptHelper(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  siteId: string,
): Promise<Prisma.VehiclePurchaseGetPayload<object>> {
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

export async function upsertLotVehicleHelper(
  tx: Prisma.TransactionClient,
  tenantId: string,
  purchase: Prisma.VehiclePurchaseGetPayload<object>,
): Promise<string> {
  const locationId = await resolveReceiveLocationIdHelper(
    tx,
    tenantId,
    purchase,
  );
  const purchaseWithLot = { ...purchase, location_id: locationId };
  const vin = normalizeVehicleIdentityValueOrNull(purchase.vin);
  if (!vin) {
    return createNewStockVehicleHelper(tx, tenantId, purchaseWithLot, null);
  }

  const existing = await tx.vehicle.findFirst({
    where: { tenant_id: tenantId, vin },
  });
  if (!existing) {
    return createNewStockVehicleHelper(tx, tenantId, purchaseWithLot, vin);
  }

  await updateExistingStockVehicleHelper({
    tx,
    tenantId,
    existing,
    purchase: purchaseWithLot,
    vin,
  });
  return existing.id;
}

export function buildVehiclePurchaseQuery(
  tenantId: string,
  siteId: string | string[],
  search?: string,
  status?: VehiclePurchaseStatus,
): Prisma.VehiclePurchaseWhereInput {
  const trimmed = search?.trim();
  const siteFilter = Array.isArray(siteId) ? { in: siteId } : siteId;
  return {
    tenant_id: tenantId,
    site_id: siteFilter,
    ...(status ? { status } : {}),
    ...(trimmed
      ? {
          OR: [
            { vin: { contains: trimmed, mode: 'insensitive' } },
            { make: { contains: trimmed, mode: 'insensitive' } },
            { model: { contains: trimmed, mode: 'insensitive' } },
            { purchase_number: { contains: trimmed, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

export function buildVehiclePurchasePaginationMeta(
  total: number,
  page: number,
  limit: number,
) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    pageSize: limit,
    pageCount: totalPages,
  };
}

export function buildVehiclePurchaseCreateData(
  tenantId: string,
  siteId: string,
  purchaseNumber: string,
  dto: CreateVehiclePurchaseDto,
): Prisma.VehiclePurchaseUncheckedCreateInput {
  return {
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
  };
}

export function assertValidCreateLocation(
  loc: { site_id: string; type: LocationType } | null,
  siteId: string,
): void {
  if (!loc || loc.site_id !== siteId || loc.type !== LocationType.vehicle_lot) {
    throw new UnprocessableEntityException(
      'Location does not belong to the active site',
    );
  }
}

export function assertCanDeletePurchase(
  purchase: { status: VehiclePurchaseStatus } | null,
  ledgerCount: number,
  id: string,
): void {
  if (!purchase) {
    throw new NotFoundException(`Vehicle purchase ${id} not found`);
  }
  if (purchase.status !== VehiclePurchaseStatus.DRAFT) {
    throw new ConflictException('Only DRAFT purchases can be deleted');
  }
  if (ledgerCount > 0) {
    throw new ConflictException(
      'Vehicle purchase cannot be deleted because ledger entries exist',
    );
  }
}

export function formatPurchaseNumber(
  prefix: string,
  nextNumber: number,
): string {
  return `${prefix}${String(nextNumber - 1).padStart(4, '0')}`;
}

export async function assertTenantPurchaseRefs(
  prisma: any,
  tenantId: string,
  refs: {
    vendor_id?: string | null;
    customer_id?: string | null;
    location_id?: string | null;
  },
  siteId: string,
): Promise<void> {
  if (refs.vendor_id) {
    await assertTenantVendorExists(prisma, tenantId, refs.vendor_id);
  }
  if (refs.customer_id) {
    await assertTenantCustomerExists(prisma, tenantId, refs.customer_id);
  }
  if (refs.location_id) {
    await assertTenantStorageLocationExists(
      prisma,
      tenantId,
      siteId,
      refs.location_id,
    );
  }
}

export interface ExecuteReceivePurchaseParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  id: string;
  appendLedger: (params: {
    vehicleId: string;
    entryType: VehicleLedgerEntryType;
    amount: Prisma.Decimal;
    vehiclePurchaseId: string;
  }) => Promise<unknown>;
}

export async function executeReceivePurchaseTx(
  params: ExecuteReceivePurchaseParams,
): Promise<Prisma.VehiclePurchaseGetPayload<object>> {
  const draft = await params.tx.vehiclePurchase.findFirst({
    where: { id: params.id, tenant_id: params.tenantId, site_id: params.siteId },
    select: { site_id: true },
  });
  if (!draft) {
    throw new NotFoundException(`Vehicle purchase ${params.id} not found`);
  }
  const persistedSiteId = assertPersistedSiteId(
    draft.site_id,
    'Vehicle purchase site ownership is required',
  );
  await lockSitesAndAssertActive(params.tx, params.tenantId, [persistedSiteId]);

  const purchase = await validatePurchaseForReceiptHelper(
    params.tx,
    params.tenantId,
    params.id,
    persistedSiteId,
  );
  const vehicleId = await upsertLotVehicleHelper(
    params.tx,
    params.tenantId,
    purchase,
  );
  await params.appendLedger({
    vehicleId,
    entryType: VehicleLedgerEntryType.PURCHASE,
    amount: purchase.purchase_price,
    vehiclePurchaseId: purchase.id,
  });
  return linkPurchaseToVehicleHelper({
    tx: params.tx,
    tenantId: params.tenantId,
    siteId: persistedSiteId,
    purchaseId: purchase.id,
    vehicleId,
  });
}

export async function executeCancelDraftPurchase(
  prisma: any,
  tenantId: string,
  siteId: string,
  id: string,
): Promise<void> {
  const result = await prisma.vehiclePurchase.updateMany({
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
}

export async function executeDeleteDraftPurchase(
  prisma: any,
  tenantId: string,
  id: string,
): Promise<void> {
  const result = await prisma.vehiclePurchase.deleteMany({
    where: { id, tenant_id: tenantId, status: VehiclePurchaseStatus.DRAFT },
  });
  if (result.count === 0) {
    throw new ConflictException('Only DRAFT purchases can be deleted');
  }
}

export async function generateNextVehiclePurchaseNumber(
  prisma: any,
  tenantId: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const prefix = `VP-${year}-`;
  const settings = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
  return formatPurchaseNumber(prefix, settings.next_vehicle_purchase_number);
}

export interface ExecuteCreatePurchaseFlowParams {
  prisma: any;
  tenantId: string;
  siteId: string;
  dto: CreateVehiclePurchaseDto;
  purchaseNumber?: string;
}

export async function executeCreatePurchaseFlow(
  params: ExecuteCreatePurchaseFlowParams,
) {
  assertSeller(params.dto);
  await assertTenantPurchaseRefs(
    params.prisma,
    params.tenantId,
    params.dto,
    params.siteId,
  );

  if (params.dto.location_id) {
    const loc = await params.prisma.storageLocation.findFirst({
      where: {
        id: params.dto.location_id,
        tenant_id: params.tenantId,
        site_id: params.siteId,
      },
      select: { site_id: true, type: true },
    });
    assertValidCreateLocation(loc, params.siteId);
  }

  const purchaseNumber =
    params.purchaseNumber ??
    (await generateNextVehiclePurchaseNumber(
      params.prisma,
      params.tenantId,
    ));

  return params.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockSitesAndAssertActive(tx, params.tenantId, [params.siteId]);
    return tx.vehiclePurchase.create({
      data: buildVehiclePurchaseCreateData(
        params.tenantId,
        params.siteId,
        purchaseNumber,
        params.dto,
      ),
    });
  });
}

export async function executeFindAllPurchases(
  prisma: any,
  tenantId: string,
  siteId: string,
  page = 1,
  limit = 25,
  search?: string,
) {
  const where = buildVehiclePurchaseQuery(tenantId, siteId, search);
  const [data, total] = await Promise.all([
    prisma.vehiclePurchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.vehiclePurchase.count({ where }),
  ]);
  return {
    data,
    meta: buildVehiclePurchasePaginationMeta(total, page, limit),
  };
}

export async function executeFindOnePurchase(
  prisma: any,
  tenantId: string,
  authorizedSiteIds: string[],
  id: string,
) {
  const purchase = await prisma.vehiclePurchase.findFirst({
    where: { id, tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
    include: { customer: true },
  });
  if (!purchase) {
    throw new NotFoundException(`Vehicle purchase ${id} not found`);
  }
  return purchase;
}

export interface ExecuteDraftUpdateFlowParams {
  prisma: any;
  tenantContext: any;
  tenantId: string;
  siteId: string;
  id: string;
  purchase: any;
  dto: PatchVehiclePurchaseDto;
}

export async function executeDraftUpdateFlow(
  params: ExecuteDraftUpdateFlowParams,
) {
  const targetSiteId = params.dto.siteId ?? params.dto.site_id;
  const isRetargeting =
    targetSiteId !== undefined && targetSiteId !== params.purchase.site_id;

  assertDraftUpdatePreconditions(params.purchase, params.dto, isRetargeting);

  if (isRetargeting) {
    await validateRetargetingSiteAndLot(
      params.prisma,
      params.tenantContext,
      params.tenantId,
      targetSiteId,
      params.dto.location_id,
    );
  }

  assertSeller(resolveSellerValidationTarget(params.dto, params.purchase));
  await assertTenantPurchaseRefs(
    params.prisma,
    params.tenantId,
    {
      vendor_id: params.dto.vendor_id,
      customer_id: params.dto.customer_id,
      location_id: params.dto.location_id,
    },
    targetSiteId ?? params.siteId,
  );

  const data = prepareDraftUpdateData(params.dto);
  if (isRetargeting) {
    data.site_id = targetSiteId;
  }

  return params.prisma.$transaction((tx: Prisma.TransactionClient) =>
    executeDraftUpdateTx({
      tx,
      id: params.id,
      tenantId: params.tenantId,
      purchase: params.purchase,
      targetSiteId,
      isRetargeting,
      expectedSiteId: params.dto.expectedSiteId,
      data,
    }),
  );
}

export async function executeRemovePurchaseFlow(
  prisma: any,
  tenantId: string,
  siteId: string,
  id: string,
) {
  const purchase = await prisma.vehiclePurchase.findFirst({
    where: { id, tenant_id: tenantId, site_id: siteId },
    select: { id: true, status: true },
  });
  const ledgerCount = await prisma.vehicleLedgerEntry.count({
    where: { tenant_id: tenantId, vehicle_purchase_id: id },
  });
  assertCanDeletePurchase(purchase, ledgerCount, id);
  await executeDeleteDraftPurchase(prisma, tenantId, id);
  return { id };
}

