import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma, WorkshopOrderStatus } from '@prisma/client';
import {
  assertInvoiceHasSourceDocument,
  type InvoiceSnapshotCommitService,
} from './invoice-snapshot-commit.service.js';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import { omitInvoiceSnapshot } from './invoice-response.mapper.js';
import { generateInvoiceNumber } from '../sales/helpers/invoice-number.helpers.js';

export function assertInvoiceEligibleForIssue(invoice: {
  status: InvoiceStatus;
  workshop_order_id: string | null;
  sales_order_id?: string | null;
  vehicle_sale_id?: string | null;
}): void {
  if (!invoice.workshop_order_id) {
    throw new BadRequestException('Invoice is not linked to a workshop order');
  }

  if (invoice.status !== InvoiceStatus.DRAFT) {
    throw new BadRequestException('Only DRAFT invoices can be issued');
  }

  assertInvoiceHasSourceDocument({
    status: invoice.status,
    workshop_order_id: invoice.workshop_order_id,
    sales_order_id: invoice.sales_order_id ?? null,
    vehicle_sale_id: invoice.vehicle_sale_id ?? null,
  });
}

export async function executeIssueInvoice(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    invoiceId: string;
    snapshotCommit: InvoiceSnapshotCommitService;
  },
) {
  const { tenantId, invoiceId, snapshotCommit } = params;

  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      customer: true,
      vehicle: true,
      workshop_order: true,
    },
  });

  if (!invoice) {
    throw new NotFoundException('Invoice not found');
  }

  assertInvoiceEligibleForIssue(invoice);

  const prepared = await snapshotCommit.prepareV2Snapshot({
    tx,
    tenantId,
    invoice,
    invoiceNumber: invoice.invoice_number ?? '',
  });

  const invoiceNumber =
    invoice.invoice_number ?? (await generateInvoiceNumber(tx, tenantId));

  await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
    id: invoiceId,
    tenantId,
    from: InvoiceStatus.DRAFT,
    to: InvoiceStatus.ISSUED,
    conflictMessage: 'Invoice was already transitioned by another request',
  });

  await tx.invoice.updateMany({
    where: { id: invoiceId, tenant_id: tenantId },
    data: {
      invoice_number: invoiceNumber,
    },
  });

  await snapshotCommit.persistV2Snapshot(tx, tenantId, invoiceId, prepared);

  await guardedStatusUpdate(bindStatusUpdateMany(tx.workshopOrder), {
    id: invoice.workshop_order_id!,
    tenantId,
    from: WorkshopOrderStatus.COMPLETED,
    to: WorkshopOrderStatus.INVOICED,
    conflictMessage:
      'Workshop order was already invoiced or is no longer COMPLETED',
  });

  const updated = await tx.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      customer: true,
      vehicle: true,
      workshop_order: true,
    },
  });

  if (!updated) {
    throw new NotFoundException('Invoice not found');
  }

  return omitInvoiceSnapshot({
    ...updated,
    vehicle: updated.vehicle
      ? stripVehicleIdentityResolutionState(updated.vehicle)
      : updated.vehicle,
  });
}
