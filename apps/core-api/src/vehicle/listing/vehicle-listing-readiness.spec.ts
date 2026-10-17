import { UnprocessableEntityException } from '@nestjs/common';
import {
  VehicleInventoryRole,
  VehicleListingDesiredState,
  VehicleListingVatDisplay,
  VehicleStockStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  assertListingChannelActiveReadiness,
  listListingOfferFieldReadinessIssues,
} from './vehicle-listing-readiness.js';

import Decimal = Prisma.Decimal;

describe('assertListingChannelActiveReadiness', () => {
  const readyListing = {
    price_gross_eur: new Decimal('12000.00'),
    vat_display: VehicleListingVatDisplay.STANDARD,
    nova_included_confirmed: true,
    mandatory_fees_included_confirmed: true,
  };
  const readyVehicle = {
    inventory_role: VehicleInventoryRole.USED,
    stock_status: VehicleStockStatus.IN_STOCK,
  };

  it('allows INACTIVE without price confirmations', () => {
    expect(() =>
      assertListingChannelActiveReadiness(
        VehicleListingDesiredState.INACTIVE,
        {
          price_gross_eur: null,
          vat_display: null,
          nova_included_confirmed: false,
          mandatory_fees_included_confirmed: false,
        },
        readyVehicle,
      ),
    ).not.toThrow();
  });

  it('rejects ACTIVE when price or stock readiness is missing', () => {
    expect(() =>
      assertListingChannelActiveReadiness(
        VehicleListingDesiredState.ACTIVE,
        {
          ...readyListing,
          price_gross_eur: null,
        },
        readyVehicle,
      ),
    ).toThrow(UnprocessableEntityException);

    expect(() =>
      assertListingChannelActiveReadiness(
        VehicleListingDesiredState.ACTIVE,
        readyListing,
        {
          ...readyVehicle,
          stock_status: VehicleStockStatus.RESERVED,
        },
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('lists offer field issues even when channel is inactive', () => {
    const issues = listListingOfferFieldReadinessIssues({
      price_gross_eur: null,
      vat_display: null,
      nova_included_confirmed: false,
      mandatory_fees_included_confirmed: false,
    });
    expect(issues.map((row) => row.code)).toEqual([
      'LISTING_PRICE_REQUIRED',
      'LISTING_VAT_DISPLAY_REQUIRED',
      'LISTING_NOVA_CONFIRMATION_REQUIRED',
      'LISTING_MANDATORY_FEES_CONFIRMATION_REQUIRED',
    ]);
  });

  it('allows ACTIVE when all readiness checks pass', () => {
    expect(() =>
      assertListingChannelActiveReadiness(
        VehicleListingDesiredState.ACTIVE,
        readyListing,
        readyVehicle,
      ),
    ).not.toThrow();
  });
});
