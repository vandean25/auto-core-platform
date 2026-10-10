import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleAcquisitionKind,
  VehicleInventoryRole,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
  VehicleSaleStatus,
  VehicleStockStatus,
  type VehiclePurchase,
} from '@prisma/client';
import type { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto.js';
import {
  assertTradeInIsNotSoldVehicle,
  assertValidTradeInAllowance,
} from './vehicle-trade-in.js';

export const SELLABLE_STATUSES: VehicleStockStatus[] = [
  VehicleStockStatus.IN_STOCK,
  VehicleStockStatus.RESERVED,
];
export const SALE_STATE_CHANGED_MESSAGE =
  'Vehicle sale state or site changed concurrently. Please refresh.';
export const TRADE_IN_NO_LONGER_VALID_MESSAGE =
  'The trade-in vehicle is no longer valid for this sale. Please refresh.';

type VehicleSellability = {
  inventory_role: VehicleInventoryRole | null;
  stock_status: VehicleStockStatus | null;
  reserved_for_customer_id: string | null;
};

const isReservedForAnotherBuyer = (
  vehicle: VehicleSellability,
  buyerId: string,
): boolean => {
  if (vehicle.stock_status !== VehicleStockStatus.RESERVED) {
    return false;
  }
  return (
    Boolean(vehicle.reserved_for_customer_id) &&
    vehicle.reserved_for_customer_id !== buyerId
  );
};

/** Vehicle-side sellability: dealer stock, a sellable status, and not reserved for another buyer. */
export function assertVehicleIsSellable(
  vehicle: VehicleSellability,
  buyerId: string,
): void {
  if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
    throw new ConflictException('Vehicle is not dealer stock');
  }
  if (
    !vehicle.stock_status ||
    !SELLABLE_STATUSES.includes(vehicle.stock_status)
  ) {
    throw new ConflictException('Vehicle is not available for sale');
  }
  if (isReservedForAnotherBuyer(vehicle, buyerId)) {
    throw new ConflictException('Vehicle is reserved for a different customer');
  }
}

export type TradeInLinkSale = {
  trade_in_purchase_id: string | null;
  customer_id: string;
  sale_price: Prisma.Decimal;
  vehicle: { vin: string | null };
};

const isLiveCustomerTradeIn = (purchase: VehiclePurchase): boolean =>
  purchase.status !== VehiclePurchaseStatus.CANCELLED &&
  purchase.acquisition_kind === VehicleAcquisitionKind.TRADE_IN;

const isTradeInAtSale = (
  sale: TradeInLinkSale,
  purchase: VehiclePurchase,
  siteId: string,
): boolean =>
  purchase.seller_type === VehiclePurchaseSellerType.CUSTOMER &&
  purchase.customer_id === sale.customer_id &&
  purchase.site_id === siteId;

/**
 * Re-validates the attached trade-in at finalize: the sale may have changed since it was set.
 * Returns the trade-in purchase whose purchase_price is the allowance, or null without a trade-in.
 */
export function assertFinalizableTradeIn(
  sale: TradeInLinkSale,
  purchase: VehiclePurchase | null,
  siteId: string,
): VehiclePurchase | null {
  if (!sale.trade_in_purchase_id) {
    return null;
  }
  // A link that cannot be read at this site must not finalize as a sale without its trade-in.
  if (
    !purchase?.vin ||
    !isLiveCustomerTradeIn(purchase) ||
    !isTradeInAtSale(sale, purchase, siteId)
  ) {
    throw new ConflictException(TRADE_IN_NO_LONGER_VALID_MESSAGE);
  }
  assertValidTradeInAllowance(purchase.purchase_price, sale.sale_price);
  assertTradeInIsNotSoldVehicle(purchase.vin, sale.vehicle.vin);
  return purchase;
}

/** A trade-in attached to a draft blocks a buyer change and a sale price below its allowance. */
export function assertDraftTradeInCompatible(
  sale: { customer_id: string },
  dto: PatchVehicleSaleDto,
  tradeIn: VehiclePurchase | null,
): void {
  if (!tradeIn) {
    return;
  }
  if (dto.customer_id && dto.customer_id !== sale.customer_id) {
    throw new UnprocessableEntityException(
      'Remove the trade-in before changing the buyer of this sale',
    );
  }
  if (dto.sale_price !== undefined) {
    assertValidTradeInAllowance(
      tradeIn.purchase_price,
      new Prisma.Decimal(dto.sale_price),
    );
  }
}

/** A caller-supplied expected site must still match the sale's site when one is recorded. */
export function assertExpectedSaleSite(
  sale: { site_id: string | null },
  dto: Pick<PatchVehicleSaleDto, 'expectedSiteId'>,
): void {
  if (dto.expectedSiteId === undefined || !sale.site_id) {
    return;
  }
  if (dto.expectedSiteId !== sale.site_id) {
    throw new ConflictException(
      'Vehicle sale site changed concurrently. Please refresh.',
    );
  }
}

/** Scopes the draft update to a DRAFT still on the expected site, so a stale write matches nothing. */
export function buildDraftUpdateWhere(
  id: string,
  tenantId: string,
  sale: { site_id: string | null },
  dto: Pick<PatchVehicleSaleDto, 'expectedSiteId'>,
  isRetargeting: boolean,
): Prisma.VehicleSaleWhereInput {
  return {
    id,
    tenant_id: tenantId,
    status: VehicleSaleStatus.DRAFT,
    ...(isRetargeting && sale.site_id ? { site_id: sale.site_id } : {}),
    ...(dto.expectedSiteId ? { site_id: dto.expectedSiteId } : {}),
  };
}

export function buildDraftUpdateData(
  dto: PatchVehicleSaleDto,
  warrantyFields: Prisma.VehicleSaleUncheckedUpdateManyInput,
  targetSiteId: string | undefined,
  isRetargeting: boolean,
): Prisma.VehicleSaleUncheckedUpdateManyInput {
  const data: Prisma.VehicleSaleUncheckedUpdateManyInput = {
    customer_id: dto.customer_id,
    sale_price:
      dto.sale_price !== undefined
        ? new Prisma.Decimal(dto.sale_price)
        : undefined,
    ...warrantyFields,
  };
  if (isRetargeting) {
    data.site_id = targetSiteId;
  }
  return data;
}
