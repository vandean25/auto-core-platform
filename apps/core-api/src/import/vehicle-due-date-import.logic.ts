import { ImportRowAction, VehicleNoticeStatus } from '@prisma/client';
import {
  CANONICAL_ROW_ISSUE_CODES,
  cell,
  errorRow,
  invalidIssue,
  optionalDay,
  parseIsoDay,
  prepareCanonicalRow,
  requiredIssue,
  type PreparedBase,
} from './canonical-csv-cell.util.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportRowIssue,
} from './import.types.js';
import {
  mergeReconcilePlanOutput,
  normalizedStringField,
  seedExternalIdSeenFromPriors,
} from './import-dry-run-reconcile.prior.js';

/** The `kind` tokens of the canonical vehicle_due_dates.csv. */
export const DUE_DATE_KIND = {
  INSPECTION_57A: 'INSPECTION_57A',
  SERVICE: 'SERVICE',
} as const;

export type DueDateKind = (typeof DUE_DATE_KIND)[keyof typeof DUE_DATE_KIND];

export type StoredInspection = {
  id: string;
  vehicle_id: string;
  inspected_on: string;
  plaketten_valid_until_year: number;
  plaketten_valid_until_month: number;
  station_name: string | null;
  notes: string | null;
};

export type StoredServiceNotice = {
  id: string;
  vehicle_id: string;
  external_ref: string | null;
  status: VehicleNoticeStatus;
  body: string | null;
  due_date: string | null;
  due_mileage: number | null;
};

export type DueDatePlanContext = {
  vehicleIdByExternalId: Map<string, string>;
  /** Existing VEHICLE_DUE_DATE mappings: external id to inspection record or notice id. */
  dueIdByExternalId: Map<string, string>;
  /** PICKERL_57A records of the vehicles the file mentions. */
  inspections: StoredInspection[];
  /** SERVICE_DUE notices of the vehicles the file mentions. */
  serviceNotices: StoredServiceNotice[];
  options: ImportJobOptions;
  today: string;
};

/** The plan context with lookups by id and by vehicle, built once per file. */
type IndexedDueCtx = DueDatePlanContext & {
  inspectionById: Map<string, StoredInspection>;
  noticeById: Map<string, StoredServiceNotice>;
  inspectionsByVehicle: Map<string, StoredInspection[]>;
  noticesByVehicle: Map<string, StoredServiceNotice[]>;
};

function groupByVehicle<T extends { vehicle_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.vehicle_id) ?? [];
    list.push(row);
    grouped.set(row.vehicle_id, list);
  }
  return grouped;
}

function indexContext(ctx: DueDatePlanContext): IndexedDueCtx {
  return {
    ...ctx,
    inspectionById: new Map(ctx.inspections.map((item) => [item.id, item])),
    noticeById: new Map(ctx.serviceNotices.map((item) => [item.id, item])),
    inspectionsByVehicle: groupByVehicle(ctx.inspections),
    noticesByVehicle: groupByVehicle(ctx.serviceNotices),
  };
}

export type DueDateCsvRow = { rowNo: number; record: Record<string, string> };

type CommonFields = {
  external_id: string;
  vehicle_external_id: string;
  external_ref: string | null;
  notes: string | null;
};

type NormalizedInspection = CommonFields & {
  kind: typeof DUE_DATE_KIND.INSPECTION_57A;
  inspected_on: string;
  plaketten_valid_until_year: number;
  plaketten_valid_until_month: number;
  station_name: string | null;
};

type NormalizedService = CommonFields & {
  kind: typeof DUE_DATE_KIND.SERVICE;
  due_date: string | null;
  due_mileage: number | null;
};

type NormalizedDueRow = NormalizedInspection | NormalizedService;

type PreparedDue = PreparedBase<NormalizedDueRow>;

const MAX_MILEAGE = 2147483647;

type Texts = (field: string) => string;

function blankIssues(
  texts: Texts,
  fields: string[],
  kind: string,
): ImportRowIssue[] {
  return fields
    .filter((field) => texts(field) !== '')
    .map((field) => invalidIssue(field, `${field} must be blank for ${kind}`));
}

function parseYear(raw: string, issues: ImportRowIssue[]): number {
  const year = /^\d{4}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(year >= 1900 && year <= 2100)) {
    issues.push(
      invalidIssue(
        'plaketten_valid_until_year',
        'plaketten_valid_until_year must be a year between 1900 and 2100',
      ),
    );
  }
  return year;
}

function parseMonth(raw: string, issues: ImportRowIssue[]): number {
  const month = /^([1-9]|1[0-2])$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isNaN(month)) {
    issues.push(
      invalidIssue(
        'plaketten_valid_until_month',
        'plaketten_valid_until_month must be 1-12 without a leading zero',
      ),
    );
  }
  return month;
}

function checkInspectionDates(
  row: { inspected_on: string; year: number; month: number },
  cutoff: string,
  issues: ImportRowIssue[],
): void {
  if (row.inspected_on > cutoff) {
    issues.push(
      invalidIssue('inspected_on', `inspected_on cannot be after ${cutoff}`),
    );
  }
  const inspectedMonth =
    Number(row.inspected_on.slice(0, 4)) * 12 +
    Number(row.inspected_on.slice(5, 7));
  if (row.year * 12 + row.month < inspectedMonth) {
    issues.push(
      invalidIssue(
        'plaketten_valid_until_month',
        'plaketten_valid_until cannot be before the inspection month',
      ),
    );
  }
}

function normalizeInspection(
  common: CommonFields,
  texts: Texts,
  cutoff: string,
  issues: ImportRowIssue[],
): NormalizedInspection | null {
  issues.push(
    ...blankIssues(
      texts,
      ['due_date', 'due_mileage'],
      DUE_DATE_KIND.INSPECTION_57A,
    ),
  );
  const inspectedRaw = texts('inspected_on');
  const inspected_on = parseIsoDay(inspectedRaw);
  if (inspectedRaw === '') {
    issues.push(requiredIssue('inspected_on'));
  } else if (inspected_on === null) {
    issues.push(
      invalidIssue('inspected_on', 'inspected_on must be a YYYY-MM-DD date'),
    );
  }
  const year = parseYear(texts('plaketten_valid_until_year'), issues);
  const month = parseMonth(texts('plaketten_valid_until_month'), issues);
  if (inspected_on !== null && issues.length === 0) {
    checkInspectionDates({ inspected_on, year, month }, cutoff, issues);
  }
  if (issues.length > 0 || inspected_on === null) {
    return null;
  }
  return {
    ...common,
    kind: DUE_DATE_KIND.INSPECTION_57A,
    inspected_on,
    plaketten_valid_until_year: year,
    plaketten_valid_until_month: month,
    station_name: texts('station_name') || null,
  };
}

function parseMileage(raw: string, issues: ImportRowIssue[]): number | null {
  if (raw === '') {
    return null;
  }
  const value = /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(value >= 0 && value <= MAX_MILEAGE)) {
    issues.push(
      invalidIssue(
        'due_mileage',
        'due_mileage must be an absolute kilometer value (digits only, 0-2147483647)',
      ),
    );
    return null;
  }
  return value;
}

function normalizeService(
  common: CommonFields,
  texts: Texts,
  issues: ImportRowIssue[],
): NormalizedService | null {
  issues.push(
    ...blankIssues(
      texts,
      [
        'inspected_on',
        'plaketten_valid_until_year',
        'plaketten_valid_until_month',
        'station_name',
      ],
      DUE_DATE_KIND.SERVICE,
    ),
  );
  if (common.external_ref === null) {
    issues.push(requiredIssue('external_ref'));
  }
  const due_date = optionalDay(texts('due_date'), 'due_date', issues);
  const due_mileage = parseMileage(texts('due_mileage'), issues);
  if (due_date === null && due_mileage === null && issues.length === 0) {
    issues.push(
      invalidIssue('due_date', 'SERVICE requires due_date and/or due_mileage'),
    );
  }
  return issues.length > 0
    ? null
    : { ...common, kind: DUE_DATE_KIND.SERVICE, due_date, due_mileage };
}

function headerIssues(texts: Texts): ImportRowIssue[] {
  const issues = ['external_id', 'vehicle_external_id', 'kind']
    .filter((field) => texts(field) === '')
    .map(requiredIssue);
  const kind = texts('kind');
  if (kind !== '' && !Object.values<string>(DUE_DATE_KIND).includes(kind)) {
    issues.push(invalidIssue('kind', `kind "${kind}" is not allowed`));
  }
  return issues;
}

function normalizeDueRow(
  record: Record<string, string>,
  mapping: Record<string, string>,
  cutoff: string,
): { row: NormalizedDueRow | null; issues: ImportRowIssue[] } {
  const texts: Texts = (field) => cell(record, mapping, field);
  const issues = headerIssues(texts);
  if (issues.length > 0) {
    return { row: null, issues };
  }
  const common: CommonFields = {
    external_id: texts('external_id'),
    vehicle_external_id: texts('vehicle_external_id'),
    external_ref: texts('external_ref') || null,
    notes: texts('notes') || null,
  };
  const row =
    texts('kind') === DUE_DATE_KIND.SERVICE
      ? normalizeService(common, texts, issues)
      : normalizeInspection(common, texts, cutoff, issues);
  return { row, issues };
}

function conflictIssue(field: string, message: string): ImportRowIssue {
  return {
    code: CANONICAL_ROW_ISSUE_CODES.NATURAL_KEY_CONFLICT,
    message,
    field,
  };
}

function identityIssue(message: string): ImportRowIssue {
  return {
    code: CANONICAL_ROW_ISSUE_CODES.IDENTITY_CHANGED,
    message,
    field: 'external_id',
  };
}

function evidenceIssue(message: string): ImportRowIssue {
  return { code: CANONICAL_ROW_ISSUE_CODES.EVIDENCE_IMMUTABLE, message };
}

/** Blank notes and station never clear a stored value, so only supplied cells can differ. */
function resolveStoredInspection(
  prepared: PreparedDue,
  row: NormalizedInspection,
  stored: StoredInspection,
): void {
  prepared.entityId = stored.id;
  const differs =
    stored.inspected_on !== row.inspected_on ||
    stored.plaketten_valid_until_year !== row.plaketten_valid_until_year ||
    stored.plaketten_valid_until_month !== row.plaketten_valid_until_month ||
    (row.station_name !== null && row.station_name !== stored.station_name) ||
    (row.notes !== null && row.notes !== stored.notes);
  if (differs) {
    prepared.issues.push(
      evidenceIssue('Inspection evidence is immutable; supplied changes block'),
    );
    return;
  }
  prepared.action = ImportRowAction.SKIP;
}

function serviceDiffers(row: NormalizedService, stored: StoredServiceNotice) {
  return (
    (row.due_date !== null && row.due_date !== stored.due_date) ||
    (row.due_mileage !== null && row.due_mileage !== stored.due_mileage) ||
    (row.notes !== null && row.notes !== stored.body)
  );
}

function resolveStoredService(
  prepared: PreparedDue,
  row: NormalizedService,
  stored: StoredServiceNotice,
  options: ImportJobOptions,
): void {
  prepared.entityId = stored.id;
  if (stored.external_ref !== row.external_ref) {
    prepared.issues.push(
      identityIssue(
        'The schedule reference of a mapped due date cannot change',
      ),
    );
    return;
  }
  if (stored.status !== VehicleNoticeStatus.OPEN) {
    prepared.issues.push(
      evidenceIssue('The notice was resolved locally and cannot be reopened'),
    );
    return;
  }
  if (!serviceDiffers(row, stored)) {
    prepared.action = ImportRowAction.SKIP;
  } else if (options.update_existing === true) {
    prepared.action = ImportRowAction.UPDATE;
  } else {
    prepared.action = ImportRowAction.SKIP;
    prepared.warnings.push({
      code: CANONICAL_ROW_ISSUE_CODES.UPDATE_NOT_ENABLED,
      message: 'Existing notice differs; enable update_existing to apply it',
    });
  }
}

function resolveMapped(
  prepared: PreparedDue,
  row: NormalizedDueRow,
  mappedId: string,
  ctx: IndexedDueCtx,
): void {
  const vehicleId = prepared.vehicleId as string;
  const inspection = ctx.inspectionById.get(mappedId);
  const notice = ctx.noticeById.get(mappedId);
  const target = inspection ?? notice;
  if (!target || target.vehicle_id !== vehicleId) {
    prepared.issues.push(
      identityIssue('The mapped target does not belong to this vehicle'),
    );
  } else if (row.kind === DUE_DATE_KIND.INSPECTION_57A && inspection) {
    resolveStoredInspection(prepared, row, inspection);
  } else if (row.kind === DUE_DATE_KIND.SERVICE && notice) {
    resolveStoredService(prepared, row, notice, ctx.options);
  } else {
    prepared.issues.push(
      identityIssue('The kind of a mapped due date cannot change'),
    );
  }
}

function checkAgainstStored(
  prepared: PreparedDue,
  row: NormalizedDueRow,
  ctx: IndexedDueCtx,
): void {
  const vehicleId = prepared.vehicleId as string;
  const clash =
    row.kind === DUE_DATE_KIND.INSPECTION_57A
      ? (ctx.inspectionsByVehicle.get(vehicleId) ?? []).some(
          (item) => item.inspected_on === row.inspected_on,
        )
      : (ctx.noticesByVehicle.get(vehicleId) ?? []).some(
          (item) => item.external_ref === row.external_ref,
        );
  if (clash) {
    prepared.issues.push(
      conflictIssue(
        'external_id',
        'A target record with the same natural key exists without a mapping',
      ),
    );
  }
}

/** Resolves the vehicle and matches the row to a mapped or natural-key target. */
function resolveRow(prepared: PreparedDue, ctx: IndexedDueCtx): void {
  const row = prepared.row as NormalizedDueRow;
  prepared.vehicleId = ctx.vehicleIdByExternalId.get(row.vehicle_external_id);
  if (!prepared.vehicleId) {
    prepared.issues.push({
      code: CANONICAL_ROW_ISSUE_CODES.UNKNOWN_VEHICLE,
      message: 'vehicle_external_id does not resolve in this tenant',
      field: 'vehicle_external_id',
    });
    return;
  }
  const mappedId = ctx.dueIdByExternalId.get(row.external_id);
  if (mappedId) {
    resolveMapped(prepared, row, mappedId, ctx);
  } else {
    checkAgainstStored(prepared, row, ctx);
  }
}

function prepareRow(
  csv: DueDateCsvRow,
  mapping: Record<string, string>,
  ctx: IndexedDueCtx,
  seen: Map<string, number>,
): PreparedDue {
  const cutoff = ctx.options.cutover_date ?? ctx.today;
  return prepareCanonicalRow<NormalizedDueRow>(
    csv,
    mapping,
    (record) => normalizeDueRow(record, mapping, cutoff),
    seen,
    (prepared) => resolveRow(prepared, ctx),
  );
}

/** Natural keys inside the file: same vehicle and day, report reference, or schedule reference. */
function naturalKeys(item: PreparedDue): string[] {
  const row = item.row as NormalizedDueRow;
  const vehicle = item.vehicleId as string;
  if (row.kind === DUE_DATE_KIND.SERVICE) {
    return [`${vehicle}|service|${row.external_ref}`];
  }
  return [
    `${vehicle}|day|${row.inspected_on}`,
    ...(row.external_ref ? [`${vehicle}|report|${row.external_ref}`] : []),
  ];
}

function flagFileConflicts(prepared: PreparedDue[]): void {
  const live = prepared.filter((item) => item.issues.length === 0 && item.row);
  const counts = new Map<string, number>();
  for (const item of live) {
    for (const key of naturalKeys(item)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const item of live) {
    if (naturalKeys(item).some((key) => (counts.get(key) ?? 0) > 1)) {
      item.issues.push(
        conflictIssue(
          'external_id',
          'Another row in this file has the same natural key; same-day corrections need the evidence workflow',
        ),
      );
    }
  }
}

function toResult(item: PreparedDue): DryRunRowResult {
  if (item.issues.length > 0 || !item.row) {
    return errorRow(item.rowNo, item.externalId, item.issues, item.warnings);
  }
  return {
    row_no: item.rowNo,
    external_id: item.externalId,
    action: item.action,
    entity_id: item.entityId,
    errors: [],
    warnings: item.warnings,
    normalized: { ...item.row, vehicle_id: item.vehicleId },
  };
}

function dueRowFromPriorNormalized(
  normalized: Record<string, unknown>,
  prior: DryRunRowResult,
): NormalizedDueRow | null {
  const common = {
    external_id:
      normalizedStringField(normalized, 'external_id') ??
      prior.external_id ??
      '',
    vehicle_external_id: '',
    external_ref: normalizedStringField(normalized, 'external_ref'),
    notes: normalizedStringField(normalized, 'notes'),
  };
  if (normalized.kind === DUE_DATE_KIND.INSPECTION_57A) {
    return {
      ...common,
      kind: DUE_DATE_KIND.INSPECTION_57A,
      inspected_on: normalizedStringField(normalized, 'inspected_on') ?? '',
      plaketten_valid_until_year: Number(normalized.plaketten_valid_until_year),
      plaketten_valid_until_month: Number(
        normalized.plaketten_valid_until_month,
      ),
      station_name:
        typeof normalized.station_name === 'string'
          ? normalized.station_name
          : null,
    };
  }
  if (normalized.kind === DUE_DATE_KIND.SERVICE) {
    return {
      ...common,
      kind: DUE_DATE_KIND.SERVICE,
      due_date:
        typeof normalized.due_date === 'string' ? normalized.due_date : null,
      due_mileage:
        typeof normalized.due_mileage === 'number'
          ? normalized.due_mileage
          : null,
    };
  }
  return null;
}

function preparedDueFromPrior(prior: DryRunRowResult): PreparedDue | null {
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
  const vehicleId = normalized.vehicle_id;
  if (typeof vehicleId !== 'string') {
    return null;
  }
  const row = dueRowFromPriorNormalized(normalized, prior);
  if (!row) {
    return null;
  }
  return {
    rowNo: prior.row_no,
    externalId: prior.external_id,
    issues: [],
    warnings: [...prior.warnings],
    action: prior.action,
    entityId: prior.entity_id,
    row,
    vehicleId,
  };
}

/** Plans every vehicle_due_dates.csv row against the file itself and the target records. */
export function planVehicleDueDateRows(
  rows: DueDateCsvRow[],
  mapping: Record<string, string>,
  ctx: DueDatePlanContext,
  reconcilePriorResults?: DryRunRowResult[],
): DryRunRowResult[] {
  const priors = reconcilePriorResults ?? [];
  const seen = new Map<string, number>();
  seedExternalIdSeenFromPriors(seen, priors);
  const indexed = indexContext(ctx);
  const preparedPriors = priors
    .map((prior) => preparedDueFromPrior(prior))
    .filter((item): item is PreparedDue => item !== null);
  const preparedNew = rows.map((csv) =>
    prepareRow(csv, mapping, indexed, seen),
  );
  const combined = [...preparedPriors, ...preparedNew];
  flagFileConflicts(combined);
  const finished = combined.map(toResult);
  const newRowNos = new Set(rows.map((row) => row.rowNo));
  return mergeReconcilePlanOutput(finished, newRowNos, priors);
}
