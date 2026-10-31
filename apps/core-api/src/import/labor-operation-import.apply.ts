import {
  AuditLogAction,
  ImportEntityType,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import {
  ApplyRowStaleError,
  resolveImportExternalId,
} from './import-apply.errors.js';
import { pickLaborAuditSnapshot } from './import-audit.util.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import {
  createExternalMapping,
  upsertExternalMapping,
} from './import-external-id.store.js';
import type { ImportApplyJob, ImportApplyRow } from './import-type-handler.js';
import {
  assignImportUpdateFields,
  isBlankValue,
} from './import-update-data.util.js';
import type {
  ImportJobOptions,
  NormalizedLaborFitmentRow,
} from './import.types.js';

export type LaborApplyContext = {
  tenantId: string;
  job: ImportApplyJob;
  actorUserId: string;
  audit: ImportAuditWriter;
};

type LaborSnapshotFields = {
  code: string;
  description: string;
  standard_aw: Prisma.Decimal;
  hourly_rate: Prisma.Decimal;
  internal_cost: Prisma.Decimal | null;
  category_id: string | null;
};

function readFitment(
  payload: Record<string, unknown>,
): NormalizedLaborFitmentRow | null {
  const fitment = payload.fitment;
  if (!fitment || typeof fitment !== 'object') {
    return null;
  }
  const record = fitment as Record<string, unknown>;
  const make = typeof record.make === 'string' ? record.make.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  if (!make || !model) {
    return null;
  }
  const normalized: NormalizedLaborFitmentRow = { make, model };
  if ('year_from' in record) {
    normalized.year_from =
      record.year_from === null || record.year_from === undefined
        ? null
        : Number(record.year_from);
  }
  if ('year_to' in record) {
    normalized.year_to =
      record.year_to === null || record.year_to === undefined
        ? null
        : Number(record.year_to);
  }
  if ('engine_code' in record) {
    normalized.engine_code =
      typeof record.engine_code === 'string' ? record.engine_code : null;
  }
  return normalized;
}

async function ensureFitment(
  tx: Prisma.TransactionClient,
  laborOperationId: string,
  fitment: NormalizedLaborFitmentRow,
  options: ImportJobOptions,
): Promise<void> {
  const existing = await tx.laborFitment.findFirst({
    where: {
      labor_operation_id: laborOperationId,
      make: { equals: fitment.make, mode: 'insensitive' },
      model: { equals: fitment.model, mode: 'insensitive' },
    },
  });
  if (!existing) {
    await tx.laborFitment.create({
      data: {
        labor_operation_id: laborOperationId,
        make: fitment.make,
        model: fitment.model,
        year_from: fitment.year_from ?? null,
        year_to: fitment.year_to ?? null,
        engine_code: fitment.engine_code ?? null,
      },
    });
    return;
  }

  const updateData: Prisma.LaborFitmentUpdateInput = {};
  if (options.fill_empty_only === true) {
    if (existing.year_from === null && fitment.year_from !== null) {
      updateData.year_from = fitment.year_from;
    }
    if (existing.year_to === null && fitment.year_to !== null) {
      updateData.year_to = fitment.year_to;
    }
    if (isBlankValue(existing.engine_code) && fitment.engine_code) {
      updateData.engine_code = fitment.engine_code;
    }
  } else {
    if (fitment.year_from !== undefined) {
      updateData.year_from = fitment.year_from;
    }
    if (fitment.year_to !== undefined) {
      updateData.year_to = fitment.year_to;
    }
    if (fitment.engine_code !== undefined) {
      updateData.engine_code = fitment.engine_code;
    }
  }

  if (Object.keys(updateData).length > 0) {
    await tx.laborFitment.update({
      where: { id: existing.id },
      data: updateData,
    });
  }
}

function buildLaborUpdateData(
  existing: LaborSnapshotFields,
  payload: Record<string, unknown>,
  options: ImportJobOptions,
): Prisma.LaborOperationUpdateInput {
  const existingPlain = {
    code: existing.code,
    description: existing.description,
    standard_aw: Number(existing.standard_aw),
    hourly_rate: Number(existing.hourly_rate),
    internal_cost:
      existing.internal_cost !== null ? Number(existing.internal_cost) : null,
    category_id: existing.category_id,
  };
  return assignImportUpdateFields(
    existingPlain,
    [
      ['code', payload.code],
      ['description', payload.description],
      ['standard_aw', payload.standard_aw],
      ['hourly_rate', payload.hourly_rate],
      ['internal_cost', payload.internal_cost],
      ['category_id', payload.category_id],
    ],
    options,
  );
}

async function createLaborOperation(
  tx: Prisma.TransactionClient,
  ctx: LaborApplyContext,
  rowNo: number,
  externalId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const fitment = readFitment(payload);
  const created = await tx.laborOperation.create({
    data: {
      tenant_id: ctx.tenantId,
      code: String(payload.code),
      description: String(payload.description),
      standard_aw: payload.standard_aw as Prisma.Decimal | number,
      hourly_rate: payload.hourly_rate as Prisma.Decimal | number,
      internal_cost: (payload.internal_cost as number | null) ?? null,
      category_id: (payload.category_id as string | null) ?? null,
      fitments: fitment
        ? {
            create: [
              {
                make: fitment.make,
                model: fitment.model,
                year_from: fitment.year_from ?? null,
                year_to: fitment.year_to ?? null,
                engine_code: fitment.engine_code ?? null,
              },
            ],
          }
        : undefined,
    },
    include: { fitments: true },
  });
  await createExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.LABOR_OPERATION,
    ctx.job.source_system,
    externalId,
    created.id,
    ctx.job.id,
  );
  await tx.importJobRow?.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: ctx.tenantId,
        import_job_id: ctx.job.id,
        row_no: rowNo,
      },
    },
    data: { entity_id: created.id },
  });
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    'LaborOperation',
    created.id,
    AuditLogAction.CREATE,
    null,
    pickLaborAuditSnapshot(created),
  );
}

async function updateLaborOperation(
  tx: Prisma.TransactionClient,
  ctx: LaborApplyContext,
  rowNo: number,
  entityId: string,
  externalId: string,
  payload: Record<string, unknown>,
  options: ImportJobOptions,
): Promise<void> {
  const before = await tx.laborOperation.findFirst({
    where: { tenant_id: ctx.tenantId, id: entityId },
    include: { fitments: true },
  });
  if (!before) {
    throw new ApplyRowStaleError();
  }
  const updateData = buildLaborUpdateData(before, payload, options);
  await tx.laborOperation.update({
    where: { id: entityId },
    data: updateData,
  });
  const fitment = readFitment(payload);
  if (fitment) {
    await ensureFitment(tx, entityId, fitment, options);
  }
  const after = await tx.laborOperation.findFirst({
    where: { tenant_id: ctx.tenantId, id: entityId },
    include: { fitments: true },
  });
  if (!after) {
    throw new ApplyRowStaleError();
  }
  await upsertExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.LABOR_OPERATION,
    ctx.job.source_system,
    externalId,
    after.id,
    ctx.job.id,
  );
  await tx.importJobRow?.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: ctx.tenantId,
        import_job_id: ctx.job.id,
        row_no: rowNo,
      },
    },
    data: { before_snapshot_json: pickLaborAuditSnapshot(before) as any },
  });
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    'LaborOperation',
    after.id,
    AuditLogAction.UPDATE,
    pickLaborAuditSnapshot(before),
    pickLaborAuditSnapshot(after),
  );
}

/** Writes one planned labor operation row. */
export async function applyLaborOperationImportRow(
  tx: Prisma.TransactionClient,
  ctx: LaborApplyContext,
  row: ImportApplyRow,
): Promise<void> {
  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);
  const options = (ctx.job.options_json as ImportJobOptions) ?? {};
  delete payload.external_id;
  delete payload.category_name;

  if (row.action === ImportRowAction.CREATE) {
    await createLaborOperation(tx, ctx, row.row_no, externalId, payload);
    return;
  }
  if (row.action === ImportRowAction.UPDATE && row.entity_id) {
    await updateLaborOperation(
      tx,
      ctx,
      row.row_no,
      row.entity_id,
      externalId,
      payload,
      options,
    );
  }
}
