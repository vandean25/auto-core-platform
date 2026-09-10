import {
  Prisma,
  VehicleInventoryRole,
  VehiclePurchaseSellerType,
  VehicleStockStatus,
  VehicleTaxScheme,
} from '@prisma/client';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
} from '../vehicle/vehicle-identity.util';
import type { CreateVehiclePurchaseDto } from './dto/create-vehicle-purchase.dto';
import type { PatchVehiclePurchaseDto } from './dto/patch-vehicle-purchase.dto';

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
