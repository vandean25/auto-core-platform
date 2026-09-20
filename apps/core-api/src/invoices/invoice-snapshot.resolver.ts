import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import { toRenderableInvoiceSnapshot } from './invoice-snapshot-render.adapter.js';
import { isInvoiceSnapshotV2 } from './invoice-snapshot-v2.validation.js';
import { isInvoiceSnapshot } from './invoice-snapshot.validation.js';

const COMMITTED_INVOICE_STATUSES = new Set<InvoiceStatus>([
  InvoiceStatus.FINALIZED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
  InvoiceStatus.CANCELLED,
]);

export async function resolveInvoiceSnapshot(
  prisma: PrismaService,
  invoiceId: string,
  existingSnapshot: unknown,
  tenantId: string,
): Promise<InvoiceSnapshot> {
  if (isInvoiceSnapshot(existingSnapshot)) {
    return existingSnapshot;
  }

  const invoice = await prisma.client.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId },
    select: {
      id: true,
      status: true,
      invoice_number: true,
      snapshot: true,
    },
  });

  if (!invoice) {
    throw new NotFoundException('Invoice not found');
  }

  const v2Renderable = toRenderableInvoiceSnapshot(
    existingSnapshot,
    invoice.invoice_number,
    invoice.id,
  );
  if (v2Renderable) {
    return v2Renderable;
  }

  if (isInvoiceSnapshotV2(existingSnapshot)) {
    const adapted = toRenderableInvoiceSnapshot(
      existingSnapshot,
      invoice.invoice_number,
      invoice.id,
    );
    if (adapted) {
      return adapted;
    }
  }

  if (COMMITTED_INVOICE_STATUSES.has(invoice.status)) {
    throw new ConflictException({
      code: 'LEGACY_SNAPSHOT_UNAVAILABLE',
      message:
        'Committed invoice has no renderable snapshot. Historical remediation is required.',
    });
  }

  throw new ConflictException({
    code: 'LEGACY_SNAPSHOT_UNAVAILABLE',
    message: 'Invoice snapshot is not available for rendering.',
  });
}
