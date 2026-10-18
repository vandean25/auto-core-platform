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
import { pickVehicleImportAuditSnapshot } from './vehicle-import-audit.snapshot.js';
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
import type { ImportJobOptions } from './import.types.js';
import { toImportFirstRegistrationDate } from './vehicle-import-apply-fields.js';

export type VehicleApplyContext = {
  tenantId: string;
  job: ImportApplyJob;
  actorUserId: string;
  audit: ImportAuditWriter;
};

type VehicleSnapshotFields = {
  make: string;
  model: string;
  year: number;
  vin: string | null;
  plate: string | null;
  mileage: number | null;
  color: string | null;
  key_number: string | null;
  customer_id: string | null;
  first_registration_date: Date | null;
};

function buildVehicleUpdateData(
  existing: VehicleSnapshotFields,
  payload: Record<string, unknown>,
  options: ImportJobOptions,
): Prisma.VehicleUncheckedUpdateInput {
  const data = assignImportUpdateFields(
    existing,
    [
      ['make', payload.make],
      ['model', payload.model],
      ['year', payload.year],
      ['vin', payload.vin],
      ['plate', payload.plate],
      ['mileage', payload.mileage],
      ['color', payload.color],
      ['key_number', payload.key_number],
      [
        'first_registration_date',
        toImportFirstRegistrationDate(payload.first_registration_date),
      ],
    ],
    options,
  );
  if (payload.owner_external_id_provided === true) {
    if (isBlankValue(payload.customer_id)) {
      data.customer_id = null;
    } else {
      Object.assign(
        data,
        assignImportUpdateFields(
          existing,
          [['customer_id', payload.customer_id]],
          options,
        ),
      );
    }
  }
  return data;
}

async function createVehicle(
  tx: Prisma.TransactionClient,
  ctx: VehicleApplyContext,
  externalId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const registrationDate = Object.hasOwn(payload, 'first_registration_date')
    ? toImportFirstRegistrationDate(payload.first_registration_date)
    : undefined;
  const created = await tx.vehicle.create({
    data: {
      tenant_id: ctx.tenantId,
      make: String(payload.make),
      model: String(payload.model),
      year: Number(payload.year),
      vin: payload.vin as string | null,
      plate: payload.plate as string | null,
      mileage: payload.mileage as number | null,
      color: payload.color as string | null,
      key_number: payload.key_number as string | null,
      customer_id: payload.customer_id as string | null,
      ...(registrationDate !== undefined
        ? { first_registration_date: registrationDate ?? null }
        : {}),
    },
  });
  await createExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.VEHICLE,
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
    'Vehicle',
    created.id,
    AuditLogAction.CREATE,
    null,
    pickVehicleImportAuditSnapshot(created),
  );
}

async function updateVehicle(
  tx: Prisma.TransactionClient,
  ctx: VehicleApplyContext,
  entityId: string,
  externalId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const before = await tx.vehicle.findFirst({
    where: { tenant_id: ctx.tenantId, id: entityId },
  });
  if (!before) {
    throw new ApplyRowStaleError();
  }
  const updateData = buildVehicleUpdateData(
    before,
    payload,
    (ctx.job.options_json as ImportJobOptions) ?? {},
  );
  const after = await tx.vehicle.update({
    where: { id: entityId },
    data: updateData,
  });
  await upsertExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.VEHICLE,
    ctx.job.source_system,
    externalId,
    after.id,
    ctx.job.id,
  );
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    'Vehicle',
    after.id,
    AuditLogAction.UPDATE,
    pickVehicleImportAuditSnapshot(before),
    pickVehicleImportAuditSnapshot(after),
  );
}

/** Writes one planned vehicle row. CREATE adds a vehicle, UPDATE changes an existing one. */
export async function applyVehicleImportRow(
  tx: Prisma.TransactionClient,
  ctx: VehicleApplyContext,
  row: ImportApplyRow,
): Promise<void> {
  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);
  delete payload.external_id;
  delete payload.owner_external_id_provided;

  if (row.action === ImportRowAction.CREATE) {
    await createVehicle(tx, ctx, externalId, payload);
    return;
  }
  if (row.action === ImportRowAction.UPDATE && row.entity_id) {
    await updateVehicle(tx, ctx, row.entity_id, externalId, payload);
  }
}
