import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { VehicleRecordSource, type Vehicle } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  isValidVinCheckDigit,
  isValidVinFormat,
  normalizeVin,
} from '../import/vin.validation.js';
import {
  findVehicleDuplicateCandidates,
  VEHICLE_MATCH_REASONS,
  type VehicleDuplicateCandidate,
} from './vehicle-duplicate-check.js';
import { partyWriteContext, setOwnerInTx } from './vehicle-party.writer.js';
import { normalizePlate, withPlateNormalized } from './vehicle-plate.util.js';
import {
  assertVehicleRegulatoryFields,
  normalizeVehicleRegulatoryFields,
} from './vehicle-regulatory.validation.js';
import {
  VEHICLE_DUPLICATE_CODE,
  VEHICLE_INVALID_VIN_CODE,
  VEHICLE_MILEAGE_DECREASE_REQUIRES_REASON_CODE,
  VEHICLE_NO_CHANGES_CODE,
  VEHICLE_STALE_PROPOSAL_CODE,
} from './vehicle-propose.constants.js';
import {
  buildVehicleProposalDiff,
  digestOfVehicleFields,
  type VehicleCreateFields,
  type VehicleCreateProposalPayload,
  type VehicleProposalDiffEntry,
  type VehicleProposalFields,
  type VehicleUpdateProposalPayload,
} from './vehicle-propose.payload.js';
import {
  proposeVehicleCreateInputSchema,
  proposeVehicleUpdateInputSchema,
} from './vehicle-propose.schema.js';

export type VehicleProposalOutcome = {
  id: string;
  vehicle_id: string;
  entity: 'Vehicle';
  op: 'create' | 'update';
  diff: VehicleProposalDiffEntry[];
  duplicate_candidates: VehicleDuplicateCandidate[];
  warnings: string[];
};

type ProposalContext = {
  prisma: PrismaService;
  tenantId: string;
};

const MILEAGE_DECREASE_WARNING =
  'Mileage decreased compared to current recorded value';

function validateAndNormalizeVin(
  rawVin: string | null | undefined,
  warnings: string[],
): string | null | undefined {
  if (rawVin === undefined) return undefined;
  if (rawVin === null) return null;
  const vin = normalizeVin(rawVin);
  if (!vin) return null;
  if (!isValidVinFormat(vin)) {
    throw new BadRequestException({
      code: VEHICLE_INVALID_VIN_CODE,
      message: `${VEHICLE_INVALID_VIN_CODE}: vin must be 17 characters using ISO 3779 charset (no I, O, Q)`,
      field: 'vin',
    });
  }
  if (!isValidVinCheckDigit(vin)) {
    warnings.push(
      'VIN check digit does not validate (ISO 3779); verify VIN manually',
    );
  }
  return vin;
}

function normalizeAndValidateFirstReg(rawDate: string | null | undefined): {
  isoDate: string | null | undefined;
  dateObj: Date | null | undefined;
} {
  if (rawDate === undefined) return { isoDate: undefined, dateObj: undefined };
  if (rawDate === null) return { isoDate: null, dateObj: null };
  const normalized = normalizeVehicleRegulatoryFields({
    first_registration_date: rawDate,
  });
  assertVehicleRegulatoryFields(normalized);
  const rawFirstReg: unknown = normalized.first_registration_date;
  const dateObj = rawFirstReg instanceof Date ? rawFirstReg : null;
  return {
    isoDate: dateObj ? dateObj.toISOString().slice(0, 10) : null,
    dateObj,
  };
}

function appendDuplicateWarnings(
  candidates: VehicleDuplicateCandidate[],
  warnings: string[],
): void {
  const hasPlate = candidates.some((c) =>
    c.match_reasons.includes(VEHICLE_MATCH_REASONS.plate),
  );
  if (hasPlate) {
    warnings.push(
      'Another vehicle in this tenant has the same normalized plate (plates can be reassigned)',
    );
  }
  const hasOwnerModel = candidates.some((c) =>
    c.match_reasons.includes(
      VEHICLE_MATCH_REASONS.ownerMakeModelFirstRegistration,
    ),
  );
  if (hasOwnerModel) {
    warnings.push(
      'Another vehicle for the same owner has the same make, model, and first registration date',
    );
  }
}

function assertNoBlockingVinDuplicate(
  candidates: VehicleDuplicateCandidate[],
): void {
  const blocking = candidates.find((c) =>
    c.match_reasons.includes(VEHICLE_MATCH_REASONS.vin),
  );
  if (!blocking) return;
  throw new UnprocessableEntityException({
    code: VEHICLE_DUPLICATE_CODE,
    message: `${VEHICLE_DUPLICATE_CODE}: a vehicle with the same VIN already exists (vehicle_id ${blocking.vehicle_id}). Propose an update for that vehicle instead of a create.`,
  });
}

async function customerExistsInTenant(
  context: ProposalContext,
  customerId: string,
): Promise<boolean> {
  const row = await context.prisma.customer.findFirst({
    where: { id: customerId, tenant_id: context.tenantId },
    select: { id: true },
  });
  return Boolean(row);
}

async function assertCustomerExists(
  context: ProposalContext,
  customerId: string,
): Promise<void> {
  if (!(await customerExistsInTenant(context, customerId))) {
    throw new NotFoundException(`Customer with ID ${customerId} not found`);
  }
}

function currentVehicleFields(vehicle: Vehicle): VehicleProposalFields {
  return {
    owner_customer_id: vehicle.customer_id,
    vin: vehicle.vin,
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    first_registration_date: vehicle.first_registration_date
      ? vehicle.first_registration_date.toISOString().slice(0, 10)
      : null,
    mileage_km: vehicle.mileage,
    fuel_type: vehicle.fuel_type,
    national_code: vehicle.national_code,
  };
}

function pickBeforeSubset(
  vehicle: Vehicle,
  changes: VehicleProposalFields,
): VehicleProposalFields {
  const current = currentVehicleFields(vehicle);
  const subset: VehicleProposalFields = {};
  for (const key of Object.keys(changes) as (keyof VehicleProposalFields)[]) {
    if (changes[key] !== undefined) {
      (subset as Record<string, unknown>)[key] = current[key] ?? null;
    }
  }
  return subset;
}

function resolveVehicleYear(
  year: number | undefined,
  firstRegDate: Date | null | undefined,
): number {
  if (year !== undefined) return year;
  if (firstRegDate) return firstRegDate.getUTCFullYear();
  return new Date().getUTCFullYear();
}

export async function enrichVehicleCreateProposal(
  context: ProposalContext,
  input: unknown,
): Promise<VehicleCreateProposalPayload> {
  const parsed = proposeVehicleCreateInputSchema.parse(input);
  const warnings: string[] = [];
  const vin = validateAndNormalizeVin(parsed.vin, warnings);
  const plate =
    parsed.plate !== undefined ? normalizePlate(parsed.plate) : undefined;
  const { isoDate, dateObj } = normalizeAndValidateFirstReg(
    parsed.first_registration_date,
  );
  if (parsed.owner_customer_id) {
    await assertCustomerExists(context, parsed.owner_customer_id);
  }
  const fields: VehicleCreateFields = {
    ...(parsed.owner_customer_id !== undefined
      ? { owner_customer_id: parsed.owner_customer_id }
      : {}),
    ...(vin !== undefined ? { vin } : {}),
    ...(plate !== undefined ? { plate } : {}),
    make: parsed.make,
    model: parsed.model,
    ...(parsed.variant !== undefined ? { variant: parsed.variant } : {}),
    year: resolveVehicleYear(parsed.year, dateObj),
    ...(isoDate !== undefined ? { first_registration_date: isoDate } : {}),
    ...(parsed.mileage_km !== undefined
      ? { mileage_km: parsed.mileage_km }
      : {}),
    ...(parsed.fuel_type !== undefined ? { fuel_type: parsed.fuel_type } : {}),
    ...(parsed.national_code !== undefined
      ? { national_code: parsed.national_code }
      : {}),
  };

  const candidates = await findVehicleDuplicateCandidates(
    context.prisma,
    context.tenantId,
    {
      vin: fields.vin,
      plate: fields.plate,
      owner_customer_id: fields.owner_customer_id,
      make: fields.make,
      model: fields.model,
      first_registration_date: dateObj ?? null,
    },
  );
  assertNoBlockingVinDuplicate(candidates);
  appendDuplicateWarnings(candidates, warnings);

  return {
    action: 'vehicle.create',
    idempotency_key: parsed.idempotency_key,
    fields,
    duplicate_check: {
      digest: digestOfVehicleFields(fields),
      candidate_ids: candidates.map((c) => c.vehicle_id),
    },
    warnings,
  };
}

function normalizeUpdateChanges(
  raw: Record<string, unknown>,
  warnings: string[],
): {
  changes: VehicleProposalFields;
  firstRegDateObj: Date | null | undefined;
} {
  const changes: VehicleProposalFields = {};
  if (raw.owner_customer_id !== undefined) {
    changes.owner_customer_id = raw.owner_customer_id as string | null;
  }
  if (raw.vin !== undefined) {
    changes.vin = validateAndNormalizeVin(raw.vin as string | null, warnings);
  }
  if (raw.plate !== undefined) {
    changes.plate =
      raw.plate === null ? null : normalizePlate(raw.plate as string);
  }
  const { isoDate, dateObj } = normalizeAndValidateFirstReg(
    raw.first_registration_date as string | null | undefined,
  );
  if (isoDate !== undefined) changes.first_registration_date = isoDate;
  for (const key of [
    'make',
    'model',
    'variant',
    'year',
    'mileage_km',
    'fuel_type',
    'national_code',
  ] as const) {
    if (raw[key] !== undefined) {
      (changes as Record<string, unknown>)[key] = raw[key];
    }
  }
  return { changes, firstRegDateObj: dateObj };
}

function filterChangedFields(
  vehicle: Vehicle,
  normalized: VehicleProposalFields,
): VehicleProposalFields {
  const current = currentVehicleFields(vehicle);
  const diffed: VehicleProposalFields = {};
  for (const key of Object.keys(
    normalized,
  ) as (keyof VehicleProposalFields)[]) {
    const nextVal = normalized[key];
    if (nextVal === undefined) continue;
    const prevVal = current[key] ?? null;
    if (prevVal !== nextVal) {
      (diffed as Record<string, unknown>)[key] = nextVal;
    }
  }
  return diffed;
}

export async function enrichVehicleUpdateProposal(
  context: ProposalContext,
  input: unknown,
): Promise<VehicleUpdateProposalPayload> {
  const parsed = proposeVehicleUpdateInputSchema.parse(input);
  const vehicle = await loadVehicle(context, parsed.vehicle_id);
  const warnings: string[] = [];
  const { changes: normalized, firstRegDateObj } = normalizeUpdateChanges(
    parsed.changes,
    warnings,
  );
  const changes = filterChangedFields(vehicle, normalized);
  if (Object.keys(changes).length === 0) {
    throw new BadRequestException({
      code: VEHICLE_NO_CHANGES_CODE,
      message: `${VEHICLE_NO_CHANGES_CODE}: the submitted changes match the current vehicle data`,
    });
  }
  if (
    changes.mileage_km !== undefined &&
    changes.mileage_km !== null &&
    vehicle.mileage !== null &&
    changes.mileage_km < vehicle.mileage
  ) {
    if (!parsed.reason) {
      throw new BadRequestException({
        code: VEHICLE_MILEAGE_DECREASE_REQUIRES_REASON_CODE,
        message: `${VEHICLE_MILEAGE_DECREASE_REQUIRES_REASON_CODE}: mileage may only increase unless a reason is provided`,
        field: 'mileage_km',
      });
    }
    warnings.push(MILEAGE_DECREASE_WARNING);
  }
  if (typeof changes.owner_customer_id === 'string') {
    await assertCustomerExists(context, changes.owner_customer_id);
  }

  const probeFirstReg =
    firstRegDateObj !== undefined
      ? firstRegDateObj
      : vehicle.first_registration_date;
  const candidates = await findVehicleDuplicateCandidates(
    context.prisma,
    context.tenantId,
    buildVehicleDuplicateProbe(vehicle, changes, probeFirstReg),
    vehicle.id,
  );
  assertNoBlockingVinDuplicate(candidates);
  appendDuplicateWarnings(candidates, warnings);

  return {
    action: 'vehicle.update',
    idempotency_key: parsed.idempotency_key,
    vehicle_id: vehicle.id,
    ...(parsed.reason ? { reason: parsed.reason } : {}),
    changes,
    before_digest: digestOfVehicleFields(pickBeforeSubset(vehicle, changes)),
    duplicate_check: {
      digest: digestOfVehicleFields(changes),
      candidate_ids: candidates.map((c) => c.vehicle_id),
    },
    warnings,
  };
}

function buildVehicleDuplicateProbe(
  vehicle: Vehicle,
  changes: VehicleProposalFields,
  firstRegistrationDate: Date | null,
) {
  return {
    vin: changes.vin !== undefined ? changes.vin : vehicle.vin,
    plate: changes.plate !== undefined ? changes.plate : vehicle.plate,
    owner_customer_id:
      changes.owner_customer_id !== undefined
        ? changes.owner_customer_id
        : vehicle.customer_id,
    make: changes.make ?? vehicle.make,
    model: changes.model ?? vehicle.model,
    first_registration_date: firstRegistrationDate,
  };
}

export async function applyVehicleCreateProposal(
  context: ProposalContext,
  payload: unknown,
): Promise<VehicleProposalOutcome> {
  const proposal = payload as VehicleCreateProposalPayload;
  if (proposal?.action !== 'vehicle.create') {
    throw new BadRequestException('Invalid vehicle.create proposal payload');
  }
  const warnings = [...(proposal.warnings ?? [])];
  const { fields } = proposal;

  const candidates = await findVehicleDuplicateCandidates(
    context.prisma,
    context.tenantId,
    {
      vin: fields.vin,
      plate: fields.plate,
      owner_customer_id: fields.owner_customer_id,
      make: fields.make,
      model: fields.model,
      first_registration_date: parseIsoDateOrNull(
        fields.first_registration_date,
      ),
    },
  );
  assertNoBlockingVinDuplicate(candidates);

  const resolvedOwnerId = await resolveCreateOwnerId(
    context,
    fields.owner_customer_id,
    warnings,
  );

  const created = await context.prisma.$transaction(async (tx) => {
    const row = await tx.vehicle.create({
      data: withPlateNormalized({
        tenant_id: context.tenantId,
        make: fields.make,
        model: fields.model,
        year: fields.year ?? new Date().getUTCFullYear(),
        vin: fields.vin ?? null,
        plate: fields.plate ?? null,
        first_registration_date: parseIsoDateOrNull(
          fields.first_registration_date,
        ),
        mileage: fields.mileage_km ?? null,
        fuel_type: fields.fuel_type ?? null,
        national_code: fields.national_code ?? null,
      }),
    });
    if (resolvedOwnerId) {
      await setOwnerInTx(
        tx,
        partyWriteContext(context.tenantId),
        row.id,
        resolvedOwnerId,
        VehicleRecordSource.MANUAL,
      );
    }
    return row;
  });

  return {
    id: created.id,
    vehicle_id: created.id,
    entity: 'Vehicle',
    op: 'create',
    diff: buildVehicleProposalDiff({}, fields),
    duplicate_candidates: candidates,
    warnings,
  };
}

export async function applyVehicleUpdateProposal(
  context: ProposalContext,
  payload: unknown,
): Promise<VehicleProposalOutcome> {
  const proposal = payload as VehicleUpdateProposalPayload;
  if (proposal?.action !== 'vehicle.update') {
    throw new BadRequestException('Invalid vehicle.update proposal payload');
  }
  const vehicle = await loadVehicle(context, proposal.vehicle_id);
  const currentSubset = pickBeforeSubset(vehicle, proposal.changes);
  if (digestOfVehicleFields(currentSubset) !== proposal.before_digest) {
    throw new ConflictException({
      code: VEHICLE_STALE_PROPOSAL_CODE,
      message: `${VEHICLE_STALE_PROPOSAL_CODE}: the vehicle data changed since this proposal was created. Reload the vehicle and propose the change again.`,
    });
  }

  const warnings = [...(proposal.warnings ?? [])];
  const { changes } = proposal;
  const probeFirstReg =
    changes.first_registration_date !== undefined
      ? parseIsoDateOrNull(changes.first_registration_date)
      : vehicle.first_registration_date;
  const candidates = await findVehicleDuplicateCandidates(
    context.prisma,
    context.tenantId,
    buildVehicleDuplicateProbe(vehicle, changes, probeFirstReg),
    vehicle.id,
  );
  assertNoBlockingVinDuplicate(candidates);

  const nextOwnerId = await resolveUpdateOwnerId(
    context,
    changes.owner_customer_id,
    warnings,
  );
  await persistVehicleUpdate(
    context,
    vehicle.id,
    buildScalarUpdateData(changes),
    nextOwnerId,
  );

  return {
    id: vehicle.id,
    vehicle_id: vehicle.id,
    entity: 'Vehicle',
    op: 'update',
    diff: buildVehicleProposalDiff(
      currentSubset,
      changes,
      buildMileageWarningsByField(changes, vehicle),
    ),
    duplicate_candidates: candidates,
    warnings,
  };
}

function parseIsoDateOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

async function resolveCreateOwnerId(
  context: ProposalContext,
  ownerCustomerId: string | null | undefined,
  warnings: string[],
): Promise<string | null> {
  if (!ownerCustomerId) return null;
  if (await customerExistsInTenant(context, ownerCustomerId)) {
    return ownerCustomerId;
  }
  warnings.push(
    'Proposed owner customer no longer exists in this tenant; vehicle created without owner link',
  );
  return null;
}

async function resolveUpdateOwnerId(
  context: ProposalContext,
  ownerCustomerId: string | null | undefined,
  warnings: string[],
): Promise<string | null | undefined> {
  if (ownerCustomerId === undefined) return undefined;
  if (ownerCustomerId === null) return null;
  if (await customerExistsInTenant(context, ownerCustomerId)) {
    return ownerCustomerId;
  }
  warnings.push(
    'Proposed owner customer no longer exists in this tenant; owner link was skipped',
  );
  return undefined;
}

async function persistVehicleUpdate(
  context: ProposalContext,
  vehicleId: string,
  updateData: Record<string, unknown>,
  nextOwnerId: string | null | undefined,
): Promise<void> {
  await context.prisma.$transaction(async (tx) => {
    if (Object.keys(updateData).length > 0) {
      await tx.vehicle.updateMany({
        where: { id: vehicleId, tenant_id: context.tenantId },
        data: withPlateNormalized(updateData),
      });
    }
    if (nextOwnerId !== undefined) {
      await setOwnerInTx(
        tx,
        partyWriteContext(context.tenantId),
        vehicleId,
        nextOwnerId,
        VehicleRecordSource.MANUAL,
      );
    }
  });
}

function buildMileageWarningsByField(
  changes: VehicleProposalFields,
  vehicle: Vehicle,
): Record<string, string> {
  const isDecrease =
    typeof changes.mileage_km === 'number' &&
    vehicle.mileage !== null &&
    changes.mileage_km < vehicle.mileage;
  return isDecrease ? { mileage_km: MILEAGE_DECREASE_WARNING } : {};
}

const SCALAR_FIELD_MAP: ReadonlyArray<
  readonly [keyof VehicleProposalFields, string]
> = [
  ['make', 'make'],
  ['model', 'model'],
  ['year', 'year'],
  ['vin', 'vin'],
  ['plate', 'plate'],
  ['mileage_km', 'mileage'],
  ['fuel_type', 'fuel_type'],
  ['national_code', 'national_code'],
];

function buildScalarUpdateData(changes: VehicleProposalFields) {
  const data: Record<string, unknown> = {};
  for (const [sourceKey, targetKey] of SCALAR_FIELD_MAP) {
    if (changes[sourceKey] !== undefined) {
      data[targetKey] = changes[sourceKey];
    }
  }
  if (changes.first_registration_date !== undefined) {
    data.first_registration_date = parseIsoDateOrNull(
      changes.first_registration_date,
    );
  }
  return data;
}

async function loadVehicle(
  context: ProposalContext,
  vehicleId: string,
): Promise<Vehicle> {
  const vehicle = await context.prisma.vehicle.findFirst({
    where: { id: vehicleId, tenant_id: context.tenantId },
  });
  if (!vehicle) {
    throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
  }
  return vehicle;
}
