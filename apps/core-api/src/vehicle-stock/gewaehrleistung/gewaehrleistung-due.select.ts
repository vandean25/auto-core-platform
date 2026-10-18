import type { Prisma } from '@prisma/client';

/** Prisma select for gewaehrleistung-due rows (REST + MCP). */
export const gewaehrleistungDueSaleSelect = {
  id: true,
  sale_number: true,
  vehicle_id: true,
  customer_id: true,
  handed_over_at: true,
  gewaehrleistung_ends_on: true,
  presumption_ends_on: true,
  gewaehrleistung_rule_version: true,
  vehicle: {
    select: {
      id: true,
      make: true,
      model: true,
      year: true,
      vin: true,
      plate: true,
    },
  },
  customer: {
    select: {
      id: true,
      type: true,
      first_name: true,
      last_name: true,
      company_name: true,
    },
  },
} satisfies Prisma.VehicleSaleSelect;
