import type { Prisma } from '@prisma/client';

/**
 * Typed shape of a WorkshopOrder with relations, as loaded for PDF rendering.
 * Mirrors the Prisma `include` used in WorkshopPdfService.generateNow().
 */
export type WorkshopOrderForPdf = {
  id: string;
  order_number: string;
  status: string;
  odometer: number;
  fuel_level: number;
  reported_issue: string | null;
  notes: string | null;
  customer: {
    type: string;
    first_name: string;
    last_name: string;
    company_name: string | null;
    phone: string | null;
    email: string | null;
    address_zip: string | null;
    address_city: string | null;
  } | null;
  vehicle: {
    make: string;
    model: string;
    year: number;
    vin: string | null;
    plate: string | null;
  };
  tasks: Array<{
    title: string;
    mechanic_notes: string | null;
    line_items: Array<{
      type: string;
      item_no: string | null;
      description: string;
      quantity: Prisma.Decimal | string | number;
    }>;
  }>;
};
