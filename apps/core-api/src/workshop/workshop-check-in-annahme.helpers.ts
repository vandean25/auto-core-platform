import type { Prisma } from '@prisma/client';
import {
  ANNAHME_CHECK_TEMPLATE_CODE,
  ANNAHME_CHECK_TEMPLATE_VERSION,
} from '../prisma/fixtures/annahme-check-inspection-template.fixture.js';

export async function ensureAnnahmeInspectionForOrder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<string | null> {
  const template = await tx.inspectionTemplate.findFirst({
    where: {
      tenant_id: tenantId,
      code: ANNAHME_CHECK_TEMPLATE_CODE,
      version: ANNAHME_CHECK_TEMPLATE_VERSION,
      is_active: true,
    },
    include: {
      items: {
        where: { tenant_id: tenantId, is_active: true },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!template || template.items.length === 0) {
    return null;
  }

  const existing = await tx.workshopInspection.findFirst({
    where: {
      tenant_id: tenantId,
      workshop_order_id: orderId,
      workshop_task_id: null,
      inspection_template_id: template.id,
    },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }

  const created = await tx.workshopInspection.create({
    data: {
      tenant_id: tenantId,
      workshop_order_id: orderId,
      workshop_task_id: null,
      inspection_template_id: template.id,
      title: template.title,
      items: {
        create: template.items.map((item) => ({
          tenant_id: tenantId,
          inspection_template_item_id: item.id,
          label_snapshot: item.label,
          unit: item.unit,
        })),
      },
    },
    select: { id: true },
  });

  return created.id;
}
