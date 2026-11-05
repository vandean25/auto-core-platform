import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ORDER_WITH_INVOICE_RELATIONS } from './workshop-intake-query.helpers.js';
import {
  assertActiveSiteMatch,
  type WorkshopIntakeServices,
} from './workshop-intake-update.helpers.js';
import type { UndoWorkshopOrderNotesDto } from './dto/undo-workshop-order-notes.dto.js';
import { assertPersistedSiteId } from '../site/document-retarget.helpers.js';
import {
  assertOrderEditable,
  type WorkshopOrderWithRelations,
} from './workshop-order.helpers.js';
import { assertWorkshopTaskWriteRole } from './workshop-task-scope.js';

export async function executeUndoWorkshopOrderNotes(
  services: WorkshopIntakeServices,
  id: string,
  dto: UndoWorkshopOrderNotesDto,
): Promise<WorkshopOrderWithRelations> {
  assertWorkshopTaskWriteRole(
    services.tenantContext,
    'Undoing workshop order notes',
  );

  const tenantId = await services.tenantContext.getTenantId();
  const activeSiteId = await services.siteContext.getSiteId();
  const authorizedSiteIds = await services.siteContext.listAuthorizedSiteIds();
  const expectedUpdatedAt = new Date(dto.expectedUpdatedAt);

  const existing = await services.prisma.workshopOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
    include: ORDER_WITH_INVOICE_RELATIONS,
  });
  if (!existing) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }

  assertOrderEditable(existing);
  const persistedSiteId = assertPersistedSiteId(
    existing.site_id,
    'Workshop order site ownership is required',
  );
  assertActiveSiteMatch(false, persistedSiteId, activeSiteId, id);

  return services.prisma.$transaction(async (tx) => {
    const updateResult = await tx.workshopOrder.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        site_id: persistedSiteId,
        updatedAt: expectedUpdatedAt,
      },
      data: {
        notes: dto.previousNotes ?? null,
      },
    });
    if (updateResult.count === 0) {
      throw new ConflictException(
        'Workshop order changed concurrently. Undo is no longer available.',
      );
    }

    return tx.workshopOrder.findFirstOrThrow({
      where: { id, tenant_id: tenantId, site_id: persistedSiteId },
      include: ORDER_WITH_INVOICE_RELATIONS,
    });
  });
}
