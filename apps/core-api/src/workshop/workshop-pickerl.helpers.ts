import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const PICKERL_TASK_TITLE = '§57a Begutachtung';
export const PICKERL_TEMPLATE_CODE = 'PICKERL_57A_PREP';

export function assertCanCreatePickerlOrder(role: string | undefined): void {
  if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'SALES') {
    throw new ForbiddenException(
      'Only OWNER, ADMIN, or SALES can create a §57a workshop order.',
    );
  }
}

export async function createPickerlTaskAndInspection(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
) {
  const template = await tx.inspectionTemplate.findFirst({
    where: {
      tenant_id: tenantId,
      code: PICKERL_TEMPLATE_CODE,
      version: 1,
      is_active: true,
    },
    include: {
      items: {
        where: { tenant_id: tenantId, is_active: true },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!template) {
    throw new NotFoundException(
      'The tenant has no active §57a preparation checklist template.',
    );
  }

  const task = await tx.workshopTask.create({
    data: {
      tenant_id: tenantId,
      workshop_order_id: orderId,
      title: PICKERL_TASK_TITLE,
    },
  });

  await tx.workshopInspection.create({
    data: {
      tenant_id: tenantId,
      workshop_order_id: orderId,
      workshop_task_id: task.id,
      inspection_template_id: template.id,
      title: template.title,
      items: {
        create: template.items.map((item) => ({
          inspection_template_item_id: item.id,
          label_snapshot: item.label,
          unit: item.unit,
        })),
      },
    },
  });

  return task;
}
