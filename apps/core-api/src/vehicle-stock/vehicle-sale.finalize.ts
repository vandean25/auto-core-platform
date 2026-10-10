import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
  VehicleSaleStatus,
  type VehiclePurchase,
} from '@prisma/client';
import { omitInvoiceSnapshot } from '../invoices/invoice-response.mapper.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import { omitKaufvertragArchiveInternals } from './kaufvertrag/kaufvertrag-sale-response.js';
import { costBasis, marginVatGross } from './vehicle-cost.js';
import {
  SALE_STATE_CHANGED_MESSAGE,
  assertFinalizableTradeIn,
} from './vehicle-sale.guards.js';
import {
  buildMarginSaleInvoiceLines,
  tradeInLineDescription,
} from './vehicle-trade-in.js';

export const DEFAULT_VAT_RATE = new Prisma.Decimal(20);
export const MARGIN_REVENUE_GROUP = 'Vehicle used (margin)';

export type FinalizeSale = Prisma.VehicleSaleGetPayload<{
  include: { vehicle: true; customer: true };
}>;

type LedgerEntries = Awaited<
  ReturnType<Prisma.TransactionClient['vehicleLedgerEntry']['findMany']>
>;

/** Loads the sale within a site scope, or throws NotFound. */
export async function findSaleForFinalize(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  siteId: string,
): Promise<FinalizeSale> {
  const sale = await tx.vehicleSale.findFirst({
    where: {
      id,
      tenant_id: tenantId,
      site_id: siteId,
      vehicle: { is: { tenant_id: tenantId, site_id: siteId } },
      customer: { is: { tenant_id: tenantId } },
    },
    include: { vehicle: true, customer: true },
  });
  if (!sale) {
    throw new NotFoundException(`Vehicle sale ${id} not found`);
  }
  return sale;
}

/** Re-reads the sale as a DRAFT under the lock site; a changed draft is a concurrency conflict. */
export async function findLockedDraftForFinalize(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  lockSiteId: string,
): Promise<FinalizeSale> {
  const lockedSale = await tx.vehicleSale.findFirst({
    where: {
      id,
      tenant_id: tenantId,
      site_id: lockSiteId,
      status: VehicleSaleStatus.DRAFT,
      vehicle: { is: { tenant_id: tenantId, site_id: lockSiteId } },
      customer: { is: { tenant_id: tenantId } },
    },
    include: { vehicle: true, customer: true },
  });
  if (!lockedSale) {
    throw new ConflictException(SALE_STATE_CHANGED_MESSAGE);
  }
  return lockedSale;
}

/** Ledger rows for the vehicle's cost basis, from the day it entered stock. */
export function findFinalizeLedgerEntries(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sale: FinalizeSale,
  persistedSiteId: string,
): Promise<LedgerEntries> {
  return tx.vehicleLedgerEntry.findMany({
    where: {
      tenant_id: tenantId,
      vehicle_id: sale.vehicle_id,
      vehicle: { is: { tenant_id: tenantId, site_id: persistedSiteId } },
      ...(sale.vehicle.stock_received_at
        ? { posting_date: { gte: sale.vehicle.stock_received_at } }
        : {}),
    },
  });
}

/**
 * Reads the attached trade-in after the guarded status update, so a concurrent trade-in save
 * (which takes the same site lock first) cannot change the link before the invoice is written.
 */
export async function loadFinalizableTradeIn(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sale: FinalizeSale,
  persistedSiteId: string,
): Promise<VehiclePurchase | null> {
  const tradeInPurchase = sale.trade_in_purchase_id
    ? await tx.vehiclePurchase.findFirst({
        where: {
          id: sale.trade_in_purchase_id,
          tenant_id: tenantId,
          site_id: persistedSiteId,
        },
      })
    : null;
  return assertFinalizableTradeIn(sale, tradeInPurchase, persistedSiteId);
}

/** Next RE-<year>-NNNN number for the tenant, taken from the per-year invoice sequence. */
export async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  const year = new Date().getFullYear();
  const prefix = `RE-${year}-`;
  const sequence = await tx.invoiceSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });
  return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
}

/** Numbers a finalized invoice once; a second number on the same invoice is a concurrency conflict. */
export async function assignInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceId: string,
): Promise<string> {
  const invoiceNumber = await generateInvoiceNumber(tx, tenantId);
  const invoiceNumberUpdate = await tx.invoice.updateMany({
    where: {
      id: invoiceId,
      tenant_id: tenantId,
      status: InvoiceStatus.FINALIZED,
      invoice_number: null,
    },
    data: { invoice_number: invoiceNumber },
  });
  if (invoiceNumberUpdate.count !== 1) {
    throw new ConflictException(
      'Invoice was already transitioned by another request',
    );
  }
  return invoiceNumber;
}

/** Margin figures for the sale: the cost basis, the margin VAT, the net amount and the snapshot. */
export function buildFinalizeFigures(
  sale: FinalizeSale,
  entries: LedgerEntries,
) {
  const basis = costBasis(entries);
  const vat = marginVatGross(sale.sale_price, basis, DEFAULT_VAT_RATE);
  return {
    basis,
    vat,
    net: sale.sale_price.sub(vat),
    description:
      `${sale.vehicle.year} ${sale.vehicle.make} ${sale.vehicle.model} VIN ${sale.vehicle.vin ?? ''}`.trim(),
    margin: {
      cost_basis: basis.toFixed(2),
      margin_tax: vat.toFixed(2),
      tax_rate: DEFAULT_VAT_RATE.toFixed(2),
      calculation_profile: 'vehicle-margin-v1',
    },
  };
}

export function buildMarginInvoiceData(input: {
  tenantId: string;
  posted: Pick<FinalizeSale, 'customer_id' | 'vehicle_id' | 'id'>;
  ownership: { siteId: string; legalEntityId: string };
  invoiceDate: Date;
  dueDate: Date;
  figures: { net: Prisma.Decimal; vat: Prisma.Decimal; description: string };
  salePrice: Prisma.Decimal;
  amountDue: Prisma.Decimal;
  tradeIn: VehiclePurchase | null;
}) {
  const invoiceLines = buildMarginSaleInvoiceLines({
    vehicleDescription: input.figures.description,
    salePrice: input.salePrice,
    taxRate: DEFAULT_VAT_RATE,
    revenueGroupName: MARGIN_REVENUE_GROUP,
    tradeIn: input.tradeIn
      ? {
          description: tradeInLineDescription(input.tradeIn),
          allowance: input.tradeIn.purchase_price,
        }
      : null,
  });
  return {
    tenant_id: input.tenantId,
    customer_id: input.posted.customer_id,
    vehicle_id: input.posted.vehicle_id,
    vehicle_sale_id: input.posted.id,
    site_id: input.ownership.siteId,
    legal_entity_id: input.ownership.legalEntityId,
    currency: 'EUR',
    tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
    status: InvoiceStatus.FINALIZED,
    invoice_number: null,
    date: input.invoiceDate,
    due_date: input.dueDate,
    total_net: input.figures.net,
    total_tax: input.figures.vat,
    total_gross: input.amountDue,
    items: {
      create: invoiceLines.map((line) => ({
        tenant_id: input.tenantId,
        ...line,
      })),
    },
  };
}

export type FinalizedInvoice = Prisma.InvoiceGetPayload<{
  include: { items: true; customer: true; vehicle: true };
}> & { invoice_number: string };

export function buildFinalizeResponse<Snapshot>(
  posted: FinalizeSale,
  invoiceWithNumber: FinalizedInvoice,
  snapshot: Snapshot,
) {
  return {
    ...omitKaufvertragArchiveInternals(posted),
    status: VehicleSaleStatus.INVOICED,
    vehicle: stripVehicleIdentityResolutionState(posted.vehicle),
    invoice: omitInvoiceSnapshot({
      ...invoiceWithNumber,
      vehicle: invoiceWithNumber.vehicle
        ? stripVehicleIdentityResolutionState(invoiceWithNumber.vehicle)
        : invoiceWithNumber.vehicle,
      snapshot,
    }),
  };
}
