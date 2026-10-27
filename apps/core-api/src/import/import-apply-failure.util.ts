import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportApplyFailureReason } from './import-apply.errors.js';

export async function mergeImportJobApplyFailureReason(
  prisma: PrismaService,
  jobId: string,
  failureReason: ImportApplyFailureReason,
): Promise<{ options_json: Prisma.InputJsonValue }> {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId },
    select: { options_json: true },
  });
  return {
    options_json: {
      ...((job?.options_json as Record<string, unknown> | null) ?? {}),
      apply_failure_reason: failureReason,
    } as Prisma.InputJsonValue,
  };
}
