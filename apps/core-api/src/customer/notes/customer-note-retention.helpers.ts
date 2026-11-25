import { createHash } from 'node:crypto';
import { CustomerNoteRetentionClass } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';

export function computeCustomerNoteRetainUntil(params: {
  retentionClass: CustomerNoteRetentionClass;
  now: Date;
  lastCustomerActivityAt?: Date | null;
  orderClosedAt?: Date | null;
}): Date {
  if (params.retentionClass === CustomerNoteRetentionClass.CLAIMS_3Y) {
    const base = params.orderClosedAt ?? params.now;
    const endYear = base.getUTCFullYear() + 3;
    return new Date(Date.UTC(endYear, 11, 31, 23, 59, 59, 999));
  }

  const baseMs = Math.max(
    params.now.getTime(),
    params.lastCustomerActivityAt?.getTime() ?? 0,
  );
  const base = new Date(baseMs);
  const target = new Date(base);
  target.setUTCFullYear(target.getUTCFullYear() + 3);
  return target;
}

export function hashCustomerNoteBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function isNoteProtectedFromErasure(note: {
  legal_hold: boolean;
  retention_class: CustomerNoteRetentionClass;
}): boolean {
  return (
    note.legal_hold ||
    note.retention_class === CustomerNoteRetentionClass.CLAIMS_3Y
  );
}

function recordLatestActivity(
  map: Map<string, Date>,
  customerId: string | null | undefined,
  candidate: Date | null | undefined,
): void {
  if (!customerId || !candidate) return;
  const current = map.get(customerId);
  if (!current || candidate.getTime() > current.getTime()) {
    map.set(customerId, candidate);
  }
}

export async function resolveLastCustomerActivityMap(
  prisma: PrismaService,
  tenantId: string,
  customerIds: readonly string[],
  siteIds: readonly string[],
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (customerIds.length === 0 || siteIds.length === 0) {
    return result;
  }

  const ids = [...new Set(customerIds)];
  const sites = [...new Set(siteIds)];
  const siteWhere = {
    tenant_id: tenantId,
    customer_id: { in: ids },
    site_id: { in: sites },
  };

  const [workshops, salesOrders, invoices, creditNotes, loaners] =
    await Promise.all([
      prisma.workshopOrder.groupBy({
        by: ['customer_id'],
        where: siteWhere,
        _max: { createdAt: true },
      }),
      prisma.salesOrder.groupBy({
        by: ['customer_id'],
        where: siteWhere,
        _max: { createdAt: true },
      }),
      prisma.invoice.groupBy({
        by: ['customer_id'],
        where: siteWhere,
        _max: { date: true },
      }),
      prisma.creditNote.findMany({
        where: {
          tenant_id: tenantId,
          site_id: { in: sites },
          original_invoice: { customer_id: { in: ids } },
        },
        select: {
          date: true,
          original_invoice: { select: { customer_id: true } },
        },
      }),
      prisma.loanerBooking.groupBy({
        by: ['customer_id'],
        where: {
          tenant_id: tenantId,
          customer_id: { in: ids },
          loaner_vehicle: { site_id: { in: sites } },
        },
        _max: { createdAt: true },
      }),
    ]);

  for (const row of workshops) {
    recordLatestActivity(result, row.customer_id, row._max.createdAt);
  }
  for (const row of salesOrders) {
    recordLatestActivity(result, row.customer_id, row._max.createdAt);
  }
  for (const row of invoices) {
    recordLatestActivity(result, row.customer_id, row._max.date);
  }
  for (const row of creditNotes) {
    recordLatestActivity(result, row.original_invoice.customer_id, row.date);
  }
  for (const row of loaners) {
    recordLatestActivity(result, row.customer_id, row._max.createdAt);
  }

  return result;
}

export async function resolveLastCustomerActivityAt(
  prisma: PrismaService,
  tenantId: string,
  customerId: string,
  siteIds: readonly string[],
): Promise<Date | null> {
  const map = await resolveLastCustomerActivityMap(
    prisma,
    tenantId,
    [customerId],
    siteIds,
  );
  return map.get(customerId) ?? null;
}
