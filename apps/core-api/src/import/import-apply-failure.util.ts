import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  ImportApplyFailureReason,
  ImportJobFailureDetail,
} from './import-apply.errors.js';

/** Records one failure on the options, so a detail never outlives the failure that set it. */
export function importJobOptionsWithFailure(
  previousOptions: Prisma.JsonValue | null | undefined,
  failureReason: ImportApplyFailureReason,
  failure?: ImportJobFailureDetail,
): Prisma.InputJsonValue {
  const options: Record<string, unknown> = {
    ...((previousOptions as Record<string, unknown> | null) ?? {}),
    apply_failure_reason: failureReason,
  };
  delete options.apply_failure_code;
  delete options.apply_failure_message;
  if (failure) {
    options.apply_failure_code = failure.code;
    options.apply_failure_message = failure.message;
  }
  return options as Prisma.InputJsonValue;
}

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
    options_json: importJobOptionsWithFailure(job?.options_json, failureReason),
  };
}
