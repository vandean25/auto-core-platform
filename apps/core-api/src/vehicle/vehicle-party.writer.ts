import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  VehiclePartyRole,
  VehicleRecordSource,
  type VehicleParty,
} from '@prisma/client';
import {
  findPartyConflict,
  isActiveOn,
  selectActiveOwner,
  validatePartyShape,
  type PartyInterval,
  type PartyRuleViolation,
} from './vehicle-party.rules.js';
import { dateToDay, dayToDate } from './vehicle-party-date.util.js';

/**
 * Every write here runs inside the caller's transaction and starts with a row lock on the
 * vehicle, so the overlap check and the main-contact sync see a timeline nobody else is editing.
 */
export type PartyWriteContext = {
  tenantId: string;
  /** `YYYY-MM-DD` day in the workshop's time zone. */
  today: string;
  /** Migration cutover day. Only the importer sets it. */
  cutover?: string;
};

export type NewParty = {
  customer_id: string;
  role: VehiclePartyRole;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  source: VehicleRecordSource;
};

export function toPartyInterval(
  row: VehicleParty,
): PartyInterval & { id: string } {
  return {
    id: row.id,
    role: row.role,
    customer_id: row.customer_id,
    valid_from: dateToDay(row.valid_from),
    valid_to: dateToDay(row.valid_to),
  };
}

export function violationToException(violation: PartyRuleViolation) {
  // Message only: stable HTTP error codes need DE/EN catalog entries, which come with the UI slice.
  return new UnprocessableEntityException(violation.message);
}

function overlapException(candidate: PartyInterval) {
  return new ConflictException(
    `${candidate.role} overlaps an existing party interval on this vehicle`,
  );
}

/**
 * Takes the per-vehicle write lock. A typed UPDATE holds the row lock until the transaction
 * ends, which serializes party writes the same way SELECT ... FOR UPDATE would, without raw SQL.
 */
export async function lockVehicleForPartyWrite(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicleId: string,
): Promise<void> {
  const { count } = await tx.vehicle.updateMany({
    where: { id: vehicleId, tenant_id: tenantId },
    data: { updatedAt: new Date() },
  });
  if (count === 0) {
    throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
  }
}

async function loadTimeline(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicleId: string,
): Promise<VehicleParty[]> {
  return tx.vehicleParty.findMany({
    where: { tenant_id: tenantId, vehicle_id: vehicleId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function assertCustomerInTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!customer) {
    throw new NotFoundException(`Customer with ID ${customerId} not found`);
  }
}

async function createPartyRow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicleId: string,
  input: NewParty,
): Promise<VehicleParty> {
  try {
    return await tx.vehicleParty.create({
      data: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        customer_id: input.customer_id,
        role: input.role,
        valid_from: dayToDate(input.valid_from),
        valid_to: dayToDate(input.valid_to),
        notes: input.notes,
        source: input.source,
      },
    });
  } catch (error) {
    // The partial unique index is the backstop for the service check above.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw overlapException({ ...input });
    }
    throw error;
  }
}

/** Overlap check, insert and main-contact sync. The vehicle row is already locked. */
async function insertLockedParty(
  tx: Prisma.TransactionClient,
  ctx: PartyWriteContext,
  vehicleId: string,
  input: NewParty,
): Promise<VehicleParty> {
  const existing = (await loadTimeline(tx, ctx.tenantId, vehicleId)).map(
    toPartyInterval,
  );
  if (findPartyConflict(existing, input)) {
    throw overlapException(input);
  }
  const created = await createPartyRow(tx, ctx.tenantId, vehicleId, input);
  if (
    created.role === VehiclePartyRole.OWNER &&
    isActiveOn(toPartyInterval(created), ctx.today)
  ) {
    await tx.vehicle.updateMany({
      where: { id: vehicleId, tenant_id: ctx.tenantId },
      data: { customer_id: created.customer_id },
    });
  }
  return created;
}

export async function addPartyInTx(
  tx: Prisma.TransactionClient,
  ctx: PartyWriteContext,
  vehicleId: string,
  input: NewParty,
): Promise<VehicleParty> {
  const violation = validatePartyShape(input, ctx);
  if (violation) {
    throw violationToException(violation);
  }
  await lockVehicleForPartyWrite(tx, ctx.tenantId, vehicleId);
  await assertCustomerInTenant(tx, ctx.tenantId, input.customer_id);
  return insertLockedParty(tx, ctx, vehicleId, input);
}

/** Ends an open-ended party. Ending the owner never clears the main contact. */
export async function endPartyInTx(
  tx: Prisma.TransactionClient,
  ctx: PartyWriteContext,
  vehicleId: string,
  partyId: string,
  validTo: string,
): Promise<VehicleParty> {
  await lockVehicleForPartyWrite(tx, ctx.tenantId, vehicleId);
  const party = await tx.vehicleParty.findFirst({
    where: { id: partyId, tenant_id: ctx.tenantId, vehicle_id: vehicleId },
  });
  if (!party) {
    throw new NotFoundException(`Vehicle party ${partyId} not found`);
  }
  if (party.valid_to !== null) {
    throw new ConflictException('Only an open-ended party can be ended');
  }
  const violation = validatePartyShape(
    { ...toPartyInterval(party), valid_to: validTo },
    ctx,
  );
  if (violation) {
    throw violationToException(violation);
  }
  return tx.vehicleParty.update({
    where: { tenant_id_id: { tenant_id: ctx.tenantId, id: party.id } },
    data: { valid_to: dayToDate(validTo) },
  });
}

/**
 * An OWNER that started today cannot end today (the interval would be empty). A manual one is a
 * same-day correction: it is re-pointed at the new customer, or withdrawn when the contact is
 * cleared, so no future-dated OWNER is ever created. An imported one is evidence and stays.
 */
async function correctSameDayOwner(
  tx: Prisma.TransactionClient,
  ctx: PartyWriteContext,
  timeline: VehicleParty[],
  owner: VehicleParty,
  customerId: string | null,
): Promise<void> {
  if (owner.source !== VehicleRecordSource.MANUAL) {
    throw new ConflictException(
      'The owner was assigned today by an import; end it from tomorrow or correct it in the import',
    );
  }
  if (customerId === null) {
    await tx.vehicleParty.deleteMany({
      where: { id: owner.id, tenant_id: ctx.tenantId },
    });
    return;
  }
  const next = { ...toPartyInterval(owner), customer_id: customerId };
  if (findPartyConflict(timeline.map(toPartyInterval), next)) {
    throw overlapException(next);
  }
  await tx.vehicleParty.update({
    where: { tenant_id_id: { tenant_id: ctx.tenantId, id: owner.id } },
    data: { customer_id: customerId, notes: null },
  });
}

/** Ends the active OWNER today and starts the next one today. */
async function handOverOwner(
  tx: Prisma.TransactionClient,
  ctx: PartyWriteContext,
  vehicleId: string,
  timeline: VehicleParty[],
  active: VehicleParty | null,
  customerId: string | null,
): Promise<void> {
  const interval = active ? toPartyInterval(active) : null;
  if (active && interval && (interval.valid_from ?? '') >= ctx.today) {
    await correctSameDayOwner(tx, ctx, timeline, active, customerId);
    return;
  }
  if (active) {
    await tx.vehicleParty.update({
      where: { tenant_id_id: { tenant_id: ctx.tenantId, id: active.id } },
      data: { valid_to: dayToDate(ctx.today) },
    });
  }
  if (customerId !== null) {
    await insertLockedParty(tx, ctx, vehicleId, {
      customer_id: customerId,
      role: VehiclePartyRole.OWNER,
      valid_from: ctx.today,
      valid_to: null,
      notes: null,
      source: VehicleRecordSource.MANUAL,
    });
  }
}

/**
 * Keeps the parties in step with an explicit change of the main contact (PATCH customer_id):
 * the active OWNER ends and, for a customer, a new OWNER starts, in the caller's transaction.
 * Clearing the contact (null) ends the OWNER and starts none.
 */
export async function changeMainContactInTx(
  tx: Prisma.TransactionClient,
  ctx: PartyWriteContext,
  vehicleId: string,
  customerId: string | null,
): Promise<void> {
  await lockVehicleForPartyWrite(tx, ctx.tenantId, vehicleId);
  const timeline = await loadTimeline(tx, ctx.tenantId, vehicleId);
  const activeInterval = selectActiveOwner(
    timeline.map(toPartyInterval),
    ctx.today,
  );
  const active = timeline.find((row) => row.id === activeInterval?.id) ?? null;
  const unchanged = active
    ? active.customer_id === customerId
    : customerId === null;

  if (!unchanged) {
    await handOverOwner(tx, ctx, vehicleId, timeline, active, customerId);
  }
  await tx.vehicle.updateMany({
    where: { id: vehicleId, tenant_id: ctx.tenantId },
    data: { customer_id: customerId },
  });
}

export type PartyBoundsUpdate = {
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
};

/**
 * Changes the bounds and notes of one party. A null value keeps the stored one, so a blank
 * cell can never end a party or clear a note. The timeline is rechecked under the lock.
 */
export async function updatePartyBoundsInTx(
  tx: Prisma.TransactionClient,
  ctx: PartyWriteContext,
  vehicleId: string,
  partyId: string,
  update: PartyBoundsUpdate,
): Promise<VehicleParty> {
  await lockVehicleForPartyWrite(tx, ctx.tenantId, vehicleId);
  const timeline = await loadTimeline(tx, ctx.tenantId, vehicleId);
  const party = timeline.find((row) => row.id === partyId);
  if (!party) {
    throw new NotFoundException(`Vehicle party ${partyId} not found`);
  }
  const next = {
    ...toPartyInterval(party),
    valid_from: update.valid_from ?? dateToDay(party.valid_from),
    valid_to: update.valid_to ?? dateToDay(party.valid_to),
  };
  const violation = validatePartyShape(next, ctx);
  if (violation) {
    throw violationToException(violation);
  }
  if (findPartyConflict(timeline.map(toPartyInterval), next)) {
    throw overlapException(next);
  }
  const updated = await tx.vehicleParty.update({
    where: { tenant_id_id: { tenant_id: ctx.tenantId, id: party.id } },
    data: {
      valid_from: dayToDate(next.valid_from),
      valid_to: dayToDate(next.valid_to),
      notes: update.notes ?? party.notes,
    },
  });
  if (party.role === VehiclePartyRole.OWNER && isActiveOn(next, ctx.today)) {
    await tx.vehicle.updateMany({
      where: { id: vehicleId, tenant_id: ctx.tenantId },
      data: { customer_id: party.customer_id },
    });
  }
  return updated;
}
