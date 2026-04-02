import {
  CustomerType,
  Prisma,
  type Customer,
  type Invoice,
  type InvoiceItem,
  type Vehicle,
} from '@prisma/client';

export type InvoiceSnapshot = {
  id: string;
  invoice_number: string | null;
  date: string;
  due_date: string;

  total_net: string;
  total_tax: string;
  total_gross: string;
  notes: string | null;

  customer: {
    type: CustomerType;
    company_name: string | null;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    vat_id: string | null;
    address_street: string | null;
    address_city: string | null;
    address_zip: string | null;
    address_country: string | null;
  };

  vehicle: null | {
    make: string;
    model: string;
    year: number;
    engine_code: string | null;
    vin: string | null;
    plate: string | null;
  };

  items: Array<{
    description: string;
    quantity: string;
    unit_price: string;
    tax_rate: string;
    line_discount_type: string | null;
    line_discount_value: string | null;
    line_total: string | null;
    revenue_group_name: string | null;
  }>;

  snapshot_created_at: string;
};

type InvoiceForSnapshot = Invoice & {
  items: InvoiceItem[];
  customer: Customer;
  vehicle: Vehicle | null;
};

type DecimalLike = Prisma.Decimal | number | string;

const decimalToString = (value: DecimalLike): string => value.toString();

const optionalDecimalToString = (
  value: DecimalLike | null | undefined,
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return decimalToString(value);
};

export const buildInvoiceSnapshot = (
  invoice: InvoiceForSnapshot,
): InvoiceSnapshot => {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    date: invoice.date.toISOString(),
    due_date: invoice.due_date.toISOString(),

    total_net: decimalToString(invoice.total_net),
    total_tax: decimalToString(invoice.total_tax),
    total_gross: decimalToString(invoice.total_gross),
    notes: invoice.notes ?? null,

    customer: {
      type: invoice.customer.type,
      company_name: invoice.customer.company_name ?? null,
      first_name: invoice.customer.first_name,
      last_name: invoice.customer.last_name,
      email: invoice.customer.email ?? null,
      phone: invoice.customer.phone ?? null,
      vat_id: invoice.customer.vat_id ?? null,
      address_street: invoice.customer.address_street ?? null,
      address_city: invoice.customer.address_city ?? null,
      address_zip: invoice.customer.address_zip ?? null,
      address_country: invoice.customer.address_country ?? null,
    },

    vehicle: invoice.vehicle
      ? {
          make: invoice.vehicle.make,
          model: invoice.vehicle.model,
          year: invoice.vehicle.year,
          engine_code: invoice.vehicle.engine_code ?? null,
          vin: invoice.vehicle.vin ?? null,
          plate: invoice.vehicle.plate ?? null,
        }
      : null,

    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: decimalToString(item.quantity),
      unit_price: decimalToString(item.unit_price),
      tax_rate: decimalToString(item.tax_rate),
      line_discount_type: item.line_discount_type ?? null,
      line_discount_value: optionalDecimalToString(item.line_discount_value),
      line_total: optionalDecimalToString(item.line_total),
      revenue_group_name: item.revenue_group_name ?? null,
    })),

    snapshot_created_at: new Date().toISOString(),
  };
};
