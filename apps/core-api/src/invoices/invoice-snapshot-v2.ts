import {
  CustomerType,
  DiscountType,
  InvoiceTaxMode,
  Prisma,
  type Customer,
  type Invoice,
  type InvoiceItem,
  type LegalEntity,
  type Vehicle,
} from '@prisma/client';
import type { ResolvedAccountingAllocation } from '../finance/accounting-profile/accounting-profile.types.js';

export const INVOICE_SNAPSHOT_SCHEMA_VERSION = 2;
export const INVOICE_SNAPSHOT_TEMPLATE_VERSION = 'invoice-pdf-v1';
export const INVOICE_SNAPSHOT_COUNTRY_PROFILE_VERSION = 'legal-invoicing-v1';

export type InvoiceSnapshotV2Seller = {
  name: string;
  country_iso: 'AT' | 'DE';
  address_street: string;
  address_line2: string | null;
  address_zip: string;
  address_city: string;
  tax_number: string | null;
  vat_id: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  email: string | null;
  phone: string | null;
  registration_number: string | null;
  registration_court: string | null;
  representatives: string | null;
};

export type InvoiceSnapshotV2Item = {
  id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  line_discount_type: string | null;
  line_discount_value: string | null;
  net: string;
  tax: string;
  gross: string;
  revenue_group_name: string | null;
  accounting_allocation: ResolvedAccountingAllocation;
};

export type InvoiceSnapshotV2TaxBucket = {
  rate: string;
  net: string;
  tax: string;
  gross: string;
};

export type InvoiceSnapshotV2Margin = {
  cost_basis: string;
  margin_tax: string;
  tax_rate: string;
  calculation_profile: string;
};

export type InvoiceSnapshotV2 = {
  schema_version: typeof INVOICE_SNAPSHOT_SCHEMA_VERSION;
  document_kind: 'INVOICE';
  template_version: string;
  country_profile_version: string;
  site_id: string;
  legal_entity_id: string;
  currency: 'EUR';
  seller: InvoiceSnapshotV2Seller;
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
  date: string;
  due_date: string;
  supply_date_from: string;
  supply_date_to: string;
  payment_terms: {
    days: number;
    text: string;
  };
  items: InvoiceSnapshotV2Item[];
  tax_breakdown: InvoiceSnapshotV2TaxBucket[];
  margin?: InvoiceSnapshotV2Margin;
  total_net: string;
  total_tax: string;
  total_gross: string;
  notes: string | null;
  tax_mode: InvoiceTaxMode;
  snapshot_created_at: string;
};

type DecimalLike = Prisma.Decimal | number | string;

type LineAllocationInput = {
  id: string;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineDiscountType: DiscountType | null;
  lineDiscountValue: Prisma.Decimal | null;
  revenueGroupName: string | null;
  accountingAllocation: ResolvedAccountingAllocation;
};

type BuildInvoiceSnapshotV2Input = {
  invoice: Invoice & {
    items: InvoiceItem[];
    customer: Customer;
    vehicle: Vehicle | null;
  };
  seller: LegalEntity;
  siteId: string;
  legalEntityId: string;
  lineAllocations: LineAllocationInput[];
  margin?: InvoiceSnapshotV2Margin;
  committedAt?: Date;
};

const toMoney = (value: DecimalLike): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

const moneyString = (value: Prisma.Decimal): string => value.toFixed(2);

const quantityString = (value: Prisma.Decimal): string => value.toFixed(3);

const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const halfUpTax = (net: Prisma.Decimal, rate: Prisma.Decimal): Prisma.Decimal =>
  net.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

function lineNetBeforeGlobalDiscount(
  line: LineAllocationInput,
): Prisma.Decimal {
  const grossLine = line.quantity.mul(line.unitPrice);
  if (!line.lineDiscountType || line.lineDiscountValue === null) {
    return grossLine;
  }
  if (line.lineDiscountType === DiscountType.PERCENTAGE) {
    return grossLine.sub(
      grossLine.mul(line.lineDiscountValue).div(100).toDecimalPlaces(2),
    );
  }
  return Prisma.Decimal.max(
    grossLine.sub(line.lineDiscountValue),
    new Prisma.Decimal(0),
  );
}

function allocateGlobalDiscount(
  lines: LineAllocationInput[],
  globalDiscountType: DiscountType | null,
  globalDiscountValue: Prisma.Decimal | null,
): Map<string, Prisma.Decimal> {
  const preDiscount = lines.map((line) => ({
    id: line.id,
    amount: lineNetBeforeGlobalDiscount(line),
  }));
  const subtotal = preDiscount.reduce(
    (sum, line) => sum.add(line.amount),
    new Prisma.Decimal(0),
  );

  const allocations = new Map<string, Prisma.Decimal>();
  if (!globalDiscountType || globalDiscountValue === null || subtotal.lte(0)) {
    for (const line of preDiscount) {
      allocations.set(line.id, line.amount);
    }
    return allocations;
  }

  const discountTotal =
    globalDiscountType === DiscountType.PERCENTAGE
      ? subtotal.mul(globalDiscountValue).div(100).toDecimalPlaces(2)
      : Prisma.Decimal.min(globalDiscountValue, subtotal);

  const fractional = preDiscount.map((line) => {
    const share = subtotal.gt(0)
      ? line.amount.div(subtotal).mul(discountTotal)
      : new Prisma.Decimal(0);
    const floored = share.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
    return {
      id: line.id,
      preDiscount: line.amount,
      floored,
      remainder: share.sub(floored),
    };
  });

  let remainingCents = discountTotal
    .sub(
      fractional.reduce(
        (sum, line) => sum.add(line.floored),
        new Prisma.Decimal(0),
      ),
    )
    .mul(100)
    .toNumber();

  const sorted = [...fractional].sort((left, right) => {
    const remainderDiff = right.remainder.comparedTo(left.remainder);
    if (remainderDiff !== 0) {
      return remainderDiff;
    }
    return left.id.localeCompare(right.id);
  });

  const discountByLine = new Map<string, Prisma.Decimal>();
  for (const line of sorted) {
    const extra =
      remainingCents > 0 ? new Prisma.Decimal('0.01') : new Prisma.Decimal(0);
    if (remainingCents > 0) {
      remainingCents -= 1;
    }
    discountByLine.set(line.id, line.floored.add(extra));
  }

  for (const line of preDiscount) {
    const discount = discountByLine.get(line.id) ?? new Prisma.Decimal(0);
    allocations.set(line.id, line.amount.sub(discount));
  }

  return allocations;
}

function buildTaxBreakdown(
  items: Array<{
    taxRate: Prisma.Decimal;
    net: Prisma.Decimal;
    tax: Prisma.Decimal;
    gross: Prisma.Decimal;
  }>,
): InvoiceSnapshotV2TaxBucket[] {
  const buckets = new Map<string, InvoiceSnapshotV2TaxBucket>();

  for (const item of items) {
    const rate = moneyString(item.taxRate);
    const existing = buckets.get(rate) ?? {
      rate,
      net: '0.00',
      tax: '0.00',
      gross: '0.00',
    };
    buckets.set(rate, {
      rate,
      net: moneyString(toMoney(existing.net).add(item.net)),
      tax: moneyString(toMoney(existing.tax).add(item.tax)),
      gross: moneyString(toMoney(existing.gross).add(item.gross)),
    });
  }

  return [...buckets.values()].sort((left, right) =>
    toMoney(left.rate).comparedTo(toMoney(right.rate)),
  );
}

export function buildSellerSnapshot(
  seller: LegalEntity,
): InvoiceSnapshotV2Seller {
  return {
    name: seller.name,
    country_iso: seller.country_iso,
    address_street: seller.address_street ?? '',
    address_line2: seller.address_line2 ?? null,
    address_zip: seller.address_zip ?? '',
    address_city: seller.address_city ?? '',
    tax_number: seller.tax_number ?? null,
    vat_id: seller.vat_id ?? null,
    iban: seller.iban ?? null,
    bic: seller.bic ?? null,
    bank_name: seller.bank_name ?? null,
    email: seller.email ?? null,
    phone: seller.phone ?? null,
    registration_number: seller.registration_number ?? null,
    registration_court: seller.registration_court ?? null,
    representatives: seller.representatives ?? null,
  };
}

export function buildInvoiceSnapshotV2(
  input: BuildInvoiceSnapshotV2Input,
): InvoiceSnapshotV2 {
  const { invoice, seller, siteId, legalEntityId, lineAllocations, margin } =
    input;
  const committedAt = input.committedAt ?? new Date();
  const netByLine = allocateGlobalDiscount(
    lineAllocations,
    invoice.global_discount_type,
    invoice.global_discount_value,
  );

  const snapshotItems: InvoiceSnapshotV2Item[] = lineAllocations.map((line) => {
    const net = netByLine.get(line.id) ?? new Prisma.Decimal(0);
    const tax = halfUpTax(net, line.taxRate);
    const gross = net.add(tax);
    return {
      id: line.id,
      description: line.description,
      quantity: quantityString(line.quantity),
      unit_price: moneyString(line.unitPrice),
      tax_rate: moneyString(line.taxRate),
      line_discount_type: line.lineDiscountType,
      line_discount_value:
        line.lineDiscountValue === null
          ? null
          : moneyString(line.lineDiscountValue),
      net: moneyString(net),
      tax: moneyString(tax),
      gross: moneyString(gross),
      revenue_group_name: line.revenueGroupName,
      accounting_allocation: line.accountingAllocation,
    };
  });

  const totalNet = snapshotItems.reduce(
    (sum, item) => sum.add(toMoney(item.net)),
    new Prisma.Decimal(0),
  );
  const totalTax = snapshotItems.reduce(
    (sum, item) => sum.add(toMoney(item.tax)),
    new Prisma.Decimal(0),
  );
  const totalGross = snapshotItems.reduce(
    (sum, item) => sum.add(toMoney(item.gross)),
    new Prisma.Decimal(0),
  );

  const supplyFrom = invoice.supply_date_from ?? invoice.date;
  const supplyTo = invoice.supply_date_to ?? supplyFrom;
  const paymentDays = seller.payment_terms_days ?? 0;

  return {
    schema_version: INVOICE_SNAPSHOT_SCHEMA_VERSION,
    document_kind: 'INVOICE',
    template_version: INVOICE_SNAPSHOT_TEMPLATE_VERSION,
    country_profile_version: INVOICE_SNAPSHOT_COUNTRY_PROFILE_VERSION,
    site_id: siteId,
    legal_entity_id: legalEntityId,
    currency: 'EUR',
    seller: buildSellerSnapshot(seller),
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
    date: toDateOnly(invoice.date),
    due_date: toDateOnly(invoice.due_date),
    supply_date_from: toDateOnly(supplyFrom),
    supply_date_to: toDateOnly(supplyTo),
    payment_terms: {
      days: paymentDays,
      text: seller.payment_terms_text ?? '',
    },
    items: snapshotItems,
    tax_breakdown: buildTaxBreakdown(
      snapshotItems.map((item) => ({
        taxRate: toMoney(item.tax_rate),
        net: toMoney(item.net),
        tax: toMoney(item.tax),
        gross: toMoney(item.gross),
      })),
    ),
    ...(margin ? { margin } : {}),
    total_net: moneyString(totalNet),
    total_tax: moneyString(totalTax),
    total_gross: moneyString(totalGross),
    notes: invoice.notes ?? null,
    tax_mode: invoice.tax_mode,
    snapshot_created_at: committedAt.toISOString(),
  };
}
