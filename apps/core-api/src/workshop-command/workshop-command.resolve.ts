import { Injectable } from '@nestjs/common';
import {
  WorkshopOrderStatus,
  type Site,
  type Vehicle,
  type WorkshopCommandPreset,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoanerVehiclesAuthorization } from '../loaner-vehicles/loaner-vehicles.authorization.js';
import {
  parseCommandText,
  resolveCommandDay,
} from './workshop-command.parse.js';
import {
  isDaylightSavingAt,
  offsetMinutesAt,
  resolveWallClock,
} from './workshop-command.time.js';
import {
  CLARIFICATION_PROMPTS,
  WORKSHOP_COMMAND_CONTRACT_VERSION,
  type Clarification,
  type ClarificationCode,
  type CommandChoice,
  type CommandSelection,
  type InterpretResult,
  type ParsedCommand,
  type PositionPlanLine,
  type WorkshopIntent,
} from './workshop-command.types.js';

const ACTIVE_ORDER_STATUSES = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

const ACTIVE_LOANER_BOOKING_STATUSES = ['RESERVED', 'HANDED_OVER'] as const;

type CustomerRow = {
  id: string;
  first_name: string;
  last_name: string;
  company_name: string | null;
};

type ResolveInput = {
  tenantId: string;
  site: Site;
  text: string;
  commandId: string;
  source: 'keyboard' | 'voice_transcript';
  now: Date;
  selections: CommandSelection[];
  offeredSelections?: CommandSelection[];
};

type ResolvedPreset = {
  preset: WorkshopCommandPreset;
  description: string;
  durationMinutes: number | null;
  unitPriceCents: number;
  unit: string;
  quantityMilli: number | null;
};

type TimeResolution =
  | {
      kind: 'ok';
      startAt: Date;
      endAt: Date;
      durationMinutes: number;
      source: 'preset_sum' | 'end_clock';
    }
  | {
      kind: 'clarification';
      code: ClarificationCode;
      choices: CommandChoice[];
      recognized: Record<string, unknown>;
    };

function choice(
  slot: string,
  value: string,
  label: string,
  prefix = slot,
): CommandChoice {
  return { choice_id: `${prefix}:${value}`, slot, value, label };
}

function clarification(
  commandId: string,
  code: ClarificationCode,
  choices: CommandChoice[],
  recognized: Record<string, unknown>,
): Clarification {
  return {
    contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
    status: 'clarification',
    command_id: commandId,
    code,
    prompt: CLARIFICATION_PROMPTS[code],
    choices,
    recognized,
    proposal: null,
  };
}

function formatCustomerName(customer: CustomerRow): string {
  return (
    customer.company_name?.trim() ||
    `${customer.first_name} ${customer.last_name}`.trim()
  );
}

function customerLabel(
  customer: CustomerRow,
  vehicle: Vehicle | undefined,
): string {
  const name = formatCustomerName(customer);
  if (!vehicle) return name;
  return `${name} — ${vehicle.model} — ${vehicle.plate ?? '—'}`;
}

function vehicleLabel(vehicle: Vehicle): string {
  return `${vehicle.model} — ${vehicle.plate ?? '—'} — ${vehicle.year}`;
}

function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[\s-]/gu, '');
}

@Injectable()
export class WorkshopCommandResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loanerAuthorization: LoanerVehiclesAuthorization,
  ) {}

  async resolve(input: ResolveInput): Promise<InterpretResult> {
    const parsed = await this.parse(
      input.tenantId,
      input.text,
      input.now,
      input.site.timezone,
    );
    return this.resolveParsed(parsed, input);
  }

  /** Parses raw text against the tenant's site codes without resolving any ids. */
  async parse(
    tenantId: string,
    text: string,
    now: Date,
    timeZone: string,
  ): Promise<ParsedCommand> {
    const sites = await this.prisma.site.findMany({
      where: { tenant_id: tenantId },
      select: { code: true, name: true },
    });
    return parseCommandText(
      text,
      { sites: sites.map((site) => ({ code: site.code, name: site.name })) },
      now,
      timeZone,
    );
  }

  async resolveParsed(
    parsed: ParsedCommand,
    input: ResolveInput,
  ): Promise<InterpretResult> {
    const selectionMap = new Map(
      input.selections.map((entry) => [entry.slot, entry.value]),
    );
    const recognized = { ...parsed.recognized };

    if (parsed.humanOnly) {
      return clarification(
        input.commandId,
        'HUMAN_ONLY_EXCLUDED',
        [],
        recognized,
      );
    }
    if (
      parsed.unsupportedGrammar ||
      !parsed.identity ||
      !parsed.day ||
      parsed.startClock === null
    ) {
      return clarification(
        input.commandId,
        'UNSUPPORTED_GRAMMAR',
        [],
        recognized,
      );
    }

    if (
      parsed.clocks.length > 1 &&
      parsed.endClock === null &&
      !selectionMap.has('local_start')
    ) {
      return clarification(
        input.commandId,
        'TIME_CONTRADICTORY',
        parsed.clocks.map((clock) =>
          choice('local_start', clock, clock, 'clock'),
        ),
        { ...recognized, clocks: parsed.clocks },
      );
    }

    if (parsed.unsupportedClauses.length > 0) {
      return clarification(input.commandId, 'UNSUPPORTED_SERVICE', [], {
        ...recognized,
        unsupported_clauses: parsed.unsupportedClauses,
      });
    }

    if (
      parsed.namedSite &&
      parsed.namedSite !== input.site.code &&
      selectionMap.get('site_constraint') !== 'continue_at_operative_site'
    ) {
      return clarification(
        input.commandId,
        'SITE_MISMATCH',
        [
          {
            choice_id: 'site:continue',
            slot: 'site_constraint',
            value: 'continue_at_operative_site',
            label: 'Am aktiven Standort bleiben',
          },
        ],
        {
          ...recognized,
          named_site_code: parsed.namedSite,
          operative_site_code: input.site.code,
        },
      );
    }

    const identityResult = await this.resolveIdentity(
      input.tenantId,
      parsed,
      selectionMap,
    );
    if ('clarification' in identityResult) {
      return clarification(
        input.commandId,
        identityResult.clarification.code,
        identityResult.clarification.choices,
        identityResult.clarification.recognized,
      );
    }
    const { customer, vehicle } = identityResult;

    const presets = await this.loadPresets(
      input.tenantId,
      input.site.id,
      parsed.presetKeys,
    );
    const recognizedBase = this.intentRecognized(
      customer,
      vehicle,
      parsed,
      input.site,
      input.now,
      presets.presetKeys,
    );
    if (presets.missingKey) {
      return clarification(
        input.commandId,
        'PRESET_NOT_CONFIGURED',
        [],
        recognizedBase,
      );
    }

    const time = this.resolveTime(
      parsed,
      input.now,
      input.site,
      selectionMap,
      presets.durationMinutes,
      recognizedBase,
    );
    if (time.kind === 'clarification') {
      return clarification(
        input.commandId,
        time.code,
        time.choices,
        time.recognized,
      );
    }

    const physical = await this.resolveResources(
      input.tenantId,
      input.site,
      time,
      parsed.loanerRequested,
      selectionMap,
    );
    if ('clarification' in physical) {
      return clarification(
        input.commandId,
        physical.clarification.code,
        physical.clarification.choices,
        physical.clarification.recognized,
      );
    }

    const lines = this.buildPositionLines(presets.resolved);
    const intent: WorkshopIntent = {
      contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
      status: 'ready',
      command_id: input.commandId,
      site_id: input.site.id,
      timezone: input.site.timezone,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      schedule: {
        local_date: this.localDate(parsed, input.now, input.site.timezone),
        local_start: parsed.startClock,
        local_end: this.clockOf(time.endAt, input.site.timezone),
        start_at: time.startAt.toISOString(),
        end_at: time.endAt.toISOString(),
        duration_minutes: time.durationMinutes,
        duration_source: time.source,
      },
      bay_id: physical.bayId,
      mechanic_id: null,
      loaner: {
        requested: Boolean(physical.loanerVehicleId),
        loaner_vehicle_id: physical.loanerVehicleId ?? null,
        planned_from: physical.loanerVehicleId
          ? time.startAt.toISOString()
          : null,
        planned_to: physical.loanerVehicleId ? time.endAt.toISOString() : null,
      },
      position_plan: { version: 1, lines },
      purpose: 'CUSTOMER_REPAIR',
      order_status: 'SCHEDULED',
      reported_issue: presets.resolved
        .map((item) => item.description)
        .join('; '),
    };
    return intent;
  }

  private localDate(
    parsed: ReturnType<typeof parseCommandText>,
    now: Date,
    timeZone: string,
  ): string {
    return resolveCommandDay(parsed.day!, now, timeZone);
  }

  private clockOf(instant: Date, timeZone: string): string {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(instant)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.hour}:${parts.minute}`;
  }

  private intentRecognized(
    customer: CustomerRow,
    vehicle: Vehicle,
    parsed: ReturnType<typeof parseCommandText>,
    site: Site,
    now: Date,
    presetKeys: string[],
  ): Record<string, unknown> {
    return {
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      local_date: resolveCommandDay(parsed.day!, now, site.timezone),
      local_start: parsed.startClock,
      timezone: site.timezone,
      preset_keys: presetKeys,
    };
  }

  private async resolveIdentity(
    tenantId: string,
    parsed: ReturnType<typeof parseCommandText>,
    selections: Map<string, string>,
  ): Promise<
    | { customer: CustomerRow; vehicle: Vehicle }
    | {
        clarification: {
          code: ClarificationCode;
          choices: CommandChoice[];
          recognized: Record<string, unknown>;
        };
      }
  > {
    if (parsed.identity?.kind === 'plate' || parsed.identity?.kind === 'vin') {
      const identity = parsed.identity;
      const isPlate = identity.kind === 'plate';
      const value = isPlate ? identity.plate : identity.vin;
      const candidates = await this.prisma.vehicle.findMany({
        where: {
          tenant_id: tenantId,
          ...(isPlate
            ? {
                OR: [
                  { plate: { equals: value, mode: 'insensitive' } },
                  { plate_normalized: normalizePlate(value) },
                ],
              }
            : { vin: { equals: value, mode: 'insensitive' } }),
        },
        orderBy: { id: 'asc' },
      });
      if (candidates.length === 0) {
        return {
          clarification: {
            code: 'VEHICLE_NOT_FOUND',
            choices: [],
            recognized: {},
          },
        };
      }
      const selected = this.pickById(candidates, selections.get('vehicle_id'));
      if (!selected) {
        return {
          clarification: {
            code: 'VEHICLE_AMBIGUOUS',
            choices: candidates.map((vehicle) =>
              choice(
                'vehicle_id',
                vehicle.id,
                vehicleLabel(vehicle),
                'vehicle',
              ),
            ),
            recognized: {},
          },
        };
      }
      if (!selected.customer_id) {
        return {
          clarification: {
            code: 'CUSTOMER_NOT_FOUND',
            choices: [],
            recognized: {},
          },
        };
      }
      const customer = await this.prisma.customer.findFirst({
        where: { id: selected.customer_id, tenant_id: tenantId },
      });
      if (!customer) {
        return {
          clarification: {
            code: 'CUSTOMER_NOT_FOUND',
            choices: [],
            recognized: {},
          },
        };
      }
      return { customer, vehicle: selected };
    }

    if (parsed.identity?.kind !== 'surname_model') {
      return {
        clarification: {
          code: 'UNSUPPORTED_GRAMMAR',
          choices: [],
          recognized: {},
        },
      };
    }

    const { surname, model } = parsed.identity;
    const customers = await this.prisma.customer.findMany({
      where: {
        tenant_id: tenantId,
        OR: [
          { last_name: { equals: surname, mode: 'insensitive' } },
          { company_name: { equals: surname, mode: 'insensitive' } },
        ],
      },
      orderBy: { id: 'asc' },
    });
    if (customers.length === 0) {
      return {
        clarification: {
          code: 'CUSTOMER_NOT_FOUND',
          choices: [],
          recognized: { customer_token: surname, vehicle_token: model },
        },
      };
    }

    const customerIds = customers.map((customer) => customer.id);
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenant_id: tenantId, customer_id: { in: customerIds } },
      orderBy: { id: 'asc' },
    });
    const selectedCustomer = this.pickById(
      customers,
      selections.get('customer_id'),
    );
    if (!selectedCustomer) {
      return {
        clarification: {
          code: 'CUSTOMER_AMBIGUOUS',
          choices: customers.map((customer) => {
            const vehicle = vehicles.find(
              (entry) => entry.customer_id === customer.id,
            );
            return choice(
              'customer_id',
              customer.id,
              customerLabel(customer, vehicle),
              'customer',
            );
          }),
          recognized: { customer_token: surname, vehicle_token: model },
        },
      };
    }

    const matchingVehicles = vehicles.filter(
      (vehicle) =>
        vehicle.customer_id === selectedCustomer.id &&
        vehicle.model.toLocaleLowerCase('de-AT') ===
          model.toLocaleLowerCase('de-AT'),
    );
    const selectedVehicle = this.pickById(
      matchingVehicles,
      selections.get('vehicle_id'),
    );
    if (!selectedVehicle) {
      return {
        clarification: {
          code:
            matchingVehicles.length === 0
              ? 'VEHICLE_NOT_FOUND'
              : 'VEHICLE_AMBIGUOUS',
          choices: matchingVehicles.map((vehicle) =>
            choice('vehicle_id', vehicle.id, vehicleLabel(vehicle), 'vehicle'),
          ),
          recognized: {
            customer_id: selectedCustomer.id,
            vehicle_token: model,
          },
        },
      };
    }

    return { customer: selectedCustomer, vehicle: selectedVehicle };
  }

  private pickById<T extends { id: string }>(
    rows: T[],
    selectedId: string | undefined,
  ): T | undefined {
    if (!selectedId) {
      return rows.length === 1 ? rows[0] : undefined;
    }
    return rows.find((row) => row.id === selectedId);
  }

  private async loadPresets(
    tenantId: string,
    siteId: string,
    presetKeys: string[],
  ): Promise<{
    resolved: ResolvedPreset[];
    durationMinutes: number[];
    presetKeys: string[];
    missingKey?: string;
  }> {
    if (presetKeys.length === 0) {
      return { resolved: [], durationMinutes: [], presetKeys: [] };
    }
    const rows = await this.prisma.workshopCommandPreset.findMany({
      where: {
        tenant_id: tenantId,
        preset_key: { in: presetKeys },
        active: true,
        OR: [{ site_id: siteId }, { site_id: null }],
      },
    });
    const laborIds = rows
      .map((row) => row.labor_operation_id)
      .filter((id): id is string => Boolean(id));
    const catalogIds = rows
      .map((row) => row.catalog_item_id)
      .filter((id): id is string => Boolean(id));
    const [laborOperations, catalogItems] = await Promise.all([
      laborIds.length
        ? this.prisma.laborOperation.findMany({
            where: { tenant_id: tenantId, id: { in: laborIds } },
          })
        : Promise.resolve([]),
      catalogIds.length
        ? this.prisma.catalogItem.findMany({
            where: { tenant_id: tenantId, id: { in: catalogIds } },
          })
        : Promise.resolve([]),
    ]);
    const laborById = new Map(
      laborOperations.map((operation) => [operation.id, operation]),
    );
    const catalogById = new Map(catalogItems.map((item) => [item.id, item]));

    const resolved: ResolvedPreset[] = [];
    const durationMinutes: number[] = [];
    for (const key of presetKeys) {
      const candidates = rows.filter((row) => row.preset_key === key);
      const preset =
        candidates.find((row) => row.site_id === siteId) ??
        candidates.find((row) => row.site_id === null);
      if (!preset) {
        return {
          resolved: [],
          durationMinutes: [],
          presetKeys,
          missingKey: key,
        };
      }
      if (preset.kind === 'LOANER_FLAG') {
        continue;
      }
      if (preset.kind === 'LABOR') {
        const operation = preset.labor_operation_id
          ? laborById.get(preset.labor_operation_id)
          : undefined;
        if (!operation || !operation.is_active) {
          return {
            resolved: [],
            durationMinutes: [],
            presetKeys,
            missingKey: key,
          };
        }
        if (preset.duration_minutes)
          durationMinutes.push(preset.duration_minutes);
        resolved.push({
          preset,
          description: operation.description,
          durationMinutes: preset.duration_minutes,
          unitPriceCents: Math.round(Number(operation.hourly_rate) * 100),
          unit: 'h',
          quantityMilli: null,
        });
        continue;
      }
      const catalogItem = preset.catalog_item_id
        ? catalogById.get(preset.catalog_item_id)
        : undefined;
      if (!catalogItem) {
        return {
          resolved: [],
          durationMinutes: [],
          presetKeys,
          missingKey: key,
        };
      }
      resolved.push({
        preset,
        description: catalogItem.name,
        durationMinutes: null,
        unitPriceCents: Math.round(Number(catalogItem.retail_price) * 100),
        unit: catalogItem.unit,
        quantityMilli: preset.quantity_milli,
      });
    }
    return { resolved, durationMinutes, presetKeys };
  }

  private resolveTime(
    parsed: ReturnType<typeof parseCommandText>,
    now: Date,
    site: Site,
    selections: Map<string, string>,
    presetDurations: number[],
    recognizedBase: Record<string, unknown>,
  ): TimeResolution {
    const localDate = resolveCommandDay(parsed.day!, now, site.timezone);
    let startClock = parsed.startClock as string;
    const selectedStartClock = selections.get('local_start');
    if (selectedStartClock && parsed.clocks.includes(selectedStartClock)) {
      startClock = selectedStartClock;
    }

    const startCandidates = resolveWallClock(
      site.timezone,
      localDate,
      startClock,
    );
    const selectedInstant = selections.get('start_at');
    let startAt: Date | undefined;
    if (selectedInstant) {
      startAt = startCandidates.find(
        (instant) => instant.toISOString() === selectedInstant,
      );
    }
    if (!startAt) {
      if (startCandidates.length === 0) {
        return {
          kind: 'clarification',
          code: 'TIME_DOES_NOT_EXIST',
          choices: [],
          recognized: {
            ...recognizedBase,
            local_date: localDate,
            local_start: startClock,
            timezone: site.timezone,
          },
        };
      }
      if (startCandidates.length > 1) {
        return {
          kind: 'clarification',
          code: 'TIME_AMBIGUOUS',
          choices: startCandidates.map((instant) => {
            const offset = offsetMinutesAt(instant, site.timezone);
            const dst = isDaylightSavingAt(instant, site.timezone);
            const label = `${startClock} ${dst ? 'Sommerzeit' : 'Winterzeit'} (UTC+${offset / 60})`;
            return choice('start_at', instant.toISOString(), label, 'instant');
          }),
          recognized: {
            ...recognizedBase,
            local_date: localDate,
            local_start: startClock,
            timezone: site.timezone,
          },
        };
      }
      startAt = startCandidates[0];
    }

    if (startAt.getTime() <= now.getTime()) {
      return {
        kind: 'clarification',
        code: 'TIME_IN_PAST',
        choices: [],
        recognized: { ...recognizedBase, start_at: startAt.toISOString() },
      };
    }

    if (parsed.endClock) {
      const endCandidates = resolveWallClock(
        site.timezone,
        localDate,
        parsed.endClock,
      );
      if (endCandidates.length === 0) {
        return {
          kind: 'clarification',
          code: 'TIME_DOES_NOT_EXIST',
          choices: [],
          recognized: {
            ...recognizedBase,
            local_date: localDate,
            local_start: startClock,
            local_end: parsed.endClock,
            timezone: site.timezone,
          },
        };
      }
      const endAt = endCandidates[0];
      if (endAt.getTime() <= startAt.getTime()) {
        return {
          kind: 'clarification',
          code: 'TIME_CONTRADICTORY',
          choices: [startClock, parsed.endClock].map((clock) =>
            choice('local_start', clock, clock, 'clock'),
          ),
          recognized: { clocks: [startClock, parsed.endClock] },
        };
      }
      return {
        kind: 'ok',
        startAt,
        endAt,
        durationMinutes: Math.round(
          (endAt.getTime() - startAt.getTime()) / 60_000,
        ),
        source: 'end_clock',
      };
    }

    if (presetDurations.length === 0) {
      return {
        kind: 'clarification',
        code: 'DURATION_REQUIRED',
        choices: [],
        recognized: { ...recognizedBase },
      };
    }
    const durationMinutes = presetDurations.reduce(
      (sum, value) => sum + value,
      0,
    );
    return {
      kind: 'ok',
      startAt,
      endAt: new Date(startAt.getTime() + durationMinutes * 60_000),
      durationMinutes,
      source: 'preset_sum',
    };
  }

  private async resolveResources(
    tenantId: string,
    site: Site,
    time: Extract<TimeResolution, { kind: 'ok' }>,
    loanerRequested: boolean,
    selections: Map<string, string>,
  ): Promise<
    | { bayId: string; loanerVehicleId?: string }
    | {
        clarification: {
          code: ClarificationCode;
          choices: CommandChoice[];
          recognized: Record<string, unknown>;
        };
      }
  > {
    const bays = await this.prisma.bay.findMany({
      where: { tenant_id: tenantId, site_id: site.id, is_active: true },
      orderBy: { sort_order: 'asc' },
    });
    const occupyingOrders = await this.prisma.workshopOrder.findMany({
      where: {
        tenant_id: tenantId,
        site_id: site.id,
        bay_id: { in: bays.map((bay) => bay.id) },
        status: { in: ACTIVE_ORDER_STATUSES },
        scheduled_start_at: { lt: time.endAt },
        scheduled_end_at: { gt: time.startAt },
      },
      select: { bay_id: true },
    });
    const occupiedBayIds = new Set(
      occupyingOrders
        .map((order) => order.bay_id)
        .filter((id): id is string => Boolean(id)),
    );
    let eligibleBays = bays.filter((bay) => !occupiedBayIds.has(bay.id));
    const selectedBay = selections.get('bay_id');
    if (selectedBay) {
      eligibleBays = eligibleBays.filter((bay) => bay.id === selectedBay);
    }
    if (eligibleBays.length === 0) {
      return {
        clarification: {
          code: 'RESOURCE_MISSING',
          choices: [],
          recognized: {},
        },
      };
    }
    const bayId = eligibleBays.length === 1 ? eligibleBays[0].id : undefined;
    if (!bayId) {
      return {
        clarification: {
          code: 'RESOURCE_AMBIGUOUS',
          choices: eligibleBays.map((bay) =>
            choice('bay_id', bay.id, bay.name, 'bay'),
          ),
          recognized: {},
        },
      };
    }

    if (
      !loanerRequested ||
      selections.get('loaner') === 'continue_without_loaner'
    ) {
      return { bayId };
    }

    try {
      await this.loanerAuthorization.assertWriteAccess();
    } catch {
      return {
        clarification: {
          code: 'LOANER_NOT_PERMITTED',
          choices: [
            choice(
              'loaner',
              'continue_without_loaner',
              'Ohne Leihwagen fortsetzen',
              'loaner',
            ),
          ],
          recognized: {},
        },
      };
    }

    const loaners = await this.prisma.loanerVehicle.findMany({
      where: {
        tenant_id: tenantId,
        site_id: site.id,
        active: true,
        status: 'AVAILABLE',
      },
      orderBy: { display_name: 'asc' },
    });
    const overlappingBookings = await this.prisma.loanerBooking.findMany({
      where: {
        tenant_id: tenantId,
        loaner_vehicle_id: { in: loaners.map((loaner) => loaner.id) },
        status: { in: [...ACTIVE_LOANER_BOOKING_STATUSES] },
        planned_from: { lt: time.endAt },
        planned_to: { gt: time.startAt },
      },
      select: { loaner_vehicle_id: true },
    });
    const bookedIds = new Set(
      overlappingBookings.map((booking) => booking.loaner_vehicle_id),
    );
    let eligibleLoaners = loaners.filter((loaner) => !bookedIds.has(loaner.id));
    const selectedLoaner = selections.get('loaner_vehicle_id');
    if (selectedLoaner) {
      eligibleLoaners = eligibleLoaners.filter(
        (loaner) => loaner.id === selectedLoaner,
      );
    }
    if (eligibleLoaners.length === 0) {
      return {
        clarification: {
          code: 'RESOURCE_MISSING',
          choices: [
            choice(
              'loaner',
              'continue_without_loaner',
              'Ohne Leihwagen fortsetzen',
              'loaner',
            ),
          ],
          recognized: {},
        },
      };
    }
    if (eligibleLoaners.length === 1) {
      return { bayId, loanerVehicleId: eligibleLoaners[0].id };
    }
    return {
      clarification: {
        code: 'RESOURCE_AMBIGUOUS',
        choices: [
          ...eligibleLoaners.map((loaner) =>
            choice(
              'loaner_vehicle_id',
              loaner.id,
              loaner.display_name,
              'loaner',
            ),
          ),
          choice(
            'loaner',
            'continue_without_loaner',
            'Ohne Leihwagen fortsetzen',
            'loaner',
          ),
        ],
        recognized: {},
      },
    };
  }

  private buildPositionLines(resolved: ResolvedPreset[]): PositionPlanLine[] {
    return resolved.map((item) => {
      if (item.preset.kind === 'LABOR') {
        const duration = item.durationMinutes ?? 0;
        return {
          ...(item.preset.preset_key
            ? { preset_key: item.preset.preset_key }
            : {}),
          kind: 'LABOR',
          labor_operation_id: item.preset.labor_operation_id,
          catalog_item_id: null,
          description: item.description,
          quantity: (duration / 60).toFixed(3),
          unit: item.unit,
          unit_price_cents: item.unitPriceCents,
          net_cents: Math.round((duration * item.unitPriceCents) / 60),
          reservation: 'not_applicable',
        };
      }
      const quantityMilli = item.quantityMilli ?? 0;
      return {
        ...(item.preset.preset_key
          ? { preset_key: item.preset.preset_key }
          : {}),
        kind: 'PART',
        labor_operation_id: null,
        catalog_item_id: item.preset.catalog_item_id,
        description: item.description,
        quantity: (quantityMilli / 1000).toFixed(3),
        unit: item.unit,
        unit_price_cents: item.unitPriceCents,
        net_cents: Math.round((quantityMilli * item.unitPriceCents) / 1000),
        reservation: 'unbooked',
      };
    });
  }
}
