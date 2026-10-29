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

type ClarificationPayload = {
  code: ClarificationCode;
  choices: CommandChoice[];
  recognized: Record<string, unknown>;
};

type IdentityResolution =
  | { customer: CustomerRow; vehicle: Vehicle }
  | { clarification: ClarificationPayload };

type PresetFailure = { missingKey: string };

type PresetBuild = ResolvedPreset | PresetFailure | null;

type PresetLoadResult = {
  resolved: ResolvedPreset[];
  durationMinutes: number[];
  presetKeys: string[];
  missingKey?: string;
};

type PresetContext = {
  rows: WorkshopCommandPreset[];
  laborById: Map<string, LaborOperationRow>;
  catalogById: Map<string, CatalogItemRow>;
};

type LaborOperationRow = Awaited<
  ReturnType<PrismaService['laborOperation']['findMany']>
>[number];
type CatalogItemRow = Awaited<
  ReturnType<PrismaService['catalogItem']['findMany']>
>[number];

function isPresetFailure(value: PresetBuild): value is PresetFailure {
  return value !== null && 'missingKey' in value;
}

function vehicleIdentityWhere(
  tenantId: string,
  identity: { kind: 'plate'; plate: string } | { kind: 'vin'; vin: string },
) {
  if (identity.kind === 'vin') {
    return {
      tenant_id: tenantId,
      vin: { equals: identity.vin, mode: 'insensitive' as const },
    };
  }
  return {
    tenant_id: tenantId,
    OR: [
      { plate: { equals: identity.plate, mode: 'insensitive' as const } },
      { plate_normalized: normalizePlate(identity.plate) },
    ],
  };
}

function customerChoices(
  customers: CustomerRow[],
  vehicles: Vehicle[],
): CommandChoice[] {
  return customers.map((customer) => {
    const vehicle = vehicles.find((entry) => entry.customer_id === customer.id);
    return choice(
      'customer_id',
      customer.id,
      customerLabel(customer, vehicle),
      'customer',
    );
  });
}

function matchingModelVehicles(
  vehicles: Vehicle[],
  customerId: string,
  model: string,
): Vehicle[] {
  return vehicles.filter(
    (vehicle) =>
      vehicle.customer_id === customerId &&
      vehicle.model.toLocaleLowerCase('de-AT') ===
        model.toLocaleLowerCase('de-AT'),
  );
}

function instantChoice(
  startClock: string,
  instant: Date,
  timeZone: string,
): CommandChoice {
  const offset = offsetMinutesAt(instant, timeZone);
  const dst = isDaylightSavingAt(instant, timeZone);
  const label = `${startClock} ${dst ? 'Sommerzeit' : 'Winterzeit'} (UTC+${offset / 60})`;
  return choice('start_at', instant.toISOString(), label, 'instant');
}

const KEEP_SITE_LABEL = 'Am aktiven Standort bleiben';
const WITHOUT_LOANER_LABEL = 'Ohne Leihwagen fortsetzen';

function buildPresetForKey(
  key: string,
  siteId: string,
  context: PresetContext,
): PresetBuild {
  const candidates = context.rows.filter((row) => row.preset_key === key);
  const preset =
    candidates.find((row) => row.site_id === siteId) ??
    candidates.find((row) => row.site_id === null);
  if (!preset) return { missingKey: key };
  if (preset.kind === 'LOANER_FLAG') return null;
  return preset.kind === 'LABOR'
    ? buildLaborPreset(preset, key, context)
    : buildCatalogPreset(preset, key, context);
}

function buildLaborPreset(
  preset: WorkshopCommandPreset,
  key: string,
  context: PresetContext,
): PresetBuild {
  const operation = preset.labor_operation_id
    ? context.laborById.get(preset.labor_operation_id)
    : undefined;
  if (!operation || !operation.is_active) return { missingKey: key };
  return {
    preset,
    description: operation.description,
    durationMinutes: preset.duration_minutes,
    unitPriceCents: Math.round(Number(operation.hourly_rate) * 100),
    unit: 'h',
    quantityMilli: null,
  };
}

function buildCatalogPreset(
  preset: WorkshopCommandPreset,
  key: string,
  context: PresetContext,
): PresetBuild {
  const catalogItem = preset.catalog_item_id
    ? context.catalogById.get(preset.catalog_item_id)
    : undefined;
  if (!catalogItem) return { missingKey: key };
  return {
    preset,
    description: catalogItem.name,
    durationMinutes: null,
    unitPriceCents: Math.round(Number(catalogItem.retail_price) * 100),
    unit: catalogItem.unit,
    quantityMilli: preset.quantity_milli,
  };
}

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
    const guarded = this.guardParsed(parsed, input, selectionMap, recognized);
    if (guarded) {
      return clarification(
        input.commandId,
        guarded.code,
        guarded.choices,
        guarded.recognized,
      );
    }

    const identity = await this.resolveIdentity(
      input.tenantId,
      parsed,
      selectionMap,
    );
    if ('clarification' in identity) {
      return clarification(
        input.commandId,
        identity.clarification.code,
        identity.clarification.choices,
        identity.clarification.recognized,
      );
    }
    const { customer, vehicle } = identity;

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

    return this.buildIntent(parsed, input, {
      customer,
      vehicle,
      presets,
      time,
      bayId: physical.bayId,
      loanerVehicleId: physical.loanerVehicleId,
    });
  }

  private guardParsed(
    parsed: ParsedCommand,
    input: ResolveInput,
    selectionMap: Map<string, string>,
    recognized: Record<string, unknown>,
  ): ClarificationPayload | null {
    return (
      this.guardShape(parsed, recognized) ??
      this.guardClocks(parsed, selectionMap, recognized) ??
      this.guardClauses(parsed, recognized) ??
      this.guardNamedSite(parsed, input.site, selectionMap, recognized)
    );
  }

  private guardShape(
    parsed: ParsedCommand,
    recognized: Record<string, unknown>,
  ): ClarificationPayload | null {
    if (parsed.humanOnly) {
      return { code: 'HUMAN_ONLY_EXCLUDED', choices: [], recognized };
    }
    if (
      parsed.unsupportedGrammar ||
      !parsed.identity ||
      !parsed.day ||
      parsed.startClock === null
    ) {
      return { code: 'UNSUPPORTED_GRAMMAR', choices: [], recognized };
    }
    return null;
  }

  private guardClocks(
    parsed: ParsedCommand,
    selectionMap: Map<string, string>,
    recognized: Record<string, unknown>,
  ): ClarificationPayload | null {
    if (
      parsed.clocks.length <= 1 ||
      parsed.endClock !== null ||
      selectionMap.has('local_start')
    ) {
      return null;
    }
    return {
      code: 'TIME_CONTRADICTORY',
      choices: parsed.clocks.map((clock) =>
        choice('local_start', clock, clock, 'clock'),
      ),
      recognized: { ...recognized, clocks: parsed.clocks },
    };
  }

  private guardClauses(
    parsed: ParsedCommand,
    recognized: Record<string, unknown>,
  ): ClarificationPayload | null {
    if (parsed.unsupportedClauses.length === 0) return null;
    return {
      code: 'UNSUPPORTED_SERVICE',
      choices: [],
      recognized: {
        ...recognized,
        unsupported_clauses: parsed.unsupportedClauses,
      },
    };
  }

  private guardNamedSite(
    parsed: ParsedCommand,
    site: Site,
    selectionMap: Map<string, string>,
    recognized: Record<string, unknown>,
  ): ClarificationPayload | null {
    if (!parsed.namedSite || parsed.namedSite === site.code) return null;
    if (selectionMap.get('site_constraint') === 'continue_at_operative_site') {
      return null;
    }
    return {
      code: 'SITE_MISMATCH',
      choices: [
        {
          choice_id: 'site:continue',
          slot: 'site_constraint',
          value: 'continue_at_operative_site',
          label: KEEP_SITE_LABEL,
        },
      ],
      recognized: {
        ...recognized,
        named_site_code: parsed.namedSite,
        operative_site_code: site.code,
      },
    };
  }

  private buildIntent(
    parsed: ParsedCommand,
    input: ResolveInput,
    resolved: {
      customer: CustomerRow;
      vehicle: Vehicle;
      presets: PresetLoadResult;
      time: Extract<TimeResolution, { kind: 'ok' }>;
      bayId: string;
      loanerVehicleId?: string;
    },
  ): WorkshopIntent {
    const { customer, vehicle, presets, time, bayId, loanerVehicleId } =
      resolved;
    const lines = this.buildPositionLines(presets.resolved);
    return {
      contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
      status: 'ready',
      command_id: input.commandId,
      site_id: input.site.id,
      timezone: input.site.timezone,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      schedule: {
        local_date: this.localDate(parsed, input.now, input.site.timezone),
        local_start: this.clockOf(time.startAt, input.site.timezone),
        local_end: this.clockOf(time.endAt, input.site.timezone),
        start_at: time.startAt.toISOString(),
        end_at: time.endAt.toISOString(),
        duration_minutes: time.durationMinutes,
        duration_source: time.source,
      },
      bay_id: bayId,
      mechanic_id: null,
      loaner: {
        requested: Boolean(loanerVehicleId),
        loaner_vehicle_id: loanerVehicleId ?? null,
        planned_from: loanerVehicleId ? time.startAt.toISOString() : null,
        planned_to: loanerVehicleId ? time.endAt.toISOString() : null,
      },
      position_plan: { version: 1, lines },
      purpose: 'CUSTOMER_REPAIR',
      order_status: 'SCHEDULED',
      reported_issue: presets.resolved
        .map((item) => item.description)
        .join('; '),
    };
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
  ): Promise<IdentityResolution> {
    const identity = parsed.identity;
    if (identity?.kind === 'plate' || identity?.kind === 'vin') {
      return this.resolveVehicleIdentity(tenantId, identity, selections);
    }
    if (identity?.kind !== 'surname_model') {
      return this.identityClarification('UNSUPPORTED_GRAMMAR', []);
    }
    return this.resolveSurnameIdentity(tenantId, identity, selections);
  }

  private identityClarification(
    code: ClarificationCode,
    choices: CommandChoice[],
    recognized: Record<string, unknown> = {},
  ): IdentityResolution {
    return { clarification: { code, choices, recognized } };
  }

  private async resolveVehicleIdentity(
    tenantId: string,
    identity: { kind: 'plate'; plate: string } | { kind: 'vin'; vin: string },
    selections: Map<string, string>,
  ): Promise<IdentityResolution> {
    const candidates = await this.prisma.vehicle.findMany({
      where: vehicleIdentityWhere(tenantId, identity),
      orderBy: { id: 'asc' },
    });
    if (candidates.length === 0) {
      return this.identityClarification('VEHICLE_NOT_FOUND', []);
    }
    const selected = this.pickById(candidates, selections.get('vehicle_id'));
    if (!selected) {
      return this.identityClarification(
        'VEHICLE_AMBIGUOUS',
        candidates.map((vehicle) =>
          choice('vehicle_id', vehicle.id, vehicleLabel(vehicle), 'vehicle'),
        ),
      );
    }
    const customer = await this.findCustomerOfVehicle(tenantId, selected);
    if (!customer) {
      return this.identityClarification('CUSTOMER_NOT_FOUND', []);
    }
    return { customer, vehicle: selected };
  }

  private async findCustomerOfVehicle(
    tenantId: string,
    vehicle: Vehicle,
  ): Promise<CustomerRow | null> {
    if (!vehicle.customer_id) return null;
    return this.prisma.customer.findFirst({
      where: { id: vehicle.customer_id, tenant_id: tenantId },
    });
  }

  private async resolveSurnameIdentity(
    tenantId: string,
    identity: { surname: string; model: string },
    selections: Map<string, string>,
  ): Promise<IdentityResolution> {
    const { surname, model } = identity;
    const tokens = { customer_token: surname, vehicle_token: model };
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
      return this.identityClarification('CUSTOMER_NOT_FOUND', [], tokens);
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: { in: customers.map((customer) => customer.id) },
      },
      orderBy: { id: 'asc' },
    });
    const selectedCustomer = this.pickById(
      customers,
      selections.get('customer_id'),
    );
    if (!selectedCustomer) {
      return this.identityClarification(
        'CUSTOMER_AMBIGUOUS',
        customerChoices(customers, vehicles),
        tokens,
      );
    }

    const matchingVehicles = matchingModelVehicles(
      vehicles,
      selectedCustomer.id,
      model,
    );
    const selectedVehicle = this.pickById(
      matchingVehicles,
      selections.get('vehicle_id'),
    );
    if (!selectedVehicle) {
      return this.identityClarification(
        matchingVehicles.length === 0
          ? 'VEHICLE_NOT_FOUND'
          : 'VEHICLE_AMBIGUOUS',
        matchingVehicles.map((vehicle) =>
          choice('vehicle_id', vehicle.id, vehicleLabel(vehicle), 'vehicle'),
        ),
        { customer_id: selectedCustomer.id, vehicle_token: model },
      );
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
  ): Promise<PresetLoadResult> {
    if (presetKeys.length === 0) {
      return { resolved: [], durationMinutes: [], presetKeys: [] };
    }
    const context = await this.loadPresetContext(tenantId, siteId, presetKeys);
    const resolved: ResolvedPreset[] = [];
    const durationMinutes: number[] = [];
    for (const key of presetKeys) {
      const built = buildPresetForKey(key, siteId, context);
      if (isPresetFailure(built)) {
        return {
          resolved: [],
          durationMinutes: [],
          presetKeys,
          missingKey: key,
        };
      }
      if (!built) continue;
      if (built.durationMinutes) durationMinutes.push(built.durationMinutes);
      resolved.push(built);
    }
    return { resolved, durationMinutes, presetKeys };
  }

  private async loadPresetContext(
    tenantId: string,
    siteId: string,
    presetKeys: string[],
  ): Promise<PresetContext> {
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
    return {
      rows,
      laborById: new Map(
        laborOperations.map((operation) => [operation.id, operation]),
      ),
      catalogById: new Map(catalogItems.map((item) => [item.id, item])),
    };
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
    const startClock = this.chooseStartClock(parsed, selections);
    const start = this.resolveStartInstant(
      site,
      localDate,
      startClock,
      selections,
      recognizedBase,
    );
    if ('clarification' in start) return start.clarification;
    if (start.startAt.getTime() <= now.getTime()) {
      return {
        kind: 'clarification',
        code: 'TIME_IN_PAST',
        choices: [],
        recognized: {
          ...recognizedBase,
          start_at: start.startAt.toISOString(),
        },
      };
    }
    if (parsed.endClock) {
      return this.resolveEndClock(
        site,
        localDate,
        start.startAt,
        parsed.endClock,
        startClock,
        recognizedBase,
      );
    }
    return this.resolvePresetDuration(
      start.startAt,
      presetDurations,
      recognizedBase,
    );
  }

  private chooseStartClock(
    parsed: ReturnType<typeof parseCommandText>,
    selections: Map<string, string>,
  ): string {
    const selected = selections.get('local_start');
    if (selected && parsed.clocks.includes(selected)) return selected;
    return parsed.startClock as string;
  }

  private resolveStartInstant(
    site: Site,
    localDate: string,
    startClock: string,
    selections: Map<string, string>,
    recognizedBase: Record<string, unknown>,
  ): { startAt: Date } | { clarification: TimeResolution } {
    const candidates = resolveWallClock(site.timezone, localDate, startClock);
    const selectedInstant = selections.get('start_at');
    const selected = selectedInstant
      ? candidates.find((instant) => instant.toISOString() === selectedInstant)
      : undefined;
    if (selected) return { startAt: selected };
    if (candidates.length === 0) {
      return {
        clarification: this.timeClarification(
          'TIME_DOES_NOT_EXIST',
          [],
          recognizedBase,
          {
            local_date: localDate,
            local_start: startClock,
            timezone: site.timezone,
          },
        ),
      };
    }
    if (candidates.length > 1) {
      return {
        clarification: this.timeClarification(
          'TIME_AMBIGUOUS',
          candidates.map((instant) =>
            instantChoice(startClock, instant, site.timezone),
          ),
          recognizedBase,
          {
            local_date: localDate,
            local_start: startClock,
            timezone: site.timezone,
          },
        ),
      };
    }
    return { startAt: candidates[0] };
  }

  private resolveEndClock(
    site: Site,
    localDate: string,
    startAt: Date,
    endClock: string,
    startClock: string,
    recognizedBase: Record<string, unknown>,
  ): TimeResolution {
    const endCandidates = resolveWallClock(site.timezone, localDate, endClock);
    if (endCandidates.length === 0) {
      return this.timeClarification('TIME_DOES_NOT_EXIST', [], recognizedBase, {
        local_date: localDate,
        local_start: startClock,
        local_end: endClock,
        timezone: site.timezone,
      });
    }
    const endAt = endCandidates[0];
    if (endAt.getTime() <= startAt.getTime()) {
      return {
        kind: 'clarification',
        code: 'TIME_CONTRADICTORY',
        choices: [startClock, endClock].map((clock) =>
          choice('local_start', clock, clock, 'clock'),
        ),
        recognized: { clocks: [startClock, endClock] },
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

  private resolvePresetDuration(
    startAt: Date,
    presetDurations: number[],
    recognizedBase: Record<string, unknown>,
  ): TimeResolution {
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

  private timeClarification(
    code: ClarificationCode,
    choices: CommandChoice[],
    recognizedBase: Record<string, unknown>,
    extra: Record<string, unknown>,
  ): TimeResolution {
    return {
      kind: 'clarification',
      code,
      choices,
      recognized: { ...recognizedBase, ...extra },
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
    | { clarification: ClarificationPayload }
  > {
    const bay = await this.resolveBay(tenantId, site, time, selections);
    if ('clarification' in bay) return bay;
    if (
      !loanerRequested ||
      selections.get('loaner') === 'continue_without_loaner'
    ) {
      return { bayId: bay.bayId };
    }
    const loaner = await this.resolveLoaner(tenantId, site, time, selections);
    if ('clarification' in loaner) return loaner;
    return { bayId: bay.bayId, loanerVehicleId: loaner.loanerVehicleId };
  }

  private async resolveBay(
    tenantId: string,
    site: Site,
    time: Extract<TimeResolution, { kind: 'ok' }>,
    selections: Map<string, string>,
  ): Promise<{ bayId: string } | { clarification: ClarificationPayload }> {
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
    const eligibleBays = bays
      .filter((bay) => !occupiedBayIds.has(bay.id))
      .filter((bay) => this.matchesSelection(bay.id, selections.get('bay_id')));
    if (eligibleBays.length === 0) {
      return {
        clarification: {
          code: 'RESOURCE_MISSING',
          choices: [],
          recognized: {},
        },
      };
    }
    if (eligibleBays.length > 1) {
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
    return { bayId: eligibleBays[0].id };
  }

  private matchesSelection(
    id: string,
    selectedId: string | undefined,
  ): boolean {
    return selectedId === undefined || id === selectedId;
  }

  private async resolveLoaner(
    tenantId: string,
    site: Site,
    time: Extract<TimeResolution, { kind: 'ok' }>,
    selections: Map<string, string>,
  ): Promise<
    { loanerVehicleId: string } | { clarification: ClarificationPayload }
  > {
    try {
      await this.loanerAuthorization.assertWriteAccess();
    } catch {
      return { clarification: this.loanerNotPermitted() };
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
    const eligibleLoaners = loaners
      .filter((loaner) => !bookedIds.has(loaner.id))
      .filter((loaner) =>
        this.matchesSelection(loaner.id, selections.get('loaner_vehicle_id')),
      );
    if (eligibleLoaners.length === 0) {
      return {
        clarification: {
          code: 'RESOURCE_MISSING',
          choices: [this.withoutLoanerChoice()],
          recognized: {},
        },
      };
    }
    if (eligibleLoaners.length > 1) {
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
            this.withoutLoanerChoice(),
          ],
          recognized: {},
        },
      };
    }
    return { loanerVehicleId: eligibleLoaners[0].id };
  }

  private withoutLoanerChoice(): CommandChoice {
    return choice(
      'loaner',
      'continue_without_loaner',
      WITHOUT_LOANER_LABEL,
      'loaner',
    );
  }

  private loanerNotPermitted(): ClarificationPayload {
    return {
      code: 'LOANER_NOT_PERMITTED',
      choices: [this.withoutLoanerChoice()],
      recognized: {},
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
