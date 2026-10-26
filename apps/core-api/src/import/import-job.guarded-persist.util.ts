import { ImportJobStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportJobTotals } from './import.types.js';

export async function persistImportJobApplyingTotals(
  prisma: PrismaService,
  jobId: string,
  totals: ImportJobTotals,
  guardedWrite: boolean,
) {
  if (guardedWrite) {
    await prisma.importJob.updateMany({
      where: { id: jobId, status: ImportJobStatus.APPLYING },
      data: { totals_json: totals },
    });
    return prisma.importJob.findFirst({ where: { id: jobId } });
  }
  return prisma.importJob.update({
    where: { id: jobId },
    data: { totals_json: totals, status: ImportJobStatus.APPLYING },
  });
}
