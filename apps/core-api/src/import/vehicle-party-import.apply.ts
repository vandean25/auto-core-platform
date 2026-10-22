import {
  AuditLogAction,
  ImportEntityType,
  ImportRowAction,
  Prisma,
  VehiclePartyRole,
  VehicleRecordSource,
} from '@prisma/client';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import {
  addPartyInTx,
  dateToDay,
  updatePartyBoundsInTx,
  type PartyWriteContext,
} from '../vehicle/vehicle-party.writer.js';
import {
  ApplyRowStaleError,
  resolveImportExternalId,
} from './import-apply.errors.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { createExternalMapping } from './import-external-id.store.js';
import type { ImportApplyJob, ImportApplyRow } from './import-type-handler.js';
import type { ImportJobOptions } from './import.types.js';

export type PartyApplyContext = {
  tenantId: string;
  job: ImportApplyJob;
  actorUserId: string;
  audit: ImportAuditWriter;
};

type PartyPayload = {
  vehicle_id: string;
  customer_id: string;
  role: VehiclePartyRole;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
};

function auditSnapshot(party: {
  vehicle_id: string;
  customer_id: string;
  role: VehiclePartyRole;
  valid_from: Date | null;
  valid_to: Date | null;
}) {
  return {
    vehicle_id: party.vehicle_id,
    customer_id: party.customer_id,
    role: party.role,
    valid_from: dateToDay(party.valid_from),
    valid_to: dateToDay(party.valid_to),
  };
}

function writeContext(ctx: PartyApplyContext): PartyWriteContext {
  const options = (ctx.job.options_json as ImportJobOptions | null) ?? {};
  return {
    tenantId: ctx.tenantId,
    today: viennaIsoDay(new Date()),
    cutover: options.cutover_date,
  };
}

async function createParty(
  tx: Prisma.TransactionClient,
  ctx: PartyApplyContext,
  externalId: string,
  payload: PartyPayload,
): Promise<void> {
  const created = await addPartyInTx(
    tx,
    writeContext(ctx),
    payload.vehicle_id,
    {
      customer_id: payload.customer_id,
      role: payload.role,
      valid_from: payload.valid_from,
      valid_to: payload.valid_to,
      notes: payload.notes,
      source: VehicleRecordSource.LEGACY_IMPORT,
    },
  );
  await createExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.VEHICLE_PARTY,
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
    'VehicleParty',
    created.id,
    AuditLogAction.CREATE,
    null,
    auditSnapshot(created),
  );
}

async function updateParty(
  tx: Prisma.TransactionClient,
  ctx: PartyApplyContext,
  partyId: string,
  payload: PartyPayload,
): Promise<void> {
  const before = await tx.vehicleParty.findFirst({
    where: { id: partyId, tenant_id: ctx.tenantId },
  });
  if (!before) {
    throw new ApplyRowStaleError();
  }
  const after = await updatePartyBoundsInTx(
    tx,
    writeContext(ctx),
    payload.vehicle_id,
    partyId,
    payload,
  );
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    'VehicleParty',
    partyId,
    AuditLogAction.UPDATE,
    auditSnapshot(before),
    auditSnapshot(after),
  );
}

/** Writes one planned vehicle party row. */
export async function applyVehiclePartyImportRow(
  tx: Prisma.TransactionClient,
  ctx: PartyApplyContext,
  row: ImportApplyRow,
): Promise<void> {
  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);
  const party = payload as unknown as PartyPayload;

  if (row.action === ImportRowAction.CREATE) {
    await createParty(tx, ctx, externalId, party);
    return;
  }
  if (row.action === ImportRowAction.UPDATE && row.entity_id) {
    await updateParty(tx, ctx, row.entity_id, party);
  }
}
