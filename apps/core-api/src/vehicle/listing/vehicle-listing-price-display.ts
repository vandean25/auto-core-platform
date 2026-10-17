import { Prisma, VehicleListingVatDisplay } from '@prisma/client';

import Decimal = Prisma.Decimal;

export interface VehicleListingPriceDisplayInput {
  price_gross_eur: Decimal | string | number | null | undefined;
  vat_display: VehicleListingVatDisplay | null | undefined;
  nova_included_confirmed: boolean;
  mandatory_fees_included_confirmed: boolean;
}

export interface VehicleListingPriceDisplay {
  price_gross_eur: string | null;
  vat_display: VehicleListingVatDisplay | null;
  consumer_hint_de: string | null;
  nova_included_confirmed: boolean;
  mandatory_fees_included_confirmed: boolean;
}

function formatGrossAmount(
  value: Decimal | string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const decimal =
    value instanceof Decimal ? value : new Decimal(value.toString());
  if (!decimal.isFinite() || decimal.lte(0)) {
    return null;
  }
  return decimal.toFixed(2);
}

/**
 * Consumer-facing price display hints per marketplace-export spec (draft wording).
 * Gross amount is always all-in; margin scheme does not expose separate net/VAT lines.
 */
export function buildVehicleListingPriceDisplay(
  input: VehicleListingPriceDisplayInput,
): VehicleListingPriceDisplay {
  const gross = formatGrossAmount(input.price_gross_eur);
  const vatDisplay = input.vat_display ?? null;

  let consumerHint: string | null = null;
  if (gross && vatDisplay === VehicleListingVatDisplay.STANDARD) {
    const parts = ['inkl. USt.'];
    if (input.nova_included_confirmed) {
      parts.push('und NoVA');
    }
    consumerHint = parts.join(' ');
  } else if (gross && vatDisplay === VehicleListingVatDisplay.MARGIN) {
    consumerHint = 'differenzbesteuert; USt. nicht gesondert ausweisbar';
  }

  return {
    price_gross_eur: gross,
    vat_display: vatDisplay,
    consumer_hint_de: consumerHint,
    nova_included_confirmed: input.nova_included_confirmed,
    mandatory_fees_included_confirmed: input.mandatory_fees_included_confirmed,
  };
}
