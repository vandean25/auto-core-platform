import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import { toRenderableInvoiceSnapshot } from './invoice-snapshot-render.adapter.js';
import { isInvoiceSnapshot } from './invoice-snapshot.validation.js';
import { isInvoiceSnapshotV2 } from './invoice-snapshot-v2.validation.js';

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
  if (
    isRecord(existingSnapshot) &&
    existingSnapshot.template_version === INVOICE_BRANDED_TEMPLATE_VERSION &&
    !isInvoiceSnapshotV2(existingSnapshot)
  ) {
    throw new ConflictException({
      code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      message: 'Frozen branding data for this invoice is unavailable.',
    });
  }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
