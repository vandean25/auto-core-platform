import { UnprocessableEntityException } from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
  type Invoice,
} from '@prisma/client';
import {
  computeInvoiceBalance,
  type InvoiceBalanceInput,
} from '../finance/receivables/invoice-balance.js';
import { isInvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.validation.js';
import type { InvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.js';
import { SETTLEMENT_ERROR_CODES } from './settlement.constants.js';

const STANDARD_VAT = '20.00';

export function assertSettlementInvoiceSlice(
  invoice: Invoice,
): InvoiceSnapshotV2 {
  if (invoice.status !== InvoiceStatus.ISSUED) {
    throw settlementNotInSlice('Only ISSUED workshop invoices can be settled.');
  }
  if (!invoice.workshop_order_id) {
    throw settlementNotInSlice('Settlement is limited to workshop invoices.');
  }
  if (invoice.sales_order_id || invoice.vehicle_sale_id) {
    throw settlementNotInSlice(
      'Sales-order and vehicle-sale invoices are not in this settlement slice.',
    );
  }
  if (invoice.tax_mode !== InvoiceTaxMode.STANDARD) {
    throw settlementNotInSlice('Only STANDARD tax mode is supported.');
  }
  if (!invoice.currency || invoice.currency !== 'EUR') {
    throw new UnprocessableEntityException({
      code: SETTLEMENT_ERROR_CODES.CURRENCY_UNSUPPORTED,
      message: 'Settlement requires invoice currency EUR.',
    });
  }
  const snapshot = invoice.snapshot;
  if (!isInvoiceSnapshotV2(snapshot)) {
    throw settlementNotInSlice('Settlement requires invoice snapshot v2.');
  }
  assertSnapshotLines(snapshot, invoice.total_gross);
  return snapshot;
}

function assertSnapshotLines(
  snapshot: InvoiceSnapshotV2,
  totalGross: Prisma.Decimal,
): void {
  for (const line of snapshot.items) {
    if (line.tax_rate !== STANDARD_VAT) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.VAT_CONTAINER_UNSUPPORTED,
        message: 'Only 20.00% STANDARD lines are supported in this slice.',
      });
    }
  }
  const breakdownGross = snapshot.tax_breakdown.reduce(
    (acc, bucket) => acc.add(new Prisma.Decimal(bucket.gross)),
    new Prisma.Decimal(0),
  );
  const snapshotGross = new Prisma.Decimal(snapshot.total_gross);
  const payableGross = breakdownGross.add(snapshot.rounding_amount ?? 0);
  if (!payableGross.equals(totalGross) || !snapshotGross.equals(totalGross)) {
    throw new UnprocessableEntityException({
      code: SETTLEMENT_ERROR_CODES.SETTLEMENT_AMOUNT_MISMATCH,
      message: 'Invoice snapshot gross does not match total_gross.',
    });
  }
}

function settlementNotInSlice(message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOT_IN_SLICE,
    message,
  });
}

/**
 * Amount the cash desk collects: the shared outstanding value (same as bank
 * reconciliation). Refuses when nothing is outstanding or when credit notes
 * plus payments exceed the gross (no refund flow).
 */
export function resolveSettlementAmount(
  invoice: InvoiceBalanceInput,
): Prisma.Decimal {
  const balance = computeInvoiceBalance(invoice);
  if (balance.signedBalance.lt(0)) {
    throw nothingOutstanding(
      'Credit notes and payments exceed the invoice total; refunds are not part of settlement.',
    );
  }
  if (balance.outstanding.lte(0)) {
    throw nothingOutstanding('Nothing is outstanding on this invoice.');
  }
  return balance.outstanding;
}

function nothingOutstanding(message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: SETTLEMENT_ERROR_CODES.SETTLEMENT_NOTHING_OUTSTANDING,
    message,
  });
}
