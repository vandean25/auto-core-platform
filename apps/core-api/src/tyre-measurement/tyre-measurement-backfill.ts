import { Prisma, TyreWheelPosition } from '@prisma/client';
import type { PrismaClient, TyreSeason } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { evaluateTyreWheel } from './tyre-evaluation.js';
import type { TyreEvaluationContext } from './tyre-evaluation.js';
import {
  validateTyreThresholdOverrides,
  type TyreThresholdOverrides,
} from './tyre-thresholds.js';

const DEFAULT_BATCH_SIZE = 200;
const WRITE_CHUNK_SIZE = 20;
const WARNING_SAMPLE_LIMIT = 20;
const BACKFILL_AUTHOR = 'Legacy tread backfill';
const POSITIONS = new Set<string>(Object.values(TyreWheelPosition));

export type LegacyTreadWarningReason =
  'NOT_AN_OBJECT' | 'INVALID_KEY' | 'INVALID_VALUE' | 'DUPLICATE_POSITION';

export type LegacyTreadWarning = {
  reason: LegacyTreadWarningReason;
  key?: string;
};

export type LegacyTreadReading = {
  position: TyreWheelPosition;
  mm: number;
};

export type LegacyTreadParse = {
  readings: LegacyTreadReading[];
  warnings: LegacyTreadWarning[];
};

/**
 * Reads the legacy per-position tread JSON. Only plain numbers within the
 * 0–20 mm range become readings; anything else is reported, never guessed.
 */
export function parseLegacyTreadJson(value: unknown): LegacyTreadParse {
  if (value === null || value === undefined) {
    return { readings: [], warnings: [] };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { readings: [], warnings: [{ reason: 'NOT_AN_OBJECT' }] };
  }

  const readings: LegacyTreadReading[] = [];
  const warnings: LegacyTreadWarning[] = [];
  const seen = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toUpperCase();
    if (!POSITIONS.has(key)) {
      warnings.push({ reason: 'INVALID_KEY', key: rawKey });
      continue;
    }
    if (seen.has(key)) {
      warnings.push({ reason: 'DUPLICATE_POSITION', key: rawKey });
      continue;
    }
    seen.add(key);
    if (
      typeof rawValue !== 'number' ||
      !Number.isFinite(rawValue) ||
      rawValue < 0 ||
      rawValue > 20 ||
      rawValue !== Math.round(rawValue * 100) / 100
    ) {
      warnings.push({ reason: 'INVALID_VALUE', key: rawKey });
      continue;
    }
    readings.push({ position: key as TyreWheelPosition, mm: rawValue });
  }
  return { readings, warnings };
}

export type TyreBackfillSummary = {
  tenants: number;
  setsScanned: number;
  eventsScanned: number;
  setsConverted: number;
  eventsConverted: number;
  setsSkippedNoVehicle: number;
  eventsSkippedNoVehicle: number;
  setsSkippedNoReadings: number;
  eventsSkippedNoReadings: number;
  setsSkippedLiveMeasurements: number;
  eventsSkippedLiveMeasurements: number;
  alreadyConverted: number;
  warnings: number;
  warningSamples: string[];
};

export type TyreBackfillOptions = {
  /** Dry-run by default: counts what would change without writing. */
  execute: boolean;
  tenantId?: string;
  batchSize?: number;
};

type LegacyParent = 'set' | 'event';

type BackfillSetRow = {
  id: string;
  site_id: string;
  vehicle_id: string | null;
  season: TyreSeason;
  brand: string | null;
  model: string | null;
  dimension: string | null;
  tread_depth_mm_json: Prisma.JsonValue | null;
  updatedAt: Date;
};

type BackfillEventRow = {
  id: string;
  tyre_set_id: string;
  workshop_order_id: string | null;
  occurred_at: Date;
  tread_depth_mm_json: Prisma.JsonValue | null;
  tyre_set: {
    site_id: string;
    vehicle_id: string | null;
    season: TyreSeason;
    brand: string | null;
    model: string | null;
    dimension: string | null;
  };
};

type TyreSetSnapshot = Pick<
  BackfillSetRow,
  'season' | 'brand' | 'model' | 'dimension' | 'vehicle_id' | 'site_id'
>;

type TenantContext = {
  prisma: PrismaClient;
  tenantId: string;
  execute: boolean;
  batchSize: number;
  summary: TyreBackfillSummary;
  countryBySite: Map<string, string>;
  overrides: TyreThresholdOverrides;
};

export async function backfillTyreMeasurements(
  prisma: PrismaClient,
  options: TyreBackfillOptions,
): Promise<TyreBackfillSummary> {
  const summary: TyreBackfillSummary = {
    tenants: 0,
    setsScanned: 0,
    eventsScanned: 0,
    setsConverted: 0,
    eventsConverted: 0,
    setsSkippedNoVehicle: 0,
    eventsSkippedNoVehicle: 0,
    setsSkippedNoReadings: 0,
    eventsSkippedNoReadings: 0,
    setsSkippedLiveMeasurements: 0,
    eventsSkippedLiveMeasurements: 0,
    alreadyConverted: 0,
    warnings: 0,
    warningSamples: [],
  };
  const tenantIds = options.tenantId
    ? [options.tenantId]
    : (
        await prisma.tenant.findMany({
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      ).map((tenant) => tenant.id);
  summary.tenants = tenantIds.length;

  for (const tenantId of tenantIds) {
    await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: 'tyre-backfill',
        email: 'tyre-backfill@internal',
        tenantId,
        role: 'ADMIN',
      });
      const context = await tenantContext(prisma, tenantId, options, summary);
      if (!context) return;
      await backfillSets(context);
      await backfillEvents(context);
    });
  }
  return summary;
}

async function tenantContext(
  prisma: PrismaClient,
  tenantId: string,
  options: TyreBackfillOptions,
  summary: TyreBackfillSummary,
): Promise<TenantContext | null> {
  const sites = await prisma.site.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, legal_entity: { select: { country_iso: true } } },
  });
  if (sites.length === 0) return null;
  const settings = await prisma.tyreStorageSettings.findFirst({
    where: { tenant_id: tenantId },
    select: { recommendation_overrides: true },
  });
  let overrides: TyreThresholdOverrides;
  try {
    overrides = validateTyreThresholdOverrides(
      settings?.recommendation_overrides ?? {},
    );
  } catch {
    overrides = {};
  }
  return {
    prisma,
    tenantId,
    execute: options.execute,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    summary,
    countryBySite: new Map(
      sites.map((site) => [site.id, site.legal_entity.country_iso]),
    ),
    overrides,
  };
}

function addWarning(context: TenantContext, text: string): void {
  context.summary.warnings += 1;
  if (context.summary.warningSamples.length < WARNING_SAMPLE_LIMIT) {
    context.summary.warningSamples.push(text);
  }
}

function bumpSkippedNoReadings(
  context: TenantContext,
  parent: LegacyParent,
): void {
  if (parent === 'set') {
    context.summary.setsSkippedNoReadings += 1;
  } else {
    context.summary.eventsSkippedNoReadings += 1;
  }
}

function legacyWhere(tenantId: string): Prisma.TyreSetWhereInput {
  return {
    tenant_id: tenantId,
    tread_depth_mm_json: { not: Prisma.DbNull },
  };
}

async function backfillSets(context: TenantContext): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const sets: BackfillSetRow[] = await context.prisma.tyreSet.findMany({
      where: {
        ...legacyWhere(context.tenantId),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: context.batchSize,
      select: {
        id: true,
        site_id: true,
        vehicle_id: true,
        season: true,
        brand: true,
        model: true,
        dimension: true,
        tread_depth_mm_json: true,
        updatedAt: true,
      },
    });
    if (sets.length === 0) break;
    context.summary.setsScanned += sets.length;
    const fresh = await unconverted(
      context,
      'set',
      sets.map((set) => set.id),
    );
    const live = await liveMeasurementLinks(
      context,
      'tyre_set_id',
      sets.filter((set) => fresh.has(set.id)).map((set) => set.id),
    );
    const operations = pendingSetOperations(context, sets, fresh, live);
    context.summary.setsConverted += operations.length;
    if (context.execute) {
      await chunkedPromiseAll(
        operations,
        (operation) => operation(),
        WRITE_CHUNK_SIZE,
      );
    }
    cursor = sets[sets.length - 1].id;
    if (sets.length < context.batchSize) break;
  }
}

function pendingSetOperations(
  context: TenantContext,
  sets: BackfillSetRow[],
  fresh: Set<string>,
  live: Set<string>,
): MeasurementOperation[] {
  const operations: MeasurementOperation[] = [];
  for (const set of sets) {
    if (!fresh.has(set.id)) continue;
    if (live.has(set.id)) {
      context.summary.setsSkippedLiveMeasurements += 1;
      addWarning(
        context,
        `set ${set.id}: live measurements exist, legacy snapshot left unlinked`,
      );
      continue;
    }
    const operation = buildSetMeasurement(context, set);
    if (operation) operations.push(operation);
  }
  return operations;
}

async function backfillEvents(context: TenantContext): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const events: BackfillEventRow[] =
      await context.prisma.tyreSetEvent.findMany({
        where: {
          tenant_id: context.tenantId,
          tread_depth_mm_json: { not: Prisma.DbNull },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: context.batchSize,
        select: {
          id: true,
          tyre_set_id: true,
          workshop_order_id: true,
          occurred_at: true,
          tread_depth_mm_json: true,
          tyre_set: {
            select: {
              site_id: true,
              vehicle_id: true,
              season: true,
              brand: true,
              model: true,
              dimension: true,
            },
          },
        },
      });
    if (events.length === 0) break;
    context.summary.eventsScanned += events.length;
    const fresh = await unconverted(
      context,
      'event',
      events.map((event) => event.id),
    );
    const candidates = events.filter((event) => fresh.has(event.id));
    const live = await liveMeasurementLinks(
      context,
      'tyre_set_event_id',
      candidates.map((event) => event.id),
    );
    const orders = await loadOrderVehicles(
      context,
      candidates.filter((event) => !live.has(event.id)),
    );
    const operations = pendingEventOperations(
      context,
      candidates,
      live,
      orders,
    );
    context.summary.eventsConverted += operations.length;
    if (context.execute) {
      await chunkedPromiseAll(
        operations,
        (operation) => operation(),
        WRITE_CHUNK_SIZE,
      );
    }
    cursor = events[events.length - 1].id;
    if (events.length < context.batchSize) break;
  }
}

function pendingEventOperations(
  context: TenantContext,
  events: BackfillEventRow[],
  live: Set<string>,
  orders: Map<string, { site_id: string | null; vehicle_id: string }>,
): MeasurementOperation[] {
  const operations: MeasurementOperation[] = [];
  for (const event of events) {
    if (live.has(event.id)) {
      context.summary.eventsSkippedLiveMeasurements += 1;
      addWarning(
        context,
        `event ${event.id}: live measurements exist, legacy snapshot left unlinked`,
      );
      continue;
    }
    const operation = buildEventMeasurement(context, event, orders);
    if (operation) operations.push(operation);
  }
  return operations;
}

async function liveMeasurementLinks(
  context: TenantContext,
  field: 'tyre_set_id' | 'tyre_set_event_id',
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await context.prisma.tyreMeasurement.findMany({
    where: {
      tenant_id: context.tenantId,
      site_id: { in: [...context.countryBySite.keys()] },
      source: 'CAPTURE',
      [field]: { in: ids },
    },
    select: { tyre_set_id: true, tyre_set_event_id: true },
    distinct: [field],
  });
  return new Set(rows.flatMap((row) => (row[field] ? [row[field]] : [])));
}

async function unconverted(
  context: TenantContext,
  parent: LegacyParent,
  ids: string[],
): Promise<Set<string>> {
  const refs = ids.map((id) => `${parent}:${id}`);
  const existing = await context.prisma.tyreMeasurement.findMany({
    where: {
      tenant_id: context.tenantId,
      site_id: { in: [...context.countryBySite.keys()] },
      source_ref: { in: refs },
    },
    select: { source_ref: true },
  });
  const converted = new Set(existing.map((row) => row.source_ref));
  context.summary.alreadyConverted += converted.size;
  return new Set(ids.filter((id) => !converted.has(`${parent}:${id}`)));
}

async function loadOrderVehicles(
  context: TenantContext,
  events: BackfillEventRow[],
): Promise<Map<string, { site_id: string | null; vehicle_id: string }>> {
  const ids = [
    ...new Set(
      events.flatMap((event) =>
        event.workshop_order_id ? [event.workshop_order_id] : [],
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  const orders = await context.prisma.workshopOrder.findMany({
    where: {
      tenant_id: context.tenantId,
      site_id: { in: [...context.countryBySite.keys()] },
      id: { in: ids },
    },
    select: { id: true, site_id: true, vehicle_id: true },
  });
  return new Map(
    orders.map((order) => [
      order.id,
      { site_id: order.site_id, vehicle_id: order.vehicle_id },
    ]),
  );
}

type MeasurementOperation = () => Promise<unknown>;

function buildSetMeasurement(
  context: TenantContext,
  set: BackfillSetRow,
): MeasurementOperation | null {
  if (!set.vehicle_id) {
    context.summary.setsSkippedNoVehicle += 1;
    addWarning(context, `set ${set.id}: no vehicle, skipped`);
    return null;
  }
  const data = measurementData(context, {
    parent: 'set',
    parentId: set.id,
    set,
    tyreSetId: set.id,
    treadJson: set.tread_depth_mm_json,
    vehicleId: set.vehicle_id,
    measuredAt: set.updatedAt,
    workshopOrderId: null,
  });
  return data ? () => context.prisma.tyreMeasurement.create({ data }) : null;
}

function buildEventMeasurement(
  context: TenantContext,
  event: BackfillEventRow,
  orders: Map<string, { site_id: string | null; vehicle_id: string }>,
): MeasurementOperation | null {
  const counters = context.summary;
  if (!event.tyre_set.vehicle_id) {
    counters.eventsSkippedNoVehicle += 1;
    addWarning(context, `event ${event.id}: set has no vehicle, skipped`);
    return null;
  }
  let workshopOrderId: string | null = null;
  if (event.workshop_order_id) {
    const order = orders.get(event.workshop_order_id);
    if (
      order &&
      order.site_id === event.tyre_set.site_id &&
      order.vehicle_id === event.tyre_set.vehicle_id
    ) {
      workshopOrderId = event.workshop_order_id;
    } else {
      addWarning(
        context,
        `event ${event.id}: workshop order does not match the set, unlinked`,
      );
    }
  }
  const data = measurementData(context, {
    parent: 'event',
    parentId: event.id,
    set: event.tyre_set,
    tyreSetId: event.tyre_set_id,
    treadJson: event.tread_depth_mm_json,
    vehicleId: event.tyre_set.vehicle_id,
    measuredAt: event.occurred_at,
    workshopOrderId,
  });
  return data ? () => context.prisma.tyreMeasurement.create({ data }) : null;
}

function measurementData(
  context: TenantContext,
  input: {
    parent: LegacyParent;
    parentId: string;
    set: TyreSetSnapshot;
    tyreSetId: string;
    treadJson: Prisma.JsonValue | null;
    vehicleId: string;
    measuredAt: Date;
    workshopOrderId: string | null;
  },
): Prisma.TyreMeasurementUncheckedCreateInput | null {
  const country = context.countryBySite.get(input.set.site_id);
  if (!country) {
    bumpSkippedNoReadings(context, input.parent);
    addWarning(
      context,
      `${input.parent} ${input.parentId}: site has no country`,
    );
    return null;
  }
  const parsed = parseLegacyTreadJson(input.treadJson);
  if (parsed.readings.length === 0) {
    for (const warning of parsed.warnings) {
      addWarning(
        context,
        `${input.parent} ${input.parentId}: ${warning.reason}${
          warning.key ? ` (${warning.key})` : ''
        }`,
      );
    }
    bumpSkippedNoReadings(context, input.parent);
    return null;
  }
  for (const warning of parsed.warnings) {
    addWarning(
      context,
      `${input.parent} ${input.parentId}: ${warning.reason}${
        warning.key ? ` (${warning.key})` : ''
      }`,
    );
  }
  const evaluationContext: TyreEvaluationContext = {
    country,
    weightClass: 'UP_TO_3500_KG',
    asOf: input.measuredAt,
    overrides: context.overrides,
  };
  return {
    tenant_id: context.tenantId,
    site_id: input.set.site_id,
    vehicle_id: input.vehicleId,
    workshop_order_id: input.workshopOrderId,
    tyre_set_id: input.tyreSetId,
    tyre_set_event_id: input.parent === 'event' ? input.parentId : undefined,
    measured_at: input.measuredAt,
    measured_by: null,
    measured_by_name: BACKFILL_AUTHOR,
    country,
    weight_class: 'UP_TO_3500_KG',
    weight_class_source: 'DEFAULT',
    source: 'LEGACY_TREAD_JSON',
    source_ref: `${input.parent}:${input.parentId}`,
    wheels: {
      create: parsed.readings.map((reading) => ({
        position: reading.position,
        tread_inner_mm: null,
        tread_middle_mm: reading.mm,
        tread_outer_mm: null,
        brand: input.set.brand,
        model: input.set.model,
        size: input.set.dimension,
        dot: null,
        season: input.set.season,
        construction: 'RADIAL',
        winter_marking: 'NONE',
        media_id: null,
        evaluation: evaluateTyreWheel(
          {
            treadInnerMm: reading.mm,
            treadMiddleMm: reading.mm,
            treadOuterMm: reading.mm,
            season: input.set.season,
            dot: null,
          },
          evaluationContext,
        ),
      })),
    },
  };
}
