import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { rethrowAsConflict } from '../labor/labor-shared.helpers.js';
import { runPurchaseOrderCreateInSavepoint } from './purchase-order-create-savepoint.js';

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

export function formatPurchaseOrderNumber(
  year: number,
  suffix: number,
): string {
  return `PO-${year}-${suffix.toString().padStart(4, '0')}`;
}

async function maxPurchaseOrderSuffixForYear(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  year: number,
): Promise<number> {
  const sites = await tx.site.findMany({
    where: { tenant_id: tenantId },
    select: { id: true },
  });
  if (sites.length === 0) {
    return 0;
  }
  const siteIds = sites.map((site) => site.id);
  const prefix = `PO-${year}-`;
  const latest = await tx.purchaseOrder.findFirst({
    where: {
      tenant_id: tenantId,
      order_number: { startsWith: prefix },
      OR: [{ site_id: { in: siteIds } }, { site_id: null }],
    },
    orderBy: { order_number: 'desc' },
    select: { order_number: true },
  });
  const parsed = latest
    ? parsePurchaseOrderNumberSuffix(latest.order_number)
    : null;
  return parsed?.year === year ? parsed.suffix : 0;
}

/**
 * When no sequence row exists, seeds it from the highest PO-YYYY-NNNN suffix (one row)
 * without lowering an existing counter. Both statements are conflict-free: a concurrent
 * seed makes the insert a no-op (ON CONFLICT DO NOTHING) instead of a unique violation,
 * which would abort the surrounding transaction.
 */
export async function ensurePurchaseOrderSequenceRowForYear(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  year: number,
): Promise<void> {
  const existing = await tx.purchaseOrderSequence.findFirst({
    where: { tenant_id: tenantId, year },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  const maxSuffix = await maxPurchaseOrderSuffixForYear(tx, tenantId, year);
  await tx.purchaseOrderSequence.createMany({
    data: [{ tenant_id: tenantId, year, current: maxSuffix }],
    skipDuplicates: true,
  });
  await tx.purchaseOrderSequence.updateMany({
    where: { tenant_id: tenantId, year, current: { lt: maxSuffix } },
    data: { current: maxSuffix },
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
 * PO-YYYY-NNNN from the tenant/year counter. Seeds the sequence row once when missing,
 * then increments atomically. Retries on order_number unique collisions.
 */
export async function allocatePurchaseOrderNumber(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  await ensurePurchaseOrderSequenceRowForYear(tx, tenantId, year);
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
  const existing = await tx.purchaseOrderSequence.findFirst({
    where: { tenant_id: tenantId, year: parsed.year },
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
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const meta = error.meta ?? {};
  const target = meta.target;
  if (Array.isArray(target)) {
    return target.some(
      (field) =>
        field === 'order_number' ||
        (typeof field === 'string' && field.includes('order_number')),
    );
  }
  if (typeof target === 'string') {
    return target.includes('order_number');
  }
  if (
    typeof meta.constraint === 'string' &&
    meta.constraint.includes('order_number')
  ) {
    return true;
  }
  return meta.modelName === 'PurchaseOrder';
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
  for (
    let attempt = 0;
    attempt < MAX_ORDER_NUMBER_ALLOCATION_ATTEMPTS;
    attempt++
  ) {
    const orderNumber = await allocatePurchaseOrderNumber(tx, tenantId, now);
    try {
      return await runPurchaseOrderCreateInSavepoint(tx, attempt, () =>
        create(orderNumber),
      );
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
