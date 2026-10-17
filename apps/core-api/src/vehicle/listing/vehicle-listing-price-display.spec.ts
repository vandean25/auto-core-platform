import { VehicleListingVatDisplay } from '@prisma/client';
import { buildVehicleListingPriceDisplay } from './vehicle-listing-price-display.js';

describe('buildVehicleListingPriceDisplay', () => {
  it('formats standard VAT with NoVA confirmation', () => {
    const display = buildVehicleListingPriceDisplay({
      price_gross_eur: '24990.50',
      vat_display: VehicleListingVatDisplay.STANDARD,
      nova_included_confirmed: true,
      mandatory_fees_included_confirmed: true,
    });
    expect(display).toEqual({
      price_gross_eur: '24990.50',
      vat_display: VehicleListingVatDisplay.STANDARD,
      consumer_hint_de: 'inkl. USt. und NoVA',
      nova_included_confirmed: true,
      mandatory_fees_included_confirmed: true,
    });
  });

  it('formats standard VAT without NoVA in the hint when not confirmed', () => {
    const display = buildVehicleListingPriceDisplay({
      price_gross_eur: '12000',
      vat_display: VehicleListingVatDisplay.STANDARD,
      nova_included_confirmed: false,
      mandatory_fees_included_confirmed: false,
    });
    expect(display.consumer_hint_de).toBe('inkl. USt.');
  });

  it('formats margin scheme with differenzbesteuert hint', () => {
    const display = buildVehicleListingPriceDisplay({
      price_gross_eur: '9999.99',
      vat_display: VehicleListingVatDisplay.MARGIN,
      nova_included_confirmed: false,
      mandatory_fees_included_confirmed: false,
    });
    expect(display).toEqual({
      price_gross_eur: '9999.99',
      vat_display: VehicleListingVatDisplay.MARGIN,
      consumer_hint_de: 'differenzbesteuert; USt. nicht gesondert ausweisbar',
      nova_included_confirmed: false,
      mandatory_fees_included_confirmed: false,
    });
  });

  it('returns null gross and hint when price is missing', () => {
    const display = buildVehicleListingPriceDisplay({
      price_gross_eur: null,
      vat_display: VehicleListingVatDisplay.STANDARD,
      nova_included_confirmed: true,
      mandatory_fees_included_confirmed: true,
    });
    expect(display.price_gross_eur).toBeNull();
    expect(display.consumer_hint_de).toBeNull();
  });
});
