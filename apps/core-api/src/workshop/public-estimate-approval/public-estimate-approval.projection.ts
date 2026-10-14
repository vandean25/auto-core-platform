import type { WorkshopEstimateSnapshot } from '../workshop-estimate-snapshot.js';

/**
 * What the public approval page shows. It is an allowlist over the frozen snapshot: the seller's bank details,
 * the customer's email and phone, the branding and the internal ids are never copied into the response
 * (ADR-0025 §7: the response projection is the estimate document fields only).
 */
export type PublicEstimateView = {
  document: {
    estimate_number: string;
    version: number;
    issued_at: string;
    valid_from: string;
    valid_until: string;
    validity_days: number;
    free_of_charge: boolean;
    price_display: WorkshopEstimateSnapshot['document']['price_display'];
  };
  seller: {
    name: string;
    address_street: string | null;
    address_zip: string | null;
    address_city: string | null;
    country_iso: string;
    vat_id: string | null;
    tax_number: string | null;
  };
  customer: {
    type: string;
    company_name: string | null;
    first_name: string;
    last_name: string;
    address_street: string | null;
    address_zip: string | null;
    address_city: string | null;
    address_country: string | null;
    vat_id: string | null;
  };
  vehicle: {
    make: string;
    model: string;
    plate: string | null;
    vin: string | null;
    year: number | null;
  };
  order: {
    order_number: string;
    odometer: number;
  };
  lines: Array<{
    type: string;
    item_no: string;
    description: string;
    quantity: string;
    unit_price: string;
    tax_rate: string;
    net: string;
    tax: string;
    gross: string;
  }>;
  totals: WorkshopEstimateSnapshot['totals'];
  legal: WorkshopEstimateSnapshot['legal'];
};

export function projectPublicEstimate(
  snapshot: WorkshopEstimateSnapshot,
): PublicEstimateView {
  const { document, seller, customer, vehicle, order, lines, totals, legal } =
    snapshot;
  return {
    document: {
      estimate_number: document.estimate_number,
      version: document.version,
      issued_at: document.issued_at,
      valid_from: document.valid_from,
      valid_until: document.valid_until,
      validity_days: document.validity_days,
      free_of_charge: document.free_of_charge,
      price_display: document.price_display,
    },
    seller: {
      name: seller.name,
      address_street: seller.address_street ?? null,
      address_zip: seller.address_zip ?? null,
      address_city: seller.address_city ?? null,
      country_iso: seller.country_iso,
      vat_id: seller.vat_id ?? null,
      tax_number: seller.tax_number ?? null,
    },
    customer: {
      type: customer.type,
      company_name: customer.company_name ?? null,
      first_name: customer.first_name,
      last_name: customer.last_name,
      address_street: customer.address_street ?? null,
      address_zip: customer.address_zip ?? null,
      address_city: customer.address_city ?? null,
      address_country: customer.address_country ?? null,
      vat_id: customer.vat_id ?? null,
    },
    vehicle: {
      make: vehicle.make,
      model: vehicle.model,
      plate: vehicle.plate,
      vin: vehicle.vin,
      year: vehicle.year,
    },
    order: {
      order_number: order.order_number,
      odometer: order.odometer,
    },
    lines: lines.map((line) => ({
      type: line.type,
      item_no: line.item_no,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      tax_rate: line.tax_rate,
      net: line.net,
      tax: line.tax,
      gross: line.gross,
    })),
    totals,
    legal,
  };
}
