import { UnprocessableEntityException } from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
  type Invoice,
} from '@prisma/client';
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
  let sum = new Prisma.Decimal(0);
  for (const line of snapshot.items) {
    if (line.tax_rate !== STANDARD_VAT) {
      throw new UnprocessableEntityException({
        code: SETTLEMENT_ERROR_CODES.VAT_CONTAINER_UNSUPPORTED,
        message: 'Only 20.00% STANDARD lines are supported in this slice.',
      });
    }
    sum = sum.add(new Prisma.Decimal(line.gross));
  }
  if (!sum.equals(totalGross)) {
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
