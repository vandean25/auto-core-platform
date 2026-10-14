import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

export async function generateNextWorkshopOrderNumber(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `WO-${currentYear}-`;

  await db.financeSettings.upsert({
    where: { tenant_id: tenantId },
    update: {},
    create: {
      tenant_id: tenantId,
      fiscal_year_start_month: 1,
      lock_date: null,
      next_invoice_number: 1001,
      invoice_prefix: 'RE-2026-',
      next_sales_order_number: 1001,
      sales_order_prefix: 'SO-2026-',
      next_workshop_order_number: 1,
      workshop_order_prefix: prefix,
    },
  });

  const settings = await db.financeSettings.update({
    where: { tenant_id: tenantId },
    data: {
      next_workshop_order_number: { increment: 1 },
      workshop_order_prefix: prefix,
    },
    select: {
      next_workshop_order_number: true,
    },
  });

  const paddedSequence = String(
    settings.next_workshop_order_number - 1,
  ).padStart(4, '0');
  return `${prefix}${paddedSequence}`;
}
