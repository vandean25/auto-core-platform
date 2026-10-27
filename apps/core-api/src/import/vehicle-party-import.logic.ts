import {
  ImportRowAction,
  VehiclePartyRole,
  VehicleRecordSource,
} from '@prisma/client';
import {
  mergeReconcilePlanOutput,
  normalizedStringField,
  seedExternalIdSeenFromPriors,
} from './import-dry-run-reconcile.prior.js';
import {
  findPartyConflict,
  isActiveOn,
  validatePartyShape,
  VEHICLE_PARTY_RULE_CODES,
  type PartyInterval,
} from '../vehicle/vehicle-party.rules.js';
import {
  CANONICAL_ROW_ISSUE_CODES,
  cell,
  errorRow,
  invalidIssue,
  optionalDay,
  prepareCanonicalRow,
  requiredIssue,
  type PreparedBase,
} from './canonical-csv-cell.util.js';
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
  source: VehicleRecordSource;
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

/** The plan context with the lookups the per-row checks need, built once per file. */
type IndexedPartyCtx = PartyPlanContext & {
  storedById: Map<string, StoredParty>;
  storedByVehicle: Map<string, StoredParty[]>;
  /** Stored parties that already carry an external id from an earlier import. */
  mappedPartyIds: Set<string>;
  /** Stored parties an earlier row of this file adopted. */
  adoptedPartyIds: Set<string>;
};

function indexContext(ctx: PartyPlanContext): IndexedPartyCtx {
  const storedByVehicle = new Map<string, StoredParty[]>();
  for (const party of ctx.storedParties) {
    const rows = storedByVehicle.get(party.vehicle_id) ?? [];
    rows.push(party);
    storedByVehicle.set(party.vehicle_id, rows);
  }
  return {
    ...ctx,
    storedById: new Map(ctx.storedParties.map((party) => [party.id, party])),
    storedByVehicle,
    mappedPartyIds: new Set(ctx.partyIdByExternalId.values()),
    adoptedPartyIds: new Set(),
  };
}

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
  /** The row takes over an OWNER the vehicles.csv import started, instead of creating one. */
  adoptsExisting?: boolean;
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
    violation.code === VEHICLE_PARTY_RULE_CODES.FUTURE_START_UNSUPPORTED
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
      code: CANONICAL_ROW_ISSUE_CODES.UNKNOWN_VEHICLE,
      message: 'vehicle_external_id does not resolve in this tenant',
      field: 'vehicle_external_id',
    });
  }
  if (!ctx.customerIdByExternalId.has(row.customer_external_id)) {
    issues.push({
      code: CANONICAL_ROW_ISSUE_CODES.UNKNOWN_CUSTOMER,
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
      code: CANONICAL_ROW_ISSUE_CODES.UPDATE_NOT_ENABLED,
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
function resolveRow(prepared: PreparedParty, ctx: IndexedPartyCtx): void {
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
  const stored = storedId ? ctx.storedById.get(storedId) : undefined;
  if (stored) {
    resolveStored(prepared, stored, ctx);
    return;
  }
  adoptLegacyOwner(prepared, ctx);
}

function startsOnOrBefore(from: string | null, storedFrom: string | null) {
  return from === null || (storedFrom !== null && from <= storedFrom);
}

function isAdoptableOwner(
  party: StoredParty,
  row: NormalizedPartyRow,
  customerId: string,
): boolean {
  return (
    party.role === VehiclePartyRole.OWNER &&
    party.source === VehicleRecordSource.LEGACY_IMPORT &&
    party.customer_id === customerId &&
    party.valid_to === null &&
    startsOnOrBefore(row.valid_from, party.valid_from)
  );
}

/**
 * The vehicles.csv import starts an OWNER dated the import day. An open OWNER row of the same
 * customer that starts on or before it takes that party over (its valid_from moves to the
 * file's day) instead of overlapping it. MANUAL owners, other customers and closed rows never
 * adopt.
 */
function adoptLegacyOwner(prepared: PreparedParty, ctx: IndexedPartyCtx): void {
  const row = prepared.row as NormalizedPartyRow;
  if (row.role !== VehiclePartyRole.OWNER || row.valid_to !== null) {
    return;
  }
  const target = (ctx.storedByVehicle.get(prepared.vehicleId as string) ?? [])
    .filter(
      (party) =>
        !ctx.mappedPartyIds.has(party.id) && !ctx.adoptedPartyIds.has(party.id),
    )
    .find((party) =>
      isAdoptableOwner(party, row, prepared.customerId as string),
    );
  if (!target) {
    return;
  }
  ctx.adoptedPartyIds.add(target.id);
  prepared.adoptsExisting = true;
  prepared.action = ImportRowAction.UPDATE;
  prepared.entityId = target.id;
  prepared.interval = {
    id: target.id,
    role: target.role,
    customer_id: target.customer_id,
    valid_from: row.valid_from ?? target.valid_from,
    valid_to: null,
  };
}

function prepareRow(
  csv: PartyCsvRow,
  mapping: Record<string, string>,
  ctx: IndexedPartyCtx,
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
      code: CANONICAL_ROW_ISSUE_CODES.IDENTITY_CHANGED,
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
  const add = (vehicleId: string, interval: PartyInterval) => {
    const rows = timeline.get(vehicleId) ?? [];
    rows.push(interval);
    timeline.set(vehicleId, rows);
  };

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
  ctx: IndexedPartyCtx,
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
  return !(ctx.storedByVehicle.get(vehicleId) ?? []).some(
    (party) =>
      party.role === VehiclePartyRole.OWNER && party.customer_id === contact,
  );
}

/** True when the file leaves the vehicle without an OWNER active today while a main contact exists. */
function leavesNoActiveOwner(
  item: PreparedParty,
  timeline: Map<string, PartyInterval[]>,
  ctx: IndexedPartyCtx,
): boolean {
  const vehicleId = item.vehicleId as string;
  if ((ctx.vehicleContact.get(vehicleId) ?? null) === null) {
    return false;
  }
  return !(timeline.get(vehicleId) ?? []).some(
    (party) =>
      party.role === VehiclePartyRole.OWNER && isActiveOn(party, ctx.today),
  );
}

/** Reconciliation conflicts between an OWNER row and the vehicle's existing main contact. */
function contactConflictIssue(
  item: PreparedParty,
  timeline: Map<string, PartyInterval[]>,
  ctx: IndexedPartyCtx,
): ImportRowIssue | null {
  if ((item.interval as PartyInterval).role !== VehiclePartyRole.OWNER) {
    return null;
  }
  const reason = hasUnmappedContactConflict(item, ctx)
    ? 'The active OWNER differs from the vehicle main contact that has no OWNER party; assign or end the owner explicitly'
    : leavesNoActiveOwner(item, timeline, ctx)
      ? 'The file leaves no OWNER active today while the vehicle has a main contact; assign or end the owner explicitly'
      : null;
  return reason === null
    ? null
    : {
        code: CANONICAL_ROW_ISSUE_CODES.OWNER_CONTACT_CONFLICT,
        message: reason,
        field: 'customer_external_id',
      };
}

function plannedPayload(item: PreparedParty, row: NormalizedPartyRow) {
  return {
    external_id: row.external_id,
    vehicle_id: item.vehicleId,
    customer_id: item.customerId,
    role: row.role,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    notes: row.notes,
    ...(item.adoptsExisting ? { adopts_existing: true } : {}),
  };
}

function finishRow(
  item: PreparedParty,
  timeline: Map<string, PartyInterval[]>,
  ctx: IndexedPartyCtx,
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
        code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
        message: `${interval.role} overlaps another party interval on this vehicle`,
        field: 'valid_from',
      },
    ]);
  }
  const contactIssue = writes && contactConflictIssue(item, timeline, ctx);
  if (contactIssue) {
    return errorRow(item.rowNo, item.externalId, [contactIssue]);
  }
  return {
    row_no: item.rowNo,
    external_id: item.externalId,
    action: item.action,
    entity_id: item.entityId,
    errors: [],
    warnings: item.warnings,
    normalized: plannedPayload(item, item.row),
  };
}

function partyIdsFromPriorNormalized(
  normalized: Record<string, unknown>,
): { vehicleId: string; customerId: string; role: VehiclePartyRole } | null {
  const vehicleId = normalized.vehicle_id;
  const customerId = normalized.customer_id;
  const role = normalized.role;
  if (
    typeof vehicleId !== 'string' ||
    typeof customerId !== 'string' ||
    typeof role !== 'string'
  ) {
    return null;
  }
  return { vehicleId, customerId, role: role as VehiclePartyRole };
}

function preparedPartyFromPrior(prior: DryRunRowResult): PreparedParty | null {
  if (prior.errors.length > 0) {
    return {
      rowNo: prior.row_no,
      externalId: prior.external_id,
      issues: [...prior.errors],
      warnings: [...prior.warnings],
      action: prior.action,
      entityId: prior.entity_id,
    };
  }
  const normalized = prior.normalized;
  if (!normalized) {
    return null;
  }
  const ids = partyIdsFromPriorNormalized(normalized);
  if (!ids) {
    return null;
  }
  const row: NormalizedPartyRow = {
    external_id:
      normalizedStringField(normalized, 'external_id') ??
      prior.external_id ??
      '',
    vehicle_external_id: '',
    customer_external_id: '',
    role: ids.role,
    valid_from: normalizedStringField(normalized, 'valid_from'),
    valid_to: normalizedStringField(normalized, 'valid_to'),
    notes: normalizedStringField(normalized, 'notes'),
  };
  return {
    rowNo: prior.row_no,
    externalId: prior.external_id,
    issues: [],
    warnings: [...prior.warnings],
    action: prior.action,
    entityId: prior.entity_id,
    row,
    vehicleId: ids.vehicleId,
    customerId: ids.customerId,
    interval: {
      id: prior.entity_id ?? `row:${prior.row_no}`,
      role: ids.role,
      customer_id: ids.customerId,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
    },
  };
}

/** Plans every vehicle_parties.csv row against the file itself and the untouched target parties. */
export function planVehiclePartyRows(
  rows: PartyCsvRow[],
  mapping: Record<string, string>,
  ctx: PartyPlanContext,
  reconcilePriorResults?: DryRunRowResult[],
): DryRunRowResult[] {
  const priors = reconcilePriorResults ?? [];
  const seen = new Map<string, number>();
  seedExternalIdSeenFromPriors(seen, priors);
  const indexed = indexContext(ctx);
  const preparedPriors = priors
    .map((prior) => preparedPartyFromPrior(prior))
    .filter((item): item is PreparedParty => item !== null);
  const preparedNew = rows.map((csv) =>
    prepareRow(csv, mapping, indexed, seen),
  );
  const combined = [...preparedPriors, ...preparedNew];
  const timeline = buildTimeline(combined, indexed);
  const finished = combined.map((item) => finishRow(item, timeline, indexed));
  const newRowNos = new Set(rows.map((row) => row.rowNo));
  return mergeReconcilePlanOutput(finished, newRowNos, priors);
}
