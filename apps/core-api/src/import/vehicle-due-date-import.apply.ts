import {
  AuditLogAction,
  ImportEntityType,
  ImportRowAction,
  Prisma,
  VehicleInspectionRecordSource,
  VehicleInspectionType,
  VehicleNoticeStatus,
  VehicleNoticeType,
  VehicleRecordSource,
} from '@prisma/client';
import { dateToDay, dayToDate } from '../vehicle/vehicle-party.writer.js';
import {
  ApplyRowStaleError,
  resolveImportExternalId,
} from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { createExternalMapping } from './import-external-id.store.js';
import type { ImportApplyJob, ImportApplyRow } from './import-type-handler.js';
import { assignImportUpdateFields } from './import-update-data.util.js';
import type { ImportJobOptions } from './import.types.js';

export type DueDateApplyContext = {
  tenantId: string;
  job: ImportApplyJob;
  actorUserId: string;
  audit: ImportAuditWriter;
};

const SERVICE_TITLE = 'Service';

type DuePayload = {
  kind: 'INSPECTION_57A' | 'SERVICE';
  vehicle_id: string;
  inspected_on?: string;
  plaketten_valid_until_year?: number;
  plaketten_valid_until_month?: number;
  station_name?: string | null;
  due_date?: string | null;
  due_mileage?: number | null;
  external_ref: string | null;
  notes: string | null;
};

async function assertVehicleInTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicleId: string,
): Promise<void> {
  const vehicle = await tx.vehicle.findFirst({
    where: { id: vehicleId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!vehicle) {
    throw new ApplyRowStaleError();
  }
}

async function recordCreate(
  tx: Prisma.TransactionClient,
  ctx: DueDateApplyContext,
  externalId: string,
  entityType: 'VehicleInspectionRecord' | 'VehicleNotice',
  created: { id: string },
  snapshot: Record<string, unknown>,
): Promise<void> {
  await createExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.VEHICLE_DUE_DATE,
    ctx.job.source_system,
    externalId,
    created.id,
    ctx.job.id,
  );
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    entityType,
    created.id,
    AuditLogAction.CREATE,
    null,
    snapshot,
  );
}

async function createInspection(
  tx: Prisma.TransactionClient,
  ctx: DueDateApplyContext,
  externalId: string,
  payload: DuePayload,
): Promise<void> {
  await assertVehicleInTenant(tx, ctx.tenantId, payload.vehicle_id);
  // No ExternalInspectionResult, no tolerance months: the CSV pair is the actual plate month.
  const created = await tx.vehicleInspectionRecord.create({
    data: {
      tenant_id: ctx.tenantId,
      vehicle_id: payload.vehicle_id,
      inspection_type: VehicleInspectionType.PICKERL_57A,
      inspected_on: dayToDate(payload.inspected_on as string) as Date,
      plaketten_valid_until_year: payload.plaketten_valid_until_year as number,
      plaketten_valid_until_month:
        payload.plaketten_valid_until_month as number,
      station_name: payload.station_name ?? null,
      notes: payload.notes,
      source: VehicleInspectionRecordSource.LEGACY_IMPORT,
    },
  });
  await recordCreate(tx, ctx, externalId, 'VehicleInspectionRecord', created, {
    vehicle_id: created.vehicle_id,
    inspected_on: dateToDay(created.inspected_on),
    plaketten_valid_until_year: created.plaketten_valid_until_year,
    plaketten_valid_until_month: created.plaketten_valid_until_month,
    source: created.source,
  });
}

async function createServiceNotice(
  tx: Prisma.TransactionClient,
  ctx: DueDateApplyContext,
  externalId: string,
  payload: DuePayload,
): Promise<void> {
  await assertVehicleInTenant(tx, ctx.tenantId, payload.vehicle_id);
  const created = await tx.vehicleNotice.create({
    data: {
      tenant_id: ctx.tenantId,
      vehicle_id: payload.vehicle_id,
      type: VehicleNoticeType.SERVICE_DUE,
      status: VehicleNoticeStatus.OPEN,
      title: SERVICE_TITLE,
      body: payload.notes,
      due_date: dayToDate(payload.due_date ?? null),
      due_mileage: payload.due_mileage ?? null,
      external_ref: payload.external_ref,
      source: VehicleRecordSource.LEGACY_IMPORT,
    },
  });
  await recordCreate(tx, ctx, externalId, 'VehicleNotice', created, {
    vehicle_id: created.vehicle_id,
    type: created.type,
    status: created.status,
    due_date: dateToDay(created.due_date),
    due_mileage: created.due_mileage,
    external_ref: created.external_ref,
  });
}

/** Updates an OPEN service notice only: a resolved notice is never reopened or overwritten. */
async function updateServiceNotice(
  tx: Prisma.TransactionClient,
  ctx: DueDateApplyContext,
  noticeId: string,
  payload: DuePayload,
  options: ImportJobOptions,
): Promise<void> {
  const before = await tx.vehicleNotice.findFirst({
    where: {
      id: noticeId,
      tenant_id: ctx.tenantId,
      type: VehicleNoticeType.SERVICE_DUE,
      status: VehicleNoticeStatus.OPEN,
    },
  });
  if (!before) {
    throw new ApplyRowStaleError();
  }
  const changes = assignImportUpdateFields(
    {
      due_date: dateToDay(before.due_date),
      due_mileage: before.due_mileage,
      body: before.body,
    },
    [
      ['due_date', payload.due_date],
      ['due_mileage', payload.due_mileage],
      ['body', payload.notes],
    ],
    options,
  );
  const { count } = await tx.vehicleNotice.updateMany({
    where: {
      id: noticeId,
      tenant_id: ctx.tenantId,
      status: VehicleNoticeStatus.OPEN,
    },
    data: {
      ...(changes.due_date !== undefined
        ? { due_date: dayToDate(changes.due_date as string) }
        : {}),
      ...(changes.due_mileage !== undefined
        ? { due_mileage: changes.due_mileage as number }
        : {}),
      ...(changes.body !== undefined ? { body: changes.body as string } : {}),
    },
  });
  if (count === 0) {
    throw new ApplyRowStaleError();
  }
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    'VehicleNotice',
    noticeId,
    AuditLogAction.UPDATE,
    { due_date: dateToDay(before.due_date), due_mileage: before.due_mileage },
    changes,
  );
}

/** Writes one planned vehicle due date row. Inspection evidence is never updated. */
export async function applyVehicleDueDateImportRow(
  tx: Prisma.TransactionClient,
  ctx: DueDateApplyContext,
  row: ImportApplyRow,
): Promise<void> {
  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);
  const due = payload as unknown as DuePayload;

  if (row.action === ImportRowAction.CREATE) {
    await (due.kind === 'SERVICE'
      ? createServiceNotice(tx, ctx, externalId, due)
      : createInspection(tx, ctx, externalId, due));
    return;
  }
  if (
    row.action === ImportRowAction.UPDATE &&
    row.entity_id &&
    due.kind === 'SERVICE'
  ) {
    const options = (ctx.job.options_json as ImportJobOptions | null) ?? {};
    await updateServiceNotice(tx, ctx, row.entity_id, due, options);
  }
}
