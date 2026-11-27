import { UnprocessableEntityException } from '@nestjs/common';
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
import { assertMarginSchemeSellerCountrySupported } from './margin-scheme-legal-notes.js';
import type { DocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import { buildDocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  type DisplayLanguage,
} from '../common/i18n/display-language.js';
import {
  calendarDateInTimeZone,
  DEFAULT_INVOICE_TIME_ZONE,
} from '../sales/helpers/invoice-number.helpers.js';

export const INVOICE_PAYMENT_TERMS_MISSING_CODE =
  'INVOICE_PAYMENT_TERMS_MISSING';

export function resolveInvoicePaymentTermsDays(
  customer: Pick<Customer, 'payment_terms_days'>,
  seller: { payment_terms_days?: number | null },
): number {
  const days = customer.payment_terms_days ?? seller.payment_terms_days;
  if (
    days === null ||
    days === undefined ||
    !Number.isInteger(days) ||
    days < 0
  ) {
    throw new UnprocessableEntityException({
      code: INVOICE_PAYMENT_TERMS_MISSING_CODE,
      message:
        'Payment terms days must be configured on the customer or legal entity before issuing an invoice.',
    });
  }

  return days;
}

export const INVOICE_SNAPSHOT_SCHEMA_VERSION = 2;
export const INVOICE_SNAPSHOT_TEMPLATE_VERSION = 'invoice-pdf-v1';
export const INVOICE_BRANDED_TEMPLATE_VERSION = 'invoice-brand-v1';
export const INVOICE_SNAPSHOT_COUNTRY_PROFILE_VERSION = 'legal-invoicing-v1';

export type InvoiceSnapshotV2Branding = {
  schema_version: 1;
  profile_id: string | null;
  profile_revision: number;
  preset_id: 'standard-v1';
  renderer_version: typeof INVOICE_BRANDED_TEMPLATE_VERSION;
  font_id: 'acp-sans-v1';
  tokens: {
    primary_color: string;
    secondary_color: string;
    header_band: 'none' | 'primary' | 'secondary';
    footer_band: 'none' | 'primary' | 'secondary';
    header_text: string;
    footer_text: string;
  };
  logo: null | {
    asset_id: string;
    bucket: string;
    key: string;
    generation: string;
    sha256: string;
    mime_type: 'image/png';
    width: number;
    height: number;
  };
  resolved_at: string;
};

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
  vat_calculation?: 'PER_RATE';
  rounding_amount?: string;
  margin?: InvoiceSnapshotV2Margin;
  branding?: InvoiceSnapshotV2Branding;
  total_net: string;
  total_tax: string;
  total_gross: string;
  notes: string | null;
  tax_mode: InvoiceTaxMode;
  snapshot_created_at: string;
} & Partial<DocumentSnapshotLocaleFields>;

type DecimalLike = Prisma.Decimal | number | string;

type LineAllocationInput = InvoiceBilledLineInput & {
  description: string;
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
  branding?: InvoiceSnapshotV2Branding;
  committedAt?: Date;
  documentLocale?: DisplayLanguage;
  legalTextVersion?: string | null;
  timeZone?: string;
};

const toMoney = (value: DecimalLike): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

const moneyString = (value: Prisma.Decimal): string => value.toFixed(2);

const quantityString = (value: Prisma.Decimal): string => value.toFixed(3);

export const halfUpTax = (
  net: Prisma.Decimal,
  rate: Prisma.Decimal,
): Prisma.Decimal =>
  net.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export function convertGrossUnitPriceToNet(
  grossUnitPrice: Prisma.Decimal,
  taxRate: Prisma.Decimal,
): Prisma.Decimal {
  return grossUnitPrice
    .div(new Prisma.Decimal(1).add(taxRate.div(100)))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function lineNetBeforeGlobalDiscount(
  line: Pick<
    InvoiceBilledLineInput,
    'quantity' | 'unitPrice' | 'lineDiscountType' | 'lineDiscountValue'
  >,
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

/** Line inputs for billed net after line and invoice-level discounts (snapshot parity). */
export type InvoiceBilledLineInput = {
  id: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  grossUnitPrice?: Prisma.Decimal | null;
  taxRate: Prisma.Decimal;
  lineDiscountType: DiscountType | null;
  lineDiscountValue: Prisma.Decimal | null;
};

export type InvoiceBilledLineAmounts = {
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
};

export type StandardInvoiceTotals = {
  totalNet: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalGross: Prisma.Decimal;
  roundingAmount: Prisma.Decimal;
};

function computeGrossPriceRounding(
  lines: readonly InvoiceBilledLineInput[],
  netForLine: (id: string) => Prisma.Decimal | undefined,
): Prisma.Decimal {
  const grossPricedNets: Array<{
    taxRate: Prisma.Decimal;
    net: Prisma.Decimal;
  }> = [];
  let targetGross = new Prisma.Decimal(0);
  for (const line of lines) {
    const net = netForLine(line.id)?.toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    if (line.grossUnitPrice == null || !net || net.isZero()) continue;
    const gross = line.quantity
      .mul(line.grossUnitPrice)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const originalNet = line.quantity
      .mul(line.unitPrice)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const netDiscount = originalNet.sub(net);
    targetGross = targetGross.add(
      gross.sub(netDiscount).sub(halfUpTax(netDiscount, line.taxRate)),
    );
    grossPricedNets.push({ taxRate: line.taxRate, net });
  }

  // Gross-priced lines contribute the rounding adjustment. VAT uses the full rate bucket.
  return buildTaxBreakdown(grossPricedNets).reduce(
    (remaining, bucket) => remaining.sub(bucket.gross),
    targetGross,
  );
}

/** Per-line net, half-up tax, and gross using the same rules as `buildInvoiceSnapshotV2`. */
export function computeStandardInvoiceBilledLineAmounts(
  lines: readonly InvoiceBilledLineInput[],
  globalDiscountType: DiscountType | null,
  globalDiscountValue: Prisma.Decimal | null,
): Map<string, InvoiceBilledLineAmounts> {
  const netByLine = allocateGlobalDiscount(
    lines.map((line) => ({
      id: line.id,
      description: '',
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      lineDiscountType: line.lineDiscountType,
      lineDiscountValue: line.lineDiscountValue,
      revenueGroupName: null,
      accountingAllocation: {
        profileCode: null,
        profileVersion: 0,
        sourceCategoryKey: '',
        sourceCategoryLabel: '',
        revenueAccount: '',
        debtorAccount: '',
        taxMode: 'STANDARD',
        taxRate: '0.00',
        taxTreatment: 'automatic',
        buKey: null,
        countryIso: 'AT',
        currency: 'EUR',
      },
    })),
    globalDiscountType,
    globalDiscountValue,
  );
  const amounts = new Map<string, InvoiceBilledLineAmounts>();
  for (const line of lines) {
    const net = netByLine.get(line.id) ?? new Prisma.Decimal(0);
    const tax = halfUpTax(net, line.taxRate);
    amounts.set(line.id, { net, tax, gross: net.add(tax) });
  }
  return amounts;
}

/** Invoice-level net, tax, and gross matching `buildInvoiceSnapshotV2` for STANDARD invoices. */
export function computeStandardInvoiceTotals(
  lines: readonly InvoiceBilledLineInput[],
  globalDiscountType: DiscountType | null = null,
  globalDiscountValue: Prisma.Decimal | null = null,
): StandardInvoiceTotals {
  const amounts = computeStandardInvoiceBilledLineAmounts(
    lines,
    globalDiscountType,
    globalDiscountValue,
  );
  const netByRate = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const entry = amounts.get(line.id);
    if (!entry) continue;
    const rateKey = moneyString(line.taxRate);
    const lineNet = entry.net.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    netByRate.set(
      rateKey,
      (netByRate.get(rateKey) ?? new Prisma.Decimal(0)).add(lineNet),
    );
  }
  let totalNet = new Prisma.Decimal(0);
  let totalTax = new Prisma.Decimal(0);
  for (const [rate, rateNet] of netByRate.entries()) {
    totalNet = totalNet.add(rateNet);
    totalTax = totalTax.add(halfUpTax(rateNet, toMoney(rate)));
  }
  const roundingAmount = computeGrossPriceRounding(
    lines,
    (id) => amounts.get(id)?.net,
  );
  return {
    totalNet,
    totalTax,
    totalGross: totalNet.add(totalTax).add(roundingAmount),
    roundingAmount,
  };
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
  }>,
): InvoiceSnapshotV2TaxBucket[] {
  const netByRate = new Map<string, Prisma.Decimal>();

  for (const item of items) {
    const rate = moneyString(item.taxRate);
    netByRate.set(
      rate,
      (netByRate.get(rate) ?? new Prisma.Decimal(0)).add(item.net),
    );
  }

  return [...netByRate.entries()]
    .sort(([left], [right]) => toMoney(left).comparedTo(toMoney(right)))
    .map(([rate, net]) => {
      const tax = halfUpTax(net, toMoney(rate));
      return {
        rate,
        net: moneyString(net),
        tax: moneyString(tax),
        gross: moneyString(net.add(tax)),
      };
    });
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

function buildCustomerSnapshot(
  customer: Customer,
): InvoiceSnapshotV2['customer'] {
  return {
    type: customer.type,
    company_name: customer.company_name ?? null,
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    vat_id: customer.vat_id ?? null,
    address_street: customer.address_street ?? null,
    address_city: customer.address_city ?? null,
    address_zip: customer.address_zip ?? null,
    address_country: customer.address_country ?? null,
  };
}

function buildSnapshotAmounts(
  invoice: Pick<Invoice, 'tax_mode' | 'total_gross'>,
  items: InvoiceSnapshotV2Item[],
  lineAllocations: LineAllocationInput[],
  netByLine: ReadonlyMap<string, Prisma.Decimal>,
): Pick<
  InvoiceSnapshotV2,
  | 'tax_breakdown'
  | 'vat_calculation'
  | 'rounding_amount'
  | 'total_net'
  | 'total_tax'
  | 'total_gross'
> {
  if (invoice.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    const gross = moneyString(toMoney(invoice.total_gross));
    return {
      tax_breakdown: [],
      total_net: gross,
      total_tax: '0.00',
      total_gross: gross,
    };
  }

  const taxBreakdown = buildTaxBreakdown(
    items.map((item) => ({
      taxRate: toMoney(item.tax_rate),
      net: toMoney(item.net),
    })),
  );
  const totalNet = taxBreakdown.reduce(
    (sum, bucket) => sum.add(toMoney(bucket.net)),
    new Prisma.Decimal(0),
  );
  const totalTax = taxBreakdown.reduce(
    (sum, bucket) => sum.add(toMoney(bucket.tax)),
    new Prisma.Decimal(0),
  );
  const roundingAmount = computeGrossPriceRounding(lineAllocations, (id) =>
    netByLine.get(id),
  );
  return {
    tax_breakdown: taxBreakdown,
    vat_calculation: 'PER_RATE',
    ...(!roundingAmount.isZero()
      ? { rounding_amount: moneyString(roundingAmount) }
      : {}),
    total_net: moneyString(totalNet),
    total_tax: moneyString(totalTax),
    total_gross: moneyString(totalNet.add(totalTax).add(roundingAmount)),
  };
}

export function buildInvoiceSnapshotV2(
  input: BuildInvoiceSnapshotV2Input,
): InvoiceSnapshotV2 {
  const {
    invoice,
    seller,
    siteId,
    legalEntityId,
    lineAllocations,
    margin,
    branding,
  } = input;
  const isMarginScheme = invoice.tax_mode === InvoiceTaxMode.MARGIN_SCHEME;
  if (isMarginScheme) {
    assertMarginSchemeSellerCountrySupported(seller.country_iso);
  }
  const committedAt = input.committedAt ?? new Date();
  const netByLine = allocateGlobalDiscount(
    lineAllocations,
    invoice.global_discount_type,
    invoice.global_discount_value,
  );

  const snapshotItems: InvoiceSnapshotV2Item[] = lineAllocations.map((line) => {
    const net = netByLine.get(line.id) ?? new Prisma.Decimal(0);

    const tax = isMarginScheme
      ? new Prisma.Decimal(0)
      : halfUpTax(net, line.taxRate);
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

  const supplyFrom = invoice.supply_date_from ?? invoice.date;
  const supplyTo = invoice.supply_date_to ?? supplyFrom;
  const paymentDays = resolveInvoicePaymentTermsDays(invoice.customer, seller);
  const timeZone = input.timeZone ?? DEFAULT_INVOICE_TIME_ZONE;

  const documentLocale = input.documentLocale ?? DEFAULT_DISPLAY_LANGUAGE;
  return {
    ...buildDocumentSnapshotLocaleFields(
      documentLocale,
      input.legalTextVersion,
    ),
    schema_version: INVOICE_SNAPSHOT_SCHEMA_VERSION,
    document_kind: 'INVOICE',
    template_version: branding
      ? INVOICE_BRANDED_TEMPLATE_VERSION
      : INVOICE_SNAPSHOT_TEMPLATE_VERSION,
    country_profile_version: INVOICE_SNAPSHOT_COUNTRY_PROFILE_VERSION,
    site_id: siteId,
    legal_entity_id: legalEntityId,
    currency: 'EUR',
    seller: buildSellerSnapshot(seller),
    customer: buildCustomerSnapshot(invoice.customer),
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
    date: calendarDateInTimeZone(invoice.date, timeZone),
    due_date: calendarDateInTimeZone(invoice.due_date, timeZone),
    supply_date_from: calendarDateInTimeZone(supplyFrom, timeZone),
    supply_date_to: calendarDateInTimeZone(supplyTo, timeZone),
    payment_terms: {
      days: paymentDays,
      text: seller.payment_terms_text ?? '',
    },
    items: snapshotItems,
    ...buildSnapshotAmounts(invoice, snapshotItems, lineAllocations, netByLine),
    ...(margin ? { margin } : {}),
    notes: invoice.notes ?? null,
    tax_mode: invoice.tax_mode,
    snapshot_created_at: committedAt.toISOString(),
    ...(branding ? { branding } : {}),
  };
}
