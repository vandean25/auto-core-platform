import { ImportRowAction, VehiclePartyRole } from '@prisma/client';
import {
  findPartyConflict,
  isActiveOn,
  validatePartyShape,
  VEHICLE_PARTY_ERROR_CODES,
  type PartyInterval,
} from '../vehicle/vehicle-party.rules.js';
import {
  cell,
  errorRow,
  invalidIssue,
  optionalDay,
  prepareCanonicalRow,
  requiredIssue,
  type PreparedBase,
} from './canonical-csv-cell.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportRowIssue,
} from './import.types.js';

export type StoredParty = {
  id: string;
  vehicle_id: string;
  customer_id: string;
  role: VehiclePartyRole;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
};

export type PartyPlanContext = {
  vehicleIdByExternalId: Map<string, string>;
  customerIdByExternalId: Map<string, string>;
  /** Existing VEHICLE_PARTY mappings: external id to party id. */
  partyIdByExternalId: Map<string, string>;
  /** Every stored party of every vehicle the file mentions. */
  storedParties: StoredParty[];
  /** `Vehicle.customer_id` by vehicle id. */
  vehicleContact: Map<string, string | null>;
  options: ImportJobOptions;
  today: string;
};

export type PartyCsvRow = { rowNo: number; record: Record<string, string> };

type NormalizedPartyRow = {
  external_id: string;
  vehicle_external_id: string;
  customer_external_id: string;
  role: VehiclePartyRole;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
};

type PreparedParty = PreparedBase<NormalizedPartyRow> & {
  customerId?: string;
  /** Interval the row stands for once applied (or the stored one when not applied). */
  interval?: PartyInterval;
};

const ROLES = new Set<string>(Object.values(VehiclePartyRole));

function normalizePartyRow(
  record: Record<string, string>,
  mapping: Record<string, string>,
): { row: NormalizedPartyRow | null; issues: ImportRowIssue[] } {
  const issues: ImportRowIssue[] = [];
  const text = (field: string) => cell(record, mapping, field);
  for (const field of [
    'external_id',
    'vehicle_external_id',
    'customer_external_id',
    'role',
  ]) {
    if (text(field) === '') {
      issues.push(requiredIssue(field));
    }
  }
  const role = text('role');
  if (role !== '' && !ROLES.has(role)) {
    issues.push(invalidIssue('role', `role "${role}" is not allowed`));
  }
  const valid_from = optionalDay(text('valid_from'), 'valid_from', issues);
  const valid_to = optionalDay(text('valid_to'), 'valid_to', issues);
  if (issues.length > 0) {
    return { row: null, issues };
  }
  return {
    row: {
      external_id: text('external_id'),
      vehicle_external_id: text('vehicle_external_id'),
      customer_external_id: text('customer_external_id'),
      role: role as VehiclePartyRole,
      valid_from,
      valid_to,
      notes: text('notes') || null,
    },
    issues,
  };
}

function toRuleIssue(violation: {
  code: string;
  message: string;
  field?: string;
}) {
  // The migration contract names a deferred capability, not a data error.
  const code =
    violation.code === VEHICLE_PARTY_ERROR_CODES.FUTURE_START_UNSUPPORTED
      ? MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_UNSUPPORTED_CAPABILITY
      : violation.code;
  return { code, message: violation.message, field: violation.field };
}

function referenceIssues(
  row: NormalizedPartyRow,
  ctx: PartyPlanContext,
): ImportRowIssue[] {
  const issues: ImportRowIssue[] = [];
  if (!ctx.vehicleIdByExternalId.has(row.vehicle_external_id)) {
    issues.push({
      code: IMPORT_ERROR_CODES.UNKNOWN_VEHICLE,
      message: 'vehicle_external_id does not resolve in this tenant',
      field: 'vehicle_external_id',
    });
  }
  if (!ctx.customerIdByExternalId.has(row.customer_external_id)) {
    issues.push({
      code: IMPORT_ERROR_CODES.UNKNOWN_CUSTOMER,
      message: 'customer_external_id does not resolve in this tenant',
      field: 'customer_external_id',
    });
  }
  return issues;
}

function sameIdentity(
  stored: StoredParty,
  row: NormalizedPartyRow,
  vehicleId: string,
  customerId: string,
): boolean {
  return (
    stored.vehicle_id === vehicleId &&
    stored.customer_id === customerId &&
    stored.role === row.role
  );
}

/** Blank bounds and notes never clear a stored value, so only supplied cells can differ. */
function changedFields(stored: StoredParty, row: NormalizedPartyRow) {
  return {
    valid_from: row.valid_from !== null && row.valid_from !== stored.valid_from,
    valid_to: row.valid_to !== null && row.valid_to !== stored.valid_to,
    notes: row.notes !== null && row.notes !== stored.notes,
  };
}

function prepareExisting(
  prepared: PreparedParty,
  stored: StoredParty,
  ctx: PartyPlanContext,
): void {
  const row = prepared.row as NormalizedPartyRow;
  const changed = changedFields(stored, row);
  prepared.entityId = stored.id;
  prepared.interval = {
    id: stored.id,
    role: stored.role,
    customer_id: stored.customer_id,
    valid_from: stored.valid_from,
    valid_to: stored.valid_to,
  };
  if (!changed.valid_from && !changed.valid_to && !changed.notes) {
    prepared.action = ImportRowAction.SKIP;
    return;
  }
  if (ctx.options.update_existing !== true) {
    prepared.action = ImportRowAction.SKIP;
    prepared.warnings.push({
      code: 'IMPORT_UPDATE_NOT_ENABLED',
      message: 'Existing party differs; enable update_existing to apply it',
    });
    return;
  }
  prepared.action = ImportRowAction.UPDATE;
  prepared.interval = {
    ...prepared.interval,
    valid_from: row.valid_from ?? stored.valid_from,
    valid_to: row.valid_to ?? stored.valid_to,
  };
}

/** Resolves references, checks the shape of the row and matches it to a stored party. */
function resolveRow(prepared: PreparedParty, ctx: PartyPlanContext): void {
  const row = prepared.row as NormalizedPartyRow;
  prepared.issues.push(...referenceIssues(row, ctx));
  if (prepared.issues.length > 0) {
    return;
  }
  prepared.vehicleId = ctx.vehicleIdByExternalId.get(row.vehicle_external_id);
  prepared.customerId = ctx.customerIdByExternalId.get(
    row.customer_external_id,
  );
  prepared.interval = {
    role: row.role,
    customer_id: prepared.customerId as string,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
  };
  const shape = validatePartyShape(prepared.interval, {
    today: ctx.today,
    cutover: ctx.options.cutover_date,
  });
  if (shape) {
    prepared.issues.push(toRuleIssue(shape));
    return;
  }
  const storedId = ctx.partyIdByExternalId.get(row.external_id);
  const stored = ctx.storedParties.find((party) => party.id === storedId);
  if (stored) {
    resolveStored(prepared, stored, ctx);
  }
}

function prepareRow(
  csv: PartyCsvRow,
  mapping: Record<string, string>,
  ctx: PartyPlanContext,
  seen: Map<string, number>,
): PreparedParty {
  return prepareCanonicalRow<NormalizedPartyRow>(
    csv,
    mapping,
    (record) => normalizePartyRow(record, mapping),
    seen,
    (prepared) => resolveRow(prepared, ctx),
  );
}

function resolveStored(
  prepared: PreparedParty,
  stored: StoredParty,
  ctx: PartyPlanContext,
): void {
  const row = prepared.row as NormalizedPartyRow;
  if (
    !sameIdentity(
      stored,
      row,
      prepared.vehicleId as string,
      prepared.customerId as string,
    )
  ) {
    prepared.issues.push({
      code: IMPORT_ERROR_CODES.IDENTITY_CHANGED,
      message:
        'vehicle, customer and role of a mapped party cannot change; use a new external_id',
      field: 'external_id',
    });
    return;
  }
  prepareExisting(prepared, stored, ctx);
}

function buildTimeline(
  prepared: PreparedParty[],
  ctx: PartyPlanContext,
): Map<string, PartyInterval[]> {
  const touched = new Set(
    prepared
      .filter((p) => p.issues.length === 0 && p.entityId)
      .map((p) => p.entityId),
  );
  const timeline = new Map<string, PartyInterval[]>();
  const add = (vehicleId: string, interval: PartyInterval) =>
    timeline.set(vehicleId, [...(timeline.get(vehicleId) ?? []), interval]);

  for (const party of ctx.storedParties) {
    if (!touched.has(party.id)) {
      add(party.vehicle_id, party);
    }
  }
  for (const item of prepared) {
    if (item.issues.length === 0 && item.interval && item.vehicleId) {
      add(item.vehicleId, {
        ...item.interval,
        id: item.entityId ?? `row:${item.rowNo}`,
      });
    }
  }
  return timeline;
}

function hasUnmappedContactConflict(
  item: PreparedParty,
  ctx: PartyPlanContext,
): boolean {
  const interval = item.interval as PartyInterval;
  if (
    interval.role !== VehiclePartyRole.OWNER ||
    !isActiveOn(interval, ctx.today)
  ) {
    return false;
  }
  const vehicleId = item.vehicleId as string;
  const contact = ctx.vehicleContact.get(vehicleId) ?? null;
  if (contact === null || contact === interval.customer_id) {
    return false;
  }
  return !ctx.storedParties.some(
    (party) =>
      party.vehicle_id === vehicleId &&
      party.role === VehiclePartyRole.OWNER &&
      party.customer_id === contact,
  );
}

function finishRow(
  item: PreparedParty,
  timeline: Map<string, PartyInterval[]>,
  ctx: PartyPlanContext,
): DryRunRowResult {
  if (item.issues.length > 0 || !item.row) {
    return errorRow(item.rowNo, item.externalId, item.issues, item.warnings);
  }
  const interval = item.interval as PartyInterval;
  const writes = item.action !== ImportRowAction.SKIP;
  const id = item.entityId ?? `row:${item.rowNo}`;
  const clash =
    writes &&
    findPartyConflict(timeline.get(item.vehicleId as string) ?? [], {
      ...interval,
      id,
    });
  if (clash) {
    return errorRow(item.rowNo, item.externalId, [
      {
        code: VEHICLE_PARTY_ERROR_CODES.OVERLAP,
        message: `${interval.role} overlaps another party interval on this vehicle`,
        field: 'valid_from',
      },
    ]);
  }
  if (writes && hasUnmappedContactConflict(item, ctx)) {
    return errorRow(item.rowNo, item.externalId, [
      {
        code: IMPORT_ERROR_CODES.OWNER_CONTACT_CONFLICT,
        message:
          'The active OWNER differs from the vehicle main contact that has no OWNER party; assign or end the owner explicitly',
        field: 'customer_external_id',
      },
    ]);
  }
  return {
    row_no: item.rowNo,
    external_id: item.externalId,
    action: item.action,
    entity_id: item.entityId,
    errors: [],
    warnings: item.warnings,
    normalized: {
      external_id: item.row.external_id,
      vehicle_id: item.vehicleId,
      customer_id: item.customerId,
      role: item.row.role,
      valid_from: item.row.valid_from,
      valid_to: item.row.valid_to,
      notes: item.row.notes,
    },
  };
}

/** Plans every vehicle_parties.csv row against the file itself and the untouched target parties. */
export function planVehiclePartyRows(
  rows: PartyCsvRow[],
  mapping: Record<string, string>,
  ctx: PartyPlanContext,
): DryRunRowResult[] {
  const seen = new Map<string, number>();
  const prepared = rows.map((csv) => prepareRow(csv, mapping, ctx, seen));
  const timeline = buildTimeline(prepared, ctx);
  return prepared.map((item) => finishRow(item, timeline, ctx));
}
