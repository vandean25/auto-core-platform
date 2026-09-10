import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SaveDiagnosticsDto } from './dto/save-diagnostics.dto';

/**
 * Validates and accepts a pending voice note draft, returning its translated text.
 * Scoped to tenant, task, and mechanic employee.
 */
export async function processVoiceNoteDraft(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
  mechanicId: string,
  draftId: string,
): Promise<string> {
  const pendingDraft = await tx.workshopVoiceNoteDraft.findFirst({
    where: {
      id: draftId,
      tenant_id: tenantId,
      workshop_task_id: taskId,
      mechanic_employee_id: mechanicId,
      status: 'PENDING',
    },
    select: { id: true, translated_text: true },
  });

  if (!pendingDraft) {
    throw new NotFoundException(
      `Voice note draft ${draftId} not found or already accepted.`,
    );
  }

  const acceptedDraft = await tx.workshopVoiceNoteDraft.updateMany({
    where: {
      id: pendingDraft.id,
      tenant_id: tenantId,
      workshop_task_id: taskId,
      mechanic_employee_id: mechanicId,
      status: 'PENDING',
    },
    data: {
      status: 'ACCEPTED',
      accepted_at: new Date(),
      accepted_by_employee_id: mechanicId,
    },
  });

  if (acceptedDraft.count === 0) {
    throw new NotFoundException(
      `Voice note draft ${draftId} not found or already accepted.`,
    );
  }

  return pendingDraft.translated_text;
}

/**
 * Updates task mechanic notes within a transaction.
 */
export async function updateTaskNotes(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
  notes: string | null,
): Promise<void> {
  const taskUpdate = await tx.workshopTask.updateMany({
    where: { id: taskId, tenant_id: tenantId },
    data: { mechanic_notes: notes },
  });

  if (taskUpdate.count === 0) {
    throw new NotFoundException(`Task ${taskId} not found.`);
  }
}

/**
 * Validates inspection ownership and batch updates inspection items.
 */
export async function updateInspectionItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
  inspectionId: string,
  items: NonNullable<SaveDiagnosticsDto['inspectionItems']>,
): Promise<void> {
  const inspection = await tx.workshopInspection.findFirst({
    where: {
      id: inspectionId,
      tenant_id: tenantId,
      workshop_task_id: taskId,
    },
    select: { id: true },
  });

  if (!inspection) {
    throw new NotFoundException(
      `Inspection ${inspectionId} not found for task ${taskId}.`,
    );
  }

  const updateResults = await Promise.all(
    items.map((item) =>
      tx.workshopInspectionItem.updateMany({
        where: {
          id: item.itemId,
          tenant_id: tenantId,
          workshop_inspection_id: inspectionId,
        },
        data: {
          ...(item.responseValue !== undefined
            ? { response_value: item.responseValue }
            : {}),
          ...(item.passed !== undefined ? { passed: item.passed } : {}),
          ...(item.severity !== undefined ? { severity: item.severity } : {}),
          ...(item.notes !== undefined ? { notes: item.notes } : {}),
        },
      }),
    ),
  );

  const notFound = items.filter((_, i) => updateResults[i].count === 0);
  if (notFound.length > 0) {
    throw new NotFoundException(
      `Inspection item(s) not found: ${notFound.map((i) => i.itemId).join(', ')}.`,
    );
  }
}
