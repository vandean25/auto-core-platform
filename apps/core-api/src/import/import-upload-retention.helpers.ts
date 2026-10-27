import { ImportJobStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import { readUploadRef } from './import-job.worker-state.js';
import { readImportUploadRetentionDays } from './import-limits.js';

export type ImportUploadRetentionCounts = {
  jobs_scanned: number;
  uploads_deleted: number;
  dry_run: boolean;
};

export function importUploadRetentionCutoff(
  now: Date,
  retentionDays: number = readImportUploadRetentionDays(),
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

const TERMINAL_UPLOAD_STATUSES: ImportJobStatus[] = [
  ImportJobStatus.APPLIED,
  ImportJobStatus.CANCELLED,
  ImportJobStatus.FAILED,
];

export function buildTerminalImportUploadRetentionWhere(
  cutoff: Date,
): Prisma.ImportJobWhereInput {
  return {
    status: { in: TERMINAL_UPLOAD_STATUSES },
    OR: [
      {
        status: ImportJobStatus.APPLIED,
        appliedAt: { lt: cutoff },
      },
      {
        status: ImportJobStatus.FAILED,
        failed_at: { lt: cutoff },
      },
      {
        status: ImportJobStatus.CANCELLED,
        cancelled_at: { lt: cutoff },
      },
    ],
  };
}

export async function purgeStaleImportUploadsForTenant(
  prisma: PrismaService,
  tenantId: string,
  now: Date,
  purgeOptions: {
    dryRun?: boolean;
    deleteUpload?: (
      upload: NonNullable<ReturnType<typeof readUploadRef>>,
    ) => Promise<void>;
  } = {},
): Promise<ImportUploadRetentionCounts> {
  const cutoff = importUploadRetentionCutoff(now);
  const jobs = await prisma.importJob.findMany({
    where: {
      tenant_id: tenantId,
      ...buildTerminalImportUploadRetentionWhere(cutoff),
    },
    select: {
      id: true,
      options_json: true,
    },
    take: 200,
  });

  let uploadsDeleted = 0;
  for (const job of jobs) {
    const jobOptions = job.options_json as ImportJobOptionsWithWorker;
    const upload = readUploadRef(jobOptions);
    if (!upload) {
      continue;
    }
    uploadsDeleted += 1;
    if (purgeOptions.dryRun) {
      continue;
    }
    if (purgeOptions.deleteUpload) {
      await purgeOptions.deleteUpload(upload);
    }
    const cleared: ImportJobOptionsWithWorker = { ...jobOptions };
    delete cleared.upload;
    await prisma.importJob.update({
      where: { tenant_id: tenantId, id: job.id },
      data: {
        options_json: cleared,
      },
    });
  }

  return {
    jobs_scanned: jobs.length,
    uploads_deleted: uploadsDeleted,
    dry_run: purgeOptions.dryRun ?? false,
  };
}
