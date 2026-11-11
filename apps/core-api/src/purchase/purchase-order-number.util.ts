import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { rethrowAsConflict } from '../labor/labor-shared.helpers.js';

const PO_NUMBER_PATTERN = /^PO-(\d{4})-(\d{4})$/;
const MAX_ORDER_NUMBER_ALLOCATION_ATTEMPTS = 12;

export function parsePurchaseOrderNumberSuffix(
  orderNumber: string,
): { year: number; suffix: number } | null {
  const match = PO_NUMBER_PATTERN.exec(orderNumber);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), suffix: Number(match[2]) };
}

export function formatPurchaseOrderNumber(year: number, suffix: number): string {
  return `PO-${year}-${suffix.toString().padStart(4, '0')}`;
}

/**
 * Raises the tenant/year sequence to at least the max `PO-YYYY-NNNN` suffix already stored.
 */
export async function syncPurchaseOrderSequenceForYear(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  year: number,
): Promise<void> {
  const prefix = `PO-${year}-`;
  const rows = await tx.purchaseOrder.findMany({
    where: { tenant_id: tenantId, order_number: { startsWith: prefix } },
    select: { order_number: true },
  });
  let maxSuffix = 0;
  for (const row of rows) {
    const parsed = parsePurchaseOrderNumberSuffix(row.order_number);
    if (parsed?.year === year) {
      maxSuffix = Math.max(maxSuffix, parsed.suffix);
    }
  }
  if (maxSuffix <= 0) {
    return;
  }

  const existing = await tx.purchaseOrderSequence.findUnique({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    select: { current: true },
  });
  if (existing && existing.current >= maxSuffix) {
    return;
  }

  await tx.purchaseOrderSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: maxSuffix },
    create: { tenant_id: tenantId, year, current: maxSuffix },
  });
}

async function nextPurchaseOrderSuffix(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  year: number,
): Promise<number> {
  const sequence = await tx.purchaseOrderSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });
  return sequence.current;
}

/**
 * PO-YYYY-NNNN from the tenant/year counter. Syncs with existing orders, then
 * increments atomically. Retries on order_number unique collisions.
 */
export async function allocatePurchaseOrderNumber(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  await syncPurchaseOrderSequenceForYear(tx, tenantId, year);
  const suffix = await nextPurchaseOrderSuffix(tx, tenantId, year);
  return formatPurchaseOrderNumber(year, suffix);
}

export async function bumpPurchaseOrderSequencePastNumber(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  orderNumber: string,
): Promise<void> {
  const parsed = parsePurchaseOrderNumberSuffix(orderNumber);
  if (!parsed) {
    return;
  }
  const existing = await tx.purchaseOrderSequence.findUnique({
    where: {
      tenant_id_year: { tenant_id: tenantId, year: parsed.year },
    },
    select: { current: true },
  });
  const next = Math.max(existing?.current ?? 0, parsed.suffix);
  await tx.purchaseOrderSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year: parsed.year } },
    update: { current: next },
    create: { tenant_id: tenantId, year: parsed.year, current: next },
  });
}

export function isPurchaseOrderNumberConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.target as string[] | undefined)?.includes('order_number')
  );
}

/**
 * Allocates a PO number and runs create; on tenant order_number collision, bumps
 * the sequence past the taken suffix and retries inside the same transaction.
 */
export async function createPurchaseOrderWithAllocatedNumber<T>(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  now: Date,
  create: (orderNumber: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ALLOCATION_ATTEMPTS; attempt++) {
    const orderNumber = await allocatePurchaseOrderNumber(tx, tenantId, now);
    try {
      return await create(orderNumber);
    } catch (error) {
      if (isPurchaseOrderNumberConflict(error)) {
        await bumpPurchaseOrderSequencePastNumber(tx, tenantId, orderNumber);
        continue;
      }
      rethrowAsConflict(
        error,
        'A purchase order with this number already exists for the tenant.',
      );
    }
  }
  throw new ConflictException(
    'Could not allocate a unique purchase order number after several attempts.',
  );
}
