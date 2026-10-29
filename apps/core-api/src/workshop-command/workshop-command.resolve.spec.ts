import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { LoanerVehiclesAuthorization } from '../loaner-vehicles/loaner-vehicles.authorization.js';
import { WorkshopCommandResolver } from './workshop-command.resolve.js';
import { intentFingerprint } from './workshop-command.tokens.js';
import type {
  Clarification,
  CommandSelection,
  InterpretResult,
  WorkshopIntent,
} from './workshop-command.types.js';

type Json = Record<string, any>;

const FIXTURE_DIR = new URL(
  '../../../../docs/internal/02-Feature-Specs/Platform/command-first-workshop/fixtures/',
  import.meta.url,
);

const DEFAULT_NOW = '2026-10-15T14:30:00+02:00';
const DEFAULT_COMMAND_ID = '51500000-0000-4000-8000-0000000000aa';

function fixture(name: string): Json {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8')) as Json;
}

type World = Json;

function clock(date: Date | string): number {
  return new Date(date).getTime();
}

/**
 * Minimal in-memory stand-in for the Prisma delegate calls the resolver makes.
 * It intentionally keeps filtering dumb so the fixtures drive the assertions.
 */
function createPrisma(world: World) {
  const sites = world.sites as Json[];
  const customers = world.customers as Json[];
  const vehicles = (world.vehicles as Json[]).map(
    (vehicle): Json => ({
      ...vehicle,
      plate_normalized: (vehicle.plate ?? '').toUpperCase().replace(/[\s-]/gu, ''),
    }),
  );
  const laborOperations = (world.labor_operations as Json[]).map((operation) => ({
    ...operation,
    is_active: operation.active ?? true,
    hourly_rate: (operation.hourly_rate_cents / 100).toFixed(2),
  }));
  const presets = (world.presets as Json[]).map(
    (preset): Json => ({
      ...preset,
      quantity_milli: preset.quantity_milli ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
  const bays = world.bays as Json[];
  const loaners = world.loaners as Json[];
  const orders: Json[] = (world.orders as Json[] | undefined) ?? [];
  const bookings: Json[] = (world.bookings as Json[] | undefined) ?? [];

  const stringMatch = (value: string | null | undefined, filter: Json): boolean => {
    if (typeof filter === 'string') return value === filter;
    if (filter?.equals !== undefined) {
      if (value === null || value === undefined) return false;
      return filter.mode === 'insensitive'
        ? value.toLowerCase() === String(filter.equals).toLowerCase()
        : value === filter.equals;
    }
    return true;
  };

  const byIds = <T extends Json>(rows: T[], filter: Json | undefined): T[] => {
    if (!filter?.in) return rows;
    const ids = filter.in as string[];
    return rows.filter((row) => ids.includes(row.id));
  };

  return {
    site: {
      findMany: async () => sites,
      findFirst: async ({ where }: Json) =>
        sites.find((site) => site.id === where.id && site.is_active === where.is_active) ?? null,
    },
    vehicle: {
      findMany: async ({ where }: Json) => {
        let rows = vehicles.filter((vehicle) => vehicle.tenant_id === where.tenant_id);
        if (where.customer_id?.in) {
          rows = rows.filter((vehicle) => where.customer_id.in.includes(vehicle.customer_id));
        }
        for (const clause of (where.OR as Json[] | undefined) ?? []) {
          if (clause.plate !== undefined) {
            rows = rows.filter((vehicle) => stringMatch(vehicle.plate, clause.plate));
          } else if (clause.plate_normalized !== undefined) {
            rows = rows.filter(
              (vehicle) => vehicle.plate_normalized === clause.plate_normalized,
            );
          }
        }
        if (where.vin !== undefined) {
          rows = rows.filter((vehicle) => stringMatch(vehicle.vin, where.vin));
        }
        return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      },
    },
    customer: {
      findMany: async ({ where }: Json) => {
        let rows = customers.filter((customer) => customer.tenant_id === where.tenant_id);
        const clauses = (where.OR as Json[]) ?? [];
        rows = rows.filter((customer) =>
          clauses.some(
            (clause) =>
              (clause.last_name && stringMatch(customer.last_name, clause.last_name)) ||
              (clause.company_name && stringMatch(customer.company_name, clause.company_name)),
          ),
        );
        return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      },
      findFirst: async ({ where }: Json) =>
        customers.find(
          (customer) => customer.id === where.id && customer.tenant_id === where.tenant_id,
        ) ?? null,
    },
    workshopCommandPreset: {
      findMany: async ({ where }: Json) =>
        presets.filter(
          (preset) =>
            preset.tenant_id === where.tenant_id &&
            where.preset_key.in.includes(preset.preset_key) &&
            preset.active === where.active &&
            (preset.site_id === where.OR[0].site_id || preset.site_id === null),
        ),
    },
    laborOperation: {
      findMany: async ({ where }: Json) => byIds(laborOperations, where.id),
    },
    catalogItem: {
      findMany: async () => [],
    },
    bay: {
      findMany: async ({ where }: Json) =>
        bays
          .filter(
            (bay) =>
              bay.tenant_id === where.tenant_id &&
              bay.site_id === where.site_id &&
              bay.is_active === where.is_active,
          )
          .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)),
    },
    workshopOrder: {
      findMany: async ({ where }: Json) =>
        orders.filter(
          (order) =>
            order.tenant_id === where.tenant_id &&
            order.site_id === where.site_id &&
            (where.bay_id.in as string[]).includes(order.bay_id) &&
            where.status.in.includes(order.status) &&
            clock(order.scheduled_start_at) < clock(where.scheduled_start_at.lt) &&
            clock(order.scheduled_end_at) > clock(where.scheduled_end_at.gt),
        ),
    },
    loanerVehicle: {
      findMany: async ({ where }: Json) =>
        loaners
          .filter(
            (loaner) =>
              loaner.tenant_id === where.tenant_id &&
              loaner.site_id === where.site_id &&
              loaner.active === where.active &&
              loaner.status === where.status,
          )
          .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))),
    },
    loanerBooking: {
      findMany: async ({ where }: Json) =>
        bookings.filter(
          (booking) =>
            (where.loaner_vehicle_id.in as string[]).includes(booking.loaner_vehicle_id) &&
            where.status.in.includes(booking.status) &&
            clock(booking.planned_from) < clock(where.planned_from.lt) &&
            clock(booking.planned_to) > clock(where.planned_to.gt),
        ),
    },
  };
}

function buildResolver(world: World): WorkshopCommandResolver {
  const prisma = createPrisma(world);
  const authorization = {
    assertWriteAccess: async () => undefined,
  } as unknown as LoanerVehiclesAuthorization;
  return new WorkshopCommandResolver(prisma as unknown as PrismaService, authorization);
}

const TENANT_TAGGED_COLLECTIONS = [
  'sites',
  'customers',
  'vehicles',
  'labor_operations',
  'presets',
  'bays',
  'loaners',
] as const;

function withTenant(world: World): World {
  const tagged: World = { ...world };
  for (const key of TENANT_TAGGED_COLLECTIONS) {
    tagged[key] = (world[key] as Json[]).map((row) => ({
      ...row,
      tenant_id: 'tenant-1',
    }));
  }
  return tagged;
}

function siteOf(world: World) {
  const site = world.sites.find((entry: Json) => entry.id === world.operative_site_id)!;
  return { ...site, tenant_id: 'tenant-1' };
}

type ResolveOptions = {
  text: string;
  commandId?: string;
  source?: 'keyboard' | 'voice_transcript';
  now?: string;
  selections?: CommandSelection[];
};

function resolveIn(world: World, options: ResolveOptions): Promise<InterpretResult> {
  const tagged = withTenant(world);
  return buildResolver(tagged).resolve({
    tenantId: 'tenant-1',
    site: siteOf(tagged),
    text: options.text,
    commandId: options.commandId ?? DEFAULT_COMMAND_ID,
    source: options.source ?? 'keyboard',
    now: new Date(options.now ?? DEFAULT_NOW),
    selections: options.selections ?? [],
  });
}

/** Resolves one sentence against the shared pilot world. */
function resolveSentence(
  text: string,
  options: Omit<ResolveOptions, 'text'> = {},
): Promise<InterpretResult> {
  return resolveIn(fixture('world.json'), { text, ...options });
}

async function runFixture(name: string): Promise<InterpretResult> {
  const document = fixture(name);
  return resolveIn(
    { ...fixture(document.world), ...(document.world_patch ?? {}) } as World,
    {
      text: document.input.text,
      commandId: document.input.command_id,
      source: document.input.source,
      now: document.now,
    },
  );
}

describe('WorkshopCommandResolver fixtures', () => {
  it('resolves the canonical sentence into a ready intent', async () => {
    const document = fixture('canonical-huber-golf.json');
    const result = await runFixture('canonical-huber-golf.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns TIME_CONTRADICTORY for two start clocks', async () => {
    const document = fixture('contradictory-time.json');
    const result = await runFixture('contradictory-time.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns TIME_AMBIGUOUS across the fall-back overlap', async () => {
    const document = fixture('dst-overlap.json');
    const result = await runFixture('dst-overlap.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns TIME_DOES_NOT_EXIST in the spring-forward gap', async () => {
    const document = fixture('dst-gap.json');
    const result = await runFixture('dst-gap.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns UNSUPPORTED_SERVICE for an unknown service', async () => {
    const document = fixture('unsupported-service.json');
    const result = await runFixture('unsupported-service.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns SITE_MISMATCH for a different named site', async () => {
    const document = fixture('wrong-site.json');
    const result = await runFixture('wrong-site.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns CUSTOMER_AMBIGUOUS for two matching customers', async () => {
    const document = fixture('multiple-huber-golf.json');
    const result = await runFixture('multiple-huber-golf.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns VEHICLE_AMBIGUOUS for two matching vehicles', async () => {
    const document = fixture('multiple-golfs-one-huber.json');
    const result = await runFixture('multiple-golfs-one-huber.json');
    expect(result).toEqual(document.expect.body);
  });

  it('returns CUSTOMER_NOT_FOUND when the name is unknown', async () => {
    const document = fixture('no-match.json');
    const result = await runFixture('no-match.json');
    expect(result).toEqual(document.expect.body);
  });

  it('resolves a plate and a VIN locally without a provider call', async () => {
    const document = fixture('no-provider-pii.json');
    for (const testCase of document.cases) {
      const result = await resolveIn(fixture('world.json'), {
        text: testCase.input.text,
        commandId: testCase.input.command_id,
        source: testCase.input.source,
        now: testCase.now,
      });

      for (const [key, value] of Object.entries(testCase.expect.body)) {
        expect((result as WorkshopIntent)[key as keyof WorkshopIntent]).toEqual(value);
      }
    }
  });

  it('reaches a ready intent through an explicit end clock', async () => {
    const result = await resolveSentence(
      'Huber Golf morgen 8 Uhr bis 10 Uhr großes Service',
    );

    expect(result.status).toBe('ready');
    expect((result as WorkshopIntent).schedule).toEqual(
      expect.objectContaining({
        local_date: '2026-10-16',
        local_start: '08:00',
        local_end: '10:00',
        duration_minutes: 120,
        duration_source: 'end_clock',
      }),
    );
  });

  it('resolves both spellings of übermorgen', async () => {
    for (const text of [
      'Huber Golf übermorgen 8 Uhr großes Service',
      'Huber Golf uebermorgen 8 Uhr großes Service',
    ]) {
      const result = await resolveSentence(text);

      expect(result.status).toBe('ready');
      expect((result as WorkshopIntent).schedule.local_date).toBe('2026-10-17');
    }
  });

  it('shows the clock the advisor chose for a contradictory start time', async () => {
    const text = 'Huber Golf morgen 8 Uhr und um 10 Uhr großes Service';
    const clarification = (await resolveSentence(text)) as Clarification;
    expect(clarification.code).toBe('TIME_CONTRADICTORY');
    const chosen = clarification.choices[1];
    expect(chosen).toEqual(
      expect.objectContaining({ slot: 'local_start', value: '10:00' }),
    );

    const ready = (await resolveSentence(text, {
      selections: [{ slot: chosen.slot, value: chosen.value }],
    })) as WorkshopIntent;

    expect(ready.status).toBe('ready');
    expect(ready.schedule).toEqual(
      expect.objectContaining({
        local_start: '10:00',
        local_end: '11:30',
        start_at: '2026-10-16T08:00:00.000Z',
        duration_source: 'preset_sum',
      }),
    );
  });

  it('keeps one plan fingerprint for the same intent under another command id', async () => {
    const reviewed = (await runFixture('canonical-huber-golf.json')) as WorkshopIntent;

    expect(intentFingerprint(reviewed)).toBe(
      intentFingerprint({ ...reviewed, command_id: randomUUID() }),
    );
  });

  it('changes the plan fingerprint when a labor rate moves after the preview', async () => {
    const document = fixture('canonical-huber-golf.json');
    const reviewed = (await runFixture('canonical-huber-golf.json')) as WorkshopIntent;
    const world = {
      ...fixture(document.world),
      labor_operations: (fixture(document.world).labor_operations as Json[]).map(
        (operation) => ({
          ...operation,
          hourly_rate_cents: operation.hourly_rate_cents * 2,
        }),
      ),
    };

    const live = (await resolveIn(world, {
      text: document.input.text,
      commandId: document.input.command_id,
      now: document.now,
    })) as WorkshopIntent;

    expect(live.position_plan.lines[0].net_cents).toBe(
      2 * reviewed.position_plan.lines[0].net_cents,
    );
    expect(intentFingerprint(reviewed)).not.toBe(intentFingerprint(live));
  });

  it('changes the plan fingerprint when the resolved day crosses midnight', async () => {
    const document = fixture('morgen-midnight.json');
    const reviewed: WorkshopIntent[] = [];
    for (const testCase of document.cases) {
      const intent = (await resolveIn(fixture(document.world), {
        text: testCase.input.text,
        commandId: testCase.input.command_id,
        now: testCase.now,
      })) as WorkshopIntent;

      expect(intent).toEqual(testCase.expect.body);
      reviewed.push(intent);
    }

    expect(reviewed.map((intent) => intent.schedule.local_date)).toEqual([
      '2026-10-17',
      '2026-10-16',
    ]);
    expect(intentFingerprint(reviewed[0])).not.toBe(intentFingerprint(reviewed[1]));
  });
});
