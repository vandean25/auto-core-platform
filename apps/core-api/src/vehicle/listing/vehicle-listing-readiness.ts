import { UnprocessableEntityException } from '@nestjs/common';
import {
  VehicleInventoryRole,
  VehicleListingDesiredState,
  VehicleListingVatDisplay,
  VehicleStockStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

import Decimal = Prisma.Decimal;

export interface ListingActiveReadinessListing {
  price_gross_eur: Decimal | null;
  vat_display: VehicleListingVatDisplay | null;
  nova_included_confirmed: boolean;
  mandatory_fees_included_confirmed: boolean;
}

export interface ListingActiveReadinessVehicle {
  inventory_role: VehicleInventoryRole;
  stock_status: VehicleStockStatus | null;
}

export type ListingReadinessFieldIssue = {
  field: string;
  message: string;
};

export function listListingActiveReadinessIssues(
  desiredState: VehicleListingDesiredState,
  listing: ListingActiveReadinessListing,
  vehicle: ListingActiveReadinessVehicle,
): ListingReadinessFieldIssue[] {
  if (desiredState !== VehicleListingDesiredState.ACTIVE) {
    return [];
  }

  const issues: ListingReadinessFieldIssue[] = [];

  if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
    issues.push({
      field: 'vehicle.inventory_role',
      message:
        'Vehicle must be dealer USED stock to activate a listing offer.',
    });
  }
  if (vehicle.stock_status !== VehicleStockStatus.IN_STOCK) {
    issues.push({
      field: 'vehicle.stock_status',
      message:
        'Vehicle stock status must be IN_STOCK to activate a listing offer.',
    });
  }
  if (!listing.price_gross_eur || listing.price_gross_eur.lte(0)) {
    issues.push({
      field: 'price_gross_eur',
      message: 'A gross asking price greater than zero is required.',
    });
  }
  if (!listing.vat_display) {
    issues.push({
      field: 'vat_display',
      message: 'VAT display (STANDARD or MARGIN) must be confirmed.',
    });
  }
  if (!listing.nova_included_confirmed) {
    issues.push({
      field: 'nova_included_confirmed',
      message: 'NoVA inclusion must be confirmed for an active offer.',
    });
  }
  if (!listing.mandatory_fees_included_confirmed) {
    issues.push({
      field: 'mandatory_fees_included_confirmed',
      message:
        'Mandatory fees inclusion must be confirmed for an active offer.',
    });
  }

  return issues;
}

export function assertListingChannelActiveReadiness(
  desiredState: VehicleListingDesiredState,
  listing: ListingActiveReadinessListing,
  vehicle: ListingActiveReadinessVehicle,
): void {
  const fieldIssues = listListingActiveReadinessIssues(
    desiredState,
    listing,
    vehicle,
  );
  if (fieldIssues.length > 0) {
    throw new UnprocessableEntityException({
      code: 'VEHICLE_LISTING_NOT_READY',
      message: 'Listing is not ready for an active marketplace offer.',
      issues: fieldIssues.map((row) => row.message),
      field_issues: fieldIssues,
    });
  }
}
